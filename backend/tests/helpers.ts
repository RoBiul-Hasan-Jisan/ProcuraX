/** A chainable, awaitable stand-in for a Mongoose query: .lean().sort().populate()... all resolve to `value`. */
export function chain<T>(value: T) {
  const q: any = {
    lean: () => q, sort: () => q, populate: () => q, skip: () => q, limit: () => q, select: () => q, session: () => q,
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  };
  return q;
}
export const oid = (n: number | string) => String(n).padStart(24, '0').slice(-24).replace(/[^0-9a-f]/g, 'a');
import { Types } from 'mongoose';
export const D = (v: string) => Types.Decimal128.fromString(v);

/** Builds a model stand-in whose static methods are jest.fn(). Used inside jest.mock factories. */
export const mockModel = (...methods: string[]) => Object.fromEntries(methods.map((m) => [m, jest.fn()]));
