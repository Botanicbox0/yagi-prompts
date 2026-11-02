import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { RENDER_STAGES, stageSteps, type RenderStage } from './stage';

/**
 * docs/PLATFORM-2.0.md §3.2-4 — the three stages, the measured estimate, and what to do with the
 * time. Server-rendered: the page refreshes itself (`AutoRefresh`), so the stage moves without
 * any client state here.
 *
 * Accessibility: the strip is one `progressbar` (step n of 3, with the step's name as its value
 * text) and the visual steps are an ordered list with `aria-current="step"`. Nothing animates —
 * a pulsing bar promised motion the server could not measure.
 */
export function RenderStages({ stage, minutes, dict }: { stage: RenderStage; minutes: number; dict: Dictionary }) {
  const r = dict.renders;
  const w = r.wait;
  const steps = stageSteps(stage);
  const at = RENDER_STAGES.indexOf(stage) + 1;

  return (
    <section data-render-waiting data-render-stage={stage} className="mt-8 max-w-detail">
      <p className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black">{w.title}</p>

      <div
        role="progressbar"
        aria-label={r.progressLabel}
        aria-valuemin={1}
        aria-valuemax={RENDER_STAGES.length}
        aria-valuenow={at}
        aria-valuetext={interpolate(w.progressText, { step: String(at), label: w.steps[stage] })}
        className="mt-6"
      >
        <ol className="grid grid-cols-3 gap-2">
          {steps.map(({ key, state }, index) => (
            <li
              key={key}
              data-stage-step={key}
              data-stage-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              className="min-w-0"
            >
              <span
                aria-hidden
                className={`block h-1.5 rounded-full ${state === 'todo' ? 'bg-hairline' : 'bg-accent'}`}
              />
              <span className={`mt-2 flex items-center gap-1.5 text-[0.8125rem] leading-tight ${state === 'current' ? 'font-semibold text-black' : state === 'done' ? 'text-black' : 'text-black/60'}`}>
                <span aria-hidden className="tabular-nums">{state === 'done' ? '✓' : `${index + 1}`}</span>
                <span className="break-keep">{w.steps[key]}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-6 text-body">{w.body[stage]}</p>
      <p data-render-eta className="mt-2 text-body text-black/70">
        {stage === 'finish' ? w.finishEta : interpolate(w.eta, { minutes: String(minutes) })} {w.etaNote}
      </p>
    </section>
  );
}
