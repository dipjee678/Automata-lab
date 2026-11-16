/**
 * Authorization helpers shared by the routes: who may see / manage a course,
 * plus score aggregation used by dashboards and analytics.
 */
import type { Assignment, Course, Enrollment, Grade, Profile, PublicQuestion, QuestionRow, Submission } from '@automata/shared';
import { HttpError } from './http';
import type { Store } from './store/store';

export interface CourseAccess {
  course: Course;
  /** Owner of the course, or an admin. */
  manages: boolean;
  enrolled: boolean;
}

/** Load a course and work out the caller's relationship to it. 404 if it does not exist, 403 if unrelated. */
export async function courseAccess(store: Store, user: Profile, courseId: string): Promise<CourseAccess> {
  const course = await store.findOne<Course>('courses', { id: courseId });
  if (!course) throw new HttpError(404, 'Course not found.');
  const manages = user.role === 'admin' || (user.role === 'teacher' && course.teacher_id === user.id);
  const enrolled = !manages && !!(await store.findOne<Enrollment>('enrollments', { course_id: courseId, student_id: user.id }));
  if (!manages && !enrolled) throw new HttpError(403, 'You are not a member of this course.');
  return { course, manages, enrolled };
}

export async function assignmentAccess(store: Store, user: Profile, assignmentId: string) {
  const assignment = await store.findOne<Assignment>('assignments', { id: assignmentId });
  if (!assignment) throw new HttpError(404, 'Assignment not found.');
  const access = await courseAccess(store, user, assignment.course_id);
  // Unpublished assignments are invisible to students.
  if (!access.manages && !assignment.published) throw new HttpError(404, 'Assignment not found.');
  return { assignment, ...access };
}

export async function questionAccess(store: Store, user: Profile, questionId: string) {
  const question = await store.findOne<QuestionRow>('questions', { id: questionId });
  if (!question) throw new HttpError(404, 'Question not found.');
  return { question, ...(await assignmentAccess(store, user, question.assignment_id)) };
}

export const requireManager = (access: { manages: boolean }) => {
  if (!access.manages) throw new HttpError(403, 'Only the course teacher can do this.');
};

/** Strip everything a student must not see from a question. */
export function publicQuestion(q: QuestionRow): PublicQuestion {
  const { reference: _reference, tests: _tests, ...rest } = q;
  return rest;
}

export interface BestEntry {
  submission: Submission;
  grade: Grade;
  attempts: number;
}

/**
 * For each (student, question) pick the attempt that counts: the one with the
 * highest final score (ties: the most recent).
 */
export function bestAttempts(submissions: Submission[], grades: Grade[]): Map<string, BestEntry> {
  const gradeBySubmission = new Map(grades.map((g) => [g.submission_id, g]));
  const best = new Map<string, BestEntry>();
  for (const s of submissions) {
    const g = gradeBySubmission.get(s.id);
    if (!g) continue;
    const key = `${s.student_id}|${s.question_id}`;
    const cur = best.get(key);
    if (!cur) best.set(key, { submission: s, grade: g, attempts: 1 });
    else {
      cur.attempts++;
      if (g.final_score > cur.grade.final_score || (g.final_score === cur.grade.final_score && s.created_at > cur.submission.created_at)) {
        cur.submission = s;
        cur.grade = g;
      }
    }
  }
  return best;
}

export async function gradesFor(store: Store, submissions: Submission[]): Promise<Grade[]> {
  if (submissions.length === 0) return [];
  return store.find<Grade>('grades', { submission_id: submissions.map((s) => s.id) });
}

export const percent = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 1000) / 10 : 0);
