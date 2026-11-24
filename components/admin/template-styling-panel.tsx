import { BUTTON_PRIMARY, Field, INPUT, OpForm, Panel } from '@/components/admin/chrome';
import { stylingPartLabels } from '@/components/admin/prompt-fields';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import type { PromptRow } from '@/lib/prompts/repo';
import { templateCardStyling, templateCompileSource } from '@/lib/template-director/compile-prompts';
import { applyDeterministicDirectorSpec } from '@/lib/template-director/flash-director';
import { OWN_STYLE_PARTS, TEMPLATE_STYLING_EXAMPLE, parseTemplateStyling, type OwnStylePart } from '@/lib/template-director/styling';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — the admin template page's styling panel:
 *
 *  - what buyers see: the styling every prompt an order compiles declares alike (the catalogue card's rule,
 *    `templateCardStyling`), or why they see nothing (the prompts disagree, a step takes no photo);
 *  - for a recipe or image-set template, that an order reads its result steps, not the main text;
 *  - a free dry run: the deterministic compile (no provider, no model) of the first compiled prompt with the buyer's
 *    "내 사진 그대로" for hair, makeup and both — labelled as the no-model fallback text, since a real order has the
 *    model rewrite it;
 *  - one declaration (`prompt.declareStyling`) written into the main text and every compiled prompt at once.
 */

type Dict = Dictionary;

const CASES: ReadonlyArray<readonly OwnStylePart[]> = [['hair'], ['makeup'], ['hair', 'makeup']];

/** The deterministic compile of `basePrompt` with the buyer's own `parts` and nothing else asked (no env, no model). */
export function stylingDryRun(basePrompt: string, medium: 'image' | 'video', cast: PromptRow['cast'], parts: readonly OwnStylePart[]): string {
  return applyDeterministicDirectorSpec(
    { basePrompt, medium, cast, hasPersonSlot: true, directorSpec: { audioMode: 'ambient', own: [...parts] } },
    { env: {} },
  );
}

export function TemplateStylingPanel({
  op,
  row,
  source,
  dict,
  back,
}: {
  /** Named by the page, like the marks editor's (the screen contract lists every prompt operation it offers). */
  op: 'prompt.declareStyling';
  row: PromptRow;
  source: { recipe: unknown; recipeReady: boolean };
  dict: Dict;
  back: string;
}) {
  const a = dict.admin;
  const compile = templateCompileSource({ promptText: row.promptText, ...source });
  const shown = templateCardStyling({ promptText: row.promptText, ...source, cast: row.cast });
  const mentions = [row.promptText, ...compile.prompts.map((p) => p.text)].some((text) => /template styling:/i.test(text));
  const first = compile.prompts[0] ?? null;
  const current = parseTemplateStyling(first?.text ?? row.promptText).block || parseTemplateStyling(row.promptText).block;
  const ownParts = shown ? OWN_STYLE_PARTS.filter((part) => shown.styled.includes(part)) : [];
  const cases = CASES.filter((parts) => parts.every((part) => ownParts.includes(part)));
  const medium: 'image' | 'video' = first?.kind ?? row.medium;

  return (
    <Panel title={a.templateStylingHeading}>
      <div data-template-styling-panel className="flex flex-col gap-3">
        {shown ? (
          <p data-template-styling-shown className="font-mono text-[0.72rem] opacity-70">
            {interpolate(a.templateStylingShown, { parts: stylingPartLabels(shown, dict).join(' · ') })}
          </p>
        ) : mentions ? (
          <p data-template-styling-mismatch className="font-mono text-[0.72rem] text-accent">
            {a.templateStylingMismatch}
          </p>
        ) : (
          <p data-template-styling-none className="font-mono text-[0.72rem] opacity-70">
            {a.templateStylingNone}
          </p>
        )}
        {compile.kind === 'recipe' && (
          <p data-template-styling-recipe className="font-mono text-[0.72rem] opacity-70">
            {interpolate(a.templateStylingRecipe, { n: String(compile.prompts.length) })}
          </p>
        )}

        {first && cases.length > 0 && (
          <details data-template-styling-dry-run className="border border-hairline p-3">
            <summary className="cursor-pointer font-label text-eyebrow">{a.templateStylingDryRun}</summary>
            <p className="mt-2 font-mono text-[0.72rem] opacity-70">{a.templateStylingDryRunNote}</p>
            {cases.map((parts) => (
              <div key={parts.join('+')} data-template-styling-case={parts.join('+')} className="mt-3">
                <p className="font-mono text-[0.72rem] font-semibold">
                  {interpolate(a.templateStylingDryRunCase, { parts: parts.map((part) => dict.editSheet.slots[part]).join(' · ') })}
                </p>
                <pre className="mt-1 max-h-72 overflow-auto border border-hairline p-3 font-mono text-[0.72rem] whitespace-pre-wrap">
                  {stylingDryRun(first.text, medium, row.cast, parts)}
                </pre>
              </div>
            ))}
          </details>
        )}

        <div data-template-styling-declare={row.slug}>
        <OpForm op={op} back={back} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={row.id} />
          <Field label={a.templateStylingField} hint={a.templateStylingDeclareHint}>
            <textarea name="block" rows={5} defaultValue={current} placeholder={TEMPLATE_STYLING_EXAMPLE} className={`${INPUT} font-mono text-[0.75rem]`} />
          </Field>
          <div>
            <button type="submit" className={BUTTON_PRIMARY}>
              {a.templateStylingDeclare}
            </button>
          </div>
        </OpForm>
        </div>
      </div>
    </Panel>
  );
}
