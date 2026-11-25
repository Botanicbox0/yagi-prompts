/**
 * The home's news slot, server side (docs/BRAND-PROJECT-SPINE.md §6, slice 3b; migrations 0196/0197).
 *
 * Three readers and one writer for members, all asking the same questions in the same order:
 *  1. Is the slot open: `BRAND_NEWS=on` (lib/flags.ts) AND both tables exist (a remembered probe, as the spine's
 *     columns are probed). While the switch is off nothing touches the database.
 *  2. May this person see announcements in this organization at all (`newsSeat`): the organization exists, it is
 *     not the sandboxed client (id or name) and generation is not closed for it — the two gates the project rooms
 *     run first (lib/brand-rooms/access.ts `roomAudience`) — then an active membership (a project guest and TWINGS
 *     staff who are not members get nothing), then 직접 만들기 (`self_studio`) open.
 *  3. Which live announcement, inside its period, not closed by this person, does the audience give this
 *     organization: the most recently started one.
 * Nothing about another organization, an announcement's audience or its author ever leaves through these answers.
 *
 * The admin side (lib/admin/brand-news-operations.ts) writes; the two admin reads below serve `/admin/brand-news`.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from '@/lib/content/asset-url';
import { assertBrandFeature, BrandFeatureDenied, isSandboxedClientOrganization, loadFeaturePolicies } from '@/lib/brands/entitlements';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandNewsOpen, brandRoomsOpen, brandStudioV2Open } from '@/lib/flags';
import {
  BRAND_NEWS_LIMITS,
  BRAND_NEWS_PLANS,
  announcementAnswer,
  audienceAdmits,
  isUuid,
  parseBrandNewsAudience,
  publishRefusals,
  type BrandNewsAdminItem,
  type BrandNewsAudience,
  type BrandNewsDismissOutcome,
  type BrandNewsMode,
  type BrandNewsPlan,
  type BrandNewsShape,
  type BrandNewsSlot,
  type BrandNewsStatus,
  type BrandNewsWords,
  type HomeAnnouncement,
} from './contracts';

type Env = Record<string, string | undefined>;

export interface BrandNewsDeps {
  sql: SqlRunner;
  /** Stored picture key → address. Defaults to the public bucket (`publicContentUrl`); null where nothing serves it. */
  imageUrl?: (key: string) => string | null;
}

const defaultImageUrl = (key: string): string | null => publicContentUrl(key);

/* ------------------------------------------------------------- readiness */

const RECHECK_MS = 60_000;
let probe: { ready: boolean; at: number } | null = null;

/**
 * True once both tables of migration 0196 exist. A miss is looked up again after a minute, so applying the
 * migration needs no redeploy; a hit is kept (the spine's column probe, lib/brands/project-origin.ts).
 */
