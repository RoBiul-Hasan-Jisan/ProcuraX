"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice, Select } from "@/components/ui/field";
import { useAuth } from "@/features/auth/AuthProvider";
import { PlanDialog } from "@/features/planning/PlanDialog";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate, quantity } from "@/lib/utils/format";
import type { ProductionPlan } from "@/types/planning";

/** Legal next statuses, mirroring the server's state machine (the server is the authority). */
const NEXT: Record<string, { to: string; label: string; danger?: boolean }[]> = {
  planned: [{ to: "confirmed", label: "Confirm" }, { to: "cancelled", label: "Cancel", danger: true }],
  confirmed: [{ to: "in_progress", label: "Start" }, { to: "planned", label: "Back to planned" }, { to: "cancelled", label: "Cancel", danger: true }],
  in_progress: [{ to: "completed", label: "Complete" }, { to: "cancelled", label: "Cancel", danger: true }],
};

export default function ProductionPlanningPage() {
  const { can } = useAuth();
  const manage = can("production:manage");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<ProductionPlan | "new" | null>(null);
  const list = useApi<ProductionPlan[]>(`/production-plans?page=${page}&limit=15${status ? `&status=${status}` : ""}`);
  const act = useAction();

  const move = (id: string, to: string) => act.run(async () => { await apiFetch(`/production-plans/${id}/status`, { method: "POST", body: JSON.stringify({ status: to }) }); list.reload(); });

  const columns = useMemo<ColumnDef<ProductionPlan>[]>(() => [
    { header: "Plan", accessorKey: "number", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    { header: "Product", cell: ({ row }) => `${row.original.product.name ?? ""}` },
    { header: "Quantity", cell: ({ row }) => `${quantity(row.original.quantity)} ${row.original.unit}` },
    { header: "Start", cell: ({ row }) => formatDate(row.original.startDate) },
    { header: "Completion", cell: ({ row }) => formatDate(row.original.endDate) },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    ...(manage ? [{ header: "Actions", id: "actions", cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {(row.original.status === "planned" || row.original.status === "confirmed") && <Button size="sm" variant="secondary" onClick={() => setEditing(row.original)}>Edit</Button>}
        {(NEXT[row.original.status] ?? []).map((n) => <Button key={n.to} size="sm" variant={n.danger ? "danger" : "secondary"} disabled={act.pending} onClick={() => void move(row.original.id, n.to)}>{n.label}</Button>)}
      </div>) } as ColumnDef<ProductionPlan>] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [manage, act.pending]);

  return (
    <>
      <PageHeader title="Production Planning" subtitle="What will be produced, how much, and when. MRP turns these plans into material needs."
        actions={manage ? <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New plan</Button> : undefined} />
      {act.error && <div className="mb-3"><Notice tone="error">{act.error}</Notice></div>}
      <Card>
        <div className="border-b border-line p-3">
          <Select className="max-w-48" aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All statuses</option>{["planned", "confirmed", "in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No production plans yet." pagination={list.pagination} onPage={setPage} />
      </Card>
      <p className="mt-3 text-xs text-slate-500">Planned, confirmed and in-progress plans are included in MRP. An in-progress plan counts at its full quantity until it is completed.</p>
      {editing && <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}
