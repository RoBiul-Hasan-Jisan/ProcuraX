import { Schema, model } from 'mongoose';

/** Stock set aside for a purpose. Reserved stock is not available to MRP unless the reservation belongs to a plan in the run. */
const schema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
    quantity: { type: Schema.Types.Decimal128, required: true },
    reason: { type: String, required: true },
    productionPlan: { type: Schema.Types.ObjectId, ref: 'ProductionPlan', default: null },
    status: { type: String, enum: ['active', 'released'], default: 'active', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
    releasedAt: Date,
    externalRef: { type: String, unique: true, sparse: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const StockReservation = model('StockReservation', schema);
