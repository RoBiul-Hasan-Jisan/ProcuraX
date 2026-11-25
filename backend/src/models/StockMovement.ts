import { Schema, model } from 'mongoose';
import { MOVEMENT_TYPES } from '../domain/inventory';

/** Append-only ledger. There is no update or delete endpoint; corrections are new adjustment movements. */
const schema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
    delta: { type: Schema.Types.Decimal128, required: true }, // signed
    balanceAfter: { type: Schema.Types.Decimal128, required: true },
    reason: { type: String, default: '' },
    reference: { kind: String, id: Schema.Types.ObjectId, number: String },
    performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    performedByName: String,
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.index({ createdAt: -1 });
schema.index({ type: 1, createdAt: -1 }); // consumption and forecast-performance reports
export const StockMovement = model('StockMovement', schema);
