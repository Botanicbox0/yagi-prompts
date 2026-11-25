'use client';

import { useEffect, useRef, useState } from 'react';
import {
  OWN_STYLE_PARTS,
  TEMPLATE_STYLING_LIMITS,
  checkStylingBlock,
  stylingHelperBlock,
  type OwnStylePart,
  type StylingHelperChoice,
} from '@/lib/template-director/styling';

export interface StylingHelperCopy {
  heading: string;
  hint: string;
  photo: string;
  template: string;
  notePlaceholder: string;
  insert: string;
  noteInvalid: string;
}

type Choices = Record<OwnStylePart, { from: 'photo' | 'template'; note: string }>;

const START: Choices = { hair: { from: 'photo', note: '' }, makeup: { from: 'photo', note: '' } };

/** The person template's prompt has no `Template styling:` block yet (a malformed one has its own warning). */
const needsBlock = (prompt: string, cast: string): boolean => cast !== 'pet' && checkStylingBlock(prompt).state === 'none';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9, rule 3 (founder, 2026-11-25) — above the admin template form's prompt field: for a
 * person template whose prompt has no styling block, the hair and the makeup each follow the buyer's photo (the
 * default) or are set by the template, with a short English description; the button writes the block at the end of the
 * prompt field. Client-side text only: the save still checks the block (`checkStylingBlock`), and the helper posts no
 * field of its own (no `name` on any control). It follows the prompt field and the cast picker as they change, and
 * hides itself once the prompt declares its styling or the template is a pet's.
 */
export function TemplateStylingHelper({
  copy,
  partLabels,
  initialPrompt,
  initialCast,
}: {
  copy: StylingHelperCopy;
  partLabels: Record<OwnStylePart, string>;
  initialPrompt: string;
  initialCast: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(() => needsBlock(initialPrompt, initialCast));
  const [choices, setChoices] = useState<Choices>(START);
  const [bad, setBad] = useState<OwnStylePart[]>([]);

  useEffect(() => {
    const form = (root.current ?? anchor)?.closest('form');
    if (!form) return;
    const read = () => {
      const prompt = form.elements.namedItem('promptText');
      const cast = form.elements.namedItem('cast');
      setShown(
        needsBlock(
          prompt instanceof HTMLTextAreaElement ? prompt.value : initialPrompt,
          cast instanceof HTMLSelectElement ? cast.value : initialCast,
        ),
      );
    };
    read();
    form.addEventListener('input', read);
    form.addEventListener('change', read);
    return () => {
      form.removeEventListener('input', read);
      form.removeEventListener('change', read);
    };
  }, [anchor, initialPrompt, initialCast]);

  // Hidden, the helper keeps an empty anchor in the form so it can come back when the cast or the prompt changes.
  if (!shown) return <span ref={setAnchor} hidden data-styling-anchor />;

  const pick = (part: OwnStylePart, from: 'photo' | 'template') => {
    setChoices((current) => ({ ...current, [part]: { ...current[part], from } }));
    setBad((current) => current.filter((p) => p !== part));
  };

  const insert = () => {
    const form = root.current?.closest('form');
    const field = form?.elements.namedItem('promptText');
    if (!(field instanceof HTMLTextAreaElement)) return;
    const asked = Object.fromEntries(
      OWN_STYLE_PARTS.map((part): [OwnStylePart, StylingHelperChoice] => [
        part,
        choices[part].from === 'template' ? { from: 'template', note: choices[part].note } : { from: 'photo' },
      ]),
    ) as Record<OwnStylePart, StylingHelperChoice>;
    const result = stylingHelperBlock(asked);
    if (!result.ok) {
      setBad(result.parts);
      return;
    }
    setBad([]);
    const body = field.value.replace(/\s+$/u, '');
    field.value = body ? `${body}\n\n${result.block}` : result.block;
    // The form's own listeners (draft autosave, this helper) hear the change like typing.
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
  };

  return (
    <div ref={root} data-styling-helper className="border border-hairline p-3">
      <p className="font-label text-eyebrow">{copy.heading}</p>
      <p className="mt-1 font-mono text-[0.72rem] opacity-70">{copy.hint}</p>
      {OWN_STYLE_PARTS.map((part) => {
        const choice = choices[part];
        return (
          <div key={part} data-styling-helper-part={part} className="mt-2 flex flex-wrap items-center gap-2">
            <span className="w-16 font-mono text-[0.72rem]">{partLabels[part]}</span>
            <div role="group" aria-label={partLabels[part]} className="flex gap-1">
              {(['photo', 'template'] as const).map((from) => (
                <button
                  key={from}
                  type="button"
                  aria-pressed={choice.from === from}
                  onClick={() => pick(part, from)}
                  className={`border px-2 py-1 font-mono text-[0.72rem] ${choice.from === from ? 'border-accent text-accent' : 'border-hairline opacity-70'}`}
                >
                  {from === 'photo' ? copy.photo : copy.template}
                </button>
              ))}
            </div>
            {choice.from === 'template' && (
              <input
                type="text"
                aria-label={`${partLabels[part]} · ${copy.template}`}
                aria-invalid={bad.includes(part) || undefined}
                placeholder={copy.notePlaceholder}
                maxLength={TEMPLATE_STYLING_LIMITS.tailMax}
                value={choice.note}
                onChange={(event) => {
                  const note = event.target.value;
                  setChoices((current) => ({ ...current, [part]: { ...current[part], note } }));
                }}
                className={`min-w-0 flex-1 border bg-transparent px-2 py-1 font-mono text-[0.72rem] ${bad.includes(part) ? 'border-accent' : 'border-hairline'}`}
              />
            )}
          </div>
        );
      })}
      {bad.length > 0 && (
        <p role="alert" className="mt-2 font-mono text-[0.72rem] text-accent">
          {copy.noteInvalid}
        </p>
      )}
      <button type="button" data-styling-helper-insert onClick={insert} className="mt-3 border border-hairline px-2.5 py-1 font-mono text-[0.72rem]">
        {copy.insert}
      </button>
    </div>
  );
}
