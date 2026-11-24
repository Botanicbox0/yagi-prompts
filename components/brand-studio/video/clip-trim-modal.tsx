"use client";
/**
 * Segment & crop modal for Video Edit (Bundle C, docs/BRAND-STUDIO-VIDEO-C.md §2):
 *  - Dark media stage (`--ys-media-bg` #111113) with interactive 8-handle rule-of-thirds crop box
 *  - Play/Pause preview bounded to `[range.start, range.end]`
 *  - Filmstrip timeline with draggable French Blue (`--ys-accent`) start/end handles (4–30s)
 *  - Exports a real trimmed/cropped MP4 via Canvas + MediaRecorder when supported, or safely falls
 *    back to the original clip when unchanged or when browser MP4 encoding is unavailable.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StudioAssetView } from "@/lib/brand-studio/contracts";
import type { StudioVideoCopy } from "@/messages/studio-video";
import { StudioIcon } from "../icons";
import { useModal } from "../modal";
import { corsMediaUrl } from "@/lib/brand-studio/cors-media-url";
import { fillText } from "./reverse-model";
import { FULL_CROP, clampCropRect, clampTrimRange, isFullFrameAndRange, type CropRect } from "./workspace-model";
import w from "./video-workspace.module.css";

export interface ClipTrimModalProps {
  asset: StudioAssetView;
  copy: StudioVideoCopy["workspace"]["trimModal"];
  minSeconds?: number;
  maxSeconds?: number;
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

  const [measuredTotal, setMeasuredTotal] = useState<number>(asset.seconds && asset.seconds > 0 ? asset.seconds : 8);
  const total = Math.max(0.5, measuredTotal);
  const [range, setRange] = useState(() => clampTrimRange(0, Math.min(total, maxSeconds), total, minSeconds, maxSeconds));
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [playing, setPlaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    const base = asset.seconds && asset.seconds > 0 ? asset.seconds : 8;
    setMeasuredTotal(base);
    setRange(clampTrimRange(0, Math.min(base, maxSeconds), base, minSeconds, maxSeconds));
    setCrop(FULL_CROP);
  }, [asset.id, asset.seconds, minSeconds, maxSeconds]);

  // Sample up to 8 filmstrip thumbnails in the browser when possible (graceful fallback to tick bars).
  useEffect(() => {
    let cancelled = false;
    setFrames([]);
    if (typeof document === "undefined") return;
    const probe = document.createElement("video");
    probe.crossOrigin = "anonymous";
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = "metadata";
    probe.src = corsMediaUrl(asset.url);

    const thumbs: string[] = [];
    const count = 8;
    probe.onloadedmetadata = async () => {
      if (cancelled) return;
      const dur = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : total;
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        setMeasuredTotal(probe.duration);
        setRange((cur) => clampTrimRange(cur.start, Math.min(cur.end, probe.duration), probe.duration, minSeconds, maxSeconds));
      }
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 54;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      for (let i = 0; i < count; i += 1) {
        if (cancelled) return;
        const target = Math.min(Math.max(0.05, ((i + 0.5) / count) * dur), Math.max(0.05, dur - 0.05));
        const ok = await new Promise<boolean>((res) => {
          const timer = window.setTimeout(() => res(false), 1200);
          probe.onseeked = () => {
            window.clearTimeout(timer);
            res(true);
          };
          probe.onerror = () => {
            window.clearTimeout(timer);
            res(false);
          };
          try {
            probe.currentTime = target;
          } catch {
            window.clearTimeout(timer);
            res(false);
          }
        });
        if (!ok || cancelled) break;
        try {
          ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
          thumbs.push(canvas.toDataURL("image/jpeg", 0.55));
        } catch {
          break;
        }
      }
      if (!cancelled && thumbs.length > 0) setFrames(thumbs);
      probe.removeAttribute("src");
      probe.load();
    };
    return () => {
      cancelled = true;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [asset.url, minSeconds, maxSeconds, total]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < range.start || el.currentTime >= range.end) el.currentTime = range.start;
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [range.end, range.start]);

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
        if (videoRef.current) videoRef.current.currentTime = which === "start" ? next.start : Math.max(next.start, next.end - 0.05);
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
                setRange((cur) => clampTrimRange(cur.start, Math.min(cur.end, dur), dur, minSeconds, maxSeconds));
              }
            }}
            onTimeUpdate={(ev) => {
              if (ev.currentTarget.currentTime >= range.end) {
                ev.currentTarget.currentTime = range.start;
              }
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
            onClick={togglePlay}
            data-trim-play
          >
            {playing ? copy.pause : copy.play}
          </button>
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
        </div>

        <div ref={trackRef} className={w.filmstripWrap} data-trim-filmstrip>
          <div className={w.filmstripCells} aria-hidden="true">
            {frames.length > 0
              ? frames.map((src, idx) => <img key={idx} src={src} alt="" />)
              : Array.from({ length: 12 }, (_, idx) => <span key={idx} className={w.filmstripTick} />)}
          </div>
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
