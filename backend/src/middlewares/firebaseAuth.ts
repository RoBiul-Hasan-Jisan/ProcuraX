import type { NextFunction, Request, Response } from 'express';
import { verifyIdToken } from '../config/firebase';
import { unauthorized } from '../utils/apiResponse';

/**
 * Verifies the Firebase-issued ID token in `Authorization: Bearer <token>`
 * using the Firebase Admin SDK. This app issues no tokens of its own.
 */
export async function verifyFirebaseAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized('Missing bearer token');
    req.auth = await verifyIdToken(token);
    next();
  } catch (err) {
    next(err instanceof Error && err.name === 'AppError' ? err : unauthorized('Invalid or expired token'));
  }
}
