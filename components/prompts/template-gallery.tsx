'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { interpolate } from '@/lib/i18n/format';
import { subscribeViewerSelfie, viewerSelfieSnapshot } from '@/lib/twings/viewer-selfie';

/**
 * The template page's picture stage (docs/PLATFORM-2.0.md §3, founder 2026-10-28: "누르면 커질 줄
 * 알았는데", "아주 interactive한 느낌으로 슬라이드").
 *
 * - The stage is a native scroll-snap track: a finger swipes it, a trackpad flicks it, the arrows
 *   and the keyboard step it. No carousel library; the browser's own scrolling does the physics.
 * - Every picture opens the viewer: a full-screen `<dialog>` (native focus trap, Esc closes) with
 *   the same swipe, and a tap or click that zooms in where it lands; dragging or moving the
 *   pointer then pans, another tap zooms out.
 * - Under the stage, "my selfie → these results": the reader's own saved selfie when the studio
 *   already knows it (lib/twings/viewer-selfie.ts), an outline otherwise, then the frames as
 *   thumbnails. It never shows someone else's face as "the selfie" behind these results.
 */

export interface GalleryFrame {
  src: string;
  w?: number;
  h?: number;
}

export interface TemplateGalleryLabels {
  prev: string;
  next: string;
  open: string;
  close: string;
  zoomIn: string;
  zoomOut: string;
  transformSet?: string;
  transformImage?: string;
  transformVideo?: string;
  /** "{n}장 중 {i}번째" — each picture's alt and thumbnail name. */
  position: string;
  /** The strip's sentence: "셀카 한 장이면 이 {n}컷이 나와요". */
  lead: string;
  /** "내 셀카". */
  selfie: string;
}

const ZOOM = 2.4;

function useViewerSelfie(): string | null {
  return useSyncExternalStore(subscribeViewerSelfie, viewerSelfieSnapshot, () => null);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ratioOf(frame: GalleryFrame | undefined, fallback: string): string {
  if (frame?.w && frame.h) return `${frame.w} / ${frame.h}`;
  const [w, h] = fallback.split(':');
  return w && h ? `${w} / ${h}` : '3 / 4';
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {direction === 'left' ? <path d="M12.5 4.5 7 10l5.5 5.5" /> : <path d="M7.5 4.5 13 10l-5.5 5.5" />}
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5 11 9M3.5 16.5 9 11" />
    </svg>
  );
}

/** One person, head and shoulders — the empty selfie slot, drawn in the same stroke as the arrows. */
function SelfieOutline() {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 52" className="h-8 w-7 text-black/35" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="20" cy="18" r="8.5" />
      <path d="M5.5 47c1.4-9.3 7.2-14.5 14.5-14.5S33.1 37.7 34.5 47" />
    </svg>
  );
}

/** The first tile of the strip: the reader's selfie, or where it goes. Links to the make card. */
export function SelfieTile({ label, href, className = '' }: { label: string; href?: string | null; className?: string }) {
  const selfie = useViewerSelfie();
  const face = selfie ? (
    // eslint-disable-next-line @next/next/no-img-element -- the owner-only selfie gateway URL
    <img src={selfie} alt="" className="h-full w-full object-cover" />
  ) : (
    <SelfieOutline />
  );
  const tile = (
    <span
      data-selfie-tile={selfie ? 'mine' : 'empty'}
      className={`flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl ${selfie ? 'ring-2 ring-accent ring-offset-2 ring-offset-white' : 'border border-dashed border-black/25 bg-white'} ${className}`}
    >
      {face}
    </span>
  );
  return (
    <figure className="flex w-14 shrink-0 flex-col items-center gap-1.5 sm:w-16">
      {href ? (
        <a href={href} className="block w-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {tile}
        </a>
      ) : (
        <span className="block w-full">{tile}</span>
      )}
      <figcaption className="text-[0.7rem] font-medium whitespace-nowrap text-black/70">{label}</figcaption>
    </figure>
  );
}

export function StripArrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="mb-5 h-5 w-5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M14 6.5 19.5 12 14 17.5" />
    </svg>
  );
}

