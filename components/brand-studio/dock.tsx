"use client";
/**
 * The prompt bar (docs/STUDIO-PRO-SUITE-V4.md §1, BRAND-STUDIO-V3.md §4): one rounded translucent panel
 * floating over the bottom centre of the wall. Top: the reference row (square thumbnails with `@kindN`
 * badges and bidirectional blue focus rings when mentioned). Middle: zero-drift `<PromptHighlight>`
 * backdrop + `<textarea>`. Bottom: compact model/ratio/resolution/quality/count/duration/sound chips,
 * and on the right the screen's one solid button with this run's cost in credits.
 *
 * Manual `자동 개선(✨)` controls are removed: the Silent Multimodal Director runs automatically on submit,
 * and when Video Studio's Sequence Rail expands to full timeline height, `collapsed` renders a sleek
 * 1-line floating pill button.
 */
import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { extractClipboardImages, prepareClipboardUploadFiles } from "@/lib/brand-studio/clipboard-image";
import {
  STUDIO_AUDIO_MODES,
  STUDIO_LIMITS,
  STUDIO_SHOT_LIMITS,
  type StudioAllowanceView,
  type StudioAssetView,
} from "@/lib/brand-studio/contracts";
import { creditsLeft } from "@/lib/brand-studio/credits";
import type { StudioMedium, StudioVideoModel } from "@/lib/brand-studio/models";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";
import { uploadKind } from "./api";
import {
  AtMentionMenu,
  applyMentionInsertion,
  buildAtMentionCandidates,
  detectMentionTrigger,
  stepMentionIndex,
  type AtMentionCandidate,
} from "./at-mention-menu";
import { credits, fill, formatDay, type StudioCopy, type StudioLocale } from "./copy";
import {
  DRAFT_RESOLUTION,
  dockControls,
  draftAfterAttach,
  remixActive,
  remixBlocking,
  remixBlueprintFit,
  remixFit,
  resolveUnifiedRemixMethod,
  withModel,
  type DockDraft,
} from "./dock-model";
import { ModelMenu } from "./gallery/model-menu";
import { StudioIcon } from "./icons";
import { PromptHighlight, resolvePromptMentions } from "./prompt-highlight";
import { RemixPanel } from "./remix-panel";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource, type TrayItem } from "./refs";
import { Tray } from "./tray";
import { filmLimitLine } from "./use-dock";
import type { FilmState } from "./use-studio";

export interface DockProps {
  /** The screen's medium; the bar never offers the other one. */
  mode?: StudioMedium;
  draft: DockDraft;
  tray: readonly TrayItem[];
  labels: readonly string[];
  copy: StudioCopy;
  locale: StudioLocale;
  allowance: StudioAllowanceView;
  /** This run's expected cost in credits (dock-model.ts `dockCredits`, the server's arithmetic). */
  credits: number;
  busy: boolean;
  message: string | null;
  /** A quiet line about something the bar did on its own. */
  notice?: string | null;
  /** The screen's latest status line, shown as a small pill above the bar (the screen announces it). */
  toast?: string | null;
  film: FilmState | null;
  uploading: readonly string[];
  initialOpenRef?: string | null;
  /** Kept optional for caller compatibility while background Silent Director runs automatically. */
  enhancing?: boolean;
  enhanced?: boolean;
  /** Opens the model list first (tests). */
  initialModelMenu?: boolean;
  /** `dict.studioVideo`, for the reference-video panel's link to the full reverse panel (video screen). */
  videoCopy?: Dictionary["studioVideo"];
  /** Organization assets searchable in `@` autocomplete (Section 2: 에셋에서 바로 추가). */
  availableAssets?: readonly StudioAssetView[];
  /** Recent generated outputs searchable in `@` autocomplete (Section 2: 에셋에서 바로 추가). */
  recentOutputs?: readonly TrayItem[];
  /** Collapsed 1-line floating pill mode when Video Studio's Sequence Rail expands to full height. */
  collapsed?: boolean;
  collapsedLabel?: string;
  onExpand?(): void;
  /** Direct 1-click attach handler for `@` autocomplete unattached items. */
  onAttachItem?(item: TrayItem): void;
  /** Opens `ClipTrimModal` for `@video1` directly from the tray chip or over-30s banner. */
  onTrimVideo?(item: TrayItem): void;
  onDraft(next: DockDraft): void;
  onTrayUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onTrayRemove(key: string): void;
  onTrayMove?(from: number, to: number): void;
  onSubmit(): void;
  onDropSource(source: RefSource): void;
  onFiles(files: File[]): void;
  onBrowse(): void;
  onEnhance?(): void;
  onUndoEnhance?(): void;
}

