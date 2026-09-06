import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Visibility } from '@/lib/content/visibility';
import type { PromptSource, PromptStatus, TemplateMedium } from './schemas';

/**
 * PLAN §13 — every `prompt_items` query, in one driver-agnostic module.
 *
 * Same seam as `lib/content/catalog.ts` and `lib/admin/repo.ts`: the acceptance tests drive these
 * against real PGlite, the app drives them against Supabase Postgres through `pg`, and neither
 * needs a session — the CALLER supplies the viewer and the shaping happens above.
 *
 * One ordering rule, spelled once and reused by both rails (§13.2 "featured-first, then newest"):
 * `featured desc, published_at desc, created_at desc`. Ties break deterministically on `created_at`
 * so a page rendered twice is the same page.
 */

export interface PromptRow {
  id: string;
  slug: string;
  source: PromptSource;
  authorId: string | null;
  authorHandle: string | null;
  status: PromptStatus;
  models: string[];
  title: string;
  titleKo: string | null;
  promptText: string;
  /** The "how it was made" write-up (markdown), per locale. Null is the common case. */
  processMd: string | null;
  processMdKo: string | null;
  /** Where the creator originally posted it (their SNS post), if they gave a link. */
  sourceUrl: string | null;
  textVisibility: Visibility;
  media: unknown;
  useCase: string[];
  featured: boolean;
  /** docs/TEMPLATES-IA.md — what this template produces; the catalogue's first split. */
  medium: TemplateMedium;
  /** One render, in USD cents. 0 = not for sale yet (the detail page says so, no button). */
  priceCents: number;
  /** Films only; null for an image template (CHECK in 0015). */
  runtimeSeconds: number | null;
  /** docs/TEMPLATES-IA.md §7 — the render engine (lib/images/engines.ts ids); null = the medium's default. */
  engine: string | null;
  /** The aspect the make step opens in ('4:5', '9:16', …); null = the medium's default. */
  aspectDefault: string | null;
  rejectReason: string | null;
  createdAt: string | null;
  publishedAt: string | null;
}

interface RawRow {
  id: string;
  slug: string;
  source: PromptSource;
  author_id: string | null;
  author_handle: string | null;
  status: PromptStatus;
  models: string[];
  title: string;
  title_ko: string | null;
  prompt_text: string;
  process_md: string | null;
  process_md_ko: string | null;
  source_url: string | null;
  text_visibility: Visibility;
  media: unknown;
  use_case: string[] | null;
  featured: boolean;
  medium: TemplateMedium;
  price_cents: number;
  runtime_seconds: number | null;
  engine: string | null;
  aspect_default: string | null;
  reject_reason: string | null;
  created_at: Date | string | null;
  published_at: Date | string | null;
}

const COLUMNS = `id, slug, source, author_id, author_handle, status, models, title, title_ko,
                 prompt_text, process_md, process_md_ko, source_url,
                 text_visibility::text as text_visibility, media, use_case, featured,
                 medium, price_cents, runtime_seconds, engine, aspect_default,
                 reject_reason, created_at, published_at`;

/** §13.2 — the one ordering, so the gallery, the admin list and the sitemap never disagree. */
const RAIL_ORDER = 'featured desc, published_at desc nulls last, created_at desc, slug asc';

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawRow): PromptRow {
  return {
    id: raw.id,
    slug: raw.slug,
    source: raw.source,
    authorId: raw.author_id,
    authorHandle: raw.author_handle,
    status: raw.status,
    models: raw.models ?? [],
    title: raw.title,
    titleKo: raw.title_ko,
    promptText: raw.prompt_text,
    processMd: raw.process_md,
    processMdKo: raw.process_md_ko,
    sourceUrl: raw.source_url,
    textVisibility: raw.text_visibility,
    media: raw.media,
    useCase: raw.use_case ?? [],
    featured: raw.featured,
    medium: raw.medium,
    priceCents: raw.price_cents,
    runtimeSeconds: raw.runtime_seconds,
    engine: raw.engine,
    aspectDefault: raw.aspect_default,
    rejectReason: raw.reject_reason,
    createdAt: toIso(raw.created_at),
    publishedAt: toIso(raw.published_at),
  };
}

// ---------------------------------------------------------------------------
// read paths
// ---------------------------------------------------------------------------

