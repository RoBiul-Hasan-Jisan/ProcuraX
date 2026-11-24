"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { useApi } from "@/hooks/useApi";
import { quantity } from "@/lib/utils/format";
import type { StockRow } from "@/types/purchasing";

export default function AlertsPage() {
  const list = useApi<StockRow[]>("/stock/alerts");
  const columns = useMemo<ColumnDef<StockRow>[]>(() => [
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    { header: "Material", cell: ({ row }) => <span>{row.original.name}<span className="block font-mono text-xs text-slate-400">{row.original.sku}</span></span> },
    { header: "On hand", cell: ({ row }) => `${quantity(row.original.total)} ${row.original.unit}` },
    { header: "Safety / min / reorder", cell: ({ row }) => `${row.original.safetyStock} / ${row.original.minimumStock} / ${row.original.reorderPoint}` },
    { header: "Short of reorder point", cell: ({ row }) => `${quantity(row.original.shortfallToReorderPoint)} ${row.original.unit}` },
  ], []);
  return (
    <>
      <PageHeader title="Reorder Alerts" subtitle="Materials at or below a configured level. Most severe first. Raise a requisition from Purchase Requisitions." />
      <Card><DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No materials are at or below their reorder levels." /></Card>
    </>
  );
}