/** The bar's real height as `--bs-dock-h` on the page, so the wall, popovers and the help launcher clear it. */
function useDockHeight(collapsed: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--bs-dock-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(write);
    observer.observe(el);
    write();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bs-dock-h");
    };
  }, [collapsed]);
  return ref;
}

/** Grows the text field with what is typed, up to six lines, keeping the backdrop height & scroll synced. */
function useAutoGrow(value: string, backdropRef: React.RefObject<HTMLDivElement | null>, collapsed: boolean) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (collapsed) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = `${Math.min(el.scrollHeight, 6 * 24 + 20)}px`;
    el.style.height = nextHeight;
    if (backdropRef.current) {
      backdropRef.current.style.height = nextHeight;
      backdropRef.current.scrollTop = el.scrollTop;
    }
  }, [backdropRef, collapsed, value]);
  return ref;
}

export function Dock(props: DockProps) {
  const { draft, tray, copy, locale, busy, message, onDraft, mode = draft.medium, enhancing = false, collapsed = false } = props;
  const d = copy.dock;
  const id = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const form = useDockHeight(collapsed);
  const field = useAutoGrow(draft.prompt, backdropRef, collapsed);
  const controls = dockControls(draft);
  const remix = remixActive(draft, tray);
  const effectiveMethod = remix ? resolveUnifiedRemixMethod(draft, tray) : draft.method;
  const effectiveDraft = remix && effectiveMethod !== draft.method ? { ...draft, method: effectiveMethod } : draft;
  const fit = remix ? remixFit(effectiveDraft, tray) : null;
  const bpFit = remix ? remixBlueprintFit(effectiveDraft, tray) : null;
  const rawLimits = controls.model.medium === "video" ? (controls.model as StudioVideoModel).referenceVideoSeconds : null;
  const limits = rawLimits
    ? effectiveMethod === "blueprint"
      ? { ...rawLimits, max: STUDIO_SHOT_LIMITS.secondsMax }
      : rawLimits
    : null;
  // A blueprint only reads the clip, so pixel size and >30s..600s never stop it (`remixBlocking`).
  const blocking = remixBlocking(effectiveDraft, fit, bpFit);
  const filmLimit =
    fit && limits && rawLimits
      ? blocking
        ? filmLimitLine(blocking, limits, copy)
        : !fit.editable && effectiveMethod !== "blueprint"
          ? filmLimitLine("edit", rawLimits, copy)
          : null
      : null;
  const filmTrayItem = remix ? (tray.find((item) => item.kind === "video") ?? null) : null;
  const filmAsset = filmTrayItem?.assetId ?? null;
  const resolvedVideoCopy = props.videoCopy ?? (locale === "ko" ? studioVideoKo : studioVideoEn);

  const [dropActive, setDropActive] = useState(false);
  const [mention, setMention] = useState<{
    open: boolean;
    query: string;
    atIndex: number;
    cursor: number;
    activeIndex: number;
  }>({ open: false, query: "", atIndex: -1, cursor: 0, activeIndex: 0 });
  const depth = useRef(0);
  const set = (patch: Partial<DockDraft>) => onDraft({ ...draft, ...patch });
  const cost = credits(copy.credits.amount, props.credits, locale);

  const { mentionedKeys } = useMemo(
    () => resolvePromptMentions(draft.prompt, tray),
    [draft.prompt, tray],
  );

  const candidates = useMemo(
    () =>
      mention.open
        ? buildAtMentionCandidates({
            query: mention.query,
            mode,
            tray,
            availableAssets: props.availableAssets,
            recentOutputs: props.recentOutputs,
            copy,
            outputBadgeLabel: resolvedVideoCopy.remix.atMenu.outputBadge,
          })
        : { attached: [], library: [], flat: [] },
    [copy, mention.open, mention.query, mode, props.availableAssets, props.recentOutputs, resolvedVideoCopy.remix.atMenu.outputBadge, tray],
  );
  const safeMentionIndex = candidates.flat.length > 0 ? Math.min(mention.activeIndex, candidates.flat.length - 1) : 0;

  useEffect(() => {
    if (!mention.open) return;
    const onDown = (event: PointerEvent) => {
      const root = form.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setMention((cur) => ({ ...cur, open: false }));
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [form, mention.open]);

  const syncMentionFromCursor = (text: string, cursor: number) => {
    if (isComposingRef.current) return;
    const trig = detectMentionTrigger(text, cursor);
    if (!trig.active) {
      setMention((cur) => (cur.open ? { ...cur, open: false } : cur));
      return;
    }
    setMention((cur) => ({
      open: true,
      query: trig.query,
      atIndex: trig.atIndex,
      cursor,
      activeIndex: cur.open && cur.query === trig.query && cur.atIndex === trig.atIndex ? cur.activeIndex : 0,
    }));
  };

  const pickMentionCandidate = (candidate: AtMentionCandidate) => {
    if (isComposingRef.current) return;
    const cursor = field.current?.selectionStart ?? mention.cursor;
    const inserted = applyMentionInsertion(draft.prompt, cursor, mention.atIndex, candidate.token);
    if (candidate.attachItem) {
      const nextTray = [...tray, candidate.attachItem];
      const nextDraft = draftAfterAttach(draft, candidate.attachItem, Boolean(props.mode), nextTray);
      if (props.onAttachItem) {
        props.onAttachItem(candidate.attachItem);
      } else if (candidate.attachItem.assetId) {
        props.onDropSource({ assetId: candidate.attachItem.assetId });
      } else if (candidate.attachItem.outputId) {
        props.onDropSource({ outputId: candidate.attachItem.outputId });
      }
      onDraft({ ...nextDraft, prompt: inserted.text });
    } else {
      set({ prompt: inserted.text });
    }
    setMention((cur) => ({ ...cur, open: false }));
    requestAnimationFrame(() => {
      const el = field.current;
      if (el) {
        el.focus();
        el.setSelectionRange(inserted.nextCursor, inserted.nextCursor);
      }
    });
  };

  const dragIn = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    depth.current += 1;
    setDropActive(true);
  };
  const dragOver = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const dragOut = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDropActive(false);
  };
  const drop = (event: DragEvent) => {
    if (!acceptsDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    depth.current = 0;
    setDropActive(false);
    const source = decodeRefDrag(event.dataTransfer.getData(REF_DRAG_TYPE));
    if (source) props.onDropSource(source);
    else if (event.dataTransfer.files.length) props.onFiles(Array.from(event.dataTransfer.files));
  };

  if (collapsed) {
    const collapsedText =
      props.collapsedLabel ??
      (mode === "video"
        ? locale === "ko"
          ? "새 컷 · 장면 추가"
          : "Add shot"
        : d.label);
    const leftText = allowanceText(props.allowance, copy, locale).value;
    const trayCountText =
      tray.length > 0
        ? locale === "ko"
          ? `참조 ${tray.length}`
          : `${tray.length} ref${tray.length === 1 ? "" : "s"}`
        : null;
    return (
      <button
        ref={(node) => {
          form.current = node;
        }}
        type="button"
        className="bs-dock bs-dock-collapsed"
        data-studio-dock
        data-mode={mode}
        data-collapsed=""
        aria-label={collapsedText}
        onClick={() => props.onExpand?.()}
      >
        <span className="bs-dock-collapsed-plus" aria-hidden="true">
          <StudioIcon name="plus" />
        </span>
        <span className="bs-dock-collapsed-label">{collapsedText}</span>
        <span className="bs-dock-collapsed-meta bs-num">
          {trayCountText && (
            <span className="bs-dock-collapsed-tray" data-collapsed-tray-count={tray.length}>
              {trayCountText}
            </span>
          )}
          <span className="bs-dock-collapsed-credits">{leftText}</span>
        </span>
      </button>
    );
  }

  return (
    <form
      ref={(node) => {
        form.current = node;
      }}
      className="bs-dock"
      data-studio-dock
      data-mode={mode}
      data-drop-target={dropActive ? "" : undefined}
      aria-label={d.label}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      onDragEnter={dragIn}
      onDragOver={dragOver}
      onDragLeave={dragOut}
      onDrop={drop}
    >
      {props.toast && (
        <p className="bs-dock-toast" aria-hidden="true" data-studio-toast>
          {props.toast}
        </p>
      )}
      <Tray
        items={tray}
        labels={props.labels}
        medium={draft.medium}
        copy={copy}
        dropActive={dropActive}
        uploading={props.uploading}
        initialOpen={props.initialOpenRef ?? null}
        mentionedKeys={mentionedKeys}
        onTrimVideo={props.onTrimVideo}
        trimLabel={resolvedVideoCopy.remix.trayTrim}
        onUpdate={props.onTrayUpdate}
        onRemove={props.onTrayRemove}
        onMove={props.onTrayMove ?? (() => {})}
        onBrowse={props.onBrowse}
      />
      {remix && (
        <RemixPanel
          draft={effectiveDraft}
          film={props.film}
          copy={copy}
          disabled={busy}
          limit={filmLimit}
          editable={fit?.editable ?? true}
          videoSeconds={filmTrayItem?.seconds ?? null}
          rawMaxSeconds={rawLimits?.max ?? 30}
          videoCopy={props.videoCopy}
          videoAssetId={filmAsset}
          onTrimVideo={filmTrayItem && props.onTrimVideo ? () => props.onTrimVideo!(filmTrayItem) : undefined}
          onChange={set}
        />
      )}
      <div className="bs-prompt-wrap" data-enhancing={enhancing ? "" : undefined}>
        {mention.open && (
          <AtMentionMenu
            id={`${id}-at-menu`}
            attached={candidates.attached}
            library={candidates.library}
            activeIndex={safeMentionIndex}
            copy={copy}
            videoCopy={props.videoCopy}
            onHighlight={(idx) => setMention((cur) => ({ ...cur, activeIndex: idx }))}
            onSelect={pickMentionCandidate}
          />
        )}
        <label className="bs-sr" htmlFor={`${id}-prompt`}>
          {d.label}
        </label>
        <PromptHighlight prompt={draft.prompt} tray={tray} backdropRef={backdropRef} />
        <textarea
          ref={field}
          id={`${id}-prompt`}
          className="bs-prompt"
          rows={1}
          maxLength={STUDIO_LIMITS.promptMax}
          value={draft.prompt}
          placeholder={mode === "video" ? d.placeholderVideo : d.placeholder}
          aria-describedby={message ? `${id}-message` : undefined}
          aria-expanded={mention.open ? true : undefined}
          aria-controls={mention.open ? `${id}-at-menu` : undefined}
          aria-activedescendant={mention.open && candidates.flat.length > 0 ? `${id}-at-menu-opt-${safeMentionIndex}` : undefined}
          aria-busy={enhancing}
          readOnly={enhancing}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onScroll={(event) => {
            if (backdropRef.current) {
              backdropRef.current.scrollTop = event.currentTarget.scrollTop;
            }
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            isComposingRef.current = false;
            const el = event.currentTarget;
            syncMentionFromCursor(el.value, el.selectionStart ?? el.value.length);
          }}
          onChange={(event) => {
            const nextText = event.target.value;
            const cursor = event.target.selectionStart ?? nextText.length;
            set({ prompt: nextText });
            const nativeComposing = Boolean((event.nativeEvent as InputEvent | undefined)?.isComposing);
            if (!isComposingRef.current && !nativeComposing) {
              syncMentionFromCursor(nextText, cursor);
            }
          }}
          onClick={(event) => {
            if (isComposingRef.current) return;
            syncMentionFromCursor(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
          }}
          onKeyUp={(event) => {
            if (isComposingRef.current || event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Tab" || event.key === "Escape") return;
            syncMentionFromCursor(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
          }}
          onKeyDown={(event) => {
            if (isComposingRef.current || event.nativeEvent.isComposing) return;
            if (mention.open) {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setMention((cur) => ({ ...cur, open: false }));
                return;
              }
              if (event.key === "ArrowDown" && candidates.flat.length > 0) {
                event.preventDefault();
                setMention((cur) => ({ ...cur, activeIndex: stepMentionIndex(safeMentionIndex, 1, candidates.flat.length) }));
                return;
              }
              if (event.key === "ArrowUp" && candidates.flat.length > 0) {
                event.preventDefault();
                setMention((cur) => ({ ...cur, activeIndex: stepMentionIndex(safeMentionIndex, -1, candidates.flat.length) }));
                return;
              }
              if (
                ((event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) || event.key === "Tab") &&
                candidates.flat.length > 0
              ) {
                event.preventDefault();
                const chosen = candidates.flat[safeMentionIndex];
                if (chosen) pickMentionCandidate(chosen);
                return;
              }
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onPaste={(event) => {
            const clipboardImages = extractClipboardImages(event.clipboardData);
            if (clipboardImages.length > 0) {
              event.preventDefault();
              void prepareClipboardUploadFiles(clipboardImages).then((ready) => props.onFiles(ready));
              return;
            }
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) => uploadKind(file.type) !== null);
            if (!files.length) return;
            event.preventDefault();
            props.onFiles(files);
          }}
        />
      </div>
      {message && (
        <p id={`${id}-message`} className="bs-dock-message" role="alert" data-studio-dock-message>
          {message}
        </p>
      )}
      {props.notice && (
        <p className="bs-dock-note" role="status" data-studio-dock-notice>
          {props.notice}
        </p>
      )}
      <div className="bs-controls">
        <div className="bs-controls-set" data-studio-controls>
          <ModelMenu
            models={controls.models}
            value={controls.model.id}
            draft={draft}
            references={tray.length}
            copy={copy}
            locale={locale}
            initialOpen={props.initialModelMenu}
            onChange={(value) => onDraft(withModel(draft, value))}
          />
          <Select id={`${id}-aspect`} label={d.aspect} value={draft.aspect} display={draft.aspect} onChange={(aspect) => set({ aspect })} data="aspect" mono>
            {controls.aspects.map((aspect) => (
              <option key={aspect} value={aspect}>
                {aspect}
              </option>
            ))}
          </Select>
          <Select
            id={`${id}-resolution`}
            label={d.resolution}
            value={draft.resolution}
            display={draft.resolution === DRAFT_RESOLUTION ? d.draft : draft.resolution}
            onChange={(resolution) => set({ resolution })}
            data="resolution"
            mono
          >
            {controls.resolutions.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution === DRAFT_RESOLUTION ? d.draft : resolution}
              </option>
            ))}
          </Select>
          {controls.qualities.length > 0 && (
            <Select
              id={`${id}-quality`}
              label={d.quality}
              value={draft.quality}
              display={copy.qualities[draft.quality as keyof StudioCopy["qualities"]] ?? draft.quality}
              onChange={(quality) => set({ quality })}
              data="quality"
            >
              {controls.qualities.map((quality) => (
                <option key={quality} value={quality}>
                  {copy.qualities[quality as keyof StudioCopy["qualities"]] ?? quality}
                </option>
              ))}
            </Select>
          )}
          {draft.medium === "image" ? (
            <Select id={`${id}-count`} label={d.count} value={String(draft.count)} display={fill(d.countValue, { n: draft.count })} onChange={(value) => set({ count: Number(value) })} data="count" mono>
              {controls.counts.map((n) => (
                <option key={n} value={n}>
                  {fill(d.countValue, { n })}
                </option>
              ))}
            </Select>
          ) : (
            !(remix && (effectiveMethod === "edit" || (draft.clipCount ?? 1) >= 2)) && (
              <Select
                id={`${id}-seconds`}
                label={d.seconds}
                value={String(draft.seconds)}
                display={fill(d.secondsValue, { n: draft.seconds })}
                onChange={(value) => {
                  const sec = Number(value);
                  set({ seconds: sec, ...(remix ? { targetTotalSeconds: sec, clipCount: 1 } : {}) });
                }}
                data="seconds"
                mono
              >
                {controls.seconds.map((n) => (
                  <option key={n} value={n}>
                    {fill(d.secondsValue, { n })}
                  </option>
                ))}
              </Select>
            )
          )}
          {draft.medium === "video" && !remix && (
            <Select id={`${id}-sound`} label={d.sound} quietLabel value={draft.audio} display={copy.sound[draft.audio]} onChange={(audio) => set({ audio: audio as DockDraft["audio"] })} data="sound">
              {STUDIO_AUDIO_MODES.map((m) => (
                <option key={m} value={m}>
                  {copy.sound[m]}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="bs-controls-end">
          <button
            type="submit"
            className="bs-btn bs-submit"
            data-variant="solid"
            data-size="md"
            disabled={busy || enhancing || Boolean(blocking)}
            aria-label={busy ? d.submitting : fill(d.submitLabel, { cost })}
            data-studio-submit
          >
            <span>{busy ? d.submitting : d.submit}</span>
            {!busy && (
              <span className="bs-submit-cost bs-num" data-studio-quote>
                {cost}
              </span>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

/** A "!" button whose tooltip opens on hover and on keyboard focus (and stays readable by screen readers). */
export function Tip({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <span className="bs-tip" data-studio-tip>
      <button type="button" className="bs-tip-btn" aria-label={label} aria-describedby={id}>
        <span aria-hidden="true">!</span>
      </button>
      <span id={id} role="tooltip" className="bs-tip-body">
        {children}
      </span>
    </span>
  );
}

function Select({
  id,
  label,
  quietLabel = true,
  value,
  display,
  onChange,
  data,
  mono = false,
  children,
}: {
  id: string;
  label: string;
  /** The value says what it is (a ratio, a quality): keep the label for screen readers only. */
  quietLabel?: boolean;
  value: string;
  display: string;
  onChange(value: string): void;
  data: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="bs-select" data-control={data} data-mono={mono ? "" : undefined}>
      <label htmlFor={id} className={quietLabel ? "bs-sr" : undefined}>
        {label}
      </label>
      <span className="bs-select-value" aria-hidden="true">
        {display}
      </span>
      <StudioIcon name="chevron" />
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </span>
  );
}

function allowanceText(allowance: StudioAllowanceView, copy: StudioCopy, locale: StudioLocale) {
  const cap = Math.max(0, allowance.capKrw);
  const used = Math.max(0, allowance.usedKrw);
  const left = creditsLeft(cap, used);
  const total = creditsLeft(cap, 0);
  return { left, total, value: credits(copy.credits.left, left, locale) };
}

/** "남은 크레딧 12,340" with the refill day in its tooltip (the page header shows it). */
export function AllowanceLine({ allowance, copy, locale }: { allowance: StudioAllowanceView; copy: StudioCopy; locale: StudioLocale }) {
  const { value } = allowanceText(allowance, copy, locale);
  const day = formatDay(allowance.resetsAt, locale);
  return (
    <p className="bs-allowance bs-num" title={day ? fill(copy.dock.resets, { date: day }) : undefined} data-studio-allowance>
      {value}
    </p>
  );
}
