import { Schema, model } from 'mongoose';

/** Stored output of the ML service. `isForecast` is always true: these are predictions, never actuals. */
const common = {
  material: { type: Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  sku: String, materialName: String, unit: String,
  status: { type: String, enum: ['ok', 'insufficient_data'], required: true },
  reason: String,
  modelVersion: { type: String, required: true },
  isForecast: { type: Boolean, default: true },
  generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  generatedByName: String,
  asOf: { type: Date, required: true },
  result: { type: Schema.Types.Mixed, required: true }, // the validated ML response, stored verbatim
  isDemoData: { type: Boolean, default: false },
};
export const DemandForecast = model('DemandForecast', new Schema({ ...common, selectedModel: String }, { timestamps: true }).index({ material: 1, createdAt: -1 }));
export const PriceForecast = model('PriceForecast', new Schema({ ...common, method: String }, { timestamps: true }).index({ material: 1, createdAt: -1 }));
