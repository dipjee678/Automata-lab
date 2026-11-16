/**
 * Local development store: all tables in memory, persisted to one JSON file.
 * Mirrors the foreign-key cascades of database/schema.sql.
 */
import fs from 'node:fs';
import path from 'node:path';
import { matches, TABLES, withDefaults, type Filter, type Row, type Store, type Table } from './store';

/** parent table -> [child table, foreign key column] (ON DELETE CASCADE). */
const CASCADES: Partial<Record<Table, Array<[Table, string]>>> = {
  profiles: [
    ['users', 'id'],
    ['courses', 'teacher_id'],
    ['enrollments', 'student_id'],
    ['submissions', 'student_id'],
    ['automata', 'owner_id'],
    ['practice_history', 'user_id'],
  ],
  courses: [
    ['enrollments', 'course_id'],
    ['assignments', 'course_id'],
  ],
  assignments: [
    ['questions', 'assignment_id'],
    ['submissions', 'assignment_id'],
  ],
  questions: [['submissions', 'question_id']],
  submissions: [['grades', 'submission_id']],
};

type Data = Record<Table, Row[]>;
const emptyData = (): Data => Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Data;

export class LocalStore implements Store {
  private data: Data = emptyData();

  /** @param file JSON file to persist to, or null for a purely in-memory store (tests). */
  constructor(private file: string | null) {
    if (file && fs.existsSync(file)) {
      try {
        this.data = { ...emptyData(), ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Data) };
      } catch (e) {
        throw new Error(`Could not read local data file ${file}: ${(e as Error).message}`);
      }
    }
  }

  private persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file); // atomic replace: never leaves a half-written file
  }

  private clone<T>(row: Row): T {
    return structuredClone(row) as T;
  }

  async insert<T>(table: Table, row: Record<string, unknown>): Promise<T> {
    const full = withDefaults(structuredClone(row));
    if (this.data[table].some((r) => r.id === full.id)) throw new Error(`Duplicate id in ${table}.`);
    this.data[table].push(full);
    this.persist();
    return this.clone<T>(full);
  }

  async find<T>(table: Table, filter: Filter = {}): Promise<T[]> {
    return this.data[table]
      .filter((r) => matches(r, filter))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((r) => this.clone<T>(r));
  }

  async findOne<T>(table: Table, filter: Filter): Promise<T | null> {
    const row = this.data[table].find((r) => matches(r, filter));
    return row ? this.clone<T>(row) : null;
  }

  async update<T>(table: Table, id: string, patch: Record<string, unknown>): Promise<T> {
    const row = this.data[table].find((r) => r.id === id);
    if (!row) throw new Error(`Row ${id} not found in ${table}.`);
    Object.assign(row, structuredClone(patch), { id });
    this.persist();
    return this.clone<T>(row);
  }

  private removeSync(table: Table, filter: Filter): number {
    const doomed = this.data[table].filter((r) => matches(r, filter));
    if (doomed.length === 0) return 0;
    const ids = new Set(doomed.map((r) => r.id));
    this.data[table] = this.data[table].filter((r) => !ids.has(r.id));
    for (const [child, fk] of CASCADES[table] ?? []) this.removeSync(child, { [fk]: [...ids] });
    return doomed.length;
  }

  async remove(table: Table, filter: Filter): Promise<number> {
    const n = this.removeSync(table, filter);
    if (n) this.persist();
    return n;
  }
}
