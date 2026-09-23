import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import { CONTEST_NOT_FOUND, shapeContestPreview, type ContestDetailResult } from './access';

/**
 * PLAN §14.2 — the contest façade. The public contest routes are retired (TEMPLATES-IA §6); the
 * admin preview is the one remaining caller. No viewer parameter and no viewer read: nothing on the
 * contests surface is shaped per tier.
 */

/** The admin-only preview path — behind `requireAdmin()` in the `(admin)` layout, never public. */
export async function getContestPreview(slug: string): Promise<ContestDetailResult> {
  const sql = await getSqlRunner();
  if (sql === null) return CONTEST_NOT_FOUND;
  return shapeContestPreview({ sql }, slug);
}
