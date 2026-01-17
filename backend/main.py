from __future__ import annotations

import csv
import json
import os
import random
import re
import shutil
import tempfile
from typing import Optional
import unicodedata
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

try:
    from db import get_database_url, db_conn
except ImportError:
    # Pas de support PostgreSQL : on désactive la base
    def get_database_url():
        return None
    from contextlib import contextmanager
    @contextmanager
    def db_conn():
        raise RuntimeError("DATABASE_URL is not set")


def _utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_git_sha_short(base_dir: str) -> str | None:
    """Best-effort git SHA for debugging deployments.

    Works when the repo is available as a git checkout (e.g., local dev, Replit
    imported from GitHub). Returns None if not available.
    """

    head_path = os.path.join(base_dir, ".git", "HEAD")
    try:
        with open(head_path, "r", encoding="utf-8") as f:
            head = f.read().strip()
    except OSError:
        return None

    if head.startswith("ref:"):
        ref = head.split(":", 1)[1].strip()
        ref_path = os.path.join(base_dir, ".git", *ref.split("/"))
        try:
            with open(ref_path, "r", encoding="utf-8") as f:
                sha = f.read().strip()
        except OSError:
            return None
    else:
        sha = head

    if re.fullmatch(r"[0-9a-fA-F]{7,40}", sha or ""):
        return sha[:7].lower()
    return None


def _strip_accents(s: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFKD", s)
        if not unicodedata.combining(c)
    )


def _norm_key(s: str) -> str:
    s = _strip_accents(s).lower()
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def _alerte_from_surface(surface_ha: float | None) -> str:
    if surface_ha is None:
        return "?"
    if surface_ha < 1:
        return "Jaune"
    if surface_ha < 10:
        return "Orange"
    if surface_ha < 50:
        return "Rouge"
    return "Noir"


