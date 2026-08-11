/**
 * Driver-agnostic query surface.
 *
 * The seed script (scripts/seed.ts) runs identically against PGlite inside vitest and against a
 * real Postgres URL via `pg`. Both drivers already speak `query(text, params) -> { rows }` with
 * `$1` placeholders, so this is the whole abstraction.
 */
export interface SqlRunner {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
