"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Notice } from "@/components/ui/field";
import { useApi } from "@/hooks/useApi";
import type { SupplierScoreRow } from "@/types/intelligence";

interface Scoring { minHistoryOrders: number; rows: SupplierScoreRow[] }
const pct = (n: number | null) => (n == null ? "-" : `${n}%`);

export default function SupplierPerformancePage() {
  const s = useApi<Scoring>("/supplier-scoring");
  const columns: ColumnDef<SupplierScoreRow>[] = [
    { header: "Supplier", cell: ({ row }) => <div><div className="font-medium">{row.original.name}</div><div className="font-mono text-xs text-slate-500">{row.original.code}</div></div> },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    { header: "Completed orders", accessorKey: "completedOrders" },
    { header: "On-time", cell: ({ row }) => pct(row.original.onTimePercent) },
    { header: "Quality acceptance", cell: ({ row }) => pct(row.original.qualityPercent) },
    { header: "History score", cell: ({ row }) => row.original.proven ? <span className="font-medium">{row.original.historyScore}</span> : <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-warn">Unproven</span> },
    { header: "Note", cell: ({ row }) => <span className="text-xs text-slate-500">{row.original.note ?? ""}</span> },
  ];
  return (
    <>
      <PageHeader title="Supplier Performance" subtitle="Recorded delivery and quality history. This is not a quotation score; scoring of bids happens in Quotation Comparison." />
      <Notice tone="info">A supplier needs at least {s.data?.minHistoryOrders ?? 5} completed orders before reliability is rated. Until then no score is shown, because a short record can look perfect by chance.</Notice>
      <div className="mt-3"><DataTable columns={columns} data={s.data?.rows ?? []} loading={s.loading} error={s.error} onRetry={s.reload} emptyMessage="No suppliers yet." /></div>
      <p className="mt-2 text-xs text-slate-500">On-time = orders fully accepted by the expected date / completed orders. Quality = accepted units / received units. History score = the mean of the two.</p>
    </>
  );
}
