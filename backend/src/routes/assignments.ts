import { Router } from 'express';
import { z } from 'zod';
import { gradeAnswer, validateQuestion } from '@automata/algorithms';
import {
  answerSchema,
  answerKindFor,
  assignmentInputSchema,
  gradeAdjustSchema,
  questionInputSchema,
  type Assignment,
  type Enrollment,
  type Grade,
  type GradeResult,
  type Profile,
  type QuestionRow,
  type Submission,
} from '@automata/shared';
import { assignmentAccess, bestAttempts, gradesFor, publicQuestion, questionAccess, requireManager } from '../access';
import { authenticate, HttpError, me, parse, route, type Deps } from '../http';

/** Validate a question definition beyond its JSON shape: can it actually be graded? */
function checkQuestion(q: z.infer<typeof questionInputSchema>) {
  const problems = validateQuestion({ ...q, given: q.given ?? null });
  if (q.reference.kind === 'tests' && q.reference.tests.length === 0) problems.push('Add at least one test string.');
  if (problems.length) throw new HttpError(400, `This question cannot be graded: ${problems[0]}`, problems);
}

/** Run the grading engine; a failure here means the QUESTION is misconfigured, not the answer. */
function grade(question: QuestionRow, answer: z.infer<typeof answerSchema>): GradeResult {
  try {
    return gradeAnswer({ ...question, given: question.given ?? null }, answer);
  } catch (e) {
    throw new HttpError(422, `This question could not be graded automatically: ${(e as Error).message}`);
  }
}

