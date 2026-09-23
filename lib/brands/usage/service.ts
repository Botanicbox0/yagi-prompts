import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  UsageInquirySchema, UsageMessageSchema, UsageCaseRevisionSchema, UsageChangeRequestSchema, UsageAcceptSchema,
  UsageScopeSchema, UsageCompensationSchema, UsageConsentSchema, UsageConsentWithdrawSchema, UsageQuoteSchema,
  UsageCloseSchema, UsageBuyerSchema, UsageGrantEventSchema, UsageGrantStartSchema,
  USAGE_EXCLUSIONS, USAGE_TIME_ZONE, USAGE_ACCEPTANCE_STATEMENT, koreaMidnight, scopeSha256,
} from './schemas';
import {
  Denied, type Row, uuid, stamp, nullableStamp, clock, studio, mutation, writer, buyer, isBuyer, readable,
  lockCase, setStatus, usageEvent, latestScope, latestCompensation, checkPins, checkTerms, checkQuoteBasis, recordOutcome, grantState,
  windowsOpen, latestAcceptance,
} from './core';
import type {
  UsageOutcome, UsageScope, UsageScopeItem, UsageSubjectPin, BrandUsageView, BrandUsageCase, BrandUsageState,
  StudioUsageCase, StudioUsageQueueRow, UsageCaseStatus,
} from './types';
export type * from './types';

/**
 * Brand secondary usage ("2차 활용"): the case, its thread, the studio's scope/consent/quote records,
 * acceptance and grants. Payment lives in ./payment.ts. docs/SECONDARY-USAGE.md.
 *
 * Brand operations collapse every internal guard failure to `conflict`: the brand is never told
 * which consent, pin or compensation check failed. Studio operations return the detailed code.
 */
export interface UsageDeps { sql: SqlRunner; now?: Date; verifiedEmail?: string; paymentsOpen?: boolean }

/** Audit reason on the automatic hold (grant_events.reason is free text; this one is fixed). */
export const CONSENT_WITHDRAWN_HOLD = 'Creator consent withdrawn; studio review required';
const PRE_PAYMENT: UsageCaseStatus[] = ['inquiry', 'scoping', 'scope_defined', 'quoted', 'accepted'];
/** Anything the provider may have charged, or that the studio must still decide (`review`). */
const LIVE_PAYMENT = ['confirming', 'paid', 'refund_pending', 'refunded', 'review'];
/** Guard failures reach the brand as a plain "this changed, refresh". */
async function asBrand<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof Denied && !['not_found', 'forbidden', 'sign_in_required', 'invalid', 'rate_limited', 'not_active'].includes(error.code)) throw new Denied('conflict');
    throw error;
  }
}
/** An accepted-but-unpaid quote can be let go only while nothing has reached the provider. */
async function releaseUnpaid(sql: SqlRunner, caseId: unknown): Promise<void> {
  const live = (await sql.query('select status from brand_usage_payments where case_id=$1 and status=any($2::text[])', [caseId, LIVE_PAYMENT])).rows;
  if (live.length) throw new Denied('conflict');
  await sql.query("update brand_usage_payments set status='expired',updated_at=now() where case_id=$1 and status='pending'", [caseId]);
}
async function currentQuote(sql: SqlRunner, caseId: unknown): Promise<Row | null> {
  return (await sql.query("select * from brand_usage_quotes where case_id=$1 and status in ('open','accepted') for update", [caseId])).rows[0] ?? null;
}

// ------------------------------------------------------------------------------------------ brand

async function eligibleContent(sql: SqlRunner, projectId: unknown, id: string): Promise<boolean> {
  return (await sql.query(`select 1 from brand_content_versions c join brand_content_decisions d on d.content_version_id=c.id and d.revision=c.review_revision
    where c.project_id=$1 and c.id=$2 and d.decision='approved'
    and not exists(select 1 from brand_content_versions n where n.project_id=c.project_id and n.slot_key=c.slot_key and n.version>c.version)`, [projectId, id])).rows.length > 0;
}

/**
 * "2차 활용 견적 문의": the selected content plus what the brand wants to know. Nothing else is
 * required, nothing is granted and nothing is charged. Imported posts are eligible to ask about.
 */
