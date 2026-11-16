import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { loginSchema, registerSchema, roleSchema, type Profile } from '@automata/shared';
import { authenticate, HttpError, me, parse, requireRole, route, type Deps } from '../http';

export function authRoutes(deps: Deps): Router {
  const { store, auth } = deps;
  const r = Router();

  // Slow down credential guessing.
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });

  r.post(
    '/auth/register',
    limiter,
    route(async (req, res) => {
      const body = parse(registerSchema, req.body);
      if (body.role === 'teacher' && !deps.allowTeacherSignup)
        throw new HttpError(403, 'Teacher accounts are created by an administrator on this server.');
      const email = body.email.trim().toLowerCase();
      if (await store.findOne<Profile>('profiles', { email })) throw new HttpError(409, 'An account with this email already exists.');
      const userId = await auth.register(email, body.password);
      let profile: Profile;
      try {
        profile = await store.insert<Profile>('profiles', { id: userId, email, full_name: body.full_name.trim(), role: body.role });
      } catch (e) {
        await auth.deleteUser(userId).catch(() => undefined); // do not leave a credential without a profile
        throw e;
      }
      const { token } = await auth.login(email, body.password);
      res.status(201).json({ token, user: profile });
    }),
  );

  r.post(
    '/auth/login',
    limiter,
    route(async (req, res) => {
      const body = parse(loginSchema, req.body);
      const { userId, token } = await auth.login(body.email, body.password);
      const profile = await store.findOne<Profile>('profiles', { id: userId });
      if (!profile) throw new HttpError(401, 'This account has no profile. Ask an administrator for help.');
      res.json({ token, user: profile });
    }),
  );

  r.get(
    '/auth/me',
    authenticate(deps),
    route(async (req, res) => {
      res.json({ user: me(req) });
    }),
  );

  r.patch(
    '/auth/me',
    authenticate(deps),
    route(async (req, res) => {
      const body = parse(z.object({ full_name: z.string().min(1).max(120) }), req.body);
      res.json({ user: await store.update<Profile>('profiles', me(req).id, { full_name: body.full_name.trim() }) });
    }),
  );

  /* ----------------------------- admin ----------------------------- */

  r.get(
    '/admin/users',
    authenticate(deps),
    requireRole('admin'),
    route(async (_req, res) => {
      res.json({ users: await store.find<Profile>('profiles') });
    }),
  );

  r.patch(
    '/admin/users/:id',
    authenticate(deps),
    requireRole('admin'),
    route(async (req, res) => {
      const body = parse(z.object({ role: roleSchema }), req.body);
      const target = await store.findOne<Profile>('profiles', { id: req.params.id! });
      if (!target) throw new HttpError(404, 'User not found.');
      if (target.id === me(req).id && body.role !== 'admin') throw new HttpError(400, 'You cannot remove your own admin role.');
      res.json({ user: await store.update<Profile>('profiles', target.id, { role: body.role }) });
    }),
  );

  r.delete(
    '/admin/users/:id',
    authenticate(deps),
    requireRole('admin'),
    route(async (req, res) => {
      const target = await store.findOne<Profile>('profiles', { id: req.params.id! });
      if (!target) throw new HttpError(404, 'User not found.');
      if (target.id === me(req).id) throw new HttpError(400, 'You cannot delete your own account.');
      // Remove the profile first (cascades to the user's data), then the credential.
      await store.remove('profiles', { id: target.id });
      await auth.deleteUser(target.id);
      res.status(204).end();
    }),
  );

  return r;
}
