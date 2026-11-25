"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useApi } from "@/hooks/useApi";
import { formatDate } from "@/lib/utils/format";
import type { AuditEntry } from "@/types/operations";

const pretty = (v: unknown) => (v === null || v === undefined ? "none" : JSON.stringify(v, null, 2));

export default function AuditLogsPage() {
  const [f, setF] = useState({ action: "", entityType: "", search: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setPage(1); };
  const qs = new URLSearchParams({ page: String(page), limit: "25", ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const actions = useApi<string[]>("/audit-logs/actions");
  const list = useApi<AuditEntry[]>(`/audit-logs?${qs}`);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const columns: ColumnDef<AuditEntry>[] = [
    { header: "When", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.at, true)}</span> },
    { header: "Who", cell: ({ row }) => <div><div>{row.original.actor.name}</div><div className="text-xs text-slate-500">{row.original.actor.role ?? "system"}</div></div> },
    { header: "Action", cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span> },
    { header: "Record", cell: ({ row }) => <div><div>{row.original.entityNumber || row.original.entityId}</div><div className="text-xs text-slate-500">{row.original.entityType}</div></div> },
    { header: "Summary", accessorKey: "summary" },
  ];

  return (
    <>
      <PageHeader title="Audit Logs" subtitle="An append-only record of who did what. Entries cannot be edited or deleted from the application. Secrets and bank details are never recorded." />
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Action" htmlFor="a"><Select id="a" value={f.action} onChange={(e) => set("action", e.target.value)}><option value="">All actions</option>{(actions.data ?? []).map((a) => <option key={a}>{a}</option>)}</Select></Field>
        <Field label="Record type" htmlFor="t"><Input id="t" value={f.entityType} onChange={(e) => set("entityType", e.target.value)} placeholder="e.g. PurchaseOrder" /></Field>
        <Field label="Search" htmlFor="s"><Input id="s" value={f.search} onChange={(e) => set("search", e.target.value)} placeholder="Number or summary" /></Field>
        <Field label="From" htmlFor="f"><Input id="f" type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></Field>
        <Field label="To" htmlFor="to"><Input id="to" type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></Field>
      </div>
      <DataTable columns={columns} data={list.data ?? []} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={setOpen} emptyMessage="No audit entries match." pagination={list.pagination} onPage={setPage} />
      {open && (
        <Modal title={open.action} onClose={() => setOpen(null)} wide>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">When</dt><dd>{formatDate(open.at, true)}</dd>
            <dt className="text-slate-500">User</dt><dd>{open.actor.name} ({open.actor.role ?? "system"})</dd>
            <dt className="text-slate-500">Record</dt><dd>{open.entityType} {open.entityNumber || open.entityId}</dd>
            <dt className="text-slate-500">Summary</dt><dd>{open.summary || "-"}</dd>
            <dt className="text-slate-500">Request id</dt><dd className="font-mono text-xs">{open.requestId ?? "-"}</dd>
            <dt className="text-slate-500">IP address</dt><dd className="font-mono text-xs">{open.ip ?? "-"}</dd>
          </dl>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div><h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Before</h3><pre className="max-h-64 overflow-auto rounded bg-surface p-2 text-xs">{pretty(open.before)}</pre></div>
            <div><h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">After</h3><pre className="max-h-64 overflow-auto rounded bg-surface p-2 text-xs">{pretty(open.after)}</pre></div>
          </div>
        </Modal>
      )}
    </>
  );
}
