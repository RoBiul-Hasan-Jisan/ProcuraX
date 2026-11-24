"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAction, useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import type { Warehouse } from "@/types/purchasing";

export default function WarehousesPage() {
  const list = useApi<Warehouse[]>("/warehouses");
  const toggle = useAction();
  const [creating, setCreating] = useState(false);

  const columns = useMemo<ColumnDef<Warehouse>[]>(() => [
    { header: "Code", accessorKey: "code", cell: (c) => <span className="font-mono text-xs font-medium">{c.getValue<string>()}</span> },
    { header: "Name", accessorKey: "name" },
    { header: "Location", accessorKey: "location" },
    { header: "Status", cell: ({ row }) => <StatusBadge value={row.original.active ? "active" : "inactive"} /> },
    { header: "", id: "a", cell: ({ row }) => (
      <Button size="sm" variant="secondary" disabled={toggle.pending} onClick={() => void toggle.run(async () => { await apiFetch(`/warehouses/${row.original.id}`, { method: "PATCH", body: JSON.stringify({ active: !row.original.active }) }); list.reload(); })}>
        {row.original.active ? "Deactivate" : "Activate"}
      </Button>) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [toggle.pending]);

  return (
    <>
      <PageHeader title="Warehouse Management" subtitle="A warehouse that still holds stock cannot be deactivated."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New warehouse</Button>} />
      {toggle.error && <div className="mb-3"><Notice tone="error">{toggle.error}</Notice></div>}
      <Card><DataTable columns={columns} data={list.data} loading={list.loading} error={list.error} onRetry={list.reload} emptyMessage="No warehouses yet. Create one before receiving goods." /></Card>
      {creating && <CreateDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />}
    </>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState({ code: "", name: "", location: "" });
  const bad = v.code.trim().length < 2 || v.name.trim().length < 2;
  return (
    <Modal title="New warehouse" onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Code" htmlFor="w-code"><Input id="w-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Name" htmlFor="w-name"><Input id="w-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Location" htmlFor="w-loc"><Input id="w-loc" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || bad} onClick={() => void run(async () => { await apiFetch("/warehouses", { method: "POST", body: JSON.stringify(v) }); onDone(); })}>Create</Button></div>
      </div>
    </Modal>
  );
}
