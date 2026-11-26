"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiFetch } from "@/lib/api/client";

interface Dept { _id: string; code: string; name: string; description?: string; active: boolean }
const input = "h-8 rounded-md border border-line bg-white px-2 text-sm";

/** Create, rename and deactivate departments. Departments are deactivated, never deleted, because requisitions refer to them. */
export function DepartmentsPanel() {
  const [items, setItems] = useState<Dept[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try { setItems((await apiFetch<Dept[]>("/departments?all=1")).data); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load departments"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setNotice(ok); setError(null); await load(); }
    catch (e) { setNotice(null); setError(e instanceof Error ? e.message : "Request failed"); }
  };
  const add = () => run(async () => { await apiFetch("/departments", { method: "POST", body: JSON.stringify({ code: code.trim().toUpperCase(), name: name.trim() }) }); setCode(""); setName(""); }, "Department created.");
  const patch = (id: string, body: object, ok: string) => run(() => apiFetch(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(body) }), ok);

  return (
    <Card>
      <CardHeader title="Departments" />
      {notice && <p role="status" className="m-3 rounded bg-green-50 p-2 text-sm text-ok">{notice}</p>}
      {error && <p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
        <label className="text-xs text-slate-500">Code<input aria-label="Department code" className={`${input} ml-2 w-24`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. QA" /></label>
        <label className="text-xs text-slate-500">Name<input aria-label="Department name" className={`${input} ml-2 w-56`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Quality Assurance" /></label>
        <Button size="sm" disabled={code.trim().length < 2 || name.trim().length < 2} onClick={() => void add()}>Add department</Button>
      </div>
      {items === null ? (error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState label="Loading departments…" />)
        : items.length === 0 ? <EmptyState message="No departments yet." />
        : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase text-slate-500"><tr><th className="px-4 py-2 font-medium">Code</th><th className="px-4 py-2 font-medium">Name</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2" /></tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d._id} className="border-t border-line">
                  <td className="px-4 py-2 font-mono text-xs">{d.code}</td>
                  <td className="px-4 py-2">
                    {editing?.id === d._id
                      ? <input aria-label={`Rename ${d.code}`} className={`${input} w-56`} value={editing.name} onChange={(e) => setEditing({ id: d._id, name: e.target.value })} />
                      : d.name}
                  </td>
                  <td className="px-4 py-2">{d.active ? "Active" : <span className="text-slate-500">Inactive</span>}</td>
                  <td className="flex justify-end gap-2 px-4 py-2">
                    {editing?.id === d._id ? (
                      <>
                        <Button size="sm" disabled={editing.name.trim().length < 2} onClick={() => { void patch(d._id, { name: editing.name.trim() }, "Department renamed."); setEditing(null); }}>Save</Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setEditing({ id: d._id, name: d.name })}>Rename</Button>
                        <Button size="sm" variant="secondary" onClick={() => void patch(d._id, { active: !d.active }, d.active ? "Department deactivated." : "Department reactivated.")}>{d.active ? "Deactivate" : "Reactivate"}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </Card>
  );
}
