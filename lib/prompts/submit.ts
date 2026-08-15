import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { stagePromptUpload, type UploadRejection } from './media';
import { insertPrompt, countRecentSubmissions, slugExists } from './repo';
import {
  DEFAULT_PROMPT_MODEL,
  RATE_WINDOW_HOURS,
  SUBMISSIONS_PER_DAY,
  SubmissionSchema,
  normalizeHandle,
  slugify,
  type PromptMedia,
} from './schemas';

/**
 * PLAN §13.1/E — community submission, as one injectable service.
 *
 * Everything abuse-facing is decided HERE, server-side, over the received bytes and the real
 * database, and nothing is trusted from the form:
 *
 *   · the AUTHOR is the session's user id — there is no field that could carry another;
 *   · the STATUS is `pending`, always — a submission cannot ask to be published;
 *   · the TEXT VISIBILITY is `public`, always (§13.3-1) — and the DB CHECK backs it up;
 *   · the RATE LIMIT is a `count(*)` in the same transaction-less path, not a cookie;
 *   · the SIZE/TYPE caps are measured over the uploaded bytes (`lib/prompts/media.ts`), not read
 *     from a `Content-Length` header or an `accept` attribute.
 */

export interface SubmitDeps {
  sql: SqlRunner;
  storage: StorageDriver;
}

export type SubmitFailure =
  | { code: 'sign_in_required' }
  | { code: 'invalid'; detail: string }
  | { code: 'rate_limited'; detail: string }
  | { code: 'upload'; detail: UploadRejection };

export type SubmitOutcome = { ok: true; id: string; slug: string } | ({ ok: false } & SubmitFailure);

export interface SubmitInput {
  title: string;
  promptText: string;
  /** The optional making-of (founder direction, 2026-08-14) — markdown, one field, any language. */
  processMd: string | null;
  /** The easy path (2026-08-15): a link to where the creator already posted it. */
  sourceUrl: string | null;
  useCase: string[];
  handle: string | null;
  consent: boolean;
  video: File | null;
  poster: File | null;
  audio: File | null;
}

/**
 * §13.1: "Rate limit 3 submissions/day/user" — so the FOURTH inside the window is refused.
 * Pure, and tested as a truth table: 0,1,2 pass; 3 and above do not.
 */
export function isRateLimited(recentCount: number, limit = SUBMISSIONS_PER_DAY): boolean {
  return recentCount >= limit;
}

/** Deterministic, collision-free slug: the title's shape first, a short id suffix when it must. */
export async function uniqueSlug(
  sql: SqlRunner,
  title: string,
  id: string,
): Promise<string> {
  const suffix = id.slice(0, 8);
  const base = slugify(title, `prompt-${suffix}`);
  if (!(await slugExists(sql, base))) return base;
  return `${base}-${suffix}`;
}

export async function submitPrompt(
  deps: SubmitDeps,
  viewer: Viewer,
  input: SubmitInput,
): Promise<SubmitOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };

  const parsed = SubmissionSchema.safeParse({
    title: input.title,
    promptText: input.promptText,
    processMd: input.processMd ?? '',
    sourceUrl: input.sourceUrl ?? '',
    useCase: input.useCase,
    handle: input.handle,
    consent: input.consent === true ? true : undefined,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { ok: false, code: 'invalid', detail };
  }

  const recent = await countRecentSubmissions(deps.sql, viewer.userId, RATE_WINDOW_HOURS);
  if (isRateLimited(recent)) {
    return {
      ok: false,
      code: 'rate_limited',
      detail: `${recent}/${SUBMISSIONS_PER_DAY} in ${RATE_WINDOW_HOURS}h`,
    };
  }

  const id = randomUUID();
  const media: PromptMedia = {};
  // Uploads are staged BEFORE the row is written, so a rejected file never leaves a half-made
  // submission behind. Nothing is copied to the public bucket here — that happens at approval.
  for (const [kind, file] of [
    ['poster', input.poster],
    ['video', input.video],
    ['audio', input.audio],
  ] as const) {
    if (file === null) continue;
    const staged = await stagePromptUpload(deps.storage, id, kind, file);
    if (!staged.ok) return { ok: false, code: 'upload', detail: staged.reason };
    media[kind] = staged.value.ref;
  }

  const slug = await uniqueSlug(deps.sql, parsed.data.title, id);

  await insertPrompt(deps.sql, {
    id,
    slug,
    source: 'community',
    authorId: viewer.userId,
    authorHandle: normalizeHandle(parsed.data.handle) ?? normalizeHandle(viewer.email?.split('@')[0] ?? null),
    status: 'pending',
    models: [DEFAULT_PROMPT_MODEL],
    title: parsed.data.title,
    titleKo: null,
    promptText: parsed.data.promptText,
    // One field, whichever language they wrote in: the detail page falls back across locales.
    processMd: parsed.data.processMd,
    sourceUrl: parsed.data.sourceUrl,
    // §13.3-1, and the DB CHECK agrees: community text is public by definition.
    textVisibility: 'public',
    media: Object.keys(media).length === 0 ? null : media,
    useCase: parsed.data.useCase,
    featured: false,
    publishedAt: null,
  });

  return { ok: true, id, slug };
}
