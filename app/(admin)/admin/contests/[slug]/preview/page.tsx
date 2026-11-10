import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/viewer';
import { getContestPreview } from '@/lib/contests/facade';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { ADMIN_CONTESTS_PATH, contestSubmitPath } from '@/lib/contests/links';
import { publicHref, requestSurface } from '@/lib/routing/request-surface';
import {
  ContestBody,
  ContestHeader,
  ContestMeta,
  ContestPrize,
} from '@/components/contests/detail';
import { contestLabels } from '@/components/contests/labels';
import { AdminBrand, BUTTON } from '@/components/admin/chrome';

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
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
  const [{ slug }, locale] = await Promise.all([params, getLocaleFromHeaders()]);
  const dict = getDictionary(locale);
  const result = await getContestPreview(slug);
  if (result.status !== 'ok') notFound();

  const { contest } = result;
  const { admin } = await requestSurface();
  // Existing preview media includes published-only consumer URLs. Keep those public rather
  // than widening the admin host's API allowlist; private preview assets keep their own gateway.
  for (const media of [contest.poster, contest.video, contest.hostLogo]) {
    if (media?.src.startsWith('/')) media.src = publicHref(media.src, admin);
  }
  const labels = contestLabels(dict);

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell flex-wrap items-center justify-between gap-4 px-gutter py-4">
          <AdminBrand dict={dict.admin} />
          <a href={ADMIN_CONTESTS_PATH} className={BUTTON}>
            {dict.admin.editorBack}
          </a>
        </div>
      </header>

      <main id="main" className="pb-24">
        <ContestHeader contest={contest} locale={locale} labels={labels} />
        <div className="band">
          <ContestMeta contest={contest} locale={locale} labels={labels} />
        </div>
        <ContestPrize contest={contest} locale={locale} labels={labels} />
        <div className="band">
          <ContestBody contest={contest} locale={locale} labels={labels} submitHref={publicHref(contestSubmitPath(contest.slug), admin)} />
        </div>
      </main>
    </div>
  );
}
