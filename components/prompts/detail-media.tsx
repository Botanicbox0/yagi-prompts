'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { observeCardArming } from '@/lib/media/card-arming';
import { rangeLoopReducer, rangeLoopSeek, type RangeLoop, type RangeLoopAction } from '@/lib/media/range-loop';
import { VideoKeyframeStrip } from './video-keyframe-strip';
import { TemplateFixedStrip, type TemplateFixedCopy } from './template-fixed-strip';
import type { VideoKeyframe } from '@/lib/prompts/keyframes';
import type { TemplatePartView } from '@/lib/template-director/parts-view';

export interface DetailMediaSource {
  src: string;
  mime: string;
  w?: number;
  h?: number;
}

/** The four words the controls say, from the dictionary — never written here. */
export interface DetailMediaControls {
  play: string;
  pause: string;
  unmute: string;
  mute: string;
}

/**
 * Hero media for a template detail page (`/[locale]/t/[slug]`) and the prompt detail header.
 *
 * - SSR renders `preload="none"`, `muted`, `loop`, `playsInline` and the poster, with no native
 *   browser `controls`: the result is the picture, not a player.
 * - Plays through the shared `observeCardArming` pool (at most four on screen), muted.
 * - Two small controls: play/pause and sound. A looping clip up to 30 seconds long must be
 *   stoppable (WCAG 2.2.2), and `prefers-reduced-motion` does not autoplay but keeps the play
 *   button, so the example stays one tap away instead of out of reach.
 * - Portrait clips (`9:16`, `4:5`, `3:4`) stand whole on a sky-toned stage at every width, never
 *   cropped; landscape clips keep their own ratio. The card crops, the template page does not.
 */

function isPortraitAspect(aspect?: string | null): boolean {
  return aspect === '9:16' || aspect === '4:5' || aspect === '3:4';
}

function frameAspectClass(aspect?: string | null): string {
  switch (aspect) {
    case '9:16':
      return 'aspect-[9/16]';
    case '3:4':
      return 'aspect-[3/4]';
    case '4:5':
      return 'aspect-[4/5]';
    case '4:3':
      return 'aspect-[4/3]';
    case '1:1':
      return 'aspect-square';
    default:
      return 'aspect-video';
  }
}

/** `auto` follows the arming pool; `paused`/`playing` are the reader's own choice and win. */
type PlaybackIntent = 'auto' | 'paused' | 'playing';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — the parts the template decides, shown under the keyframe strip. Absent (or
 * nothing declared), the block renders exactly as before.
 */
export interface DetailMediaFixed {
  parts: readonly TemplatePartView[];
  /** The template's lock block did not parse: everything is fixed. */
  all: boolean;
  copy: TemplateFixedCopy;
}

const CONTROL =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

