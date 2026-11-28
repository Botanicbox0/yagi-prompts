'use client';

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { COMPOSE_DIMENSIONS } from '@/lib/brand-studio/compose/timeline';
import { FIXTURE_SPEECH, materialBySrc } from '@/lib/brand-studio/editor-v2/fixture';
import {
  FRAME_STRIP_PX,
  MAX_PX_PER_FRAME,
  clipFrameAt,
  formatTimecode,
  moveClip as moveClipInSequence,
  ppfToSlider,
  rulerTicks,
  sliderToPpf,
  snapFrame,
  trimClipEdge,
  visibleCaptions,
  zoomScrollLeft,
} from '@/lib/brand-studio/editor-v2/frames';
import { formatSpeed } from '@/lib/brand-studio/editor-v2/speed-curve';
import { duckEnvelope, envelopeGainAt, waveform } from '@/lib/brand-studio/editor-v2/model';
import { formatBinding } from '@/lib/brand-studio/editor-v2/shortcuts';
import {
  DRAG_ACTIVATION_PX,
  OVERLAY_ROW_HEIGHT,
  TRACK_LIFT_HYSTERESIS_PX,
  collectSnapTargets,
  computeDropTarget,
  overlayTracksOf,
  p7MainTrackDropAndReorder,
  p8ComputeSnap,
  reconcileLinkedOverlays,
  tracksAfterClosingMain,
  trimOverlayEdge,
  type DropTarget,
  type OverlayClip,
  type TrackRowRect,
} from '@/lib/brand-studio/editor-v2/tracks';
import { FrameThumbs, type ThumbRequest } from './frame-thumbs';
import { EditorIcon } from './icons';
import {
  DRAG_THRESHOLD_PX,
  LANE_KINDS,
  LANE_MAX_HEIGHT,
  LANE_MIN_HEIGHT,
  clampLaneHeight,
  effectiveLaneHeight,
  filmstripSampleStep,
  filmstripTileWidth,
  isLayoutSized,
  stepLaneByKey,
  thumbDecodeHeight,
  visibleLanes,
  type LaneKind,
} from './layout-model';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

const useIsoLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

type Drag =
  | { kind: 'trim'; index: number; edge: 'start' | 'end'; delta: number; guideFrame?: number | null }
  | { kind: 'move'; index: number; toIndex: number; dx: number; guideFrame?: number | null }
  | {
      kind: 'lift';
      index: number;
      clipId: string;
      clipLabel: string;
      thumbUrl: string | null;
      frames: number;
      startFrame: number;
      pointerY: number;
      guideFrame: number | null;
      /** True once the pointer crossed above the main row to lift the cut (S4). */
      wasLifted: boolean;
      target: DropTarget;
    }
  | {
      kind: 'overlay-move';
      clipId: string;
      clipLabel: string;
      thumbUrl: string | null;
      trackIndex: number;
      frames: number;
      startFrame: number;
      pointerY: number;
      guideFrame: number | null;
      target: DropTarget;
    }
  | { kind: 'overlay-trim'; clipId: string; edge: 'start' | 'end'; delta: number; guideFrame: number | null };

const SNAP_PX = 7;
const BAR_PX = 4;
/** From this frame width on, the filmstrip decodes real frames; below it the poster stands in. */
const REAL_FRAMES_PX = 6;
/** What "frame level" zooms to. */
const FRAME_LEVEL_PX = 64;
const PAD_PX = 40;

interface LaneResizeHandleProps {
  kind: LaneKind;
  label: string;
  height: number;
  timelineRef: RefObject<HTMLElement | null>;
  onDragEnd?: (moved: boolean) => void;
  onCommit: (kind: LaneKind, height: number | null) => void;
}

