"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

interface Props<T> {
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  data: T[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyMessage: string;
  onRowClick?: (row: T) => void;
  pagination?: { page: number; totalPages: number; total: number } | null;
  onPage?: (page: number) => void;
}

/** TanStack Table wrapper with built-in loading, error and empty states plus server-side pagination. */
export function DataTable<T>({ columns, data, loading, error, onRetry, emptyMessage, onRowClick, pagination, onPage }: Props<T>) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: data ?? [], columns, getCoreRowModel: getCoreRowModel() });

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={onRetry} />;
  if (!data || data.length === 0) return loading ? <LoadingState /> : <EmptyState message={emptyMessage} />;

  return (
    <div className={loading ? "opacity-60 transition-opacity" : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-slate-500">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="whitespace-nowrap px-4 py-2 font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={onRowClick ? "cursor-pointer border-t border-line hover:bg-steel-100/50" : "border-t border-line"}>
                {row.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-2 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && onPage && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-sm">
          <span className="text-slate-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} records</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
