import { normalizeReturnPath } from '@/lib/auth/return-path';

/** Navigation only: accept the current surface's list and never switch the project's brand. */
export function campaignListReturnPath(raw: unknown, organizationId: string, studio = false): string {
  const path = studio ? '/admin/brand-workspace' : '/brand';
  const fallback = studio ? path : `${path}?${new URLSearchParams({ organizationId })}`;
  const safe = normalizeReturnPath(raw);
  if (!safe) return fallback;
  const url = new URL(safe, 'https://navigation.invalid');
  if (url.pathname !== path) return fallback;
  const organizations = url.searchParams.getAll('organizationId');
  if (organizations.length > 1 || (organizations.length === 1 && organizations[0] !== organizationId)) return fallback;
  if (!studio) url.searchParams.set('organizationId', organizationId);
  return `${url.pathname}${url.search}${url.hash}`;
}
