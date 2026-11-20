'use client';

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { FIXTURE_SPEECH } from '@/lib/brand-studio/editor-v2/fixture';
import {
  FRAME_STRIP_PX,
  MAX_PX_PER_FRAME,
  clipFrameAt,
  formatTimecode,
  ppfToSlider,
  rulerTicks,
  sliderToPpf,
  snapFrame,
  trimClipEdge,
  visibleCaptions,
  zoomScrollLeft,
} from '@/lib/brand-studio/editor-v2/frames';
import { duckEnvelope, envelopeGainAt, waveform } from '@/lib/brand-studio/editor-v2/model';
import { formatBinding } from '@/lib/brand-studio/editor-v2/shortcuts';
import { FrameThumbs, type ThumbRequest } from './frame-thumbs';
import { EditorIcon } from './icons';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

type Drag =
  | { kind: 'trim'; index: number; edge: 'start' | 'end'; delta: number }
  | { kind: 'move'; index: number; toIndex: number; dx: number };

const SNAP_PX = 7;
const BAR_PX = 4;
const TILE_PX = 96;
/** From this frame width on, the filmstrip decodes real frames; below it the poster stands in. */
const REAL_FRAMES_PX = 6;
/** What "frame level" zooms to. */
const FRAME_LEVEL_PX = 64;
const PAD_PX = 40;

