import { requireAdmin } from '@/lib/auth/viewer';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { interpolate } from '@/lib/i18n/format';
import { USE_CASE_MAX, USE_CASE_MIN } from '@/lib/prompts/schemas';
import { ADMIN_PROMPTS_PATH, ADMIN_PROMPT_NEW_PATH, ADMIN_PROMPT_NEW_SET_PATH } from '@/lib/prompts/links';
import { lockRefusalCopy } from '@/lib/template-director/locks';
import { TEMPLATE_STYLING_DEFAULT_BLOCK } from '@/lib/template-director/styling';
import { AdminShell, BUTTON_PRIMARY, OpForm, OutcomeBanner, Panel } from '@/components/admin/chrome';
import { AdminPageHeader } from '@/components/admin/patterns';
import { PromptFields } from '@/components/admin/prompt-fields';
import { getSqlRunner } from '@/lib/db/connect';
import { promptLookSchemaReady } from '@/lib/prompts/repo';
import { personalMagi2Open } from '@/lib/flags';
import { PromptCreateFeedback } from '@/components/admin/prompt-create-feedback';

/**
 * `/admin/prompts/new` — one form, nothing else (2026-08-15).
 *
 * This page exists because of where the form used to be: at the bottom of the board, under every
 * published prompt's inline editor. The founder's complaint was literally the scroll. A dedicated
 * route makes "add a prompt" a link in the header, and makes the form the only thing on the screen
 * — which is also the state in which a long shot-by-shot brief is actually pleasant to paste.
 *
 * SUCCESS lands on the board (the operation's own `to`), where the new card now is, with the
 * outcome banner over it. `back` is this page: a refused submission (a short title, a missing
 * poster) returns HERE with the reason, not to the board with the reason and no form. The
 * fields also carry `required`/`minLength`, so the browser refuses the obvious cases before a
 * 15,000-character brief is posted and lost (UX audit, 2026-09-03).
 *
 * The reason has to be READ here, too (audit 2026-09-25): without the banner a refused upload
 * (`err=upload`, `err=invalid` for a missing poster) came back as a blank form and nothing else.
 *
 * Discoverability pass (2026-09-25): the two refusals a first-time admin actually meets — no use
 * case, no poster — are named in plain words above the form, and the steps, the required pieces and
 * the fact that pressing the button publishes immediately are stated before the first field.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

export default async function AdminPromptNewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
  const [locale, params, sql] = await Promise.all([getLocaleFromHeaders(), searchParams, getSqlRunner()]);
  // docs/PERSONAL-STUDIO.md §3.4.10 — the style select, once 0190 is applied; a new template starts "for anyone".
  const lookReady = sql !== null && (await promptLookSchemaReady(sql).catch(() => false));
  const dict = getDictionary(locale);
  const a = dict.admin;
  const caps = { min: USE_CASE_MIN, max: USE_CASE_MAX };
  const err = one(params, 'err');
  const detail = one(params, 'detail') ?? '';
  // The operation's detail is `field: reason`; only the two fields a new admin trips on get prose.
  const refused =
    err === 'invalid' && detail.startsWith('useCase')
      ? { field: 'useCase', text: interpolate(a.refusedUseCase, caps) }
      : err === 'invalid' && detail.startsWith('poster')
        ? { field: 'poster', text: a.refusedPoster }
        : null;
  const steps = [
    [a.authorStep1Title, interpolate(a.authorStep1Body, caps)],
    [a.authorStep2Title, a.authorStep2Body],
    [a.authorStep3Title, a.authorStep3Body],
  ] as const;

  return (
    <AdminShell dict={a} locale={locale} active="prompts">
      <AdminPageHeader
        back={{ href: ADMIN_PROMPTS_PATH, label: a.backToPrompts }}
        title={a.authorHeading}
        lede={a.authorLede}
        actions={
          <a href={ADMIN_PROMPT_NEW_SET_PATH} data-image-set-link className="admin-btn">
            {a.setLink} →
          </a>
        }
      />
      <p className="mt-3 text-[13px] opacity-75">
        {a.setLinkHint}
      </p>

      <OutcomeBanner
        dict={a}
        {...(err ? { err } : {})}
        {...(detail ? { detail } : {})}
      />
      {refused && (
        <p data-refused-field={refused.field} className="mt-3 rounded-[10px] border border-accent px-3.5 py-2.5 text-[13px] text-accent">
          {refused.text}
        </p>
      )}
      {/* docs/PERSONAL-STUDIO.md §3.4.9, rule 3: a person template without a styling block (no-JS answer). */}
      {err === 'stylingRequired' && (
        <div data-refused-field="promptText" data-styling-required className="mt-3 rounded-[10px] border border-accent px-3.5 py-2.5 text-[13px]">
          <p className="text-accent">{a.stylingRequiredExample}</p>
          <pre className="mt-2 overflow-auto font-mono text-[12px] whitespace-pre-wrap select-all">{TEMPLATE_STYLING_DEFAULT_BLOCK}</pre>
        </div>
      )}

      <section data-template-steps className="admin-spec-card">
        <div className="admin-spec-head">
          <h2>{a.authorStepsHeading}</h2>
        </div>
        <ol className="admin-card-grid">
          {steps.map(([title, body], index) => (
            <li key={title} className="admin-subcard">
              <h3>
                {index + 1}. {title}
              </h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <p data-publish-notice className="mt-3 border-t border-hairline pt-3 text-[13px] opacity-80">
          {a.authorPublishNotice}
        </p>
      </section>

      <Panel title={a.authorFormTitle}>
        <PromptCreateFeedback labels={{
          useCase: interpolate(a.refusedUseCase, caps), poster: a.refusedPoster,
          invalid: a.errInvalid, upload: a.mediaUploadFailed, session: a.mediaUploadSession,
          uncertain: a.promptPublishUncertain, retained: a.promptInputsRetained, publishing: a.promptPublishing,
          draftRestored: a.promptDraftRestored, draftDiscard: a.promptDraftDiscard, draftSavedAt: a.promptDraftSavedAt,
          lockCopy: lockRefusalCopy(a), lengthCopy: a.promptLengthRefusal, lengthCopyForEngine: a.promptLengthRefusalForEngine,
          stylingRequired: a.errStylingRequired, stylingExample: TEMPLATE_STYLING_DEFAULT_BLOCK,
        }}>
        <OpForm op="prompt.create" back={ADMIN_PROMPT_NEW_PATH} className="flex flex-col gap-4">
          <PromptFields row={null} dict={dict} {...(lookReady ? { look: 'any' as const } : {})} magi2Open={personalMagi2Open()} />
          <div>
            <button type="submit" data-template-publish className={BUTTON_PRIMARY}>
              {a.publishPrompt}
            </button>
          </div>
        </OpForm>
        </PromptCreateFeedback>
      </Panel>
    </AdminShell>
  );
}
