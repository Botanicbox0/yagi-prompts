import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { signInHref } from '@/lib/billing/links';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { isApplicationField, loadCreatorWorkspace } from '@/lib/creator-platform/onboarding';
import { loadCreatorProfile } from '@/lib/creators/profile';
import { CREATOR_APPLY_PATH, CREATOR_WORKSPACE_PATH, creatorProgramHref } from '@/lib/creator-platform/links';
import { AppHeader } from '@/components/app/app-header';
import { CreatorApplicationForm } from '@/components/creators/application-form';
import { BUTTON_OUTLINE, PANEL } from '@/components/creators/styles';

/**
 * `/creators/apply` — the format creator application (docs/CREATOR-PLATFORM.md).
 * Login-gated at the edge; the page and the server action both re-resolve the gates.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CreatorApplyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [viewer, sql, locale, query] = await Promise.all([getViewer(), getSqlRunner(), getLocaleFromHeaders(), searchParams]);
  if (!viewer.userId) redirect(signInHref(CREATOR_APPLY_PATH, locale));
  const dict = getDictionary(locale), t = dict.creatorProgram;
  const access = sql ? await platformAccess(sql) : null;
  const workspace = sql && access?.applications ? await loadCreatorWorkspace(sql, viewer, access) : null;
  if (workspace?.creator?.active) redirect(CREATOR_WORKSPACE_PATH);
  const profile = workspace && sql ? await loadCreatorProfile(sql, viewer.userId) : null;
  const pending = workspace?.application?.status === 'submitted';
  // The no-JS fallback returns here with a known code and field name only; anything else is ignored.
  const code = typeof query.err === 'string' && query.err in t.errors ? query.err : null;
  const initialError = code ? { code, ...(code === 'invalid' && isApplicationField(query.field) ? { field: query.field } : {}) } : null;
  return <div data-section data-theme="light" className="section min-h-screen">
    <AppHeader locale={locale} dict={dict} rest={CREATOR_APPLY_PATH} />
    <main id="main" data-creator-apply className="band py-12 lg:py-16">
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{t.applyTitle}</h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed opacity-65">{t.applyLede}</p>
      {!workspace ? <p role="status" data-creator-unavailable className="mt-10">{t.unavailable}</p>
        : viewer.isAdmin ? <p role="status" className="mt-10">{t.errors.forbidden}</p>
        : pending ? <section data-creator-state="submitted" className={`mt-10 max-w-2xl ${PANEL}`}>
            <h2 className="text-xl font-semibold">{t.alreadyOpen}</h2>
            <a href={CREATOR_WORKSPACE_PATH} className={BUTTON_OUTLINE}>{t.workspaceTitle} →</a>
          </section>
        : <>
            {workspace.application?.status === 'declined' ? <p className="mt-6 max-w-2xl text-sm opacity-65">{t.reapplyLimit}</p> : null}
            <CreatorApplicationForm copy={{ fieldName: t.fieldName, fieldNameHint: t.fieldNameHint, fieldPortfolio: t.fieldPortfolio, fieldPortfolioHint: t.fieldPortfolioHint, fieldSamples: t.fieldSamples, fieldSamplesHint: t.fieldSamplesHint, fieldMediums: t.fieldMediums, fieldTools: t.fieldTools, fieldMessage: t.fieldMessage, fieldMessageHint: t.fieldMessageHint, rights: t.rights, program: t.program, programLink: t.programLink, submit: t.submit, busy: t.busy, errors: t.errors, fields: t.fields }} media={{ image: dict.community.image, video: dict.community.video }} displayName={profile?.displayName ?? ''} programHref={creatorProgramHref(locale)} requestId={randomUUID()} initialError={initialError} />
          </>}
    </main>
  </div>;
}
