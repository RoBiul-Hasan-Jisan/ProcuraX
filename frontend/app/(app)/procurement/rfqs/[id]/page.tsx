"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { QuotationForm } from "@/features/rfq/QuotationForm";
import { useAction, useApi } from "@/hooks/useApi";
import { useNow } from "@/hooks/useNow";
import { apiFetch } from "@/lib/api/client";
import { formatDate, money, quantity } from "@/lib/utils/format";
import type { Quotation, Rfq } from "@/types/procurement";
import { DocumentsPanel } from "@/features/documents/DocumentsPanel";

function SupplierQuotationPanel({ rfq }: { rfq: Rfq }) {
  const mine = useApi<Quotation | null>(`/rfqs/${rfq.id}/quotation`);
  const now = useNow();
  if (mine.loading && mine.data === null) return <LoadingState />;
  if (mine.error) return <ErrorState message={mine.error} onRetry={mine.reload} />;
  const open = rfq.status === "open" && new Date(rfq.deadline).getTime() > now;
  if (open) return (<div className="space-y-4"><QuotationForm rfq={rfq} existing={mine.data} onSaved={mine.reload} />{mine.data && <DocumentsPanel entityType="quotation" entityId={mine.data.id} title="Quotation attachments (datasheets, certificates)" />}</div>);
  const q = mine.data;
  return (
    <>
    <Card>
      <CardHeader title="Your quotation" />
      <div className="space-y-2 p-4 text-sm">
        {!q ? <p className="text-slate-500">Bidding is closed and you did not submit a quotation.</p> : (
          <>
            <div className="flex items-center gap-2"><StatusBadge value={q.status} /> {q.status === "awarded" && <strong className="text-ok">You were selected for this RFQ.</strong>}</div>
            <div>Total landed cost: <strong>{money(q.totalLandedCost, q.currency)}</strong> · Delivery {q.deliveryDays} days · {q.paymentTerms}</div>
          </>
        )}
        <p className="text-xs text-slate-500">This RFQ is no longer open for changes.</p>
      </div>
    </Card>
    {q && <div className="mt-4"><DocumentsPanel entityType="quotation" entityId={q.id} canUpload={false} title="Quotation attachments" /></div>}
    </>
  );
}

export default function RfqDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAuth();
  const { data: rfq, loading, error, reload } = useApi<Rfq>(`/rfqs/${id}`);
  const now = useNow();
  const action = useAction();
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (loading && !rfq) return <LoadingState />;
  if (error || !rfq) return <ErrorState message={error ?? "RFQ not found"} onRetry={reload} />;
  const manager = can("rfq:manage");
  const isSupplier = user?.role === "supplier";
  const bidsOpened = rfq.status !== "open" || new Date(rfq.deadline).getTime() <= now;

  const close = () => action.run(async () => { await apiFetch(`/rfqs/${rfq.id}/close`, { method: "POST", body: "{}" }); reload(); });
  const cancel = () => action.run(async () => {
    await apiFetch(`/rfqs/${rfq.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    setCancelOpen(false); reload();
  });

  return (
    <>
      <PageHeader title={rfq.number} subtitle={rfq.requisitionNumber ? `From requisition ${rfq.requisitionNumber}` : undefined}
        actions={<>
          <StatusBadge value={rfq.status} />
          {manager && rfq.status === "open" && <Button variant="secondary" disabled={action.pending} onClick={() => void close()}>Close bidding now</Button>}
          {manager && (rfq.status === "open" || rfq.status === "closed") && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel RFQ</Button>}
          {manager && bidsOpened && rfq.status !== "cancelled" && <Link href={`/procurement/comparison?rfq=${rfq.id}`} className="inline-flex h-10 items-center rounded-md bg-navy-800 px-4 text-sm font-medium text-white hover:bg-navy-700">Compare quotations</Link>}
        </>} />
      {action.error && <div className="mb-3"><Notice tone="error">{action.error}</Notice></div>}
      {manager && !bidsOpened && <div className="mb-3"><Notice tone="info">Quotations are sealed until {formatDate(rfq.deadline, true)}, or until you close bidding. Currently {rfq.quotationCount ?? 0} received.</Notice></div>}
      {rfq.award && manager && can("purchase_orders:manage") && rfq.status === "awarded" && (
        <div className="mb-3"><Button variant="secondary" disabled={action.pending} onClick={() => void action.run(async () => { const r = await apiFetch<{ id: string }>("/purchase-orders", { method: "POST", body: JSON.stringify({ rfqId: rfq.id }) }); router.push(`/procurement/purchase-orders/${r.data.id}`); })}>Create purchase order (draft)</Button></div>
      )}
      {rfq.award && <div className="mb-3"><Notice tone="success">Awarded by {rfq.award.awardedByName}{rfq.award.overrodeTopRank ? ` (not the top-ranked quotation: "${rfq.award.justification}")` : ""}.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Requirements" />
            <ul className="divide-y divide-line">
              {rfq.items.map((i) => (
                <li key={i.materialId} className="px-4 py-3 text-sm">
                  <div className="flex justify-between"><span className="font-medium">{i.materialName}</span><span>{quantity(i.quantity)} {i.unit}</span></div>
                  <div className="text-xs text-slate-500">{i.sku}</div>
                  {i.technicalSpecs && <div className="mt-1 text-slate-600">Specification: {i.technicalSpecs}</div>}
                </li>
              ))}
            </ul>
          </Card>
          {isSupplier && <SupplierQuotationPanel rfq={rfq} />}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Terms" />
            <dl className="space-y-3 p-4 text-sm">
              <div><dt className="text-xs text-slate-500">Submission deadline</dt><dd>{formatDate(rfq.deadline, true)}</dd></div>
              <div><dt className="text-xs text-slate-500">Needed by</dt><dd>{formatDate(rfq.requiredDate)}</dd></div>
              <div><dt className="text-xs text-slate-500">Delivery location</dt><dd>{rfq.deliveryLocation}</dd></div>
              <div><dt className="text-xs text-slate-500">Payment terms</dt><dd>{rfq.paymentTerms}</dd></div>
              {rfq.deliveryRequirements && <div><dt className="text-xs text-slate-500">Delivery requirements</dt><dd className="whitespace-pre-wrap">{rfq.deliveryRequirements}</dd></div>}
            </dl>
          </Card>
          {manager && rfq.invitedSuppliers && (
            <Card>
              <CardHeader title={`Invited suppliers (${rfq.invitedSuppliers.length})`} />
              <ul className="space-y-1 p-4 text-sm">{rfq.invitedSuppliers.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>

      {cancelOpen && (
        <Modal title={`Cancel ${rfq.number}`} onClose={() => setCancelOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">The requisition returns to Approved so a new RFQ can be raised.</p>
            <Field label="Reason" htmlFor="reason"><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep RFQ</Button>
              <Button variant="danger" disabled={reason.trim().length < 3 || action.pending} onClick={() => void cancel()}>Cancel RFQ</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
