'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import { sheetKeyAction, trapFocusIndex } from '@/components/identity/selfie-sheet';
import type { TemplateLook } from '@/lib/template-look/look';
import { setFirstRunPending, snoozeLookQuestion } from '@/lib/template-look/store';
import { LookChoice, postTemplateLook, type TemplateLookCopy } from '@/components/template-look/look-island';

/**
 * The first-run sheet (docs/PLATFORM-2.0.md §3.2-1, founder 2026-10-22): the first time a new account
 * reaches the video catalogue, one sheet with three cards — "① 포맷을 고르세요 ② 정면 셀카 한 장
 * ③ 완성되면 알려드려요" — and, on the last, "내 사진 미리 올려두기" or "포맷 보러 가기".
 *
 * The catalogue is static HTML, so this is a small client island: the server renders NOTHING, and
 * the browser asks `GET /api/account/onboarding` once. Only an explicit `{ show: true }` (a signed-in
 * account with `profiles.onboarded_at` still NULL) opens it. Any way out — skip, close, Escape, the
 * backdrop, either button — records the dismissal once (`POST`), so it never comes back.
 *
 * Same shape and motion as the selfie chooser (components/identity/selfie-sheet.tsx): a bottom sheet
 * on a phone, the same panel centred on a desktop, `aria-modal`, Tab kept inside, a CSS transition
 * that `prefers-reduced-motion` turns off.
 */
type Copy = Dictionary['firstRun'];

const ENDPOINT = '/api/account/onboarding';
const STEPS = 3;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** "내 사진 미리 올려두기": the photo page, which sends the reader back to the catalogue afterwards. */
export function firstRunSelfieHref(locale: string): string {
  return `/identity/selfie?${new URLSearchParams({ next: `/${locale}/video` })}`;
}

/** Only an explicit yes opens the sheet; anything else (signed out, seen, an error) draws nothing. */
export function shouldShowFirstRun(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && (answer as { show?: unknown }).show === true;
}

/** docs/PERSONAL-STUDIO.md §3.4.10 — the same answer says whether the template style is still to be chosen (switch on). */
export function firstRunAsksLook(answer: unknown): boolean {
  return shouldShowFirstRun(answer) && (answer as { lookUnset?: unknown }).lookUnset === true;
}

/**
 * One POST however many ways the sheet is closed. `keepalive` lets the record outlive a navigation
 * ("내 사진 미리 올려두기" leaves the page at once). A failure is swallowed: the sheet still closes,
 * and at worst it is offered once more on the next visit.
 */
export function createOnboardingRecorder(endpoint: string = ENDPOINT, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  let sent: Promise<void> | null = null;
  return {
    record(): Promise<void> {
      sent ??= fetchImpl(endpoint, { method: 'POST', credentials: 'same-origin', keepalive: true }).then(
        () => undefined,
        () => undefined,
      );
      return sent;
    },
  };
}

