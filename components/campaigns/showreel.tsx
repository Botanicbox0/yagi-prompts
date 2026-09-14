'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReelItem } from '@/lib/campaigns/showreel';

/**
 * Four studio formats on the campaigns page (founder, 2026-09-14). The same posture as the
 * template cards' media (`components/prompts/card-media.tsx`): the poster is in the HTML and is
 * what a crawler, a no-JS reader and the first paint see; the clip has `preload="none"` and plays
 * only while at least half of it is on screen, muted, so a page with four films costs four stills
 * until the reader scrolls to one. `prefers-reduced-motion` keeps every clip parked on its poster
 * and leaves the play button as the one way in.
 *
 * Sound is off by default (autoplay policy), and the reader turns it on per tile — a beauty spot
 * with a soundtrack is a different film from a silent one.
 */

export interface ReelCaption {
  title: string;
  line: string;
}

export interface ReelLabels {
  play: string;
  pause: string;
  unmute: string;
  mute: string;
}

export function CampaignShowreel({
  items,
  captions,
  labels,
}: {
  items: readonly ReelItem[];
  captions: Record<ReelItem['id'], ReelCaption>;
  labels: ReelLabels;
}) {
  return (
    <ul data-campaign-reel className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.id} className={item.orientation === 'landscape' ? 'flex sm:col-span-2 lg:col-span-3' : 'flex'}>
          <ReelTile item={item} caption={captions[item.id]} labels={labels} />
        </li>
      ))}
    </ul>
  );
}

function ReelTile({ item, caption, labels }: { item: ReelItem; caption: ReelCaption; labels: ReelLabels }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReduced(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.5 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (video.paused) void video.play().catch(() => undefined);
  };

  const landscape = item.orientation === 'landscape';

  return (
    <figure
      data-reel-item={item.id}
      data-reel-playing={playing ? 'true' : 'false'}
      className={[
        'relative w-full overflow-hidden border border-hairline bg-black',
        // A landscape tile fills the row a portrait tile sets (grid stretch); below lg it keeps its own frame.
        landscape ? 'aspect-video lg:aspect-auto lg:h-full' : '',
      ].join(' ')}
      style={landscape ? undefined : { aspectRatio: item.ratio }}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        poster={item.poster}
        muted
        loop
        playsInline
        preload="none"
        aria-label={caption.title}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={item.src} type="video/mp4" />
      </video>

      {/* Caption + controls sit on a gradient so the type reads on any frame. */}
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-3 text-white">
        <div className="min-w-0">
          <p className="font-label text-[0.75rem] leading-none tracking-[0.12em] uppercase">{caption.title}</p>
          <p className="mt-1.5 truncate font-mono text-[0.7rem] opacity-70">{caption.line}</p>
        </div>
        <div className="pointer-events-auto flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-pressed={playing}
            aria-label={playing ? labels.pause : labels.play}
            className={[
              'inline-flex h-8 min-w-8 items-center justify-center border border-white/40 bg-black/50 px-2 font-mono text-[0.7rem] leading-none backdrop-blur-sm',
              reduced ? 'opacity-100' : '',
            ].join(' ')}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={!muted}
            aria-label={muted ? labels.unmute : labels.mute}
            className="inline-flex h-8 min-w-8 items-center justify-center border border-white/40 bg-black/50 px-2 font-mono text-[0.7rem] leading-none backdrop-blur-sm"
          >
            {muted ? '♪̸' : '♪'}
          </button>
        </div>
      </figcaption>
    </figure>
  );
}
