'use client';

import { useMemo, useRef, useState, type RefObject } from 'react';
import type { Dictionary } from '@/messages/en';
import { interpolate } from '@/lib/i18n/format';
import { promptCharLimit } from '@/lib/engines/prompt-limits';
import { MAX_RECIPE_STEPS, NOTE_MAX, type Recipe } from '@/lib/recipes/schema';
import { BUTTON_OUTLINE, FIELD, HINT, PANEL } from '@/components/creators/styles';
import { ClipCard, isFoldablePrompt } from './clip-card';
import { ClipIndex, CLIP_INDEX_MIN, useActiveClip } from './clip-index';
import {
  addGuideClip,
  duplicateGuideClip,
  GUIDE_META_MAX,
  GUIDE_NOTE_MAX,
  GUIDE_PROMPT_MAX,
  GUIDE_TITLE_MAX,
  guideClipValidation,
  MAX_GUIDE_CLIPS,
  moveGuideClip,
  removeGuideClip,
  updateGuideClip,
  type GuideCardDraft,
} from './guide-editor';

type Copy = Dictionary['makerRecipe'];

export interface StepItemState {
  kind: 'image' | 'video';
  engine: string;
  text: string;
  aspect: string;
  duration: number;
  resolution: '720p' | '1080p';
  note?: string;
}

export interface WorkbenchEngineOption {
  id: string;
  label: string;
  kind: 'image' | 'video';
  minDuration?: number;
  maxDuration?: number;
  resolutions?: string[];
}

export type SelectedWorkbenchItem =
  | { type: 'step'; index: number }
  | { type: 'clip'; index: number };

export interface RecipeStepsWorkbenchProps {
  copy: Copy;
  locale: string;
  medium: 'video' | 'image' | 'carousel';
  disabled: boolean;
  steps: StepItemState[];
  guideCards: GuideCardDraft[];
  recipe: Recipe;
  engines: WorkbenchEngineOption[];
  aspects: { image: string[]; video: string[] };
  tokensForStep: (stepIndex: number) => string[];
  clipTokens: string[];
  stepSentLength: (index: number) => number;
  textareasRef: RefObject<Array<HTMLTextAreaElement | null>>;
  onUpdateStep: (index: number, patch: Partial<StepItemState>) => void;
  onRemoveStep: (index: number) => void;
  onAddImageStep: () => void;
  onAddFrame: () => void;
  onInsertStepToken: (index: number, token: string) => void;
  onChangeGuideCards: (next: GuideCardDraft[]) => void;
}

const SMALL_PILL =
  'inline-flex min-h-9 items-center rounded-full border border-[#09090B]/[0.14] bg-white px-3 text-xs font-medium text-[#09090B] transition-colors hover:bg-[#F4F4F5] disabled:opacity-40';

