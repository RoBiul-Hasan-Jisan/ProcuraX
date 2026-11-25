import { Schema, model } from 'mongoose';
import { RISK_CATEGORIES, RISK_STATUSES, SEVERITY_ORDER } from '../domain/risk';

const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    dedupeKey: { type: String, required: true, unique: true }, // one alert per underlying condition
    category: { type: String, enum: RISK_CATEGORIES, required: true, index: true },
    severity: { type: String, enum: SEVERITY_ORDER, required: true, index: true },
    title: { type: String, required: true },
    material: { id: String, name: String, sku: String },
    supplier: { id: String, name: String },
    reference: { kind: String, id: String, number: String },
    reason: { type: String, required: true },
    evidence: { type: Schema.Types.Mixed, default: {} },
    recommendedAction: { type: String, required: true },
    status: { type: String, enum: RISK_STATUSES, default: 'open', index: true },
    detectedAt: { type: Date, default: Date.now },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedToName: { type: String, default: '' },
    history: [{ at: Date, by: String, from: String, to: String, note: String, _id: false }],
    resolutionNote: { type: String, default: '' },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const RiskAlert = model('RiskAlert', schema);
