/** `npm run seed` – insert the demo data into the configured store (Supabase or local). */
import { createDeps } from '../app';
import { loadConfig } from '../config';
import { seedDemo, SEED_USERS } from '../seed';

const config = loadConfig();
const created = await seedDemo(createDeps(config));
console.log(
  created
    ? `Seeded ${SEED_USERS.length} demo accounts and a demo course into the ${config.mode} store.`
    : 'Demo data is already present; nothing was changed.',
);