export function Timeline({ api }: { api: EditorApi }) {
  const { copy, doc, sequence, spans, total, fps, workspace, playhead } = api;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [zoomPpf, setZoomPpf] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const thumbs = useRef<FrameThumbs | null>(null);
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const store = new FrameThumbs();
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
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setScrollLeft(element.scrollLeft);
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, []);

  const fitPpf = Math.min(MAX_PX_PER_FRAME, total > 0 ? Math.max(0.2, (width - PAD_PX) / total) : 2);
  const ppf = zoomPpf === null ? fitPpf : Math.min(MAX_PX_PER_FRAME, Math.max(fitPpf, zoomPpf));
  const contentWidth = Math.max(width, total * ppf + PAD_PX);
  const live = useRef({ ppf, fitPpf, width, playhead, total });
  live.current = { ppf, fitPpf, width, playhead, total };

  /** Changes the zoom and keeps `anchorX` (a position inside the visible strip) on the same frame. */
  const zoomTo = (next: number | null, anchorX: number, center = false) => {
    const element = scrollRef.current;
    const current = live.current;
    const target = next === null ? current.fitPpf : Math.min(MAX_PX_PER_FRAME, Math.max(current.fitPpf, next));
    if (element) {
      pendingScroll.current = center
        ? Math.max(0, (current.playhead + 0.5) * target - current.width / 2)
        : zoomScrollLeft(current.ppf, target, anchorX, element.scrollLeft);
    }
    setZoomPpf(next === null || target <= current.fitPpf + 1e-6 ? null : target);
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
        // A plain wheel moves along the film when there is somewhere to go.
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && element.scrollWidth > element.clientWidth) {
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

  const startMove = (event: React.PointerEvent<HTMLDivElement>, index: number, clipId: string) => {
    if (event.button !== 0) return;
    if (api.readOnly) return api.select(clipId, event.shiftKey || event.ctrlKey || event.metaKey);
    const startX = event.clientX;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    let moved = false;
    let toIndex = index;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 6) return;
      moved = true;
      const at = frameAt(e.clientX);
      toIndex = spans.filter((span) => span.index !== index && (span.start + span.end) / 2 < at).length;
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
  };

  const startTrim = (event: React.PointerEvent<HTMLSpanElement>, index: number, edge: 'start' | 'end') => {
    event.stopPropagation();
    if (event.button !== 0 || api.readOnly) return;
    const span = spans[index];
    if (!span) return;
    const startX = event.clientX;
    const edgeFrame = edge === 'start' ? span.start : span.end;
    let applied = 0;
    const onMove = (e: PointerEvent) => {
      // Always a whole frame; with the magnet on (and Shift not held), the playhead pulls the edge.
      let wanted = Math.round((e.clientX - startX) / ppf);
      if (api.magnet && !e.shiftKey) wanted = snapFrame(edgeFrame + wanted, [api.playhead, api.playhead + 1], ppf, SNAP_PX) - edgeFrame;
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
  };

  // Only what is on screen (plus a margin) is drawn: at frame level the film is tens of thousands of pixels wide.
  const viewFrom = Math.max(0, Math.floor((scrollLeft - 200) / ppf));
  const viewTo = Math.min(total, Math.ceil((scrollLeft + width + 200) / ppf));
  const ticks = rulerTicks(ppf, fps, viewFrom, viewTo);

  const perFrame = ppf >= FRAME_STRIP_PX;
  const realFrames = ppf >= REAL_FRAMES_PX;
  const tilePx = perFrame ? ppf : TILE_PX;
  const wanted: ThumbRequest[] = [];
  const tilesOf = (span: (typeof spans)[number]) => {
    const tiles: Array<{ left: number; width: number; url: string | undefined; frame: number }> = [];
    const clipPx = span.frames * ppf;
    const first = Math.max(0, Math.floor(((viewFrom - span.start) * ppf) / tilePx));
    const last = Math.min(Math.ceil(clipPx / tilePx) - 1, Math.floor(((viewTo - span.start) * ppf) / tilePx));
    for (let i = first; i <= last; i += 1) {
      const offset = Math.min(span.frames - 1, Math.floor((i * tilePx) / ppf + 1e-6));
      const picture = clipFrameAt(span.clip, offset, fps);
      const url = thumbs.current?.get(span.clip.srcUrl, picture.sourceFrame);
      if (!url) wanted.push({ src: span.clip.srcUrl, sourceFrame: picture.sourceFrame, seekSec: picture.seekSec });
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
  const wantedKey = wanted.map((request) => `${request.src}#${request.sourceFrame}`).join('|');
  useEffect(() => {
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
      : null;
  const cap = (action: 'magnet' | 'zoomFit' | 'zoomFrames' | 'zoomIn' | 'zoomOut') => {
    const binding = api.shortcutMap[action][0];
    return binding ? ` (${formatBinding(binding, api.mac).join(' ')})` : '';
  };
  const blank = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) api.clearSelection();
  };

  return (
    <section
      className={styles.timeline}
      data-ws={workspace}
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
          title={`${copy.timeline.magnetNote}${cap('magnet')}`}
          data-editor-magnet
        >
          <EditorIcon name="magnet" />
          {copy.timeline.magnet}
        </button>
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
          value={Math.round(ppfToSlider(ppf, fitPpf) * 1000)}
          onChange={(event) => zoomTo(sliderToPpf(Number(event.target.value) / 1000, fitPpf), playheadAnchor())}
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
      <div className={styles.laneNames}>
        <span className={styles.rulerName}>{formatTimecode(playhead, fps)}</span>
        {!api.real && <span data-lane="titles">{lanes.titles}</span>}
        <span data-lane="video">{lanes.video}</span>
        <span data-lane="captions">{lanes.captions}</span>
        {!api.real && <span data-lane="voice">{lanes.voice}</span>}
        {!api.real && <span data-lane="music">{lanes.music}</span>}
      </div>
      <div className={styles.laneScroll} ref={scrollRef}>
        <div className={styles.laneContent} ref={contentRef} style={{ width: contentWidth }} onPointerDown={blank}>
          <div className={styles.ruler} onPointerDown={scrub} data-editor-ruler data-frames={perFrame ? '' : undefined}>
            {ticks.map((tick) => (
              <span key={tick.frame} style={{ left: tick.frame * ppf }} data-label={tick.label ? '' : undefined}>
                {tick.label}
              </span>
            ))}
          </div>

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

          <div className={styles.lane} data-lane="video" onPointerDown={blank} data-empty={api.real && spans.length === 0 ? '' : undefined}>
            {api.real && spans.length === 0 && (
              <span className={styles.laneEmpty} style={{ left: scrollLeft }} data-editor-empty-lane>
                {api.status === 'ready' ? copy.real.emptyLane : copy.real.loading}
              </span>
            )}
            {spans.map((span) => {
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
                  aria-label={fill(copy.timeline.cut, { number: span.index + 1 })}
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
                  data-speed={`${span.clip.speedNum}/${span.clip.speedDen}`}
                  data-source-fps={span.clip.sourceFps}
                  data-source-frames={span.clip.sourceFrames}
                  data-clip-id={span.clip.id}
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
                  {span.clip.speedNum !== span.clip.speedDen && <span className={styles.clipRate}>{span.clip.speedNum / span.clip.speedDen}×</span>}
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

          <span
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
