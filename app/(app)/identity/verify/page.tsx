import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatDate } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { IDENTITY_VERIFY_PATH, safeNextPath } from '@/lib/identity/links';
import { loadIdentityGroup } from '@/lib/identity/service';
import { RENDERS_PATH } from '@/lib/renders/share';
import { AppHeader } from '@/components/app/app-header';
import { TextSwap } from '@/components/ui/text-swap';
import { startVerificationAction } from './actions';

/**
 * `/identity/verify?next=…` — the one-time face check (docs/TEMPLATES-IA.md §8.2).
 *
 * The page says plainly why it exists (the film engine refuses a real person's photo unless the
 * person has verified), what will happen (a BytePlus page, in English, a minute with the camera),
 * and where the person stands: not yet · in progress (reopen) · done (go back and make) · failed
 * (try again). One form, no JavaScript; the bank's page does the rest.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function VerifyIdentityPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const [locale, viewer, sql, query] = await Promise.all([getLocaleFromHeaders(), getViewer(), getSqlRunner(), searchParams ?? Promise.resolve({} as SearchParams)]);
  const dict = getDictionary(locale);
  const t = dict.identity;
  const next = safeNextPath(one(query, 'next')) ?? RENDERS_PATH;
  const result = one(query, 'result');
  const err = one(query, 'err');
  const group = viewer.userId !== null && sql !== null ? await loadIdentityGroup(sql, viewer.userId) : null;
  const status = group?.status ?? 'none';

  const errLine = (() => {
    switch (err) {
      case 'unavailable':
        return t.err.unavailable;
      case 'no_capacity':
        return t.err.no_capacity;
      case 'bank_error':
        return t.err.bank_error;
      case 'already_active':
        return t.err.already_active;
      default:
        return null;
    }
  })();

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={IDENTITY_VERIFY_PATH} />

      <main id="main" data-identity-status={status} className="band py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{t.eyebrow}</p>

        {viewer.userId === null ? (
          <>
            <h1 className="mt-4 font-display text-title font-black uppercase">{t.title}</h1>
            <a href={signInHref(`${IDENTITY_VERIFY_PATH}?next=${encodeURIComponent(next)}`, locale)} className="mt-10 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
              <TextSwap>{dict.auth.signIn} →</TextSwap>
            </a>
          </>
        ) : status === 'active' ? (
          <section data-identity-done>
            <h1 className="mt-4 font-display text-title font-black uppercase">{t.doneTitle}</h1>
            <p className="mt-6 max-w-detail text-body opacity-70">{t.doneBody}</p>
            {group?.verifiedAt && <p className="mt-3 font-mono text-[0.78rem] opacity-50">{formatDate(group.verifiedAt, locale)}</p>}
            <a href={next} data-identity-back className="mt-10 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
              <TextSwap>{t.backToMake} →</TextSwap>
            </a>
          </section>
        ) : (
          <section>
            <h1 className="mt-4 font-display text-title font-black uppercase">{status === 'pending' ? t.pendingTitle : result === 'failed' || status === 'failed' ? t.failedTitle : t.title}</h1>
            <p className="mt-6 max-w-detail text-body opacity-70">
              {status === 'pending' ? t.pendingBody : result === 'failed' || status === 'failed' ? t.failedBody : t.body}
            </p>

            <ol className="mt-8 max-w-detail flex flex-col gap-3 border-t border-hairline pt-6 font-mono text-[0.85rem]">
              <li>1. {t.steps.camera}</li>
              <li>2. {t.steps.english}</li>
              <li>3. {t.steps.minute}</li>
            </ol>

            {errLine && (
              <p role="status" data-identity-error={err} className="text-accent mt-6 max-w-detail border border-accent px-4 py-3 text-[0.95rem]">
                {errLine}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              {status === 'pending' && group?.h5Link && (
                <a href={group.h5Link} data-identity-resume className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
                  <TextSwap>{t.resume} →</TextSwap>
                </a>
              )}
              <form action={startVerificationAction} data-identity-start>
                <input type="hidden" name="next" value={next} />
                <button type="submit" className={status === 'pending' && group?.h5Link ? 'inline-block border border-current px-6 py-3 font-label text-label uppercase' : 'inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase'}>
                  <TextSwap>{status === 'pending' ? t.restart : status === 'failed' || result === 'failed' ? t.retry : t.start} →</TextSwap>
                </button>
              </form>
            </div>

            <p className="mt-8 max-w-detail font-mono text-[0.72rem] leading-relaxed opacity-45">{t.privacy}</p>
          </section>
        )}
      </main>
    </div>
  );
}
