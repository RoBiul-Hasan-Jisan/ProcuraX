export interface PoLine {
  materialId: string; materialName: string; sku: string; unit: string; quantity: string; unitPrice: string; lineTotal: string;
  acceptedQty: string; rejectedQty: string; invoicedQty: string;
}
export interface PurchaseOrder {
  id: string; number: string; status: string; currency: string; rfqId: string; rfqNumber: string | null; requisitionId: string; requisitionNumber: string | null;
  supplier: { id: string; name: string | null }; lines: PoLine[];
  materialCost: string; transportCost: string; additionalCharges: string; taxRatePercent: string; taxAmount: string; totalAmount: string;
  paymentTerms: string; paymentTermsDays: number; deliveryLocation: string; deliveryDays: number;
  expectedDeliveryDate: string | null; issuedAt: string | null; lastReceiptAt: string | null; closeReason: string | null; createdAt: string;
}
export interface GoodsReceipt {
  id: string; number: string; receivedAt: string; receivedByName: string; deliveryNote: string; notes: string;
  purchaseOrder: { id: string; number: string | null }; supplier: { id: string; name: string | null }; warehouse: { id: string; code: string | null };
  lines: { materialId: string; materialName: string; unit: string; acceptedQty: string; rejectedQty: string; rejectionReason: string }[];
  purchaseOrderStatus?: string;
}
export interface Invoice {
  id: string; number: string; invoiceNumber: string; status: string; invoiceDate: string; dueDate: string | null;
  purchaseOrder: { id: string; number: string | null }; supplier: { id: string; name: string | null };
  lines: { materialId: string; materialName: string; quantity: string; unitPrice: string; lineTotal: string }[];
  materialCost: string; transportCost: string; additionalCharges: string; taxRatePercent: string; taxAmount: string; totalAmount: string;
  match: { ok: boolean; issues: string[]; expectedTotal: string; invoiceTotal: string } | null;
  decision: { byName: string; at: string; comment: string } | null;
}
export interface Warehouse { id: string; code: string; name: string; location: string; active: boolean }
export type StockStatus = "ok" | "reorder" | "low" | "critical";
export interface StockRow {
  materialId: string; sku: string; name: string; unit: string; total: string; status: StockStatus;
  safetyStock: number; minimumStock: number; reorderPoint: number; shortfallToReorderPoint: string;
  byWarehouse: { warehouseId: string; code: string; quantity: string }[];
}
export interface StockMovement {
  id: string; type: string; delta: string; balanceAfter: string; reason: string; createdAt: string; performedByName: string;
  reference: { kind: string; number: string } | null;
  material: { id: string; sku: string; name: string; unit: string }; warehouse: { id: string; code: string; name: string };
}
