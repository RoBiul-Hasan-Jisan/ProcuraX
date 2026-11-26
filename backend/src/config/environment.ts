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
  /** auto = use the Python ML service when ML_INTERNAL_KEY is set (falling back to builtin if it is down); builtin = never call it; service = require it. */
  ML_MODE: z.enum(['auto', 'builtin', 'service']).default('auto'),
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

/**
 * Settings that must be real in production. Returned as a list of problems (empty = fine) so it can be tested without
 * starting anything. The checks stop a container from starting with a placeholder secret or without Firebase credentials.
 */
export function productionProblems(e: z.infer<typeof schema>): string[] {
  const problems: string[] = [];
  if (!e.FIREBASE_PROJECT_ID || !e.FIREBASE_CLIENT_EMAIL || !e.FIREBASE_PRIVATE_KEY) problems.push('FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required');
  if (e.ML_MODE !== 'builtin' && (e.ML_INTERNAL_KEY.length < 16 || /change-?me/i.test(e.ML_INTERNAL_KEY))) problems.push('ML_INTERNAL_KEY must be a random secret of at least 16 characters (not the placeholder)');
  if (!/^https:\/\//.test(e.FRONTEND_URL) && !/^http:\/\/localhost(:\d+)?$/.test(e.FRONTEND_URL)) problems.push('FRONTEND_URL must be an https:// origin');
  return problems;
}

export const env = parsed.data;
if (env.NODE_ENV === 'production') {
  const problems = productionProblems(env);
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production:\n - ' + problems.join('\n - '));
    throw new Error('Invalid production configuration');
  }
}
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
