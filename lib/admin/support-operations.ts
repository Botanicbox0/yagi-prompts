import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sendBrandSupport } from '@/lib/brands/workspace/service';
import { sendConsumerSupportReply } from '@/lib/support/concierge-service';
import {
  boundErrorCode,
  mirrorAdminReplyToSlackThread,
  resolveTeamNoticeConfig,
  runLiveTeamNoticeDeliveryPass,
  sendTeamNoticePayload,
  tableExists,
} from '@/lib/brands/team-notice-outbox';
import { adminUrl } from '@/lib/seo/site-url';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import * as f from './form';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RetryInput =
  | { scope: 'one'; id: string }
  | { scope: 'all_failed' }
  | { scope: 'all' };

const deliveryRetry: AdminOperation<RetryInput> = {
  parse(form) {
    const scope = f.str(form, 'scope');
    if (scope === 'all_failed' || scope === 'all') return { ok: true, value: { scope } };
    const id = f.str(form, 'id');
    if (!UUID_RE.test(id)) return { ok: false, detail: 'id: valid UUID required' };
    return { ok: true, value: { scope: 'one', id } };
  },
  async run(ctx, input) {
    if (!(await tableExists(ctx.sql, 'team_notice_deliveries'))) {
      return fail('notFound', 'team_notice_deliveries table is not available yet');
    }
    let resetIds: string[] = [];
    if (input.scope === 'all_failed' || input.scope === 'all') {
      const targetStatuses = input.scope === 'all' ? "('failed', 'skipped')" : "('failed')";
      const { rows } = await ctx.sql.query<{ id: string }>(
        `update team_notice_deliveries
            set status = 'pending',
                attempts = 0,
                next_attempt_at = null,
                claimed_at = null,
                claim_token = null,
                last_error_code = null,
                updated_at = now()
          where status in ${targetStatuses}
          returning id::text as id`,
      );
      resetIds = rows.map((r) => r.id);
    } else {
      const { rows } = await ctx.sql.query<{ id: string }>(
        `update team_notice_deliveries
            set status = 'pending',
                attempts = 0,
                next_attempt_at = null,
                claimed_at = null,
                claim_token = null,
                last_error_code = null,
                updated_at = now()
          where id = $1::uuid
            and status in ('failed', 'skipped', 'pending')
          returning id::text as id`,
        [input.id],
      );
      if (rows.length === 0) return fail('notFound', 'delivery row not found or already sent');
      resetIds = rows.map((r) => r.id);
    }

    if (resetIds.length > 0 && ctx.defer) {
      ctx.defer(async () => {
        if (input.scope === 'one') {
          await runLiveTeamNoticeDeliveryPass(ctx.sql, { deliveryId: input.id });
        } else {
          await runLiveTeamNoticeDeliveryPass(ctx.sql, { limit: Math.min(20, resetIds.length) });
        }
      });
    }

    return ok('saved', { detail: `retried:${resetIds.length}` });
  },
};

export interface SlackConnectionTestInput {
  force: boolean;
}

/**
 * Testable core for `support.slack.connectionTest`.
 * Refuses outside `VERCEL_ENV === 'production'` unless `input.force` is explicitly true.
 * Enforces 5-minute audit cooldown and records audit rows in `platform_audit`.
 */
export async function runSupportSlackConnectionTest(
  ctx: AdminContext,
  input: SlackConnectionTestInput,
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
  },
): Promise<AdminOutcome> {
  const env = options?.env ?? process.env;
  const vercelEnv = env.VERCEL_ENV?.trim() || 'local';
  const nodeEnv = env.NODE_ENV?.trim() || 'unknown';
  const isProduction = vercelEnv === 'production';

  const gate = await ctx.sql.transaction(async (tx) => {
    const admin = (
      await tx.query<{ is_admin: boolean }>(
        'select is_admin from profiles where id = $1 for update',
        [ctx.viewer.userId],
      )
    ).rows[0];
    if (admin?.is_admin !== true) return 'forbidden' as const;

    if (!isProduction && !input.force) {
      return 'non_production' as const;
    }

    const config = resolveTeamNoticeConfig(env, { allowNonProduction: input.force });
    if (config.status !== 'configured') return config;

    const recent = (
      await tx.query<{ id: string }>(
        "select id from platform_audit where actor_id = $1 and action = 'support.slack.connectionTest' and created_at > now() - interval '5 minutes' limit 1",
        [ctx.viewer.userId],
      )
    ).rows[0];
    if (recent) return 'cooldown' as const;

    const envCheck = isProduction
      ? 'production_verified'
      : input.force
        ? 'non_production_forced'
        : 'blocked';

    await tx.query(
      "insert into platform_audit(actor_id, entity_id, action, reason, details) values($1, $1, 'support.slack.connectionTest', 'admin_requested_connection_test', $2::jsonb)",
      [
        ctx.viewer.userId,
        JSON.stringify({
          state: 'started',
          transport: config.transport,
          forced: input.force,
          forcedByActorId: input.force ? ctx.viewer.userId : null,
          vercelEnv,
          nodeEnv,
          environmentCheck: envCheck,
        }),
      ],
    );
    return { config, envCheck };
  });

  if (gate === 'forbidden') return fail('forbidden');
  if (gate === 'non_production') return fail('invalid', 'slackTestNonProduction');
  if (gate === 'cooldown') return fail('invalid', 'slackTestCooldown');
  if ('status' in gate) return fail('invalid', `slackTest_${gate.code}`);
  if (!('config' in gate)) return fail('invalid');
  const activeConfig = gate.config;

  const isEn = ctx.viewer.locale === 'en';
  const testLine = isEn
    ? `[TWINGS · Connection Test]\nAdmin verified support Slack delivery (${activeConfig.transport}).\n${adminUrl('/admin/inquiries?kind=team')}`
    : `[TWINGS · 연결 점검]\n관리자 화면에서 고객 문의 Slack 알림(${activeConfig.transport}) 연결을 점검했습니다.\n${adminUrl('/admin/inquiries?kind=team')}`;

  const outcome = await sendTeamNoticePayload(activeConfig, testLine, {
    fetcher: options?.fetcher,
    env,
  });

  await ctx.sql.query(
    "insert into platform_audit(actor_id, entity_id, action, reason, details) values($1, $1, 'support.slack.connectionTest.result', 'admin_requested_connection_test', $2::jsonb)",
    [
      ctx.viewer.userId,
      JSON.stringify({
        status: outcome.status,
        transport: activeConfig.transport,
        forced: input.force,
        forcedByActorId: input.force ? ctx.viewer.userId : null,
        vercelEnv,
        environmentCheck: gate.envCheck,
        code: outcome.status === 'sent' ? 'ok' : boundErrorCode(outcome.code),
      }),
    ],
  );

  if (outcome.status === 'sent') {
    return ok('saved', { detail: `slackTestSent:${activeConfig.transport}` });
  }
  return fail('unknown', `slackTestFailed:${boundErrorCode(outcome.code)}`);
}

