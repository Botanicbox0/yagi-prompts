'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardMediaSource } from '@/components/prompts/card-media';
import { observePreviewPlayback } from '@/lib/media/preview-playback';

/** First-screen media has its own playback lifecycle; catalog hover previews stay lightweight. */
export function CreatorPreview({
  poster, video, fallback, title, href, ratio, labels, priority = true,
}: {
  poster: CardMediaSource | null;
  video: CardMediaSource | null;
  fallback: ReactNode;
  title: string;
  href: string;
  ratio: string;
  labels: { play: string; pause: string };
  priority?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<ReturnType<typeof observePreviewPlayback> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const element = videoRef.current;
    if (!root || !element) return;
    const playback = observePreviewPlayback(element, root);
    playbackRef.current = playback;
    setReady(true);
    return () => {
      playback.dispose();
      playbackRef.current = null;
    };
  }, [video?.src]);

  return <div ref={rootRef} data-creator-preview className="card__media relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: ratio }}>
    <a href={href} aria-label={title} className="block h-full w-full">
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element -- public catalog media; the hero is the LCP image
        <img src={poster.src} alt={title} width={poster.w} height={poster.h} loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" className="absolute inset-0 h-full w-full object-contain" />
      ) : fallback}
      {video && <video
        key={video.src}
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-contain"
        muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      ><source src={video.src} type={video.mime} /></video>}
    </a>
    {video && ready && <button
      type="button" data-creator-preview-control
      onClick={() => playbackRef.current?.toggle()}
      aria-label={playing ? labels.pause : labels.play}
      className="absolute right-3 bottom-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-black px-4 text-xs font-medium text-white"
    ><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span><span>{playing ? labels.pause : labels.play}</span></button>}
  </div>;
}
