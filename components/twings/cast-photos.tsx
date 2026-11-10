'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';

/**
 * docs/CAST-CATEGORIES.md §3 — the make card's other photos: the pet, or the person the buyer makes a
 * couple template with. Nothing is uploaded here: the files stay in the browser until the make
 * request, which shrinks and sends them with the order. The buyer's own selfie keeps its own panel and
 * rules (SelfieSheet); this never touches it.
 *
 * The partner photo carries one plain confirmation (the other person agreed); the pay button waits for it.
 */

export interface CastPhotoState {
  pet: File | null;
  partner: File | null;
  partnerConsent: boolean;
}
export const EMPTY_CAST_PHOTOS: CastPhotoState = { pet: null, partner: null, partnerConsent: false };

export function castPhotosReady(need: { pet: boolean; partner: boolean }, value: CastPhotoState): boolean {
  return (!need.pet || value.pet !== null) && (!need.partner || (value.partner !== null && value.partnerConsent));
}

type Copy = Dictionary['cast']['photo'];

function PhotoPicker({ slot, title, hint, tips, file, onFile, copy, disabled }: {
  slot: 'pet' | 'partner';
  title: string;
  hint: string;
  tips?: string[];
  file: File | null;
  onFile(file: File | null): void;
  copy: Copy;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div data-cast-photo={slot} data-cast-photo-set={file ? 'true' : 'false'}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-black/65">{hint}</p>
      {tips && tips.length > 0 && (
        <ul data-cast-photo-tips className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-black/75">
          {tips.map((tip) => (
            <li key={tip} className="inline-flex items-center gap-1"><span aria-hidden="true" className="text-accent">✓</span>{tip}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-3">
        <div className="aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-xl border border-dashed border-black/20 bg-white">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never leaves the browser
            <img src={preview} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={disabled}
          data-cast-photo-input={slot}
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          data-cast-photo-choose={slot}
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="inline-flex min-h-11 items-center rounded-full border border-black/15 bg-white px-4 text-sm font-medium transition-colors hover:border-black/40 disabled:opacity-60"
        >
          {file ? copy.change : copy.choose}
        </button>
      </div>
    </div>
  );
}

export function CastPhotoFields({ need, value, onChange, copy, disabled }: {
  need: { pet: boolean; partner: boolean };
  value: CastPhotoState;
  onChange(next: CastPhotoState): void;
  copy: Copy;
  disabled?: boolean;
}) {
  if (!need.pet && !need.partner) return null;
  return (
    <div data-cast-photos className="flex flex-col gap-5">
      {need.pet && (
        <PhotoPicker
          slot="pet"
          title={copy.petTitle}
          hint={copy.petHint}
          tips={[copy.petTips.face, copy.petTips.body, copy.petTips.alone]}
          file={value.pet}
          onFile={(pet) => onChange({ ...value, pet })}
          copy={copy}
          disabled={disabled}
        />
      )}
      {need.partner && (
        <div>
          <PhotoPicker
            slot="partner"
            title={copy.partnerTitle}
            hint={copy.partnerHint}
            file={value.partner}
            onFile={(partner) => onChange({ ...value, partner, partnerConsent: partner === value.partner ? value.partnerConsent : false })}
            copy={copy}
            disabled={disabled}
          />
          <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
            <input
              data-partner-consent
              type="checkbox"
              checked={value.partnerConsent}
              disabled={disabled || value.partner === null}
              onChange={(event) => onChange({ ...value, partnerConsent: event.target.checked })}
              className="mt-1 size-4 shrink-0 accent-black"
            />
            <span>{copy.partnerConsent}</span>
          </label>
        </div>
      )}
    </div>
  );
}

/** The one line under the pay button that says what is still missing, or null when nothing is. */
export function castPhotoHint(need: { pet: boolean; partner: boolean }, value: CastPhotoState, copy: Copy): string | null {
  if (need.pet && !value.pet) return copy.needPet;
  if (need.partner && !value.partner) return copy.needPartner;
  if (need.partner && !value.partnerConsent) return copy.needConsent;
  return null;
}
