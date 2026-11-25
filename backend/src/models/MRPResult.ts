import { Schema, model } from 'mongoose';

/**
 * One row per material per run. Quantities are stored as exact decimal STRINGS: a result is an immutable snapshot
 * of what was calculated, not a live balance.
 */
const schema = new Schema(
  {
    run: { type: Schema.Types.ObjectId, ref: 'MRPRun', required: true, index: true },
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    sku: String, name: String, category: String, unit: String,
    grossRequirement: String, adjustedRequirement: String, onHand: String, reservedOther: String, reservedForPlans: String, available: String,
    scheduledReceiptsTotal: String, scheduledReceiptsUsed: String, safetyStock: String, netRequirement: String,
    plannedOrders: [{ needDate: Date, quantity: String, releaseDate: Date, expectedArrival: Date, late: Boolean, daysLate: Number, urgency: String, _id: false }],
    firstNeedDate: Date,
    urgency: { type: String, enum: ['critical', 'high', 'medium', 'low', null], default: null },
    leadTimeDays: Number, leadTimeAssumed: Boolean,
    preferredSupplier: { id: String, name: String },
    supplierNote: String,
    exceedsSupplierCapacity: Boolean, ordersNeededForCapacity: Number, supplierCapacity: String,
    estimatedCost: String,
    demands: [{ plan: String, date: Date, gross: String, adjusted: String, path: [String], _id: false }],
    receipts: [{ reference: String, date: Date, quantity: String, _id: false }],
    lateReceipts: [{ reference: String, date: Date, quantity: String, _id: false }],
    explanation: [String],
  },
  { timestamps: true },
);
export const MRPResult = model('MRPResult', schema);