/** A film's version of the strip: my selfie → the scene I lead. The poster stands for the result. */
export function TransformStrip({ lead, selfieLabel, makeHref, poster, aspect }: { lead: string; selfieLabel: string; makeHref?: string | null; poster: GalleryFrame | null; aspect: string }) {
  return (
    <div data-template-transform className="mt-4 flex flex-col gap-2.5 sm:mt-5">
      <p className="text-sm font-semibold tracking-[-0.01em] text-black/85">{lead}</p>
      <div className="flex items-end gap-2.5">
        <SelfieTile label={selfieLabel} href={makeHref} />
        <StripArrow />
        {poster && (
          <span className="mb-5 block h-[4.67rem] shrink-0 overflow-hidden rounded-xl bg-black sm:h-[5.33rem]" style={{ aspectRatio: ratioOf(poster, aspect) }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader */}
            <img src={poster.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          </span>
        )}
      </div>
    </div>
  );
}

export function TemplateGallery({
  frames,
  initialIndex = 0,
  title,
  aspect,
  labels,
  makeHref,
  setSize,
}: {
  frames: GalleryFrame[];
  initialIndex?: number;
  title: string;
  aspect: string;
  labels: TemplateGalleryLabels;
  /** A set template's frame count — the `data-template-gallery` marker the sweep reads. */
  setSize?: number | null;
  /** `#make` when the template is on sale: the selfie tile is the way in. */
  makeHref?: string | null;
}) {
  const n = frames.length;
  const start = Math.min(Math.max(initialIndex, 0), Math.max(n - 1, 0));
  const [index, setIndex] = useState(start);
  const [viewerIndex, setViewerIndex] = useState(start);
  const [zoom, setZoom] = useState<{ on: boolean; x: number; y: number }>({ on: false, x: 50, y: 50 });
  const trackRef = useRef<HTMLDivElement | null>(null);
  const viewerTrackRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const multi = n > 1;
  const ratio = ratioOf(frames[start], aspect);
  const alt = (i: number) => (multi ? `${title} · ${interpolate(labels.position, { i: String(i + 1), n: String(n) })}` : title);

  // Open on the poster's frame, without an animated jump.
  useEffect(() => {
    const track = trackRef.current;
    if (track && start > 0) track.scrollLeft = start * track.clientWidth;
  }, [start]);

  const scrollTrack = useCallback((track: HTMLDivElement | null, to: number, smooth: boolean) => {
    if (!track) return;
    track.scrollTo({ left: to * track.clientWidth, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
  }, []);

  const goTo = useCallback((to: number) => scrollTrack(trackRef.current, Math.min(Math.max(to, 0), n - 1), true), [n, scrollTrack]);

  const readIndex = (track: HTMLDivElement) => Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))));

  const onTrackKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(index + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(index - 1); }
  };

  const openViewer = (at: number) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    setViewerIndex(at);
    setZoom({ on: false, x: 50, y: 50 });
    if (!dialog.open) dialog.showModal();
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => scrollTrack(viewerTrackRef.current, at, false));
  };

  const closeViewer = () => dialogRef.current?.close();

  // The dialog closes by the button, Esc or the backdrop; every road lands here.
  const onViewerClose = () => {
    document.documentElement.style.overflow = '';
    setZoom({ on: false, x: 50, y: 50 });
    scrollTrack(trackRef.current, viewerIndex, false);
  };

  useEffect(() => () => {
    document.documentElement.style.overflow = '';
  }, []);

  const viewerGo = (to: number) => {
    const next = Math.min(Math.max(to, 0), n - 1);
    setZoom({ on: false, x: 50, y: 50 });
    scrollTrack(viewerTrackRef.current, next, true);
  };

  const onViewerKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); viewerGo(viewerIndex + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); viewerGo(viewerIndex - 1); }
  };

  const originOf = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100)),
    };
  };

  const onZoomPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const onZoomPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!zoom.on) return;
    const drag = dragRef.current;
    if (drag && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
    // A mouse pans by hovering; a finger pans by dragging.
    if (event.pointerType === 'mouse' || drag) setZoom({ on: true, ...originOf(event) });
  };
  const onZoomClick = (event: MouseEvent<HTMLButtonElement>) => {
    const moved = dragRef.current?.moved === true;
    dragRef.current = null;
    if (moved) return;
    setZoom((current) => (current.on ? { on: false, x: 50, y: 50 } : { on: true, ...originOf(event) }));
  };

  if (n === 0) return null;

  return (
    <div data-template-stage="gallery" data-template-gallery={setSize ?? undefined} className="flex flex-col">
      <div className="relative -mx-[var(--spacing-gutter)] sm:mx-0">
        <div
          ref={trackRef}
          role="region"
          aria-roledescription="carousel"
          aria-label={title}
          tabIndex={multi ? 0 : -1}
          onKeyDown={multi ? onTrackKey : undefined}
          onScroll={(event) => setIndex(readIndex(event.currentTarget))}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-black/[0.035] [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent sm:rounded-2xl [&::-webkit-scrollbar]:hidden"
        >
          {frames.map((frame, i) => (
            <div
              key={frame.src}
              data-template-gallery-frame={multi ? i + 1 : undefined}
              aria-hidden={multi && i !== index ? true : undefined}
              className="flex w-full shrink-0 snap-center items-center justify-center lg:h-[min(calc(100svh-9rem),46rem)] lg:p-8"
              style={{ aspectRatio: ratio }}
            >
              <button
                type="button"
                onClick={() => openViewer(i)}
                tabIndex={multi && i !== index ? -1 : 0}
                aria-label={`${labels.open} · ${alt(i)}`}
                className="group relative flex h-full max-h-full w-full cursor-zoom-in items-center justify-center lg:w-auto"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader */}
                <img
                  src={frame.src}
                  alt={alt(i)}
                  {...(frame.w ? { width: frame.w } : {})}
                  {...(frame.h ? { height: frame.h } : {})}
                  loading={i === start ? 'eager' : 'lazy'}
                  fetchPriority={i === start ? 'high' : undefined}
                  decoding="async"
                  className="h-full w-full object-cover transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] lg:w-auto lg:max-w-full lg:rounded-xl lg:object-contain lg:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.45)] lg:group-hover:scale-[1.012]"
                />
              </button>
            </div>
          ))}
        </div>

        {multi && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              aria-label={labels.prev}
              className="absolute top-1/2 left-4 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-[0_6px_18px_-6px_rgba(0,0,0,0.35)] transition-opacity hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex"
            >
              <Chevron direction="left" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={index === n - 1}
              aria-label={labels.next}
              className="absolute top-1/2 right-4 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-[0_6px_18px_-6px_rgba(0,0,0,0.35)] transition-opacity hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex"
            >
              <Chevron direction="right" />
            </button>
          </>
        )}

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 lg:inset-x-5 lg:bottom-5">
          {multi ? (
            <span data-template-gallery-counter className="rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white tabular-nums backdrop-blur-md">
              {index + 1} / {n}
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => openViewer(index)}
            aria-label={labels.open}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-md transition-colors hover:bg-black/85"
          >
            <ExpandIcon />
          </button>
        </div>
      </div>

      {/* My selfie → these results. The thumbnails also drive the stage. */}
      <div data-template-transform className="mt-4 flex flex-col gap-2.5 sm:mt-5">
        <p className="text-sm font-semibold tracking-[-0.01em] text-black/85">{interpolate(labels.lead, { n: String(n) })}</p>
        <div className="-mx-[var(--spacing-gutter)] flex items-end gap-2.5 overflow-x-auto px-[var(--spacing-gutter)] pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <SelfieTile label={labels.selfie} href={makeHref} />
          <StripArrow />
          {frames.map((frame, i) => (
            <button
              key={frame.src}
              type="button"
              onClick={() => (multi ? goTo(i) : openViewer(0))}
              aria-label={alt(i)}
              aria-current={multi && i === index ? 'true' : undefined}
              className={`mb-5 block w-14 shrink-0 overflow-hidden rounded-xl transition-[opacity,box-shadow] duration-300 sm:w-16 ${multi && i === index ? 'opacity-100 ring-2 ring-black ring-offset-2 ring-offset-white' : 'opacity-60 hover:opacity-100'}`}
              style={{ aspectRatio: ratioOf(frame, aspect) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the same public object as the stage */}
              <img src={frame.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-label={title}
        onClose={onViewerClose}
        onKeyDown={onViewerKey}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeViewer();
        }}
        className="m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-hidden bg-black p-0 text-white backdrop:bg-black"
      >
        <div
          ref={viewerTrackRef}
          onScroll={(event) => {
            const next = readIndex(event.currentTarget);
            if (next !== viewerIndex) {
              setViewerIndex(next);
              setZoom({ on: false, x: 50, y: 50 });
            }
          }}
          className={`flex h-full snap-x snap-mandatory overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${zoom.on ? 'overflow-hidden' : 'overflow-x-auto'}`}
        >
          {frames.map((frame, i) => (
            <div key={frame.src} className="flex h-full w-screen shrink-0 snap-center items-center justify-center overflow-hidden px-3 pt-16 pb-10 sm:px-20">
              <button
                type="button"
                aria-label={zoom.on && i === viewerIndex ? labels.zoomOut : labels.zoomIn}
                onPointerDown={onZoomPointerDown}
                onPointerMove={i === viewerIndex ? onZoomPointerMove : undefined}
                onClick={onZoomClick}
                className={`flex h-full w-full items-center justify-center ${zoom.on && i === viewerIndex ? 'cursor-zoom-out touch-none' : 'cursor-zoom-in'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader */}
                <img
                  src={frame.src}
                  alt={alt(i)}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  style={
                    i === viewerIndex
                      ? { transform: `scale(${zoom.on ? ZOOM : 1})`, transformOrigin: `${zoom.x}% ${zoom.y}%` }
                      : undefined
                  }
                  className="max-h-full max-w-full rounded-lg object-contain transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none motion-reduce:transition-none"
                />
              </button>
            </div>
          ))}
        </div>

        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 sm:px-6">
          <span className="text-sm font-medium text-white/85 tabular-nums">{multi ? `${viewerIndex + 1} / ${n}` : ''}</span>
          <button
            type="button"
            onClick={closeViewer}
            aria-label={labels.close}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>

        {multi && (
          <>
            <button
              type="button"
              onClick={() => viewerGo(viewerIndex - 1)}
              disabled={viewerIndex === 0}
              aria-label={labels.prev}
              className="absolute top-1/2 left-4 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-[background-color,opacity] hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0 sm:flex"
            >
              <Chevron direction="left" />
            </button>
            <button
              type="button"
              onClick={() => viewerGo(viewerIndex + 1)}
              disabled={viewerIndex === n - 1}
              aria-label={labels.next}
              className="absolute top-1/2 right-4 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-[background-color,opacity] hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0 sm:flex"
            >
              <Chevron direction="right" />
            </button>
          </>
        )}
      </dialog>
    </div>
  );
}
