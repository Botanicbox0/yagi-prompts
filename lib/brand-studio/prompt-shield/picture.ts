/**
 * Who may see a sent video prompt as pictures (`/api/brand-studio/prompt-image`), and which text it is.
 *
 * A stored run: exactly the seats that see its view today (`studioSeat`: owner, editor, viewer and project
 * guest of the organization, after the sandbox hardline and the feature policy), a live VIDEO run of that
 * organization (the state read's rule: not removed, not the editor's export) with a sent text the view would have
 * shown (not a preset), the shield open for the organization.
 * A designed sentence (`prompt.enhance` token): the member it was made for, still seated, within 24 hours.
 *
 * Every refusal is the same `null` (the route answers one 404 for all): a missing run, another organization's,
 * a closed shield, an image run, a run with nothing designed, a bad token.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioSeat, StudioDenied } from '../access';
import { liveRunsFilter, sentTextOf } from '../repo';
import type { JobRow } from '../types';
import { isShieldedKind, SHIELDED_KINDS, videoPromptShieldActive } from './shield';
import { openPromptToken } from './token';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function seated(sql: SqlRunner, viewer: Pick<Viewer, 'userId'>, organizationId: string): Promise<boolean> {
  try {
    await studioSeat(sql, viewer.userId, organizationId);
    return true;
  } catch (error) {
    if (error instanceof StudioDenied) return false;
    throw error;
  }
}

/** The sent text of a stored VIDEO run this viewer may see as pictures, or null. */
export async function shieldedJobText(sql: SqlRunner, viewer: Pick<Viewer, 'userId'>, organizationId: string, jobId: string): Promise<string | null> {
  if (!UUID.test(organizationId) || !UUID.test(jobId) || !videoPromptShieldActive(organizationId)) return null;
  return sql.transaction(async (tx) => {
    if (!(await seated(tx, viewer, organizationId))) return null;
    const row = (
      await tx.query<Pick<JobRow, 'kind' | 'final_prompt' | 'enhance' | 'params' | 'work'>>(
        `select kind, final_prompt, enhance, params, work from brand_studio_jobs
          where id = $1 and organization_id = $2 and model <> 'compose-1080p' ${await liveRunsFilter(tx)}`,
        [jobId, organizationId],
      )
    ).rows[0];
    if (!row || !isShieldedKind(row.kind) || row.params?.preset) return null;
    return sentTextOf(row);
  });
}

/** The designed sentence inside a `prompt.enhance` token, for the member it was made for, or null. */
export async function shieldedTokenText(sql: SqlRunner, viewer: Pick<Viewer, 'userId'>, organizationId: string, token: unknown): Promise<string | null> {
  if (!UUID.test(organizationId) || !viewer.userId || !videoPromptShieldActive(organizationId)) return null;
  if (!(await sql.transaction((tx) => seated(tx, viewer, organizationId)))) return null;
  return openPromptToken(token, { org: organizationId, user: viewer.userId, model: null, kind: SHIELDED_KINDS });
}
