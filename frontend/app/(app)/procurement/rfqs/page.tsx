"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { useAuth } from "@/features/auth/AuthProvider";
import { CreateRfqDialog } from "@/features/rfq/CreateRfqDialog";
import { useApi } from "@/hooks/useApi";
import { formatDate } from "@/lib/utils/format";
import type { Rfq } from "@/types/procurement";

function RfqList() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const manager = can("rfq:manage");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const preselect = params.get("create");
  const [creating, setCreating] = useState(Boolean(preselect));
  const list = useApi<Rfq[]>(`/rfqs?page=${page}&limit=15${status ? `&status=${status}` : ""}`);

  const columns = useMemo<ColumnDef<Rfq>[]>(() => [
    { header: "RFQ", accessorKey: "number", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    { header: "Materials", cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.items.map((i) => i.materialName).join(", ")}</span> },
    ...(manager ? [
      { header: "Requisition", cell: ({ row }) => row.original.requisitionNumber ?? "-" },
      { header: "Invited", cell: ({ row }) => row.original.invitedSuppliers?.length ?? 0 },
      { header: "Quotations", cell: ({ row }) => row.original.quotationCount ?? 0 },
    ] as ColumnDef<Rfq>[] : [
      { header: "Your quotation", cell: ({ row }) => row.original.myQuotationStatus ? <StatusBadge value={row.original.myQuotationStatus} /> : <span className="text-slate-400">Not submitted</span> },
    ] as ColumnDef<Rfq>[]),
    { header: "Deadline", cell: ({ row }) => formatDate(row.original.deadline, true) },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
  ], [manager]);

  return (
    <>
      <PageHeader title="Request for Quotation" subtitle={manager ? "RFQs raised from approved requisitions." : "RFQs addressed to your company."}
        actions={manager ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New RFQ</Button> : undefined} />
      <Card>
        <div className="border-b border-line p-3">
          <Select className="max-w-48" aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option><option value="awarded">Awarded</option><option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage={manager ? "No RFQs yet. Create one from an approved requisition." : "No RFQs have been sent to you."}
          pagination={list.pagination} onPage={setPage} onRowClick={(r) => router.push(`/procurement/rfqs/${r.id}`)} />
      </Card>
      {creating && <CreateRfqDialog initialRequisitionId={preselect ?? undefined} onClose={() => setCreating(false)} onCreated={(r) => router.push(`/procurement/rfqs/${r.id}`)} />}
    </>
  );
}

export default function RfqsPage() {
  return <Suspense><RfqList /></Suspense>;
}
