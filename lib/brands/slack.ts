import { adminUrl } from '@/lib/seo/site-url';
import type { InquiryType } from './schemas';

/** Pure transport seam; credentials are read only by the server-only runtime module. */
export type SlackInquiryConfiguration = 'disabled' | 'unconfigured' | 'misconfigured' | 'configured';
export type SlackInquiryConfig =
  | { status: Exclude<SlackInquiryConfiguration, 'configured'> }
  | { status: 'configured'; webhookUrl: string };

export function slackInquiryConfigFromEnv(env: Record<string, string | undefined>): SlackInquiryConfig {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') return { status: 'disabled' };
  if (env.SLACK_BRAND_INQUIRIES_ENABLED !== 'on') return { status: 'disabled' };
  const webhookUrl = env.SLACK_BRAND_INQUIRIES_WEBHOOK_URL?.trim();
  if (!webhookUrl) return { status: 'unconfigured' };
  try {
    const url = new URL(webhookUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'hooks.slack.com' || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      return { status: 'misconfigured' };
    }
    return { status: 'configured', webhookUrl: url.toString() };
  } catch { return { status: 'misconfigured' }; }
}

export type SlackInquiryOutcome =
  | { status: 'sent' }
  | { status: 'retry'; code: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'failed' | 'uncertain'; code: string };

export interface SlackInquirySender {
  send(input: { inquiryId: string; inquiryType: InquiryType }): Promise<SlackInquiryOutcome>;
}

const ADMIN_URL = adminUrl('/admin/inquiries');
export const SLACK_INQUIRY_TIMEOUT_MS = 5_000;

/** Incoming webhooks provide no idempotency acknowledgement. Never retry an ambiguous send. */
export function createSlackInquirySender(args: {
  webhookUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): SlackInquirySender {
  const fetcher = args.fetcher ?? fetch;
  return {
    async send({ inquiryId, inquiryType }) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<SlackInquiryOutcome>(resolve => {
        timer = setTimeout(() => {
          // Resolve first: abort-aware fetchers may reject synchronously from the abort event.
          resolve({ status: 'uncertain', code: 'timeout' });
          controller.abort();
        }, args.timeoutMs ?? SLACK_INQUIRY_TIMEOUT_MS);
      });
      const send = async (): Promise<SlackInquiryOutcome> => {
        try {
          const response = await fetcher(args.webhookUrl, {
            method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // All dynamic values are a UUID or a fixed enum, never free-form inquiry content.
              text: `TWINGS inquiry ${inquiryId}\nType: ${inquiryType}\n${ADMIN_URL}#inquiry-${inquiryId}`,
              unfurl_links: false, unfurl_media: false,
            }),
          });
          if (response.status === 429) {
            const seconds = Number(response.headers.get('retry-after'));
            // Invalid or absent Retry-After uses one minute. Do not retry before a valid value.
            return { status: 'retry', code: 'rate_limited', retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60 };
          }
          if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            return { status: 'failed', code: `http_${response.status}` };
          }
          if (response.status !== 200) return { status: 'uncertain', code: `http_${response.status}` };
          return (await response.text()).trim() === 'ok'
            ? { status: 'sent' }
            : { status: 'uncertain', code: 'unexpected_response' };
        } catch {
          // Exception strings and provider bodies can contain the secret webhook URL.
          return { status: 'uncertain', code: 'transport_error' };
        }
      };
      try { return await Promise.race([send(), deadline]); }
      finally { clearTimeout(timer); }
    },
  };
}
