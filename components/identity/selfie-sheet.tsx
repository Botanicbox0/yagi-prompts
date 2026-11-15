'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Dictionary } from '@/messages/en';
import type { SelfieLibrary, SelfieView } from '@/lib/identity/selfie-service';
import { selfieSavedOn } from '@/lib/identity/selfie-format';
import { interpolate } from '@/lib/i18n/format';
import { SelfieGrid, selfieName } from './selfie-grid';
import { SelfieUploader } from './selfie-uploader';
import { PhotoCheckNote } from './photo-check-note';
import type { PhotoCheck } from '@/lib/identity/photo-check-view';

/**
 * "이 얼굴로 만들까요?" (founder, 2026-10-22: "매번 모바일에서 얼굴을 안 넣어도 되게 … '해당 얼굴을
 * 활용해서 제작할까요?'"). The studio's photo step once a photo is saved (docs/IDENTITY-SELFIE.md §3):
 *
 *   confirm  the default (or last-used) photo, big, with the question and two answers —
 *            [이 사진으로 만들기] [다른 사진 고르기]; the same card on a phone and a desktop
 *   chosen   the face this order will use, small, with the way to another
 *   chooser  a modal sheet — a bottom sheet on a phone, the same panel centred on a desktop — with
 *            the saved photos to pick from and "take / upload a new one" (at the limit: "change")
 *
 * The chooser is `aria-modal`, keeps Tab inside, closes on Escape or the backdrop, and gives the
 * focus back to the button that opened it. A choice closes it and hands the focus to the parent,
 * which moves it to the pay button (the studio's existing behaviour). Nothing here judges whose
 * face it is: "only photos of you" is said, never automated (PLATFORM-2.0 §4).
 */
type Copy = Dictionary['selfie'];
export type SheetChoice = 'confirm' | 'pick' | 'upload';

/** Escape closes the sheet; Tab must stay inside it; everything else is the browser's. */
export function sheetKeyAction(key: string): 'close' | 'trap' | null {
  if (key === 'Escape' || key === 'Esc') return 'close';
  if (key === 'Tab') return 'trap';
  return null;
}

/**
 * Where Tab has to send the focus to stay inside the sheet: wrap at either edge, pull back focus
 * that escaped (index -1), and leave the middle to the browser (null).
 */
