import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Brand secondary usage ("2차 활용"), docs/SECONDARY-USAGE.md.
 *
 * Two deliberately different shapes:
 *   · the INQUIRY a brand sends is permissive. Only the selected content and what the brand wants to
 *     know are required. Every hint is optional and an absent hint stays unknown: it never means all
 *     channels, perpetual or worldwide.
 *   · the SCOPE the studio records is complete. Quotes, consent and grants only ever bind to it.
 */
const id = z.string().uuid();
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v; });
const unique = <T extends z.ZodType>(item: T, min: number, max: number) =>
  z.array(item).min(min).max(max).refine(v => new Set(v).size === v.length, 'Duplicate value');

export const USAGE_INTENTS = ['know_cost', 'recommend_terms', 'question'] as const;
export const USAGE_HINTS = ['organic_repost', 'paid_ads', 'owned_media', 'creator_partnership_ads', 'offline', 'undecided'] as const;
export const USAGE_DURATION_HINTS = ['1m', '3m', '6m', '12m', 'custom', 'undecided'] as const;
/**
 * What a scope may license. No `source_files`: source-file delivery is not built (docs/SECONDARY-USAGE.md §6), so a
 * quote must never promise files nothing can hand over. Masters are pinned only as files the campaign already shows.
 */
export const USAGE_KINDS = ['organic_repost', 'owned_web', 'ecommerce', 'paid_ads', 'partnership_ads', 'edit_cutdown'] as const;
export const USAGE_EDITS = ['none', 'studio_edits', 'brand_edits'] as const;
export const USAGE_CLOSE_REASONS = ['answered_only', 'creator_declined', 'no_response', 'other'] as const;
/** Fixed in every scope and every grant: a usage licence never covers the creator's likeness beyond the pinned file. */
export const USAGE_EXCLUSIONS = ['no_identity_training', 'no_new_likeness_generation', 'no_use_beyond_pinned_subject'] as const;
/** The basis zone for dates in a quote. Changing it changes every scope hash, so it is part of the scope. */
export const USAGE_TIME_ZONE = 'Asia/Seoul';
/** The acceptance wording version the brand confirmed (a dictionary key, never free text). */
export const USAGE_ACCEPTANCE_STATEMENT = 'quote-accept-2026-09-23';

const Subject = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('content_version'), id }),
  z.object({ kind: z.literal('post'), id }),
]);
/** Blank or missing optional fields become null here, so "unknown" has exactly one representation. */
const optionalText = (max: number) => z.preprocess(v => typeof v === 'string' && v.trim() === '' ? null : v, text(1, max).nullable().default(null));
export const UsageInquirySchema = z.object({
  projectId: id, requestId: id,
  subjects: z.array(Subject).min(1).max(10).refine(v => new Set(v.map(s => `${s.kind}:${s.id}`)).size === v.length, 'Duplicate subject'),
  intent: z.enum(USAGE_INTENTS),
  question: z.preprocess(v => v ?? '', text(0, 2000)),
  // An empty list is the same as not answering: stored as null (unknown), never as "none" or "all".
  hints: z.preprocess(v => Array.isArray(v) && v.length === 0 ? null : v, unique(z.enum(USAGE_HINTS), 1, 6).nullable().default(null)),
  durationHint: z.preprocess(v => v === '' ? null : v, z.enum(USAGE_DURATION_HINTS).nullable().default(null)),
  timingText: optionalText(500),
  budgetKrw: z.preprocess(v => v === '' ? null : v, z.number().int().min(0).max(1_000_000_000_000).nullable().default(null)),
}).refine(v => v.intent !== 'question' || v.question.length > 0, { path: ['question'], message: 'Write the question' });

export const UsageMessageSchema = z.object({ caseId: id, body: text(1, 4000), requestId: id });
export const UsageCaseRevisionSchema = z.object({ caseId: id, expectedRevision: z.number().int().nonnegative() });
export const UsageChangeRequestSchema = UsageCaseRevisionSchema.extend({ body: text(1, 4000), requestId: id });
export const UsageAcceptSchema = UsageCaseRevisionSchema.extend({ quoteId: id, requestId: id, confirmed: z.literal(true) });

// ---------------------------------------------------------------- studio

