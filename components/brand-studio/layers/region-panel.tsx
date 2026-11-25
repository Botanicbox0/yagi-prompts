"use client";
/**
 * In-editor Oplux Region Edit panel (`docs/BRAND-STUDIO-REGION-LAYERS.md` §1, §4):
 * - Input preview `1` (the selected crop on the zoomed stage)
 * - Numbered square reference thumbnails `2, 3, …` with drag/drop, file upload, quick strip & role select
 * - 5-task Prompt Assistant (`지시 도우미`) + `!` tip + reference/box-size/contour advisors
 * - Prompt Auto-Refine toggle + `!` tip + live preview rewrite
 * - Model / quality select and credit-only non-blocking submit CTA. A finished edit always lands as a
 *   patch layer in the editor, followed by the result bar (region-result.ts).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent, type RefObject } from "react";
import { extractClipboardImages, prepareClipboardUploadFiles } from "@/lib/brand-studio/clipboard-image";
import { STUDIO_LIMITS, STUDIO_UPLOAD_MIMES, type RegionBox, type StudioAssetRole } from "@/lib/brand-studio/contracts";
import {
  REGION_ASSISTANT_TASK_IDS,
  assessRegionBox,
  buildRegionAssistantTask,
  isPresetRegionPrompt,
  measureBoxBoundaryEdges,
  regionAssistantTaskLabel,
  type RegionAssistantTaskId,
} from "@/lib/brand-studio/enhancer/region-assistant";
import { qualityOf, regionCredits, regionInstructionForForm, regionProblem, type RegionProblem } from "../dock-model";
import { REGION_ROLES, cropStyle, selectionStyle } from "../gallery/region-form";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, startRefDrag, type RefSource, type TrayItem } from "../refs";
import { centeredBox, regionInputFrame } from "../region-math";
import type { LayerEditorRegionPreset, LayerEditorRegionSupport } from "../seams";
import { LayerIcon } from "./icons";
import { fill, type LayersCopy } from "./panels";

export interface RegionEditPanelProps {
  copy: LayersCopy;
  locale: "ko" | "en";
  baseSize: { width: number; height: number };
  baseImgRef: RefObject<HTMLImageElement | null>;
  region: LayerEditorRegionSupport;
  box: RegionBox | null;
  preset?: LayerEditorRegionPreset | null;
  /** True when marquee / partial-edit tool is active so window-level Ctrl+V routes copied images here. */
  activeForPaste?: boolean;
  quickItems: readonly TrayItem[];
  uploading: boolean;
  onBox(box: RegionBox | null): void;
  resolveRef(ref: RefSource): TrayItem | null;
  onUploadRefs(files: File[]): Promise<TrayItem[]>;
  onNotice?(message: string): void;
  onSubmitted(jobId: string, meta: { box: RegionBox }): void;
}

function problemMessage(problem: RegionProblem, copy: LayersCopy): string {
  switch (problem.kind) {
    case "need_box":
      return copy.region.needBox;
    case "empty_prompt":
      return copy.region.emptyPrompt;
    case "image_only":
      return copy.stage.notImage;
    case "too_many_images":
      return fill(copy.region.tooManyRefs, { max: problem.max });
    case "missing":
      return fill(copy.region.missingRefMention, { n: problem.mentions.map((m) => m.number).join(", ") });
  }
}

