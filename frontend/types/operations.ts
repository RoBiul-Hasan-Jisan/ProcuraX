export type NotificationSeverity = "info" | "warning" | "critical";
export interface AppNotification {
  _id: string; type: string; title: string; body: string; severity: NotificationSeverity; link: string;
  entity?: { kind?: string; id?: string; number?: string }; readAt: string | null; createdAt: string;
}
export interface AuditEntry {
  _id: string; at: string; actor: { id: string | null; name: string; role: string | null }; action: string; entityType: string; entityId: string;
  entityNumber: string; summary: string; before: unknown; after: unknown; requestId: string | null; ip: string | null; userAgent?: string | null;
}
export type ReportFilterKey = "from" | "to" | "departmentId" | "supplierId" | "materialId" | "categoryId" | "warehouseId" | "poStatus";
export interface ReportDef { key: string; title: string; description: string; financial: boolean; filters: ReportFilterKey[] }
export interface ReportColumn { key: string; label: string; type: "text" | "money" | "qty" | "pct" | "date" | "int" }
export interface ReportResult {
  key: string; title: string; generatedAt: string; filters: Record<string, string>; columns: ReportColumn[];
  rows: Record<string, string | number | null>[]; totals: Record<string, string | number | null> | null; notes: string[]; truncated: boolean;
}
export interface Option { id: string; name: string }
export interface FilterOptions { departments: Option[]; suppliers: Option[]; materials: Option[]; categories: Option[]; warehouses: Option[]; poStatuses: string[] }
export type DocumentEntity = "supplier" | "quotation" | "requisition" | "purchase_order" | "goods_receipt" | "invoice";
export interface DocumentItem { id: string; entityType: DocumentEntity; entityId: string; name: string; mimeType: string; size: number; description: string; uploadedByName: string; uploadedAt: string }
