import { readBoundedResponse } from './transport';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { adminUrl } from '@/lib/seo/site-url';
import { campaignRiskMessages } from '@/messages/campaign-risk';
export type SlackRiskConfig =
  | { status: 'disabled' | 'unconfigured' }
  | { status: 'configured'; token: string };
export function slackRiskConfig(env: Record<string, string | undefined>): SlackRiskConfig {
  if (env.CAMPAIGN_RISK_SLACK_ENABLED !== 'on' || env.VERCEL_ENV !== 'production')
    return { status: 'disabled' };
  const token = env.CAMPAIGN_RISK_SLACK_TOKEN?.trim();
  return token ? { status: 'configured', token } : { status: 'unconfigured' };
}
export type SlackRiskOutcome =
  | { state: 'sent' | 'failed' | 'uncertain'; code: string }
  | { state: 'retry'; code: 'rate_limited'; delay: number };
export const RISK_CHANNEL = 'C0C9DRS4DT7';
const RISK_TEAM = 'T0AJ7QBQM39';
function createPrivateRiskSlackSender(
  token: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
) {
  return async (payload: { text: string; client_msg_id?: string }): Promise<SlackRiskOutcome> => {
    let sending = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<SlackRiskOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({ state: sending ? 'uncertain' : 'failed', code: 'timeout' });
        controller.abort();
      }, timeoutMs);
    });
    const run = async (): Promise<SlackRiskOutcome> => {
      try {
        const call = async (method: string, body: object) => {
          const readChannel = method === 'conversations.info';
          const query = readChannel ? `?${new URLSearchParams({ channel: RISK_CHANNEL })}` : '';
          const r = await fetcher(`https://slack.com/api/${method}${query}`, {
            method: readChannel ? 'GET' : 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(!readChannel ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
            },
            ...(!readChannel ? { body: JSON.stringify(body) } : {}),
          });
          if (r.status === 429)
            return {
              limited: true,
              delay: Math.max(60, Math.min(86400, Number(r.headers.get('retry-after')) || 60)),
            };
          if (!r.ok) throw Error('http');
          const text = await readBoundedResponse(r, 65536);
          return JSON.parse(text);
        };
        const auth = await call('auth.test', {});
        if (auth.limited) return { state: 'retry', code: 'rate_limited', delay: auth.delay };
        if (auth.ok !== true || auth.team_id !== RISK_TEAM)
          return { state: 'failed', code: 'workspace_mismatch' };
        const info = await call('conversations.info', { channel: RISK_CHANNEL });
        if (info.limited) return { state: 'retry', code: 'rate_limited', delay: info.delay };
        if (
          info.ok !== true ||
          info.channel?.id !== RISK_CHANNEL ||
          info.channel?.is_private !== true ||
          info.channel?.is_member !== true ||
          info.channel?.is_archived === true
        )
          return { state: 'failed', code: 'channel_unavailable' };
        sending = true;
        const sent = await call('chat.postMessage', {
          channel: RISK_CHANNEL,
          ...payload,
          unfurl_links: false,
          unfurl_media: false,
        });
        if (sent.limited) return { state: 'retry', code: 'rate_limited', delay: sent.delay };
        if (sent.ok === true && sent.channel === RISK_CHANNEL && typeof sent.ts === 'string')
          return { state: 'sent', code: 'acknowledged' };
        // Only explicit provider rejection proves non-delivery. Unknown bodies remain ambiguous.
        if (
          sent.ok === false &&
          [
            'channel_not_found',
            'not_in_channel',
            'invalid_auth',
            'account_inactive',
            'missing_scope',
            'is_archived',
          ].includes(sent.error)
        )
          return { state: 'failed', code: 'provider_rejected' };
        return { state: 'uncertain', code: 'unknown_response' };
      } catch {
        return { state: sending ? 'uncertain' : 'failed', code: 'transport_error' };
      }
    };
    try {
      return await Promise.race([run(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}
export function createRiskSlackSender(
  token: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
) {
  const send = createPrivateRiskSlackSender(token, fetcher, timeoutMs);
  return async (id: string, flagId: string): Promise<SlackRiskOutcome> => {
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(flagId).success)
      return { state: 'failed', code: 'invalid_id' };
    return send({
      client_msg_id: id,
      text: `TWINGS risk_review_required ${id}\n${adminUrl(`/admin/risk?flag=${flagId}#flag-${flagId}`)}`,
    });
  };
}
/** Explicit admin diagnostic only. Never create a fake risk event or drain the outbox. */
export function createRiskSlackConnectionTestSender(
  token: string,
  locale: 'ko' | 'en',
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
) {
  const send = createPrivateRiskSlackSender(token, fetcher, timeoutMs);
  return () =>
    send({
      text: `${campaignRiskMessages[locale].slackConnectionMessage}\n${adminUrl('/admin/risk')}`,
    });
}
/** Durable claim before outbound I/O. A crashed send is uncertain, never blindly reclaimed. */
export async function dispatchRiskSlack(
  sql: SqlRunner,
  config: SlackRiskConfig,
  send?: ReturnType<typeof createRiskSlackSender>,
  now = new Date(),
): Promise<string> {
  if (config.status !== 'configured') return config.status;
  const claimed = await sql.transaction(async (tx) => {
    await tx.query(
      "update campaign_risk_slack_outbox set state='uncertain',error_code='lease_expired',lease_token=null,lease_until=null where state='sending' and lease_until<=$1",
      [now],
    );
    const row = (
      await tx.query<{ id: string; flag_id: string }>(
        "select id,flag_id from campaign_risk_slack_outbox where state='queued' and attempts<5 and available_at<=$1 order by created_at for update skip locked limit 1",
        [now],
      )
    ).rows[0];
    if (!row) return null;
    const token = randomUUID();
    await tx.query(
      "update campaign_risk_slack_outbox set state='sending',attempts=attempts+1,lease_token=$2,lease_until=$3 where id=$1",
      [row.id, token, new Date(now.getTime() + 30000)],
    );
    return { ...row, token };
  });
  if (!claimed) return 'idle';
  let result: SlackRiskOutcome;
  try {
    result = await (send ?? createRiskSlackSender(config.token))(claimed.id, claimed.flag_id);
  } catch {
    result = { state: 'uncertain', code: 'transport_error' };
  }
  const state = result.state === 'retry' ? 'queued' : result.state;
  await sql.query(
    `update campaign_risk_slack_outbox set state=case when $3='queued' and attempts>=5 then 'failed' else $3 end,error_code=$4,available_at=$5,sent_at=case when $3='sent' then $6::timestamptz else null end,lease_token=null,lease_until=null where id=$1 and state='sending' and lease_token=$2`,
    [
      claimed.id,
      claimed.token,
      state,
      result.code,
      new Date(now.getTime() + (result.state === 'retry' ? result.delay * 1000 : 0)),
      now,
    ],
  );
  return state;
}