export function RegionEditPanel(props: RegionEditPanelProps) {
  const { copy, locale, baseSize, baseImgRef, region, box } = props;
  const r = copy.region;
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [model, setModelState] = useState<string>(() => presetModel(props.preset?.model, region));
  const [quality, setQuality] = useState<string>(() =>
    region.fixedModel ? "" : qualityOf(region.models.find((m) => m.id === presetModel(props.preset?.model, region)) ?? null, props.preset?.quality ?? region.defaultQuality),
  );
  const v2 = region.fixedModel ? { v2: true } : {};
  const [references, setReferences] = useState<TrayItem[]>(() => props.preset?.references ?? []);
  const [task, setTask] = useState<RegionAssistantTaskId | null>(null);
  const [instruction, setInstruction] = useState<string>(() =>
    props.preset?.instruction
      ? props.preset.serverNumbered === false
        ? props.preset.instruction
        : regionInstructionForForm(props.preset.instruction, locale)
      : "",
  );
  const [enhance, setEnhance] = useState(props.preset?.enhance ?? true);
  const [enhancing, setEnhancing] = useState(false);
  const [beforeEnhance, setBeforeEnhance] = useState<string | null>(null);
  const [showAssistantTip, setShowAssistantTip] = useState(false);
  const [showEnhanceTip, setShowEnhanceTip] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [edgeScore, setEdgeScore] = useState(0);

  const setModel = (nextId: string) => {
    setModelState(nextId);
    setQuality((cur) => qualityOf(region.models.find((m) => m.id === nextId) ?? null, cur));
  };

  // Measure whether the selection box cuts across strong object contours on the base picture.
  useEffect(() => {
    if (!box) {
      setEdgeScore(0);
      return;
    }
    setEdgeScore(measureBoxBoundaryEdges(baseImgRef.current, box));
  }, [box, baseImgRef]);

  // Keep preset wording synced when Reference 2 is added/removed while on a preset prompt.
  useEffect(() => {
    if (!task) return;
    setInstruction((current) => {
      if (!isPresetRegionPrompt(current)) return current;
      return buildRegionAssistantTask({
        task,
        locale,
        referenceCount: references.length,
        currentText: current,
      }).prompt;
    });
  }, [references.length, task, locale]);

  const maxTotalRefs = region.models.find((m) => m.id === model)?.maxReferences ?? STUDIO_LIMITS.referencesMax;
  const maxExtraRefs = Math.max(0, maxTotalRefs - 1);
  const full = references.length >= maxExtraRefs;

  const assistantState = useMemo(
    () =>
      task
        ? buildRegionAssistantTask({
            task,
            locale,
            referenceCount: references.length,
            currentText: instruction,
          })
        : null,
    [task, locale, references.length, instruction],
  );

  const boxAssessment = useMemo(() => assessRegionBox(box, edgeScore, locale), [box, edgeScore, locale]);

  const creditsAmount = regionCredits(model, references.length, quality, Boolean(region.fixedModel));
  const formattedCredits = creditsAmount.toLocaleString(locale === "ko" ? "ko-KR" : "en-US");

  const addRefItem = (item: TrayItem | null) => {
    if (!item || item.kind !== "image" || references.some((ref) => ref.key === item.key) || full) return;
    const cleanRole = item.role && (REGION_ROLES as readonly string[]).includes(item.role) ? item.role : undefined;
    setReferences((cur) => [...cur, { ...item, role: cleanRole }]);
    setErrorNote(null);
  };

  const ingestPastedFiles = useCallback(
    async (rawFiles: File[]) => {
      if (!rawFiles.length) return;
      if (full) {
        setErrorNote(fill(r.tooManyRefs, { max: maxExtraRefs }));
        return;
      }
      const ready = await prepareClipboardUploadFiles(rawFiles);
      const added = await props.onUploadRefs(ready);
      if (!added.length) return;
      setReferences((cur) => {
        const room = Math.max(0, maxExtraRefs - cur.length);
        const fresh = added.filter((a) => !cur.some((c) => c.key === a.key)).slice(0, room);
        return [...cur, ...fresh];
      });
      setErrorNote(null);
      props.onNotice?.(copy.clipboard.pastedRef);
    },
    [full, r.tooManyRefs, maxExtraRefs, props.onUploadRefs, props.onNotice, copy.clipboard.pastedRef],
  );

  const handlePaste = (event: ReactClipboardEvent) => {
    const pasted = extractClipboardImages(event.clipboardData);
    if (!pasted.length) return;
    event.preventDefault();
    event.stopPropagation();
    void ingestPastedFiles(pasted);
  };

  useEffect(() => {
    if (!props.activeForPaste || typeof window === "undefined") return;
    const onWindowPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const pasted = extractClipboardImages(event.clipboardData);
      if (!pasted.length) return;
      event.preventDefault();
      event.stopPropagation();
      void ingestPastedFiles(pasted);
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [props.activeForPaste, ingestPastedFiles]);

  const handleDrop = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) {
      addRefItem(props.resolveRef(source));
      return;
    }
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      void props.onUploadRefs(files).then((added) => {
        setReferences((cur) => {
          const room = Math.max(0, maxExtraRefs - cur.length);
          const fresh = added.filter((a) => !cur.some((c) => c.key === a.key)).slice(0, room);
          return [...cur, ...fresh];
        });
      });
    }
  };

  const pickTask = (nextTask: RegionAssistantTaskId) => {
    setTask(nextTask);
    setBeforeEnhance(null);
    setErrorNote(null);
    const built = buildRegionAssistantTask({
      task: nextTask,
      locale,
      referenceCount: references.length,
      currentText: instruction,
    });
    setInstruction(built.prompt);
  };

  const previewRewrite = async () => {
    if (enhancing) return;
    if (!box) {
      setErrorNote(r.needBox);
      return;
    }
    if (assistantState?.missingRefWarning) {
      setErrorNote(assistantState.missingRefWarning);
      return;
    }
    const problem = regionProblem({ box, instruction, model, references, ...v2 });
    if (problem) {
      setErrorNote(problemMessage(problem, copy));
      return;
    }
    setErrorNote(null);
    setEnhancing(true);
    const snapshot = instruction;
    try {
      const res = await region.enhancePrompt({
        source: region.sourceRef,
        box,
        instruction: instruction.trim(),
        model,
        quality,
        references,
      });
      if (res.ok) {
        setBeforeEnhance(snapshot);
        setInstruction(res.finalPrompt);
      } else {
        setErrorNote(res.message);
      }
    } finally {
      setEnhancing(false);
    }
  };

  const submit = async () => {
    if (submitting) return;
    if (!box) {
      setErrorNote(r.needBox);
      return;
    }
    if (assistantState?.missingRefWarning) {
      setErrorNote(assistantState.missingRefWarning);
      return;
    }
    const problem = regionProblem({ box, instruction, model, references, ...v2 });
    if (problem) {
      setErrorNote(problemMessage(problem, copy));
      return;
    }
    setErrorNote(null);
    setSubmitting(true);
    const targetBox = box;
    const preEnhanced = beforeEnhance !== null;
    try {
      const res = await region.submit({
        source: region.sourceRef,
        box: targetBox,
        instruction: instruction.trim(),
        model,
        quality,
        references,
        enhance: preEnhanced ? false : enhance,
      });
      if (!res.ok) {
        setErrorNote(res.message);
        return;
      }
      props.onSubmitted(res.job.id, { box: targetBox });
    } finally {
      setSubmitting(false);
    }
  };

  const qualities = region.models.find((m) => m.id === model)?.qualities ?? [];

  return (
    <form
      className="bsl-panel-body bsl-region-panel"
      data-layers-region
      data-drop-active={dropActive || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onDragOver={(event) => {
        if (!acceptsDrag(event.dataTransfer?.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <div className="bsl-region-head">
        <h2 className="bsl-panel-title">{r.title}</h2>
        {box && (
          <button type="button" className="bsl-btn" data-variant="ghost" data-size="sm" onClick={() => props.onBox(null)}>
            {r.clearBox}
          </button>
        )}
      </div>

      {!box ? (
        <div className="bsl-region-empty">
          <p className="bsl-hint">{r.emptyHint}</p>
          <button type="button" className="bsl-btn" data-variant="soft" data-size="sm" onClick={() => props.onBox(centeredBox())}>
            <LayerIcon name="marquee" />
            <span>{r.placeCenter}</span>
          </button>
        </div>
      ) : (
        <>
          <figure className="bsl-region-preview" data-layers-region-preview>
            {/* Exactly what goes in as image 1, at its own shape, letterboxed in the stage; with the one
                region engine that is the window around the selection, which is outlined inside it. */}
            {(() => {
              const input = regionInputFrame(baseSize, box, Boolean(region.fixedModel));
              return (
                <span className="bsl-region-stage">
                  <span className="bsl-region-crop" role="img" aria-label={r.inputPreviewLabel} style={cropStyle(input.frame, baseSize, region.previewUrl)}>
                    {input.selection && (
                      <span className="bsl-region-select" data-layers-region-select aria-hidden="true" style={selectionStyle(input.selection)} />
                    )}
                  </span>
                </span>
              );
            })()}
            <figcaption className="bsl-region-caption">
              <span className="bsl-num-badge bsl-num">1</span>
              <span>{region.fixedModel ? r.inputPreviewCaptionWide : r.inputPreviewCaption}</span>
            </figcaption>
          </figure>

          {boxAssessment.warnings.map((tip, i) => (
            <p key={i} className="bsl-advisory" role="status" data-region-box-tip>
              {tip}
            </p>
          ))}
        </>
      )}

      <div className="bsl-region-refs" role="group" aria-labelledby={`${id}-refs`}>
        <span id={`${id}-refs`} className="bsl-label">
          {r.refsTitle}
        </span>
        <ul className="bsl-ref-grid">
          {references.map((ref, i) => (
            <li key={ref.key} className="bsl-ref-card" data-layers-ref={i + 2}>
              <span className="bsl-ref-thumb">
                <img src={ref.thumbUrl ?? ref.url} alt="" draggable={false} />
                <span className="bsl-num-badge bsl-num" aria-hidden="true">
                  {i + 2}
                </span>
                <button
                  type="button"
                  className="bsl-ref-remove"
                  aria-label={fill(r.removeRef, { n: i + 2 })}
                  onClick={() => setReferences((cur) => cur.filter((x) => x.key !== ref.key))}
                >
                  <LayerIcon name="close" />
                </button>
              </span>
              <label className="bsl-sr" htmlFor={`${id}-role-${i}`}>
                {fill(r.roleLabel, { n: i + 2 })}
              </label>
              <select
                id={`${id}-role-${i}`}
                className="bsl-input bsl-role-select"
                value={ref.role ?? ""}
                onChange={(event) =>
                  setReferences((cur) =>
                    cur.map((x) =>
                      x.key === ref.key
                        ? { ...x, role: (event.target.value || undefined) as StudioAssetRole | undefined }
                        : x,
                    ),
                  )
                }
              >
                <option value="">{r.roleNone}</option>
                {REGION_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {r.roles[role]}
                  </option>
                ))}
              </select>
            </li>
          ))}
          {!full && (
            <li className="bsl-ref-card">
              <button
                type="button"
                className="bsl-ref-add"
                disabled={props.uploading}
                aria-label={r.addRef}
                title={r.addRef}
                onClick={() => fileRef.current?.click()}
              >
                <LayerIcon name="plus" />
              </button>
              <input
                ref={fileRef}
                type="file"
                className="bsl-sr"
                tabIndex={-1}
                accept={STUDIO_UPLOAD_MIMES.image.join(",")}
                multiple
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (!picked.length) return;
                  void props.onUploadRefs(picked).then((added) => {
                    setReferences((cur) => {
                      const room = Math.max(0, maxExtraRefs - cur.length);
                      const fresh = added.filter((a) => !cur.some((c) => c.key === a.key)).slice(0, room);
                      return [...cur, ...fresh];
                    });
                  });
                }}
              />
            </li>
          )}
        </ul>
        <p className="bsl-hint">{dropActive ? r.dropRefs : r.refsHint}</p>

        {props.quickItems.length > 0 && !full && (
          <div className="bsl-quick-refs">
            <span className="bsl-label">{r.quickPick}</span>
            <ul className="bsl-quick-strip">
              {props.quickItems.slice(0, 8).map((item) => {
                const taken = references.some((ref) => ref.key === item.key);
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="bsl-quick-thumb"
                      disabled={taken || full}
                      draggable
                      onDragStart={(event) =>
                        startRefDrag(event, item.assetId ? { assetId: item.assetId } : { outputId: item.outputId! })
                      }
                      aria-label={fill(copy.add.addImage, { name: item.name })}
                      title={item.name}
                      onClick={() => addRefItem(item)}
                    >
                      <img src={item.thumbUrl ?? item.url} alt="" loading="lazy" draggable={false} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="bsl-assistant" data-layers-assistant>
        <div className="bsl-label-row">
          <span className="bsl-label">{r.assistantTitle}</span>
          <button
            type="button"
            className="bsl-tip-btn"
            aria-label={r.assistantTipLabel}
            aria-expanded={showAssistantTip}
            onClick={() => setShowAssistantTip((v) => !v)}
          >
            !
          </button>
        </div>
        {showAssistantTip && <p className="bsl-tip-box">{region.fixedModel ? r.assistantTipWide : r.assistantTip}</p>}
        <div className="bsl-task-pills" role="group" aria-label={r.assistantTitle}>
          {REGION_ASSISTANT_TASK_IDS.map((taskId) => (
            <button
              key={taskId}
              type="button"
              className="bsl-task-pill"
              aria-pressed={task === taskId}
              data-task={taskId}
              onClick={() => pickTask(taskId)}
            >
              {regionAssistantTaskLabel(taskId, locale)}
            </button>
          ))}
        </div>
        {assistantState?.missingRefWarning && (
          <p className="bsl-advisory" data-tone="warn" role="alert">
            {assistantState.missingRefWarning}
          </p>
        )}
        {assistantState?.refAdvisory && (
          <p className="bsl-advisory" role="status">
            {assistantState.refAdvisory}
          </p>
        )}
      </div>

      <div className="bsl-field">
        <label className="bsl-label" htmlFor={`${id}-instruction`}>
          {r.instructionLabel}
        </label>
        <textarea
          id={`${id}-instruction`}
          className="bsl-input bsl-textarea"
          rows={3}
          maxLength={STUDIO_LIMITS.promptMax}
          value={instruction}
          placeholder={references.length ? r.placeholderWithRef : r.placeholderNoRef}
          onChange={(event) => {
            setInstruction(event.target.value);
            setBeforeEnhance(null);
            setErrorNote(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </div>

      <div className="bsl-enhance-block">
        <div className="bsl-enhance-row">
          <label className="bsl-check">
            <input type="checkbox" checked={enhance} onChange={(event) => setEnhance(event.target.checked)} />
            <span>{r.enhanceLabel}</span>
          </label>
          <button
            type="button"
            className="bsl-tip-btn"
            aria-label={r.enhanceTipLabel}
            aria-expanded={showEnhanceTip}
            onClick={() => setShowEnhanceTip((v) => !v)}
          >
            !
          </button>
          <span className="bsl-spacer" />
          {beforeEnhance !== null ? (
            <button
              type="button"
              className="bsl-btn"
              data-variant="ghost"
              data-size="sm"
              onClick={() => {
                setInstruction(beforeEnhance);
                setBeforeEnhance(null);
              }}
            >
              {r.undoEnhance}
            </button>
          ) : (
            <button
              type="button"
              className="bsl-btn"
              data-variant="soft"
              data-size="sm"
              disabled={enhancing || !instruction.trim() || !box}
              onClick={() => void previewRewrite()}
            >
              {enhancing ? r.enhancing : r.previewEnhance}
            </button>
          )}
        </div>
        {showEnhanceTip && <p className="bsl-tip-box">{r.enhanceTip}</p>}
      </div>

      {!region.fixedModel && (
      <div className={qualities.length ? "bsl-grid2" : "bsl-field"}>
        <div className="bsl-field">
          <label className="bsl-label" htmlFor={`${id}-model`}>
            {r.modelLabel}
          </label>
          <select id={`${id}-model`} className="bsl-input" value={model} onChange={(event) => setModel(event.target.value)}>
            {region.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {qualities.length > 0 && (
          <div className="bsl-field">
            <label className="bsl-label" htmlFor={`${id}-quality`}>
              {r.qualityLabel}
            </label>
            <select id={`${id}-quality`} className="bsl-input" value={quality} onChange={(event) => setQuality(event.target.value)}>
              {qualities.map((q) => (
                <option key={q} value={q}>
                  {r.qualities[q as keyof typeof r.qualities] ?? q}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      )}

      {errorNote && (
        <p className="bsl-error" role="alert">
          {errorNote}
        </p>
      )}

      <button
        type="submit"
        className="bsl-btn bsl-region-submit bsl-num"
        data-variant="solid"
        data-size="md"
        disabled={submitting}
        aria-busy={submitting}
        data-layers-region-send
      >
        {fill(r.submitCta, { credits: formattedCredits })}
      </button>
    </form>
  );
}

function presetModel(asked: string | undefined, region: LayerEditorRegionSupport): string {
  // Region edit v2: a rerun of an edit made on another model runs on the one engine too.
  if (region.fixedModel) return region.defaultModel;
  if (asked && region.models.some((m) => m.id === asked)) return asked;
  return region.defaultModel;
}
