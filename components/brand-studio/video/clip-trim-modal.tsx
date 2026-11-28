"use client";
/**
 * Segment & crop modal for Video Edit (Bundle C, docs/BRAND-STUDIO-VIDEO-C.md §2):
 *  - Dark media stage (`--ys-media-bg` #111113) with interactive 8-handle rule-of-thirds crop box
 *  - Play/Pause preview bounded to `[range.start, range.end]`
 *  - Filmstrip timeline with draggable French Blue (`--ys-accent`) start/end handles (4–30s)
 *  - Exports a real trimmed/cropped MP4 via Canvas + MediaRecorder when supported, or safely falls
 *    back to the original clip when unchanged or when browser MP4 encoding is unavailable.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FilmShot, StudioAssetView } from "@/lib/brand-studio/contracts";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { FrameThumbs, THUMB_HEIGHT } from "../editor-v2/frame-thumbs";
import { StudioIcon } from "../icons";
import { useModal } from "../modal";
import { corsMediaUrl } from "@/lib/brand-studio/cors-media-url";
import { fillText } from "./reverse-model";
import {
  TRIM_FRAME_STEP_SECONDS,
  TRIM_STRIP_COUNT,
  TRIM_TEN_FRAMES_SECONDS,
  applyPlayheadBound,
  fixedSceneStep,
  sceneBoundaries,
  sceneJumpTarget,
  stripTimestamps,
} from "./trim-nav-model";
import { FULL_CROP, clampCropRect, clampTrimRange, isFullFrameAndRange, type CropRect } from "./workspace-model";
import w from "./video-workspace.module.css";

export interface ClipTrimModalProps {
  asset: StudioAssetView;
  copy: StudioVideoCopy["workspace"]["trimModal"];
  minSeconds?: number;
  maxSeconds?: number;
  /** Optional already-cached film shots (`studio.films[asset.id].sheet.shots`) for scene markers & jumps; never triggers a reading. */
  shots?: readonly Pick<FilmShot, "start" | "end">[];
  /** Optional `FrameThumbs` factory override for deterministic tests. */
  createThumbs?(): FrameThumbs;
  onSkip(asset: StudioAssetView): void;
  onApply(result: { asset: StudioAssetView; trimmed: boolean; fallbackNotice?: string | null }): void;
  onUploadTrimmed(file: File): Promise<StudioAssetView | null>;
  onClose(): void;
}

type HandleDir = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: readonly Exclude<HandleDir, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function pickMp4Mime(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

async function exportTrimmedMp4(
  url: string,
  range: { start: number; end: number },
  crop: CropRect,
): Promise<File | null> {
  const mime = pickMp4Mime();
  if (!mime || typeof document === "undefined") return null;

  return new Promise<File | null>((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.muted = true;
    video.preload = "auto";
    video.src = corsMediaUrl(url);

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        /* ignore cleanup */
      }
      resolve(file);
    };

    const guard = window.setTimeout(() => finish(null), 40_000);

    video.onerror = () => {
      window.clearTimeout(guard);
      finish(null);
    };

    video.onloadedmetadata = () => {
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const sx = Math.round(crop.x * vw);
      const sy = Math.round(crop.y * vh);
      const sw = Math.max(320, Math.round(crop.w * vw));
      const sh = Math.max(320, Math.round(crop.h * vh));
      const outW = Math.min(1280, Math.max(320, sw - (sw % 2)));
      const outH = Math.min(1280, Math.max(320, sh - (sh % 2)));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof canvas.captureStream !== "function") {
        window.clearTimeout(guard);
        finish(null);
        return;
      }

      let recorder: MediaRecorder;
      const chunks: BlobPart[] = [];
      try {
        const stream = canvas.captureStream(24);
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
      } catch {
        window.clearTimeout(guard);
        finish(null);
        return;
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = () => {
        window.clearTimeout(guard);
        finish(null);
      };
      recorder.onstop = () => {
        window.clearTimeout(guard);
        if (!chunks.length) return finish(null);
        const blob = new Blob(chunks, { type: "video/mp4" });
        if (blob.size < 256) return finish(null);
        finish(new File([blob], `trimmed-${Date.now()}.mp4`, { type: "video/mp4" }));
      };

      let raf = 0;
      const pump = () => {
        if (settled) return;
        ctx.drawImage(video, sx, sy, Math.min(sw, vw - sx), Math.min(sh, vh - sy), 0, 0, outW, outH);
        if (video.currentTime >= range.end || video.ended) {
          cancelAnimationFrame(raf);
          if (recorder.state !== "inactive") recorder.stop();
          return;
        }
        raf = requestAnimationFrame(pump);
      };

      video.onseeked = () => {
        video.onseeked = null;
        ctx.drawImage(video, sx, sy, Math.min(sw, vw - sx), Math.min(sh, vh - sy), 0, 0, outW, outH);
        recorder.start(200);
        void video.play().then(() => {
          raf = requestAnimationFrame(pump);
        }).catch(() => {
          if (recorder.state !== "inactive") recorder.stop();
          finish(null);
        });
      };

      try {
        video.currentTime = range.start;
      } catch {
        window.clearTimeout(guard);
        finish(null);
      }
    };
  });
}

