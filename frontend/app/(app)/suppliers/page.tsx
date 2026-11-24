"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Notice, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import type { Category, Supplier } from "@/types/procurement";

const schema = z.object({
  companyName: z.string().trim().min(2, "Company name is required"), contactPerson: z.string().trim().min(2, "Contact person is required"),
  email: z.string().min(1, "Email is required").email("Enter a valid email"), phone: z.string(), address: z.string(),
  registrationNumber: z.string(), taxId: z.string(), paymentTerms: z.string().min(2, "Required"),
  paymentTermsDays: z.string().regex(/^\d{1,3}$/, "Enter whole days (0-365)"),
  verificationStatus: z.enum(["pending", "verified", "rejected"]), status: z.enum(["active", "inactive", "blocked"]),
  materialCategories: z.array(z.string()),
  bankName: z.string(), accountName: z.string(), accountNumber: z.string(),
});
type Values = z.infer<typeof schema>;

function SupplierForm({ supplier, categories, onDone }: { supplier: Supplier | null; categories: Category[]; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: supplier?.companyName ?? "", contactPerson: supplier?.contactPerson ?? "", email: supplier?.email ?? "", phone: supplier?.phone ?? "",
      address: supplier?.address ?? "", registrationNumber: supplier?.registrationNumber ?? "", taxId: supplier?.taxId ?? "",
      paymentTerms: supplier?.paymentTerms ?? "Net 30", paymentTermsDays: String(supplier?.paymentTermsDays ?? 30),
      verificationStatus: (supplier?.verificationStatus as Values["verificationStatus"]) ?? "pending", status: (supplier?.status as Values["status"]) ?? "active",
      materialCategories: supplier?.materialCategories.map((c) => c.id) ?? [],
      bankName: supplier?.bankInfo?.bankName ?? "", accountName: supplier?.bankInfo?.accountName ?? "", accountNumber: supplier?.bankInfo?.accountNumber ?? "",
    },
  });
  const submit = (v: Values) =>
    run(async () => {
      const { bankName, accountName, accountNumber, paymentTermsDays, ...rest } = v;
      const body = { ...rest, paymentTermsDays: Number(paymentTermsDays), bankInfo: { bankName, accountName, accountNumber } };
      await apiFetch(supplier ? `/suppliers/${supplier.id}` : "/suppliers", { method: supplier ? "PATCH" : "POST", body: JSON.stringify(body) });
      onDone();
    });
  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="Company name" htmlFor="companyName" error={errors.companyName?.message}><Input id="companyName" {...register("companyName")} /></Field>
      <Field label="Contact person" htmlFor="contactPerson" error={errors.contactPerson?.message}><Input id="contactPerson" {...register("contactPerson")} /></Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" {...register("email")} /></Field>
      <Field label="Phone" htmlFor="phone"><Input id="phone" {...register("phone")} /></Field>
      <div className="sm:col-span-2"><Field label="Business address" htmlFor="address"><Input id="address" {...register("address")} /></Field></div>
      <Field label="Registration number" htmlFor="registrationNumber"><Input id="registrationNumber" {...register("registrationNumber")} /></Field>
      <Field label="Tax ID" htmlFor="taxId"><Input id="taxId" {...register("taxId")} /></Field>
      <Field label="Payment terms" htmlFor="paymentTerms" error={errors.paymentTerms?.message}><Input id="paymentTerms" {...register("paymentTerms")} /></Field>
      <Field label="Credit days" htmlFor="paymentTermsDays" error={errors.paymentTermsDays?.message}><Input id="paymentTermsDays" {...register("paymentTermsDays")} /></Field>
      <Field label="Verification" htmlFor="verificationStatus"><Select id="verificationStatus" {...register("verificationStatus")}><option value="pending">Pending</option><option value="verified">Verified</option><option value="rejected">Rejected</option></Select></Field>
      <Field label="Account status" htmlFor="status"><Select id="status" {...register("status")}><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></Select></Field>
      <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-medium">Material categories</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{categories.map((c) => (
          <label key={c.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" value={c.id} {...register("materialCategories")} /> {c.name}</label>
        ))}</div>
      </fieldset>
      <fieldset className="grid gap-3 rounded border border-line p-3 sm:col-span-2 sm:grid-cols-3"><legend className="px-1 text-sm font-medium">Bank details (restricted)</legend>
        <Field label="Bank" htmlFor="bankName"><Input id="bankName" {...register("bankName")} /></Field>
        <Field label="Account name" htmlFor="accountName"><Input id="accountName" {...register("accountName")} /></Field>
        <Field label="Account number" htmlFor="accountNumber"><Input id="accountNumber" {...register("accountNumber")} /></Field>
      </fieldset>
      {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : supplier ? "Save changes" : "Create supplier"}</Button>
      </div>
    </form>
  );
}

