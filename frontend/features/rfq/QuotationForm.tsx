"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { isDecimal, mul2, pct2, round2, sum2 } from "@/lib/utils/decimal";
import { money, quantity, toDateInput } from "@/lib/utils/format";
import type { Quotation, Rfq } from "@/types/procurement";

const dec = (label: string, positive = false) =>
  z.string().refine((v) => isDecimal(v) && (!positive || Number(v) > 0), positive ? `${label} must be greater than zero` : `${label} must be a non-negative number`);

const schema = z.object({
  prices: z.array(z.object({ unitPrice: dec("Unit price", true) })),
  transportCost: dec("Transportation cost"), additionalCharges: dec("Additional charges"),
  taxRatePercent: dec("Tax rate").refine((v) => Number(v) <= 100, "Tax rate cannot exceed 100"),
  deliveryDays: z.string().regex(/^\d{1,3}$/, "Enter whole days").refine((v) => Number(v) >= 1, "At least 1 day"),
  paymentTerms: z.string().trim().min(2, "Payment terms are required"),
  paymentTermsDays: z.string().regex(/^\d{1,3}$/, "Enter whole days (0-365)"),
  validUntil: z.string().min(1, "Validity date is required").refine((v) => new Date(v).getTime() > Date.now(), "Validity must be in the future"),
  notes: z.string(),
});
type Values = z.infer<typeof schema>;

export function QuotationForm({ rfq, existing, onSaved }: { rfq: Rfq; existing: Quotation | null; onSaved: () => void }) {
  const { pending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const priceOf = (materialId: string) => existing?.lines.find((l) => l.materialId === materialId)?.unitPrice ?? "";
  const { register, control, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      prices: rfq.items.map((i) => ({ unitPrice: priceOf(i.materialId) })),
      transportCost: existing?.transportCost ?? "0", additionalCharges: existing?.additionalCharges ?? "0", taxRatePercent: existing?.taxRatePercent ?? "0",
      deliveryDays: String(existing?.deliveryDays ?? ""), paymentTerms: existing?.paymentTerms ?? rfq.paymentTerms, paymentTermsDays: String(existing?.paymentTermsDays ?? 30),
      validUntil: existing ? toDateInput(existing.validUntil) : "", notes: existing?.notes ?? "",
    },
  });
  const w = useWatch({ control });
  const lineTotals = rfq.items.map((i, idx) => mul2(i.quantity, w.prices?.[idx]?.unitPrice ?? ""));
  const material = sum2(lineTotals);
  const transport = round2(w.transportCost ?? "") ?? "0.00";
  const additional = round2(w.additionalCharges ?? "") ?? "0.00";
  const tax = pct2(material, w.taxRatePercent ?? "") ?? "0.00";
  const total = sum2([material, transport, additional, tax]);

  const submit = (v: Values) => run(async () => {
    const body = {
      lines: rfq.items.map((i, idx) => ({ materialId: i.materialId, unitPrice: v.prices[idx].unitPrice })),
      transportCost: v.transportCost, additionalCharges: v.additionalCharges, taxRatePercent: v.taxRatePercent,
      deliveryDays: Number(v.deliveryDays), paymentTerms: v.paymentTerms, paymentTermsDays: Number(v.paymentTermsDays),
      validUntil: `${v.validUntil}T23:59:59.000Z`, notes: v.notes,
    };
    await apiFetch(`/rfqs/${rfq.id}/quotation`, { method: "PUT", body: JSON.stringify(body) });
    setSaved(true);
    onSaved();
  });
  const withdraw = () => run(async () => { await apiFetch(`/rfqs/${rfq.id}/quotation`, { method: "DELETE" }); onSaved(); });

  return (
    <Card>
      <CardHeader title={existing ? "Your quotation (you can revise it until the deadline)" : "Submit your quotation"} />
      <form onSubmit={handleSubmit(submit)} className="space-y-4 p-4" noValidate>
        <p className="text-xs text-slate-500">Your quotation is confidential. Other suppliers cannot see it. Quantities are fixed by the RFQ; you set the prices.</p>
        <div className="space-y-2">
          {rfq.items.map((i, idx) => (
            <div key={i.materialId} className="grid items-start gap-3 rounded border border-line p-3 sm:grid-cols-[2fr_1fr_1fr]">
              <div><div className="text-sm font-medium">{i.materialName}</div><div className="text-xs text-slate-500">{quantity(i.quantity)} {i.unit}</div></div>
              <Field label="Unit price (BDT)" htmlFor={`price-${idx}`} error={errors.prices?.[idx]?.unitPrice?.message}><Input id={`price-${idx}`} inputMode="decimal" {...register(`prices.${idx}.unitPrice`)} /></Field>
              <div><div className="mb-1 text-sm font-medium">Line total</div><div className="flex h-10 items-center text-sm">{lineTotals[idx] ? money(lineTotals[idx]) : "-"}</div></div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Transportation cost" htmlFor="transportCost" error={errors.transportCost?.message}><Input id="transportCost" inputMode="decimal" {...register("transportCost")} /></Field>
          <Field label="Additional charges" htmlFor="additionalCharges" error={errors.additionalCharges?.message}><Input id="additionalCharges" inputMode="decimal" {...register("additionalCharges")} /></Field>
          <Field label="Tax rate (%)" htmlFor="taxRatePercent" error={errors.taxRatePercent?.message}><Input id="taxRatePercent" inputMode="decimal" {...register("taxRatePercent")} /></Field>
          <Field label="Delivery time (days)" htmlFor="deliveryDays" error={errors.deliveryDays?.message}><Input id="deliveryDays" inputMode="numeric" {...register("deliveryDays")} /></Field>
          <Field label="Payment terms" htmlFor="paymentTerms" error={errors.paymentTerms?.message}><Input id="paymentTerms" {...register("paymentTerms")} /></Field>
          <Field label="Credit days offered" htmlFor="paymentTermsDays" error={errors.paymentTermsDays?.message}><Input id="paymentTermsDays" inputMode="numeric" {...register("paymentTermsDays")} /></Field>
          <Field label="Quotation valid until" htmlFor="validUntil" error={errors.validUntil?.message}><Input id="validUntil" type="date" {...register("validUntil")} /></Field>
          <div className="sm:col-span-2"><Field label="Notes" htmlFor="notes"><Input id="notes" {...register("notes")} /></Field></div>
        </div>
        <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 rounded border border-line bg-surface p-3 text-sm">
          <dt>Material cost</dt><dd className="text-right">{money(material)}</dd>
          <dt>Transportation</dt><dd className="text-right">{money(transport)}</dd>
          <dt>Additional charges</dt><dd className="text-right">{money(additional)}</dd>
          <dt>Taxes</dt><dd className="text-right">{money(tax)}</dd>
          <dt className="font-semibold">Total landed cost</dt><dd className="text-right font-semibold">{money(total)}</dd>
        </dl>
        {error && <Notice tone="error">{error}</Notice>}
        {saved && !error && <Notice tone="success">Quotation saved. You can still revise it until the deadline.</Notice>}
        <div className="flex justify-end gap-2">
          {existing && existing.status === "submitted" && <Button type="button" variant="secondary" disabled={pending} onClick={() => void withdraw()}>Withdraw</Button>}
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : existing ? "Update quotation" : "Submit quotation"}</Button>
        </div>
      </form>
    </Card>
  );
}
