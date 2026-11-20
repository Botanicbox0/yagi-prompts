'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { materialBySrc } from '@/lib/brand-studio/editor-v2/fixture';
import { COMPOSE_DIMENSIONS } from '@/lib/brand-studio/compose/timeline';
import { CURRENT_EXPORT_BACKGROUND, currentExportFrame } from '@/lib/brand-studio/editor-v2/framing';
import { formatTimecode, frameStateAt, spansOf, totalFrames } from '@/lib/brand-studio/editor-v2/frames';
import { DEFAULT_REFRAME, gradeMatrix, isNeutral } from '@/lib/brand-studio/editor-v2/model';
import { formatBinding } from '@/lib/brand-studio/editor-v2/shortcuts';
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
  const { copy, doc, sequence, frame, activeClip, rate, workspace, fps, playhead } = api;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState(50);
  const [shown, setShown] = useState<{ src: string; sourceFrame: number } | null>(null);
  /** The picture's own size, once the video knows it: a real film is framed by it (framing.ts). */
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null);

  const latest = useRef({ sequence, playhead, seek: api.seek, setRate: api.setRate });
  latest.current = { sequence, playhead, seek: api.seek, setRate: api.setRate };

  const clip = activeClip?.clip ?? null;
  const look = clip ? doc.looks[clip.id] : undefined;
  const graded = !!look && !(isNeutral(look.detail) || look.strength === 0);
  const matrix = useMemo(() => (look ? gradeMatrix(look.detail, look.strength) : null), [look]);
  const reframe = (clip && doc.reframe[clip.id]) || DEFAULT_REFRAME;
  const comparing = api.compare && graded && workspace === 'color';

  // Stopped (or shuttling backwards): show exactly the frame the playhead is on. The seek aims at the
  // middle of the source frame, so the browser cannot round onto a neighbour.
  const src = clip?.srcUrl ?? null;
  const seekSec = activeClip?.seekSec ?? 0;
  const sourceFrame = activeClip?.sourceFrame ?? 0;
  useEffect(() => {
    if (rate > 0) return;
    const video = videoRef.current;
    if (!video || !src) return;
    if (video.dataset.src !== src) {
      video.dataset.src = src;
      video.src = src;
    }
    video.pause();
    let alive = true;
    const landed = () => {
      if (alive && !video.seeking && Math.abs(video.currentTime - seekSec) < 0.002) setShown({ src, sourceFrame });
    };
    const apply = () => {
      if (Math.abs(video.currentTime - seekSec) > 0.0005) video.currentTime = seekSec;
      else if (video.readyState >= 2) landed();
    };
    video.addEventListener('seeked', landed);
    video.addEventListener('loadeddata', landed);
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
    return () => {
      alive = false;
      video.removeEventListener('seeked', landed);
      video.removeEventListener('loadeddata', landed);
      video.removeEventListener('loadedmetadata', apply);
    };
  }, [rate, src, seekSec, sourceFrame]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const read = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setNatural({ src: video.dataset.src ?? '', width: video.videoWidth, height: video.videoHeight });
    };
    video.addEventListener('loadedmetadata', read);
    video.addEventListener('resize', read);
    read();
    return () => {
      video.removeEventListener('loadedmetadata', read);
      video.removeEventListener('resize', read);
    };
  }, []);

  // Playing forward (1×, or 2× and 4× on the shuttle): the video element is the clock and the playhead
  // follows it, one whole frame at a time, cut by cut.
  useEffect(() => {
    if (rate <= 0) return;
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let lastPush = 0;
    let expectedId: string | null = null;
    let seekTo: number | null = null;
    const startTotal = totalFrames(latest.current.sequence);
    let cursor = latest.current.playhead >= startTotal - 1 ? 0 : latest.current.playhead;
    const tick = (now: number) => {
      const current = latest.current.sequence;
      const end = totalFrames(current);
      const active = cursor < end ? frameStateAt(current, cursor).active : null;
      if (!active) {
        latest.current.seek(end - 1);
        latest.current.setRate(0);
        return;
      }
      const { clip: playing } = active;
      const span = spansOf(current)[active.index]!;
      if (video.dataset.src !== playing.srcUrl) {
        video.dataset.src = playing.srcUrl;
        video.src = playing.srcUrl;
        seekTo = active.seekSec;
      } else if (expectedId !== playing.id && Math.abs(video.currentTime - active.seekSec) > 0.5 / playing.sourceFps) {
        seekTo = active.seekSec;
      }
      expectedId = playing.id;
      if (seekTo !== null) {
        if (video.readyState >= 1) {
          video.currentTime = seekTo;
          seekTo = null;
        }
      } else {
        video.playbackRate = Math.min(16, (playing.speedNum / playing.speedDen) * rate);
        if (video.paused) void video.play().catch(() => undefined);
        // The film-grid frame the video is on, then back through the cut's speed to a timeline frame.
        const mediaFrame = Math.floor(video.currentTime * current.fps + 1e-6);
        const offset = Math.floor(((mediaFrame - playing.inFrame) * playing.speedDen - playing.phase) / playing.speedNum);
        if (offset >= playing.frames || video.ended) cursor = span.end;
        else if (offset >= 0) cursor = Math.max(cursor, span.start + offset);
      }
      if (now - lastPush > 40 && cursor < end) {
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
  }, [rate]);

  // Shuttling backwards: a browser cannot play a video in reverse, so the playhead steps back at the
  // film's rate and the frame is shown by seeking.
  useEffect(() => {
    if (rate >= 0) return;
    const timer = setInterval(() => {
      const at = latest.current.playhead;
      if (at <= 0) return latest.current.setRate(0);
      latest.current.seek(at + rate);
    }, 1000 / fps);
    return () => clearInterval(timer);
  }, [rate, fps]);

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
  const vertical = sequence.aspect === '9:16';
  const zone = settings.safeArea !== 'none' ? SAFE_ZONES[settings.safeArea] : null;
  const showZones = workspace === 'captions' && vertical && !!zone;
  const lifted = vertical && settings.lift && zone ? zone.bottom + 2 : 6;
  const activeTitles = doc.titles.filter((title) => playhead >= title.start && playhead < title.end);
  const material = clip ? materialBySrc(clip.srcUrl) : undefined;
  const key = (action: 'split' | 'play') => {
    const binding = api.shortcutMap[action][0];
    return binding ? formatBinding(binding, api.mac) : [];
  };
  const settledOnFrame = rate === 0 && !!shown && shown.src === src && shown.sourceFrame === sourceFrame;
  // A real film is framed exactly as the current editor's file frames it (and v2's export does): cover,
  // or fit inside on the exporter's background when the shapes are far apart (review round 1, item 5).
  const dims = COMPOSE_DIMENSIONS[sequence.aspect];
  const framed = api.real
    ? currentExportFrame(natural && natural.src === src ? natural.width : 0, natural && natural.src === src ? natural.height : 0, dims.width, dims.height)
    : null;
  const videoStyle: React.CSSProperties = framed
    ? { objectFit: framed.fit === 'fit' ? 'contain' : 'cover', objectPosition: '50% 50%', backgroundColor: CURRENT_EXPORT_BACKGROUND }
    : { objectFit: reframe.fit === 'fill' ? 'cover' : 'contain', objectPosition: `${reframe.x}% 50%`, filter: graded ? 'url(#ev2-grade)' : undefined };

  return (
    <section
      className={styles.stage}
      aria-label={copy.title}
      data-editor-preview
      data-editor-playhead={playhead}
      data-editor-fps={fps}
      data-editor-source-frame={sourceFrame}
      data-editor-settled={settledOnFrame ? '' : undefined}
    >
      <svg className={styles.defs} aria-hidden="true" focusable="false">
        <filter id="ev2-grade" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={(matrix ?? gradeMatrix({ exposure: 0, contrast: 0, temperature: 0, saturation: 0 })).join(' ')} />
        </filter>
      </svg>
      <div className={styles.frameWrap}>
        <div
          ref={frameRef}
          className={styles.frame}
          style={{ aspectRatio: ASPECT_CSS[sequence.aspect], '--ev-ratio': ASPECT_RATIO[sequence.aspect] } as React.CSSProperties}
          data-aspect={sequence.aspect}
          data-editor-frame
        >
          <video
            ref={videoRef}
            className={styles.video}
            muted
            playsInline
            preload="auto"
            poster={material?.poster ?? (api.real ? (clip?.thumbUrl ?? undefined) : undefined)}
            style={videoStyle}
            data-editor-framing={framed ? framed.fit : undefined}
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
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.stopPropagation();
                  setSplit((value) => Math.min(96, Math.max(4, value + (event.key === 'ArrowLeft' ? -4 : 4))));
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
          {frame.captions.map((caption) => (
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
          {api.real && api.status === 'loading' && (
            <p className={styles.stageNote} role="status" data-editor-loading>{copy.real.loading}</p>
          )}
          {api.real && api.status === 'ready' && sequence.clips.length === 0 && (
            <p className={styles.stageNote} data-editor-empty>{copy.real.empty}</p>
          )}
        </div>
      </div>
      <div className={styles.transport}>
        <button type="button" className={styles.iconBtn} onClick={() => api.step(-api.total)} aria-label={copy.timeline.toStart} title={copy.timeline.toStart}>
          <EditorIcon name="toStart" />
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => api.step(-1)} aria-label={copy.timeline.stepBack} title={copy.timeline.stepBack} data-editor-step="-1">
          <EditorIcon name="back" />
        </button>
        <button
          type="button"
          className={styles.playBtn}
          onClick={() => api.setPlaying(rate === 0)}
          aria-label={rate !== 0 ? copy.timeline.pause : copy.timeline.play}
          title={`${rate !== 0 ? copy.timeline.pause : copy.timeline.play} (${key('play').join(' ')})`}
          data-editor-play
        >
          <EditorIcon name={rate !== 0 ? 'pause' : 'play'} />
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => api.step(1)} aria-label={copy.timeline.stepForward} title={copy.timeline.stepForward} data-editor-step="1">
          <EditorIcon name="forward" />
        </button>
        <span className={styles.clock} title={copy.timeline.timecodeNote}>
          <strong data-editor-timecode>{formatTimecode(playhead, fps)}</strong>
          <span>/ {formatTimecode(api.total, fps)}</span>
          {/* An empty real film has no rate yet: its first clip sets it. */}
          {(!api.real || sequence.clips.length > 0) && (
            <em title={api.tentative ? fill(copy.real.rateTentative, { fps }) : undefined} data-editor-fps-tentative={api.tentative ? '' : undefined}>
              {fps} fps{api.tentative ? ` · ${copy.real.rateTentativeShort}` : ''}
            </em>
          )}
          {rate !== 0 && rate !== 1 && <em data-editor-shuttle>{rate > 0 ? `${rate}×` : `−${Math.abs(rate)}×`}</em>}
        </span>
        <span className={styles.transportSpace} />
        {workspace === 'color' && !api.real && (
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
        <button type="button" className={styles.chipBtn} onClick={api.splitAtPlayhead} disabled={api.readOnly || sequence.clips.length === 0} data-editor-split-button>
          <EditorIcon name="split" />
          {copy.timeline.split}
          <kbd>{key('split').join(' ')}</kbd>
        </button>
      </div>
    </section>
  );
}
