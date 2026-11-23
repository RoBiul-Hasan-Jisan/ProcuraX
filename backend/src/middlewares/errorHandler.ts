import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/apiResponse';
import { isProduction } from '../config/environment';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'Route not found', 'NOT_FOUND'));
}

/** Central error handler. Never leaks stack traces or database internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      errors: err.details ?? null,
      data: null,
      pagination: null,
      requestId: req.requestId,
    });
  }
  // eslint-disable-next-line no-console
  console.error(`[${req.requestId}] Unhandled error:`, isProduction ? (err as Error)?.message : err);
  return res.status(500).json({
    success: false,
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    data: null,
    pagination: null,
    requestId: req.requestId,
  });
}
