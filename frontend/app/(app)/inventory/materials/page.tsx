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
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { money } from "@/lib/utils/format";
import type { Category, Material } from "@/types/procurement";

const num = (label: string) => z.string().regex(/^\d+(\.\d+)?$/, `${label} must be a non-negative number`);
const schema = z.object({
  sku: z.string().trim().min(2, "SKU is required"), name: z.string().trim().min(2, "Name is required"), category: z.string().min(1, "Choose a category"),
  unit: z.string().trim().min(1, "Unit is required"), description: z.string(), technicalSpecs: z.string(),
  minimumStock: num("Minimum stock"), safetyStock: num("Safety stock"), reorderPoint: num("Reorder point"),
  averagePurchasePrice: z.string().refine((v) => v === "" || /^\d+(\.\d{1,4})?$/.test(v), "Enter a valid price (max 4 decimals)"),
  leadTimeDays: z.string().regex(/^\d+$/, "Whole days, 0 if unknown"),
  supplierCapacity: z.string().refine((v) => v === "" || /^\d+(\.\d{1,4})?$/.test(v), "Enter a number (max 4 decimals) or leave empty"),
  active: z.boolean(),
});
type Values = z.infer<typeof schema>;

function MaterialForm({ material, categories, onDone }: { material: Material | null; categories: Category[]; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: material
      ? { sku: material.sku, name: material.name, category: material.category.id, unit: material.unit, description: material.description, technicalSpecs: material.technicalSpecs,
          minimumStock: String(material.minimumStock), safetyStock: String(material.safetyStock), reorderPoint: String(material.reorderPoint),
          averagePurchasePrice: material.averagePurchasePrice ?? "", leadTimeDays: String(material.leadTimeDays ?? 0), supplierCapacity: material.supplierCapacity ?? "", active: material.active }
      : { sku: "", name: "", category: "", unit: "MT", description: "", technicalSpecs: "", minimumStock: "0", safetyStock: "0", reorderPoint: "0", averagePurchasePrice: "", leadTimeDays: "0", supplierCapacity: "", active: true },
  });
  const submit = (v: Values) =>
    run(async () => {
      const body = { ...v, minimumStock: Number(v.minimumStock), safetyStock: Number(v.safetyStock), reorderPoint: Number(v.reorderPoint), averagePurchasePrice: v.averagePurchasePrice === "" ? null : v.averagePurchasePrice, leadTimeDays: Number(v.leadTimeDays), supplierCapacity: v.supplierCapacity === "" ? null : v.supplierCapacity };
      await apiFetch(material ? `/materials/${material.id}` : "/materials", { method: material ? "PATCH" : "POST", body: JSON.stringify(body) });
      onDone();
    });
  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="SKU" htmlFor="sku" error={errors.sku?.message}><Input id="sku" {...register("sku")} /></Field>
      <Field label="Name" htmlFor="name" error={errors.name?.message}><Input id="name" {...register("name")} /></Field>
      <Field label="Category" htmlFor="category" error={errors.category?.message}>
        <Select id="category" {...register("category")}><option value="">Select…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </Field>
      <Field label="Unit of measure" htmlFor="unit" error={errors.unit?.message}><Input id="unit" {...register("unit")} /></Field>
      <Field label="Minimum stock" htmlFor="minimumStock" error={errors.minimumStock?.message}><Input id="minimumStock" {...register("minimumStock")} /></Field>
      <Field label="Safety stock" htmlFor="safetyStock" error={errors.safetyStock?.message}><Input id="safetyStock" {...register("safetyStock")} /></Field>
      <Field label="Reorder point" htmlFor="reorderPoint" error={errors.reorderPoint?.message}><Input id="reorderPoint" {...register("reorderPoint")} /></Field>
      <Field label="Average purchase price (BDT)" htmlFor="averagePurchasePrice" error={errors.averagePurchasePrice?.message} hint="Optional. Used to flag unusually high quotations."><Input id="averagePurchasePrice" {...register("averagePurchasePrice")} /></Field>
      <Field label="Supplier lead time (days)" htmlFor="leadTimeDays" error={errors.leadTimeDays?.message} hint="Used by MRP to time orders. 0 = not set (a default is assumed and flagged)."><Input id="leadTimeDays" {...register("leadTimeDays")} /></Field>
      <Field label="Supplier capacity per order" htmlFor="supplierCapacity" error={errors.supplierCapacity?.message} hint="Optional. MRP warns when a planned order is larger."><Input id="supplierCapacity" {...register("supplierCapacity")} /></Field>
      <div className="sm:col-span-2"><Field label="Technical specifications" htmlFor="technicalSpecs"><Textarea id="technicalSpecs" {...register("technicalSpecs")} /></Field></div>
      <div className="sm:col-span-2"><Field label="Description" htmlFor="description"><Textarea id="description" {...register("description")} /></Field></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...register("active")} /> Active (available for requisitions)</label>
      {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : material ? "Save changes" : "Create material"}</Button>
      </div>
    </form>
  );
}

export default function MaterialCataloguePage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Material | "new" | null>(null);
  const qs = new URLSearchParams({ page: String(page), limit: "15", ...(search ? { search } : {}), ...(category ? { category } : {}) });
  const list = useApi<Material[]>(`/materials?${qs}`);
  const cats = useApi<Category[]>("/material-categories");
  const manage = can("materials:manage");

  const columns = useMemo<ColumnDef<Material>[]>(() => [
    { header: "SKU", accessorKey: "sku", cell: (c) => <span className="font-mono text-xs">{c.getValue<string>()}</span> },
    { header: "Material", accessorKey: "name", cell: (c) => <span className="font-medium">{c.getValue<string>()}</span> },
    { header: "Category", cell: ({ row }) => row.original.category.name ?? "-" },
    { header: "Unit", accessorKey: "unit" },
    { header: "Reorder point", accessorKey: "reorderPoint" },
    { header: "Avg. price", cell: ({ row }) => money(row.original.averagePurchasePrice, row.original.currency) },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.active ? "active" : "inactive"} /> },
  ], []);

  return (
    <>
      <PageHeader title="Material Catalogue" subtitle="Materials available for requisitions and RFQs."
        actions={manage ? <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New material</Button> : undefined} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search name or SKU…" aria-label="Search materials" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          <Select className="max-w-xs" aria-label="Filter by category" value={category} onChange={(e) => { setPage(1); setCategory(e.target.value); }}>
            <option value="">All categories</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload}
          emptyMessage="No materials match your filters." pagination={list.pagination} onPage={setPage} onRowClick={manage ? (m) => setEditing(m) : undefined} />
      </Card>
      {editing && (
        <Modal title={editing === "new" ? "New material" : `Edit ${editing.sku}`} onClose={() => setEditing(null)} wide>
          <MaterialForm material={editing === "new" ? null : editing} categories={cats.data ?? []} onDone={() => { setEditing(null); list.reload(); }} />
        </Modal>
      )}
    </>
  );
}
