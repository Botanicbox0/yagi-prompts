'use client';

import { useEffect, useRef } from 'react';
import { observePreviewPlayback } from '@/lib/media/preview-playback';

export interface DirectHeroVideoProps {
  videoSrc: string;
  posterSrc: string | null;
  title: string;
  ratio: string;
}

/**
 * Plays a single muted hero loop only when scrolled into view and reduced motion is off.
 */
export function DirectHeroVideo({ videoSrc, posterSrc, title, ratio }: DirectHeroVideoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return;
    const playback = observePreviewPlayback(video, root);
    return () => playback.dispose();
  }, [videoSrc]);

  return (
    <div
      ref={rootRef}
      className="relative w-full overflow-hidden rounded-[12px] bg-[#F4F4F5]"
      style={{ aspectRatio: ratio }}
    >
      <video
        ref={videoRef}
        data-direct-hero-video
        src={videoSrc}
        poster={posterSrc ?? undefined}
        muted
        loop
        playsInline
        preload="none"
        aria-label={title}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
