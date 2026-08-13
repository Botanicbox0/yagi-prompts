import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Localized } from '@/lib/content/schemas';
import type { ContestStatus, EntryStatus, Placement } from './schemas';

/**
 * PLAN §14 — every `contests` / `contest_entries` query, in one driver-agnostic module.
 *
 * Same seam as `lib/prompts/repo.ts`: the acceptance tests drive these against real PGlite, the app
 * drives them against Supabase Postgres through `pg`, and neither needs a session — the CALLER
 * supplies the viewer and the shaping happens above.
 *
 * One thing this module deliberately does NOT do: derive a phase. Phase is a function of the clock
 * (`lib/contests/phase.ts`), and a `where now() between ...` in SQL would make every listing query
 * uncacheable and every test dependent on wall-clock time. The queries return dates; the caller
 * decides what time it is.
 */

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

export interface ContestRow {
  id: string;
  slug: string;
  status: ContestStatus;
  title: Localized;
  summary: Localized;
  prize: Localized;
  rules: Localized | null;
  brandName: string;
  brandUrl: string | null;
  media: unknown;
  startsAt: string | null;
  deadlineAt: string | null;
  createdAt: string | null;
  publishedAt: string | null;
}

export interface EntryRow {
  id: string;
  contestId: string;
  authorId: string;
  title: string;
  videoUrl: string;
  note: string | null;
  snsUrl: string;
  status: EntryStatus;
  rejectReason: string | null;
  placement: Placement | null;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * The optimistic-concurrency token the moderation forms carry (§14.2 / M9 review).
   *
   * `updated_at` rendered to MICROSECOND precision as text, deliberately not the `updatedAt` field
   * above: both drivers hand a timestamptz back as a JS `Date`, which truncates to milliseconds, so
   * a token built from it would round to a value the database can never match. Formatting on both
   * sides — here and in the `WHERE` clause — is what makes the comparison exact.
   */
  version: string;
}

interface RawContest {
  id: string;
  slug: string;
  status: ContestStatus;
  title: Localized;
  summary: Localized;
  prize: Localized;
  rules: Localized | null;
  brand_name: string;
  brand_url: string | null;
  media: unknown;
  starts_at: Date | string | null;
  deadline_at: Date | string | null;
  created_at: Date | string | null;
  published_at: Date | string | null;
}

interface RawEntry {
  id: string;
  contest_id: string;
  author_id: string;
  title: string;
  video_url: string;
  note: string | null;
  sns_url: string;
  status: EntryStatus;
  reject_reason: string | null;
  placement: number | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  version: string;
}

const CONTEST_COLUMNS = `id, slug, status, title, summary, prize, rules, brand_name, brand_url,
                         media, starts_at, deadline_at, created_at, published_at`;

/**
 * `updated_at` as microsecond-precision UTC text — the optimistic-concurrency token.
 *
 * Spelled once and reused by both the projection and every guarded `WHERE`, because the two have to
 * produce byte-identical strings or the guard would reject every review as stale.
 */
const VERSION_EXPR = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const ENTRY_COLUMNS = `id, contest_id, author_id, title, video_url, note, sns_url, status,
                       reject_reason, placement, created_at, updated_at,
                       ${VERSION_EXPR} as version`;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toContest(raw: RawContest): ContestRow {
  return {
    id: raw.id,
    slug: raw.slug,
    status: raw.status,
    title: raw.title,
    summary: raw.summary,
    prize: raw.prize,
    rules: raw.rules,
    brandName: raw.brand_name,
    brandUrl: raw.brand_url,
    media: raw.media,
    startsAt: toIso(raw.starts_at),
    deadlineAt: toIso(raw.deadline_at),
    createdAt: toIso(raw.created_at),
    publishedAt: toIso(raw.published_at),
  };
}

