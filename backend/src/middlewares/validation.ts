import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../utils/apiResponse';

type Source = 'body' | 'query' | 'params';

/** Validates a request section with Zod and stores the parsed value on `res.locals.validated[source]`. */
export const validate =
  (schema: ZodType, source: Source = 'body') =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        badRequest(
          'Validation failed',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
    }
    res.locals.validated = { ...(res.locals.validated ?? {}), [source]: result.data };
    next();
  };
