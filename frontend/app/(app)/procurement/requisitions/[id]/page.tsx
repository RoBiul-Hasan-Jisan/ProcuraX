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
import { ApprovalTimeline } from "@/features/requisitions/ApprovalTimeline";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate, money, quantity } from "@/lib/utils/format";
import type { Requisition } from "@/types/procurement";

const CANCELLABLE = ["Draft", "Submitted", "Under Review", "Approved", "Modification Requested"];

export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, can } = useAuth();
  const { data: r, loading, error, reload } = useApi<Requisition>(`/requisitions/${id}`);
  const action = useAction();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (loading && !r) return <LoadingState />;
  if (error || !r) return <ErrorState message={error ?? "Requisition not found"} onRetry={reload} />;

  const isOwner = r.requestedBy.id === user?.id;
  const editable = isOwner && (r.status === "Draft" || r.status === "Modification Requested");
  const canCancel = CANCELLABLE.includes(r.status) && (isOwner || can("rfq:manage") || can("users:manage"));

  const submit = () => action.run(async () => { await apiFetch(`/requisitions/${r.id}/submit`, { method: "POST", body: "{}" }); reload(); });
  const cancel = () => action.run(async () => {
    await apiFetch(`/requisitions/${r.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    setCancelOpen(false); setReason(""); reload();
  });

  return (
    <>
      <PageHeader title={r.number} subtitle={`${r.department.name ?? ""} · requested by ${r.requestedBy.name}`}
        actions={<>
          <StatusBadge value={r.status} /><StatusBadge value={r.priority} />
          {editable && <Button variant="secondary" onClick={() => router.push(`/procurement/requisitions/${r.id}/edit`)}>Edit</Button>}
          {editable && <Button onClick={() => void submit()} disabled={action.pending}>{r.status === "Draft" ? "Submit for approval" : "Resubmit"}</Button>}
          {r.status === "Approved" && can("rfq:manage") && <Button onClick={() => router.push(`/procurement/rfqs?create=${r.id}`)}>Create RFQ</Button>}
          {r.rfqId && can("rfq:manage") && <Link href={`/procurement/rfqs/${r.rfqId}`} className="text-sm text-steel-600 hover:underline">View RFQ</Link>}
          {canCancel && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel</Button>}
        </>} />
      {action.error && <div className="mb-3"><Notice tone="error">{action.error}</Notice></div>}
      {r.status === "Modification Requested" && <div className="mb-3"><Notice tone="info">A reviewer asked for changes. See the comment in the approval timeline, edit the requisition, then resubmit.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Materials" />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-xs uppercase text-slate-500"><tr>
                  <th className="px-4 py-2 font-medium">Material</th><th className="px-4 py-2 font-medium">Quantity</th><th className="px-4 py-2 font-medium">Est. unit price</th><th className="px-4 py-2 text-right font-medium">Line total</th>
                </tr></thead>
                <tbody>
                  {r.items.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-4 py-2"><div className="font-medium">{i.materialName}</div><div className="text-xs text-slate-500">{i.sku} · {i.category}</div></td>
                      <td className="px-4 py-2">{quantity(i.quantity)} {i.unit}</td>
                      <td className="px-4 py-2">{money(i.estimatedUnitPrice, r.currency)}</td>
                      <td className="px-4 py-2 text-right">{money(i.lineTotal, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-line bg-surface font-semibold"><td className="px-4 py-2" colSpan={3}>Estimated total</td><td className="px-4 py-2 text-right">{money(r.estimatedTotal, r.currency)}</td></tr></tfoot>
              </table>
            </div>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Required by</dt><dd>{formatDate(r.requiredDate)}</dd></div>
              <div><dt className="text-xs text-slate-500">Submitted</dt><dd>{formatDate(r.submittedAt, true)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Reason for purchase</dt><dd className="whitespace-pre-wrap">{r.reason}</dd></div>
            </dl>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Approval workflow" />
            <div className="p-4">
              {r.approval ? <ApprovalTimeline approval={r.approval} currentStep={r.approval.currentStep} /> : <p className="text-sm text-slate-500">Not submitted yet. The approval chain is created on submission.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="space-y-2 p-4 text-sm">
              {(r.history ?? []).length === 0 && <li className="text-slate-500">No activity yet.</li>}
              {(r.history ?? []).map((h, i) => (
                <li key={i}><span className="font-medium capitalize">{h.action.replace(/_/g, " ")}</span>{h.stepLabel ? ` · ${h.stepLabel}` : ""} by {h.actorName}
                  <div className="text-xs text-slate-500">{formatDate(h.at, true)}</div>{h.comment && <div className="text-slate-600">&ldquo;{h.comment}&rdquo;</div>}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {cancelOpen && (
        <Modal title={`Cancel ${r.number}`} onClose={() => setCancelOpen(false)}>
          <div className="space-y-3">
            <Field label="Reason for cancelling" htmlFor="reason"><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {action.error && <Notice tone="error">{action.error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep requisition</Button>
              <Button variant="danger" disabled={reason.trim().length < 3 || action.pending} onClick={() => void cancel()}>Cancel requisition</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