function toEntry(raw: RawEntry): EntryRow {
  return {
    id: raw.id,
    contestId: raw.contest_id,
    authorId: raw.author_id,
    title: raw.title,
    videoUrl: raw.video_url,
    note: raw.note,
    snsUrl: raw.sns_url,
    status: raw.status,
    rejectReason: raw.reject_reason,
    placement: (raw.placement === 1 || raw.placement === 2 || raw.placement === 3
      ? raw.placement
      : null) as Placement | null,
    createdAt: toIso(raw.created_at),
    updatedAt: toIso(raw.updated_at),
    version: raw.version,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// contests — read paths
// ---------------------------------------------------------------------------

/**
 * Every PUBLISHED contest. The listing's single query.
 *
 * Ordered by deadline so the rows arrive in a stable, meaningful sequence even before the caller
 * splits them by phase; `slug` breaks ties so a page rendered twice is the same page.
 */
export async function loadPublishedContests(sql: SqlRunner): Promise<ContestRow[]> {
  const { rows } = await sql.query<RawContest>(
    `select ${CONTEST_COLUMNS} from contests
      where status = 'published'
      order by deadline_at asc nulls last, slug asc`,
  );
  return rows.map(toContest);
}

/**
 * By slug, WHATEVER the status.
 *
 * Deliberately unfiltered, for the same reason `loadPromptBySlug` is: the caller decides what a
 * draft means (404 on the public detail page, a rendered page inside the admin preview, an editable
 * row in `/admin/contests`). A repo that filtered here would need three variants and one of them
 * would drift.
 */
export async function loadContestBySlug(sql: SqlRunner, slug: string): Promise<ContestRow | null> {
  const { rows } = await sql.query<RawContest>(
    `select ${CONTEST_COLUMNS} from contests where slug = $1`,
    [slug],
  );
  return rows[0] ? toContest(rows[0]) : null;
}

/** By id, with the shape check here rather than at every call site (a malformed id is a 404). */
export async function loadContestById(sql: SqlRunner, id: string): Promise<ContestRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await sql.query<RawContest>(
    `select ${CONTEST_COLUMNS} from contests where id = $1`,
    [id],
  );
  return rows[0] ? toContest(rows[0]) : null;
}

/** The admin list: drafts first (they are the ones with work in them), then newest. */
export async function loadAllContests(sql: SqlRunner): Promise<ContestRow[]> {
  const { rows } = await sql.query<RawContest>(
    `select ${CONTEST_COLUMNS} from contests
      order by (status = 'draft') desc, coalesce(published_at, created_at) desc, slug asc`,
  );
  return rows.map(toContest);
}

export async function contestSlugExists(
  sql: SqlRunner,
  slug: string,
  exceptId?: string,
): Promise<boolean> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from contests where slug = $1 and ($2::uuid is null or id <> $2)`,
    [slug, exceptId ?? null],
  );
  return (rows[0]?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// contests — write paths
// ---------------------------------------------------------------------------

export interface ContestWriteArgs {
  slug: string;
  title: Localized;
  summary: Localized;
  prize: Localized;
  rules: Localized | null;
  brandName: string;
  brandUrl: string | null;
  startsAt: string | null;
  deadlineAt: string | null;
}

export async function insertContest(
  sql: SqlRunner,
  args: ContestWriteArgs & { id: string; status?: ContestStatus; media?: unknown },
): Promise<void> {
  await sql.query(
    `insert into contests
       (id, slug, status, title, summary, prize, rules, brand_name, brand_url, media,
        starts_at, deadline_at, published_at)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb,
             $11::timestamptz, $12::timestamptz,
             case when $3 = 'published' then now() else null end)`,
    [
      args.id,
      args.slug,
      args.status ?? 'draft',
      JSON.stringify(args.title),
      JSON.stringify(args.summary),
      JSON.stringify(args.prize),
      args.rules === null ? null : JSON.stringify(args.rules),
      args.brandName,
      args.brandUrl,
      args.media === null || args.media === undefined ? null : JSON.stringify(args.media),
      args.startsAt,
      args.deadlineAt,
    ],
  );
}

/**
 * §14.1 / M9 R3 — the judged-contest deadline lock is serialized on the contest row.
 *
 * The extension guard used to be a count-then-update in the operation layer; a placement landing
 * between the two left medals on a reopened contest. Now the contest row is taken `FOR UPDATE`
 * FIRST, and `setEntryPlacement` takes the same lock — the two writes cannot interleave. The
 * placement count therefore runs after any in-flight placement has committed or rolled back.
 */
export async function updateContest(
  sql: SqlRunner,
  args: ContestWriteArgs & { id: string },
): Promise<'saved' | 'notFound' | 'placementsLocked'> {
  return await sql.transaction(async (tx) => {
    const locked = await tx.query<{ deadline_at: string | null }>(
      'select deadline_at from contests where id = $1 for update',
      [args.id],
    );
    const current = locked.rows[0];
    if (current === undefined) return 'notFound';

    const extending =
      args.deadlineAt !== null &&
      current.deadline_at !== null &&
      new Date(args.deadlineAt) > new Date(current.deadline_at);
    if (extending) {
      const placed = await tx.query<{ n: number }>(
        'select count(*)::int as n from contest_entries where contest_id = $1 and placement is not null',
        [args.id],
      );
      if ((placed.rows[0]?.n ?? 0) > 0) return 'placementsLocked';
    }

    const { rows } = await tx.query<{ id: string }>(
      `update contests
          set slug = $2, title = $3::jsonb, summary = $4::jsonb, prize = $5::jsonb,
              rules = $6::jsonb, brand_name = $7, brand_url = $8,
              starts_at = $9::timestamptz, deadline_at = $10::timestamptz
        where id = $1
        returning id`,
      [
        args.id,
        args.slug,
        JSON.stringify(args.title),
        JSON.stringify(args.summary),
        JSON.stringify(args.prize),
        args.rules === null ? null : JSON.stringify(args.rules),
        args.brandName,
        args.brandUrl,
        args.startsAt,
        args.deadlineAt,
      ],
    );
    return rows.length > 0 ? 'saved' : 'notFound';
  });
}

/** Stamp the published media refs back onto the row after the copier has run. */
export async function updateContestMedia(
  sql: SqlRunner,
  id: string,
  media: unknown,
): Promise<void> {
  await sql.query('update contests set media = $2::jsonb where id = $1', [
    id,
    media === null || media === undefined ? null : JSON.stringify(media),
  ]);
}

/**
 * draft → published. `published_at` is stamped once and never re-stamped: republishing after an
 * unpublish is the same contest, and moving its debut date would move it in the sitemap too.
 */
export async function publishContest(sql: SqlRunner, id: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update contests
        set status = 'published', published_at = coalesce(published_at, now())
      where id = $1 and status in ('draft','archived')
      returning id`,
    [id],
  );
  return rows.length > 0;
}

