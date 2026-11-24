import { cn } from "@/lib/utils/cn";

const TONES: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-700", Submitted: "bg-blue-50 text-blue-700", "Under Review": "bg-amber-50 text-warn",
  Approved: "bg-green-50 text-ok", Rejected: "bg-red-50 text-danger", "Modification Requested": "bg-orange-50 text-orange-700",
  "RFQ Created": "bg-indigo-50 text-indigo-700", Ordered: "bg-indigo-50 text-indigo-700", Completed: "bg-green-50 text-ok", Cancelled: "bg-slate-100 text-slate-500",
  open: "bg-green-50 text-ok", closed: "bg-amber-50 text-warn", awarded: "bg-indigo-50 text-indigo-700", cancelled: "bg-slate-100 text-slate-500",
  submitted: "bg-blue-50 text-blue-700", withdrawn: "bg-slate-100 text-slate-500", not_selected: "bg-slate-100 text-slate-500",
  active: "bg-green-50 text-ok", inactive: "bg-slate-100 text-slate-500", blocked: "bg-red-50 text-danger", verified: "bg-green-50 text-ok",
  pending: "bg-amber-50 text-warn", rejected: "bg-red-50 text-danger",
  draft: "bg-slate-100 text-slate-700", issued: "bg-blue-50 text-blue-700", partially_received: "bg-amber-50 text-warn", received: "bg-green-50 text-ok",
  pending_verification: "bg-amber-50 text-warn", disputed: "bg-red-50 text-danger",
  ok: "bg-green-50 text-ok", reorder: "bg-amber-50 text-warn", low: "bg-orange-50 text-orange-700", critical: "bg-red-50 text-danger",
  Low: "bg-slate-100 text-slate-600", Medium: "bg-blue-50 text-blue-700", High: "bg-orange-50 text-orange-700", Urgent: "bg-red-50 text-danger",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium", TONES[value] ?? "bg-slate-100 text-slate-700")}>
      {value.replace(/_/g, " ")}
    </span>
  );
}