const Pin = z.discriminatedUnion('kind', [
  /** The approved content version behind the item (a content item, or a post published from approved content). */
  z.object({ kind: z.literal('content_version') }),
  /** Reshare of this post URL as published. Never source files or edits. */
  z.object({ kind: z.literal('original_post') }),
  /** A master file the studio uploaded to this campaign; its bytes' hash is pinned. */
  z.object({ kind: z.literal('master'), attachmentId: id }),
]);
const Timing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), startsOn: date, endsOn: date }).refine(v => v.endsOn >= v.startsOn, { path: ['endsOn'], message: 'End must follow start' }),
  z.object({ kind: z.literal('first_use'), durationDays: z.number().int().min(1).max(3650) }),
]);
export const UsageScopeItemSchema = z.object({
  itemId: id, pin: Pin,
  usageKinds: unique(z.enum(USAGE_KINDS), 1, USAGE_KINDS.length),
  channels: unique(text(1, 80), 1, 20),
  territory: unique(z.string().regex(/^[A-Z]{2}$/), 1, 30),
  advertiser: z.preprocess(v => typeof v === 'string' && v.trim() === '' ? null : v, text(1, 120).nullable().default(null)),
  edits: z.enum(USAGE_EDITS),
  timing: Timing,
}).superRefine((v, ctx) => {
  const ads = v.usageKinds.includes('paid_ads') || v.usageKinds.includes('partnership_ads');
  if (ads && !v.advertiser) ctx.addIssue({ code: 'custom', path: ['advertiser'], message: 'Ads need the advertiser' });
  if (v.usageKinds.includes('edit_cutdown') !== (v.edits !== 'none')) ctx.addIssue({ code: 'custom', path: ['edits'], message: 'Edits and the edit usage kind go together' });
  if (v.pin.kind === 'original_post' && v.edits !== 'none')
    ctx.addIssue({ code: 'custom', path: ['pin'], message: 'An original post can only be used as published' });
});
export const UsageScopeSchema = z.object({
  caseId: id, expectedRevision: z.number().int().nonnegative(), requestId: id,
  items: z.array(UsageScopeItemSchema).min(1).max(10).refine(v => new Set(v.map(i => i.itemId)).size === v.length, 'Duplicate item'),
  excludedNote: z.preprocess(v => v ?? '', text(0, 1000)),
});
export const UsageCompensationSchema = z.object({
  caseId: id, scopeRevisionId: id, requestId: id,
  amountKrw: z.number().int().min(0).max(1_000_000_000_000), taxBasis: z.enum(['included', 'excluded']), note: z.preprocess(v => v ?? '', text(0, 2000)),
});
export const UsageConsentSchema = z.object({
  caseId: id, itemId: id, scopeRevisionId: id, compensationId: id, requestId: id,
  approverKind: z.enum(['creator', 'agency', 'rights_holder']), approvedAt: z.string().datetime({ offset: true }),
  evidenceReference: text(1, 500),
  rightsChecks: z.array(z.enum(['ownership', 'music', 'people', 'marks'])).refine(v => ['ownership', 'music', 'people', 'marks'].every(k => v.includes(k as never)), 'Every rights check must be confirmed'),
});
export const UsageConsentWithdrawSchema = z.object({ caseId: id, consentId: id });
export const UsageQuoteSchema = z.object({
  caseId: id, expectedRevision: z.number().int().nonnegative(), requestId: id, scopeRevisionId: id,
  totalKrw: z.number().int().min(1).max(1_000_000_000_000), taxBasis: z.enum(['included', 'excluded']),
  validUntil: z.string().datetime({ offset: true }), contractId: id, note: z.preprocess(v => v ?? '', text(0, 2000)),
});
export const UsageCloseSchema = UsageCaseRevisionSchema.extend({ reason: z.enum(USAGE_CLOSE_REASONS) });
export const UsageBuyerSchema = z.object({ organizationId: id, userId: id, grant: z.boolean(), reason: z.preprocess(v => v ?? '', text(0, 500)) })
  .refine(v => !v.grant || v.reason.length > 0, { path: ['reason'], message: 'Record the documented authority' });
export const UsageGrantEventSchema = z.object({ grantId: id, requestId: id, kind: z.enum(['suspended', 'resumed', 'terminated']), reason: text(1, 500) });
export const UsageGrantStartSchema = z.object({ grantId: id, requestId: id, startsOn: date, reason: text(1, 500) });
/** `abandon` releases an unconfirmed payment only after the provider shows it was not paid (payment.ts). */
export const UsageResolveSchema = z.object({ caseId: id, action: z.enum(['reverify', 'refund', 'abandon']), reason: text(1, 500) });

export type UsageInquiry = z.output<typeof UsageInquirySchema>;
export type UsageScopeItemInput = z.output<typeof UsageScopeItemSchema>;

/** Stable JSON: keys sorted at every depth, so the same scope always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const scopeSha256 = (scope: unknown) => createHash('sha256').update(canonicalJson(scope)).digest('hex');

/** 00:00 Korea time of a calendar date, as an instant. Korea has no daylight saving time. */
export function koreaMidnight(day: string): Date { return new Date(`${day}T00:00:00+09:00`); }
