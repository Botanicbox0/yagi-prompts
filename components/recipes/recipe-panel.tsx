'use client';

import { useEffect, useState } from 'react';
import type { PublicRecipe, RecipeInput, RecipeOutline } from '@/lib/recipes/public';
import { CopyPrompt } from './copy-prompt';

/**
 * "만드는 법" on a template page (docs/PLATFORM-2.0.md §7.3·§20.3) — the creative's tutorial.
 *
 * The page is static, so it renders the OUTLINE for everyone: the intro, each step's kind, engine
 * and inputs, how many source files there are — with the prompts drawn as locked lines and a sign-in
 * door. Once mounted, this island asks `/api/recipes/{id}` for the full recipe; a signed-in member
 * gets it (the prompts with copy buttons, the creative's tips, the source files to open or
 * download), anyone else gets 401 and the door stays. The full text is never in the page's HTML.
 */
export interface RecipePanelCopy {
  heading: string; lede: string; step: string; copy: string; copied: string; assets: string; stepsCount: string; filesCount: string; inputs: string;
  lockedTitle: string; lockedBody: string; signIn: string; loading: string; error: string; seeAll: string; showLess: string; download: string; open: string;
  make: string; hidden: string; stepImage: string; stepVideo: string; selfieLabel: string; referenceLabel: string; stepResultLabel: string; credit: string | null;
}

type State = { kind: 'checking' } | { kind: 'locked' } | { kind: 'full'; recipe: PublicRecipe } | { kind: 'error' };

const LONG = 420;

function inputLabel(input: RecipeInput, copy: RecipePanelCopy): string {
  if (input.kind === 'selfie') return copy.selfieLabel;
  if (input.kind === 'reference') return copy.referenceLabel.replace('{n}', String(input.n));
  return copy.stepResultLabel.replace('{n}', String(input.n));
}

function Prompt({ text, copy }: { text: string; copy: RecipePanelCopy }) {
  const [open, setOpen] = useState(text.length <= LONG);
  return (
    <div className="relative">
      <p data-recipe-prompt className={`font-mono text-[0.82rem] leading-relaxed whitespace-pre-wrap break-words text-black/85 ${open ? '' : 'max-h-44 overflow-hidden'}`}>{text}</p>
      {!open && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--surface)] to-transparent" />}
      {text.length > LONG && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-2 inline-flex min-h-9 items-center text-xs font-medium underline underline-offset-4">{open ? copy.showLess : copy.seeAll}</button>
      )}
    </div>
  );
}

function LockedLines() {
  return (
    <div aria-hidden="true" data-recipe-locked-lines className="space-y-2 select-none">
      {[92, 100, 78, 96, 64].map((width, i) => <span key={i} className="block h-2.5 rounded-full bg-black/[0.07]" style={{ width: `${width}%` }} />)}
    </div>
  );
}

