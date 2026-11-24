import { CheckCircle2, Circle, MessageSquare, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/utils/format";
import { ROLE_OPTIONS } from "@/types";
import type { Requisition } from "@/types/procurement";

const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

export function ApprovalTimeline({ approval, currentStep }: { approval: NonNullable<Requisition["approval"]>; currentStep: number }) {
  return (
    <ol className="space-y-3">
      {approval.steps.map((s) => {
        const active = approval.status === "pending" && s.order === currentStep;
        const Icon = s.status === "approved" ? CheckCircle2 : s.status === "rejected" ? XCircle : s.status === "modification_requested" ? MessageSquare : Circle;
        const tone = s.status === "approved" ? "text-ok" : s.status === "rejected" ? "text-danger" : s.status === "modification_requested" ? "text-orange-600" : active ? "text-steel-600" : "text-slate-300";
        return (
          <li key={s.order} className="flex gap-3">
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} />
            <div className="text-sm">
              <div className="font-medium text-navy-900">{s.order}. {s.label} <span className="font-normal text-slate-500">({roleLabel(s.role)})</span> {active && <StatusBadge value="Under Review" />}</div>
              {s.decidedAt ? <div className="text-xs text-slate-500">{s.status.replace(/_/g, " ")} by {s.decidedByName} · {formatDate(s.decidedAt, true)}</div> : <div className="text-xs text-slate-400">{active ? "Awaiting decision" : "Not reached yet"}</div>}
              {s.comment && <div className="mt-1 rounded bg-surface p-2 text-slate-700">&ldquo;{s.comment}&rdquo;</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
