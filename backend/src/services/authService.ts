import { env } from '../config/environment';
import { userRepository, type ProfileRecord } from '../repositories/userRepository';
import type { AuthContext } from '../types/express';
import { ensureDefaultRoles } from '../models/Role';

export interface SessionResult {
  profile: ProfileRecord;
  permissions: string[];
  created: boolean;
}

/**
 * Called right after Firebase sign-in. Returns the existing MongoDB profile or provisions one.
 *
 * Provisioning rules (the client can never choose its own role):
 *  - New profiles start as `pending` with no role; an administrator activates them.
 *  - The single email in BOOTSTRAP_ADMIN_EMAIL becomes an active System Administrator,
 *    but only if Firebase reports that email as verified (prevents takeover by unverified signup).
 */
export async function establishSession(auth: AuthContext): Promise<SessionResult> {
  let profile = await userRepository.findByFirebaseUid(auth.uid);
  let created = false;

  if (!profile) {
    if (!auth.email) throw new Error('Firebase account has no email address');
    const email = auth.email.toLowerCase();
    const isBootstrapAdmin =
      !!env.BOOTSTRAP_ADMIN_EMAIL &&
      email === env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
      auth.emailVerified === true;

    if (isBootstrapAdmin) await ensureDefaultRoles();

    profile = await userRepository.create({
      firebaseUid: auth.uid,
      email,
      displayName: auth.name?.trim() || email.split('@')[0],
      role: isBootstrapAdmin ? 'system_admin' : null,
      status: isBootstrapAdmin ? 'active' : 'pending',
    });
    created = true;
  }

  await userRepository.touchLogin(profile.id);
  const permissions = profile.status === 'active' ? await userRepository.permissionsForRole(profile.role) : [];
  return { profile, permissions, created };
}
