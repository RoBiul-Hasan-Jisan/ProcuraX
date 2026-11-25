"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Notice, Select } from "@/components/ui/field";
import { useApi } from "@/hooks/useApi";
import { fmtNum } from "@/lib/utils/forecast";
import { formatDate } from "@/lib/utils/format";
import type { Candidate, StoredForecast } from "@/types/intelligence";

/** Demand and price results share a list; each kind reads only its own fields. */
interface AnyResult { selectedModel?: string; method?: string; candidates?: Candidate[]; horizons?: { days: number; total?: number; price?: number; changePercent?: number | null }[] }
type Row = StoredForecast<AnyResult>;
const at30 = (r: Row) => r.result.horizons?.find((x) => x.days === 30);

export default function ForecastAnalyticsPage() {
  const [kind, setKind] = useState<"demand" | "price">("demand");
  const [page, setPage] = useState(1);
  const list = useApi<Row[]>(`/forecasting?kind=${kind}&page=${page}&limit=20`);
  const columns: ColumnDef<Row>[] = [
    { header: "Material", cell: ({ row }) => <Link className="text-steel-600 underline" href="/planning/forecasting">{row.original.sku} {row.original.materialName.replace(/^\[DEMO\]\s*/, "")}</Link> },
    { header: "Generated", cell: ({ row }) => formatDate(row.original.createdAt, true) },
    { header: "Outcome", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    kind === "demand"
      ? { header: "Model", cell: ({ row }) => row.original.result.selectedModel?.replace(/_/g, " ") ?? "-" }
      : { header: "Method", cell: ({ row }) => row.original.result.method?.replace(/_/g, " ") ?? "-" },
    kind === "demand"
      ? { header: "Next 30 days (forecast)", cell: ({ row }) => { const h = at30(row.original); return h?.total != null ? `${fmtNum(h.total)} ${row.original.unit}` : "-"; } }
      : { header: "In 30 days (forecast)", cell: ({ row }) => { const h = at30(row.original); return h?.price != null ? `${fmtNum(h.price, 2)} (${h.changePercent == null ? "-" : `${h.changePercent > 0 ? "+" : ""}${fmtNum(h.changePercent)}%`})` : "-"; } },
    ...(kind === "demand" ? [{ header: "Backtest RMSE", cell: ({ row }: { row: { original: Row } }) => { const c = row.original.result.candidates?.find((x) => x.model === row.original.result.selectedModel); return c?.rmse == null ? "-" : fmtNum(c.rmse, 2); } } as ColumnDef<Row>] : []),
    { header: "Version", cell: ({ row }) => <span className="font-mono text-xs">{row.original.modelVersion}</span> },
    { header: "Reason", cell: ({ row }) => row.original.reason ?? "" },
  ];
  return (
    <>
      <PageHeader title="Forecast Analytics" subtitle="Every forecast that has been generated, with the model used and its backtest accuracy. These are predictions, not actual values." />
      <div className="mb-3 flex items-end gap-3">
        <div><label htmlFor="kind" className="mb-1 block text-sm font-medium">Type</label>
          <Select id="kind" value={kind} onChange={(e) => { setKind(e.target.value as "demand" | "price"); setPage(1); }}><option value="demand">Demand</option><option value="price">Price</option></Select></div>
      </div>
      <Notice tone="info">Forecasts are re-generated on request and are not updated automatically. Check the generated date before relying on one.</Notice>
      <div className="mt-3"><DataTable columns={columns} data={list.data ?? []} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No forecasts have been generated yet. Open Demand Forecasting to create one." pagination={list.pagination} onPage={setPage} /></div>
    </>
  );
}
