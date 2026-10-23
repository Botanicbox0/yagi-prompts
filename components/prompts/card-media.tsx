'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { observeCardArming } from '@/lib/media/card-arming';

/**
 * PLAN §13.2, revised by docs/PLATFORM-2.0.md §15.2 — "뷰포트 진입 자동재생" with a visible stop.
 *
 * The `<video>` element is not in the tree until the card is ARMED, and the `src` is not set until
 * then either, so a gallery of forty cards downloads forty posters and only the clips on screen.
 *
 *   · Every device arms on real visibility (IntersectionObserver at 60%) and releases on the way
 *     out (`lib/media/card-arming.ts`): iPhone Safari caps concurrent media decoders, and a rail
 *     that only ever arms starves the cards further down. Keyboard focus anywhere on the card arms
 *     it too — a focused card is on screen.
 *   · However many cards fit on the screen, at most four clips play: the ones nearest its centre.
 *     A card the reader pressed play on keeps its slot.
 *   · `prefers-reduced-motion` → never on its own. §5.3's reduced-motion rule is a kill switch, not
 *     a softening. The play button still works: pressing it is the reader's choice, not motion.
 *   · The stop button wins: a clip the reader stopped stays stopped, through scrolling away and
 *     back, until they press play.
 *
 * The poster stays mounted underneath at all times: it is the LCP candidate, it is what a browser
 * with no JS shows, and it is what fills the frame while the first video frame decodes.
 *
 * The card is a STRETCHED LINK, so `a::after` covers the whole card and the pointer hit-tests to
 * the anchor, never to this element. Focus is therefore listened for on the card (`HOVER_HOST`, an
 * ancestor of both), and the control is rendered as a SIBLING of `.card__media`, because the hover
 * zoom transforms that layer's children and a transformed ancestor would trap the button's z-index
 * underneath the overlay.
 */

/** The arming host is an ancestor of media AND its link. Hero previews opt in without counting as catalog cards. */
export const HOVER_HOST = '[data-prompt-card], [data-media-host]';

export interface CardMediaSource {
  src: string;
  mime: string;
  w?: number;
  h?: number;
}

/** What the reader last asked for. `auto` = they have not touched the control. */
export type PlaybackIntent = 'auto' | 'play' | 'pause';

/** The whole arming rule in one place, so it can be read (and tested) without a browser. */
export function shouldMountClip({ inView, intent, autoplay }: { inView: boolean; intent: PlaybackIntent; autoplay: boolean }): boolean {
  if (!inView || intent === 'pause') return false;
  return intent === 'play' || autoplay;
}

/** The visible play/stop control: a 44px target on a dark disc, labelled with what it will do. */
export function CardPlaybackControl({
  playing,
  labels,
  onToggle,
}: {
  playing: boolean;
  labels: { play: string; pause: string };
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-card-control={playing ? 'pause' : 'play'}
      aria-label={playing ? labels.pause : labels.play}
      onClick={onToggle}
      className="absolute right-1 bottom-1 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full"
    >
      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-white">
        {playing ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor"><rect x="2" y="1.5" width="3" height="9" rx="0.5" /><rect x="7" y="1.5" width="3" height="9" rx="0.5" /></svg>
        ) : (
          <svg viewBox="0 0 12 12" className="ml-0.5 h-3 w-3" fill="currentColor"><path d="M3 1.6v8.8a.5.5 0 0 0 .76.43l7.04-4.4a.5.5 0 0 0 0-.86L3.76 1.17A.5.5 0 0 0 3 1.6Z" /></svg>
        )}
      </span>
    </button>
  );
}

export function PromptCardMedia({
  poster,
  video,
  fallback,
  alt,
  ratio,
  fit = 'contain',
  controlLabels,
  className,
}: {
  poster: CardMediaSource | null;
  video: CardMediaSource | null;
  /** The typographic poster (§13.3-4), rendered on the server and handed down. */
  fallback: ReactNode;
  alt: string;
  ratio: string;
  /** `cover` crops to fill (the 4:5 portrait card); `contain` letterboxes (the 16:9 card). */
  fit?: 'cover' | 'contain';
  /** Without labels there is no control — the clip is decoration only. */
  controlLabels?: { play: string; pause: string };
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  const [intent, setIntent] = useState<PlaybackIntent>('auto');
  const intentRef = useRef<PlaybackIntent>('auto');
  intentRef.current = intent;
  const [autoplay, setAutoplay] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [playing, setPlaying] = useState(false);
  const armed = video !== null && shouldMountClip({ inView, intent, autoplay });

  useEffect(() => {
    setHydrated(true);
    setAutoplay(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  // Arm on real visibility and release on the way out, so the page never holds more decoders
  // than the pool's four slots. The observer stays live for the session.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || video === null || typeof IntersectionObserver === 'undefined') return;
    return observeCardArming(root, setInView, { pinned: () => intentRef.current === 'play' });
  }, [video]);

  // Keyboard focus anywhere on the card counts as being on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || video === null) return;
    const host = root.closest<HTMLElement>(HOVER_HOST) ?? root;
    const focus = () => setInView(true);
    host.addEventListener('focusin', focus);
    return () => host.removeEventListener('focusin', focus);
  }, [video]);

  useEffect(() => {
    if (!armed) setPlaying(false);
  }, [armed]);

  const toggle = () => {
    if (playing) {
      videoRef.current?.pause();
      setIntent('pause');
      return;
    }
    setIntent('play');
    setInView(true);
    void videoRef.current?.play().catch(() => {});
  };

  return (
    <>
      <div
        ref={rootRef}
        data-armed={armed ? 'true' : 'false'}
        className={['card__media relative overflow-hidden bg-black', className].filter(Boolean).join(' ')}
        style={{ aspectRatio: ratio }}
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader
          <img
            src={poster.src}
            alt={alt}
            {...(poster.w ? { width: poster.w } : {})}
            {...(poster.h ? { height: poster.h } : {})}
            loading="lazy"
            decoding="async"
            className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
          />
        ) : (
          fallback
        )}

        {armed && (
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            aria-hidden
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          >
            <source src={video.src} type={video.mime} />
          </video>
        )}
      </div>
      {hydrated && video !== null && controlLabels && (
        <CardPlaybackControl playing={playing} labels={controlLabels} onToggle={toggle} />
      )}
    </>
  );
}
