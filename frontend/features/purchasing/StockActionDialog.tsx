"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { cmp, isDecimal } from "@/lib/utils/decimal";
import type { StockRow, Warehouse } from "@/types/purchasing";

export type StockAction = "issue" | "adjust" | "transfer";
const TITLES: Record<StockAction, string> = { issue: "Issue stock (consumption)", adjust: "Stock adjustment", transfer: "Transfer between warehouses" };

/** Manual stock operations. Every one is a ledger movement with a mandatory reason; the server blocks negative stock. */
export function StockActionDialog({ action, row, onClose, onDone }: { action: StockAction; row: StockRow; onClose: () => void; onDone: () => void }) {
  const warehouses = useApi<Warehouse[]>("/warehouses");
  const { pending, error, run } = useAction();
  const [wh, setWh] = useState(row.byWarehouse[0]?.warehouseId ?? "");
  const [to, setTo] = useState("");
  const [direction, setDirection] = useState<"increase" | "decrease">("decrease");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const active = (warehouses.data ?? []).filter((w) => w.active);
  const held = row.byWarehouse.find((b) => b.warehouseId === wh)?.quantity ?? "0";

  const problems: string[] = [];
  if (!wh) problems.push("Choose a warehouse");
  if (action === "transfer" && (!to || to === wh)) problems.push("Choose a different destination warehouse");
  if (!isDecimal(qty) || cmp(qty, "0") <= 0) problems.push("Enter a quantity greater than zero (max 4 decimals)");
  else if ((action === "issue" || action === "transfer" || (action === "adjust" && direction === "decrease")) && cmp(qty, held) > 0) problems.push(`Only ${held} ${row.unit} is held in that warehouse`);
  if (reason.trim().length < (action === "adjust" ? 5 : 3)) problems.push("A reason is required");

  const submit = () => {
    setTouched(true);
    if (problems.length) return;
    void run(async () => {
      const base = { materialId: row.materialId, quantity: qty, reason: reason.trim() };
      if (action === "issue") await apiFetch("/stock/issues", { method: "POST", body: JSON.stringify({ ...base, warehouseId: wh }) });
      if (action === "adjust") await apiFetch("/stock/adjustments", { method: "POST", body: JSON.stringify({ ...base, warehouseId: wh, direction }) });
      if (action === "transfer") await apiFetch("/stock/transfers", { method: "POST", body: JSON.stringify({ ...base, fromWarehouseId: wh, toWarehouseId: to }) });
      onDone();
    });
  };

  return (
    <Modal title={`${TITLES[action]}: ${row.name}`} onClose={onClose}>
      <div className="grid gap-3">
        <Field label={action === "transfer" ? "From warehouse" : "Warehouse"} htmlFor="sa-wh">
          <Select id="sa-wh" value={wh} onChange={(e) => setWh(e.target.value)}>
            <option value="">Select…</option>
            {(action === "adjust" && direction === "increase" ? active : active).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </Select>
        </Field>
        {action === "transfer" && (
          <Field label="To warehouse" htmlFor="sa-to"><Select id="sa-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{active.filter((w) => w.id !== wh).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select></Field>
        )}
        {action === "adjust" && (
          <Field label="Direction" htmlFor="sa-dir"><Select id="sa-dir" value={direction} onChange={(e) => setDirection(e.target.value as "increase" | "decrease")}><option value="decrease">Decrease (loss, damage, count shortfall)</option><option value="increase">Increase (count surplus)</option></Select></Field>
        )}
        <Field label={`Quantity (${row.unit})`} htmlFor="sa-qty" hint={`Held in selected warehouse: ${held}`}><Input id="sa-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="sa-reason"><Input id="sa-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === "issue" ? "e.g. Melt shop heat 2411" : "Why is this needed?"} /></Field>
        {touched && problems.length > 0 && <Notice tone="error">{problems[0]}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit}>{pending ? "Saving…" : "Confirm"}</Button></div>
      </div>
    </Modal>
  );
}
