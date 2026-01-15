"use client";

import { MapContainer, Rectangle, TileLayer } from "react-leaflet";

export default function MiniMapPanel({ viewport, baseLayer }) {
  const center = viewport?.center
    ? [viewport.center.lat, viewport.center.lng]
    : [46.2, 2.2];
  const zoom = typeof viewport?.zoom === "number" ? Math.max(3, viewport.zoom - 4) : 3;
  const bounds = viewport?.bounds;

  const tile =
    baseLayer === "sat"
      ? {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          attribution: "Tiles © Esri",
        }
      : {
          url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution: "© OpenStreetMap",
        };

  const rectBounds =
    bounds && bounds.isValid && bounds.isValid()
      ? [
          [bounds.getSouthWest().lat, bounds.getSouthWest().lng],
          [bounds.getNorthEast().lat, bounds.getNorthEast().lng],
        ]
      : null;

  return (
    <div className="panel h-full overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="text-[12px] font-semibold text-zinc-100">Mini-carte</div>
        <div className="text-[10px] text-zinc-400">Vue globale</div>
      </div>
      <div className="h-[120px] w-full">
        <MapContainer
          center={center}
          zoom={zoom}
          zoomControl={false}
          attributionControl={false}
          dragging={false}
          doubleClickZoom={false}
          scrollWheelZoom={false}
          boxZoom={false}
          keyboard={false}
          style={{ height: "120px", width: "100%" }}
        >
          <TileLayer url={tile.url} attribution={tile.attribution} />
          {rectBounds ? (
            <Rectangle
              bounds={rectBounds}
              pathOptions={{ color: "#fb923c", weight: 2, fillOpacity: 0 }}
            />
          ) : null}
        </MapContainer>
      </div>
    </div>
  );
}
