import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { selectVideoProvider, type SelectProviderInput } from '@/lib/renders/provider-router';
import { readSunraCircuit, recordSunraCircuit, sunraLaneGate, sunraLaneSchemaReady } from '@/lib/renders/sunra-lane';
import { freshDb, runner } from '@/tests/helpers/pglite';

/**
 * The personal Sunra lane's gate (lib/renders/sunra-lane.ts): closed unless the switch is on, the key is
 * there, migration 0188 is applied, the circuit is closed and the router says "sunra". Any other router
 * answer closes it: a partner job is Sunra or refused, never handed to ModelArk.
 */

const ON = { TWINGS_PERSONAL_SUNRA_FACES: 'on', SUNRA_API_KEY: 'test-key-not-real' };
const T0 = new Date('2026-11-24T06:00:00.000Z');
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

/** A database that must never be asked anything: the gate closes before it. */
const untouchable: SqlRunner = {
  async query() { throw new Error('the gate must not read the database here'); },
  async transaction() { throw new Error('the gate must not read the database here'); },
};

let db: PGlite;
let sql: SqlRunner;

beforeAll(async () => {
  db = await freshDb();
  sql = runner(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await sql.query('delete from render_provider_state');
});

describe('sunraLaneGate', () => {
  it('is closed with the switch unset, off or anything but exactly "on", and reads nothing', async () => {
    for (const value of [undefined, '', 'off', 'ON', 'on ', 'true', '1']) {
      const env = { ...ON, TWINGS_PERSONAL_SUNRA_FACES: value };
      await expect(sunraLaneGate(untouchable, env, T0), String(value)).resolves.toEqual({ open: false, reason: 'flag_off', circuit: null });
    }
  });

  it('is closed without a Sunra key', async () => {
    for (const key of [undefined, '', '   ']) {
      await expect(sunraLaneGate(untouchable, { ...ON, SUNRA_API_KEY: key }, T0)).resolves.toEqual({ open: false, reason: 'no_key', circuit: null });
    }
  });

  it('opens on a migrated database with a closed circuit, asking the router for a person-face job in sunra_primary', async () => {
    const select = vi.fn(selectVideoProvider);
    await expect(sunraLaneGate(sql, ON, T0, { select })).resolves.toEqual({ open: true, reason: 'ok', circuit: 'closed' });
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0]![0]).toMatchObject({ mode: 'sunra_primary', sunraConfigured: true, circuitState: 'closed', hasPersonFace: true, sunraSignedFaceAllowed: true, model: 'seedance-2.5' });
  });

  it('turns every "not sunra" answer of the router into a closed gate, never a ModelArk fallback', async () => {
    const answers: Array<(input: SelectProviderInput) => ReturnType<typeof selectVideoProvider>> = [
      () => ({ primary: 'modelark', fallback: 'sunra', reason: 'modelark_within_capacity' }),
      () => ({ primary: 'modelark', fallback: null, reason: 'sunra_disabled' }),
      (input) => selectVideoProvider({ ...input, sunraSignedFaceAllowed: false }),
      (input) => selectVideoProvider({ ...input, mode: 'off' }),
      (input) => selectVideoProvider({ ...input, mode: 'ab_benchmark', jobId: 'job-that-hashes-to-modelark-3' }),
    ];
    for (const select of answers) {
      const decision = select({ jobId: 'x', model: 'seedance-2.5', mode: 'sunra_primary', sunraConfigured: true, circuitState: 'closed', modelarkInFlight: 0, hasPersonFace: true, sunraSignedFaceAllowed: true });
      const gate = await sunraLaneGate(sql, ON, T0, { select });
      if (decision.primary === 'sunra') continue;
      expect(gate, decision.reason).toEqual({ open: false, reason: 'router', circuit: 'closed' });
    }
  });

  it('is closed, not thrown, on a database without migration 0188 — and on one that cannot be read', async () => {
    const old = new PGlite();
    try {
      await old.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((name) => !name.startsWith('0188_'))) await old.exec(readMigration(file));
      const oldSql = runner(old);
      await expect(sunraLaneSchemaReady(oldSql)).resolves.toBe(false);
      await expect(sunraLaneGate(oldSql, ON, T0)).resolves.toEqual({ open: false, reason: 'schema', circuit: null });
      // The provider CHECK alone (a half-applied file) is not enough either.
      await old.exec(readMigration(coreMigrationFiles().find((name) => name.startsWith('0188_'))!).split('-- 2.')[0]!);
      await expect(sunraLaneSchemaReady(oldSql)).resolves.toBe(false);
    } finally {
      await old.close();
    }
    const broken: SqlRunner = { async query() { throw new Error('connection refused'); }, async transaction() { throw new Error('connection refused'); } };
    await expect(sunraLaneGate(broken, ON, T0)).resolves.toEqual({ open: false, reason: 'schema', circuit: null });
    await expect(sunraLaneSchemaReady(sql)).resolves.toBe(true);
  }, 120_000);

  it('is closed while the circuit is open: outage 5 minutes, hold 15 minutes, price drift until an admin reset', async () => {
    await recordSunraCircuit(sql, 'open_provider_outage', 'http_502 at submit', T0);
    await expect(sunraLaneGate(sql, ON, minutes(4.9))).resolves.toEqual({ open: false, reason: 'circuit', circuit: 'open_provider_outage' });
    await expect(sunraLaneGate(sql, ON, minutes(5))).resolves.toMatchObject({ open: true, circuit: 'closed' });

    await recordSunraCircuit(sql, 'open_insufficient_hold', 'INSUFFICIENT_CREDIT', T0);
    await expect(sunraLaneGate(sql, ON, minutes(14.9))).resolves.toEqual({ open: false, reason: 'circuit', circuit: 'open_insufficient_hold' });
    await expect(sunraLaneGate(sql, ON, minutes(15))).resolves.toMatchObject({ open: true });

    await recordSunraCircuit(sql, 'open_price_drift', 'billed 34% over', T0);
    await expect(sunraLaneGate(sql, ON, minutes(60 * 24 * 30))).resolves.toEqual({ open: false, reason: 'circuit', circuit: 'open_price_drift' });
    await recordSunraCircuit(sql, 'closed', 'admin reset', minutes(60));
    await expect(sunraLaneGate(sql, ON, minutes(60))).resolves.toEqual({ open: true, reason: 'ok', circuit: 'closed' });
  });
});

