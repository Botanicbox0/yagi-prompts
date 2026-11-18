import { Resend } from 'resend';
import type { EmailMessage, Mailer, MailerConfig, SendOutcome } from './mailer';

/**
 * The live half of the §3.5 boundary — the ONLY file that imports the `resend` SDK.
 *
 * Everything the pipeline needs is expressed in `Mailer`, so the SDK version stays a detail of this
 * module (§7 pins it) and nothing downstream knows a Resend type.
 *
 * Two things this file is careful about:
 *   · **the idempotency key is passed to the provider**, not just recorded by us. `job_id:user_id`
 *     (§3.5) means a re-claimed delivery collapses to one message at Resend even if our own row
 *     moves twice — which is precisely the window a lease expiry opens;
 *   · **failures are classified**, because `retryable` decides whether the worker burns an attempt
 *     or leaves the delivery for the next pass. A rejected recipient is not worth three tries.
 */

/** Provider errors that will never succeed on a retry — burn the delivery instead of the budget. */
const TERMINAL_ERROR_NAMES = new Set([
  'validation_error',
  'invalid_parameter',
  'invalid_from_address',
  'invalid_to_address',
  'missing_required_field',
  'not_found',
  'restricted_api_key',
  'invalid_access',
  'invalid_api_key',
  'security_error',
]);

interface ResendErrorLike {
  name?: string;
  message?: string;
  statusCode?: number;
}

function classify(error: ResendErrorLike): SendOutcome {
  const name = typeof error.name === 'string' ? error.name : 'unknown_error';
  const message = typeof error.message === 'string' ? error.message : name;
  const status = typeof error.statusCode === 'number' ? error.statusCode : null;

  // 429 is explicitly retryable (rate limit); every other 4xx is the caller's fault and stays so.
  const retryable =
    status === 429 ||
    (status !== null && status >= 500) ||
    (status === null && !TERMINAL_ERROR_NAMES.has(name));

  return { ok: false, retryable, error: `${name}: ${message}` };
}

export function createLiveMailer(config: MailerConfig): Mailer {
  const client = new Resend(config.apiKey);

  return {
    kind: 'live',
    from: config.from,

    async send(message: EmailMessage): Promise<SendOutcome> {
      try {
        const { data, error } = await client.emails.send(
          {
            from: config.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            // RFC 8058: the mail client renders its own unsubscribe control, and pressing it is
            // a POST the signed GET link also honours (§3.5 "one-click unsubscribe"). A one-off
            // invitation has no list to leave and carries no header.
            ...(message.unsubscribeUrl
              ? { headers: { 'List-Unsubscribe': `<${message.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
              : {}),
          },
          // resend@6 spreads request options into its `fetch` call, so the signal really aborts the
          // HTTP request even though its `PostOptions` type does not list it.
          { idempotencyKey: message.idempotencyKey, ...(message.signal ? { signal: message.signal } : {}) } as { idempotencyKey: string },
        );

        if (error) return classify(error as ResendErrorLike);
        return { ok: true, id: data?.id ?? null };
      } catch (err) {
        // A thrown error is transport-level (DNS, socket, timeout) — always worth another attempt.
        return { ok: false, retryable: true, error: `transport: ${String(err)}` };
      }
    },
  };
}
