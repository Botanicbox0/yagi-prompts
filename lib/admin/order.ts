import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * PLAN §3.8 — "step list with **up/down ordering** (drag-and-drop deferred)".
 *
 * `steps` and `blocks` both carry `unique (parent, "order")` (§6). That constraint is not
 * deferrable, so the obvious `update … case id when a then bOrder when b then aOrder end` can trip
 * the unique index halfway through its own statement. The safe pattern — and the one the seeds
 * imply by always writing dense 1..n orders — is:
 *
 *   1. park row A in a slot nothing can occupy (a NEGATIVE order; every real order is ≥ 1),
 *   2. move row B into A's old slot,
 *   3. move A into B's old slot,
 *   4. renumber the whole group to a dense 1..n.
 *
 * Step 4 is what keeps deletes honest too: compressing 1..n in ASCENDING order only ever moves a
 * row DOWNWARD into a slot already vacated, so it can never collide either.
 *
 * The DB triggers still get the final word: every statement here fires `guard_steps` /
 * `guard_blocks`, so reordering a published revision is rejected exactly like any other write.
 */

export type OrderedTable = 'steps' | 'blocks';
export type Direction = 'up' | 'down';

interface Scope {
  table: OrderedTable;
  parentId: string;
}

/** Closed unions, never user input — safe to interpolate into the statement. */
function parentColumn(table: OrderedTable): string {
  return table === 'steps' ? 'revision_id' : 'step_id';
}

export async function nextOrder(sql: SqlRunner, scope: Scope): Promise<number> {
  const { rows } = await sql.query<{ next: number }>(
    `select coalesce(max("order"), 0) + 1 as next
       from ${scope.table} where ${parentColumn(scope.table)} = $1`,
    [scope.parentId],
  );
  return rows[0]?.next ?? 1;
}

/** Dense 1..n, ascending. Idempotent, and safe to call after every mutation. */
export async function normalizeOrder(sql: SqlRunner, scope: Scope): Promise<void> {
  const { rows } = await sql.query<{ id: string; order: number }>(
    `select id, "order" from ${scope.table}
      where ${parentColumn(scope.table)} = $1 order by "order", id`,
    [scope.parentId],
  );
  for (const [index, row] of rows.entries()) {
    const target = index + 1;
    if (row.order === target) continue;
    await sql.query(`update ${scope.table} set "order" = $2 where id = $1`, [row.id, target]);
  }
}

interface Row {
  id: string;
  order: number;
  parentId: string;
}

async function rowOf(sql: SqlRunner, table: OrderedTable, id: string): Promise<Row | null> {
  const { rows } = await sql.query<{ id: string; order: number; parent: string }>(
    `select id, "order", ${parentColumn(table)} as parent from ${table} where id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { id: row.id, order: row.order, parentId: row.parent } : null;
}

/**
 * Swap a row with its neighbour. Returns false when there is no neighbour in that direction, so the
 * caller can answer "nothing to do" rather than inventing a failure.
 */
export async function moveRow(
  sql: SqlRunner,
  table: OrderedTable,
  id: string,
  direction: Direction,
): Promise<boolean> {
  const row = await rowOf(sql, table, id);
  if (row === null) return false;

  const column = parentColumn(table);
  const comparison = direction === 'up' ? '<' : '>';
  const ordering = direction === 'up' ? 'desc' : 'asc';
  const { rows: neighbours } = await sql.query<{ id: string; order: number }>(
    `select id, "order" from ${table}
      where ${column} = $1 and "order" ${comparison} $2
      order by "order" ${ordering} limit 1`,
    [row.parentId, row.order],
  );
  const neighbour = neighbours[0];
  if (!neighbour) return false;

  // Park below every legal order, then swap into the vacated slots.
  const parking = -Math.abs(row.order) - 1;
  await sql.query(`update ${table} set "order" = $2 where id = $1`, [row.id, parking]);
  await sql.query(`update ${table} set "order" = $2 where id = $1`, [neighbour.id, row.order]);
  await sql.query(`update ${table} set "order" = $2 where id = $1`, [row.id, neighbour.order]);

  await normalizeOrder(sql, { table, parentId: row.parentId });
  return true;
}
