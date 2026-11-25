'use client';

import { useId } from 'react';
import { interpolate } from '@/lib/i18n/format';
import { OWN_STYLE_PARTS, type OwnStylePart } from '@/lib/template-director/styling';
import type { PartState, StyleChoice, StyleChoices, TemplatePartRow, TemplatePartsCopy } from '@/lib/template-director/parts-view';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 · §3.4.9 (S2) — the parts a template decides, on the make card, right above the pay
 * button and outside the folding edit panel. Video has no free retry, so the buyer sees before paying what the
 * template will do to their look, and — where the template styles the hair or the makeup without locking it — picks
 * the template's style (the default, the example's look) or their own ("내 사진 그대로").
 *
 * The choice travels as the spec's `own` (names only; the server writes the words). Choosing nothing changes nothing:
 * `withOwnChoice` (lib/template-director/parts-view.ts) hands back the very spec the order would have sent. A part the customer's edits change explicitly
 * (a hair line in the sheet, a hair chip) is made as written there (the server rule), so its choice row says so and
 * waits instead of disagreeing with the edit.
 *
 * Three techniques, the quiet white make card's own: the wash panel the template page's fixed row uses, white rows
 * on it, and an ink ring for the chosen option (pink stays on the pay button). Native radios inside 44px pills, so the
 * arrow keys and screen readers work as they do everywhere. No word of the template's prompt reaches this component.
 */

const ROW = 'rounded-[12px] bg-white px-3 py-2.5';
const META = 'text-xs text-[#71717A]';
const NOTE = 'mt-1.5 text-xs leading-[1.5] break-keep text-[#52525B]';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CC1573]';

export interface TemplatePartsCardProps {
  rows: readonly TemplatePartRow[];
  /** A lock block that did not parse: everything is fixed, one line instead of the rows. */
  all?: boolean;
  copy: TemplatePartsCopy;
  choices: StyleChoices;
  /** Absent = no choice can be made here (a subscription render cannot carry it yet): styled rows read "template style". */
  onChoose?: (part: OwnStylePart, choice: StyleChoice) => void;
  /** Parts the customer's edits change explicitly. */
  overridden?: readonly string[];
  /** The outfit-photo slot of the edit panel: open on this template, already holding a photo, and how to reach it. */
  outfitPhoto?: { open: boolean; attached: boolean; onAdd?: () => void };
  /** Founder 2026-11-25 — parts whose "내 사진 그대로" would not fit the template's clip: that option is disabled. */
  mineBlocked?: readonly OwnStylePart[];
  disabled?: boolean;
}

export function TemplatePartsCard({ rows, all = false, copy, choices, onChoose, overridden = [], outfitPhoto, mineBlocked = [], disabled = false }: TemplatePartsCardProps) {
  const baseId = useId();
  if (!all && rows.length === 0) return null;
  const stateWord = (state: PartState): string => (state === 'locked' ? copy.locked : state === 'styled' ? copy.styled : copy.photo);

  return (
    <section data-template-parts aria-labelledby={`${baseId}-heading`} className="mt-5 rounded-[16px] bg-[#F4F4F5] p-3">
      <p id={`${baseId}-heading`} className="text-xs font-semibold tracking-tight text-[#09090B]">
        {copy.heading}
      </p>
      {all ? (
        <p data-template-parts-all className="mt-2 text-[13px] leading-[1.5] break-keep text-[#09090B]">
          {copy.lockedAll}
        </p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {rows.map((row) => {
            const part = (OWN_STYLE_PARTS as readonly string[]).includes(row.key) ? (row.key as OwnStylePart) : null;
            const choosable = row.choice && part !== null && onChoose !== undefined;
            const isOverridden = overridden.includes(row.key);
            const chosen: StyleChoice = part ? choices[part] ?? 'template' : 'template';
            const outfit = row.key === 'outfit' && row.state === 'styled' ? outfitPhoto : undefined;
            let note: string | null = null;
            if (row.state === 'styled' && part) {
              note = isOverridden ? copy.overridden : chosen === 'mine' && choosable ? (part === 'hair' ? copy.mineHair : copy.mineMakeup) : copy.templateNote;
            } else if (outfit?.attached) note = copy.outfitAttached;
            else if (row.state === 'styled' && isOverridden) note = copy.overridden;
            const blocked = choosable && part !== null && mineBlocked.includes(part) && chosen !== 'mine';
            if (blocked && copy.tooLong) note = copy.tooLong;
            return (
              <li
                key={row.key}
                data-template-part={row.key}
                data-part-state={row.state}
                {...(choosable ? { 'data-part-choice': isOverridden ? 'overridden' : chosen } : {})}
                {...(blocked ? { 'data-style-blocked': part } : {})}
                className={ROW}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#09090B]">{row.label}</span>
                  {!choosable && <span className={META}>{stateWord(row.state)}</span>}
                </div>
                {row.desc && <p className="mt-0.5 text-xs leading-[1.45] break-keep text-[#52525B]">{row.desc}</p>}
                {choosable && part && (
                  <fieldset disabled={disabled || isOverridden} className="mt-2 min-w-0">
                    <legend className="sr-only">{interpolate(copy.choiceLabel, { part: row.label })}</legend>
                    <div className={`inline-flex flex-wrap gap-1 rounded-full bg-[#F4F4F5] p-1 ${isOverridden ? 'opacity-50' : ''}`}>
                      {(['template', 'mine'] as const).map((value) => {
                        const on = chosen === value;
                        return (
                          <label
                            key={value}
                            data-style-option={`${part}:${value}`}
                            className={[
                              'relative inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-[13px] break-keep transition-[background-color,box-shadow,color] duration-[160ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#CC1573] has-[:disabled]:cursor-default',
                              on ? 'bg-white font-semibold text-[#09090B] ring-[1.5px] ring-[#09090B]' : 'text-[#52525B] hover:text-[#09090B]',
                            ].join(' ')}
                          >
                            <input
                              type="radio"
                              name={`${baseId}-${part}`}
                              value={value}
                              checked={on}
                              disabled={value === 'mine' && blocked}
                              onChange={() => onChoose?.(part, value)}
                              className="sr-only"
                            />
                            {value === 'template' ? copy.template : copy.mine}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
                {note && (
                  <p data-part-note className={NOTE} aria-live={choosable ? 'polite' : undefined}>
                    {note}
                  </p>
                )}
                {outfit && outfit.open && !outfit.attached && !isOverridden && (
                  <p data-part-outfit-photo className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs leading-[1.5] break-keep text-[#52525B]">
                    <span>{copy.outfitPhoto}</span>
                    {outfit.onAdd && (
                      <button
                        type="button"
                        data-part-outfit-photo-cta
                        disabled={disabled}
                        onClick={outfit.onAdd}
                        className={`inline-flex min-h-11 items-center font-semibold text-[#09090B] underline underline-offset-4 disabled:opacity-40 ${FOCUS}`}
                      >
                        {copy.outfitPhotoCta}
                      </button>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
