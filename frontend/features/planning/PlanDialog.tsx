"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { toDateInput } from "@/lib/utils/format";
import type { FinishedProduct, ProductionPlan } from "@/types/planning";

/** Create or edit a production plan. Only planned/confirmed plans are editable (the server enforces this too). */
export function PlanDialog({ plan, onClose, onDone }: { plan: ProductionPlan | null; onClose: () => void; onDone: () => void }) {
  const products = useApi<FinishedProduct[]>("/finished-products?active=true");
  const { pending, error, run } = useAction();
  const [productId, setProductId] = useState(plan?.product.id ?? "");
  const [quantity, setQuantity] = useState(plan ? String(Number(plan.quantity)) : "");
  const [startDate, setStart] = useState(plan ? toDateInput(plan.startDate) : "");
  const [endDate, setEnd] = useState(plan ? toDateInput(plan.endDate) : "");
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [touched, setTouched] = useState(false);
  const unit = products.data?.find((p) => p.id === productId)?.unit ?? plan?.unit ?? "";

  const problems: string[] = [];
  if (!productId) problems.push("Choose a finished product");
  if (!/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) problems.push("Enter a production quantity greater than zero (max 3 decimals)");
  if (!startDate) problems.push("Set the production start date");
  if (!endDate) problems.push("Set the expected completion date");
  if (startDate && endDate && endDate < startDate) problems.push("The completion date cannot be before the start date");

  const submit = () => {
    setTouched(true);
    if (problems.length) return;
    void run(async () => {
      await apiFetch(plan ? `/production-plans/${plan.id}` : "/production-plans", { method: plan ? "PUT" : "POST", body: JSON.stringify({ productId, quantity, startDate, endDate, notes }) });
      onDone();
    });
  };
  return (
    <Modal title={plan ? `Edit ${plan.number}` : "New production plan"} onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Finished product" htmlFor="pp-product">
          <Select id="pp-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </Select>
        </Field>
        <Field label={`Production quantity${unit ? ` (${unit})` : ""}`} htmlFor="pp-qty"><Input id="pp-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date (materials needed)" htmlFor="pp-start"><Input id="pp-start" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Expected completion" htmlFor="pp-end"><Input id="pp-end" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Notes" htmlFor="pp-notes"><Textarea id="pp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {touched && problems.length > 0 && <Notice tone="error">{problems[0]}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit}>{pending ? "Saving…" : "Save plan"}</Button></div>
      </div>
    </Modal>
  );
}
