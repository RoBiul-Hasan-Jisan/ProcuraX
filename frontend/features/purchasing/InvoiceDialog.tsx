"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Notice, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { isDecimal, mul2, pct2, remaining, round2, sum2 } from "@/lib/utils/decimal";
import { money, quantity } from "@/lib/utils/format";
import type { Invoice, PurchaseOrder } from "@/types/purchasing";

/**
 * Records a supplier invoice. Quantities default to what was accepted and not yet invoiced; prices default to the PO price.
 * The total shown here is a preview only: the server recomputes it and runs the three-way match.
 */
export function InvoiceDialog({ orders, onClose, onDone }: { orders: PurchaseOrder[]; onClose: () => void; onDone: (i: Invoice) => void }) {
  const { pending, error, run } = useAction();
  const [poId, setPoId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [edits, setEdits] = useState<Record<string, { q?: string; p?: string }>>({});
  const [charges, setCharges] = useState<{ t?: string; a?: string; tax?: string }>({});
  const [touched, setTouched] = useState(false);
  const po = orders.find((o) => o.id === poId);

  const rows = useMemo(() => (po?.lines ?? []).map((l) => {
    const e = edits[l.materialId] ?? {};
    const q = e.q ?? remaining(l.acceptedQty, l.invoicedQty);
    const p = e.p ?? l.unitPrice;
    return { l, q, p, total: mul2(q, p) };
  }), [po, edits]);
  const t = charges.t ?? po?.transportCost ?? "0", a = charges.a ?? po?.additionalCharges ?? "0", tax = charges.tax ?? po?.taxRatePercent ?? "0";
  const material = sum2(rows.map((r) => r.total));
  const taxAmt = pct2(material, tax);
  const preview = taxAmt !== null && round2(t) !== null && round2(a) !== null ? sum2([material, round2(t), round2(a), taxAmt]) : null;

  const problems: string[] = [];
  if (!po) problems.push("Choose a purchase order");
  if (!invoiceNumber.trim()) problems.push("Enter the supplier's invoice number");
  const used = rows.filter((r) => r.q !== "" && r.q !== "0");
  if (po && used.length === 0) problems.push("Enter a billed quantity for at least one line");
  if (used.some((r) => !isDecimal(r.q) || !isDecimal(r.p))) problems.push("Quantities and prices must be numbers with at most 4 decimals");
  if (![t, a, tax].every(isDecimal)) problems.push("Charges and tax rate must be numbers");

  const submit = () => {
    setTouched(true);
    if (problems.length || !po) return;
    void run(async () => {
      const res = await apiFetch<Invoice>("/invoices", { method: "POST", body: JSON.stringify({
        purchaseOrderId: po.id, invoiceNumber: invoiceNumber.trim(), invoiceDate,
        lines: used.map((r) => ({ materialId: r.l.materialId, quantity: r.q, unitPrice: r.p })), transportCost: t, additionalCharges: a, taxRatePercent: tax,
      }) });
      onDone(res.data);
    });
  };

  return (
    <Modal title="Record supplier invoice" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Purchase order" htmlFor="inv-po">
          <Select id="inv-po" value={poId} onChange={(e) => { setPoId(e.target.value); setEdits({}); setCharges({}); }}>
            <option value="">Select…</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.supplier.name}</option>)}
          </Select>
        </Field>
        <Field label="Supplier invoice no." htmlFor="inv-no"><Input id="inv-no" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} /></Field>
        <Field label="Invoice date" htmlFor="inv-date"><Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
      </div>
      {po && (
        <>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Material</th><th>Billable now</th><th>Billed qty</th><th>Unit price</th><th className="text-right">Line</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.l.materialId} className="border-t border-line">
                  <td className="py-2">{r.l.materialName}</td>
                  <td>{quantity(remaining(r.l.acceptedQty, r.l.invoicedQty))} {r.l.unit}</td>
                  <td><Input aria-label={`Billed ${r.l.materialName}`} className="w-28" inputMode="decimal" value={r.q} onChange={(e) => setEdits((s) => ({ ...s, [r.l.materialId]: { ...s[r.l.materialId], q: e.target.value } }))} /></td>
                  <td><Input aria-label={`Price ${r.l.materialName}`} className="w-28" inputMode="decimal" value={r.p} onChange={(e) => setEdits((s) => ({ ...s, [r.l.materialId]: { ...s[r.l.materialId], p: e.target.value } }))} /></td>
                  <td className="text-right">{r.total ? money(r.total, po.currency) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Transportation" htmlFor="inv-t"><Input id="inv-t" inputMode="decimal" value={t} onChange={(e) => setCharges((c) => ({ ...c, t: e.target.value }))} /></Field>
            <Field label="Additional charges" htmlFor="inv-a"><Input id="inv-a" inputMode="decimal" value={a} onChange={(e) => setCharges((c) => ({ ...c, a: e.target.value }))} /></Field>
            <Field label="Tax rate %" htmlFor="inv-tax"><Input id="inv-tax" inputMode="decimal" value={tax} onChange={(e) => setCharges((c) => ({ ...c, tax: e.target.value }))} /></Field>
          </div>
          <p className="mt-2 text-sm">Preview total: <strong>{preview ? money(preview, po.currency) : "-"}</strong> <span className="text-xs text-slate-500">(the server recomputes the total and checks it against the PO and receipts)</span></p>
        </>
      )}
      {touched && problems.length > 0 && <div className="mt-3"><Notice tone="error">{problems[0]}</Notice></div>}
      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit}>{pending ? "Recording…" : "Record invoice"}</Button></div>
    </Modal>
  );
}
