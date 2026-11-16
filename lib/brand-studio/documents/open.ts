/**
 * Who may open a studio document, and where its bytes are (app/api/brand-studio/documents/[id]).
 *
 * Order, as everywhere in the studio (lib/brand-studio/access.ts): membership, then the Morphic and
 * sandbox hardline and the feature policy, then the role. Guests (project-only access) never open a
 * brand's documents. Anything that does not hold answers null, which the route turns into a plain 404.
 * Documents are readable while they exist even if the flag was turned off since, so a team can still
 * open what it uploaded.
 */
import type { Viewer } from '@/lib/auth/identity';
import { studioSeat } from '../access';
import type { StudioDeps } from '../types';
import { isDocumentKey } from './index';

export interface OpenedDocument {
  key: string;
  mime: string;
  name: string;
  sizeBytes: number;
}

export async function openStudioDocument(
  deps: Pick<StudioDeps, 'sql'>,
  viewer: Viewer,
  organizationId: string,
  assetId: string,
): Promise<OpenedDocument | null> {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  try {
    const seat = await studioSeat(deps.sql, viewer.userId, organizationId);
    if (seat.role === 'guest') return null;
    const row = (
      await deps.sql.query<{ storage_key: string; mime: string; name: string; size_bytes: string | number }>(
        "select storage_key, mime, name, size_bytes from brand_studio_assets where id = $1 and organization_id = $2 and kind = 'document' and status = 'ready' and deleted_at is null",
        [assetId, organizationId],
      )
    ).rows[0];
    if (!row || !isDocumentKey(row.storage_key)) return null;
    return { key: row.storage_key, mime: row.mime, name: row.name, sizeBytes: Number(row.size_bytes) };
  } catch {
    return null;
  }
}
