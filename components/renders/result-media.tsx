/**
 * The finished object, framed at its own aspect so the page does not jump when it loads. A film
 * plays muted and looped like the template's example does; an image sits on black at its full
 * size. Both take the gateway URL (`/api/renders/media/{id}…`), which redirects or streams.
 *
 * docs/PLATFORM-2.0.md §3.2-5 — the result comes first, and a portrait film should be seen whole
 * without scrolling: the width is derived from the screen height (`100svh` minus
 * `--result-chrome`, which the page sets to what sits above and below the object), capped at the
 * column — or at `--result-cap` where the page lays the object out beside its actions and a
 * percentage would have nothing definite to resolve against. A wide object simply takes the cap.
 */
export const DEFAULT_CHROME = '12rem';

export function ratioOf(aspect: string): { css: string; w: number; h: number } {
  const match = /^(\d+):(\d+)$/.exec(aspect);
  const w = match ? Number(match[1]) : 4;
  const h = match ? Number(match[2]) : 5;
  return { css: `${w} / ${h}`, w, h };
}

export function ResultMedia({ src, mime, aspect, poster, alt = '' }: { src: string; mime: string; aspect: string; poster?: string | null; alt?: string }) {
  const ratio = ratioOf(aspect);
  const style = {
    aspectRatio: ratio.css,
    width: `min(var(--result-cap, 100%), calc((100svh - var(--result-chrome, ${DEFAULT_CHROME})) * ${ratio.w} / ${ratio.h}))`,
  };
  if (mime.startsWith('video/')) {
    return (
      <video
        src={src}
        {...(poster ? { poster } : {})}
        controls
        autoPlay
        muted
        loop
        playsInline
        data-result-media="video"
        style={style}
        className="block bg-black object-contain"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a gateway URL, never a static import
    <img src={src} alt={alt} data-result-media="image" style={style} className="block bg-black object-contain" />
  );
}
