"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { RequisitionForm } from "@/features/requisitions/RequisitionForm";
import { useApi } from "@/hooks/useApi";
import type { Requisition } from "@/types/procurement";

export default function EditRequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useApi<Requisition>(`/requisitions/${id}`);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Requisition not found"} onRetry={reload} />;
  if (data.status !== "Draft" && data.status !== "Modification Requested") {
    return <ErrorState message={`A requisition in status "${data.status}" cannot be edited.`} />;
  }
  return (
    <>
      <PageHeader title={`Edit ${data.number}`} subtitle={data.status === "Modification Requested" ? "Address the reviewer's comments, then resubmit." : undefined} />
      <RequisitionForm requisition={data} />
    </>
  );
}
