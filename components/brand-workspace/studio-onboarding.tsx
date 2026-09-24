import type { ReactNode } from "react";
import type { Dictionary } from "@/messages/en";
import type { StudioStage } from "@/lib/brands/production/stage";
import { StudioShowcase } from "./studio-showcase";

type T = Dictionary["brandWorkspace"]["productionStudio"]["onboarding"];
const STEPS = ["request", "design", "select", "create"] as const;

/** The step a brand is on, or null when no single step applies (read-only, allowance used up). */
export function studioStep(stage: StudioStage): number | null {
  switch (stage) {
    case "onboarding": return 0;
    case "requested":
    case "templates-pending": return 1;
    case "ready": return 2;
    default: return null;
  }
}

/** Request → design and contract → template and portrait → create. Steps before `current` read as done. */
export function StudioProcess({ t, current }: { t: T; current: number | null }) {
  return (
    <section className="bw-studio-process" aria-labelledby="studio-process-title" data-studio-process>
      <h2 id="studio-process-title">{t.processTitle}</h2>
      {/* role keeps list semantics in Safari once list-style is removed. */}
      <ol role="list">
        {STEPS.map((key, i) => {
          const state = current === null ? undefined : i < current ? "done" : i === current ? "current" : undefined;
          return (
            <li key={key} data-step={key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="bw-studio-step-number" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <h3>{t.steps[key].title}</h3>
              <p>{t.steps[key].body}</p>
              {state && <span className="bw-studio-step-state">{state === "done" ? t.stepDone : t.stepCurrent}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** First visit, or still waiting for templates: the explanation is the page. */
export function StudioIntro({ t, stage, guide }: { t: T; stage: StudioStage; guide: ReactNode }) {
  return (
    <>
      <StudioProcess t={t} current={studioStep(stage)} />
      <StudioShowcase t={t} />
      {guide}
    </>
  );
}

/** Returning brands: the same explanation, folded away so templates stay at the top. */
export function StudioHelp({ t, stage, guide }: { t: T; stage: StudioStage; guide: ReactNode }) {
  return (
    <details className="bw-studio-help" data-studio-help>
      <summary>{t.helpSummary}</summary>
      <div>
        <StudioIntro t={t} stage={stage} guide={guide} />
      </div>
    </details>
  );
}
