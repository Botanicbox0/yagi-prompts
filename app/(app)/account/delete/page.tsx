import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { interpolate } from '@/lib/i18n/format';
import { BUSINESS } from '@/lib/legal/documents';
import { ACCOUNT_DELETE_PATH } from '@/lib/account/links';
import {
  NOTHING_PENDING,
  deletionPending,
  deletionReady,
  openDeletionRequest,
  type DeletionPending,
  type DeletionRequest,
} from '@/lib/account/deletion';
import { AppHeader } from '@/components/app/app-header';
import { DeletionFacts, DeletionPendingNotice, DeletionRequestStatus, deletionFlash } from '@/components/account/deletion';
import { deletionMailto } from '@/components/app/deletion-mailto';
import { cancelDeletion, requestDeletion } from './actions';

/**
 * `/account/delete` — the confirmation step of the in-app deletion request (docs/APP-STORE-LAUNCH.md
 * §3.2; Apple 5.1.1(v), Google Play's account-deletion policy). What goes, what stays, what is still
 * moving, one box and one button. No JavaScript: the form posts to a server action.
 *
 * Before 0064 is applied the page offers the mail request the account page always had, so the store
 * builds never show a dead end.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AccountDeletePage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(ACCOUNT_DELETE_PATH)}`);
  const [locale, params] = await Promise.all([getLocaleFromHeaders(), searchParams ?? Promise.resolve({} as SearchParams)]);
  const dict = getDictionary(locale);
  const copy = dict.accountDeletion;

  let ready = false;
  let open: DeletionRequest | null = null;
  let pending: DeletionPending = NOTHING_PENDING;
  try {
    const sql = await getSqlRunner();
    if (sql && (await deletionReady(sql))) {
      ready = true;
      [open, pending] = await Promise.all([openDeletionRequest(sql, viewer.userId), deletionPending(sql, viewer.userId)]);
    }
  } catch { /* An unreachable database reads as "not ready": the mail request still works. */ }

  const flash = deletionFlash(copy, params.deletion);
  const state = !ready ? 'unavailable' : open ? open.status : 'form';

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={ACCOUNT_DELETE_PATH} />
      <main id="main" data-account-delete data-deletion-state={state} className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-8 sm:py-14">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-black">{open ? copy.requestedTitle : copy.title}</h1>
        {!open && <p className="mt-4 text-body leading-relaxed opacity-70">{copy.lede}</p>}

        {flash && (
          <p role={flash.tone === 'error' ? 'alert' : 'status'} data-deletion-flash={flash.tone} className={`mt-6 text-sm ${flash.tone === 'error' ? 'text-accent' : ''}`}>
            {flash.text}
          </p>
        )}

        {open ? (
          <div className="mt-8">
            <DeletionRequestStatus copy={copy} locale={locale} request={open} cancel={cancelDeletion} titled={false} />
          </div>
        ) : (
          <>
            <div className="mt-10">
              <DeletionFacts copy={copy} />
            </div>
            <div className="mt-8">
              <DeletionPendingNotice copy={copy} pending={pending} />
            </div>
            {ready ? (
              <form action={requestDeletion} data-deletion-confirm className="mt-10 border-t border-hairline pt-8">
                <label htmlFor="deletion-confirm" className="flex items-start gap-3">
                  <input
                    id="deletion-confirm"
                    type="checkbox"
                    name="confirm"
                    value="yes"
                    required
                    className="mt-1 h-5 w-5 shrink-0"
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="text-[0.9375rem] leading-relaxed">{copy.confirmLabel}</span>
                </label>
                <button type="submit" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-accent px-6 text-sm font-semibold text-white">
                  {copy.submit}
                </button>
              </form>
            ) : (
              <div className="mt-10 border-t border-hairline pt-8">
                <p className="text-[0.9375rem] leading-relaxed">{interpolate(copy.errUnavailable, { email: BUSINESS.email })}</p>
                <a href={deletionMailto(dict.account, viewer.email)} data-deletion-mail className="text-accent mt-3 inline-block font-label text-eyebrow uppercase">
                  {copy.mailCta} →
                </a>
              </div>
            )}
          </>
        )}

        <p className="mt-10 text-sm"><a href="/account" className="inline-flex min-h-11 items-center underline underline-offset-4">← {copy.back}</a></p>
      </main>
    </div>
  );
}
