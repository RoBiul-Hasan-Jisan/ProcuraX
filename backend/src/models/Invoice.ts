import { Schema, model } from 'mongoose';

const dec = { type: Schema.Types.Decimal128 };
const schema = new Schema(
  {
    number: { type: String, required: true, unique: true }, // internal reference
    invoiceNumber: { type: String, required: true, trim: true }, // supplier's own number
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    lines: [{ material: { type: Schema.Types.ObjectId, ref: 'Material' }, materialName: String, quantity: dec, unitPrice: dec, lineTotal: dec, _id: false }],
    materialCost: dec, transportCost: dec, additionalCharges: dec, taxRatePercent: dec, taxAmount: dec,
    totalAmount: { ...dec, required: true }, // always server-computed
    invoiceDate: { type: Date, required: true },
    dueDate: Date,
    match: { ok: Boolean, issues: [String], expectedTotal: String, invoiceTotal: String, checkedAt: Date },
    status: { type: String, enum: ['pending_verification', 'verified', 'disputed'], default: 'pending_verification', index: true },
    decision: { by: { type: Schema.Types.ObjectId, ref: 'User' }, byName: String, at: Date, comment: String },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// The same supplier invoice number can be recorded only once.
schema.index({ invoiceDate: -1 }); // invoice discrepancy report
schema.index({ status: 1, invoiceDate: -1 });
schema.index({ supplier: 1, invoiceNumber: 1 }, { unique: true });
export const Invoice = model('Invoice', schema);
