import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AdminContext } from '@/lib/admin/context';
import { CAMPAIGN_RISK_OPERATIONS } from '@/lib/admin/campaign-risk-operations';
import * as slack from '@/lib/campaigns/risk/slack';
let db: PGlite, sql: SqlRunner;
const adminId = randomUUID(),
  otherId = randomUUID();
const context = (id = adminId): AdminContext => ({
  sql,
  storage: {} as AdminContext['storage'],
  viewer: { userId: id, isAdmin: true, email: null, tier: 'admin', locale: 'ko' },
});
const operation = CAMPAIGN_RISK_OPERATIONS['campaignRisk.slackConnectionTest'];
beforeAll(async () => {
  db = await freshDb();
  sql = runner(db);
  await seedProfile(sql, { id: adminId, isAdmin: true });
  await seedProfile(sql, { id: otherId });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db?.close();
});
const configured = () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('CAMPAIGN_RISK_SLACK_ENABLED', 'on');
  vi.stubEnv('CAMPAIGN_RISK_SLACK_TOKEN', 'synthetic-token');
};
it('rechecks current database admin and rejects local/preview delivery before transport', async () => {
  configured();
  const sender = vi.spyOn(slack, 'createRiskSlackConnectionTestSender');
  expect(await operation.run(context(otherId), undefined)).toEqual({
    ok: false,
    code: 'forbidden',
  });
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(await operation.run(context(), undefined)).toEqual({
    ok: false,
    code: 'invalid',
    detail: 'slackTestDisabled',
  });
  expect(sender).not.toHaveBeenCalled();
  expect((await sql.query('select id from platform_audit')).rows).toHaveLength(0);
});
it('audits an explicit connection test and prevents replay without flags, fake events or retries', async () => {
  configured();
  const send = vi.fn(async () => ({ state: 'uncertain' as const, code: 'timeout' }));
  vi.spyOn(slack, 'createRiskSlackConnectionTestSender').mockReturnValue(send);
  const result = await operation.run(context(), undefined);
  expect(result).toEqual({ ok: false, code: 'unknown', detail: 'slackTestUncertain' });
  expect(await operation.run(context(), undefined)).toEqual({
    ok: false,
    code: 'invalid',
    detail: 'slackTestCooldown',
  });
  expect(send).toHaveBeenCalledTimes(1);
  const audit = (
    await sql.query(
      'select actor_id,entity_id,action,details from platform_audit order by created_at',
    )
  ).rows;
  expect(audit).toEqual([
    {
      actor_id: adminId,
      entity_id: adminId,
      action: 'campaignRisk.slackConnectionTest',
      details: { state: 'started' },
    },
    {
      actor_id: adminId,
      entity_id: adminId,
      action: 'campaignRisk.slackConnectionTest.result',
      details: { state: 'uncertain', code: 'timeout' },
    },
  ]);
  expect((await sql.query('select id from campaign_risk_flags')).rows).toHaveLength(0);
  expect((await sql.query('select id from campaign_risk_slack_outbox')).rows).toHaveLength(0);
});
