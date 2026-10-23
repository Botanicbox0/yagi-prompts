import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { signInHref } from '@/lib/billing/links';
import { BUSINESS } from '@/lib/legal/documents';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { loadCreatorWorkspace } from '@/lib/creator-platform/onboarding';
import { CREATOR_APPLY_PATH, CREATOR_WORKSPACE_PATH, creatorProgramHref } from '@/lib/creator-platform/links';
import { AppHeader } from '@/components/app/app-header';
import { FormatSubmitForm } from '@/components/creators/format-form';
import { EarningsTable, FormatList, formatDate } from '@/components/creators/workspace';
import { BUTTON, BUTTON_OUTLINE, PANEL } from '@/components/creators/styles';
import { MakerProfilePanel } from '@/components/creators/maker-profile';
import { loadMakerSettings } from '@/lib/makers/profile';

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
  const access = sql ? await platformAccess(sql) : null;
  const data = sql && access?.creators ? await loadCreatorWorkspace(sql, viewer, access) : null;
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
    <section className={PANEL}><h2 className="text-xl font-semibold">{t.formatsHeading}</h2><FormatList formats={data.formats} dict={dict} locale={locale} canRevise={!!creator?.active && data.onboarding} /></section>
    <EarningsTable earnings={data.earnings} dict={dict} locale={locale} />
  </>;

  if (creator?.active) {
    const c = dict.community;
    // Only the strings the island renders cross the RSC boundary.
    const formCopy = { formatName: c.formatName, medium: c.medium, video: c.video, image: c.image, example: c.example, recipe: c.recipe, rights: c.rights, busy: c.busy, submitFormat: c.submitFormat, error: c.error, errors: c.errors, formatNeedsScript: c.formatNeedsScript };
    const revising = typeof query.revise === 'string' && data.onboarding ? data.formats.find((f) => f.id === query.revise && f.status === 'rejected') : undefined;
    const makerSettings = sql ? await loadMakerSettings(sql, viewer.userId) : null;
    return shell('approved', <>
      <p className="text-sm opacity-70">{interpolate(t.approvedLine, { date: formatDate(creator.registeredAt, locale), contract: creator.contractVersion })}</p>
      {application?.status === 'approved' ? note(application.decisionNote) : null}
      <section id="submit" className={`scroll-mt-24 ${PANEL}`}>
        <h2 className="text-xl font-semibold">{revising ? interpolate(t.revisionHeading, { title: revising.title }) : t.submitHeading}</h2>
        <p className="text-sm leading-relaxed opacity-70">{dict.community.formatHint}</p>
        {revising ? <a href={CREATOR_WORKSPACE_PATH} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t.cancelRevision}</a> : null}
        <FormatSubmitForm key={revising?.id ?? 'new'} copy={formCopy} revision={revising && { id: revising.id, title: revising.title, medium: revising.medium, exampleUrl: revising.exampleUrl }} />
      </section>
      <MakerProfilePanel settings={makerSettings} dict={dict} locale={locale} saved={query.ok === 'profile'} error={typeof query.profile === 'string' ? query.profile : null} />
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
  if (declinedCard) return shell('declined', declinedCard);
  return shell('none', access.applications ? <section className={PANEL}>
    <p className="text-base leading-relaxed">{t.notApplied}</p>
    <div className="flex flex-wrap items-center gap-4"><a href={CREATOR_APPLY_PATH} className={BUTTON}>{t.cta} →</a><a href={creatorProgramHref(locale)} className={BUTTON_OUTLINE}>{t.programLink}</a></div>
  </section> : <p role="status">{t.unavailable}</p>);
}
