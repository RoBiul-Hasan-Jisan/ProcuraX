import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);
export const MaterialCategory = model('MaterialCategory', schema);