def _parse_dt(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None

    # Common formats in your CSV: 09/01/1973 13:50
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            dt = datetime.strptime(value, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            continue

    return None


def _read_fires_from_csv(path: str) -> list[dict]:
    # NB: file uses semicolon delimiter and legacy encoding.
    # We decode with latin-1 to avoid crashes and keep content readable.
    with open(path, "r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        if reader.fieldnames is None:
            return []

        # Map normalized header -> actual header
        header_map = {_norm_key(h): h for h in reader.fieldnames}

        def col(*candidates: str) -> str | None:
            for c in candidates:
                key = _norm_key(c)
                if key in header_map:
                    return header_map[key]
            return None

        c_annee = col("annee")
        c_numero = col("numero", "num")
        c_departement = col("departement")
        c_insee = col("codeinsee", "insee", "codinsee")
        c_commune = col("commune")
        c_date_alerte = col("alerte")
        c_origine = col("originedelalerte", "originedalerte")
        c_surf_ha = col("surfha")
        c_surface_m2 = col("surfaceparcouruem2")

        allowed_deps = os.getenv("DEPARTEMENTS", "04,05,06,13,83,84")
        allowed = {x.strip() for x in allowed_deps.split(",") if x.strip()}

        fires: list[dict] = []
        fallback_id = 0
        for row in reader:
            dep = (row.get(c_departement) if c_departement else "")
            dep = (dep or "").strip()
            if allowed and dep and dep not in allowed:
                continue

            commune = (row.get(c_commune) if c_commune else "")
            commune = (commune or "").strip()

            surface_ha = None
            if c_surf_ha:
                raw = (row.get(c_surf_ha) or "").replace(",", ".").strip()
                try:
                    surface_ha = float(raw) if raw else None
                except ValueError:
                    surface_ha = None

            if surface_ha is None and c_surface_m2:
                raw = (row.get(c_surface_m2) or "").replace(",", ".").strip()
                try:
                    m2 = float(raw) if raw else None
                    surface_ha = (m2 / 10000.0) if m2 is not None else None
                except ValueError:
                    surface_ha = None

            dt = _parse_dt(row.get(c_date_alerte, "") if c_date_alerte else "")
            if dt is None and c_annee:
                # fallback: use Jan 1st of the year
                y = (row.get(c_annee) or "").strip()
                try:
                    dt = datetime(int(y), 1, 1, tzinfo=timezone.utc)
                except ValueError:
                    dt = datetime.now(timezone.utc)

            alerte = _alerte_from_surface(surface_ha)

            origine = (row.get(c_origine) if c_origine else "")
            origine = (origine or "").strip()
            cause = f"Origine {origine}" if origine else "Inconnue"

            insee = (row.get(c_insee) if c_insee else "")
            insee = (insee or "").strip()

            raw_id = (row.get(c_numero) if c_numero else "")
            raw_id = (raw_id or "").strip()
            try:
                fire_id = int(raw_id)
            except ValueError:
                fallback_id += 1
                fire_id = fallback_id

            fires.append(
                {
                    "id": fire_id,
                    "commune": commune or "-",
                    "latitude": None,
                    "longitude": None,
                    "surface_ha": round(surface_ha, 2) if surface_ha is not None else None,
                    "alerte": alerte,
                    "cause": cause,
                    "date": _utc_iso(dt),
                    "departement": dep or None,
                    "insee": insee or None,
                }
            )

        # Newest first
        fires.sort(key=lambda f: f.get("date", ""), reverse=True)
        max_records = int(os.getenv("MAX_FIRES", "500"))
        return fires[:max_records]


def _metrics_by_insee_from_csv(path: str, *, filters: dict | None = None) -> dict[str, dict]:
    """Aggregate metrics by INSEE directly from the CSV.

    This is used for choropleths / joins without requiring Postgres.
    """

    filters = filters or {}
    dep_filter = (filters.get("departement") or "").strip()
    alerte_filter = (filters.get("alerte") or "").strip()
    year_filter = (filters.get("year") or "").strip()
    min_surface = filters.get("min_surface")

    try:
        min_surface_f = float(min_surface) if min_surface not in (None, "") else None
    except (TypeError, ValueError):
        min_surface_f = None

    allowed_deps = os.getenv("DEPARTEMENTS", "04,05,06,13,83,84")
    allowed = {x.strip() for x in allowed_deps.split(",") if x.strip()}

    out: dict[str, dict] = {}

    with open(path, "r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        if reader.fieldnames is None:
            return {}

        header_map = {_norm_key(h): h for h in reader.fieldnames}

        def col(*candidates: str) -> str | None:
            for c in candidates:
                key = _norm_key(c)
                if key in header_map:
                    return header_map[key]
            return None

        c_departement = col("departement")
        c_insee = col("codeinsee", "insee", "codinsee")
        c_surf_ha = col("surfha")
        c_surface_m2 = col("surfaceparcouruem2")
        c_date_alerte = col("alerte")
        c_annee = col("annee")

        for row in reader:
            dep = (row.get(c_departement) if c_departement else "")
            dep = (dep or "").strip()
            if allowed and dep and dep not in allowed:
                continue
            if dep_filter and dep_filter != "all" and dep != dep_filter:
                continue

            insee = (row.get(c_insee) if c_insee else "")
            insee = (insee or "").strip()
            if not insee:
                continue

            surface_ha = None
            if c_surf_ha:
                raw = (row.get(c_surf_ha) or "").replace(",", ".").strip()
                try:
                    surface_ha = float(raw) if raw else None
                except ValueError:
                    surface_ha = None

            if surface_ha is None and c_surface_m2:
                raw = (row.get(c_surface_m2) or "").replace(",", ".").strip()
                try:
                    m2 = float(raw) if raw else None
                    surface_ha = (m2 / 10000.0) if m2 is not None else None
                except ValueError:
                    surface_ha = None

            alerte = _alerte_from_surface(surface_ha)
            if alerte_filter and alerte_filter != "all" and alerte != alerte_filter:
                continue

            if year_filter and year_filter != "all":
                dt = _parse_dt(row.get(c_date_alerte, "") if c_date_alerte else "")
                if dt is None and c_annee:
                    y = (row.get(c_annee) or "").strip()
                    try:
                        dt = datetime(int(y), 1, 1, tzinfo=timezone.utc)
                    except ValueError:
                        dt = None
                if dt is None or str(dt.year) != year_filter:
                    continue

            if min_surface_f is not None:
                s = surface_ha if surface_ha is not None else 0.0
                if s < min_surface_f:
                    continue

            agg = out.get(insee)
            if not agg:
                agg = {"fires": 0, "surface_ha": 0.0}
                out[insee] = agg
            agg["fires"] += 1
            agg["surface_ha"] = round(float(agg["surface_ha"]) + float(surface_ha or 0.0), 2)

    return out


def _generate_mock_fires(count: int = 30) -> list[dict]:
    # Random, but stable between restarts if SEED is set
    seed = os.getenv("SEED")
    rng = random.Random(int(seed) if seed and seed.isdigit() else None)

    communes = [
        "Marseille",
        "Aix-en-Provence",
        "Toulon",
        "Nice",
        "Cannes",
        "Antibes",
        "Avignon",
        "Arles",
        "Hyères",
        "La Seyne-sur-Mer",
    ]

    alertes = ["Jaune", "Orange", "Rouge", "Noir"]
    causes = ["Imprudence", "Foudre", "Travaux", "Pyromanie", "Inconnue"]

    # Rough PACA bbox
    lat_min, lat_max = 43.0, 44.8
    lon_min, lon_max = 4.7, 7.7

    now = datetime.now(timezone.utc)

    fires: list[dict] = []
    for i in range(1, count + 1):
        days_ago = rng.randint(1, 30)
        dt = now - timedelta(days=days_ago)

        fires.append(
            {
                "id": i,
                "commune": rng.choice(communes),
                "latitude": round(rng.uniform(lat_min, lat_max), 6),
                "longitude": round(rng.uniform(lon_min, lon_max), 6),
                "surface_ha": round(rng.uniform(1.0, 100.0), 2),
                "alerte": rng.choice(alertes),
                "cause": rng.choice(causes),
                "date": _utc_iso(dt),
            }
        )

    # Sort by date asc for consistent output
    fires.sort(key=lambda f: f.get("date", ""))
    return fires


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)  # simple for demo; lock down later if needed

    base_dir = os.path.dirname(os.path.abspath(__file__))
    default_csv = os.path.join(base_dir, "data", "liste_incendies_all.csv")

    cartes_dir = os.path.join(base_dir, "data", "cartes")

    def _maybe_bootstrap_qgis2web_exports() -> None:
        """Optionally download a QGIS2Web export ZIP into backend/data/cartes.

        This enables fully-online deployments where the frontend is a single link
        and the backend can fetch its required map exports at startup.

        Env vars:
        - QGIS2WEB_EXPORT_ZIP_URL: public URL to a .zip containing one or more qgis2web_* folders
          (Google Drive share links are supported when gdown is installed).
        - QGIS2WEB_EXPORTS_SKIP_BOOTSTRAP: set to 1/true/yes to disable.
        """

        if (os.getenv("QGIS2WEB_EXPORTS_SKIP_BOOTSTRAP") or "").strip().lower() in {
            "1",
            "true",
            "yes",
        }:
            return

        # Already present.
        if os.path.isdir(cartes_dir):
            try:
                for name in os.listdir(cartes_dir):
                    full = os.path.join(cartes_dir, name)
                    if os.path.isdir(full) and name.lower().startswith("qgis2web_"):
                        return
            except OSError:
                pass

        zip_url = (os.getenv("QGIS2WEB_EXPORT_ZIP_URL") or "").strip()
        if not zip_url:
            return

        os.makedirs(cartes_dir, exist_ok=True)

        def _is_google_drive_url(u: str) -> bool:
            try:
                host = urlparse(u).netloc.lower()
                return "drive.google.com" in host
            except Exception:
                return False

        def _try_extract_drive_file_id(u: str) -> Optional[str]:
            try:
                parsed = urlparse(u)
                if "drive.google.com" not in parsed.netloc.lower():
                    return None
                # /file/d/<id>/view
                m = re.search(r"/file/d/([^/]+)", parsed.path)
                if m:
                    return m.group(1)
                qs = parse_qs(parsed.query)
                if "id" in qs and qs["id"]:
                    return qs["id"][0]
                return None
            except Exception:
                return None

        with tempfile.TemporaryDirectory(prefix="qgis2web_") as td:
            zip_path = os.path.join(td, "qgis2web_export.zip")
            print(f"[qgis2web] Bootstrapping exports from: {zip_url}")

            # Prefer gdown for Google Drive (handles large-file confirmation)
            if _is_google_drive_url(zip_url):
                try:
                    import gdown  # type: ignore

                    gdown.download(url=zip_url, output=zip_path, quiet=False, fuzzy=True)
                except Exception as e:
                    file_id = _try_extract_drive_file_id(zip_url)
                    hint = (
                        "Install gdown (pip install gdown) or provide a direct public zip URL."
                    )
                    raise RuntimeError(
                        f"Failed to download from Google Drive (file_id={file_id}): {e}. {hint}"
                    )
            else:
                # Generic HTTP(S) zip URL
                try:
                    from urllib.request import urlretrieve

                    urlretrieve(zip_url, zip_path)
                except Exception as e:
                    raise RuntimeError(f"Failed to download QGIS2Web ZIP: {e}")

            if not os.path.isfile(zip_path) or os.path.getsize(zip_path) < 1024:
                raise RuntimeError("Downloaded QGIS2Web ZIP looks empty or missing")

            extract_dir = os.path.join(td, "extract")
            os.makedirs(extract_dir, exist_ok=True)
            try:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    zf.extractall(extract_dir)
            except zipfile.BadZipFile as e:
                raise RuntimeError(f"Invalid ZIP file for QGIS2Web exports: {e}")

            # Find qgis2web_* folders within extracted tree.
            found = 0
            for root, dirs, _files in os.walk(extract_dir):
                for d in list(dirs):
                    if not d.lower().startswith("qgis2web_"):
                        continue
                    src = os.path.join(root, d)
                    dst = os.path.join(cartes_dir, d)
                    if os.path.isdir(dst):
                        # Keep existing folder; don't overwrite.
                        continue
                    shutil.move(src, dst)
                    found += 1
                # Don't recurse into moved dirs
                dirs[:] = [d for d in dirs if not d.lower().startswith("qgis2web_")]

            if found == 0:
                raise RuntimeError(
                    "QGIS2Web ZIP did not contain any folder named qgis2web_*. "
                    "Please zip the export directory (including its qgis2web_* folder)."
                )

            print(f"[qgis2web] Bootstrapped {found} export folder(s) into {cartes_dir}")

    # Skip downloading QGIS2Web exports from remote sources.
    # The backend will rely only on local qgis2web_ folders that are committed in this repository.
    # Removing the call to _maybe_bootstrap_qgis2web_exports() prevents any attempt to download ZIP files.


    def _find_latest_qgis2web_export_dir() -> str | None:
        if not os.path.isdir(cartes_dir):
            return None
        candidates: list[str] = []
        for name in os.listdir(cartes_dir):
            full = os.path.join(cartes_dir, name)
            if not os.path.isdir(full):
                continue
            if not name.lower().startswith("qgis2web_"):
                continue
            candidates.append(full)
        if not candidates:
            return None
        candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return candidates[0]

    def _qgis2web_export_dir(export: str | None) -> str | None:
        if export:
            export = export.strip()
        if not export or export.lower() in {"latest", "default"}:
            return _find_latest_qgis2web_export_dir()

        # Allow passing either folder name or full path under cartes_dir
        safe = os.path.basename(export)
        full = os.path.join(cartes_dir, safe)
        if os.path.isdir(full):
            return full
        return None

    def _qgis2web_layers_dir(export_dir: str) -> str:
        return os.path.join(export_dir, "data")

    def _parse_qgis2web_styles(export_dir: str) -> dict[str, dict]:
        """Best-effort parse of QGIS2Web style_* functions from index.html.

        Supports:
        - Simple styles: return { color, weight, fillColor, fillOpacity, opacity }
        - Categorized styles: switch(String(feature.properties['FIELD'])) { case 'x': return {...}; default: ... }
        - Graduated styles: repeated if(...) { return {...} } blocks (range rules)

        Returns mapping: layer_id -> style dict
        """

        index_path = os.path.join(export_dir, "index.html")
        if not os.path.isfile(index_path):
            return {}

        try:
            with open(index_path, "r", encoding="utf-8", errors="replace") as f:
                html = f.read()
        except OSError:
            return {}

        def _extract_number(obj_text: str, key: str) -> float | None:
            m = re.search(rf"\b{re.escape(key)}\s*:\s*([0-9]+(?:\.[0-9]+)?)", obj_text)
            if not m:
                return None
            try:
                return float(m.group(1))
            except ValueError:
                return None

        def _extract_bool(obj_text: str, key: str) -> bool | None:
            m = re.search(rf"\b{re.escape(key)}\s*:\s*(true|false)\b", obj_text)
            if not m:
                return None
            return m.group(1) == "true"

        def _extract_string(obj_text: str, key: str) -> str | None:
            m = re.search(rf"\b{re.escape(key)}\s*:\s*'([^']*)'", obj_text)
            if not m:
                return None
            return m.group(1)

        def _extract_style_obj(obj_text: str) -> dict:
            """Extract a subset of style keys from a qgis2web return { ... } object."""

            # QGIS2Web commonly uses:
            # - color: stroke color
            # - fillColor: fill color
            # - weight/opacity/fillOpacity
            # - stroke/fill booleans
            return {
                "stroke": _extract_string(obj_text, "color"),
                "fill": _extract_string(obj_text, "fillColor"),
                "weight": _extract_number(obj_text, "weight"),
                "opacity": _extract_number(obj_text, "opacity"),
                "fillOpacity": _extract_number(obj_text, "fillOpacity"),
                "strokeEnabled": _extract_bool(obj_text, "stroke"),
                "fillEnabled": _extract_bool(obj_text, "fill"),
            }

        out: dict[str, dict] = {}

        # Capture each style function block
        for m in re.finditer(r"function\s+style_([A-Za-z0-9_]+)_0\s*\([^)]*\)\s*\{", html):
            layer_id = m.group(1)
            start = m.end()
            # naive brace match for function body
            depth = 1
            i = start
            while i < len(html) and depth > 0:
                ch = html[i]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                i += 1
            body = html[start : i - 1]

            # Categorized / rule-based
            field_m = re.search(r"feature\.properties\['([^']+)'\]", body)
            has_switch = "switch" in body and field_m is not None

            if has_switch:
                field = field_m.group(1)
                cases: dict[str, dict] = {}

                for cm in re.finditer(
                    r"case\s+'([^']*)'\s*:\s*return\s*\{(.*?)\}\s*;?",
                    body,
                    flags=re.DOTALL,
                ):
                    value = cm.group(1)
                    obj = cm.group(2)
                    cases[value] = _extract_style_obj(obj)

                default_m = re.search(
                    r"default\s*:\s*return\s*\{(.*?)\}\s*;?",
                    body,
                    flags=re.DOTALL,
                )
                default_obj = default_m.group(1) if default_m else ""

                default_style = _extract_style_obj(default_obj)

                out[layer_id] = {
                    "kind": "categorical",
                    "property": field,
                    "stroke": {
                        "default": default_style.get("stroke"),
                        "values": {k: v.get("stroke") for (k, v) in cases.items() if v.get("stroke")},
                    },
                    "fill": {
                        "default": default_style.get("fill"),
                        "values": {k: v.get("fill") for (k, v) in cases.items() if v.get("fill")},
                    },
                    "weight": default_style.get("weight"),
                    "opacity": default_style.get("opacity"),
                    "fillOpacity": default_style.get("fillOpacity"),
                    "strokeEnabled": default_style.get("strokeEnabled"),
                    "fillEnabled": default_style.get("fillEnabled"),
                }
                continue

            # Graduated / range rules: if (...) return { ... }
            # Example:
            # if (feature.properties['FIELD'] >= 1 && feature.properties['FIELD'] <= 3) { return {...} }
            grad_rules: list[dict] = []
            grad_field: str | None = None
            for im in re.finditer(
                r"if\s*\(\s*feature\.properties\['([^']+)'\]\s*([<>]=?)\s*([0-9]+(?:\.[0-9]+)?)\s*&&\s*feature\.properties\['([^']+)'\]\s*([<>]=?)\s*([0-9]+(?:\.[0-9]+)?)\s*\)\s*\{\s*return\s*\{(.*?)\}\s*\}",
                body,
                flags=re.DOTALL,
            ):
                field = im.group(1)
                field2 = im.group(4)
                if field2 != field:
                    continue
                op1 = im.group(2)
                v1 = float(im.group(3))
                op2 = im.group(5)
                v2 = float(im.group(6))
                obj = im.group(7)

                grad_field = grad_field or field
                if grad_field != field:
                    # Mixed-field rules are unexpected; skip to avoid wrong styling.
                    continue

                # Determine min/max from the operators.
                # Common case: >= v1 && <= v2
                min_v, max_v = (v1, v2)
                if (op1.startswith("<") and op2.startswith(">")) or (
                    op1.startswith("<=") and op2.startswith(">=")
                ):
                    min_v, max_v = (v2, v1)
                if min_v > max_v:
                    min_v, max_v = (max_v, min_v)

                style_obj = _extract_style_obj(obj)
                grad_rules.append({"min": min_v, "max": max_v, **style_obj})

            if grad_rules and grad_field:
                # Best-effort global defaults from the first rule (QGIS2Web commonly repeats these).
                first = grad_rules[0]
                out[layer_id] = {
                    "kind": "graduated",
                    "property": grad_field,
                    "rules": grad_rules,
                    "weight": first.get("weight"),
                    "opacity": first.get("opacity"),
                    "fillOpacity": first.get("fillOpacity"),
                    "strokeEnabled": first.get("strokeEnabled"),
                    "fillEnabled": first.get("fillEnabled"),
                }
                continue

            # Simple style (first return { ... })
            ret_m = re.search(r"return\s*\{(.*?)\}\s*;?", body, flags=re.DOTALL)
            obj_text = ret_m.group(1) if ret_m else ""
            if obj_text:
                style_obj = _extract_style_obj(obj_text)
                out[layer_id] = {"kind": "simple", **style_obj}

        return out

    def _list_qgis2web_layers(export_dir: str) -> list[dict]:
        layers_path = _qgis2web_layers_dir(export_dir)
        if not os.path.isdir(layers_path):
            return []

        # Preserve QGIS2Web layer order (as defined in index.html)
        index_path = os.path.join(export_dir, "index.html")
        index_html = ""
        try:
            if os.path.isfile(index_path):
                with open(index_path, "r", encoding="utf-8", errors="replace") as f:
                    index_html = f.read()
        except OSError:
            index_html = ""

        styles = _parse_qgis2web_styles(export_dir)
        out: list[dict] = []
        for filename in sorted(os.listdir(layers_path)):
            if not filename.lower().endswith(".js"):
                continue
            layer_id = os.path.splitext(filename)[0]

            order = 1_000_000_000
            if index_html:
                p1 = index_html.find(f"layer_{layer_id}")
                p2 = index_html.find(f"json_{layer_id}")
                candidates = [p for p in (p1, p2) if p != -1]
                if candidates:
                    order = min(candidates)

            # Heuristic display name: drop trailing numeric suffix if present.
            display = layer_id
            m = re.match(r"^(.*?)(?:_[0-9]+)?$", layer_id)
            if m and m.group(1):
                display = m.group(1)
            out.append(
                {
                    "id": layer_id,
                    "name": display,
                    "filename": filename,
                    "kind": "geojson",
                    "style": styles.get(layer_id),
                    "order": order,
                }
            )

        out.sort(key=lambda x: (x.get("order", 1_000_000_000), x.get("name", ""), x.get("id", "")))
        return out

    def _load_qgis2web_layer_geojson(export_dir: str, layer_id: str) -> dict:
        layers_path = _qgis2web_layers_dir(export_dir)
        # Prevent path traversal
        safe_id = os.path.basename(layer_id)
        js_path = os.path.join(layers_path, f"{safe_id}.js")
        if not os.path.isfile(js_path):
            raise FileNotFoundError(f"Layer not found: {safe_id}")

        # QGIS2Web layer files look like:
        #   var json_LayerName_0 = { ...FeatureCollection... };
        with open(js_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("Invalid QGIS2Web layer JS format")

        payload = text[start : end + 1]
        try:
            return json.loads(payload)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse GeoJSON from JS: {e}")

    def _db_enabled() -> bool:
        return bool(get_database_url())

    def _alerte_case_sql() -> str:
        # Mirrors _alerte_from_surface thresholds
        return (
            "case "
            "when surface_ha is null then '?' "
            "when surface_ha < 1 then 'Jaune' "
            "when surface_ha < 10 then 'Orange' "
            "when surface_ha < 50 then 'Rouge' "
            "else 'Noir' end"
        )

    def _fires_from_db(limit: int) -> list[dict]:
        allowed_deps = os.getenv("DEPARTEMENTS", "04,05,06,13,83,84")
        allowed = [x.strip() for x in allowed_deps.split(",") if x.strip()]

        where = ""
        params: list[object] = []
        if allowed:
            where = "where departement = any(%s)"
            params.append(allowed)

        sql = f"""
            select
              coalesce(numero, id)::bigint as id,
              coalesce(commune, '-') as commune,
              null::double precision as latitude,
              null::double precision as longitude,
              surface_ha,
              {_alerte_case_sql()} as alerte,
              'Inconnue' as cause,
              date_alerte,
              departement,
              insee
            from fires
            {where}
            order by date_alerte desc nulls last, id desc
            limit %s
        """
        params.append(limit)

        out: list[dict] = []
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                for (
                    fire_id,
                    commune,
                    lat,
                    lon,
                    surface_ha,
                    alerte,
                    cause,
                    date_alerte,
                    departement,
                    insee,
                ) in cur.fetchall():
                    dt = date_alerte
                    if isinstance(dt, datetime):
                        dt = dt.astimezone(timezone.utc)
                        date_iso = _utc_iso(dt)
                    else:
                        date_iso = _utc_iso(datetime.now(timezone.utc))

                    out.append(
                        {
                            "id": int(fire_id),
                            "commune": commune,
                            "latitude": lat,
                            "longitude": lon,
                            "surface_ha": round(float(surface_ha), 2)
                            if surface_ha is not None
                            else None,
                            "alerte": str(alerte),
                            "cause": str(cause),
                            "date": date_iso,
                            "departement": departement,
                            "insee": insee,
                        }
                    )
        return out

    def _stats_from_db() -> dict:
        allowed_deps = os.getenv("DEPARTEMENTS", "04,05,06,13,83,84")
        allowed = [x.strip() for x in allowed_deps.split(",") if x.strip()]
        where = ""
        params: list[object] = []
        if allowed:
            where = "where departement = any(%s)"
            params.append(allowed)

        alerte_sql = f"select {_alerte_case_sql()} as key, count(*)::int as n from fires {where} group by 1"
        commune_sql = f"select coalesce(commune,'?') as key, count(*)::int as n from fires {where} group by 1"
        totals_sql = f"select count(*)::int as n, coalesce(sum(coalesce(surface_ha,0)),0)::double precision as s from fires {where}"

        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(totals_sql, params)
                count, total_surface = cur.fetchone()

                cur.execute(alerte_sql, params)
                by_alerte = {str(k): int(n) for (k, n) in cur.fetchall()}

                cur.execute(commune_sql, params)
                by_commune = {str(k): int(n) for (k, n) in cur.fetchall()}

        return {
            "count": int(count),
            "total_surface_ha": round(float(total_surface), 2),
            "by_alerte": by_alerte,
            "by_commune": by_commune,
            "generated_at": _utc_iso(datetime.now(timezone.utc)),
            "source": "postgres",
        }

    def _metrics_by_insee_from_db() -> dict:
        # For choropleths / joins in the frontend by INSEE code.
        allowed_deps = os.getenv("DEPARTEMENTS", "04,05,06,13,83,84")
        allowed = [x.strip() for x in allowed_deps.split(",") if x.strip()]

        where = ""
        params: list[object] = []
        if allowed:
            where = "where departement = any(%s)"
            params.append(allowed)

        sql = f"""
          select
            insee,
            count(*)::int as fires,
            coalesce(sum(coalesce(surface_ha,0)),0)::double precision as surface_ha
          from fires
          {where}
          and insee is not null
          group by insee
        """ if where else """
          select
            insee,
            count(*)::int as fires,
            coalesce(sum(coalesce(surface_ha,0)),0)::double precision as surface_ha
          from fires
          where insee is not null
          group by insee
        """

        out: dict[str, dict] = {}
        with db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                for insee, fires_n, surf in cur.fetchall():
                    if not insee:
                        continue
                    out[str(insee)] = {
                        "fires": int(fires_n),
                        "surface_ha": round(float(surf), 2),
                    }
        return out

    def get_fires_data() -> list[dict]:
        if _db_enabled():
            limit = int(os.getenv("MAX_FIRES", "500"))
            return _fires_from_db(limit)
        path = os.getenv("FIRE_CSV_PATH", default_csv)
        if path and os.path.exists(path):
            return _read_fires_from_csv(path)
        return _generate_mock_fires(int(os.getenv("FIRE_COUNT", "30")))

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "git": _get_git_sha_short(base_dir)})

    @app.get("/api/fires")
    def fires():
        data = get_fires_data()

        mode = (request.args.get("mode") or "").strip().lower()
        pretty = (request.args.get("pretty") or "").strip().lower() in {"1", "true", "yes"}

        # Backward compatible default: { value: [...], Count: n }
        # Optional: ?mode=list to return just the array
        if mode in {"list", "array", "raw"}:
            payload = data
        else:
            payload = {"value": data, "Count": len(data)}

        # Optional: ?pretty=1 for human-readable JSON in the browser
        if pretty:
            return Response(
                json.dumps(payload, ensure_ascii=False, indent=2),
                mimetype="application/json",
            )

        return jsonify(payload)

    @app.get("/api/stats")
    def stats():
        if _db_enabled():
            return jsonify(_stats_from_db())

        data = get_fires_data()
        total_surface = sum(float(x.get("surface_ha") or 0) for x in data)

        by_alerte: dict[str, int] = {}
        by_commune: dict[str, int] = {}
        for f in data:
            a = str(f.get("alerte") or "?")
            c = str(f.get("commune") or "?")
            by_alerte[a] = by_alerte.get(a, 0) + 1
            by_commune[c] = by_commune.get(c, 0) + 1

        return jsonify(
            {
                "count": len(data),
                "total_surface_ha": round(total_surface, 2),
                "by_alerte": by_alerte,
                "by_commune": by_commune,
                "generated_at": _utc_iso(datetime.now(timezone.utc)),
                "source": "csv",
            }
        )

    @app.get("/api/metrics/insee")
    def metrics_insee():
        filters = {
            "departement": request.args.get("departement"),
            "alerte": request.args.get("alerte"),
            "year": request.args.get("year"),
            "min_surface": request.args.get("min_surface"),
        }

        if _db_enabled():
            metrics = _metrics_by_insee_from_db()
            source = "postgres"
        else:
            path = os.getenv("FIRE_CSV_PATH", default_csv)
            if not path or not os.path.exists(path):
                return jsonify({"error": "FIRE_CSV_PATH not found"}), 400
            metrics = _metrics_by_insee_from_csv(path, filters=filters)
            source = "csv"

        return jsonify(
            {
                "generated_at": _utc_iso(datetime.now(timezone.utc)),
                "source": source,
                "filters": {k: v for (k, v) in filters.items() if v not in (None, "")},
                "metrics": metrics,
            }
        )

    # -----------------
    # QGIS2Web exports
    # -----------------

    @app.get("/api/qgis2web/exports")
    def qgis2web_exports():
        if not os.path.isdir(cartes_dir):
            return jsonify({"exports": [], "default": None})

        exports = []
        for name in sorted(os.listdir(cartes_dir)):
            full = os.path.join(cartes_dir, name)
            if os.path.isdir(full) and name.lower().startswith("qgis2web_"):
                exports.append(name)

        default_dir = _find_latest_qgis2web_export_dir()
        default_name = os.path.basename(default_dir) if default_dir else None
        return jsonify({"exports": exports, "default": default_name})

    @app.get("/api/qgis2web/layers")
    def qgis2web_layers():
        export = request.args.get("export")
        export_dir = _qgis2web_export_dir(export)
        if not export_dir:
            return jsonify({"error": "No QGIS2Web export found"}), 404

        layers = _list_qgis2web_layers(export_dir)
        return jsonify(
            {
                "export": os.path.basename(export_dir),
                "layers": layers,
            }
        )

    @app.get("/api/qgis2web/layers/<layer_id>")
    def qgis2web_layer(layer_id: str):
        export = request.args.get("export")
        export_dir = _qgis2web_export_dir(export)
        if not export_dir:
            return jsonify({"error": "No QGIS2Web export found"}), 404

        try:
            geojson_obj = _load_qgis2web_layer_geojson(export_dir, layer_id)
        except FileNotFoundError:
            return jsonify({"error": "Layer not found"}), 404
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        return jsonify(
            {
                "export": os.path.basename(export_dir),
                "id": os.path.basename(layer_id),
                "geojson": geojson_obj,
            }
        )

    @app.get("/qgis2web/<export>/<path:asset_path>")
    def qgis2web_static(export: str, asset_path: str):
        """Serve static QGIS2Web export assets (for iframe embedding)."""
        export_dir = _qgis2web_export_dir(export)
        if not export_dir:
            return jsonify({"error": "Export not found"}), 404
        return send_from_directory(export_dir, asset_path)

    @app.get("/")
    def root():
        return jsonify(
            {
                "service": "PACA Incendies API",
                "endpoints": ["/api/health", "/api/fires", "/api/stats"],
            }
        )

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.getenv("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
