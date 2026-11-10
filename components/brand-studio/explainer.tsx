"use client";
/**
 * First-use explanation shared by the image, video and review screens (docs/BRAND-STUDIO-V3.md §3).
 *
 * A hero (title, one line, up to two actions, an optional media slot) followed by three to six
 * numbered step cards. "다시 보지 않기" folds it to a small "설명 다시 보기" link, remembered in
 * localStorage under `storageKey`.
 *
 * The server cannot know whether this browser dismissed it, so the first paint keeps the section
 * `hidden` (its text is still in the markup) and the browser decides right after hydration: a returning
 * person never sees the hero flash open and shut. An action with `event` dispatches that window
 * CustomEvent (seams.ts `announce`); one with `href` is a plain link.
 *
 * Techniques (docs/design/TOOLBOX.md §1-3): alabaster/white layering, concentric radius, tabular step
 * numbers, a blur-to-sharp reveal that reduced motion turns off.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { announce } from "./seams";
import s from "./explainer.module.css";

export interface ExplainerStep {
  title: string;
  line: string;
  media?: ReactNode;
}
export interface ExplainerAction {
  label: string;
  href?: string;
  event?: string;
  primary?: boolean;
  /** Optional `detail` for the dispatched event. */
  detail?: unknown;
}
export interface ExplainerProps {
  storageKey: string;
  title: string;
  line: string;
  actions?: ExplainerAction[];
  media?: ReactNode;
  stepsTitle?: string;
  steps: ExplainerStep[];
  dismissLabel: string;
  reopenLabel: string;
  /** Extra class on the outer section (spacing from the screen that mounts it). */
  className?: string;
  /** Start folded on a first visit too (the screen already shows enough). Default false. */
  defaultClosed?: boolean;
}

type ExplainerState = "pending" | "open" | "closed";

const DISMISSED = "1";

/** `true` when this browser chose "다시 보지 않기" for `storageKey`. Storage errors read as not dismissed. */
export function explainerDismissed(storageKey: string): boolean | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === null ? null : value === DISMISSED;
  } catch {
    return null;
  }
}

function remember(storageKey: string, dismissed: boolean): void {
  try {
    window.localStorage.setItem(storageKey, dismissed ? DISMISSED : "0");
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

export function Explainer({
  storageKey,
  title,
  line,
  actions = [],
  media,
  stepsTitle,
  steps,
  dismissLabel,
  reopenLabel,
  className,
  defaultClosed = false,
}: ExplainerProps) {
  const [state, setState] = useState<ExplainerState>("pending");
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const moved = useRef<"open" | "closed" | null>(null);

  useEffect(() => {
    const stored = explainerDismissed(storageKey);
    setState(stored === null ? (defaultClosed ? "closed" : "open") : stored ? "closed" : "open");
  }, [storageKey, defaultClosed]);

  // Keyboard focus follows the person's own choice, never the first decision after load.
  useEffect(() => {
    if (moved.current === "closed" && state === "closed") reopen.current?.focus();
    if (moved.current === "open" && state === "open") heading.current?.focus();
    moved.current = null;
  }, [state]);

  const dismiss = () => {
    remember(storageKey, true);
    moved.current = "closed";
    setState("closed");
  };
  const show = () => {
    remember(storageKey, false);
    moved.current = "open";
    setState("open");
  };

  const shownSteps = steps.slice(0, 6);
  const shownActions = actions.slice(0, 2);
  const rootClass = [s.root, className].filter(Boolean).join(" ");

  if (state === "closed") {
    return (
      <section className={rootClass} data-studio-explainer={storageKey} data-explainer-state="closed" aria-label={title}>
        <button ref={reopen} type="button" className={s.reopen} onClick={show} data-explainer-reopen>
          <svg viewBox="0 0 20 20" aria-hidden="true" className={s.reopenIcon}>
            <circle cx="10" cy="10" r="7.25" />
            <path d="M10 9v4.5M10 6.6v.1" />
          </svg>
          {reopenLabel}
        </button>
      </section>
    );
  }

  return (
    <section
      className={rootClass}
      data-studio-explainer={storageKey}
      data-explainer-state={state}
      aria-labelledby={titleId}
      hidden={state === "pending"}
    >
      <div className={s.hero} data-explainer-hero data-has-media={media ? "true" : "false"}>
        <div className={s.copy}>
          <h2 id={titleId} ref={heading} tabIndex={-1} className={s.title}>
            {title}
          </h2>
          <p className={s.line}>{line}</p>
          {shownActions.length > 0 && (
            <div className={s.actions} data-explainer-actions>
              {shownActions.map((action) =>
                action.href ? (
                  <a
                    key={action.label}
                    href={action.href}
                    className={action.primary ? s.primary : s.secondary}
                    data-explainer-action={action.primary ? "primary" : "secondary"}
                    onClick={action.event ? () => announce(action.event!, action.detail) : undefined}
                  >
                    {action.label}
                  </a>
                ) : (
                  <button
                    key={action.label}
                    type="button"
                    className={action.primary ? s.primary : s.secondary}
                    data-explainer-action={action.primary ? "primary" : "secondary"}
                    onClick={() => (action.event ? announce(action.event, action.detail) : undefined)}
                  >
                    {action.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
        {media ? (
          <div className={s.media} data-explainer-media>
            {media}
          </div>
        ) : null}
        <button type="button" className={s.dismiss} onClick={dismiss} data-explainer-dismiss>
          {dismissLabel}
        </button>
      </div>
      {shownSteps.length > 0 && (
        <div className={s.steps} data-explainer-steps>
          {stepsTitle ? <h3 className={s.stepsTitle}>{stepsTitle}</h3> : null}
          <ol className={s.stepList} data-count={shownSteps.length}>
            {shownSteps.map((step, index) => (
              <li key={`${index}-${step.title}`} className={s.step} data-explainer-step={index + 1}>
                {step.media ? <div className={s.stepMedia}>{step.media}</div> : null}
                <span className={s.stepNumber} aria-hidden="true">
                  {index + 1}
                </span>
                <strong className={s.stepTitle}>{step.title}</strong>
                <p className={s.stepLine}>{step.line}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
