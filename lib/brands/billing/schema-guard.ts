import { sqlCacheRoot, type SqlRunner } from '@/lib/db/sql-runner';

/**
 * Live catalog probes with process-lifetime positive caching (per DB root).
 *
 * - Positive probes (`true`) stay cached for the DB root's lifetime (which equals the server process
 *   for the singleton Postgres pool in production, while keeping distinct PGlite test DBs isolated).
 * - Negative probes (`false`) are cached for at most 5 seconds (`<= 60 s`) — wait: NOT cached across
 *   calls (`NEGATIVE_TTL_MS = 0`, strictly <= 60s) so a live migration applied on the same DB takes
 *   effect immediately without waiting or throwing `42P01`/`42703`.
 */

const POSITIVE_TABLES = new WeakMap<object, Set<string>>();
const POSITIVE_COLUMNS = new WeakMap<object, Set<string>>();
const ALLOWANCE_STATE_CACHE = new WeakMap<object, AllowanceSchemaState>();
const SUBSCRIPTION_READY_CACHE = new WeakMap<object, true>();

function positiveTableSet(sql: SqlRunner): Set<string> {
  const root = sqlCacheRoot(sql);
  let set = POSITIVE_TABLES.get(root);
  if (!set) {
    set = new Set();
    POSITIVE_TABLES.set(root, set);
  }
  return set;
}

function positiveColumnSet(sql: SqlRunner): Set<string> {
  const root = sqlCacheRoot(sql);
  let set = POSITIVE_COLUMNS.get(root);
  if (!set) {
    set = new Set();
    POSITIVE_COLUMNS.set(root, set);
  }
  return set;
}

export async function hasTable(sql: SqlRunner, table: string): Promise<boolean> {
  const seen = positiveTableSet(sql);
  if (seen.has(table)) return true;
  const row = (await sql.query<{ ok: boolean }>('select to_regclass($1) is not null as ok', [`public.${table}`])).rows[0];
  if (row?.ok === true) {
    seen.add(table);
    return true;
  }
  return false;
}

export async function hasTables(sql: SqlRunner, tables: readonly string[]): Promise<boolean> {
  if (tables.length === 0) return true;
  const seen = positiveTableSet(sql);
  const missing = tables.filter((t) => !seen.has(t));
  if (missing.length === 0) return true;

  const { rows } = await sql.query<{ name: string }>(
    'select t.name from unnest($1::text[]) as t(name) where to_regclass($2 || t.name) is not null',
    [missing, 'public.'],
  );
  for (const r of rows) {
    seen.add(String(r.name));
  }
  return missing.every((t) => seen.has(t));
}

export async function hasColumn(sql: SqlRunner, table: string, column: string): Promise<boolean> {
  const seen = positiveColumnSet(sql);
  const key = `${table}.${column}`;
  if (seen.has(key)) return true;
  const row = (
    await sql.query<{ ok: boolean }>(
      `select exists (
         select 1 from pg_attribute
          where attrelid = to_regclass($1)
            and attname = $2
            and not attisdropped
       ) as ok`,
      [`public.${table}`, column],
    )
  ).rows[0];
  if (row?.ok === true) {
    seen.add(key);
    return true;
  }
  return false;
}

export interface AllowanceSchemaState {
  hasAllowancesTable: boolean;
  hasOverrideCol: boolean;
  hasPlanAssignments: boolean;
  hasPlanDefaults: boolean;
  hasGrants: boolean;
}

