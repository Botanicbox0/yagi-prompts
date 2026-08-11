/**
 * PLAN §3.5 / §7 — the ONE boundary every outbound email crosses.
 *
 * Same seam, same reasons, as `lib/billing/stripe-gateway.ts`: there is no Resend account on this
 * machine and no verified sending domain (§11 stop-gate), so an implementation that reached for the
 * SDK inline would be untestable and unrunnable here. A live implementation wraps the pinned
 * `resend` SDK (`lib/notify/mailer-live.ts`), a deterministic fake drives vitest and the offline
 * worker demo (`lib/notify/mailer-fake.ts`), and `lib/notify/service.ts` picks one.
 *
 * The interface is deliberately narrow, and one field of it is load-bearing:
 * `idempotencyKey` is `job_id:user_id` (§3.5), so a delivery that is claimed twice — a lease that
 * expired while the provider was already accepting the message, a worker killed between send and
 * mark — collapses to ONE email at Resend even though our own row moves twice. Exactly-once at the
 * database is the outbox's job; exactly-once at the recipient is this key's.
 *
 * Types + env plumbing only. No `server-only` guard: the worker script and tests import it directly.
 */

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Always sent alongside the HTML — a text/plain alternative is a deliverability requirement. */
  text: string;
  /** `{job_id}:{user_id}` — see the header comment. */
  idempotencyKey: string;
  /**
   * RFC 8058 one-click unsubscribe. The same signed URL the body links to, promoted to a header so
   * Gmail/Apple render their own unsubscribe control (§3.5 "one-click unsubscribe").
   */
  unsubscribeUrl: string;
}

export type SendOutcome =
  | { ok: true; id: string | null }
  /**
   * `retryable` decides whether the worker leaves the delivery for another attempt or burns one.
   * A 4xx from the provider (bad address, suppressed recipient) is not worth three tries; a
   * network blip or a 5xx is.
   */
  | { ok: false; retryable: boolean; error: string };

export interface Mailer {
  /** Which implementation answered — printed by the worker so a run is never ambiguous. */
  readonly kind: 'live' | 'fake';
  /** The verified sender (`NOTIFY_FROM_EMAIL`). Surfaced so the worker can log what it used. */
  readonly from: string;
  send(message: EmailMessage): Promise<SendOutcome>;
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

export interface MailerConfig {
  apiKey: string;
  from: string;
}

/** `.env.example` ships `re_...`-style placeholders; a copied-but-unfilled env is NOT configured. */
function filled(value: string | undefined, min = 12): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < min) return false;
  return !trimmed.endsWith('...') && !trimmed.startsWith('YOUR-');
}

/**
 * Read the live configuration, or `null` when either half is missing.
 *
 * Fails CLOSED, and the worker's degradation is the honest one: with no mailer it claims nothing
 * and leaves every delivery `pending`, rather than marking messages sent that were never sent or
 * burning three attempts against a provider that was never configured. That is the emailing
 * equivalent of the 503 the billing routes answer with — a deployment that is not wired up says so
 * and changes no state.
 */
export function mailerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.NOTIFY_FROM_EMAIL;
  if (!filled(apiKey) || !filled(from, 6) || !from.includes('@')) return null;
  return { apiKey: apiKey.trim(), from: from.trim() };
}

export function isNotifyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return mailerConfigFromEnv(env) !== null || fakeMailerEnabled(env);
}

/**
 * DEV/CI escape hatch so the whole publish → expand → claim → send loop is runnable on a machine
 * with no Resend account (which is this one, and the Director's).
 *
 * Two independent conditions, both required — the same fence as `fakeBillingEnabled()`:
 *   · `NODE_ENV !== 'production'` — a production bundle inlines this and the branch is dead;
 *   · an explicit `PLAYBOOK_FAKE_MAILER=1`.
 * A real `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` always wins (see `lib/notify/service.ts`).
 */
export function fakeMailerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.PLAYBOOK_FAKE_MAILER === '1';
}

/** `{job_id}:{user_id}` — the provider-side idempotency key (§3.5), in one place. */
export function idempotencyKeyFor(jobId: string, userId: string): string {
  return `${jobId}:${userId}`;
}
