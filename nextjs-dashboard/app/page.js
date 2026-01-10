"use client";

import { useEffect, useMemo, useState } from "react";

function getApiBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL || "";
  return raw.replace(/\/+$/, "");
}

export default function Home() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
  const [health, setHealth] = useState({ status: "loading" });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setError(null);
        if (!apiBaseUrl) {
          throw new Error(
            "NEXT_PUBLIC_API_URL is missing. Configure it in Vercel env vars."
          );
        }

        const res = await fetch(`${apiBaseUrl}/api/health`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          throw new Error(`Health check failed (${res.status})`);
        }

        const data = await res.json();
        if (!cancelled) setHealth(data);
      } catch (e) {
        if (!cancelled) {
          setHealth({ status: "error" });
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

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
        </div>
      </main>
    </div>
  );
}
