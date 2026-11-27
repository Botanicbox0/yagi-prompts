/**
 * Client-safe organization and seat eligibility for Campaign Ops C1.
 * Shared between the server gate (`campaignOpsOpenForViewer`) and client navigation/bell guards.
 */
import { roomsOpenFor, type RoomEntryOrg } from '@/components/brand-rooms/room/visibility';
import { featureDenied, isSandboxedClientOrganization } from '../features';

export function campaignOpsEligible(org: RoomEntryOrg | null | undefined): boolean {
  if (!org?.id) return false;
  if (isSandboxedClientOrganization(org)) return false;
  if (featureDenied(org.denied, 'generative_media')) return false;
  if (!roomsOpenFor(org, true)) return false;
  return org.role !== 'guest';
}
