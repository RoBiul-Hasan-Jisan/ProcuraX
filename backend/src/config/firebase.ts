import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from './environment';

let app: App | null = null;

/** Firebase private keys are stored in env vars with literal "\n" sequences. */
export function normalizePrivateKey(raw: string): string {
  return raw.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

export function getFirebaseApp(): App {
  if (app) return app;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('Firebase Admin credentials are not configured (see backend/.env.example)');
  }
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: normalizePrivateKey(env.FIREBASE_PRIVATE_KEY),
      }),
    });
  return app;
}

export interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

/** Verifies a Firebase-issued ID token with the Admin SDK. Throws if invalid/expired. */
export async function verifyIdToken(idToken: string): Promise<VerifiedFirebaseToken> {
  const decoded = await getAuth(getFirebaseApp()).verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name as string | undefined,
    emailVerified: decoded.email_verified,
  };
}
