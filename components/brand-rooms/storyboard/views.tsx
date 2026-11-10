"use client";
/**
 * The three ways to read a storyboard (docs/BRAND-ROOMS.md §5): 카드 (a grid of cut cards, each picture
 * at its own aspect ratio), 표 (the shot list with the running time), 재생 (the animatic: cuts advance by
 * their length). Plus the large cut sheet with the cut's thread beside it, and the confirm dialog.
 * Read-only; the tab and the editor own every write.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { StoryboardFrameView } from "@/components/brand-rooms/seams";
import { animaticTimeline, cutLabelParts, formatRunTime, frameIndexAt, frameSeconds, totalSeconds } from "@/lib/brand-rooms/storyboard-contracts";

export type StoryboardCopy = Dictionary["roomsStoryboard"];
export type StoryboardViewMode = "cards" | "table" | "player";
type Frame = StoryboardFrameView & { thumbUrl?: string | null };

export function cutLabel(copy: StoryboardCopy, frame: Pick<Frame, "scene" | "shot">, position: number): string {
  const parts = cutLabelParts(frame, position);
  return parts.scene ? interpolate(copy.cutWithScene, { scene: parts.scene, shot: parts.shot }) : interpolate(copy.cut, { shot: parts.shot });
}

export function secondsLabel(copy: StoryboardCopy, seconds: number | null): string {
  return interpolate(copy.seconds, { n: String(frameSeconds(seconds)) });
}

const still = (f: Frame) => f.thumbUrl ?? f.url;
const ratio = (f: Pick<Frame, "width" | "height">) => (f.width && f.height ? `${f.width} / ${f.height}` : undefined);

/* ------------------------------------------------------------- view switch */

