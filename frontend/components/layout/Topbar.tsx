"use client";

import { ChevronRight, LogOut, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { NotificationCenter } from "@/features/notifications/NotificationCenter";
import { NAVIGATION, isEnabled } from "@/lib/navigation";
import { cn } from "@/lib/utils/cn";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = useMemo(() => {
    for (const section of NAVIGATION) {
      const item = section.items.find((i) => pathname.startsWith(i.href));
      if (item) return section.label === item.label ? [item.label] : [section.label, item.label];
    }
    return [];
  }, [pathname]);
  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-sm text-slate-500 md:flex">
      <Link href="/overview" className="hover:text-navy-800">Home</Link>
      {crumbs.map((c) => (
        <span key={c} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5" /> <span className="text-navy-900">{c}</span>
        </span>
      ))}
    </nav>
  );
}

/** Global search over the pages the signed-in user is permitted to open. */
function GlobalSearch() {
  const { can } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return NAVIGATION.flatMap((s) => s.items)
      .filter((i) => can(...i.permissions) && i.label.toLowerCase().includes(term))
      .slice(0, 6);
  }, [q, can]);

  const go = (href: string) => {
    setQ("");
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          const first = results.find(isEnabled);
          if (e.key === "Enter" && first) go(first.href);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search pages…"
        aria-label="Search pages"
        className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-steel-500"
      />
      {open && q.trim() && (
        <ul className="absolute z-30 mt-1 w-full rounded-md border border-line bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matching pages</li>}
          {results.map((r) => (
            <li key={r.href}>
              <button
                disabled={!isEnabled(r)}
                onClick={() => go(r.href)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm enabled:hover:bg-steel-100 disabled:text-slate-400"
              >
                {r.label}
                {!isEnabled(r) && <span className="text-[10px]">Phase {r.phase}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  if (!user) return null;
  const initials = user.displayName.replace(/\[[^\]]*\]/g, "").trim().split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="User menu" aria-expanded={open}
        className="flex items-center gap-2 rounded-md p-1 hover:bg-steel-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">{initials}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-line bg-white py-2 shadow-lg">
          <div className="border-b border-line px-4 pb-2">
            <p className="truncate text-sm font-semibold text-navy-900">{user.displayName}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-xs text-steel-600">{user.roleLabel ?? "No role assigned"}</p>
          </div>
          <button onClick={() => void signOut()} className={cn("flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-steel-100")}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-line bg-white px-4">
      <button onClick={onMenu} aria-label="Open navigation" className="rounded-md p-2 hover:bg-steel-100 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>
      <Breadcrumbs />
      <div className="ml-auto flex flex-1 items-center justify-end gap-3">
        <GlobalSearch />
        <NotificationCenter />
        <UserMenu />
      </div>
    </header>
  );
}
