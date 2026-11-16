-- =============================================================================
-- Automata Lab – PostgreSQL schema for Supabase
--
-- Run this once in the Supabase SQL editor (or `psql`) on a fresh project.
-- It is idempotent: running it again does not destroy data.
--
-- Users:  Supabase Auth owns credentials in `auth.users` (this is the "users"
--         table of the design). `public.profiles` extends each user with a
--         name and a role.
-- Access: the Express backend uses the service-role key, which bypasses RLS,
--         and enforces authorization in code. The RLS policies below protect
--         the data against any client that talks to Supabase directly with
--         the anon key or a user JWT (defence in depth).
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null check (char_length(full_name) between 1 and 120),
  role        text not null default 'student' check (role in ('admin', 'teacher', 'student')),
  created_at  timestamptz not null default now()
);

create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  code        text not null check (char_length(code) between 1 and 30),
  join_code   text not null unique,
  teacher_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (course_id, student_id)
);

create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  description   text not null default '',
  due_at        timestamptz,
  max_attempts  integer check (max_attempts is null or max_attempts between 1 and 100),
  published     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- A question. `given`, `reference`, `tests` and `criteria` are JSONB documents
-- in the format defined in shared/src/index.ts:
--   given      Automaton | null          { type, states[], transitions[], alphabet? }
--   reference  { kind: 'automaton' | 'regex' | 'grammar' | 'tests' | 'given', ... }
--   tests      [{ input, accept }]
--   criteria   { partialCredit, partialCap, minimalityWeight, requireComplete, boundedLength }
create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  position       integer not null default 1,
  type           text not null check (type in ('dfa_construct', 'nfa_construct', 'nfa_to_dfa', 'dfa_minimize', 'regex', 'cfg', 'pda', 'tm')),
  title          text not null check (char_length(title) between 1 and 200),
  prompt         text not null default '',
  marks          numeric(7, 2) not null check (marks >= 0),
  alphabet       jsonb not null default '[]'::jsonb,
  given          jsonb,
  reference      jsonb not null,
  tests          jsonb not null default '[]'::jsonb,
  criteria       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- One attempt of one student at one question.
--   answer  { kind: 'automaton', automaton } | { kind: 'regex', regex } | { kind: 'grammar', grammar }
create table if not exists public.submissions (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions (id) on delete cascade,
  assignment_id  uuid not null references public.assignments (id) on delete cascade,
  student_id     uuid not null references public.profiles (id) on delete cascade,
  answer         jsonb not null,
  attempt        integer not null check (attempt >= 1),
  late           boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (question_id, student_id, attempt)
);

-- The grade of one submission. `auto_score` is what the grading engine gave;
-- `final_score` is what counts (a teacher may adjust it).
create table if not exists public.grades (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null unique references public.submissions (id) on delete cascade,
  auto_score      numeric(7, 2) not null check (auto_score >= 0),
  final_score     numeric(7, 2) not null check (final_score >= 0),
  max_score       numeric(7, 2) not null check (max_score >= 0),
  verdict         text not null check (verdict in ('correct', 'partial', 'incorrect', 'invalid', 'needs_review')),
  exact           boolean not null,          -- true: exact equivalence check; false: bounded testing
  method          text not null,
  feedback        jsonb not null default '[]'::jsonb,
  counterexample  jsonb,                     -- { input, expected, actual } | null
  adjusted_by     uuid references public.profiles (id) on delete set null,
  adjust_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (final_score <= max_score and auto_score <= max_score)
);

-- Automata saved from the editor. `data` is the Automaton JSON document.
create table if not exists public.automata (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  type        text not null check (type in ('DFA', 'NFA', 'ENFA', 'PDA', 'TM')),
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.practice_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  problem_id  text not null,
  answer      jsonb not null,
  score       numeric(7, 2) not null,
  max_score   numeric(7, 2) not null,
  verdict     text not null,
  created_at  timestamptz not null default now()
);

-- numeric columns come back from PostgREST as JSON numbers; keep it that way.

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index if not exists courses_teacher_idx       on public.courses (teacher_id);
create index if not exists enrollments_student_idx   on public.enrollments (student_id);
create index if not exists assignments_course_idx    on public.assignments (course_id);
create index if not exists questions_assignment_idx  on public.questions (assignment_id, position);
create index if not exists submissions_student_idx   on public.submissions (student_id, question_id);
create index if not exists submissions_assign_idx    on public.submissions (assignment_id);
create index if not exists automata_owner_idx        on public.automata (owner_id);
create index if not exists practice_user_idx         on public.practice_history (user_id, problem_id);

-- ----------------------------------------------------------------------------
-- Helper functions for RLS (SECURITY DEFINER so policies do not recurse)
-- ----------------------------------------------------------------------------

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.teaches_course(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.courses where id = c and teacher_id = auth.uid())
$$;

create or replace function public.enrolled_in(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments where course_id = c and student_id = auth.uid())
$$;