export async function brandNewsTablesReady(sql: SqlRunner, now = Date.now()): Promise<boolean> {
  if (probe && (probe.ready || now - probe.at < RECHECK_MS)) return probe.ready;
  const found = await sql.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = current_schema() and table_name in ('brand_announcements', 'brand_announcement_dismissals')`,
  );
  probe = { ready: Number(found.rows[0]?.n ?? 0) === 2, at: now };
  return probe.ready;
}

/** Forget the lookup (tests change the schema under one process). */
export function resetBrandNewsProbe(): void {
  probe = null;
}

/** The switch, then the tables. While the switch says closed the database is not asked anything. */
export async function brandNewsReady(sql: SqlRunner, env: Env = process.env): Promise<boolean> {
  if (!brandNewsOpen(env)) return false;
  return brandNewsTablesReady(sql);
}

/* ------------------------------------------------------------------ seat */

/**
 * May `viewer` see announcements in this organization: the organization's two hardline gates first (sandboxed,
 * generation closed), then an active membership, then 직접 만들기 open. Null on any no, and on malformed input.
 * Never inside a transaction (the policy reads tolerate a table that is not there yet).
 */
async function newsSeat(sql: SqlRunner, viewer: Viewer, organizationId: unknown): Promise<{ organizationId: string; userId: string } | null> {
  if (!isUuid(viewer.userId) || !isUuid(organizationId)) return null;
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) return null;
  try {
    await assertBrandFeature(sql, organizationId, 'generative_media');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) return null;
    throw error;
  }
  const member = (
    await sql.query("select 1 from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active'", [organizationId, viewer.userId])
  ).rows[0];
  if (!member) return null;
  try {
    await assertBrandFeature(sql, organizationId, 'self_studio');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) return null;
    throw error;
  }
  return { organizationId: organizationId.toLowerCase(), userId: viewer.userId };
}

/** The homes an organization of an open seat has: 직접 만들기 always, 야기 팀과 while project rooms are open. */
function homesOf(env: Env): BrandNewsMode[] {
  return brandRoomsOpen(env as NodeJS.ProcessEnv) ? ['make', 'team'] : ['make'];
}

/** The plan key of a stored `plan_id` (null: no active assignment). */
function planKey(raw: unknown): BrandNewsPlan | 'other' {
  if (raw === null || raw === undefined) return 'none';
  const value = String(raw);
  return (BRAND_NEWS_PLANS as readonly string[]).includes(value) && value !== 'none' ? (value as BrandNewsPlan) : 'other';
}

/** The organization's plan today (KST calendar day), as entitlements reads `project_only`. */
const ACTIVE_PLAN = (orgParam: string) =>
  `(select p.plan_id from brand_plan_assignments p
     where p.organization_id = ${orgParam}
       and p.started_on <= (now() at time zone 'Asia/Seoul')::date
       and (p.ends_on is null or (now() at time zone 'Asia/Seoul')::date < p.ends_on))`;

const WORD_COLUMNS =
  'a.id::text as id, a.kicker_ko, a.kicker_en, a.title_ko, a.title_en, a.cta_label_ko, a.cta_label_en, a.cta_href, a.shape, a.image_key, a.image_w, a.image_h';

interface WordRow {
  id: string;
  kicker_ko: string;
  kicker_en: string;
  title_ko: string;
  title_en: string;
  cta_label_ko: string;
  cta_label_en: string;
  cta_href: string;
  shape: string;
  image_key: string | null;
  image_w: number | null;
  image_h: number | null;
}

function wordsOf(row: WordRow): BrandNewsWords {
  return {
    id: String(row.id),
    kickerKo: String(row.kicker_ko ?? ''),
    kickerEn: String(row.kicker_en ?? ''),
    titleKo: String(row.title_ko ?? ''),
    titleEn: String(row.title_en ?? ''),
    ctaLabelKo: String(row.cta_label_ko ?? ''),
    ctaLabelEn: String(row.cta_label_en ?? ''),
    ctaHref: String(row.cta_href ?? ''),
    shape: (row.shape === 'banner' ? 'banner' : 'line') as BrandNewsShape,
    imageKey: row.image_key == null ? null : String(row.image_key),
    imageWidth: row.image_w == null ? null : Number(row.image_w),
    imageHeight: row.image_h == null ? null : Number(row.image_h),
  };
}

/** Live, inside its period (an announcement past its end is ended for every reader, pressed or not). */
const SHOWING = (alias: string) => `${alias}.status = 'live' and ${alias}.starts_at <= now() and now() < ${alias}.ends_at`;

/** At most this many live rows are looked at (the unique index allows one per slot; this only bounds the read). */
const CANDIDATES_MAX = 10;

/* -------------------------------------------------------------- home read */

/**
 * The one announcement the home of `mode` shows this person in this organization, in `locale`, or null.
 *
 * Null when: the switch is off (no statement), the tables are missing, the organization is closed (sandboxed,
 * generation closed, 직접 만들기 closed), the person is not an active member (a project guest, TWINGS staff), studio
 * v2 is off, `mode` is 'team' while project rooms are off, or no live announcement inside its period whose audience
 * takes this organization and this home is left that this person has not closed. A failed read is also null (the
 * slot is never worth a broken home). A constant number of statements, whatever is stored.
 */
export async function loadHomeAnnouncement(
  deps: BrandNewsDeps,
  viewer: Viewer,
  input: { organizationId: string; mode: BrandNewsMode; locale: 'ko' | 'en' },
  env: Env = process.env,
): Promise<HomeAnnouncement | null> {
  if (!brandNewsOpen(env) || !brandStudioV2Open(env as NodeJS.ProcessEnv)) return null;
  if (input.mode !== 'make' && input.mode !== 'team') return null;
  if (input.mode === 'team' && !brandRoomsOpen(env as NodeJS.ProcessEnv)) return null;
  try {
    if (!(await brandNewsTablesReady(deps.sql))) return null;
    const seat = await newsSeat(deps.sql, viewer, input.organizationId);
    if (!seat) return null;
    const rows = (
      await deps.sql.query<WordRow & { audience: unknown; plan_id: string | null }>(
        `select ${WORD_COLUMNS}, a.audience, ${ACTIVE_PLAN('$2::uuid')} as plan_id
           from brand_announcements a
          where a.slot = 'home' and ${SHOWING('a')}
            and not exists (select 1 from brand_announcement_dismissals d where d.announcement_id = a.id and d.user_id = $1)
          order by a.starts_at desc, a.id desc
          limit ${CANDIDATES_MAX}`,
        [seat.userId, seat.organizationId],
      )
    ).rows;
    const locale = input.locale === 'en' ? 'en' : 'ko';
    for (const row of rows) {
      const audience = parseBrandNewsAudience(row.audience);
      if (!audience) continue;
      if (!audienceAdmits(audience, { organizationId: seat.organizationId, plan: planKey(row.plan_id), modes: [input.mode] })) continue;
      const answer = announcementAnswer(wordsOf(row), locale, {
        imageUrl: deps.imageUrl ?? defaultImageUrl,
        scope: (path) => scopedHref(path, { id: seat.organizationId }),
      });
      if (answer) return answer;
    }
    return null;
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('[brand-news] home read failed', error instanceof Error ? error.message : error);
    return null;
  }
}

/* ---------------------------------------------------------------- dismiss */

/** The answer while the slot is closed: the route then answers exactly like an unknown operation. */
export const BRAND_NEWS_CLOSED = 'closed' as const;

/**
 * Close an announcement for this person, for good (`news.dismiss`). Idempotent. Anything this person could not have
 * been shown — a made-up or malformed id, a draft, an ended one or one past its period, another audience, an
 * organization they are not a member of or that is closed — answers `not_found`, the same as an unknown id, so the
 * answer never tells whether an id exists. "Could have been shown" ignores whether they already closed it and counts
 * every home this organization has (the server does not know which one the browser drew).
 */
export async function dismissHomeAnnouncement(
  deps: Pick<BrandNewsDeps, 'sql'>,
  viewer: Viewer,
  input: unknown,
  env: Env = process.env,
): Promise<BrandNewsDismissOutcome | typeof BRAND_NEWS_CLOSED> {
  if (!(await brandNewsReady(deps.sql, env))) return BRAND_NEWS_CLOSED;
  const notFound: BrandNewsDismissOutcome = { ok: false, code: 'not_found' };
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (!brandStudioV2Open(env as NodeJS.ProcessEnv) || !isUuid(raw.announcementId)) return notFound;
  const seat = await newsSeat(deps.sql, viewer, raw.organizationId);
  if (!seat) return notFound;
  const announcementId = raw.announcementId.toLowerCase();
  const row = (
    await deps.sql.query<WordRow & { audience: unknown; plan_id: string | null }>(
      `select ${WORD_COLUMNS}, a.audience, ${ACTIVE_PLAN('$2::uuid')} as plan_id
         from brand_announcements a
        where a.id = $1 and a.slot = 'home' and ${SHOWING('a')}`,
      [announcementId, seat.organizationId],
    )
  ).rows[0];
  if (!row) return notFound;
  const audience = parseBrandNewsAudience(row.audience);
  if (!audience || !audienceAdmits(audience, { organizationId: seat.organizationId, plan: planKey(row.plan_id), modes: homesOf(env) })) return notFound;
  if (!announcementAnswer(wordsOf(row), 'ko', { imageUrl: () => null, scope: (path) => path })) return notFound;
  await deps.sql.query(
    'insert into brand_announcement_dismissals (announcement_id, user_id) values ($1, $2) on conflict (announcement_id, user_id) do nothing',
    [announcementId, seat.userId],
  );
  return { ok: true };
}

/* ------------------------------------------------------------ admin reads */

export type BrandNewsAdminRefusal = 'forbidden' | 'disabled' | 'notFound';

interface AdminRow extends WordRow {
  slot: string;
  status: string;
  showing: boolean;
  over: boolean;
  starts_at: Date | string;
  ends_at: Date | string;
  audience: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
  ended_at: Date | string | null;
  db_now: Date | string;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

/**
 * `/admin/brand-news`: the announcements, newest first, at most `BRAND_NEWS_LIMITS.adminList`. Admins only (the page
 * runs `requireAdmin()` first; this refuses again on the viewer). `disabled` while the slot is closed.
 */
export async function loadBrandNewsAdmin(
  deps: BrandNewsDeps,
  viewer: Viewer,
  env: Env = process.env,
): Promise<{ ok: true; items: BrandNewsAdminItem[]; limit: number } | { ok: false; code: BrandNewsAdminRefusal }> {
  if (!viewer.isAdmin) return { ok: false, code: 'forbidden' };
  if (!(await brandNewsReady(deps.sql, env))) return { ok: false, code: 'disabled' };
  const limit = BRAND_NEWS_LIMITS.adminList;
  const rows = (
    await deps.sql.query<AdminRow>(
      `select ${WORD_COLUMNS}, a.slot, a.status, (${SHOWING('a')}) as showing, (a.ends_at <= now()) as over,
              a.starts_at, a.ends_at, a.audience, a.created_at, a.updated_at, a.published_at, a.ended_at, now() as db_now
         from brand_announcements a
        order by a.created_at desc, a.id desc
        limit $1`,
      [limit],
    )
  ).rows;
  const imageUrl = deps.imageUrl ?? defaultImageUrl;
  const items = rows.map((row): BrandNewsAdminItem => {
    const words = wordsOf(row);
    const status = row.status as BrandNewsStatus;
    const refusals =
      status === 'draft'
        ? publishRefusals({ ...words, status, startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), audience: row.audience }, new Date(row.db_now))
        : ['notDraft' as const];
    return {
      ...words,
      slot: row.slot as BrandNewsSlot,
      status,
      showing: Boolean(row.showing),
      over: Boolean(row.over),
      imageUrl: words.imageKey ? imageUrl(words.imageKey) : null,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      audience: parseBrandNewsAudience(row.audience),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      publishedAt: row.published_at == null ? null : iso(row.published_at),
      endedAt: row.ended_at == null ? null : iso(row.ended_at),
      publishable: refusals.length === 0 ? { ok: true } : { ok: false, reasons: refusals },
    };
  });
  return { ok: true, items, limit };
}

/**
 * How many organizations an audience reaches now, by the home read's rule: open (not sandboxed, generation and
 * 직접 만들기 open), at least one active member, and taken by the audience on one of the homes it names that the
 * organization has (야기 팀과 only while project rooms are open). While studio v2 is off there is no home to show it on,
 * so the count is 0, as the read answers null. A number only: no organization is named. A constant number of
 * statements, whatever the number of organizations.
 */
export async function countBrandNewsReach(sql: SqlRunner, audience: BrandNewsAudience, env: Env = process.env): Promise<number> {
  if (!brandStudioV2Open(env as NodeJS.ProcessEnv)) return 0;
  const listed = audience.orgs ?? null;
  const orgs = (
    await sql.query<{ id: string; name: string }>(
      listed ? 'select id::text as id, name from brand_organizations where id = any($1::uuid[])' : 'select id::text as id, name from brand_organizations',
      listed ? [listed] : [],
    )
  ).rows.filter((org) => !isSandboxedClientOrganization(org));
  if (orgs.length === 0) return 0;
  const ids = orgs.map((org) => String(org.id).toLowerCase());
  const denied = await loadFeaturePolicies(sql, ids);
  const open = ids.filter((id) => {
    const closed = denied[id] ?? [];
    return !closed.includes('generative_media') && !closed.includes('self_studio');
  });
  if (open.length === 0) return 0;
  const members = new Set(
    (
      await sql.query<{ organization_id: string }>(
        "select distinct organization_id::text as organization_id from brand_memberships where status = 'active' and organization_id = any($1::uuid[])",
        [open],
      )
    ).rows.map((row) => String(row.organization_id).toLowerCase()),
  );
  const plans = new Map(
    (
      await sql.query<{ organization_id: string; plan_id: string }>(
        `select p.organization_id::text as organization_id, p.plan_id from brand_plan_assignments p
          where p.organization_id = any($1::uuid[])
            and p.started_on <= (now() at time zone 'Asia/Seoul')::date
            and (p.ends_on is null or (now() at time zone 'Asia/Seoul')::date < p.ends_on)`,
        [open],
      )
    ).rows.map((row) => [String(row.organization_id).toLowerCase(), row.plan_id] as const),
  );
  const homes = homesOf(env);
  return open.filter((id) => members.has(id) && audienceAdmits(audience, { organizationId: id, plan: planKey(plans.get(id) ?? null), modes: homes }))
    .length;
}

/** `/admin/brand-news`: the reach of one stored announcement (a draft, typically), as a number. Admins only. */
export async function loadBrandNewsReach(
  deps: Pick<BrandNewsDeps, 'sql'>,
  viewer: Viewer,
  announcementId: string,
  env: Env = process.env,
): Promise<{ ok: true; organizations: number } | { ok: false; code: BrandNewsAdminRefusal }> {
  if (!viewer.isAdmin) return { ok: false, code: 'forbidden' };
  if (!(await brandNewsReady(deps.sql, env))) return { ok: false, code: 'disabled' };
  if (!isUuid(announcementId)) return { ok: false, code: 'notFound' };
  const row = (await deps.sql.query<{ audience: unknown }>('select audience from brand_announcements where id = $1', [announcementId])).rows[0];
  if (!row) return { ok: false, code: 'notFound' };
  const audience = parseBrandNewsAudience(row.audience);
  // A stored audience that does not parse is never shown: it reaches nobody.
  if (!audience) return { ok: true, organizations: 0 };
  return { ok: true, organizations: await countBrandNewsReach(deps.sql, audience, env) };
}
