import { Schema, model, type InferSchemaType } from 'mongoose';

const departmentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type DepartmentDoc = InferSchemaType<typeof departmentSchema>;
export const Department = model('Department', departmentSchema);
