import type { Response } from 'express';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Operation completed successfully',
  status = 200,
  pagination: Pagination | null = null,
): Response {
  return res.status(status).json({ success: true, message, data, pagination });
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (msg = 'Authentication required') => new AppError(401, msg, 'UNAUTHENTICATED');
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'Resource not found') => new AppError(404, msg, 'NOT_FOUND');
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, 'BAD_REQUEST', details);
export const conflict = (msg: string) => new AppError(409, msg, 'CONFLICT');
