import { createApp } from './app';
import { connectDatabase } from './config/database';
import { env } from './config/environment';
import { ensureDefaultRoles } from './models/Role';

async function main() {
  await connectDatabase();
  await ensureDefaultRoles();
  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`SteelProcure API listening on :${env.PORT} (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
