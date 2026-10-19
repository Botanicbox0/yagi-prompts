'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Dictionary } from '@/messages/en';
import { submitApplicationAction, submitApplicationForm } from '@/app/(app)/creators/apply/actions';
import { CREATOR_WORKSPACE_PATH } from '@/lib/creator-platform/links';
import { BUTTON, FIELD, HINT } from './styles';

export type ApplicationFormCopy = Pick<Dictionary['creatorProgram'], 'fieldName' | 'fieldNameHint' | 'fieldPortfolio' | 'fieldPortfolioHint' | 'fieldSamples' | 'fieldSamplesHint' | 'fieldMediums' | 'fieldTools' | 'fieldMessage' | 'fieldMessageHint' | 'rights' | 'program' | 'programLink' | 'submit' | 'busy' | 'errors' | 'fields'>;
type Copy = ApplicationFormCopy;
type Field = keyof Copy['fields'];
type Failure = { code: string; field?: Field };

/** The first control of a field, including grouped checkboxes (a RadioNodeList). */
function firstControl(form: HTMLFormElement, field: Field): HTMLElement | null {
  const item = form.elements.namedItem(field === 'samples' ? 'sample1' : field);
  const first = item instanceof RadioNodeList ? item[0] : item;
  return first instanceof HTMLElement ? first : null;
}

/**
 * The application form. `action` is a server action, so a submission before hydration or
 * without JavaScript is a real POST (never a GET carrying answers in the URL). Once hydrated,
 * `onSubmit` takes over: uncontrolled inputs plus `preventDefault`, so a refusal or a network
 * failure leaves every answer in place. The server-issued request id makes a resend the same
 * application. The server action re-validates everything.
 */
export function CreatorApplicationForm({ copy, media, displayName, programHref, requestId, initialError }: {
  copy: Copy; media: { image: string; video: string }; displayName: string; programHref: string; requestId: string; initialError: Failure | null;
}) {
  const form = useRef<HTMLFormElement>(null), alert = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<Failure | null>(initialError);
  const invalid = (name: Field) => error?.field === name ? { 'aria-invalid': true as const, 'aria-describedby': 'creator-apply-error' } : {};
  // Move focus to the first invalid control (its aria-describedby reads the alert), or to the alert itself.
  useEffect(() => {
    if (!error || !form.current) return;
    const control = error.field ? firstControl(form.current, error.field) : null;
    if (control) control.focus(); else alert.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const payload = {
      requestId,
      displayName: String(data.get('displayName') ?? ''),
      portfolioUrl: String(data.get('portfolioUrl') ?? ''),
      samples: ['sample1', 'sample2', 'sample3'].map((name) => String(data.get(name) ?? '').trim()),
      mediums: data.getAll('mediums').map(String),
      tools: String(data.get('tools') ?? ''),
      message: String(data.get('message') ?? ''),
      rights: data.get('rights') === 'on',
      program: data.get('program') === 'on',
    };
    setBusy(true); setError(null);
    try {
      const result = await submitApplicationAction(payload);
      if (result.ok) { window.location.assign(`${CREATOR_WORKSPACE_PATH}?ok=applied`); return; }
      setError({ code: result.code, field: result.field as Field | undefined });
    } catch {
      setError({ code: 'unavailable' });
    } finally { setBusy(false); }
  }
  const message = error ? (copy.errors[error.code as keyof Copy['errors']] ?? copy.errors.unavailable) : '';
  return <form ref={form} data-creator-apply-form action={submitApplicationForm} onSubmit={(event) => void submit(event)} className="mt-10 max-w-2xl space-y-6">
    <input type="hidden" name="requestId" value={requestId} />
    {error ? <p ref={alert} id="creator-apply-error" role="alert" tabIndex={-1} data-apply-error={error.code} className="rounded-xl border border-accent p-4 text-sm">{message}{error.field ? ` (${copy.fields[error.field]})` : ''}</p> : null}
    <label className="block text-sm">{copy.fieldName}<input name="displayName" required maxLength={80} defaultValue={displayName} autoComplete="nickname" className={FIELD} {...invalid('displayName')} /><span className={HINT}>{copy.fieldNameHint}</span></label>
    <label className="block text-sm">{copy.fieldPortfolio}<input name="portfolioUrl" type="url" required maxLength={2048} inputMode="url" placeholder="https://" className={FIELD} {...invalid('portfolioUrl')} /><span className={HINT}>{copy.fieldPortfolioHint}</span></label>
    <fieldset className="text-sm" {...(error?.field === 'samples' ? { 'aria-describedby': 'creator-apply-error' } : {})}>
      <legend>{copy.fieldSamples}</legend>
      {[1, 2, 3].map((n) => <input key={n} name={`sample${n}`} type="url" required={n === 1} maxLength={2048} inputMode="url" placeholder="https://" aria-label={`${copy.fieldSamples} ${n}`} className={FIELD} {...invalid('samples')} />)}
      <span className={HINT}>{copy.fieldSamplesHint}</span>
    </fieldset>
    <fieldset className="text-sm" {...(error?.field === 'mediums' ? { 'aria-describedby': 'creator-apply-error' } : {})}>
      <legend>{copy.fieldMediums}</legend>
      <div className="mt-2 flex flex-wrap gap-3">{(['video', 'image'] as const).map((value) => <label key={value} className="flex min-h-12 items-center gap-3 rounded-xl border border-hairline px-4"><input type="checkbox" name="mediums" value={value} defaultChecked={value === 'video'} {...invalid('mediums')} />{media[value]}</label>)}</div>
    </fieldset>
    <label className="block text-sm">{copy.fieldTools}<input name="tools" maxLength={300} className={FIELD} {...invalid('tools')} /></label>
    <label className="block text-sm">{copy.fieldMessage}<textarea name="message" required minLength={20} maxLength={2000} rows={6} className={FIELD} {...invalid('message')} /><span className={HINT}>{copy.fieldMessageHint}</span></label>
    <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="rights" required className="mt-1" {...invalid('rights')} />{copy.rights}</label>
    <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" name="program" required className="mt-1" {...invalid('program')} /><span>{copy.program} <a href={programHref} target="_blank" rel="noopener" className="underline underline-offset-4">{copy.programLink} ↗</a></span></label>
    <button type="submit" disabled={busy} className={BUTTON}>{busy ? copy.busy : copy.submit}</button>
  </form>;
}
