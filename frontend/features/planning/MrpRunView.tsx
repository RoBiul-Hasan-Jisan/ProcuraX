"use client";

import { ChevronDown, ChevronRight, Download, Printer } from "lucide-react";
import { Fragment, useState } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/field";
import { downloadText, toCsv } from "@/lib/utils/csv";
import { formatDate, money, quantity } from "@/lib/utils/format";
import type { MrpResult, MrpRun } from "@/types/planning";

export const mrpCsv = (run: MrpRun, results: MrpResult[]) =>
  toCsv([
    [`MRP run ${run.number}`, `Run date ${new Date(run.runDate).toISOString().slice(0, 10)}`, `Horizon ${run.horizonDays} days`],
    [],
    ["SKU", "Material", "Category", "Unit", "Gross requirement", "Wastage-adjusted requirement", "On hand", "Reserved (other)", "Available", "Scheduled receipts", "Safety stock", "Net requirement / suggested quantity",
      "Preferred supplier", "Lead time (days)", "Lead time assumed", "Planned order date", "Expected arrival", "Needed by", "Urgency", "Estimated cost (BDT)", "Warnings"],
    ...results.map((r) => {
      const o = r.plannedOrders[0];
      const warn = [r.exceedsSupplierCapacity ? `exceeds supplier capacity (${r.ordersNeededForCapacity} orders)` : "", !r.preferredSupplier && Number(r.netRequirement) > 0 ? r.supplierNote ?? "no eligible supplier" : "", r.plannedOrders.some((p) => p.late) ? "cannot arrive by need date" : ""].filter(Boolean).join("; ");
      return [r.sku, r.name, r.category, r.unit, r.grossRequirement, r.adjustedRequirement, r.onHand, r.reservedOther, r.available, r.scheduledReceiptsTotal, r.safetyStock, r.netRequirement,
        r.preferredSupplier?.name ?? "", r.leadTimeDays, r.leadTimeAssumed ? "yes" : "no", o ? o.releaseDate.slice(0, 10) : "", o ? o.expectedArrival.slice(0, 10) : "", r.firstNeedDate?.slice(0, 10) ?? "", r.urgency ?? "covered", r.estimatedCost ?? "", warn];
    }),
  ]);

