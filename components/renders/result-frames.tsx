import { interpolate } from '@/lib/i18n/format';
import type { RenderFrame } from '@/lib/renders/frames';
import { DEFAULT_CHROME, ratioOf } from './result-media';

/**
 * A set's pictures, in the order they were made, as one horizontal strip (lib/renders/frames.ts).
 * Each picture is sized like a single result (`ResultMedia`'s rule: the screen height minus
 * `--result-chrome`) but never wider than most of the strip, so the next picture shows at the edge
 * and says "there is more" without a word. Plain CSS scroll-snap, no script; every picture carries
 * its own save link, which works before (and without) the "save all" button.
 */
export interface ResultFramesLabels {
  /** "{i} of {n}" — the picture's alt suffix. */
  position: string;
  /** "Save photo {i}" — the save link's name for a screen reader. */
  saveOne: string;
  /** "Swipe to see all {n}." */
  hint: string;
}

export function ResultFrames({ frames, aspect, alt, labels }: { frames: RenderFrame[]; aspect: string; alt: string; labels: ResultFramesLabels }) {
  const ratio = ratioOf(aspect);
  const n = frames.length;
  const width = `min(84%, calc((100svh - var(--result-chrome, ${DEFAULT_CHROME})) * ${ratio.w} / ${ratio.h}))`;
  return (
    <div>
      <ol data-result-frames={n} className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-2">
        {frames.map((frame) => (
          <li key={frame.frame} data-result-frame={frame.frame} className="relative shrink-0 snap-start" style={{ width }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a gateway URL, never a static import */}
            <img
              src={frame.view}
              alt={`${alt} · ${interpolate(labels.position, { i: frame.frame, n })}`}
              loading={frame.frame <= 3 ? 'eager' : 'lazy'}
              style={{ aspectRatio: ratio.css }}
              className="block w-full bg-black object-contain"
            />
            <a
              href={frame.download}
              download={frame.filename}
              aria-label={interpolate(labels.saveOne, { i: frame.frame })}
              data-frame-download={frame.frame}
              className="absolute right-2 bottom-2 inline-flex min-h-9 items-center rounded-full bg-black/75 px-3 font-mono text-[0.72rem] text-white"
            >
              {frame.frame}/{n} ↓
            </a>
          </li>
        ))}
      </ol>
      <p className="mt-1 font-mono text-[0.72rem] text-black/70">{interpolate(labels.hint, { n })}</p>
    </div>
  );
}
