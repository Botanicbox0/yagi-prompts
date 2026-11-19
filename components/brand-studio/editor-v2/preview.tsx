'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clipPlaybackRate, frameStateAtTime, timelineSpans } from '@/lib/brand-studio/compose/timeline';
import { materialBySrc } from '@/lib/brand-studio/editor-v2/fixture';
import { DEFAULT_REFRAME, formatClock, gradeMatrix, isNeutral } from '@/lib/brand-studio/editor-v2/model';
import { EditorIcon } from './icons';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

const ASPECT_CSS = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1', '4:5': '4 / 5' } as const;
const ASPECT_RATIO = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const;

/** How far the platform's own interface reaches into a vertical frame (percent of the frame). */
const SAFE_ZONES = {
  reels: { top: 11, bottom: 21, side: 14 },
  shorts: { top: 9, bottom: 19, side: 15 },
  tiktok: { top: 10, bottom: 23, side: 15 },
} as const;

export function Preview({ api }: { api: EditorApi }) {
  const { copy, doc, project, frame, activeClip, playing, workspace } = api;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState(50);

  const latest = useRef({ project, playheadSec: api.playheadSec, seek: api.seek, setPlaying: api.setPlaying });
  latest.current = { project, playheadSec: api.playheadSec, seek: api.seek, setPlaying: api.setPlaying };

  const clip = activeClip?.clip ?? null;
  const look = clip ? doc.looks[clip.id] : undefined;
  const graded = !!look && !(isNeutral(look.detail) || look.strength === 0);
  const matrix = useMemo(() => (look ? gradeMatrix(look.detail, look.strength) : null), [look]);
  const reframe = (clip && doc.reframe[clip.id]) || DEFAULT_REFRAME;
  const comparing = api.compare && graded && workspace === 'color';

  // Paused: the frame under the playhead.
  const src = clip?.srcUrl ?? null;
  const mediaTime = activeClip?.mediaTimeSec ?? 0;
  useEffect(() => {
    if (playing) return;
    const video = videoRef.current;
    if (!video || !src) return;
    if (video.dataset.src !== src) {
      video.dataset.src = src;
      video.src = src;
    }
    video.pause();
    const apply = () => {
      if (Math.abs(video.currentTime - mediaTime) > 0.04) video.currentTime = mediaTime;
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [playing, src, mediaTime]);

  // Playing: the video element is the clock; the playhead follows it cut by cut.
  useEffect(() => {
    if (!playing) return;
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let lastPush = 0;
    let expectedId: string | null = null;
    let seekTo: number | null = null;
    const total = timelineSpans(latest.current.project).at(-1)?.timelineEndSec ?? 0;
    let cursor = latest.current.playheadSec >= total - 0.05 ? 0 : latest.current.playheadSec;
    const tick = (now: number) => {
      const current = latest.current.project;
      const spans = timelineSpans(current);
      const end = spans.at(-1)?.timelineEndSec ?? 0;
      const active = frameStateAtTime(current, cursor).activeClip;
      if (!active || cursor >= end - 0.01) {
        latest.current.seek(end);
        latest.current.setPlaying(false);
        return;
      }
      const span = spans[active.index]!;
      const rate = clipPlaybackRate(active.clip);
      if (video.dataset.src !== active.clip.srcUrl) {
        video.dataset.src = active.clip.srcUrl;
        video.src = active.clip.srcUrl;
        seekTo = active.mediaTimeSec;
      } else if (expectedId !== active.clip.id && Math.abs(video.currentTime - active.mediaTimeSec) > 0.08) {
        seekTo = active.mediaTimeSec;
      }
      expectedId = active.clip.id;
      if (seekTo !== null) {
        if (video.readyState >= 1) {
          video.currentTime = seekTo;
          seekTo = null;
        }
      } else {
        video.playbackRate = rate;
        if (video.paused) void video.play().catch(() => undefined);
        const media = video.currentTime;
        if (media >= active.clip.trimEndSec - 0.03 || video.ended) cursor = span.timelineEndSec + 0.001;
        else if (media >= active.clip.trimStartSec - 0.05) {
          cursor = Math.max(cursor, span.timelineStartSec + (media - active.clip.trimStartSec) / rate);
        }
      }
      if (now - lastPush > 66) {
        lastPush = now;
        latest.current.seek(cursor);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      video.pause();
    };
  }, [playing]);

  // Before/after: the untouched picture is drawn over the left part of the frame.
  useEffect(() => {
    if (!comparing) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const box = frameRef.current;
    if (!video || !canvas || !box) return;
    let raf = 0;
    const draw = () => {
      const width = Math.round(box.clientWidth);
      const height = Math.round(box.clientHeight);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (context && vw > 0 && vh > 0 && width > 0 && height > 0) {
        const frameRatio = width / height;
        const videoRatio = vw / vh;
        context.clearRect(0, 0, width, height);
        if (reframe.fit === 'fill') {
          if (videoRatio > frameRatio) {
            const sw = vh * frameRatio;
            context.drawImage(video, (vw - sw) * (reframe.x / 100), 0, sw, vh, 0, 0, width, height);
          } else {
            const sh = vw / frameRatio;
            context.drawImage(video, 0, (vh - sh) / 2, vw, sh, 0, 0, width, height);
          }
        } else if (videoRatio > frameRatio) {
          const dh = width / videoRatio;
          context.drawImage(video, 0, 0, vw, vh, 0, (height - dh) / 2, width, dh);
        } else {
          const dw = height * videoRatio;
          context.drawImage(video, 0, 0, vw, vh, (width - dw) / 2, 0, dw, height);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [comparing, reframe.fit, reframe.x]);

  const dragSplit = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = frameRef.current;
    if (!box) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (clientX: number) => {
      const rect = box.getBoundingClientRect();
      setSplit(Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100)));
    };
    move(event.clientX);
    const target = event.currentTarget;
    const onMove = (e: PointerEvent) => move(e.clientX);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const settings = doc.captionSettings;
  const vertical = project.aspect === '9:16';
  const zone = settings.safeArea !== 'none' ? SAFE_ZONES[settings.safeArea] : null;
  const showZones = workspace === 'captions' && vertical && !!zone;
  const lifted = vertical && settings.lift && zone ? zone.bottom + 2 : 6;
  const activeTitles = doc.titles.filter((title) => api.playheadSec >= title.startSec && api.playheadSec <= title.endSec);
  const material = clip ? materialBySrc(clip.srcUrl) : undefined;

  return (
    <section className={styles.stage} aria-label={copy.title} data-editor-preview>
      <svg className={styles.defs} aria-hidden="true" focusable="false">
        <filter id="ev2-grade" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={(matrix ?? gradeMatrix({ exposure: 0, contrast: 0, temperature: 0, saturation: 0 })).join(' ')} />
        </filter>
      </svg>
      <div className={styles.frameWrap}>
        <div
          ref={frameRef}
          className={styles.frame}
          style={{ aspectRatio: ASPECT_CSS[project.aspect], '--ev-ratio': ASPECT_RATIO[project.aspect] } as React.CSSProperties}
          data-aspect={project.aspect}
          data-editor-frame
        >
          <video
            ref={videoRef}
            className={styles.video}
            muted
            playsInline
            preload="auto"
            poster={material?.poster}
            style={{
              objectFit: reframe.fit === 'fill' ? 'cover' : 'contain',
              objectPosition: `${reframe.x}% 50%`,
              filter: graded ? 'url(#ev2-grade)' : undefined,
            }}
          />
          {comparing && (
            <>
              <canvas ref={canvasRef} className={styles.beforeCanvas} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
              <span className={styles.compareTag} data-side="before">{copy.color.applied.before}</span>
              <span className={styles.compareTag} data-side="after">{copy.color.applied.after}</span>
              <div
                className={styles.splitHandle}
                style={{ left: `${split}%` }}
                onPointerDown={dragSplit}
                role="slider"
                aria-label={copy.color.applied.compare}
                aria-valuemin={4}
                aria-valuemax={96}
                aria-valuenow={Math.round(split)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') setSplit((value) => Math.max(4, value - 4));
                  if (event.key === 'ArrowRight') setSplit((value) => Math.min(96, value + 4));
                }}
                data-editor-split
              >
                <span />
              </div>
            </>
          )}
          {showZones && zone && (
            <div className={styles.zones} aria-hidden="true" data-editor-safe-area>
              <span style={{ top: 0, left: 0, right: 0, height: `${zone.top}%` }} />
              <span style={{ bottom: 0, left: 0, right: 0, height: `${zone.bottom}%` }} />
              <span style={{ right: 0, width: `${zone.side}%`, top: '44%', bottom: `${zone.bottom}%` }} />
            </div>
          )}
          {activeTitles.map((title) => (
            <p key={title.id} className={styles.title} data-preset={title.preset}>{title.text}</p>
          ))}
          {frame.activeCaptions.map((caption) => (
            <p
              key={caption.id}
              className={styles.caption}
              data-style={settings.styleId}
              data-position={caption.position}
              style={caption.position === 'bottom' ? { bottom: `${lifted}%` } : undefined}
              data-editor-caption
            >
              {caption.text}
            </p>
          ))}
        </div>
      </div>
      <div className={styles.transport}>
        <button type="button" className={styles.iconBtn} onClick={() => { api.setPlaying(false); api.seek(0); }} aria-label={copy.timeline.toStart} title={copy.timeline.toStart}>
          <EditorIcon name="toStart" />
        </button>
        <button
          type="button"
          className={styles.playBtn}
          onClick={() => api.setPlaying(!playing)}
          aria-label={playing ? copy.timeline.pause : copy.timeline.play}
          title={playing ? copy.timeline.pause : copy.timeline.play}
          data-editor-play
        >
          <EditorIcon name={playing ? 'pause' : 'play'} />
        </button>
        <span className={styles.clock}>
          <strong>{formatClock(api.playheadSec, true)}</strong>
          <span>/ {formatClock(api.durationSec, true)}</span>
        </span>
        <span className={styles.transportSpace} />
        {workspace === 'color' && (
          <button
            type="button"
            className={styles.chipBtn}
            aria-pressed={api.compare}
            disabled={!graded}
            onClick={() => api.setCompare(!api.compare)}
            data-editor-compare
          >
            <EditorIcon name="compare" />
            {copy.color.applied.compare}
          </button>
        )}
        <button type="button" className={styles.chipBtn} onClick={api.splitAtPlayhead} title="S">
          <EditorIcon name="split" />
          {copy.timeline.split}
          <kbd>S</kbd>
        </button>
      </div>
    </section>
  );
}