export function PromptDetailMedia({
  poster,
  video,
  alt,
  ratio,
  fallback,
  aspect,
  controls,
  keyframes,
  locale = 'ko',
  fixed = null,
}: {
  poster: DetailMediaSource | null;
  video: DetailMediaSource | null;
  alt: string;
  ratio?: string;
  fallback: ReactNode;
  aspect?: string | null;
  controls: DetailMediaControls;
  keyframes?: readonly VideoKeyframe[] | null;
  locale?: 'ko' | 'en';
  fixed?: DetailMediaFixed | null;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [intent, setIntent] = useState<PlaybackIntent>('auto');
  const [reducedMotion, setReducedMotion] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mutedRef = useRef(true);
  const intentRef = useRef<PlaybackIntent>('auto');
  mutedRef.current = muted;
  intentRef.current = intent;
  // The range a tapped fixed part replays. The ref is the truth the frame loop reads; it changes inside the tap
  // itself, so a beat tap that seeks elsewhere is never pulled back by a loop that is about to end.
  const [loop, setLoop] = useState<RangeLoop | null>(null);
  const loopRef = useRef<RangeLoop | null>(null);
  const applyLoop = (action: RangeLoopAction): RangeLoop | null => {
    const next = rangeLoopReducer(loopRef.current, action);
    loopRef.current = next;
    setLoop(next);
    return next;
  };

  const hasPoster = poster !== null && !posterFailed;
  const hasVideo = video !== null && !videoFailed;

  useEffect(() => {
    setVideoFailed(false);
    setPosterFailed(false);
    setMuted(true);
    setIntent('auto');
    loopRef.current = null;
    setLoop(null);
  }, [video?.src, poster?.src]);

  // While a range loops, check every frame (timeupdate only fires about four times a second).
  useEffect(() => {
    if (!loop || typeof requestAnimationFrame === 'undefined') return;
    let frame = 0;
    const tick = () => {
      const el = videoRef.current;
      const target = el ? rangeLoopSeek(loopRef.current, el.currentTime) : null;
      if (el && target !== null) {
        try {
          el.currentTime = target;
        } catch {
          // An element that cannot seek yet keeps playing; the next frame tries again.
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [loop]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !hasVideo) return;
    if (typeof IntersectionObserver === 'undefined') {
      setArmed(true);
      return;
    }
    // A clip the reader turned on (sound or play) keeps its slot in the pool.
    return observeCardArming(el, setArmed, { pinned: () => !mutedRef.current || intentRef.current === 'playing' });
  }, [hasVideo, video?.src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hasVideo) return;
    const shouldPlay = intent === 'playing' ? armed : intent === 'auto' ? armed && !reducedMotion : false;
    if (shouldPlay) {
      el.muted = mutedRef.current;
      el.play()?.catch?.(() => {
        // Autoplay refused or decode failed: the poster stays underneath, the play button stays.
      });
    } else {
      el.pause();
    }
  }, [armed, reducedMotion, intent, hasVideo, video?.src]);

  if (!hasPoster && !hasVideo) {
    return <>{fallback}</>;
  }

  const portrait = isPortraitAspect(aspect);
  const ratioClass = frameAspectClass(aspect);
  // Portrait: a stage as tall as the screen allows, the clip centred in it at its own ratio — the
  // same stage the picture gallery uses, so films and pictures read as one family.
  const outerClass = portrait
    ? 'flex h-[min(calc(100svh-7rem),40rem)] w-full items-center justify-center bg-sky p-4 sm:rounded-[18px] sm:p-6 lg:h-[min(calc(100svh-9rem),46rem)] lg:p-8'
    : 'w-full';
  const stageClass = portrait
    ? `relative h-full w-auto max-w-full overflow-hidden rounded-[18px] bg-sky ${ratioClass}`
    : `relative w-full overflow-hidden bg-sky sm:rounded-[18px] ${ratioClass}`;

  // Both handlers touch the element inside the tap itself: iOS only lets a gesture start sound.
  const togglePlayback = () => {
    const el = videoRef.current;
    if (playing) {
      setIntent('paused');
      if (loopRef.current) applyLoop({ type: 'pause' });
      el?.pause();
      return;
    }
    setIntent('playing');
    if (el) {
      el.muted = mutedRef.current;
      el.play()?.catch?.(() => {});
    }
  };

  const toggleSound = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    const el = videoRef.current;
    if (!el) return;
    el.muted = nextMuted;
    if (!nextMuted && el.paused) {
      setIntent('playing');
      el.play()?.catch?.(() => {});
    }
  };

  // Tapping a fixed part: seek to its start and replay the range (on reduced motion: seek only, no play). Tapping the
  // same part again clears the loop and leaves playback as it is.
  const selectPart = (part: TemplatePartView) => {
    if (part.from === null) return;
    const next = applyLoop({ type: 'tap', id: part.id, from: part.from, to: part.to });
    const el = videoRef.current;
    if (!next || !el) return;
    try {
      el.currentTime = next.from;
    } catch {
      // Unready media ignores the seek; the loop pulls it into range once it plays.
    }
    if (reducedMotion) return;
    setIntent('playing');
    el.muted = mutedRef.current;
    el.play()?.catch?.(() => {});
  };

  const showBeats = Boolean(hasVideo && keyframes && keyframes.length > 0);
  const showFixed = Boolean(fixed && (fixed.parts.length > 0 || fixed.all));
  const wrapped = showBeats || showFixed;

  const stageContent = (
    <div ref={wrapped ? undefined : hostRef} data-media-host={wrapped ? undefined : true} className={outerClass} style={!aspect && ratio ? { aspectRatio: ratio } : undefined}>
      <div className={stageClass}>
        {hasPoster && (
          // eslint-disable-next-line @next/next/no-img-element -- gateway URL with auth headers on private tiers; next/image cannot proxy
          <img
            src={poster.src}
            alt={alt}
            {...(poster.w ? { width: poster.w } : {})}
            {...(poster.h ? { height: poster.h } : {})}
            fetchPriority="high"
            decoding="async"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {hasVideo && (
          <>
            <video
              ref={videoRef}
              key={video.src}
              src={video.src}
              poster={hasPoster ? poster.src : undefined}
              preload="none"
              playsInline
              muted={muted}
              loop
              aria-label={alt}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setVideoFailed(true)}
              className="relative h-full w-full object-cover"
            />
            <div className="absolute inset-x-3 bottom-3 z-10 flex items-center justify-between gap-2">
              <button
                type="button"
                data-detail-playback={playing ? 'playing' : 'paused'}
                aria-label={playing ? controls.pause : controls.play}
                onClick={togglePlayback}
                className={`${CONTROL} min-w-9 justify-center px-0`}
              >
                {playing ? (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
                    <rect x="4" y="3" width="3" height="10" rx="0.75" />
                    <rect x="9" y="3" width="3" height="10" rx="0.75" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
                    <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                data-detail-sound={muted ? 'muted' : 'unmuted'}
                aria-pressed={!muted}
                aria-label={muted ? controls.unmute : controls.mute}
                onClick={toggleSound}
                className={CONTROL}
              >
                {muted ? (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2.5 6.2h2.6L8.8 3v10L5.1 9.8H2.5V6.2Z" fill="currentColor" stroke="none" />
                    <path d="m11 6 3 4m0-4-3 4" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2.5 6.2h2.6L8.8 3v10L5.1 9.8H2.5V6.2Z" fill="currentColor" stroke="none" />
                    <path d="M11.2 5.5a3.5 3.5 0 0 1 0 5M13 3.8a6 6 0 0 1 0 8.4" strokeLinecap="round" />
                  </svg>
                )}
                <span>{muted ? controls.unmute : controls.mute}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (wrapped) {
    return (
      <div ref={hostRef} data-media-host className="flex w-full flex-col gap-3">
        {stageContent}
        {showBeats && keyframes && (
          <VideoKeyframeStrip
            keyframes={keyframes}
            posterSrc={poster?.src ?? null}
            videoSrc={video?.src ?? null}
            videoRef={videoRef}
            aspect={aspect}
            locale={locale}
            alt={alt}
            onSelectBeat={() => {
              // A beat ends a range loop: the strip has already seeked to the beat inside this same tap.
              if (loopRef.current) applyLoop({ type: 'beat' });
              setIntent('playing');
            }}
          />
        )}
        {showFixed && fixed && (
          <TemplateFixedStrip
            parts={fixed.parts}
            all={fixed.all}
            copy={fixed.copy}
            videoSrc={hasVideo ? video!.src : null}
            aspect={aspect}
            activeId={loop?.id ?? null}
            onSelect={selectPart}
          />
        )}
      </div>
    );
  }

  return stageContent;
}
