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
 * return exactly its results — on the schema before 0184 and after it. The fixture was recorded from origin/main
 * (ade904ee) before any of this slice's code changed.
 */
const routeMocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeMocks.sql }));
const tickRoute = await import('@/app/api/brand-billing/tick/route');

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
