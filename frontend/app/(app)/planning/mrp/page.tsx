"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Download, Play } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { MrpRunView } from "@/features/planning/MrpRunView";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { downloadText, toCsv } from "@/lib/utils/csv";
import { formatDate, quantity } from "@/lib/utils/format";
import type { MrpRun, ProductionPlan, ReorderRow } from "@/types/planning";

type Tab = "run" | "history" | "reorder";
interface Settings { horizonDays: number; defaultLeadTimeDays: number; urgency: { highDays: number; mediumDays: number }; reorder: { lookbackDays: number; coverageDays: number } }

export default function MrpPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("run");
  const tabs: [Tab, string][] = [["run", "Run MRP"], ["history", "Previous runs"], ["reorder", "Reorder recommendations"]];
  return (
    <>
      <PageHeader title="MRP Calculator" subtitle="Material requirements from production plans, BOMs, stock, reservations and open purchase orders." />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-steel-600 font-medium text-steel-600" : "border-transparent text-slate-500"}`}>{label}</button>
        ))}
      </div>
      {tab === "run" && <RunTab canRun={can("mrp:run")} />}
      {tab === "history" && <HistoryTab />}
      {tab === "reorder" && <ReorderTab />}
    </>
  );
}

function RunTab({ canRun }: { canRun: boolean }) {
  const settings = useApi<Settings>("/settings/mrp");
  const planned = useApi<ProductionPlan[]>("/production-plans?limit=100&status=planned");
  const confirmed = useApi<ProductionPlan[]>("/production-plans?limit=100&status=confirmed");
  const running = useApi<ProductionPlan[]>("/production-plans?limit=100&status=in_progress");
  const plans = useMemo(() => [...(confirmed.data ?? []), ...(planned.data ?? []), ...(running.data ?? [])], [confirmed.data, planned.data, running.data]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [horizon, setHorizon] = useState<string | null>(null);
  const [result, setResult] = useState<MrpRun | null>(null);
  const { pending, error, run } = useAction();
  const horizonValue = horizon ?? String(settings.data?.horizonDays ?? 30);
  const horizonOk = /^\d+$/.test(horizonValue) && Number(horizonValue) >= 1 && Number(horizonValue) <= 365;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const go = () => run(async () => {
    const res = await apiFetch<MrpRun>("/mrp/run", { method: "POST", body: JSON.stringify({ planIds: [...picked], horizonDays: Number(horizonValue) }) });
    setResult(res.data);
  });

  if (planned.loading && !planned.data) return <LoadingState />;
  return (
    <>
      <Card>
        <CardHeader title="1. Choose production plans" />
        <div className="p-4">
          {plans.length === 0 ? <p className="text-sm text-slate-500">There are no open production plans. Create one in Production Planning first.</p> : (
            <ul className="divide-y divide-line text-sm">
              {plans.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2">
                    <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Include ${p.number}`} />
                    <span className="font-mono text-xs">{p.number}</span><span>{p.product.name}</span><span>{quantity(p.quantity)} {p.unit}</span>
                    <span className="text-slate-500">starts {formatDate(p.startDate)}</span><StatusBadge value={p.status} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <Field label="2. Planning horizon (days)" htmlFor="horizon" hint="Plans starting later than this are left out and listed in the run.">
              <Input id="horizon" className="w-32" inputMode="numeric" value={horizonValue} onChange={(e) => setHorizon(e.target.value)} />
            </Field>
            {canRun
              ? <Button onClick={() => void go()} disabled={pending || picked.size === 0 || !horizonOk}><Play className="h-4 w-4" /> {pending ? "Calculating…" : "Run MRP"}</Button>
              : <Notice tone="info">You can view MRP results but not run MRP.</Notice>}
          </div>
          {!horizonOk && <p className="mt-2 text-xs text-danger">Horizon must be a whole number from 1 to 365.</p>}
          {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
        </div>
      </Card>
      {canRun && settings.data && <SettingsCard settings={settings.data} onSaved={settings.reload} />}
      {result && <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm"><strong>{result.number}</strong><StatusBadge value={result.status} /><Link className="text-steel-600 underline" href={`/planning/mrp/${result.id}`}>Open saved run</Link></div><MrpRunView run={result} /></div>}
    </>
  );
}

function SettingsCard({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ horizon: String(settings.horizonDays), lead: String(settings.defaultLeadTimeDays), high: String(settings.urgency.highDays), medium: String(settings.urgency.mediumDays), look: String(settings.reorder.lookbackDays), cover: String(settings.reorder.coverageDays) });
  const { pending, error, run } = useAction();
  const n = Object.values(v).map(Number);
  const bad = Object.values(v).some((x) => !/^\d+$/.test(x)) || Number(v.medium) < Number(v.high) || Number(v.horizon) < 1 || Number(v.look) < 7;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Card className="mt-4">
      <CardHeader title="Planning parameters" action={<Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>{open ? "Hide" : "Edit"}</Button>} />
      {open && (
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Default horizon (days)" htmlFor="s-h"><Input id="s-h" value={v.horizon} onChange={set("horizon")} /></Field>
          <Field label="Default lead time (days)" htmlFor="s-l" hint="Used when a material has none"><Input id="s-l" value={v.lead} onChange={set("lead")} /></Field>
          <span />
          <Field label="High urgency: order within (days)" htmlFor="s-hi"><Input id="s-hi" value={v.high} onChange={set("high")} /></Field>
          <Field label="Medium urgency: order within (days)" htmlFor="s-me"><Input id="s-me" value={v.medium} onChange={set("medium")} /></Field>
          <span />
          <Field label="Consumption look-back (days)" htmlFor="s-lo"><Input id="s-lo" value={v.look} onChange={set("look")} /></Field>
          <Field label="Coverage after reorder (days)" htmlFor="s-co"><Input id="s-co" value={v.cover} onChange={set("cover")} /></Field>
          <div className="flex items-end"><Button disabled={pending || bad} onClick={() => void run(async () => {
            await apiFetch("/settings/mrp", { method: "PUT", body: JSON.stringify({ horizonDays: n[0], defaultLeadTimeDays: n[1], urgency: { highDays: n[2], mediumDays: n[3] }, reorder: { lookbackDays: n[4], coverageDays: n[5] } }) });
            onSaved(); setOpen(false);
          })}>Save</Button></div>
          {error && <div className="sm:col-span-3"><Notice tone="error">{error}</Notice></div>}
        </div>
      )}
    </Card>
  );
}

function HistoryTab() {
  const [page, setPage] = useState(1);
  const list = useApi<MrpRun[]>(`/mrp/runs?page=${page}&limit=15`);
  const columns = useMemo<ColumnDef<MrpRun>[]>(() => [
    { header: "Run", cell: ({ row }) => <Link className="font-mono text-xs text-steel-600 underline" href={`/planning/mrp/${row.original.id}`}>{row.original.number}</Link> },
    { header: "When", cell: ({ row }) => formatDate(row.original.runDate, true) },
    { header: "By", accessorKey: "createdByName" },
    { header: "Plans", accessorKey: "planCount" },
    { header: "Horizon", cell: ({ row }) => `${row.original.horizonDays} days` },
    { header: "Need procurement", cell: ({ row }) => `${row.original.summary.withShortage} of ${row.original.summary.materials}` },
    { header: "Critical / high", cell: ({ row }) => `${row.original.summary.critical} / ${row.original.summary.high}` },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
  ], []);
  return <Card><DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No MRP runs yet. Run MRP to create the first one." pagination={list.pagination} onPage={setPage} /></Card>;
}

function ReorderTab() {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useApi<ReorderRow[]>(`/mrp/reorder-recommendations?onlyNeeded=${all ? "false" : "true"}`);
  const rows = list.data ?? [];
  const exportCsv = () => downloadText("reorder-recommendations.csv", toCsv([
    ["SKU", "Material", "Unit", "On hand", "Reserved", "On order", "Avg daily use", "Lead-time demand", "Safety stock", "Reorder point", "Basis", "Position", "Reorder now", "Suggested quantity", "Order date", "Expected delivery", "Supplier"],
    ...rows.map((r) => [r.sku, r.name, r.unit, r.onHand, r.reserved, r.onOrder, r.averageDailyConsumption, r.leadTimeDemand, r.safetyStock, r.reorderPoint, r.basis, r.inventoryPosition, r.reorderNow ? "yes" : "no", r.suggestedQuantity, r.plannedOrderDate?.slice(0, 10) ?? "", r.expectedDelivery?.slice(0, 10) ?? "", r.preferredSupplier?.name ?? ""]),
  ]));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show materials that do not need ordering</label>
        <Button size="sm" variant="secondary" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>
      {list.loading && !list.data ? <LoadingState /> : list.error ? <div className="p-4"><Notice tone="error">{list.error}</Notice></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Material</th><th>On hand</th><th>On order</th><th>Daily use</th><th>Reorder point</th><th>Suggested qty</th><th>Order date</th><th>Delivery</th><th>Supplier</th><th>Basis</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-slate-500">Nothing needs reordering right now.</td></tr>}
              {rows.map((r) => (
                <Fragment key={r.materialId}>
                  <tr className="cursor-pointer border-t border-line" onClick={() => setOpen(open === r.materialId ? null : r.materialId)}>
                    <td className="px-3 py-2">{r.name}<div className="text-xs text-slate-400">{r.sku}</div></td>
                    <td>{quantity(r.onHand)} {r.unit}</td><td>{quantity(r.onOrder)}</td><td>{quantity(r.averageDailyConsumption)}</td><td>{quantity(r.reorderPoint)}</td>
                    <td>{r.reorderNow ? <strong>{quantity(r.suggestedQuantity)} {r.unit}</strong> : <span className="text-slate-400">None</span>}</td>
                    <td>{formatDate(r.plannedOrderDate)}</td><td>{formatDate(r.expectedDelivery)}</td>
                    <td>{r.preferredSupplier?.name ?? <span className="text-slate-400">{r.reorderNow ? "None eligible" : "-"}</span>}</td>
                    <td className="text-xs text-slate-500">{r.basis === "consumption" ? "Consumption history" : "Configured level"}</td>
                  </tr>
                  {open === r.materialId && <tr className="bg-slate-50"><td colSpan={10} className="p-3 text-xs"><ul className="list-disc space-y-1 pl-5">{r.explanation.map((e, i) => <li key={i}>{e}</li>)}{r.leadTimeAssumed && <li>No lead time set for this material; the default was assumed.</li>}</ul></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
