"use client";

import { useEffect, useMemo, useState } from "react";

export default function HeaderBar({ title }) {
  const profileCandidates = useMemo(
    () => [
      "/branding/profile.png",
      "/branding/profil.png",
      "/branding/profile.jpg",
      "/branding/profil.jpg",
    ],
    []
  );
  const [profileIdx, setProfileIdx] = useState(0);

  const [today, setToday] = useState("");
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        setToday(
          new Intl.DateTimeFormat("fr-FR", {
            weekday: "short",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date())
        );
      } catch {
        // ignore
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <header className="sticky top-0 z-50 h-12 bg-gradient-to-b from-slate-950 via-slate-950/90 to-slate-950/70 shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-white/15">
      <div className="flex h-12 w-full items-center justify-between gap-3 px-0">
        <div className="flex min-w-[200px] items-center gap-3">
          <img
            src="/branding/univ-logo.png"
            alt="Université"
            className="h-7 w-auto opacity-95"
          />
        </div>

        <div className="flex min-w-[200px] items-center justify-end gap-3">
          <div className="text-right">
            <div className="text-[11px] text-zinc-400" suppressHydrationWarning>
              {today}
            </div>
            <div className="text-[11px] text-zinc-500">M. AIT ICHOU</div>
          </div>
          <img
            src={profileCandidates[profileIdx]}
            alt="Profil"
            className="h-10 w-10 rounded-full border border-white/15 object-cover"
            onError={() => {
              setProfileIdx((i) =>
                i + 1 < profileCandidates.length ? i + 1 : i
              );
            }}
          />
        </div>
      </div>
    </header>
  );
}
