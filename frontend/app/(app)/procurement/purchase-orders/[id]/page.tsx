"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice, Textarea } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/features/auth/AuthProvider";
import { ReceiptDialog } from "@/features/purchasing/ReceiptDialog";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate, money, quantity } from "@/lib/utils/format";
import type { GoodsReceipt, Invoice, PurchaseOrder } from "@/types/purchasing";

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const po = useApi<PurchaseOrder>(`/purchase-orders/${id}`);
  const receipts = useApi<GoodsReceipt[]>(can("goods_receipts:manage") || can("purchase_orders:view") ? `/goods-receipts?purchaseOrder=${id}&limit=50` : null);
  const invoices = useApi<Invoice[]>(can("invoices:verify") ? `/invoices?purchaseOrder=${id}&limit=50` : null);
  const action = useAction();
  const [dialog, setDialog] = useState<null | "cancel" | "close" | "receipt">(null);
  const [reason, setReason] = useState("");

  if (po.loading && !po.data) return <LoadingState />;
  if (po.error || !po.data) return <ErrorState message={po.error ?? "Not found"} onRetry={po.reload} />;
  const p = po.data;
  const manager = can("purchase_orders:manage");
  const refresh = () => { po.reload(); receipts.reload(); invoices.reload(); };

  const post = (path: string, body: unknown = {}) => action.run(async () => {
    await apiFetch(`/purchase-orders/${p.id}/${path}`, { method: "POST", body: JSON.stringify(body) });
    setDialog(null); setReason(""); refresh();
  });

  return (
    <>
      <PageHeader title={p.number} subtitle={`${p.supplier.name ?? ""}${p.rfqNumber ? ` · from ${p.rfqNumber}` : ""}`}
        actions={<>
          <StatusBadge value={p.status} />
          {manager && p.status === "draft" && <Button disabled={action.pending} onClick={() => void post("issue")}>Issue to supplier</Button>}
          {manager && (p.status === "draft" || p.status === "issued") && <Button variant="danger" onClick={() => setDialog("cancel")}>Cancel</Button>}
          {manager && p.status === "partially_received" && <Button variant="secondary" onClick={() => setDialog("close")}>Short-close</Button>}
          {can("goods_receipts:manage") && (p.status === "issued" || p.status === "partially_received") && <Button onClick={() => setDialog("receipt")}>Record receipt</Button>}
        </>} />
      {action.error && <div className="mb-3"><Notice tone="error">{action.error}</Notice></div>}
      {p.status === "draft" && manager && <div className="mb-3"><Notice tone="info">This is a draft. The supplier cannot see it until you issue it.</Notice></div>}
      {p.closeReason && <div className="mb-3"><Notice tone="info">Reason: {p.closeReason}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Order lines" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Material</th><th>Ordered</th><th>Unit price</th><th>Accepted</th><th>Rejected</th><th>Invoiced</th><th className="pr-4 text-right">Line total</th></tr></thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.materialId} className="border-t border-line">
                    <td className="px-4 py-2">{l.materialName}<div className="text-xs text-slate-400">{l.sku}</div></td>
                    <td>{quantity(l.quantity)} {l.unit}</td><td>{money(l.unitPrice, p.currency)}</td>
                    <td>{quantity(l.acceptedQty)}</td><td>{Number(l.rejectedQty) > 0 ? quantity(l.rejectedQty) : "-"}</td><td>{quantity(l.invoicedQty)}</td>
                    <td className="pr-4 text-right">{money(l.lineTotal, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto max-w-xs space-y-1 border-t border-line p-4 text-sm">
            {([["Material cost", p.materialCost], ["Transportation", p.transportCost], ["Additional charges", p.additionalCharges], [`Tax (${p.taxRatePercent}%)`, p.taxAmount]] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd>{money(v, p.currency)}</dd></div>
            ))}
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Total landed cost</dt><dd>{money(p.totalAmount, p.currency)}</dd></div>
          </dl>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Delivery and terms" />
            <dl className="space-y-3 p-4 text-sm">
              <div><dt className="text-xs text-slate-500">Deliver to</dt><dd>{p.deliveryLocation}</dd></div>
              <div><dt className="text-xs text-slate-500">Expected delivery</dt><dd>{p.expectedDeliveryDate ? formatDate(p.expectedDeliveryDate) : "Set when issued"}</dd></div>
              <div><dt className="text-xs text-slate-500">Payment terms</dt><dd>{p.paymentTerms}</dd></div>
              <div><dt className="text-xs text-slate-500">Requisition</dt><dd>{p.requisitionNumber ?? "-"}</dd></div>
            </dl>
          </Card>
          {receipts.data && (
            <Card>
              <CardHeader title={`Receipts (${receipts.data.length})`} />
              <ul className="divide-y divide-line text-sm">
                {receipts.data.length === 0 && <li className="p-4 text-slate-500">Nothing received yet.</li>}
                {receipts.data.map((r) => <li key={r.id} className="px-4 py-2"><span className="font-mono text-xs">{r.number}</span> · {formatDate(r.receivedAt)}<div className="text-xs text-slate-500">{r.lines.map((l) => `${quantity(l.acceptedQty)} ${l.unit} accepted${Number(l.rejectedQty) > 0 ? `, ${quantity(l.rejectedQty)} rejected` : ""}`).join("; ")}</div></li>)}
              </ul>
            </Card>
          )}
          {invoices.data && (
            <Card>
              <CardHeader title={`Invoices (${invoices.data.length})`} action={<Link href="/procurement/invoices" className="text-xs text-steel-600 underline">Open</Link>} />
              <ul className="divide-y divide-line text-sm">
                {invoices.data.length === 0 && <li className="p-4 text-slate-500">No invoices recorded.</li>}
                {invoices.data.map((i) => <li key={i.id} className="flex items-center justify-between px-4 py-2"><span>{i.invoiceNumber}</span><StatusBadge value={i.status} /></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {(dialog === "cancel" || dialog === "close") && (
        <Modal title={dialog === "cancel" ? "Cancel purchase order" : "Short-close purchase order"} onClose={() => setDialog(null)}>
          <p className="mb-2 text-sm text-slate-600">{dialog === "cancel" ? "Only orders with no receipts can be cancelled." : "The supplier will deliver no more. This counts against their on-time record."}</p>
          <Textarea aria-label="Reason" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {action.error && <div className="mt-2"><Notice tone="error">{action.error}</Notice></div>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>Back</Button>
            <Button variant="danger" disabled={action.pending || reason.trim().length < 3} onClick={() => void post(dialog, { reason })}>Confirm</Button>
          </div>
        </Modal>
      )}
      {dialog === "receipt" && <ReceiptDialog orders={[p]} initialPoId={p.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
    </>
  );
}
