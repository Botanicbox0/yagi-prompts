import 'server-only';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import {
  PLAYBOOK_NOT_FOUND,
  shapePlaybook,
  type ShapedPlaybookOptions,
  type ShapedPlaybookResult,
} from './playbook-access';

export type {
  ShapedPlaybookOk,
  ShapedPlaybookOptions,
  ShapedPlaybookResult,
} from './playbook-access';

/**
 * PLAN §7 — `getShapedPlaybook(slug, opts?)`, the façade every route calls.
 *
 * It resolves the session ITSELF: no caller may hand it a tier, and there is no parameter that
 * could. Everything below the two `await`s lives in `lib/content/playbook-access.ts`, which is where
 * the eligibility matrix is tested (see that file's note on the injection seam).
 */
export async function getShapedPlaybook(
  slug: string,
  options: ShapedPlaybookOptions = {},
): Promise<ShapedPlaybookResult> {
  const [sql, viewer] = await Promise.all([getSqlRunner(), getViewer()]);
  // No database configured ⇒ nothing is published ⇒ 404. Fail closed: never render a page that
  // could not prove what it is allowed to show.
  if (sql === null) return PLAYBOOK_NOT_FOUND;
  return shapePlaybook({ sql, viewer }, slug, options);
}
