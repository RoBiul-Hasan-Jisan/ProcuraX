import type { Server } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/environment';
import { ensureDefaultRoles } from './models/Role';

const SHUTDOWN_GRACE_MS = 15_000;

async function main() {
  await connectDatabase();
  await ensureDefaultRoles();
  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`ProcuraX API listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  /** Docker sends SIGTERM on stop: finish in-flight requests, close the database, then exit. A timer forces exit if something hangs. */
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    // eslint-disable-next-line no-console
    console.log(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
    force.unref();
    server.close(() => {
      disconnectDatabase().catch(() => undefined).finally(() => process.exit(0));
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
