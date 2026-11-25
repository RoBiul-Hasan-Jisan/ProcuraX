"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { MrpRunView } from "@/features/planning/MrpRunView";
import { useApi } from "@/hooks/useApi";
import type { MrpRun } from "@/types/planning";

export default function MrpRunPage() {
  const { id } = useParams<{ id: string }>();
  const run = useApi<MrpRun>(`/mrp/runs/${id}`);
  if (run.loading && !run.data) return <LoadingState />;
  if (run.error || !run.data) return <ErrorState message={run.error ?? "Not found"} onRetry={run.reload} />;
  return (
    <>
      <PageHeader title={run.data.number} subtitle="A saved MRP run, shown exactly as it was calculated." actions={<><StatusBadge value={run.data.status} /><Link className="no-print text-sm text-steel-600 underline" href="/planning/mrp">All runs</Link></>} />
      <MrpRunView run={run.data} />
    </>
  );
}
