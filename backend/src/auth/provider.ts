/**
 * Authentication providers.
 *
 *  - SupabaseAuth: users live in Supabase Auth. The backend creates users with
 *    the service-role key, signs them in with the anon key and returns the
 *    Supabase access token (a JWT) to the browser. No key ever reaches the client.
 *  - LocalAuth: development fallback. Passwords are hashed with scrypt and the
 *    backend signs its own JWTs.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Store } from '../store/store';
import { HttpError } from '../http';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface AuthProvider {
  mode: 'local' | 'supabase';
  /** Create the credential record. Returns the new user id. */
  register(email: string, password: string): Promise<string>;
  /** Check credentials. Returns the user id and a bearer token. */
  login(email: string, password: string): Promise<{ userId: string; token: string }>;
  /** Resolve a bearer token to a user id (null if invalid or expired). */
  verify(token: string): Promise<string | null>;
  deleteUser(userId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Local                                                               */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Load the JWT signing secret: env var, else a random secret persisted next to the data file. */
export function resolveJwtSecret(fromEnv: string | null, dataDir: string | null): string {
  if (fromEnv) return fromEnv;
  if (!dataDir) return randomBytes(48).toString('hex');
  const file = path.join(dataDir, 'jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export class LocalAuth implements AuthProvider {
  mode = 'local' as const;
  constructor(
    private store: Store,
    private secret: string,
  ) {}

  async register(email: string, password: string): Promise<string> {
    const normalized = email.trim().toLowerCase();
    if (await this.store.findOne<UserRow>('users', { email: normalized })) throw new HttpError(409, 'An account with this email already exists.');
    const user = await this.store.insert<UserRow>('users', { email: normalized, password_hash: await hashPassword(password) });
    return user.id;
  }

  async login(email: string, password: string) {
    const user = await this.store.findOne<UserRow>('users', { email: email.trim().toLowerCase() });
    // Verify against a dummy hash when the user is unknown so timing does not reveal which emails exist.
    const ok = await verifyPassword(password, user?.password_hash ?? `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password.');
    return { userId: user.id, token: jwt.sign({ sub: user.id }, this.secret, { algorithm: 'HS256', expiresIn: '7d' }) };
  }

  async verify(token: string): Promise<string | null> {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async deleteUser(userId: string) {
    await this.store.remove('users', { id: userId });
  }
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

export class SupabaseAuth implements AuthProvider {
  mode = 'supabase' as const;
  private cache = new Map<string, { userId: string; until: number }>();

  /**
   * @param admin  client created with the service-role key (user management, token checks)
   * @param anon   client created with the anon key (password sign-in)
   */
  constructor(
    private admin: SupabaseClient,
    private anon: SupabaseClient,
  ) {}

  async register(email: string, password: string): Promise<string> {
    const { data, error } = await this.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      if (error && /already|registered|exists/i.test(error.message)) throw new HttpError(409, 'An account with this email already exists.');
      throw new HttpError(400, error?.message ?? 'Could not create the account.');
    }
    return data.user.id;
  }

  async login(email: string, password: string) {
    const { data, error } = await this.anon.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) throw new HttpError(401, 'Invalid email or password.');
    return { userId: data.user.id, token: data.session.access_token };
  }

  async verify(token: string): Promise<string | null> {
    const hit = this.cache.get(token);
    if (hit && hit.until > Date.now()) return hit.userId;
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) return null;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(token, { userId: data.user.id, until: Date.now() + 60_000 });
    return data.user.id;
  }

  async deleteUser(userId: string) {
    const { error } = await this.admin.auth.admin.deleteUser(userId);
    if (error) throw new HttpError(500, `Could not delete the auth user: ${error.message}`);
    for (const [token, entry] of this.cache) if (entry.userId === userId) this.cache.delete(token);
  }
}
