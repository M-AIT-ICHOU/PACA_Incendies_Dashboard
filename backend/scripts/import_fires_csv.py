from __future__ import annotations

import csv
import os
from datetime import datetime, timezone

from db import db_conn


def _parse_dt(value: str) -> datetime | None:
    value = (value or "").strip()
    if not value:
        return None

    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"):
        try:
            dt = datetime.strptime(value, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass

    return None


def main() -> None:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_csv = os.path.join(base_dir, "data", "liste_incendies_all.csv")
    csv_path = os.getenv("FIRE_CSV_PATH", default_csv)

    if not os.path.exists(csv_path):
        raise SystemExit(f"CSV not found: {csv_path}")

    with open(csv_path, "r", encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        if not reader.fieldnames:
            raise SystemExit("CSV has no header")

        # expected columns from your dataset
        # Année;Numéro;Département;Code INSEE;Commune;Alerte;surf_ha
        def col(name: str) -> str:
            if name in reader.fieldnames:
                return name
            raise SystemExit(f"Missing column '{name}'")

        c_annee = col("Année")
        c_numero = col("Numéro")
        c_dep = col("Département")
        c_insee = col("Code INSEE")
        c_commune = col("Commune")
        c_date = col("Alerte")
        c_surf_ha = "surf_ha" if "surf_ha" in reader.fieldnames else None
        c_surface_m2 = "Surface parcourue (m2)" if "Surface parcourue (m2)" in reader.fieldnames else None

        rows = []
        for r in reader:
            try:
                annee = int((r.get(c_annee) or "").strip() or 0) or None
            except ValueError:
                annee = None

            try:
                numero = int((r.get(c_numero) or "").strip() or 0) or None
            except ValueError:
                numero = None

            dep = (r.get(c_dep) or "").strip() or None
            insee = (r.get(c_insee) or "").strip() or None
            commune = (r.get(c_commune) or "").strip() or None
            dt = _parse_dt(r.get(c_date) or "")

            surface_ha = None
            if c_surf_ha:
                raw = (r.get(c_surf_ha) or "").replace(",", ".").strip()
                try:
                    surface_ha = float(raw) if raw else None
                except ValueError:
                    surface_ha = None

            if surface_ha is None and c_surface_m2:
                raw = (r.get(c_surface_m2) or "").replace(",", ".").strip()
                try:
                    m2 = float(raw) if raw else None
                    surface_ha = (m2 / 10000.0) if m2 is not None else None
                except ValueError:
                    surface_ha = None

            rows.append((annee, numero, dep, insee, commune, dt, surface_ha))

    with db_conn() as conn:
        with conn.cursor() as cur:
            # schema
            schema_path = os.path.join(base_dir, "sql", "schema.sql")
            with open(schema_path, "r", encoding="utf-8") as sf:
                cur.execute(sf.read())
            conn.commit()

            # load
            cur.execute("truncate table fires;")
            conn.commit()

            cur.executemany(
                """
                insert into fires (annee, numero, departement, insee, commune, date_alerte, surface_ha)
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
            conn.commit()

            cur.execute("select count(*) from fires;")
            n = cur.fetchone()[0]

    print(f"Imported fires: {n}")


if __name__ == "__main__":
    main()
