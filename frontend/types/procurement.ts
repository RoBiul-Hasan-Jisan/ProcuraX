export interface Category { id: string; name: string; code: string }
export interface Material {
  id: string; sku: string; name: string; category: { id: string; name: string | null }; description: string; unit: string;
  technicalSpecs: string; minimumStock: number; safetyStock: number; reorderPoint: number; averagePurchasePrice: string | null;
  currency: string; active: boolean;
}
export interface Supplier {
  id: string; supplierCode: string; companyName: string; contactPerson: string; email: string; phone: string; address: string;
  registrationNumber: string; taxId: string; paymentTerms: string; paymentTermsDays: number; verificationStatus: string; status: string;
  materialCategories: { id: string; name?: string }[];
  history: { completedOrders: number; onTimeDeliveries: number; unitsReceived: number; unitsAccepted: number; onTimeRate: number | null; qualityAcceptanceRate: number | null };
  bankInfo?: { bankName: string; accountName: string; accountNumber: string };
}
export interface Department { _id: string; code: string; name: string }
export interface RequisitionItem { id: string; materialId: string; materialName: string; sku: string; category: string; quantity: string; unit: string; estimatedUnitPrice: string; lineTotal: string }
export interface ApprovalStepView { order: number; role: string; label: string; status: string; decidedByName: string | null; decidedAt: string | null; comment: string | null }
export interface Requisition {
  id: string; number: string; status: string; priority: string; requestedBy: { id: string; name: string }; department: { id: string; name: string | null };
  items: RequisitionItem[]; currency: string; estimatedTotal: string; requiredDate: string; reason: string; rfqId: string | null; createdAt: string; submittedAt: string | null;
  approval?: { id: string; status: string; currentStep: number; cycle: number; steps: ApprovalStepView[] } | null;
  history?: { action: string; stepLabel: string | null; actorName: string; actorRole: string | null; comment: string | null; at: string }[];
}
export interface Rfq {
  id: string; number: string; status: string; deadline: string; requiredDate: string; deliveryLocation: string; paymentTerms: string; deliveryRequirements: string;
  items: { materialId: string; materialName: string; sku: string; quantity: string; unit: string; technicalSpecs: string }[];
  requisitionId?: string; requisitionNumber?: string | null; invitedSuppliers?: { id: string; name?: string }[]; quotationCount?: number;
  myQuotationStatus?: string | null; award?: { quotationId: string; supplierId: string; awardedByName: string; justification: string | null; overrodeTopRank: boolean } | null;
}
export interface Quotation {
  id: string; status: string; currency: string; lines: { materialId: string; materialName: string; quantity: string; unit: string; unitPrice: string; lineTotal: string }[];
  materialCost: string; transportCost: string; additionalCharges: string; taxRatePercent: string; taxAmount: string; totalLandedCost: string;
  deliveryDays: number; paymentTerms: string; paymentTermsDays: number; validUntil: string; notes: string;
}
export interface Weights { price: number; delivery: number; quality: number; leadTime: number; payment: number }
export interface ComparisonRow {
  quotationId: string; supplierId: string; supplierName: string; status: string; verificationStatus: string;
  unitPrices: { materialId: string; materialName: string; unitPrice: string; averagePurchasePrice: string | null; percentVsAverage: number | null; flagged: boolean }[];
  materialCost: string; transportCost: string; additionalCharges: string; taxAmount: string; totalLandedCost: string;
  deliveryDays: number; paymentTerms: string; validUntil: string; expired: boolean;
  quality: { completedOrders: number; onTimeRate: number | null; qualityAcceptanceRate: number | null };
  evaluation: {
    scores: Weights; overall: number; rank: number; insufficientHistory: boolean; reasons: string[];
    costDifference: string; costDifferencePercent: number; deliveryDifferenceDays: number;
  };
}
export interface Comparison {
  rfq: { id: string; number: string; status: string; deadline: string; award: { quotationId: string } | null };
  weights: Weights; rawWeights: Weights; advisory: string; rows: ComparisonRow[];
}
export const REQUISITION_STATUSES = ["Draft", "Submitted", "Under Review", "Approved", "Rejected", "Modification Requested", "RFQ Created", "Ordered", "Partially Fulfilled", "Completed", "Cancelled"];
