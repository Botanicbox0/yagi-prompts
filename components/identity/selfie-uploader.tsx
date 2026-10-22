'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Dictionary } from '@/messages/en';
import type { SelfieView } from '@/lib/identity/selfie-service';
import { selfieSavedOn } from '@/lib/identity/selfie-format';
import { shrinkPhoto } from '@/lib/images/client-photo';
import { SelfiePhotoGuide } from './selfie-photo-guide';
import { usePhotoAdvice } from './use-photo-advice';
import { usePhotoLight } from './use-photo-light';

/**
 * The one upload (docs/IDENTITY-SELFIE.md). Founder, 2026-10-22: no generated reference portrait —
 * a natural front-facing selfie, chosen or taken on the spot, previewed, saved, reused everywhere.
 *
 * One screen, one action. Empty: take or choose. Chosen: preview with the angle and light hints
 * (advice, never a gate — AGENTS.md §5, 2026-10-15), consent, save. Saved: the photo, when it was
 * saved, and the one way to change it. Nothing leaves the browser until "save"; a failed save keeps
 * the chosen file so the person presses once more rather than starting over.
 *
 * The component owns its state after mount. A parent that learns of a different selfie from
 * elsewhere (another tab) remounts it with a new `key`; it never pushes props into state.
 */
export interface SelfieUploaderProps {
  copy: Dictionary['selfie'];
  locale: string;
  initial: SelfieView | null;
  /** Fires after a save (new or unchanged) with the current selfie. */
  onSaved?: (selfie: SelfieView, replaced: boolean) => void;
  /** Fires when the chooser opens or closes, so a parent can hold its own next step meanwhile. */
  onEditingChange?: (editing: boolean) => void;
  /** Open on the chooser even though a selfie exists (the "change" deep link). */
  startEditing?: boolean;
  /** Where a `sign_in_required` answer sends the person. */
  signinHref?: string;
  /** Shown beside "change" once saved: the way onward (the page variant). */
  continueHref?: string | null;
  continueLabel?: string;
}

type SaveCode = 'bad_photo' | 'rate_limited' | 'unavailable' | 'error';

