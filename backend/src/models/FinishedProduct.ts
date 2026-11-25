import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    unit: { type: String, required: true, default: 'MT', trim: true },
    description: { type: String, default: '' },
    /** A product made in-house that is a component of another product's BOM (multi-level BOM). */
    intermediate: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const FinishedProduct = model('FinishedProduct', schema);
