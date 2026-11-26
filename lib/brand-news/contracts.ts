/**
 * The home's news slot, shapes and rules (docs/BRAND-PROJECT-SPINE.md §6, slice 3b; migration 0196).
 *
 * Pure: no database, no environment, no server-only import, so the admin page, the home and the client method can
 * all read the same limits and types. The server (./service.ts) and the admin operations
 * (lib/admin/brand-news-operations.ts) judge every input with the functions here; migration 0196's table checks are
 * the backstop for the same rules.
 */
import { z } from 'zod';

export const BRAND_NEWS_SLOTS = ['home', 'team_home'] as const;
export type BrandNewsSlot = (typeof BRAND_NEWS_SLOTS)[number];

export const BRAND_NEWS_SHAPES = ['line', 'banner'] as const;
export type BrandNewsShape = (typeof BRAND_NEWS_SHAPES)[number];

export const BRAND_NEWS_STATUSES = ['draft', 'live', 'ended'] as const;
export type BrandNewsStatus = (typeof BRAND_NEWS_STATUSES)[number];

/** The workspace's two rail modes (components/brand-workspace/rail-mode.ts): each has its own home. */
export const BRAND_NEWS_MODES = ['make', 'team'] as const;
export type BrandNewsMode = (typeof BRAND_NEWS_MODES)[number];
/** Default target mode per slot when an audience omits `modes` (direct home vs YAGI team home). */
export const BRAND_NEWS_SLOT_DEFAULT_MODES: Record<BrandNewsSlot, readonly BrandNewsMode[]> = {
  home: ['make'],
  team_home: ['team'],
};
/** An audience without `modes` in the `home` slot reaches the 직접 만들기 home only (design §6: "기본 대상은 … 직접 만들기 홈"). */
export const BRAND_NEWS_DEFAULT_MODES: readonly BrandNewsMode[] = BRAND_NEWS_SLOT_DEFAULT_MODES.home;

/**
 * The plan an organization is on today (lib/brands/plans.ts `BRAND_PLAN_IDS`, an assignment active in KST), or
 * `none` when it has no active assignment (a workspace on trial). `project_only` is not offered: such an
 * organization has 직접 만들기 closed and never sees an announcement.
 */
export const BRAND_NEWS_PLANS = ['b2b_29', 'b2b_49', 'b2b_69', 'none'] as const;
export type BrandNewsPlan = (typeof BRAND_NEWS_PLANS)[number];

