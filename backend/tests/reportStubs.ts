/** Canned rows per model name, returned through the usual find().sort().limit().select().lean() chain. */
export const rowsFor: Record<string, any[]> = {};
const chain = (name: string) => { const c: any = { sort: () => c, limit: () => c, select: () => c, lean: async () => rowsFor[name] ?? [] }; return c; };
const one = (name: string) => { const c: any = { sort: () => c, select: () => c, lean: async () => rowsFor[name]?.[0] ?? null }; return c; };
export const stub = (name: string) => ({ find: jest.fn(() => chain(name)), findOne: jest.fn(() => one(name)) });
