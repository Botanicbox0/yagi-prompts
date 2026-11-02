import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { signInHref } from '@/lib/billing/links';
import { templatesHref } from '@/lib/prompts/links';
import { listMyRenders } from '@/lib/renders/service';
import { RENDERS_PATH } from '@/lib/renders/share';
import { AppHeader } from '@/components/app/app-header';
import { RenderList } from '@/components/renders/render-list';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * `/renders` — everything the signed-in reader has made (docs/TEMPLATES-IA.md §8: "영구 보관
 * '내 작품'"). The 3-day link in the email is a convenience; this is the record.
 */
export const dynamic = 'force-dynamic';

export default async function MyRendersPage() {
  const [locale, viewer] = await Promise.all([getLocaleFromHeaders(), getViewer()]);
  const dict = getDictionary(locale);
  const r = dict.renders;
  const sql = await getSqlRunner();
  const items = viewer.userId === null || sql === null ? [] : await listMyRenders(sql, viewer.userId);

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <AppHeader locale={locale} dict={dict} rest={RENDERS_PATH} />

      <main id="main" className="band py-16 lg:py-20">
        <p className="text-accent font-label text-eyebrow uppercase">{r.eyebrow}</p>
        <h1 className="mt-4 font-display text-title font-black uppercase">{r.title}</h1>
        <p className="mt-6 max-w-detail text-body opacity-70">{r.lede}</p>

        {viewer.userId === null ? (
          <a href={signInHref(RENDERS_PATH, locale)} className="mt-10 inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
            <TextSwap>{dict.auth.signIn} →</TextSwap>
          </a>
        ) : items.length === 0 ? (
          <div data-renders-empty className="mt-10 max-w-detail border-t border-hairline pt-8">
            <p className="text-body opacity-70">{r.empty}</p>
            <a href={templatesHref(locale, 'video')} className="text-accent mt-6 inline-block font-label text-label uppercase">
              <TextSwap>{r.browse} →</TextSwap>
            </a>
          </div>
        ) : (
          <div className="mt-10">
            <RenderList items={items} locale={locale} dict={dict} />
          </div>
        )}
      </main>
    </div>
  );
}
