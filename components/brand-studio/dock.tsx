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
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { extractClipboardImages, prepareClipboardUploadFiles } from "@/lib/brand-studio/clipboard-image";
import {
  STUDIO_AUDIO_MODES,
  STUDIO_LIMITS,
  STUDIO_SHOT_LIMITS,
  type StudioAllowanceView,
  type StudioAssetView,
  type StudioErrorCode,
} from "@/lib/brand-studio/contracts";
import { refillWording, windowDayInstant } from "@/lib/brand-studio/allowance-window";
import { creditsLeft } from "@/lib/brand-studio/credits";
import type { StudioMedium, StudioVideoModel } from "@/lib/brand-studio/models";
import type { BillingPlanCatalogueItem } from "@/lib/brands/billing-ui";
import type { BrandBillingCopy } from "@/messages/brand-billing";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";
import { uploadKind } from "./api";
import { StudioAllowanceNotice } from "./studio-allowance-notice";
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
import {
  checkBlock,
  groupControls,
  groupQuotes,
  isGroupDraft,
  modelLabel as studioModelLabel,
  pickedModels,
  sharedLabel,
  toggledPick,
  type DesignTabs,
} from "./group-model";
import { StudioIcon } from "./icons";
import { PromptHighlight, mentionAtCaret, resolvePromptMentions, type PromptMentionSegment } from "./prompt-highlight";
import { RemixPanel } from "./remix-panel";
import { REF_DRAG_TYPE, acceptsDrag, decodeRefDrag, type RefSource, type TrayItem } from "./refs";
import { usePageDrag } from "./use-page-drag";
import { Tray } from "./tray";
import { filmLimitLine } from "./use-dock";
import type { FilmState } from "./use-studio";

export interface DockProps {
  /** The screen's medium; the bar never offers the other one. */
  mode?: StudioMedium;
  organizationId?: string;
  organizationName?: string | null;
  draft: DockDraft;
  tray: readonly TrayItem[];
  labels: readonly string[];
  copy: StudioCopy;
  locale: StudioLocale;
  billingCopy?: BrandBillingCopy["customer"];
  planCatalogue?: readonly BillingPlanCatalogueItem[];
  allowance: StudioAllowanceView;
  /** This run's expected cost in credits (dock-model.ts `dockCredits`, the server's arithmetic). */
  credits: number;
  busy: boolean;
  message: string | null;
  errorCode?: StudioErrorCode | null;
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
  /**
   * The image screen: the model list gets a check per model, so one request can go to two or three models
   * at once (./group-model.ts). Absent (the video screen, tests of the single bar): one model, as always.
   */
  onModels?(ids: string[]): void;
  /** Several models after "설계하기": each model's sentence in its own tab; the field shows `active`. */
  tabs?: { tabs: DesignTabs; active: string } | null;
  onTab?(model: string): void;
  onTabText?(text: string): void;
  /** Designs one model's tab ("아직 설계 전", or one that could not be designed). */
  onDesignOne?(model: string): void;
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
  // Several image models at once: shared options are what every picked model has; count is per model.
  const multi = Boolean(props.onModels) && mode === "image";
  const picked = pickedModels(draft);
  const grouped = multi && isGroupDraft(draft);
  const common = grouped ? groupControls(picked) : null;
  const quotes = grouped ? groupQuotes(draft, tray) : [];
  // After "설계하기" on several models the field shows one model's own sentence (its tab).
  const tabbed = grouped && props.tabs && props.tabs.tabs[props.tabs.active] ? props.tabs : null;
  const activeTab = tabbed ? tabbed.tabs[tabbed.active]! : null;
  const text = activeTab ? activeTab.text : draft.prompt;
  const setText = (next: string) => (tabbed ? props.onTabText?.(next) : onDraft({ ...draft, prompt: next }));
  const tabsRef = useRef<HTMLDivElement>(null);
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
  // Video studio: while a reference or a file is dragged anywhere over the page, the bar says it takes it.
  const pageDrag = usePageDrag(mode === "video" && !collapsed, acceptsDrag);
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

