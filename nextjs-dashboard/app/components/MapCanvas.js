"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const DEPT_META = {
  "04": { name: "Alpes-de-Haute-Provence (04)", center: [44.092, 6.235] },
  "05": { name: "Hautes-Alpes (05)", center: [44.559, 6.079] },
  "06": { name: "Alpes-Maritimes (06)", center: [43.703, 7.266] },
  "13": { name: "Bouches-du-Rhône (13)", center: [43.296, 5.369] },
  "83": { name: "Var (83)", center: [43.125, 5.93] },
  "84": { name: "Vaucluse (84)", center: [43.949, 4.805] },
};

function colorForIntensity(intensity01) {
  // ember -> red
  const t = Math.max(0, Math.min(1, intensity01));
  const r = Math.round(245 + (239 - 245) * t);
  const g = Math.round(158 + (68 - 158) * t);
  const b = Math.round(11 + (68 - 11) * t);
  return `rgb(${r},${g},${b})`;
}

function toOverlayGeoJson({ points, showDeptOverlay, max }) {
  if (!showDeptOverlay) return { type: "FeatureCollection", features: [] };

  const features = (points || [])
    .map((p) => {
      const meta = DEPT_META[p.departement];
      if (!meta) return null;

      const intensity = max > 0 ? (p.metric || 0) / max : 0;
      const radius = 8 + 18 * intensity;
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [meta.center[1], meta.center[0]],
        },
        properties: {
          departement: p.departement,
          name: meta.name,
          count: p.count,
          surfaceHa: p.surfaceHa,
          metric: p.metric,
          intensity,
          radius,
          color: colorForIntensity(intensity),
        },
      };
    })
    .filter(Boolean);

  return { type: "FeatureCollection", features };
}

