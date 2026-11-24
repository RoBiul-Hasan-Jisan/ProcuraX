import { Router } from 'express';
import { establishSession } from '../services/authService';
import { getOverview } from '../services/dashboardService';
import { userRepository } from '../repositories/userRepository';
import { Department } from '../models/Department';
import { Role } from '../models/Role';
import {
  loadUserProfile,
  requireActiveAccount,
  requirePermission,
  verifyFirebaseAuth,
} from '../middlewares/authorization';
import { validate } from '../middlewares/validation';
import { authLimiter } from '../middlewares/rateLimiter';
import { sendSuccess, badRequest, conflict, notFound, forbidden, unauthorized } from '../utils/apiResponse';
import { createDepartmentBody, idParam, listUsersQuery, updateUserBody } from '../validators/schemas';
import { ROLE_LABELS } from '../utils/permissions';
import { linkUserToSupplier } from '../services/supplierService';
import catalogRoutes from './catalog';
import procurementRoutes from './procurement';
import purchasingRoutes from './purchasing';

const router = Router();

/* ---------- Auth ---------- */

// Token only: provisions the MongoDB profile on first sign-in (never trusts a client-supplied role).
router.post('/auth/session', authLimiter, verifyFirebaseAuth, async (req, res) => {
  if (!req.auth) throw unauthorized();
  const { profile, permissions, created } = await establishSession(req.auth);
  sendSuccess(
    res,
    { user: { ...profile, roleLabel: profile.role ? ROLE_LABELS[profile.role] : null }, permissions },
    created ? 'Profile created' : 'Session established',
    created ? 201 : 200,
  );
});

// Pending/suspended users may call this so the UI can explain their account state.
router.get('/auth/me', verifyFirebaseAuth, loadUserProfile, (req, res) => {
  const u = req.user!;
  sendSuccess(res, {
    user: { ...u, roleLabel: u.role ? ROLE_LABELS[u.role] : null },
    permissions: u.permissions,
  });
});

/* ---------- Protected business routes ---------- */
const protectedChain = [verifyFirebaseAuth, loadUserProfile, requireActiveAccount];

router.get('/dashboard/overview', ...protectedChain, requirePermission('dashboard:view'), async (_req, res) => {
  sendSuccess(res, await getOverview());
});

/* ---------- Users (admin) ---------- */
router.get(
  '/users',
  ...protectedChain,
  requirePermission('users:manage'),
  validate(listUsersQuery, 'query'),
  async (_req, res) => {
    const q = res.locals.validated.query as { page: number; limit: number; status?: string; role?: string };
    const { items, total } = await userRepository.list({ status: q.status, role: q.role }, q.page, q.limit);
    sendSuccess(res, items, 'Users retrieved', 200, {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    });
  },
);

router.patch(
  '/users/:id',
  ...protectedChain,
  requirePermission('users:manage'),
  validate(idParam, 'params'),
  validate(updateUserBody, 'body'),
  async (req, res) => {
    const { id } = res.locals.validated.params as { id: string };
    const patch = res.locals.validated.body as Parameters<typeof userRepository.update>[1];
    if (id === req.user!.id && (patch.role !== undefined || patch.status !== undefined)) {
      throw forbidden('Administrators cannot change their own role or status');
    }
    if (patch.status === 'active' && patch.role === null) {
      throw badRequest('An active account requires a role');
    }
    const { supplierId, ...userPatch } = patch as typeof patch & { supplierId?: string | null };
    const updated = Object.keys(userPatch).length ? await userRepository.update(id, userPatch) : await userRepository.findById(id);
    if (!updated) throw notFound('User not found');
    if (supplierId !== undefined) await linkUserToSupplier(id, supplierId);
    if (updated.status === 'active' && !updated.role) {
      // Roll back to pending: an active user must always have a role.
      await userRepository.update(id, { status: 'pending' });
      throw badRequest('Assign a role before activating the account');
    }
    sendSuccess(res, updated, 'User updated');
  },
);

/* ---------- Roles & departments ---------- */
router.get('/roles', ...protectedChain, requirePermission('users:manage'), async (_req, res) => {
  sendSuccess(res, await Role.find().sort({ name: 1 }).lean());
});

router.get('/departments', ...protectedChain, async (_req, res) => {
  sendSuccess(res, await Department.find({ active: true }).sort({ name: 1 }).lean());
});

router.post(
  '/departments',
  ...protectedChain,
  requirePermission('departments:manage'),
  validate(createDepartmentBody),
  async (_req, res) => {
    const body = res.locals.validated.body as { code: string; name: string; description?: string };
    try {
      const dept = await Department.create(body);
      sendSuccess(res, dept, 'Department created', 201);
    } catch (err: any) {
      if (err?.code === 11000) throw conflict('A department with this code already exists');
      throw err;
    }
  },
);

router.use(catalogRoutes);
router.use(procurementRoutes);
router.use(purchasingRoutes);

export default router;
