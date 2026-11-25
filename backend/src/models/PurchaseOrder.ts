import { Schema, model } from 'mongoose';
import { PO_STATUSES } from '../domain/purchaseOrder';

const dec = { type: Schema.Types.Decimal128 };
const lineSchema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    materialName: String, sku: String, unit: String,
    quantity: { ...dec, required: true },
    unitPrice: { ...dec, required: true },
    lineTotal: { ...dec, required: true },
    acceptedQty: { ...dec, default: 0 },
    rejectedQty: { ...dec, default: 0 },
    invoicedQty: { ...dec, default: 0 },
  },
  { _id: false },
);

const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ', required: true },
    requisition: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true },
    quotation: { type: Schema.Types.ObjectId, ref: 'SupplierQuotation', required: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    lines: { type: [lineSchema], validate: [(v: unknown[]) => v.length > 0, 'At least one line is required'] },
    currency: { type: String, default: 'BDT' },
    materialCost: { ...dec, required: true },
    transportCost: { ...dec, default: 0 },
    additionalCharges: { ...dec, default: 0 },
    taxRatePercent: { ...dec, default: 0 },
    taxAmount: { ...dec, required: true },
    totalAmount: { ...dec, required: true },
    paymentTerms: String,
    paymentTermsDays: { type: Number, default: 0 },
    deliveryLocation: String,
    deliveryDays: Number,
    expectedDeliveryDate: Date,
    status: { type: String, enum: PO_STATUSES, default: 'draft', index: true },
    receiptSeq: { type: Number, default: 0 }, // optimistic gate for concurrent receipts
    lastReceiptAt: Date,
    closeReason: String,
    issuedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// One live PO per RFQ.
// Reports filter and group by issue date and expected delivery date.
schema.index({ issuedAt: 1, status: 1 });
schema.index({ expectedDeliveryDate: 1, status: 1 });
schema.index({ rfq: 1 }, { unique: true, partialFilterExpression: { status: { $ne: 'cancelled' } } });
export const PurchaseOrder = model('PurchaseOrder', schema);
