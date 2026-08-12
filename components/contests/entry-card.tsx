import type { ContestEntryView } from '@/lib/contests/access';
import { posterHash } from '@/components/ui/poster-seed';
import { placementLabel, platformLabel, type ContestLabels } from './labels';

/**
 * PLAN §14.2 — the approved-entry card: "title + @sns platform chip linking to sns_url + video_url
 * link — card design consistent with prompt cards; typographic poster treatment since entries have
 * no media".
 *
 * An entry has no bytes on this site at all (§14.1 makes films LINKS), so there is nothing to put
 * in the media slot and a grey rectangle would be worse than none. The card is therefore set
 * entirely in type — the title at display scale on the same black field the typographic posters
 * use, with the rule and the accent tick placed by the same slug hash. It reads as a poster for the
 * film rather than as a row in a table.
 *
 * Two links, and they are deliberately different weights: the FILM is the reason the card exists
 * (primary, full-width, accent), the SNS is the credit (a chip). Both carry `rel="noreferrer"` and
 * both are external by construction — the URLs were validated as http(s) at submission
 * (`lib/contests/schemas.ts`) and are re-validated nowhere else, because this component cannot know
 * better than the gate did.
 */
export function ContestEntryCard({
  entry,
  labels,
}: {
  entry: ContestEntryView;
  labels: ContestLabels;
}) {
  const seed = posterHash(entry.id);
  const placed = entry.placement !== null;

  return (
    <article
      data-entry-card={entry.id}
      {...(placed ? { 'data-placement': String(entry.placement) } : {})}
      className="card group relative flex h-full flex-col border border-hairline"
    >
      <div
        className="card__media relative flex min-h-[11rem] flex-col justify-between overflow-hidden bg-black p-5 text-white"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-line-dark"
          style={{ left: `${30 + (seed % 22)}%` }}
        />

        <div className="relative flex items-start justify-between gap-3">
          <span className="font-label text-[0.65rem] tracking-[0.14em] uppercase opacity-70">
            {platformLabel(labels, entry.platform)}
          </span>
          {placed ? (
            <span
              data-winner-badge
              className="bg-accent px-2 py-1 font-display text-[0.9rem] leading-none font-black tracking-tight uppercase"
            >
              {placementLabel(labels, entry.placement!)}
            </span>
          ) : (
            <span aria-hidden className="bg-accent mt-1 block h-2 w-2 shrink-0" />
          )}
        </div>

        <h3 className="relative mt-6 font-display text-[clamp(1.3rem,2.6vw,1.9rem)] leading-[0.92] font-black tracking-tight uppercase">
          <a
            href={entry.videoUrl}
            rel="noreferrer"
            className="after:absolute after:inset-0 after:content-['']"
          >
            {entry.title}
          </a>
        </h3>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {entry.note && <p className="text-[0.9rem] leading-relaxed opacity-70">{entry.note}</p>}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-hairline pt-3">
          {/* The credit. Above the stretched link on the z-axis so it is independently clickable. */}
          <a
            href={entry.snsUrl}
            rel="noreferrer"
            data-entry-sns={entry.platform}
            className="relative z-10 border border-hairline px-2.5 py-1 font-label text-[0.65rem] tracking-[0.12em] uppercase hover:border-accent hover:text-accent"
          >
            {entry.handle ?? platformLabel(labels, entry.platform)}
          </a>
          <span className="text-accent font-label text-[0.65rem] tracking-[0.12em] uppercase">
            {labels.watchLabel} →
          </span>
        </div>
      </div>
    </article>
  );
}
