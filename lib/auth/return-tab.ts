import { tabFromHash } from '@/components/brand-workspace/project-tabs';
import { normalizeReturnPath } from './return-path';

const BASE = 'https://return-tab.invalid';
const CAMPAIGN_PAGE = /^\/brand\/projects\/[^/]+$/;

/**
 * A fragment never reaches the server, so the redirect to the sign-in door cannot put a campaign link's
 * `#shortlist` into `next`, and the OAuth round trip would land on the campaign's first tab. The door's
 * page reads the fragment and asks this for each link. Only a plain tab name on a campaign page rides
 * along; anything with a value (an invitation's `#token=`) stays out of return paths.
 */
export function withReturnTab(href: string, hash: string): string {
  if (hash.includes('=') || tabFromHash(hash) === null) return href;
  const url = new URL(href, BASE);
  const next = normalizeReturnPath(url.searchParams.get('next'));
  if (next === null) return href;
  const target = new URL(next, BASE);
  if (target.hash || !CAMPAIGN_PAGE.test(target.pathname)) return href;
  url.searchParams.set('next', `${next}${hash}`);
  return `${url.pathname}${url.search}`;
}
