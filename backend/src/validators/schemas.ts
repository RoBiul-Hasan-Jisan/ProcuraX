import { z } from 'zod';
import { ROLES } from '../utils/permissions';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParam = z.object({ id: objectId });

export const listUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  role: z.enum(ROLES).optional(),
});

export const updateUserBody = z
  .object({
    role: z.enum(ROLES).nullable().optional(),
    status: z.enum(['pending', 'active', 'suspended']).optional(),
    departmentId: objectId.nullable().optional(),
    supplierId: objectId.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const createDepartmentBody = z.object({
  code: z.string().trim().min(2).max(12),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
});

/* ---------- Phase 2 ---------- */
const decimalString = (label: string) =>
  z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), `${label} must be a non-negative number with at most 4 decimals`);
const positive = (label: string) => decimalString(label).refine((v) => Number(v) > 0, `${label} must be greater than zero`);
const futureDate = z.coerce.date();
const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
const boolish = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listMaterialsQuery = z.object({ ...page, search: z.string().trim().max(80).optional(), category: objectId.optional(), active: boolish.optional() });
export const materialBody = z.object({
  sku: z.string().trim().min(2).max(40), name: z.string().trim().min(2).max(120), category: objectId,
  description: z.string().trim().max(500).default(''), unit: z.string().trim().min(1).max(20),
  technicalSpecs: z.string().trim().max(1000).default(''), preferredSuppliers: z.array(objectId).max(20).default([]),
  minimumStock: z.number().min(0).default(0), safetyStock: z.number().min(0).default(0), reorderPoint: z.number().min(0).default(0),
  averagePurchasePrice: decimalString('Average price').nullable().optional(), active: z.boolean().default(true),
  leadTimeDays: z.number().int().min(0).max(730).default(0), supplierCapacity: decimalString('Supplier capacity').nullable().optional(),
});
export const materialUpdateBody = materialBody.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const listSuppliersQuery = z.object({
  ...page, search: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive', 'blocked']).optional(), verification: z.enum(['pending', 'verified', 'rejected']).optional(),
});
const bankInfo = z.object({ bankName: z.string().trim().max(80).default(''), accountName: z.string().trim().max(80).default(''), accountNumber: z.string().trim().max(40).default('') });
export const supplierBody = z.object({
  companyName: z.string().trim().min(2).max(120), contactPerson: z.string().trim().min(2).max(80), email: z.string().trim().email(),
  phone: z.string().trim().max(30).default(''), address: z.string().trim().max(300).default(''),
  registrationNumber: z.string().trim().max(60).default(''), taxId: z.string().trim().max(60).default(''),
  materialCategories: z.array(objectId).max(20).default([]), paymentTerms: z.string().trim().max(60).default('Net 30'),
  paymentTermsDays: z.number().int().min(0).max(365).default(30), bankInfo: bankInfo.optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).optional(), status: z.enum(['active', 'inactive', 'blocked']).optional(),
});
export const supplierUpdateBody = supplierBody.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const supplierSelfBody = z.object({
  contactPerson: z.string().trim().min(2).max(80), email: z.string().trim().email(), phone: z.string().trim().max(30),
  address: z.string().trim().max(300), registrationNumber: z.string().trim().max(60), taxId: z.string().trim().max(60), bankInfo,
}).partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const requisitionBody = z.object({
  items: z.array(z.object({ materialId: objectId, quantity: positive('Quantity'), estimatedUnitPrice: decimalString('Estimated unit price') })).min(1).max(50),
  requiredDate: futureDate.refine((d) => d.getTime() > Date.now(), 'Required date must be in the future'),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).default('Medium'),
  reason: z.string().trim().min(5, 'Please give a reason').max(1000),
});
export const listRequisitionsQuery = z.object({
  ...page, status: z.string().trim().max(40).optional(), search: z.string().trim().max(80).optional(),
  department: objectId.optional(), mine: boolish.optional(),
});
export const cancelBody = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(500) });
export const decisionBody = z.object({ action: z.enum(['approve', 'reject', 'request_modification']), comment: z.string().trim().max(1000).default('') });