function LaneResizeHandle({ kind, label, height, timelineRef, onDragEnd, onCommit }: LaneResizeHandleProps) {
  const dragRef = useRef<{
    pointerId: number;
    target: HTMLSpanElement;
    startY: number;
    startHeight: number;
    lastHeight: number;
    moved: boolean;
    wasSized: boolean;
    rootEl: HTMLElement | null;
    cleanup: () => void;
  } | null>(null);
  const latest = useRef({ height, onDragEnd, onCommit, kind });
  latest.current = { height, onDragEnd, onCommit, kind };

  const applyLive = (el: HTMLSpanElement, next: number, rootEl: HTMLElement | null, firstMove: boolean) => {
    const tl = timelineRef.current;
    if (tl) {
      if (firstMove) {
        if (!tl.hasAttribute('data-sized')) tl.setAttribute('data-sized', '');
        tl.setAttribute('data-lane-dragging', '');
        if (rootEl && !rootEl.hasAttribute('data-sized')) rootEl.setAttribute('data-sized', '');
      }
      tl.style.setProperty(`--ev-h-${kind}`, `${next}px`);
    }
    el.setAttribute('aria-valuenow', String(next));
    el.setAttribute('aria-valuetext', `${next}px`);
  };

  const finishDrag = (commit: boolean, pointerId?: number) => {
    const active = dragRef.current;
    if (!active) return;
    if (pointerId !== undefined && active.pointerId !== pointerId) return;
    dragRef.current = null;
    active.cleanup();
    try {
      if (active.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture?.(active.pointerId);
    } catch {
      // Ignore capture release errors on detached elements.
    }
    active.target.removeAttribute('data-dragging');
    const tl = timelineRef.current;
    tl?.removeAttribute('data-lane-dragging');
    if (commit && active.moved) {
      latest.current.onDragEnd?.(true);
      latest.current.onCommit(latest.current.kind, active.lastHeight);
    } else if (!commit && active.moved && tl) {
      tl.style.removeProperty(`--ev-h-${latest.current.kind}`);
      if (!active.wasSized) {
        tl.removeAttribute('data-sized');
        active.rootEl?.removeAttribute('data-sized');
      }
      latest.current.onDragEnd?.(false);
    }
  };

  useEffect(() => () => finishDrag(false), []);

  const startDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag(true);
    const target = event.currentTarget;
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore capture errors in synthetic test environments.
    }
    const startHeight = latest.current.height;
    const tl = timelineRef.current;
    const rootEl = (tl?.closest?.('[data-studio-editor-v2]') as HTMLElement | null | undefined) ?? null;
    target.setAttribute('data-dragging', '');
    const onStop = () => finishDrag(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finishDrag(true);
    };
    window.addEventListener('blur', onStop);
    document.addEventListener('mouseleave', onStop);
    document.addEventListener('visibilitychange', onVisibility);
    dragRef.current = {
      pointerId: event.pointerId,
      target,
      startY: event.clientY,
      startHeight,
      lastHeight: startHeight,
      moved: false,
      wasSized: Boolean(tl?.hasAttribute('data-sized')),
      rootEl,
      cleanup: () => {
        window.removeEventListener('blur', onStop);
        document.removeEventListener('mouseleave', onStop);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - active.startY;
    if (!active.moved && Math.abs(deltaY) < DRAG_THRESHOLD_PX) return;
    const next = clampLaneHeight(active.startHeight + deltaY);
    if (active.moved && next === active.lastHeight) return;
    const firstMove = !active.moved;
    active.moved = true;
    active.lastHeight = next;
    applyLive(active.target, next, active.rootEl, firstMove);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const result = stepLaneByKey(event.key || event.code, latest.current.height, event);
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    latest.current.onCommit(latest.current.kind, result.next);
  };

  return (
    <span
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={LANE_MIN_HEIGHT}
      aria-valuemax={LANE_MAX_HEIGHT}
      aria-valuenow={height}
      aria-valuetext={`${height}px`}
      tabIndex={0}
      className={styles.laneResize}
      data-editor-lane-resize={kind}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={(event) => finishDrag(true, event.pointerId)}
      onPointerCancel={(event) => finishDrag(true, event.pointerId)}
      onLostPointerCapture={(event) => finishDrag(true, event.pointerId)}
      onDoubleClick={() => onCommit(kind, null)}
      onKeyDown={onKeyDown}
    />
  );
}

export function Timeline({ api }: { api: EditorApi }) {
  const { copy, doc, sequence, spans, total, fps, workspace, playhead } = api;
  const timelineRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const namesRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const mainLaneRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  const widthRef = useRef(width);
  widthRef.current = width;
  const [scrollLeft, setScrollLeft] = useState(0);
  const [zoomPpf, setZoomPpf] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [linkageMenuOpen, setLinkageMenuOpen] = useState(false);
  const linkageWrapRef = useRef<HTMLSpanElement | null>(null);
  const linkageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const suppressedWantRef = useRef(false);
  const latestWantedRef = useRef<ThumbRequest[]>([]);
  const playheadRef = useRef<HTMLSpanElement | null>(null);
  const thumbs = useRef<FrameThumbs | null>(null);
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const isSized = isLayoutSized(api.layout);
  const isSizedRef = useRef(isSized);
  isSizedRef.current = isSized;
  const wasSizedRef = useRef(isSized);
  const sizedNow = () => Boolean(isSizedRef.current || timelineRef.current?.hasAttribute('data-sized'));
  const syncScrollMetricsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const store = new FrameThumbs();
    store.setTrackRatios(apiRef.current.layout.lanes.video !== undefined);
    thumbs.current = store;
    const off = store.subscribe(repaint);
    return () => {
      off();
      store.dispose();
      thumbs.current = null;
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    const names = namesRef.current;
    if (!element) return;
    const syncVertical = () => {
      if (!sizedNow() || timelineRef.current?.hasAttribute('data-lane-dragging')) return;
      if (names && names.scrollTop !== element.scrollTop) names.scrollTop = element.scrollTop;
      playheadRef.current?.style.setProperty('--ev-scroll-y', `${element.scrollTop}px`);
    };
    const syncScrollMetrics = () => {
      const nextWidth = element.clientWidth;
      if (nextWidth !== widthRef.current) setWidth(nextWidth);
      if (!sizedNow() || timelineRef.current?.hasAttribute('data-lane-dragging')) return;
      if (names) {
        const hBar = Math.max(0, (element.offsetHeight ?? 0) - (element.clientHeight ?? 0));
        const nextPad = hBar > 0 ? `${hBar}px` : '';
        if (names.style.paddingBottom !== nextPad) names.style.paddingBottom = nextPad;
      }
      syncVertical();
    };
    syncScrollMetricsRef.current = syncScrollMetrics;
    const observer = new ResizeObserver(syncScrollMetrics);
    observer.observe(element);
    syncScrollMetrics();
    let queued = false;
    const onScroll = () => {
      if (sizedNow()) syncScrollMetrics();
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setScrollLeft(element.scrollLeft);
      });
    };
    const onNamesWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !sizedNow()) return;
      if (element.scrollHeight > element.clientHeight && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
        event.preventDefault();
        element.scrollTop += event.deltaY;
        syncScrollMetrics();
      }
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    names?.addEventListener('wheel', onNamesWheel, { passive: false });
    return () => {
      syncScrollMetricsRef.current = null;
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
      names?.removeEventListener('wheel', onNamesWheel);
    };
  }, []);

  // S3: abort any in-flight tracks drag cleanly on unmount so `tracksDragging` never gets stuck.
  useEffect(() => () => activeDragCleanupRef.current?.(), []);

  // W5: close the 연동 설정 popover on Escape (returning focus to trigger) or outside pointerdown.
  useEffect(() => {
    if (!linkageMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setLinkageMenuOpen(false);
      linkageTriggerRef.current?.focus?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (linkageWrapRef.current && target && !linkageWrapRef.current.contains(target)) {
        setLinkageMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [linkageMenuOpen]);

  const overlayDropInsert =
    api.tracksOpen && drag?.kind === 'overlay-move' && drag.target.kind === 'main-track'
      ? drag.target.insertIndex
      : -1;
  const overlayDropFrames =
    api.tracksOpen && drag?.kind === 'overlay-move' && drag.target.kind === 'main-track'
      ? drag.frames
      : 0;
  const liveMainTotal = overlayDropFrames > 0 ? (spans[spans.length - 1]?.end ?? 0) + overlayDropFrames : total;
  const fitPpf = Math.min(MAX_PX_PER_FRAME, total > 0 ? Math.max(0.2, (width - PAD_PX) / total) : 2);
  // W2 + S5c: restore exact `7165e399` fit for everyone; only allow zooming below fitPpf after an explicit track op when tracksOpen.
  const minPpf = api.tracksOpen && zoomPpf !== null ? 0.2 : fitPpf;
  const ppf = zoomPpf === null ? fitPpf : Math.min(MAX_PX_PER_FRAME, Math.max(minPpf, zoomPpf));
  const contentWidth = Math.max(width, Math.max(total, liveMainTotal) * ppf + PAD_PX);
  const live = useRef({ ppf, fitPpf, width, playhead, total });
  live.current = { ppf, fitPpf, width, playhead, total };

  // W2 + W8 + S5c: preserve current zoom (`ppf`) and scroll position ONLY after an explicit track operation
  // (lift, drop-to-main, move overlay, move up/down, overlay trim/delete) while the tracks switch is open.
  // Never triggers on initial film load, closed organizations, or ordinary main-track cut-count changes.
  const prevTrackOpRef = useRef<{ seq: number; ppf: number }>({ seq: api.trackOpSeq, ppf });
  useIsoLayoutEffect(() => {
    const prev = prevTrackOpRef.current;
    if (api.tracksOpen && api.trackOpSeq !== prev.seq) {
      if (zoomPpf === null) {
        setZoomPpf(prev.ppf);
      }
      if (scrollRef.current) {
        pendingScroll.current = scrollRef.current.scrollLeft;
      }
    }
    prevTrackOpRef.current = { seq: api.trackOpSeq, ppf };
  }, [api.tracksOpen, api.trackOpSeq, ppf, zoomPpf]);

  /** Changes the zoom and keeps `anchorX` (a position inside the visible strip) on the same frame. */
  const zoomTo = (next: number | null, anchorX: number, center = false) => {
    const element = scrollRef.current;
    const current = live.current;
    const floorPpf = apiRef.current.tracksOpen ? 0.2 : current.fitPpf;
    const target = next === null ? current.fitPpf : Math.min(MAX_PX_PER_FRAME, Math.max(floorPpf, next));
    if (element) {
      pendingScroll.current = center
        ? Math.max(0, (current.playhead + 0.5) * target - current.width / 2)
        : zoomScrollLeft(current.ppf, target, anchorX, element.scrollLeft);
    }
    setZoomPpf(
      next === null || (!apiRef.current.tracksOpen && target <= current.fitPpf + 1e-6) ? null : target,
    );
  };
  const playheadAnchor = () => {
    const element = scrollRef.current;
    const current = live.current;
    const x = current.playhead * current.ppf - (element?.scrollLeft ?? 0);
    return x >= 0 && x <= current.width ? x : current.width / 2;
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && pendingScroll.current !== null) {
      element.scrollLeft = pendingScroll.current;
      setScrollLeft(element.scrollLeft);
      pendingScroll.current = null;
    }
  }, [ppf]);

  // Ctrl/⌘ + wheel (a trackpad pinch arrives the same way) zooms around the pointer.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        // A plain wheel moves along the film when lanes do not scroll vertically (when sized) and there is horizontal room.
        if (
          Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
          (!sizedNow() || element.scrollHeight <= element.clientHeight) &&
          element.scrollWidth > element.clientWidth
        ) {
          event.preventDefault();
          element.scrollLeft += event.deltaY;
        }
        return;
      }
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomTo(live.current.ppf * Math.exp(-event.deltaY * 0.0022), event.clientX - rect.left);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // Zoom asked for by a key or a button elsewhere: around the playhead.
  const command = api.zoomCommand;
  useEffect(() => {
    if (command.n === 0) return;
    if (command.kind === 'fit') zoomTo(null, 0);
    else if (command.kind === 'frames') zoomTo(FRAME_LEVEL_PX, 0, true);
    else zoomTo(live.current.ppf * (command.kind === 'in' ? 1.6 : 1 / 1.6), playheadAnchor());
  }, [command]);

  // The playhead stays in view while stepping or playing.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || drag) return;
    const x = playhead * ppf;
    if (x < element.scrollLeft + 8) element.scrollLeft = Math.max(0, x - width * 0.2);
    else if (x + ppf > element.scrollLeft + width - 24) element.scrollLeft = x - width * 0.8;
  }, [playhead, ppf, width, drag]);

  const frameAt = (clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    return rect ? (clientX - rect.left) / ppf : 0;
  };
  const cutEdges = useMemo(() => spans.map((span) => span.start), [spans]);

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    api.setPlaying(false);
    const move = (clientX: number, free: boolean) => {
      const raw = Math.floor(frameAt(clientX));
      api.seek(api.magnet && !free ? snapFrame(raw, cutEdges, ppf, SNAP_PX) : raw);
    };
    move(event.clientX, event.shiftKey);
    const onMove = (e: PointerEvent) => move(e.clientX, e.shiftKey);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const collectRowRects = (): {
    rows: TrackRowRect[];
    mainRow: { top: number; bottom: number };
    contentTop: number;
    contentLeft: number;
    hadNewZone: boolean;
    scrollTop: number;
    scrollLeft: number;
  } => {
    const contentEl = contentRef.current;
    const mainEl = mainLaneRef.current;
    const scrollEl = scrollRef.current;
    const contentRect = contentEl?.getBoundingClientRect() ?? { top: 0, left: 0 };
    const contentTop = contentRect.top;
    const contentLeft = contentRect.left;
    const mainRect = mainEl?.getBoundingClientRect() ?? { top: contentTop + 28, bottom: contentTop + 92 };
    const mainRow = { top: mainRect.top, bottom: mainRect.bottom };
    const rows: TrackRowRect[] = [];
    if (contentEl) {
      const ovNodes = contentEl.querySelectorAll<HTMLElement>('[data-overlay-track]');
      ovNodes.forEach((node) => {
        const idx = Number(node.getAttribute('data-overlay-track'));
        if (!Number.isInteger(idx)) return;
        const r = node.getBoundingClientRect();
        rows.push({ kind: 'overlay', trackIndex: idx, top: r.top, bottom: r.bottom });
      });
    }
    rows.sort((a, b) => a.top - b.top);
    rows.push({ kind: 'main', top: mainRow.top, bottom: mainRow.bottom });
    const hadNewZone = Boolean(contentEl?.querySelector('[data-overlay-new-zone]'));
    return {
      rows,
      mainRow,
      contentTop,
      contentLeft,
      hadNewZone,
      scrollTop: scrollEl?.scrollTop ?? 0,
      scrollLeft: scrollEl?.scrollLeft ?? 0,
    };
  };

  /** W4: resolves a clip's first thumbnail from decoded filmstrip cache, clip poster, or fixture material. */
  const resolveFirstThumb = (clip: Pick<OverlayClip, 'srcUrl' | 'thumbUrl' | 'inFrame' | 'phase' | 'frames' | 'speedNum' | 'speedDen' | 'sourceFps' | 'sourceFrames' | 'speedCurve'>): string | null => {
    const picture = clipFrameAt(clip as OverlayClip, 0, fps);
    const dh = thumbDecodeHeight(api.layout.lanes.video);
    return (
      thumbs.current?.get(clip.srcUrl, picture.sourceFrame, dh) ??
      thumbs.current?.fallback(clip.srcUrl, picture.sourceFrame, dh) ??
      clip.thumbUrl ??
      materialBySrc(clip.srcUrl)?.poster ??
      null
    );
  };

  const sameDropTarget = (a: DropTarget, b: DropTarget): boolean => {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'main-track' && b.kind === 'main-track') return a.insertIndex === b.insertIndex && a.isReorder === b.isReorder;
    if (a.kind === 'overlay-row' && b.kind === 'overlay-row') return a.trackIndex === b.trackIndex && a.startFrame === b.startFrame;
    if (a.kind === 'new-track' && b.kind === 'new-track') {
      return a.insertTrackIndex === b.insertTrackIndex && a.startFrame === b.startFrame && a.lineY === b.lineY;
    }
    if (a.kind === 'refused' && b.kind === 'refused') return a.reason === b.reason;
    return false;
  };

  const startMove = (event: React.PointerEvent<HTMLDivElement>, index: number, clipId: string) => {
    if (event.button !== 0) return;
    if (api.readOnly) return api.select(clipId, event.shiftKey || event.ctrlKey || event.metaKey);
    const startX = event.clientX;
    const startY = event.clientY;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;

    // S3: Closed organizations keep the exact existing drag path untouched.
    if (!api.tracksOpen) {
      let moved = false;
      let toIndex = index;
      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        if (!moved && Math.abs(dx) < DRAG_ACTIVATION_PX) return;
        moved = true;
        const at = frameAt(e.clientX);
        toIndex = spans.filter((entry) => entry.index !== index && (entry.start + entry.end) / 2 < at).length;
        setDrag({ kind: 'move', index, toIndex, dx });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDrag(null);
        if (!moved) return api.select(clipId, additive);
        if (toIndex !== index) api.moveClip(index, toIndex);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    // Tracks-open drag path (S1, S3, W2, W3, W4): pointer capture, cancel/blur/unmount cleanup, rAF batching, cached rects.
    activeDragCleanupRef.current?.();
    const captureEl = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      captureEl.setPointerCapture?.(pointerId);
    } catch {
      // Ignore synthetic test environments without real pointer capture.
    }
    const span = spans[index];
    const initialThumb = span ? resolveFirstThumb(span.clip) : null;
    let cachedRects = collectRowRects();
    const getRects = () => {
      const scrollEl = scrollRef.current;
      const curScrollTop = scrollEl?.scrollTop ?? 0;
      const curScrollLeft = scrollEl?.scrollLeft ?? 0;
      const hasNewZone = Boolean(contentRef.current?.querySelector('[data-overlay-new-zone]'));
      // SMALL: refresh cached row rects whenever the timeline scrolls mid-drag or the new-track zone toggles.
      if (
        hasNewZone !== cachedRects.hadNewZone ||
        curScrollTop !== cachedRects.scrollTop ||
        curScrollLeft !== cachedRects.scrollLeft
      ) {
        cachedRects = collectRowRects();
      }
      return cachedRects;
    };
    const frameFromX = (clientX: number, contentLeft: number) => (clientX - contentLeft) / ppf;
    const grabOffsetFrames = span ? frameFromX(startX, cachedRects.contentLeft) - span.start : 0;
    const closedSpans = (() => {
      let cursor = 0;
      return sequence.clips
        .filter((_, i) => i !== index)
        .map((clip, i) => {
          const start = cursor;
          cursor += clip.frames;
          return { clip, index: i, start, end: cursor, frames: clip.frames };
        });
    })();
    const liftTargets = collectSnapTargets(sequence, playhead, {
      excludeClipIds: [clipId],
      mainSpansOverride: closedSpans,
    });

    let moved = false;
    let hasLifted = false;
    let toIndex = index;
    let lastLift: Extract<Drag, { kind: 'lift' }> | null = null;
    let lastDrag: Drag | null = null;
    let prevGuideFrame: number | null = null;
    let rafId: number | null = null;
    let pendingPoint: { clientX: number; clientY: number } | null = null;
    let finished = false;

    const commitPoint = (clientX: number, clientY: number) => {
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_ACTIVATION_PX) return;
      if (!moved) {
        moved = true;
        api.setTracksDragging(true);
      }
      if (!span) return;
      const { rows, mainRow, contentTop, contentLeft } = getRects();
      const pointerFrame = frameFromX(clientX, contentLeft);
      const pointerY = clientY - contentTop;

      // S4: refuse drops below main ONLY for already-lifted cuts or drags clearly past the 16px vertical tolerance;
      // a main-cut reorder drifting a few pixels below mainRow.bottom stays a horizontal reorder.
      if ((hasLifted && clientY > mainRow.bottom) || (!hasLifted && clientY > mainRow.bottom + TRACK_LIFT_HYSTERESIS_PX)) {
        const nextLift: Extract<Drag, { kind: 'lift' }> = {
          kind: 'lift',
          index,
          clipId,
          clipLabel: span.clip.label,
          thumbUrl: resolveFirstThumb(span.clip) ?? initialThumb,
          frames: span.frames,
          startFrame: Math.max(0, Math.round(pointerFrame - grabOffsetFrames)),
          pointerY,
          guideFrame: null,
          wasLifted: hasLifted,
          target: { kind: 'refused', reason: 'below_main' },
        };
        lastLift = nextLift;
        prevGuideFrame = null;
        if (
          !lastDrag ||
          lastDrag.kind !== 'lift' ||
          lastDrag.startFrame !== nextLift.startFrame ||
          Math.abs(lastDrag.pointerY - nextLift.pointerY) >= 1 ||
          !sameDropTarget(lastDrag.target, nextLift.target)
        ) {
          lastDrag = nextLift;
          setDrag(nextLift);
        }
        return;
      }

      if (clientY < mainRow.top - TRACK_LIFT_HYSTERESIS_PX) {
        hasLifted = true;
        const rawStart = Math.max(0, pointerFrame - grabOffsetFrames);
        const snapped = p8ComputeSnap({
          frame: rawStart,
          clipFrames: span.frames,
          targets: liftTargets,
          pxPerFrame: ppf,
          enabled: api.magnet,
          prevGuideFrame,
        });
        prevGuideFrame = snapped.guideFrame;
        const target = computeDropTarget({
          sequence,
          source: { kind: 'main', index },
          clientY,
          dropFrame: snapped.snappedFrame,
          pointerFrame,
          linkage: api.effectiveOverlayLinkage,
          rows,
          mainRow,
        });
        const nextLift: Extract<Drag, { kind: 'lift' }> = {
          kind: 'lift',
          index,
          clipId,
          clipLabel: span.clip.label,
          thumbUrl: resolveFirstThumb(span.clip) ?? initialThumb,
          frames: span.frames,
          startFrame: snapped.snappedFrame,
          pointerY,
          guideFrame: snapped.guideFrame,
          wasLifted: true,
          target,
        };
        lastLift = nextLift;
        if (
          !lastDrag ||
          lastDrag.kind !== 'lift' ||
          lastDrag.startFrame !== nextLift.startFrame ||
          lastDrag.guideFrame !== nextLift.guideFrame ||
          Math.abs(lastDrag.pointerY - nextLift.pointerY) >= 1 ||
          !sameDropTarget(lastDrag.target, nextLift.target)
        ) {
          lastDrag = nextLift;
          setDrag(nextLift);
        }
        return;
      }

      lastLift = null;
      prevGuideFrame = null;
      toIndex = p7MainTrackDropAndReorder(spans, index, pointerFrame);
      const nextMove: Extract<Drag, { kind: 'move' }> = { kind: 'move', index, toIndex, dx };
      if (!lastDrag || lastDrag.kind !== 'move' || lastDrag.toIndex !== toIndex || lastDrag.dx !== dx) {
        lastDrag = nextMove;
        setDrag(nextMove);
      }
    };

    const flushPending = () => {
      rafId = null;
      const pt = pendingPoint;
      pendingPoint = null;
      if (!finished && pt) commitPoint(pt.clientX, pt.clientY);
    };

    const onMove = (e: PointerEvent) => {
      pendingPoint = { clientX: e.clientX, clientY: e.clientY };
      if (rafId === null) {
        if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(flushPending);
        else flushPending();
      }
    };

    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (commit && pendingPoint) {
        const pt = pendingPoint;
        pendingPoint = null;
        commitPoint(pt.clientX, pt.clientY);
      } else {
        pendingPoint = null;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      captureEl.removeEventListener('lostpointercapture', onLostCapture);
      try {
        if (captureEl.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture?.(pointerId);
      } catch {
        // Ignore capture release errors on detached elements.
      }
      if (activeDragCleanupRef.current === cleanupAbort) activeDragCleanupRef.current = null;
      api.setTracksDragging(false);
      setDrag(null);
      if (!commit) return;
      if (!moved) return api.select(clipId, additive);
      if (lastLift) {
        const t = lastLift.target;
        if (t.kind === 'overlay-row' || t.kind === 'new-track') {
          api.liftToOverlay(index, t, lastLift.startFrame);
        } else if (t.kind === 'refused') {
          api.sayTrackRefusal(t.reason);
        } else if (t.kind === 'main-track' && t.insertIndex !== index) {
          api.moveClip(index, t.insertIndex);
        }
        return;
      }
      if (toIndex !== index) api.moveClip(index, toIndex);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    // Live reflow can re-order DOM nodes in Chromium, firing `lostpointercapture` while the button is still held
    // (`buttons !== 0`); window listeners keep the drag alive. Only abort if no button is held (`buttons === 0`).
    const onLostCapture = (e: PointerEvent) => {
      if (e.buttons === 0) finish(false);
    };
    const cleanupAbort = () => finish(false);
    activeDragCleanupRef.current = cleanupAbort;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    captureEl.addEventListener('lostpointercapture', onLostCapture);
  };

  const startOverlayMove = (event: React.PointerEvent<HTMLDivElement>, trackIndex: number, clip: OverlayClip) => {
    if (event.button !== 0 || !api.tracksOpen) return;
    if (api.readOnly) return api.select(clip.id, event.shiftKey || event.ctrlKey || event.metaKey);
    activeDragCleanupRef.current?.();
    const captureEl = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      captureEl.setPointerCapture?.(pointerId);
    } catch {
      // Ignore synthetic test environments without real pointer capture.
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const initialThumb = resolveFirstThumb(clip);
    let cachedRects = collectRowRects();
    const getRects = () => {
      const scrollEl = scrollRef.current;
      const curScrollTop = scrollEl?.scrollTop ?? 0;
      const curScrollLeft = scrollEl?.scrollLeft ?? 0;
      const hasNewZone = Boolean(contentRef.current?.querySelector('[data-overlay-new-zone]'));
      if (
        hasNewZone !== cachedRects.hadNewZone ||
        curScrollTop !== cachedRects.scrollTop ||
        curScrollLeft !== cachedRects.scrollLeft
      ) {
        cachedRects = collectRowRects();
      }
      return cachedRects;
    };
    const frameFromX = (clientX: number, contentLeft: number) => (clientX - contentLeft) / ppf;
    const grabOffsetFrames = frameFromX(startX, cachedRects.contentLeft) - clip.startFrame;
    let moved = false;
    let lastMove: Extract<Drag, { kind: 'overlay-move' }> | null = null;
    let prevGuideFrame: number | null = null;
    let rafId: number | null = null;
    let pendingPoint: { clientX: number; clientY: number } | null = null;
    let finished = false;
    const baseTargets = collectSnapTargets(sequence, playhead, { excludeClipIds: [clip.id] });
    const shiftedTargetsByInsert = new Map<number, number[]>();
    const targetsForMainDrop = (insertIndex: number): number[] => {
      const cached = shiftedTargetsByInsert.get(insertIndex);
      if (cached) return cached;
      const shiftedMain = spans.map((s) =>
        s.index >= insertIndex ? { ...s, start: s.start + clip.frames, end: s.end + clip.frames } : s,
      );
      let shiftedOverlays: readonly ReturnType<typeof overlayTracksOf>[number][] | undefined;
      if (api.effectiveOverlayLinkage) {
        const shiftedMainIds = new Set(spans.filter((s) => s.index >= insertIndex).map((s) => s.clip.id));
        shiftedOverlays = overlayTracksOf(sequence).map((track) => ({
          ...track,
          clips: track.clips.map((ov) =>
            ov.id !== clip.id && ov.link && shiftedMainIds.has(ov.link.clipId)
              ? { ...ov, startFrame: ov.startFrame + clip.frames }
              : ov,
          ),
        }));
      }
      const computed = collectSnapTargets(sequence, playhead, {
        excludeClipIds: [clip.id],
        mainSpansOverride: shiftedMain,
        overlayTracksOverride: shiftedOverlays,
      });
      shiftedTargetsByInsert.set(insertIndex, computed);
      return computed;
    };

    const commitPoint = (clientX: number, clientY: number) => {
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!moved && Math.hypot(dx, dy) < DRAG_ACTIVATION_PX) return;
      if (!moved) {
        moved = true;
        api.setTracksDragging(true);
      }
      const { rows, mainRow, contentTop, contentLeft } = getRects();
      const pointerFrame = frameFromX(clientX, contentLeft);
      const rawStart = Math.max(0, pointerFrame - grabOffsetFrames);
      const overMainRow = clientY >= mainRow.top && clientY <= mainRow.bottom;
      const activeTargets = overMainRow
        ? targetsForMainDrop(p7MainTrackDropAndReorder(spans, null, Math.max(0, Math.round(pointerFrame))))
        : baseTargets;
      const snapped = p8ComputeSnap({
        frame: rawStart,
        clipFrames: clip.frames,
        targets: activeTargets,
        pxPerFrame: ppf,
        enabled: api.magnet,
        prevGuideFrame,
      });
      prevGuideFrame = snapped.guideFrame;
      // S2: pass pointerFrame so overlay -> main insertion picks the boundary under the pointer (observed rule 8).
      const target = computeDropTarget({
        sequence,
        source: { kind: 'overlay', clipId: clip.id, trackIndex },
        clientY,
        dropFrame: snapped.snappedFrame,
        pointerFrame,
        rows,
        mainRow,
      });
      const nextMove: Extract<Drag, { kind: 'overlay-move' }> = {
        kind: 'overlay-move',
        clipId: clip.id,
        clipLabel: clip.label,
        thumbUrl: resolveFirstThumb(clip) ?? initialThumb,
        trackIndex,
        frames: clip.frames,
        startFrame: snapped.snappedFrame,
        pointerY: clientY - contentTop,
        guideFrame: snapped.guideFrame,
        target,
      };
      if (
        !lastMove ||
        lastMove.startFrame !== nextMove.startFrame ||
        lastMove.guideFrame !== nextMove.guideFrame ||
        Math.abs(lastMove.pointerY - nextMove.pointerY) >= 1 ||
        !sameDropTarget(lastMove.target, nextMove.target)
      ) {
        lastMove = nextMove;
        setDrag(nextMove);
      } else {
        lastMove = nextMove;
      }
    };

    const flushPending = () => {
      rafId = null;
      const pt = pendingPoint;
      pendingPoint = null;
      if (!finished && pt) commitPoint(pt.clientX, pt.clientY);
    };

    const onMove = (e: PointerEvent) => {
      pendingPoint = { clientX: e.clientX, clientY: e.clientY };
      if (rafId === null) {
        if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(flushPending);
        else flushPending();
      }
    };

    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (commit && pendingPoint) {
        const pt = pendingPoint;
        pendingPoint = null;
        commitPoint(pt.clientX, pt.clientY);
      } else {
        pendingPoint = null;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      captureEl.removeEventListener('lostpointercapture', onLostCapture);
      try {
        if (captureEl.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture?.(pointerId);
      } catch {
        // Ignore capture release errors on detached elements.
      }
      if (activeDragCleanupRef.current === cleanupAbort) activeDragCleanupRef.current = null;
      api.setTracksDragging(false);
      setDrag(null);
      if (!commit) return;
      if (!moved) return api.select(clip.id, additive);
      if (!lastMove) return;
      const t = lastMove.target;
      if (t.kind === 'main-track') {
        api.dropToMain(clip.id, t.insertIndex);
      } else if (t.kind === 'overlay-row' || t.kind === 'new-track') {
        api.moveOverlay(clip.id, t, lastMove.startFrame);
      } else if (t.kind === 'refused') {
        api.sayTrackRefusal(t.reason);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    const onLostCapture = (e: PointerEvent) => {
      if (e.buttons === 0) finish(false);
    };
    const cleanupAbort = () => finish(false);
    activeDragCleanupRef.current = cleanupAbort;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    captureEl.addEventListener('lostpointercapture', onLostCapture);
  };

  const startOverlayTrim = (event: React.PointerEvent<HTMLSpanElement>, clip: OverlayClip, edge: 'start' | 'end') => {
    event.stopPropagation();
    if (event.button !== 0 || api.readOnly || !api.tracksOpen) return;
    activeDragCleanupRef.current?.();
    const captureEl = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      captureEl.setPointerCapture?.(pointerId);
    } catch {
      // Ignore synthetic test environments.
    }
    const startX = event.clientX;
    const edgeFrame = edge === 'start' ? clip.startFrame : clip.startFrame + clip.frames;
    const targets = collectSnapTargets(sequence, playhead, { excludeClipIds: [clip.id] });
    let applied = 0;
    let prevGuideFrame: number | null = null;
    let lastDelta: number | null = null;
    let lastGuide: number | null | undefined = undefined;
    let rafId: number | null = null;
    let pendingClientX: number | null = null;
    let finished = false;

    const commitX = (clientX: number) => {
      let wanted = Math.round((clientX - startX) / ppf);
      const snapped = p8ComputeSnap({
        frame: edgeFrame + wanted,
        clipFrames: null,
        targets,
        pxPerFrame: ppf,
        enabled: api.magnet,
        prevGuideFrame,
      });
      prevGuideFrame = snapped.guideFrame;
      wanted = snapped.snappedFrame - edgeFrame;
      applied = trimOverlayEdge(sequence, clip.id, edge, wanted).applied;
      if (applied !== lastDelta || snapped.guideFrame !== lastGuide) {
        lastDelta = applied;
        lastGuide = snapped.guideFrame;
        setDrag({ kind: 'overlay-trim', clipId: clip.id, edge, delta: applied, guideFrame: snapped.guideFrame });
      }
    };
    const flushPending = () => {
      rafId = null;
      const x = pendingClientX;
      pendingClientX = null;
      if (!finished && x !== null) commitX(x);
    };
    const onMove = (e: PointerEvent) => {
      pendingClientX = e.clientX;
      if (rafId === null) {
        if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(flushPending);
        else flushPending();
      }
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (commit && pendingClientX !== null) {
        const x = pendingClientX;
        pendingClientX = null;
        commitX(x);
      } else {
        pendingClientX = null;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      captureEl.removeEventListener('lostpointercapture', onLostCapture);
      try {
        if (captureEl.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture?.(pointerId);
      } catch {
        // Ignore capture release errors.
      }
      if (activeDragCleanupRef.current === cleanupAbort) activeDragCleanupRef.current = null;
      setDrag(null);
      if (commit && applied !== 0) api.trimOverlay(clip.id, edge, applied);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    const onLostCapture = (e: PointerEvent) => {
      if (e.buttons === 0) finish(false);
    };
    const cleanupAbort = () => finish(false);
    activeDragCleanupRef.current = cleanupAbort;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    captureEl.addEventListener('lostpointercapture', onLostCapture);
  };

  const startTrim = (event: React.PointerEvent<HTMLSpanElement>, index: number, edge: 'start' | 'end') => {
    event.stopPropagation();
    if (event.button !== 0 || api.readOnly) return;
    const span = spans[index];
    if (!span) return;
    const startX = event.clientX;
    const edgeFrame = edge === 'start' ? span.start : span.end;

    // S3: Closed organizations keep the exact existing trim path untouched.
    if (!api.tracksOpen) {
      let applied = 0;
      const onMove = (e: PointerEvent) => {
        let wanted = Math.round((e.clientX - startX) / ppf);
        if (api.magnet && !e.shiftKey) {
          wanted = snapFrame(edgeFrame + wanted, [api.playhead, api.playhead + 1], ppf, SNAP_PX) - edgeFrame;
        }
        applied = trimClipEdge(sequence, index, edge, wanted).applied;
        setDrag({ kind: 'trim', index, edge, delta: applied });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDrag(null);
        if (applied !== 0) api.trimEdge(index, edge, applied);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    activeDragCleanupRef.current?.();
    const captureEl = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      captureEl.setPointerCapture?.(pointerId);
    } catch {
      // Ignore synthetic test environments.
    }
    const targets = collectSnapTargets(sequence, playhead, { excludeClipIds: [span.clip.id] });
    let applied = 0;
    let prevGuideFrame: number | null = null;
    let lastDelta: number | null = null;
    let lastGuide: number | null | undefined = undefined;
    let rafId: number | null = null;
    let pendingClientX: number | null = null;
    let finished = false;

    const commitX = (clientX: number) => {
      let wanted = Math.round((clientX - startX) / ppf);
      const snapped = p8ComputeSnap({
        frame: edgeFrame + wanted,
        clipFrames: null,
        targets,
        pxPerFrame: ppf,
        enabled: api.magnet,
        prevGuideFrame,
      });
      prevGuideFrame = snapped.guideFrame;
      wanted = snapped.snappedFrame - edgeFrame;
      applied = trimClipEdge(sequence, index, edge, wanted).applied;
      if (applied !== lastDelta || snapped.guideFrame !== lastGuide) {
        lastDelta = applied;
        lastGuide = snapped.guideFrame;
        setDrag({ kind: 'trim', index, edge, delta: applied, guideFrame: snapped.guideFrame });
      }
    };
    const flushPending = () => {
      rafId = null;
      const x = pendingClientX;
      pendingClientX = null;
      if (!finished && x !== null) commitX(x);
    };
    const onMove = (e: PointerEvent) => {
      pendingClientX = e.clientX;
      if (rafId === null) {
        if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(flushPending);
        else flushPending();
      }
    };
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (commit && pendingClientX !== null) {
        const x = pendingClientX;
        pendingClientX = null;
        commitX(x);
      } else {
        pendingClientX = null;
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      captureEl.removeEventListener('lostpointercapture', onLostCapture);
      try {
        if (captureEl.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture?.(pointerId);
      } catch {
        // Ignore capture release errors.
      }
      if (activeDragCleanupRef.current === cleanupAbort) activeDragCleanupRef.current = null;
      setDrag(null);
      if (commit && applied !== 0) api.trimEdge(index, edge, applied);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    const onLostCapture = (e: PointerEvent) => {
      if (e.buttons === 0) finish(false);
    };
    const cleanupAbort = () => finish(false);
    activeDragCleanupRef.current = cleanupAbort;

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    captureEl.addEventListener('lostpointercapture', onLostCapture);
  };

  // Only what is on screen (plus a margin) is drawn: at frame level the film is tens of thousands of pixels wide.
  const viewFrom = Math.max(0, Math.floor((scrollLeft - 200) / ppf));
  const viewTo = Math.min(total, Math.ceil((scrollLeft + width + 200) / ppf));
  const ticks = rulerTicks(ppf, fps, viewFrom, viewTo);

  const frameRatio = (() => {
    const dims = COMPOSE_DIMENSIONS[sequence.aspect];
    return dims ? dims.width / dims.height : 16 / 9;
  })();
  const committedCustomVideoHeight = api.layout.lanes.video;
  useEffect(() => {
    thumbs.current?.setTrackRatios(committedCustomVideoHeight !== undefined);
  }, [committedCustomVideoHeight]);
  const decodeHeight = thumbDecodeHeight(committedCustomVideoHeight);
  const perFrame = ppf >= FRAME_STRIP_PX;
  const realFrames = ppf >= REAL_FRAMES_PX;
  const tileWidthFor = (src: string) => {
    if (perFrame) return ppf;
    const ratio = thumbs.current?.ratioOf(src) ?? materialBySrc(src)?.ratio ?? frameRatio;
    return filmstripTileWidth(committedCustomVideoHeight, ratio);
  };
  const wanted: ThumbRequest[] = [];
  const tilesOf = (span: (typeof spans)[number]) => {
    const tilePx = tileWidthFor(span.clip.srcUrl);
    const sampleStepPx = perFrame ? tilePx : filmstripSampleStep(tilePx);
    const tiles: Array<{ left: number; width: number; url: string | undefined; frame: number }> = [];
    const clipPx = span.frames * ppf;
    const first = Math.max(0, Math.floor(((viewFrom - span.start) * ppf) / tilePx));
    const last = Math.min(Math.ceil(clipPx / tilePx) - 1, Math.floor(((viewTo - span.start) * ppf) / tilePx));
    for (let i = first; i <= last; i += 1) {
      const sampleX = perFrame ? i * tilePx : Math.floor((i * tilePx) / sampleStepPx) * sampleStepPx;
      const offset = Math.min(span.frames - 1, Math.floor(sampleX / ppf + 1e-6));
      const picture = clipFrameAt(span.clip, offset, fps);
      const exactUrl = thumbs.current?.get(span.clip.srcUrl, picture.sourceFrame, decodeHeight);
      const url = exactUrl ?? thumbs.current?.fallback(span.clip.srcUrl, picture.sourceFrame, decodeHeight);
      if (!exactUrl) wanted.push({ src: span.clip.srcUrl, sourceFrame: picture.sourceFrame, seekSec: picture.seekSec, height: decodeHeight });
      tiles.push({ left: i * tilePx, width: Math.min(tilePx, clipPx - i * tilePx), url, frame: span.start + offset });
    }
    return tiles;
  };
  // A cut with no poster of its own (an upload without a thumbnail) shows decoded frames at every zoom.
  const strips = spans.map((span) => {
    const visible = span.end >= viewFrom && span.start <= viewTo;
    if (realFrames) return visible ? tilesOf(span) : [];
    return !span.clip.thumbUrl && visible ? tilesOf(span) : null;
  });
  // W7: render filmstrip thumbnails inside overlay clips using the same pipeline main cuts use.
  const overlayStrips = new Map<string, ReturnType<typeof tilesOf> | null>();
  if (api.tracksOpen) {
    for (const track of overlayTracksOf(sequence)) {
      for (const clip of track.clips) {
        const end = clip.startFrame + clip.frames;
        const visible = end >= viewFrom && clip.startFrame <= viewTo;
        if (realFrames) {
          overlayStrips.set(clip.id, visible ? tilesOf({ clip, index: 0, start: clip.startFrame, end, frames: clip.frames }) : []);
        } else {
          overlayStrips.set(
            clip.id,
            !clip.thumbUrl && visible ? tilesOf({ clip, index: 0, start: clip.startFrame, end, frames: clip.frames }) : null,
          );
        }
      }
    }
  }
  latestWantedRef.current = wanted;
  const wantedKey = wanted.map((request) => `${request.src}#${request.sourceFrame}@${request.height ?? 72}`).join('|');
  useEffect(() => {
    if (timelineRef.current?.hasAttribute('data-lane-dragging')) {
      suppressedWantRef.current = true;
      return;
    }
    suppressedWantRef.current = false;
    thumbs.current?.want(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  const totalBars = Math.max(8, Math.floor((total * ppf) / BAR_PX));
  const voiceBars = useMemo(() => waveform(7, Math.min(totalBars, 12000)), [totalBars]);
  const musicBars = useMemo(() => waveform(doc.music ? doc.music.id.charCodeAt(1) * 31 : 3, Math.min(totalBars, 12000)), [totalBars, doc.music]);
  const firstBar = Math.max(0, Math.floor((scrollLeft - 200) / BAR_PX));
  const lastBar = Math.min(totalBars, Math.ceil((scrollLeft + width + 200) / BAR_PX));
  const barSec = (index: number) => (index * BAR_PX) / ppf / fps;
  const envelope = useMemo(() => duckEnvelope(FIXTURE_SPEECH, api.durationSec, doc.sound.duck), [api.durationSec, doc.sound.duck]);
  const musicGain = (sec: number) => {
    let gain = envelopeGainAt(envelope, sec) * doc.sound.musicVolume;
    if (doc.sound.fades) gain *= Math.min(1, sec / 0.5, Math.max(0, api.durationSec - sec) / 1.5);
    return gain;
  };
  const inSpeech = (sec: number) => FIXTURE_SPEECH.some((region) => sec >= region.startSec && sec <= region.endSec);
  const barIndexes = Array.from({ length: Math.max(0, lastBar - firstBar) }, (_, i) => firstBar + i);
  const waveLeft = firstBar * BAR_PX;
  const waveWidth = Math.max(1, (lastBar - firstBar) * BAR_PX);

  const lanes = copy.timeline.lanes;
  const usage = thumbs.current?.usage();
  const dropAt =
    drag?.kind === 'move'
      ? (() => {
          const others = spans.filter((span) => span.index !== drag.index);
          const before = others[drag.toIndex];
          return before ? before.start : (others[others.length - 1]?.end ?? 0);
        })()
      : drag?.kind === 'overlay-move' && drag.target.kind === 'main-track'
        ? (() => {
            const before = spans[drag.target.insertIndex];
            return before ? before.start : (spans[spans.length - 1]?.end ?? 0);
          })()
        : null;
  const cap = (action: 'magnet' | 'toggleLinkage' | 'splitAll' | 'zoomFit' | 'zoomFrames' | 'zoomIn' | 'zoomOut') => {
    const binding = api.shortcutMap[action][0];
    return binding ? ` (${formatBinding(binding, api.mac).join(' ')})` : '';
  };
  const overlayTracks = api.tracksOpen ? overlayTracksOf(sequence) : [];
  // Top-to-bottom visual order: highest track index at top, index 0 directly above main.
  const overlayRowsDisplay = api.tracksOpen
    ? overlayTracks.map((track, trackIndex) => ({ track, trackIndex })).reverse()
    : [];
  const showNewTrackZone = api.tracksOpen && api.isTracksDragging;
  const gridRowsStyle: CSSProperties | undefined =
    api.tracksOpen && (overlayRowsDisplay.length > 0 || showNewTrackZone)
      ? {
          gridTemplateRows: [
            'var(--h-ruler)',
            ...(showNewTrackZone ? ['22px'] : []),
            ...overlayRowsDisplay.map(() => `${OVERLAY_ROW_HEIGHT}px`),
            'var(--ev-h-video, var(--h-video))',
            'var(--ev-h-captions, var(--h-captions))',
          ].join(' '),
        }
      : undefined;
  const activeDropLineY: number | null =
    (drag?.kind === 'lift' || drag?.kind === 'overlay-move') && drag.target.kind === 'new-track'
      ? drag.target.lineY - (contentRef.current?.getBoundingClientRect().top ?? 0)
      : null;
  const activeGhost: { trackIndex: number; startFrame: number; frames: number } | null =
    (drag?.kind === 'lift' || drag?.kind === 'overlay-move') && drag.target.kind === 'overlay-row'
      ? { trackIndex: drag.target.trackIndex, startFrame: drag.startFrame, frames: drag.frames }
      : null;
  const dragClipGhost =
    drag?.kind === 'lift' || drag?.kind === 'overlay-move'
      ? (() => {
          const liveClip =
            drag.kind === 'lift'
              ? spans[drag.index]?.clip
              : overlayTracks[drag.trackIndex]?.clips.find((c) => c.id === drag.clipId);
          const thumbUrl = (liveClip ? resolveFirstThumb(liveClip) : null) ?? drag.thumbUrl;
          return {
            clipId: drag.clipId,
            clipLabel: drag.clipLabel,
            thumbUrl,
            startFrame: drag.startFrame,
            frames: drag.frames,
            pointerY: drag.pointerY,
          };
        })()
      : null;
  const snapGuideFrame: number | null =
    drag && 'guideFrame' in drag && drag.guideFrame !== undefined ? drag.guideFrame : null;
  // A4 + S3 + SMALL: with linkage + Overlay kind ON, linked overlays follow both main reorder AND main lift LIVE.
  // Memoized on target index (not every pixel of `dx`) so full reconcile does not re-run per pointer pixel (S3).
  const liveDisplacedStarts = useMemo(() => {
    if (!api.tracksOpen || !api.effectiveOverlayLinkage) return null;
    if (drag?.kind === 'move' && drag.toIndex !== drag.index) {
      const displaced = new Map<string, number>();
      const previewMain = moveClipInSequence(sequence, drag.index, drag.toIndex);
      const reconciled = reconcileLinkedOverlays(sequence, previewMain, true).sequence;
      for (const track of overlayTracksOf(reconciled)) {
        for (const clip of track.clips) displaced.set(clip.id, clip.startFrame);
      }
      return displaced;
    }
    if (drag?.kind === 'lift') {
      const displaced = new Map<string, number>();
      const { tracks } = tracksAfterClosingMain(sequence, drag.index, true);
      for (const track of tracks) {
        for (const clip of track.clips) displaced.set(clip.id, clip.startFrame);
      }
      return displaced;
    }
    if (overlayDropInsert >= 0 && overlayDropFrames > 0 && drag?.kind === 'overlay-move') {
      const shiftedMainIds = new Set(spans.filter((s) => s.index >= overlayDropInsert).map((s) => s.clip.id));
      const displaced = new Map<string, number>();
      for (const track of overlayTracksOf(sequence)) {
        for (const ov of track.clips) {
          if (ov.id === drag.clipId) continue;
          if (ov.link && shiftedMainIds.has(ov.link.clipId)) {
            displaced.set(ov.id, ov.startFrame + overlayDropFrames);
          }
        }
      }
      return displaced;
    }
    return null;
  }, [
    api.tracksOpen,
    api.effectiveOverlayLinkage,
    drag?.kind === 'move' ? drag.index : drag?.kind === 'lift' ? drag.index : -1,
    drag?.kind === 'move' ? drag.toIndex : -1,
    drag?.kind === 'overlay-move' ? drag.clipId : '',
    overlayDropInsert,
    overlayDropFrames,
    drag?.kind,
    spans,
    sequence,
  ]);
  const liveOverlayPreview =
    api.tracksOpen &&
    api.effectiveOverlayLinkage &&
    (drag?.kind === 'move' || drag?.kind === 'lift' || overlayDropInsert >= 0)
      ? {
          draggedClipId: drag?.kind === 'move' ? (sequence.clips[drag.index]?.id ?? null) : null,
          dx: drag?.kind === 'move' ? drag.dx : 0,
          displacedStarts: liveDisplacedStarts ?? new Map<string, number>(),
        }
      : null;

  // C2 / C9 / W2 / S4: while lifting a main cut upward, preview shows the main track already closed;
  // an unlifted main cut refused below main does NOT hide itself from the main track.
  // While reordering on the main track with tracks switch open, neighbours shift LIVE across midpoints (W2).
  // While dragging an overlay clip DOWN onto the main track, cuts at/after `insertIndex` open a live gap of `drag.frames`.
  const renderedMainSpans = useMemo(() => {
    if (drag?.kind === 'lift' && drag.wasLifted) {
      let cursor = 0;
      return spans
        .filter((s) => s.index !== drag.index)
        .map((s) => {
          const start = cursor;
          cursor += s.frames;
          return { ...s, start, end: cursor };
        });
    }
    if (overlayDropInsert >= 0 && overlayDropFrames > 0) {
      return spans.map((s) =>
        s.index >= overlayDropInsert
          ? { ...s, start: s.start + overlayDropFrames, end: s.end + overlayDropFrames }
          : s,
      );
    }
    if (api.tracksOpen && drag?.kind === 'move' && drag.toIndex !== drag.index) {
      const dragged = spans[drag.index];
      if (!dragged) return spans;
      const others = spans.filter((s) => s.index !== drag.index);
      const result: typeof spans = [];
      let cursor = 0;
      for (let i = 0; i <= others.length; i += 1) {
        if (i === drag.toIndex) {
          // Keep the dragged cut at its own visual start so `translateX(drag.dx)` tracks the pointer smoothly.
          result.push(dragged);
          cursor += dragged.frames;
        }
        const other = others[i];
        if (other) {
          const start = cursor;
          cursor += other.frames;
          result.push({ ...other, start, end: cursor });
        }
      }
      return result;
    }
    return spans;
  }, [
    api.tracksOpen,
    drag?.kind,
    drag?.kind === 'lift' || drag?.kind === 'move' ? drag.index : -1,
    drag?.kind === 'move' ? drag.toIndex : -1,
    overlayDropInsert,
    overlayDropFrames,
    spans,
  ]);
  const blank = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) api.clearSelection();
  };

  const commitLaneHeight = (kind: LaneKind, height: number | null) => apiRef.current.setLaneHeight(kind, height, true);

  useIsoLayoutEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    const wasSized = wasSizedRef.current || tl.hasAttribute('data-sized');
    const isActivelySizedDrag =
      tl.hasAttribute('data-sized') &&
      LANE_KINDS.some((k) => Boolean(tl.querySelector?.(`[data-editor-lane-resize="${k}"]`)?.hasAttribute?.('data-dragging')));
    const nextSized = isSized || isActivelySizedDrag;

    if (nextSized) {
      if (!tl.hasAttribute('data-sized')) tl.setAttribute('data-sized', '');
      for (const kind of LANE_KINDS) {
        const handleEl = tl.querySelector?.(`[data-editor-lane-resize="${kind}"]`) as HTMLElement | null | undefined;
        if (handleEl?.hasAttribute('data-dragging') && tl.hasAttribute('data-sized')) continue;
        if (api.layout.lanes[kind] !== undefined) {
          tl.style.setProperty(`--ev-h-${kind}`, `${effectiveLaneHeight(api.layout, kind, workspace, api.real)}px`);
        } else {
          tl.style.removeProperty(`--ev-h-${kind}`);
        }
      }
      if (!wasSized) syncScrollMetricsRef.current?.();
    } else if (wasSized) {
      tl.removeAttribute('data-sized');
      if (scrollRef.current && scrollRef.current.scrollTop !== 0) scrollRef.current.scrollTop = 0;
      if (namesRef.current) {
        if (namesRef.current.scrollTop !== 0) namesRef.current.scrollTop = 0;
        if (namesRef.current.style.paddingBottom) namesRef.current.style.paddingBottom = '';
      }
      playheadRef.current?.style.removeProperty('--ev-scroll-y');
      for (const kind of LANE_KINDS) {
        tl.style.removeProperty(`--ev-h-${kind}`);
      }
    }
    wasSizedRef.current = nextSized;
  }, [isSized, api.layout, workspace, api.real]);

  const handleLaneDragEnd = () => {
    if (suppressedWantRef.current) {
      suppressedWantRef.current = false;
      thumbs.current?.want(latestWantedRef.current);
    }
    syncScrollMetricsRef.current?.();
  };

  const renderLaneHandle = (kind: LaneKind) => {
    const height = effectiveLaneHeight(api.layout, kind, workspace, api.real);
    return (
      <LaneResizeHandle
        key={kind}
        kind={kind}
        label={fill(copy.timeline.resizeLane, { lane: lanes[kind] })}
        height={height}
        timelineRef={timelineRef}
        onDragEnd={handleLaneDragEnd}
        onCommit={commitLaneHeight}
      />
    );
  };

  const laneStyle = Object.fromEntries(
    visibleLanes(api.real).map((kind) => [`--h-${kind}`, `${effectiveLaneHeight(api.layout, kind, workspace, api.real)}px`]),
  ) as CSSProperties;

  return (
    <section
      ref={timelineRef}
      className={styles.timeline}
      style={laneStyle}
      data-ws={workspace}
      data-sized={isSized ? '' : undefined}
      aria-label={lanes.video}
      data-editor-timeline
      data-real={api.real ? '' : undefined}
      data-editor-ppf={ppf.toFixed(3)}
      data-editor-thumbs={usage ? `${usage.pictures}:${usage.bytes}` : undefined}
    >
      <div className={styles.timelineBar}>
        <button
          type="button"
          className={styles.chipBtn}
          aria-pressed={api.magnet}
          onClick={() => api.setMagnet(!api.magnet)}
          title={api.tracksOpen && api.tracksCopy ? `${api.tracksCopy.toolbar.snapNote}${cap('magnet')}` : `${copy.timeline.magnetNote}${cap('magnet')}`}
          data-editor-magnet
          data-editor-snap={api.tracksOpen ? '' : undefined}
        >
          <EditorIcon name="magnet" />
          {api.tracksOpen && api.tracksCopy ? api.tracksCopy.toolbar.snap : copy.timeline.magnet}
        </button>
        {api.tracksOpen && api.tracksCopy && (
          <>
            <span ref={linkageWrapRef} className={styles.linkageWrap}>
              <button
                type="button"
                className={styles.chipBtn}
                aria-pressed={api.linkage}
                disabled={api.readOnly}
                onClick={() => api.setLinkage(!api.linkage)}
                title={`${api.linkage && !api.linkageOverlay ? api.tracksCopy.toolbar.linkageNoneActive : api.tracksCopy.toolbar.linkageNote}${cap('toggleLinkage')}`}
                data-editor-linkage
              >
                <EditorIcon name="link" />
                {api.tracksCopy.toolbar.linkage}
              </button>
              <button
                ref={linkageTriggerRef}
                type="button"
                className={styles.chipBtn}
                aria-expanded={linkageMenuOpen}
                aria-label={api.tracksCopy.toolbar.linkageSettings}
                title={api.tracksCopy.toolbar.linkageSettings}
                onClick={() => setLinkageMenuOpen((open) => !open)}
                data-editor-linkage-settings
              >
                ▾
              </button>
              {linkageMenuOpen && (
                <div
                  className={styles.linkagePopover}
                  role="dialog"
                  aria-label={api.tracksCopy.toolbar.linkageSettings}
                  data-editor-linkage-popover
                >
                  <p className={styles.note}>{api.tracksCopy.toolbar.linkageSettingsNote}</p>
                  <label className={styles.linkageCheck}>
                    <input
                      type="checkbox"
                      checked={api.linkageOverlay}
                      disabled={api.readOnly}
                      onChange={(event) => api.setLinkageOverlay(event.target.checked)}
                      data-editor-linkage-kind="overlay"
                    />
                    <span>{api.tracksCopy.toolbar.linkageKindOverlay}</span>
                  </label>
                </div>
              )}
            </span>
            <button
              type="button"
              className={styles.chipBtn}
              onClick={api.splitAllAtPlayhead}
              disabled={api.readOnly || sequence.clips.length === 0}
              title={`${api.tracksCopy.actions.splitAll}${cap('splitAll')}`}
              data-editor-split-all
            >
              <EditorIcon name="split" />
              {api.tracksCopy.actions.splitAll}
            </button>
          </>
        )}
        <span className={styles.transportSpace} />
        <span className={styles.zoomRead} data-editor-zoom-read>
          {ppf >= 1 ? fill(copy.timeline.zoomFrame, { px: Math.round(ppf) }) : copy.timeline.zoomFar}
        </span>
        <button type="button" className={styles.chipBtn} onClick={() => api.zoom('fit')} disabled={zoomPpf === null} title={`${copy.timeline.zoomFit}${cap('zoomFit')}`} data-editor-zoom="fit">
          {copy.timeline.zoomFit}
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => api.zoom('out')} aria-label={copy.timeline.zoomOut} title={`${copy.timeline.zoomOut}${cap('zoomOut')}`} disabled={zoomPpf === null}>
          <EditorIcon name="minus" />
        </button>
        <input
          className={styles.zoomSlider}
          type="range"
          min={0}
          max={1000}
          value={Math.round(ppfToSlider(ppf, api.tracksOpen ? Math.min(fitPpf, ppf) : fitPpf) * 1000)}
          onChange={(event) => zoomTo(sliderToPpf(Number(event.target.value) / 1000, api.tracksOpen ? Math.min(fitPpf, ppf) : fitPpf), playheadAnchor())}
          aria-label={copy.timeline.zoom}
          data-editor-zoom-slider
        />
        <button type="button" className={styles.iconBtn} onClick={() => api.zoom('in')} aria-label={copy.timeline.zoomIn} title={`${copy.timeline.zoomIn}${cap('zoomIn')}`} disabled={ppf >= MAX_PX_PER_FRAME}>
          <EditorIcon name="plus" />
        </button>
        <button type="button" className={styles.chipBtn} onClick={() => api.zoom('frames')} title={`${copy.timeline.zoomFrames}${cap('zoomFrames')}`} data-editor-zoom="frames">
          {copy.timeline.zoomFrames}
        </button>
      </div>
      <div className={styles.laneNames} ref={namesRef} style={gridRowsStyle}>
        <span className={styles.rulerName}>{formatTimecode(playhead, fps)}</span>
        {showNewTrackZone && <span className={styles.newTrackLabel} />}
        {overlayRowsDisplay.map(({ track, trackIndex }) => (
          <span key={track.id} data-overlay-lane-name={trackIndex}>
            {api.tracksCopy ? fill(api.tracksCopy.lanes.overlay, { n: trackIndex + 1 }) : `V${trackIndex + 2}`}
          </span>
        ))}
        {!api.real && <span data-lane="titles">{lanes.titles}{renderLaneHandle('titles')}</span>}
        <span data-lane="video">{lanes.video}{renderLaneHandle('video')}</span>
        <span data-lane="captions">{lanes.captions}{renderLaneHandle('captions')}</span>
        {!api.real && <span data-lane="voice">{lanes.voice}{renderLaneHandle('voice')}</span>}
        {!api.real && <span data-lane="music">{lanes.music}{renderLaneHandle('music')}</span>}
      </div>
      <div className={styles.laneScroll} ref={scrollRef}>
        <div className={styles.laneContent} ref={contentRef} style={{ width: contentWidth, ...gridRowsStyle }} onPointerDown={blank}>
          <div className={styles.ruler} onPointerDown={scrub} data-editor-ruler data-frames={perFrame ? '' : undefined}>
            {ticks.map((tick) => (
              <span key={tick.frame} style={{ left: tick.frame * ppf }} data-label={tick.label ? '' : undefined}>
                {tick.label}
              </span>
            ))}
          </div>

          {showNewTrackZone && (
            <div className={styles.newTrackZone} data-overlay-new-zone>
              <span>{api.tracksCopy?.lanes.newTrackHint}</span>
            </div>
          )}

          {overlayRowsDisplay.map(({ track, trackIndex }) => (
            <div
              key={track.id}
              className={styles.lane}
              data-lane={`overlay-${trackIndex}`}
              data-overlay-track={trackIndex}
              onPointerDown={blank}
            >
              {track.clips.map((clip, clipIndex) => {
                const trimming = drag?.kind === 'overlay-trim' && drag.clipId === clip.id ? drag : null;
                const moving = drag?.kind === 'overlay-move' && drag.clipId === clip.id ? drag : null;
                const linkedToDragged =
                  liveOverlayPreview && liveOverlayPreview.draggedClipId && clip.link?.clipId === liveOverlayPreview.draggedClipId;
                const liveDisplacedStart =
                  liveOverlayPreview && !linkedToDragged ? liveOverlayPreview.displacedStarts.get(clip.id) : undefined;
                let left = (liveDisplacedStart ?? clip.startFrame) * ppf;
                let clipWidth = clip.frames * ppf;
                if (trimming) {
                  if (trimming.edge === 'start') {
                    left += trimming.delta * ppf;
                    clipWidth -= trimming.delta * ppf;
                  } else {
                    clipWidth += trimming.delta * ppf;
                  }
                }
                const selected = api.selection.includes(clip.id);
                const ovTiles = overlayStrips.get(clip.id) ?? null;
                return (
                  <div
                    key={clip.id}
                    className={`${styles.clip} ${styles.overlayClip}`}
                    style={{
                      left,
                      width: Math.max(4, clipWidth - (ppf >= 12 ? 1 : 2)),
                      backgroundImage: !ovTiles && clip.thumbUrl ? `url(${clip.thumbUrl})` : undefined,
                      opacity: moving ? 0.35 : undefined,
                      transform: linkedToDragged ? `translateX(${liveOverlayPreview.dx}px)` : undefined,
                    }}
                    data-selected={selected ? '' : undefined}
                    data-moving={moving ? '' : undefined}
                    onPointerDown={(event) => startOverlayMove(event, trackIndex, clip)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={
                      api.tracksCopy
                        ? fill(api.tracksCopy.lanes.overlayCut, { track: trackIndex + 1, number: clipIndex + 1 })
                        : clip.label
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.stopPropagation();
                        api.select(clip.id, event.shiftKey);
                      }
                    }}
                    data-overlay-clip={clip.id}
                    data-overlay-start={clip.startFrame}
                    data-frames={clip.frames}
                    data-clip-id={clip.id}
                  >
                    {ovTiles?.map((tile) => (
                      <i
                        key={tile.left}
                        className={styles.tile}
                        style={{
                          left: tile.left - (trimming?.edge === 'start' ? trimming.delta * ppf : 0),
                          width: tile.width,
                          backgroundImage: `url(${tile.url ?? clip.thumbUrl ?? ''})`,
                        }}
                        data-ready={tile.url ? '' : undefined}
                        data-frame={perFrame ? tile.frame : undefined}
                      />
                    ))}
                    <span
                      className={styles.clipHandle}
                      data-edge="start"
                      onPointerDown={(event) => startOverlayTrim(event, clip, 'start')}
                      title={copy.timeline.trimStart}
                    />
                    <span className={styles.clipBadge}>{clip.label}</span>
                    {clip.speedCurve ? (
                      <span className={styles.clipRate}>{copy.cut.clip.speedCurveBadge}</span>
                    ) : (
                      clip.speedNum !== clip.speedDen && (
                        <span className={styles.clipRate}>{formatSpeed(clip.speedNum / clip.speedDen)}×</span>
                      )
                    )}
                    <span
                      className={styles.clipHandle}
                      data-edge="end"
                      onPointerDown={(event) => startOverlayTrim(event, clip, 'end')}
                      title={copy.timeline.trimEnd}
                    />
                  </div>
                );
              })}
              {activeGhost && activeGhost.trackIndex === trackIndex && (
                <span
                  className={styles.overlayGhost}
                  style={{
                    left: activeGhost.startFrame * ppf,
                    width: Math.max(4, activeGhost.frames * ppf - 1),
                  }}
                  data-overlay-ghost={trackIndex}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}

          {/* Titles, voice and music lanes are the sample film's: a real film has none of them yet (V1). */}
          {!api.real && (
            <div className={styles.lane} data-lane="titles" onPointerDown={blank}>
              {doc.titles.map((title) => (
                <button
                  key={title.id}
                  type="button"
                  className={styles.textItem}
                  style={{ left: title.start * ppf, width: Math.max(18, (title.end - title.start) * ppf - 2) }}
                  aria-pressed={api.selectedTitleId === title.id}
                  onClick={() => { api.setWorkspace('cut'); api.setSelectedTitleId(title.id); api.seek(title.start); }}
                >
                  {title.text}
                </button>
              ))}
            </div>
          )}

          <div ref={mainLaneRef} className={styles.lane} data-lane="video" onPointerDown={blank} data-empty={api.real && spans.length === 0 ? '' : undefined}>
            {api.real && spans.length === 0 && (
              <span className={styles.laneEmpty} style={{ left: scrollLeft }} data-editor-empty-lane>
                {api.status === 'ready' ? copy.real.emptyLane : copy.real.loading}
              </span>
            )}
            {renderedMainSpans.map((span) => {
              const trimming = drag?.kind === 'trim' && drag.index === span.index ? drag : null;
              const moving = drag?.kind === 'move' && drag.index === span.index ? drag : null;
              let left = span.start * ppf;
              let clipWidth = span.frames * ppf;
              if (trimming) {
                if (trimming.edge === 'start') {
                  left += trimming.delta * ppf;
                  clipWidth -= trimming.delta * ppf;
                } else clipWidth += trimming.delta * ppf;
              }
              const look = doc.looks[span.clip.id];
              const selected = api.selection.includes(span.clip.id);
              const inScope = workspace !== 'cut' && !api.locked && api.targetIds.includes(span.clip.id);
              const tiles = strips?.[span.index] ?? null;
              const missing = api.real && !!api.missingSources[span.clip.srcUrl];
              return (
                <div
                  key={span.clip.id}
                  className={styles.clip}
                  style={{
                    left,
                    width: Math.max(4, clipWidth - (ppf >= 12 ? 1 : 2)),
                    backgroundImage: !tiles && span.clip.thumbUrl ? `url(${span.clip.thumbUrl})` : undefined,
                    transform: moving ? `translateX(${moving.dx}px)` : undefined,
                  }}
                  data-selected={selected ? '' : undefined}
                  data-scope={inScope ? '' : undefined}
                  data-moving={moving ? '' : undefined}
                  onPointerDown={(event) => startMove(event, span.index, span.clip.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${fill(copy.timeline.cut, { number: span.index + 1 })}${missing ? ` · ${copy.timeline.missing}` : ''}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      api.select(span.clip.id, event.shiftKey);
                    }
                  }}
                  data-editor-clip={span.index + 1}
                  data-frames={span.frames}
                  data-in-frame={span.clip.inFrame}
                  data-phase={span.clip.phase}
                  data-speed={span.clip.speedCurve ? 'curve' : `${span.clip.speedNum}/${span.clip.speedDen}`}
                  data-speed-curve={span.clip.speedCurve ? '1' : undefined}
                  data-source-fps={span.clip.sourceFps}
                  data-source-frames={span.clip.sourceFrames}
                  data-clip-id={span.clip.id}
                  data-editor-clip-missing={missing ? '' : undefined}
                >
                  {tiles?.map((tile) => (
                    <i
                      key={tile.left}
                      className={styles.tile}
                      style={{
                        left: tile.left - (trimming?.edge === 'start' ? trimming.delta * ppf : 0),
                        width: tile.width,
                        backgroundImage: `url(${tile.url ?? span.clip.thumbUrl ?? ''})`,
                      }}
                      data-ready={tile.url ? '' : undefined}
                      data-frame={perFrame ? tile.frame : undefined}
                    />
                  ))}
                  <span className={styles.clipHandle} data-edge="start" onPointerDown={(event) => startTrim(event, span.index, 'start')} title={copy.timeline.trimStart} />
                  <span className={styles.clipBadge}>{span.index + 1}</span>
                  {look && <span className={styles.clipLook} data-source={look.source} />}
                  {missing ? (
                    // The file is confirmed missing (audit A4): the speed badge's place says so; the panel says what to do.
                    <span className={styles.clipRate}>{copy.timeline.missing}</span>
                  ) : span.clip.speedCurve ? (
                    <span className={styles.clipRate}>{copy.cut.clip.speedCurveBadge}</span>
                  ) : (
                    span.clip.speedNum !== span.clip.speedDen && (
                      <span className={styles.clipRate}>{formatSpeed(span.clip.speedNum / span.clip.speedDen)}×</span>
                    )
                  )}
                  <span className={styles.clipHandle} data-edge="end" onPointerDown={(event) => startTrim(event, span.index, 'end')} title={copy.timeline.trimEnd} />
                </div>
              );
            })}
            {dropAt !== null && <span className={styles.dropMark} style={{ left: dropAt * ppf }} />}
          </div>

          <div className={styles.lane} data-lane="captions" onPointerDown={blank}>
            {visibleCaptions(sequence).map((caption) => (
              <button
                key={caption.id}
                type="button"
                className={styles.textItem}
                data-editor-caption-item={caption.id}
                style={{ left: caption.start * ppf, width: Math.max(18, (caption.end - caption.start) * ppf - 2) }}
                onClick={() => { api.setWorkspace('captions'); api.seek(caption.start); }}
              >
                {caption.text}
              </button>
            ))}
          </div>

          {!api.real && (
            <div className={styles.lane} data-lane="voice">
              <span className={styles.laneTag} style={{ left: Math.max(6, scrollLeft + 6) }}>{copy.timeline.narration}</span>
              <svg className={styles.wave} style={{ left: waveLeft }} width={waveWidth} height="100%" viewBox={`0 0 ${waveWidth} 40`} preserveAspectRatio="none" aria-hidden="true">
                {barIndexes.map((index) => {
                  const sec = barSec(index);
                  const level = voiceBars[index % voiceBars.length] ?? 0.5;
                  const height = Math.max(1.5, level * (inSpeech(sec) ? (doc.sound.speechClear ? 36 : 28) : doc.sound.speechClear ? 1.5 : 5));
                  return <rect key={index} x={(index - firstBar) * BAR_PX} y={20 - height / 2} width={BAR_PX - 1.5} height={height} rx="1" />;
                })}
              </svg>
            </div>
          )}

          {!api.real && (
            <div className={styles.lane} data-lane="music" data-empty={doc.music ? undefined : ''}>
              {doc.music ? (
                <>
                  <span className={styles.laneTag} style={{ left: Math.max(6, scrollLeft + 6) }}>{doc.music.label}</span>
                  <svg className={styles.wave} style={{ left: waveLeft }} width={waveWidth} height="100%" viewBox={`0 0 ${waveWidth} 40`} preserveAspectRatio="none" aria-hidden="true" data-editor-music-wave>
                    {barIndexes.map((index) => {
                      const level = musicBars[index % musicBars.length] ?? 0.5;
                      const height = Math.max(1.5, level * 34 * musicGain(barSec(index)));
                      return <rect key={index} x={(index - firstBar) * BAR_PX} y={20 - height / 2} width={BAR_PX - 1.5} height={height} rx="1" />;
                    })}
                    {doc.sound.duck && (
                      <polyline
                        className={styles.envelope}
                        points={envelope.map((point) => `${point.sec * fps * ppf - waveLeft},${36 - point.gain * 32}`).join(' ')}
                        data-editor-envelope
                      />
                    )}
                  </svg>
                </>
              ) : (
                <span className={styles.laneEmpty} style={{ left: scrollLeft }}>{copy.timeline.noMusic}</span>
              )}
            </div>
          )}

          {dragClipGhost && (
            <div
              className={styles.dragClipGhost}
              style={{
                left: dragClipGhost.startFrame * ppf,
                top: Math.max(24, dragClipGhost.pointerY - OVERLAY_ROW_HEIGHT / 2),
                width: Math.max(24, dragClipGhost.frames * ppf - 1),
                height: OVERLAY_ROW_HEIGHT,
              }}
              data-overlay-drag-ghost={dragClipGhost.clipId}
              data-overlay-drag-start={dragClipGhost.startFrame}
              data-has-thumb={dragClipGhost.thumbUrl ? '' : undefined}
              aria-hidden="true"
            >
              {dragClipGhost.thumbUrl && (
                <span
                  className={styles.dragClipGhostThumb}
                  style={{ backgroundImage: `url(${dragClipGhost.thumbUrl})` }}
                  data-overlay-drag-ghost-thumb=""
                />
              )}
              <span className={styles.clipBadge}>{dragClipGhost.clipLabel}</span>
            </div>
          )}

          {activeDropLineY !== null && (
            <span
              className={styles.overlayDropLine}
              style={{ top: activeDropLineY }}
              data-overlay-drop-line=""
              aria-hidden="true"
            />
          )}

          {snapGuideFrame !== null && (
            <span
              className={styles.snapGuide}
              style={{ left: snapGuideFrame * ppf }}
              data-snap-guide={snapGuideFrame}
              aria-hidden="true"
            />
          )}

          <span
            ref={playheadRef}
            className={styles.playhead}
            style={{ transform: `translateX(${playhead * ppf}px)`, width: ppf >= 12 ? ppf : undefined }}
            data-wide={ppf >= 12 ? '' : undefined}
            aria-hidden="true"
            data-editor-playhead-mark
          />
        </div>
      </div>
    </section>
  );
}
