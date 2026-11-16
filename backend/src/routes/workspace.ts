/**
 * Personal workspace routes: saved automata, practice problems, and the
 * role-specific dashboard summary.
 */
import { Router } from 'express';
import { z } from 'zod';
import { gradeAnswer } from '@automata/algorithms';
import {
  answerSchema,
  savedAutomatonInputSchema,
  type Assignment,
  type Course,
  type Enrollment,
  type PracticeHistory,
  type Profile,
  type QuestionRow,
  type SavedAutomaton,
  type Submission,
} from '@automata/shared';
import { bestAttempts, gradesFor, percent } from '../access';
import { authenticate, HttpError, me, parse, route, type Deps } from '../http';
import { PRACTICE_PROBLEMS, publicProblem } from '../practice/problems';

export function workspaceRoutes(deps: Deps): Router {
  const { store } = deps;
  const r = Router();
  r.use(authenticate(deps));

  /* ------------------------- saved automata ------------------------- */

  r.get(
    '/automata',
    route(async (req, res) => {
      const rows = await store.find<SavedAutomaton>('automata', { owner_id: me(req).id });
      res.json({ automata: rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)) });
    }),
  );

  r.post(
    '/automata',
    route(async (req, res) => {
      const body = parse(savedAutomatonInputSchema, req.body);
      const count = (await store.find<SavedAutomaton>('automata', { owner_id: me(req).id })).length;
      if (count >= 200) throw new HttpError(400, 'You have reached the limit of 200 saved automata.');
      const now = new Date().toISOString();
      const row = await store.insert<SavedAutomaton>('automata', { owner_id: me(req).id, name: body.name.trim(), type: body.data.type, data: body.data, updated_at: now });
      res.status(201).json({ automaton: row });
    }),
  );

  const owned = async (userId: string, id: string) => {
    const row = await store.findOne<SavedAutomaton>('automata', { id });
    // Same response for "missing" and "not yours" so ids cannot be probed.
    if (!row || row.owner_id !== userId) throw new HttpError(404, 'Saved automaton not found.');
    return row;
  };

  r.get(
    '/automata/:id',
    route(async (req, res) => {
      res.json({ automaton: await owned(me(req).id, req.params.id!) });
    }),
  );

  r.put(
    '/automata/:id',
    route(async (req, res) => {
      const row = await owned(me(req).id, req.params.id!);
      const body = parse(savedAutomatonInputSchema, req.body);
      res.json({
        automaton: await store.update<SavedAutomaton>('automata', row.id, { name: body.name.trim(), type: body.data.type, data: body.data, updated_at: new Date().toISOString() }),
      });
    }),
  );

  r.delete(
    '/automata/:id',
    route(async (req, res) => {
      const row = await owned(me(req).id, req.params.id!);
      await store.remove('automata', { id: row.id });
      res.status(204).end();
    }),
  );

  /* ---------------------------- practice ---------------------------- */

  r.get(
    '/practice/problems',
    route(async (req, res) => {
      const history = await store.find<PracticeHistory>('practice_history', { user_id: me(req).id });
      res.json({
        problems: PRACTICE_PROBLEMS.map((p) => {
          const mine = history.filter((h) => h.problem_id === p.id);
          return {
            ...publicProblem(p),
            attempts: mine.length,
            best_score: mine.length ? Math.max(...mine.map((h) => h.score)) : null,
            solved: mine.some((h) => h.verdict === 'correct'),
          };
        }),
      });
    }),
  );

  r.post(
    '/practice/problems/:id/check',
    route(async (req, res) => {
      const problem = PRACTICE_PROBLEMS.find((p) => p.id === req.params.id);
      if (!problem) throw new HttpError(404, 'Practice problem not found.');
      const { answer } = parse(z.object({ answer: answerSchema }), req.body);
      const result = gradeAnswer(problem.question, answer);
      await store.insert('practice_history', {
        user_id: me(req).id,
        problem_id: problem.id,
        answer,
        score: result.score,
        max_score: result.maxScore,
        verdict: result.verdict,
      });
      res.json({ result });
    }),
  );

  r.get(
    '/practice/history',
    route(async (req, res) => {
      const rows = await store.find<PracticeHistory>('practice_history', { user_id: me(req).id });
      const titles = new Map(PRACTICE_PROBLEMS.map((p) => [p.id, p.title]));
      res.json({
        history: rows
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 100)
          .map((h) => ({ ...h, title: titles.get(h.problem_id) ?? h.problem_id })),
      });
    }),
  );

  /* ---------------------------- dashboard --------------------------- */

  r.get(
    '/dashboard',
    route(async (req, res) => {
      const user = me(req);

      if (user.role === 'admin') {
        const [profiles, courses, submissions] = await Promise.all([
          store.find<Profile>('profiles'),
          store.find<Course>('courses'),
          store.find<Submission>('submissions'),
        ]);
        return res.json({
          role: 'admin',
          users: profiles.length,
          admins: profiles.filter((p) => p.role === 'admin').length,
          teachers: profiles.filter((p) => p.role === 'teacher').length,
          students: profiles.filter((p) => p.role === 'student').length,
          courses: courses.length,
          submissions: submissions.length,
          recentUsers: profiles.slice(-5).reverse(),
        });
      }

      if (user.role === 'teacher') {
        const courses = await store.find<Course>('courses', { teacher_id: user.id });
        const ids = courses.map((c) => c.id);
        const [enrollments, assignments] = await Promise.all([
          store.find<Enrollment>('enrollments', { course_id: ids }),
          store.find<Assignment>('assignments', { course_id: ids }),
        ]);
        const submissions = await store.find<Submission>('submissions', { assignment_id: assignments.map((a) => a.id) });
        const grades = await gradesFor(store, submissions);
        const gradeOf = new Map(grades.map((g) => [g.submission_id, g]));
        const recent = submissions.slice(-8).reverse();
        const [students, questions] = await Promise.all([
          store.find<Profile>('profiles', { id: [...new Set(recent.map((s) => s.student_id))] }),
          store.find<QuestionRow>('questions', { id: [...new Set(recent.map((s) => s.question_id))] }),
        ]);
        return res.json({
          role: 'teacher',
          courses: courses.length,
          students: new Set(enrollments.map((e) => e.student_id)).size,
          assignments: assignments.length,
          published: assignments.filter((a) => a.published).length,
          submissions: submissions.length,
          needsReview: grades.filter((g) => !g.exact && !g.adjusted_by).length,
          recent: recent.map((s) => ({
            id: s.id,
            assignment_id: s.assignment_id,
            created_at: s.created_at,
            student: students.find((p) => p.id === s.student_id)?.full_name ?? 'Unknown',
            question: questions.find((q) => q.id === s.question_id)?.title ?? 'Question',
            verdict: gradeOf.get(s.id)?.verdict ?? null,
            score: gradeOf.get(s.id)?.final_score ?? null,
            max_score: gradeOf.get(s.id)?.max_score ?? null,
            exact: gradeOf.get(s.id)?.exact ?? null,
          })),
        });
      }

      // Student
      const enrollments = await store.find<Enrollment>('enrollments', { student_id: user.id });
      const courses = await store.find<Course>('courses', { id: enrollments.map((e) => e.course_id) });
      const assignments = (await store.find<Assignment>('assignments', { course_id: courses.map((c) => c.id) })).filter((a) => a.published);
      const [questions, submissions, practice] = await Promise.all([
        store.find<QuestionRow>('questions', { assignment_id: assignments.map((a) => a.id) }),
        store.find<Submission>('submissions', { student_id: user.id, assignment_id: assignments.map((a) => a.id) }),
        store.find<PracticeHistory>('practice_history', { user_id: user.id }),
      ]);
      const grades = await gradesFor(store, submissions);
      const best = bestAttempts(submissions, grades);
      const rows = assignments.map((a) => {
        const qs = questions.filter((q) => q.assignment_id === a.id);
        const entries = qs.map((q) => best.get(`${user.id}|${q.id}`)).filter(Boolean);
        const total = qs.reduce((s, q) => s + q.marks, 0);
        const score = entries.reduce((s, e) => s + e!.grade.final_score, 0);
        return {
          id: a.id,
          title: a.title,
          course: courses.find((c) => c.id === a.course_id)?.title ?? '',
          due_at: a.due_at,
          questions: qs.length,
          answered: entries.length,
          score,
          total,
          percent: percent(score, total),
        };
      });
      const earned = rows.reduce((s, x) => s + x.score, 0);
      const possible = rows.filter((x) => x.answered > 0).reduce((s, x) => s + x.total, 0);
      const gradeOf = new Map(grades.map((g) => [g.submission_id, g]));
      res.json({
        role: 'student',
        courses: courses.length,
        assignments: rows.length,
        completed: rows.filter((x) => x.questions > 0 && x.answered === x.questions).length,
        average: possible ? percent(earned, possible) : null,
        practiceSolved: new Set(practice.filter((p) => p.verdict === 'correct').map((p) => p.problem_id)).size,
        practiceAttempts: practice.length,
        practiceTotal: PRACTICE_PROBLEMS.length,
        upcoming: rows.filter((x) => x.answered < x.questions).sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')),
        assignmentsList: rows,
        recent: submissions
          .slice(-6)
          .reverse()
          .map((s) => ({
            id: s.id,
            assignment_id: s.assignment_id,
            created_at: s.created_at,
            question: questions.find((q) => q.id === s.question_id)?.title ?? 'Question',
            verdict: gradeOf.get(s.id)?.verdict ?? null,
            score: gradeOf.get(s.id)?.final_score ?? null,
            max_score: gradeOf.get(s.id)?.max_score ?? null,
          })),
      });
    }),
  );

  return r;
}
