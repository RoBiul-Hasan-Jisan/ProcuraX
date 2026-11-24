"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate, money } from "@/lib/utils/format";
import type { Comparison, ComparisonRow, Rfq, Weights } from "@/types/procurement";

const WEIGHT_LABELS: [keyof Weights, string][] = [["price", "Price"], ["delivery", "Delivery reliability"], ["quality", "Quality"], ["leadTime", "Lead time"], ["payment", "Payment terms"]];

function RfqPicker() {
  const router = useRouter();
  const list = useApi<Rfq[]>("/rfqs?limit=50");
  const columns = useMemo<ColumnDef<Rfq>[]>(() => [
    { header: "RFQ", accessorKey: "number", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    { header: "Materials", cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.items.map((i) => i.materialName).join(", ")}</span> },
    { header: "Quotations", cell: ({ row }) => row.original.quotationCount ?? 0 },
    { header: "Deadline", cell: ({ row }) => formatDate(row.original.deadline, true) },
    { header: "Status", cell: ({ row }) => {
      const sealed = row.original.status === "open" && new Date(row.original.deadline).getTime() > Date.now();
      return sealed ? <span className="text-xs text-warn">Sealed until deadline</span> : <StatusBadge value={row.original.status} />;
    } },
  ], []);
  const rows = (list.data ?? []).filter((r) => r.status !== "cancelled");
  return (
    <>
      <PageHeader title="Quotation Comparison" subtitle="Choose an RFQ whose bidding has closed. Quotations stay sealed until the deadline passes or bidding is closed." />
      <Card>
        <DataTable columns={columns} data={list.data ? rows : null} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No RFQs available for comparison yet."
          onRowClick={(r) => router.push(`/procurement/comparison?rfq=${r.id}`)} />
      </Card>
    </>
  );
}