function Rate({ value }: { value: number | null }) {
  return <>{value === null ? <span className="text-slate-400">No history</span> : `${value.toFixed(1)}%`}</>;
}

function SupplierDetail({ supplier, canManage, onEdit }: { supplier: Supplier; canManage: boolean; onEdit: () => void }) {
  const h = supplier.history;
  const unproven = h.completedOrders < 5;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><div className="text-xs text-slate-500">Code</div>{supplier.supplierCode}</div>
        <div><div className="text-xs text-slate-500">Status</div><StatusBadge value={supplier.status} /> <StatusBadge value={supplier.verificationStatus} /></div>
        <div><div className="text-xs text-slate-500">Contact</div>{supplier.contactPerson} · {supplier.email} · {supplier.phone || "-"}</div>
        <div><div className="text-xs text-slate-500">Payment terms</div>{supplier.paymentTerms} ({supplier.paymentTermsDays} days)</div>
        <div className="sm:col-span-2"><div className="text-xs text-slate-500">Address</div>{supplier.address || "-"}</div>
        <div className="sm:col-span-2"><div className="text-xs text-slate-500">Categories</div>{supplier.materialCategories.map((c) => c.name).join(", ") || "-"}</div>
      </div>
      <div className="rounded border border-line p-3">
        <div className="mb-2 font-medium text-navy-900">Recorded performance</div>
        <div className="grid grid-cols-3 gap-2">
          <div><div className="text-xs text-slate-500">Completed orders</div>{h.completedOrders}</div>
          <div><div className="text-xs text-slate-500">On-time delivery</div><Rate value={h.onTimeRate} /></div>
          <div><div className="text-xs text-slate-500">Quality acceptance</div><Rate value={h.qualityAcceptanceRate} /></div>
        </div>
        {unproven && <p className="mt-2 text-xs text-warn">Fewer than 5 completed orders: reliability is not yet proven and is scored neutrally.</p>}
      </div>
      {supplier.bankInfo && (
        <div className="rounded border border-line p-3"><div className="mb-1 font-medium text-navy-900">Bank details</div>
          {supplier.bankInfo.bankName || "-"} · {supplier.bankInfo.accountName || "-"} · {supplier.bankInfo.accountNumber || "-"}</div>
      )}
      {canManage && <div className="flex justify-end"><Button onClick={onEdit}>Edit supplier</Button></div>}
    </div>
  );
}

export default function SupplierDirectoryPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const qs = new URLSearchParams({ page: String(page), limit: "15", ...(search ? { search } : {}), ...(status ? { status } : {}) });
  const list = useApi<Supplier[]>(`/suppliers?${qs}`);
  const cats = useApi<Category[]>(can("materials:view", "materials:manage") ? "/material-categories" : null);
  const manage = can("suppliers:manage");

  const columns = useMemo<ColumnDef<Supplier>[]>(() => [
    { header: "Code", accessorKey: "supplierCode", cell: (c) => <span className="font-mono text-xs">{c.getValue<string>()}</span> },
    { header: "Company", accessorKey: "companyName", cell: (c) => <span className="font-medium">{c.getValue<string>()}</span> },
    { header: "Contact", accessorKey: "contactPerson" },
    { header: "On-time", cell: ({ row }) => <Rate value={row.original.history.onTimeRate} /> },
    { header: "Quality", cell: ({ row }) => <Rate value={row.original.history.qualityAcceptanceRate} /> },
    { header: "Verification", cell: ({ row }) => <StatusBadge value={row.original.verificationStatus} /> },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.status} /> },
  ], []);

  return (
    <>
      <PageHeader title="Supplier Directory" subtitle="Registered suppliers with recorded delivery and quality history."
        actions={manage ? <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New supplier</Button> : undefined} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search name or code…" aria-label="Search suppliers" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          <Select className="max-w-xs" aria-label="Filter by status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option>
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage="No suppliers match your filters." pagination={list.pagination} onPage={setPage} onRowClick={setSelected} />
      </Card>
      {selected && !editing && (
        <Modal title={selected.companyName} onClose={() => setSelected(null)} wide>
          <SupplierDetail supplier={selected} canManage={manage} onEdit={() => setEditing(selected)} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing === "new" ? "New supplier" : `Edit ${editing.companyName}`} onClose={() => setEditing(null)} wide>
          <SupplierForm supplier={editing === "new" ? null : editing} categories={cats.data ?? []} onDone={() => { setEditing(null); setSelected(null); list.reload(); }} />
        </Modal>
      )}
    </>
  );
}
