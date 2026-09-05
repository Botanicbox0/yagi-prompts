import type { CampaignCard } from '@/lib/campaigns/catalog';
import { payoutHeadline } from '@/lib/campaigns/copy';
import { campaignHref } from '@/lib/campaigns/links';
import { formatDate, interpolate, localize } from '@/lib/i18n/format';
import type { PromptCard } from '@/lib/prompts/catalog';
import { TypographicPoster } from '@/components/prompts/poster';
import { posterRatio } from '@/components/ui/poster-seed';
import type { CampaignLabels } from './labels';

/**
 * A campaign on the listing (docs/CAMPAIGNS.md §6). The contest card's shape — poster-led, chips
 * on the poster, a stretched link — because a reader moving between the two tabs should not feel
 * they changed sites. What differs is what it SAYS: a contest names a prize and a clock; a campaign
 * names a fee, the slots left and the day applications close.
 *
 * The poster is the style's (the prompt catalog's card for `styleSlug`), joined by the page: the
 * format IS the image.
 */
export function CampaignCardView({
  card,
  style,
  locale,
  labels,
  now,
}: {
  card: CampaignCard;
  style: PromptCard | null;
  locale: string;
  labels: CampaignLabels;
  now: Date | number;
}) {
  const title = localize(card.title, locale);
  const summary = localize(card.summary, locale);
  const ratio = style?.poster?.w && style.poster.h ? `${style.poster.w} / ${style.poster.h}` : posterRatio(card.slug);
  const recruiting = card.status === 'recruiting';
  const closesIn = card.applicationsCloseAt ? Math.ceil((Date.parse(card.applicationsCloseAt) - new Date(now).getTime()) / 86_400_000) : null;
  const dDay = recruiting && closesIn !== null && closesIn >= 0 ? (closesIn === 0 ? 'D-DAY' : `D-${closesIn}`) : null;
  const slotsLeft = Math.max(0, card.slots - card.slotsTaken);

  return (
    <article
      data-campaign-card={card.slug}
      data-status={card.status}
      className="card group relative flex h-full flex-col border border-hairline"
    >
      <div className="relative border-b border-hairline">
        <div className="card__media overflow-hidden" style={{ aspectRatio: ratio }}>
          {style?.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- public bucket object, no loader
            <img src={style.poster.src} alt={title} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <TypographicPoster title={title} slug={card.slug} kicker={card.hostName} ratio={ratio} />
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span
            data-status-chip={card.status}
            className={[
              'px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] uppercase',
              recruiting ? 'bg-blue text-white' : 'bg-black/70 text-white opacity-80',
            ].join(' ')}
          >
            {labels.status[card.status]}
          </span>
          {dDay && (
            <span
              data-dday
              className="border border-white/35 bg-black/70 px-2 py-1 font-mono text-[0.75rem] leading-none tracking-[0.08em] text-white"
            >
              {dDay}
            </span>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
          <span className="border border-white/35 bg-black/70 px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] text-white uppercase">
            {card.hostName}
          </span>
          <span className="border border-white/25 px-2 py-1 font-label text-[0.75rem] leading-none tracking-[0.12em] text-white/75 uppercase">
            {labels.hostKind[card.hostKind]}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* The money first — it is the question every creator asks first. */}
        <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span data-card-payout className="font-display text-[1.6rem] leading-none font-black">
            {card.payout ? payoutHeadline(card.payout, locale, labels.payout) : '—'}
          </span>
          <span className="font-label text-[0.7rem] tracking-[0.12em] uppercase opacity-55">
            {card.platforms.map((p) => labels.platform[p]).join(' · ')} · {labels.deliverable[card.deliverable]}
          </span>
        </p>
        <h3 className="font-display text-[1.15rem] leading-[1.05] font-black uppercase">
          <a href={campaignHref(locale, card.slug)} className="after:absolute after:inset-0 after:content-['']">
            {title}
          </a>
        </h3>
        <p className="text-[0.9rem] leading-snug opacity-70">{summary}</p>
        <p className="mt-auto flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-[0.72rem] opacity-55">
          <span data-card-slots>{interpolate(labels.slotsLine, { left: String(slotsLeft), slots: String(card.slots) })}</span>
          {card.applicationsCloseAt && recruiting && (
            <span>{interpolate(labels.applyBy, { date: formatDate(card.applicationsCloseAt, locale) ?? '' })}</span>
          )}
        </p>
      </div>
    </article>
  );
}
