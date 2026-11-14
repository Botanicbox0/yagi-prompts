'use client';

import { useEffect, useState, type RefObject } from 'react';
import { formatKeyframeSeconds, type VideoKeyframe } from '@/lib/prompts/keyframes';

export interface VideoKeyframeStripProps {
  keyframes: readonly VideoKeyframe[];
  posterSrc?: string | null;
  videoSrc?: string | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
  aspect?: string | null;
  locale?: 'ko' | 'en';
  alt?: string;
  onSelectBeat?: (timeSeconds: number) => void;
}

function keyframeThumbAspectClass(aspect?: string | null): string {
  switch (aspect) {
    case '9:16':
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

export function VideoKeyframeStrip({
  keyframes,
  posterSrc = null,
  videoSrc = null,
  videoRef,
  aspect = null,
  locale = 'ko',
  alt = '',
  onSelectBeat,
}: VideoKeyframeStripProps) {
  const [activeIndex, setActiveIndex] = useState<number>(keyframes[0]?.index ?? 0);
  const [sampledThumbs, setSampledThumbs] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!videoSrc || typeof document === 'undefined') return;
    if (keyframes.every((kf) => Boolean(kf.thumbUrl))) return;

    let cancelled = false;
    const probe = document.createElement('video');
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = 'metadata';
    if (/^https?:\/\//i.test(videoSrc) && !videoSrc.startsWith(window.location.origin)) {
      probe.crossOrigin = 'anonymous';
    }
    probe.src = videoSrc;

    const captureBeats = async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          probe.onloadedmetadata = () => resolve();
          probe.onerror = () => reject(new Error('video_meta_error'));
        });
        const w = 160;
        const h = probe.videoWidth && probe.videoHeight
          ? Math.max(90, Math.round((w * probe.videoHeight) / probe.videoWidth))
          : 120;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const nextThumbs: Record<number, string> = {};
        for (const kf of keyframes) {
          if (cancelled || kf.thumbUrl) continue;
          const target = Math.min(Math.max(0, kf.timeSeconds), Math.max(0, (probe.duration || kf.timeSeconds) - 0.05));
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              probe.removeEventListener('seeked', onSeeked);
              resolve();
            };
            probe.addEventListener('seeked', onSeeked, { once: true });
            probe.currentTime = target;
          });
          if (cancelled) return;
          ctx.drawImage(probe, 0, 0, w, h);
          try {
            nextThumbs[kf.index] = canvas.toDataURL('image/jpeg', 0.72);
          } catch {
            return;
          }
        }
        if (!cancelled && Object.keys(nextThumbs).length > 0) {
          setSampledThumbs(nextThumbs);
        }
      } catch {
        // Cross-origin video or headless environment without canvas codec cleanly keeps poster/stored thumbs.
      }
    };

    void captureBeats();
    return () => {
      cancelled = true;
      probe.removeAttribute('src');
      probe.load();
    };
  }, [videoSrc, keyframes]);

  if (!keyframes.length) return null;

  const heading = locale === 'en' ? '3-Second Keyframe Preview' : '3초 만에 훑는 핵심 프레임';
  const hint = locale === 'en' ? 'Tap a frame to jump' : '장면을 누르면 해당 시점으로 바로 이동해요';

  const handleClick = (kf: VideoKeyframe) => {
    setActiveIndex(kf.index);
    const el = videoRef?.current;
    if (el) {
      try {
        el.currentTime = kf.timeSeconds;
        el.play()?.catch?.(() => {});
      } catch {
        // Unready media element ignores seek without throwing.
      }
    }
    onSelectBeat?.(kf.timeSeconds);
  };

  const thumbAspectClass = keyframeThumbAspectClass(aspect);

  return (
    <section
      data-video-keyframe-strip
      aria-label={heading}
      className="mt-3 w-full rounded-[16px] bg-[#F4F4F5] p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-tight text-[#09090B]">{heading}</span>
        <span className="text-[0.7rem] text-[#71717A]">{hint}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keyframes.map((kf) => {
          const explicitThumb = kf.thumbUrl ?? sampledThumbs[kf.index] ?? null;
          const active = activeIndex === kf.index;
          const label = locale === 'en' ? kf.labelEn : kf.labelKo;
          return (
            <button
              key={kf.index}
              type="button"
              data-video-keyframe={kf.index}
              data-keyframe-time={kf.timeSeconds}
              aria-pressed={active}
              onClick={() => handleClick(kf)}
              className={`group flex flex-col overflow-hidden rounded-[12px] text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#09090B] ${
                active
                  ? 'bg-white ring-[1.5px] ring-[#09090B]'
                  : 'bg-white/75 hover:bg-white'
              }`}
            >
              <div className={`relative ${thumbAspectClass} w-full overflow-hidden bg-white`}>
                {explicitThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- beat frame preview / canvas snapshot
                  <img
                    src={explicitThumb}
                    alt={`${alt || heading} ${formatKeyframeSeconds(kf.timeSeconds)}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : videoSrc ? (
                  <video
                    src={`${videoSrc}#t=${kf.timeSeconds}`}
                    preload="metadata"
                    muted
                    playsInline
                    tabIndex={-1}
                    aria-hidden="true"
                    onLoadedMetadata={(e) => {
                      try {
                        e.currentTarget.currentTime = kf.timeSeconds;
                      } catch {
                        // Ignore unseekable media element during test/load.
                      }
                    }}
                    className="pointer-events-none h-full w-full object-cover"
                  />
                ) : posterSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- beat frame poster fallback
                  <img
                    src={posterSrc}
                    alt={`${alt || heading} ${formatKeyframeSeconds(kf.timeSeconds)}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : null}
                <span className="absolute right-1.5 bottom-1 rounded-full bg-[#09090B] px-1.5 py-0.5 font-mono text-[0.65rem] font-medium text-[#FFFFFF] tabular-nums">
                  {formatKeyframeSeconds(kf.timeSeconds)}
                </span>
              </div>
              {label ? (
                <span className="truncate px-2 py-1.5 text-[0.72rem] font-medium text-[#52525B] group-hover:text-[#09090B]">
                  {label}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
