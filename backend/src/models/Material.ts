import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: Schema.Types.ObjectId, ref: 'MaterialCategory', required: true, index: true },
    description: { type: String, default: '' },
    unit: { type: String, required: true, trim: true },
    technicalSpecs: { type: String, default: '' },
    preferredSuppliers: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }],
    minimumStock: { type: Number, default: 0, min: 0 },
    safetyStock: { type: Number, default: 0, min: 0 },
    reorderPoint: { type: Number, default: 0, min: 0 },
    averagePurchasePrice: { type: Schema.Types.Decimal128, default: null },
    currency: { type: String, default: 'BDT' },
    active: { type: Boolean, default: true, index: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ name: 'text', sku: 'text', description: 'text' });
export const Material = model('Material', schema);
