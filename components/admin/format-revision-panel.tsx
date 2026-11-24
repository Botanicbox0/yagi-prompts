import { BUTTON_PRIMARY, Field, INPUT, OpForm, Panel } from '@/components/admin/chrome';
import { FormatRevisionStepField } from '@/components/admin/format-revision-step-field';
import { readRevisionRefusal, type FormatRevisionView } from '@/lib/creator-platform/format-revision';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { formatDate, interpolate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { MAX_STEP_PROMPT_CHARS } from '@/lib/recipes/schema';

/**
 * docs/CREATOR-PLATFORM.md "Recipe revisions of the studio's own formats (2026-11-25)" — the admin template page's
 * "레시피 문구 개정" panel. The page renders it ONLY for an accepted format owned by the company-payout account
 * (`loadFormatRevisionView` answers null otherwise), so a creative's format never shows it.
 *
 *  - the prompts an order compiles (the result steps), raw — `{{selfie}}` tokens and all — one textarea each, with a
 *    count against the step limit;
 *  - the reason (10+ characters, kept in the audit and the revision record);
 *  - the SHA-256 of the recipe this page showed, posted back hidden: a recipe that changed since is refused;
 *  - the last three revisions (date, reason, total step-prompt characters before → after);
 *  - on a database without 0192: the sentence that says so, and no form.
 *
 * Admin-only furniture; no buyer ever sees any of it.
 */
export function FormatRevisionPanel({
  op,
  templateId,
  view,
  dict,
  locale,
  back,
  detail,
}: {
  /** Named by the page, like the other template panels' operations. */
  op: 'format.reviseRecipe';
  templateId: string;
  view: FormatRevisionView;
  dict: Dictionary;
  locale: Locale;
  back: string;
  /** The outcome detail in the address (`?detail=`), read back when it is this operation's refusal. */
  detail?: string | null;
}) {
  const c = dict.admin.formatRevision;
  const refusal = readRevisionRefusal(detail);
  const refusals = c.refusals as Readonly<Record<string, string>>;
  const sentence = refusal ? interpolate(refusals[refusal.code] ?? c.refusals.input, { detail: refusal.detail }) : null;

  return (
    <Panel title={c.heading}>
      <div data-format-revision-panel className="flex flex-col gap-3">
        <p className="font-mono text-[0.72rem] opacity-70">{c.lede}</p>
        {sentence && (
          <p data-format-revision-refusal={refusal!.code} role="status" className="font-mono text-[0.75rem]">
            {sentence}
          </p>
        )}
        {!view.schemaReady ? (
          <p data-format-revision-schema-missing className="font-mono text-[0.75rem]">
            {c.schemaMissing}
          </p>
        ) : (
          <OpForm op={op} back={back} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={templateId} />
            <input type="hidden" name="reviewedSha256" value={view.reviewedSha256} />
            {view.steps.map((step) => (
              <FormatRevisionStepField
                key={step.id}
                name={`prompt:${step.id}`}
                label={interpolate(c.step, { step: step.id, kind: step.kind === 'video' ? c.kindVideo : c.kindImage })}
                defaultValue={step.prompt}
                max={MAX_STEP_PROMPT_CHARS}
                counter={c.counter}
              />
            ))}
            <Field label={c.reason} hint={c.reasonHint}>
              <textarea name="reason" rows={2} required minLength={10} maxLength={2000} className={INPUT} />
            </Field>
            <div>
              <button type="submit" className={BUTTON_PRIMARY} data-format-revision-save>
                {c.save}
              </button>
            </div>
          </OpForm>
        )}
        <section data-format-revision-history className="mt-2 flex flex-col gap-1.5">
          <h3 className="text-[12px] font-semibold">{c.history}</h3>
          {view.revisions.length === 0 ? (
            <p className="font-mono text-[0.72rem] opacity-60">{c.historyEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {view.revisions.map((revision) => (
                <li key={`${revision.createdAt}-${revision.reason}`} data-format-revision-entry className="font-mono text-[0.72rem] opacity-80">
                  {interpolate(c.historyRow, {
                    date: formatDate(revision.createdAt, locale) ?? revision.createdAt,
                    reason: revision.reason,
                    before: revision.beforeChars.toLocaleString('en-US'),
                    after: revision.afterChars.toLocaleString('en-US'),
                  })}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Panel>
  );
}
