import rateLimit from 'express-rate-limit';
import { isTest } from '../config/environment';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  message: { success: false, message: 'Too many requests, please try again later', data: null, pagination: null },
});

/** Stricter limit for session bootstrap / profile provisioning. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  message: { success: false, message: 'Too many requests, please try again later', data: null, pagination: null },
});