/** A saved MRP run: summary, problems, material-wise table with a full explanation per row, CSV export and print/PDF. */
export function MrpRunView({ run }: { run: MrpRun }) {
  const results = run.results ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const s = run.summary;
  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => downloadText(`${run.number}.csv`, mrpCsv(run, results))}><Download className="h-4 w-4" /> Export CSV</Button>
        <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / save as PDF</Button>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([["Materials assessed", s.materials], ["Need procurement", s.withShortage], ["Covered by stock", s.covered], ["Critical / High", `${s.critical} / ${s.high}`], ["Estimated cost", money(s.estimatedCost)]] as const).map(([k, v]) => (
          <Card key={k}><div className="p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div></Card>
        ))}
      </div>
      <p className="mb-3 text-xs text-slate-500">{s.estimatedCostNote}</p>
      {run.issues.length > 0 && <div className="mb-3"><Notice tone="error">{run.issues.length} problem(s) in this run: {run.issues.map((i) => `${i.plan}: ${i.message}`).join(" | ")}. Affected plans contributed no material needs.</Notice></div>}
      {(run.inputs?.excludedPlans ?? []).length > 0 && <div className="mb-3"><Notice tone="info">Excluded: {run.inputs!.excludedPlans.map((p) => `${p.plan} (${p.reason})`).join("; ")}</Notice></div>}
      {(s.noEligibleSupplier > 0 || s.capacityWarnings > 0) && <div className="mb-3"><Notice tone="info">{s.noEligibleSupplier > 0 ? `${s.noEligibleSupplier} material(s) needing procurement have no active, verified preferred supplier. ` : ""}{s.capacityWarnings > 0 ? `${s.capacityWarnings} planned order(s) exceed the supplier's single-order capacity.` : ""}</Notice></div>}

      <Card>
        <CardHeader title="Material requirements" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="w-8 px-3 py-2" /><th>Material</th><th>Gross</th><th>Adjusted</th><th>Available</th><th>Receipts</th><th>Safety</th><th>Net / order qty</th><th>Supplier</th><th>Order by</th><th>Arrives</th><th>Urgency</th></tr>
            </thead>
            <tbody>
              {results.length === 0 && <tr><td colSpan={12} className="p-6 text-center text-slate-500">This run produced no material requirements.</td></tr>}
              {results.map((r) => {
                const o = r.plannedOrders[0];
                return (
                  <Fragment key={r.id}>
                    <tr className="border-t border-line align-top">
                      <td className="px-3 py-2"><button type="button" aria-label={`Explain ${r.name}`} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                      <td className="py-2 pr-2">{r.name}<div className="text-xs text-slate-400">{r.sku} · {r.category}</div></td>
                      <td>{quantity(r.grossRequirement)}</td><td>{quantity(r.adjustedRequirement)}</td>
                      <td>{quantity(r.available)}{Number(r.reservedOther) > 0 && <div className="text-xs text-slate-400">{quantity(r.reservedOther)} reserved</div>}</td>
                      <td>{quantity(r.scheduledReceiptsTotal)}</td><td>{quantity(r.safetyStock)}</td>
                      <td><strong>{quantity(r.netRequirement)}</strong> {r.unit}</td>
                      <td>{r.preferredSupplier ? r.preferredSupplier.name : Number(r.netRequirement) > 0 ? <span className="text-danger">None eligible</span> : "-"}<div className="text-xs text-slate-400">{r.leadTimeDays}d lead{r.leadTimeAssumed ? " (assumed)" : ""}</div></td>
                      <td>{o ? formatDate(o.releaseDate) : "-"}</td>
                      <td>{o ? <span className={o.late ? "text-danger" : ""}>{formatDate(o.expectedArrival)}{o.late ? ` (${o.daysLate}d late)` : ""}</span> : "-"}</td>
                      <td>{r.urgency ? <StatusBadge value={r.urgency} /> : <span className="text-xs text-slate-400">Covered</span>}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-slate-50"><td /><td colSpan={11} className="p-3 text-xs">
                        <div className="font-medium">How this was calculated</div>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">{r.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
                        {r.plannedOrders.length > 1 && <div className="mt-2"><div className="font-medium">Planned orders</div><ul className="list-disc pl-5">{r.plannedOrders.map((p, i) => <li key={i}>{quantity(p.quantity)} {r.unit}: order {formatDate(p.releaseDate)}, arrive {formatDate(p.expectedArrival)}, needed {formatDate(p.needDate)}</li>)}</ul></div>}
                        {r.receipts.length > 0 && <div className="mt-2"><span className="font-medium">Open purchase orders: </span>{r.receipts.map((x) => `${x.reference} ${quantity(x.quantity)} due ${formatDate(x.date)}`).join("; ")}</div>}
                        {r.lateReceipts.length > 0 && <div className="mt-1 text-warn">Arrives after the first need date: {r.lateReceipts.map((x) => x.reference).join(", ")}.</div>}
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {run.inputs && (
        <Card className="mt-4">
          <CardHeader title="Inputs used by this run" />
          <div className="p-4 text-sm">
            <p className="text-xs text-slate-500">Run {run.number} on {formatDate(run.runDate, true)} by {run.createdByName}, {run.horizonDays}-day horizon.</p>
            <ul className="mt-2 list-disc pl-5">{run.inputs.plans.map((p) => <li key={p.number}>{p.number}: {quantity(p.quantity)} {p.unit} {p.product}, starts {formatDate(p.startDate)} ({p.status.replace("_", " ")})</li>)}</ul>
            <p className="mt-2 text-xs text-slate-500">BOMs used: {run.inputs.bomsUsed.length ? run.inputs.bomsUsed.map((b) => `${b.number} v${b.version}`).join(", ") : "none"}.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