/** Every PUBLISHED item, both rails, in rail order. The gallery's single query. */
export async function loadPublishedPrompts(sql: SqlRunner): Promise<PromptRow[]> {
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from prompt_items where status = 'published' order by ${RAIL_ORDER}`,
  );
  return rows.map(toRow);
}

/**
 * By slug, WHATEVER the status.
 *
 * Deliberately unfiltered: the caller decides what a `pending` row means (404 on the public detail
 * page, an editable card in `/admin/prompts`, a "in review" line on `/account`). A repo that
 * filtered here would need three variants and one of them would drift.
 */
export async function loadPromptBySlug(sql: SqlRunner, slug: string): Promise<PromptRow | null> {
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from prompt_items where slug = $1`,
    [slug],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * By id, with the shape check done HERE rather than at every call site.
 *
 * The id arrives from a URL segment (`/api/prompts/copy/[id]`, `/api/prompts/media/[ref]`), so a
 * malformed one is an ordinary request, not an exception: Postgres would raise `invalid input
 * syntax for type uuid` and turn a 404 into a 500. `null` is the right answer and it is the same
 * answer an unknown-but-well-formed id gets, which is also what a prober should learn.
 */
export async function loadPromptById(sql: SqlRunner, id: string): Promise<PromptRow | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await sql.query<RawRow>(`select ${COLUMNS} from prompt_items where id = $1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * §13.2 detail — "4 related (same source or shared use_case, newest)".
 *
 * Shared use-case first (a genuine relation), then same-rail neighbours (a weak one), so a prompt
 * with an unusual tag still gets a full strip instead of an empty one.
 */
export async function loadRelatedPrompts(
  sql: SqlRunner,
  item: { id: string; source: PromptSource; useCase: string[] },
  limit = 4,
): Promise<PromptRow[]> {
  const { rows } = await sql.query<RawRow & { shared: boolean }>(
    `select ${COLUMNS}, (use_case && $2::text[]) as shared
       from prompt_items
      where status = 'published' and id <> $1
      order by (use_case && $2::text[]) desc,
               (source = $3) desc,
               published_at desc nulls last,
               created_at desc
      limit $4`,
    [item.id, item.useCase, item.source, limit],
  );
  return rows.map(toRow);
}

/** `/account` — "your submissions" (§13.1: slug, status, reject_reason when rejected). */
export async function loadSubmissionsByAuthor(sql: SqlRunner, userId: string): Promise<PromptRow[]> {
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from prompt_items where author_id = $1 order by created_at desc`,
    [userId],
  );
  return rows.map(toRow);
}

/** The moderation queue: pending first (oldest first — a queue), then everything else. */
export async function loadPromptsByStatus(
  sql: SqlRunner,
  status: PromptStatus,
): Promise<PromptRow[]> {
  const order = status === 'pending' ? 'created_at asc' : RAIL_ORDER;
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from prompt_items where status = $1 order by ${order}`,
    [status],
  );
  return rows.map(toRow);
}

export async function loadAllPrompts(sql: SqlRunner): Promise<PromptRow[]> {
  const { rows } = await sql.query<RawRow>(
    `select ${COLUMNS} from prompt_items
      order by (status = 'pending') desc, ${RAIL_ORDER}`,
  );
  return rows.map(toRow);
}

export async function slugExists(sql: SqlRunner, slug: string, exceptId?: string): Promise<boolean> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from prompt_items where slug = $1 and ($2::uuid is null or id <> $2)`,
    [slug, exceptId ?? null],
  );
  return (rows[0]?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// rate limit (§13.1 — 3 submissions/day/user)
// ---------------------------------------------------------------------------

/**
 * How many items this user has created inside the window.
 *
 * Counted over ALL statuses on purpose: a rejected submission still consumed a moderation slot,
 * and letting a rejection refill the quota is exactly the loop an abuser would run.
 */
export async function countRecentSubmissions(
  sql: SqlRunner,
  userId: string,
  windowHours: number,
): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n from prompt_items
      where author_id = $1 and created_at > now() - ($2 || ' hours')::interval`,
    [userId, String(windowHours)],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// write paths
// ---------------------------------------------------------------------------

export interface InsertPromptArgs {
  id: string;
  slug: string;
  source: PromptSource;
  authorId: string | null;
  authorHandle: string | null;
  status: PromptStatus;
  models: string[];
  title: string;
  titleKo: string | null;
  promptText: string;
  processMd?: string | null;
  processMdKo?: string | null;
  sourceUrl?: string | null;
  textVisibility: Visibility;
  media: unknown;
  useCase: string[];
  featured: boolean;
  /** docs/TEMPLATES-IA.md — default 'video' / 0 / null: a row born before templates is a video not yet for sale. */
  medium?: TemplateMedium;
  priceCents?: number;
  runtimeSeconds?: number | null;
  engine?: string | null;
  aspectDefault?: string | null;
  /**
   * Written in the SAME statement as the status, never after it: the
   * `prompt_items_reject_reason_present` CHECK fires at INSERT, so a two-step "insert rejected,
   * then explain why" is rejected by the database — correctly.
   */
  rejectReason?: string | null;
  /** Set only when the row is born published (YAGI authoring); pending rows have none. */
  publishedAt?: 'now' | null;
}

export async function insertPrompt(sql: SqlRunner, args: InsertPromptArgs): Promise<void> {
  await sql.query(
    `insert into prompt_items
       (id, slug, source, author_id, author_handle, status, models, title, title_ko,
        prompt_text, process_md, process_md_ko, source_url,
        text_visibility, media, use_case, featured, reject_reason, published_at,
        medium, price_cents, runtime_seconds, engine, aspect_default)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14::visibility, $15::jsonb, $16, $17, $18,
             case when $19::boolean then now() else null end,
             $20, $21, $22, $23, $24)`,
    [
      args.id,
      args.slug,
      args.source,
      args.authorId,
      args.authorHandle,
      args.status,
      args.models,
      args.title,
      args.titleKo,
      args.promptText,
      args.processMd ?? null,
      args.processMdKo ?? null,
      args.sourceUrl ?? null,
      args.textVisibility,
      args.media === null || args.media === undefined ? null : JSON.stringify(args.media),
      args.useCase,
      args.featured,
      args.rejectReason ?? null,
      args.publishedAt === 'now',
      args.medium ?? 'video',
      args.priceCents ?? 0,
      args.runtimeSeconds ?? null,
      args.engine ?? null,
      args.aspectDefault ?? null,
    ],
  );
}

/** Stamp the published media refs back onto the row after the copier has run (§13.1 lifecycle). */
export async function updatePromptMedia(
  sql: SqlRunner,
  id: string,
  media: unknown,
): Promise<void> {
  await sql.query('update prompt_items set media = $2::jsonb where id = $1', [
    id,
    media === null || media === undefined ? null : JSON.stringify(media),
  ]);
}

export interface UpdatePromptArgs {
  id: string;
  slug: string;
  title: string;
  titleKo: string | null;
  promptText: string;
  processMd?: string | null;
  processMdKo?: string | null;
  sourceUrl?: string | null;
  useCase: string[];
  authorHandle: string | null;
  textVisibility: Visibility;
  featured: boolean;
  models: string[];
  /** Omitted ⇒ unchanged (a form that predates templates keeps what the row had). */
  medium?: TemplateMedium;
  priceCents?: number;
  runtimeSeconds?: number | null;
  engine?: string | null;
  aspectDefault?: string | null;
}

export async function updatePrompt(sql: SqlRunner, args: UpdatePromptArgs): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update prompt_items
        set slug = $2, title = $3, title_ko = $4, prompt_text = $5, use_case = $6,
            author_handle = $7, text_visibility = $8::visibility, featured = $9,
            process_md = $10, process_md_ko = $11, source_url = $12, models = $13,
            medium = coalesce($14, medium),
            price_cents = coalesce($15::int, price_cents),
            runtime_seconds = case when $16::boolean then $17::int else runtime_seconds end,
            engine = case when $18::boolean then $19::text else engine end,
            aspect_default = case when $20::boolean then $21::text else aspect_default end
      where id = $1
      returning id`,
    [
      args.id,
      args.slug,
      args.title,
      args.titleKo,
      args.promptText,
      args.useCase,
      args.authorHandle,
      args.textVisibility,
      args.featured,
      args.processMd ?? null,
      args.processMdKo ?? null,
      args.sourceUrl ?? null,
      args.models,
      args.medium ?? null,
      args.priceCents ?? null,
      args.runtimeSeconds !== undefined,
      args.runtimeSeconds ?? null,
      args.engine !== undefined,
      args.engine ?? null,
      args.aspectDefault !== undefined,
      args.aspectDefault ?? null,
    ],
  );
  return rows.length > 0;
}

