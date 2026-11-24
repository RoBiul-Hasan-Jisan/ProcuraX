"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { useAuth } from "@/features/auth/AuthProvider";
import { useApi } from "@/hooks/useApi";
import { formatDate, money } from "@/lib/utils/format";
import type { PurchaseOrder } from "@/types/purchasing";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { can } = useAuth();
  const supplierView = !can("purchase_orders:view");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const list = useApi<PurchaseOrder[]>(`/purchase-orders?page=${page}&limit=15${status ? `&status=${status}` : ""}`);

  const columns = useMemo<ColumnDef<PurchaseOrder>[]>(() => [
    { header: "PO", accessorKey: "number", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    ...(supplierView ? [] : [{ header: "Supplier", cell: ({ row }) => row.original.supplier.name } as ColumnDef<PurchaseOrder>]),
    { header: "Materials", cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.lines.map((l) => l.materialName).join(", ")}</span> },
    { header: "Total", cell: ({ row }) => money(row.original.totalAmount, row.original.currency) },
    { header: "Expected", cell: ({ row }) => formatDate(row.original.expectedDeliveryDate) },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
  ], [supplierView]);

  return (
    <>
      <PageHeader title="Purchase Orders" subtitle={supplierView ? "Orders placed with your company." : "Orders raised from awarded RFQs. Create one from an awarded RFQ."} />
      <Card>
        <div className="border-b border-line p-3">
          <Select className="max-w-52" aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All statuses</option>
            {["draft", "issued", "partially_received", "received", "closed", "cancelled"].filter((s) => !(supplierView && s === "draft")).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage={supplierView ? "No purchase orders have been issued to you." : "No purchase orders yet."}
          pagination={list.pagination} onPage={setPage} onRowClick={(r) => router.push(`/procurement/purchase-orders/${r.id}`)} />
      </Card>
    </>
  );
}
