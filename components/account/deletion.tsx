import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { DeletionHold, DeletionRequest } from '@/lib/account/deletion';
import { interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';

type Copy = Dictionary['accountDeletion'];

/**
 * The calendar day the grace period ends, in Korean time: the service's members and its daily pass
 * (03:00 KST) both live there, and the shared `formatDate` (UTC) would name the day before for any
 * request made between midnight and 09:00.
 */
export function deletionDay(iso: string, locale: string): { label: string; ymd: string } {
  const date = new Date(iso);
  const label = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' }).format(date);
  const ymd = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).format(date);
  return { label, ymd };
}

/**
 * What a deletion removes and what it leaves, said once and shown on both the confirmation step and
 * the public how-to page. The sentences follow the privacy policy's §3 retention lines; changing
 * what they promise is a policy change, not a copy edit.
 */
export function DeletionFacts({ copy, headingLevel = 2, questions = false }: { copy: Copy; headingLevel?: 2 | 3; questions?: boolean }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div data-deletion-facts className="grid gap-8 sm:grid-cols-2">
      <section>
        <Heading className="text-base font-semibold">{questions ? copy.deletedQuestion : copy.deletedHeading}</Heading>
        <ul data-deletion-removed className="mt-3 list-disc space-y-2 pl-5 text-[0.9375rem] leading-relaxed opacity-80">
          {copy.deleted.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <section>
        <Heading className="text-base font-semibold">{questions ? copy.keptQuestion : copy.keptHeading}</Heading>
        <ul data-deletion-kept className="mt-3 list-disc space-y-2 pl-5 text-[0.9375rem] leading-relaxed opacity-80">
          {copy.kept.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}

/**
 * Why the account cannot be deleted the moment its grace period ends: something still running that
 * clears by itself, or something only a person can settle. The request is accepted either way; the
 * codes come from `deletionHolds` and are looked at again before anything is deleted.
 */
export function DeletionHoldNotice({ copy, hold, titled = true }: { copy: Copy; hold: DeletionHold[]; titled?: boolean }) {
  if (hold.length === 0) return null;
  return (
    <section data-deletion-hold={hold.join(' ')} role="note" className="rounded-2xl border border-accent p-5">
      {titled && <h2 className="text-base font-semibold">{copy.holdHeading}</h2>}
      <ul className={`${titled ? 'mt-3 ' : ''}list-disc space-y-2 pl-5 text-[0.9375rem] leading-relaxed`}>
        {hold.map((code) => <li key={code} data-hold={code}>{copy.holds[code]}</li>)}
      </ul>
      <p className="mt-3 text-sm opacity-70">{copy.holdNote}</p>
    </section>
  );
}

/**
 * An open request, on `/account` and on the confirmation step: the day the account goes, what it is
 * waiting on if anything, and the cancel button. `cancel` is the server action; the form posts
 * nothing else. `titled={false}` where the page heading already says the request was received.
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
  const day = deletionDay(request.scheduledFor, locale);
  const held = request.hold.length > 0;
  return (
    <div data-deletion-request={request.status} data-deletion-scheduled={day.ymd} role="status" className="rounded-2xl border border-hairline p-5">
      {titled && <p className="mb-2 text-base font-semibold">{copy.requestedTitle}</p>}
      <p className="text-[0.9375rem] leading-relaxed opacity-75">
        {held ? copy.requestedHeldBody : interpolate(copy.requestedBody, { date: day.label })}
      </p>
      {held && (
        <div className="mt-4">
          <DeletionHoldNotice copy={copy} hold={request.hold} titled={false} />
        </div>
      )}
      <form action={cancel} className="mt-4">
        <button type="submit" data-deletion-cancel className="inline-flex min-h-11 items-center rounded-full border border-current px-5 text-sm font-medium">
          {copy.cancelCta}
        </button>
        <p className="mt-2 text-xs opacity-60">{copy.cancelHint}</p>
      </form>
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
