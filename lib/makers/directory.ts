import type { PublicMaker } from '@/lib/prompts/catalog';

/**
 * Orders public AI creative profiles for the directory and blog feed strip:
 * most published templates first, then newest published template, then post count, then handle.
 */
export function sortDirectoryMakers(
  makers: readonly PublicMaker[],
  postCounts: Readonly<Record<string, number>> = {},
): PublicMaker[] {
  return [...makers].sort((a, b) => {
    if (b.templateCount !== a.templateCount) return b.templateCount - a.templateCount;
    const aDate = a.latestPublishedAt ? Date.parse(a.latestPublishedAt) : NaN;
    const bDate = b.latestPublishedAt ? Date.parse(b.latestPublishedAt) : NaN;
    const aMs = Number.isFinite(aDate) ? aDate : -Infinity;
    const bMs = Number.isFinite(bDate) ? bDate : -Infinity;
    if (bMs !== aMs) return bMs - aMs;
    const aPosts = postCounts[a.handle] ?? 0;
    const bPosts = postCounts[b.handle] ?? 0;
    if (bPosts !== aPosts) return bPosts - aPosts;
    return a.handle.localeCompare(b.handle);
  });
}
