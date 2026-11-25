"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartPoint } from "@/lib/utils/forecast";

/** Actual values are a solid line; forecasts are dashed with a shaded range. The legend says which is which. */
export function ForecastChart({ data, unit, height = 280 }: { data: ChartPoint[]; unit: string; height?: number }) {
  return (
    <div role="img" aria-label={`Actual and forecast weekly values in ${unit}`} style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} width={56} />
          <Tooltip />
          <Legend />
          <Area dataKey="band" name="Forecast range (80%)" stroke="none" fill="#94a3b8" fillOpacity={0.25} isAnimationActive={false} />
          <Line dataKey="actual" name={`Actual (${unit}/week)`} stroke="#0f4c81" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="forecast" name="Forecast (not actual)" stroke="#d97706" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
