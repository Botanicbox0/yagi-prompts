import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import type { Mailer, SendOutcome } from '@/lib/notify/mailer';
import { createWebPushSender, pushConfigFromEnv, sendPushToUser, type PushFanout, type PushMessage, type PushSender } from '@/lib/notify/push';
import { getMailer } from '@/lib/notify/service';
import { templateHref } from '@/lib/prompts/links';
import { renderResultEmail } from './email';
import type { RenderFrame } from './frames';
import type { RenderJob } from './repo';
import { RENDERS_PATH, renderHref, renderMediaHref, shareHref } from './share';

/**
 * "Tell the person where their render is" — as a CHANNEL, not as an email.
 *
 * docs/TEMPLATES-IA.md §8.1 (founder, 2026-09-06): a Kakao-login reader expects the link in
 * KakaoTalk, a Google-login reader in Korea wants it there too, and WhatsApp is next. All of
 * those are the same message on a different wire, so the pass talks to this interface and the
 * row records `notify_channel`. Email is the one wire live today; 알림톡 and WhatsApp become two
 * more implementations of `RenderNotifier`, chosen per reader, without the pass changing.
 *
 * Push (docs/PLATFORM-2.0.md §5.3, 2026-10-22) is the first of those, and it rides WITH email
 * rather than instead of it: the email always goes, and every live device of the owner gets a push
 * too. A reader the email cannot reach (a Kakao account without an email) is reached by push alone.
 */

export type RenderChannel = 'email' | 'kakao' | 'whatsapp' | 'sms' | 'push';

export interface RenderNotifyInput {
  job: RenderJob;
  templateTitle: string;
  recipient: { email: string | null; locale: Locale };
  /** Localized explanation for a failed render, or null. */
  failureReason: string | null;
  /** A finished set's pictures in order (lib/renders/frames.ts); empty for one result. */
  frames?: readonly RenderFrame[];
  siteUrl: string;
  siteName: string;
}

export interface RenderNotifier {
  readonly channel: RenderChannel;
  /** Which implementation answered — printed by the pass so a run is never ambiguous. */
  readonly kind: string;
  send(input: RenderNotifyInput): Promise<SendOutcome>;
}

/** `render:{job_id}:{user_id}` — the provider-side idempotency key, so a re-claimed send collapses to one message. */
export function renderIdempotencyKey(job: Pick<RenderJob, 'id' | 'userId'>): string {
  return `render:${job.id}:${job.userId}`;
}

export function createEmailRenderNotifier(mailer: Mailer): RenderNotifier {
  return {
    channel: 'email',
    kind: mailer.kind,
    async send(input) {
      if (!input.recipient.email) return { ok: false, retryable: false, error: 'the profile has no email' };
      const { job } = input;
      const origin = input.siteUrl.replace(/\/+$/, '');
      const ready = job.status === 'succeeded' && job.shareToken !== null;
      const shareUrl = ready ? `${origin}${shareHref(job.id, job.shareToken!)}` : `${origin}${RENDERS_PATH}`;
      const frames = ready ? (input.frames ?? []) : [];
      const email = renderResultEmail({
        kind: ready ? 'ready' : 'failed',
        locale: input.recipient.locale,
        templateTitle: input.templateTitle,
        medium: job.medium,
        aspect: job.aspect,
        expiresAt: ready && job.shareExpiresAt ? new Date(job.shareExpiresAt) : null,
        reason: input.failureReason,
        ...(frames.length > 1 ? { frames: frames.length } : {}),
        links: {
          primaryUrl: shareUrl,
          previewUrl: ready && job.medium === 'image' ? `${origin}${renderMediaHref(job.id, { share: job.shareToken! })}` : null,
          morePreviewUrls: frames.slice(1).map((frame) => `${origin}${frame.view}`),
          templateUrl: `${origin}${templateHref(input.recipient.locale, job.templateSlug)}`,
          rendersUrl: `${origin}${RENDERS_PATH}`,
          feedbackUrl: `${origin}${renderHref(job.id)}#feedback`,
        },
        siteName: input.siteName,
      });
      return mailer.send({
        to: input.recipient.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: renderIdempotencyKey(job),
        // Transactional, but the header costs nothing and points at the account's own settings.
        unsubscribeUrl: `${origin}/account`,
      });
    },
  };
}

