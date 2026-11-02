import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { signInHref } from '@/lib/billing/links';
import { IDENTITY_SELFIE_PATH } from '@/lib/identity/links';
import { currentSelfie } from '@/lib/identity/selfie-service';
import { engineLabel, IMAGE_ASPECTS, isVideoEngine, VIDEO_ASPECTS } from '@/lib/images/engines';
import { videoEngineSpec } from '@/lib/video/models';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { approvedCreator, companyCreator } from '@/lib/creator-platform/service';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { loadMakerDraft, MAKER_TEST_RENDERS } from '@/lib/recipes/maker';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { MAKER_ENGINE_IDS } from '@/lib/recipes/schema';
import { AppHeader } from '@/components/app/app-header';
import { RecipeEditor, type EngineOption } from '@/components/recipes/recipe-editor';
import { selfPublishOpen } from '@/lib/recipes/self-publish';

/**
 * `/creators/workspace/formats/{new|id}` — the maker recipe editor (docs/PLATFORM-2.0.md §7.4).
 * Desktop first: a left/right split from `lg`. Same gates as the workspace's submission form —
 * signed in, an approved supplier, `TWINGS_FORMAT_CREATORS`, and 0059 — plus ownership of an
 * existing format. `new` gets a fresh server-made id; nothing is written until the maker saves.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocaleFromHeaders());
  return { title: dict.makerRecipe.metaTitle, robots: { index: false, follow: false } };
}

export default async function RecipeEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query, viewer, sql, locale] = await Promise.all([params, searchParams, getViewer(), getSqlRunner(), getLocaleFromHeaders()]);
  const path = `${CREATOR_WORKSPACE_PATH}/formats/${id}`;
  if (!viewer.userId) redirect(signInHref(path, locale));
  const dict = getDictionary(locale), t = dict.makerRecipe;
  const access = sql ? await platformAccess(sql) : null;
  const open = !!sql && !!access?.creators && await recipeSchemaReady(sql) && await approvedCreator(sql, viewer.userId);
  const shell = (state: string, children: React.ReactNode) => <div data-section data-theme="light" className="section min-h-screen">
    <AppHeader locale={locale} dict={dict} rest={path} />
    <main id="main" data-recipe-editor-page data-recipe-editor-state={state} className="band py-10 lg:py-14">
      <a href={CREATOR_WORKSPACE_PATH} className="inline-flex min-h-11 items-center text-sm opacity-70">← {t.back}</a>
      <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{id === 'new' ? t.metaTitle : t.editTitle}</h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed opacity-65">{t.lede}</p>
      <p className="mt-2 text-xs opacity-55 lg:hidden">{t.desktopHint}</p>
      <div className="mt-8">{children}</div>
    </main>
  </div>;
  if (!open || !sql || !access) return shell('unavailable', <p role="status">{t.errors.not_open}</p>);

  const draft = id === 'new' ? null : await loadMakerDraft(sql, viewer, id, { creators: access.creators });
  if (id !== 'new' && !draft) notFound();
  const formatId = id === 'new' ? randomUUID() : id;
  const revisionOf = typeof query.revise === 'string' && /^[0-9a-f-]{36}$/.test(query.revise) ? query.revise : undefined;
  const engines: EngineOption[] = MAKER_ENGINE_IDS.map((engine) => isVideoEngine(engine)
    ? (({ minDurationSeconds, maxDurationSeconds, resolutions }) => ({ id: engine, label: engineLabel(engine), kind: 'video' as const, minDuration: minDurationSeconds, maxDuration: maxDurationSeconds, resolutions: resolutions.filter((r): r is '720p' | '1080p' => r === '720p' || r === '1080p') }))(videoEngineSpec(engine))
    : { id: engine, label: engineLabel(engine), kind: 'image' });
  const [hasSelfie, company] = await Promise.all([currentSelfie(sql, viewer.userId).then(Boolean), companyCreator(sql, viewer.userId)]);
  return shell(draft?.status ?? 'new', <RecipeEditor
    copy={t}
    formatId={formatId}
    draft={draft && { status: draft.status, title: draft.title, titleKo: draft.titleKo, recipe: draft.recipe, exampleUrl: draft.exampleUrl, disclosure: draft.disclosure, presentation: draft.presentation, royaltyKrw: draft.royaltyKrw, testRendersUsed: draft.testRendersUsed, files: draft.files.map((f) => ({ id: f.id, role: f.role, kind: f.kind, mime: f.mime })), tests: draft.tests, revisionOf: draft.revisionOf }}
    engines={engines}
    aspects={{ image: [...IMAGE_ASPECTS], video: [...VIDEO_ASPECTS] }}
    hasSelfie={hasSelfie}
    selfieHref={IDENTITY_SELFIE_PATH}
    workspaceHref={CREATOR_WORKSPACE_PATH}
    testLimit={MAKER_TEST_RENDERS}
    selfPublish={selfPublishOpen()}
    company={company}
    revisionOf={revisionOf}
    locale={locale}
  />);
}
