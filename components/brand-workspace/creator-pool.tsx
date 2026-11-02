import type { BrandCopy } from "./action-form";
import { PLATFORM_NAMES } from "./campaign-terms-summary";
import { formatBrandTimestamp } from "./format";
import { CreatorInvite, type InviteCampaign } from "./creator-invite";
import { compactFollowers, POOL_BANDS, POOL_LIMIT, POOL_PATH, type CreatorPool, type PoolQuery } from "@/lib/brands/creator-pool";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/influencers/rules";
import { interpolate, localize } from "@/lib/i18n/format";

/** A plain glyph per platform: no work is public yet, so the card shows where the creator posts. */
function PlatformGlyph({ platform }: { platform: SocialPlatform }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {platform === "instagram" && <><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.6" /><circle cx="16.8" cy="7.2" r=".6" /></>}
      {platform === "tiktok" && <path d="M13.5 4v10.6a3.4 3.4 0 1 1-3.4-3.4M13.5 4c.5 2.4 2.2 3.9 4.8 4" />}
      {platform === "youtube" && <><rect x="3" y="6" width="18" height="12" rx="4" /><path d="M10.5 9.6v4.8l4-2.4z" /></>}
    </svg>
  );
}

/**
 * The creator pool (docs/PLATFORM-2.0.md §16.5, §17.3). Cards carry what the creator agreed to
 * show — handle, platform, a band rounded to 1,000, the last check — and one action. The handle is
 * not a link: the brand meets the creator through the campaign, not their profile.
 */
export function CreatorPoolView({ pool, query, b, locale, organizationId }: {
  pool: CreatorPool;
  query: PoolQuery;
  b: BrandCopy;
  locale: string;
  organizationId: string;
}) {
  const t = b.creatorPool;
  const heading = (
    <div className="bw-heading">
      <div>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
      </div>
    </div>
  );
  if (pool.state !== "open")
    return (
      <div data-creator-pool={pool.state}>
        {heading}
        <p className="bw-note" role={pool.state === "unavailable" ? "alert" : undefined}>{t[pool.state]}</p>
      </div>
    );
  const filtered = Boolean(query.q || query.platform || query.band);
  const campaigns: InviteCampaign[] = pool.campaigns.map((c) => ({
    id: c.id,
    title: localize(c.title, locale),
    meta: interpolate(t.campaignMeta, { date: formatBrandTimestamp(c.closesAt, locale) ?? "", invited: String(c.invited), cap: String(c.cap) }),
    full: c.invited >= c.cap,
  }));
  const inviting = pool.canInvite && campaigns.length > 0;
  return (
    <div data-creator-pool="open">
      {heading}
      <form method="get" action={POOL_PATH} className="bw-creator-filters" data-creator-filters>
        <input type="hidden" name="organizationId" value={organizationId} />
        <label className="bw-search">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3zM13.5 13.5 17 17" /></svg>
          <span className="sr-only">{t.search}</span>
          <input type="search" name="q" defaultValue={query.q} placeholder={t.searchPlaceholder} maxLength={30} autoComplete="off" spellCheck={false} />
        </label>
        <label>
          <span>{t.platform}</span>
          <select name="platform" defaultValue={query.platform ?? ""}>
            <option value="">{t.all}</option>
            {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_NAMES[p]}</option>)}
          </select>
        </label>
        <label>
          <span>{t.band}</span>
          <select name="band" defaultValue={query.band ?? ""}>
            <option value="">{t.all}</option>
            {POOL_BANDS.map((band) => <option key={band} value={band}>{t.bands[band]}</option>)}
          </select>
        </label>
        <button type="submit" className="bw-button">{t.apply}</button>
        {filtered && <a className="bw-creator-reset" href={`${POOL_PATH}?organizationId=${encodeURIComponent(organizationId)}`}>{t.reset}</a>}
      </form>
      {!pool.canInvite ? (
        <p className="bw-note" data-creator-invite-closed>{t.inviteClosed}</p>
      ) : !campaigns.length ? (
        <p className="bw-note" data-creator-no-campaign>{t.noCampaign}</p>
      ) : null}
      <p className="bw-muted bw-creator-count" role="status">
        {interpolate(t.count, { count: pool.cards.length.toLocaleString(locale) })}
        {pool.truncated && <> · {interpolate(t.truncated, { count: String(POOL_LIMIT) })}</>}
      </p>
      {pool.cards.length ? (
        <ul className="bw-campaign-grid bw-creator-grid">
          {pool.cards.map((card) => (
            <li key={card.id} data-creator-card={card.platform}>
              <article className="bw-campaign-card bw-creator-card">
                <div className="bw-cover bw-creator-art" data-creator-platform={card.platform}>
                  <PlatformGlyph platform={card.platform} />
                </div>
                <div className="bw-card-copy">
                  <p>{PLATFORM_NAMES[card.platform]}</p>
                  <h2 translate="no">@{card.handle}</h2>
                  <span>{interpolate(t.followers, { band: compactFollowers(card.followers, locale) })}</span>
                  {card.invitedTo.length > 0 && <span className="bw-badge" data-creator-invited>{interpolate(t.invitedCount, { count: String(card.invitedTo.length) })}</span>}
                  <footer>
                    <small className="bw-creator-checked"><time dateTime={card.checkedOn}>{interpolate(t.checked, { date: card.checkedOn })}</time></small>
                    {inviting && <CreatorInvite card={{ id: card.id, handle: card.handle, invitedTo: card.invitedTo }} campaigns={campaigns} copy={t} />}
                  </footer>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bw-board-empty" data-creator-empty>{filtered ? t.empty : t.emptyPool}</p>
      )}
    </div>
  );
}
