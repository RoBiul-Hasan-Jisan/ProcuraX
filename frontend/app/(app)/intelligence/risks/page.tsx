"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { CATEGORY_LABEL, NEXT_STATUSES, NOTE_REQUIRED, SEVERITY_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/utils/risk";
import { formatDate } from "@/lib/utils/format";
import type { RiskAlert, RiskStatus, Severity } from "@/types/intelligence";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const Tag = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;

export default function RisksPage() {
  const { can, user } = useAuth();
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), limit: "20", ...(status ? { status } : {}), ...(severity ? { severity } : {}) }).toString();
  const list = useApi<RiskAlert[]>(`/risk-alerts?${qs}`);
  const [open, setOpen] = useState<RiskAlert | null>(null);
  const scan = useAction();
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const unresolved = (list.pagination as unknown as { unresolved?: Record<Severity, number> } | null)?.unresolved;
  const canReview = can("risks:review");

  const doScan = () => scan.run(async () => {
    const res = await apiFetch<{ detected: number; created: number; alreadyKnown: number }>("/risk-alerts/scan", { method: "POST" });
    setScanMsg(`${res.data.detected} condition(s) found: ${res.data.created} new alert(s), ${res.data.alreadyKnown} already known.`);
    list.reload();
  });

  const columns: ColumnDef<RiskAlert>[] = [
    { header: "Alert", cell: ({ row }) => <span className="font-mono text-xs">{row.original.number}</span> },
    { header: "Severity", cell: ({ row }) => <Tag tone={SEVERITY_TONE[row.original.severity]}>{row.original.severity}</Tag> },
    { header: "What", cell: ({ row }) => <div><div className="font-medium">{row.original.title}</div><div className="text-xs text-slate-500">{CATEGORY_LABEL[row.original.category] ?? row.original.category}</div></div> },
    { header: "Status", cell: ({ row }) => <Tag tone={STATUS_TONE[row.original.status]}>{row.original.status}</Tag> },
    { header: "Detected", cell: ({ row }) => formatDate(row.original.detectedAt) },
    { header: "Reviewer", cell: ({ row }) => row.original.assignedToName || "Unassigned" },
  ];

  return (
    <>
      <PageHeader title="Risk Detection" subtitle="Patterns in procurement data that deserve a second look. An alert is a prompt to review, not a finding about any person or supplier."
        actions={canReview ? <Button onClick={doScan} disabled={scan.pending}>{scan.pending ? "Scanning…" : "Run detection scan"}</Button> : undefined} />
      {scan.error && <Notice tone="error">{scan.error}</Notice>}
      {scanMsg && <Notice tone="success">{scanMsg}</Notice>}
      {unresolved && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Unresolved alerts by severity">
          {SEVERITIES.map((s) => <div key={s} className="rounded-lg border border-line bg-white p-3"><div className="text-2xl font-semibold">{unresolved[s] ?? 0}</div><div className="text-xs text-slate-500">Unresolved {s}</div></div>)}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-3">
        <div><label htmlFor="st" className="mb-1 block text-sm font-medium">Status</label>
          <Select id="st" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option>{["open", "acknowledged", "investigating", "resolved", "dismissed"].map((s) => <option key={s}>{s}</option>)}</Select></div>
        <div><label htmlFor="sv" className="mb-1 block text-sm font-medium">Severity</label>
          <Select id="sv" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}><option value="">All</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</Select></div>
      </div>
      <DataTable columns={columns} data={list.data ?? []} loading={list.loading} error={list.error} onRetry={list.reload} onRowClick={setOpen}
        emptyMessage={canReview ? "No alerts match. Run a detection scan to check current data." : "No alerts match."} pagination={list.pagination} onPage={setPage} />
      {open && <AlertDialog alert={open} canReview={canReview} meId={user?.id ?? null} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function AlertDialog({ alert, canReview, meId, onClose, onChanged }: { alert: RiskAlert; canReview: boolean; meId: string | null; onClose: () => void; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const { pending, error, run } = useAction();
  const next = NEXT_STATUSES[alert.status];
  const submit = (body: Record<string, unknown>) => run(async () => { await apiFetch(`/risk-alerts/${alert._id}/review`, { method: "POST", body: JSON.stringify(body) }); onChanged(); });
  return (
    <Modal title={`${alert.number}: ${alert.title}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2"><Tag tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Tag><Tag tone={STATUS_TONE[alert.status]}>{alert.status}</Tag><Tag tone="bg-slate-100 text-slate-700">{CATEGORY_LABEL[alert.category] ?? alert.category}</Tag></div>
        <section><h3 className="font-medium">Why it was flagged</h3><p>{alert.reason}</p></section>
        <section><h3 className="font-medium">Supporting evidence</h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">{Object.entries(alert.evidence).map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "-")}</dd></div>)}</dl></section>
        <section><h3 className="font-medium">Suggested next step</h3><p>{alert.recommendedAction}</p></section>
        <section><h3 className="font-medium">Affected</h3><p>{[alert.material && `${alert.material.sku ?? ""} ${alert.material.name}`, alert.supplier?.name, alert.reference && `${alert.reference.kind} ${alert.reference.number ?? ""}`].filter(Boolean).join(" · ") || "-"}</p></section>
        <section><h3 className="font-medium">History</h3>
          <ul className="space-y-1">{alert.history.map((h, i) => <li key={i} className="text-xs text-slate-600">{formatDate(h.at, true)}: {h.by} {h.from === h.to ? "noted" : `moved ${h.from || "new"} to ${h.to}`}{h.note ? ` - "${h.note}"` : ""}</li>)}</ul>
          {alert.resolutionNote && <p className="mt-1 text-xs"><strong>Outcome:</strong> {alert.resolutionNote}</p>}</section>
        {canReview && next.length > 0 && (
          <section className="space-y-2 border-t border-line pt-3">
            <Field label="Note (required to resolve or dismiss)" htmlFor="rnote"><Textarea id="rnote" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex flex-wrap gap-2">
              {next.map((s: RiskStatus) => (
                <Button key={s} variant={s === "dismissed" ? "secondary" : "primary"} disabled={pending || (NOTE_REQUIRED.includes(s) && note.trim().length < 5)} onClick={() => submit({ status: s, note })}>{STATUS_LABEL[s]}</Button>
              ))}
              {meId && alert.assignedToName === "" && <Button variant="secondary" disabled={pending} onClick={() => submit({ assignedTo: meId, note })}>Assign to me</Button>}
            </div>
          </section>
        )}
        {!canReview && <Notice tone="info">You can read alerts but only procurement managers and administrators can review them.</Notice>}
      </div>
    </Modal>
  );
}
