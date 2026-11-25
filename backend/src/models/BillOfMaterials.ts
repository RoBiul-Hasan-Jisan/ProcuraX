import { Schema, model } from 'mongoose';

const dec = { type: Schema.Types.Decimal128 };
const itemSchema = new Schema(
  {
    // Exactly one of material / subProduct is set (validated in the service).
    material: { type: Schema.Types.ObjectId, ref: 'Material', default: null },
    subProduct: { type: Schema.Types.ObjectId, ref: 'FinishedProduct', default: null },
    name: String, sku: String,
    quantity: { ...dec, required: true }, // per ONE unit of the finished product, up to 6 decimals
    unit: { type: String, required: true },
    wastagePercent: { ...dec, default: 0 },
  },
  { _id: false },
);
const schema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    product: { type: Schema.Types.ObjectId, ref: 'FinishedProduct', required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['draft', 'active', 'obsolete'], default: 'draft', index: true },
    effectiveFrom: { type: Date, required: true },
    items: { type: [itemSchema], validate: [(v: unknown[]) => v.length > 0, 'A BOM needs at least one component'] },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
schema.index({ product: 1, version: 1 }, { unique: true });
export const BillOfMaterials = model('BillOfMaterials', schema);
