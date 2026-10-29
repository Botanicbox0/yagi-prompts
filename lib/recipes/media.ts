import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { ASSET_HANDLE } from './schema';
import { parseDisclosure, recipeSchemaReady } from './repo';

/**
 * Who may see which private recipe object — the one rule both media routes ask.
 *
 *   a test or review render's Nth result   the job's owner; a studio review also any admin.
 *                                          A maker's test render is the maker's alone.
 *   a maker file                           its owner and the studio — or any signed-in member, once
 *                                          the template is published AND the maker chose to show
 *                                          their files (`disclosure.assets`), and only reference
 *                                          files. Never an anonymous reader (§20.3).
 */

export interface MediaObject { key: string; mime: string; publicCache: boolean }

export async function recipeRenderOutput(sql: SqlRunner, viewer: Viewer, renderId: string, position: number): Promise<MediaObject | null> {
  if (!z.uuid().safeParse(renderId).success || !Number.isInteger(position) || position < 0 || position > 5 || !viewer.userId) return null;
  if (!await recipeSchemaReady(sql)) return null;
  const { rows } = await sql.query<{ user_id: string; purpose: string; storage_key: string; mime: string }>(`select j.user_id,r.purpose,o.storage_key,o.mime from render_job_outputs o
    join render_jobs j on j.id=o.render_id left join render_job_recipes r on r.render_id=o.render_id where o.render_id=$1 and o.position=$2 and j.status='succeeded'`, [renderId, position]);
  const row = rows[0];
  if (!row) return null;
  const allowed = row.user_id === viewer.userId || (viewer.isAdmin && row.purpose === 'studio_review');
  return allowed ? { key: row.storage_key, mime: row.mime, publicCache: false } : null;
}

export async function makerFileObject(sql: SqlRunner, viewer: Viewer, handle: string): Promise<MediaObject | null> {
  if (!ASSET_HANDLE.test(handle) || !await recipeSchemaReady(sql)) return null;
  const { rows } = await sql.query<{ user_id: string; role: string; storage_key: string; mime: string; template_status: string | null; audience: string | null; disclosure: unknown }>(`select a.user_id,a.role,a.storage_key,a.mime,p.status template_status,p.audience,to_jsonb(p.*)->'disclosure' disclosure
    from platform_format_assets a join platform_formats f on f.id=a.format_id left join prompt_items p on p.id=f.template_id and f.status='accepted' where a.id=$1`, [handle]);
  const row = rows[0];
  if (!row) return null;
  if (!viewer.userId) return null;
  if (row.user_id === viewer.userId || viewer.isAdmin) return { key: row.storage_key, mime: row.mime, publicCache: false };
  // §20.3: a disclosed source file is part of the full recipe, so it opens for signed-in members only.
  const disclosed = row.role === 'reference' && row.template_status === 'published' && row.audience === 'public' && parseDisclosure(row.disclosure).assets;
  return disclosed ? { key: row.storage_key, mime: row.mime, publicCache: false } : null;
}
