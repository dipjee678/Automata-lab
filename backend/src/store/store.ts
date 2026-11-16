/**
 * Minimal table-oriented data access layer. Both the Supabase (Postgres) and
 * the local JSON implementation satisfy this interface, so the routes never
 * know which one they are talking to.
 */
import { randomUUID } from 'node:crypto';

export const TABLES = [
  'users', // local mode only (Supabase keeps credentials in auth.users)
  'profiles',
  'courses',
  'enrollments',
  'assignments',
  'questions',
  'submissions',
  'grades',
  'automata',
  'practice_history',
] as const;
export type Table = (typeof TABLES)[number];

export type FilterValue = string | number | boolean | null | Array<string | number>;
export type Filter = Record<string, FilterValue>;
export type Row = Record<string, unknown> & { id: string };

export interface Store {
  /** Insert a row. `id` and `created_at` are filled in when missing. */
  insert<T>(table: Table, row: Record<string, unknown>): Promise<T>;
  /** Rows matching every filter entry (array value = IN). Ordered by created_at ascending. */
  find<T>(table: Table, filter?: Filter): Promise<T[]>;
  findOne<T>(table: Table, filter: Filter): Promise<T | null>;
  update<T>(table: Table, id: string, patch: Record<string, unknown>): Promise<T>;
  /** Delete matching rows (dependent rows are removed as well). Returns the number deleted. */
  remove(table: Table, filter: Filter): Promise<number>;
}

export const withDefaults = (row: Record<string, unknown>): Row => ({
  ...row,
  id: (row.id as string | undefined) ?? randomUUID(),
  created_at: (row.created_at as string | undefined) ?? new Date().toISOString(),
});

export const matches = (row: Record<string, unknown>, filter: Filter): boolean =>
  Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? (v as unknown[]).includes(row[k]) : row[k] === v));
