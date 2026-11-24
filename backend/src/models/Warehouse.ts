import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const Warehouse = model('Warehouse', schema);