create or replace function public.course_of_assignment(a uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select course_id from public.assignments where id = a
$$;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.courses           enable row level security;
alter table public.enrollments       enable row level security;
alter table public.assignments       enable row level security;
alter table public.questions         enable row level security;
alter table public.submissions       enable row level security;
alter table public.grades            enable row level security;
alter table public.automata          enable row level security;
alter table public.practice_history  enable row level security;

-- profiles: read your own; teachers read the students of their courses; admins everything.
-- Nobody can change their own role (updates are limited to admins + own name via column grant below).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_admin()
  or exists (
    select 1 from public.enrollments e join public.courses c on c.id = e.course_id
    where e.student_id = profiles.id and c.teacher_id = auth.uid()
  )
  or exists ( -- students can see who teaches their courses
    select 1 from public.courses c join public.enrollments e on e.course_id = c.id
    where c.teacher_id = profiles.id and e.student_id = auth.uid()
  )
);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Column-level protection: ordinary users may only change their display name.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- courses
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select to authenticated
  using (public.teaches_course(id) or public.enrolled_in(id));
drop policy if exists courses_insert on public.courses;
create policy courses_insert on public.courses for insert to authenticated
  with check (teacher_id = auth.uid() and public.current_role_name() in ('teacher', 'admin'));
drop policy if exists courses_modify on public.courses;
create policy courses_modify on public.courses for update to authenticated
  using (public.teaches_course(id)) with check (public.teaches_course(id));
drop policy if exists courses_delete on public.courses;
create policy courses_delete on public.courses for delete to authenticated using (public.teaches_course(id));

-- enrollments: the teacher manages them; a student sees and may delete only their own.
-- (Joining by code goes through the backend, which validates the code.)
drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments for select to authenticated
  using (student_id = auth.uid() or public.teaches_course(course_id));
drop policy if exists enrollments_teacher_insert on public.enrollments;
create policy enrollments_teacher_insert on public.enrollments for insert to authenticated
  with check (public.teaches_course(course_id));
drop policy if exists enrollments_delete on public.enrollments;
create policy enrollments_delete on public.enrollments for delete to authenticated
  using (student_id = auth.uid() or public.teaches_course(course_id));

-- assignments: teachers everything; students only published ones of their courses.
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to authenticated
  using (public.teaches_course(course_id) or (published and public.enrolled_in(course_id)));
drop policy if exists assignments_write on public.assignments;
create policy assignments_write on public.assignments for all to authenticated
  using (public.teaches_course(course_id)) with check (public.teaches_course(course_id));

-- questions: ONLY the teacher can read the table, because it contains the
-- reference solutions. Students read questions through the view below.
drop policy if exists questions_teacher on public.questions;
create policy questions_teacher on public.questions for all to authenticated
  using (public.teaches_course(public.course_of_assignment(assignment_id)))
  with check (public.teaches_course(public.course_of_assignment(assignment_id)));

-- Student-safe projection of questions: no reference, no hidden tests.
create or replace view public.questions_public
with (security_barrier = true) as
  select q.id, q.assignment_id, q.position, q.type, q.title, q.prompt, q.marks, q.alphabet, q.given, q.criteria, q.created_at
  from public.questions q
  join public.assignments a on a.id = q.assignment_id
  where public.teaches_course(a.course_id) or (a.published and public.enrolled_in(a.course_id));
revoke all on public.questions_public from anon;
grant select on public.questions_public to authenticated;

-- submissions: a student reads their own; the course teacher reads all.
-- Inserts are done by the backend only (it grades the answer in the same step),
-- so there is deliberately no insert policy for clients.
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (student_id = auth.uid() or public.teaches_course(public.course_of_assignment(assignment_id)));

-- grades: readable by the submitting student and the course teacher;
-- adjustable by the teacher. Students can never write grades.
drop policy if exists grades_select on public.grades;
create policy grades_select on public.grades for select to authenticated using (
  exists (
    select 1 from public.submissions s
    where s.id = grades.submission_id
      and (s.student_id = auth.uid() or public.teaches_course(public.course_of_assignment(s.assignment_id)))
  )
);
drop policy if exists grades_teacher_update on public.grades;
create policy grades_teacher_update on public.grades for update to authenticated using (
  exists (
    select 1 from public.submissions s
    where s.id = grades.submission_id and public.teaches_course(public.course_of_assignment(s.assignment_id))
  )
) with check (
  exists (
    select 1 from public.submissions s
    where s.id = grades.submission_id and public.teaches_course(public.course_of_assignment(s.assignment_id))
  )
);

-- automata: strictly private to their owner.
drop policy if exists automata_owner on public.automata;
create policy automata_owner on public.automata for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- practice history: private; written by the backend after grading.
drop policy if exists practice_select on public.practice_history;
create policy practice_select on public.practice_history for select to authenticated using (user_id = auth.uid());

-- The anon role (not signed in) gets nothing.
revoke all on all tables in schema public from anon;