export function assignmentRoutes(deps: Deps): Router {
  const { store } = deps;
  const r = Router();
  r.use(authenticate(deps));

  /* --------------------------- assignments -------------------------- */

  r.get(
    '/assignments/:id',
    route(async (req, res) => {
      const user = me(req);
      const { assignment, course, manages } = await assignmentAccess(store, user, req.params.id!);
      const questions = (await store.find<QuestionRow>('questions', { assignment_id: assignment.id })).sort((a, b) => a.position - b.position);

      if (manages) return res.json({ assignment, course, manages, questions });

      // Student view: public questions plus the caller's own attempts.
      const mine = await store.find<Submission>('submissions', { assignment_id: assignment.id, student_id: user.id });
      const grades = await gradesFor(store, mine);
      const best = bestAttempts(mine, grades);
      res.json({
        assignment,
        course: { id: course.id, title: course.title, code: course.code },
        manages,
        questions: questions.map(publicQuestion),
        progress: questions.map((q) => {
          const entry = best.get(`${user.id}|${q.id}`);
          return { question_id: q.id, attempts: entry?.attempts ?? 0, best: entry?.grade ?? null };
        }),
      });
    }),
  );

  r.patch(
    '/assignments/:id',
    route(async (req, res) => {
      const access = await assignmentAccess(store, me(req), req.params.id!);
      requireManager(access);
      const body = parse(assignmentInputSchema.partial(), req.body);
      if (body.published) {
        const questions = await store.find<QuestionRow>('questions', { assignment_id: access.assignment.id });
        if (questions.length === 0) throw new HttpError(400, 'Add at least one question before publishing.');
      }
      res.json({ assignment: await store.update<Assignment>('assignments', access.assignment.id, body) });
    }),
  );

  r.delete(
    '/assignments/:id',
    route(async (req, res) => {
      const access = await assignmentAccess(store, me(req), req.params.id!);
      requireManager(access);
      await store.remove('assignments', { id: access.assignment.id });
      res.status(204).end();
    }),
  );

  /* ---------------------------- questions --------------------------- */

  r.post(
    '/assignments/:id/questions',
    route(async (req, res) => {
      const access = await assignmentAccess(store, me(req), req.params.id!);
      requireManager(access);
      const body = parse(questionInputSchema, req.body);
      checkQuestion(body);
      const existing = await store.find<QuestionRow>('questions', { assignment_id: access.assignment.id });
      const position = existing.reduce((m, q) => Math.max(m, q.position), 0) + 1;
      res.status(201).json({ question: await store.insert<QuestionRow>('questions', { ...body, given: body.given ?? null, assignment_id: access.assignment.id, position }) });
    }),
  );

  r.patch(
    '/questions/:id',
    route(async (req, res) => {
      const access = await questionAccess(store, me(req), req.params.id!);
      requireManager(access);
      const body = parse(questionInputSchema, req.body);
      checkQuestion(body);
      res.json({ question: await store.update<QuestionRow>('questions', access.question.id, { ...body, given: body.given ?? null }) });
    }),
  );

  r.delete(
    '/questions/:id',
    route(async (req, res) => {
      const access = await questionAccess(store, me(req), req.params.id!);
      requireManager(access);
      await store.remove('questions', { id: access.question.id });
      res.status(204).end();
    }),
  );

  /** Teacher dry-run: grade an answer without storing anything (to check a question works). */
  r.post(
    '/questions/:id/test',
    route(async (req, res) => {
      const access = await questionAccess(store, me(req), req.params.id!);
      requireManager(access);
      const { answer } = parse(z.object({ answer: answerSchema }), req.body);
      res.json({ result: grade(access.question, answer) });
    }),
  );

  /* --------------------------- submissions -------------------------- */

  /** A student submits an answer; it is graded immediately. */
  r.post(
    '/questions/:id/submissions',
    route(async (req, res) => {
      const user = me(req);
      const { question, assignment, enrolled } = await questionAccess(store, user, req.params.id!);
      if (user.role !== 'student' || !enrolled) throw new HttpError(403, 'Only enrolled students can submit answers.');
      const { answer } = parse(z.object({ answer: answerSchema }), req.body);
      if (answer.kind !== answerKindFor(question.type))
        throw new HttpError(400, `This question expects ${answerKindFor(question.type) === 'automaton' ? 'an automaton' : `a ${answerKindFor(question.type)}`}.`);

      const previous = await store.find<Submission>('submissions', { question_id: question.id, student_id: user.id });
      if (assignment.max_attempts !== null && previous.length >= assignment.max_attempts)
        throw new HttpError(409, `You have used all ${assignment.max_attempts} attempt(s) for this question.`);

      const result = grade(question, answer);
      const now = new Date();
      const submission = await store.insert<Submission>('submissions', {
        question_id: question.id,
        assignment_id: assignment.id,
        student_id: user.id,
        answer,
        attempt: previous.length + 1,
        late: !!assignment.due_at && now > new Date(assignment.due_at),
      });
      const gradeRow = await store.insert<Grade>('grades', {
        submission_id: submission.id,
        auto_score: result.score,
        final_score: result.score,
        max_score: result.maxScore,
        verdict: result.verdict,
        exact: result.exact,
        method: result.method,
        feedback: result.feedback,
        counterexample: result.counterexample ?? null,
        adjusted_by: null,
        adjust_note: null,
        updated_at: now.toISOString(),
      });
      res.status(201).json({
        submission,
        grade: gradeRow,
        attempts_left: assignment.max_attempts === null ? null : assignment.max_attempts - previous.length - 1,
      });
    }),
  );

  /** The caller's attempts on one question (newest first). */
  r.get(
    '/questions/:id/submissions/mine',
    route(async (req, res) => {
      const user = me(req);
      const { question } = await questionAccess(store, user, req.params.id!);
      const mine = await store.find<Submission>('submissions', { question_id: question.id, student_id: user.id });
      const grades = await gradesFor(store, mine);
      res.json({
        attempts: mine
          .map((s) => ({ ...s, grade: grades.find((g) => g.submission_id === s.id) ?? null }))
          .sort((a, b) => b.attempt - a.attempt),
      });
    }),
  );

  /** Teacher view: every submission of an assignment with its grade. */
  r.get(
    '/assignments/:id/submissions',
    route(async (req, res) => {
      const access = await assignmentAccess(store, me(req), req.params.id!);
      requireManager(access);
      const [submissions, enrollments, questions] = await Promise.all([
        store.find<Submission>('submissions', { assignment_id: access.assignment.id }),
        store.find<Enrollment>('enrollments', { course_id: access.course.id }),
        store.find<QuestionRow>('questions', { assignment_id: access.assignment.id }),
      ]);
      const grades = await gradesFor(store, submissions);
      const ids = [...new Set([...enrollments.map((e) => e.student_id), ...submissions.map((s) => s.student_id)])];
      const students = await store.find<Profile>('profiles', { id: ids });
      res.json({
        assignment: access.assignment,
        questions: questions.sort((a, b) => a.position - b.position),
        students,
        submissions: submissions.map((s) => ({ ...s, grade: grades.find((g) => g.submission_id === s.id) ?? null })),
      });
    }),
  );

  /** Teacher overrides the automatic score. */
  r.patch(
    '/grades/:id',
    route(async (req, res) => {
      const user = me(req);
      const gradeRow = await store.findOne<Grade>('grades', { id: req.params.id! });
      if (!gradeRow) throw new HttpError(404, 'Grade not found.');
      const submission = await store.findOne<Submission>('submissions', { id: gradeRow.submission_id });
      if (!submission) throw new HttpError(404, 'Submission not found.');
      const access = await assignmentAccess(store, user, submission.assignment_id);
      requireManager(access);
      const body = parse(gradeAdjustSchema, req.body);
      if (body.final_score > gradeRow.max_score) throw new HttpError(400, `The score cannot exceed the maximum of ${gradeRow.max_score}.`);
      const updated = await store.update<Grade>('grades', gradeRow.id, {
        final_score: body.final_score,
        adjusted_by: user.id,
        adjust_note: body.note,
        updated_at: new Date().toISOString(),
      });
      res.json({ grade: updated });
    }),
  );

  return r;
}
