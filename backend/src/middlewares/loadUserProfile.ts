import type { NextFunction, Request, Response } from 'express';
import { userRepository } from '../repositories/userRepository';
import { AppError, unauthorized } from '../utils/apiResponse';

/**
 * Loads the MongoDB profile for the verified Firebase UID. Role, status and
 * permissions ALWAYS come from the database, never from the request.
 */
export async function loadUserProfile(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw unauthorized();
    const profile = await userRepository.findByFirebaseUid(req.auth.uid);
    if (!profile) {
      throw new AppError(403, 'No application profile exists for this account', 'PROFILE_NOT_FOUND');
    }
    const permissions = profile.status === 'active' ? await userRepository.permissionsForRole(profile.role) : [];
    req.user = {
      id: profile.id,
      firebaseUid: profile.firebaseUid,
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      status: profile.status,
      departmentId: profile.departmentId,
      supplierId: profile.supplierId,
      permissions,
    };
    next();
  } catch (err) {
    next(err);
  }
}