  const { mentionedKeys, segments } = useMemo(() => resolvePromptMentions(text, tray), [text, tray]);
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
  }, [activeStart, text, tray]);

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
    const inserted = applyMentionInsertion(text, cursor, mention.atIndex, candidate.token);
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
      if (tabbed) {
        if (nextDraft !== draft) onDraft(nextDraft);
        setText(inserted.text);
      } else onDraft({ ...nextDraft, prompt: inserted.text });
    } else {
      setText(inserted.text);
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
      data-drop-ready={pageDrag && !dropActive ? "" : undefined}
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
        dropReady={mode === "video" && (pageDrag || dropActive)}
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
        {tabbed && (
          <PromptTabs
            id={id}
            tabsRef={tabsRef}
            picked={picked}
            tabs={tabbed.tabs}
            active={tabbed.active}
            copy={copy}
            disabled={busy}
            onTab={(model) => props.onTab?.(model)}
            onDesignOne={(model) => props.onDesignOne?.(model)}
          />
        )}
        <label className="bs-sr" htmlFor={`${id}-prompt`}>
          {tabbed ? fill(d.tabPrompt, { model: studioModelLabel(tabbed.active) }) : d.label}
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
            <PromptHighlight prompt={text} tray={tray} backdropRef={backdropRef} linkedKey={thumbKey} activeStart={activeStart} />
            <textarea
              ref={field}
              id={`${id}-prompt`}
              className="bs-prompt"
              rows={1}
              maxLength={STUDIO_LIMITS.promptMax}
              value={text}
              placeholder={mode === "video" ? d.placeholderVideo : d.placeholder}
              aria-describedby={
                [message ? `${id}-message` : null, caretLine ? `${id}-mention` : null, activeTab && activeTab.status !== "ready" ? `${id}-tab-state` : null].filter(Boolean).join(" ") ||
                undefined
              }
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
                setText(nextText);
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
      {props.errorCode === "allowance_closed" ? (
        <StudioAllowanceNotice
          kind="closed"
          organizationId={props.organizationId ?? ""}
          organizationName={props.organizationName}
          locale={locale}
          billingCopy={props.billingCopy}
          planCatalogue={props.planCatalogue}
          surface={props.mode === "video" ? "studio_video" : "studio_image"}
          solidCta={false}
        />
      ) : props.errorCode === "allowance_exhausted" ||
        (props.allowance.capKrw > 0 && creditsLeft(props.allowance.capKrw, props.allowance.usedKrw) <= 0) ? (
        <StudioAllowanceNotice
          kind="exhausted"
          organizationId={props.organizationId ?? ""}
          organizationName={props.organizationName}
          locale={locale}
          billingCopy={props.billingCopy}
          planCatalogue={props.planCatalogue}
          neededCredits={props.credits > 0 ? props.credits : null}
          remainingCredits={creditsLeft(props.allowance.capKrw, props.allowance.usedKrw)}
          resetsAt={props.allowance.resetsAt}
          allowanceWindow={props.allowance.window}
          allowanceRefill={props.allowance.refill}
          surface={props.mode === "video" ? "studio_video" : "studio_image"}
          solidCta={false}
        />
      ) : null}
      {message && props.errorCode !== "allowance_closed" && props.errorCode !== "allowance_exhausted" && (
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
            onChange={(value) => (multi ? props.onModels!([value]) : onDraft(withModel(draft, value)))}
            {...(multi
              ? {
                  picked,
                  blockOf: (model: string) => checkBlock(draft, tray, model),
                  onToggle: (model: string) => props.onModels!(toggledPick(draft, tray, model)),
                }
              : {})}
          />
          <ChipSelect
            label={d.aspect}
            value={draft.aspect}
            options={(common?.aspects ?? controls.aspects).map((aspect) => ({ value: aspect, label: aspect, icon: <AspectShape ratio={aspect} /> }))}
            onChange={(aspect) => set({ aspect })}
            data="aspect"
            mono
            initialOpen={opens("aspect")}
          />
          <ChipSelect
            label={d.resolution}
            value={draft.resolution}
            options={(common?.resolutions ?? controls.resolutions).map((resolution) => ({ value: resolution, label: resolution === DRAFT_RESOLUTION ? d.draft : resolution }))}
            onChange={(resolution) => set({ resolution })}
            data="resolution"
            mono
            initialOpen={opens("resolution")}
          />
          {(common ? common.qualities : controls.qualities).length > 0 &&
            (common ? (
              // Quality belongs to the picked models that have one: the chip and its list say which.
              <ChipSelect
                label={fill(d.qualityFor, { model: common.qualityModels.map((m) => m.label).join(", ") })}
                value={draft.quality}
                tag={sharedLabel(common.qualityModels, true)}
                note={fill(d.qualityOnly, { model: common.qualityModels.map((m) => m.label).join(", ") })}
                options={common.qualities.map((quality) => ({ value: quality, label: copy.qualities[quality as keyof StudioCopy["qualities"]] ?? quality }))}
                onChange={(quality) => set({ quality })}
                data="quality"
                initialOpen={opens("quality")}
              />
            ) : (
              <ChipSelect
                label={d.quality}
                value={draft.quality}
                options={controls.qualities.map((quality) => ({ value: quality, label: copy.qualities[quality as keyof StudioCopy["qualities"]] ?? quality }))}
                onChange={(quality) => set({ quality })}
                data="quality"
                initialOpen={opens("quality")}
              />
            ))}
          {draft.medium === "image" ? (
            <ChipSelect
              label={grouped ? d.countEachLabel : d.count}
              value={String(draft.count)}
              options={controls.counts.map((n) => ({ value: String(n), label: fill(grouped ? d.countEach : d.countValue, { n }) }))}
              onChange={(value) => set({ count: Number(value) })}
              data="count"
              mono={!grouped}
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
      {grouped && quotes.length > 1 && (
        // What each model's run takes; the button shows their sum.
        <p className="bs-dock-breakdown bs-num" data-studio-breakdown>
          <span className="bs-sr">{d.breakdown}: </span>
          {quotes.map((quote) => (
            <span key={quote.model.id} className="bs-breakdown-item" data-model={quote.model.id}>
              <span className="bs-breakdown-name">{quote.model.label}</span>
              <span className="bs-breakdown-cost">{credits(copy.credits.amount, quote.credits, locale)}</span>
            </span>
          ))}
        </p>
      )}
    </form>
  );
}

/**
 * The tabs over the prompt field after "설계하기" on several models: one per model in the order they were
 * picked, its state as a small quiet mark (being designed, not designed yet, could not be designed). ←/→
 * move between them. Under them, one line for a tab that is not designed, with the press that designs it.
 */
function PromptTabs({
  id,
  tabsRef,
  picked,
  tabs,
  active,
  copy,
  disabled,
  onTab,
  onDesignOne,
}: {
  id: string;
  tabsRef: RefObject<HTMLDivElement | null>;
  picked: readonly string[];
  tabs: DesignTabs;
  active: string;
  copy: StudioCopy;
  disabled: boolean;
  onTab(model: string): void;
  onDesignOne(model: string): void;
}) {
  const d = copy.dock;
  const order = picked.filter((model) => tabs[model]);
  const current = tabs[active];
  const state =
    current?.status === "pending"
      ? { line: d.tabPending, action: d.designOne }
      : current?.status === "failed"
        ? { line: d.enhanceFailed, action: d.designAgain }
        : current?.status === "designing"
          ? { line: d.enhancing, action: null }
          : null;
  const move = (step: number) => {
    const at = order.indexOf(active);
    const next = order[(at + step + order.length) % order.length];
    if (!next) return;
    onTab(next);
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next)}"]`)?.focus());
  };
  return (
    <div className="bs-prompt-tabs-wrap" data-studio-prompt-tabs>
      <div
        ref={tabsRef}
        className="bs-prompt-tabs"
        role="tablist"
        aria-label={d.tabsLabel}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            move(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {order.map((model) => {
          const tab = tabs[model]!;
          const selected = model === active;
          const label = studioModelLabel(model);
          return (
            <button
              key={model}
              type="button"
              role="tab"
              className="bs-prompt-tab"
              aria-selected={selected}
              aria-controls={`${id}-prompt`}
              tabIndex={selected ? 0 : -1}
              data-tab={model}
              data-status={tab.status}
              aria-busy={tab.status === "designing" || undefined}
              aria-describedby={tab.status === "ready" ? undefined : `${id}-tab-${model.replace(/[^A-Za-z0-9_-]/g, "_")}`}
              onClick={() => onTab(model)}
            >
              <span className="bs-prompt-tab-name">{label}</span>
              {tab.status !== "ready" && <span className="bs-prompt-tab-mark" aria-hidden="true" />}
              {tab.status !== "ready" && (
                <span id={`${id}-tab-${model.replace(/[^A-Za-z0-9_-]/g, "_")}`} className="bs-sr">
                  {tab.status === "pending" ? d.tabPending : tab.status === "failed" ? d.tabFailed : d.enhancing}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {state && (
        <p id={`${id}-tab-state`} className="bs-prompt-tab-state" data-studio-tab-state={current!.status}>
          <span>{state.line}</span>
          {state.action && (
            <button type="button" className="bs-link-btn" data-studio-design-one={active} disabled={disabled} onClick={() => onDesignOne(active)}>
              {state.action}
            </button>
          )}
        </p>
      )}
    </div>
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

/**
 * "남은 크레딧 12,340" with the refill day in its tooltip (the page header shows it). R4: a trial-only organization's
 * tooltip gives the trial's last day; extra credits without a trial refill on no date, so there is no tooltip.
 */
export function AllowanceLine({ allowance, copy, locale }: { allowance: StudioAllowanceView; copy: StudioCopy; locale: StudioLocale }) {
  const { value } = allowanceText(allowance, copy, locale);
  const wording = refillWording(allowance.refill);
  const day =
    wording.kind === "trial"
      ? formatDay(windowDayInstant(wording.through).toISOString(), locale)
      : wording.kind === "hidden"
        ? ""
        : formatDay(allowance.resetsAt, locale);
  const tooltip = wording.kind === "trial" ? copy.dock.resetsTrial : copy.dock.resets;
  return (
    <p className="bs-allowance bs-num" title={day ? fill(tooltip, { date: day }) : undefined} data-studio-allowance>
      {value}
    </p>
  );
}