/** published → draft. The listing loses it immediately; the disclosed poster stays disclosed (§6). */
export async function unpublishContest(sql: SqlRunner, id: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update contests set status = 'draft' where id = $1 and status = 'published' returning id`,
    [id],
  );
  return rows.length > 0;
}

/** Never a delete: the slug stays taken, the entries stay attached, the row stays audit. */
export async function setContestArchived(
  sql: SqlRunner,
  id: string,
  archived: boolean,
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update contests
        set status = case when $2::boolean then 'archived' else 'draft' end
      where id = $1 and status in ('published','archived','draft')
      returning id`,
    [id, archived],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// entries — read paths
// ---------------------------------------------------------------------------

/**
 * The public rail: APPROVED entries only, winners first, then newest.
 *
 * The winners ordering is in SQL rather than in the component because the winners strip and the
 * rail read the same array — if they disagreed about who came second, one of them would be wrong on
 * a page that names a prize.
 */
export async function loadApprovedEntries(sql: SqlRunner, contestId: string): Promise<EntryRow[]> {
  if (!UUID.test(contestId)) return [];
  const { rows } = await sql.query<RawEntry>(
    `select ${ENTRY_COLUMNS} from contest_entries
      where contest_id = $1 and status = 'approved'
      order by placement asc nulls last, created_at asc, id asc`,
    [contestId],
  );
  return rows.map(toEntry);
}

/** The moderation queue: pending first (oldest first — it is a queue), then the rest. */
export async function loadEntriesForModeration(
  sql: SqlRunner,
  contestId: string,
): Promise<EntryRow[]> {
  if (!UUID.test(contestId)) return [];
  const { rows } = await sql.query<RawEntry>(
    `select ${ENTRY_COLUMNS} from contest_entries
      where contest_id = $1
      order by (status = 'pending') desc, placement asc nulls last, created_at asc`,
    [contestId],
  );
  return rows.map(toEntry);
}

/** §14.1 — one entry per user per contest, so this is the resubmit lookup. */
export async function loadEntryByAuthor(
  sql: SqlRunner,
  contestId: string,
  authorId: string,
): Promise<EntryRow | null> {
  const { rows } = await sql.query<RawEntry>(
    `select ${ENTRY_COLUMNS} from contest_entries where contest_id = $1 and author_id = $2`,
    [contestId, authorId],
  );
  return rows[0] ? toEntry(rows[0]) : null;
}

export async function loadEntryById(sql: SqlRunner, id: string): Promise<EntryRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await sql.query<RawEntry>(
    `select ${ENTRY_COLUMNS} from contest_entries where id = $1`,
    [id],
  );
  return rows[0] ? toEntry(rows[0]) : null;
}