export const rfqBody = z.object({
  requisitionId: objectId, deliveryLocation: z.string().trim().min(2).max(200),
  deadline: futureDate, paymentTerms: z.string().trim().max(100).default('Net 30'),
  deliveryRequirements: z.string().trim().max(1000).default(''), invitedSupplierIds: z.array(objectId).min(1, 'Invite at least one supplier').max(30),
});
export const listRfqsQuery = z.object({ ...page, status: z.enum(['open', 'closed', 'awarded', 'cancelled']).optional() });
export const quotationBody = z.object({
  lines: z.array(z.object({ materialId: objectId, unitPrice: positive('Unit price') })).min(1).max(50),
  transportCost: decimalString('Transportation cost').default('0'), additionalCharges: decimalString('Additional charges').default('0'),
  taxRatePercent: decimalString('Tax rate').default('0'), deliveryDays: z.number().int().min(1).max(730),
  paymentTerms: z.string().trim().min(2).max(100), paymentTermsDays: z.number().int().min(0).max(365).default(0),
  validUntil: futureDate, notes: z.string().trim().max(1000).default(''),
});
export const weightsBody = z.object({
  price: z.number().min(0).max(100), delivery: z.number().min(0).max(100), quality: z.number().min(0).max(100),
  leadTime: z.number().min(0).max(100), payment: z.number().min(0).max(100),
}).refine((w) => w.price + w.delivery + w.quality + w.leadTime + w.payment > 0, 'At least one weight must be greater than zero');
export const comparisonQuery = z.object({
  price: z.coerce.number().min(0).optional(), delivery: z.coerce.number().min(0).optional(), quality: z.coerce.number().min(0).optional(),
  leadTime: z.coerce.number().min(0).optional(), payment: z.coerce.number().min(0).optional(),
});
export const awardBody = z.object({ quotationId: objectId, justification: z.string().trim().max(1000).default('') });
export const approvalSettingsBody = z.object({ financeThreshold: decimalString('Threshold'), currency: z.string().trim().length(3).toUpperCase() });

export const linkSupplierBody = z.object({ supplierId: objectId.nullable() });

/* ---------- Phase 3 ---------- */
const qty = (label: string) => decimalString(label).refine((v) => Number(v) > 0, `${label} must be greater than zero`);
const qtyOrZero = (label: string) => decimalString(label);
export const createPoBody = z.object({ rfqId: objectId });
export const listPoQuery = z.object({ ...page, status: z.enum(['draft', 'issued', 'partially_received', 'received', 'closed', 'cancelled']).optional(), supplier: objectId.optional() });
export const reasonBody = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(500) });

export const receiptBody = z.object({
  purchaseOrderId: objectId, warehouseId: objectId, deliveryNote: z.string().trim().max(100).default(''), notes: z.string().trim().max(500).default(''),
  lines: z.array(z.object({ materialId: objectId, acceptedQty: qtyOrZero('Accepted quantity').default('0'), rejectedQty: qtyOrZero('Rejected quantity').default('0'), rejectionReason: z.string().trim().max(300).optional() })).min(1).max(50),
});
export const listReceiptsQuery = z.object({ ...page, purchaseOrder: objectId.optional() });

export const invoiceBody = z.object({
  purchaseOrderId: objectId, invoiceNumber: z.string().trim().min(1).max(60), invoiceDate: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86_400_000, 'Invoice date cannot be in the future'),
  lines: z.array(z.object({ materialId: objectId, quantity: qty('Quantity'), unitPrice: qty('Unit price') })).min(1).max(50),
  transportCost: decimalString('Transportation cost').default('0'), additionalCharges: decimalString('Additional charges').default('0'), taxRatePercent: decimalString('Tax rate').default('0'),
});
export const listInvoicesQuery = z.object({ ...page, status: z.enum(['pending_verification', 'verified', 'disputed']).optional(), purchaseOrder: objectId.optional() });
export const invoiceDecisionBody = z.object({ action: z.enum(['verify', 'dispute']), comment: z.string().trim().max(500).default('') });

export const warehouseBody = z.object({ code: z.string().trim().min(2).max(12), name: z.string().trim().min(2).max(80), location: z.string().trim().max(200).default('') });
export const warehouseUpdateBody = z.object({ name: z.string().trim().min(2).max(80), location: z.string().trim().max(200), active: z.boolean() }).partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const stockQuery = z.object({ search: z.string().trim().max(80).optional(), status: z.enum(['ok', 'reorder', 'low', 'critical']).optional(), warehouse: objectId.optional() });
export const movementsQuery = z.object({ ...page, material: objectId.optional(), warehouse: objectId.optional(), type: z.enum(['opening_balance', 'receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment']).optional() });
export const adjustmentBody = z.object({ materialId: objectId, warehouseId: objectId, direction: z.enum(['increase', 'decrease']), quantity: qty('Quantity'), reason: z.string().trim().min(5, 'A reason is required').max(300) });
export const issueBody = z.object({ materialId: objectId, warehouseId: objectId, quantity: qty('Quantity'), reason: z.string().trim().min(3, 'A reason is required').max(300) });
export const transferBody = z.object({ materialId: objectId, fromWarehouseId: objectId, toWarehouseId: objectId, quantity: qty('Quantity'), reason: z.string().trim().min(3).max(300) });

/* ---------- Phase 4 ---------- */
const decN = (label: string, places: number) =>
  z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(v), `${label} must be a non-negative number with at most ${places} decimals`);
