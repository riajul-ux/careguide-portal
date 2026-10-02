"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart } from "recharts";

// Single-series charts: one hue (brand blue), recessive grid, tooltip on hover.
const BAR = "#2a6db0";
const AXIS = { fontSize: 11, fill: "#64748b" };

export function DepartmentChart({ data, label, height = 220 }: { data: { name: string; value: number }[]; label: string; height?: number }) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">No data.</div>;
  return (
    <div style={{ height: Math.max(height, data.length * 26 + 30) }} aria-label={`${label} by category`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke="#eef2f6" />
          <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={170} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [v as number, label]} />
          <Bar dataKey="value" fill={BAR} radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ data, label }: { data: { day: string; completed: number }[]; label: string }) {
  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef2f6" />
          <XAxis dataKey="day" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={32} />
          <Tooltip formatter={(v) => [v as number, label]} />
          <Line type="monotone" dataKey="completed" stroke={BAR} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
