import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { IDENTITY_SELFIE_PATH, safeNextPath } from '@/lib/identity/links';
import { selfieLibrary, selfieLimit, type SelfieLibrary } from '@/lib/identity/selfie-service';
import { templatesHref } from '@/lib/prompts/links';
import { AppHeader } from '@/components/app/app-header';
import { SelfieLibraryPanel } from '@/components/identity/selfie-grid';

/**
 * `/identity/selfie?next=…` — the standalone place for the saved photos (founder, 2026-10-22): see
 * them, add one (up to IDENTITY_SELFIE_LIMIT), change, make default, note, delete. The studio asks
 * "이 얼굴로 만들까요?" over the same photos; this page is the entry from the account, the header
 * menu, the brand studio and the community, and the way to manage them without buying anything.
 * `?add=1` / `?change=1` open straight on the uploader (add while there is room, change when full).
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function SelfiePage({ searchParams }: { searchParams: Promise<{ next?: string; change?: string; add?: string }> }) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  const change = query.change === '1';
  const add = query.add === '1';
  // The way back to THIS page, with its own way back kept: used by the chooser redirect and by a mid-save sign-in.
  const here = new URLSearchParams({ ...(next ? { next } : {}), ...(change ? { change: '1' } : {}), ...(add ? { add: '1' } : {}) }).toString();
  const herePath = `${IDENTITY_SELFIE_PATH}${here ? `?${here}` : ''}`;
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(herePath)}`);
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const copy = dict.selfie;
  let library: SelfieLibrary | null = null;
  try {
    const sql = await getSqlRunner();
    if (sql) library = await selfieLibrary(sql, viewer.userId, selfieLimit());
  } catch { /* Missing cloud migration: the page says so instead of a 500. */ }
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={IDENTITY_SELFIE_PATH} />
      <main id="main" data-identity-selfie className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="max-w-[18ch] font-display text-[clamp(2rem,5vw,3.2rem)] leading-[0.95] font-black uppercase">{copy.title}</h1>
        <p className="mt-4 max-w-[46ch] text-body leading-relaxed opacity-70">{copy.intro}</p>
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start">
          <div className="border border-hairline p-5 sm:p-6">
            {library
              ? <SelfieLibraryPanel copy={copy} locale={locale} variant="page" initial={library} startEditing={change || add} signinHref={`/auth/signin?next=${encodeURIComponent(herePath)}&locale=${locale}`} continueHref={next ?? templatesHref(locale, 'video')} continueLabel={next ? copy.continue : copy.browse} />
              : <p role="status" className="text-sm leading-relaxed">{copy.unavailable}</p>}
          </div>
          <aside className="text-sm leading-relaxed opacity-70">
            <p>{copy.identityNote}</p>
            <p className="mt-6"><a href="/account" className="underline underline-offset-4">← {copy.back}</a></p>
          </aside>
        </div>
      </main>
    </div>
  );
}
