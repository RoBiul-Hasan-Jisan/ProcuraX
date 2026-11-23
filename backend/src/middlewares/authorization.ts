import type { NextFunction, Request, Response } from 'express';
import { AppError, forbidden, unauthorized } from '../utils/apiResponse';
import type { Permission, RoleName } from '../utils/permissions';

export function requireActiveAccount(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.status === 'pending') {
    return next(new AppError(403, 'Your account is awaiting administrator approval', 'ACCOUNT_PENDING'));
  }
  if (req.user.status === 'suspended') {
    return next(new AppError(403, 'Your account has been suspended', 'ACCOUNT_SUSPENDED'));
  }
  if (!req.user.role) return next(new AppError(403, 'No role has been assigned to your account', 'NO_ROLE'));
  next();
}

export const requireRole =
  (...roles: RoleName[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.role || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Passes when the user holds ANY of the listed permissions. */
export const requirePermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const held = req.user?.permissions ?? [];
    if (!permissions.some((p) => held.includes(p))) return next(forbidden());
    next();
  };

/** Standard chain for any protected business route. */
export { verifyFirebaseAuth } from './firebaseAuth';
export { loadUserProfile } from './loadUserProfile';