const slackConnectionTest: AdminOperation<SlackConnectionTestInput> = {
  parse(form) {
    const rawForce = f.str(form, 'force').toLowerCase();
    return {
      ok: true,
      value: { force: rawForce === 'true' || rawForce === '1' || rawForce === 'on' },
    };
  },
  run(ctx, input) {
    return runSupportSlackConnectionTest(ctx, input);
  },
};

export interface SupportReplyInput {
  targetType: 'brand' | 'consumer';
  organizationId: string;
  userId: string;
  deliveryId: string;
  body: string;
  requestId: string;
}

const SupportReplySchema = z
  .object({
    targetType: z.enum(['brand', 'consumer']),
    organizationId: z.string(),
    userId: z.string(),
    deliveryId: z.string(),
    body: z.string().trim().min(1).max(4000),
    requestId: z.uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.targetType === 'brand' && !UUID_RE.test(v.organizationId)) {
      ctx.addIssue({ code: 'custom', path: ['organizationId'], message: 'valid organizationId required' });
    }
    if (v.targetType === 'consumer' && !UUID_RE.test(v.userId)) {
      ctx.addIssue({ code: 'custom', path: ['userId'], message: 'valid userId required' });
    }
  });

/**
 * Unified admin support reply operation (`support.reply`).
 * Stores the studio reply in `brand_support_messages` or `consumer_support_messages`, and when
 * the notice was delivered via `bot` transport mirrors the reply into that Slack thread.
 */
export async function runSupportReplyOperation(
  ctx: AdminContext,
  input: SupportReplyInput,
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
  },
): Promise<AdminOutcome> {
  if (input.targetType === 'brand') {
    const res = await sendBrandSupport(
      { sql: ctx.sql },
      ctx.viewer,
      {
        organizationId: input.organizationId,
        body: input.body,
        requestId: input.requestId,
      },
      'studio',
    );
    if (!res.ok) {
      const code =
        res.code === 'forbidden'
          ? 'forbidden'
          : res.code === 'not_found'
            ? 'notFound'
            : res.code === 'conflict'
              ? 'brandConflict'
              : 'invalid';
      return fail(code, res.code);
    }
    const mirror = async () => {
      await mirrorAdminReplyToSlackThread(
        ctx.sql,
        {
          targetType: 'brand',
          organizationId: input.organizationId,
          deliveryId: input.deliveryId || undefined,
          body: input.body,
        },
        options,
      );
    };
    if (ctx.defer) ctx.defer(mirror);
    else await mirror();
    return ok('saved', { detail: 'replied' });
  }

  const res = await sendConsumerSupportReply(ctx.sql, ctx.viewer, {
    userId: input.userId,
    body: input.body,
    requestId: input.requestId,
  });
  if (!res.ok) {
    return fail(
      res.code === 'forbidden' ? 'forbidden' : res.code === 'not_found' ? 'notFound' : 'invalid',
      res.code,
    );
  }
  const mirror = async () => {
    await mirrorAdminReplyToSlackThread(
      ctx.sql,
      {
        targetType: 'consumer',
        userId: input.userId,
        deliveryId: input.deliveryId || undefined,
        body: input.body,
      },
      options,
    );
  };
  if (ctx.defer) ctx.defer(mirror);
  else await mirror();
  return ok('saved', { detail: 'replied' });
}

const supportReply: AdminOperation<SupportReplyInput> = {
  parse(form) {
    const organizationId = f.str(form, 'organizationId');
    const userId = f.str(form, 'userId');
    const rawTarget = f.str(form, 'targetType');
    const targetType =
      rawTarget === 'brand' || rawTarget === 'consumer'
        ? rawTarget
        : organizationId
          ? 'brand'
          : 'consumer';
    const requestIdRaw = f.str(form, 'requestId');
    const candidate = {
      targetType,
      organizationId,
      userId,
      deliveryId: f.str(form, 'deliveryId'),
      body: f.text(form, 'body'),
      requestId: UUID_RE.test(requestIdRaw) ? requestIdRaw : randomUUID(),
    };
    const parsed = SupportReplySchema.safeParse(candidate);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return { ok: false, detail };
    }
    return { ok: true, value: parsed.data };
  },
  run(ctx, input) {
    return runSupportReplyOperation(ctx, input);
  },
};

export const SUPPORT_OPERATIONS = {
  'support.delivery.retry': deliveryRetry,
  'support.slack.connectionTest': slackConnectionTest,
  'support.reply': supportReply,
} as const;
