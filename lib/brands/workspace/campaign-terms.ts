import { z } from 'zod';
import { CAMPAIGN_PLATFORMS, HASHTAG_MAX, PAYOUT_MODELS, SLOTS_MAX, type CampaignPlatform, type PayoutModel } from '@/lib/campaigns/schemas';

/**
 * The brand's campaign request (docs/PLATFORM-2.0.md §16.3): what the five-step wizard on
 * brand.twings.app collects, stored as `brand_projects.campaign_terms`.
 *
 * It is a REQUEST. The brand decides format, reward range, audience and posting rules; TWINGS still
 * creates the campaign, selects creators, reviews posts and confirms payouts (KAIPER principle). The
 * admin campaign form is pre-filled from these terms (`campaignPrefillFromTerms`) and nothing more.
 *
 * Shared by the wizard (client, step by step) and `createBrandProject` (server, all at once), so the
 * two can never disagree about what a valid step is. No Node-only imports here.
 */

export const CAMPAIGN_TERMS_VERSION = 1;
export const WIZARD_STEPS = ['format', 'reward', 'audience', 'schedule', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const AUDIENCE_MODES = ['all', 'criteria', 'invited'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];
export const AUDIENCE_GENDERS = ['any', 'female', 'male'] as const;
export const TAX_BASES = ['included', 'excluded'] as const;
export const BUDGET_MAX_KRW = 1_000_000_000_000;
export const REWARD_MAX_KRW = 1_000_000_000;
export const REGIONS_MAX = 10;

const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine((v) => !controls.test(v));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
});
const won = (max: number) => z.number().int().min(0).max(max);
const hashtag = z.string().trim().transform((v) => v.replace(/^#/, '')).pipe(z.string().min(1).max(40).regex(/^[\p{L}\p{N}_]+$/u));
const mention = z.string().trim().transform((v) => v.replace(/^@/, '')).pipe(z.string().min(1).max(60).regex(/^[\p{L}\p{N}._]+$/u));
const unique = <T>(items: T[]) => [...new Set(items)];

/** ① A public template (TWINGS original or a creator's format) or a brand-only production request. */
export const CampaignFormatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('template'), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), source: z.enum(['yagi', 'community']) }).strict(),
  z.object({ kind: z.literal('custom'), note: text(10, 1000) }).strict(),
]);
export const FormatStepSchema = z.object({
  title: text(3, 120),
  objective: text(3, 2000),
  format: CampaignFormatSchema,
}).strict();

/**
 * ② The existing payout models (lib/campaigns/schemas.ts). The brand names a per-creator range and
 * the total; the slots × lowest reward must fit in the total, or the request cannot be honoured.
 */
export const CampaignRewardSchema = z.object({
  model: z.enum(PAYOUT_MODELS),
  rewardMinKrw: won(REWARD_MAX_KRW),
  rewardMaxKrw: won(REWARD_MAX_KRW),
  perThousandViewsKrw: won(REWARD_MAX_KRW).nullable().default(null),
  totalBudgetKrw: z.number().int().min(1).max(BUDGET_MAX_KRW),
  taxBasis: z.enum(TAX_BASES),
  slots: z.number().int().min(1).max(SLOTS_MAX),
}).strict().superRefine((v, ctx) => {
  if (v.rewardMaxKrw < v.rewardMinKrw) ctx.addIssue({ code: 'custom', path: ['rewardMaxKrw'], message: 'range' });
  if (v.model !== 'per_view' && v.rewardMinKrw <= 0) ctx.addIssue({ code: 'custom', path: ['rewardMinKrw'], message: 'fee' });
  if (v.model !== 'flat' && !(v.perThousandViewsKrw && v.perThousandViewsKrw > 0)) ctx.addIssue({ code: 'custom', path: ['perThousandViewsKrw'], message: 'rate' });
  if (v.model === 'flat' && v.perThousandViewsKrw !== null) ctx.addIssue({ code: 'custom', path: ['perThousandViewsKrw'], message: 'flat' });
  if (v.slots * v.rewardMinKrw > v.totalBudgetKrw) ctx.addIssue({ code: 'custom', path: ['totalBudgetKrw'], message: 'budget' });
});
export const RewardStepSchema = z.object({ reward: CampaignRewardSchema }).strict();

/** ③ Who may apply. Designated creators are reached by invitation link until the creator pool (§16.5). */
export const CampaignAudienceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z.object({
    mode: z.literal('criteria'),
    platforms: z.array(z.enum(CAMPAIGN_PLATFORMS)).min(1).max(CAMPAIGN_PLATFORMS.length).transform(unique),
    minFollowers: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    gender: z.enum(AUDIENCE_GENDERS).default('any'),
    regions: z.array(text(1, 40)).max(REGIONS_MAX).transform(unique).default([]),
  }).strict(),
  z.object({ mode: z.literal('invited') }).strict(),
]);
export const AudienceStepSchema = z.object({ audience: CampaignAudienceSchema }).strict();

