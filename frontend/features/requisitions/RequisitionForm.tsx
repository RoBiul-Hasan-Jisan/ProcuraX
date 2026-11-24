"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { isDecimal, mul2, sum2 } from "@/lib/utils/decimal";
import { money, toDateInput } from "@/lib/utils/format";
import type { Material, Requisition } from "@/types/procurement";

export const requisitionSchema = z.object({
  items: z.array(z.object({
    materialId: z.string().min(1, "Choose a material"),
    quantity: z.string().refine((v) => isDecimal(v) && Number(v) > 0, "Enter a quantity greater than zero"),
    estimatedUnitPrice: z.string().refine((v) => isDecimal(v), "Enter a valid price"),
  })).min(1, "Add at least one material")
    .refine((rows) => new Set(rows.map((r) => r.materialId)).size === rows.length, "Each material can appear only once"),
  requiredDate: z.string().min(1, "Required date is required").refine((v) => new Date(v).getTime() > Date.now(), "Required date must be in the future"),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]),
  reason: z.string().trim().min(5, "Please give a reason (at least 5 characters)"),
});
export type RequisitionValues = z.infer<typeof requisitionSchema>;

export function RequisitionForm({ requisition }: { requisition?: Requisition }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const materials = useApi<Material[]>("/materials?limit=100&active=true");
  const byId = useMemo(() => new Map((materials.data ?? []).map((m) => [m.id, m])), [materials.data]);

  const { register, control, handleSubmit, setValue, getValues, formState: { errors } } = useForm<RequisitionValues>({
    resolver: zodResolver(requisitionSchema),
    defaultValues: requisition
      ? { items: requisition.items.map((i) => ({ materialId: i.materialId, quantity: i.quantity, estimatedUnitPrice: i.estimatedUnitPrice })),
          requiredDate: toDateInput(requisition.requiredDate), priority: requisition.priority as RequisitionValues["priority"], reason: requisition.reason }
      : { items: [{ materialId: "", quantity: "", estimatedUnitPrice: "" }], requiredDate: "", priority: "Medium", reason: "" },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const watched = useWatch({ control, name: "items" });
  const lineTotals = (watched ?? []).map((r) => mul2(r?.quantity ?? "", r?.estimatedUnitPrice ?? ""));
  const total = sum2(lineTotals);

  const save = (andSubmit: boolean) => (v: RequisitionValues) =>
    run(async () => {
      const body = JSON.stringify({ ...v, requiredDate: `${v.requiredDate}T00:00:00.000Z` });
      const saved = requisition
        ? await apiFetch<Requisition>(`/requisitions/${requisition.id}`, { method: "PATCH", body })
        : await apiFetch<Requisition>("/requisitions", { method: "POST", body });
      if (andSubmit) await apiFetch(`/requisitions/${saved.data.id}/submit`, { method: "POST", body: "{}" });
      router.push(`/procurement/requisitions/${saved.data.id}`);
    });

  const pickMaterial = (index: number, id: string) => {
    const m = byId.get(id);
    if (m?.averagePurchasePrice && !getValues(`items.${index}.estimatedUnitPrice`)) {
      setValue(`items.${index}.estimatedUnitPrice`, m.averagePurchasePrice.replace(/\.?0+$/, "") || "0");
    }
  };

  return (
    <form noValidate className="space-y-4">
      <Card>
        <CardHeader title="Materials" action={<Button type="button" variant="secondary" size="sm" onClick={() => append({ materialId: "", quantity: "", estimatedUnitPrice: "" })}><Plus className="h-3.5 w-3.5" /> Add line</Button>} />
        <div className="space-y-3 p-4">
          {fields.map((f, i) => {
            const m = byId.get(watched?.[i]?.materialId ?? "");
            const e = errors.items?.[i];
            return (
              <div key={f.id} className="grid items-start gap-3 rounded border border-line p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <Field label="Material" htmlFor={`m-${i}`} error={e?.materialId?.message}>
                  <Select id={`m-${i}`} {...register(`items.${i}.materialId`, { onChange: (ev) => pickMaterial(i, ev.target.value) })}>
                    <option value="">Select…</option>
                    {(materials.data ?? []).map((mm) => <option key={mm.id} value={mm.id}>{mm.sku} · {mm.name}</option>)}
                  </Select>
                </Field>
                <Field label={`Quantity${m ? ` (${m.unit})` : ""}`} htmlFor={`q-${i}`} error={e?.quantity?.message}><Input id={`q-${i}`} inputMode="decimal" {...register(`items.${i}.quantity`)} /></Field>
                <Field label="Est. unit price" htmlFor={`p-${i}`} error={e?.estimatedUnitPrice?.message}><Input id={`p-${i}`} inputMode="decimal" {...register(`items.${i}.estimatedUnitPrice`)} /></Field>
                <div><div className="mb-1 text-sm font-medium">Line total</div><div className="flex h-10 items-center text-sm">{lineTotals[i] ? money(lineTotals[i]) : "-"}</div></div>
                <Button type="button" variant="ghost" size="icon" className="mt-6" aria-label={`Remove line ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          {errors.items?.root?.message && <p role="alert" className="text-xs text-danger">{errors.items.root.message}</p>}
          {errors.items?.message && <p role="alert" className="text-xs text-danger">{errors.items.message}</p>}
          <div className="flex justify-end text-sm"><span className="mr-2 text-slate-500">Estimated total</span><strong>{money(total)}</strong></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Request details" />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Required delivery date" htmlFor="requiredDate" error={errors.requiredDate?.message}><Input id="requiredDate" type="date" {...register("requiredDate")} /></Field>
          <Field label="Priority" htmlFor="priority"><Select id="priority" {...register("priority")}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></Select></Field>
          <div className="sm:col-span-2"><Field label="Reason for purchase" htmlFor="reason" error={errors.reason?.message}><Textarea id="reason" {...register("reason")} /></Field></div>
        </div>
      </Card>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={handleSubmit(save(false))}>Save as draft</Button>
        <Button type="button" disabled={pending} onClick={handleSubmit(save(true))}>{pending ? "Saving…" : "Save and submit for approval"}</Button>
      </div>
    </form>
  );
}
