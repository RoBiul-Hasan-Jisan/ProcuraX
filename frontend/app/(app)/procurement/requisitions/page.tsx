"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthProvider";
import { useApi } from "@/hooks/useApi";
import { formatDate, money } from "@/lib/utils/format";
import { REQUISITION_STATUSES, type Requisition } from "@/types/procurement";

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function RequisitionsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const qs = new URLSearchParams({ page: String(page), limit: "15", ...(search ? { search } : {}), ...(status ? { status } : {}), ...(mine ? { mine: "true" } : {}) });
  const list = useApi<Requisition[]>(`/requisitions?${qs}`);

  const columns = useMemo<ColumnDef<Requisition>[]>(() => [
    { header: "Number", accessorKey: "number", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    { header: "Materials", cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.items.map((i) => i.materialName).join(", ")}</span> },
    { header: "Requester", cell: ({ row }) => row.original.requestedBy.name },
    { header: "Department", cell: ({ row }) => row.original.department.name ?? "-" },
    { header: "Est. total", cell: ({ row }) => money(row.original.estimatedTotal, row.original.currency) },
    { header: "Priority", cell: ({ row }) => <StatusBadge value={row.original.priority} /> },
    { header: "Needed by", cell: ({ row }) => formatDate(row.original.requiredDate) },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
  ], []);

  /** Exports the rows currently on screen (current page and filters) as CSV. */
  const exportCsv = () => {
    const rows = list.data ?? [];
    const head = ["Number", "Status", "Priority", "Requester", "Department", "Estimated total", "Currency", "Needed by", "Materials"];
    const lines = rows.map((r) => [r.number, r.status, r.priority, r.requestedBy.name, r.department.name ?? "", r.estimatedTotal, r.currency, r.requiredDate.slice(0, 10), r.items.map((i) => `${i.materialName} x ${i.quantity} ${i.unit}`).join("; ")].map(csvEscape).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "purchase-requisitions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader title="Purchase Requisitions" subtitle="Departmental requests for materials."
        actions={<>
          <Button variant="secondary" onClick={exportCsv} disabled={!list.data?.length}>Export CSV</Button>
          {can("requisitions:create") && <Button onClick={() => router.push("/procurement/requisitions/new")}><Plus className="h-4 w-4" /> New requisition</Button>}
        </>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search number, requester, material…" aria-label="Search requisitions" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          <Select className="max-w-48" aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All statuses</option>{REQUISITION_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={mine} onChange={(e) => { setPage(1); setMine(e.target.checked); }} /> My requests only</label>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage="No requisitions match your filters." pagination={list.pagination} onPage={setPage}
          onRowClick={(r) => router.push(`/procurement/requisitions/${r.id}`)} />
      </Card>
    </>
  );
}
