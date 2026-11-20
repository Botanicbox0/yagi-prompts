/**
 * Server reads for the sound studio page (docs/BRAND-SOUND-STUDIO.md §7.3). Callers pass an organization
 * the studio guard already seated and the `sound` group already allowed; every query is scoped to it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioMediaStore } from '../media-store';
import { assetView, assetsOf } from '../repo';
import { soundTracks, type SoundTrackView } from './library';

export async function loadSoundTracks(
  sql: SqlRunner,
  media: StudioMediaStore,
  organizationId: string,
  userId: string | null,
): Promise<SoundTrackView[]> {
  const [assets, likes] = await Promise.all([
    assetsOf(sql, organizationId, 600),
    userId
      ? sql.query<{ asset_id: string }>(
          'select asset_id from brand_studio_likes where organization_id = $1 and user_id = $2 and asset_id is not null',
          [organizationId, userId],
        )
      : Promise.resolve({ rows: [] as Array<{ asset_id: string }> }),
  ]);
  const audio = assets.filter((row) => row.kind === 'audio').map((row) => assetView(row, media));
  return soundTracks(
    organizationId,
    audio,
    likes.rows.map((row) => `a:${row.asset_id}`),
  );
}