export function ViewSwitch({ value, onChange, copy }: { value: StoryboardViewMode; onChange: (mode: StoryboardViewMode) => void; copy: StoryboardCopy }) {
  const modes: StoryboardViewMode[] = ["cards", "table", "player"];
  return (
    <div className="brs-seg" role="group" aria-label={copy.views.label} data-storyboard-views>
      {modes.map((mode) => (
        <button key={mode} type="button" className="brs-seg-btn" aria-pressed={value === mode} onClick={() => onChange(mode)} data-storyboard-view={mode}>
          {copy.views[mode]}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- cards */

export function CutCards({
  frames,
  copy,
  changed,
  onOpen,
}: {
  frames: readonly Frame[];
  copy: StoryboardCopy;
  changed?: ReadonlySet<string>;
  onOpen?: (index: number) => void;
}) {
  return (
    <ol className="brs-grid" data-storyboard-cards>
      {frames.map((frame, i) => {
        const label = cutLabel(copy, frame, i);
        const isChanged = changed?.has(frame.id) ?? false;
        const body = (
          <>
            <span className="brs-card-media" style={{ aspectRatio: ratio(frame) ?? "16 / 9" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- storyboard pictures come from the media store at their own size */}
              <img src={still(frame)} alt="" loading="lazy" decoding="async" />
              {isChanged ? <span className="brs-chip brs-chip-changed">{copy.changed}</span> : null}
            </span>
            <span className="brs-card-text">
              <span className="brs-card-head">
                <span className="brs-card-label">{label}</span>
                <span className="brs-card-meta">
                  <span className="brs-num">{secondsLabel(copy, frame.seconds)}</span>
                  {frame.threadCount > 0 ? (
                    <span className="brs-thread-count" aria-label={interpolate(copy.threadCountLabel, { n: frame.threadCount })}>
                      {interpolate(copy.threadCount, { n: frame.threadCount })}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className={frame.description ? "brs-card-desc" : "brs-card-desc brs-muted"}>{frame.description || copy.noDescription}</span>
            </span>
          </>
        );
        return (
          <li key={frame.id} className="brs-card" data-storyboard-cut={frame.id} data-changed={isChanged || undefined}>
            {onOpen ? (
              <button type="button" className="brs-card-button" onClick={() => onOpen(i)} aria-label={interpolate(copy.openCut, { cut: label })}>
                {body}
              </button>
            ) : (
              <div className="brs-card-button">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------- shot list */

export function ShotTable({
  frames,
  copy,
  changed,
  onOpen,
}: {
  frames: readonly Frame[];
  copy: StoryboardCopy;
  changed?: ReadonlySet<string>;
  onOpen?: (index: number) => void;
}) {
  const t = copy.table;
  return (
    <div className="brs-table-wrap" data-storyboard-table>
      <table className="brs-table">
        <caption className="brs-sr">{t.caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="brs-col-num">{t.number}</th>
            <th scope="col">{t.cut}</th>
            <th scope="col">{t.picture}</th>
            <th scope="col" className="brs-col-wide">{t.description}</th>
            <th scope="col">{t.camera}</th>
            <th scope="col">{t.audio}</th>
            <th scope="col" className="brs-col-num">{t.seconds}</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((frame, i) => {
            const label = cutLabel(copy, frame, i);
            return (
              <tr key={frame.id} data-storyboard-row={frame.id} data-changed={changed?.has(frame.id) || undefined}>
                <td className="brs-col-num brs-num">{i + 1}</td>
                <th scope="row" className="brs-row-label">
                  {label}
                  {changed?.has(frame.id) ? <span className="brs-chip brs-chip-changed brs-chip-inline">{copy.changed}</span> : null}
                </th>
                <td>
                  {onOpen ? (
                    <button type="button" className="brs-thumb" onClick={() => onOpen(i)} aria-label={interpolate(copy.openCut, { cut: label })}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- media-store still */}
                      <img src={still(frame)} alt="" loading="lazy" style={{ aspectRatio: ratio(frame) ?? "16 / 9" }} />
                    </button>
                  ) : (
                    <span className="brs-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element -- media-store still */}
                      <img src={still(frame)} alt="" loading="lazy" style={{ aspectRatio: ratio(frame) ?? "16 / 9" }} />
                    </span>
                  )}
                </td>
                <td className="brs-col-wide brs-pre">{frame.description || <span className="brs-muted">{copy.noDescription}</span>}</td>
                <td className="brs-pre">{frame.camera ?? ""}</td>
                <td className="brs-pre">{frame.audio ?? ""}</td>
                <td className="brs-col-num brs-num">{secondsLabel(copy, frame.seconds)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={6} className="brs-total-label">
              {t.total}
            </th>
            <td className="brs-col-num brs-num" data-storyboard-total>
              {formatRunTime(totalSeconds(frames))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- animatic */

export function Animatic({ frames, copy, startIndex = 0 }: { frames: readonly Frame[]; copy: StoryboardCopy; startIndex?: number }) {
  const { starts, total } = useMemo(() => animaticTimeline(frames), [frames]);
  const [ms, setMs] = useState(() => starts[Math.min(startIndex, Math.max(0, starts.length - 1))] ?? 0);
  const [playing, setPlaying] = useState(false);
  const last = useRef<number | null>(null);
  const msRef = useRef(ms);
  useEffect(() => {
    msRef.current = ms;
  }, [ms]);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const before = last.current ?? now;
      last.current = now;
      const next = Math.min(total, msRef.current + (now - before));
      msRef.current = next;
      setMs(next);
      if (next >= total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const index = frameIndexAt(starts, Math.min(ms, Math.max(0, total - 1)));
  const frame = frames[index];
  const nextFrame = frames[index + 1];

  const go = useCallback(
    (to: number) => {
      const clamped = Math.max(0, Math.min(frames.length - 1, to));
      setMs(starts[clamped] ?? 0);
    },
    [frames.length, starts],
  );
  const toggle = useCallback(() => {
    if (playing) setPlaying(false);
    else {
      if (ms >= total) setMs(0);
      setPlaying(true);
    }
  }, [ms, playing, total]);

  if (!frame) return null;
  const label = cutLabel(copy, frame, index);
  return (
    <section
      className="brs-player"
      aria-label={copy.player.label}
      tabIndex={0}
      data-storyboard-player
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget && (event.target as HTMLElement).tagName === "INPUT") {
          if (event.key !== " ") return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(index - 1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          go(index + 1);
        } else if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <div className="brs-player-stage">
        {/* eslint-disable-next-line @next/next/no-img-element -- the cut's own picture */}
        <img src={frame.url} alt={label} className="brs-player-img" />
        {nextFrame ? (
          // Warm the next picture so the cut lands on time.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={nextFrame.url} alt="" aria-hidden="true" className="brs-preload" />
        ) : null}
        <span className="brs-player-chip brs-num" aria-hidden="true">
          {index + 1} / {frames.length}
        </span>
      </div>
      <div className="brs-player-caption" aria-live="polite">
        <span className="brs-card-label">{label}</span>
        <span className="brs-pre">{frame.description || copy.noDescription}</span>
      </div>
      <div className="brs-player-bar">
        <button type="button" className="brs-icon-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label={copy.player.previous}>
          <Chevron dir="left" />
        </button>
        <button type="button" className="brs-icon-btn brs-icon-btn-main" onClick={toggle} aria-label={playing ? copy.player.pause : copy.player.play} data-storyboard-play>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="brs-icon-btn" onClick={() => go(index + 1)} disabled={index >= frames.length - 1} aria-label={copy.player.next}>
          <Chevron dir="right" />
        </button>
        <div className="brs-scrub">
          <div className="brs-scrub-ticks" aria-hidden="true">
            {starts.slice(1).map((at) => (
              <span key={at} style={{ left: `${(at / Math.max(1, total)) * 100}%` }} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={total}
            step={100}
            value={Math.round(ms)}
            aria-label={copy.player.position}
            aria-valuetext={`${formatRunTime(ms / 1000)} / ${formatRunTime(total / 1000)}`}
            onChange={(event) => {
              setPlaying(false);
              setMs(Number(event.target.value));
            }}
          />
        </div>
        <span className="brs-num brs-time">
          {formatRunTime(Math.floor(ms / 1000))} / {formatRunTime(Math.round(total / 1000))}
        </span>
      </div>
      <p className="brs-hint">{copy.player.keys}</p>
    </section>
  );
}

/* ------------------------------------------------------------- cut sheet */

export function CutSheet({
  frames,
  index,
  copy,
  onIndex,
  onClose,
  side,
}: {
  frames: readonly Frame[];
  index: number;
  copy: StoryboardCopy;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The cut's thread (slice M), or nothing on a shared link. */
  side?: ReactNode;
}) {
  const frame = frames[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const before = useRef<HTMLElement | null>(null);
  useEffect(() => {
    before.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => before.current?.focus?.();
  }, []);
  if (!frame) return null;
  const label = cutLabel(copy, frame, index);
  const s = copy.sheet;
  return createPortal(
    <div className="brs-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="brs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-storyboard-sheet={frame.id}
        onKeyDown={(event) => {
          const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName) || (event.target as HTMLElement).isContentEditable;
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          } else if (!typing && event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
          else if (!typing && event.key === "ArrowRight" && index < frames.length - 1) onIndex(index + 1);
        }}
      >
        <div className="brs-sheet-main">
          <div className="brs-sheet-top">
            <span className="brs-card-label">{label}</span>
            <span className="brs-muted brs-num">{interpolate(s.of, { n: index + 1, total: frames.length })}</span>
            <span className="brs-sheet-nav">
              <button type="button" className="brs-icon-btn" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label={s.previous}>
                <Chevron dir="left" />
              </button>
              <button type="button" className="brs-icon-btn" onClick={() => onIndex(index + 1)} disabled={index >= frames.length - 1} aria-label={s.next}>
                <Chevron dir="right" />
              </button>
              <button type="button" className="brs-icon-btn" onClick={onClose} aria-label={s.close} ref={closeRef} data-storyboard-sheet-close>
                <CloseIcon />
              </button>
            </span>
          </div>
          <div className="brs-sheet-media" style={{ ["--brs-ratio" as string]: ratio(frame) ?? "16 / 9" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the cut's full picture */}
            <img src={frame.url} alt={label} />
          </div>
          <dl className="brs-sheet-facts">
            <div className="brs-fact-wide">
              <dt>{s.description}</dt>
              <dd className="brs-pre">{frame.description || <span className="brs-muted">{copy.noDescription}</span>}</dd>
            </div>
            {frame.camera ? (
              <div>
                <dt>{s.camera}</dt>
                <dd className="brs-pre">{frame.camera}</dd>
              </div>
            ) : null}
            {frame.audio ? (
              <div>
                <dt>{s.audio}</dt>
                <dd className="brs-pre">{frame.audio}</dd>
              </div>
            ) : null}
            <div>
              <dt>{s.seconds}</dt>
              <dd className="brs-num">{secondsLabel(copy, frame.seconds)}</dd>
            </div>
          </dl>
        </div>
        {side ? (
          <aside className="brs-sheet-side" aria-label={s.threadTitle} data-storyboard-thread={frame.id}>
            <h3 className="brs-side-title">{s.threadTitle}</h3>
            {side}
          </aside>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- confirm */

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => before?.focus?.();
  }, []);
  return createPortal(
    <div className="brs-overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <div
        className="brs-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="brs-confirm-title"
        aria-describedby="brs-confirm-body"
        data-storyboard-confirm
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <h3 id="brs-confirm-title" className="brs-confirm-title">
          {title}
        </h3>
        <p id="brs-confirm-body" className="brs-confirm-body">
          {body}
        </p>
        <div className="brs-confirm-actions">
          <button type="button" className="brs-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className="brs-btn brs-btn-primary" onClick={onConfirm} disabled={busy} ref={confirmRef} data-storyboard-confirm-yes>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- icons */

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={dir === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5 3.2v9.6c0 .4.4.6.7.4l7.2-4.8a.5.5 0 0 0 0-.8L5.7 2.8c-.3-.2-.7 0-.7.4Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
