import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/steelprocure?replicaSet=rs0'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  FIREBASE_PROJECT_ID: z.string().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().default(''),
  FIREBASE_PRIVATE_KEY: z.string().default(''),
  ML_SERVICE_URL: z.string().default('http://localhost:8000'),
  ML_INTERNAL_KEY: z.string().default(''),
  ML_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  // Optional: the email that is auto-provisioned as System Administrator on first login.
  BOOTSTRAP_ADMIN_EMAIL: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
