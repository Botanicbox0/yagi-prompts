/**
 * Whether a person-face job may go to Sunra right now (docs/PERSONAL-STUDIO.md §5.1), and the circuit that
 * stops it. Server only. Nothing in the live render path calls this yet (PR A of the personal Sunra lane);
 * the order route and the dispatch will ask it before taking money and again before submitting.
 *
 * The gate is open only when ALL of these hold, checked in this order (the first that fails is the reason):
 *   flag_off  `TWINGS_PERSONAL_SUNRA_FACES` is exactly `on` (lib/flags.ts `personalSunraFacesOpen`)
 *   no_key    `SUNRA_API_KEY` is set (presence only; the value is never read here beyond that)
 *   schema    migration 0188 is applied: render_jobs.provider accepts 'sunra', render_provider_state and
 *             adult_confirmations exist, render_slot_inputs has photo_check / photo_checked_at. A database
 *             without them, or one that cannot be read, closes the gate; it never throws.
 *   circuit   the stored circuit (render_provider_state) is closed. A short balance holds it 15 minutes, an
 *             outage 5 (lib/renders/provider-router.ts cooldowns); a price drift stays open until an admin
 *             reset (`recordSunraCircuit(sql, 'closed', …)`).
 *   router    `selectVideoProvider` in `sunra_primary` for a person-face job answers `primary: 'sunra'`. Any
 *             other answer closes the gate: its ModelArk fallback is never taken for this lane, because a
 *             partner's photo must not reach ModelArk's identity library.
 *
 * The router keeps its circuit in process memory, which a serverless deployment loses between requests; this
 * module keeps it in one table row instead and hands the router the state it read.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { personalSunraFacesOpen } from '@/lib/flags';
import { sunraConfigFromEnv } from '@/lib/sunra/client';
import { HOLD_COOLDOWN_MS, OUTAGE_COOLDOWN_MS, selectVideoProvider, type CircuitBreakerState, type ProviderRouteDecision, type SelectProviderInput } from './provider-router';

export type SunraLaneReason = 'flag_off' | 'no_key' | 'schema' | 'circuit' | 'router' | 'ok';

export interface SunraLaneGate {
  open: boolean;
  reason: SunraLaneReason;
  /** The circuit read for this decision; null when the gate closed before reading it. */
  circuit: CircuitBreakerState | null;
}

const CIRCUIT_STATES: readonly CircuitBreakerState[] = ['closed', 'open_price_drift', 'open_insufficient_hold', 'open_provider_outage'];

function closed(reason: SunraLaneReason, circuit: CircuitBreakerState | null = null): SunraLaneGate {
  return { open: false, reason, circuit };
}

/** True only when every object of migration 0188 is there. Quietly false on an older or unreadable database. */
export async function sunraLaneSchemaReady(sql: SqlRunner): Promise<boolean> {
  try {
    const { rows } = await sql.query<{ state: string | null; adult: string | null; slot_columns: number; provider_ok: boolean | null }>(
      `select to_regclass('public.render_provider_state')::text as state,
              to_regclass('public.adult_confirmations')::text as adult,
              (select count(*)::int from information_schema.columns
                where table_schema = 'public' and table_name = 'render_slot_inputs'
                  and column_name in ('photo_check', 'photo_checked_at')) as slot_columns,
              (select coalesce(bool_and(pg_get_constraintdef(con.oid) like '%''sunra''%'), true)
                 from pg_constraint con
                where con.conrelid = to_regclass('public.render_jobs')
                  and con.contype = 'c'
                  and exists (select 1 from pg_attribute a
                               where a.attrelid = con.conrelid and a.attnum = any (con.conkey) and a.attname = 'provider')) as provider_ok`,
    );
    const row = rows[0];
    return Boolean(row?.state && row.adult && Number(row.slot_columns) === 2 && row.provider_ok === true);
  } catch {
    return false;
  }
}

