import { notFound } from 'next/navigation';
import { getContestPreview } from '@/lib/contests/facade';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { ADMIN_CONTESTS_PATH } from '@/lib/contests/links';
import {
  ContestCta,
  ContestEntries,
  ContestHeader,
  ContestMeta,
  ContestPrize,
  ContestRules,
  ContestWinners,
} from '@/components/contests/detail';
import { contestLabels } from '@/components/contests/labels';
import { BUTTON } from '@/components/admin/chrome';

/**
 * `/admin/contests/[slug]/preview` — PLAN §14.2: "draft = admin preview path".
 *
 * The public detail route is published-only for EVERYONE, admins included, because §14.1 makes
 * publishing the founder's deliberate act and a draft anyone could read by guessing a URL would
 * defeat that. So the draft renders here instead, inside the `(admin)` route group — which means
 * the `(admin)` layout's `requireAdmin()` → **404** is the whole gate, exactly the way
 * `/admin/p/[id]/preview` works for playbooks.
 *
 * It composes the SAME section components the public page composes. That is the point: a preview
 * built from a second set of components is a preview of something else. The only difference is the
 * chrome around it (a bar back to the editor) and the `preview` flag the shaper stamps, which the
 * header turns into the "not published" badge.
 */
export const dynamic = 'force-dynamic';

export default async function AdminContestPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, locale] = await Promise.all([params, getLocaleFromHeaders()]);
  const dict = getDictionary(locale);
  const result = await getContestPreview(slug);
  if (result.status !== 'ok') notFound();

  const { contest } = result;
  const labels = contestLabels(dict);

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-4 px-gutter py-4">
          <span className="font-display text-[1.05rem] leading-none font-black uppercase">
            {dict.admin.brand}
          </span>
          <a href={ADMIN_CONTESTS_PATH} className={BUTTON}>
            {dict.admin.editorBack}
          </a>
        </div>
      </header>

      <main id="main" className="pb-24">
        <ContestHeader contest={contest} locale={locale} labels={labels} />
        <div className="band">
          <ContestMeta contest={contest} locale={locale} labels={labels} />
          <ContestPrize contest={contest} locale={locale} labels={labels} />
          <ContestCta contest={contest} locale={locale} labels={labels} />
          <ContestRules contest={contest} locale={locale} labels={labels} />
          <ContestWinners contest={contest} labels={labels} />
          <ContestEntries contest={contest} labels={labels} />
        </div>
      </main>
    </div>
  );
}
