import { Schema, model, type ClientSession } from 'mongoose';

const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

/**
 * Atomically allocates the next number for a prefix and year, e.g. PR-2026-0001.
 * `findOneAndUpdate` with $inc is atomic, so concurrent callers never receive the same number.
 */
export async function nextNumber(prefix: string, session?: ClientSession, year = new Date().getFullYear()): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { _id: `${prefix}-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return `${prefix}-${year}-${String(doc!.seq).padStart(4, '0')}`;
}
