/**
 * The finished object, framed at its own aspect so the page does not jump when it loads. A film
 * plays muted and looped like the template's example does; an image sits on black at its full
 * size. Both take the gateway URL (`/api/renders/media/{id}…`), which redirects or streams.
 */
export function ResultMedia({ src, mime, aspect, poster }: { src: string; mime: string; aspect: string; poster?: string | null }) {
  const ratio = /^\d+:\d+$/.test(aspect) ? aspect.replace(':', ' / ') : '4 / 5';
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
        style={{ aspectRatio: ratio }}
        className="w-full bg-black object-contain"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a gateway URL, never a static import
    <img src={src} alt="" data-result-media="image" style={{ aspectRatio: ratio }} className="w-full bg-black object-contain" />
  );
}
