import { Schema, model } from 'mongoose';
import { PLAN_STATUSES } from '../domain/productionPlan';

const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    product: { type: Schema.Types.ObjectId, ref: 'FinishedProduct', required: true, index: true },
    quantity: { type: Schema.Types.Decimal128, required: true },
    unit: { type: String, required: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: PLAN_STATUSES, default: 'planned', index: true },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Stable key used only by the idempotent demo seed. */
    externalRef: { type: String, unique: true, sparse: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const ProductionPlan = model('ProductionPlan', schema);
