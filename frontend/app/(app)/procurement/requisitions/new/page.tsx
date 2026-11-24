"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { RequisitionForm } from "@/features/requisitions/RequisitionForm";

export default function NewRequisitionPage() {
  const { can, user } = useAuth();
  if (!can("requisitions:create")) return <ErrorState message="You do not have permission to create requisitions." />;
  return (
    <>
      <PageHeader title="New Purchase Requisition" subtitle="Saved as a draft until you submit it for approval." />
      {!user?.departmentId && <p role="alert" className="mb-3 rounded bg-amber-50 p-2 text-sm text-warn">Your account has no department yet. Ask an administrator to assign one before you submit.</p>}
      <RequisitionForm />
    </>
  );
}