export function FirstRunSheet({ copy, locale, endpoint = ENDPOINT, initialOpen = false, initialStep = 0, look, initialAskLook = false }: {
  copy: Copy;
  locale: string;
  endpoint?: string;
  /** Server-markup seams for tests: render open, on this card (0-based). */
  initialOpen?: boolean;
  initialStep?: number;
  /**
   * docs/PERSONAL-STUDIO.md §3.4.10 — the template style words, handed in only with `TWINGS_TEMPLATE_LOOK=on`. Then the
   * first card also asks the style when the account has none (the answer's `lookUnset`), and the standalone question
   * waits while this sheet decides. Absent, the sheet is exactly as before.
   */
  look?: TemplateLookCopy;
  /** Test seam: render the style question on the first card. */
  initialAskLook?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), STEPS - 1));
  const [entered, setEntered] = useState(false);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [askLook, setAskLook] = useState(Boolean(look) && initialAskLook);
  const [chosenLook, setChosenLook] = useState<TemplateLook | null>(null);
  const [lookBusy, setLookBusy] = useState(false);
  const recorder = useRef(createOnboardingRecorder(endpoint));
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const lookLineId = useId();
  const lookOn = Boolean(look);

  // §3.4.10: while this sheet is deciding (and while it asks), the standalone style question waits.
  useLayoutEffect(() => {
    if (!lookOn || initialOpen) return;
    setFirstRunPending(true);
    return () => setFirstRunPending(false);
  }, [lookOn, initialOpen]);

  // Ask once. A static page cannot know who is reading it; the session can.
  useEffect(() => {
    setPortal(document.body);
    if (initialOpen) return;
    let cancelled = false;
    fetch(endpoint, { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: unknown) => {
        if (cancelled) return;
        if (shouldShowFirstRun(answer)) {
          if (lookOn) setAskLook(firstRunAsksLook(answer));
          setOpen(true);
        } else if (lookOn) setFirstRunPending(false);
      })
      .catch(() => { if (!cancelled && lookOn) setFirstRunPending(false); });
    return () => { cancelled = true; };
  }, [endpoint, initialOpen, lookOn]);

  const dismiss = () => {
    setOpen(false);
    void recorder.current.record();
    if (lookOn) {
      // Closed without a style: it stays unset (everything visible) and is not asked again today.
      if (askLook && chosenLook === null) snoozeLookQuestion();
      setFirstRunPending(false);
    }
  };

  const chooseLook = async (next: TemplateLook) => {
    setLookBusy(true);
    const stored = await postTemplateLook(next);
    setLookBusy(false);
    if (stored) setChosenLook(next);
  };

  // While open: the page under it does not scroll, and Escape closes it from anywhere.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (sheetKeyAction(event.key) !== 'close') return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => { root.style.overflow = previous; document.removeEventListener('keydown', onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) { setEntered(false); return; }
    const enter = () => setEntered(true);
    const frame = requestAnimationFrame(enter);
    const timer = setTimeout(enter, 80);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [open]);
  // Each card is announced: focus goes to its title when the sheet opens and on every Next/Back.
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [open, step]);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (sheetKeyAction(event.key) !== 'trap' || !dialogRef.current) return;
    const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.getClientRects().length > 0);
    const next = trapFocusIndex(nodes.indexOf(document.activeElement as HTMLElement), nodes.length, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    nodes[next]?.focus();
  };

  if (!open) return null;

  const cards = [
    { title: copy.step1Title, body: copy.step1Body, art: <FormatArt /> },
    { title: copy.step2Title, body: copy.step2Body, art: <SelfieArt /> },
    { title: copy.step3Title, body: copy.step3Body, art: <BellArt /> },
  ];
  const card = cards[step]!;
  const last = step === STEPS - 1;
  const secondary = 'inline-flex min-h-12 items-center justify-center border border-current px-5 font-label text-[0.8rem] tracking-[0.1em] uppercase transition-opacity hover:opacity-70';
  const primary = 'inline-flex min-h-12 items-center justify-center bg-accent px-5 font-label text-[0.8rem] tracking-[0.1em] text-white uppercase transition-opacity hover:opacity-85';

  const dialog = (
    <div data-theme="light">
      <div data-onboarding-backdrop aria-hidden="true" onClick={dismiss} className={['fixed inset-0 z-[60] bg-black/60 transition-opacity duration-200 motion-reduce:transition-none', entered ? 'opacity-100' : 'opacity-0'].join(' ')} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.label}
        aria-describedby={bodyId}
        data-onboarding-sheet
        data-onboarding-step={step + 1}
        onKeyDown={onDialogKeyDown}
        className={[
          'fixed inset-x-0 bottom-0 z-[61] flex max-h-[88dvh] flex-col overflow-y-auto overscroll-contain rounded-t-3xl bg-surface px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-on-surface shadow-[0_-12px_40px_rgba(0,0,0,0.35)]',
          'transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:w-[min(28rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:px-7 sm:pt-6 sm:pb-7',
          entered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 sm:opacity-0',
        ].join(' ')}
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-current opacity-25 sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-black/70" aria-hidden="true">{interpolate(copy.progress, { current: String(step + 1), total: String(STEPS) })}</p>
          <div className="flex items-center gap-1">
            {!last && (
              <button type="button" data-onboarding-skip onClick={dismiss} className="inline-flex min-h-11 items-center px-2 text-sm underline underline-offset-4">{copy.skip}</button>
            )}
            <button type="button" data-onboarding-close aria-label={copy.close} onClick={dismiss} className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full transition-opacity hover:opacity-70">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-5">
          <div className="grid h-28 place-items-center rounded-2xl bg-black/[0.04]">{card.art}</div>
          <div>
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-xl leading-snug font-semibold outline-none">
              <span className="text-accent">{step + 1}.</span> {card.title}
            </h2>
            <p id={bodyId} className="mt-2 text-[0.95rem] leading-relaxed text-black/75">{card.body}</p>
            {/* §3.4.10: the style, asked here once instead of on the list, on the card about picking a format. */}
            {look && askLook && step === 0 && (
              <div className="mt-4">
                <LookChoice copy={look} chosen={chosenLook} busy={lookBusy} onChoose={(next) => void chooseLook(next)} lineId={lookLineId} />
              </div>
            )}
          </div>
          <ol aria-hidden="true" className="flex justify-center gap-2">
            {cards.map((_, index) => (
              <li key={index} data-onboarding-dot={index + 1} className={['h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none', index === step ? 'w-6 bg-accent' : 'w-1.5 bg-black/25'].join(' ')} />
            ))}
          </ol>
          {last ? (
            <div className="flex flex-col gap-2">
              <a href={firstRunSelfieHref(locale)} data-onboarding-upload onClick={() => void recorder.current.record()} className={primary}>{copy.uploadCta}</a>
              <button type="button" data-onboarding-browse onClick={dismiss} className={secondary}>{copy.browseCta}</button>
              <button type="button" data-onboarding-back onClick={() => setStep(step - 1)} className="inline-flex min-h-11 items-center justify-center text-sm underline underline-offset-4">{copy.back}</button>
            </div>
          ) : (
            <div className={step === 0 ? 'flex' : 'grid grid-cols-2 gap-2'}>
              {step > 0 && <button type="button" data-onboarding-back onClick={() => setStep(step - 1)} className={secondary}>{copy.back}</button>}
              <button type="button" data-onboarding-next onClick={() => setStep(step + 1)} className={`${primary} ${step === 0 ? 'w-full' : ''}`}>{copy.next}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return portal ? createPortal(dialog, portal) : dialog;
}

function FormatArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 80" className="h-20 w-auto text-black/80" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x="10" y="12" width="28" height="44" rx="4" />
      <rect x="46" y="6" width="28" height="56" rx="4" className="text-accent" stroke="currentColor" />
      <rect x="82" y="12" width="28" height="44" rx="4" />
      <path d="M56 26v16l13-8z" fill="currentColor" className="text-accent" stroke="none" />
      <path d="M52 72h16" strokeLinecap="round" className="text-accent" stroke="currentColor" />
    </svg>
  );
}

function SelfieArt() {
  return (
    <span className="block h-24 w-[4.8rem] overflow-hidden rounded-xl ring-2 ring-blue">
      {/* eslint-disable-next-line @next/next/no-img-element -- the public photo guide */}
      <img src="/images/portrait-guide/front-facing.webp" alt="" width={77} height={96} className="h-full w-full object-cover object-[50%_25%]" />
    </span>
  );
}

function BellArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-16 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
