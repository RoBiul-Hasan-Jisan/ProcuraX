import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { KEY_PATTERN } from '../domain/documents';

/** Where file bytes live. Development uses the local disk; production can supply another implementation of this interface. */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Readable;
  remove(key: string): Promise<void>;
}

export class LocalStorage implements StorageAdapter {
  constructor(private readonly root: string) {}
  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key'); // belt and braces against traversal
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: 'wx', mode: 0o640 }); // never overwrite
  }
  get(key: string) { return createReadStream(this.resolve(key)); }
  async remove(key: string) { await fs.rm(this.resolve(key), { force: true }); }
}

let current: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (current) return current;
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver !== 'local') throw new Error(`Storage driver "${driver}" is not implemented. Only "local" ships with this build; add an adapter implementing StorageAdapter.`);
  return (current = new LocalStorage(process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads')));
}
export const setStorage = (s: StorageAdapter | null) => { current = s; };
