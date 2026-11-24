import { Schema, model } from 'mongoose';
import { REQUISITION_STATUSES } from '../domain/requisitionStatus';

const itemSchema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    // Snapshots so history stays readable if the catalogue changes.
    materialName: { type: String, required: true },
    sku: { type: String, required: true },
    category: { type: String, default: '' },
    quantity: { type: Schema.Types.Decimal128, required: true },
    unit: { type: String, required: true },
    estimatedUnitPrice: { type: Schema.Types.Decimal128, required: true },
    lineTotal: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: true },
);

const schema = new Schema(
  {
    number: { type: String, unique: true, sparse: true }, // assigned on first submit? no: on creation
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedByName: { type: String, required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    items: { type: [itemSchema], validate: [(v: unknown[]) => v.length > 0, 'At least one line item is required'] },
    currency: { type: String, default: 'BDT' },
    estimatedTotal: { type: Schema.Types.Decimal128, required: true },
    requiredDate: { type: Date, required: true },
    priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium' },
    reason: { type: String, required: true, trim: true },
    documents: [{ name: String, note: String }], // file upload arrives in Phase 6; metadata placeholder only
    status: { type: String, enum: REQUISITION_STATUSES, default: 'Draft', index: true },
    submittedAt: Date,
    approvedAt: Date,
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ', default: null },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ department: 1, status: 1, createdAt: -1 });
schema.index({ createdAt: -1 });
export const PurchaseRequisition = model('PurchaseRequisition', schema);
