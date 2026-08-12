import { z } from 'zod';
import { AssetRefSchema } from '@/lib/content/schemas';

/**
 * PLAN §14.1 — the contest content contracts.
 *
 * Same doctrine as `lib/content/schemas.ts` (§6.1) and `lib/prompts/schemas.ts` (§13.1): these
 * schemas are the SINGLE source — the entry form fields, the admin authoring fields, the renderer
 * props and the moderation validation all derive from here, and nothing downstream invents a field.
 *
 * The one structural difference from prompts: an entry carries no bytes. §14.1 makes film files
 * LINKS, so the only validation that matters on a submission is URL validation — which is why this
 * file spends more lines on `parseHttpUrl` than on anything else.
 */

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

export const CONTEST_STATUSES = ['draft', 'published', 'archived'] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

export const ENTRY_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** §14.1 — "placement int null (1/2/3 set by admin post-deadline)". */
export const PLACEMENTS = [1, 2, 3] as const;
export type Placement = (typeof PLACEMENTS)[number];

export function isPlacement(value: unknown): value is Placement {
  return value === 1 || value === 2 || value === 3;
}

// ---------------------------------------------------------------------------
// caps (§14.1)
// ---------------------------------------------------------------------------

export const ENTRY_TITLE_MAX = 80;
export const ENTRY_NOTE_MAX = 300;
/** Long enough for a share link with tracking junk, short enough not to be a payload. */
export const URL_MAX = 500;
export const REJECT_REASON_MAX = 400;
export const BRAND_NAME_MAX = 80;
export const CONTEST_TEXT_MAX = 4000;

/** §14.1: "Rate limit: ≤10 entry writes/day/user" — the 11th inside the window is refused. */
export const ENTRY_WRITES_PER_DAY = 10;
export const RATE_WINDOW_HOURS = 24;

// ---------------------------------------------------------------------------
// URLs and platform chips
// ---------------------------------------------------------------------------

/**
 * `new URL()` with the protocol allowlist applied, because the two failures a URL field has to
 * refuse are different in kind:
 *
 *   · `javascript:alert(1)` PARSES perfectly. Only the protocol check stops it, and it must be
 *     applied here rather than at render time — an href we never store is an href we never have to
 *     remember to sanitise.
 *   · `https://` with no host parses to an empty hostname on some inputs, which would render as a
 *     link to the current origin.
 *
 * The DB CHECK (`~ '^https?://'`) is the backstop; this is the gate.
 */
export function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname.length === 0) return null;
  return url;
}

/**
 * §14.1 — "recognized hosts get a platform chip, generic https accepted".
 *
 * Six keys, and `link` for everything else. `twitter.com` maps to `x` rather than getting a seventh
 * key: they are one platform with two hostnames, and a chip reading TWITTER next to one reading X
 * would suggest the site thinks they are different places. (Interpretation logged for the Director
 * — §14.1's own list names both.)
 */
export const ENTRY_PLATFORMS = [
  'instagram',
  'youtube',
  'tiktok',
  'x',
  'threads',
  'vimeo',
  /** The honest default: a link we recognise as a link and nothing more. */
  'link',
] as const;
export type EntryPlatform = (typeof ENTRY_PLATFORMS)[number];

/** Registrable host → platform. Matched on suffix so `www.`/`m.`/`open.` subdomains all resolve. */
const PLATFORM_HOSTS: ReadonlyArray<[string, EntryPlatform]> = [
  ['instagram.com', 'instagram'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['x.com', 'x'],
  ['twitter.com', 'x'],
  ['threads.net', 'threads'],
  ['threads.com', 'threads'],
  ['vimeo.com', 'vimeo'],
];

export function platformOf(raw: unknown): EntryPlatform {
  const url = parseHttpUrl(raw);
  if (url === null) return 'link';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const [domain, platform] of PLATFORM_HOSTS) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  return 'link';
}

/**
 * The display handle for an SNS link: the first path segment when the platform puts the account
 * there (`instagram.com/hana` → `@hana`), otherwise the host.
 *
 * Never the raw URL: the entries rail credits a person, and `https://www.instagram.com/hana/?hl=ko`
 * set in a chip is a tracking string, not a credit.
 */
export function snsDisplayHandle(raw: unknown): string | null {
  const url = parseHttpUrl(raw);
  if (url === null) return null;
  const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
  const handle = segment.replace(/^@/, '').slice(0, 40);
  if (handle.length === 0) return url.hostname.toLowerCase().replace(/^www\./, '');
  return `@${handle}`;
}

const HttpUrl = z
  .string()
  .trim()
  .max(URL_MAX)
  .refine((value) => parseHttpUrl(value) !== null, 'must be a http(s) link');

// ---------------------------------------------------------------------------
// entry submission (§14.1/§14.2 — the login-gated form)
// ---------------------------------------------------------------------------

export const EntrySubmissionSchema = z.object({
  title: z.string().trim().min(2).max(ENTRY_TITLE_MAX),
  videoUrl: HttpUrl,
  /**
   * §14.1: "sns_url NOT NULL (entrant's main SNS)". Required at the schema level, not merely at the
   * column — the sentence the form shows ("judging and credit") is only true if the field cannot be
   * skipped.
   */
  snsUrl: HttpUrl,
  note: z.string().trim().max(ENTRY_NOTE_MAX).nullable(),
  /**
   * The entry is published with the entrant's SNS attached. `literal(true)` rather than a boolean:
   * an unchecked box posts nothing, and "absent" must fail the same way "false" does.
   */
  consent: z.literal(true, 'the entry terms must be accepted'),
});
export type EntrySubmissionInput = z.infer<typeof EntrySubmissionSchema>;

