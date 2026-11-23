import { z } from 'zod';
import { ROLES } from '../utils/permissions';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParam = z.object({ id: objectId });

export const listUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  role: z.enum(ROLES).optional(),
});

export const updateUserBody = z
  .object({
    role: z.enum(ROLES).nullable().optional(),
    status: z.enum(['pending', 'active', 'suspended']).optional(),
    departmentId: objectId.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const createDepartmentBody = z.object({
  code: z.string().trim().min(2).max(12),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
});