/** Approved counts per contest, for the listing card — a number, never a row (§14.2 / no PII). */
export async function countApprovedEntries(
  sql: SqlRunner,
): Promise<Map<string, { approved: number; winners: number }>> {
  const { rows } = await sql.query<{ contest_id: string; approved: number; winners: number }>(
    `select contest_id,
            count(*)::int as approved,
            count(placement)::int as winners
       from contest_entries
      where status = 'approved'
      group by contest_id`,
  );
  return new Map(rows.map((row) => [row.contest_id, { approved: row.approved, winners: row.winners }]));
}

/** `/account` — "your entries", across every contest. */
export async function loadEntriesByAuthor(sql: SqlRunner, authorId: string): Promise<EntryRow[]> {
  const { rows } = await sql.query<RawEntry>(
    `select ${ENTRY_COLUMNS} from contest_entries where author_id = $1 order by created_at desc`,
    [authorId],
  );
  return rows.map(toEntry);
}

// ---------------------------------------------------------------------------
// entries — write paths
// ---------------------------------------------------------------------------

export interface UpsertEntryArgs {
  id: string;
  contestId: string;
  authorId: string;
  title: string;
  videoUrl: string;
  note: string | null;
  snsUrl: string;
}

/**
 * §14.1 — "resubmit while open replaces + resets to pending".
 *
 * ONE statement, so a resubmit can never be observed half-applied: the new content, the reset to
 * `pending`, the cleared rejection and the cleared placement all land together or not at all. The
 * placement is cleared on purpose — a winner who replaces their film is no longer the entry that
 * won, and leaving the medal on new content would be the site lying about a judged result.
 *
 * Returns the row's id, which for a resubmit is the EXISTING one (the `id` argument is only used
 * when a row is actually created).
 */
export async function upsertEntry(sql: SqlRunner, args: UpsertEntryArgs): Promise<string> {
  const { rows } = await sql.query<{ id: string }>(
    `insert into contest_entries (id, contest_id, author_id, title, video_url, note, sns_url, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending')
     on conflict (contest_id, author_id) do update
        set title = excluded.title,
            video_url = excluded.video_url,
            note = excluded.note,
            sns_url = excluded.sns_url,
            status = 'pending',
            reject_reason = null,
            placement = null
     returning id`,
    [args.id, args.contestId, args.authorId, args.title, args.videoUrl, args.note, args.snsUrl],
  );
  return rows[0]!.id;
}

/**
 * Approve — guarded on the entry's VERSION (§14.2 / M9 review).
 *
 * The blocker this closes: a moderation form is rendered against one revision of an entry, and
 * §14.1 lets the entrant replace that revision at any time before the deadline. Without the guard,
 * an Approve pressed after a resubmit blesses content the moderator never watched. With it, the
 * `WHERE` matches nothing and the caller reports "the entry changed — review it again".
 */
