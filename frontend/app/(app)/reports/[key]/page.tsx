"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ReportTable } from "@/features/reports/ReportTable";
import { useApi } from "@/hooks/useApi";
import { apiBlob, saveBlob } from "@/lib/api/client";
import { FILTER_LABEL } from "@/lib/utils/operations";
import { formatDate } from "@/lib/utils/format";
import type { FilterOptions, ReportDef, ReportFilterKey, ReportResult } from "@/types/operations";

const OPTION_KEY: Partial<Record<ReportFilterKey, keyof FilterOptions>> = { departmentId: "departments", supplierId: "suppliers", materialId: "materials", categoryId: "categories", warehouseId: "warehouses" };

export default function ReportPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const catalogue = useApi<ReportDef[]>("/reports");
  const options = useApi<FilterOptions>("/reports/filter-options");
  const def = catalogue.data?.find((r) => r.key === key) ?? null;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const qs = useMemo(() => new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString(), [applied]);
  const report = useApi<ReportResult>(def ? `/reports/${key}${qs ? `?${qs}` : ""}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const dateError = draft.from && draft.to && draft.from > draft.to ? "The start date must not be after the end date." : null;

  const doExport = async (format: "csv" | "xlsx" | "pdf") => {
    setBusy(format); setExportError(null);
    try {
      const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)), format });
      const { blob, filename } = await apiBlob(`/reports/${key}/export?${q}`);
      saveBlob(blob, filename ?? `${key}.${format}`);
    } catch (e) { setExportError(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(null); }
  };

  if (catalogue.loading && !catalogue.data) return <LoadingState />;
  if (catalogue.error && !catalogue.data) return <ErrorState message={catalogue.error} onRetry={catalogue.reload} />;
  if (!def) return <><Link href="/reports" className="text-sm text-steel-600 hover:underline">← All reports</Link><EmptyState message="This report does not exist or your role cannot open it." /></>;

  const r = report.data;
  return (
    <>
      <Link href="/reports" className="text-sm text-steel-600 hover:underline">← All reports</Link>
      <PageHeader title={def.title} subtitle={def.description}
        actions={<>{(["csv", "xlsx", "pdf"] as const).map((f) => <Button key={f} variant="secondary" size="sm" disabled={busy !== null || !r || r.rows.length === 0} onClick={() => void doExport(f)}><Download className="mr-1 h-3.5 w-3.5" />{busy === f ? "Preparing…" : f === "xlsx" ? "Excel" : f.toUpperCase()}</Button>)}</>} />
      <form className="mb-4 grid gap-3 rounded-lg border border-line bg-white p-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); if (!dateError) setApplied(draft); }}>
        {def.filters.map((f) => {
          const opts = OPTION_KEY[f] ? (options.data?.[OPTION_KEY[f]!] as { id: string; name: string }[] | undefined) : undefined;
          return (
            <Field key={f} label={FILTER_LABEL[f] ?? f} htmlFor={`f-${f}`}>
              {f === "from" || f === "to" ? <Input id={`f-${f}`} type="date" value={draft[f] ?? ""} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                : f === "poStatus" ? <Select id={`f-${f}`} value={draft[f] ?? ""} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}><option value="">Default</option>{(options.data?.poStatuses ?? []).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
                : <Select id={`f-${f}`} value={draft[f] ?? ""} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}><option value="">All</option>{(opts ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
            </Field>
          );
        })}
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={!!dateError}>Apply filters</Button>
          <Button type="button" variant="secondary" onClick={() => { setDraft({}); setApplied({}); }}>Clear</Button>
          {dateError && <span role="alert" className="text-xs text-danger">{dateError}</span>}
        </div>
      </form>
      {exportError && <Notice tone="error">{exportError}</Notice>}
      {report.loading && !r && <LoadingState label="Running report…" />}
      {report.error && !r && <ErrorState message={report.error} onRetry={report.reload} />}
      {r && (
        <div className={report.loading ? "opacity-60" : undefined}>
          <p className="mb-2 text-xs text-slate-500">{r.rows.length} row(s) · generated {formatDate(r.generatedAt, true)}{r.truncated ? " · truncated, narrow the filters" : ""}</p>
          {r.rows.length === 0 && r.columns.length > 0 ? <EmptyState message="No data matches these filters." /> : <ReportTable result={r} />}
          {r.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
    </>
  );
}
