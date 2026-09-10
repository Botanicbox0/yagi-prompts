import type { Locale } from '@/lib/i18n/config';
import type { Mailer, SendOutcome } from '@/lib/notify/mailer';
import { getMailer } from '@/lib/notify/service';
import { templateHref } from '@/lib/prompts/links';
import { renderResultEmail } from './email';
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
 */

export type RenderChannel = 'email' | 'kakao' | 'whatsapp' | 'sms';

export interface RenderNotifyInput {
  job: RenderJob;
  templateTitle: string;
  recipient: { email: string | null; locale: Locale };
  /** Localized explanation for a failed render, or null. */
  failureReason: string | null;
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
      const email = renderResultEmail({
        kind: ready ? 'ready' : 'failed',
        locale: input.recipient.locale,
        templateTitle: input.templateTitle,
        medium: job.medium,
        aspect: job.aspect,
        expiresAt: ready && job.shareExpiresAt ? new Date(job.shareExpiresAt) : null,
        reason: input.failureReason,
        links: {
          primaryUrl: shareUrl,
          previewUrl: ready && job.medium === 'image' ? `${origin}${renderMediaHref(job.id, { share: job.shareToken! })}` : null,
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

/** The live resolver: the configured mailer (live or fake), or null — the pass then leaves messages pending. */
export function getRenderNotifier(): RenderNotifier | null {
  const mailer = getMailer();
  return mailer === null ? null : createEmailRenderNotifier(mailer);
}
