'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * TWINGS §2 — the four-step demo the founder asked for (2026-08-16): "사진만 넣으면 완성도 높은
 * 영상으로 변환된다는 걸 잘 보이게".
 *
 * This is a MOCKUP and says so on screen. No file leaves the browser, no payment is taken, and the
 * film that plays at the end is the studio's own published example rather than a render of the
 * uploaded face. Every one of those is stated in the UI, because a demo that lets someone believe
 * their photo was processed is not a demo — it is a lie with a progress bar.
 *
 * What it IS built to prove: the shape of the product. Pick a style, hand over one photo, pay once,
 * wait, get a finished film. When the real Seedance pipeline lands, only the rendering step
 * changes — the flow, the copy and the waiting UI are already the ones a real render needs.
 */

export interface StudioStyle {
  id: string;
  title: string;
  price: string;
  runtime: string;
  blurb: string;
  posterSrc: string | null;
  videoSrc: string | null;
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
  demoBadge: string;
  rendering: string;
  renderingNote: string;
  resultHeading: string;
  resultNote: string;
  again: string;
  runtimeLabel: string;
}

type Phase = 'photo' | 'style' | 'pay' | 'rendering' | 'result';

const STEP_ORDER: Phase[] = ['photo', 'style', 'pay', 'result'];

/** Long enough that the wait reads as work. A real render takes minutes; 400ms would teach a lie. */
const RENDER_MS = 5200;

export function TwingsStudio({ styles, labels }: { styles: StudioStyle[]; labels: StudioLabels }) {
  const [phase, setPhase] = useState<Phase>('photo');
  const [photo, setPhoto] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<string>(styles[0]?.id ?? '');
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const chosen = styles.find((item) => item.id === styleId) ?? styles[0] ?? null;

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  useEffect(() => {
    if (phase !== 'rendering') return;
    setProgress(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const next = Math.min(100, Math.round(((Date.now() - started) / RENDER_MS) * 100));
      setProgress(next);
      if (next >= 100) {
        window.clearInterval(timer);
        setPhase('result');
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [phase]);

  const takePhoto = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPhoto((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setPhase('style');
  };

  const stepIndex = phase === 'rendering' ? 2 : STEP_ORDER.indexOf(phase);
  const steps = [labels.stepPhoto, labels.stepStyle, labels.stepPay, labels.stepResult];

  return (
    <section data-twings-studio data-phase={phase} className="mt-10">
      {/* The one honest label the whole screen hangs on. */}
      <p
        data-demo-badge
        className="inline-block border border-accent px-3 py-1.5 font-label text-[0.68rem] tracking-[0.12em] text-accent uppercase"
      >
        {labels.demoBadge}
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
          <div
            className="flex aspect-[3/4] cursor-pointer items-center justify-center overflow-hidden bg-black"
            onClick={() => fileRef.current?.click()}
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
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
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
                      if (photo) setPhase('pay');
                    }}
                    className={[
                      'flex flex-col border text-left transition-opacity',
                      style.id === styleId
                        ? 'border-accent'
                        : 'border-hairline opacity-70 hover:opacity-100',
                    ].join(' ')}
                  >
                    <span className="block aspect-video overflow-hidden bg-black">
                      {style.posterSrc && (
                        // eslint-disable-next-line @next/next/no-img-element -- public bucket object
                        <img src={style.posterSrc} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="flex flex-col gap-1 p-3">
                      <span className="font-display text-[1.15rem] leading-[1] font-black uppercase">
                        {style.title}
                      </span>
                      <span className="font-mono text-[0.72rem] opacity-55">{style.blurb}</span>
                      <span className="mt-1 flex items-baseline justify-between font-label text-[0.7rem] tracking-[0.12em] uppercase">
                        <span className="text-accent">{style.price}</span>
                        <span className="opacity-45">
                          {labels.runtimeLabel.replace('{seconds}', style.runtime)}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-auto pt-6">
                <button
                  type="button"
                  data-pay-cta
                  disabled={!photo || !chosen}
                  onClick={() => setPhase('rendering')}
                  className="w-full border border-current px-5 py-4 font-label text-[0.95rem] tracking-[0.1em] text-accent uppercase transition-opacity hover:opacity-70 disabled:opacity-25"
                >
                  {chosen ? labels.payCta.replace('{price}', chosen.price) : labels.payCta}
                </button>
                <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.payNote}</p>
              </div>
            </>
          )}

          {phase === 'rendering' && (
            <div className="flex flex-1 flex-col justify-center">
              <p className="font-display text-[clamp(1.6rem,3vw,2.4rem)] leading-[0.95] font-black uppercase">
                {labels.rendering}
              </p>
              <div
                className="mt-6 h-1 w-full bg-hairline"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-3 font-mono text-[0.78rem] opacity-55">{progress}%</p>
              <p className="mt-6 max-w-detail font-mono text-[0.72rem] opacity-45">
                {labels.renderingNote}
              </p>
            </div>
          )}

          {phase === 'result' && chosen && (
            <div className="flex flex-1 flex-col">
              <p className="font-label text-label uppercase">{labels.resultHeading}</p>
              <div className="mt-4 aspect-video overflow-hidden border border-hairline bg-black">
                {chosen.videoSrc && (
                  <video
                    src={chosen.videoSrc}
                    {...(chosen.posterSrc ? { poster: chosen.posterSrc } : {})}
                    controls
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
              <p className="mt-3 font-mono text-[0.72rem] opacity-45">{labels.resultNote}</p>
              <button
                type="button"
                onClick={() => setPhase('style')}
                className="mt-6 self-start border border-current px-5 py-3 font-label text-eyebrow uppercase transition-opacity hover:opacity-70"
              >
                {labels.again}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
