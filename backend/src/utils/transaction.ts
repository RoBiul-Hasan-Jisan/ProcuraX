import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs `fn` inside a MongoDB transaction (retried automatically on transient errors).
 * Requires a replica set. There is deliberately NO fallback to non-transactional writes:
 * stock and order state must change together or not at all.
 */
export async function runInTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } catch (err: any) {
    if (/Transaction numbers are only allowed|replica set/i.test(String(err?.message))) {
      throw new Error('MongoDB must run as a replica set for transactions (see README quick start)');
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