/** The stored state as it stands at `now`: a hold or an outage closes by itself after its cooldown; a drift never does. */
export function effectiveSunraCircuit(row: { circuit_state: string; opened_at: Date | string | null } | null | undefined, now: Date): CircuitBreakerState {
  if (!row || !(CIRCUIT_STATES as readonly string[]).includes(row.circuit_state)) return 'closed';
  const state = row.circuit_state as CircuitBreakerState;
  if (state === 'closed' || state === 'open_price_drift') return state;
  const openedAt = row.opened_at === null ? NaN : new Date(row.opened_at).getTime();
  if (!Number.isFinite(openedAt)) return 'closed';
  const cooldown = state === 'open_insufficient_hold' ? HOLD_COOLDOWN_MS : OUTAGE_COOLDOWN_MS;
  return now.getTime() - openedAt >= cooldown ? 'closed' : state;
}

export async function readSunraCircuit(sql: SqlRunner, now: Date): Promise<CircuitBreakerState> {
  const { rows } = await sql.query<{ circuit_state: string; opened_at: Date | string | null }>(
    `select circuit_state, opened_at from render_provider_state where provider = 'sunra'`,
  );
  return effectiveSunraCircuit(rows[0], now);
}

/**
 * Opens (or, with 'closed', resets) the Sunra circuit. One row, one statement. A write never lowers the
 * state that is in force: a drift stays until a 'closed' reset; a live hold is not shortened by an outage;
 * an equal state restarts its clock. 'closed' is the admin reset and always wins.
 */
export async function recordSunraCircuit(sql: SqlRunner, state: CircuitBreakerState, reason: string, now: Date): Promise<void> {
  if (!CIRCUIT_STATES.includes(state)) throw new Error(`unknown circuit state: ${String(state)}`);
  await sql.query(
    `insert into render_provider_state as s (provider, circuit_state, reason, opened_at, updated_at)
     values ('sunra', $1::text, $2::text, case when $1::text = 'closed' then null else $3::timestamptz end, $3::timestamptz)
     on conflict (provider) do update
        set circuit_state = excluded.circuit_state,
            reason = excluded.reason,
            opened_at = excluded.opened_at,
            updated_at = excluded.updated_at
      where excluded.circuit_state = 'closed'
         or (case excluded.circuit_state
               when 'open_price_drift' then 3 when 'open_insufficient_hold' then 2 when 'open_provider_outage' then 1 else 0 end)
            >= (case
                  when s.circuit_state = 'open_price_drift' then 3
                  when s.circuit_state = 'open_insufficient_hold'
                       and s.opened_at > $3::timestamptz - ($4::bigint * interval '1 millisecond') then 2
                  when s.circuit_state = 'open_provider_outage'
                       and s.opened_at > $3::timestamptz - ($5::bigint * interval '1 millisecond') then 1
                  else 0 end)`,
    [state, reason.slice(0, 500), now.toISOString(), HOLD_COOLDOWN_MS, OUTAGE_COOLDOWN_MS],
  );
}

export async function sunraLaneGate(
  sql: SqlRunner,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
  deps: { select?: (input: SelectProviderInput) => ProviderRouteDecision } = {},
): Promise<SunraLaneGate> {
  if (!personalSunraFacesOpen(env)) return closed('flag_off');
  if (sunraConfigFromEnv(env) === null) return closed('no_key');
  if (!(await sunraLaneSchemaReady(sql))) return closed('schema');
  let circuit: CircuitBreakerState;
  try {
    circuit = await readSunraCircuit(sql, now);
  } catch {
    return closed('schema');
  }
  if (circuit !== 'closed') return closed('circuit', circuit);
  const decision = (deps.select ?? selectVideoProvider)({
    jobId: 'personal-sunra-lane',
    model: 'seedance-2.5',
    mode: 'sunra_primary',
    sunraConfigured: true,
    circuitState: circuit,
    modelarkInFlight: 0,
    hasPersonFace: true,
    // The one switch that lets a person's face go to Sunra (docs/PERSONAL-STUDIO.md §5.1).
    sunraSignedFaceAllowed: personalSunraFacesOpen(env),
  });
  if (decision.primary !== 'sunra') return closed('router', circuit);
  return { open: true, reason: 'ok', circuit };
}
