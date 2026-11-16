import type { Profile } from '@automata/shared';
import { createApp, createDeps } from './app';
import { loadConfig } from './config';
import { seedDemo } from './seed';

const config = loadConfig();
const deps = createDeps(config);

if (config.mode === 'local') {
  // First start in local mode: create the demo accounts and course.
  const empty = (await deps.store.find<Profile>('profiles')).length === 0;
  // Demo accounts share a published password, so never create them automatically in production.
  const wanted = process.env.SEED_ON_START ?? (config.production ? 'false' : 'true');
  if (empty && wanted !== 'false' && (await seedDemo(deps)))
    console.log('[seed] Demo data created (accounts are listed in README.md).');
}

if (config.production && config.mode === 'local')
  console.warn('[api] WARNING: running in production WITHOUT Supabase. Data is stored in a local JSON file, which most hosts erase on every deploy.');

const app = createApp(deps, { corsOrigins: config.corsOrigins, serveFrontend: true, trustProxy: config.trustProxy });
app.listen(config.port, () => {
  console.log(`[api] Automata Lab API listening on http://localhost:${config.port} (${config.mode} mode)`);
  if (config.mode === 'local')
    console.log('[api] No Supabase credentials found: using the local JSON store in backend/data/. See README.md to connect Supabase.');
});
