'use client';

import { useId, useState } from 'react';
import { TEMPLATE_LOOKS, type TemplateLook } from '@/lib/template-look/look';
import { postTemplateLook, type TemplateLookCopy } from './look-island';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the settings row: the women's style first, the men's style, and "정하지 않음" to
 * clear it. A change goes through the same route as the question (it updates the profile and the cookie together); the
 * row says so in one line, and goes back to the stored value when the save fails.
 */
export function LookSetting({ initial, copy }: { initial: TemplateLook | null; copy: TemplateLookCopy }) {
  const [value, setValue] = useState<TemplateLook | null>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const labelId = useId();
  const hintId = useId();
  const options: Array<{ value: TemplateLook | null; label: string }> = [
    ...TEMPLATE_LOOKS.map((look) => ({ value: look, label: copy[look] })),
    { value: null, label: copy.unset },
  ];

  const choose = async (next: TemplateLook | null) => {
    if (next === value || status === 'saving') return;
    const previous = value;
    setValue(next);
    setStatus('saving');
    const stored = await postTemplateLook(next);
    if (stored) setStatus('saved');
    else {
      setValue(previous);
      setStatus('error');
    }
  };

  return (
    <div data-look-setting={value ?? 'unset'}>
      <span id={labelId} className="sr-only">{copy.settingsLabel}</span>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value ?? 'unset'}
              type="button"
              role="radio"
              aria-checked={on}
              data-look-setting-option={option.value ?? 'unset'}
              disabled={status === 'saving'}
              onClick={() => void choose(option.value)}
              className={[
                'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium',
                'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-editorial)] motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF58AE] disabled:opacity-60',
                on ? 'bg-[#09090B] text-white' : 'bg-[#F4F4F5] text-[#09090B] hover:bg-[#E4E4E7]',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p id={hintId} className="mt-2 text-[0.875rem] leading-relaxed opacity-60 break-keep">{copy.settingsHint}</p>
      <p role="status" aria-live="polite" data-look-setting-status={status} className="mt-1 min-h-5 text-[0.875rem]">
        {status === 'saved' ? copy.saved : status === 'error' ? copy.error : ''}
      </p>
    </div>
  );
}
