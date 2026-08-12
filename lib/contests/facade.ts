import 'server-only';
import { getSqlRunner } from '@/lib/db/connect';
import {
  CONTEST_NOT_FOUND,
  shapeContestDetail,
  shapeContestPreview,
  type ContestDetailResult,
} from './access';
import { loadEntryFormState, type EntryFormState } from './submit';

export type { ContestDetailOk, ContestDetailResult, ContestEntryView, ShapedContest } from './access';

/**
 * PLAN §14.2 — the façades the contest routes call.
 *
 * Same contract as `lib/prompts/facade.ts`, with one difference worth stating: there is no viewer
 * parameter and no viewer read at all. Nothing on the contests surface is shaped per tier — a
 * contest is marketing, its rules are rules, and its approved entries are public. The only
 * per-person decision on this surface is "may you submit", which lives on the login-gated form and
 * is resolved there.
 *
 * That is also why the detail route can be `force-dynamic` + `no-store` (§14.2) without needing the
 * session: it is dynamic because the phase and the D-day move with the clock, not because the HTML
 * differs by reader.
 */
export async function getShapedContest(slug: string, now?: Date | number): Promise<ContestDetailResult> {
  const sql = await getSqlRunner();
  // No database ⇒ nothing is published ⇒ 404. Fail closed, exactly like every other façade.
  if (sql === null) return CONTEST_NOT_FOUND;
  return shapeContestDetail({ sql, ...(now === undefined ? {} : { now }) }, slug);
}

/** The admin-only preview path — behind `requireAdmin()` in the `(admin)` layout, never public. */
export async function getContestPreview(slug: string): Promise<ContestDetailResult> {
  const sql = await getSqlRunner();
  if (sql === null) return CONTEST_NOT_FOUND;
  return shapeContestPreview({ sql }, slug);
}

/** Everything `/contests/[slug]/submit` needs in one read (contest + existing entry + prefill). */
export async function getEntryFormState(
  slug: string,
  userId: string | null,
): Promise<EntryFormState | null> {
  const sql = await getSqlRunner();
  if (sql === null) return null;
  return loadEntryFormState({ sql }, slug, userId);
}
