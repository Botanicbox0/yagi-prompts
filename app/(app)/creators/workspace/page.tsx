import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatPostDate, interpolate } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { BUSINESS } from '@/lib/legal/documents';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { openMakerEnabled } from '@/lib/makers/self-activate';
import { loadCreatorWorkspace } from '@/lib/creator-platform/onboarding';
import { CREATOR_APPLY_PATH, CREATOR_WORKSPACE_PATH, creatorProgramHref } from '@/lib/creator-platform/links';
import { AppHeader } from '@/components/app/app-header';
import { FormatSubmitForm } from '@/components/creators/format-form';
import { OpenMakerCard } from '@/components/creators/open-maker-card';
import { EarningsTable, FormatList, formatDate, recipeEditorHref } from '@/components/creators/workspace';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { BUTTON, BUTTON_OUTLINE, PANEL } from '@/components/creators/styles';
import { MakerProfilePanel } from '@/components/creators/maker-profile';
import { McpConnect, WorksManager } from '@/components/creators/creative-studio';
import { loadMakerSettings } from '@/lib/makers/profile';
import { listMakerWorks } from '@/lib/makers/works';
import { listMakerTokens } from '@/lib/makers/tokens';
import { makerStats } from '@/lib/makers/stats';
import { requestSurface } from '@/lib/routing/request-surface';
import { siteUrl } from '@/lib/seo/site-url';
import { makerBlogOpen } from '@/lib/posts/flag';
import { listMakerPostsForWorkspace } from '@/lib/posts/service';
import { makerBlogPostHref, postEditorHref } from '@/lib/posts/links';

