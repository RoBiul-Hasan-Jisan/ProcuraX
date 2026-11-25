"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Notice, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useApi } from "@/hooks/useApi";
import { apiFetch } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/format";
import { SEVERITY_TONE, safeInternalLink, timeAgo } from "@/lib/utils/operations";
import type { AppNotification } from "@/types/operations";

export default function NotificationsPage() {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState("");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), limit: "20", ...(unreadOnly ? { unreadOnly: "true" } : {}) }).toString();
  const list = useApi<AppNotification[]>(`/notifications?${qs}`);
  const [err, setErr] = useState<string | null>(null);
  const unread = (list.pagination as unknown as { unread?: number } | null)?.unread ?? 0;

  const markRead = async (n: AppNotification) => {
    setErr(null);
    try {
      if (!n.readAt) await apiFetch(`/notifications/${n._id}/read`, { method: "POST" });
      const href = safeInternalLink(n.link);
      if (href) router.push(href); else list.reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); }
  };
  const readAll = async () => {
    setErr(null);
    try { await apiFetch("/notifications/read-all", { method: "POST" }); list.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); }
  };

  return (
    <>
      <PageHeader title="Notifications" subtitle="Events that need your attention. You only ever see your own."
        actions={unread > 0 ? <Button variant="secondary" onClick={() => void readAll()}>Mark all {unread} as read</Button> : undefined} />
      {err && <Notice tone="error">{err}</Notice>}
      <div className="mb-3">
        <label htmlFor="flt" className="mb-1 block text-sm font-medium">Show</label>
        <Select id="flt" value={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.value); setPage(1); }}><option value="">All</option><option value="true">Unread only</option></Select>
      </div>
      {list.loading && !list.data && <LoadingState />}
      {list.error && !list.data && <ErrorState message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <EmptyState message={unreadOnly ? "No unread notifications." : "You have no notifications."} />}
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {list.data?.map((n) => (
          <li key={n._id}>
            <button onClick={() => void markRead(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-steel-100/50 ${n.readAt ? "" : "bg-steel-100/40"}`}>
              {!n.readAt && <span aria-label="Unread" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-steel-600" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{n.title}</span><span className={`rounded px-1.5 text-[10px] ${SEVERITY_TONE[n.severity]}`}>{n.severity}</span></div>
                {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                <p className="mt-1 text-xs text-slate-400" title={formatDate(n.createdAt, true)}>{timeAgo(n.createdAt)}{safeInternalLink(n.link) ? " · opens the related record" : ""}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {list.pagination && list.pagination.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>Page {list.pagination.page} of {list.pagination.totalPages}</span>
          <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={page >= list.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div>
        </div>
      )}
    </>
  );
}
