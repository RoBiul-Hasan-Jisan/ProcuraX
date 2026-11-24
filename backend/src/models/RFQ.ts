import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    // One RFQ per approved requisition (partial unique index below enforces it while active)
    requisition: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true, index: true },
    items: [
      {
        material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
        materialName: String,
        sku: String,
        quantity: { type: Schema.Types.Decimal128, required: true },
        unit: String,
        technicalSpecs: { type: String, default: '' },
      },
    ],
    deliveryLocation: { type: String, required: true },
    deadline: { type: Date, required: true },
    paymentTerms: { type: String, default: 'Net 30' },
    deliveryRequirements: { type: String, default: '' },
    requiredDate: { type: Date, required: true },
    invitedSuppliers: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }],
    status: { type: String, enum: ['open', 'closed', 'awarded', 'cancelled'], default: 'open', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Manual award. Never set by an algorithm.
    award: {
      quotation: { type: Schema.Types.ObjectId, ref: 'SupplierQuotation' },
      supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
      awardedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      awardedByName: String,
      awardedAt: Date,
      justification: String,
      overrodeTopRank: Boolean,
    },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
// A requisition can have only one non-cancelled RFQ.
schema.index(
  { requisition: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['open', 'closed', 'awarded'] } } },
);
schema.index({ invitedSuppliers: 1, status: 1 });
export const RFQ = model('RFQ', schema);
