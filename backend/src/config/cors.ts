import type { CorsOptions } from 'cors';
import { env } from './environment';

export const corsOptions: CorsOptions = {
  origin: env.FRONTEND_URL.split(',').map((o) => o.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
  credentials: false,
  maxAge: 600,
};
