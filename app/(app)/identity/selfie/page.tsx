import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { IDENTITY_SELFIE_PATH, safeNextPath } from '@/lib/identity/links';
import { currentSelfie, selfieView } from '@/lib/identity/selfie-service';
import { templatesHref } from '@/lib/prompts/links';
import { AppHeader } from '@/components/app/app-header';
import { SelfieUploader } from '@/components/identity/selfie-uploader';

/**
 * `/identity/selfie?next=…` — the standalone place to upload or change the one photo (founder,
 * 2026-10-22). The same uploader lives inline in every template's make loop; this page is the entry
 * from the account, the header menu, the brand studio and the community, and the only way back
 * for someone who wants to change the photo without buying anything.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function SelfiePage({ searchParams }: { searchParams: Promise<{ next?: string; change?: string }> }) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  const change = query.change === '1';
  // The way back to THIS page, with its own way back kept: used by the chooser redirect and by a mid-save sign-in.
  const here = new URLSearchParams({ ...(next ? { next } : {}), ...(change ? { change: '1' } : {}) }).toString();
  const herePath = `${IDENTITY_SELFIE_PATH}${here ? `?${here}` : ''}`;
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/auth/choose?next=${encodeURIComponent(herePath)}`);
  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const copy = dict.selfie;
  let selfie = null;
  let available = false;
  try {
    const sql = await getSqlRunner();
    if (sql) { available = true; const row = await currentSelfie(sql, viewer.userId); selfie = row ? selfieView(row) : null; }
  } catch { /* Missing cloud migration: the page says so instead of a 500. */ }
  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={IDENTITY_SELFIE_PATH} />
      <main id="main" data-identity-selfie className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="max-w-[18ch] font-display text-[clamp(2rem,5vw,3.2rem)] leading-[0.95] font-black uppercase">{copy.title}</h1>
        <p className="mt-4 max-w-[46ch] text-body leading-relaxed opacity-70">{copy.intro}</p>
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <div className="border border-hairline p-5 sm:p-6">
            {available
              ? <SelfieUploader copy={copy} locale={locale} initial={selfie} startEditing={change} signinHref={`/auth/signin?next=${encodeURIComponent(herePath)}&locale=${locale}`} continueHref={next ?? templatesHref(locale, 'video')} continueLabel={next ? copy.continue : copy.browse} />
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
