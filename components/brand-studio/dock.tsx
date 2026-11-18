"use client";
/**
 * The prompt bar (docs/STUDIO-PRO-SUITE-V4.md §1, BRAND-STUDIO-V3.md §4): one rounded translucent panel
 * floating over the bottom centre of the wall. Top: the reference row (square thumbnails with `@kindN`
 * badges and bidirectional blue focus rings when mentioned). Middle: zero-drift `<PromptHighlight>`
 * backdrop + `<textarea>`. Bottom: compact model/ratio/resolution/quality/count/duration/sound chips,
 * each opening its own dark list (./gallery/chip-select.tsx, never a native `<select>`), then the prompt
 * rewrite: a switch for rewriting on send (on by default) and a button that rewrites the sentence in the
 * field now, where it can be edited or taken back. On the right the screen's one solid button with this
 * run's cost in credits.
 *
 * When Video Studio's Sequence Rail expands to full timeline height, `collapsed` renders a sleek 1-line
 * floating pill button.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
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
  trayVirtualTags,
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
import { AspectShape, ChipSelect } from "./gallery/chip-select";
import { ModelMenu } from "./gallery/model-menu";
import { StudioIcon } from "./icons";
import { PromptHighlight, mentionAtCaret, resolvePromptMentions, type PromptMentionSegment } from "./prompt-highlight";
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
  /** The project this run goes into, when one is chosen (`BRAND_STUDIO_PROJECTS`). Absent: nothing is drawn. */
  project?: { title: string; hint: string } | null;
  film: FilmState | null;
  uploading: readonly string[];
  initialOpenRef?: string | null;
  /** The rewrite button is waiting for its sentence. */
  enhancing?: boolean;
  /** The field holds a rewritten sentence and the customer's own words are kept for "원래 문장으로". */
  enhanced?: boolean;
  /** Opens the model list first (tests). */
  initialModelMenu?: boolean;
  /** Opens that chip's list first: "aspect", "resolution", "quality", "count", "seconds" or "sound" (tests). */
  initialOpenControl?: string;
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

/** Where a tooltip for one mention goes: above its first painted line, in the prompt box's coordinates. */
interface MentionTip {
  start: number;
  left: number;
  top: number;
}

/** The first visible rect of the mark that starts at `start`, relative to `host`; null when scrolled away. */
function markTip(backdrop: HTMLElement | null, host: HTMLElement | null, scroller: HTMLElement | null, start: number): MentionTip | null {
  if (!backdrop || !host) return null;
  const mark = backdrop.querySelector<HTMLElement>(`mark[data-mention-start="${start}"]`);
  const rect = mark?.getClientRects()[0];
  if (!rect) return null;
  const view = scroller?.getBoundingClientRect();
  if (view && (rect.bottom < view.top || rect.top > view.bottom)) return null;
  const box = host.getBoundingClientRect();
  return { start, left: Math.round(rect.left + rect.width / 2 - box.left), top: Math.round(rect.top - box.top) };
}

/** The mark under a pointer position, read from the painted layer (the field above it is transparent). */
function markAtPoint(backdrop: HTMLElement | null, x: number, y: number): number | null {
  if (!backdrop) return null;
  for (const mark of backdrop.querySelectorAll<HTMLElement>("mark[data-mention-start]")) {
    for (const r of mark.getClientRects()) {
      if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return Number(mark.dataset.mentionStart);
    }
  }
  return null;
}

