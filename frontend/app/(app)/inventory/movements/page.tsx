"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { useApi } from "@/hooks/useApi";
import { formatDate, quantity } from "@/lib/utils/format";
import type { StockMovement } from "@/types/purchasing";

const TYPES = ["opening_balance", "receipt", "issue", "transfer_in", "transfer_out", "adjustment"];

export default function MovementsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const list = useApi<StockMovement[]>(`/stock-movements?page=${page}&limit=20${type ? `&type=${type}` : ""}`);
  const columns = useMemo<ColumnDef<StockMovement>[]>(() => [
    { header: "When", cell: ({ row }) => formatDate(row.original.createdAt, true) },
    { header: "Material", cell: ({ row }) => `${row.original.material.name} (${row.original.material.sku})` },
    { header: "Warehouse", cell: ({ row }) => row.original.warehouse.code },
    { header: "Type", cell: ({ row }) => row.original.type.replace(/_/g, " ") },
    { header: "Change", cell: ({ row }) => <span className={Number(row.original.delta) < 0 ? "text-danger" : "text-ok"}>{Number(row.original.delta) > 0 ? "+" : ""}{quantity(row.original.delta)} {row.original.material.unit}</span> },
    { header: "Balance", cell: ({ row }) => quantity(row.original.balanceAfter) },
    { header: "Reason / ref", cell: ({ row }) => <span className="block max-w-xs truncate">{row.original.reference?.number ?? row.original.reason}</span> },
    { header: "By", accessorKey: "performedByName" },
  ], []);
  return (
    <>
      <PageHeader title="Stock Movements" subtitle="Append-only ledger. Corrections are made with new adjustment entries, never by editing history." />
      <Card>
        <div className="border-b border-line p-3">
          <Select className="max-w-48" aria-label="Filter by type" value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
            <option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No stock movements yet." pagination={list.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