export const BRAND_NEWS_LIMITS = {
  /** Characters (code points, as `char_length` counts them) per language. */
  kickerChars: 12,
  titleChars: 60,
  ctaLabelChars: 12,
  hrefChars: 500,
  /** `ends_at - starts_at`, at most. */
  periodMaxDays: 60,
  /** `audience.orgs`, at most. */
  audienceOrgsMax: 50,
  /** The admin list, newest first. */
  adminList: 50,
  /** The banner picture as stored: WebP, exactly this size, at most this many bytes. */
  image: { width: 1600, height: 400, maxBytes: 400 * 1024, mime: 'image/webp' },
  /** What the admin form may post before it is re-encoded (the landing media limit). */
  imageUploadMaxBytes: 20 * 1024 * 1024,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Code points, as Postgres `char_length` counts them (a surrogate pair is one). */
export const charCount = (value: string): number => Array.from(value).length;

/* ------------------------------------------------------------------ link */

const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f-\uffff]/;
/** A `%` that does not start two hex digits, or one that encodes a control character (`%00` to `%1F`, `%7F`). */
const BAD_ESCAPE = /%(?![0-9a-f]{2})|%[01][0-9a-f]|%7f/i;
const INTERNAL_PREFIX = '/brand/';
/** Lower-case labels only, no user, no port: `twings.app` or a subdomain of it, then a path, query or fragment. */
const TWINGS_HTTPS = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*twings\.app)(?:[/?#].*)?$/;

export type BrandNewsLinkRefusal = 'empty' | 'tooLong' | 'characters' | 'notAllowed' | 'traversal';

/**
 * The button's link (design §6, brief §2.5). Allowed:
 *  - an internal path that starts with `/brand/`, with no `//` anywhere, no backslash, no scheme, no dot segment
 *    (`.` or `..`, also percent-encoded), and no encoded slash or backslash inside a segment;
 *  - an `https://` address (lower-case scheme and host) whose host is exactly `twings.app` or a subdomain of it,
 *    with no user and no port.
 * Every character must be printable ASCII (percent-encode anything else); no space or control character, raw or
 * percent-encoded; every `%` starts a valid escape; at most one `#`. So the link is stored, scoped and followed as
 * written (lib/brands/workspace/selection.ts `scopedHref` only adds `organizationId` to the query).
 */
export function judgeBrandNewsLink(raw: string): { ok: true; href: string; external: boolean } | { ok: false; reason: BrandNewsLinkRefusal } {
  if (raw === '') return { ok: false, reason: 'empty' };
  if (raw.length > BRAND_NEWS_LIMITS.hrefChars) return { ok: false, reason: 'tooLong' };
  if (CONTROL_OR_SPACE.test(raw) || raw.includes('\\') || BAD_ESCAPE.test(raw) || raw.indexOf('#') !== raw.lastIndexOf('#')) {
    return { ok: false, reason: 'characters' };
  }
  if (raw.startsWith(INTERNAL_PREFIX)) {
    if (raw.includes('//')) return { ok: false, reason: 'notAllowed' };
    const path = raw.split(/[?#]/, 1)[0]!;
    for (const segment of path.split('/')) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return { ok: false, reason: 'characters' };
      }
      if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return { ok: false, reason: 'traversal' };
    }
    return { ok: true, href: raw, external: false };
  }
  const match = TWINGS_HTTPS.exec(raw);
  if (!match) return { ok: false, reason: 'notAllowed' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'notAllowed' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '' || url.hostname !== match[1]) {
    return { ok: false, reason: 'notAllowed' };
  }
  return { ok: true, href: raw, external: true };
}

/* -------------------------------------------------------------- audience */

/**
 * Who may see an announcement, on top of the gates every announcement passes (an open organization, a member,
 * 직접 만들기 open). Every key narrows; an absent key does not. Unknown keys are refused when saving
 * (`.strict()`), and a stored audience that does not parse is never shown (the read fails closed).
 *  - `modes`: which homes show it (absent: the 직접 만들기 home only);
 *  - `plans`: only organizations on one of these plans today;
 *  - `orgs`: ONLY these organizations (how a new announcement is tried on a test organization first).
 */
export const BrandNewsAudienceSchema = z
  .object({
    modes: z.array(z.enum(BRAND_NEWS_MODES)).min(1).max(BRAND_NEWS_MODES.length).optional(),
    plans: z.array(z.enum(BRAND_NEWS_PLANS)).min(1).max(BRAND_NEWS_PLANS.length).optional(),
    orgs: z.array(z.string().regex(UUID)).min(1).max(BRAND_NEWS_LIMITS.audienceOrgsMax).optional(),
  })
  .strict();
export type BrandNewsAudience = z.infer<typeof BrandNewsAudienceSchema>;

/** Parsed, de-duplicated, ids in lower case; null when it is not a valid audience. */
export function parseBrandNewsAudience(value: unknown): BrandNewsAudience | null {
  const parsed = BrandNewsAudienceSchema.safeParse(value);
  if (!parsed.success) return null;
  const out: BrandNewsAudience = {};
  if (parsed.data.modes) out.modes = [...new Set(parsed.data.modes)];
  if (parsed.data.plans) out.plans = [...new Set(parsed.data.plans)];
  if (parsed.data.orgs) out.orgs = [...new Set(parsed.data.orgs.map((id) => id.toLowerCase()))];
  return out;
}

/** Slot `'home'` only ever renders on `'make'`; `'team'` mode belongs exclusively to slot `'team_home'`. */
export const homeSlotModesValid = (slot: BrandNewsSlot, audience: BrandNewsAudience): boolean =>
  slot !== 'home' || !audience.modes?.some((mode) => mode !== 'make');

/**
 * Does the audience take this organization, on one of `modes` (the homes in question: the one being drawn, or
 * every home the organization has when the question is "could this person ever have been shown it")?
 */
export function audienceAdmits(
  audience: BrandNewsAudience,
  who: { organizationId: string; plan: BrandNewsPlan | 'other'; modes: readonly BrandNewsMode[] },
  slot: BrandNewsSlot = 'home',
): boolean {
  const modes = audience.modes ?? BRAND_NEWS_SLOT_DEFAULT_MODES[slot];
  if (!who.modes.some((mode) => modes.includes(mode))) return false;
  if (audience.plans && !(audience.plans as readonly string[]).includes(who.plan)) return false;
  if (audience.orgs && !audience.orgs.includes(who.organizationId.toLowerCase())) return false;
  return true;
}

/* ---------------------------------------------------------------- answers */

/** What the home line needs, in the viewer's language. Nothing about the audience, the author or anyone else. */
export interface HomeAnnouncement {
  id: string;
  /** Null: the screen shows its default kicker. */
  kicker: string | null;
  title: string;
  /** Null: the screen shows its default button label. */
  ctaLabel: string | null;
  /** An internal path already carries `organizationId` (like every workspace link); an external one is as stored. */
  href: string;
  /** True for an `https://…twings.app` address (another page of ours, not this workspace). */
  external: boolean;
  shape: BrandNewsShape;
  /** A banner's picture; null for a line. */
  image: { url: string; width: number; height: number } | null;
}

/** The stored row's words, as the read and the admin preview both use them. */
export interface BrandNewsWords {
  id: string;
  kickerKo: string;
  kickerEn: string;
  titleKo: string;
  titleEn: string;
  ctaLabelKo: string;
  ctaLabelEn: string;
  ctaHref: string;
  shape: BrandNewsShape;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

/** The viewer's language first, the other one when it is empty, null when both are. */
function pick(locale: 'ko' | 'en', ko: string, en: string): string | null {
  const first = locale === 'en' ? en : ko;
  const second = locale === 'en' ? ko : en;
  return first !== '' ? first : second !== '' ? second : null;
}

/**
 * The line as the home draws it, or null when the row cannot be drawn (no title in either language, or a link the
 * rule refuses). `imageUrl` turns a stored key into an address; a banner whose picture has no address here (local
 * mode serves no public bucket) is answered as a line, so the words still show. `scope` adds `organizationId` to an
 * internal path (null: the admin preview, which has no workspace).
 */
export function announcementAnswer(
  row: BrandNewsWords,
  locale: 'ko' | 'en',
  options: { imageUrl: (key: string) => string | null; scope: (path: string) => string },
): HomeAnnouncement | null {
  const title = pick(locale, row.titleKo, row.titleEn);
  if (title === null) return null;
  const link = judgeBrandNewsLink(row.ctaHref);
  if (!link.ok) return null;
  const url = row.shape === 'banner' && row.imageKey ? options.imageUrl(row.imageKey) : null;
  const banner = url !== null && row.imageWidth !== null && row.imageHeight !== null;
  return {
    id: row.id,
    kicker: pick(locale, row.kickerKo, row.kickerEn),
    title,
    ctaLabel: pick(locale, row.ctaLabelKo, row.ctaLabelEn),
    href: link.external ? link.href : options.scope(link.href),
    external: link.external,
    shape: banner ? 'banner' : 'line',
    image: banner ? { url: url!, width: row.imageWidth!, height: row.imageHeight! } : null,
  };
}

/* ------------------------------------------------------------ admin shapes */

export interface BrandNewsAdminItem extends BrandNewsWords {
  slot: BrandNewsSlot;
  status: BrandNewsStatus;
  /** Live and inside its period now: what the homes show. */
  showing: boolean;
  /** Its period has ended (the home treats a live row as ended from then on). */
  over: boolean;
  /** The banner picture's address (null without a picture, or where the public bucket is not served). */
  imageUrl: string | null;
  startsAt: string;
  endsAt: string;
  /** As stored. `null` when a hand-written row does not parse (it is then never shown). */
  audience: BrandNewsAudience | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  endedAt: string | null;
  /** For a draft: whether `brandNews.publish` would accept it now, and if not, every reason. */
  publishable: { ok: true } | { ok: false; reasons: BrandNewsPublishRefusal[] };
}

export type BrandNewsPublishRefusal = 'notDraft' | 'titleKo' | 'titleEn' | 'link' | 'image' | 'period' | 'over' | 'audience' | 'audienceModes';

/** The `brandNews.publish` rules, for a row as stored (also shown on the admin list). */
export function publishRefusals(
  row: Pick<BrandNewsWords, 'titleKo' | 'titleEn' | 'ctaHref' | 'shape' | 'imageKey'> & {
    slot?: BrandNewsSlot;
    status: BrandNewsStatus;
    startsAt: Date;
    endsAt: Date;
    audience: unknown;
  },
  now: Date,
): BrandNewsPublishRefusal[] {
  const out: BrandNewsPublishRefusal[] = [];
  if (row.status !== 'draft') out.push('notDraft');
  if (row.titleKo === '') out.push('titleKo');
  if (row.titleEn === '') out.push('titleEn');
  if (!judgeBrandNewsLink(row.ctaHref).ok) out.push('link');
  if (row.shape === 'banner' && !row.imageKey) out.push('image');
  if (!periodValid(row.startsAt, row.endsAt)) out.push('period');
  if (row.endsAt.getTime() <= now.getTime()) out.push('over');
  const audience = parseBrandNewsAudience(row.audience);
  if (audience === null) out.push('audience');
  else if (!homeSlotModesValid(row.slot ?? 'home', audience)) out.push('audienceModes');
  return out;
}

export function periodValid(startsAt: Date, endsAt: Date): boolean {
  const start = startsAt.getTime();
  const end = endsAt.getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start < end && end - start <= BRAND_NEWS_LIMITS.periodMaxDays * 86_400_000;
}

/* --------------------------------------------------------------- dismiss */

export const BRAND_NEWS_DISMISS_OPERATION = 'news.dismiss' as const;

/** `POST /api/brand-workspace` `{ operation: 'news.dismiss', input }`. */
export interface BrandNewsDismissInput {
  organizationId: string;
  announcementId: string;
}

/**
 * `{ ok: true }` once closed (again: idempotent). `not_found` for anything this person could not have been shown,
 * whatever the reason (made up, another audience, ended, not a member). While the slot is closed (switch off,
 * tables missing) the route answers exactly like an unknown operation: `invalid`, 400.
 */
export type BrandNewsDismissOutcome = { ok: true } | { ok: false; code: 'not_found' };
