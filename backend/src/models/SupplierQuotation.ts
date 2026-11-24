import { Schema, model } from 'mongoose';

const lineSchema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    materialName: String,
    quantity: { type: Schema.Types.Decimal128, required: true },
    unit: String,
    unitPrice: { type: Schema.Types.Decimal128, required: true },
    lineTotal: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: false },
);

const schema = new Schema(
  {
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    lines: { type: [lineSchema], validate: [(v: unknown[]) => v.length > 0, 'At least one line is required'] },
    currency: { type: String, default: 'BDT' },
    materialCost: { type: Schema.Types.Decimal128, required: true },
    transportCost: { type: Schema.Types.Decimal128, default: 0 },
    additionalCharges: { type: Schema.Types.Decimal128, default: 0 },
    taxRatePercent: { type: Schema.Types.Decimal128, default: 0 },
    taxAmount: { type: Schema.Types.Decimal128, required: true },
    totalLandedCost: { type: Schema.Types.Decimal128, required: true },
    deliveryDays: { type: Number, required: true, min: 1 },
    paymentTerms: { type: String, required: true },
    paymentTermsDays: { type: Number, default: 0, min: 0 },
    validUntil: { type: Date, required: true },
    notes: { type: String, default: '' },
    documents: [{ name: String, note: String }],
    status: { type: String, enum: ['submitted', 'withdrawn', 'awarded', 'not_selected'], default: 'submitted', index: true },
    submittedAt: { type: Date, default: Date.now },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// One quotation per supplier per RFQ (supplier updates it before the deadline)
schema.index({ rfq: 1, supplier: 1 }, { unique: true });
export const SupplierQuotation = model('SupplierQuotation', schema);
