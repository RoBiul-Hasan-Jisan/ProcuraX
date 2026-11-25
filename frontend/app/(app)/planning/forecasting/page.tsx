"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { ForecastChart } from "@/features/intelligence/ForecastChart";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { buildForecastSeries, fmtNum } from "@/lib/utils/forecast";
import { formatDate } from "@/lib/utils/format";
import type { MaterialForecastView } from "@/types/intelligence";

interface MaterialLite { id: string; sku: string; name: string; unit: string }
type Tab = "demand" | "price";

export default function ForecastingPage() {
  const { can } = useAuth();
  const materials = useApi<MaterialLite[]>("/materials?limit=100&active=true");
  const [materialId, setMaterialId] = useState("");
  const [tab, setTab] = useState<Tab>("demand");
  const view = useApi<MaterialForecastView>(materialId ? `/forecasting/material/${materialId}` : null);
  const { pending, error, run } = useAction();
  const canRun = can("mrp:run");

  const generate = (kind: "demand" | "prices") => run(async () => {
    await apiFetch(`/forecasting/${kind}`, { method: "POST", body: JSON.stringify({ materialId }) });
    view.reload();
  });

  return (
    <>
      <PageHeader title="Demand Forecasting" subtitle="Predicted consumption and price trends. Everything on this page marked Forecast is a prediction, not a recorded value." />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-64">
            <label htmlFor="mat" className="mb-1 block text-sm font-medium">Material</label>
            <Select id="mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              <option value="">Choose a material…</option>
              {(materials.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.sku} - {m.name.replace(/^\[DEMO\]\s*/, "")}</option>)}
            </Select>
          </div>
          {materialId && canRun && (
            <>
              <Button onClick={() => generate("demand")} disabled={pending}>{pending ? "Working…" : "Generate demand forecast"}</Button>
              <Button variant="secondary" onClick={() => generate("prices")} disabled={pending}>Generate price forecast</Button>
            </>
          )}
        </div>
        {error && <div className="px-4 pb-4"><Notice tone="error">{error}</Notice></div>}
      </Card>

      {!materialId && <EmptyState message="Choose a material to see its consumption history and forecasts." />}
      {materialId && view.loading && !view.data && <LoadingState />}
      {materialId && view.error && <ErrorState message={view.error} onRetry={view.reload} />}
      {view.data && (
        <>
          <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
            {([["demand", "Demand"], ["price", "Price"]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-steel-600 font-medium text-steel-600" : "border-transparent text-slate-500"}`}>{label}</button>
            ))}
          </div>
          {tab === "demand" ? <DemandPanel view={view.data} canRun={canRun} /> : <PricePanel view={view.data} canRun={canRun} />}
        </>
      )}
    </>
  );
}

