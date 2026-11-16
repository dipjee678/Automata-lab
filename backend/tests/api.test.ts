/**
 * Integration tests: the real Express app on an in-memory store.
 * Covers authentication, role permissions, the course → assignment →
 * submission → grade flow, and data isolation between users.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildAutomaton } from '@automata/algorithms';
import { defaultCriteria } from '@automata/shared';
import { createApp, createTestDeps } from '../src/app';
import { hashPassword, verifyPassword } from '../src/auth/provider';
import { seedDemo, SEED_PASSWORD } from '../src/seed';
import type { Profile } from '@automata/shared';

const deps = createTestDeps();
const app = createApp(deps);
const api = request(app);

const div3 = buildAutomaton('DFA', {
  states: ['r0', 'r1', 'r2'],
  initial: 'r0',
  accepting: ['r0'],
  transitions: [
    ['r0', '0', 'r0'],
    ['r0', '1', 'r1'],
    ['r1', '0', 'r2'],
    ['r1', '1', 'r0'],
    ['r2', '0', 'r1'],
    ['r2', '1', 'r2'],
  ],
});
const acceptAll = buildAutomaton('DFA', { states: ['p'], initial: 'p', accepting: ['p'], transitions: [['p', '0,1', 'p']] });

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

async function register(who: string, role: 'teacher' | 'student') {
  const res = await api.post('/api/auth/register').send({ email: `${who}@example.com`, password: 'correct-horse-9', full_name: who, role });
  expect(res.status).toBe(201);
  tokens[who] = res.body.token;
  ids[who] = res.body.user.id;
}

beforeAll(async () => {
  await register('teacher', 'teacher');
  await register('other-teacher', 'teacher');
  await register('alice', 'student');
  await register('bob', 'student');
  // Promote an admin directly in the store (admins cannot self-register).
  await register('root', 'student');
  await deps.store.update<Profile>('profiles', ids.root!, { role: 'admin' });
});

describe('authentication', () => {
  it('hashes passwords with a salt and verifies them', async () => {
    const h1 = await hashPassword('secret-password');
    const h2 = await hashPassword('secret-password');
    expect(h1).not.toBe(h2);
    expect(h1).not.toContain('secret-password');
    expect(await verifyPassword('secret-password', h1)).toBe(true);
    expect(await verifyPassword('wrong', h1)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('validates registration input', async () => {
    expect((await api.post('/api/auth/register').send({ email: 'nope', password: 'longenough1', full_name: 'x' })).status).toBe(400);
    expect((await api.post('/api/auth/register').send({ email: 'a@b.co', password: 'short', full_name: 'x' })).status).toBe(400);
    expect((await api.post('/api/auth/register').send({ email: 'alice@example.com', password: 'correct-horse-9', full_name: 'dup' })).status).toBe(409);
  });

  it('never lets anyone self-register as admin', async () => {
    const res = await api.post('/api/auth/register').send({ email: 'evil@example.com', password: 'correct-horse-9', full_name: 'evil', role: 'admin' });
    expect(res.status).toBe(400);
  });

  it('logs in with correct credentials only', async () => {
    const ok = await api.post('/api/auth/login').send({ email: 'ALICE@example.com', password: 'correct-horse-9' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: 'alice@example.com', role: 'student' });
    expect(ok.body.user.password_hash).toBeUndefined();
    expect((await api.post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong-password' })).status).toBe(401);
    expect((await api.post('/api/auth/login').send({ email: 'ghost@example.com', password: 'whatever-123' })).status).toBe(401);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await api.get('/api/auth/me')).status).toBe(401);
    expect((await api.get('/api/auth/me').set('Authorization', 'Bearer not.a.token')).status).toBe(401);
    expect((await api.get('/api/courses').set('Authorization', 'Basic abc')).status).toBe(401);
    expect((await api.get('/api/auth/me').set(as('alice'))).body.user.email).toBe('alice@example.com');
  });
});

describe('role permissions', () => {
  it('only teachers and admins create courses', async () => {
    expect((await api.post('/api/courses').set(as('alice')).send({ title: 'x', code: 'X1' })).status).toBe(403);
  });

  it('only admins manage users', async () => {
    expect((await api.get('/api/admin/users').set(as('teacher'))).status).toBe(403);
    expect((await api.get('/api/admin/users').set(as('alice'))).status).toBe(403);
    const res = await api.get('/api/admin/users').set(as('root'));
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('admins change roles but cannot demote or delete themselves', async () => {
    expect((await api.patch(`/api/admin/users/${ids.bob}`).set(as('root')).send({ role: 'teacher' })).body.user.role).toBe('teacher');
    expect((await api.patch(`/api/admin/users/${ids.bob}`).set(as('root')).send({ role: 'student' })).body.user.role).toBe('student');
    expect((await api.patch(`/api/admin/users/${ids.root}`).set(as('root')).send({ role: 'student' })).status).toBe(400);
    expect((await api.delete(`/api/admin/users/${ids.root}`).set(as('root'))).status).toBe(400);
    expect((await api.patch(`/api/admin/users/${ids.bob}`).set(as('root')).send({ role: 'wizard' })).status).toBe(400);
  });
});

describe('course → assignment → submission → grade', () => {
  let courseId = '';
  let joinCode = '';
  let assignmentId = '';
  let questionId = '';
  let gradeId = '';

  it('teacher creates a course and students join by code', async () => {
    const res = await api.post('/api/courses').set(as('teacher')).send({ title: 'Automata', code: 'CS 301', description: '' });
    expect(res.status).toBe(201);
    courseId = res.body.course.id;
    joinCode = res.body.course.join_code;
    expect(joinCode).toMatch(/^[A-Z0-9]{7}$/);

    expect((await api.post('/api/courses/join').set(as('alice')).send({ join_code: 'WRONG00' })).status).toBe(404);
    expect((await api.post('/api/courses/join').set(as('alice')).send({ join_code: joinCode.toLowerCase() })).status).toBe(201);
    expect((await api.post('/api/courses/join').set(as('alice')).send({ join_code: joinCode })).status).toBe(409);
    expect((await api.post('/api/courses/join').set(as('teacher')).send({ join_code: joinCode })).status).toBe(403);
  });

  it('hides the course from non-members and the join code from students', async () => {
    expect((await api.get(`/api/courses/${courseId}`).set(as('bob'))).status).toBe(403);
    expect((await api.get(`/api/courses/${courseId}`).set(as('other-teacher'))).status).toBe(403);
    const student = await api.get(`/api/courses/${courseId}`).set(as('alice'));
    expect(student.body.course.join_code).toBeUndefined();
    expect(student.body.students).toEqual([]);
    const teacher = await api.get(`/api/courses/${courseId}`).set(as('teacher'));
    expect(teacher.body.students.map((s: Profile) => s.email)).toEqual(['alice@example.com']);
    expect((await api.get(`/api/courses/${courseId}`).set(as('root'))).body.manages).toBe(true);
  });

  it('teacher enrols and removes students by email', async () => {
    expect((await api.post(`/api/courses/${courseId}/enrollments`).set(as('teacher')).send({ email: 'bob@example.com' })).status).toBe(201);
    expect((await api.post(`/api/courses/${courseId}/enrollments`).set(as('teacher')).send({ email: 'bob@example.com' })).status).toBe(409);
    expect((await api.post(`/api/courses/${courseId}/enrollments`).set(as('teacher')).send({ email: 'nobody@example.com' })).status).toBe(404);
    expect((await api.post(`/api/courses/${courseId}/enrollments`).set(as('alice')).send({ email: 'bob@example.com' })).status).toBe(403);
    expect((await api.delete(`/api/courses/${courseId}/enrollments/${ids.bob}`).set(as('alice'))).status).toBe(403);
    expect((await api.delete(`/api/courses/${courseId}/enrollments/${ids.bob}`).set(as('teacher'))).status).toBe(204);
    expect((await api.post(`/api/courses/${courseId}/enrollments`).set(as('teacher')).send({ email: 'bob@example.com' })).status).toBe(201);
  });

  it('teacher creates an assignment; publishing needs a question', async () => {
    expect((await api.post(`/api/courses/${courseId}/assignments`).set(as('alice')).send({ title: 'HW' })).status).toBe(403);
    expect((await api.post(`/api/courses/${courseId}/assignments`).set(as('other-teacher')).send({ title: 'HW' })).status).toBe(403);
    const res = await api.post(`/api/courses/${courseId}/assignments`).set(as('teacher')).send({ title: 'HW 1', max_attempts: 3 });
    expect(res.status).toBe(201);
    assignmentId = res.body.assignment.id;
    expect((await api.patch(`/api/assignments/${assignmentId}`).set(as('teacher')).send({ published: true })).status).toBe(400);
  });

  it('rejects questions that cannot be graded', async () => {
    const base = { title: 'q', prompt: '', marks: 10, alphabet: ['0', '1'] };
    const bad = await api.post(`/api/assignments/${assignmentId}/questions`).set(as('teacher')).send({ ...base, type: 'regex', reference: { kind: 'regex', regex: '(0|1' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/cannot be graded/);
    const noGiven = await api.post(`/api/assignments/${assignmentId}/questions`).set(as('teacher')).send({ ...base, type: 'dfa_minimize', reference: { kind: 'given' } });
    expect(noGiven.status).toBe(400);
    expect((await api.post(`/api/assignments/${assignmentId}/questions`).set(as('teacher')).send({ ...base, type: 'nonsense', reference: { kind: 'regex', regex: '0' } })).status).toBe(400);
  });

  it('teacher adds a question, tests it and publishes', async () => {
    const res = await api
      .post(`/api/assignments/${assignmentId}/questions`)
      .set(as('teacher'))
      .send({ type: 'dfa_construct', title: 'Divisible by 3', prompt: 'Build it.', marks: 10, alphabet: ['0', '1'], reference: { kind: 'automaton', automaton: div3 }, criteria: defaultCriteria() });
    expect(res.status).toBe(201);
    questionId = res.body.question.id;

    const dry = await api.post(`/api/questions/${questionId}/test`).set(as('teacher')).send({ answer: { kind: 'automaton', automaton: div3 } });
    expect(dry.body.result).toMatchObject({ verdict: 'correct', score: 10 });
    expect((await api.post(`/api/questions/${questionId}/test`).set(as('alice')).send({ answer: { kind: 'automaton', automaton: div3 } })).status).toBe(404); // unpublished = invisible

    expect((await api.get(`/api/assignments/${assignmentId}`).set(as('alice'))).status).toBe(404);
    expect((await api.patch(`/api/assignments/${assignmentId}`).set(as('teacher')).send({ published: true })).status).toBe(200);
  });

  it('never sends the reference solution to students', async () => {
    const res = await api.get(`/api/assignments/${assignmentId}`).set(as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].reference).toBeUndefined();
    expect(res.body.questions[0].tests).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('"reference"');
    const teacher = await api.get(`/api/assignments/${assignmentId}`).set(as('teacher'));
    expect(teacher.body.questions[0].reference.kind).toBe('automaton');
  });

  it('grades a wrong submission with a counterexample, then a correct one', async () => {
    const wrong = await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({ answer: { kind: 'automaton', automaton: acceptAll } });
    expect(wrong.status).toBe(201);
    expect(wrong.body.grade).toMatchObject({ verdict: 'incorrect', final_score: 0, exact: true });
    expect(wrong.body.grade.counterexample).toEqual({ input: '1', expected: false, actual: true });
    expect(wrong.body.attempts_left).toBe(2);

    const right = await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({ answer: { kind: 'automaton', automaton: div3 } });
    expect(right.body.grade).toMatchObject({ verdict: 'correct', final_score: 10, max_score: 10 });
    expect(right.body.submission.attempt).toBe(2);
    gradeId = wrong.body.grade.id;
  });

  it('validates submissions and enforces the attempt limit', async () => {
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({ answer: { kind: 'regex', regex: '0*' } })).status).toBe(400);
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({ answer: { kind: 'automaton', automaton: { type: 'DFA', states: 'oops' } } })).status).toBe(400);
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({})).status).toBe(400);
    // Third (last) attempt: an invalid automaton is still an attempt, graded as invalid.
    const invalid = await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({ answer: { kind: 'automaton', automaton: { type: 'DFA', states: [], transitions: [] } } });
    expect(invalid.body.grade.verdict).toBe('invalid');
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('alice')).send({ answer: { kind: 'automaton', automaton: div3 } })).status).toBe(409);
  });

  it('only enrolled students submit', async () => {
    const body = { answer: { kind: 'automaton', automaton: div3 } };
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('teacher')).send(body)).status).toBe(403);
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('other-teacher')).send(body)).status).toBe(403);
    await api.delete(`/api/courses/${courseId}/enrollments/${ids.bob}`).set(as('teacher'));
    expect((await api.post(`/api/questions/${questionId}/submissions`).set(as('bob')).send(body)).status).toBe(403);
  });

  it('students see only their own attempts; the best attempt counts', async () => {
    const mine = await api.get(`/api/questions/${questionId}/submissions/mine`).set(as('alice'));
    expect(mine.body.attempts.map((a: { attempt: number }) => a.attempt)).toEqual([3, 2, 1]);
    const view = await api.get(`/api/assignments/${assignmentId}`).set(as('alice'));
    expect(view.body.progress[0]).toMatchObject({ attempts: 3, best: { final_score: 10 } });
    expect((await api.get(`/api/assignments/${assignmentId}/submissions`).set(as('alice'))).status).toBe(403);
  });

  it('teacher reviews submissions and adjusts a grade', async () => {
    const list = await api.get(`/api/assignments/${assignmentId}/submissions`).set(as('teacher'));
    expect(list.body.submissions).toHaveLength(3);
    expect((await api.patch(`/api/grades/${gradeId}`).set(as('alice')).send({ final_score: 10 })).status).toBe(403);
    expect((await api.patch(`/api/grades/${gradeId}`).set(as('other-teacher')).send({ final_score: 10 })).status).toBe(403);
    expect((await api.patch(`/api/grades/${gradeId}`).set(as('teacher')).send({ final_score: 11 })).status).toBe(400);
    const res = await api.patch(`/api/grades/${gradeId}`).set(as('teacher')).send({ final_score: 4, note: 'Good attempt' });
    expect(res.body.grade).toMatchObject({ final_score: 4, auto_score: 0, adjusted_by: ids.teacher, adjust_note: 'Good attempt' });
  });

  it('produces class analytics for the teacher only', async () => {
    expect((await api.get(`/api/courses/${courseId}/analytics`).set(as('alice'))).status).toBe(403);
    const res = await api.get(`/api/courses/${courseId}/analytics`).set(as('teacher'));
    expect(res.body).toMatchObject({ students: 1, questions: 1, total_marks: 10, class_average: 100 });
    expect(res.body.perQuestion[0]).toMatchObject({ attempted: 1, attempts: 3, correct: 1, average_percent: 100 });
    expect(res.body.distribution).toEqual([0, 0, 0, 0, 1]);
  });

  it('builds role-specific dashboards', async () => {
    expect((await api.get('/api/dashboard').set(as('alice'))).body).toMatchObject({ role: 'student', courses: 1, assignments: 1, completed: 1, average: 100 });
    expect((await api.get('/api/dashboard').set(as('teacher'))).body).toMatchObject({ role: 'teacher', courses: 1, students: 1, submissions: 3 });
    expect((await api.get('/api/dashboard').set(as('root'))).body.role).toBe('admin');
  });

  it('deleting the course removes its assignments, questions, submissions and grades', async () => {
    expect((await api.delete(`/api/courses/${courseId}`).set(as('other-teacher'))).status).toBe(403);
    expect((await api.delete(`/api/courses/${courseId}`).set(as('teacher'))).status).toBe(204);
    for (const table of ['assignments', 'questions', 'submissions', 'grades', 'enrollments'] as const) expect(await deps.store.find(table)).toEqual([]);
  });
});

describe('saved automata and practice', () => {
  it('saves, lists, updates and deletes automata per owner', async () => {
    const created = await api.post('/api/automata').set(as('alice')).send({ name: 'My DFA', data: div3 });
    expect(created.status).toBe(201);
    const id = created.body.automaton.id;
    expect((await api.get('/api/automata').set(as('alice'))).body.automata).toHaveLength(1);
    expect((await api.get('/api/automata').set(as('bob'))).body.automata).toHaveLength(0);
    expect((await api.get(`/api/automata/${id}`).set(as('bob'))).status).toBe(404);
    expect((await api.put(`/api/automata/${id}`).set(as('bob')).send({ name: 'stolen', data: div3 })).status).toBe(404);
    expect((await api.delete(`/api/automata/${id}`).set(as('bob'))).status).toBe(404);
    expect((await api.put(`/api/automata/${id}`).set(as('alice')).send({ name: 'Renamed', data: acceptAll })).body.automaton.name).toBe('Renamed');
    expect((await api.post('/api/automata').set(as('alice')).send({ name: '', data: div3 })).status).toBe(400);
    expect((await api.post('/api/automata').set(as('alice')).send({ name: 'bad', data: { type: 'XYZ' } })).status).toBe(400);
    expect((await api.delete(`/api/automata/${id}`).set(as('alice'))).status).toBe(204);
  });

  it('serves practice problems without solutions and records attempts', async () => {
    const list = await api.get('/api/practice/problems').set(as('alice'));
    expect(list.body.problems.length).toBeGreaterThan(10);
    expect(JSON.stringify(list.body)).not.toContain('reference');
    const wrong = await api.post('/api/practice/problems/regex-even-length/check').set(as('alice')).send({ answer: { kind: 'regex', regex: '(a|b)*' } });
    expect(wrong.body.result.counterexample).toEqual({ input: 'a', expected: false, actual: true });
    const right = await api.post('/api/practice/problems/regex-even-length/check').set(as('alice')).send({ answer: { kind: 'regex', regex: '(aa|ab|ba|bb)*' } });
    expect(right.body.result.verdict).toBe('correct');
    const after = await api.get('/api/practice/problems').set(as('alice'));
    expect(after.body.problems.find((p: { id: string }) => p.id === 'regex-even-length')).toMatchObject({ attempts: 2, solved: true, best_score: 10 });
    expect((await api.get('/api/practice/history').set(as('alice'))).body.history).toHaveLength(2);
    expect((await api.get('/api/practice/history').set(as('bob'))).body.history).toHaveLength(0);
    expect((await api.post('/api/practice/problems/nope/check').set(as('alice')).send({ answer: { kind: 'regex', regex: 'a' } })).status).toBe(404);
  });
});

describe('demo seed', () => {
  it('creates working accounts and a gradable course, and is idempotent', async () => {
    const fresh = createTestDeps();
    expect(await seedDemo(fresh)).toBe(true);
    expect(await seedDemo(fresh)).toBe(false);
    const seeded = request(createApp(fresh));
    const login = await seeded.post('/api/auth/login').send({ email: 'student@automatalab.test', password: SEED_PASSWORD });
    expect(login.status).toBe(200);
    const courses = await seeded.get('/api/courses').set('Authorization', `Bearer ${login.body.token}`);
    expect(courses.body.courses).toHaveLength(1);
    expect(courses.body.courses[0]).toMatchObject({ code: 'CSE 331', assignment_count: 2, student_count: 2 });
    expect(await fresh.store.find('grades')).toHaveLength(4);
  });

  it('every built-in practice problem has a consistent reference', async () => {
    const { PRACTICE_PROBLEMS } = await import('../src/practice/problems');
    const { validateQuestion } = await import('@automata/algorithms');
    for (const p of PRACTICE_PROBLEMS) expect(validateQuestion(p.question), p.id).toEqual([]);
  });

  it('removing a user removes their data', async () => {
    const fresh = createTestDeps();
    await seedDemo(fresh);
    const seeded = request(createApp(fresh));
    const admin = await seeded.post('/api/auth/login').send({ email: 'admin@automatalab.test', password: SEED_PASSWORD });
    const student2 = (await fresh.store.findOne<Profile>('profiles', { email: 'student2@automatalab.test' }))!;
    expect((await seeded.delete(`/api/admin/users/${student2.id}`).set('Authorization', `Bearer ${admin.body.token}`)).status).toBe(204);
    expect(await fresh.store.find('submissions')).toEqual([]);
    expect(await fresh.store.find('grades')).toEqual([]);
    expect((await seeded.post('/api/auth/login').send({ email: 'student2@automatalab.test', password: SEED_PASSWORD })).status).toBe(401);
  });
});
