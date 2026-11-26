"use client";

import { LogoMark } from "@/components/brand/Logo";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { isEnabled, visibleNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils/cn";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

export function Sidebar({ collapsed, onToggle, onNavigate }: Props) {
  const { can } = useAuth();
  const pathname = usePathname();
  const sections = useMemo(() => visibleNavigation(can), [can]);

  return (
    <aside className={cn("flex h-full flex-col bg-navy-900 text-steel-100 transition-[width]", collapsed ? "w-16" : "w-64")}>
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <LogoMark className="h-8 w-8 shrink-0" />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">ProcuraX</div>
            <div className="text-[10px] uppercase tracking-wider text-steel-300">Demo prototype</div>
          </div>
        )}
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-2">
        {sections.map((section) => {
          const Icon = section.icon;
          const single = section.items.length === 1 && section.items[0].label === section.label;
          return (
            <div key={section.label} className="mb-1">
              {!single && !collapsed && (
                <div className="flex items-center gap-2 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-steel-300">
                  <Icon className="h-3.5 w-3.5" /> {section.label}
                </div>
              )}
              {section.items.map((item) => {
                const enabled = isEnabled(item);
                const active = enabled && pathname.startsWith(item.href);
                const content = (
                  <>
                    {(single || collapsed) && <Icon className="h-4 w-4 shrink-0" />}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && !enabled && (
                      <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-steel-300">
                        Phase {item.phase}
                      </span>
                    )}
                  </>
                );
                const base = cn(
                  "mx-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                  !single && !collapsed && "pl-9",
                );
                return enabled ? (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(base, active ? "bg-steel-600 text-white" : "hover:bg-white/10")}
                  >
                    {content}
                  </Link>
                ) : (
                  <div
                    key={item.href}
                    aria-disabled="true"
                    title={`${item.label} - planned for Phase ${item.phase}`}
                    className={cn(base, "cursor-not-allowed text-steel-300/50")}
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>

      <button
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden h-10 items-center justify-center border-t border-white/10 hover:bg-white/10 lg:flex"
      >
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
