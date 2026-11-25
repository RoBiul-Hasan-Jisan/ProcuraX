"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { FilePlus2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { InvoiceDialog } from "@/features/purchasing/InvoiceDialog";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate, money } from "@/lib/utils/format";
import type { Invoice, PurchaseOrder } from "@/types/purchasing";
import { DocumentsPanel } from "@/features/documents/DocumentsPanel";

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState(false);
  const [reviewing, setReviewing] = useState<Invoice | null>(null);
  const list = useApi<Invoice[]>(`/invoices?page=${page}&limit=15${status ? `&status=${status}` : ""}`);
  const recv = useApi<PurchaseOrder[]>(recording ? "/purchase-orders?limit=100&status=received" : null);
  const part = useApi<PurchaseOrder[]>(recording ? "/purchase-orders?limit=100&status=partially_received" : null);
  const closed = useApi<PurchaseOrder[]>(recording ? "/purchase-orders?limit=100&status=closed" : null);

  const columns = useMemo<ColumnDef<Invoice>[]>(() => [
    { header: "Invoice", cell: ({ row }) => <span><span className="font-medium">{row.original.invoiceNumber}</span><span className="block font-mono text-xs text-slate-400">{row.original.number}</span></span> },
    { header: "PO", cell: ({ row }) => row.original.purchaseOrder.number },
    { header: "Supplier", cell: ({ row }) => row.original.supplier.name },
    { header: "Total", cell: ({ row }) => money(row.original.totalAmount) },
    { header: "Date", cell: ({ row }) => formatDate(row.original.invoiceDate) },
    { header: "Match", cell: ({ row }) => row.original.match ? (row.original.match.ok ? <span className="text-ok">Matches</span> : <span className="text-danger">{row.original.match.issues.length} issue(s)</span>) : "-" },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
  ], []);

  return (
    <>
      <PageHeader title="Invoice Verification" subtitle="Three-way match: purchase order, goods received, invoice."
        actions={<Button onClick={() => setRecording(true)}><FilePlus2 className="h-4 w-4" /> Record invoice</Button>} />
      <Card>
        <div className="border-b border-line p-3">
          <Select className="max-w-56" aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All statuses</option><option value="pending_verification">Pending verification</option><option value="verified">Verified</option><option value="disputed">Disputed</option>
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage="No invoices recorded yet." pagination={list.pagination} onPage={setPage} onRowClick={setReviewing} />
      </Card>
      {recording && <InvoiceDialog orders={[...(recv.data ?? []), ...(part.data ?? []), ...(closed.data ?? [])]} onClose={() => setRecording(false)} onDone={(i) => { setRecording(false); list.reload(); setReviewing(i); }} />}
      {reviewing && <ReviewDialog invoice={reviewing} onClose={() => setReviewing(null)} onDecided={() => { setReviewing(null); list.reload(); }} />}
    </>
  );
}

function ReviewDialog({ invoice: i, onClose, onDecided }: { invoice: Invoice; onClose: () => void; onDecided: () => void }) {
  const { pending, error, run } = useAction();
  const [comment, setComment] = useState("");
  const decide = (action: "verify" | "dispute") => run(async () => {
    await apiFetch(`/invoices/${i.id}/decision`, { method: "POST", body: JSON.stringify({ action, comment }) });
    onDecided();
  });
  const open = i.status === "pending_verification";
  return (
    <Modal title={`Invoice ${i.invoiceNumber}`} onClose={onClose} wide>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Supplier</dt><dd>{i.supplier.name}</dd></div>
        <div><dt className="text-xs text-slate-500">Purchase order</dt><dd>{i.purchaseOrder.number}</dd></div>
        <div><dt className="text-xs text-slate-500">Total (server-computed)</dt><dd className="font-semibold">{money(i.totalAmount)}</dd></div>
      </dl>
      <ul className="mt-3 divide-y divide-line rounded border border-line text-sm">
        {i.lines.map((l) => <li key={l.materialId} className="flex justify-between px-3 py-2"><span>{l.materialName} · {l.quantity} × {money(l.unitPrice)}</span><span>{money(l.lineTotal)}</span></li>)}
      </ul>
      <div className="mt-3"><DocumentsPanel entityType="invoice" entityId={i.id} canUpload={false} /></div>
      <div className="mt-3">
        {i.match?.ok ? <Notice tone="success">Matches the purchase order and goods accepted.</Notice>
          : i.match ? <Notice tone="error">Does not match: {i.match.issues.join("; ")}. It can be disputed but not verified.</Notice> : null}
      </div>
      {i.decision && <p className="mt-2 text-sm text-slate-600">{i.status === "verified" ? "Verified" : "Disputed"} by {i.decision.byName} on {formatDate(i.decision.at)}{i.decision.comment ? `: ${i.decision.comment}` : ""}.</p>}
      {open && (
        <div className="mt-3">
          <Textarea aria-label="Comment" placeholder="Comment (required to dispute)" value={comment} onChange={(e) => setComment(e.target.value)} />
          {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="danger" disabled={pending || comment.trim().length < 3} onClick={() => void decide("dispute")}>Dispute</Button>
            <Button disabled={pending || !i.match?.ok} onClick={() => void decide("verify")}>Verify</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
