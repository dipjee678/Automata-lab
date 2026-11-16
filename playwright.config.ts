import path from 'node:path';
import { defineConfig } from '@playwright/test';

const dataDir = path.resolve('backend/.e2e-data');
/** Password of the demo accounts in the throw-away e2e database. */
export const E2E_PASSWORD = 'e2e-password-1';

/**
 * E2E_TARGET=prod tests the DEPLOYABLE artifact instead of the dev servers: the
 * production build served by the backend itself, with NODE_ENV=production
 * (content security policy, proxy settings, caching headers). Run `npm run build` first.
 */
const prod = process.env.E2E_TARGET === 'prod';
const wipe = `node -e "require('fs').rmSync(process.argv[1],{recursive:true,force:true})" "${dataDir}"`;

// Empty SUPABASE_* values force local mode even when backend/.env points at a real
// project: the e2e suite must never touch live data.
const apiEnv = {
  PORT: '4010',
  DATA_DIR: dataDir,
  SEED_PASSWORD: E2E_PASSWORD,
  SEED_ON_START: 'true',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

/**
 * End-to-end tests. They start the API on a throw-away data directory (fresh
 * demo seed every run) and drive the installed Microsoft Edge – no browser
 * download needed. Use PW_CHANNEL=chrome to switch.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: prod ? 'http://localhost:4010' : 'http://localhost:5183',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: prod
    ? [
        {
          command: `${wipe} && npm run start -w backend`,
          url: 'http://localhost:4010/api/health',
          // TRUST_PROXY stays off: there is no proxy in front of this local run.
          env: { ...apiEnv, NODE_ENV: 'production', TRUST_PROXY: 'false' },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ]
    : [
        {
          // Wipe the throw-away data directory first so every run starts from a fresh demo seed.
          command: `${wipe} && npm run start -w backend`,
          url: 'http://localhost:4010/api/health',
          env: { ...apiEnv, CORS_ORIGIN: 'http://localhost:5183' },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: 'npm run dev -w frontend -- --port 5183 --strictPort',
          url: 'http://localhost:5183',
          env: { API_PROXY_TARGET: 'http://localhost:4010' },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