export function RecipeStepsWorkbench({
  copy,
  locale,
  medium,
  disabled,
  steps,
  guideCards,
  recipe,
  engines,
  aspects,
  tokensForStep,
  clipTokens,
  stepSentLength,
  textareasRef,
  onUpdateStep,
  onRemoveStep,
  onAddImageStep,
  onAddFrame,
  onInsertStepToken,
  onChangeGuideCards,
}: RecipeStepsWorkbenchProps) {
  const imageEngines = engines.filter((e) => e.kind === 'image');
  const videoEngines = engines.filter((e) => e.kind === 'video');
  const [selected, setSelected] = useState<SelectedWorkbenchItem>({ type: 'step', index: 0 });
  const [viewAll, setViewAll] = useState(false);
  const [previewOpenKeys, setPreviewOpenKeys] = useState<Set<string>>(() => new Set());
  const clipTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeSelection: SelectedWorkbenchItem = useMemo(() => {
    if (selected.type === 'clip') {
      if (guideCards.length === 0) return { type: 'step', index: 0 };
      if (selected.index >= guideCards.length) return { type: 'clip', index: guideCards.length - 1 };
      return selected;
    }
    if (selected.index >= steps.length) return { type: 'step', index: Math.max(0, steps.length - 1) };
    return selected;
  }, [selected, steps.length, guideCards.length]);

  const count = (n: number) => n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US');

  const previewIndexItems = useMemo(
    () =>
      guideCards.map((clip, i) => ({
        id: `preview-clip-${i + 1}`,
        n: i + 1,
        title: clip.title.trim() || copy.clipUntitled,
      })),
    [guideCards, copy.clipUntitled],
  );
  const { activeId: previewActiveId, jumpTo: previewJumpTo } = useActiveClip(
    previewIndexItems.map((item) => item.id),
  );

  const previewCardLabels = {
    tipHeading: copy.how.tipHeading,
    expand: copy.how.expand,
    collapse: copy.how.collapse,
    copy: copy.how.copy,
    copied: copy.how.copied,
  };

  const previewFoldableKeys = [
    ...steps.filter((step) => isFoldablePrompt(step.text)).map((_, i) => `step-${i}`),
    ...guideCards.filter((clip) => isFoldablePrompt(clip.prompt)).map((clip) => clip.key),
  ];
  const previewAllExpanded =
    previewFoldableKeys.length > 0 && previewFoldableKeys.every((key) => previewOpenKeys.has(key));

  const togglePreviewKey = (key: string) => {
    setPreviewOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePreviewAll = () => {
    setPreviewOpenKeys(previewAllExpanded ? new Set() : new Set(previewFoldableKeys));
  };

  const activeClipIndex = activeSelection.type === 'clip' ? activeSelection.index : -1;
  const activeClip = activeClipIndex >= 0 ? guideCards[activeClipIndex] ?? null : null;
  const activeConvertedPrompt = activeClipIndex >= 0 ? recipe.guide?.[activeClipIndex]?.prompt ?? '' : '';
  const activeClipCheck = activeClip
    ? guideClipValidation(activeClip, activeConvertedPrompt.trim().length)
    : null;

  const insertClipToken = (token: string) => {
    if (activeClipIndex < 0 || !activeClip) return;
    const area = clipTextareaRef.current;
    const text = activeClip.prompt;
    const start = area?.selectionStart ?? text.length;
    const end = area?.selectionEnd ?? text.length;
    onChangeGuideCards(
      updateGuideClip(guideCards, activeClipIndex, {
        prompt: `${text.slice(0, start)}${token}${text.slice(end)}`,
      }),
    );
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleAddClip = () => {
    if (guideCards.length >= MAX_GUIDE_CLIPS) return;
    const next = addGuideClip(guideCards, 'video');
    onChangeGuideCards(next);
    setSelected({ type: 'clip', index: next.length - 1 });
    setViewAll(false);
  };

  const handleDuplicateClip = (index: number) => {
    if (guideCards.length >= MAX_GUIDE_CLIPS) return;
    const next = duplicateGuideClip(guideCards, index);
    onChangeGuideCards(next);
    setSelected({ type: 'clip', index: Math.min(index + 1, next.length - 1) });
  };

  const handleMoveClip = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= guideCards.length) return;
    onChangeGuideCards(moveGuideClip(guideCards, index, delta));
    setSelected({ type: 'clip', index: nextIndex });
  };

  const handleDeleteClip = (index: number) => {
    const next = removeGuideClip(guideCards, index);
    onChangeGuideCards(next);
    if (next.length === 0) {
      setSelected({ type: 'step', index: 0 });
    } else {
      setSelected({ type: 'clip', index: Math.min(index, next.length - 1) });
    }
  };

  return (
    <section data-recipe-steps-workbench className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[#09090B]">{copy.steps}</h2>
          <p className="mt-0.5 text-xs text-[#71717A] tabular-nums">
            {copy.stepsMainHeading} {steps.length} · {copy.clipsHeading} {guideCards.length} / {MAX_GUIDE_CLIPS}
          </p>
        </div>

        <button
          type="button"
          data-recipe-view-all
          aria-pressed={viewAll}
          onClick={() => setViewAll((value) => !value)}
          className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[#09090B]/[0.16] bg-white px-4 text-xs font-semibold text-[#09090B] transition-colors hover:bg-[#F4F4F5]"
        >
          {viewAll ? copy.editorBackToEdit : copy.editorViewAll}
        </button>
      </div>

      {viewAll ? (
        <div data-recipe-editor-preview-all className="space-y-6 border-t border-hairline pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-[#71717A]">{copy.editorViewAllHint}</p>
            {(steps.length + guideCards.length) > 1 && previewFoldableKeys.length > 0 ? (
              <button
                type="button"
                data-recipe-toggle-all
                aria-pressed={previewAllExpanded}
                onClick={togglePreviewAll}
                className="audience-button-quiet min-h-9 shrink-0 px-3.5 text-xs"
              >
                {previewAllExpanded ? copy.how.collapseAll : copy.how.expandAll}
              </button>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-[#71717A]">{copy.stepsMainHeading}</p>
            <ol className="space-y-4">
              {steps.map((step, index) => {
                const key = `step-${index}`;
                return (
                  <ClipCard
                    key={key}
                    number={index + 1}
                    showNumber={false}
                    title={`${interpolate(copy.stepLabel, { n: String(index + 1) })} · ${step.kind === 'image' ? copy.stepImage : copy.stepVideo}`}
                    note={step.note}
                    noteMarker="step"
                    prompt={step.text || '…'}
                    labels={previewCardLabels}
                    expanded={previewOpenKeys.has(key)}
                    onToggle={() => togglePreviewKey(key)}
                  />
                );
              })}
            </ol>
          </div>

          {guideCards.length > 0 ? (
            <div className="space-y-4 border-t border-hairline pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-[#71717A]">{copy.clipsHeading}</p>
                <span className="rounded-full bg-[#F4F4F5] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#52525B]">
                  {interpolate(copy.how.clipCount, { n: String(guideCards.length) })}
                </span>
              </div>
              {previewIndexItems.length >= CLIP_INDEX_MIN ? (
                <ClipIndex
                  items={previewIndexItems}
                  activeId={previewActiveId}
                  onSelect={previewJumpTo}
                  label={copy.how.clipIndexLabel}
                  variant="chips"
                />
              ) : null}
              <div
                className={
                  previewIndexItems.length >= CLIP_INDEX_MIN
                    ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start'
                    : ''
                }
              >
                <ol className="min-w-0 space-y-4">
                  {guideCards.map((clip, index) => (
                    <ClipCard
                      key={clip.key}
                      id={`preview-clip-${index + 1}`}
                      number={index + 1}
                      title={clip.title.trim() || copy.clipUntitled}
                      meta={clip.meta}
                      note={clip.note}
                      noteMarker="guide"
                      prompt={clip.prompt || '…'}
                      labels={previewCardLabels}
                      expanded={previewOpenKeys.has(clip.key)}
                      onToggle={() => togglePreviewKey(clip.key)}
                    />
                  ))}
                </ol>
                {previewIndexItems.length >= CLIP_INDEX_MIN ? (
                  <ClipIndex
                    items={previewIndexItems}
                    activeId={previewActiveId}
                    onSelect={previewJumpTo}
                    label={copy.how.clipIndexLabel}
                    variant="rail"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-5 border-t border-hairline pt-5 md:grid-cols-[14.5rem_minmax(0,1fr)] md:items-start">
          {/* Left column: execution steps + clip cards list */}
          <div data-recipe-steps-list className="min-w-0 space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#71717A]">{copy.stepsMainHeading}</p>
              <ul className="space-y-1.5">
                {steps.map((step, index) => {
                  const limit = promptCharLimit(step.engine);
                  const written = stepSentLength(index);
                  const over = written > limit;
                  const isActive = activeSelection.type === 'step' && activeSelection.index === index;
                  return (
                    <li key={`list-step-${index}`}>
                      <button
                        type="button"
                        data-recipe-list-step={index + 1}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => setSelected({ type: 'step', index })}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          isActive
                            ? 'border-[#09090B] bg-[#F4F4F5]'
                            : 'border-[#09090B]/[0.08] bg-white hover:bg-[#F4F4F5]/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-[#09090B]">
                            {interpolate(copy.stepLabel, { n: String(index + 1) })} ·{' '}
                            {step.kind === 'image' ? copy.stepImage : copy.stepVideo}
                          </span>
                          {over ? (
                            <span
                              data-list-over="true"
                              className="shrink-0 text-[11px] font-semibold text-[#CC1573]"
                            >
                              {copy.clipOverLimit}
                            </span>
                          ) : null}
                        </div>
                        <p className={`mt-1 text-[11px] tabular-nums ${over ? 'font-semibold text-[#CC1573]' : 'text-[#71717A]'}`}>
                          {interpolate(copy.promptCount, { n: count(written), max: count(limit) })}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                {medium === 'video' && !steps.some((s) => s.kind === 'image') ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onAddImageStep();
                      setSelected({ type: 'step', index: 0 });
                    }}
                    className={SMALL_PILL}
                  >
                    {copy.addImageStep}
                  </button>
                ) : null}
                {medium === 'carousel' && steps.length < MAX_RECIPE_STEPS ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const nextIndex = steps.length;
                      onAddFrame();
                      setSelected({ type: 'step', index: nextIndex });
                    }}
                    className={SMALL_PILL}
                  >
                    {copy.addFrame}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#71717A]">{copy.clipsHeading}</p>
                <span className="text-[11px] font-medium tabular-nums text-[#71717A]">
                  {guideCards.length} / {MAX_GUIDE_CLIPS}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[#71717A]">
                {interpolate(copy.clipsHint, { max: String(MAX_GUIDE_CLIPS) })}
              </p>

              {guideCards.length > 0 ? (
                <ul className="space-y-1.5">
                  {guideCards.map((clip, index) => {
                    const convertedLen = recipe.guide?.[index]?.prompt?.trim().length ?? clip.prompt.trim().length;
                    const check = guideClipValidation(clip, convertedLen);
                    const isActive = activeSelection.type === 'clip' && activeSelection.index === index;
                    return (
                      <li key={clip.key}>
                        <button
                          type="button"
                          data-recipe-list-clip={index + 1}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => setSelected({ type: 'clip', index })}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            isActive
                              ? 'border-[#09090B] bg-[#F4F4F5]'
                              : 'border-[#09090B]/[0.08] bg-white hover:bg-[#F4F4F5]/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs font-semibold text-[#09090B]">
                              <span className="mr-1.5 tabular-nums text-[#71717A]">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              {clip.title.trim() || copy.clipUntitled}
                            </span>
                            {check.overLimit ? (
                              <span
                                data-list-over="true"
                                className="shrink-0 text-[11px] font-semibold text-[#CC1573]"
                              >
                                {copy.clipOverLimit}
                              </span>
                            ) : null}
                          </div>
                          <p
                            className={`mt-1 text-[11px] tabular-nums ${
                              check.overLimit ? 'font-semibold text-[#CC1573]' : 'text-[#71717A]'
                            }`}
                          >
                            {interpolate(copy.promptCount, { n: count(check.promptLen), max: count(GUIDE_PROMPT_MAX) })}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-[#09090B]/[0.12] px-3 py-3 text-xs leading-relaxed text-[#71717A]">
                  {copy.clipsEmpty}
                </p>
              )}

              <button
                type="button"
                data-recipe-add-clip
                disabled={disabled || guideCards.length >= MAX_GUIDE_CLIPS}
                onClick={handleAddClip}
                className={`${BUTTON_OUTLINE} min-h-10 w-full px-4 text-xs disabled:opacity-40`}
              >
                + {copy.addClip}
              </button>
              {guideCards.length >= MAX_GUIDE_CLIPS ? (
                <p className="text-[11px] text-[#71717A]">
                  {interpolate(copy.clipLimitReached, { max: String(MAX_GUIDE_CLIPS) })}
                </p>
              ) : null}
            </div>
          </div>

          {/* Right column: edit the single selected item */}
          <div data-recipe-active-pane className="min-w-0 rounded-2xl border border-[#09090B]/[0.08] bg-white p-4 sm:p-5">
            <fieldset disabled={disabled} className="min-w-0 space-y-4">
              {steps.map((step, index) => {
                const options = step.kind === 'image' ? imageEngines : videoEngines;
                const engine = options.find((e) => e.id === step.engine) ?? options[0]!;
                const durations = Array.from(
                  { length: (engine.maxDuration ?? 15) - (engine.minDuration ?? 4) + 1 },
                  (_, i) => (engine.minDuration ?? 4) + i,
                );
                const removable =
                  (medium === 'carousel' && steps.length > 1) || (medium === 'video' && step.kind === 'image');
                const limit = promptCharLimit(step.engine);
                const written = stepSentLength(index);
                const over = written > limit;
                const isSelected = activeSelection.type === 'step' && activeSelection.index === index;

                return (
                  <div
                    key={index}
                    hidden={!isSelected}
                    data-recipe-step={`step${index + 1}`}
                    data-step-kind={step.kind}
                    className="space-y-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-base font-semibold text-[#09090B]">
                        {interpolate(copy.stepLabel, { n: String(index + 1) })} ·{' '}
                        {step.kind === 'image' ? copy.stepImage : copy.stepVideo}
                      </h3>
                      {removable ? (
                        <button
                          type="button"
                          onClick={() => {
                            onRemoveStep(index);
                            setSelected({ type: 'step', index: Math.max(0, index - 1) });
                          }}
                          className="text-xs underline underline-offset-4"
                        >
                          {copy.removeStep}
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-sm">
                        {copy.engine}
                        <select
                          value={engine.id}
                          onChange={(e) => onUpdateStep(index, { engine: e.target.value })}
                          className={FIELD}
                        >
                          {options.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm">
                        {copy.aspect}
                        <select
                          value={step.aspect}
                          onChange={(e) => onUpdateStep(index, { aspect: e.target.value })}
                          className={FIELD}
                        >
                          {(step.kind === 'image' ? aspects.image : aspects.video).map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </label>
                      {step.kind === 'video' ? (
                        <>
                          <label className="block text-sm">
                            {copy.duration}
                            <select
                              value={step.duration}
                              onChange={(e) => onUpdateStep(index, { duration: Number(e.target.value) })}
                              className={FIELD}
                            >
                              {durations.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-sm">
                            {copy.resolution}
                            <select
                              value={step.resolution}
                              onChange={(e) =>
                                onUpdateStep(index, { resolution: e.target.value as '720p' | '1080p' })
                              }
                              className={FIELD}
                            >
                              {(engine.resolutions ?? ['720p']).map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : null}
                    </div>

                    <label className="block text-sm" data-recipe-step-note={index + 1}>
                      {copy.note}
                      <textarea
                        value={step.note ?? ''}
                        onChange={(e) => onUpdateStep(index, { note: e.target.value })}
                        rows={2}
                        maxLength={NOTE_MAX}
                        className={FIELD}
                      />
                      <span className={HINT}>
                        {copy.noteHint} · <span className="tabular-nums">{count((step.note ?? '').trim().length)} / {count(NOTE_MAX)}</span>
                      </span>
                    </label>

                    <div className="space-y-2">
                      <p className="text-sm">{copy.prompt}</p>
                      <div className="flex flex-wrap gap-2" aria-label={copy.insert}>
                        {tokensForStep(index).map((token) => (
                          <button
                            key={token}
                            type="button"
                            data-insert-token={token}
                            onClick={() => onInsertStepToken(index, token)}
                            className="inline-flex min-h-9 items-center rounded-full border border-hairline px-3 text-xs"
                          >
                            {token}
                          </button>
                        ))}
                      </div>
                      <textarea
                        ref={(node) => {
                          if (textareasRef.current) textareasRef.current[index] = node;
                        }}
                        value={step.text}
                        onChange={(e) => onUpdateStep(index, { text: e.target.value })}
                        rows={12}
                        maxLength={limit}
                        aria-invalid={over ? true : undefined}
                        aria-label={`${interpolate(copy.stepLabel, { n: String(index + 1) })} ${copy.prompt}`}
                        className={`${FIELD} resize-y`}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <span
                        data-recipe-prompt-count={written}
                        data-recipe-prompt-limit={limit}
                        data-over={over ? 'true' : undefined}
                        className={`${HINT} tabular-nums${over ? ' text-accent' : ''}`}
                      >
                        {interpolate(copy.promptCount, { n: count(written), max: count(limit) })}
                      </span>
                      <span className={HINT}>{copy.promptHint}</span>
                    </div>
                  </div>
                );
              })}

              {activeSelection.type === 'clip' && activeClip && activeClipCheck ? (
                <div data-recipe-clip-editor={activeClipIndex + 1} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
                    <h3 className="text-base font-semibold text-[#09090B]">
                      {interpolate(copy.clipLabel, { n: String(activeClipIndex + 1) })}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        data-clip-move-up
                        disabled={disabled || activeClipIndex === 0}
                        onClick={() => handleMoveClip(activeClipIndex, -1)}
                        className={SMALL_PILL}
                      >
                        {copy.clipMoveUp}
                      </button>
                      <button
                        type="button"
                        data-clip-move-down
                        disabled={disabled || activeClipIndex >= guideCards.length - 1}
                        onClick={() => handleMoveClip(activeClipIndex, 1)}
                        className={SMALL_PILL}
                      >
                        {copy.clipMoveDown}
                      </button>
                      <button
                        type="button"
                        data-clip-duplicate
                        disabled={disabled || guideCards.length >= MAX_GUIDE_CLIPS}
                        onClick={() => handleDuplicateClip(activeClipIndex)}
                        className={SMALL_PILL}
                      >
                        {copy.clipDuplicate}
                      </button>
                      <button
                        type="button"
                        data-clip-delete
                        disabled={disabled}
                        onClick={() => handleDeleteClip(activeClipIndex)}
                        className={SMALL_PILL}
                      >
                        {copy.clipDelete}
                      </button>
                    </div>
                  </div>

                  <label className="block text-sm">
                    {copy.clipTitle}
                    <input
                      type="text"
                      data-clip-title-input
                      value={activeClip.title}
                      onChange={(e) =>
                        onChangeGuideCards(updateGuideClip(guideCards, activeClipIndex, { title: e.target.value }))
                      }
                      maxLength={GUIDE_TITLE_MAX}
                      placeholder={copy.clipTitlePlaceholder}
                      aria-invalid={activeClipCheck.titleTooShort || activeClipCheck.titleOver ? true : undefined}
                      className={FIELD}
                    />
                    <span className={`${HINT} tabular-nums`}>
                      {activeClipCheck.titleTooShort ? `${copy.clipTitleRequired} · ` : ''}
                      {count(activeClipCheck.titleLen)} / {count(GUIDE_TITLE_MAX)}
                    </span>
                  </label>

                  <div role="radiogroup" aria-label={copy.clipKind} data-clip-kind-picker className="space-y-2">
                    <p className="text-sm">{copy.clipKind}</p>
                    <div className="flex flex-wrap gap-2">
                      {(['video', 'image'] as const).map((kind) => (
                        <label
                          key={kind}
                          data-clip-kind={kind}
                          className={`inline-flex min-h-10 cursor-pointer items-center rounded-full border px-4 text-xs font-medium ${
                            activeClip.kind === kind
                              ? 'border-[#09090B] bg-[#09090B] text-white'
                              : 'border-hairline bg-white text-[#52525B]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="clip-kind"
                            value={kind}
                            checked={activeClip.kind === kind}
                            onChange={() =>
                              onChangeGuideCards(updateGuideClip(guideCards, activeClipIndex, { kind }))
                            }
                            className="sr-only"
                          />
                          {kind === 'image' ? copy.stepImage : copy.stepVideo}
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="block text-sm">
                    {copy.clipMeta}
                    <input
                      type="text"
                      data-clip-meta-input
                      value={activeClip.meta}
                      onChange={(e) =>
                        onChangeGuideCards(updateGuideClip(guideCards, activeClipIndex, { meta: e.target.value }))
                      }
                      maxLength={GUIDE_META_MAX}
                      placeholder={copy.clipMetaPlaceholder}
                      aria-invalid={activeClipCheck.metaOver ? true : undefined}
                      className={FIELD}
                    />
                    <span className={`${HINT} tabular-nums`}>
                      {count(activeClipCheck.metaLen)} / {count(GUIDE_META_MAX)}
                    </span>
                  </label>

                  <label className="block text-sm">
                    {copy.note}
                    <textarea
                      data-clip-note-input
                      value={activeClip.note}
                      onChange={(e) =>
                        onChangeGuideCards(updateGuideClip(guideCards, activeClipIndex, { note: e.target.value }))
                      }
                      rows={2}
                      maxLength={GUIDE_NOTE_MAX}
                      aria-invalid={activeClipCheck.noteOver ? true : undefined}
                      className={FIELD}
                    />
                    <span className={HINT}>
                      {copy.noteHint} · <span className="tabular-nums">{count(activeClipCheck.noteLen)} / {count(GUIDE_NOTE_MAX)}</span>
                    </span>
                  </label>

                  <div className="space-y-2">
                    <p className="text-sm">{copy.prompt}</p>
                    <div className="flex flex-wrap gap-2" aria-label={copy.insert}>
                      {clipTokens.map((token) => (
                        <button
                          key={token}
                          type="button"
                          data-clip-insert-token={token}
                          onClick={() => insertClipToken(token)}
                          className="inline-flex min-h-9 items-center rounded-full border border-hairline px-3 text-xs"
                        >
                          {token}
                        </button>
                      ))}
                    </div>
                    <textarea
                      ref={clipTextareaRef}
                      data-clip-prompt-input
                      value={activeClip.prompt}
                      onChange={(e) =>
                        onChangeGuideCards(updateGuideClip(guideCards, activeClipIndex, { prompt: e.target.value }))
                      }
                      rows={12}
                      maxLength={GUIDE_PROMPT_MAX}
                      aria-invalid={activeClipCheck.promptOver ? true : undefined}
                      aria-label={`${interpolate(copy.clipLabel, { n: String(activeClipIndex + 1) })} ${copy.prompt}`}
                      className={`${FIELD} resize-y`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span
                      data-clip-prompt-count={activeClipCheck.promptLen}
                      data-clip-prompt-limit={GUIDE_PROMPT_MAX}
                      data-over={activeClipCheck.promptOver ? 'true' : undefined}
                      className={`${HINT} tabular-nums${activeClipCheck.promptOver ? ' text-accent' : ''}`}
                    >
                      {activeClipCheck.promptTooShort ? `${copy.clipPromptTooShort} · ` : ''}
                      {interpolate(copy.promptCount, {
                        n: count(activeClipCheck.promptLen),
                        max: count(GUIDE_PROMPT_MAX),
                      })}
                    </span>
                    <span className={HINT}>{copy.promptHint}</span>
                  </div>
                </div>
              ) : null}
            </fieldset>
          </div>
        </div>
      )}
    </section>
  );
}
