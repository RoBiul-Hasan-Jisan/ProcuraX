"use client";

import { FileBarChart, Lock } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useApi } from "@/hooks/useApi";
import type { ReportDef } from "@/types/operations";

export default function ReportsPage() {
  const list = useApi<ReportDef[]>("/reports");
  return (
    <>
      <PageHeader title="Reports" subtitle="Filter, review on screen, and export as CSV, Excel or PDF. You only see reports your role may open." />
      {list.loading && !list.data && <LoadingState />}
      {list.error && !list.data && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <EmptyState message="No reports are available for your role." />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((r) => (
          <Link key={r.key} href={`/reports/${r.key}`} className="rounded-lg border border-line bg-white p-4 hover:border-steel-500">
            <div className="flex items-center gap-2 font-semibold text-navy-900"><FileBarChart className="h-4 w-4 text-steel-600" />{r.title}{r.financial && <Lock aria-label="Financial report" className="h-3.5 w-3.5 text-slate-400" />}</div>
            <p className="mt-1 text-sm text-slate-600">{r.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
