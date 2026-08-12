import type { EmailMessage, Mailer, SendOutcome } from './mailer';

/**
 * The deterministic half of the §3.5 boundary.
 *
 * It exists because M5's acceptance criteria are all about ORDERING and COUNTING — "exactly one
 * delivery per opted-in Pro user", "job re-run + worker re-claim = zero duplicate sends",
 * "attempts ≤3 with backoff", "recovery sweep re-queues abandoned leases". Those are only testable
 * if every send is an inspectable record and failure is something a test can schedule. A network
 * mock could not express that; this can.
 *
 * It also drives the offline worker demo (`npm run notify:worker` with `PLAYBOOK_FAKE_MAILER=1`),
 * which is the only way to run the pipeline end to end on a machine with no Resend account. That
 * path is fenced off from production twice over — see `fakeMailerEnabled()` in `mailer.ts`.
 */

export interface RecordedEmail extends EmailMessage {
  /** 1-based, in send order — the counter the exactly-once assertions read. */
  seq: number;
  id: string;
}

export interface FakeMailerOptions {
  from?: string;
  /**
   * Fail the next N sends. `retryable: true` exercises the backoff path (the delivery goes back to
   * `pending`); `false` exercises the terminal path.
   */
  failures?: Array<{ retryable: boolean; error: string }>;
}

export interface FakeMailer extends Mailer {
  readonly kind: 'fake';
  /** Everything that was actually handed to the provider, in order. */
  readonly sent: RecordedEmail[];
  /** Every idempotency key the provider saw, including repeats — a repeat is the bug. */
  idempotencyKeys(): string[];
  /** Keys the provider would have COLLAPSED: sent more than once. Must always be empty. */
  duplicateKeys(): string[];
  /** Queue a failure for the next send (tests call this mid-run). */
  failNext(outcome?: { retryable?: boolean; error?: string }): void;
  reset(): void;
}

const DEFAULT_FROM = 'YAGI PROMPTS <prompts@fake.test>';

export function createFakeMailer(options: FakeMailerOptions = {}): FakeMailer {
  const sent: RecordedEmail[] = [];
  const queued: Array<{ retryable: boolean; error: string }> = [...(options.failures ?? [])];
  let counter = 0;

  const mailer: FakeMailer = {
    kind: 'fake',
    from: options.from ?? DEFAULT_FROM,
    sent,

    idempotencyKeys() {
      return sent.map((message) => message.idempotencyKey);
    },

    duplicateKeys() {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const key of mailer.idempotencyKeys()) {
        if (seen.has(key)) duplicates.add(key);
        seen.add(key);
      }
      return [...duplicates];
    },

    failNext(outcome = {}) {
      queued.push({
        retryable: outcome.retryable ?? true,
        error: outcome.error ?? 'fake mailer: injected failure',
      });
    },

    reset() {
      sent.length = 0;
      queued.length = 0;
      counter = 0;
    },

    async send(message: EmailMessage): Promise<SendOutcome> {
      const failure = queued.shift();
      // A failure is recorded as NOT sent — the provider never accepted it, so it must not appear
      // in `sent`, or the exactly-once assertions would count a message nobody received.
      if (failure) return { ok: false, retryable: failure.retryable, error: failure.error };

      counter += 1;
      sent.push({ ...message, seq: counter, id: `fake_email_${counter}` });
      return { ok: true, id: `fake_email_${counter}` };
    },
  };

  return mailer;
}
