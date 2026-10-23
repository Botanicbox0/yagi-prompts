import { brandContext } from "@/components/brand-workspace/context";
import { brandScope } from "@/components/brand-workspace/scope";
import { BrandUnavailable } from "@/components/brand-workspace/brand-unavailable";
import { CreatorPoolView } from "@/components/brand-workspace/creator-pool";
import { loadCreatorPool, parsePoolQuery, type CreatorPool } from "@/lib/brands/creator-pool";
import { influencersOpen } from "@/lib/influencers/rules";
import { poolVisible } from "@/lib/brands/workspace/selection";

/**
 * The creator pool (docs/PLATFORM-2.0.md §16.5, §17.3) for the selected brand. Owners and editors
 * only; "being prepared" while TWINGS_INFLUENCERS is off. Filters are a plain GET form, so a link
 * to a filtered pool opens the same pool.
 */
export default async function CreatorPoolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [search, { sql, viewer, verifiedEmail, b, locale }] = await Promise.all([searchParams, brandContext()]);
  if (!sql) return <p role="alert">{b.unavailable}</p>;
  const query = parsePoolQuery(search);
  if (!influencersOpen()) return <CreatorPoolView pool={{ state: "closed" }} query={query} b={b} locale={locale} organizationId="" />;
  const { selection, choice } = await brandScope({ sql, verifiedEmail }, viewer, search.organizationId);
  if (selection.state === "unavailable") return <BrandUnavailable b={b} />;
  if (!choice) return <p className="bw-note" data-creator-pool="none">{b.creatorPool.noBrand}</p>;
  const pool: CreatorPool = poolVisible(choice)
    ? await loadCreatorPool({ sql }, viewer, choice.id, query)
    : { state: "forbidden" };
  return <CreatorPoolView pool={pool} query={query} b={b} locale={locale} organizationId={choice.id} />;
}
