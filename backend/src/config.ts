/**
 * Runtime configuration, read from environment variables (backend/.env).
 *
 * Two modes:
 *  - "supabase": SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY are set.
 *    Data lives in Supabase Postgres and users in Supabase Auth.
 *  - "local": no Supabase credentials. Data is kept in a JSON file and
 *    passwords are hashed locally. Meant for development and demos only.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Config {
  port: number;
  mode: 'supabase' | 'local';
  supabaseUrl: string;
  supabaseServiceKey: string;
  supabaseAnonKey: string;
  corsOrigins: string[];
  dataDir: string;
  jwtSecret: string | null;
  allowTeacherSignup: boolean;
  /** True when running behind a reverse proxy (any hosted deployment). */
  trustProxy: boolean;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const supabaseUrl = env.SUPABASE_URL ?? '';
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? '';
  const hasSupabase = !!(supabaseUrl && supabaseServiceKey && supabaseAnonKey);
  if (!hasSupabase && (supabaseUrl || supabaseServiceKey || supabaseAnonKey))
    console.warn('[config] Supabase is only partly configured (need URL, service-role key and anon key). Falling back to local mode.');
  return {
    port: Number(env.PORT ?? 4000),
    mode: hasSupabase ? 'supabase' : 'local',
    supabaseUrl,
    supabaseServiceKey,
    supabaseAnonKey,
    corsOrigins: (env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.resolve(here, '../data'),
    jwtSecret: env.JWT_SECRET ?? null,
    allowTeacherSignup: (env.ALLOW_TEACHER_SIGNUP ?? 'true') !== 'false',
    trustProxy: (env.TRUST_PROXY ?? (env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
    production: env.NODE_ENV === 'production',
  };
}
