import { forwardRef, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-charcoal">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

const control = "w-full rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-steel-500 focus:ring-2 focus:ring-steel-100 disabled:bg-surface";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(control, "h-10", className)} {...p} />
));
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(control, "min-h-20 py-2", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const cls = { error: "bg-red-50 text-danger", success: "bg-green-50 text-ok", info: "bg-steel-100 text-navy-800" }[tone];
  return <p role={tone === "error" ? "alert" : "status"} className={cn("rounded p-2 text-sm", cls)}>{children}</p>;
}
