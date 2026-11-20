/**
 * Server reads for the sound studio page (docs/BRAND-SOUND-STUDIO.md §7.3). Callers pass an organization
 * the studio guard already seated and the `sound` group already allowed; every query is scoped to it.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioMediaStore } from '../media-store';
import type { StudioAllowanceView, StudioJobView } from '../contracts';
import type { StudioEnv } from '../env';
import { assetView, assetsOf, viewsOf } from '../repo';
import type { JobRow } from '../types';
import { allowanceView, loadAllowance } from '../usage';
import { mergeTracks, musicTracks, soundTracks, type SoundTrackView } from './library';

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

/** Music runs of this organization, newest first (open, finished and recently failed ones), as job views. */
export async function loadMusicJobs(sql: SqlRunner, media: StudioMediaStore, organizationId: string, limit = 60): Promise<StudioJobView[]> {
  const rows = (
    await sql.query<JobRow>(
      `select * from brand_studio_jobs
        where organization_id = $1 and kind = 'music'
          and (status <> 'failed' or created_at > now() - interval '1 day')
        order by created_at desc, id limit $2`,
      [organizationId, limit],
    )
  ).rows;
  return viewsOf(sql, rows, media);
}

export interface SoundStudioData {
  tracks: SoundTrackView[];
  jobs: StudioJobView[];
  allowance: StudioAllowanceView;
}

/** Everything the page renders first: the list (made versions and files), the runs still going, the credits. */
export async function loadSoundStudio(
  sql: SqlRunner,
  media: StudioMediaStore,
  env: StudioEnv,
  organizationId: string,
  userId: string | null,
): Promise<SoundStudioData> {
  const [files, jobs, allowance, likes] = await Promise.all([
    loadSoundTracks(sql, media, organizationId, userId),
    loadMusicJobs(sql, media, organizationId),
    loadAllowance(sql, organizationId, env),
    userId
      ? sql.query<{ output_id: string }>(
          'select output_id from brand_studio_likes where organization_id = $1 and user_id = $2 and output_id is not null',
          [organizationId, userId],
        )
      : Promise.resolve({ rows: [] as Array<{ output_id: string }> }),
  ]);
  const made = musicTracks(organizationId, jobs, likes.rows.map((row) => `o:${row.output_id}`));
  return { tracks: mergeTracks(made, files), jobs, allowance: allowanceView(allowance) };
}
