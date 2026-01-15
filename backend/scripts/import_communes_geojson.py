from __future__ import annotations

import json
import os

from db import db_conn


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    geo_path = os.getenv(
        "COMMUNES_GEOJSON",
        os.path.join(
            root,
            "..",
            "nextjs-dashboard",
            "public",
            "geo",
            "CommunesPromethee.simplified.geojson",
        ),
    )

    geo_path = os.path.abspath(geo_path)
    if not os.path.exists(geo_path):
        raise SystemExit(f"GeoJSON not found: {geo_path}")

    with open(geo_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    feats = data.get("features") or []
    rows = []
    for ft in feats:
        props = ft.get("properties") or {}
        insee = (props.get("insee") or "").strip()
        nom = (props.get("nom") or "").strip()
        if not insee:
            continue
        rows.append((insee, nom or None))

    with db_conn() as conn:
        with conn.cursor() as cur:
            schema_path = os.path.join(root, "sql", "schema.sql")
            with open(schema_path, "r", encoding="utf-8") as sf:
                cur.execute(sf.read())
            conn.commit()

            cur.execute("truncate table communes;")
            conn.commit()

            cur.executemany(
                "insert into communes (insee, nom) values (%s, %s) on conflict (insee) do update set nom = excluded.nom",
                rows,
            )
            conn.commit()

            cur.execute("select count(*) from communes;")
            n = cur.fetchone()[0]

    print(f"Imported communes: {n}")


if __name__ == "__main__":
    main()
