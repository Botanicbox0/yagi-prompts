import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Localized } from '@/lib/content/schemas';
import { publicContentUrl } from '@/lib/content/asset-url';
import { shapeContestMedia, type ShapedContestMedia } from './media';
import { contestTiming, type ContestTiming } from './phase';
import { loadApprovedEntries, loadContestBySlug, type ContestRow, type EntryRow } from './repo';
import { platformOf, snsDisplayHandle, type EntryPlatform, type Placement } from './schemas';

/**
 * PLAN §14.2 — the contests gate, as a pure function of (db × slug × clock).
 *
 * Split from the façade for the reason M2 established and M6 repeated: `getSqlRunner` carries the
 * `server-only` guard and cannot be imported into vitest, so everything that DECIDES lives here
 * with its dependencies injected.
 *
 * Two rules, and the difference between them is the whole §14 doctrine:
 *
 *   · **A contest's existence is a status question.** Only `published` contests resolve on the
 *     public route — draft and archived are 404 for everyone, admin included. §14.1 makes
 *     publishing the founder's deliberate act because "a prize is a public commitment", so a draft
 *     that could be read by anyone holding the URL would defeat the point. Drafts render through
 *     the admin-only preview route, which calls `shapeContestPreview` below.
 *   · **An entry's visibility is a moderation question**, and it is not a tier question at all:
 *     approved entries are public to everyone, pending and rejected ones are visible to nobody but
 *     the moderator. There is no Pro gate anywhere on this surface — a contest is marketing, and
 *     charging to read the rules of a competition would be absurd.
 */

export interface ContestEntryView {
  /**
   * Every field an approved entry publishes, and nothing else.
   *
   * Not present, deliberately: `author_id` (an internal identifier for a person), `status`,
   * `reject_reason` (a private note between the moderator and the entrant) and every timestamp
   * except the one the rail needs. The projection is built by naming, so this list IS the
   * disclosure, and `tests/contests/access.test.ts` pins the key set.
   */
  id: string;
  title: string;
  note: string | null;
  videoUrl: string;
  snsUrl: string;
  /** `instagram` … `vimeo`, or `link` — the chip, derived from the host (§14.1). */
  platform: EntryPlatform;
  /** `@hana`, derived from the SNS path — the credit, never the raw tracking URL. */
  handle: string | null;
  placement: Placement | null;
  createdAt: string | null;
}

export interface ShapedContest {
  id: string;
  slug: string;
  title: Localized;
  summary: Localized;
  prize: Localized;
  rules: Localized | null;
  brandName: string;
  brandUrl: string | null;
  poster: ShapedContestMedia | null;
  video: ShapedContestMedia | null;
  startsAt: string | null;
  deadlineAt: string | null;
  publishedAt: string | null;
  timing: ContestTiming;
  entries: ContestEntryView[];
  /** The 1/2/3 subset, in placement order — the winners strip's own array. */
  winners: ContestEntryView[];
  /** True on the admin preview path only; the page renders a banner rather than pretending. */
  preview: boolean;
}

export interface ContestDetailOk {
  status: 'ok';
  contest: ShapedContest;
}

export type ContestDetailResult = ContestDetailOk | { status: 'not_found' };

export const CONTEST_NOT_FOUND = { status: 'not_found' } as const;

export interface ContestAccessDeps {
  sql: SqlRunner;
  /** Injected so a test can stand on a boundary instead of waiting for one. */
  now?: Date | number;
  publicUrl?: (key: string) => string | null;
}

/** A published contest is visible to everyone; everything else does not exist publicly. */
export function isPubliclyVisible(row: Pick<ContestRow, 'status'>): boolean {
  return row.status === 'published';
}

/** One approved row → one public entry view. The ONLY place a `ContestEntryView` is constructed. */
export function toEntryView(row: EntryRow): ContestEntryView {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    videoUrl: row.videoUrl,
    snsUrl: row.snsUrl,
    platform: platformOf(row.snsUrl),
    handle: snsDisplayHandle(row.snsUrl),
    placement: row.placement,
    createdAt: row.createdAt,
  };
}

async function shape(
  deps: ContestAccessDeps,
  row: ContestRow,
  preview: boolean,
): Promise<ContestDetailOk> {
  const entryRows = await loadApprovedEntries(deps.sql, row.id);
  const entries = entryRows.map(toEntryView);
  const { poster, video } = shapeContestMedia(row.id, row.media, {
    publicUrl: deps.publicUrl ?? publicContentUrl,
  });

  return {
    status: 'ok',
    contest: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      prize: row.prize,
      rules: row.rules,
      brandName: row.brandName,
      brandUrl: row.brandUrl,
      poster,
      video,
      startsAt: row.startsAt,
      deadlineAt: row.deadlineAt,
      publishedAt: row.publishedAt,
      timing: contestTiming(row, deps.now ?? Date.now()),
      entries,
      winners: entries.filter((entry) => entry.placement !== null),
      preview,
    },
  };
}

/** The public detail route's one call. Published only, for everyone. */
export async function shapeContestDetail(
  deps: ContestAccessDeps,
  slug: string,
): Promise<ContestDetailResult> {
  const row = await loadContestBySlug(deps.sql, slug);
  if (row === null || !isPubliclyVisible(row)) return CONTEST_NOT_FOUND;
  return shape(deps, row, false);
}

/**
 * The admin preview's one call — the SAME shaping, with the status gate removed and `preview: true`
 * stamped on the result.
 *
 * The caller is `app/(admin)/admin/contests/[slug]/preview/page.tsx`, which lives inside the
 * `(admin)` route group and is therefore behind `requireAdmin()` → 404. Nothing here checks a
 * viewer, on purpose: this function is not a gate, it is the thing behind one, and a second gate
 * here would be a second place to get the rule wrong.
 */
export async function shapeContestPreview(
  deps: ContestAccessDeps,
  slug: string,
): Promise<ContestDetailResult> {
  const row = await loadContestBySlug(deps.sql, slug);
  if (row === null) return CONTEST_NOT_FOUND;
  return shape(deps, row, row.status !== 'published');
}