export function trapFocusIndex(current: number, count: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface SelfieSheetProps {
  copy: Copy;
  locale: string;
  /** The photo to offer: the default (the access call's `selfie`). */
  suggested: SelfieView;
  /** The face this order will use, once answered; null asks the question. */
  chosen: SelfieView | null;
  onChoose: (selfie: SelfieView, how: SheetChoice, library: SelfieLibrary | null) => void;
  /** True while the chooser is open, so the parent holds its pay button and its refreshes. */
  onEditingChange?: (open: boolean) => void;
  signinHref?: string;
  /** Say "saved" once, right after the person uploaded their first photo here. */
  justSaved?: boolean;
  /** Server-markup seams for tests: render with the chooser open, on this library. */
  initialOpen?: boolean;
  initialLibrary?: SelfieLibrary | null;
  /** Test seam: the advisory photo check's answer for the shown face, instead of asking the server. */
  initialPhotoCheck?: PhotoCheck | null;
}

export function SelfieSheet({ copy, locale, suggested, chosen, onChoose, onEditingChange, signinHref, justSaved = false, initialOpen = false, initialLibrary = null, initialPhotoCheck }: SelfieSheetProps) {
  const [open, setOpen] = useState(initialOpen);
  const [view, setView] = useState<'grid' | 'upload'>('grid');
  const [library, setLibrary] = useState<SelfieLibrary | null>(initialLibrary);
  const [loadState, setLoadState] = useState<'ready' | 'loading' | 'error'>(initialLibrary || !initialOpen ? 'ready' : 'loading');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [canCapture, setCanCapture] = useState(false);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [theme, setTheme] = useState('light');
  // One frame after opening the sheet rises (a phone) or fades in (a desktop): a CSS transition, no library.
  const [entered, setEntered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const savingRef = useRef(false);
  savingRef.current = saving;
  const titleId = useId();
  const questionId = useId();

  const face = chosen ?? suggested;
  const items = library?.items ?? [];
  const limit = library?.limit ?? 1;
  const full = items.length >= limit;
  // At the limit a new photo replaces the one this order would use (the pressed tile).
  const replaceTarget = items.find(item => item.id === face.id) ?? items.find(item => item.isDefault) ?? items[0] ?? null;

  useEffect(() => {
    setPortal(document.body);
    if (typeof navigator === 'undefined' || !('mediaDevices' in navigator)) return;
    setCanCapture(navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  const load = async () => {
    if (!libraryRef.current) setLoadState('loading');
    try {
      const response = await fetch('/api/identity/selfie', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json().catch(() => ({})) as Partial<SelfieLibrary> & { ok?: boolean; code?: string };
      if (data.code === 'sign_in_required' && signinHref) { window.location.assign(signinHref); return; }
      if (!response.ok || data.ok !== true || !Array.isArray(data.items)) throw Error('library');
      setLibrary({ limit: data.limit ?? 1, defaultId: data.defaultId ?? null, items: data.items });
      setLoadState('ready');
    } catch {
      // A library already on screen stays usable; only an empty sheet shows the retry.
      if (!libraryRef.current) setLoadState('error');
    }
  };

  const openChooser = () => {
    setTheme(rootRef.current?.closest('[data-theme]')?.getAttribute('data-theme') ?? 'light');
    setView('grid');
    setPendingFile(null);
    setReplaceId(null);
    setOpen(true);
    onEditingChange?.(true);
    void load();
  };
  const closeChooser = ({ restore = true, force = false } = {}) => {
    if (savingRef.current && !force) return;
    setOpen(false);
    setView('grid');
    setPendingFile(null);
    setReplaceId(null);
    onEditingChange?.(false);
    // Back to the button that opened the sheet — not document.activeElement, which Safari leaves on <body> after a tap.
    if (restore) otherRef.current?.focus({ preventScroll: true });
  };
  const choose = (selfie: SelfieView, how: SheetChoice, next: SelfieLibrary | null) => {
    if (how !== 'confirm') closeChooser({ restore: false, force: true });
    onChoose(selfie, how, next);
  };
  const startUpload = (file: File | null | undefined, replace: string | null) => {
    if (file && !file.type.startsWith('image/')) return;
    setPendingFile(file ?? null);
    setReplaceId(replace);
    setView('upload');
    if (cameraRef.current) cameraRef.current.value = '';
    if (fileRef.current) fileRef.current.value = '';
  };
  const backToGrid = () => {
    if (savingRef.current) return;
    setView('grid');
    setPendingFile(null);
    setReplaceId(null);
  };

  // While the sheet is open: the page under it does not scroll, and Escape closes it from anywhere.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (sheetKeyAction(event.key) !== 'close') return;
      event.preventDefault();
      closeChooser();
    };
    document.addEventListener('keydown', onKey);
    return () => { root.style.overflow = previous; document.removeEventListener('keydown', onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) { setEntered(false); return; }
    // A frame for the start position to paint; the timer covers a page whose frames are paused (a background tab).
    const enter = () => setEntered(true);
    const frame = requestAnimationFrame(enter);
    const timer = setTimeout(enter, 80);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [open]);
  // Focus on open and on every change of view goes to the title, so the sheet is announced; once the
  // photos are there (and the person has not moved on), it moves to the photo this order would use.
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [open, view]);
  useEffect(() => {
    if (!open || view !== 'grid' || loadState !== 'ready' || document.activeElement !== titleRef.current) return;
    dialogRef.current?.querySelector<HTMLElement>('[data-selfie-pick][aria-pressed="true"]')?.focus({ preventScroll: true });
  }, [open, view, loadState, library]);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (sheetKeyAction(event.key) !== 'trap' || !dialogRef.current) return;
    const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(node => node.getClientRects().length > 0);
    const next = trapFocusIndex(nodes.indexOf(document.activeElement as HTMLElement), nodes.length, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    nodes[next]?.focus();
  };

  const savedOn = selfieSavedOn(copy.savedOn, face.createdAt, locale);
  const detail = [face.label, face.isDefault ? copy.defaultBadge : null, savedOn].filter(Boolean).join(' · ');
  const chooserView = view === 'upload' ? 'upload' : loadState === 'ready' ? 'grid' : loadState;
  // Advice about the face this order would use; "다른 사진 고르기" is the way to another. Never blocks.
  const photoCheck = <PhotoCheckNote selfieId={face.id} copy={copy.photoCheck} onRetake={openChooser} retakeLabel={copy.otherPhotos} {...(initialPhotoCheck !== undefined ? { initial: initialPhotoCheck } : {})} />;

  const dialog = (
    <div data-theme={theme}>
      <div data-selfie-backdrop aria-hidden="true" onClick={() => closeChooser()} className={['fixed inset-0 z-[60] bg-black/60 transition-opacity duration-200 motion-reduce:transition-none', entered ? 'opacity-100' : 'opacity-0'].join(' ')} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-selfie-chooser
        data-selfie-chooser-view={chooserView}
        aria-busy={saving}
        onKeyDown={onDialogKeyDown}
        className={[
          'fixed inset-x-0 bottom-0 z-[61] flex max-h-[88dvh] flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-surface px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-on-surface shadow-[0_-12px_40px_rgba(0,0,0,0.35)]',
          'transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:px-6 sm:pt-5 sm:pb-6',
          entered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 sm:opacity-0',
        ].join(' ')}
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-current opacity-25 sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-lg font-semibold outline-none">{copy.chooserTitle}</h2>
          <button type="button" data-selfie-close aria-label={copy.close} onClick={() => closeChooser()} disabled={saving} className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-30">
            <CloseIcon />
          </button>
        </div>

        <input ref={cameraRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => startUpload(event.currentTarget.files?.[0], null)} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => startUpload(event.currentTarget.files?.[0], null)} />

        {chooserView === 'loading' ? (
          <p role="status" aria-live="polite" className="py-10 text-center text-sm opacity-70">{copy.loading}</p>
        ) : chooserView === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-8">
            <p className="text-sm">{copy.loadError}</p>
            <button type="button" data-selfie-retry onClick={() => void load()} className="inline-flex rounded-full min-h-11 items-center border border-current px-4 font-label text-eyebrow uppercase">{copy.retry}</button>
          </div>
        ) : chooserView === 'grid' ? (
          <div className="mt-4 flex flex-col gap-5">
            <SelfieGrid copy={copy} locale={locale} items={items} limit={limit} mode="pick" selectedId={face.id} onPick={item => choose(item, 'pick', libraryRef.current)} />
            {full ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-hairline p-4">
                <p className="text-sm leading-relaxed">{limit > 1 ? interpolate(copy.limitFull, { limit: String(limit) }) : copy.replaceNote}</p>
                <button type="button" data-selfie-replace disabled={!replaceTarget} onClick={() => startUpload(null, replaceTarget?.id ?? null)} className="inline-flex rounded-full min-h-12 items-center justify-center gap-2 border border-current px-4 font-label text-eyebrow uppercase transition-opacity hover:opacity-70 disabled:opacity-40">
                  <CameraIcon />{copy.change}
                </button>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {canCapture ? (
                  <button type="button" data-selfie-add="camera" onClick={() => cameraRef.current?.click()} className="inline-flex rounded-full min-h-12 items-center justify-center gap-2 bg-accent px-4 font-label text-eyebrow text-white uppercase transition-opacity hover:opacity-85">
                    <CameraIcon />{copy.takeNew}
                  </button>
                ) : null}
                <button type="button" data-selfie-add="file" onClick={() => fileRef.current?.click()} className={['inline-flex rounded-full min-h-12 items-center justify-center gap-2 px-4 font-label text-eyebrow uppercase transition-opacity', canCapture ? 'border border-current hover:opacity-70' : 'bg-accent text-white hover:opacity-85 sm:col-span-2'].join(' ')}>
                  <ImageIcon />{copy.uploadNew}
                </button>
              </div>
            )}
            <p className="text-xs leading-relaxed opacity-60">{copy.onlyYou}</p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            <button type="button" data-selfie-back disabled={saving} onClick={backToGrid} className="inline-flex min-h-11 items-center gap-1 self-start text-sm underline underline-offset-4 disabled:opacity-40">
              ← {copy.backToList}
            </button>
            <p className="text-sm leading-relaxed opacity-75">{replaceId ? (limit > 1 ? interpolate(copy.limitFull, { limit: String(limit) }) : copy.replaceNote) : copy.onlyYou}</p>
            <SelfieUploader
              key={`${replaceId ?? 'add'}:${pendingFile ? `${pendingFile.name}:${pendingFile.size}:${pendingFile.lastModified}` : 'none'}`}
              copy={copy}
              locale={locale}
              initial={null}
              initialFile={pendingFile}
              replaceId={replaceId}
              signinHref={signinHref}
              onBusyChange={setSaving}
              onSaved={(saved, _replaced, next) => { if (next) setLibrary(next); choose(saved, 'upload', next); }}
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} data-selfie-sheet data-selfie-sheet-state={chosen ? 'chosen' : 'confirm'} className="flex flex-col gap-4">
      {chosen ? (
        <>
        <div className="flex items-center gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-2xl bg-black sm:size-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-only private route */}
            <img src={chosen.imageUrl} alt={selfieName(copy, chosen, locale)} width={chosen.width} height={chosen.height} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-5 place-items-center rounded-full bg-accent text-white"><CheckIcon /></span>{copy.chosenTitle}</p>
            {detail ? <p className="mt-1 truncate text-xs opacity-60">{detail}</p> : null}
            <button ref={otherRef} type="button" data-selfie-other onClick={openChooser} className="mt-1 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.otherPhotos}</button>
          </div>
        </div>
        {photoCheck}
        </>
      ) : (
        <section aria-labelledby={questionId} className="flex flex-col gap-4">
          <div className="aspect-[4/5] overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-only private route */}
            <img src={face.imageUrl} alt={selfieName(copy, face, locale)} width={face.width} height={face.height} className="h-full w-full object-cover" />
          </div>
          <div>
            <h4 id={questionId} className="text-xl leading-snug font-semibold">{copy.useThisFace}</h4>
            {detail ? <p className="mt-1 text-xs opacity-60">{detail}</p> : null}
          </div>
          {photoCheck}
          <div className="flex flex-col gap-2">
            <button type="button" data-selfie-use onClick={() => choose(face, 'confirm', libraryRef.current)} className="inline-flex rounded-full min-h-12 w-full items-center justify-center bg-accent px-5 font-label text-[0.8rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85">{copy.useThisPhoto}</button>
            <button ref={otherRef} type="button" data-selfie-other onClick={openChooser} className="inline-flex rounded-full min-h-11 w-full items-center justify-center border border-current px-5 font-label text-eyebrow uppercase transition-opacity hover:opacity-70">{copy.otherPhotos}</button>
          </div>
        </section>
      )}
      <p role="status" aria-live="polite" data-selfie-saved={justSaved ? 'true' : undefined} className={justSaved ? 'text-sm font-medium text-accent' : 'sr-only'}>{justSaved ? copy.savedToast : ''}</p>
      {open ? (portal ? createPortal(dialog, portal) : dialog) : null}
    </div>
  );
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>;
}
function CheckIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
}
function CameraIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2h5.2L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.25" /></svg>;
}
function ImageIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="m20 15-4.5-4.5L8 18" /></svg>;
}