/** ④ Dates and what every post must carry. The ad disclosure is the law, so it is `true` or invalid. */
export const CampaignScheduleSchema = z.object({
  applicationsCloseOn: date,
  postDeadlineOn: date,
  hashtags: z.array(hashtag).max(HASHTAG_MAX).transform(unique).default([]),
  mentions: z.array(mention).max(HASHTAG_MAX).transform(unique).default([]),
  disclosure: z.literal(true),
  prohibited: text(0, 1000).default(''),
}).strict().refine((v) => v.postDeadlineOn > v.applicationsCloseOn, { path: ['postDeadlineOn'], message: 'order' });
export const ScheduleStepSchema = z.object({ schedule: CampaignScheduleSchema }).strict();

export const CampaignTermsSchema = z.object({
  version: z.literal(CAMPAIGN_TERMS_VERSION),
  format: CampaignFormatSchema,
  reward: CampaignRewardSchema,
  audience: CampaignAudienceSchema,
  schedule: CampaignScheduleSchema,
}).strict();
export type CampaignTerms = z.infer<typeof CampaignTermsSchema>;
export type CampaignFormat = z.infer<typeof CampaignFormatSchema>;
export type CampaignReward = z.infer<typeof CampaignRewardSchema>;
export type CampaignAudience = z.infer<typeof CampaignAudienceSchema>;
export type CampaignSchedule = z.infer<typeof CampaignScheduleSchema>;

const STEP_SCHEMAS = { format: FormatStepSchema, reward: RewardStepSchema, audience: AudienceStepSchema, schedule: ScheduleStepSchema } as const;

/** Everything the wizard holds between steps. Any part may still be missing or half typed. */
export interface WizardDraft {
  version: typeof CAMPAIGN_TERMS_VERSION;
  step: WizardStep;
  title?: string;
  objective?: string;
  format?: unknown;
  reward?: unknown;
  audience?: unknown;
  schedule?: unknown;
}

export interface StepIssue { path: string; message: string }
export type StepResult = { ok: true } | { ok: false; issues: StepIssue[] };