export function ClipTrimModal({
  asset,
  copy,
  minSeconds = 4,
  maxSeconds = 30,
  shots,
  createThumbs,
  onSkip,
  onApply,
  onUploadTrimmed,
  onClose,
}: ClipTrimModalProps) {
  const dialogRef = useModal();
  const id = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<FrameThumbs | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const startedInsideRangeRef = useRef(true);

  const [measuredTotal, setMeasuredTotal] = useState<number>(asset.seconds && asset.seconds > 0 ? asset.seconds : 8);
  const [stripDuration, setStripDuration] = useState<number | null>(asset.seconds && asset.seconds > 0 ? asset.seconds : null);
  const total = Math.max(0.5, measuredTotal);
  const [range, setRange] = useState(() => clampTrimRange(0, Math.min(total, maxSeconds), total, minSeconds, maxSeconds));
  const [playhead, setPlayhead] = useState(0);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [playing, setPlaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [clampNote, setClampNote] = useState<string | null>(null);
  const [, setThumbTick] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<{ sec: number; pct: number; frameKey: number } | null>(null);

  const mediaSrc = useMemo(() => corsMediaUrl(asset.url), [asset.url]);
  const stripTimes = useMemo(
    () => (stripDuration !== null ? stripTimestamps(stripDuration, TRIM_STRIP_COUNT) : []),
    [stripDuration],
  );
  const boundaries = useMemo(() => sceneBoundaries(shots, total), [shots, total]);
  const hasShots = boundaries.length > 0;
  const fallbackStep = useMemo(() => fixedSceneStep(total), [total]);

  useEffect(() => {
    const known = asset.seconds && asset.seconds > 0 ? asset.seconds : null;
    const base = known ?? 8;
    setMeasuredTotal(base);
    setStripDuration(known);
    setRange(clampTrimRange(0, Math.min(base, maxSeconds), base, minSeconds, maxSeconds));
    setPlayhead(0);
    setCrop(FULL_CROP);
    setClampNote(null);
    setHoverInfo(null);
  }, [asset.id, asset.seconds, minSeconds, maxSeconds]);

  // Decode 16 browser filmstrip frames ONCE (keyed on stored duration; re-decodes only if metadata differs by >1 frame).
  useEffect(() => {
    if (typeof document === "undefined" || stripDuration === null) return;
    const thumbs = createThumbs ? createThumbs() : new FrameThumbs({ crossOrigin: "anonymous" });
    thumbsRef.current = thumbs;
    const unsub = thumbs.subscribe(() => setThumbTick((n) => n + 1));
    thumbs.want(
      stripTimes.map((seekSec, idx) => ({
        src: mediaSrc,
        sourceFrame: idx,
        seekSec,
        height: THUMB_HEIGHT,
      })),
    );
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      unsub();
      thumbs.dispose();
      if (thumbsRef.current === thumbs) thumbsRef.current = null;
    };
  }, [createThumbs, mediaSrc, stripDuration, stripTimes]);

  const seekTo = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(total, Number.isFinite(targetSec) ? targetSec : 0));
      startedInsideRangeRef.current = clamped >= range.start - 0.05 && clamped < range.end - 0.05;
      setPlayhead(clamped);
      if (videoRef.current) {
        try {
          videoRef.current.currentTime = clamped;
        } catch {
          /* ignore seek error on unloaded media */
        }
      }
    },
    [range.end, range.start, total],
  );

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      const cur = Number.isFinite(el.currentTime) ? el.currentTime : playhead;
      // Loop inside `[range.start, range.end]` only when playback starts inside the range;
      // otherwise let the customer play/inspect anywhere in the full clip before placing handles.
      const inside = cur >= range.start - 0.05 && cur < range.end - 0.05;
      startedInsideRangeRef.current = inside;
      if (cur >= total - 0.05) {
        el.currentTime = 0;
        setPlayhead(0);
      }
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [playhead, range.end, range.start, total]);

  const jumpScene = useCallback(
    (dir: "prev" | "next") => {
      const cur = videoRef.current && Number.isFinite(videoRef.current.currentTime) ? videoRef.current.currentTime : playhead;
      const { target } = sceneJumpTarget(cur, shots, total, dir);
      seekTo(target);
    },
    [playhead, seekTo, shots, total],
  );

  const setBoundAtPlayhead = useCallback(
    (side: "start" | "end") => {
      const cur = videoRef.current && Number.isFinite(videoRef.current.currentTime) ? videoRef.current.currentTime : playhead;
      setRange((prev) => {
        const { range: next, movedOther } = applyPlayheadBound(prev, cur, side, total, minSeconds, maxSeconds);
        if (movedOther === "start") {
          setClampNote(fillText(copy.clampedOtherStart, { start: next.start.toFixed(1), min: minSeconds, max: maxSeconds }));
        } else if (movedOther === "end") {
          setClampNote(fillText(copy.clampedOtherEnd, { end: next.end.toFixed(1), min: minSeconds, max: maxSeconds }));
        } else {
          setClampNote(null);
        }
        return next;
      });
    },
    [copy.clampedOtherEnd, copy.clampedOtherStart, maxSeconds, minSeconds, playhead, total],
  );

  const onDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDialogElement>) => {
      if (event.nativeEvent?.isComposing) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === " " || event.code === "Space") {
        if (tag === "BUTTON") return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = (event.shiftKey ? TRIM_TEN_FRAMES_SECONDS : TRIM_FRAME_STEP_SECONDS) * (event.key === "ArrowLeft" ? -1 : 1);
        const cur = videoRef.current && Number.isFinite(videoRef.current.currentTime) ? videoRef.current.currentTime : playhead;
        seekTo(cur + delta);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        jumpScene(event.key === "ArrowUp" ? "prev" : "next");
        return;
      }
      if (event.code === "KeyI" || event.key === "i" || event.key === "I") {
        event.preventDefault();
        setBoundAtPlayhead("start");
        return;
      }
      if (event.code === "KeyO" || event.key === "o" || event.key === "O") {
        event.preventDefault();
        setBoundAtPlayhead("end");
      }
    },
    [jumpScene, playhead, seekTo, setBoundAtPlayhead, togglePlay],
  );

  const onStripPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("[data-side]")) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    event.preventDefault();
    const applyFromClientX = (clientX: number) => {
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seekTo(frac * total);
    };
    applyFromClientX(event.clientX);
    const move = (ev: PointerEvent) => applyFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onStripPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const sec = frac * total;
    const frameKey = 1000 + Math.round(sec * 2);
    setHoverInfo({ sec, pct: frac * 100, frameKey });
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      thumbsRef.current?.want([{ src: mediaSrc, sourceFrame: frameKey, seekSec: Math.min(Math.max(0.05, sec), Math.max(0.05, total - 0.05)), height: THUMB_HEIGHT }]);
    }, 80);
  };

  const onStripPointerLeave = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverInfo(null);
  };

  const onCropPointerDown = (dir: HandleDir) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const box = stageBoxRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...crop };

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / box.width;
      const dy = (ev.clientY - startY) / box.height;
      let next = { ...origin };
      if (dir === "move") {
        next.x = origin.x + dx;
        next.y = origin.y + dy;
      } else {
        if (dir.includes("w")) {
          const nx = Math.max(0, Math.min(origin.x + origin.w - 0.2, origin.x + dx));
          next.w = origin.w + (origin.x - nx);
          next.x = nx;
        }
        if (dir.includes("e")) {
          next.w = Math.min(1 - origin.x, Math.max(0.2, origin.w + dx));
        }
        if (dir.includes("n")) {
          const ny = Math.max(0, Math.min(origin.y + origin.h - 0.2, origin.y + dy));
          next.h = origin.h + (origin.y - ny);
          next.y = ny;
        }
        if (dir.includes("s")) {
          next.h = Math.min(1 - origin.y, Math.max(0.2, origin.h + dy));
        }
      }
      setCrop(clampCropRect(next));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onTrimPointerDown = (which: "start" | "end") => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const move = (ev: PointerEvent) => {
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const sec = frac * total;
      setRange((cur) => {
        const next = which === "start"
          ? clampTrimRange(sec, cur.end, total, minSeconds, maxSeconds, "start")
          : clampTrimRange(cur.start, sec, total, minSeconds, maxSeconds, "end");
        const nextHead = which === "start" ? next.start : Math.max(next.start, next.end - 0.05);
        setPlayhead(nextHead);
        setClampNote(null);
        if (videoRef.current) videoRef.current.currentTime = nextHead;
        return next;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const leftPct = Math.max(0, Math.min(100, (range.start / total) * 100));
  const widthPct = Math.max(4, Math.min(100 - leftPct, ((range.end - range.start) / total) * 100));
  const playheadPct = Math.max(0, Math.min(100, (playhead / total) * 100));
  const decodedStrip = stripTimes.map((_, idx) => thumbsRef.current?.get(mediaSrc, idx, THUMB_HEIGHT));
  const hasAnyThumb = decodedStrip.some(Boolean);
  const hoverThumbUrl = hoverInfo ? thumbsRef.current?.get(mediaSrc, hoverInfo.frameKey, THUMB_HEIGHT) : undefined;
  const prevLabel = hasShots ? copy.prevScene : fillText(copy.stepBack, { seconds: fallbackStep });
  const nextLabel = hasShots ? copy.nextScene : fillText(copy.stepForward, { seconds: fallbackStep });
  const prevTitle = hasShots ? copy.prevSceneTitle : fillText(copy.stepBackTitle, { seconds: fallbackStep });
  const nextTitle = hasShots ? copy.nextSceneTitle : fillText(copy.stepForwardTitle, { seconds: fallbackStep });
  const isCropped = !(crop.x <= 0.01 && crop.y <= 0.01 && crop.w >= 0.98 && crop.h >= 0.98);
  const canSkip = total >= minSeconds && total <= maxSeconds;
  const validSelection = range.duration >= minSeconds && range.duration <= maxSeconds;

  const aspectStyle = useMemo(() => {
    if (asset.width && asset.height && asset.width > 0 && asset.height > 0) {
      return { aspectRatio: `${asset.width} / ${asset.height}` };
    }
    return { aspectRatio: "16 / 9" };
  }, [asset.height, asset.width]);

  const handleConfirm = async () => {
    if (processing || !validSelection) return;
    if (isFullFrameAndRange(range, total, crop, maxSeconds)) {
      onApply({ asset, trimmed: false });
      return;
    }
    setProcessing(true);
    const exported = await exportTrimmedMp4(asset.url, range, crop);
    if (exported) {
      const uploaded = await onUploadTrimmed(exported);
      setProcessing(false);
      if (uploaded) {
        onApply({ asset: uploaded, trimmed: true });
        return;
      }
    }
    setProcessing(false);
    if (canSkip) {
      onApply({ asset, trimmed: false, fallbackNotice: copy.unsupportedFallback });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={w.trimDialog}
      aria-labelledby={`${id}-title`}
      data-video-trim-modal
      onKeyDown={onDialogKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        if (!processing) onClose();
      }}
    >
      <header className={w.trimHead}>
        <div>
          <h2 id={`${id}-title`}>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <button
          type="button"
          className="bs-btn bs-icon-btn"
          data-variant="ghost"
          data-size="sm"
          aria-label={copy.close}
          disabled={processing}
          onClick={onClose}
        >
          <StudioIcon name="close" />
        </button>
      </header>

      <div className={w.trimStage}>
        <div ref={stageBoxRef} className={w.trimFrameWrap} style={aspectStyle}>
          <video
            ref={videoRef}
            className={w.trimVideo}
            src={asset.url}
            poster={asset.thumbUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(ev) => {
              const dur = ev.currentTarget.duration;
              if (Number.isFinite(dur) && dur > 0) {
                setMeasuredTotal(dur);
                setStripDuration((prev) =>
                  prev === null || Math.abs(dur - prev) > TRIM_FRAME_STEP_SECONDS ? dur : prev,
                );
                setRange((cur) => clampTrimRange(cur.start, Math.min(cur.end, dur), dur, minSeconds, maxSeconds));
              }
            }}
            onTimeUpdate={(ev) => {
              const cur = ev.currentTarget.currentTime;
              if (playing && startedInsideRangeRef.current && cur >= range.end) {
                ev.currentTarget.currentTime = range.start;
                setPlayhead(range.start);
                return;
              }
              setPlayhead(cur);
            }}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />
          <div
            className={w.cropOverlay}
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.w * 100}%`,
              height: `${crop.h * 100}%`,
            }}
            onPointerDown={onCropPointerDown("move")}
            data-video-crop-box
          >
            <div className={w.cropGrid} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            {HANDLES.map((dir) => (
              <span
                key={dir}
                className={w.cropHandle}
                data-dir={dir}
                onPointerDown={onCropPointerDown(dir)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className={w.trimControls}>
        <div className={w.trimMetaRow}>
          <button
            type="button"
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            title={copy.playTitle}
            onClick={togglePlay}
            data-trim-play
          >
            {playing ? copy.pause : copy.play}
          </button>
          <button
            type="button"
            className="bs-btn"
            data-variant="ghost"
            data-size="sm"
            title={prevTitle}
            onClick={() => jumpScene("prev")}
            data-trim-prev-scene
          >
            {prevLabel}
          </button>
          <button
            type="button"
            className="bs-btn"
            data-variant="ghost"
            data-size="sm"
            title={nextTitle}
            onClick={() => jumpScene("next")}
            data-trim-next-scene
          >
            {nextLabel}
          </button>
          <button
            type="button"
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            title={copy.setStartTitle}
            onClick={() => setBoundAtPlayhead("start")}
            data-trim-set-start
          >
            {copy.setStart}
          </button>
          <button
            type="button"
            className="bs-btn"
            data-variant="soft"
            data-size="sm"
            title={copy.setEndTitle}
            onClick={() => setBoundAtPlayhead("end")}
            data-trim-set-end
          >
            {copy.setEnd}
          </button>
          <span className={`${w.trimPlayheadBadge} bs-num`} data-trim-playhead-readout>
            {fillText(copy.playhead, { time: playhead.toFixed(1) })}
          </span>
          <span className={`${w.trimRangeBadge} bs-num`} data-trim-range-readout>
            {fillText(copy.rangeValue, {
              start: range.start.toFixed(1),
              end: range.end.toFixed(1),
              duration: range.duration.toFixed(1),
            })}
          </span>
          <span className={w.trimCropStatus}>
            {isCropped
              ? fillText(copy.cropActive, { w: Math.round(crop.w * 100), h: Math.round(crop.h * 100) })
              : copy.cropReset}
            {isCropped && (
              <button
                type="button"
                className="bs-link-btn"
                onClick={() => setCrop(FULL_CROP)}
                data-trim-crop-reset
              >
                {copy.cropReset}
              </button>
            )}
          </span>
          {clampNote && (
            <span className={w.trimClampNote} role="status" data-trim-clamp-note>
              {clampNote}
            </span>
          )}
        </div>

        <div className={w.filmstripOuter}>
          {hoverInfo && (
            <div
              className={w.trimHoverPreview}
              style={{ left: `${Math.max(10, Math.min(90, hoverInfo.pct))}%` }}
              aria-hidden="true"
              data-trim-hover-preview
            >
              {hoverThumbUrl && <img src={hoverThumbUrl} alt="" />}
              <span className="bs-num">{hoverInfo.sec.toFixed(1)}s</span>
            </div>
          )}
          <div
            ref={trackRef}
            className={w.filmstripWrap}
            aria-label={copy.scrubLabel}
            data-trim-filmstrip
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            onPointerLeave={onStripPointerLeave}
          >
            <div className={w.filmstripCells} aria-hidden="true">
              {hasAnyThumb
                ? decodedStrip.map((src, idx) =>
                    src ? (
                      <img key={idx} src={src} alt="" data-trim-strip-thumb={idx} />
                    ) : (
                      <span key={idx} className={w.filmstripTick} />
                    ),
                  )
                : Array.from({ length: 12 }, (_, idx) => <span key={idx} className={w.filmstripTick} />)}
            </div>
            {boundaries.map((t, idx) => (
              <span
                key={`scene-${idx}`}
                className={w.trimSceneMarker}
                style={{ left: `${Math.max(0, Math.min(100, (t / total) * 100))}%` }}
                aria-hidden="true"
                data-trim-scene-marker={t}
              />
            ))}
            <div className={w.filmstripShade} style={{ left: 0, width: `${leftPct}%` }} aria-hidden="true" />
            <div
              className={w.filmstripShade}
              style={{ left: `${leftPct + widthPct}%`, right: 0 }}
              aria-hidden="true"
            />
            <div
              className={w.filmstripWindow}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              data-trim-window
            >
              <button
                type="button"
                className={w.trimHandle}
                data-side="start"
                aria-label={copy.rangeStart}
                onPointerDown={onTrimPointerDown("start")}
              />
              <button
                type="button"
                className={w.trimHandle}
                data-side="end"
                aria-label={copy.rangeEnd}
                onPointerDown={onTrimPointerDown("end")}
              />
            </div>
            <div
              className={w.trimPlayheadLine}
              style={{ left: `${playheadPct}%` }}
              aria-hidden="true"
              data-trim-playhead
            />
          </div>
        </div>

        <div className={w.srSliders}>
          <label htmlFor={`${id}-range-start`}>{copy.rangeStart}</label>
          <input
            id={`${id}-range-start`}
            type="range"
            min={0}
            max={Math.round(Math.max(0, range.end - minSeconds) * 10) / 10}
            step={0.1}
            value={range.start}
            onChange={(ev) =>
              setRange((cur) => clampTrimRange(Number(ev.target.value), cur.end, total, minSeconds, maxSeconds, "start"))
            }
          />
          <label htmlFor={`${id}-range-end`}>{copy.rangeEnd}</label>
          <input
            id={`${id}-range-end`}
            type="range"
            min={Math.round(Math.min(total, range.start + minSeconds) * 10) / 10}
            max={total}
            step={0.1}
            value={range.end}
            onChange={(ev) =>
              setRange((cur) => clampTrimRange(cur.start, Number(ev.target.value), total, minSeconds, maxSeconds, "end"))
            }
          />
        </div>
        {!validSelection && (
          <p className={w.trimRuleNote} role="status">
            {fillText(copy.durationRule, { min: minSeconds, max: maxSeconds })}
          </p>
        )}
      </div>

      <footer className={w.trimFoot}>
        <button
          type="button"
          className="bs-btn"
          data-variant="soft"
          data-size="md"
          disabled={processing || !canSkip}
          onClick={() => onSkip(asset)}
          data-trim-skip
        >
          {copy.skip}
        </button>
        <button
          type="button"
          className="bs-btn"
          data-variant="solid"
          data-size="md"
          disabled={processing || !validSelection}
          onClick={() => void handleConfirm()}
          data-trim-confirm
        >
          {processing ? copy.processing : copy.confirm}
        </button>
      </footer>
    </dialog>
  );
}
