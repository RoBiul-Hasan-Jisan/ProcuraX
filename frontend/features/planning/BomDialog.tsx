"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { toDateInput } from "@/lib/utils/format";
import type { Material } from "@/types/procurement";
import type { Bom, FinishedProduct } from "@/types/planning";

interface Row { kind: "material" | "product"; refId: string; quantity: string; wastage: string }
const blank = (): Row => ({ kind: "material", refId: "", quantity: "", wastage: "0" });

/**
 * Create a draft BOM or edit one. Quantities are per ONE unit of the finished product (up to 6 decimals); the unit of each
 * component comes from the catalogue on the server. Only drafts can be edited; active BOMs get a new version instead.
 */
export function BomDialog({ bom, productId: fixedProduct, onClose, onDone }: { bom: Bom | null; productId?: string; onClose: () => void; onDone: () => void }) {
  const products = useApi<FinishedProduct[]>("/finished-products?active=true");
  const materials = useApi<Material[]>("/materials?limit=100&active=true");
  const { pending, error, run } = useAction();
  const [productId, setProductId] = useState(bom?.product.id ?? fixedProduct ?? "");
  const [effectiveFrom, setEffective] = useState(bom ? toDateInput(bom.effectiveFrom) : toDateInput(new Date()));
  const [notes, setNotes] = useState(bom?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(bom ? bom.items.map((i) => ({ kind: i.subProductId ? "product" : "material", refId: i.subProductId ?? i.materialId ?? "", quantity: i.quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""), wastage: i.wastagePercent.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") })) : [blank()]);
  const [touched, setTouched] = useState(false);
  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const problems: string[] = [];
  if (!productId) problems.push("Choose the finished product");
  if (!effectiveFrom) problems.push("Set the effective date");
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r.refId) problems.push(`Component ${n}: choose a ${r.kind === "material" ? "material" : "sub-product"}`);
    if (!/^\d+(\.\d{1,6})?$/.test(r.quantity) || Number(r.quantity) <= 0) problems.push(`Component ${n}: quantity per unit must be greater than zero (max 6 decimals)`);
    if (!/^\d+(\.\d{1,2})?$/.test(r.wastage) || Number(r.wastage) > 100) problems.push(`Component ${n}: wastage must be between 0 and 100 (max 2 decimals)`);
    const key = `${r.kind}:${r.refId}`;
    if (r.refId && seen.has(key)) problems.push(`Component ${n} is listed twice`);
    seen.add(key);
    if (r.kind === "product" && r.refId === productId) problems.push(`Component ${n}: a product cannot contain itself`);
  });

  const submit = () => {
    setTouched(true);
    if (problems.length) return;
    void run(async () => {
      const body = { productId, effectiveFrom, notes, items: rows.map((r) => ({ materialId: r.kind === "material" ? r.refId : null, subProductId: r.kind === "product" ? r.refId : null, quantity: r.quantity, wastagePercent: r.wastage })) };
      await apiFetch(bom ? `/boms/${bom.id}` : "/boms", { method: bom ? "PUT" : "POST", body: JSON.stringify(body) });
      onDone();
    });
  };

  return (
    <Modal title={bom ? `Edit ${bom.number} (draft v${bom.version})` : "New bill of materials"} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Finished product" htmlFor="bom-product">
          <Select id="bom-product" value={productId} disabled={Boolean(bom) || Boolean(fixedProduct)} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.unit})</option>)}
          </Select>
        </Field>
        <Field label="Effective from" htmlFor="bom-eff"><Input id="bom-eff" type="date" value={effectiveFrom} onChange={(e) => setEffective(e.target.value)} /></Field>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Type</th><th>Component</th><th>Qty per 1 unit</th><th>Wastage %</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-2 pr-2"><Select aria-label={`Type ${i + 1}`} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Row["kind"], refId: "" })}><option value="material">Material</option><option value="product">Sub-product</option></Select></td>
                <td className="pr-2">
                  <Select aria-label={`Component ${i + 1}`} value={r.refId} onChange={(e) => setRow(i, { refId: e.target.value })}>
                    <option value="">Select…</option>
                    {r.kind === "material" ? (materials.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.sku} · {m.name} ({m.unit})</option>) : (products.data ?? []).filter((p) => p.id !== productId).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                  </Select>
                </td>
                <td className="pr-2"><Input aria-label={`Quantity ${i + 1}`} inputMode="decimal" className="w-28" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} /></td>
                <td className="pr-2"><Input aria-label={`Wastage ${i + 1}`} inputMode="decimal" className="w-20" value={r.wastage} onChange={(e) => setRow(i, { wastage: e.target.value })} /></td>
                <td><Button variant="ghost" size="icon" aria-label={`Remove component ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => setRows((r) => [...r, blank()])}><Plus className="h-4 w-4" /> Add component</Button>
      </div>
      <div className="mt-3"><Field label="Notes" htmlFor="bom-notes"><Textarea id="bom-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      <p className="mt-2 text-xs text-slate-500">Gross need = production quantity x quantity per unit. Wastage is added on top: adjusted need = gross x (1 + wastage%). A sub-product is made in-house from its own BOM.</p>
      {touched && problems.length > 0 && <div className="mt-3"><Notice tone="error">{problems[0]}</Notice></div>}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit}>{pending ? "Saving…" : "Save draft"}</Button></div>
    </Modal>
  );
}
