"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import type { Supplier } from "@/types/procurement";
import { DocumentsPanel } from "@/features/documents/DocumentsPanel";

const schema = z.object({
  contactPerson: z.string().trim().min(2, "Contact person is required"), email: z.string().min(1, "Email is required").email("Enter a valid email"),
  phone: z.string(), address: z.string(), registrationNumber: z.string(), taxId: z.string(),
  bankName: z.string(), accountName: z.string(), accountNumber: z.string(),
});
type Values = z.infer<typeof schema>;

function ProfileForm({ supplier, onSaved }: { supplier: Supplier; onSaved: () => void }) {
  const { pending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      contactPerson: supplier.contactPerson, email: supplier.email, phone: supplier.phone, address: supplier.address,
      registrationNumber: supplier.registrationNumber, taxId: supplier.taxId,
      bankName: supplier.bankInfo?.bankName ?? "", accountName: supplier.bankInfo?.accountName ?? "", accountNumber: supplier.bankInfo?.accountNumber ?? "",
    },
  });
  const submit = (v: Values) =>
    run(async () => {
      const { bankName, accountName, accountNumber, ...rest } = v;
      await apiFetch("/suppliers/me", { method: "PATCH", body: JSON.stringify({ ...rest, bankInfo: { bankName, accountName, accountNumber } }) });
      setSaved(true);
      onSaved();
    });
  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-3 p-4 sm:grid-cols-2" noValidate>
      <Field label="Contact person" htmlFor="contactPerson" error={errors.contactPerson?.message}><Input id="contactPerson" {...register("contactPerson")} /></Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" {...register("email")} /></Field>
      <Field label="Phone" htmlFor="phone"><Input id="phone" {...register("phone")} /></Field>
      <Field label="Registration number" htmlFor="registrationNumber"><Input id="registrationNumber" {...register("registrationNumber")} /></Field>
      <div className="sm:col-span-2"><Field label="Business address" htmlFor="address"><Input id="address" {...register("address")} /></Field></div>
      <Field label="Tax ID" htmlFor="taxId"><Input id="taxId" {...register("taxId")} /></Field>
      <div />
      <Field label="Bank" htmlFor="bankName"><Input id="bankName" {...register("bankName")} /></Field>
      <Field label="Account name" htmlFor="accountName"><Input id="accountName" {...register("accountName")} /></Field>
      <Field label="Account number" htmlFor="accountNumber"><Input id="accountNumber" {...register("accountNumber")} /></Field>
      <div className="space-y-2 sm:col-span-2">
        {error && <Notice tone="error">{error}</Notice>}
        {saved && !error && <Notice tone="success">Profile saved.</Notice>}
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
      </div>
    </form>
  );
}

export default function SupplierProfilePage() {
  const { data, loading, error, reload } = useApi<Supplier | null>("/suppliers/me");
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState message="Your account is not linked to a supplier record yet. Ask a system administrator to link it." />;
  return (
    <>
      <PageHeader title="My Supplier Profile" subtitle={`${data.companyName} (${data.supplierCode})`} />
      <Card>
        <div className="flex gap-2 border-b border-line px-4 py-3 text-sm">
          Verification: <StatusBadge value={data.verificationStatus} /> Account: <StatusBadge value={data.status} />
          <span className="text-slate-500">Verification and status are managed by procurement.</span>
        </div>
        <ProfileForm supplier={data} onSaved={reload} />
      </Card>
      <div className="mt-4"><DocumentsPanel entityType="supplier" entityId={data.id} title="Registration and compliance documents" /></div>
    </>
  );
}
