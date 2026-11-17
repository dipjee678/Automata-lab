import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createClient } from '@supabase/supabase-js';
import { LocalAuth, resolveJwtSecret, SupabaseAuth } from './auth/provider';
import type { Config } from './config';
import { errorHandler, HttpError, type DemoAccount, type Deps } from './http';
import { assignmentRoutes } from './routes/assignments';
import { authRoutes } from './routes/auth';
import { courseRoutes } from './routes/courses';
import { workspaceRoutes } from './routes/workspace';
import { SEED_PASSWORD, SEED_USERS } from './seed';
import { LocalStore } from './store/localStore';
import { SupabaseStore } from './store/supabaseStore';

/** The seeded demo accounts that the sign-in page may offer (their password is public). */
function demoAccounts(config: Config): DemoAccount[] {
  return config.demoLogins.flatMap((role) => {
    const user = SEED_USERS.find((u) => u.role === role);
    return user ? [{ role, email: user.email, password: SEED_PASSWORD }] : [];
  });
}

/** Build the store + auth provider for the configured mode. */
export function createDeps(config: Config): Deps {
  if (config.mode === 'supabase') {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(config.supabaseUrl, config.supabaseServiceKey, options);
    const anon = createClient(config.supabaseUrl, config.supabaseAnonKey, options);
    return { store: new SupabaseStore(admin), auth: new SupabaseAuth(admin, anon), allowTeacherSignup: config.allowTeacherSignup, demoAccounts: demoAccounts(config) };
  }
  const store = new LocalStore(path.join(config.dataDir, 'db.json'));
  return { store, auth: new LocalAuth(store, resolveJwtSecret(config.jwtSecret, config.dataDir)), allowTeacherSignup: config.allowTeacherSignup, demoAccounts: demoAccounts(config) };
}

/** Purely in-memory dependencies for tests. */
export function createTestDeps(): Deps {
  const store = new LocalStore(null);
  return { store, auth: new LocalAuth(store, resolveJwtSecret(null, null)), allowTeacherSignup: true };
}

export function createApp(deps: Deps, opts: { corsOrigins?: string[]; serveFrontend?: boolean; trustProxy?: boolean } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting provider's proxy the client address arrives in X-Forwarded-For;
  // the login rate limiter needs it to tell clients apart.
  if (opts.trustProxy) app.set('trust proxy', 1);
  app.use(
    helmet({
      // The dev UI is served by Vite (which needs inline scripts); the policy applies to
      // the production build this server serves itself.
      contentSecurityPolicy: opts.serveFrontend
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"], // React inline style attributes (canvas geometry)
              imgSrc: ["'self'", 'data:', 'blob:'], // PNG export renders an SVG data URL
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
    }),
  );
  app.use(cors({ origin: opts.corsOrigins ?? true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: deps.auth.mode, allowTeacherSignup: deps.allowTeacherSignup, demoAccounts: deps.demoAccounts ?? [] });
  });

  app.use('/api', authRoutes(deps));
  app.use('/api', courseRoutes(deps));
  app.use('/api', assignmentRoutes(deps));
  app.use('/api', workspaceRoutes(deps));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));

  // Optional single-server deployment: serve the built frontend if it exists.
  if (opts.serveFrontend) {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
    if (fs.existsSync(path.join(dist, 'index.html'))) {
      // Hashed asset files never change, so they can be cached for a long time; index.html must not be.
      app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
      app.use(express.static(dist, { maxAge: 0 }));
      app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
  }

  app.use(errorHandler);
  return app;
}
