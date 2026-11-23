import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * Strips MongoDB operator injection ($-prefixed and dotted keys) from body/query/params.
 * Mutates in place because Express 5 makes `req.query` a read-only getter.
 */
export function sanitizeRequest(req: Request, _res: Response, next: NextFunction) {
  const clean = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(clean);
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (key.startsWith('$') || key.includes('.')) delete obj[key];
        else clean(obj[key]);
      }
    }
  };
  clean(req.body);
  clean(req.query);
  clean(req.params);
  next();
}
