import type { NotificationSeverity, ReportColumn } from "@/types/operations";

/**
 * Notification links come from the server but are still treated as untrusted: only an in-app path is followed.
 * Anything with a scheme, a protocol-relative "//", a backslash or control characters is ignored.
 */
export function safeInternalLink(link: string | null | undefined): string | null {
  if (!link || !link.startsWith("/") || link.startsWith("//") || /[\\\u0000-\u001f]/.test(link)) return null;
  return link;
}

export const SEVERITY_TONE: Record<NotificationSeverity, string> = {
  info: "bg-slate-100 text-slate-700", warning: "bg-amber-100 text-amber-800", critical: "bg-red-100 text-red-800",
};

/** "2 min ago" style label; falls back to a date for anything older than a week. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt";
export const MAX_UPLOAD_MB = 10;
const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "docx", "xlsx", "csv", "txt"]);

/** Early, friendly check only. The server re-checks type (from the file's bytes) and size and is the real gate. */
export function precheckFile(f: { name: string; size: number }): string | null {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  if (!ALLOWED_EXT.has(ext)) return "This file type is not allowed. Use PDF, PNG, JPG, DOCX, XLSX, CSV or TXT.";
  if (f.size === 0) return "The file is empty.";
  if (f.size > MAX_UPLOAD_MB * 1024 * 1024) return `The file is larger than ${MAX_UPLOAD_MB} MB.`;
  return null;
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const alignRight = (t: ReportColumn["type"]) => t === "money" || t === "qty" || t === "pct" || t === "int";
export const FILTER_LABEL: Record<string, string> = {
  from: "From", to: "To", departmentId: "Department", supplierId: "Supplier", materialId: "Material", categoryId: "Category", warehouseId: "Warehouse", poStatus: "PO status",
};
