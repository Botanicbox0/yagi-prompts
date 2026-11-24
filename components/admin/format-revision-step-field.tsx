'use client';

import { useState } from 'react';

/**
 * docs/CREATOR-PLATFORM.md (2026-11-25) — one result step's prompt in the "레시피 문구 개정" panel, with a live count
 * against the step limit (`MAX_STEP_PROMPT_CHARS`, passed in). The form still works without JavaScript: the textarea
 * posts as `prompt:<stepId>`, the browser holds it to `maxLength`, and the server checks the limit again.
 *
 * The class names are the admin chrome's `LABEL` / `INPUT` (components/admin/chrome.tsx), copied rather than imported:
 * that module is server furniture and would pull the dictionaries into this island.
 */
const LABEL = 'admin-field-label block text-[12px] font-semibold';
const INPUT = 'admin-input w-full border border-hairline bg-transparent px-3 py-2 text-[13.5px] outline-none focus:border-accent';

export function FormatRevisionStepField({
  name,
  label,
  defaultValue,
  max,
  counter,
}: {
  name: string;
  label: string;
  defaultValue: string;
  max: number;
  /** `{n} / {max}…` from the admin dictionary. */
  counter: string;
}) {
  const [length, setLength] = useState(defaultValue.length);
  const over = length > max;
  const count = counter.replace('{n}', length.toLocaleString('en-US')).replace('{max}', max.toLocaleString('en-US'));
  return (
    <label className="flex flex-col gap-1.5" data-format-revision-step={name}>
      <span className={LABEL}>{label}</span>
      <textarea
        name={name}
        rows={12}
        maxLength={max}
        defaultValue={defaultValue}
        onChange={(event) => setLength(event.currentTarget.value.length)}
        className={`${INPUT} font-mono text-[0.75rem]`}
      />
      <span data-format-revision-counter className={`self-end font-mono text-[0.7rem] ${over ? 'font-semibold text-amber-600' : 'opacity-60'}`}>
        {count}
      </span>
    </label>
  );
}