function DemandPanel({ view, canRun }: { view: MaterialForecastView; canRun: boolean }) {
  const f = view.demandForecast;
  const r = f?.result;
  const series = useMemo(() => buildForecastSeries(view.actualConsumption.weekStart, view.actualConsumption.weeks, r?.status === "ok" ? r.weekly ?? [] : []), [view, r]);
  const unit = view.material.unit;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Weekly consumption: actual and forecast" />
        <div className="p-4">
          {view.actualConsumption.weeks.length === 0 ? <p className="text-sm text-slate-500">No consumption has been recorded for this material (stock issued to production).</p> : <ForecastChart data={series} unit={unit} />}
          <p className="mt-2 text-xs text-slate-500">Actual = stock issued to production, summed per week. Forecast = model prediction. The shaded band is an approximate 80% range, not a guarantee.</p>
        </div>
      </Card>
      {!f && <Notice tone="info">{canRun ? "No forecast has been generated for this material yet. Use Generate demand forecast." : "No forecast has been generated for this material yet. A procurement manager can generate one."}</Notice>}
      {f && r?.status === "insufficient_data" && <Notice tone="info">Not enough data to forecast: {r.reason} (checked {formatDate(f.asOf, true)})</Notice>}
      {f && r?.status === "ok" && (
        <>
          <Card>
            <CardHeader title="Forecast demand by horizon" />
            <div className="overflow-x-auto p-4">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500"><th className="py-1">Horizon</th><th>Forecast ({unit})</th><th>80% range</th></tr></thead>
                <tbody>{r.horizons?.map((h) => <tr key={h.days} className="border-t border-line"><td className="py-1">Next {h.days} days</td><td className="font-medium">{fmtNum(h.total)}</td><td>{fmtNum(h.low)} to {fmtNum(h.high)}</td></tr>)}</tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Generated {formatDate(f.asOf, true)}{f.generatedByName ? ` by ${f.generatedByName}` : ""}. Model version {f.modelVersion}. History used: {r.historyWeeks} weeks.</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Model evaluation (backtest)" />
            <div className="overflow-x-auto p-4">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500"><th className="py-1">Model</th><th>MAE</th><th>RMSE</th><th>MAPE</th><th>Test weeks</th><th /></tr></thead>
                <tbody>
                  {r.candidates?.map((c) => (
                    <tr key={c.model} className="border-t border-line">
                      <td className="py-1">{c.model.replace(/_/g, " ")}</td>
                      {c.status === "evaluated" ? <><td>{fmtNum(c.mae, 2)}</td><td>{fmtNum(c.rmse, 2)}</td><td>{c.mape == null ? "n/a (zero actuals)" : `${fmtNum(c.mape)}%`}</td><td>{c.folds}</td></> : <td colSpan={4} className="text-slate-500">Not used: {c.reason}</td>}
                      <td>{c.model === r.selectedModel && <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-ok">selected</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Each model is tested one week ahead on weeks it was not trained on (rolling backtest, no shuffling). The model with the lowest RMSE is used. {r.interval?.method}.</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function PricePanel({ view, canRun }: { view: MaterialForecastView; canRun: boolean }) {
  const f = view.priceForecast;
  const r = f?.result;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Recorded unit price (actual)" />
        <div className="p-4">
          {view.priceHistory.observations.length < 2 ? <p className="text-sm text-slate-500">Fewer than two price records exist for this material.</p> : (
            <div role="img" aria-label="Recorded unit price over time" style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={view.priceHistory.observations} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} /><YAxis tick={{ fontSize: 11 }} width={56} domain={["auto", "auto"]} /><Tooltip />
                  <Line dataKey="price" name="Unit price (BDT)" stroke="#0f4c81" strokeWidth={2} dot isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>
      {!f && <Notice tone="info">{canRun ? "No price forecast yet. Use Generate price forecast." : "No price forecast has been generated for this material yet."}</Notice>}
      {f && r?.status === "insufficient_data" && <Notice tone="info">Not enough data for a price trend: {r.reason}</Notice>}
      {f && r?.status === "ok" && (
        <Card>
          <CardHeader title="Price trend estimate (forecast)" />
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-1">Horizon</th><th>Estimated price (BDT)</th><th>80% range</th><th>Change vs last recorded ({fmtNum(r.lastPrice, 2)})</th></tr></thead>
              <tbody>{r.horizons?.map((h) => <tr key={h.days} className="border-t border-line"><td className="py-1">In {h.days} days</td><td className="font-medium">{fmtNum(h.price, 2)}</td><td>{fmtNum(h.low, 2)} to {fmtNum(h.high, 2)}</td><td>{h.changePercent == null ? "-" : `${h.changePercent > 0 ? "+" : ""}${fmtNum(h.changePercent)}%`}</td></tr>)}</tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">{r.notes?.join(" ")} Based on {r.observations} observations over {r.spanDays} days (fit R² {fmtNum(r.r2, 2)}). Generated {formatDate(f.asOf, true)}; model version {f.modelVersion}.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
