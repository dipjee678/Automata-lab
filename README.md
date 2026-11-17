# Automata Lab

Automata and Formal Language Laboratory with automatic grading: draw and simulate
DFA / NFA / ε-NFA / PDA / Turing machines, run conversions step by step, test regular
expressions and grammars, and grade student answers by language equivalence.

## Structure

```
shared/      Types + Zod schemas (the JSON format of automata, questions, answers)
algorithms/  Pure TypeScript algorithms + unit tests (no UI, no I/O)
backend/     Express REST API (auth, courses, assignments, grading, analytics)
frontend/    React + Vite + Tailwind + React Flow
database/    PostgreSQL schema with Row Level Security for Supabase
```

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173 (API on http://localhost:4000).

Without Supabase credentials the backend runs in **local mode**: data is kept in
`backend/data/db.json`, passwords are hashed with scrypt, and demo data is created on
first start.

### Demo accounts (local mode / after `npm run seed`)

| Role | Email |
| --- | --- |
| Admin | admin@automatalab.test |
| Teacher | teacher@automatalab.test |
| Student | student@automatalab.test |
| Student | student2@automatalab.test |

Password for all of them: the value of `SEED_PASSWORD` (default in `backend/.env.example`).
The demo course join code is `DEMO331`. Sample data only — do not seed a production database.

The sign-in page shows one-click **Try as student / Try as teacher** buttons for these
accounts. They are on by default in local mode and off with Supabase; set
`DEMO_LOGINS=student,teacher` (or just `student`) to show them, or leave it empty to hide them.
The admin account is never offered.

## Connect Supabase

1. Create a Supabase project and run `database/schema.sql` in the SQL editor.
2. Copy `backend/.env.example` to `backend/.env` and set `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Optionally run `npm run seed`, then `npm run dev`.

The service-role key stays on the server; the browser only ever talks to the API.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

End-to-end tests (Playwright, drives the installed Microsoft Edge on a throw-away
database; set `PW_CHANNEL=chrome` to use Chrome):

```bash
npm run test:e2e
```

15 end-to-end tests cover login and roles, the editor, question authoring, student
submissions, PDA and Turing machine answers, and phone and tablet layouts.

163 unit and integration tests cover simulation, ε-closure, subset construction,
minimization, product, equivalence and shortest counterexamples, regex, CFG, PDA, TM,
the grading engine, authentication and role permissions.

## Grading: exact vs bounded

| Question type | Method |
| --- | --- |
| DFA / NFA construction, NFA→DFA, DFA minimization, regex | **Exact** language equivalence (product construction + BFS) with a shortest counterexample |
| CFG, PDA, Turing machine | **Bounded testing** on all strings up to a length bound plus teacher tests; labelled as such and flagged for teacher review, because equivalence is undecidable |

## Deployment

The simplest setup is **one service**: the backend serves the API and the built
frontend from the same origin, with Supabase as the database.

Required environment variables on the host:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Project Settings → API |
| `PORT` | usually injected by the host |

Build command: `npm ci --include=dev && npm run build`. Start command: `npm run start`.
Health check path: `/api/health`.

- **Render**: `render.yaml` is a ready blueprint (New → Blueprint, pick the repository,
  fill in the three Supabase values).
- **Any Docker host** (Railway, Fly.io, a VPS): the `Dockerfile` builds one image.

In production the server enables a content security policy, trusts the host's proxy
for rate limiting, caches hashed assets, and does **not** create demo accounts.
Without Supabase variables it falls back to a JSON file, which most hosts erase on
every deploy, and logs a warning.

To serve the frontend from a separate static host instead, build with
`VITE_API_URL=<api origin>` and add that site's origin to `CORS_ORIGIN`.

To test the deployable build locally (production mode, served by the backend):

```bash
npm run test:e2e:prod
```

### Before real students use it

- The seeded demo accounts share a published password. Delete them in Supabase
  (Authentication → Users), never seed the production project, or block individual
  ones without deleting their data:

  ```bash
  npm run demo-access -w backend -- disable admin@automatalab.test
  ```

  (`enable` reverses it.) A public showcase can keep the demo student and teacher,
  but the demo admin should always be disabled. Hide the one-click demo buttons by
  clearing `DEMO_LOGINS`.
- Create your own admin: register normally, then set `role = 'admin'` for that row in
  the `profiles` table (Supabase → Table Editor). Further admins can be promoted in the app.
- Set `ALLOW_TEACHER_SIGNUP=false` if teachers should only be appointed by an admin.

## Known gaps

- Supabase mode was verified once by hand against a live project (schema, seed, the full
  API flow and the RLS policies with direct user tokens), but those checks are not part of
  the automated test suite, which runs on the local store.
- `render.yaml` is verified on Render's free tier. The `Dockerfile` has not been built on
  a real host yet; it runs the same build and start commands.
- Automated browser tests run in Chromium-based browsers (Edge/Chrome) only.
