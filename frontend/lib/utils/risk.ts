import type { RiskStatus, Severity } from "@/types/intelligence";

/** Mirrors the backend workflow. The server is the authority; this only decides which buttons to offer. */
export const NEXT_STATUSES: Record<RiskStatus, RiskStatus[]> = {
  open: ["acknowledged", "investigating", "dismissed"],
  acknowledged: ["investigating", "resolved", "dismissed"],
  investigating: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};
export const NOTE_REQUIRED: RiskStatus[] = ["resolved", "dismissed"];
export const STATUS_LABEL: Record<RiskStatus, string> = { open: "Open", acknowledged: "Acknowledge", investigating: "Start investigation", resolved: "Resolve", dismissed: "Dismiss" };
export const SEVERITY_TONE: Record<Severity, string> = { critical: "bg-red-50 text-danger", high: "bg-orange-50 text-orange-700", medium: "bg-amber-50 text-warn", low: "bg-slate-100 text-slate-600" };
export const STATUS_TONE: Record<RiskStatus, string> = { open: "bg-red-50 text-danger", acknowledged: "bg-amber-50 text-warn", investigating: "bg-blue-50 text-blue-700", resolved: "bg-green-50 text-ok", dismissed: "bg-slate-100 text-slate-500" };
export const CATEGORY_LABEL: Record<string, string> = {
  high_quotation_price: "High quotation price", price_increase: "Price increase", duplicate_requisition: "Duplicate requisition", duplicate_invoice: "Duplicate invoice",
  unusual_adjustment: "Unusual stock adjustment", abnormal_consumption: "Abnormal consumption", delayed_po: "Delayed purchase order", supplier_quality: "Supplier quality",
  supplier_delivery: "Supplier delivery", repeated_mismatch: "Repeated invoice mismatch",
};
export const canClose = (status: RiskStatus, note: string, target: RiskStatus) => !NOTE_REQUIRED.includes(target) || note.trim().length >= 5 || status === target;