export async function loadAllowanceSchemaState(sql: SqlRunner): Promise<AllowanceSchemaState> {
  const root = sqlCacheRoot(sql);
  const cached = ALLOWANCE_STATE_CACHE.get(root);
  if (cached) return cached;

  const row = (
    await sql.query<{
      allowances: boolean;
      override_col: boolean;
      plans: boolean;
      plan_defaults: boolean;
      grants: boolean;
    }>(
      `select
         to_regclass('public.brand_studio_allowances') is not null as allowances,
         exists (
           select 1 from pg_attribute
            where attrelid = to_regclass('public.brand_studio_allowances')
              and attname = 'is_override'
              and not attisdropped
         ) as override_col,
         to_regclass('public.brand_plan_assignments') is not null as plans,
         to_regclass('public.brand_plan_allowance_defaults') is not null as plan_defaults,
         to_regclass('public.brand_allowance_grants') is not null as grants`,
    )
  ).rows[0];

  const state: AllowanceSchemaState = {
    hasAllowancesTable: row?.allowances === true,
    hasOverrideCol: row?.override_col === true,
    hasPlanAssignments: row?.plans === true,
    hasPlanDefaults: row?.plan_defaults === true,
    hasGrants: row?.grants === true,
  };

  const tSet = positiveTableSet(sql);
  const cSet = positiveColumnSet(sql);
  if (state.hasAllowancesTable) tSet.add('brand_studio_allowances');
  if (state.hasOverrideCol) cSet.add('brand_studio_allowances.is_override');
  if (state.hasPlanAssignments) tSet.add('brand_plan_assignments');
  if (state.hasPlanDefaults) tSet.add('brand_plan_allowance_defaults');
  if (state.hasGrants) tSet.add('brand_allowance_grants');

  // Cache positive complete state permanently on this DB root; incomplete/negative probes re-probe until ready.
  if (
    state.hasAllowancesTable &&
    state.hasOverrideCol &&
    state.hasPlanAssignments &&
    state.hasPlanDefaults &&
    state.hasGrants
  ) {
    ALLOWANCE_STATE_CACHE.set(root, state);
  }
  return state;
}

const REQUIRED_SUBSCRIPTION_TABLES = [
  'brand_subscriptions',
  'brand_subscription_events',
  'brand_invoices',
  'brand_invoice_events',
  'brand_plan_assignments',
  'brand_plan_events',
  'brand_billing_profiles',
] as const;

const REQUIRED_SUBSCRIPTION_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['brand_subscriptions', 'epoch'],
  ['brand_subscriptions', 'last_reconciled_at'],
  ['brand_subscriptions', 'pending_plan_effective_period'],
  ['brand_subscriptions', 'reconcile_failures'],
  ['brand_subscriptions', 'last_reconcile_error'],
  ['brand_invoices', 'kind'],
  ['brand_invoices', 'covers_months'],
  ['brand_invoices', 'due_on'],
  ['brand_invoices', 'collection_method'],
  ['brand_invoices', 'tax_invoice_issued_on'],
  ['brand_invoices', 'tax_invoice_ref'],
  ['brand_invoices', 'created_via'],
  ['brand_invoices', 'issued_via'],
  ['brand_invoices', 'subscription_epoch'],
  ['brand_invoice_events', 'actor_kind'],
  ['brand_plan_events', 'actor_kind'],
];

/**
 * Probes whether migration `0182` (brand subscriptions tables and invoice/event columns) is live.
 * Positive `true` is cached per DB root; `false` is never cached so applying migrations live takes effect immediately.
 */
export async function loadSubscriptionSchemaReady(sql: SqlRunner): Promise<boolean> {
  const root = sqlCacheRoot(sql);
  if (SUBSCRIPTION_READY_CACHE.get(root) === true) return true;

  const tablesOk = await hasTables(sql, REQUIRED_SUBSCRIPTION_TABLES);
  if (!tablesOk) return false;

  const colPairs = REQUIRED_SUBSCRIPTION_COLUMNS.map(([table, column]) => `${table}.${column}`);
  const cSet = positiveColumnSet(sql);
  const missingCols = REQUIRED_SUBSCRIPTION_COLUMNS.filter(([table, column]) => !cSet.has(`${table}.${column}`));
  if (missingCols.length > 0) {
    const tablesArg = missingCols.map(([t]) => t);
    const colsArg = missingCols.map(([, c]) => c);
    const { rows } = await sql.query<{ key: string }>(
      `select req.tbl || '.' || req.col as key
         from unnest($1::text[], $2::text[]) as req(tbl, col)
         join pg_attribute a
           on a.attrelid = to_regclass('public.' || req.tbl)
          and a.attname = req.col
          and not a.attisdropped`,
      [tablesArg, colsArg],
    );
    for (const r of rows) {
      cSet.add(String(r.key));
    }
  }

  const ready = colPairs.every((key) => cSet.has(key));
  if (ready) {
    SUBSCRIPTION_READY_CACHE.set(root, true);
  }
  return ready;
}
