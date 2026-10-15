import type { AdminOperation } from './operations';
import { fail, ok } from './context';
import { reviewRiskFlag } from '@/lib/campaigns/risk/admin';
import { createRiskSlackConnectionTestSender, slackRiskConfig } from '@/lib/campaigns/risk/slack';
const review: AdminOperation<Record<string, unknown>> = {
  parse: (form) => ({
    ok: true,
    value: { id: form.get('id'), state: form.get('state'), reason: form.get('reason') },
  }),
  async run(ctx, input) {
    const r = await reviewRiskFlag(ctx.sql, ctx.viewer, input);
    return r.ok ? ok('saved', { to: '/admin/risk' }) : fail(r.code);
  },
};
const slackConnectionTest: AdminOperation<undefined> = {
  parse: () => ({ ok: true, value: undefined }),
  async run(ctx) {
    const allowed = await ctx.sql.transaction(async (tx) => {
      const admin = (
        await tx.query<{ is_admin: boolean }>(
          'select is_admin from profiles where id=$1 for update',
          [ctx.viewer.userId],
        )
      ).rows[0];
      if (admin?.is_admin !== true) return 'forbidden';
      const config = slackRiskConfig(process.env);
      if (config.status !== 'configured') return 'disabled';
      const recent = (
        await tx.query(
          "select id from platform_audit where actor_id=$1 and action='campaignRisk.slackConnectionTest' and created_at>now()-interval '10 minutes' limit 1",
          [ctx.viewer.userId],
        )
      ).rows[0];
      if (recent) return 'cooldown';
      await tx.query(
        "insert into platform_audit(actor_id,entity_id,action,reason,details) values($1,$1,'campaignRisk.slackConnectionTest','admin_requested_connection_test','{\"state\":\"started\"}'::jsonb)",
        [ctx.viewer.userId],
      );
      return config;
    });
    if (allowed === 'forbidden') return fail('forbidden');
    if (allowed === 'disabled') return fail('invalid', 'slackTestDisabled');
    if (allowed === 'cooldown') return fail('invalid', 'slackTestCooldown');
    const result = await createRiskSlackConnectionTestSender(
      allowed.token,
      ctx.viewer.locale === 'en' ? 'en' : 'ko',
    )();
    await ctx.sql.query(
      "insert into platform_audit(actor_id,entity_id,action,reason,details) values($1,$1,'campaignRisk.slackConnectionTest.result','admin_requested_connection_test',$2::jsonb)",
      [ctx.viewer.userId, JSON.stringify({ state: result.state, code: result.code })],
    );
    return result.state === 'sent'
      ? ok('saved', { to: '/admin/risk', detail: 'slackTestSent' })
      : fail('unknown', result.state === 'uncertain' ? 'slackTestUncertain' : 'slackTestFailed');
  },
};
export const CAMPAIGN_RISK_OPERATIONS = {
  'campaignRisk.review': review,
  'campaignRisk.slackConnectionTest': slackConnectionTest,
} as const;