export const listProductsQuery = z.object({ search: z.string().trim().max(80).optional(), active: boolish.optional() });
export const productBody = z.object({ code: z.string().trim().min(2).max(20), name: z.string().trim().min(2).max(120), unit: z.string().trim().min(1).max(10).default('MT'), description: z.string().trim().max(300).default(''), intermediate: z.boolean().default(false) });
export const productUpdateBody = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(300), intermediate: z.boolean(), active: z.boolean() }).partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const listBomsQuery = z.object({ product: objectId.optional(), status: z.enum(['draft', 'active', 'obsolete']).optional() });
export const bomBody = z.object({
  productId: objectId, effectiveFrom: z.coerce.date(), notes: z.string().trim().max(500).default(''),
  items: z.array(z.object({
    materialId: objectId.nullable().optional(), subProductId: objectId.nullable().optional(),
    quantity: decN('Quantity', 6).refine((v) => Number(v) > 0, 'Quantity must be greater than zero'), wastagePercent: decN('Wastage', 2).default('0'),
  })).min(1, 'Add at least one component').max(60),
});

export const listPlansQuery = z.object({ ...page, status: z.enum(['planned', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional(), product: objectId.optional() });
export const planBody = z.object({
  productId: objectId, quantity: decN('Quantity', 3).refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  startDate: z.coerce.date(), endDate: z.coerce.date(), notes: z.string().trim().max(500).default(''),
});
export const planStatusBody = z.object({ status: z.enum(['planned', 'confirmed', 'in_progress', 'completed', 'cancelled']) });

export const listReservationsQuery = z.object({ status: z.enum(['active', 'released']).optional(), material: objectId.optional() });
export const reservationBody = z.object({ materialId: objectId, quantity: qty('Quantity'), reason: z.string().trim().min(3, 'A reason is required').max(300), productionPlanId: objectId.nullable().optional() });

export const mrpRunBody = z.object({ planIds: z.array(objectId).min(1, 'Select at least one production plan').max(50), horizonDays: z.number().int().min(1).max(365) });
export const listRunsQuery = z.object({ ...page });
export const reorderQuery = z.object({ onlyNeeded: boolish.default(true) });
export const mrpSettingsBody = z.object({
  horizonDays: z.number().int().min(1).max(365), defaultLeadTimeDays: z.number().int().min(0).max(365),
  urgency: z.object({ highDays: z.number().int().min(0).max(60), mediumDays: z.number().int().min(0).max(120) }).refine((u) => u.mediumDays >= u.highDays, 'Medium threshold must be at least the high threshold'),
  reorder: z.object({ lookbackDays: z.number().int().min(7).max(730), coverageDays: z.number().int().min(0).max(365) }),
});

/* ---------- Phase 5: forecasting, risk, assistant ---------- */
export const forecastRunBody = z.object({ materialId: objectId });
export const forecastListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), kind: z.enum(['demand', 'price']).default('demand'),
});
export const materialIdParam = z.object({ materialId: objectId });
export const riskListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['open', 'acknowledged', 'investigating', 'resolved', 'dismissed']).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  category: z.string().max(40).optional(),
  assignedToMe: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export const riskReviewBody = z.object({
  status: z.enum(['acknowledged', 'investigating', 'resolved', 'dismissed']).optional(),
  assignedTo: objectId.nullable().optional(),
  note: z.string().trim().max(2000).optional(),
}).refine((v) => v.status !== undefined || v.assignedTo !== undefined || !!v.note, { message: 'Provide a status, an assignee or a note' });
export const assistantBody = z.object({ question: z.string().trim().min(3, 'Ask a full question').max(500) });

/* ---------- Phase 6: notifications, audit ---------- */
export const notificationListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export const auditListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  entityType: z.string().max(40).optional(), entityId: z.string().max(60).optional(), action: z.string().max(60).optional(), actor: z.string().max(60).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), search: z.string().trim().max(100).optional(),
});

/* ---------- Phase 6: documents ---------- */
export const documentUploadFields = z.object({ entityType: z.enum(['supplier', 'quotation', 'requisition', 'purchase_order', 'goods_receipt', 'invoice']), entityId: objectId, description: z.string().trim().max(300).optional() });
export const documentListQuery = z.object({ entityType: z.enum(['supplier', 'quotation', 'requisition', 'purchase_order', 'goods_receipt', 'invoice']), entityId: objectId });

/* ---------- Phase 6: reports ---------- */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Not a valid date');
export const reportQuery = z.object({
  from: isoDay.optional(), to: isoDay.optional(), departmentId: objectId.optional(), supplierId: objectId.optional(), materialId: objectId.optional(),
  categoryId: objectId.optional(), warehouseId: objectId.optional(), poStatus: z.enum(['draft', 'issued', 'partially_received', 'received', 'closed', 'cancelled']).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The start date must not be after the end date', path: ['from'] });
export const reportExportQuery = z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') });
export const reportKeyParam = z.object({ key: z.string().regex(/^[a-z-]{3,40}$/) });