export async function submitUsageInquiry(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageInquirySchema, input, async (sql, userId, v) => {
    const { project: p } = await writer(sql, userId, v.projectId);
    const old = (await sql.query('select id from brand_usage_cases where project_id=$1 and created_by=$2 and request_id=$3', [p.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    if (!['active', 'completed'].includes(String(p.status))) throw new Denied('not_active');
    const recent = (await sql.query<{ n: number }>("select count(*)::int n from brand_usage_cases where project_id=$1 and created_at>now()-interval '1 day'", [p.id])).rows[0]!.n;
    if (recent >= 30) throw new Denied('rate_limited');
    for (const subject of v.subjects) {
      const ok = subject.kind === 'content_version' ? await eligibleContent(sql, p.id, subject.id)
        : (await sql.query('select 1 from brand_posts where project_id=$1 and id=$2', [p.id, subject.id])).rows.length > 0;
      if (!ok) throw new Denied('not_found');
    }
    const id = randomUUID();
    await sql.query(`insert into brand_usage_cases(id,organization_id,project_id,intent,question,hints,duration_hint,timing_text,budget_krw,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, p.organization_id, p.id, v.intent, v.question, v.hints, v.durationHint, v.timingText, v.budgetKrw, userId, v.requestId]);
    for (const [i, subject] of v.subjects.entries())
      await sql.query(`insert into brand_usage_case_items(case_id,organization_id,project_id,position,subject_kind,content_version_id,post_id) values($1,$2,$3,$4,$5,$6,$7)`,
        [id, p.organization_id, p.id, i + 1, subject.kind, subject.kind === 'content_version' ? subject.id : null, subject.kind === 'post' ? subject.id : null]);
    await usageEvent(sql, id, 'inquired', 'brand', userId);
    return { id };
  });
}

/** `entry` comes from the server surface (brand API: client, /admin: studio), never from the request. */
export async function sendUsageMessage(deps: UsageDeps, viewer: Viewer, input: unknown, entry: 'client' | 'studio'): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageMessageSchema, input, async (sql, userId, v) => {
    if (entry === 'studio') await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    if (entry === 'client') await writer(sql, userId, String(c.project_id));
    const old = (await sql.query('select id from brand_usage_messages where case_id=$1 and created_by=$2 and request_id=$3', [c.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    if (entry === 'client' && ['withdrawn', 'closed'].includes(String(c.status))) throw new Denied('conflict');
    const recent = (await sql.query<{ n: number }>("select count(*)::int n from brand_usage_messages where created_by=$1 and created_at>now()-interval '1 minute'", [userId])).rows[0]!.n;
    if (recent >= 10) throw new Denied('rate_limited');
    const id = randomUUID();
    await sql.query('insert into brand_usage_messages(id,case_id,organization_id,project_id,body,author_role,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, c.id, c.organization_id, c.project_id, v.body, entry === 'studio' ? 'studio' : 'brand', userId, v.requestId]);
    await sql.query('update brand_usage_cases set updated_at=now() where id=$1', [c.id]);
    return { id };
  });
}

/** The brand stops the inquiry, or declines the quote. Refused once anything reached the payment provider. */
export async function withdrawUsageCase(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageCaseRevisionSchema, input, async (sql, userId, v) => {
    const c = await lockCase(sql, v.caseId);
    await writer(sql, userId, String(c.project_id));
    if (Number(c.revision) !== v.expectedRevision || !PRE_PAYMENT.includes(c.status as UsageCaseStatus)) throw new Denied('conflict');
    await releaseUnpaid(sql, c.id);
    const quote = await currentQuote(sql, c.id);
    if (quote) {
      await sql.query("update brand_usage_quotes set status='declined' where id=$1", [quote.id]);
      await recordOutcome(sql, quote, 'declined');
    }
    await setStatus(sql, c, 'withdrawn');
    await usageEvent(sql, c.id, 'withdrawn', 'brand', userId, quote?.id ?? null);
    return { id: String(c.id) };
  });
}

/** The brand asks for different terms: the open quote is superseded and the studio re-scopes. */
export async function requestUsageChanges(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageChangeRequestSchema, input, async (sql, userId, v) => {
    const c = await lockCase(sql, v.caseId);
    await writer(sql, userId, String(c.project_id));
    if (Number(c.revision) !== v.expectedRevision || c.status !== 'quoted') throw new Denied('conflict');
    const quote = await currentQuote(sql, c.id);
    if (quote) await sql.query("update brand_usage_quotes set status='superseded' where id=$1", [quote.id]);
    await sql.query('insert into brand_usage_messages(case_id,organization_id,project_id,body,author_role,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7)',
      [c.id, c.organization_id, c.project_id, v.body, 'brand', userId, v.requestId]);
    await setStatus(sql, c, 'scoping');
    await usageEvent(sql, c.id, 'reopened', 'brand', userId, quote?.id ?? null);
    return { id: String(c.id) };
  });
}

/**
 * Guard A. The buyer accepts the exact, latest, unexpired quote while every consent it relies on still
 * matches. Locks the case row the studio's re-quote also locks, so exactly one of them wins.
 */
export async function acceptUsageQuote(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageAcceptSchema, input, async (sql, userId, v) => {
    const c = await lockCase(sql, v.caseId);
    await buyer(sql, userId, String(c.project_id));
    const same = (await sql.query("select id from brand_usage_quotes where id=$1 and case_id=$2 and status='accepted' and accepted_by=$3 and acceptance_request_id=$4", [v.quoteId, c.id, userId, v.requestId])).rows[0];
    if (same) return { id: String(same.id) };
    if (Number(c.revision) !== v.expectedRevision || c.status !== 'quoted' || deps.paymentsOpen !== true) throw new Denied('conflict');
    const quote = await currentQuote(sql, c.id);
    if (!quote || quote.id !== v.quoteId || quote.status !== 'open' || clock(deps) >= new Date(stamp(quote.valid_until))) throw new Denied('conflict');
    // Online acceptance only for a final, tax-inclusive payable total with its shared terms (docs §2).
    if (quote.tax_basis !== 'included') throw new Denied('conflict');
    await asBrand(() => checkQuoteBasis(sql, quote, clock(deps)));
    await sql.query("update brand_usage_quotes set status='accepted',accepted_by=$2,accepted_at=$3,acceptance_request_id=$4,acceptance_statement=$5 where id=$1",
      [quote.id, userId, clock(deps), v.requestId, USAGE_ACCEPTANCE_STATEMENT]);
    await setStatus(sql, c, 'accepted');
    await usageEvent(sql, c.id, 'accepted', 'brand', userId, quote.id);
    return { id: String(quote.id) };
  });
}

function brandState(c: Row, quote: Row | null, payment: Row | null, now: Date, suspended: boolean): BrandUsageState {
  switch (c.status as UsageCaseStatus) {
    case 'inquiry': return 'submitted';
    case 'scoping': case 'scope_defined': return 'in_review';
    case 'quoted': return quote && now >= new Date(stamp(quote.valid_until)) ? 'quote_expired' : 'quoted';
    case 'accepted': return payment?.status === 'confirming' || payment?.status === 'review' ? 'payment_confirming' : 'awaiting_payment';
    case 'paid': return 'confirming_terms';
    // Never an unqualified "licensed" while any grant is on hold (e.g. the creator withdrew consent).
    case 'fulfilled': return suspended ? 'suspended' : 'licensed';
    case 'blocked_after_payment': return 'needs_attention';
    case 'withdrawn': return 'withdrawn';
    case 'closed': return c.close_reason === 'refunded' ? 'refunded' : c.close_reason === 'creator_declined' ? 'declined' : 'closed';
  }
}

/**
 * The brand's "2차 활용" tab. Projected field by field: no compensation, consent, evidence, internal
 * reason, pin hash or payment key. Campaign guests and outsiders get null (404); the TWINGS team reads.
 */
export async function loadBrandUsage(deps: UsageDeps, viewer: Viewer, projectId: string): Promise<BrandUsageView | null> {
  if (!uuid(viewer.userId) || !uuid(projectId)) return null;
  const now = clock(deps);
  try { return await deps.sql.transaction(async sql => {
    const { role, project: p } = await readable(sql, viewer.userId!, projectId, deps.verifiedEmail);
    const canWrite = role === 'owner' || role === 'editor';
    const isBuyerNow = role !== 'studio' && await isBuyer(sql, String(p.organization_id), viewer.userId!, role);
    const paymentsOpen = deps.paymentsOpen === true;
    const cases = (await sql.query('select * from brand_usage_cases where project_id=$1 order by created_at desc', [p.id])).rows;
    const caseIds = cases.map(c => c.id);
    const byCase = async (table: string, order: string) => (await sql.query(`select * from ${table} where case_id=any($1::uuid[]) order by ${order}`, [caseIds])).rows;
    const items = (await sql.query(`select i.*,c.title as content_title,po.url as post_url,po.platform as post_platform,po.origin as post_origin,po.creator_handle
      from brand_usage_case_items i left join brand_content_versions c on c.id=i.content_version_id left join brand_posts po on po.id=i.post_id
      where i.case_id=any($1::uuid[]) order by i.position`, [caseIds])).rows;
    const messages = await byCase('brand_usage_messages', 'created_at,id');
    const quotes = await byCase('brand_usage_quotes', 'revision');
    const payments = await byCase('brand_usage_payments', 'created_at');
    const grants = await byCase('brand_usage_grants', 'created_at');
    const grantEvents = grants.length ? (await sql.query('select * from brand_usage_grant_events where grant_id=any($1::uuid[])', [grants.map(g => g.id)])).rows : [];
    const scopes = quotes.length ? (await sql.query('select id,scope from brand_usage_scope_revisions where id=any($1::uuid[])', [quotes.map(q => q.scope_revision_id)])).rows : [];
    const contracts = quotes.length ? (await sql.query('select id,title,version,attachment_id,shared from brand_contract_documents where id=any($1::uuid[])', [quotes.map(q => q.terms_contract_id)])).rows : [];
    const label = (i: Row | undefined) => i ? (i.content_title != null ? String(i.content_title) : i.creator_handle != null ? `@${String(i.creator_handle)}` : null) : null;
    const views: BrandUsageCase[] = cases.map(c => {
      const mine = items.filter(i => i.case_id === c.id);
      const ended = ['withdrawn', 'closed'].includes(String(c.status));
      const quote = quotes.filter(q => q.case_id === c.id && (q.status === 'open' || q.status === 'accepted' || (ended && c.close_reason === 'refunded' && q.status === 'superseded'))).at(-1) ?? null;
      const payment = payments.filter(x => x.case_id === c.id).at(-1) ?? null;
      const expired = quote ? now >= new Date(stamp(quote.valid_until)) : false;
      const caseGrants = grants.filter(g => g.case_id === c.id);
      const state = brandState(c, quote, payment, now, caseGrants.some(g => grantState(g, grantEvents, now) === 'suspended'));
      const scope = quote ? scopes.find(s => s.id === quote.scope_revision_id)?.scope as UsageScope | undefined : undefined;
      const contract = quote ? contracts.find(d => d.id === quote.terms_contract_id) : undefined;
      const livePayment = payment && LIVE_PAYMENT.includes(String(payment.status));
      // Checkout needs the full terms: a tax-inclusive final total and the shared contract, both visible now.
      const payable = !!quote && quote.tax_basis === 'included' && contract?.shared === true;
      return {
        id: String(c.id), state, revision: Number(c.revision), createdAt: stamp(c.created_at), updatedAt: stamp(c.updated_at),
        intent: c.intent as BrandUsageCase['intent'], question: String(c.question), hints: (c.hints as BrandUsageCase['hints']) ?? null,
        durationHint: (c.duration_hint as BrandUsageCase['durationHint']) ?? null, timingText: c.timing_text == null ? null : String(c.timing_text),
        budgetKrw: c.budget_krw == null ? null : Number(c.budget_krw),
        subjects: mine.map(i => ({ itemId: String(i.id), kind: i.subject_kind as 'content_version' | 'post', label: label(i),
          url: i.post_url == null ? null : String(i.post_url), platform: i.post_platform == null ? null : String(i.post_platform),
          origin: i.post_origin == null ? null : i.post_origin === 'external_import' ? 'external_import' : 'approved_content' })),
        messages: messages.filter(m => m.case_id === c.id).map(m => ({ id: String(m.id), body: String(m.body), authorRole: m.author_role as 'brand' | 'studio', createdAt: stamp(m.created_at) })),
        availability: c.status === 'scope_defined' ? 'checking' : ['quoted', 'accepted', 'paid', 'fulfilled', 'blocked_after_payment'].includes(String(c.status)) ? 'confirmed' : null,
        quote: quote && scope ? {
          id: String(quote.id), revision: Number(quote.revision), totalKrw: Number(quote.total_krw), taxBasis: quote.tax_basis as 'included' | 'excluded', currency: 'KRW',
          validUntil: stamp(quote.valid_until), expired, note: String(quote.note), status: quote.status as 'open' | 'accepted' | 'superseded' | 'declined',
          scope: { timeZone: scope.timeZone, exclusions: [...scope.exclusions], excludedNote: scope.excludedNote, items: scope.items.map(i => {
            const item = mine.find(x => x.id === i.itemId);
            return { itemId: i.itemId, usageKinds: [...i.usageKinds], channels: [...i.channels], territory: [...i.territory], advertiser: i.advertiser, edits: i.edits,
              timing: i.timing.kind === 'fixed' ? { kind: 'fixed' as const, startsOn: i.timing.startsOn, endsOn: i.timing.endsOn } : { kind: 'first_use' as const, durationDays: i.timing.durationDays },
              subjectKind: i.subject.kind, subjectLabel: label(item), subjectPlatform: item?.post_platform == null ? null : String(item.post_platform) };
          }) },
          contract: contract && contract.shared === true ? { title: String(contract.title), version: Number(contract.version), url: `/api/brand-workspace/attachments/${contract.attachment_id}` } : null,
          acceptedAt: nullableStamp(quote.accepted_at),
        } : null,
        payment: payment ? { id: String(payment.id), status: payment.status as NonNullable<BrandUsageCase['payment']>['status'], amountKrw: Number(payment.amount_krw) } : null,
        grants: caseGrants.map(g => {
          const item = mine.find(x => x.id === g.item_id);
          return { id: String(g.id), itemId: String(g.item_id), subjectLabel: label(item), subjectPlatform: item?.post_platform == null ? null : String(item.post_platform),
            state: grantState(g, grantEvents, now), startsAt: nullableStamp(g.starts_at), endsAt: nullableStamp(g.ends_at), durationDays: g.duration_days == null ? null : Number(g.duration_days) };
        }),
        actions: {
          message: canWrite && !ended,
          withdraw: canWrite && PRE_PAYMENT.includes(c.status as UsageCaseStatus) && !livePayment,
          requestChanges: canWrite && c.status === 'quoted',
          accept: isBuyerNow && paymentsOpen && payable && c.status === 'quoted' && !expired,
          pay: isBuyerNow && paymentsOpen && payable && c.status === 'accepted' && !expired && !livePayment,
        },
      };
    });
    const eligible: BrandUsageView['eligible'] = [];
    if (canWrite && ['active', 'completed'].includes(String(p.status))) {
      const contents = (await sql.query(`select c.id,c.title from brand_content_versions c join brand_content_decisions d on d.content_version_id=c.id and d.revision=c.review_revision
        where c.project_id=$1 and d.decision='approved' and not exists(select 1 from brand_content_versions n where n.project_id=c.project_id and n.slot_key=c.slot_key and n.version>c.version)
        order by c.created_at`, [p.id])).rows;
      for (const r of contents) eligible.push({ kind: 'content_version', id: String(r.id), label: String(r.title) });
      const posts = (await sql.query('select id,platform,creator_handle from brand_posts where project_id=$1 order by created_at', [p.id])).rows;
      for (const r of posts) eligible.push({ kind: 'post', id: String(r.id), label: r.creator_handle != null ? `@${String(r.creator_handle)}` : String(r.platform) });
    }
    return { role, buyer: isBuyerNow, paymentsOpen, cases: views, eligible };
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}

// ----------------------------------------------------------------------------------------- studio

export async function triageUsageCase(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageCaseRevisionSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    if (Number(c.revision) !== v.expectedRevision || c.status !== 'inquiry') throw new Denied('conflict');
    await setStatus(sql, c, 'scoping');
    await usageEvent(sql, c.id, 'triaged', 'studio', userId);
    return { id: String(c.id) };
  });
}

/**
 * The studio's complete, structured scope for this case. Each subject is pinned here, from the database
 * (never from the form): the approved version's file hash, the imported post's exact URL, or a master
 * file's hash. An imported post can never be pinned as a "content version": it never went through review.
 */
export async function defineUsageScope(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageScopeSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    const old = (await sql.query('select id from brand_usage_scope_revisions where case_id=$1 and created_by=$2 and request_id=$3', [c.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    if (Number(c.revision) !== v.expectedRevision || !['scoping', 'scope_defined'].includes(String(c.status))) throw new Denied('conflict');
    const caseItems = (await sql.query(`select i.*,p.origin,p.content_version_id as post_content_version_id,p.url,p.platform,p.platform_post_id
      from brand_usage_case_items i left join brand_posts p on p.id=i.post_id where i.case_id=$1`, [c.id])).rows;
    const items: UsageScopeItem[] = [];
    for (const input of v.items) {
      const item = caseItems.find(i => i.id === input.itemId);
      if (!item) throw new Denied('invalid');
      let subject: UsageSubjectPin;
      if (input.pin.kind === 'content_version') {
        const versionId = item.subject_kind === 'content_version' ? item.content_version_id : item.origin === 'approved_content' ? item.post_content_version_id : null;
        const cv = versionId ? (await sql.query('select id,asset_sha256,title from brand_content_versions where project_id=$1 and id=$2', [c.project_id, versionId])).rows[0] : undefined;
        if (!cv) throw new Denied('subject_unpinned');
        subject = { kind: 'content_version', contentVersionId: String(cv.id), assetSha256: String(cv.asset_sha256), title: String(cv.title) };
      } else if (input.pin.kind === 'original_post') {
        if (item.subject_kind !== 'post') throw new Denied('subject_unpinned');
        subject = { kind: 'original_post', postId: String(item.post_id), url: String(item.url), platform: String(item.platform), platformPostId: String(item.platform_post_id) };
      } else {
        const a = (await sql.query(`select id,sha256,name from brand_attachments where project_id=$1 and id=$2 and status='ready' and access_scope='workspace'
          and mime like any(array['image/%','video/%'])`, [c.project_id, input.pin.attachmentId])).rows[0];
        if (!a) throw new Denied('invalid');
        subject = { kind: 'master', attachmentId: String(a.id), assetSha256: String(a.sha256), name: String(a.name) };
      }
      items.push({ itemId: input.itemId, subject, usageKinds: [...input.usageKinds].sort() as UsageScopeItem['usageKinds'], channels: input.channels,
        territory: [...input.territory].sort(), advertiser: input.advertiser, edits: input.edits, timing: input.timing });
    }
    const scope: UsageScope = { version: 1, timeZone: USAGE_TIME_ZONE, exclusions: [...USAGE_EXCLUSIONS], excludedNote: v.excludedNote, items };
    const revision = Number((await sql.query<{ n: number }>('select coalesce(max(revision),0)+1 n from brand_usage_scope_revisions where case_id=$1', [c.id])).rows[0]!.n);
    const id = randomUUID();
    await sql.query('insert into brand_usage_scope_revisions(id,case_id,revision,scope,scope_sha256,created_by,request_id) values($1,$2,$3,$4::jsonb,$5,$6,$7)',
      [id, c.id, revision, JSON.stringify(scope), scopeSha256(scope), userId, v.requestId]);
    await setStatus(sql, c, 'scope_defined');
    await usageEvent(sql, c.id, 'scope_defined', 'studio', userId);
    return { id };
  });
}

async function scopeForConsent(sql: SqlRunner, c: Row, scopeRevisionId: string): Promise<Row> {
  if (c.status !== 'scope_defined') throw new Denied('conflict');
  const latest = await latestScope(sql, c.id);
  if (!latest || latest.id !== scopeRevisionId) throw new Denied('conflict');
  return latest;
}
/** STUDIO ONLY. The amount agreed with the creator for this scope revision. A new amount needs new consent. */
export async function recordUsageCompensation(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageCompensationSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    const old = (await sql.query('select id from brand_usage_compensations where case_id=$1 and created_by=$2 and request_id=$3', [c.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    await scopeForConsent(sql, c, v.scopeRevisionId);
    const revision = Number((await sql.query<{ n: number }>('select coalesce(max(revision),0)+1 n from brand_usage_compensations where case_id=$1', [c.id])).rows[0]!.n);
    const id = randomUUID();
    await sql.query('insert into brand_usage_compensations(id,case_id,scope_revision_id,revision,amount_krw,tax_basis,note,created_by,request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, c.id, v.scopeRevisionId, revision, v.amountKrw, v.taxBasis, v.note, userId, v.requestId]);
    await usageEvent(sql, c.id, 'compensation_recorded', 'studio', userId);
    return { id };
  });
}
/**
 * STUDIO ONLY. The creator (or their agency / rights holder) approved exactly this scope revision and
 * compensation, outside the system. Only an administrator records it; no brand action can.
 */
export async function recordUsageConsent(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageConsentSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    const old = (await sql.query('select id from brand_usage_consents where case_id=$1 and recorded_by=$2 and request_id=$3', [c.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    const scope = await scopeForConsent(sql, c, v.scopeRevisionId);
    if (!(scope.scope as UsageScope).items.some(i => i.itemId === v.itemId)) throw new Denied('invalid');
    const compensation = await latestCompensation(sql, c.id, v.scopeRevisionId);
    if (!compensation || compensation.id !== v.compensationId) throw new Denied('conflict');
    if (+new Date(v.approvedAt) > Date.now() + 300000) throw new Denied('invalid');
    const id = randomUUID();
    await sql.query(`insert into brand_usage_consents(id,case_id,item_id,scope_revision_id,scope_sha256,compensation_id,approver_kind,approved_at,evidence_reference,rights_checks,recorded_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, c.id, v.itemId, scope.id, scope.scope_sha256, compensation.id, v.approverKind, v.approvedAt, v.evidenceReference, v.rightsChecks, userId, v.requestId]);
    await usageEvent(sql, c.id, 'consent_recorded', 'studio', userId);
    return { id };
  });
}
export async function withdrawUsageConsent(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageConsentWithdrawSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    const r = (await sql.query('update brand_usage_consents set withdrawn_at=now(),withdrawn_by=$3 where id=$1 and case_id=$2 and withdrawn_at is null returning id', [v.consentId, c.id, userId])).rows[0];
    if (!r) throw new Denied('not_found');
    await usageEvent(sql, c.id, 'consent_withdrawn', 'studio', userId);
    // Grants already issued on this consent go on hold at once (an appended audit event, nothing
    // rewritten), and the case is flagged to the top of the studio queue for a decision.
    const grants = (await sql.query('select * from brand_usage_grants where consent_id=$1 for update', [r.id])).rows;
    const events = grants.length ? (await sql.query('select * from brand_usage_grant_events where grant_id=any($1::uuid[])', [grants.map(g => g.id)])).rows : [];
    let held = 0;
    for (const g of grants) {
      if (['suspended', 'terminated'].includes(grantState(g, events, clock(deps)))) continue;
      await sql.query("insert into brand_usage_grant_events(grant_id,kind,reason,created_by,request_id) values($1,'suspended',$2,$3,$4)",
        [g.id, CONSENT_WITHDRAWN_HOLD, userId, randomUUID()]);
      held++;
    }
    if (grants.length) await sql.query("update brand_usage_cases set blocked_reason='consent_withdrawn',updated_at=now() where id=$1", [c.id]);
    return { id: String(r.id), held };
  });
}

