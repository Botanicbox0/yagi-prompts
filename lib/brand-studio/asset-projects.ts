/**
 * Which library files and studio results belong to which piece of work, for the assets page's
 * by-project view. Read only, derived from links that already exist (no column of its own):
 *
 *   - a video project the team made themselves (`brand_studio_video_projects`): every asset and result
 *     its timeline uses (clips, takes, music, colour reference, reference files);
 *   - a project done with the YAGI team (`brand_projects`): the files reviewed in its room
 *     (`brand_studio_reviews.project_id`). Its campaign deliverables (`brand_content_versions`) reach the
 *     page through the workspace loader, which already scopes them.
 *
 * Two queries after the seat check, whatever the number of projects. The lists hold ids only: the page
 * intersects them with what the studio state already shows, so a deleted run, a deleted file or an
 * internal fill run can never surface through a project.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioSeat } from './access';
import type { StudioFailure } from './contracts';
import { guarded } from './outcome';
import { collectMediaRefs, normalizeStoredTimeline } from './video-projects/service';

export interface AssetProjectLink {
  id: string;
  title: string;
  /** ISO time of the project's last change, for ordering. */
  updatedAt: string;
  assetIds: string[];
  outputIds: string[];
}

export interface AssetProjectLinks {
  ok: true;
  /** Video projects made in the studio, newest first. */
  self: AssetProjectLink[];
  /** Projects done with the YAGI team that have reviewed files, newest first. */
  team: AssetProjectLink[];
}

export const EMPTY_ASSET_PROJECT_LINKS: AssetProjectLinks = { ok: true, self: [], team: [] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELF_LIMIT = 100;
const TEAM_ROW_LIMIT = 2000;

const iso = (value: Date | string | null | undefined): string => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : new Date(0).toISOString());
const missingTable = (error: unknown): boolean => (error as { code?: string } | null)?.code === '42P01';

interface SelfRow {
  id: string;
  title: string;
  aspect: string;
  timeline: unknown;
  updated_at: Date | string;
}

interface TeamRow {
  project_id: string;
  title: string;
  project_updated_at: Date | string;
  asset_id: string | null;
  output_id: string | null;
}

async function selfProjects(sql: SqlRunner, organizationId: string): Promise<AssetProjectLink[]> {
  let rows: SelfRow[];
  try {
    rows = (
      await sql.query<SelfRow>(
        `select id, title, aspect, timeline, updated_at
           from brand_studio_video_projects
          where organization_id = $1 and deleted_at is null and status in ('active', 'completed')
          order by updated_at desc, id desc
          limit ${SELF_LIMIT}`,
        [organizationId],
      )
    ).rows;
  } catch (error) {
    // The table arrives with migration 0087; before it there is simply nothing to group by.
    if (missingTable(error)) return [];
    throw error;
  }
  return rows.map((row) => {
    const timeline = normalizeStoredTimeline(row.timeline, row.aspect as Parameters<typeof normalizeStoredTimeline>[1]);
    const refs = collectMediaRefs([timeline]);
    const assetIds = new Set(refs.assetIds);
    for (const id of timeline.referenceAssetIds ?? []) if (UUID.test(id)) assetIds.add(id);
    return { id: row.id, title: row.title, updatedAt: iso(row.updated_at), assetIds: [...assetIds], outputIds: refs.outputIds };
  });
}

async function teamProjects(sql: SqlRunner, organizationId: string): Promise<AssetProjectLink[]> {
  let rows: TeamRow[];
  try {
    rows = (
      await sql.query<TeamRow>(
        `select r.project_id, p.title, p.updated_at as project_updated_at, r.asset_id, r.output_id
           from brand_studio_reviews r
           join brand_projects p on p.id = r.project_id and p.organization_id = r.organization_id
          where r.organization_id = $1 and r.project_id is not null and r.deleted_at is null and p.client_visible
          order by p.updated_at desc, p.id, r.created_at desc
          limit ${TEAM_ROW_LIMIT}`,
        [organizationId],
      )
    ).rows;
  } catch (error) {
    if (missingTable(error) || (error as { code?: string } | null)?.code === '42703') return [];
    throw error;
  }
  const byProject = new Map<string, AssetProjectLink & { assets: Set<string>; outputs: Set<string> }>();
  for (const row of rows) {
    let link = byProject.get(row.project_id);
    if (!link) {
      link = { id: row.project_id, title: row.title, updatedAt: iso(row.project_updated_at), assetIds: [], outputIds: [], assets: new Set(), outputs: new Set() };
      byProject.set(row.project_id, link);
    }
    if (row.asset_id) link.assets.add(row.asset_id);
    if (row.output_id) link.outputs.add(row.output_id);
  }
  return [...byProject.values()].map(({ assets, outputs, ...link }) => ({ ...link, assetIds: [...assets], outputIds: [...outputs] }));
}

/**
 * The seat check is the studio's own (`studioSeat`): membership, then the Morphic hardline and the
 * feature policy, then the role. A closed organization gets a failure, exactly as the studio state does,
 * and a campaign-only guest (who has no assets page) gets empty lists.
 */
export async function loadAssetProjectLinks(
  deps: { sql: SqlRunner },
  viewer: { userId: string | null },
  organizationId: string,
): Promise<AssetProjectLinks | StudioFailure> {
  return guarded(async () => {
    const seat = await studioSeat(deps.sql, viewer.userId, organizationId);
    if (seat.role === 'guest') return EMPTY_ASSET_PROJECT_LINKS;
    const self = await selfProjects(deps.sql, organizationId);
    const team = await teamProjects(deps.sql, organizationId);
    return { ok: true as const, self, team };
  });
}