// ---------------------------------------------------------------------------
// admin authoring + moderation
// ---------------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SlugSchema = z
  .string()
  .trim()
  .regex(SLUG_PATTERN, 'slug must be lowercase words joined by hyphens')
  .min(3)
  .max(80);

const LocalizedText = z.object({
  en: z.string().trim().max(CONTEST_TEXT_MAX),
  ko: z.string().trim().max(CONTEST_TEXT_MAX),
});
export type ContestLocalized = z.infer<typeof LocalizedText>;

/**
 * A `{en, ko}` pair where BOTH sides being blank means "no value at all".
 *
 * This is what makes `rules` genuinely optional while keeping the §3.9 publish gate meaningful: a
 * half-filled pair stays a half-filled pair and is refused at publish, rather than being silently
 * collapsed to null and shipping a contest with English-only rules.
 */
export const OptionalLocalizedSchema = LocalizedText.nullable();

/**
 * `datetime-local` → ISO instant, read as **UTC**.
 *
 * The input element has no timezone and the server has no way to learn the admin's. Picking one and
 * saying so (in the field hint, in the admin dictionary, and here) is the only honest option; the
 * alternative — guessing the browser's offset with client JavaScript — would put a timezone in a
 * hidden field on a deliberately JS-free form (§3.8).
 */
export function parseDateTimeLocal(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (match === null) {
    // Already an instant (a fixture, or a round trip through the DB) — accept it as such.
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, y, mo, d, h, mi, s = '00'] = match as unknown as string[];
  const millis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const date = new Date(millis);
  // Round-trip check: `Date.UTC` happily normalises 2026-02-31 into March.
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date.toISOString();
}

/** The inverse, for the admin form's `defaultValue` — UTC, minutes precision, no seconds. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

const DateTimeField = z
  .string()
  .nullable()
  .transform((value) => (value === null ? null : parseDateTimeLocal(value)));

export const ContestFormSchema = z
  .object({
    slug: SlugSchema,
    title: LocalizedText,
    summary: LocalizedText,
    prize: LocalizedText,
    rules: OptionalLocalizedSchema,
    brandName: z.string().trim().min(1).max(BRAND_NAME_MAX),
    brandUrl: HttpUrl.nullable(),
    startsAt: DateTimeField,
    deadlineAt: DateTimeField,
  })
  .refine(
    (value) =>
      value.startsAt === null ||
      value.deadlineAt === null ||
      new Date(value.deadlineAt) > new Date(value.startsAt),
    { path: ['deadlineAt'], error: 'the deadline must come after the start' },
  );
export type ContestFormInput = z.infer<typeof ContestFormSchema>;

const Uuid = z.string().uuid();

export const ContestIdSchema = z.object({ id: Uuid });

export const EntryApprovalSchema = z.object({ id: Uuid });

export const EntryRejectionSchema = z.object({
  id: Uuid,
  reason: z.string().trim().min(3).max(REJECT_REASON_MAX),
});

export const PlacementSchema = z.object({
  id: Uuid,
  /** `null` clears the placement — the same control, unset. */
  placement: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
});

// ---------------------------------------------------------------------------
// media (§14.1 — "hero media jsonb (poster required, video optional)")
// ---------------------------------------------------------------------------

export const ContestMediaSchema = z.object({
  poster: AssetRefSchema.optional(),
  video: AssetRefSchema.optional(),
});
export type ContestMedia = z.infer<typeof ContestMediaSchema>;

/** `null`/absent jsonb is "no media", never a parse failure — every contest starts that way. */
export function parseContestMedia(value: unknown): ContestMedia {
  if (value === null || value === undefined) return {};
  const parsed = ContestMediaSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

// ---------------------------------------------------------------------------
// the publish gate, in TypeScript, mirroring the DB CHECKs
// ---------------------------------------------------------------------------

export interface PublishableContest {
  title: unknown;
  summary: unknown;
  prize: unknown;
  rules: unknown;
  media: unknown;
  startsAt: string | null;
  deadlineAt: string | null;
}

function localizedComplete(value: unknown): boolean {
  const parsed = LocalizedText.safeParse(value);
  return parsed.success && parsed.data.en.length > 0 && parsed.data.ko.length > 0;
}

/**
 * Why this exists when the database already refuses: the CHECK constraints are the backstop and
 * they answer with a constraint name. An author who forgot the Korean prize line deserves the
 * sentence, not `contests_published_requires_localized`. Both run; neither is optional.
 *
 * Returns the list of missing things, so the admin banner can name all of them at once rather than
 * making publishing a guessing game one field at a time.
 */
export function publishBlockers(contest: PublishableContest): string[] {
  const missing: string[] = [];
  if (!localizedComplete(contest.title)) missing.push('title (en + ko)');
  if (!localizedComplete(contest.summary)) missing.push('summary (en + ko)');
  if (!localizedComplete(contest.prize)) missing.push('prize (en + ko)');
  if (contest.rules !== null && contest.rules !== undefined && !localizedComplete(contest.rules)) {
    missing.push('rules (en + ko)');
  }
  if (contest.startsAt === null) missing.push('start date');
  if (contest.deadlineAt === null) missing.push('deadline');
  if (
    contest.startsAt !== null &&
    contest.deadlineAt !== null &&
    new Date(contest.deadlineAt) <= new Date(contest.startsAt)
  ) {
    missing.push('a deadline after the start');
  }
  if (!parseContestMedia(contest.media).poster) missing.push('poster image');
  return missing;
}
