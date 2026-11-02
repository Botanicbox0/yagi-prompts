import { posterObjectPosition, type PosterFocus } from '@/lib/prompts/poster-focus';

/**
 * Staff report (2026-11-02): a mix of 16:9 and 9:16 cards made the admin wall uneven. Every poster now
 * fills the same 1:1 frame, at the position chosen in the editor's crop panel.
 */
export function AdminPosterFrame({ src, focus }: { src: string; focus?: PosterFocus | undefined }) {
  return (
    <div data-poster-frame="square" className="aspect-square overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- staging object behind the gate */}
      <img src={src} alt="" className="h-full w-full object-cover" style={{ objectPosition: posterObjectPosition(focus) }} />
    </div>
  );
}
