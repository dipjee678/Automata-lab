/**
 * Small HTTP helpers: typed errors, async route wrapper, authentication and
 * role-based access control middleware, request validation.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { Profile, Role } from '@automata/shared';
import type { AuthProvider } from './auth/provider';
import type { Store } from './store/store';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Deps {
  store: Store;
  auth: AuthProvider;
  allowTeacherSignup: boolean;
  /** Public demo logins offered on the sign-in page (empty = none). */
  demoAccounts?: DemoAccount[];
}

export interface DemoAccount {
  role: 'student' | 'teacher';
  email: string;
  password: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: Profile;
  }
}

/** Wrap an async handler so rejected promises reach the error middleware. */
export const route =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Parse and validate a request body; throws a 400 with field details on failure. */
export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw new HttpError(400, `Invalid request: ${issues[0]}`, issues);
  }
  return result.data;
}

/** Require a valid bearer token and attach the caller's profile to the request. */
export const authenticate =
  ({ auth, store }: Deps): RequestHandler =>
  (req, _res, next) => {
    (async () => {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new HttpError(401, 'Authentication required.');
      const userId = await auth.verify(token);
      if (!userId) throw new HttpError(401, 'Your session has expired. Please sign in again.');
      const profile = await store.findOne<Profile>('profiles', { id: userId });
      if (!profile) throw new HttpError(401, 'This account no longer exists.');
      req.user = profile;
    })().then(() => next(), next);
  };

/** Role-based access control: allow only the listed roles. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentication required.'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do this.'));
    next();
  };

export const me = (req: Request): Profile => {
  if (!req.user) throw new HttpError(401, 'Authentication required.');
  return req.user;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request.', details: err.issues });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Malformed JSON body.' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error.' });
}