describe('recordSunraCircuit', () => {
  it('keeps the more serious open state: a later outage neither ends a drift nor shortens a hold', async () => {
    await recordSunraCircuit(sql, 'open_price_drift', 'drift', T0);
    await recordSunraCircuit(sql, 'open_provider_outage', 'later 503', minutes(1));
    await recordSunraCircuit(sql, 'open_insufficient_hold', 'later 412', minutes(2));
    await expect(readSunraCircuit(sql, minutes(30))).resolves.toBe('open_price_drift');

    await recordSunraCircuit(sql, 'closed', 'admin reset', minutes(31));
    await recordSunraCircuit(sql, 'open_insufficient_hold', '412', minutes(40));
    await recordSunraCircuit(sql, 'open_provider_outage', '503', minutes(41));
    await expect(readSunraCircuit(sql, minutes(47))).resolves.toBe('open_insufficient_hold');
    await expect(readSunraCircuit(sql, minutes(55))).resolves.toBe('closed');

    // An expired hold no longer outranks a fresh outage.
    await recordSunraCircuit(sql, 'open_provider_outage', '502', minutes(56));
    await expect(readSunraCircuit(sql, minutes(57))).resolves.toBe('open_provider_outage');
    // A repeated outage restarts its own clock.
    await recordSunraCircuit(sql, 'open_provider_outage', '502 again', minutes(60));
    await expect(readSunraCircuit(sql, minutes(64))).resolves.toBe('open_provider_outage');

    const { rows } = await sql.query<{ n: number }>('select count(*)::int as n from render_provider_state');
    expect(rows[0]!.n).toBe(1);
  });

  it('reads a missing row as closed, and refuses a state outside the router vocabulary', async () => {
    await expect(readSunraCircuit(sql, T0)).resolves.toBe('closed');
    await expect(recordSunraCircuit(sql, 'half_open' as never, 'x', T0)).rejects.toThrow();
  });
});