/** The push for one finished render: wording from the dictionary, the owner page as the link. */
export function renderPushMessage(input: Pick<RenderNotifyInput, 'job' | 'templateTitle' | 'recipient' | 'failureReason'>): PushMessage {
  const copy = getDictionary(input.recipient.locale).appShell.push;
  const ready = input.job.status === 'succeeded';
  return {
    title: ready ? copy.readyTitle : copy.failedTitle,
    body: ready
      ? interpolate(copy.readyBody, { template: input.templateTitle })
      : interpolate(copy.failedBody, { template: input.templateTitle, reason: input.failureReason ?? '' }).trim(),
    url: renderHref(input.job.id),
    tag: `render-${input.job.id}`,
    // 32 URL-safe characters, the Topic header's limit: the job id without its dashes.
    topic: input.job.id.replace(/-/g, ''),
    lang: input.recipient.locale,
  };
}

export type PushDelivery =
  | { status: 'skipped'; reason: string }
  | { status: 'sent'; sent: number; revoked: number }
  | { status: 'failed'; retryable: boolean; error: string };

export interface PushRenderNotifier extends RenderNotifier {
  /** The push half on its own terms: "nobody to tell" is a skip, not a failure. */
  deliver(input: RenderNotifyInput): Promise<PushDelivery>;
}

/**
 * Every live device of the job's owner. One delivered device makes the push sent, a 404/410
 * retires that device, and a delivered push records `notify_channel = 'push'` on the job — the
 * channel that reached the reader first. Anything wrong on the push side (the table not yet in
 * this database, a dead push service) is a skip or a failure here and never stops the email.
 */
export function createPushRenderNotifier(deps: { sql: SqlRunner; sender: PushSender }): PushRenderNotifier {
  const deliver = async (input: RenderNotifyInput): Promise<PushDelivery> => {
    let fanout: PushFanout;
    try {
      fanout = await sendPushToUser({ sql: deps.sql, sender: deps.sender }, input.job.userId, renderPushMessage(input));
    } catch (error) {
      return { status: 'skipped', reason: `push unavailable — ${error instanceof Error ? error.message : String(error)}` };
    }
    if (fanout.sent > 0) {
      try {
        await deps.sql.query(`update render_jobs set notify_channel = 'push' where id = $1`, [input.job.id]);
      } catch {
        // The record is informative; the reader has already been told.
      }
      return { status: 'sent', sent: fanout.sent, revoked: fanout.revoked };
    }
    // No live device, or every one turned out to be gone: nobody to push to.
    if (fanout.failed === 0) return { status: 'skipped', reason: fanout.attempted === 0 ? 'no live device' : 'every device had expired' };
    return { status: 'failed', retryable: fanout.retryable, error: fanout.errors.join('; ') };
  };
  return {
    channel: 'push',
    kind: deps.sender.kind,
    deliver,
    async send(input) {
      const result = await deliver(input);
      if (result.status === 'sent') return { ok: true, id: null };
      if (result.status === 'skipped') return { ok: false, retryable: false, error: `push skipped — ${result.reason}` };
      return { ok: false, retryable: result.retryable, error: result.error };
    },
  };
}

/**
 * Email always, push in addition. With nobody to push to, the email's outcome is the outcome — the
 * pass behaves exactly as it did before push existed. Otherwise the message counts as sent when
 * either wire reached the reader, so a push is never repeated because an email is being retried,
 * and it fails only when neither did (retrying if either failure was transient).
 */
export function withPushNotifier(email: RenderNotifier, push: PushRenderNotifier): RenderNotifier {
  return {
    channel: email.channel,
    kind: `${email.kind}+push:${push.kind}`,
    async send(input) {
      const [mail, pushed] = await Promise.all([email.send(input), push.deliver(input)]);
      // A push that failed next to an email that landed would otherwise leave no trace at all.
      if (pushed.status === 'failed') console.warn(`[renders] ${input.job.id}: push — ${pushed.error}`);
      if (pushed.status === 'skipped' || mail.ok) return mail;
      if (pushed.status === 'sent') return { ok: true, id: null };
      // Each push error already reads "push: …".
      return { ok: false, retryable: mail.retryable || pushed.retryable, error: `${mail.error} · ${pushed.error}` };
    },
  };
}

/**
 * The live resolver: the configured mailer (live or fake), plus push when the VAPID keys are set
 * and the pass has a database to find devices in — or null without a mailer: the pass then leaves
 * messages pending, and push never replaces the email it rides with.
 */
export function getRenderNotifier(sql: SqlRunner | null = null, env: Record<string, string | undefined> = process.env): RenderNotifier | null {
  const mailer = getMailer();
  if (mailer === null) return null;
  const email = createEmailRenderNotifier(mailer);
  const config = pushConfigFromEnv(env);
  if (sql === null || config === null) return email;
  return withPushNotifier(email, createPushRenderNotifier({ sql, sender: createWebPushSender(config) }));
}
