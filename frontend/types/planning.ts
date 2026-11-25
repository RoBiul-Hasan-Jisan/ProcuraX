export interface FinishedProduct { id: string; code: string; name: string; unit: string; description: string; intermediate: boolean; active: boolean }
export interface BomItem { materialId: string | null; subProductId: string | null; name: string; sku: string; quantity: string; unit: string; wastagePercent: string }
export interface Bom {
  id: string; number: string; version: number; status: "draft" | "active" | "obsolete"; effectiveFrom: string; notes: string;
  product: { id: string; code: string | null; name: string | null; unit: string | null }; items: BomItem[];
}
export interface ProductionPlan {
  id: string; number: string; status: string; quantity: string; unit: string; startDate: string; endDate: string; notes: string;
  product: { id: string; code: string | null; name: string | null };
}
export interface Reservation {
  id: string; material: { id: string; sku: string | null; name: string | null; unit: string | null }; quantity: string; reason: string; status: string;
  productionPlanId: string | null; productionPlanNumber: string | null; createdByName: string; createdAt: string;
}
export type Urgency = "critical" | "high" | "medium" | "low";
export interface PlannedOrder { needDate: string; quantity: string; releaseDate: string; expectedArrival: string; late: boolean; daysLate: number; urgency: Urgency }
export interface MrpResult {
  id: string; material: string; sku: string; name: string; category: string; unit: string;
  grossRequirement: string; adjustedRequirement: string; onHand: string; reservedOther: string; reservedForPlans: string; available: string;
  scheduledReceiptsTotal: string; scheduledReceiptsUsed: string; safetyStock: string; netRequirement: string;
  plannedOrders: PlannedOrder[]; firstNeedDate: string | null; urgency: Urgency | null; leadTimeDays: number; leadTimeAssumed: boolean;
  preferredSupplier: { id: string; name: string } | null; supplierNote: string | null; exceedsSupplierCapacity: boolean; ordersNeededForCapacity: number | null;
  estimatedCost: string | null;
  demands: { plan: string; date: string; gross: string; adjusted: string; path: string[] }[];
  receipts: { reference: string; date: string; quantity: string }[]; lateReceipts: { reference: string; date: string; quantity: string }[]; explanation: string[];
}
export interface MrpRunSummary {
  materials: number; withShortage: number; covered: number; critical: number; high: number; medium: number; low: number;
  capacityWarnings: number; noEligibleSupplier: number; estimatedCost: string; estimatedCostNote: string;
}
export interface MrpRun {
  id: string; number: string; runDate: string; horizonDays: number; status: "completed" | "completed_with_issues"; createdByName: string;
  summary: MrpRunSummary; issues: { plan: string; message: string }[]; planCount?: number;
  inputs?: { plans: { number: string; product: string; quantity: string; unit: string; startDate: string; status: string }[]; excludedPlans: { plan: string; reason: string }[]; bomsUsed: { number: string; version: number }[] };
  results?: MrpResult[];
}
export interface ReorderRow {
  materialId: string; sku: string; name: string; category: string; unit: string; onHand: string; reserved: string; onOrder: string; leadTimeDays: number; leadTimeAssumed: boolean;
  preferredSupplier: { id: string; name: string } | null; supplierNote: string | null;
  averageDailyConsumption: string; leadTimeDemand: string; safetyStock: string; reorderPoint: string; basis: "consumption" | "configured";
  inventoryPosition: string; reorderNow: boolean; suggestedQuantity: string; plannedOrderDate: string | null; expectedDelivery: string | null; explanation: string[];
}
