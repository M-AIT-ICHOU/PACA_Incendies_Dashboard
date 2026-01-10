from __future__ import annotations

import csv
import os
import random
import re
import unicodedata
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify
from flask_cors import CORS


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

    def get_fires_data() -> list[dict]:
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
        return jsonify({"value": data, "Count": len(data)})

    @app.get("/api/stats")
    def stats():
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
            }
        )

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
