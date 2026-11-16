/**
 * Supabase (PostgreSQL) store. Uses the SERVICE ROLE key, which bypasses Row
 * Level Security – so this key must only ever live on the server, and every
 * route enforces authorization itself. RLS (database/schema.sql) remains the
 * second line of defence for any client that talks to Supabase directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { withDefaults, type Filter, type Store, type Table } from './store';

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private apply<Q extends { eq: any; in: any; is: any }>(query: Q, filter: Filter): Q {
    let q = query;
    for (const [k, v] of Object.entries(filter)) {
      if (Array.isArray(v)) q = q.in(k, v);
      else if (v === null) q = q.is(k, null);
      else q = q.eq(k, v);
    }
    return q;
  }

  async insert<T>(table: Table, row: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.from(table).insert(withDefaults(row)).select().single();
    if (error) throw new Error(`[${table}] insert failed: ${error.message}`);
    return data as T;
  }

  async find<T>(table: Table, filter: Filter = {}): Promise<T[]> {
    // An empty IN list matches nothing; PostgREST would reject it.
    if (Object.values(filter).some((v) => Array.isArray(v) && v.length === 0)) return [];
    const { data, error } = await this.apply(this.db.from(table).select('*'), filter).order('created_at', { ascending: true });
    if (error) throw new Error(`[${table}] select failed: ${error.message}`);
    return (data ?? []) as T[];
  }

  async findOne<T>(table: Table, filter: Filter): Promise<T | null> {
    const { data, error } = await this.apply(this.db.from(table).select('*'), filter).limit(1).maybeSingle();
    if (error) throw new Error(`[${table}] select failed: ${error.message}`);
    return (data ?? null) as T | null;
  }

  async update<T>(table: Table, id: string, patch: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.from(table).update(patch).eq('id', id).select().single();
    if (error) throw new Error(`[${table}] update failed: ${error.message}`);
    return data as T;
  }

  async remove(table: Table, filter: Filter): Promise<number> {
    if (Object.keys(filter).length === 0) throw new Error('Refusing to delete without a filter.');
    if (Object.values(filter).some((v) => Array.isArray(v) && v.length === 0)) return 0;
    const { data, error } = await this.apply(this.db.from(table).delete(), filter).select('id');
    if (error) throw new Error(`[${table}] delete failed: ${error.message}`);
    return data?.length ?? 0;
  }
}
