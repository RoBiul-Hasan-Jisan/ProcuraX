"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { cmp, isDecimal, remaining } from "@/lib/utils/decimal";
import { quantity } from "@/lib/utils/format";
import type { GoodsReceipt, PurchaseOrder, Warehouse } from "@/types/purchasing";

interface LineState { accepted: string; rejected: string; reason: string }

/** Records a goods receipt. Accepted quantity goes into stock; rejected quantity is recorded only. The server re-validates everything. */
export function ReceiptDialog({ orders, initialPoId, onClose, onDone }: { orders: PurchaseOrder[]; initialPoId?: string; onClose: () => void; onDone: (r: GoodsReceipt) => void }) {
  const warehouses = useApi<Warehouse[]>("/warehouses");
  const { pending, error, run } = useAction();
  const [poId, setPoId] = useState(initialPoId ?? "");
  const [warehouseId, setWarehouseId] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [touched, setTouched] = useState(false);
  const po = orders.find((o) => o.id === poId);
  const get = (id: string): LineState => lines[id] ?? { accepted: "", rejected: "", reason: "" };
  const set = (id: string, patch: Partial<LineState>) => setLines((l) => ({ ...l, [id]: { ...get(id), ...patch } }));

  const problems = useMemo(() => {
    if (!po) return ["Choose a purchase order"];
    const out: string[] = [];
    if (!warehouseId) out.push("Choose a warehouse");
    let any = false;
    for (const l of po.lines) {
      const s = get(l.materialId);
      const a = s.accepted.trim() === "" ? "0" : s.accepted.trim();
      const r = s.rejected.trim() === "" ? "0" : s.rejected.trim();
      if (!isDecimal(a) || !isDecimal(r)) { out.push(`${l.materialName}: quantities must be numbers with at most 4 decimals`); continue; }
      if (cmp(a, "0") > 0 || cmp(r, "0") > 0) any = true;
      if (cmp(a, remaining(l.quantity, l.acceptedQty)) > 0) out.push(`${l.materialName}: accepted exceeds the ${quantity(remaining(l.quantity, l.acceptedQty))} still outstanding`);
      if (cmp(r, "0") > 0 && !s.reason.trim()) out.push(`${l.materialName}: give a reason for the rejected quantity`);
    }
    if (!any && po) out.push("Enter an accepted or rejected quantity");
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po, warehouseId, lines]);

  const submit = () => {
    setTouched(true);
    if (problems.length || !po) return;
    void run(async () => {
      const body = {
        purchaseOrderId: po.id, warehouseId, deliveryNote, notes,
        lines: po.lines.map((l) => ({ materialId: l.materialId, acceptedQty: get(l.materialId).accepted.trim() || "0", rejectedQty: get(l.materialId).rejected.trim() || "0", rejectionReason: get(l.materialId).reason.trim() || undefined }))
          .filter((l) => l.acceptedQty !== "0" || l.rejectedQty !== "0"),
      };
      const res = await apiFetch<GoodsReceipt>("/goods-receipts", { method: "POST", body: JSON.stringify(body) });
      onDone(res.data);
    });
  };

  return (
    <Modal title="Record goods receipt" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Purchase order" htmlFor="gr-po">
          <Select id="gr-po" value={poId} onChange={(e) => setPoId(e.target.value)} disabled={Boolean(initialPoId)}>
            <option value="">Select…</option>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.supplier.name}</option>)}
          </Select>
        </Field>
        <Field label="Receiving warehouse" htmlFor="gr-wh">
          <Select id="gr-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Select…</option>
            {(warehouses.data ?? []).filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </Select>
        </Field>
        <Field label="Delivery note / challan no." htmlFor="gr-dn"><Input id="gr-dn" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="gr-notes"><Textarea id="gr-notes" className="min-h-10" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {po && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Material</th><th>Outstanding</th><th>Accepted</th><th>Rejected</th><th>Rejection reason</th></tr></thead>
            <tbody>
              {po.lines.map((l) => {
                const s = get(l.materialId);
                const out = remaining(l.quantity, l.acceptedQty);
                return (
                  <tr key={l.materialId} className="border-t border-line align-top">
                    <td className="py-2 pr-2">{l.materialName}<div className="text-xs text-slate-400">{l.sku}</div></td>
                    <td className="pr-2 whitespace-nowrap">{quantity(out)} {l.unit}</td>
                    <td className="pr-2"><Input aria-label={`Accepted ${l.materialName}`} inputMode="decimal" className="w-28" value={s.accepted} onChange={(e) => set(l.materialId, { accepted: e.target.value })} /></td>
                    <td className="pr-2"><Input aria-label={`Rejected ${l.materialName}`} inputMode="decimal" className="w-28" value={s.rejected} onChange={(e) => set(l.materialId, { rejected: e.target.value })} /></td>
                    <td><Input aria-label={`Reason ${l.materialName}`} value={s.reason} onChange={(e) => set(l.materialId, { reason: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Only accepted quantity is added to stock. Rejected goods are recorded against the supplier and do not count toward the order.</p>
        </div>
      )}
      {touched && problems.length > 0 && <div className="mt-3"><Notice tone="error">{problems[0]}</Notice></div>}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={pending} onClick={submit}>{pending ? "Recording…" : "Record receipt"}</Button>
      </div>
    </Modal>
  );
}
