"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Notice, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate, money, quantity } from "@/lib/utils/format";
import type { Requisition } from "@/types/procurement";

interface Pending { approvalId: string; step: number; stepLabel: string; requisition: Requisition }
type Decision = "approve" | "reject" | "request_modification";

function DecisionDialog({ item, onClose, onDone }: { item: Pending; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const { pending, error, run } = useAction();
  const r = item.requisition;
  const decide = (action: Decision) => run(async () => {
    await apiFetch(`/approvals/${r.id}/decision`, { method: "POST", body: JSON.stringify({ action, comment }) });
    onDone();
  });
  const needsComment = comment.trim().length === 0;
  return (
    <Modal title={`${r.number} · ${item.stepLabel}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          <div><div className="text-xs text-slate-500">Requester</div>{r.requestedBy.name} ({r.department.name})</div>
          <div><div className="text-xs text-slate-500">Needed by</div>{formatDate(r.requiredDate)}</div>
          <div><div className="text-xs text-slate-500">Estimated total</div><strong>{money(r.estimatedTotal, r.currency)}</strong></div>
        </div>
        <ul className="divide-y divide-line rounded border border-line">
          {r.items.map((i) => <li key={i.id} className="flex justify-between gap-3 px-3 py-2"><span>{i.materialName} · {quantity(i.quantity)} {i.unit}</span><span>{money(i.lineTotal, r.currency)}</span></li>)}
        </ul>
        <div><div className="text-xs text-slate-500">Reason</div><p className="whitespace-pre-wrap">{r.reason}</p></div>
        <Field label="Comment" htmlFor="comment" hint="Required when rejecting or requesting changes."><Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="danger" disabled={pending || needsComment} onClick={() => void decide("reject")}>Reject</Button>
          <Button variant="secondary" disabled={pending || needsComment} onClick={() => void decide("request_modification")}>Request changes</Button>
          <Button disabled={pending} onClick={() => void decide("approve")}>{pending ? "Saving…" : "Approve"}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function ApprovalsPage() {
  const { can } = useAuth();
  const list = useApi<Pending[]>(can("requisitions:approve") ? "/approvals" : null);
  const [active, setActive] = useState<Pending | null>(null);

  const columns = useMemo<ColumnDef<Pending>[]>(() => [
    { header: "Requisition", cell: ({ row }) => <Link className="font-mono text-xs font-medium text-steel-600 hover:underline" href={`/procurement/requisitions/${row.original.requisition.id}`} onClick={(e) => e.stopPropagation()}>{row.original.requisition.number}</Link> },
    { header: "Step", cell: ({ row }) => row.original.stepLabel },
    { header: "Requester", cell: ({ row }) => row.original.requisition.requestedBy.name },
    { header: "Department", cell: ({ row }) => row.original.requisition.department.name ?? "-" },
    { header: "Est. total", cell: ({ row }) => money(row.original.requisition.estimatedTotal, row.original.requisition.currency) },
    { header: "Priority", cell: ({ row }) => <StatusBadge value={row.original.requisition.priority} /> },
    { header: "Needed by", cell: ({ row }) => formatDate(row.original.requisition.requiredDate) },
  ], []);

  if (!can("requisitions:approve")) return <ErrorState message="You do not have permission to approve requisitions." />;
  return (
    <>
      <PageHeader title="Approvals" subtitle="Requisitions waiting for your decision." />
      <Card>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage="Nothing is waiting for your approval." onRowClick={setActive} />
      </Card>
      {active && <DecisionDialog item={active} onClose={() => setActive(null)} onDone={() => { setActive(null); list.reload(); }} />}
    </>
  );
}
