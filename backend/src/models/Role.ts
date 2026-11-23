import { Schema, model, type InferSchemaType } from 'mongoose';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, ROLE_LABELS } from '../utils/permissions';

const roleSchema = new Schema(
  {
    name: { type: String, enum: ROLES, required: true, unique: true },
    label: { type: String, required: true },
    permissions: [{ type: String, enum: PERMISSIONS }],
  },
  { timestamps: true },
);

export type RoleDoc = InferSchemaType<typeof roleSchema>;
export const Role = model('Role', roleSchema);

/** Inserts any missing default roles. Existing (possibly customised) roles are never overwritten. */
export async function ensureDefaultRoles(): Promise<void> {
  await Promise.all(
    ROLES.map((name) =>
      Role.updateOne(
        { name },
        { $setOnInsert: { name, label: ROLE_LABELS[name], permissions: DEFAULT_ROLE_PERMISSIONS[name] } },
        { upsert: true },
      ),
    ),
  );
}