export function SelfieUploader({ copy, locale, initial, onSaved, onEditingChange, startEditing = false, signinHref, continueHref = null, continueLabel }: SelfieUploaderProps) {
  const [selfie, setSelfie] = useState<SelfieView | null>(initial);
  const [editing, setEditing] = useState(initial === null || startEditing);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentHint, setConsentHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SaveCode | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const [dragging, setDragging] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const consentId = useId();
  const advice = usePhotoAdvice(file);
  const light = usePhotoLight(file);

  // Object URLs are made in the handlers; this only releases the last one on unmount.
  const previewRef = useRef<string | null>(null);
  previewRef.current = preview;
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  // `capture` is honoured by phone browsers only; on a desktop the camera button would just be a second file picker.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaDevices' in navigator)) return;
    const handheld = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    setCanCapture(handheld);
  }, []);

  const setPreviewUrl = (next: string | null) => {
    setPreview(current => { if (current) URL.revokeObjectURL(current); return next; });
  };
  const choose = (next: File | null | undefined) => {
    if (busy || !next || !next.type.startsWith('image/')) return;
    setFile(next);
    setError(null);
    setConsentHint(false);
    setJustSaved(false);
    setPreviewUrl(URL.createObjectURL(next));
  };
  const clearFile = () => {
    setFile(null);
    setPreviewUrl(null);
    setConsent(false);
    setConsentHint(false);
    setError(null);
    if (cameraRef.current) cameraRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
  };
  const openEditor = () => { setEditing(true); setJustSaved(false); onEditingChange?.(true); };
  const closeEditor = () => { clearFile(); setEditing(false); onEditingChange?.(false); requestAnimationFrame(() => changeRef.current?.focus({ preventScroll: true })); };

  async function save() {
    if (!file || busy) return;
    if (!consent) { setConsentHint(true); consentRef.current?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      const image = await shrinkPhoto(file, 2_800_000);
      form.set('photo', image, image.type === 'image/png' ? 'selfie.png' : 'selfie.jpg');
      form.set('consent', 'yes');
      const response = await fetch('/api/identity/selfie', { method: 'POST', body: form, credentials: 'same-origin' });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string; selfie?: SelfieView | null; replaced?: boolean };
      if (data.code === 'sign_in_required' && signinHref) { window.location.assign(signinHref); return; }
      if (!response.ok || data.ok !== true || !data.selfie) {
        setError(data.code === 'bad_photo' ? 'bad_photo' : data.code === 'rate_limited' ? 'rate_limited' : response.status === 503 ? 'unavailable' : 'error');
        return;
      }
      clearFile();
      setSelfie(data.selfie);
      setEditing(false);
      setJustSaved(true);
      onEditingChange?.(false);
      onSaved?.(data.selfie, data.replaced === true);
    } catch {
      setError('error');
    } finally {
      setBusy(false);
    }
  }

  const errorCopy = error === 'bad_photo' ? copy.badPhoto : error === 'rate_limited' ? copy.rateLimited : error === 'unavailable' ? copy.unavailable : copy.error;
  // One live region, mounted from the first render, so assistive tech hears each change of advice.
  const announcement = selfie && !editing
    ? (justSaved ? copy.savedToast : '')
    : file
      ? `${copy.photoAdvice[advice]}${light === 'dark' || light === 'bright' ? ` ${copy.lightAdvice[light]}` : ''}`
      : '';

  if (selfie && !editing) {
    const savedOn = selfieSavedOn(copy.savedOn, selfie.createdAt, locale);
    return (
      <div data-selfie-uploader data-selfie-state="saved" className="flex flex-col gap-4">
        <figure className="m-0">
          <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-only private route */}
            <img src={selfie.imageUrl} alt={copy.savedTitle} width={selfie.width} height={selfie.height} className="h-full w-full object-cover" />
          </div>
          <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-semibold">{copy.savedTitle}</span>
            {savedOn ? <span data-selfie-saved-on className="font-mono text-[0.72rem] opacity-55">{savedOn}</span> : null}
          </figcaption>
        </figure>
        <p role="status" aria-live="polite" data-selfie-saved={justSaved ? 'true' : undefined} className={justSaved ? 'flex items-center gap-2 text-sm font-medium text-accent' : 'sr-only'}>
          {justSaved ? <><CheckIcon />{copy.savedToast}</> : announcement}
        </p>
        <p className="text-sm leading-relaxed opacity-70">{copy.savedNote}</p>
        <div className="flex flex-wrap gap-3">
          <button ref={changeRef} type="button" data-selfie-change onClick={openEditor} className="inline-flex min-h-11 items-center border border-current px-4 font-label text-eyebrow uppercase transition-opacity hover:opacity-70">
            {copy.change}
          </button>
          {continueHref ? <a data-selfie-continue href={continueHref} className="inline-flex min-h-11 items-center bg-accent px-5 font-label text-eyebrow text-white uppercase transition-opacity hover:opacity-85">{continueLabel ?? copy.continue} →</a> : null}
        </div>
      </div>
    );
  }

  return (
    <div data-selfie-uploader data-selfie-state={selfie ? 'changing' : 'empty'} className="flex flex-col gap-4" aria-busy={busy}>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={busy} onChange={event => choose(event.currentTarget.files?.[0])} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" disabled={busy} onChange={event => choose(event.currentTarget.files?.[0])} />

      {file && preview ? (
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={preview} alt={copy.previewAlt} className="h-full w-full object-contain" />
          <button type="button" data-selfie-another disabled={busy} onClick={clearFile} className="absolute right-3 bottom-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-white/90 px-4 text-xs font-semibold text-black shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur transition-opacity hover:opacity-85 disabled:opacity-50">
            <ImageIcon />{copy.anotherPhoto}
          </button>
        </div>
      ) : (
        // The whole zone opens the picker (the copy promises it); the buttons are the keyboard path.
        <div
          data-selfie-dropzone
          onClick={() => { if (!busy) fileRef.current?.click(); }}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]); }}
          className={['flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-5 rounded-xl border border-dashed px-6 text-center transition-colors', dragging ? 'border-accent bg-accent/5' : 'border-current/40'].join(' ')}
        >
          <FaceIcon />
          <p className="max-w-[26ch] text-sm leading-relaxed opacity-75">{copy.dropHint}</p>
          <div className="flex w-full max-w-xs flex-col gap-2 sm:flex-row">
            {canCapture ? (
              <button type="button" data-selfie-camera disabled={busy} onClick={event => { event.stopPropagation(); cameraRef.current?.click(); }} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-accent px-4 font-label text-eyebrow text-white uppercase transition-opacity hover:opacity-85 disabled:opacity-40">
                <CameraIcon />{copy.takePhoto}
              </button>
            ) : null}
            <button type="button" data-selfie-choose disabled={busy} onClick={event => { event.stopPropagation(); fileRef.current?.click(); }} className={['inline-flex min-h-12 flex-1 items-center justify-center gap-2 px-4 font-label text-eyebrow uppercase transition-opacity disabled:opacity-40', canCapture ? 'border border-current hover:opacity-70' : 'bg-accent text-white hover:opacity-85'].join(' ')}>
              <ImageIcon />{copy.choosePhoto}
            </button>
          </div>
          <p className="font-mono text-[0.68rem] opacity-45">{copy.dropZone}</p>
        </div>
      )}

      <section data-photo-preflight data-photo-advice={file ? advice : undefined} data-photo-light={file ? light : undefined} className={file ? 'rounded-xl border border-hairline p-4' : 'sr-only'}>
        <p role="status" aria-live="polite" className="text-sm leading-relaxed">{announcement}</p>
        {file ? <p className="mt-2 text-xs leading-relaxed opacity-60">{copy.photoAdvisoryHint}</p> : null}
      </section>

      <details data-selfie-guide className="rounded-xl border border-hairline px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">{copy.guideSummary}</summary>
        <SelfiePhotoGuide copy={copy} />
      </details>

      <div>
        <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
          <input ref={consentRef} id={consentId} data-selfie-consent type="checkbox" checked={consent} disabled={busy || !file} aria-describedby={consentHint ? `${consentId}-hint` : undefined} onChange={event => { setConsent(event.target.checked); if (event.target.checked) setConsentHint(false); }} className="mt-1 size-4 shrink-0" style={{ accentColor: 'var(--accent)' }} />
          <span>{copy.consent}</span>
        </label>
        {consentHint ? <p id={`${consentId}-hint`} data-selfie-consent-hint className="mt-2 pl-7 text-xs text-accent">{copy.consentHint}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" data-selfie-save disabled={!file || busy} onClick={() => void save()} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-accent px-5 font-label text-[0.8rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85 disabled:opacity-30 sm:flex-none">
          {busy ? <><Spinner />{copy.saving}</> : copy.save}
        </button>
        {selfie ? (
          <button type="button" data-selfie-cancel disabled={busy} onClick={closeEditor} className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40">
            {copy.cancelChange}
          </button>
        ) : null}
      </div>
      {error ? <p data-selfie-error role="alert" className="text-sm leading-relaxed text-accent">{errorCopy}</p> : null}
    </div>
  );
}

function CameraIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.25" /></svg>;
}
function ImageIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="m20 15-4.5-4.5L8 18" /></svg>;
}
function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
}
function Spinner() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
}
/** The empty state's one picture: a face outline at eye level, drawn, not an emoji. */
function FaceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 96 96" className="size-20 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="48" cy="40" rx="20" ry="25" />
      <path d="M14 88c3-20 65-20 68 0" />
      <path d="M38 38h3M55 38h3M48 42v8M42 55q6 5 12 0" />
      <path d="M6 40h8M82 40h8" strokeDasharray="2 3" />
    </svg>
  );
}
