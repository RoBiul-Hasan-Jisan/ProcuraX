/**
 * A tiny in-memory stand-in for the Mongoose models, enough to exercise the seed scripts without MongoDB.
 * Supports: create, insertMany, find/findOne/findById (+ lean/select/sort), exists, countDocuments, updateOne,
 * findOneAndUpdate, with equality, $ne, $in and dotted keys; $set, $inc (numbers and Decimal128), $setOnInsert and one positional ($) update.
 * It is NOT a database: it only checks that our code asks for and writes the right things.
 */
import { Types } from 'mongoose';
import Decimal from 'decimal.js';

const isId = (v: any) => v instanceof Types.ObjectId;
const norm = (v: any): any => (isId(v) ? String(v) : v instanceof Types.Decimal128 ? v.toString() : v instanceof Date ? v.getTime() : v);
const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const eq = (a: any, b: any) => norm(a) === norm(b);
function matches(doc: any, q: Record<string, any>): boolean {
  return Object.entries(q).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !isId(cond) && !(cond instanceof Date) && !(cond instanceof Types.Decimal128)) {
      if ('$ne' in cond) return !eq(v, cond.$ne);
      if ('$in' in cond) return (cond.$in as any[]).some((x) => eq(v, x));
    }
    return eq(v, cond);
  });
}
const add = (a: any, b: any) => Types.Decimal128.fromString(new Decimal(String(a ?? 0)).plus(new Decimal(String(b))).toString());

export function createFakeModel(name: string) {
  const docs: any[] = [];
  const query = (run: () => any) => { const q: any = { lean: () => q, select: () => q, sort: () => q, limit: () => q, session: () => q, populate: () => q, then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej) }; return q; };
  const stamp = (d: any) => { d._id ??= new Types.ObjectId(); d.createdAt ??= new Date(); d.updatedAt ??= d.createdAt; return d; };
  const applyUpdate = (doc: any, update: any, inserting: boolean) => {
    for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = v;
    if (inserting) for (const [k, v] of Object.entries(update.$setOnInsert ?? {})) doc[k] = v;
    for (const [k, v] of Object.entries(update.$inc ?? {})) doc[k] = add(doc[k], v);
  };
  const model: any = {
    modelName: name, docs,
    create: async (d: any) => { if (Array.isArray(d)) return d.map((x) => { const s = stamp({ ...x }); docs.push(s); return s; }); const s = stamp({ ...d }); docs.push(s); return s; },
    insertMany: async (arr: any[]) => { arr.forEach((x) => docs.push(stamp({ ...x }))); return arr; },
    find: (q: any = {}) => query(() => docs.filter((d) => matches(d, q))),
    findOne: (q: any = {}) => query(() => docs.find((d) => matches(d, q)) ?? null),
    findById: (id: any) => query(() => docs.find((d) => eq(d._id, id)) ?? null),
    exists: (q: any = {}) => query(() => (docs.some((d) => matches(d, q)) ? { _id: 1 } : null)),
    countDocuments: (q: any = {}) => query(() => docs.filter((d) => matches(d, q)).length),
    estimatedDocumentCount: () => query(() => docs.length),
    updateOne: async (filter: any, update: any, opts: any = {}) => {
      let doc = docs.find((d) => matches(d, Object.fromEntries(Object.entries(filter).filter(([k]) => !k.includes('.')))));
      // positional update ('lines.$.field' with a filter on 'lines.material')
      const positional = Object.keys(update.$inc ?? {}).find((k) => k.includes('.$.'));
      if (doc && positional) {
        const [arr, , field] = positional.split('.');
        const key = Object.keys(filter).find((k) => k.startsWith(`${arr}.`))!.split('.')[1];
        const row = doc[arr].find((x: any) => eq(x[key], filter[`${arr}.${key}`]));
        row[field] = add(row[field], update.$inc[positional]);
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
      if (doc) { applyUpdate(doc, update, false); return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }; }
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      doc = stamp({ ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || isId(v))) });
      applyUpdate(doc, update, true); docs.push(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
    findOneAndUpdate: (filter: any, update: any, opts: any = {}) => query(() => {
      let doc = docs.find((d) => matches(d, filter));
      if (!doc && opts.upsert) { doc = stamp({ ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || isId(v))) }); applyUpdate(doc, update, true); docs.push(doc); return doc; }
      if (doc) applyUpdate(doc, update, false);
      return doc ?? null;
    }),
  };
  return model;
}
