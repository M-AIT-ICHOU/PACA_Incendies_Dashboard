from __future__ import annotations

import os
import random
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify
from flask_cors import CORS


def _utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


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

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/fires")
    def fires():
        data = _generate_mock_fires(int(os.getenv("FIRE_COUNT", "30")))
        return jsonify({"value": data, "Count": len(data)})

    @app.get("/api/stats")
    def stats():
        data = _generate_mock_fires(int(os.getenv("FIRE_COUNT", "30")))
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
