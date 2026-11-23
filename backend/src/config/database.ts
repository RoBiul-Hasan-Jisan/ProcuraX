import mongoose from 'mongoose';
import { env } from './environment';

export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function databaseState(): 'connected' | 'disconnected' | 'connecting' | 'disconnecting' {
  const map = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' } as const;
  return map[mongoose.connection.readyState as 0 | 1 | 2 | 3] ?? 'disconnected';
}
