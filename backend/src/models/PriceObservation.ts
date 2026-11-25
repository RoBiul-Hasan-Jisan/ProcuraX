import { Schema, model } from 'mongoose';

/** One observed unit price for a material (from a quotation or purchase). Used for price trends and anomaly baselines. */
const schema = new Schema(
  {
    material: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    unitPrice: { type: Schema.Types.Decimal128, required: true },
    observedAt: { type: Date, required: true },
    source: { type: String, enum: ['purchase_order', 'quotation', 'manual', 'demo'], default: 'manual' },
    externalRef: { type: String, unique: true, sparse: true }, // idempotent seeding
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ material: 1, observedAt: 1 });
export const PriceObservation = model('PriceObservation', schema);
