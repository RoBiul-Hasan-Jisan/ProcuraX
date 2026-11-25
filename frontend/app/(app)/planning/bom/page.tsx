"use client";

import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Notice, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { BomDialog } from "@/features/planning/BomDialog";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/format";
import type { Bom, FinishedProduct } from "@/types/planning";

export default function BomPage() {
  const { can } = useAuth();
  const manage = can("production:manage");
  const [productFilter, setProductFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Bom | "new" | null>(null);
  const [newProduct, setNewProduct] = useState(false);
  const products = useApi<FinishedProduct[]>("/finished-products");
  const boms = useApi<Bom[]>(`/boms${productFilter ? `?product=${productFilter}` : ""}`);
  const act = useAction();
  const post = (path: string) => act.run(async () => { await apiFetch(path, { method: "POST", body: "{}" }); boms.reload(); });

  return (
    <>
      <PageHeader title="Bill of Materials" subtitle="Materials needed per unit of each finished product. Only active BOMs are used by MRP."
        actions={manage ? <><Button variant="secondary" onClick={() => setNewProduct(true)}>New product</Button><Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New BOM</Button></> : undefined} />
      {act.error && <div className="mb-3"><Notice tone="error">{act.error}</Notice></div>}
      <Card className="mb-4">
        <CardHeader title="Finished products" />
        <div className="flex flex-wrap gap-2 p-3 text-sm">
          {(products.data ?? []).length === 0 && <span className="text-slate-500">No products yet.</span>}
          {(products.data ?? []).map((p) => (
            <button key={p.id} type="button" onClick={() => setProductFilter(productFilter === p.id ? "" : p.id)}
              className={`rounded border px-2 py-1 ${productFilter === p.id ? "border-steel-600 bg-steel-50" : "border-line"}`}>
              {p.code} · {p.name}{p.intermediate ? " (in-house component)" : ""}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        {boms.loading && !boms.data ? <LoadingState /> : boms.error ? <ErrorState message={boms.error} onRetry={boms.reload} /> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="w-8 px-3 py-2" /><th>BOM</th><th>Product</th><th>Version</th><th>Effective from</th><th>Components</th><th>Status</th>{manage && <th>Actions</th>}</tr></thead>
            <tbody>
              {(boms.data ?? []).length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No BOMs yet.</td></tr>}
              {(boms.data ?? []).map((b) => (
                <Fragment key={b.id}>
                  <tr className="border-t border-line">
                    <td className="px-3"><button type="button" aria-label={`Toggle ${b.number}`} onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                    <td className="py-2 font-mono text-xs">{b.number}</td><td>{b.product.name}</td><td>v{b.version}</td><td>{formatDate(b.effectiveFrom)}</td><td>{b.items.length}</td>
                    <td><StatusBadge value={b.status} /></td>
                    {manage && <td><div className="flex flex-wrap gap-1">
                      {b.status === "draft" && <><Button size="sm" variant="secondary" onClick={() => setEditing(b)}>Edit</Button><Button size="sm" disabled={act.pending} onClick={() => void post(`/boms/${b.id}/activate`)}>Activate</Button></>}
                      {b.status === "active" && <Button size="sm" variant="secondary" disabled={act.pending} onClick={() => void post(`/boms/${b.id}/obsolete`)}>Make obsolete</Button>}
                      {b.status !== "draft" && <Button size="sm" variant="secondary" disabled={act.pending} onClick={() => void post(`/boms/${b.id}/new-version`)}>New version</Button>}
                    </div></td>}
                  </tr>
                  {open === b.id && (
                    <tr className="bg-slate-50"><td /><td colSpan={7} className="p-3">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500"><tr><th>Component</th><th>Qty per 1 {b.product.unit}</th><th>Unit</th><th>Wastage</th></tr></thead>
                        <tbody>{b.items.map((i) => <tr key={`${i.materialId}${i.subProductId}`} className="border-t border-line"><td className="py-1">{i.name} <span className="text-slate-400">{i.sku}</span>{i.subProductId ? " (made in-house)" : ""}</td><td>{i.quantity}</td><td>{i.unit}</td><td>{i.wastagePercent}%</td></tr>)}</tbody>
                      </table>
                      {b.notes && <p className="mt-2 text-xs text-slate-500">{b.notes}</p>}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">An active BOM cannot be edited because plans and past MRP runs depend on it. Create a new version, edit the draft, then activate it. When several active versions exist, the one effective on the plan start date applies.</p>
      {editing && <BomDialog bom={editing === "new" ? null : editing} productId={productFilter || undefined} onClose={() => setEditing(null)} onDone={() => { setEditing(null); boms.reload(); }} />}
      {newProduct && <ProductDialog onClose={() => setNewProduct(false)} onDone={() => { setNewProduct(false); products.reload(); }} />}
    </>
  );
}

function ProductDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState({ code: "", name: "", unit: "MT", intermediate: false });
  const bad = v.code.trim().length < 2 || v.name.trim().length < 2 || !v.unit.trim();
  return (
    <Modal title="New product" onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Code" htmlFor="fp-code"><Input id="fp-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Name" htmlFor="fp-name"><Input id="fp-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Unit" htmlFor="fp-unit"><Input id="fp-unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.intermediate} onChange={(e) => setV({ ...v, intermediate: e.target.checked })} /> Made in-house and used as a component of another product</label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={pending || bad} onClick={() => void run(async () => { await apiFetch("/finished-products", { method: "POST", body: JSON.stringify(v) }); onDone(); })}>Create</Button></div>
      </div>
    </Modal>
  );
}
