"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PackageCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthProvider";
import { ReceiptDialog } from "@/features/purchasing/ReceiptDialog";
import { useApi } from "@/hooks/useApi";
import { formatDate, quantity } from "@/lib/utils/format";
import type { GoodsReceipt, PurchaseOrder } from "@/types/purchasing";

export default function GoodsReceiptsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const list = useApi<GoodsReceipt[]>(`/goods-receipts?page=${page}&limit=15`);
  const receivable = useApi<PurchaseOrder[]>(open ? "/purchase-orders?limit=100&status=issued" : null);
  const partial = useApi<PurchaseOrder[]>(open ? "/purchase-orders?limit=100&status=partially_received" : null);
  const orders = [...(receivable.data ?? []), ...(partial.data ?? [])];

  const columns = useMemo<ColumnDef<GoodsReceipt>[]>(() => [
    { header: "Receipt", accessorKey: "number", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    { header: "PO", cell: ({ row }) => <Link className="text-steel-600 underline" href={`/procurement/purchase-orders/${row.original.purchaseOrder.id}`}>{row.original.purchaseOrder.number}</Link> },
    { header: "Supplier", cell: ({ row }) => row.original.supplier.name },
    { header: "Warehouse", cell: ({ row }) => row.original.warehouse.code },
    { header: "Accepted", cell: ({ row }) => row.original.lines.map((l) => `${quantity(l.acceptedQty)} ${l.unit}`).join(", ") },
    { header: "Rejected", cell: ({ row }) => { const r = row.original.lines.filter((l) => Number(l.rejectedQty) > 0); return r.length ? r.map((l) => `${quantity(l.rejectedQty)} ${l.unit}`).join(", ") : "-"; } },
    { header: "Received", cell: ({ row }) => `${formatDate(row.original.receivedAt, true)} · ${row.original.receivedByName}` },
  ], []);

  return (
    <>
      <PageHeader title="Goods Receipt" subtitle="Deliveries checked in against purchase orders."
        actions={can("goods_receipts:manage") ? <Button onClick={() => setOpen(true)}><PackageCheck className="h-4 w-4" /> Record receipt</Button> : undefined} />
      <Card>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage="No goods receipts yet." pagination={list.pagination} onPage={setPage} />
      </Card>
      {open && <ReceiptDialog orders={orders} onClose={() => setOpen(false)} onDone={() => { setOpen(false); list.reload(); }} />}
    </>
  );
}