/** Approval: pending → published, with the editable fields applied in the same statement. */
export async function approvePrompt(
  sql: SqlRunner,
  args: { id: string; slug: string; authorHandle: string | null; useCase: string[]; featured: boolean },
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update prompt_items
        set status = 'published',
            slug = $2, author_handle = $3, use_case = $4, featured = $5,
            reject_reason = null,
            published_at = coalesce(published_at, now())
      where id = $1 and status in ('pending','rejected')
      returning id`,
    [args.id, args.slug, args.authorHandle, args.useCase, args.featured],
  );
  return rows.length > 0;
}

export async function rejectPrompt(sql: SqlRunner, id: string, reason: string): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update prompt_items set status = 'rejected', reject_reason = $2
      where id = $1 and status = 'pending'
      returning id`,
    [id, reason],
  );
  return rows.length > 0;
}

export async function setPromptFeatured(
  sql: SqlRunner,
  id: string,
  featured: boolean,
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    'update prompt_items set featured = $2 where id = $1 returning id',
    [id, featured],
  );
  return rows.length > 0;
}

/**
 * Founder direction (2026-08-13): free presets are a one-press decision, not a form edit. YAGI
 * rows only — a community row is always public (§13.3-1, and the CHECK underneath would refuse
 * anyway), so the guard makes "not a YAGI prompt" read as notFound rather than a constraint error.
 */
export async function setPromptTextVisibility(
  sql: SqlRunner,
  id: string,
  visibility: 'public' | 'pro',
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update prompt_items set text_visibility = $2 where id = $1 and source = 'yagi' returning id`,
    [id, visibility],
  );
  return rows.length > 0;
}

/** §13.1/F — "unpublish → archived". Never a delete: the slug stays taken and the row stays audit. */
export async function setPromptArchived(
  sql: SqlRunner,
  id: string,
  archived: boolean,
): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update prompt_items
        set status = case when $2::boolean then 'archived' else 'published' end,
            published_at = case when $2::boolean then published_at else coalesce(published_at, now()) end
      where id = $1 and status in ('published','archived')
      returning id`,
    [id, archived],
  );
  return rows.length > 0;
}
