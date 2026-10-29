import { z } from 'zod';

/**
 * The import contract for a campaign's creator shortlist (docs/BRAND-SHORTLIST.md). Every object is
 * strict: a key that is not listed here (a fee, a rate card, a note, a penalty, a source link) makes
 * the whole request invalid instead of being dropped, so whatever feeds this learns at once that it
 * sent something the brand must never see. The database repeats the metric key list (0066).
 */
export const SHORTLIST_METRIC_KEYS = [
  'followers', 'following', 'posts',
  'feedPosts30d', 'feedEngagement', 'feedEngagementRate', 'feedLikes', 'feedComments',
  'adPosts30d', 'adShare', 'adEngagement', 'adEngagementRate', 'adLikes', 'adComments',
  'reelsPosts30d', 'reelsEngagement', 'reelsEngagementRate', 'reelsLikes', 'reelsComments',
  'viewsMedian90d', 'viewsMax90d',
] as const;
export type ShortlistMetricKey = typeof SHORTLIST_METRIC_KEYS[number];
export type ShortlistMetrics = Partial<Record<ShortlistMetricKey, number>>;

/** Whole counts (followers, views). Unknown is null or absent, never 0. */
const count = z.number().int().min(0).max(2_000_000_000).nullable().optional();
/** Averages per post or per 30 days (`9.3` ads a month, `4.2` comments a post): one decimal kept. */
const average = z.number().finite().min(0).max(1_000_000_000).nullable().optional();
/** Percentages as shown (`0.5` means 0.5 %). */
const percent = z.number().finite().min(0).max(100).nullable().optional();

export const ShortlistMetricsSchema = z.object({
  followers: count, following: count, posts: count,
  feedPosts30d: average, feedEngagement: average, feedEngagementRate: percent, feedLikes: average, feedComments: average,
  adPosts30d: average, adShare: percent, adEngagement: average, adEngagementRate: percent, adLikes: average, adComments: average,
  reelsPosts30d: average, reelsEngagement: average, reelsEngagementRate: percent, reelsLikes: average, reelsComments: average,
  viewsMedian90d: count, viewsMax90d: count,
}).strict();

/**
 * Words that name where candidates were recruited. The brand only ever deals with TWINGS, so a
 * display name or category carrying one is refused rather than shown. Server-only module.
 */
const SOURCE_TERMS = /brand\s*azine|브랜더진|브랜다진|브랜드매거진/i;
export const mentionsSource = (value: string) => SOURCE_TERMS.test(value);

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine(value => !mentionsSource(value), 'source')
  .refine(value => !/[\u0000-\u001f\u007f<>]/.test(value), 'characters');

/** `@Sondxmin ` → `sondxmin`. Instagram handles only: letters, digits, `.` and `_`, at most 30. */
export const ShortlistHandleSchema = z.string().trim().transform(value => value.replace(/^@/, '').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._]{1,30}$/).refine(value => !mentionsSource(value), 'source'));

export const SHORTLIST_AVATAR_MAX_BYTES = 300 * 1024;
const AvatarSchema = z.string().max(Math.ceil(SHORTLIST_AVATAR_MAX_BYTES / 3) * 4 + 40)
  .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

export const ShortlistCandidateSchema = z.object({
  platform: z.literal('instagram').default('instagram'),
  handle: ShortlistHandleSchema,
  displayName: text(60).nullable().optional(),
  category: text(40).nullable().optional(),
  /** A small profile picture as a data URL; re-encoded server-side, never stored as a link. */
  avatar: AvatarSchema.nullable().optional(),
  metrics: ShortlistMetricsSchema.default({}),
  /** The creator's booking for this campaign is confirmed (`false` takes it back); absent leaves it as it is. */
  confirmed: z.boolean().optional(),
}).strict();
export type ShortlistCandidateInput = z.output<typeof ShortlistCandidateSchema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().startsWith(value);
}, 'date');