function AwardDialog({ rfqId, row, isTop, previewing, onClose, onDone }: { rfqId: string; row: ComparisonRow; isTop: boolean; previewing: boolean; onClose: () => void; onDone: () => void }) {
  const [justification, setJustification] = useState("");
  const { pending, error, run } = useAction();
  // The server judges "top-ranked" with the SAVED weights. While previewing other weights the on-screen rank may differ,
  // so the box stays available (and the server's rule is shown if it applies).
  const showBox = !isTop || previewing;
  const need = !isTop && !previewing && justification.trim().length < 10;
  const award = () => run(async () => {
    await apiFetch(`/quotation-comparisons/${rfqId}/award`, { method: "POST", body: JSON.stringify({ quotationId: row.quotationId, justification }) });
    onDone();
  });
  return (
    <Modal title={`Select ${row.supplierName}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>You are selecting <strong>{row.supplierName}</strong> at a total landed cost of <strong>{money(row.totalLandedCost)}</strong> with delivery in {row.deliveryDays} days. This closes the RFQ and marks the other quotations as not selected.</p>
        {row.evaluation.insufficientHistory && <Notice tone="info">This supplier has limited delivery history, so their reliability is unproven.</Notice>}
        {showBox && (
          <>
            <Notice tone="info">{previewing ? "You are previewing custom weights. If this is not the top-ranked quotation under the saved weights, a justification is required." : `This is not the top-ranked quotation (rank ${row.evaluation.rank}). Please record why.`}</Notice>
            <Field label="Justification" htmlFor="justification" hint="At least 10 characters when required. Stored with the award for audit."><Textarea id="justification" value={justification} onChange={(e) => setJustification(e.target.value)} /></Field>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || need} onClick={() => void award()}>{pending ? "Saving…" : "Confirm selection"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Compare({ rfqId }: { rfqId: string }) {
  const { can } = useAuth();
  const [applied, setApplied] = useState<Weights | null>(null);
  const [draft, setDraft] = useState<Record<keyof Weights, string> | null>(null);
  const [awarding, setAwarding] = useState<ComparisonRow | null>(null);
  const qs = applied ? `?${new URLSearchParams(Object.entries(applied).map(([k, v]) => [k, String(v)]))}` : "";
  const cmp = useApi<Comparison>(`/quotation-comparisons/${rfqId}${qs}`);
  const save = useAction();
  const canAward = can("rfq:manage");

  if (cmp.loading && !cmp.data) return <LoadingState label="Opening quotations…" />;
  if (cmp.error && !cmp.data) return <ErrorState message={cmp.error} onRetry={cmp.reload} />;
  const data = cmp.data;
  if (!data) return null;

  const awarded = data.rfq.status === "awarded";
  const weightInputs = draft ?? (Object.fromEntries(WEIGHT_LABELS.map(([k]) => [k, String(data.rawWeights[k])])) as Record<keyof Weights, string>);
  const parsed = Object.fromEntries(WEIGHT_LABELS.map(([k]) => [k, Number(weightInputs[k])])) as unknown as Weights;
  const weightsValid = WEIGHT_LABELS.every(([k]) => Number.isFinite(parsed[k]) && parsed[k] >= 0) && WEIGHT_LABELS.some(([k]) => parsed[k] > 0);

  const metric = (label: string, cell: (r: ComparisonRow) => ReactNode, emphasise = false) => (
    <tr className={emphasise ? "bg-surface font-semibold" : ""} key={label}>
      <th scope="row" className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">{label}</th>
      {data.rows.map((r) => <td key={r.quotationId} className="px-4 py-2 align-top">{cell(r)}</td>)}
    </tr>
  );

  return (
    <>
      <PageHeader title={`Compare ${data.rfq.number}`} subtitle={`${data.rows.length} quotation(s) · ${data.rfq.status}`} actions={<Link href={`/procurement/rfqs/${rfqId}`} className="text-sm text-steel-600 hover:underline">Back to RFQ</Link>} />
      <div className="mb-3"><Notice tone="info">{data.advisory}</Notice></div>

      <Card className="mb-4">
        <CardHeader title="Evaluation weights" />
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-5">
            {WEIGHT_LABELS.map(([k, label]) => (
              <Field key={k} label={`${label} (${data.weights[k].toFixed(0)}% effective)`} htmlFor={`w-${k}`}>
                <Input id={`w-${k}`} inputMode="decimal" value={weightInputs[k]} onChange={(e) => setDraft({ ...weightInputs, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <p className="text-xs text-slate-500">Weights are relative and are normalised to 100%. Previewing does not change the saved default.</p>
          {save.error && <Notice tone="error">{save.error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!weightsValid} onClick={() => setApplied(parsed)}>Preview with these weights</Button>
            {can("suppliers:evaluate") && <Button variant="secondary" disabled={!weightsValid || save.pending} onClick={() => void save.run(async () => { await apiFetch("/settings/scoring", { method: "PUT", body: JSON.stringify(parsed) }); setApplied(null); setDraft(null); cmp.reload(); })}>Save as default</Button>}
            {(applied || draft) && <Button variant="ghost" onClick={() => { setApplied(null); setDraft(null); }}>Reset</Button>}
          </div>
        </div>
      </Card>

      {data.rows.length === 0 ? <Card><div className="p-8 text-center text-sm text-slate-500">No quotations were submitted for this RFQ.</div></Card> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-navy-900 text-white"><tr><th className="px-4 py-3 text-xs font-medium uppercase">Criterion</th>
                {data.rows.map((r) => (
                  <th key={r.quotationId} className="px-4 py-3 align-top">
                    <div className="text-sm font-semibold">{r.supplierName}</div>
                    <div className="mt-1 flex flex-wrap gap-1"><span className="rounded bg-white/15 px-1.5 py-0.5 text-xs">Rank {r.evaluation.rank}</span>
                      {r.status === "awarded" && <span className="rounded bg-green-500 px-1.5 py-0.5 text-xs">Selected</span>}
                      {r.evaluation.insufficientHistory && <span className="rounded bg-amber-400/90 px-1.5 py-0.5 text-xs text-black">Unproven</span>}</div>
                  </th>))}</tr></thead>
              <tbody className="divide-y divide-line">
                {metric("Overall score", (r) => <span className="text-base">{r.evaluation.overall.toFixed(1)}</span>, true)}
                {metric("Unit price", (r) => r.unitPrices.map((u) => (
                  <div key={u.materialId}>{money(u.unitPrice)}
                    {u.percentVsAverage !== null && <span className={u.flagged ? "ml-1 inline-flex items-center gap-0.5 text-xs text-danger" : "ml-1 text-xs text-slate-500"}>{u.flagged && <AlertTriangle className="h-3 w-3" />}{u.percentVsAverage > 0 ? "+" : ""}{u.percentVsAverage}% vs avg</span>}</div>)))}
                {metric("Material cost", (r) => money(r.materialCost))}
                {metric("Transportation", (r) => money(r.transportCost))}
                {metric("Additional charges", (r) => money(r.additionalCharges))}
                {metric("Taxes", (r) => money(r.taxAmount))}
                {metric("Total landed cost", (r) => money(r.totalLandedCost), true)}
                {metric("Cost difference", (r) => r.evaluation.costDifference === "0.00" ? <span className="text-ok">Lowest</span> : `+${money(r.evaluation.costDifference)} (${r.evaluation.costDifferencePercent}%)`)}
                {metric("Delivery time", (r) => `${r.deliveryDays} days`)}
                {metric("Delivery difference", (r) => r.evaluation.deliveryDifferenceDays === 0 ? <span className="text-ok">Fastest</span> : `+${r.evaluation.deliveryDifferenceDays} days`)}
                {metric("Payment terms", (r) => r.paymentTerms)}
                {metric("Valid until", (r) => <>{formatDate(r.validUntil)} {r.expired && <span className="text-xs text-danger">expired</span>}</>)}
                {metric("On-time delivery", (r) => r.quality.onTimeRate === null ? <span className="text-slate-400">No history</span> : `${r.quality.onTimeRate}% of ${r.quality.completedOrders} orders`)}
                {metric("Quality acceptance", (r) => r.quality.qualityAcceptanceRate === null ? <span className="text-slate-400">No history</span> : `${r.quality.qualityAcceptanceRate}%`)}
                {metric("Score breakdown", (r) => (
                  <ul className="space-y-0.5 text-xs">{WEIGHT_LABELS.map(([k, l]) => <li key={k} className="flex justify-between gap-3"><span className="text-slate-500">{l}</span><span>{r.evaluation.scores[k].toFixed(0)}</span></li>)}</ul>))}
                {metric("Why this ranking", (r) => <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{r.evaluation.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>)}
                {canAward && !awarded && metric("Decision", (r) => (
                  <Button size="sm" disabled={r.expired} onClick={() => setAwarding(r)}>{r.expired ? "Quotation expired" : "Select supplier"}</Button>))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {awarded && <div className="mt-3"><Notice tone="success">This RFQ has been awarded. A purchase order can now be raised (Phase 3).</Notice></div>}
      {awarding && <AwardDialog rfqId={rfqId} row={awarding} isTop={awarding.evaluation.rank === 1} previewing={applied !== null} onClose={() => setAwarding(null)} onDone={() => { setAwarding(null); cmp.reload(); }} />}
    </>
  );
}

function Page() {
  const rfq = useSearchParams().get("rfq");
  return rfq ? <Compare rfqId={rfq} /> : <RfqPicker />;
}

export default function ComparisonPage() {
  return <Suspense><Page /></Suspense>;
}
