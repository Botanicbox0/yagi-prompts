'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { observeCardArming } from '@/lib/media/card-arming';

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
 * - Portrait clips (`9:16`, `4:5`, `3:4`) fill a phone edge to edge and sit in a studio frame on
 *   desktop; landscape clips keep their own ratio.
 */

function isPortraitAspect(aspect?: string | null): boolean {
  return aspect === '9:16' || aspect === '4:5' || aspect === '3:4';
}

function frameAspectClass(aspect?: string | null): string {
  switch (aspect) {
    case '9:16':
      return 'aspect-[4/5] sm:aspect-[9/16]';
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

const CONTROL =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition-colors hover:bg-black/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

export function PromptDetailMedia({
  poster,
  video,
  alt,
  ratio,
  fallback,
  aspect,
  controls,
}: {
  poster: DetailMediaSource | null;
  video: DetailMediaSource | null;
  alt: string;
  ratio?: string;
  fallback: ReactNode;
  aspect?: string | null;
  controls: DetailMediaControls;
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

  const hasPoster = poster !== null && !posterFailed;
  const hasVideo = video !== null && !videoFailed;

  useEffect(() => {
    setVideoFailed(false);
    setPosterFailed(false);
    setMuted(true);
    setIntent('auto');
  }, [video?.src, poster?.src]);

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
    ? 'w-full sm:flex sm:h-[min(calc(100svh-11rem),40rem)] sm:items-center sm:justify-center sm:rounded-2xl sm:bg-black/[0.035] sm:p-6 lg:h-[min(calc(100svh-9rem),46rem)] lg:p-8'
    : 'w-full';
  const stageClass = portrait
    ? `relative w-full overflow-hidden bg-black ${ratioClass} sm:h-full sm:w-auto sm:max-w-full sm:rounded-xl sm:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)]`
    : `relative w-full overflow-hidden bg-black ${ratioClass} sm:rounded-2xl`;

  // Both handlers touch the element inside the tap itself: iOS only lets a gesture start sound.
  const togglePlayback = () => {
    const el = videoRef.current;
    if (playing) {
      setIntent('paused');
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

  return (
    <div ref={hostRef} data-media-host className={outerClass} style={!aspect && ratio ? { aspectRatio: ratio } : undefined}>
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
}
