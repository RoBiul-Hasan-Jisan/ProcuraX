import { Schema, model, type InferSchemaType } from 'mongoose';
import { DEFAULTS_VERSION, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, ROLE_LABELS } from '../utils/permissions';

const roleSchema = new Schema(
  {
    name: { type: String, enum: ROLES, required: true, unique: true },
    label: { type: String, required: true },
    permissions: [{ type: String, enum: PERMISSIONS }],
    defaultsVersion: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export type RoleDoc = InferSchemaType<typeof roleSchema>;
export const Role = model('Role', roleSchema);

/**
 * Inserts missing default roles. Stored roles may have been customised, so they are never overwritten;
 * when the code's defaults version advances, only the NEW default permissions are added (never re-added
 * if an administrator removed an older one, because the version check runs once per bump).
 */
export async function ensureDefaultRoles(): Promise<void> {
  for (const name of ROLES) {
    await Role.updateOne(
      { name },
      {
        $setOnInsert: {
          name,
          label: ROLE_LABELS[name],
          permissions: DEFAULT_ROLE_PERMISSIONS[name],
          defaultsVersion: DEFAULTS_VERSION,
        },
      },
      { upsert: true },
    );
    await Role.updateOne(
      { name, $or: [{ defaultsVersion: { $exists: false } }, { defaultsVersion: { $lt: DEFAULTS_VERSION } }] },
      {
        $addToSet: { permissions: { $each: DEFAULT_ROLE_PERMISSIONS[name] } },
        $set: { defaultsVersion: DEFAULTS_VERSION },
      },
    );
  }
}
