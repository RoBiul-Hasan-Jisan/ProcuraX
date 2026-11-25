"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiFetch } from "@/lib/api/client";
import { SEVERITY_TONE, safeInternalLink, timeAgo } from "@/lib/utils/operations";
import type { AppNotification } from "@/types/operations";

const POLL_MS = 60_000;

/** Header bell: unread count (refreshed every minute and when the tab regains focus) and the latest notifications. */
export function NotificationCenter() {
  const { can } = useAuth();
  const router = useRouter();
  const allowed = can("notifications:view");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    apiFetch<{ unread: number }>("/notifications/unread-count").then((r) => setUnread(r.data.unread)).catch(() => undefined);
  }, []);
  const loadList = useCallback(() => {
    setError(null);
    apiFetch<AppNotification[]>("/notifications?limit=8")
      .then((r) => { setItems(r.data); setUnread((r.pagination as unknown as { unread?: number } | null)?.unread ?? 0); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load notifications"));
  }, []);

  useEffect(() => {
    if (!allowed) return;
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    const onFocus = () => refreshCount();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [allowed, refreshCount]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (!allowed) return null;

  const toggle = () => { const next = !open; setOpen(next); if (next) loadList(); };
  const openOne = async (n: AppNotification) => {
    if (!n.readAt) {
      await apiFetch(`/notifications/${n._id}/read`, { method: "POST" }).catch(() => undefined);
      setItems((l) => l?.map((x) => (x._id === n._id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
    }
    const href = safeInternalLink(n.link);
    if (href) { setOpen(false); router.push(href); }
  };
  const readAll = async () => {
    await apiFetch("/notifications/read-all", { method: "POST" }).catch(() => undefined);
    setUnread(0);
    setItems((l) => l?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} className="relative rounded-md p-2 text-slate-600 hover:bg-steel-100">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span data-testid="unread-badge" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-96 max-w-[90vw] rounded-md border border-line bg-white text-sm shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <p className="font-semibold text-navy-900">Notifications</p>
            {unread > 0 && <button onClick={() => void readAll()} className="text-xs text-steel-600 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {error && <p role="alert" className="p-4 text-danger">{error}</p>}
            {!error && items === null && <p role="status" className="p-4 text-slate-500">Loading…</p>}
            {!error && items?.length === 0 && <p className="p-4 text-slate-500">You have no notifications.</p>}
            {items?.map((n) => (
              <button key={n._id} onClick={() => void openOne(n)} className={`block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-steel-100/60 ${n.readAt ? "" : "bg-steel-100/40"}`}>
                <div className="flex items-start gap-2">
                  {!n.readAt && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-steel-600" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{n.title}</span><span className={`shrink-0 rounded px-1.5 text-[10px] ${SEVERITY_TONE[n.severity]}`}>{n.severity}</span></div>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-line px-4 py-2 text-center"><Link href="/notifications" onClick={() => setOpen(false)} className="text-xs text-steel-600 hover:underline">View all notifications</Link></div>
        </div>
      )}
    </div>
  );
}
