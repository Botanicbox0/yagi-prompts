import { z } from 'zod';
import { HOST_KINDS, parseHttpUrl } from '@/lib/contests/schemas';

/**
 * Campaigns — the paid cousin of contests (docs/CAMPAIGNS.md, 2026-09-03).
 *
 * A contest asks many people to compete for a few prizes. A campaign asks a FIXED number of
 * selected creators to each make the same format (a studio style), post it, submit the link, and
 * be paid after a hold. The vocabulary that is genuinely the same — host kinds, slugs, http links —
 * is imported from the contests module rather than restated; everything about money, slots and
 * the seven-day hold is new and lives here.
 *
 * Money is INTEGER minor units (원, since v1 is KRW only). No floats anywhere near a payout.
 */

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = ['draft', 'recruiting', 'selecting', 'running', 'closed', 'archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const APPLICATION_STATUSES = [
  'applied',
  'selected',
  'declined',
  'withdrawn',
  'posted',
  'verified',
  'rejected',
  'paid',
  'expired',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// platforms + deliverable
// ---------------------------------------------------------------------------

export const CAMPAIGN_PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
export type CampaignPlatform = (typeof CAMPAIGN_PLATFORMS)[number];

export function isCampaignPlatform(value: unknown): value is CampaignPlatform {
  return typeof value === 'string' && (CAMPAIGN_PLATFORMS as readonly string[]).includes(value);
}

/** Which platform a posted link belongs to, by host — the check the reviewer would otherwise do by eye. */
export function platformOfUrl(raw: string): CampaignPlatform | null {
  const url = parseHttpUrl(raw);
  if (url === null) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  return null;
}

export const DELIVERABLES = ['reel', 'feed', 'story', 'short', 'video'] as const;
export type Deliverable = (typeof DELIVERABLES)[number];

// ---------------------------------------------------------------------------
// payout rule (docs/CAMPAIGNS.md §4)
// ---------------------------------------------------------------------------

export const PAYOUT_MODELS = ['flat', 'per_view', 'hybrid'] as const;
export type PayoutModel = (typeof PAYOUT_MODELS)[number];

export const DEFAULT_HOLD_DAYS = 7;
/** v1 is 원 only; the field exists so the day it is not, nothing has to be renamed. */
export const PAYOUT_CURRENCIES = ['KRW'] as const;
export type PayoutCurrency = (typeof PAYOUT_CURRENCIES)[number];

const Won = z.number().int().min(0).max(1_000_000_000);

export const PayoutRuleSchema = z
  .object({
    model: z.enum(PAYOUT_MODELS),
    flatCents: Won.default(0),
    perThousandViewsCents: Won.default(0),
    minCents: Won.default(0),
    maxCents: Won.nullable().default(null),
    currency: z.enum(PAYOUT_CURRENCIES).default('KRW'),
    holdDays: z.number().int().min(0).max(60).default(DEFAULT_HOLD_DAYS),
  })
  .superRefine((rule, ctx) => {
    if (rule.model !== 'per_view' && rule.flatCents <= 0) {
      ctx.addIssue({ code: 'custom', path: ['flatCents'], message: 'a flat or hybrid rule needs a fee' });
    }
    if (rule.model !== 'flat' && rule.perThousandViewsCents <= 0) {
      ctx.addIssue({ code: 'custom', path: ['perThousandViewsCents'], message: 'a view-based rule needs a rate' });
    }
    if (rule.maxCents !== null && rule.maxCents < rule.minCents) {
      ctx.addIssue({ code: 'custom', path: ['maxCents'], message: 'the cap cannot be below the floor' });
    }
    if (rule.model === 'hybrid' && rule.maxCents !== null && rule.maxCents < rule.flatCents) {
      ctx.addIssue({ code: 'custom', path: ['maxCents'], message: 'the cap cannot be below the flat fee' });
    }
  });
export type PayoutRule = z.infer<typeof PayoutRuleSchema>;

export function parsePayoutRule(raw: unknown): PayoutRule | null {
  const result = PayoutRuleSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// requirements
// ---------------------------------------------------------------------------

export const HASHTAG_MAX = 12;

const Hashtag = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#/, ''))
  .pipe(z.string().min(1).max(40).regex(/^[\p{L}\p{N}_]+$/u, 'a hashtag is letters, digits and _'));

const Mention = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().min(1).max(60));

export const RequirementsSchema = z.object({
  hashtags: z.array(Hashtag).max(HASHTAG_MAX).default([]),
  mentions: z.array(Mention).max(HASHTAG_MAX).default([]),
  /** 표시·광고법: a paid post says so. Default ON; turning it off is an explicit choice. */
  disclosure: z.boolean().default(true),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export function parseRequirements(raw: unknown): Requirements {
  const result = RequirementsSchema.safeParse(raw ?? {});
  return result.success ? result.data : { hashtags: [], mentions: [], disclosure: true };
}

// ---------------------------------------------------------------------------
// creator-side payloads
// ---------------------------------------------------------------------------

export const PITCH_MAX = 300;
export const FOLLOWERS_MAX = 100_000_000;
export const URL_MAX = 500;
export const APPLICATION_WRITES_PER_DAY = 10;

const HttpUrl = z
  .string()
  .trim()
  .max(URL_MAX)
  .transform((value, ctx) => {
    const url = parseHttpUrl(value);
    if (url === null) {
      ctx.addIssue({ code: 'custom', message: 'must be a http(s) link' });
      return z.NEVER;
    }
    return url.href;
  });

export const ApplySchema = z.object({
  pitch: z.string().trim().min(10).max(PITCH_MAX),
  snsUrl: HttpUrl,
  followerCount: z.number().int().min(0).max(FOLLOWERS_MAX),
  /** The creator agrees to the brief, the disclosure rule and the payout rule as shown. */
  consent: z.literal(true, 'the campaign terms must be accepted'),
});
export type ApplyInput = z.infer<typeof ApplySchema>;

export const APPLY_FIELDS = ['pitch', 'snsUrl', 'followerCount', 'consent'] as const;
export type ApplyField = (typeof APPLY_FIELDS)[number];
export function isApplyField(value: unknown): value is ApplyField {
  return typeof value === 'string' && (APPLY_FIELDS as readonly string[]).includes(value);
}

export const PostSchema = z.object({
  postUrl: HttpUrl,
});
export type PostInput = z.infer<typeof PostSchema>;

/** The seven-day snapshot a creator reports (v1: self-reported, confirmed by the admin). */
export const MetricsSchema = z.object({
  views: z.number().int().min(0).max(10_000_000_000),
});

// ---------------------------------------------------------------------------
// admin authoring
// ---------------------------------------------------------------------------

export const CAMPAIGN_TEXT_MAX = 6000;
export const SLOTS_MAX = 500;

const LocalizedText = z.object({
  en: z.string().trim().max(CAMPAIGN_TEXT_MAX),
  ko: z.string().trim().max(CAMPAIGN_TEXT_MAX),
});
export type CampaignLocalized = z.infer<typeof LocalizedText>;

export const CampaignFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase words joined by hyphens')
    .min(3)
    .max(80),
  title: LocalizedText,
  summary: LocalizedText,
  brief: LocalizedText.nullable(),
  hostName: z.string().trim().min(1).max(80),
  hostKind: z.enum(HOST_KINDS),
  hostUrl: HttpUrl.nullable(),
  styleSlug: z.string().trim().max(80).nullable(),
  platforms: z.array(z.enum(CAMPAIGN_PLATFORMS)).min(1),
  deliverable: z.enum(DELIVERABLES),
  slots: z.number().int().min(1).max(SLOTS_MAX),
  applicationsCloseAt: z.string().datetime().nullable(),
  postDeadlineAt: z.string().datetime().nullable(),
  payout: PayoutRuleSchema,
  requirements: RequirementsSchema,
  budgetCents: Won.nullable(),
});
export type CampaignFormInput = z.infer<typeof CampaignFormSchema>;

/**
 * What must be true before a campaign recruits. English literals, like the contest gate: they are
 * the operation's refusal detail, and the admin page maps them to the dictionary. No poster gate:
 * the FORMAT is a studio style, whose own poster and film the campaign shows (0014 dropped the
 * uploaded-poster requirement); a brief-only campaign renders the typographic poster.
 */
export interface PublishableCampaign {
  title: CampaignLocalized;
  summary: CampaignLocalized;
  brief: CampaignLocalized | null;
  applicationsCloseAt: string | null;
  postDeadlineAt: string | null;
  payout: PayoutRule | null;
  slots: number;
}

function complete(value: CampaignLocalized | null): boolean {
  return value !== null && value.en.length > 0 && value.ko.length > 0;
}

export function recruitBlockers(campaign: PublishableCampaign): string[] {
  const missing: string[] = [];
  if (!complete(campaign.title)) missing.push('title (en + ko)');
  if (!complete(campaign.summary)) missing.push('summary (en + ko)');
  if (campaign.brief !== null && !complete(campaign.brief)) missing.push('brief (en + ko)');
  if (campaign.applicationsCloseAt === null) missing.push('application deadline');
  if (campaign.postDeadlineAt === null) missing.push('post deadline');
  if (
    campaign.applicationsCloseAt !== null &&
    campaign.postDeadlineAt !== null &&
    new Date(campaign.postDeadlineAt) <= new Date(campaign.applicationsCloseAt)
  ) {
    missing.push('a post deadline after the application deadline');
  }
  if (campaign.payout === null) missing.push('payout rule');
  if (campaign.slots < 1) missing.push('slots');
  return missing;
}