export function Dock(props: DockProps) {
  const { draft, tray, copy, locale, busy, message, onDraft, mode = draft.medium, enhancing = false, collapsed = false } = props;
  const d = copy.dock;
  const id = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  const form = useDockHeight(collapsed);
  const field = useRef<HTMLTextAreaElement>(null);
  // The link between a mention in the field and its thumbnail: the mention under the pointer or the caret,
  // and the thumbnail under the pointer or keyboard focus.
  const [pointerStart, setPointerStart] = useState<number | null>(null);
  const [caretStart, setCaretStart] = useState<number | null>(null);
  const [thumbKey, setThumbKey] = useState<string | null>(null);
  const [tip, setTip] = useState<MentionTip | null>(null);
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
  const opens = (control: string) => props.initialOpenControl === control;

  const { mentionedKeys, segments } = useMemo(
    () => resolvePromptMentions(draft.prompt, tray),
    [draft.prompt, tray],
  );
  // "@image1" under each thumbnail, by tray key: the name a mention's tooltip and announcement use.
  const tags = useMemo(() => {
    const list = trayVirtualTags(tray);
    return new Map(tray.map((item, i) => [item.key, list[i] ?? ""]));
  }, [tray]);
  const activeStart = pointerStart ?? caretStart;
  const active = activeStart === null ? null : (segments.find((seg) => seg.type === "mention" && seg.start === activeStart) ?? null);
  const activeMention = active && active.type === "mention" ? active : null;
  const linkedKeys = useMemo(
    () => new Set(activeMention ? activeMention.matchedKeys : thumbKey ? [thumbKey] : []),
    [activeMention, thumbKey],
  );
  const describe = (seg: PromptMentionSegment) =>
    seg.bound ? seg.matchedKeys.map((key) => tags.get(key) ?? "").filter(Boolean).join(", ") : fill(copy.tray.missing, { label: seg.text });
  const caretSeg = caretStart === null ? null : segments.find((seg) => seg.type === "mention" && seg.start === caretStart);
  const caretMention = caretSeg && caretSeg.type === "mention" ? caretSeg : null;
  // "Figure 1: @image1", or the unbound sentence (it names the mention itself).
  const caretLine = caretMention ? (caretMention.bound ? `${caretMention.text}: ${describe(caretMention)}` : describe(caretMention)) : "";

  // The tooltip follows the active mention (re-measured after every paint that can move it).
  useLayoutEffect(() => {
    setTip(activeStart === null ? null : markTip(backdropRef.current, wrapRef.current, scrollRef.current, activeStart));
  }, [activeStart, draft.prompt, tray]);

  const syncCaret = (el: HTMLTextAreaElement) => {
    const at = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
    const seg = at === null ? null : mentionAtCaret(segments, at);
    setCaretStart(seg ? seg.start : null);
  };
  // The caret also moves without a key or a click of ours (arrow keys held, a script, the IME).
  useEffect(() => {
    const onSelection = () => {
      const el = field.current;
      if (!el || document.activeElement !== el) return;
      const at = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
      const seg = at === null ? null : mentionAtCaret(segments, at);
      setCaretStart(seg ? seg.start : null);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [segments]);

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
        linkedKeys={linkedKeys}
        onLink={setThumbKey}
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
      <div
        ref={wrapRef}
        className="bs-prompt-wrap"
        data-enhancing={enhancing ? "" : undefined}
        data-enhanced={props.enhanced ? "" : undefined}
        data-composing={composing ? "" : undefined}
      >
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
        {/* One scroller around both layers: they share a grid cell, so their width is the same by construction. */}
        <div
          ref={scrollRef}
          className="bs-prompt-scroll"
          data-prompt-scroll
          onScroll={() => {
            setPointerStart(null);
            if (caretStart !== null) setTip(markTip(backdropRef.current, wrapRef.current, scrollRef.current, caretStart));
          }}
        >
          <div className="bs-prompt-stack">
            <PromptHighlight prompt={draft.prompt} tray={tray} backdropRef={backdropRef} linkedKey={thumbKey} activeStart={activeStart} />
            <textarea
              ref={field}
              id={`${id}-prompt`}
              className="bs-prompt"
              rows={1}
              maxLength={STUDIO_LIMITS.promptMax}
              value={draft.prompt}
              placeholder={mode === "video" ? d.placeholderVideo : d.placeholder}
              aria-describedby={[message ? `${id}-message` : null, caretLine ? `${id}-mention` : null].filter(Boolean).join(" ") || undefined}
              aria-expanded={mention.open ? true : undefined}
              aria-controls={mention.open ? `${id}-at-menu` : undefined}
              aria-activedescendant={mention.open && candidates.flat.length > 0 ? `${id}-at-menu-opt-${safeMentionIndex}` : undefined}
              aria-busy={enhancing}
              readOnly={enhancing}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onPointerMove={(event) => {
                if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
                const at = markAtPoint(backdropRef.current, event.clientX, event.clientY);
                if (at !== pointerStart) setPointerStart(at);
              }}
              onPointerLeave={() => setPointerStart(null)}
              onSelect={(event) => syncCaret(event.currentTarget)}
              onFocus={(event) => syncCaret(event.currentTarget)}
              onBlur={() => setCaretStart(null)}
              onCompositionStart={() => {
                isComposingRef.current = true;
                // While a syllable is being composed the field draws its own words, so the IME's underline shows.
                setComposing(true);
              }}
              onCompositionEnd={(event) => {
                isComposingRef.current = false;
                setComposing(false);
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
        </div>
        {tip && activeMention && (
          <span
            className="bs-mention-tip bs-num"
            role="tooltip"
            data-mention-tip
            data-bound={activeMention.bound ? "true" : "false"}
            style={{ left: tip.left, top: tip.top }}
          >
            {describe(activeMention)}
          </span>
        )}
        <span id={`${id}-mention`} className="bs-sr" aria-live="polite" data-mention-live>
          {caretLine}
        </span>
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
          <ChipSelect
            label={d.aspect}
            value={draft.aspect}
            options={controls.aspects.map((aspect) => ({ value: aspect, label: aspect, icon: <AspectShape ratio={aspect} /> }))}
            onChange={(aspect) => set({ aspect })}
            data="aspect"
            mono
            initialOpen={opens("aspect")}
          />
          <ChipSelect
            label={d.resolution}
            value={draft.resolution}
            options={controls.resolutions.map((resolution) => ({ value: resolution, label: resolution === DRAFT_RESOLUTION ? d.draft : resolution }))}
            onChange={(resolution) => set({ resolution })}
            data="resolution"
            mono
            initialOpen={opens("resolution")}
          />
          {controls.qualities.length > 0 && (
            <ChipSelect
              label={d.quality}
              value={draft.quality}
              options={controls.qualities.map((quality) => ({ value: quality, label: copy.qualities[quality as keyof StudioCopy["qualities"]] ?? quality }))}
              onChange={(quality) => set({ quality })}
              data="quality"
              initialOpen={opens("quality")}
            />
          )}
          {draft.medium === "image" ? (
            <ChipSelect
              label={d.count}
              value={String(draft.count)}
              options={controls.counts.map((n) => ({ value: String(n), label: fill(d.countValue, { n }) }))}
              onChange={(value) => set({ count: Number(value) })}
              data="count"
              mono
              initialOpen={opens("count")}
            />
          ) : (
            !(remix && (effectiveMethod === "edit" || (draft.clipCount ?? 1) >= 2)) && (
              <ChipSelect
                label={d.seconds}
                value={String(draft.seconds)}
                options={controls.seconds.map((n) => ({ value: String(n), label: fill(d.secondsValue, { n }) }))}
                onChange={(value) => {
                  const sec = Number(value);
                  set({ seconds: sec, ...(remix ? { targetTotalSeconds: sec, clipCount: 1 } : {}) });
                }}
                data="seconds"
                mono
                initialOpen={opens("seconds")}
              />
            )
          )}
          {draft.medium === "video" && !remix && (
            <ChipSelect
              label={d.sound}
              value={draft.audio}
              options={STUDIO_AUDIO_MODES.map((m) => ({ value: m, label: copy.sound[m] }))}
              onChange={(audio) => set({ audio: audio as DockDraft["audio"] })}
              data="sound"
              initialOpen={opens("sound")}
            />
          )}
          {!remix && (
            <span className="bs-enhance" data-studio-enhance-group>
              <button
                type="button"
                role="switch"
                className="bs-switch"
                aria-checked={draft.enhance}
                data-studio-enhance
                onClick={() => set({ enhance: !draft.enhance })}
              >
                <span className="bs-switch-knob" aria-hidden="true" />
                <span>{d.enhance}</span>
              </button>
              {props.onEnhance &&
                (props.enhanced && props.onUndoEnhance ? (
                  <button type="button" className="bs-chip-btn" data-studio-undo-enhance disabled={busy || enhancing} onClick={() => props.onUndoEnhance?.()}>
                    <StudioIcon name="undo" />
                    <span>{d.undoEnhance}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="bs-chip-btn"
                    data-studio-enhance-now
                    disabled={busy || enhancing || !draft.prompt.trim()}
                    aria-busy={enhancing}
                    onClick={() => props.onEnhance?.()}
                  >
                    <StudioIcon name="sparkles" />
                    <span>{d.enhanceNow}</span>
                  </button>
                ))}
            </span>
          )}
        </div>
        <div className="bs-controls-end">
          {props.project && (
            <span className="bs-chip bs-dock-project" title={props.project.hint} data-studio-dock-project>
              <StudioIcon name="folder" />
              <span className="bs-dock-project-name">{props.project.title}</span>
              <span className="bs-sr">{props.project.hint}</span>
            </span>
          )}
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