export function RecipePanel({ templateId, locale, outline, copy, signInHref, makeHref }: {
  templateId: string; locale: string; outline: RecipeOutline; copy: RecipePanelCopy; signInHref: string; makeHref: string | null;
}) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  useEffect(() => {
    let live = true;
    fetch(`/api/recipes/${templateId}?locale=${locale}`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!live) return;
        if (response.status === 401) return setState({ kind: 'locked' });
        const body = (await response.json().catch(() => null)) as { recipe?: PublicRecipe } | null;
        setState(response.ok && body?.recipe ? { kind: 'full', recipe: body.recipe } : { kind: 'error' });
      })
      .catch(() => { if (live) setState({ kind: 'error' }); });
    return () => { live = false; };
  }, [templateId, locale]);

  const full = state.kind === 'full' ? state.recipe : null;
  const steps = outline.steps ?? [];
  const fileCount = outline.files?.length ?? 0;
  const locked = state.kind === 'locked';

  return (
    <section id="recipe" data-recipe-how data-recipe-state={state.kind} data-presentation={outline.presentation} className="mt-16 scroll-mt-24 border-t border-hairline pt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{copy.heading}</h2>
          {copy.credit && <p className="mt-2 font-mono text-xs text-black/55">{copy.credit}</p>}
        </div>
        <p className="font-mono text-xs text-black/55">
          {[steps.length ? copy.stepsCount.replace('{n}', String(steps.length)) : null, fileCount ? copy.filesCount.replace('{n}', String(fileCount)) : null].filter(Boolean).join(' · ')}
        </p>
      </div>
      {outline.intro
        ? <p data-recipe-intro className="mt-5 max-w-detail text-[0.95rem] leading-relaxed whitespace-pre-line text-black/80">{outline.intro}</p>
        : <p className="mt-3 max-w-detail text-sm leading-relaxed text-black/70">{copy.lede}</p>}

      {steps.length > 0 && (
        <ol className="relative mt-8 space-y-4 before:absolute before:top-4 before:bottom-4 before:left-[1.05rem] before:w-px before:bg-hairline">
          {steps.map((step) => {
            const detail = full?.steps?.find((item) => item.n === step.n) ?? null;
            return (
              <li key={step.n} data-recipe-how-step={step.n} className="relative pl-12">
                <span aria-hidden="true" className="absolute top-3 left-0 inline-flex size-[2.1rem] items-center justify-center rounded-full bg-black font-mono text-xs text-white">{String(step.n).padStart(2, '0')}</span>
                <div className="rounded-2xl border border-hairline bg-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">
                      {copy.step.replace('{n}', String(step.n)).replace('{kind}', step.kind === 'image' ? copy.stepImage : copy.stepVideo)}
                      <span className="ml-2 rounded-md bg-black/[0.05] px-2 py-0.5 font-mono text-[0.7rem] font-normal tracking-wide text-black/70">{step.engine}</span>
                    </p>
                    {detail && <CopyPrompt text={detail.prompt} label={copy.copy} done={copy.copied} />}
                  </div>
                  <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-black/60">
                    <span className="mr-1">{copy.inputs}</span>
                    {step.inputs.map((input, i) => (
                      <span key={i} className={`rounded-full border px-2 py-0.5 ${input.kind === 'selfie' ? 'border-accent text-accent' : 'border-hairline text-black/75'}`}>{inputLabel(input, copy)}</span>
                    ))}
                  </p>
                  <div className="mt-4">
                    {detail ? <Prompt text={detail.prompt} copy={copy} /> : <LockedLines />}
                  </div>
                  {detail?.note && <p data-recipe-note className="mt-4 rounded-xl bg-black/[0.035] px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-black/80">{detail.note}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {fileCount > 0 && (
        <div className="mt-8">
          <p className="text-sm font-semibold">{copy.assets}</p>
          <ul data-recipe-how-files className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {(full?.files ?? outline.files!.map((file, i) => ({ n: i + 1, kind: file.kind, href: '', download: '' }))).map((file) => (
              <li key={file.n} className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-xl border border-hairline bg-black/[0.04]">
                  {file.href
                    ? file.kind === 'image'
                      // eslint-disable-next-line @next/next/no-img-element -- member-only gateway file
                      ? <img src={file.href} alt={copy.referenceLabel.replace('{n}', String(file.n))} loading="lazy" className="h-full w-full object-cover" />
                      : <video src={`${file.href}#t=0.1`} aria-label={copy.referenceLabel.replace('{n}', String(file.n))} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    : <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-black/30">
                        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                      </span>}
                  <span className="absolute top-1.5 left-1.5 rounded-md bg-white/90 px-1.5 py-0.5 font-mono text-[0.65rem] text-black/75">{copy.referenceLabel.replace('{n}', String(file.n))}</span>
                </div>
                {file.href && (
                  <div className="mt-1.5 flex gap-2 text-xs">
                    <a href={file.download} data-recipe-download={file.n} className="inline-flex min-h-9 items-center font-medium underline underline-offset-4">{copy.download}</a>
                    <a href={file.href} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-black/60 underline-offset-4 hover:underline">{copy.open}</a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {full?.outro && <p data-recipe-outro className="mt-8 max-w-detail text-sm leading-relaxed whitespace-pre-line text-black/75">{full.outro}</p>}

      {locked && (
        <div data-recipe-door className="mt-8 flex flex-col gap-4 rounded-2xl bg-black p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="text-base font-semibold">{copy.lockedTitle}</p>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-white/70">{copy.lockedBody}</p>
          </div>
          <a href={signInHref} data-recipe-signin className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-opacity hover:opacity-90">{copy.signIn}</a>
        </div>
      )}
      {state.kind === 'checking' && <p role="status" className="mt-6 text-xs text-black/50">{copy.loading}</p>}
      {state.kind === 'error' && <p role="alert" className="mt-6 text-sm text-black/70">{copy.error}</p>}
      {makeHref && (full || locked) && (
        <a href={makeHref} data-recipe-make className="mt-5 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{copy.make} →</a>
      )}
    </section>
  );
}
