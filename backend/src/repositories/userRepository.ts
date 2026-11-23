import { Types } from 'mongoose';
import { User } from '../models/User';
import { Role } from '../models/Role';
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type RoleName } from '../utils/permissions';

export interface ProfileRecord {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  role: RoleName | null;
  status: 'pending' | 'active' | 'suspended';
  departmentId: string | null;
  supplierId: string | null;
}

function toRecord(doc: any): ProfileRecord {
  return {
    id: String(doc._id),
    firebaseUid: doc.firebaseUid,
    email: doc.email,
    displayName: doc.displayName,
    role: doc.role ?? null,
    status: doc.status,
    departmentId: doc.department ? String(doc.department) : null,
    supplierId: doc.supplier ? String(doc.supplier) : null,
  };
}

export const userRepository = {
  async findByFirebaseUid(uid: string): Promise<ProfileRecord | null> {
    const doc = await User.findOne({ firebaseUid: uid }).lean();
    return doc ? toRecord(doc) : null;
  },

  async findByEmail(email: string): Promise<ProfileRecord | null> {
    const doc = await User.findOne({ email: email.toLowerCase() }).lean();
    return doc ? toRecord(doc) : null;
  },

  async create(input: {
    firebaseUid: string;
    email: string;
    displayName: string;
    role: RoleName | null;
    status: 'pending' | 'active';
  }): Promise<ProfileRecord> {
    const doc = await User.create(input);
    return toRecord(doc.toObject());
  },

  async touchLogin(id: string): Promise<void> {
    await User.updateOne({ _id: new Types.ObjectId(id) }, { $set: { lastLoginAt: new Date() } });
  },

  /** Permissions come from the database role document; defaults are the fallback. */
  async permissionsForRole(role: RoleName | null): Promise<Permission[]> {
    if (!role) return [];
    const doc = await Role.findOne({ name: role }).lean();
    return (doc?.permissions as Permission[] | undefined) ?? DEFAULT_ROLE_PERMISSIONS[role];
  },

  async list(filter: { status?: string; role?: string }, page: number, limit: number) {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.role) query.role = filter.role;
    const [items, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(query),
    ]);
    return { items: items.map(toRecord), total };
  },

  async update(
    id: string,
    patch: { role?: RoleName | null; status?: 'pending' | 'active' | 'suspended'; departmentId?: string | null },
  ) {
    const set: Record<string, unknown> = {};
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.departmentId !== undefined) set.department = patch.departmentId;
    const doc = await User.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
    return doc ? toRecord(doc) : null;
  },
};
