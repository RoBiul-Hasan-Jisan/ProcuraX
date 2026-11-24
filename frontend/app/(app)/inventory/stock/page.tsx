"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthProvider";
import { StockActionDialog, type StockAction } from "@/features/purchasing/StockActionDialog";
import { useApi } from "@/hooks/useApi";
import { quantity } from "@/lib/utils/format";
import type { StockRow } from "@/types/purchasing";

export default function StockPage() {
  const { can } = useAuth();
  const manage = can("inventory:manage");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [act, setAct] = useState<{ action: StockAction; row: StockRow } | null>(null);
  const q = new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}) }).toString();
  const list = useApi<StockRow[]>(`/stock${q ? `?${q}` : ""}`);

  const columns = useMemo<ColumnDef<StockRow>[]>(() => [
    { header: "SKU", accessorKey: "sku", cell: (c) => <span className="font-mono text-xs">{c.getValue<string>()}</span> },
    { header: "Material", accessorKey: "name" },
    { header: "On hand", cell: ({ row }) => <strong>{quantity(row.original.total)} {row.original.unit}</strong> },
    { header: "By warehouse", cell: ({ row }) => row.original.byWarehouse.length ? row.original.byWarehouse.map((b) => `${b.code}: ${quantity(b.quantity)}`).join(" · ") : <span className="text-slate-400">No stock</span> },
    { header: "Levels (safety / min / reorder)", cell: ({ row }) => `${row.original.safetyStock} / ${row.original.minimumStock} / ${row.original.reorderPoint}` },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
    ...(manage ? [{ header: "Actions", cell: ({ row }) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => setAct({ action: "issue", row: row.original })}>Issue</Button>
        <Button size="sm" variant="secondary" onClick={() => setAct({ action: "transfer", row: row.original })}>Transfer</Button>
        <Button size="sm" variant="secondary" onClick={() => setAct({ action: "adjust", row: row.original })}>Adjust</Button>
      </div>) } as ColumnDef<StockRow>] : []),
  ], [manage]);

  return (
    <>
      <PageHeader title="Stock Overview" subtitle="Live balances from the stock ledger. Status compares on-hand stock with each material's own levels." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input aria-label="Search materials" className="max-w-60" placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="max-w-44" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option><option value="critical">Critical</option><option value="low">Low</option><option value="reorder">Reorder</option><option value="ok">OK</option>
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No materials match." />
      </Card>
      {act && <StockActionDialog action={act.action} row={act.row} onClose={() => setAct(null)} onDone={() => { setAct(null); list.reload(); }} />}
    </>
  );
}
