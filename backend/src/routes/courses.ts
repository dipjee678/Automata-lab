import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import {
  assignmentInputSchema,
  courseInputSchema,
  type Assignment,
  type Course,
  type Enrollment,
  type Profile,
  type QuestionRow,
  type Submission,
} from '@automata/shared';
import { bestAttempts, courseAccess, gradesFor, percent, requireManager } from '../access';
import { authenticate, HttpError, me, parse, requireRole, route, type Deps } from '../http';

/** Human-friendly join code without ambiguous characters. */
const newJoinCode = () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...randomBytes(7)].map((b) => alphabet[b % alphabet.length]).join('');
};

export function courseRoutes(deps: Deps): Router {
  const { store } = deps;
  const r = Router();
  r.use(authenticate(deps));

  /** Courses the caller teaches (teacher), is enrolled in (student), or all (admin). */
  r.get(
    '/courses',
    route(async (req, res) => {
      const user = me(req);
      let courses: Course[];
      if (user.role === 'admin') courses = await store.find<Course>('courses');
      else if (user.role === 'teacher') courses = await store.find<Course>('courses', { teacher_id: user.id });
      else {
        const mine = await store.find<Enrollment>('enrollments', { student_id: user.id });
        courses = await store.find<Course>('courses', { id: mine.map((e) => e.course_id) });
      }
      const ids = courses.map((c) => c.id);
      const [enrollments, assignments, teachers] = await Promise.all([
        store.find<Enrollment>('enrollments', { course_id: ids }),
        store.find<Assignment>('assignments', { course_id: ids }),
        store.find<Profile>('profiles', { id: [...new Set(courses.map((c) => c.teacher_id))] }),
      ]);
      const teacherName = new Map(teachers.map((t) => [t.id, t.full_name]));
      res.json({
        courses: courses.map((c) => ({
          ...c,
          join_code: user.role === 'student' ? undefined : c.join_code,
          teacher_name: teacherName.get(c.teacher_id) ?? 'Unknown',
          student_count: enrollments.filter((e) => e.course_id === c.id).length,
          assignment_count: assignments.filter((a) => a.course_id === c.id && (user.role !== 'student' || a.published)).length,
        })),
      });
    }),
  );

  r.post(
    '/courses',
    requireRole('teacher', 'admin'),
    route(async (req, res) => {
      const body = parse(courseInputSchema, req.body);
      const course = await store.insert<Course>('courses', { ...body, teacher_id: me(req).id, join_code: newJoinCode() });
      res.status(201).json({ course });
    }),
  );

  /** Students join with the code their teacher shares. */
  r.post(
    '/courses/join',
    requireRole('student'),
    route(async (req, res) => {
      const { join_code } = parse(z.object({ join_code: z.string().min(1).max(20) }), req.body);
      const course = await store.findOne<Course>('courses', { join_code: join_code.trim().toUpperCase() });
      if (!course) throw new HttpError(404, 'No course has this join code.');
      const existing = await store.findOne<Enrollment>('enrollments', { course_id: course.id, student_id: me(req).id });
      if (existing) throw new HttpError(409, 'You are already enrolled in this course.');
      await store.insert('enrollments', { course_id: course.id, student_id: me(req).id });
      res.status(201).json({ course: { ...course, join_code: undefined } });
    }),
  );

  r.get(
    '/courses/:id',
    route(async (req, res) => {
      const user = me(req);
      const { course, manages } = await courseAccess(store, user, req.params.id!);
      const all = await store.find<Assignment>('assignments', { course_id: course.id });
      const assignments = manages ? all : all.filter((a) => a.published);
      const questions = await store.find<QuestionRow>('questions', { assignment_id: assignments.map((a) => a.id) });
      const teacher = await store.findOne<Profile>('profiles', { id: course.teacher_id });

      // Progress per assignment for the calling student.
      const mine = manages ? [] : await store.find<Submission>('submissions', { student_id: user.id, assignment_id: assignments.map((a) => a.id) });
      const best = bestAttempts(mine, await gradesFor(store, mine));

      const summary = assignments.map((a) => {
        const qs = questions.filter((q) => q.assignment_id === a.id);
        const total = qs.reduce((s, q) => s + q.marks, 0);
        const entries = qs.map((q) => best.get(`${user.id}|${q.id}`)).filter(Boolean);
        return {
          ...a,
          question_count: qs.length,
          total_marks: total,
          ...(manages ? {} : { my_score: entries.reduce((s, e) => s + e!.grade.final_score, 0), my_answered: entries.length }),
        };
      });

      let students: Array<Profile & { enrolled_at: string }> = [];
      if (manages) {
        const enrollments = await store.find<Enrollment>('enrollments', { course_id: course.id });
        const profiles = await store.find<Profile>('profiles', { id: enrollments.map((e) => e.student_id) });
        students = profiles.map((p) => ({ ...p, enrolled_at: enrollments.find((e) => e.student_id === p.id)!.created_at }));
      }
      res.json({
        course: { ...course, join_code: manages ? course.join_code : undefined, teacher_name: teacher?.full_name ?? 'Unknown' },
        manages,
        assignments: summary,
        students,
      });
    }),
  );

  r.patch(
    '/courses/:id',
    route(async (req, res) => {
      const access = await courseAccess(store, me(req), req.params.id!);
      requireManager(access);
      const body = parse(courseInputSchema.partial(), req.body);
      res.json({ course: await store.update<Course>('courses', access.course.id, body) });
    }),
  );

  r.delete(
    '/courses/:id',
    route(async (req, res) => {
      const access = await courseAccess(store, me(req), req.params.id!);
      requireManager(access);
      await store.remove('courses', { id: access.course.id });
      res.status(204).end();
    }),
  );

  /** Teacher enrols a student by email. */
  r.post(
    '/courses/:id/enrollments',
    route(async (req, res) => {
      const access = await courseAccess(store, me(req), req.params.id!);
      requireManager(access);
      const { email } = parse(z.object({ email: z.string().email() }), req.body);
      const student = await store.findOne<Profile>('profiles', { email: email.trim().toLowerCase() });
      if (!student) throw new HttpError(404, 'No account uses this email address.');
      if (student.role !== 'student') throw new HttpError(400, 'Only student accounts can be enrolled.');
      if (await store.findOne<Enrollment>('enrollments', { course_id: access.course.id, student_id: student.id }))
        throw new HttpError(409, 'This student is already enrolled.');
      await store.insert('enrollments', { course_id: access.course.id, student_id: student.id });
      res.status(201).json({ student });
    }),
  );

  /** Teacher removes a student, or a student leaves. */
  r.delete(
    '/courses/:id/enrollments/:studentId',
    route(async (req, res) => {
      const user = me(req);
      const access = await courseAccess(store, user, req.params.id!);
      if (!access.manages && user.id !== req.params.studentId) throw new HttpError(403, 'You can only remove yourself from a course.');
      const n = await store.remove('enrollments', { course_id: access.course.id, student_id: req.params.studentId! });
      if (!n) throw new HttpError(404, 'This student is not enrolled.');
      res.status(204).end();
    }),
  );

  r.post(
    '/courses/:id/assignments',
    route(async (req, res) => {
      const access = await courseAccess(store, me(req), req.params.id!);
      requireManager(access);
      const body = parse(assignmentInputSchema, req.body);
      res.status(201).json({ assignment: await store.insert<Assignment>('assignments', { ...body, course_id: access.course.id }) });
    }),
  );

  /** Class performance analytics for the teacher. */
  r.get(
    '/courses/:id/analytics',
    route(async (req, res) => {
      const access = await courseAccess(store, me(req), req.params.id!);
      requireManager(access);
      const courseId = access.course.id;
      const [enrollments, assignmentsAll] = await Promise.all([
        store.find<Enrollment>('enrollments', { course_id: courseId }),
        store.find<Assignment>('assignments', { course_id: courseId }),
      ]);
      const assignments = assignmentsAll.filter((a) => a.published);
      const [students, questions, submissions] = await Promise.all([
        store.find<Profile>('profiles', { id: enrollments.map((e) => e.student_id) }),
        store.find<QuestionRow>('questions', { assignment_id: assignments.map((a) => a.id) }),
        store.find<Submission>('submissions', { assignment_id: assignments.map((a) => a.id) }),
      ]);
      const enrolledIds = new Set(students.map((s) => s.id));
      const relevant = submissions.filter((s) => enrolledIds.has(s.student_id));
      const best = bestAttempts(relevant, await gradesFor(store, relevant));
      const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

      const perQuestion = questions
        .sort((a, b) => a.position - b.position)
        .map((q) => {
          const entries = students.map((s) => best.get(`${s.id}|${q.id}`)).filter(Boolean);
          const attempts = relevant.filter((s) => s.question_id === q.id).length;
          return {
            question_id: q.id,
            assignment_id: q.assignment_id,
            title: q.title,
            type: q.type,
            marks: q.marks,
            attempted: entries.length,
            attempts,
            correct: entries.filter((e) => e!.grade.final_score >= q.marks && q.marks > 0).length,
            average_percent: entries.length ? percent(entries.reduce((s, e) => s + e!.grade.final_score, 0), entries.length * q.marks) : null,
            needs_review: entries.filter((e) => !e!.grade.exact && !e!.grade.adjusted_by).length,
          };
        });

      const perAssignment = assignments.map((a) => {
        const qs = questions.filter((q) => q.assignment_id === a.id);
        const max = qs.reduce((s, q) => s + q.marks, 0);
        const totals = students.map((s) => {
          const entries = qs.map((q) => best.get(`${s.id}|${q.id}`)).filter(Boolean);
          return { started: entries.length > 0, score: entries.reduce((x, e) => x + e!.grade.final_score, 0) };
        });
        const started = totals.filter((t) => t.started);
        return {
          assignment_id: a.id,
          title: a.title,
          due_at: a.due_at,
          total_marks: max,
          submitted: started.length,
          average_percent: started.length ? percent(started.reduce((s, t) => s + t.score, 0), started.length * max) : null,
        };
      });

      const perStudent = students
        .map((s) => {
          const entries = questions.map((q) => best.get(`${s.id}|${q.id}`)).filter(Boolean);
          const score = entries.reduce((x, e) => x + e!.grade.final_score, 0);
          return { student_id: s.id, full_name: s.full_name, email: s.email, answered: entries.length, score, percent: percent(score, totalMarks) };
        })
        .sort((a, b) => b.percent - a.percent);

      const distribution = [0, 0, 0, 0, 0]; // 0–20, 20–40, 40–60, 60–80, 80–100
      for (const s of perStudent) distribution[Math.min(4, Math.floor(s.percent / 20))]!++;

      res.json({
        students: students.length,
        questions: questions.length,
        total_marks: totalMarks,
        class_average: perStudent.length ? Math.round((perStudent.reduce((s, x) => s + x.percent, 0) / perStudent.length) * 10) / 10 : null,
        perAssignment,
        perQuestion,
        perStudent,
        distribution,
      });
    }),
  );

  return r;
}
