"use client";

import { useEffect, useMemo, useState } from "react";

function getApiBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || "";
  return raw.replace(/\/+$/, "");
}

export default function Home() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [health, setHealth] = useState({ status: "loading" });
  const [fires, setFires] = useState([]);
  const [firesCount, setFiresCount] = useState(null);
  const [firesLoading, setFiresLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setError(null);
        setFiresLoading(true);
        if (!apiBaseUrl) {
          throw new Error(
            "NEXT_PUBLIC_API_URL is missing. Configure it in Vercel env vars."
          );
        }

        const res = await fetch(`${apiBaseUrl}/api/health`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

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

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <nav className="main-menu" aria-label="Navigation">
        <ul>
          <li className="active">
            <a href="#">
              <i className="fa fa-home fa-2x" />
              <span className="nav-text">Dashboard</span>
            </a>
          </li>
          <li>
            <a href="#">
              <i className="fa fa-map fa-2x" />
              <span className="nav-text">Carte</span>
            </a>
          </li>
          <li>
            <a href="#">
              <i className="fa fa-bar-chart fa-2x" />
              <span className="nav-text">Statistiques</span>
            </a>
          </li>
          <li>
            <a href="#">
              <i className="fa fa-cloud fa-2x" />
              <span className="nav-text">Météo</span>
            </a>
          </li>
          <li>
            <a href="#">
              <i className="fa fa-database fa-2x" />
              <span className="nav-text">Données</span>
            </a>
          </li>
          <li>
            <a href="#">
              <i className="fa fa-info fa-2x" />
              <span className="nav-text">Documentation</span>
            </a>
          </li>
        </ul>

        <ul className="logout">
          <li>
            <a href="#">
              <i className="fa fa-power-off fa-2x" />
              <span className="nav-text">Logout</span>
            </a>
          </li>
        </ul>
      </nav>

      <main className="pl-[60px]">
        <div className="p-6">
          <h1 className="text-2xl font-semibold">PACA Incendies Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Test de déploiement Vercel + connexion API Replit
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-medium text-zinc-700">
                API Base URL
              </div>
              <div className="mt-1 break-all text-sm text-zinc-900">
                {apiBaseUrl || "(non configuré)"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <div className="text-sm font-medium text-zinc-700">
                Health
              </div>
              <div className="mt-1 text-sm text-zinc-900">
                {error ? error : JSON.stringify(health)}
              </div>
            </div>
          </div>

          <div className="mt-8">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">Incendies</h2>
              <div className="text-sm text-zinc-600">
                {firesLoading
                  ? "Chargement…"
                  : firesCount != null
                    ? `${firesCount} éléments`
                    : `${fires.length} éléments`}
              </div>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-medium text-zinc-700">Surface totale</div>
                <div className="mt-1 text-2xl font-semibold">
                  {firesStats.totalSurface.toFixed(2)} ha
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-medium text-zinc-700">Max surface</div>
                <div className="mt-1 text-2xl font-semibold">
                  {firesStats.maxSurface.toFixed(2)} ha
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="text-sm font-medium text-zinc-700">Alertes</div>
                <div className="mt-1 text-sm text-zinc-900">
                  {Object.keys(firesStats.byAlert).length === 0
                    ? "-"
                    : Object.entries(firesStats.byAlert)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-700">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Commune</th>
                    <th className="px-4 py-3 font-medium">Alerte</th>
                    <th className="px-4 py-3 font-medium">Cause</th>
                    <th className="px-4 py-3 font-medium">Surface (ha)</th>
                    <th className="px-4 py-3 font-medium">Lat</th>
                    <th className="px-4 py-3 font-medium">Lon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {firesLoading ? (
                    <tr>
                      <td className="px-4 py-4 text-zinc-600" colSpan={7}>
                        Chargement…
                      </td>
                    </tr>
                  ) : fires.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-zinc-600" colSpan={7}>
                        Aucun incendie.
                      </td>
                    </tr>
                  ) : (
                    fires
                      .slice()
                      .sort((a, b) =>
                        String(b?.date || "").localeCompare(String(a?.date || ""))
                      )
                      .map((f) => (
                        <tr key={f?.id ?? `${f?.commune}-${f?.date}`}
                            className="hover:bg-zinc-50">
                          <td className="px-4 py-3">{formatDate(f?.date)}</td>
                          <td className="px-4 py-3">{f?.commune || "-"}</td>
                          <td className="px-4 py-3">{f?.alerte || "-"}</td>
                          <td className="px-4 py-3">{f?.cause || "-"}</td>
                          <td className="px-4 py-3">
                            {typeof f?.surface_ha === "number"
                              ? f.surface_ha.toFixed(2)
                              : f?.surface_ha ?? "-"}
                          </td>
                          <td className="px-4 py-3">
                            {typeof f?.latitude === "number"
                              ? f.latitude.toFixed(5)
                              : f?.latitude ?? "-"}
                          </td>
                          <td className="px-4 py-3">
                            {typeof f?.longitude === "number"
                              ? f.longitude.toFixed(5)
                              : f?.longitude ?? "-"}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
