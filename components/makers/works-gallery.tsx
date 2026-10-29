'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * docs/PLATFORM-2.0.md §20.2 — a creative's selected work: a masonry of images and silent films in
 * the creative's order, each opening full-screen with its title, caption and the original post.
 * Films play only while on screen (muted, inline) so a page of twelve does not run twelve decoders.
 */
export interface GalleryWork { id: string; kind: 'image' | 'video'; src: string; width: number | null; height: number | null; title: string | null; caption: string | null; linkUrl: string | null }
export interface GalleryLabels { viewOriginal: string; close: string; previous: string; next: string; workLabel: string }

function InViewVideo({ src, className, label }: { src: string; className: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => { /* autoplay refused: the poster frame stays */ });
      else video.pause();
    }, { threshold: 0.35 });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  return <video ref={ref} src={`${src}#t=0.1`} aria-label={label} muted loop playsInline preload="metadata" className={className} />;
}

export function WorksGallery({ works, labels }: { works: GalleryWork[]; labels: GalleryLabels }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const count = works.length;
  const label = (n: number) => labels.workLabel.replace('{n}', String(n + 1)).replace('{count}', String(count));

  const show = useCallback((index: number | null) => {
    setOpen(index);
    const node = dialog.current;
    if (!node) return;
    if (index === null) { if (node.open) node.close(); }
    else if (!node.open) node.showModal();
  }, []);

  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') setOpen((value) => (value === null ? value : (value + 1) % count));
      if (event.key === 'ArrowLeft') setOpen((value) => (value === null ? value : (value - 1 + count) % count));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, count]);

  const current = open === null ? null : works[open] ?? null;
  return (
    <>
      <ul data-creative-works={count} className="columns-2 gap-3 sm:gap-4 lg:columns-3 [&>li]:mb-3 sm:[&>li]:mb-4">
        {works.map((work, index) => (
          <li key={work.id} data-creative-work={work.id} className="break-inside-avoid">
            <button
              type="button"
              onClick={() => show(index)}
              aria-label={work.title ?? label(index)}
              className="group relative block w-full overflow-hidden rounded-[1.25rem] bg-black/[0.04] text-left focus-visible:outline-2 focus-visible:outline-offset-2"
              style={work.width && work.height ? { aspectRatio: `${work.width} / ${work.height}` } : { aspectRatio: '4 / 5' }}
            >
              {work.kind === 'image'
                // eslint-disable-next-line @next/next/no-img-element -- gateway-served creative work
                ? <img src={work.src} alt={work.title ?? ''} loading={index < 4 ? 'eager' : 'lazy'} decoding="async" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]" />
                : <InViewVideo src={work.src} label={work.title ?? label(index)} className="h-full w-full object-cover" />}
              {(work.title || work.kind === 'video') && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/60 via-black/10 to-transparent p-3.5 pt-10 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <span className="truncate text-sm font-medium">{work.title}</span>
                  {work.kind === 'video' && <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        data-creative-lightbox
        onClose={() => setOpen(null)}
        onClick={(event) => { if (event.target === event.currentTarget) show(null); }}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/92 p-0 text-white backdrop:bg-black/80"
      >
        {current && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <p className="font-mono text-xs opacity-70">{label(open!)}</p>
              <button type="button" onClick={() => show(null)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-sm hover:bg-white/10" aria-label={labels.close}>✕</button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
              {current.kind === 'image'
                // eslint-disable-next-line @next/next/no-img-element -- gateway-served creative work
                ? <img key={current.id} src={current.src} alt={current.title ?? ''} className="max-h-full max-w-full rounded-xl object-contain" />
                : <video key={current.id} src={current.src} controls autoPlay muted loop playsInline className="max-h-full max-w-full rounded-xl" />}
              {count > 1 && <>
                <button type="button" onClick={() => setOpen((open! - 1 + count) % count)} aria-label={labels.previous} className="absolute top-1/2 left-2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-lg backdrop-blur hover:bg-white/20 sm:left-4">‹</button>
                <button type="button" onClick={() => setOpen((open! + 1) % count)} aria-label={labels.next} className="absolute top-1/2 right-2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-lg backdrop-blur hover:bg-white/20 sm:right-4">›</button>
              </>}
            </div>
            {(current.title || current.caption || current.linkUrl) && (
              <div className="mx-auto w-full max-w-2xl px-5 pt-4 pb-6 text-center">
                {current.title && <p className="text-base font-semibold">{current.title}</p>}
                {current.caption && <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-white/75">{current.caption}</p>}
                {current.linkUrl && <a href={current.linkUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{labels.viewOriginal} ↗</a>}
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
