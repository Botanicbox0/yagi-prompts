'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * TWINGS — the make loop, as a four-step demo (founder, 2026-08-16: "사진만 넣으면 완성도 높은
 * 영상으로 변환된다는 걸 잘 보이게"), re-homed onto the template page (docs/TEMPLATES-IA.md).
 *
 * This is a MOCKUP and says so on screen. No file leaves the browser, no payment is taken, and the
 * film that plays at the end is the template's own published example rather than a render of the
 * uploaded face. Every one of those is stated in the UI, because a demo that lets someone believe
 * their photo was processed is not a demo — it is a lie with a progress bar.
 *
 * Two shapes: the catalogue shape (several styles, pick one) and the TEMPLATE shape (one style,
 * already chosen — the page you are on IS the choice), which skips the picking step entirely.
 * When the real render pipeline lands, only the rendering step changes.
 */

export interface StudioStyle {
  id: string;
  title: string;
  price: string;
  runtime: string;
  blurb: string;
  posterSrc: string | null;
  videoSrc: string | null;
  /** Where "see more" goes from the result — the catalogue this template belongs to. */
  moreHref: string;
  /** The aspects a visitor may pick for this style, and the one it opens in (founder, 2026-09-06). */
  aspects: Array<{ id: string; label: string }>;
  defaultAspect: string;
}

export interface StudioLabels {
  stepPhoto: string;
  stepStyle: string;
  stepPay: string;
  stepResult: string;
  dropZone: string;
  dropHint: string;
  changePhoto: string;
  chooseStyle: string;
  payCta: string;
  payNote: string;
  /** The template page before payment is wired: no mock, a promise with a date attached (founder, 2026-09-11). */
  closedBadge: string;
  closedTitle: string;
  closedBody: string;
  closedCta: string;
  closedDone: string;
  /** What AI-made means, said before the money changes hands (founder, 2026-09-11). */
  aiNote: string;
  runtimeLabel: string;
  needPhoto: string;
  noStyles: string;
  moreTemplates: string;
  aspectLabel: string;
}

/**
 * The live make loop (docs/TEMPLATES-IA.md §8). When the server says this viewer may render for
 * real (`accessEndpoint` → `{ live: true }`), the pay step posts the photo to `endpoint` and the
 * browser moves to the result page. Otherwise the studio is CLOSED: it says payment opens soon and
 * offers one thing — an email the day it does (`interestEndpoint`). There is no demo any more
 * (founder, 2026-09-11): a mock progress bar on a paid product reads as a product that does not work.
 */
export interface StudioLive {
  endpoint: string;
  accessEndpoint: string;
  /** `POST` — records "tell me when it opens" for the signed-in viewer. */
  interestEndpoint: string;
  template: string;
  locale: string;
  /** Where a `sign_in_required` answer sends the reader (back to this template afterwards). */
  signinHref: string;
  /** Where an `identity_required` answer sends them: the one-time face check (docs §8.2). */
  identityHref: string;
  labels: {
    badge: string;
    /** Operators render for real without a charge (founder, 2026-09-10). */
    operatorBadge: string;
    freeCta: string;
    submitting: string;
    identityNotice: string;
    identityPending: string;
    identityCta: string;
    errors: Record<string, string>;
  };
}

type Phase = 'photo' | 'style' | 'pay';

/** The longest edge the photo is sent at. Vercel refuses request bodies above ~4.5MB before any of our code runs. */
const PHOTO_MAX_EDGE = 1600;
const PHOTO_PASSTHROUGH_BYTES = 3_000_000;

/**
 * Downscale in the browser: a phone photo is 3–8MB and the request limit is the platform's, not
 * ours. Anything that cannot be decoded here (HEIC on a non-Apple browser) goes up as it is and
 * the server says what it wants instead.
 */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= PHOTO_PASSTHROUGH_BYTES && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('encode failed');
    return blob;
  } catch {
    return file;
  }
}

