'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { MIN_CLIP_PLAY_SEC, clipPlaybackRate } from '@/lib/brand-studio/compose/timeline';
import { FIXTURE_SPEECH } from '@/lib/brand-studio/editor-v2/fixture';
import { duckEnvelope, envelopeGainAt, waveform } from '@/lib/brand-studio/editor-v2/model';
import { EditorIcon } from './icons';
import type { EditorApi } from './use-editor';
import styles from './editor-v2.module.css';

type Drag =
  | { kind: 'trim'; index: number; edge: 'start' | 'end'; deltaSec: number }
  | { kind: 'move'; index: number; toIndex: number; dx: number };

const SNAP_PX = 7;
const BAR_PX = 4;

export function Timeline({ api }: { api: EditorApi }) {
  const { copy, doc, project, spans, durationSec, workspace } = api;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const pps = (durationSec > 0 ? Math.max(14, (width - 40) / durationSec) : 48) * api.zoom;
  const contentWidth = Math.max(width, durationSec * pps + 40);
  const toSec = (clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    return rect ? (clientX - rect.left) / pps : 0;
  };

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    api.setPlaying(false);
    const move = (clientX: number, free: boolean) => {
      let sec = toSec(clientX);
      if (!free) {
        for (const span of spans) {
          for (const edge of [span.timelineStartSec, span.timelineEndSec]) {
            if (Math.abs(edge - sec) * pps < SNAP_PX) sec = edge;
          }
        }
      }
      api.seek(sec);
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
    const startX = event.clientX;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    let moved = false;
    let toIndex = index;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) < 6) return;
      moved = true;
      const sec = toSec(e.clientX);
      toIndex = spans.filter((span) => span.index !== index && (span.timelineStartSec + span.timelineEndSec) / 2 < sec).length;
      setDrag({ kind: 'move', index, toIndex, dx });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moved) return api.select(clipId, additive);
      if (toIndex !== index) api.patch([{ op: 'move_clip', fromIndex: index, toIndex }]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startTrim = (event: React.PointerEvent<HTMLSpanElement>, index: number, edge: 'start' | 'end') => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const span = spans[index];
    if (!span) return;
    const clip = span.clip;
    const rate = clipPlaybackRate(clip);
    const startX = event.clientX;
    const edgeSec = edge === 'start' ? span.timelineStartSec : span.timelineEndSec;
    // How far this edge may travel on the timeline, in seconds (positive is to the right).
    const min = edge === 'start' ? -clip.trimStartSec / rate : -(span.durationSec - MIN_CLIP_PLAY_SEC);
    const max = edge === 'start' ? span.durationSec - MIN_CLIP_PLAY_SEC : (clip.durationSec - clip.trimEndSec) / rate;
    let deltaSec = 0;
    const onMove = (e: PointerEvent) => {
      deltaSec = (e.clientX - startX) / pps;
      if (!e.shiftKey && Math.abs(edgeSec + deltaSec - api.playheadSec) * pps < SNAP_PX) deltaSec = api.playheadSec - edgeSec;
      deltaSec = Math.min(max, Math.max(min, deltaSec));
      setDrag({ kind: 'trim', index, edge, deltaSec });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      const mediaDelta = Math.round(deltaSec * rate * 10) / 10;
      if (mediaDelta === 0) return;
      api.patch([
        edge === 'start'
          ? { op: 'trim_clip', clipIndex: index, trimStartSec: clip.trimStartSec + mediaDelta }
          : { op: 'trim_clip', clipIndex: index, trimEndSec: clip.trimEndSec + mediaDelta },
      ]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const bars = Math.max(8, Math.floor((durationSec * pps) / BAR_PX));
  const voiceBars = useMemo(() => waveform(7, bars), [bars]);
  const musicBars = useMemo(() => waveform(doc.music ? doc.music.id.charCodeAt(1) * 31 : 3, bars), [bars, doc.music]);
  const envelope = useMemo(() => duckEnvelope(FIXTURE_SPEECH, durationSec, doc.sound.duck), [durationSec, doc.sound.duck]);
  const musicGain = (sec: number) => {
    let gain = envelopeGainAt(envelope, sec) * doc.sound.musicVolume;
    if (doc.sound.fades) gain *= Math.min(1, sec / 0.5, Math.max(0, durationSec - sec) / 1.5);
    return gain;
  };
  const inSpeech = (sec: number) => FIXTURE_SPEECH.some((region) => sec >= region.startSec && sec <= region.endSec);
  const lanes = copy.timeline.lanes;
  const dropAt =
    drag?.kind === 'move'
      ? (() => {
          const others = spans.filter((span) => span.index !== drag.index);
          const before = others[drag.toIndex];
          return before ? before.timelineStartSec : (others[others.length - 1]?.timelineEndSec ?? 0);
        })()
      : null;

  return (
    <section className={styles.timeline} data-ws={workspace} aria-label={lanes.video} data-editor-timeline>
      <div className={styles.laneNames}>
        <div className={styles.zoomRow}>
          <button type="button" className={styles.iconBtn} onClick={() => api.setZoom(Math.max(1, api.zoom / 1.5))} aria-label={copy.timeline.zoomOut} title={copy.timeline.zoomOut} disabled={api.zoom <= 1}>
            <EditorIcon name="minus" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={() => api.setZoom(Math.min(8, api.zoom * 1.5))} aria-label={copy.timeline.zoomIn} title={copy.timeline.zoomIn} disabled={api.zoom >= 8}>
            <EditorIcon name="plus" />
          </button>
        </div>
        <span data-lane="titles">{lanes.titles}</span>
        <span data-lane="video">{lanes.video}</span>
        <span data-lane="captions">{lanes.captions}</span>
        <span data-lane="voice">{lanes.voice}</span>
        <span data-lane="music">{lanes.music}</span>
      </div>
      <div className={styles.laneScroll} ref={scrollRef}>
        <div className={styles.laneContent} ref={contentRef} style={{ width: contentWidth }} onPointerDown={(event) => { if (event.target === event.currentTarget) api.clearSelection(); }}>
          <div className={styles.ruler} onPointerDown={scrub} data-editor-ruler>
            {Array.from({ length: Math.floor(durationSec) + 1 }, (_, sec) => (
              (sec % (pps < 26 ? 5 : pps < 60 ? 2 : 1) === 0) && (
                <span key={sec} style={{ left: sec * pps }}>{`0:${String(sec).padStart(2, '0')}`}</span>
              )
            ))}
          </div>

          <div className={styles.lane} data-lane="titles" onPointerDown={(event) => { if (event.target === event.currentTarget) api.clearSelection(); }}>
            {doc.titles.map((title) => (
              <button
                key={title.id}
                type="button"
                className={styles.textItem}
                style={{ left: title.startSec * pps, width: Math.max(18, (title.endSec - title.startSec) * pps - 2) }}
                aria-pressed={api.selectedTitleId === title.id}
                onClick={() => { api.setWorkspace('cut'); api.setSelectedTitleId(title.id); api.seek(title.startSec); }}
              >
                {title.text}
              </button>
            ))}
          </div>

          <div className={styles.lane} data-lane="video" onPointerDown={(event) => { if (event.target === event.currentTarget) api.clearSelection(); }}>
            {spans.map((span) => {
              const trimming = drag?.kind === 'trim' && drag.index === span.index ? drag : null;
              const moving = drag?.kind === 'move' && drag.index === span.index ? drag : null;
              let left = span.timelineStartSec * pps;
              let clipWidth = span.durationSec * pps;
              if (trimming) {
                if (trimming.edge === 'start') {
                  left += trimming.deltaSec * pps;
                  clipWidth -= trimming.deltaSec * pps;
                } else clipWidth += trimming.deltaSec * pps;
              }
              const look = doc.looks[span.clip.id];
              const rate = clipPlaybackRate(span.clip);
              const selected = api.selection.includes(span.clip.id);
              const inScope = workspace !== 'cut' && api.targetIds.includes(span.clip.id);
              return (
                <div
                  key={span.clip.id}
                  className={styles.clip}
                  style={{
                    left,
                    width: Math.max(10, clipWidth - 2),
                    backgroundImage: span.clip.thumbUrl ? `url(${span.clip.thumbUrl})` : undefined,
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
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      api.select(span.clip.id, event.shiftKey);
                    }
                  }}
                  data-editor-clip={span.index + 1}
                >
                  <span className={styles.clipHandle} data-edge="start" onPointerDown={(event) => startTrim(event, span.index, 'start')} title={copy.timeline.trimStart} />
                  <span className={styles.clipBadge}>{span.index + 1}</span>
                  {look && <span className={styles.clipLook} data-source={look.source} />}
                  {rate !== 1 && <span className={styles.clipRate}>{rate}×</span>}
                  <span className={styles.clipHandle} data-edge="end" onPointerDown={(event) => startTrim(event, span.index, 'end')} title={copy.timeline.trimEnd} />
                </div>
              );
            })}
            {dropAt !== null && <span className={styles.dropMark} style={{ left: dropAt * pps }} />}
          </div>

          <div className={styles.lane} data-lane="captions" onPointerDown={(event) => { if (event.target === event.currentTarget) api.clearSelection(); }}>
            {project.captions.map((caption) => (
              <button
                key={caption.id}
                type="button"
                className={styles.textItem}
                style={{ left: caption.startSec * pps, width: Math.max(18, (caption.endSec - caption.startSec) * pps - 2) }}
                onClick={() => { api.setWorkspace('captions'); api.seek(caption.startSec + 0.05); }}
              >
                {caption.text}
              </button>
            ))}
          </div>

          <div className={styles.lane} data-lane="voice">
            <span className={styles.laneTag}>{copy.timeline.narration}</span>
            <svg className={styles.wave} width={bars * BAR_PX} height="100%" viewBox={`0 0 ${bars * BAR_PX} 40`} preserveAspectRatio="none" aria-hidden="true">
              {voiceBars.map((level, index) => {
                const sec = (index * BAR_PX) / pps;
                const height = Math.max(1.5, level * (inSpeech(sec) ? (doc.sound.speechClear ? 36 : 28) : doc.sound.speechClear ? 1.5 : 5));
                return <rect key={index} x={index * BAR_PX} y={20 - height / 2} width={BAR_PX - 1.5} height={height} rx="1" />;
              })}
            </svg>
          </div>

          <div className={styles.lane} data-lane="music" data-empty={doc.music ? undefined : ''}>
            {doc.music ? (
              <>
                <span className={styles.laneTag}>{doc.music.label}</span>
                <svg className={styles.wave} width={bars * BAR_PX} height="100%" viewBox={`0 0 ${bars * BAR_PX} 40`} preserveAspectRatio="none" aria-hidden="true" data-editor-music-wave>
                  {musicBars.map((level, index) => {
                    const height = Math.max(1.5, level * 34 * musicGain((index * BAR_PX) / pps));
                    return <rect key={index} x={index * BAR_PX} y={20 - height / 2} width={BAR_PX - 1.5} height={height} rx="1" />;
                  })}
                  {doc.sound.duck && (
                    <polyline
                      className={styles.envelope}
                      points={envelope.map((point) => `${point.sec * pps},${36 - point.gain * 32}`).join(' ')}
                      data-editor-envelope
                    />
                  )}
                </svg>
              </>
            ) : (
              <span className={styles.laneEmpty}>{copy.timeline.noMusic}</span>
            )}
          </div>

          <span className={styles.playhead} style={{ transform: `translateX(${api.playheadSec * pps}px)` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