export default function MapCanvas({
  points,
  baseLayer,
  showDeptOverlay,
  mapMetric,
  qgisLayers,
  onViewport,
  onMap,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const eventsBoundRef = useRef(false);
  const didFitRef = useRef(false);
  const mapMetricRef = useRef(mapMetric);

  useEffect(() => {
    mapMetricRef.current = mapMetric;
  }, [mapMetric]);

  const tile = useMemo(() => {
    return baseLayer === "sat"
      ? {
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          attribution: "Tiles © Esri",
        }
      : {
          tiles: [
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
          ],
          attribution: "© OpenStreetMap",
        };
  }, [baseLayer]);

  const max = useMemo(
    () => Math.max(0, ...(points || []).map((p) => p.metric || 0)),
    [points]
  );

  const overlayGeoJson = useMemo(
    () => toOverlayGeoJson({ points, showDeptOverlay, max }),
    [points, showDeptOverlay, max]
  );

  const boundaryDataRef = useRef({});

  const qgisAddedRef = useRef(new Set());

  const qgisFallbackStyleForId = useMemo(() => {
    const palette = [
      "#60a5fa",
      "#34d399",
      "#fbbf24",
      "#fb7185",
      "#a78bfa",
      "#22d3ee",
      "#f97316",
    ];
    function hash(s) {
      let h = 0;
      for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    }
    return (id) => {
      const color = palette[hash(String(id || "layer")) % palette.length];
      return {
        stroke: color,
        fill: color,
        weight: 2.2,
        opacity: 1,
        fillOpacity: 0.14,
        circleRadius: 4.5,
      };
    };
  }, []);

  function asNumberOr(value, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function splitCssColorAlpha(color) {
    // MapLibre generally accepts CSS colors, but to better match QGIS2Web
    // we extract alpha from rgba() and apply it via opacity paint props.
    if (typeof color !== "string") return { color, alpha: 1 };
    const s = color.trim();
    const m = s.match(
      /^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i
    );
    if (!m) return { color: s, alpha: 1 };
    const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
    const a = Math.max(0, Math.min(1, Number(m[4])));
    return { color: `rgb(${r},${g},${b})`, alpha: Number.isFinite(a) ? a : 1 };
  }

  function buildMatchExpression(property, mapping, defaultColor) {
    // MapLibre match expression: ['match', ['to-string',['get',prop]], 'v1','c1', ..., default]
    const expr = ["match", ["to-string", ["get", property]]];
    for (const [k, v] of Object.entries(mapping || {})) {
      if (v) {
        expr.push(String(k));
        expr.push(String(v));
      }
    }
    expr.push(String(defaultColor || "#60a5fa"));
    return expr;
  }

  function buildRangeExpression(property, rules, key, defaultValue) {
    // MapLibre case expression for numeric ranges.
    // ['case', ['all',['>=',n,min],['<=',n,max]], value, ..., default]
    const getNum = ["to-number", ["get", property]];
    const expr = ["case"];
    for (const r of rules || []) {
      const min = Number(r?.min);
      const max = Number(r?.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      const v = r?.[key];
      if (v === null || v === undefined || v === "") continue;
      expr.push(["all", [">=", getNum, min], ["<=", getNum, max]]);
      expr.push(v);
    }
    expr.push(defaultValue);
    return expr;
  }

  function inferGeometryKind(geojson) {
    try {
      const obj = geojson;
      const f =
        obj?.type === "FeatureCollection"
          ? (obj.features || []).find((x) => x?.geometry)
          : obj?.type === "Feature"
            ? obj
            : null;
      const t = f?.geometry?.type;
      if (!t) return "unknown";
      if (t === "Polygon" || t === "MultiPolygon") return "polygon";
      if (t === "LineString" || t === "MultiLineString") return "line";
      if (t === "Point" || t === "MultiPoint") return "point";
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  function computeGeoJsonBBox(geojson) {
    // Returns [[west,south],[east,north]] in lon/lat, or null.
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;

    const visitCoords = (coords) => {
      if (!coords) return;
      if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        const lon = coords[0];
        const lat = coords[1];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
        return;
      }
      for (const c of coords) visitCoords(c);
    };

    const visitGeom = (geom) => {
      if (!geom) return;
      if (geom.type === "GeometryCollection") {
        for (const g of geom.geometries || []) visitGeom(g);
        return;
      }
      visitCoords(geom.coordinates);
    };

    const obj = geojson;
    if (!obj) return null;
    if (obj.type === "FeatureCollection") {
      for (const f of obj.features || []) visitGeom(f.geometry);
    } else if (obj.type === "Feature") {
      visitGeom(obj.geometry);
    } else if (obj.type && obj.coordinates) {
      visitGeom(obj);
    }

    if (
      !Number.isFinite(west) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(north)
    ) {
      return null;
    }
    return [
      [west, south],
      [east, north],
    ];
  }

  // Static boundary layers (served from /public/geo)
  const boundaries = useMemo(
    () => [
      {
        id: "zonePromethee",
        url: "/geo/zonePromethee.simplified.geojson",
        type: "fill",
        fillColor: "rgba(56, 189, 248, 0.18)",
        lineColor: "rgba(56, 189, 248, 0.95)",
        lineWidth: 2.4,
      },
      {
        id: "departements",
        url: "/geo/departements.simplified.geojson",
        type: "line",
        lineColor: "rgba(251, 146, 60, 0.90)",
        lineWidth: 2.2,
      },
      {
        id: "communes",
        url: "/geo/CommunesPromethee.simplified.geojson",
        type: "line",
        lineColor: "rgba(148, 163, 184, 0.55)",
        lineWidth: 1,
      },
    ],
    []
  );

  const styleSpec = useMemo(() => {
    return {
      version: 8,
      sources: {
        raster: {
          type: "raster",
          tiles: tile.tiles,
          tileSize: 256,
          attribution: tile.attribution,
        },
      },
      layers: [{ id: "raster-base", type: "raster", source: "raster" }],
    };
  }, [tile]);

  // Create map once
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [6.2, 43.8],
      zoom: 7,
      style: styleSpec,
      attributionControl: true,
    });

    mapRef.current = map;
    if (onMap) onMap(map);

    const emitViewport = () => {
      if (!onViewport) return;
      const c = map.getCenter();
      const b = map.getBounds();
      onViewport({
        center: { lat: c.lat, lng: c.lng },
        zoom: map.getZoom(),
        bounds: {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
      });
    };

    map.on("moveend", emitViewport);
    map.on("zoomend", emitViewport);

    // Reliable resize (sidebar collapse/expand)
    let ro;
    let rafId = 0;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          try {
            map.resize();
          } catch {
            // noop
          }
        });
      });
      ro.observe(containerRef.current);
    }

    // initial
    setTimeout(() => {
      try {
        map.resize();
      } catch {
        // noop
      }
      emitViewport();
    }, 0);

    return () => {
      if (ro) ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      try {
        map.remove();
      } catch {
        // noop
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update style on baseLayer change (keep camera)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    try {
      const center = map.getCenter();
      const zoom = map.getZoom();
      map.setStyle(styleSpec);
      map.once("styledata", () => {
        try {
          map.setCenter(center);
          map.setZoom(zoom);
        } catch {
          // noop
        }
      });
    } catch {
      // noop
    }
  }, [styleSpec]);

  // Overlay layer + popup
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const ensureOverlay = () => {
      try {
        if (!map.getSource("dept-overlay")) {
          map.addSource("dept-overlay", {
            type: "geojson",
            data: overlayGeoJson,
          });

          map.addLayer({
            id: "dept-circles",
            type: "circle",
            source: "dept-overlay",
            paint: {
              "circle-radius": ["get", "radius"],
              "circle-color": ["get", "color"],
              "circle-opacity": 0.55,
              "circle-stroke-color": ["get", "color"],
              "circle-stroke-width": 2,
            },
          });
        } else {
          const src = map.getSource("dept-overlay");
          if (src && typeof src.setData === "function") {
            src.setData(overlayGeoJson);
          }
        }

        if (!eventsBoundRef.current) {
          eventsBoundRef.current = true;

          popupRef.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
          });

          map.on("mousemove", "dept-circles", (e) => {
            const f = e.features && e.features[0];
            if (!f) return;
            const props = f.properties || {};

            const el = document.createElement("div");
            el.style.fontSize = "12px";
            el.style.lineHeight = "1.25";
            el.style.color = "#0b1220";

            const title = document.createElement("div");
            title.style.fontWeight = "700";
            title.textContent = props.name || "";
            el.appendChild(title);

            const line1 = document.createElement("div");
            line1.textContent = `Incendies: ${props.count ?? "-"}`;
            el.appendChild(line1);

            const line2 = document.createElement("div");
            const surfRaw = props.surfaceHa ?? "-";
            const surf =
              typeof surfRaw === "number"
                ? surfRaw.toFixed(2)
                : String(surfRaw);
            line2.textContent = `Surface: ${surf} ha`;
            el.appendChild(line2);

            const line3 = document.createElement("div");
            line3.style.opacity = "0.75";
            line3.textContent = `Mesure: ${mapMetricRef.current === "surface" ? "surface" : "nombre"}`;
            el.appendChild(line3);

            try {
              popupRef.current
                .setDOMContent(el)
                .setLngLat(e.lngLat)
                .addTo(map);
            } catch {
              // noop
            }
          });

          map.on("mouseleave", "dept-circles", () => {
            try {
              popupRef.current.remove();
            } catch {
              // noop
            }
          });
        }
      } catch {
        // If style just changed, we'll be called again.
      }
    };

    if (map.isStyleLoaded()) ensureOverlay();
    else map.once("load", ensureOverlay);
    map.on("styledata", ensureOverlay);

    return () => {
      try {
        map.off("styledata", ensureOverlay);
      } catch {
        // noop
      }
    };
  }, [overlayGeoJson]);

  // Load and render boundary GeoJSON layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const addOrUpdateBoundary = async (cfg) => {
      try {
        if (!boundaryDataRef.current[cfg.id]) {
          const res = await fetch(cfg.url);
          if (!res.ok) return;
          boundaryDataRef.current[cfg.id] = await res.json();
        }

        const data = boundaryDataRef.current[cfg.id];

        const sourceId = `src-${cfg.id}`;
        const lineLayerId = `line-${cfg.id}`;
        const fillLayerId = `fill-${cfg.id}`;

        const upsert = () => {
          const beforeId = map.getLayer("dept-circles") ? "dept-circles" : undefined;

          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: "geojson", data });
          } else {
            const src = map.getSource(sourceId);
            if (src && typeof src.setData === "function") src.setData(data);
          }

          // Fill layer (optional)
          if (cfg.type === "fill") {
            if (!map.getLayer(fillLayerId)) {
              const layer = {
                id: fillLayerId,
                type: "fill",
                source: sourceId,
                paint: {
                  "fill-color": cfg.fillColor,
                  "fill-opacity": 1,
                },
              };
              if (beforeId) map.addLayer(layer, beforeId);
              else map.addLayer(layer);
            }
          }

          // Line outline
          if (!map.getLayer(lineLayerId)) {
            const layer = {
              id: lineLayerId,
              type: "line",
              source: sourceId,
              paint: {
                "line-color": cfg.lineColor,
                "line-width": cfg.lineWidth,
              },
            };
            if (beforeId) map.addLayer(layer, beforeId);
            else map.addLayer(layer);
          }

          // Auto-zoom once to Prométhée zone bounds to make layers visible.
          if (cfg.id === "zonePromethee" && !didFitRef.current) {
            const bounds = computeGeoJsonBBox(data);
            if (bounds) {
              didFitRef.current = true;
              try {
                map.fitBounds(bounds, { padding: 24, duration: 0 });
              } catch {
                // noop
              }
            }
          }
        };

        if (map.isStyleLoaded()) upsert();
        else map.once("load", upsert);

        // Re-add after style changes (e.g. basemap reset)
        map.on("styledata", upsert);

        return () => {
          try {
            map.off("styledata", upsert);
          } catch {
            // noop
          }
        };
      } catch {
        // noop
      }
    };

    const cleanups = [];
    boundaries.forEach((b) => {
      addOrUpdateBoundary(b).then((cleanup) => {
        if (typeof cleanup === "function") cleanups.push(cleanup);
      });
    });

    return () => {
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          // noop
        }
      });
    };
  }, [boundaries]);

  // Render QGIS2Web GeoJSON layers (enabled in the right sidebar)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const desired = (qgisLayers || [])
      .filter((l) => l && l.id && l.geojson)
      .map((l) => ({
        id: String(l.id),
        geojson: l.geojson,
        style: l.style,
        order: l.order,
      }))
      .sort((a, b) => {
        const ao = typeof a.order === "number" ? a.order : Number(a.order);
        const bo = typeof b.order === "number" ? b.order : Number(b.order);
        const aok = Number.isFinite(ao) ? ao : 1e12;
        const bok = Number.isFinite(bo) ? bo : 1e12;
        if (aok !== bok) return aok - bok;
        return String(a.id).localeCompare(String(b.id));
      });

    const safeRemoveLayer = (id) => {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
      } catch {
        // noop
      }
    };
    const safeRemoveSource = (id) => {
      try {
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        // noop
      }
    };

    const upsert = () => {
      try {
        const wanted = new Set(desired.map((d) => d.id));

        // Remove layers that are no longer enabled
        for (const oldId of Array.from(qgisAddedRef.current)) {
          if (wanted.has(oldId)) continue;
          safeRemoveLayer(`qgis-fill-${oldId}`);
          safeRemoveLayer(`qgis-line-${oldId}`);
          safeRemoveLayer(`qgis-pt-${oldId}`);
          safeRemoveSource(`qgis-src-${oldId}`);
          qgisAddedRef.current.delete(oldId);
        }

        const beforeId = map.getLayer("dept-circles") ? "dept-circles" : undefined;

        // Add/update enabled layers
        for (const l of desired) {
          const sourceId = `qgis-src-${l.id}`;
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: "geojson", data: l.geojson });
          } else {
            const src = map.getSource(sourceId);
            if (src && typeof src.setData === "function") src.setData(l.geojson);
          }

          const kind = inferGeometryKind(l.geojson);
          const fallback = qgisFallbackStyleForId(l.id);
          const style = l.style;

          const strokeDefault =
            style?.kind === "simple"
              ? style.stroke
              : style?.kind === "categorical"
                ? style?.stroke?.default
                : style?.kind === "graduated"
                  ? (style?.rules || []).find((r) => r?.stroke)?.stroke
                  : undefined;

          const fillDefault =
            style?.kind === "simple"
              ? style.fill
              : style?.kind === "categorical"
                ? style?.fill?.default
                : style?.kind === "graduated"
                  ? (style?.rules || []).find((r) => r?.fill)?.fill
                  : undefined;

          const transparent = "rgba(0,0,0,0)";
          const hasStyle = !!style;
          // If the export explicitly sets stroke/fill to null, keep it as "none"
          // instead of introducing our fallback palette (which changes appearance).
          const strokeColor = hasStyle ? (strokeDefault ?? transparent) : (strokeDefault || fallback.stroke);
          const fillColor = hasStyle ? (fillDefault ?? transparent) : (fillDefault || fallback.fill);

          const lineWidth = asNumberOr(style?.weight, fallback.weight);
          const lineOpacity = asNumberOr(style?.opacity, fallback.opacity);
          const fillOpacity = asNumberOr(style?.fillOpacity, fallback.fillOpacity);

          const strokeExpr =
            style?.kind === "categorical" && style?.property
              ? buildMatchExpression(style.property, style?.stroke?.values, strokeColor)
              : style?.kind === "graduated" && style?.property
                ? buildRangeExpression(style.property, style?.rules, "stroke", strokeColor)
                : strokeColor;

          const fillExpr =
            style?.kind === "categorical" && style?.property
              ? buildMatchExpression(style.property, style?.fill?.values, fillColor)
              : style?.kind === "graduated" && style?.property
                ? buildRangeExpression(style.property, style?.rules, "fill", fillColor)
                : fillColor;

          const isSimple = style?.kind === "simple";

          let strokePaintColor = strokeExpr;
          let strokePaintOpacity = lineOpacity;
          if (isSimple && typeof strokeExpr === "string") {
            const s = splitCssColorAlpha(strokeExpr);
            strokePaintColor = s.color;
            strokePaintOpacity = s.alpha * lineOpacity;
          }

          let fillPaintColor = fillExpr;
          let fillPaintOpacity = fillOpacity;
          if (isSimple && typeof fillExpr === "string") {
            const f = splitCssColorAlpha(fillExpr);
            fillPaintColor = f.color;
            fillPaintOpacity = f.alpha * fillOpacity;
          }

          if (kind === "polygon") {
            const fillEnabled = style?.fillEnabled;
            if (fillEnabled === false) {
              safeRemoveLayer(`qgis-fill-${l.id}`);
            } else {
            const fillId = `qgis-fill-${l.id}`;
            if (!map.getLayer(fillId)) {
              const layer = {
                id: fillId,
                type: "fill",
                source: sourceId,
                paint: {
                  "fill-color": fillPaintColor,
                  "fill-opacity": fillPaintOpacity,
                },
              };
              if (beforeId) map.addLayer(layer, beforeId);
              else map.addLayer(layer);
            } else {
              try {
                map.setPaintProperty(fillId, "fill-color", fillPaintColor);
                map.setPaintProperty(fillId, "fill-opacity", fillPaintOpacity);
              } catch {
                // noop
              }
            }
            }
          }

          if (kind === "point") {
            const ptId = `qgis-pt-${l.id}`;
            if (!map.getLayer(ptId)) {
              const layer = {
                id: ptId,
                type: "circle",
                source: sourceId,
                paint: {
                  "circle-radius": fallback.circleRadius,
                  "circle-color": fillPaintColor,
                  "circle-opacity": Math.max(0, Math.min(1, fillPaintOpacity)),
                  "circle-stroke-color": strokePaintColor,
                  "circle-stroke-width": 1,
                },
              };
              if (beforeId) map.addLayer(layer, beforeId);
              else map.addLayer(layer);
            } else {
              try {
                map.setPaintProperty(ptId, "circle-color", fillPaintColor);
                map.setPaintProperty(ptId, "circle-opacity", Math.max(0, Math.min(1, fillPaintOpacity)));
                map.setPaintProperty(ptId, "circle-stroke-color", strokePaintColor);
              } catch {
                // noop
              }
            }
          }

          const lineId = `qgis-line-${l.id}`;
          let strokeEnabled = style?.strokeEnabled;
          if (style?.kind === "graduated" && Array.isArray(style?.rules)) {
            // If every rule explicitly disables stroke, hide outlines.
            const anyStrokeRuleEnabled = style.rules.some((r) => r?.strokeEnabled !== false);
            strokeEnabled = anyStrokeRuleEnabled;
          }

          const shouldDrawLine = kind === "line" || (kind === "polygon" ? strokeEnabled !== false : true);
          if (!shouldDrawLine) {
            safeRemoveLayer(lineId);
          } else if (!map.getLayer(lineId)) {
            const layer = {
              id: lineId,
              type: "line",
              source: sourceId,
              paint: {
                "line-color": strokePaintColor,
                "line-width": lineWidth,
                "line-opacity": strokePaintOpacity,
              },
            };
            if (beforeId) map.addLayer(layer, beforeId);
            else map.addLayer(layer);
          } else {
            try {
              map.setPaintProperty(lineId, "line-color", strokePaintColor);
              map.setPaintProperty(lineId, "line-width", lineWidth);
              map.setPaintProperty(lineId, "line-opacity", strokePaintOpacity);
            } catch {
              // noop
            }
          }

          qgisAddedRef.current.add(l.id);
        }

        // Enforce deterministic stacking order (bottom -> top) below the dept overlay.
        try {
          const before = map.getLayer("dept-circles") ? "dept-circles" : undefined;
          if (!before) return;

          const stack = [];
          for (const l of desired) {
            const kind = inferGeometryKind(l.geojson);
            if (kind === "polygon") stack.push(`qgis-fill-${l.id}`);
            if (kind === "point") stack.push(`qgis-pt-${l.id}`);
            stack.push(`qgis-line-${l.id}`);
          }

          for (let i = 0; i < stack.length; i += 1) {
            const layerId = stack[i];
            const nextId = i + 1 < stack.length ? stack[i + 1] : before;
            if (!map.getLayer(layerId)) continue;
            if (nextId && map.getLayer(nextId)) {
              map.moveLayer(layerId, nextId);
            } else {
              map.moveLayer(layerId, before);
            }
          }
        } catch {
          // noop
        }
      } catch {
        // noop
      }
    };

    if (map.isStyleLoaded()) upsert();
    else map.once("load", upsert);
    map.on("styledata", upsert);

    return () => {
      try {
        map.off("styledata", upsert);
      } catch {
        // noop
      }
    };
  }, [qgisLayers, qgisFallbackStyleForId]);

  return <div ref={containerRef} className="relative h-full w-full" />;
}