export function TwingsStudio({
  styles,
  labels,
  initialStyleId,
  live,
}: {
  styles: StudioStyle[];
  labels: StudioLabels;
  /** Pre-chosen style (the template page); with exactly one style the picking step disappears. */
  initialStyleId?: string;
  /** The live make loop; absent (tests, the catalogue shape) the studio is closed. */
  live?: StudioLive;
}) {
  const single = styles.length === 1;
  const [phase, setPhase] = useState<Phase>('photo');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [charge, setCharge] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [interest, setInterest] = useState(false);
  const [interestBusy, setInterestBusy] = useState(false);
  const [identityRequired, setIdentityRequired] = useState(false);
  const [identity, setIdentity] = useState('not_needed');
  const [submitting, setSubmitting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<string>(initialStyleId ?? styles[0]?.id ?? '');
  const [aspect, setAspect] = useState<string>(styles.find((item) => item.id === (initialStyleId ?? styles[0]?.id))?.defaultAspect ?? styles[0]?.defaultAspect ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = styles.find((item) => item.id === styleId) ?? styles[0] ?? null;

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  // Static page, per-viewer answer: ask once whether this reader renders for real, whether a
  // payment is taken, and whether this template needs their verified face first.
  const accessUrl = live ? `${live.accessEndpoint}?template=${encodeURIComponent(live.template)}` : null;
  useEffect(() => {
    if (accessUrl === null) return;
    let cancelled = false;
    fetch(accessUrl, { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : { live: false }))
      .then((json: { live?: boolean; charge?: boolean; identityRequired?: boolean; identity?: string; signedIn?: boolean; interest?: boolean }) => {
        if (cancelled) return;
        setLiveMode(json.live === true);
        setCharge(json.charge !== false);
        setIdentityRequired(json.identityRequired === true);
        setIdentity(typeof json.identity === 'string' ? json.identity : 'not_needed');
        setSignedIn(json.signedIn === true);
        setInterest(json.interest === true);
      })
      .catch(() => {
        /* closed is the fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [accessUrl]);

  const identityBlocked = liveMode && identityRequired && identity !== 'active';

  const takePhoto = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPhotoFile(file);
    setLiveError(null);
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setPhase(single ? 'pay' : 'style');
  };

  const submitLive = async () => {
    if (!live || !photoFile || !chosen) return;
    setSubmitting(true);
    setLiveError(null);
    try {
      const blob = await shrinkPhoto(photoFile);
      const form = new FormData();
      form.set('template', live.template);
      form.set('aspect', aspect);
      form.set('locale', live.locale);
      form.set('photo', blob, blob.type === 'image/png' ? 'photo.png' : 'photo.jpg');
      // Behind the face check: hold the job with its photo and go verify — the callback starts it.
      if (identityBlocked) form.set('hold', '1');
      const response = await fetch(live.endpoint, { method: 'POST', body: form, credentials: 'same-origin' });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; href?: string; code?: string; held?: boolean; verifyHref?: string };
      if (response.ok && json.ok === true && json.held === true) {
        window.location.assign(typeof json.verifyHref === 'string' ? json.verifyHref : live.identityHref);
        return;
      }
      if (response.ok && json.ok === true && typeof json.href === 'string') {
        window.location.assign(json.href);
        return;
      }
      if (json.code === 'sign_in_required') {
        window.location.assign(live.signinHref);
        return;
      }
      if (json.code === 'identity_required') {
        window.location.assign(live.identityHref);
        return;
      }
      setLiveError(live.labels.errors[json.code ?? ''] ?? live.labels.errors.generic ?? 'error');
    } catch {
      setLiveError(live.labels.errors.generic ?? 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // "Tell me when it opens": signed out, the door; signed in, one POST and the button says so.
  const registerInterest = async () => {
    if (!live || interest || interestBusy) return;
    if (!signedIn) {
      window.location.assign(live.signinHref);
      return;
    }
    setInterestBusy(true);
    try {
      const response = await fetch(live.interestEndpoint, { method: 'POST', credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign(live.signinHref);
        return;
      }
      if (response.ok) setInterest(true);
    } catch {
      /* the button simply stays; nothing was promised */
    } finally {
      setInterestBusy(false);
    }
  };

  // A style whose template is unpublished is dropped upstream; with none left, an empty grid and a
  // permanently disabled button would read as a broken page rather than a closed one.
  if (styles.length === 0) {
    return (
      <section data-twings-studio data-phase="empty" className="mt-10 border-t border-hairline pt-8">
        <p className="max-w-detail text-body opacity-70">{labels.noStyles}</p>
      </section>
    );
  }

  // Closed until the server says otherwise: the static HTML every visitor gets is this panel, and
  // an operator's page swaps to the live loop the moment the access call answers.
  if (!liveMode || !live) {
    return (
      <section data-twings-studio data-phase="closed" data-single={single ? 'true' : 'false'} data-live="false" className="mt-10">
        <p data-studio-closed className="inline-block border border-accent px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase">
          {labels.closedBadge}
        </p>
        <div className="mt-6 max-w-detail border border-hairline p-6 sm:p-8">
          <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{labels.closedTitle}</p>
          <p className="mt-4 text-body opacity-70">{labels.closedBody}</p>
          <p data-studio-ai-note className="mt-4 font-mono text-[0.72rem] leading-relaxed opacity-45">{labels.aiNote}</p>
          <button
            type="button"
            data-studio-interest={interest ? 'done' : 'open'}
            disabled={!live || interest || interestBusy}
            onClick={() => void registerInterest()}
            className="mt-7 inline-block border border-current px-6 py-3 font-label text-label uppercase transition-opacity hover:opacity-70 disabled:opacity-60"
          >
            {interest ? labels.closedDone : `${labels.closedCta} →`}
          </button>
        </div>
      </section>
    );
  }

  // The step bar: three steps on a template page (the choice is the page), four in the catalogue.
  const steps = single
    ? [labels.stepPhoto, labels.stepPay, labels.stepResult]
    : [labels.stepPhoto, labels.stepStyle, labels.stepPay, labels.stepResult];
  const stepIndex = (() => {
    if (phase === 'photo') return 0;
    if (single) return 1;
    return phase === 'style' ? 1 : 2;
  })();

  return (
    <section data-twings-studio data-phase={phase} data-single={single ? 'true' : 'false'} data-aspect={aspect} data-live={liveMode ? 'true' : 'false'} data-live-charge={liveMode && charge ? 'true' : 'false'} className="mt-10">
      {/* The one honest label the whole screen hangs on: where the result goes, and whether a payment is taken. */}
      <p
        data-live-badge
        className="inline-block border border-accent px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase"
      >
        {charge ? live.labels.badge : live.labels.operatorBadge}
      </p>

      <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-label text-[0.68rem] tracking-[0.12em] uppercase">
        {steps.map((label, index) => (
          <li
            key={label}
            data-step={index}
            aria-current={index === stepIndex ? 'step' : undefined}
            className={index <= stepIndex ? 'text-accent' : 'opacity-35'}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="border border-hairline">
          <label
            htmlFor="studio-photo"
            className="flex aspect-[3/4] cursor-pointer items-center justify-center overflow-hidden bg-black focus-within:outline focus-within:outline-2 focus-within:outline-accent"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              takePhoto(event.dataTransfer.files?.[0]);
            }}
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL
              <img src={photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="px-6 text-center text-white/70">
                <p className="font-label text-label uppercase">{labels.dropZone}</p>
                <p className="mt-2 font-mono text-[0.72rem] text-white/45">{labels.dropHint}</p>
              </div>
            )}
          </label>
          <input
            ref={fileRef}
            id="studio-photo"
            type="file"
            accept="image/*"
            aria-label={labels.dropZone}
            className="sr-only"
            onChange={(event) => takePhoto(event.currentTarget.files?.[0])}
          />
          {photo && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-t border-hairline px-4 py-3 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
            >
              {labels.changePhoto}
            </button>
          )}
        </div>

        <div className="flex flex-col">
          {(phase === 'photo' || phase === 'style' || phase === 'pay') && (
            <>
              {single && chosen ? (
                // The template page: the choice is made, so the panel states it instead of asking.
                <div data-chosen-style={chosen.id} className="flex items-baseline justify-between gap-4 border-b border-hairline pb-4">
                  <span className="font-display text-[1.3rem] leading-[1] font-black uppercase">{chosen.title}</span>
                  <span className="flex items-baseline gap-3 font-label text-[0.7rem] tracking-[0.12em] uppercase">
                    <span className="text-accent">{chosen.price}</span>
                    {chosen.runtime !== '0' && (
                      <span className="opacity-45">{labels.runtimeLabel.replace('{seconds}', chosen.runtime)}</span>
                    )}
                  </span>
                </div>
              ) : (
                <>
                  <p className="font-label text-label uppercase">{labels.chooseStyle}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {styles.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        data-style-option={style.id}
                        aria-pressed={style.id === styleId}
                        onClick={() => {
                          setStyleId(style.id);
                          setAspect(style.defaultAspect);
                          if (photo) setPhase('pay');
                        }}
                        className={[
                          'flex flex-col border text-left transition-opacity',
                          style.id === styleId ? 'border-accent' : 'border-hairline opacity-70 hover:opacity-100',
                        ].join(' ')}
                      >
                        <span className="block aspect-video overflow-hidden bg-black">
                          {style.posterSrc && (
                            // eslint-disable-next-line @next/next/no-img-element -- public bucket object
                            <img src={style.posterSrc} alt="" className="h-full w-full object-cover" />
                          )}
                        </span>
                        <span className="flex flex-col gap-1 p-3">
                          <span className="font-display text-[1.15rem] leading-[1] font-black uppercase">{style.title}</span>
                          <span className="font-mono text-[0.72rem] opacity-55">{style.blurb}</span>
                          <span className="mt-1 flex items-baseline justify-between font-label text-[0.7rem] tracking-[0.12em] uppercase">
                            <span className="text-accent">{style.price}</span>
                            <span className="opacity-45">{labels.runtimeLabel.replace('{seconds}', style.runtime)}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* The aspect: Instagram's feed (4:5) by default, the rest one press away. */}
              {chosen && chosen.aspects.length > 1 && (
                <fieldset data-aspect-picker className="mt-5">
                  <legend className="font-label text-eyebrow uppercase opacity-60">{labels.aspectLabel}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {chosen.aspects.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-aspect-option={option.id}
                        aria-pressed={option.id === aspect}
                        onClick={() => setAspect(option.id)}
                        className={[
                          'border px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] uppercase transition-opacity',
                          option.id === aspect ? 'border-accent text-accent' : 'border-hairline opacity-60 hover:opacity-100',
                        ].join(' ')}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="mt-auto pt-6">
                {identityBlocked && live && (
                  <p data-identity-notice={identity} className="mb-3 border border-accent px-4 py-3 text-[0.9rem] leading-relaxed">
                    {identity === 'pending' ? live.labels.identityPending : live.labels.identityNotice}
                  </p>
                )}
                <button
                  type="button"
                  data-pay-cta
                  disabled={!photo || !chosen || submitting}
                  aria-describedby={photo ? undefined : 'studio-cta-hint'}
                  onClick={() => {
                    // With a photo the press stores it and goes to the check (held job); without one, just the check.
                    if (identityBlocked && !photoFile) window.location.assign(live.identityHref);
                    else void submitLive();
                  }}
                  className="w-full border border-current px-5 py-4 font-label text-[0.95rem] tracking-[0.1em] text-accent uppercase transition-opacity hover:opacity-70 disabled:opacity-25"
                >
                  {submitting
                    ? live.labels.submitting
                    : identityBlocked
                      ? live.labels.identityCta
                      : !charge
                        ? live.labels.freeCta
                        : chosen
                          ? labels.payCta.replace('{price}', chosen.price)
                          : labels.payCta}
                </button>
                <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.payNote}</p>
                <p data-studio-ai-note className="mt-2 font-mono text-[0.72rem] leading-relaxed opacity-45">{labels.aiNote}</p>
                {liveError && (
                  <p data-live-error role="alert" className="mt-2 font-mono text-[0.72rem] text-accent">
                    {liveError}
                  </p>
                )}
                {!photo && (
                  <p id="studio-cta-hint" data-studio-hint className="mt-2 font-mono text-[0.72rem] text-accent">
                    {labels.needPhoto}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
