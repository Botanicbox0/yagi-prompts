/**
 * Reusing a designed VIDEO sentence without the screen having it (the video prompt shield): `job.create` takes
 * `reviewedFrom: { jobId }` (an earlier designed run) or `reviewedToken` (a `prompt.enhance` answer) in place of
 * `reviewedPrompt`, and the server puts the stored sentence where `reviewedPrompt` would have been. From there the
 * run is planned, priced and sent exactly as one with `reviewedPrompt` (lib/brand-studio/plan.ts).
 *
 * Read only while the shield is open for the organization; closed, both keys are dropped unread, as any unknown
 * key always was. Refusals (all after the seat): a bad shape or both at once `invalid`; an earlier run that is not
 * this organization's, or was removed, `not_found`; one with no designed sentence `invalid`; any token problem `conflict` (the screen's
 * "something changed, start again"), the same for a forged, altered, expired or foreign token.
 */
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { StudioDenied } from '../access';
import { STUDIO_LIMITS, VideoJobSchema, type StudioErrorCode } from '../contracts';
import { liveRunsFilter, sentTextOf } from '../repo';
import type { JobRow } from '../types';
import { isShieldedKind } from './shield';
import { openPromptToken, PROMPT_TOKEN_MAX } from './token';

const ReviewedPrompt = VideoJobSchema.shape.reviewedPrompt;
/** The longest `reviewedPrompt` a run takes (the bar and a re-run cut a sentence to this). */
export const REVIEWED_PROMPT_MAX = ReviewedPrompt.unwrap().maxLength ?? STUDIO_LIMITS.promptMax;

const ReuseSchema = z.object({
  reviewedFrom: z.object({ jobId: z.uuid() }).strict().optional(),
  reviewedToken: z.unknown().optional(),
});

export type ShieldedReuse = { from: string } | { token: unknown };

/** What a `video` request asks to reuse, judged before anything is read. Null when it asks nothing. */
export function shieldedReuseOf(raw: unknown, hasReviewedPrompt: boolean): ShieldedReuse | null | { refused: StudioErrorCode } {
  const record = (raw ?? {}) as Record<string, unknown>;
  const from = record.reviewedFrom !== undefined;
  const token = record.reviewedToken !== undefined;
  if (!from && !token) return null;
  if ((from && token) || hasReviewedPrompt) return { refused: 'invalid' };
  const parsed = ReuseSchema.safeParse({ reviewedFrom: record.reviewedFrom, reviewedToken: record.reviewedToken });
  if (!parsed.success) return { refused: 'invalid' };
  if (from) return { from: parsed.data.reviewedFrom!.jobId };
  if (typeof record.reviewedToken !== 'string' || record.reviewedToken.length > PROMPT_TOKEN_MAX) return { refused: 'conflict' };
  return { token: record.reviewedToken };
}

/**
 * The sentence to send as `reviewedPrompt`, read inside the create transaction after the seat (an owner or editor
 * of `organizationId`). Throws `StudioDenied` with the codes above.
 */
export async function reviewedSentence(
  sql: SqlRunner,
  reuse: ShieldedReuse,
  claims: { organizationId: string; userId: string; model: string },
): Promise<string> {
  if ('token' in reuse) {
    const text = openPromptToken(reuse.token, { org: claims.organizationId, user: claims.userId, model: claims.model, kind: 'video' });
    const parsed = text === null ? null : ReviewedPrompt.safeParse(text);
    if (!parsed?.success || !parsed.data) throw new StudioDenied('conflict');
    return parsed.data;
  }
  const row = (
    await sql.query<Pick<JobRow, 'id' | 'kind' | 'final_prompt' | 'enhance' | 'params' | 'work'>>(
      `select id, kind, final_prompt, enhance, params, work from brand_studio_jobs
        where id = $1 and organization_id = $2 and model <> 'compose-1080p' ${await liveRunsFilter(sql)}`,
      [reuse.from, claims.organizationId],
    )
  ).rows[0];
  if (!row) throw new StudioDenied('not_found');
  const text = isShieldedKind(row.kind) && !row.params?.preset ? sentTextOf(row) : null;
  // As the re-run cut it from the view: the first `REVIEWED_PROMPT_MAX` characters, then the request's own trim.
  const parsed = text === null ? null : ReviewedPrompt.safeParse(text.slice(0, REVIEWED_PROMPT_MAX));
  if (!parsed?.success || !parsed.data) throw new StudioDenied('invalid');
  return parsed.data;
}
