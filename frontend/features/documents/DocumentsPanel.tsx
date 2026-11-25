"use client";

import { Download, FileText, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthProvider";
import { useApi } from "@/hooks/useApi";
import { apiBlob, apiFetch, apiUpload, saveBlob } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/format";
import { UPLOAD_ACCEPT, MAX_UPLOAD_MB, formatBytes, precheckFile } from "@/lib/utils/operations";
import type { DocumentEntity, DocumentItem } from "@/types/operations";

/**
 * Documents attached to one business record. What a person may see, upload or delete is decided by the server;
 * `canUpload` only hides the form when the page already knows the answer, so a forbidden upload would just show the server's message.
 */
export function DocumentsPanel({ entityType, entityId, canUpload = true, title = "Documents" }: { entityType: DocumentEntity; entityId: string; canUpload?: boolean; title?: string }) {
  const { user } = useAuth();
  const list = useApi<DocumentItem[]>(`/documents?entityType=${entityType}&entityId=${entityId}`);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Action failed");
  const upload = async (file: File | undefined) => {
    setError(null); setOk(null);
    if (!file) return;
    const problem = precheckFile(file);
    if (problem) { setError(problem); if (fileRef.current) fileRef.current.value = ""; return; }
    const form = new FormData();
    form.set("entityType", entityType); form.set("entityId", entityId);
    if (description.trim()) form.set("description", description.trim());
    form.set("file", file);
    setBusy("upload");
    try { await apiUpload("/documents", form); setOk(`Uploaded ${file.name}.`); setDescription(""); list.reload(); }
    catch (e) { fail(e); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const download = async (d: DocumentItem) => {
    setError(null); setBusy(d.id);
    try { const { blob, filename } = await apiBlob(`/documents/${d.id}/download`); saveBlob(blob, filename ?? d.name); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const remove = async (d: DocumentItem) => {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    setError(null); setOk(null); setBusy(d.id);
    try { await apiFetch(`/documents/${d.id}`, { method: "DELETE" }); list.reload(); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader title={title} />
      <div className="space-y-3 p-4 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {ok && <Notice tone="success">{ok}</Notice>}
        {list.loading && !list.data && <p role="status" className="text-slate-500">Loading documents…</p>}
        {list.error && !list.data && <Notice tone="error">{list.error}</Notice>}
        {list.data?.length === 0 && <p className="text-slate-500">No documents attached.</p>}
        <ul className="divide-y divide-line">
          {list.data?.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-xs text-slate-500">{formatBytes(d.size)} · {d.uploadedByName} · {formatDate(d.uploadedAt)}{d.description ? ` · ${d.description}` : ""}</div>
              </div>
              <Button variant="secondary" size="sm" disabled={busy === d.id} onClick={() => void download(d)} aria-label={`Download ${d.name}`}><Download className="h-3.5 w-3.5" /></Button>
              <Button variant="secondary" size="sm" disabled={busy === d.id} onClick={() => void remove(d)} aria-label={`Delete ${d.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
        {canUpload && (
          <div className="space-y-2 border-t border-line pt-3">
            <Input aria-label="Document description" placeholder="Short description (optional)" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} aria-label="Choose a document" disabled={busy === "upload"} onChange={(e) => void upload(e.target.files?.[0])} className="text-xs" />
              {busy === "upload" && <span role="status" className="flex items-center gap-1 text-xs text-slate-500"><Upload className="h-3.5 w-3.5" />Uploading…</span>}
            </div>
            <p className="text-xs text-slate-500">PDF, PNG, JPG, DOCX, XLSX, CSV or TXT, up to {MAX_UPLOAD_MB} MB. Files are checked by content, not just by name.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
