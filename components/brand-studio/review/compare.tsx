"use client";
/**
 * "나란히 비교" (docs/BRAND-ROOMS.md §6): two versions of one deliverable side by side. Films play
 * together from the same moment on one scrubber; each side has its own sound switch (both start muted
 * except the left). A still shows as it is. The left side drives the clock; the right follows it and is
 * pulled back when it drifts more than a tenth of a second.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { REVIEW_FRAME_MS, formatTimecode, type ReviewVersion } from "@/lib/brand-studio/review-contracts";
import type { studioReviewEn } from "@/messages/studio-review";

type Copy = typeof studioReviewEn;
type Side = "left" | "right";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

export function CompareView({ versions, currentId, copy, onClose }: { versions: ReviewVersion[]; currentId: string; copy: Copy; onClose(): void }) {
  const current = versions.find((v) => v.id === currentId) ?? versions[0]!;
  const other = versions.find((v) => v.id !== current.id) ?? current;
  // Older on the left, the one being reviewed on the right: reading order is the order of change.
  const [ids, setIds] = useState<Record<Side, string>>(() =>
    (other.version < current.version ? { left: other.id, right: current.id } : { left: current.id, right: other.id }),
  );
  const refs = { left: useRef<HTMLVideoElement>(null), right: useRef<HTMLVideoElement>(null) };
  const [muted, setMuted] = useState<Record<Side, boolean>>({ left: false, right: true });
  const [playing, setPlaying] = useState(false);
  const [ms, setMs] = useState(0);
  const [durations, setDurations] = useState<Record<Side, number>>({ left: 0, right: 0 });
  const pick = (side: Side) => versions.find((v) => v.id === ids[side]) ?? current;
  const sides: Side[] = ["left", "right"];
  const total = Math.max(durations.left, durations.right, ...sides.map((s) => Math.round((pick(s).seconds ?? 0) * 1000)));
  const anyVideo = sides.some((s) => pick(s).kind === "video" && pick(s).mediaUrl);

  const each = useCallback((fn: (v: HTMLVideoElement) => void) => {
    for (const ref of [refs.left, refs.right]) if (ref.current) fn(ref.current);
    // refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = useCallback(
    (to: number) => {
      const t = Math.max(0, Math.min(to, total || to));
      each((v) => {
        v.currentTime = Math.min(t / 1000, Number.isFinite(v.duration) ? v.duration : t / 1000);
      });
      setMs(t);
    },
    [each, total],
  );

  const toggle = useCallback(() => {
    if (playing) {
      each((v) => v.pause());
      setPlaying(false);
      return;
    }
    each((v) => {
      v.currentTime = Math.min(ms / 1000, Number.isFinite(v.duration) ? v.duration : ms / 1000);
      void v.play().catch(() => undefined);
    });
    setPlaying(true);
  }, [each, ms, playing]);

  // The left clock leads; the right follows within a tenth of a second.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const lead = refs.left.current ?? refs.right.current;
      const follow = lead === refs.left.current ? refs.right.current : null;
      if (lead) {
        const t = lead.currentTime;
        setMs(t * 1000);
        if (follow && Number.isFinite(follow.duration) && t < follow.duration && Math.abs(follow.currentTime - t) > 0.1) follow.currentTime = t;
        const ended = [refs.left.current, refs.right.current].every((v) => !v || v.ended || v.paused);
        if (ended) setPlaying(false);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    // A different version on one side starts both from the shared moment, paused.
    each((v) => v.pause());
    setPlaying(false);
  }, [ids.left, ids.right, each]);

  return (
    <div
      className="bsv-compare"
      data-review-compare
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="bsv-compare-panes">
        {sides.map((side) => {
          const v = pick(side);
          const label = side === "left" ? copy.versions.left : copy.versions.right;
          return (
            <figure key={side} className="bsv-compare-pane" data-compare-side={side}>
              <figcaption className="bsv-compare-head">
                <label className="bsv-visually-hidden" htmlFor={`bsv-compare-${side}`}>
                  {fill(copy.versions.sideVersion, { side: label })}
                </label>
                <select id={`bsv-compare-${side}`} className="bsv-version-select" value={v.id} onChange={(e) => setIds((p) => ({ ...p, [side]: e.target.value }))}>
                  {versions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {`v${o.version} · ${copy.status[o.status]}`}
                    </option>
                  ))}
                </select>
                {v.kind === "video" && v.mediaUrl && (
                  <button
                    type="button"
                    className="bsv-icon-btn"
                    aria-pressed={!muted[side]}
                    aria-label={fill(muted[side] ? copy.versions.unmute : copy.versions.mute, { side: label })}
                    onClick={() => setMuted((m) => ({ ...m, [side]: !m[side] }))}
                    data-compare-mute={side}
                  >
                    <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d={muted[side] ? "M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" : "M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6"} />
                    </svg>
                  </button>
                )}
              </figcaption>
              <div className="bsv-compare-media" style={{ aspectRatio: v.width && v.height ? `${v.width} / ${v.height}` : v.kind === "video" ? "16 / 9" : "1" }}>
                {!v.mediaUrl ? (
                  <p className="bsv-quiet">{copy.unavailable}</p>
                ) : v.kind === "video" ? (
                  <video
                    ref={refs[side]}
                    src={v.mediaUrl}
                    poster={v.thumbUrl ?? undefined}
                    preload="metadata"
                    playsInline
                    muted={muted[side]}
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration;
                      if (Number.isFinite(d)) setDurations((p) => ({ ...p, [side]: Math.round(d * 1000) }));
                    }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- private studio media
                  <img src={v.mediaUrl} alt={`v${v.version} ${v.title}`} draggable={false} />
                )}
              </div>
            </figure>
          );
        })}
      </div>
      {anyVideo && (
        <div className="bsv-controls bsv-compare-controls">
          <div className="bsv-transport">
            <button type="button" className="bsv-icon-btn" onClick={() => seek(ms - REVIEW_FRAME_MS)} aria-label={copy.player.back}>
              <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button type="button" className="bsv-icon-btn bsv-play" onClick={toggle} aria-label={playing ? copy.versions.pause : copy.versions.play} data-compare-play>
              <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled="">
                <path d={playing ? "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" : "M8 5v14l11-7z"} />
              </svg>
            </button>
            <button type="button" className="bsv-icon-btn" onClick={() => seek(ms + REVIEW_FRAME_MS)} aria-label={copy.player.forward}>
              <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <span className="bsv-time">
              {formatTimecode(ms)} <span className="bsv-time-total">/ {formatTimecode(total)}</span>
            </span>
          </div>
          <div className="bsv-track">
            <input
              type="range"
              className="bsv-range"
              min={0}
              max={Math.max(total, 1)}
              step={REVIEW_FRAME_MS}
              value={Math.min(ms, Math.max(total, 1))}
              onChange={(e) => {
                each((v) => v.pause());
                setPlaying(false);
                seek(Number(e.target.value));
              }}
              aria-label={copy.versions.timeline}
              aria-valuetext={formatTimecode(ms)}
              style={{ ["--bsv-progress" as string]: total > 0 ? `${Math.min(100, (ms / total) * 100)}%` : "0%" }}
            />
          </div>
          <p className="bsv-keys">{copy.versions.sync}</p>
        </div>
      )}
    </div>
  );
}
