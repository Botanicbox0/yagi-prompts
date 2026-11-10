/**
 * Who gets a way into a project room (docs/BRAND-ROOMS.md §2, §9): the "룸 열기" entries on the campaign
 * list and the project page ask this. Client-safe (no env, no db): the server reads `brandRoomsOpen()`
 * and passes it in as `flagOn`.
 *
 * A sandboxed client (by id or by name) and a brand whose policy closes generative media never get an
 * entry, whatever the flag says; neither does the TWINGS team view (role `studio`), which follows rooms
 * from its own console. Presentation only: the room page and its APIs authorize on their own.
 */
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { scopedHref } from '@/lib/brands/workspace/selection';

export interface RoomEntryOrg {
  id?: string | null;
  name?: string | null;
  denied?: readonly string[] | null;
  role?: string | null;
}

export function roomsOpenFor(org: RoomEntryOrg | null | undefined, flagOn: boolean): boolean {
  if (!flagOn || !org) return false;
  if (isSandboxedClientOrganization(org)) return false;
  if (featureDenied(org.denied, 'generative_media')) return false;
  return org.role !== 'studio';
}

/** `/brand/rooms/<project>?organizationId=<brand>[&tab=…]`, keeping the brand like every workspace link. */
export function roomHref(projectId: string, organizationId: string, tab?: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  if (tab && tab !== 'overview') params.set('tab', tab);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  const scoped = scopedHref(`/brand/rooms/${encodeURIComponent(projectId)}`, { id: organizationId });
  return query ? `${scoped}&${query}` : scoped;
}
