"use client";

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiFetch } from "@/lib/api/client";
import { ROLE_OPTIONS, type AccountStatus, type AppUser, type RoleName } from "@/types";

interface Draft { role: RoleName | ""; status: AccountStatus }

const col = createColumnHelper<AppUser>();
const selectCls = "h-8 rounded-md border border-line bg-white px-2 text-sm";

export default function SettingsPage() {
  const { user: me, can } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState<"" | AccountStatus>("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "15", ...(filter ? { status: filter } : {}) });
      const res = await apiFetch<AppUser[]>(`/users?${qs}`);
      setUsers(res.data);
      setTotalPages(res.pagination?.totalPages ?? 1);
      setDrafts({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { void load(); }, [load]);

  const draftFor = useCallback((u: AppUser): Draft => drafts[u.id] ?? { role: u.role ?? "", status: u.status }, [drafts]);
  const setDraft = (u: AppUser, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [u.id]: { ...draftFor(u), ...patch } }));

  const save = useCallback(async (u: AppUser) => {
    const d = draftFor(u);
    setSavingId(u.id);
    setNotice(null);
    setError(null);
    try {
      await apiFetch(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role: d.role || null, status: d.status }) });
      setNotice(`Updated ${u.displayName}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  }, [draftFor, load]);

  const columns = useMemo(() => [
    col.accessor("displayName", { header: "Name", cell: (c) => <span className="font-medium">{c.getValue()}</span> }),
    col.accessor("email", { header: "Email" }),
    col.display({
      id: "role", header: "Role",
      cell: ({ row }) => (
        <select aria-label={`Role for ${row.original.displayName}`} className={selectCls}
          value={draftFor(row.original).role} disabled={row.original.id === me?.id}
          onChange={(e) => setDraft(row.original, { role: e.target.value as RoleName | "" })}>
          <option value="">Unassigned</option>
          {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      ),
    }),
    col.display({
      id: "status", header: "Status",
      cell: ({ row }) => (
        <select aria-label={`Status for ${row.original.displayName}`} className={selectCls}
          value={draftFor(row.original).status} disabled={row.original.id === me?.id}
          onChange={(e) => setDraft(row.original, { status: e.target.value as AccountStatus })}>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      ),
    }),
    col.display({
      id: "actions", header: "",
      cell: ({ row }) => {
        const dirty = !!drafts[row.original.id];
        return (
          <Button size="sm" disabled={!dirty || savingId === row.original.id} onClick={() => void save(row.original)}>
            {savingId === row.original.id ? "Saving…" : "Save"}
          </Button>
        );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [drafts, savingId, me?.id, save, draftFor]);

  const table = useReactTable({ data: users, columns, getCoreRowModel: getCoreRowModel() });

  if (!can("users:manage")) return <ErrorState message="You do not have permission to manage users." />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-navy-900">User Management</h1>
      <Card>
        <CardHeader
          title="Users"
          action={
            <select aria-label="Filter by status" className={selectCls} value={filter}
              onChange={(e) => { setPage(1); setFilter(e.target.value as "" | AccountStatus); }}>
              <option value="">All statuses</option>
              <option value="pending">Pending approval</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          }
        />
        {notice && <p role="status" className="m-3 rounded bg-green-50 p-2 text-sm text-ok">{notice}</p>}
        {error && users.length > 0 && <p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-danger">{error}</p>}
        {loading && users.length === 0 ? <LoadingState label="Loading users…" />
          : error && users.length === 0 ? <ErrorState message={error} onRetry={() => void load()} />
          : users.length === 0 ? <EmptyState message="No users match this filter." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface text-xs uppercase text-slate-500">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>{hg.headers.map((h) => (
                      <th key={h.id} className="px-4 py-2 font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>
                    ))}</tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-sm">
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
