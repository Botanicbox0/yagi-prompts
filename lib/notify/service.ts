import { createFakeMailer } from './mailer-fake';
import { createLiveMailer } from './mailer-live';
import { fakeMailerEnabled, mailerConfigFromEnv, type Mailer } from './mailer';

/**
 * Resolve the mailer, exactly the way `lib/billing/service.ts` resolves the Stripe gateway.
 *
 *   1. real `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` → the live mailer. Always wins.
 *   2. `PLAYBOOK_FAKE_MAILER=1` (never in a production build) → the deterministic fake, so the
 *      worker is runnable offline (§11: no Resend account, no verified domain yet).
 *   3. neither → `null`, and the worker degrades honestly: it claims nothing and changes nothing.
 *
 * `null` is a first-class answer here for the same reason it is in `lib/db/connect.ts` — an
 * unconfigured deployment must be visible and inert, never half-working.
 *
 * No `server-only` guard on purpose: `scripts/notify-worker.ts` is a plain node process, and the
 * future Edge Function will call the same resolver.
 */

interface MailerCache {
  mailer: Mailer | null;
  key: string | null;
}

/** On `globalThis` for the same reason as the other two resolvers — see `lib/db/connect.ts`. */
const cache: MailerCache = (((globalThis as Record<string, unknown>).__playbookMailer ??= {
  mailer: null,
  key: null,
}) as MailerCache);

function mailerKey(): string | null {
  const config = mailerConfigFromEnv();
  if (config !== null) return `live:${config.from}`;
  if (fakeMailerEnabled()) return 'fake';
  return null;
}

export function getMailer(): Mailer | null {
  const key = mailerKey();
  if (key === null) {
    cache.mailer = null;
    cache.key = null;
    return null;
  }
  if (cache.mailer !== null && cache.key === key) return cache.mailer;

  const config = mailerConfigFromEnv();
  cache.mailer =
    config !== null ? createLiveMailer(config) : createFakeMailer({ from: 'YAGI PROMPTS <fake@local>' });
  cache.key = key;
  return cache.mailer;
}

/** Test/dev seam — drops the memoised mailer so the next call re-reads the environment. */
export function resetMailer(): void {
  cache.mailer = null;
  cache.key = null;
}
