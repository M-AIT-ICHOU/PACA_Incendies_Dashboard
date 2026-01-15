"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import HeaderBar from "./components/HeaderBar";
import StatCard from "./components/StatCard";

const MapCanvas = dynamic(() => import("./components/MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="panel flex h-full w-full items-center justify-center rounded-2xl p-6 text-sm text-zinc-300">
      Chargement de la carte…
    </div>
  ),
});

const AlertsPie = dynamic(
  () => import("./components/FiresCharts").then((m) => m.AlertsPie),
  { ssr: false }
);
const DeptBar = dynamic(
  () => import("./components/FiresCharts").then((m) => m.DeptBar),
  { ssr: false }
);
const MonthlyLine = dynamic(
  () => import("./components/FiresCharts").then((m) => m.MonthlyLine),
  { ssr: false }
);

function getApiBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || "";
  return raw.replace(/\/+$/, "");
}

export default function Home() {
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getApiBaseUrl());
  const [health, setHealth] = useState({ status: "loading" });
  const [fires, setFires] = useState([]);
  const [firesCount, setFiresCount] = useState(null);
  const [firesLoading, setFiresLoading] = useState(true);
  const [error, setError] = useState(null);

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const [qgisExport, setQgisExport] = useState(null);
  const [qgisLayers, setQgisLayers] = useState([]);
  const [qgisLayersLoading, setQgisLayersLoading] = useState(false);
  const [qgisLayersError, setQgisLayersError] = useState(null);
  const [layerEnabled, setLayerEnabled] = useState({});
  const [layerGeojson, setLayerGeojson] = useState({});

  const [deptFilter, setDeptFilter] = useState("all");
  const [alerteFilter, setAlerteFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [minSurface, setMinSurface] = useState("0");
  const [mapMetric, setMapMetric] = useState("count");

  const [baseLayer] = useState("osm");
  const [showDeptOverlay] = useState(true);

  const qgisLayersSorted = useMemo(() => {
    const arr = Array.isArray(qgisLayers) ? [...qgisLayers] : [];
    arr.sort((a, b) => {
      const ao = typeof a?.order === "number" ? a.order : Number(a?.order);
      const bo = typeof b?.order === "number" ? b.order : Number(b?.order);
      const aok = Number.isFinite(ao) ? ao : 1e12;
      const bok = Number.isFinite(bo) ? bo : 1e12;
      if (aok !== bok) return aok - bok;
      return String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""));
    });
    return arr;
  }, [qgisLayers]);

  const enabledQgisLayers = useMemo(() => {
    return qgisLayersSorted
      .filter((l) => l?.id && layerEnabled[l.id] && layerGeojson[l.id])
      .map((l) => ({
        id: l.id,
        geojson: layerGeojson[l.id],
        style: l.style,
        order: l.order,
      }));
  }, [qgisLayersSorted, layerEnabled, layerGeojson]);

  // Local-dev fallback (client-only) to avoid SSR/client HTML mismatch.
  useEffect(() => {
    if (apiBaseUrl) return;
    try {
      const host = window.location?.hostname;
      if (host === "localhost" || host === "127.0.0.1") {
        setApiBaseUrl("http://127.0.0.1:8000");
      }
    } catch {
      // noop
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setError(null);
        setFiresLoading(true);
        if (!apiBaseUrl) {
          // Don’t throw: we may set a client-only localhost fallback right after mount.
          setHealth({ status: "error" });
          setFires([]);
          setFiresCount(null);
          setFiresLoading(false);
          setError(
            "API non configurée. Définis NEXT_PUBLIC_API_URL (ou utilise le fallback localhost)."
          );
          return;
        }

        const [healthRes, firesRes] = await Promise.all([
          fetch(`${apiBaseUrl}/api/health`, {
            method: "GET",
            headers: { Accept: "application/json" },
          }),
          fetch(`${apiBaseUrl}/api/fires`, {
            method: "GET",
            headers: { Accept: "application/json" },
          }),
        ]);

        if (!healthRes.ok) {
          throw new Error(`Health check failed (${healthRes.status})`);
        }

        if (!firesRes.ok) {
          throw new Error(`Fires fetch failed (${firesRes.status})`);
        }

        const healthData = await healthRes.json();
        const firesData = await firesRes.json();

        const items = Array.isArray(firesData)
          ? firesData
          : Array.isArray(firesData?.value)
            ? firesData.value
            : [];

        const count =
          typeof firesData?.Count === "number"
            ? firesData.Count
            : typeof firesData?.count === "number"
              ? firesData.count
              : items.length;

        if (!cancelled) {
          setHealth(healthData);
          setFires(items);
          setFiresCount(count);
          setFiresLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setHealth({ status: "error" });
          setFires([]);
          setFiresCount(null);
          setFiresLoading(false);
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setQgisLayersError(null);
        setQgisLayersLoading(true);
        if (!apiBaseUrl) {
          if (!cancelled) setQgisLayersLoading(false);
          return;
        }

        const res = await fetch(`${apiBaseUrl}/api/qgis2web/layers`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`QGIS2Web layers fetch failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setQgisExport(data?.export || null);
          setQgisLayers(Array.isArray(data?.layers) ? data.layers : []);
          setQgisLayersLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setQgisExport(null);
          setQgisLayers([]);
          setQgisLayersLoading(false);
          setQgisLayersError(e instanceof Error ? e.message : "Unknown error");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  async function toggleQgisLayer(id) {
    if (!id) return;
    const willEnable = !layerEnabled[id];
    setLayerEnabled((prev) => ({ ...prev, [id]: willEnable }));
    if (!willEnable) return;
    if (layerGeojson[id]) return;
    if (!apiBaseUrl) return;

    try {
      const res = await fetch(
        `${apiBaseUrl}/api/qgis2web/layers/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );
      if (!res.ok) throw new Error(`Layer ${id} fetch failed (${res.status})`);
      const data = await res.json();
      const gj = data?.geojson;
      if (gj) setLayerGeojson((prev) => ({ ...prev, [id]: gj }));
    } catch {
      setLayerEnabled((prev) => ({ ...prev, [id]: false }));
    }
  }

  const firesStats = useMemo(() => {
    const totalSurface = fires.reduce((sum, f) => {
      const v = typeof f?.surface_ha === "number" ? f.surface_ha : Number(f?.surface_ha);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);

    const byAlert = fires.reduce((acc, f) => {
      const key = (f?.alerte || "?").toString();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const maxSurface = fires.reduce((mx, f) => {
      const v = typeof f?.surface_ha === "number" ? f.surface_ha : Number(f?.surface_ha);
      return Number.isFinite(v) ? Math.max(mx, v) : mx;
    }, 0);

    return { totalSurface, byAlert, maxSurface };
  }, [fires]);

  const meta = useMemo(() => {
    const deps = new Set();
    const years = new Set();
    const alertes = new Set();
    for (const f of fires) {
      if (f?.departement) deps.add(String(f.departement));
      if (f?.alerte) alertes.add(String(f.alerte));
      const d = new Date(f?.date);
      if (!Number.isNaN(d.getTime())) years.add(String(d.getFullYear()));
    }
    return {
      deps: Array.from(deps).sort(),
      years: Array.from(years).sort((a, b) => Number(b) - Number(a)),
      alertes: Array.from(alertes).sort(),
    };
  }, [fires]);

  const filteredFires = useMemo(() => {
    const min = Number(minSurface);
    const minOk = Number.isFinite(min) ? min : 0;
    return fires.filter((f) => {
      const depOk = deptFilter === "all" || String(f?.departement || "") === deptFilter;
      const alOk =
        alerteFilter === "all" || String(f?.alerte || "") === alerteFilter;

      let yOk = true;
      if (yearFilter !== "all") {
        const d = new Date(f?.date);
        yOk = !Number.isNaN(d.getTime()) && String(d.getFullYear()) === yearFilter;
      }

      const s =
        typeof f?.surface_ha === "number" ? f.surface_ha : Number(f?.surface_ha);
      const sOk = !Number.isFinite(s) ? minOk <= 0 : s >= minOk;
      return depOk && alOk && yOk && sOk;
    });
  }, [fires, deptFilter, alerteFilter, yearFilter, minSurface]);

  const aggregates = useMemo(() => {
    const byDept = new Map();
    const byAlerte = new Map();
    const byMonth = new Map();

    let totalSurface = 0;
    let maxSurface = 0;

    for (const f of filteredFires) {
      const dep = String(f?.departement || "?");
      const al = String(f?.alerte || "?");
      const s =
        typeof f?.surface_ha === "number" ? f.surface_ha : Number(f?.surface_ha);
      const surface = Number.isFinite(s) ? s : 0;
      totalSurface += surface;
      maxSurface = Math.max(maxSurface, surface);

      byAlerte.set(al, (byAlerte.get(al) || 0) + 1);

      const depAgg = byDept.get(dep) || { count: 0, surfaceHa: 0 };
      depAgg.count += 1;
      depAgg.surfaceHa += surface;
      byDept.set(dep, depAgg);

      const d = new Date(f?.date);
      if (!Number.isNaN(d.getTime())) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        byMonth.set(key, (byMonth.get(key) || 0) + 1);
      }
    }

    const byDeptData = Array.from(byDept.entries())
      .map(([name, v]) => ({ name, count: v.count, surfaceHa: v.surfaceHa }))
      .sort((a, b) => b.count - a.count);

    const byAlerteData = Array.from(byAlerte.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const byMonthData = Array.from(byMonth.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const mapPoints = byDeptData
      .filter((d) => /^[0-9]{2}$/.test(d.name))
      .map((d) => ({
        departement: d.name,
        count: d.count,
        surfaceHa: d.surfaceHa,
        metric: mapMetric === "surface" ? d.surfaceHa : d.count,
      }));

    return {
      totalSurface,
      maxSurface,
      byDeptData,
      byAlerteData,
      byMonthData,
      mapPoints,
    };
  }, [filteredFires, mapMetric]);

  // Timeline/minimap/layers are temporarily removed; keeping the map full-screen.

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "-";
      return new Intl.DateTimeFormat("fr-FR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    } catch {
      return "-";
    }
  }

  function formatNumber(n) {
    try {
      return new Intl.NumberFormat("fr-FR").format(n);
    } catch {
      return String(n);
    }
  }

  const visibleCount = filteredFires.length;
  const leftSidebarWidth = leftCollapsed ? 20 : 340;
  const rightSidebarWidth = rightCollapsed ? 20 : 320;
  // Keep the map flush to the sidebar edge (no visible gap).
  // The collapse handle intentionally overlaps the map.
  const mapLeftOffset = leftSidebarWidth;
  const mapRightOffset = rightSidebarWidth;

  // MapLibre handles resize internally via ResizeObserver.

  return (
    <div className="app-shell h-screen overflow-hidden text-zinc-100">
      <HeaderBar title="Prométhée Fire Dashboard" />

      <div className="relative h-[calc(100vh-48px)] w-full overflow-hidden">
        {/* Map background (behind header/sidebar) */}
        <div
          className="absolute top-0 bottom-0 z-0"
          style={{ left: mapLeftOffset, right: mapRightOffset }}
        >
          <div className="h-full w-full overflow-hidden rounded-none border border-white/10 shadow-none">
          <MapCanvas
            apiBaseUrl={apiBaseUrl}
            points={aggregates.mapPoints}
            baseLayer={baseLayer}
            showDeptOverlay={showDeptOverlay}
            mapMetric={mapMetric}
            qgisLayers={enabledQgisLayers}
            filters={{
              departement: deptFilter,
              alerte: alerteFilter,
              year: yearFilter,
              minSurface,
            }}
          />
          </div>
        </div>

        {/* Left sidebar: analytics (floats above the map) */}
        <aside
          className="absolute left-0 top-0 z-30 h-full overflow-visible border-r border-white/10 bg-gradient-to-b from-slate-950 via-slate-950/90 to-slate-950/70 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          style={{ width: leftSidebarWidth }}
        >
          {/* Collapse handle (sits on the border) */}
          <button
            className="absolute right-0 top-3 z-40 grid h-6 w-6 translate-x-1/2 place-items-center rounded-full border border-white/10 bg-slate-950/85 text-[14px] leading-none text-sky-200 shadow-[0_8px_22px_rgba(0,0,0,0.6)] backdrop-blur hover:bg-slate-950 hover:text-sky-100"
            onClick={() => setLeftCollapsed((v) => !v)}
            aria-label={leftCollapsed ? "Agrandir la barre" : "Réduire la barre"}
            title={leftCollapsed ? "Agrandir" : "Réduire"}
          >
            {leftCollapsed ? "›" : "‹"}
          </button>

          <div
            className={
              leftCollapsed
                ? "h-full overflow-hidden"
                : "scrollbar-hover h-full overflow-y-auto"
            }
          >
            <div
              className={`flex items-center justify-between ${
                leftCollapsed ? "px-2" : "px-4"
              } py-3`}
            >
              <div className="text-sm font-semibold text-zinc-100">
                {leftCollapsed ? "" : "Analytique"}
              </div>
              {!leftCollapsed ? (
                <div className="text-[11px] text-zinc-400">
                  {firesLoading
                    ? "chargement"
                    : `${formatNumber(visibleCount)} incendies`}
                </div>
              ) : null}
            </div>

            {leftCollapsed ? (
              <div className="h-full" />
            ) : (
              <div className="px-4 pb-4">

          {!apiBaseUrl ? (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[12px] text-amber-100">
              <div className="font-semibold">API non configurée</div>
              <div className="mt-1 text-amber-100/80">
                Ajoute <span className="font-mono">NEXT_PUBLIC_API_URL</span> dans
                <span className="font-mono"> nextjs-dashboard/.env.local</span> (ou dans
                Vercel) pour charger les données.
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-[12px] text-red-100">
              <div className="font-semibold">Erreur de chargement</div>
              <div className="mt-1 break-words text-red-100/80">{error}</div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3">
            <StatCard
              label="Surface totale (filtrée)"
              value={`${aggregates.totalSurface.toFixed(2)} ha`}
              hint="selon filtres / année"
            />
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Max surface"
                value={`${aggregates.maxSurface.toFixed(2)} ha`}
              />
              <StatCard
                label="API"
                value={error ? "Erreur" : health?.status === "ok" ? "OK" : "…"}
                hint={apiBaseUrl ? "connectée" : "manquante"}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            <AlertsPie data={aggregates.byAlerteData} />
            <DeptBar data={aggregates.byDeptData} />
            <MonthlyLine data={aggregates.byMonthData} />
          </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right sidebar: QGIS2Web layers */}
        <aside
          className="absolute right-0 top-0 z-30 h-full overflow-visible border-l border-white/10 bg-gradient-to-b from-slate-950 via-slate-950/90 to-slate-950/70 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          style={{ width: rightSidebarWidth }}
        >
          <button
            className="absolute left-0 top-3 z-40 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border border-white/10 bg-slate-950/85 text-[14px] leading-none text-sky-200 shadow-[0_8px_22px_rgba(0,0,0,0.6)] backdrop-blur hover:bg-slate-950 hover:text-sky-100"
            onClick={() => setRightCollapsed((v) => !v)}
            aria-label={rightCollapsed ? "Agrandir le panneau" : "Réduire le panneau"}
            title={rightCollapsed ? "Agrandir" : "Réduire"}
          >
            {rightCollapsed ? "‹" : "›"}
          </button>

          <div
            className={
              rightCollapsed
                ? "h-full overflow-hidden"
                : "scrollbar-hover h-full overflow-y-auto"
            }
          >
            <div className={`flex items-center justify-between ${rightCollapsed ? "px-2" : "px-4"} py-3`}>
              <div className="text-sm font-semibold text-zinc-100">
                {rightCollapsed ? "" : "Couches"}
              </div>
              {!rightCollapsed ? (
                <div className="text-[11px] text-zinc-400">
                  {qgisLayersLoading ? "chargement" : `${qgisLayers.length} couches`}
                </div>
              ) : null}
            </div>

            {rightCollapsed ? (
              <div className="h-full" />
            ) : (
              <div className="px-4 pb-4">
                {qgisExport ? (
                  <div className="text-[11px] text-zinc-500">Export: {qgisExport}</div>
                ) : null}

                {qgisLayersError ? (
                  <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-[12px] text-red-100">
                    <div className="font-semibold">Erreur couches</div>
                    <div className="mt-1 break-words text-red-100/80">{qgisLayersError}</div>
                  </div>
                ) : null}

                <div className="mt-3 space-y-2">
                  {qgisLayersSorted.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-200"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-sky-500"
                        checked={!!layerEnabled[l.id]}
                        onChange={() => toggleQgisLayer(l.id)}
                      />
                      <span className="truncate">{l.name || l.id}</span>
                    </label>
                  ))}
                  {!qgisLayersLoading && qgisLayers.length === 0 ? (
                    <div className="text-[12px] text-zinc-500">Aucune couche trouvée.</div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
