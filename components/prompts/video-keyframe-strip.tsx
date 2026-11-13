'use client';

import { useEffect, useState, type RefObject } from 'react';
import { formatKeyframeSeconds, type VideoKeyframe } from '@/lib/prompts/keyframes';

export interface VideoKeyframeStripProps {
  keyframes: readonly VideoKeyframe[];
  posterSrc?: string | null;
  videoSrc?: string | null;
  videoRef?: RefObject<HTMLVideoElement | null>;
  locale?: 'ko' | 'en';
  alt?: string;
  onSelectBeat?: (timeSeconds: number) => void;
}

export function VideoKeyframeStrip({
  keyframes,
  posterSrc = null,
  videoSrc = null,
  videoRef,
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

  return (
    <section
      data-video-keyframe-strip
      aria-label={heading}
      className="mt-3 w-full rounded-[16px] border border-[#E4E4E7] bg-[#FFFFFF] p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-tight text-[#09090B]">{heading}</span>
        <span className="text-[0.7rem] text-[#71717A]">{hint}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keyframes.map((kf) => {
          const thumb = kf.thumbUrl ?? sampledThumbs[kf.index] ?? posterSrc;
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
              className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#09090B] ${
                active
                  ? 'border-[#09090B] bg-[#F4F4F5]'
                  : 'border-[#E4E4E7] bg-[#FFFFFF] hover:border-[#09090B]'
              }`}
            >
              <div className="relative aspect-video w-full overflow-hidden bg-[#F4F4F5]">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- beat frame preview / canvas snapshot
                  <img
                    src={thumb}
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