/**
 * The brand's final price for the latest scope revision. Refused unless every scoped item has live
 * consent on that exact hash, backed by the latest compensation, every subject is pinned and the
 * customer-safe terms PDF is shared. The operator enters the amount and tax basis; nothing is derived.
 */
export async function issueUsageQuote(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageQuoteSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    const old = (await sql.query('select id from brand_usage_quotes where case_id=$1 and created_by=$2 and request_id=$3', [c.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    if (Number(c.revision) !== v.expectedRevision) throw new Denied('conflict');
    const scopeRow = await scopeForConsent(sql, c, v.scopeRevisionId);
    if (+new Date(v.validUntil) <= +clock(deps)) throw new Denied('invalid');
    const scope = scopeRow.scope as UsageScope;
    // A fixed window that already ended cannot be quoted, and the quote cannot stay acceptable past the
    // end of its earliest fixed window: the brand must never be able to pay for days already gone.
    const latest = latestAcceptance(scope);
    if (!windowsOpen(scope, clock(deps)) || (latest && +new Date(v.validUntil) > +latest)) throw new Denied('expired');
    const compensation = await latestCompensation(sql, c.id, scopeRow.id);
    const consents = (await sql.query('select * from brand_usage_consents where case_id=$1 and scope_revision_id=$2 and withdrawn_at is null', [c.id, scopeRow.id])).rows;
    const used: string[] = [];
    for (const item of scope.items) {
      const consent = consents.find(x => x.item_id === item.itemId && x.scope_sha256 === scopeRow.scope_sha256 && compensation && x.compensation_id === compensation.id);
      if (!consent) throw new Denied('consent_missing');
      used.push(String(consent.id));
    }
    await checkPins(sql, c.project_id, scope);
    const termsSha = await checkTerms(sql, c.project_id, v.contractId);
    const revision = Number((await sql.query<{ n: number }>('select coalesce(max(revision),0)+1 n from brand_usage_quotes where case_id=$1', [c.id])).rows[0]!.n);
    const id = randomUUID();
    await sql.query(`insert into brand_usage_quotes(id,case_id,organization_id,project_id,revision,scope_revision_id,scope_sha256,consent_ids,total_krw,tax_basis,valid_until,terms_contract_id,terms_sha256,note,created_by,request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, c.id, c.organization_id, c.project_id, revision, scopeRow.id, scopeRow.scope_sha256, used, v.totalKrw, v.taxBasis, v.validUntil, v.contractId, termsSha, v.note, userId, v.requestId]);
    await setStatus(sql, c, 'quoted');
    await usageEvent(sql, c.id, 'quoted', 'studio', userId, id);
    return { id };
  });
}

/** Back to scoping: the open (or accepted-but-unpaid) quote is superseded. Refused once a payment is live. */
export async function reopenUsageCase(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageCaseRevisionSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    if (Number(c.revision) !== v.expectedRevision || !['quoted', 'accepted'].includes(String(c.status))) throw new Denied('conflict');
    await releaseUnpaid(sql, c.id);
    const quote = await currentQuote(sql, c.id);
    if (quote) await sql.query("update brand_usage_quotes set status='superseded' where id=$1", [quote.id]);
    await setStatus(sql, c, 'scoping');
    await usageEvent(sql, c.id, 'reopened', 'studio', userId, quote?.id ?? null);
    return { id: String(c.id) };
  });
}
export async function closeUsageCase(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageCloseSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const c = await lockCase(sql, v.caseId);
    if (Number(c.revision) !== v.expectedRevision || !PRE_PAYMENT.includes(c.status as UsageCaseStatus)) throw new Denied('conflict');
    await releaseUnpaid(sql, c.id);
    const quote = await currentQuote(sql, c.id);
    if (quote) {
      await sql.query("update brand_usage_quotes set status='superseded' where id=$1", [quote.id]);
      await recordOutcome(sql, quote, clock(deps) >= new Date(stamp(quote.valid_until)) ? 'expired' : 'closed');
    }
    await setStatus(sql, c, 'closed', { closeReason: v.reason });
    await usageEvent(sql, c.id, 'closed', 'studio', userId, quote?.id ?? null);
    return { id: String(c.id) };
  });
}

/** Studio-recorded purchasing authority for an editor, on documented instruction. Owners need none. */
export async function setUsageBuyer(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageBuyerSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    await sql.query('select id from brand_organizations where id=$1 for update', [v.organizationId]);
    const m = (await sql.query("select role from brand_memberships where organization_id=$1 and user_id=$2 and status='active'", [v.organizationId, v.userId])).rows[0];
    if (v.grant) {
      // The studio never makes itself, or any studio account, a buyer for a customer (core.ts isBuyer).
      const target = (await sql.query('select is_admin from profiles where id=$1', [v.userId])).rows[0];
      if (v.userId === userId || target?.is_admin === true) throw new Denied('forbidden');
      if (!m) throw new Denied('not_found');
      if (m.role !== 'editor') throw new Denied('invalid');
      const live = (await sql.query('select id from brand_usage_buyers where organization_id=$1 and user_id=$2 and revoked_at is null', [v.organizationId, v.userId])).rows[0];
      if (live) return { id: String(live.id) };
      const id = randomUUID();
      await sql.query('insert into brand_usage_buyers(id,organization_id,user_id,reason,granted_by) values($1,$2,$3,$4,$5)', [id, v.organizationId, v.userId, v.reason, userId]);
      return { id };
    }
    const r = (await sql.query("update brand_usage_buyers set revoked_at=now(),revoked_by=$3,revoke_reason='studio' where organization_id=$1 and user_id=$2 and revoked_at is null returning id", [v.organizationId, v.userId, userId])).rows[0];
    if (!r) throw new Denied('not_found');
    return { id: String(r.id) };
  });
}

export async function recordUsageGrantEvent(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageGrantEventSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const g = (await sql.query('select * from brand_usage_grants where id=$1 for update', [v.grantId])).rows[0];
    if (!g) throw new Denied('not_found');
    const old = (await sql.query('select id from brand_usage_grant_events where grant_id=$1 and created_by=$2 and request_id=$3', [g.id, userId, v.requestId])).rows[0];
    if (old) return { id: String(old.id) };
    const state = grantState(g, (await sql.query('select * from brand_usage_grant_events where grant_id=$1', [g.id])).rows, clock(deps));
    const allowed = v.kind === 'suspended' ? !['suspended', 'terminated'].includes(state) : v.kind === 'resumed' ? state === 'suspended' : state !== 'terminated';
    if (!allowed) throw new Denied('conflict');
    // A grant whose consent was withdrawn cannot be resumed on that consent: terminate (and refund if
    // decided) instead; renewed permission is a new case with new consent.
    if (v.kind === 'resumed' && (await sql.query('select 1 from brand_usage_consents where id=$1 and withdrawn_at is not null', [g.consent_id])).rows.length) throw new Denied('consent_missing');
    const id = randomUUID();
    await sql.query('insert into brand_usage_grant_events(id,grant_id,kind,reason,created_by,request_id) values($1,$2,$3,$4,$5,$6)', [id, g.id, v.kind, v.reason, userId, v.requestId]);
    // Once no grant of the case is on hold any more, the case leaves the top of the queue.
    if (v.kind !== 'suspended') {
      const siblings = (await sql.query('select * from brand_usage_grants where case_id=$1', [g.case_id])).rows;
      const events = (await sql.query('select * from brand_usage_grant_events where grant_id=any($1::uuid[])', [siblings.map(x => x.id)])).rows;
      if (!siblings.some(x => grantState(x, events, clock(deps)) === 'suspended'))
        await sql.query("update brand_usage_cases set blocked_reason=null,updated_at=now() where id=$1 and status='fulfilled'", [g.case_id]);
    }
    return { id };
  });
}
/** "From first use": the studio records the first day of use once it is known. Set once, never moved. */
export async function startUsageGrant(deps: UsageDeps, viewer: Viewer, input: unknown): Promise<UsageOutcome> {
  return mutation(deps.sql, viewer, UsageGrantStartSchema, input, async (sql, userId, v) => {
    await studio(sql, userId);
    const g = (await sql.query('select * from brand_usage_grants where id=$1 for update', [v.grantId])).rows[0];
    if (!g) throw new Denied('not_found');
    if (g.starts_at != null || g.duration_days == null) throw new Denied('conflict');
    const starts = koreaMidnight(v.startsOn), ends = new Date(+starts + Number(g.duration_days) * 86400000);
    await sql.query('update brand_usage_grants set starts_at=$2,ends_at=$3 where id=$1', [g.id, starts, ends]);
    const id = randomUUID();
    await sql.query("insert into brand_usage_grant_events(id,grant_id,kind,reason,created_by,request_id) values($1,$2,'started',$3,$4,$5)", [id, g.id, v.reason, userId, v.requestId]);
    return { id: String(g.id) };
  });
}

/** Studio console detail. Internal by design: never hand this object to a brand page or route. */
export async function loadStudioUsageCase(deps: UsageDeps, viewer: Viewer, caseId: string): Promise<StudioUsageCase | null> {
  if (!uuid(viewer.userId) || !uuid(caseId)) return null;
  const now = clock(deps);
  try { return await deps.sql.transaction(async sql => {
    await studio(sql, viewer.userId!);
    const c = (await sql.query(`select c.*,o.name as organization_name,p.title as project_title from brand_usage_cases c join brand_projects p on p.id=c.project_id
      join brand_organizations o on o.id=c.organization_id where c.id=$1`, [caseId])).rows[0];
    if (!c) return null;
    const q = async (text: string, params: unknown[] = [caseId]) => (await sql.query(text, params)).rows;
    const items = await q(`select i.*,cv.title,po.origin,po.url,po.platform,po.creator_handle,po.content_version_id as post_cv from brand_usage_case_items i
      left join brand_content_versions cv on cv.id=i.content_version_id left join brand_posts po on po.id=i.post_id where i.case_id=$1 order by i.position`);
    const grants = await q('select * from brand_usage_grants where case_id=$1 order by created_at');
    const grantEvents = grants.length ? await q('select * from brand_usage_grant_events where grant_id=any($1::uuid[]) order by created_at', [grants.map(g => g.id)]) : [];
    return {
      id: String(c.id), organizationId: String(c.organization_id), organizationName: String(c.organization_name), projectId: String(c.project_id), projectTitle: String(c.project_title),
      status: c.status as UsageCaseStatus, revision: Number(c.revision), closeReason: c.close_reason == null ? null : String(c.close_reason), blockedReason: c.blocked_reason == null ? null : String(c.blocked_reason),
      createdAt: stamp(c.created_at), updatedAt: stamp(c.updated_at), intent: String(c.intent), question: String(c.question), hints: (c.hints as string[]) ?? null,
      durationHint: c.duration_hint == null ? null : String(c.duration_hint), timingText: c.timing_text == null ? null : String(c.timing_text), budgetKrw: c.budget_krw == null ? null : Number(c.budget_krw),
      items: items.map(i => ({ id: String(i.id), position: Number(i.position), kind: i.subject_kind as 'content_version' | 'post',
        label: i.title != null ? String(i.title) : i.creator_handle != null ? `@${String(i.creator_handle)}` : String(i.platform ?? ''),
        contentVersionId: i.content_version_id == null ? null : String(i.content_version_id), postId: i.post_id == null ? null : String(i.post_id),
        postOrigin: i.origin == null ? null : String(i.origin), postUrl: i.url == null ? null : String(i.url), postContentVersionId: i.post_cv == null ? null : String(i.post_cv) })),
      messages: (await q('select * from brand_usage_messages where case_id=$1 order by created_at,id')).map(m => ({ id: String(m.id), body: String(m.body), authorRole: m.author_role as 'brand' | 'studio', createdAt: stamp(m.created_at) })),
      scopes: (await q('select * from brand_usage_scope_revisions where case_id=$1 order by revision desc')).map(s => ({ id: String(s.id), revision: Number(s.revision), sha256: String(s.scope_sha256), scope: s.scope as UsageScope, createdAt: stamp(s.created_at) })),
      compensations: (await q('select * from brand_usage_compensations where case_id=$1 order by revision desc')).map(r => ({ id: String(r.id), scopeRevisionId: String(r.scope_revision_id), revision: Number(r.revision), amountKrw: Number(r.amount_krw), taxBasis: String(r.tax_basis), note: String(r.note), createdAt: stamp(r.created_at) })),
      consents: (await q('select * from brand_usage_consents where case_id=$1 order by created_at desc')).map(r => ({ id: String(r.id), itemId: String(r.item_id), scopeRevisionId: String(r.scope_revision_id), scopeSha256: String(r.scope_sha256), compensationId: String(r.compensation_id), approverKind: String(r.approver_kind), approvedAt: stamp(r.approved_at), evidenceReference: String(r.evidence_reference), rightsChecks: r.rights_checks as string[], withdrawnAt: nullableStamp(r.withdrawn_at), createdAt: stamp(r.created_at) })),
      quotes: (await q('select * from brand_usage_quotes where case_id=$1 order by revision desc')).map(r => ({ id: String(r.id), revision: Number(r.revision), scopeRevisionId: String(r.scope_revision_id), totalKrw: Number(r.total_krw), taxBasis: String(r.tax_basis), validUntil: stamp(r.valid_until), expired: now >= new Date(stamp(r.valid_until)), status: String(r.status), contractId: String(r.terms_contract_id), note: String(r.note), acceptedAt: nullableStamp(r.accepted_at), createdAt: stamp(r.created_at) })),
      payments: (await q('select * from brand_usage_payments where case_id=$1 order by created_at desc')).map(r => ({ id: String(r.id), quoteId: String(r.quote_id), status: String(r.status), amountKrw: Number(r.amount_krw), environment: String(r.environment), failureCode: r.failure_code == null ? null : String(r.failure_code), createdAt: stamp(r.created_at), approvedAt: nullableStamp(r.approved_at), refundedAt: nullableStamp(r.refunded_at) })),
      grants: grants.map(g => ({ id: String(g.id), itemId: String(g.item_id), state: grantState(g, grantEvents, now), startsAt: nullableStamp(g.starts_at), endsAt: nullableStamp(g.ends_at), durationDays: g.duration_days == null ? null : Number(g.duration_days),
        events: grantEvents.filter(e => e.grant_id === g.id).map(e => ({ kind: String(e.kind), reason: String(e.reason), createdAt: stamp(e.created_at) })) })),
      events: (await q('select kind,actor,created_at from brand_usage_events where case_id=$1 order by created_at,id')).map(e => ({ kind: String(e.kind), actor: String(e.actor), createdAt: stamp(e.created_at) })),
      contracts: (await q('select id,title,version,shared from brand_contract_documents where project_id=$1 order by created_at desc', [c.project_id])).map(d => ({ id: String(d.id), title: String(d.title), version: Number(d.version), shared: d.shared === true })),
      masters: (await q("select id,name,mime from brand_attachments where project_id=$1 and status='ready' and access_scope='workspace' and (mime like 'image/%' or mime like 'video/%') order by created_at desc", [c.project_id])).map(a => ({ id: String(a.id), name: String(a.name), mime: String(a.mime) })),
      buyers: (await q(`select b.user_id,p.email,m.role from brand_usage_buyers b join profiles p on p.id=b.user_id left join brand_memberships m on m.organization_id=b.organization_id and m.user_id=b.user_id and m.status='active'
        where b.organization_id=$1 and b.revoked_at is null`, [c.organization_id])).map(b => ({ userId: String(b.user_id), email: String(b.email), role: b.role == null ? null : String(b.role) })),
      members: (await q("select m.user_id,p.email,m.role from brand_memberships m join profiles p on p.id=m.user_id where m.organization_id=$1 and m.status='active' order by m.created_at", [c.organization_id])).map(m => ({ userId: String(m.user_id), email: String(m.email), role: String(m.role) })),
    };
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}
/** Every case, those needing the studio first. Optionally one campaign. */
export async function loadStudioUsageQueue(deps: UsageDeps, viewer: Viewer, projectId?: string): Promise<StudioUsageQueueRow[] | null> {
  if (!uuid(viewer.userId) || (projectId !== undefined && !uuid(projectId))) return null;
  try { return await deps.sql.transaction(async sql => {
    await studio(sql, viewer.userId!);
    const rows = (await sql.query(`select c.id,c.status,c.updated_at,c.project_id,p.title,o.name,(select count(*)::int from brand_usage_case_items i where i.case_id=c.id) as subjects
      from brand_usage_cases c join brand_projects p on p.id=c.project_id join brand_organizations o on o.id=c.organization_id
      where ($1::uuid is null or c.project_id=$1::uuid)
      order by case when c.status='blocked_after_payment' or (c.status='fulfilled' and c.blocked_reason is not null) then 0 else 1 end, case c.status when 'paid' then 1 when 'inquiry' then 2 when 'scoping' then 3 when 'scope_defined' then 4 when 'accepted' then 5 when 'quoted' then 6 else 9 end, c.updated_at desc limit 200`, [projectId ?? null])).rows;
    return rows.map(r => ({ id: String(r.id), organizationName: String(r.name), projectId: String(r.project_id), projectTitle: String(r.title), status: r.status as UsageCaseStatus, updatedAt: stamp(r.updated_at), subjects: Number(r.subjects) }));
  }); } catch (error) { if (error instanceof Denied) return null; throw error; }
}
