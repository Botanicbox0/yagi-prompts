import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { DeletionPending, DeletionRequest } from '@/lib/account/deletion';
import { formatDate, interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';

type Copy = Dictionary['accountDeletion'];

/**
 * docs/APP-STORE-LAUNCH.md §3.2 — what a deletion removes and what it leaves, said once and shown on
 * both the confirmation step and the public how-to page. The sentences follow the privacy policy's
 * §3 retention lines; changing what they promise is a policy change, not a copy edit.
 */
export function DeletionFacts({ copy, headingLevel = 2, questions = false }: { copy: Copy; headingLevel?: 2 | 3; questions?: boolean }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div data-deletion-facts className="grid gap-8 sm:grid-cols-2">
      <section>
        <Heading className="text-base font-semibold">{questions ? copy.deletedQuestion : copy.deletedHeading}</Heading>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[0.9375rem] leading-relaxed opacity-80">
          {copy.deleted.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <section>
        <Heading className="text-base font-semibold">{questions ? copy.keptQuestion : copy.keptHeading}</Heading>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[0.9375rem] leading-relaxed opacity-80">
          {copy.kept.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}

/** Things still moving on the account. Advice only: the request is never refused because of them. */
export function DeletionPendingNotice({ copy, pending }: { copy: Copy; pending: DeletionPending }) {
  const lines = [
    pending.renders > 0 ? interpolate(copy.pendingRenders, { count: String(pending.renders) }) : null,
    pending.payments > 0 ? interpolate(copy.pendingPayments, { count: String(pending.payments) }) : null,
    pending.subscription ? copy.pendingSubscription : null,
    pending.campaigns > 0 ? interpolate(copy.pendingCampaigns, { count: String(pending.campaigns) }) : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <section data-deletion-pending={lines.length} role="note" className="rounded-2xl border border-accent p-5">
      <h2 className="text-base font-semibold">{copy.pendingHeading}</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-[0.9375rem] leading-relaxed">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="mt-3 text-sm opacity-70">{copy.pendingNote}</p>
    </section>
  );
}

/**
 * An open request, on `/account` and on the confirmation step: when it will be done, and the cancel
 * button while nobody has started on it. `cancel` is the server action; the form posts nothing else.
 * `titled={false}` where the page heading already says the request was received.
 */
export function DeletionRequestStatus({
  copy,
  locale,
  request,
  cancel,
  titled = true,
}: {
  copy: Copy;
  locale: string;
  request: DeletionRequest;
  cancel: (form: FormData) => Promise<void>;
  titled?: boolean;
}) {
  const date = formatDate(request.dueAt, locale) ?? request.dueAt.slice(0, 10);
  return (
    <div data-deletion-request={request.status} role="status" className="rounded-2xl border border-hairline p-5">
      {titled && <p className="mb-2 text-base font-semibold">{copy.requestedTitle}</p>}
      <p className="text-[0.9375rem] leading-relaxed opacity-75">
        {interpolate(request.status === 'processing' ? copy.processingBody : copy.requestedBody, { date })}
      </p>
      {request.status === 'requested' && (
        <form action={cancel} className="mt-4">
          <button type="submit" data-deletion-cancel className="inline-flex min-h-11 items-center rounded-full border border-current px-5 text-sm font-medium">
            {copy.cancelCta}
          </button>
          <p className="mt-2 text-xs opacity-60">{copy.cancelHint}</p>
        </form>
      )}
    </div>
  );
}

/** The flash line after a redirect from the two server actions. */
export function deletionFlash(copy: Copy, value: string | string[] | undefined): { tone: 'ok' | 'error'; text: string } | null {
  if (value === 'cancelled') return { tone: 'ok', text: copy.cancelled };
  if (value === 'cancelFailed') return { tone: 'error', text: interpolate(copy.cancelFailed, { email: BUSINESS.email }) };
  if (value === 'unconfirmed') return { tone: 'error', text: copy.errUnconfirmed };
  if (value === 'unavailable') return { tone: 'error', text: interpolate(copy.errUnavailable, { email: BUSINESS.email }) };
  return null;
}
