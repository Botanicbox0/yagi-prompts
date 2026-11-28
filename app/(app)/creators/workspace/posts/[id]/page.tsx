import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/app-header';
import { promptLabels } from '@/components/prompts/labels';
import { getViewer } from '@/lib/auth/viewer';
import { signInHref } from '@/lib/billing/links';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { getSqlRunner } from '@/lib/db/connect';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { creativeGate } from '@/lib/makers/access';
import { loadMakerSettings } from '@/lib/makers/profile';
import { listMakerWorks } from '@/lib/makers/works';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { makerBlogOpen } from '@/lib/posts/flag';
import { postEditorHref } from '@/lib/posts/links';
import { postsReady, UUID_PATTERN } from '@/lib/posts/repo';
import { loadMakerPost, loadMakerTemplatesForImport } from '@/lib/posts/service';
import { PostEditor, type PublishableTemplateOption } from '@/components/posts/post-editor';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  if (!makerBlogOpen()) return { robots: { index: false, follow: false } };
  const { id } = await params;
  const dict = getDictionary(await getLocaleFromHeaders());
  return {
    title: id === 'new' ? dict.makerBlog.editorNewTitle : dict.makerBlog.editorEditTitle,
    robots: { index: false, follow: false },
  };
}

export default async function MakerPostEditorPage({ params }: RouteParams) {
  if (!makerBlogOpen()) notFound();
  const { id } = await params;
  const isNew = id === 'new';
  if (!isNew && !UUID_PATTERN.test(id)) notFound();

  const locale = await getLocaleFromHeaders();
  const dict = getDictionary(locale);
  const viewer = await getViewer();
  const rest = postEditorHref(id);

  if (!viewer.userId) {
    redirect(signInHref(rest, locale));
  }

  const sql = await getSqlRunner();
  const gate = sql ? await creativeGate(sql, viewer.userId) : { ok: false as const, code: 'unavailable' as const };
  const ready = sql ? await postsReady(sql) : false;

  if (!sql || !gate.ok || !ready) {
    const errorCode = !gate.ok ? gate.code : 'unavailable';
    return (
      <>
        <AppHeader locale={locale} dict={dict} rest={rest} />
        <main
          id="main"
          data-post-editor-unavailable
          className="mx-auto w-full max-w-[calc(var(--container-audience)+2*var(--spacing-gutter))] px-[var(--spacing-gutter)] py-10 lg:py-14"
        >
          <div className="space-y-4 rounded-2xl border border-hairline p-6">
            <h1 className="text-xl font-semibold">{dict.makerBlog.editorNewTitle}</h1>
            <p className="text-sm text-[#52525B]">{dict.makerBlog.errors[errorCode]}</p>
            <a
              href={CREATOR_WORKSPACE_PATH}
              className="inline-flex min-h-11 items-center rounded-full border border-current px-5 text-sm font-medium"
            >
              {dict.makerBlog.editorBack}
            </a>
          </div>
        </main>
      </>
    );
  }

  const [post, works, settings, catalog, importableTemplates] = await Promise.all([
    isNew ? Promise.resolve(null) : loadMakerPost(sql, viewer.userId, id),
    listMakerWorks(sql, viewer.userId),
    loadMakerSettings(sql, viewer.userId),
    getPromptCatalog(),
    loadMakerTemplatesForImport(sql, viewer.userId, {
      selfie: dict.makerRecipe.selfieLabel,
      reference: dict.makerRecipe.referenceLabel,
      step: dict.makerRecipe.stepResultLabel,
      pet: dict.cast.photo.petTitle,
      partner: dict.cast.photo.partnerTitle,
    }),
  ]);

  if (!isNew && !post) {
    notFound();
  }

  const handle = settings?.handle ?? null;
  const allCards = [...catalog.video, ...catalog.image];
  const sortedCards = [...allCards].sort((a, b) => {
    const aOwn = handle && a.authorHandle === handle ? 0 : 1;
    const bOwn = handle && b.authorHandle === handle ? 0 : 1;
    return aOwn - bOwn;
  });
  const publishedTemplates: PublishableTemplateOption[] = sortedCards.map((card) => ({
    slug: card.slug,
    title: locale === 'ko' ? card.titleKo ?? card.title : card.title,
    card,
  }));

  return (
    <>
      <AppHeader locale={locale} dict={dict} rest={rest} />
      <main
        id="main"
        data-post-editor-page
        className="mx-auto w-full max-w-[calc(var(--container-audience)+2*var(--spacing-gutter))] px-[var(--spacing-gutter)] py-10 lg:py-14"
      >
        <PostEditor
          locale={locale}
          handle={handle}
          publicProfile={settings?.publicProfile === true}
          worksAvailable={settings?.extended === true}
          initialPost={post}
          works={works}
          importableTemplates={importableTemplates}
          publishedTemplates={publishedTemplates}
          promptLabels={promptLabels(dict)}
          blogCopy={dict.makerBlog}
          recipeCopy={dict.makerRecipe}
          backHref={`${CREATOR_WORKSPACE_PATH}#blog`}
        />
      </main>
    </>
  );
}
