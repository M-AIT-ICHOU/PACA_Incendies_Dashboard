"use client";

import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";

const DEPT_META = {
  "04": { name: "Alpes-de-Haute-Provence (04)", center: [44.092, 6.235] },
  "05": { name: "Hautes-Alpes (05)", center: [44.559, 6.079] },
  "06": { name: "Alpes-Maritimes (06)", center: [43.703, 7.266] },
  "13": { name: "Bouches-du-Rhône (13)", center: [43.296, 5.369] },
  "83": { name: "Var (83)", center: [43.125, 5.93] },
  "84": { name: "Vaucluse (84)", center: [43.949, 4.805] },
};

function colorForIntensity(intensity01) {
  // blue -> red
  const t = Math.max(0, Math.min(1, intensity01));
  const r = Math.round(37 + (239 - 37) * t);
  const g = Math.round(99 + (68 - 99) * t);
  const b = Math.round(235 + (68 - 235) * t);
  return `rgb(${r},${g},${b})`;
}

export default function PacaMap({ points, metricLabel }) {
  const max = Math.max(0, ...points.map((p) => p.metric || 0));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="text-sm font-medium text-zinc-700">
          Carte (synthèse par département)
        </div>
        <div className="text-xs text-zinc-500">{metricLabel}</div>
      </div>

      <div className="mt-3">
        <MapContainer center={[43.8, 6.2]} zoom={7} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {points.map((p) => {
            const meta = DEPT_META[p.departement];
            if (!meta) return null;
            const intensity = max > 0 ? (p.metric || 0) / max : 0;
            const radius = 8 + 18 * intensity;

            return (
              <CircleMarker
                key={p.departement}
                center={meta.center}
                radius={radius}
                pathOptions={{
                  color: colorForIntensity(intensity),
                  fillColor: colorForIntensity(intensity),
                  fillOpacity: 0.55,
                  weight: 2,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                  <div className="text-sm">
                    <div className="font-semibold">{meta.name}</div>
                    <div>
                      Incendies: <b>{p.count}</b>
                    </div>
                    <div>
                      Surface: <b>{p.surfaceHa.toFixed(2)} ha</b>
                    </div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>

      <div className="mt-3 text-xs text-zinc-500">
        Les points sont des centres approximatifs par département (les données
        CSV n&apos;ont pas encore de latitude/longitude incendie).
      </div>
    </div>
  );
}
