"use client";

import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const ALERT_COLORS = {
  Jaune: "#facc15",
  Orange: "#fb923c",
  Rouge: "#ef4444",
  Noir: "#111827",
  "?": "#94a3b8",
};

function cardShell(title, children) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="text-sm font-medium text-zinc-700">{title}</div>
      <div className="mt-3 h-[260px]">{children}</div>
    </div>
  );
}

export function AlertsPie({ data }) {
  return cardShell(
    "Répartition des alertes",
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={95}
          paddingAngle={2}
        >
          {data.map((d) => (
            <Cell
              key={d.name}
              fill={ALERT_COLORS[d.name] || "#64748b"}
              stroke="#ffffff"
              strokeWidth={1}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DeptBar({ data }) {
  return cardShell(
    "Incendies par département",
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 10, right: 10 }}>
        <Tooltip />
        <XAxis dataKey="name" />
        <YAxis allowDecimals={false} />
        <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MonthlyLine({ data }) {
  return cardShell(
    "Série temporelle (par mois)",
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 10, right: 10 }}>
        <Tooltip />
        <XAxis dataKey="name" tickMargin={6} minTickGap={18} />
        <YAxis allowDecimals={false} />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#16a34a"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