export async function approveEntry(
  sql: SqlRunner,
  id: string,
  version: string,
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update contest_entries set status = 'approved', reject_reason = null
      where id = $1 and status in ('pending','rejected') and ${VERSION_EXPR} = $2
      returning id`,
    [id, version],
  );
  return rows.length > 0;
}

export async function rejectEntry(
  sql: SqlRunner,
  id: string,
  reason: string,
  version: string,
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    // `placement = null` in the same statement: rejecting a placed entry must not leave a medal
    // pointing at a hidden row, and the CHECK would refuse the write anyway.
    `update contest_entries set status = 'rejected', reject_reason = $2, placement = null
      where id = $1 and status in ('pending','approved') and ${VERSION_EXPR} = $3
      returning id`,
    [id, reason, version],
  );
  return rows.length > 0;
}

/**
 * Set or clear a placement, with BOTH rules in the statement (§14.1 / M9 review).
 *
 * `UPDATE … FROM contests` rather than a read-then-write: the deadline is compared against the
 * database's own `now()` in the same statement that writes the medal, so a deadline extended
 * between the check and the write cannot leave a placement on a still-open contest. The
 * `status = 'approved'` predicate is the same rule the CHECK enforces, applied where it can produce
 * "no row updated" instead of a constraint name, and the partial unique index is what refuses a
 * second gold — that one stays purely in the database because it is a race, not a rule.
 *
 * Clearing (`null`) skips the deadline test on purpose: correcting a mistake must not need a clock.
 */
export async function setEntryPlacement(
  sql: SqlRunner,
  id: string,
  placement: Placement | null,
): Promise<boolean> {
  // Same serialization point as `updateContest` (M9 R3): lock the contest row before judging, so a
  // deadline extension in flight commits (and refuses us via the predicate) or waits for us (and is
  // then refused by the placement count). The in-statement predicates stay as defense in depth.
  return await sql.transaction(async (tx) => {
    await tx.query(
      `select c.id from contests c
        where c.id = (select contest_id from contest_entries where id = $1)
          for update`,
      [id],
    );
    const { rows } = await tx.query<{ id: string }>(
      `update contest_entries e
          set placement = $2
         from contests c
        where e.id = $1
          and c.id = e.contest_id
          and (
            $2::int is null
            or (e.status = 'approved' and c.deadline_at is not null and c.deadline_at <= now())
          )
        returning e.id`,
      [id, placement],
    );
    return rows.length > 0;
  });
}

/** How many entries of this contest currently hold a medal — the deadline-extension guard's input. */
export async function countPlacedEntries(sql: SqlRunner, contestId: string): Promise<number> {
  if (!UUID.test(contestId)) return 0;
  const { rows } = await sql.query<{ n: number }>(
    'select count(*)::int as n from contest_entries where contest_id = $1 and placement is not null',
    [contestId],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// rate limit (§14.1 — ≤10 entry writes/day/user)
// ---------------------------------------------------------------------------

export async function countRecentEntryWrites(
  sql: SqlRunner,
  authorId: string,
  windowHours: number,
): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from contest_entry_writes
      where author_id = $1 and created_at > now() - ($2 || ' hours')::interval`,
    [authorId, String(windowHours)],
  );
  return rows[0]?.n ?? 0;
}

export async function recordEntryWrite(
  sql: SqlRunner,
  authorId: string,
  contestId: string,
): Promise<void> {
  await sql.query(
    'insert into contest_entry_writes (author_id, contest_id) values ($1, $2)',
    [authorId, contestId],
  );
}

// ---------------------------------------------------------------------------
// profiles.sns_url (§14.1 — prefill + write-back)
// ---------------------------------------------------------------------------

export async function loadProfileSnsUrl(sql: SqlRunner, userId: string): Promise<string | null> {
  const { rows } = await sql.query<{ sns_url: string | null }>(
    'select sns_url from profiles where id = $1',
    [userId],
  );
  return rows[0]?.sns_url ?? null;
}

export async function saveProfileSnsUrl(
  sql: SqlRunner,
  userId: string,
  snsUrl: string,
): Promise<void> {
  await sql.query('update profiles set sns_url = $2 where id = $1', [userId, snsUrl]);
}
