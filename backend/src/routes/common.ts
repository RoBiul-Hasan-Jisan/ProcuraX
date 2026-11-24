import type { Response } from 'express';
import { loadUserProfile, requireActiveAccount, verifyFirebaseAuth } from '../middlewares/authorization';
import type { Pagination } from '../utils/apiResponse';

/** Standard chain for any protected business route (permission checks are added per endpoint). */
export const protectedChain = [verifyFirebaseAuth, loadUserProfile, requireActiveAccount];

export const validated = <T>(res: Response, source: 'body' | 'query' | 'params'): T => res.locals.validated[source] as T;

export const paginate = (page: number, limit: number, total: number): Pagination => ({
  page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)),
});