/**
 * `/creators/workspace` — one screen per state: not applied, in review, declined, approved, revoked.
 *
 * Open whenever invited suppliers are (`TWINGS_FORMAT_CREATORS`), so the submission form that left
 * the community hub stays reachable even before 0051 or public applications are enabled. Every row
 * comes from the explicit allowlist in `loadCreatorWorkspace`.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CreatorWorkspacePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [viewer, sql, locale, query] = await Promise.all([getViewer(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  if (!viewer.userId) redirect(signInHref(CREATOR_WORKSPACE_PATH, locale));
  const dict = getDictionary(locale), t = dict.creatorProgram;
  const [access, openMaker] = sql
    ? await Promise.all([platformAccess(sql), openMakerEnabled(sql)])
    : [null, false];
  const creatorsOpen = Boolean(access?.creators || openMaker);
  const data = sql && creatorsOpen ? await loadCreatorWorkspace(sql, viewer, access ?? { onboarding: false }) : null;
  // docs/PLATFORM-2.0.md §7.4: with 0059 the submission is the recipe editor; before it, the older form.
  // A failed probe means the older form, never a broken page.
  const recipeEditor = !!sql && !!data && await recipeSchemaReady(sql).catch(() => false);
  const shell = (state: string, children: React.ReactNode) => <div data-section data-theme="light" className="section min-h-screen">
    <AppHeader locale={locale} dict={dict} rest={CREATOR_WORKSPACE_PATH} />
    <main id="main" data-creator-workspace data-creator-state={state} className="band py-12 lg:py-16">
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{t.workspaceTitle}</h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed opacity-65">{t.workspaceLede}</p>
      {query.ok === 'applied' || query.ok === 'format' ? <p role="status" className="mt-8 max-w-2xl rounded-xl border border-hairline p-4 text-sm">{query.ok === 'applied' ? t.applied : t.formatSent}</p> : null}
      <div className="mt-10 max-w-3xl space-y-8">{children}</div>
    </main>
  </div>;
  if (!data || !access) return shell('unavailable', <p role="status">{t.unavailable}</p>);

  const { application, creator } = data;
  const note = (text: string | null) => text ? <div className="rounded-xl bg-on-surface/5 p-4"><p className="text-xs font-medium opacity-60">{t.noteFromStudio}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p></div> : null;
  const records = <>
    <section className={PANEL}><h2 className="text-xl font-semibold">{t.formatsHeading}</h2><FormatList formats={data.formats} dict={dict} locale={locale} canRevise={!!creator?.active && data.onboarding} recipeEditor={recipeEditor && !!creator?.active} /></section>
    <EarningsTable earnings={data.earnings} dict={dict} locale={locale} />
  </>;

  if (creator?.active) {
    const c = dict.community;
    // Only the strings the island renders cross the RSC boundary.
    const formCopy = { formatName: c.formatName, medium: c.medium, video: c.video, image: c.image, example: c.example, recipe: c.recipe, rights: c.rights, busy: c.busy, submitFormat: c.submitFormat, error: c.error, errors: c.errors, formatNeedsScript: c.formatNeedsScript };
    const revising = typeof query.revise === 'string' && data.onboarding ? data.formats.find((f) => f.id === query.revise && f.status === 'rejected') : undefined;
    const makerSettings = sql ? await loadMakerSettings(sql, viewer.userId) : null;
    // docs/PLATFORM-2.0.md §20: works, agent tokens and recipe opens exist once 0065 is applied.
    const extended = !!sql && !!makerSettings?.extended;
    const blogEnabled = makerBlogOpen();
    const [works, tokens, stats, posts] = await Promise.all([
      extended && sql ? listMakerWorks(sql, viewer.userId) : Promise.resolve([]),
      extended && sql ? listMakerTokens(sql, viewer.userId) : Promise.resolve([]),
      extended && sql ? makerStats(sql, viewer.userId) : Promise.resolve([]),
      blogEnabled && sql ? listMakerPostsForWorkspace(sql, viewer.userId) : Promise.resolve([]),
    ]);
    // The agent setup shows this host's address (a preview deploy shows its own); outside a request, the site's.
    const origin = extended ? (await requestSurface().then((surface) => surface.origin).catch(() => null)) ?? siteUrl() : siteUrl();
    const p = t;
    const b = dict.makerBlog;
    return shell('approved', <>
      <p className="text-sm opacity-70">{interpolate(t.approvedLine, { date: formatDate(creator.registeredAt, locale), contract: creator.contractVersion })}</p>
      {application?.status === 'approved' ? note(application.decisionNote) : null}
      <section id="submit" className={`scroll-mt-24 ${PANEL}`}>
        <h2 className="text-xl font-semibold">{revising ? interpolate(t.revisionHeading, { title: revising.title }) : t.submitHeading}</h2>
        <p className="text-sm leading-relaxed opacity-70">{dict.community.formatHint}</p>
        {revising ? <a href={CREATOR_WORKSPACE_PATH} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.cancelRevision}</a> : null}
        {recipeEditor
          ? <a href={recipeEditorHref('new', revising?.id)} data-recipe-new className={BUTTON}>{dict.makerRecipe.newCta} →</a>
          : <FormatSubmitForm key={revising?.id ?? 'new'} copy={formCopy} revision={revising && { id: revising.id, title: revising.title, medium: revising.medium, exampleUrl: revising.exampleUrl ?? '' }} />}
      </section>
      {blogEnabled && (
        <section id="blog" data-creative-blog className={`scroll-mt-24 ${PANEL}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{b.workspaceHeading}</h2>
              <p className="mt-1 text-sm leading-relaxed opacity-70">{b.workspaceLede}</p>
            </div>
            <a href={postEditorHref('new')} data-creative-blog-new className={BUTTON}>
              {b.workspaceNewCta}
            </a>
          </div>
          {!posts.length ? (
            <p className="text-sm opacity-65">{b.workspaceEmpty}</p>
          ) : (
            <ul className="space-y-3">
              {posts.map((post) => {
                const statusText =
                  post.status === 'published'
                    ? b.statusPublished
                    : post.status === 'hidden'
                      ? b.statusHidden
                      : b.statusDraft;
                const liveHref =
                  post.status === 'published' && makerSettings?.publicProfile && makerSettings?.handle
                    ? makerBlogPostHref(locale, makerSettings.handle, post.slug)
                    : null;
                return (
                  <li
                    key={post.id}
                    data-creative-blog-row={post.id}
                    data-status={post.status}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-base font-semibold">{post.title}</h3>
                        <span className="inline-flex min-h-6 items-center rounded-full border border-hairline px-2.5 text-xs">
                          {statusText}
                        </span>
                      </div>
                      <p className="text-xs opacity-60 tabular-nums">
                        {formatPostDate(post.publishedAt ?? post.updatedAt, locale)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={postEditorHref(post.id)} className={BUTTON_OUTLINE}>
                        {b.workspaceEdit}
                      </a>
                      {liveHref ? (
                        <a
                          href={liveHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4"
                        >
                          {b.workspaceViewLive} ↗
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      <MakerProfilePanel settings={makerSettings} dict={dict} locale={locale} saved={query.ok === 'profile'} error={typeof query.profile === 'string' ? query.profile : null} />
      {extended && <>
        <section id="works" data-creative-works-panel className={`scroll-mt-24 ${PANEL}`}>
          <h2 className="text-xl font-semibold">{p.works.heading}</h2>
          <p className="text-sm leading-relaxed opacity-70">{p.works.lede}</p>
          <WorksManager initial={works.map((work) => ({ id: work.id, kind: work.kind, title: work.title, caption: work.caption, linkUrl: work.linkUrl }))} copy={p.works} />
        </section>
        <section id="stats" data-creative-stats className={`scroll-mt-24 ${PANEL}`}>
          <h2 className="text-xl font-semibold">{p.stats.heading}</h2>
          <p className="text-sm leading-relaxed opacity-70">{p.stats.lede}</p>
          {stats.length === 0 ? <p className="text-sm opacity-60">{p.stats.empty}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-xs opacity-60"><tr><th className="py-2 font-medium">{p.stats.colTemplate}</th><th className="py-2 text-right font-medium">{p.stats.colMembers}</th><th className="py-2 text-right font-medium">{p.stats.col7d}</th><th className="py-2 text-right font-medium">{p.stats.colOpens}</th></tr></thead>
                <tbody className="divide-y divide-hairline">{stats.map((row) => (
                  <tr key={row.slug}><td className="py-2.5"><a href={`/${locale}/t/${row.slug}`} className="underline-offset-4 hover:underline">{row.title}</a></td><td className="py-2.5 text-right font-mono">{row.members}</td><td className="py-2.5 text-right font-mono">{row.members7d}</td><td className="py-2.5 text-right font-mono">{row.opens}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section id="connect" data-creative-connect className={`scroll-mt-24 ${PANEL}`}>
          <h2 className="text-xl font-semibold">{p.connect.heading}</h2>
          <p className="text-sm leading-relaxed opacity-70">{p.connect.lede}</p>
          <McpConnect initial={tokens} endpoint={`${origin}/api/mcp`} locale={locale} copy={p.connect} />
        </section>
      </>}
      {records}
    </>);
  }
  // A revoked supplier may apply again: show that application's state next to their read-only records.
  // A decline from before the supplier row existed belongs to an earlier history, not this one.
  const reviewing = application?.status === 'submitted' ? application : null;
  const declined = application?.status === 'declined' && (!creator || new Date(application.createdAt) > new Date(creator.registeredAt)) ? application : null;
  const reviewingCard = reviewing && <section data-creator-application-state="submitted" className={PANEL}>
    <h2 className="text-xl font-semibold">{t.reviewingTitle}</h2>
    <p className="text-sm leading-relaxed opacity-70">{t.reviewingBody}</p>
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="opacity-60">{t.fieldName}</dt><dd className="break-words">{reviewing.displayName}</dd>
      <dt className="opacity-60">{t.fields.portfolioUrl}</dt><dd className="break-all">{reviewing.portfolioUrl}</dd>
      <dt className="opacity-60">{t.fields.samples}</dt><dd>{interpolate(t.summary, { samples: reviewing.sampleCount, mediums: reviewing.mediums.map((m) => dict.community[m]).join(' · ') })}</dd>
    </dl>
    <p className="text-xs opacity-60">{interpolate(t.sentOn, { date: formatDate(reviewing.createdAt, locale) })}</p>
  </section>;
  const declinedCard = declined && <section data-creator-application-state="declined" className={PANEL}>
    <h2 className="text-xl font-semibold">{t.declinedTitle}</h2>
    {note(declined.decisionNote)}
    {declined.decidedAt ? <p className="text-xs opacity-60">{formatDate(declined.decidedAt, locale)}</p> : null}
    {access.applications ? <><a href={CREATOR_APPLY_PATH} className={BUTTON}>{t.reapply} →</a><p className="text-xs opacity-60">{t.reapplyLimit}</p></> : null}
  </section>;

  if (creator) return shell('revoked', <>
    <section className={PANEL}>
      <h2 className="text-xl font-semibold">{t.revokedTitle}</h2>
      <p className="text-sm leading-relaxed opacity-70">{interpolate(t.revokedBody, { email: BUSINESS.email })}</p>
      {access.applications && !reviewing && !declined ? <a href={CREATOR_APPLY_PATH} className={BUTTON}>{t.reapply} →</a> : null}
    </section>
    {reviewingCard}{declinedCard}
    {records}
  </>);
  if (reviewingCard) return shell('submitted', reviewingCard);
  if (openMaker) {
    return shell('open_maker', <>
      {declinedCard}
      <OpenMakerCard locale={locale} workspaceHref={CREATOR_WORKSPACE_PATH} copy={t.openMaker} />
      {data.formats.length > 0 ? records : null}
    </>);
  }
  if (declinedCard) return shell('declined', declinedCard);
  return shell('none', access.applications ? <section className={PANEL}>
    <p className="text-base leading-relaxed">{t.notApplied}</p>
    <div className="flex flex-wrap items-center gap-4"><a href={CREATOR_APPLY_PATH} className={BUTTON}>{t.cta} →</a><a href={creatorProgramHref(locale)} className={BUTTON_OUTLINE}>{t.programLink}</a></div>
  </section> : <p role="status">{t.unavailable}</p>);
}