/** One step's check, on the draft as it stands. `review` checks every earlier step. */
export function checkWizardStep(step: WizardStep, draft: Partial<WizardDraft>): StepResult {
  if (step === 'review') {
    for (const earlier of WIZARD_STEPS.slice(0, -1)) {
      const result = checkWizardStep(earlier, draft);
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  const value = step === 'format'
    ? { title: draft.title ?? '', objective: draft.objective ?? '', format: draft.format }
    : { [step]: draft[step] };
  const parsed = STEP_SCHEMAS[step].safeParse(value);
  if (parsed.success) return { ok: true };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

/** The first step that is not complete yet: where a restored draft should reopen. */
export function firstIncompleteStep(draft: Partial<WizardDraft>): WizardStep {
  for (const step of WIZARD_STEPS.slice(0, -1)) if (!checkWizardStep(step, draft).ok) return step;
  return 'review';
}

/** The validated terms, or null while any step is incomplete. */
export function termsFromDraft(draft: Partial<WizardDraft>): CampaignTerms | null {
  const parsed = CampaignTermsSchema.safeParse({ version: CAMPAIGN_TERMS_VERSION, format: draft.format, reward: draft.reward, audience: draft.audience, schedule: draft.schedule });
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// draft storage — the brand's own browser, per workspace. Nothing reaches TWINGS before "검토 요청".
// ---------------------------------------------------------------------------

export const WIZARD_DRAFT_PREFIX = 'twings.brand.campaign-draft.v1:';
export const wizardDraftKey = (organizationId: string) => `${WIZARD_DRAFT_PREFIX}${organizationId}`;
type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const DraftShape = z.object({
  version: z.literal(CAMPAIGN_TERMS_VERSION),
  step: z.enum(WIZARD_STEPS),
  title: z.string().max(400).optional(),
  objective: z.string().max(4000).optional(),
  format: z.unknown().optional(),
  reward: z.unknown().optional(),
  audience: z.unknown().optional(),
  schedule: z.unknown().optional(),
});
/** Writes the draft. A full or blocked store (private mode) is not an error: the wizard still works. */
export function saveWizardDraft(store: DraftStore | null, organizationId: string, draft: WizardDraft): boolean {
  if (!store) return false;
  try { store.setItem(wizardDraftKey(organizationId), JSON.stringify(draft)); return true; } catch { return false; }
}
/** The saved draft for this workspace, or null when there is none or it is not one we wrote. */
export function loadWizardDraft(store: DraftStore | null, organizationId: string): WizardDraft | null {
  if (!store) return null;
  try {
    const raw = store.getItem(wizardDraftKey(organizationId));
    if (!raw || raw.length > 64_000) return null;
    const parsed = DraftShape.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as WizardDraft) : null;
  } catch { return null; }
}
export function clearWizardDraft(store: DraftStore | null, organizationId: string): void {
  try { store?.removeItem(wizardDraftKey(organizationId)); } catch { /* nothing to clear */ }
}

// ---------------------------------------------------------------------------
// what the terms mean for the existing brief columns and for the admin campaign form
// ---------------------------------------------------------------------------

/**
 * The `brand_projects` columns a wizard brief fills, derived on the server from the validated terms
 * so a client cannot send a budget or dates that disagree with them.
 */
export function briefColumnsFromTerms(terms: CampaignTerms) {
  const a = terms.audience;
  return {
    budgetKrw: terms.reward.totalBudgetKrw,
    budgetTaxBasis: terms.reward.taxBasis,
    startsOn: null,
    endsOn: terms.schedule.postDeadlineOn,
    productionMode: 'creator' as const,
    criteria: {
      platforms: a.mode === 'criteria' ? a.platforms : [],
      minFollowers: a.mode === 'criteria' ? a.minFollowers : null,
      maxFollowers: null,
      primaryMetric: 'views' as const,
      targetValue: null,
    },
  };
}

/** Which `campaigns.audience` the request asks for. Who may see a non-public campaign is slice B2. */
export function campaignAudienceFor(audience: CampaignAudience): 'public' | 'influencers' | 'invited' {
  return audience.mode === 'invited' ? 'invited' : audience.mode === 'criteria' ? 'influencers' : 'public';
}

/** Today's date in Korea (no daylight saving since 1988, so +09:00 is exact). */
export const kstToday = (now: Date = new Date()) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** A Korea-time day's end, as the instant the admin form's `datetime-local` shows. */
export const kstEndOfDay = (day: string) => new Date(`${day}T23:59:00+09:00`).toISOString();

export interface CampaignPrefill {
  title: { en: string; ko: string };
  summary: { en: string; ko: string };
  brief: { en: string; ko: string } | null;
  hostName: string;
  styleSlug: string | null;
  platforms: CampaignPlatform[];
  slots: number;
  applicationsCloseAt: string;
  postDeadlineAt: string;
  payout: { model: PayoutModel; flatCents: number; perThousandViewsCents: number; minCents: number; maxCents: number | null; holdDays: number };
  requirements: { hashtags: string[]; mentions: string[]; disclosure: true };
  budgetCents: number;
  audience: 'public' | 'influencers' | 'invited';
}

/**
 * The admin "new campaign" form's starting values for a brief that came from the wizard. Korean is
 * what the brand wrote; the English side is left for TWINGS to write. The payout starts at the
 * brand's lowest reward with its highest as the cap: TWINGS decides the final rule.
 */
export function campaignPrefillFromTerms(project: { title: string; objective: string; organizationName: string }, terms: CampaignTerms, briefLines: (terms: CampaignTerms) => string[]): CampaignPrefill {
  const r = terms.reward, a = terms.audience, s = terms.schedule;
  const lines = briefLines(terms);
  return {
    title: { en: '', ko: project.title },
    summary: { en: '', ko: project.objective },
    brief: lines.length ? { en: '', ko: lines.join('\n') } : null,
    hostName: project.organizationName,
    styleSlug: terms.format.kind === 'template' ? terms.format.slug : null,
    platforms: a.mode === 'criteria' ? a.platforms : ['instagram'],
    slots: r.slots,
    applicationsCloseAt: kstEndOfDay(s.applicationsCloseOn),
    postDeadlineAt: kstEndOfDay(s.postDeadlineOn),
    payout: {
      model: r.model,
      flatCents: r.model === 'per_view' ? 0 : r.rewardMinKrw,
      perThousandViewsCents: r.perThousandViewsKrw ?? 0,
      minCents: r.model === 'per_view' ? r.rewardMinKrw : 0,
      maxCents: r.model === 'flat' ? null : r.rewardMaxKrw,
      holdDays: 7,
    },
    requirements: { hashtags: s.hashtags, mentions: s.mentions, disclosure: true },
    budgetCents: r.totalBudgetKrw,
    audience: campaignAudienceFor(a),
  };
}
