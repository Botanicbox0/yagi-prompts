import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { freshDb } from '@/tests/helpers/pglite';
import {
  flagOffParityScenario,
  normalize,
  pre0184Db,
  recorder,
  type ParityOp,
} from '@/tests/brands/helpers/workspace-approval-parity';

/**
 * B1b-1 §4 (product owner requirement): with `BRAND_WORKSPACE_APPROVAL` off, `loadAllowance`, `reserveAllowance`,
 * `isOrganizationUploadApproved`, the grant operations and the hourly route run exactly the SQL origin/main runs and
 * return exactly its results — on the schema before 0184 and after it. The fixture was recorded by running origin/main's
 * own code (first ade904ee; re-recorded from 14d21d56 after B1a-2 changed the hourly job), never edited by hand.
 */
const routeMocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeMocks.sql }));
const tickRoute = await import('@/app/api/brand-billing/tick/route');

/** B1c: the plan organization's allowance reads (its cycle); every other operation must stay byte-identical. */
const B1C_PLAN_ORG_OPS = new Set(['loadPlan', 'uploadPlan']);
type RouteOp = { op: string; status: number; body: unknown; log: unknown };
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'brands', 'fixtures', 'brand-workspace-approval-flag-off-parity.json'), 'utf8'),
) as { ops: ParityOp[]; route: RouteOp[] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function stubFlagOff(approvalValue: string | undefined) {
  vi.stubEnv('BRAND_STUDIO_DEFAULT_MONTHLY_KRW', '0');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
  vi.stubEnv('CRON_SECRET', 'cron-secret-test');
  vi.stubEnv('BRAND_WORKSPACE_APPROVAL', approvalValue);
}

describe('BRAND_WORKSPACE_APPROVAL off: exact origin/main parity', () => {
  for (const [label, make] of [['before 0184', pre0184Db], ['after 0184/0185', freshDb]] as const) {
    // Anything but exactly `on` is off: unset, empty, `ON`, `true`.
    for (const approvalValue of [undefined, '', 'ON', 'true']) {
      it(`${label}, flag ${JSON.stringify(approvalValue ?? null)}: allowance, reserve, upload gate and grant operations`, async () => {
        stubFlagOff(approvalValue);
        const db = await make();
        try {
          const actual = await flagOffParityScenario(db);
          expect(actual.map((o) => o.op)).toEqual(fixture.ops.map((o) => o.op));
          for (const [i, op] of fixture.ops.entries()) {
            if (B1C_PLAN_ORG_OPS.has(op.op)) {
              // B1c, on purpose: a plan organization's allowance runs on its billing cycle (other statements). Its plan
              // started on the 1st here, so the cycle is the calendar month and the numbers are the same as before; the
              // result only gains the cycle and the grants' remainder.
              if (op.op === 'loadPlan') {
                // B1c fix round: a plan organization's grant belongs to the cycle containing its effective start day (the
                // later of its creation day and its month's 1st). The scenario's grant is created on the real clock, so the
                // expected extra follows its stored creation day.
                const { cycle, capKrw, extraKrw, ...rest } = actual[i]!.result as Record<string, unknown>;
                const { capKrw: _c, extraKrw: _e, ...expectedRest } = op.result as Record<string, unknown>;
                expect(rest, `${op.op}: result`).toEqual(expectedRest);
                expect(cycle).toMatchObject({ start: '2026-11-01', end: '2026-12-01' });
                const created = (
                  await db.query<{ day: string }>(
                    "select (((created_at at time zone 'UTC') + interval '9 hours')::date)::text as day from brand_allowance_grants where amount_krw = 30000",
                  )
                ).rows.map((r) => r.day);
                const attached = created.filter((d) => (d < '2026-11-01' ? '2026-11-01' : d) < '2026-12-01').length * 30_000;
                expect(extraKrw).toBe(attached);
                expect(capKrw).toBe(270_000 + attached);
              } else {
                expect(actual[i]!.result, `${op.op}: result`).toEqual(op.result);
              }
              continue;
            }
            expect(actual[i]!.log, `${op.op}: SQL and parameters`).toEqual(op.log);
            expect(actual[i]!.result, `${op.op}: full result`).toEqual(op.result);
          }
        } finally {
          await db.close();
        }
      });
    }

    it(`${label}: the hourly route, subscription flag off and on, answers and queries as origin/main`, async () => {
      stubFlagOff(undefined);
      const db = await make();
      try {
        await flagOffParityScenario(db);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-10T01:00:00Z'));
        const actual: RouteOp[] = [];
        for (const [op, sub] of [['routeBothOff', 'off'], ['routeSubscriptionOn', 'on']] as const) {
          vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', sub);
          const r = recorder(db);
          routeMocks.sql = r.sql;
          const res = await tickRoute.GET(
            new NextRequest('https://twings.app/api/brand-billing/tick', { headers: { authorization: 'Bearer cron-secret-test' } }),
          );
          actual.push({ op, status: res.status, body: normalize(await res.json()), log: normalize(r.log) });
        }
        expect(actual).toEqual(fixture.route);
        expect(fixture.route[0]).toMatchObject({ op: 'routeBothOff', body: { ok: true, skipped: 'disabled' }, log: [] });
      } finally {
        await db.close();
      }
    });
  }
});
