'use client';

import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { CampaignOpsCopy } from '@/messages/campaign-ops';
import { nextStepIndex, type ProcessStep } from './model';
import { ProcessPicture } from './pictures';
import s from './process-stage.module.css';

export interface ProcessStageProps {
  steps: readonly ProcessStep[];
  ariaLabel: string;
  exampleCaption: string;
  pic: CampaignOpsCopy['pic'];
  variant?: 'page' | 'dialog';
}

function isKeyboardFocusVisible(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).matches !== 'function') return false;
  try {
    return (target as Element).matches(':focus-visible');
  } catch {
    return false;
  }
}

export function ProcessStage({
  steps,
  ariaLabel,
  exampleCaption,
  pic,
  variant = 'page',
}: ProcessStageProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [userInitiated, setUserInitiated] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  if (steps.length === 0) return null;

  const safeIndex = activeIndex < steps.length ? activeIndex : 0;
  const activeStep = steps[safeIndex]!;
  const paused = hovered || focused;

  const selectStep = (index: number) => {
    setActiveIndex(index);
    setCycle((c) => c + 1);
    setUserInitiated(true);
  };

  const handleAnimationEnd = () => {
    if (reducedMotion || steps.length <= 1) return;
    setActiveIndex((cur) => nextStepIndex(cur, steps.length));
    setCycle((c) => c + 1);
    setUserInitiated(false);
  };

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (isKeyboardFocusVisible(event.target)) {
      setFocused(true);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setFocused(false);
    }
  };

  const handleSegmentKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectStep(index);
    }
  };

  return (
    <div
      className={`${s.root}${variant === 'dialog' ? ` ${s.rootDialog}` : ''}`}
      data-process-stage=""
      data-variant={variant}
      data-active-step={String(safeIndex + 1)}
      data-paused={paused ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      role="region"
      aria-label={ariaLabel}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className={`${s.stage}${variant === 'dialog' ? ` ${s.stageDialog}` : ''}`}>
        <ProcessPicture id={activeStep.pictureId} pic={pic} activationKey={`${activeStep.pictureId}-${cycle}`} />
        <span className={s.exampleCaption} data-process-example="">
          {exampleCaption}
        </span>
      </div>

      <ol className={s.segments}>
        {steps.map((step, index) => {
          const isActive = index === safeIndex;
          return (
            <li key={step.pictureId} className={s.segmentItem}>
              <button
                type="button"
                className={`${s.segment}${isActive ? ` ${s.segmentActive}` : ''}`}
                aria-current={isActive ? 'step' : undefined}
                data-step={isActive ? String(index + 1) : undefined}
                data-segment-index={String(index + 1)}
                onClick={() => selectStep(index)}
                onKeyDown={(e) => handleSegmentKeyDown(e, index)}
              >
                <span className={s.barTrack} aria-hidden="true">
                  {isActive ? (
                    <span
                      key={`${safeIndex}-${cycle}`}
                      className={s.barFill}
                      data-process-bar-fill=""
                      style={reducedMotion ? undefined : { animationPlayState: paused ? 'paused' : 'running' }}
                      onAnimationEnd={handleAnimationEnd}
                    />
                  ) : null}
                </span>
                <span className={s.segmentTitle}>
                  <span className={s.stepNum}>{index + 1}</span>
                  <span className={s.stepLabel}>{step.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className={s.body} data-process-body="">
        {activeStep.body}
      </p>
      <p className={s.srOnly} data-process-live="" aria-live="polite">
        {userInitiated ? activeStep.body : ''}
      </p>
    </div>
  );
}
