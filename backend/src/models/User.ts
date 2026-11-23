import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLES } from '../utils/permissions';

/**
 * Application profile for a Firebase-authenticated person.
 * NOTE: no password or token fields. Firebase owns credentials.
 */
const userSchema = new Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    role: { type: String, enum: [...ROLES, null], default: null },
    status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending', index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    // Link to a Supplier record (Phase 2) for users with the supplier role.
    supplier: { type: Schema.Types.ObjectId, default: null },
    lastLoginAt: { type: Date, default: null },
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, status: 1 });

export type UserDoc = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);