export const SHORTLIST_IMPORT_MAX = 30;
/** One request or file, kept under the platform's request body limit. */
export const SHORTLIST_IMPORT_MAX_BODY = 4_000_000;
export const ShortlistImportSchema = z.object({
  projectId: z.uuid(),
  /** The day the figures were read (Korea time), shown as "지표 기준". */
  measuredOn: isoDay.nullable().optional(),
  candidates: z.array(ShortlistCandidateSchema).min(1).max(SHORTLIST_IMPORT_MAX)
    .refine(list => new Set(list.map(c => c.handle)).size === list.length, 'duplicate handle'),
}).strict();
export type ShortlistImportInput = z.output<typeof ShortlistImportSchema>;

export const ShortlistShareSchema = z.object({
  projectId: z.uuid(),
  /** One candidate, or every waiting candidate of the campaign when absent (excluded ones stay out). */
  candidateId: z.uuid().nullable().optional(),
  shared: z.boolean(),
}).strict();
export const ShortlistRemoveSchema = z.object({ projectId: z.uuid(), candidateId: z.uuid() }).strict();
export const ShortlistPickSchema = z.object({ candidateId: z.uuid(), picked: z.boolean() }).strict();

/**
 * The brand's own sorting of shared candidates: prefer, set aside, or clear the mark, for one or many
 * at once (a selection on its page). Every ID must be a shared candidate of the same campaign.
 */
export const SHORTLIST_CHOICES = ['picked', 'passed', 'none'] as const;
export type ShortlistChoice = typeof SHORTLIST_CHOICES[number];
export const SHORTLIST_CHOOSE_MAX = 200;
export const ShortlistChooseSchema = z.object({
  candidateIds: z.array(z.uuid()).min(1).max(SHORTLIST_CHOOSE_MAX).refine(list => new Set(list).size === list.length, 'duplicate'),
  choice: z.enum(SHORTLIST_CHOICES),
}).strict();

/**
 * The studio's triage (docs/BRAND-SHORTLIST.md "선별"): move candidates between waiting, shared and
 * excluded in one call. A row's button, a selection, and the "inside / outside the ranges" split all
 * arrive as these three lists.
 */
export const SHORTLIST_TRIAGE_MAX = 500;
const candidateIds = z.array(z.uuid()).max(SHORTLIST_TRIAGE_MAX).default([]);
export const ShortlistTriageSchema = z.object({
  projectId: z.uuid(),
  share: candidateIds,
  exclude: candidateIds,
  wait: candidateIds,
}).strict()
  .refine(v => v.share.length + v.exclude.length + v.wait.length > 0, 'empty')
  .refine(v => v.share.length + v.exclude.length + v.wait.length <= SHORTLIST_TRIAGE_MAX, 'too_many')
  .refine(v => new Set([...v.share, ...v.exclude, ...v.wait]).size === v.share.length + v.exclude.length + v.wait.length, 'overlap');

/**
 * The ranges the studio filters by, which a campaign may keep as its criteria. Rates in percent as
 * shown (`1.5` means 1.5 %). Nothing is shared or excluded by criteria on their own.
 */
export const SHORTLIST_CRITERIA_KEYS = ['followers', 'views', 'engagement', 'adShare'] as const;
export type ShortlistCriteriaKey = typeof SHORTLIST_CRITERIA_KEYS[number];
const bound = z.number().finite().min(0).max(2_000_000_000).nullable().optional();
const RangeSchema = z.object({ min: bound, max: bound }).strict()
  .refine(r => r.min != null || r.max != null, 'empty')
  .refine(r => r.min == null || r.max == null || r.min <= r.max, 'range');
export const ShortlistCriteriaSchema = z.object({
  followers: RangeSchema.optional(),
  views: RangeSchema.optional(),
  engagement: RangeSchema.optional(),
  adShare: RangeSchema.optional(),
}).strict();
export type ShortlistRange = { min?: number | null; max?: number | null };
export type ShortlistCriteria = Partial<Record<ShortlistCriteriaKey, ShortlistRange>>;
export const ShortlistCriteriaSaveSchema = z.object({ projectId: z.uuid(), criteria: ShortlistCriteriaSchema.nullable() }).strict();
