"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { money, toDateTimeInput } from "@/lib/utils/format";
import type { Requisition, Rfq, Supplier } from "@/types/procurement";

const schema = z.object({
  requisitionId: z.string().min(1, "Choose an approved requisition"),
  deliveryLocation: z.string().trim().min(2, "Delivery location is required"),
  deadline: z.string().min(1, "Deadline is required").refine((v) => new Date(v).getTime() > Date.now(), "Deadline must be in the future"),
  paymentTerms: z.string().trim().min(2, "Required"),
  deliveryRequirements: z.string(),
  invitedSupplierIds: z.array(z.string()).min(1, "Invite at least one supplier"),
});
type Values = z.infer<typeof schema>;

export function CreateRfqDialog({ initialRequisitionId, onClose, onCreated }: { initialRequisitionId?: string; onClose: () => void; onCreated: (rfq: Rfq) => void }) {
  const approved = useApi<Requisition[]>("/requisitions?status=Approved&limit=100");
  const suppliers = useApi<Supplier[]>("/suppliers?status=active&verification=verified&limit=100");
  const { pending, error, run } = useAction();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      requisitionId: initialRequisitionId ?? "", deliveryLocation: "Main raw-material yard", paymentTerms: "Net 30", deliveryRequirements: "",
      deadline: toDateTimeInput(new Date(Date.now() + 7 * 864e5)), invitedSupplierIds: [],
    },
  });
  const chosen = approved.data?.find((r) => r.id === watch("requisitionId"));
  const invitedCount = watch("invitedSupplierIds")?.length ?? 0;

  const submit = (v: Values) => run(async () => {
    const res = await apiFetch<Rfq>("/rfqs", { method: "POST", body: JSON.stringify({ ...v, deadline: new Date(v.deadline).toISOString() }) });
    onCreated(res.data);
  });

  return (
    <Modal title="Create RFQ" onClose={onClose} wide>
      <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="Approved requisition" htmlFor="requisitionId" error={errors.requisitionId?.message}>
            <Select id="requisitionId" {...register("requisitionId")}>
              <option value="">Select…</option>
              {(approved.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.number} · {r.items.map((i) => i.materialName).join(", ").slice(0, 60)} · {money(r.estimatedTotal, r.currency)}</option>)}
            </Select>
          </Field>
          {approved.data?.length === 0 && <p className="mt-1 text-xs text-slate-500">No approved requisitions are waiting for an RFQ.</p>}
          {chosen && <p className="mt-1 text-xs text-slate-500">{chosen.items.map((i) => `${i.materialName} x ${i.quantity} ${i.unit}`).join(" · ")}</p>}
        </div>
        <Field label="Delivery location" htmlFor="deliveryLocation" error={errors.deliveryLocation?.message}><Input id="deliveryLocation" {...register("deliveryLocation")} /></Field>
        <Field label="Submission deadline" htmlFor="deadline" error={errors.deadline?.message}><Input id="deadline" type="datetime-local" {...register("deadline")} /></Field>
        <Field label="Payment terms" htmlFor="paymentTerms" error={errors.paymentTerms?.message}><Input id="paymentTerms" {...register("paymentTerms")} /></Field>
        <div className="sm:col-span-2"><Field label="Delivery requirements" htmlFor="deliveryRequirements"><Textarea id="deliveryRequirements" {...register("deliveryRequirements")} /></Field></div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Invite suppliers <span className="font-normal text-slate-500">({invitedCount} selected; only active, verified suppliers are listed)</span></legend>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded border border-line p-2 sm:grid-cols-2">
            {(suppliers.data ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" value={s.id} {...register("invitedSupplierIds")} /> {s.companyName}
                <span className="text-xs text-slate-400">{s.history.completedOrders < 5 ? "limited history" : `${s.history.onTimeRate ?? "-"}% on time`}</span></label>
            ))}
            {suppliers.data?.length === 0 && <span className="text-sm text-slate-500">No eligible suppliers.</span>}
          </div>
          {errors.invitedSupplierIds?.message && <p role="alert" className="mt-1 text-xs text-danger">{errors.invitedSupplierIds.message}</p>}
          {invitedCount === 1 && <p className="mt-1 text-xs text-warn">Inviting a single supplier limits price competition.</p>}
        </fieldset>
        {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create and publish RFQ"}</Button>
        </div>
      </form>
    </Modal>
  );
}
