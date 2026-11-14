import { createHash, randomUUID } from 'node:crypto';
import { reserveRewardImage, reconcileRewards } from '@/lib/creator-platform/rewards';
import { demand } from '@/lib/creator-platform/contract';
import { platformReady } from '@/lib/creator-platform/service';
import { reserveCampaignProduction, type CampaignProductionCode } from '@/lib/campaigns/production';
import { campaignProductReferences, campaignRenderReferenceUrls } from '@/lib/campaigns/production-references';
import { claimCampaignDispatch, acknowledgeCampaignTask, resumeCampaignDispatch, CAMPAIGN_DISPATCH_PREFIX } from '@/lib/campaigns/production-dispatch';
import { cleanSelfie } from '@/lib/identity/selfie-images';
import type { StorageDriver } from '@/lib/storage';
import { reserveProduction } from '@/lib/brands/production/service';
import { savedSelfiePhoto } from '@/lib/identity/selfie-service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import type { ArkAssetsClient } from '@/lib/ark/assets';
import { releaseAfterUse, releaseAfterUseEnabled } from '@/lib/identity/rotation';
import { ASSET_WAIT_HOURS, assetLibraryMode, ensureIdentityAsset, ensureVirtualGroup, identityStatusFor, loadIdentityGroup, needsIdentity, needsLiveness, pollIdentityAsset, recordIdentityUse, type AssetLibraryMode, type IdentityDeps } from '@/lib/identity/service';
import { purchaseOpenFor } from '@/lib/auth/purchase-gate';
import type { RenderPipelineMode } from '@/lib/flags';
import { getTossGateway, type TossGateway } from '@/lib/billing/toss-gateway';
import { addTossReport, billingErrorCode, emptyTossReport, logBilling, reconcileTossPayments, renderPaymentStatus, type TossReconcileReport } from '@/lib/billing/toss-service';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { aspectsForMedium, engineProvider, isEngineId, isImageAspect, isImageEngine, isVideoAspect, isVideoEngine, resolveEngine } from '@/lib/images/engines';
import { loadPromptById, loadPromptBySlug, type PromptRow } from '@/lib/prompts/repo';
import { isForSale } from '@/lib/twings/products';
import { renderResolution, renderableResolution } from '@/lib/twings/resolution';
import { reserveSubscriptionUsage, settleSubscriptionUsage } from '@/lib/creator-subscriptions/usage';
import type { BillingEnvironment } from '@/lib/creator-subscriptions/types';
import { EDIT_REFERENCE_RETENTION_DAYS, MAX_SUBSCRIPTION_BODY_BYTES, type EditReference, type EditValidationCode } from '@/lib/premium-editing/contract';
import { cleanEditReferences, PREMIUM_EDIT_GUIDE_VERSION, validateEditRequest } from '@/lib/premium-editing/guard';
import { subscriptionTemplateEligibility } from '@/lib/premium-editing/eligibility';
import { getPremiumEditBudget } from '@/lib/premium-editing/budget';
import { deleteExpiredEditReferences, loadSubscriptionRender, subscriptionRenderSchemaReady, subscriptionUsageTrackingPresent } from '@/lib/premium-editing/repo';
import { prepareSubscriptionPrompt } from '@/lib/premium-editing/service';
import type { PremiumEditClient } from '@/lib/premium-editing/provider';
import { RenderFailure, baseFailureCode, pollVideoRender, runImageRender, startVideoRender, videoModelFor, type EngineOutput, type RenderEngineDeps, type RenderFailureCode, type RenderPhoto, type StepReference } from './engines';
import { ensureJobRecipe, ensureMakerSandbox, insertJobOutputs, insertJobRecipe, loadJobRecipe, loadTemplateRecipe, MAKER_SANDBOX_ID, MAKER_SANDBOX_SLUG, renderPurpose, saveStepRecord, type JobRecipe } from '@/lib/recipes/repo';
import { recordedUsd, runRecipe, type RecipeResult } from '@/lib/recipes/execute';
import { primaryStep, recipeNeedsIdentity, type Recipe } from '@/lib/recipes/schema';
import { compileDirectorPrompt } from '@/lib/template-director/flash-director';
import { parseDirectorSpecInput, type PersonalDirectorSpec } from '@/lib/template-director/schema';
import { parseSelectedFrames, selectiveOrderKrw, sliceCarouselRecipe } from '@/lib/twings/selective-frames';
import { creditsRequiredForKrw } from '@/lib/mobile/iap/catalog';
import { toNativeIapOs } from '@/lib/mobile/iap/verify';
import { readMakerFile } from '@/lib/recipes/assets';
import { fixedVideoReferenceUrls } from './template-references';
import type { RenderNotifier } from './notify';
import { buildRenderPrompt } from './prompt';
import {
  ASSET_TASK_PREFIX,
  claimAssetDispatch,
  parseAssetTask,
  claimRenderJobs,
  countRenderJobsSince,
  insertRenderJob,
  listRenderJobsAwaitingProvider,
  listRenderJobsForUser,
  listRenderJobsToNotify,
  loadRenderJob,
  markRenderFailed,
  markRenderNotified,
  markRenderRunningWithTask,
  markRenderSucceeded,
  markRenderWaitingForAsset,
  recoverStaleRenderJobs,
  releaseHeldRenderJobs,
  requeueRenderJob,
  yieldRenderJob,
  type RenderJob,
} from './repo';
import { markRenderFinishing } from './extras';
import { loadRenderFrames } from './frames';
import { constantTimeEqual, isRenderId, isShareExpired, isShareTokenShape, newShareToken, shareExpiresAt } from './share';
import { extensionFor, type RenderStore } from './store';
import {
  CUSTOM_REF_SLOTS, castOpen, cleanSlotPhoto, deleteSpentSlotPhotos, extraSlots, liveSlotRows, loadSlotPhotos, makeInputsFrom, petIsPrimary,
  recordPrimaryPetPhoto, storeSlotPhotos, type CastSlot, type RenderSlot, type SlotPhoto,
} from './cast-inputs';
import { PARTNER_SLOT, PET_SLOT } from '@/lib/recipes/schema';
import { checkPetPhoto, petRefusal, type PetPhotoVerdict } from './pet-photo-check';

/**
 * The render queue (docs/TEMPLATES-IA.md §8): enqueue, run, tell, show.
 *
 * Why a queue at all: a film takes minutes and a Vercel function has a ceiling, so the request
 * that takes the photo must not be the thing that waits. It stores the photo, writes a row, and
 * answers with the result page's address; the PASS does the rest — and the pass is one function
 * invoked from four places (docs §8): right after enqueueing (`after()`), the provider's
 * completion callback, the owner opening the result page, and a daily cron. On the Hobby plan
 * there is no per-minute cron, so the design has to be correct with an irregular tick, and it is:
 * every step is idempotent, every claim is a lease, every message has an idempotency key.
 *
 * Who may start one: an admin, until payment lands (`RENDER_PIPELINE_PUBLIC`). Everyone else
 * keeps the demo. The gate is HERE, not in the UI — the studio asks `/api/renders/access` and the
 * enqueue route asks this function, and both get the same answer.
 */

export const RENDER_JOBS_PER_DAY = 20;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;
/** A synchronous render claimed this long ago and still `running` was orphaned by a dead process. */
export const LEASE_MINUTES = 20;
/**
 * No new recipe step starts after this long in one job's pass. The functions stop at 300 s, and a
 * step killed mid-call is paid for and lost; this leaves room for one slow image and the final copy.
 */
export const RECIPE_PASS_BUDGET_MS = 150_000;
export const NOTIFY_MAX_ATTEMPTS = 3;
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];

export function isPhotoMime(value: unknown): value is PhotoMime {
  return typeof value === 'string' && (PHOTO_MIMES as readonly string[]).includes(value);
}

/**
 * The one gate, now `lib/auth/purchase-gate.ts` so the billing service applies the identical rule.
 * Anonymous never; admins always; everyone once RENDER_PIPELINE_PUBLIC=on; the PG 심사 계정 alone
 * under `=review`. Re-exported here because this is where every render caller already looks.
 */
export const canStartRender = purchaseOpenFor;

export interface RenderServiceDeps {
  sql: SqlRunner;
  store: RenderStore;
  now?: Date;
  /** Which asset library a photo goes through (lib/flags.ts); tests pin it, production reads the flag. */
  mode?: AssetLibraryMode;
  /** Optional render pipeline gate override (defaults to RENDER_PIPELINE_MODE from lib/flags.ts). */
  pipelineMode?: RenderPipelineMode;
  /** docs/CAST-CATEGORIES.md §3 — the "is this really a pet" check; tests inject it, production calls Gemini. */
  petCheck?: (photo: SlotPhoto) => Promise<PetPhotoVerdict>;
}

export interface CreateCampaignRenderInput {
  applicationId: string; requestId: string; ownFaceConsent: boolean;
  selfieId?: string; photo?: { bytes: Uint8Array; mime: string } | null; locale: string | null;
}
/** Selected campaign participation pays for production; no consumer plan or admin impersonation. */
export async function createCampaignRenderJob(deps: RenderServiceDeps & { referenceStorage?: Pick<StorageDriver, 'read'> }, viewer: Viewer, input: CreateCampaignRenderInput): Promise<CreateRenderOutcome | { ok: false; code: CampaignProductionCode | 'consent_required' }> {
  if (!viewer.userId) return { ok: false, code: 'sign_in_required' };
  if (input.ownFaceConsent !== true) return { ok: false, code: 'consent_required' };
  if (Object.keys(input).some(key => !['applicationId', 'requestId', 'ownFaceConsent', 'selfieId', 'photo', 'locale'].includes(key))) return { ok: false, code: 'invalid' };
  if (!SUBSCRIPTION_UUID.test(input.applicationId) || !SUBSCRIPTION_UUID.test(input.requestId) || input.selfieId && (!SUBSCRIPTION_UUID.test(input.selfieId) || input.photo)) return { ok: false, code: 'invalid' };
  let photo = input.photo ?? null;
  if (!input.selfieId) {
    if (!photo || photo.bytes.byteLength > 3_000_000) return { ok: false, code: photo ? 'photo_too_large' : 'bad_photo' };
    try { photo = { bytes: (await cleanSelfie(photo.bytes, photo.mime)).bytes, mime: 'image/png' }; }
    catch { return { ok: false, code: 'bad_photo' }; }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([input.applicationId, input.selfieId ?? null, input.selfieId ? null : createHash('sha256').update(photo!.bytes).digest('hex')])).digest('hex');
  const writtenKeys: string[] = [];
  try {
    const result = await reserveCampaignProduction(deps, viewer, { applicationId: input.applicationId, requestId: input.requestId, fingerprint }, async (sql, template, ids) => {
      const ownPhoto = input.selfieId ? await savedSelfiePhoto(sql, deps.store, viewer.userId!, input.selfieId) : photo;
      if (!ownPhoto) return { ok: false as const, code: 'identity_required' as const };
      const references = await campaignProductReferences(sql, template.id, ids, deps.referenceStorage);
      const id = randomUUID();
      writtenKeys.push(`${id}/input.${extensionFor(ownPhoto.mime)}`);
      const created = await createAuthorizedRender({ ...deps, sql }, viewer, { templateSlug: template.slug, aspect: template.aspectDefault ?? '9:16', resolution: '720p', photo: ownPhoto, selfieId: input.selfieId, locale: input.locale, holdForIdentity: true }, id, template);
      if (!created.ok) return created;
      const referenceKeys: string[] = [];
      for (const [index, reference] of references.entries()) {
        const key = `${id}/product${String.fromCharCode(97 + index)}.jpg`;
        writtenKeys.push(key); await deps.store.put(key, reference.bytes, reference.mime); referenceKeys.push(key);
      }
      return { ...created, referenceKeys };
    });
    if (!result.ok && deps.store.delete) for (const key of writtenKeys) { try { await deps.store.delete(key); } catch { /* Retain the original refusal. */ } }
    return result;
  } catch (error) {
    if (deps.store.delete) for (const key of writtenKeys) { try { await deps.store.delete(key); } catch { /* Cleanup cannot replace the original error. */ } }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

export type CreateRenderFailure =
  | 'sign_in_required'
  | 'not_open'
  | 'not_found'
  | 'not_for_sale'
  | 'bad_aspect'
  /** A resolution the template's engine cannot render (or any resolution on an image). */
  | 'bad_resolution'
  | 'bad_photo'
  | 'photo_too_large'
  | 'rate_limited'
  /** The template renders on ModelArk, which takes only a verified face (docs §8.2). */
  | 'identity_required'
  /** docs/CAST-CATEGORIES.md §3 — a pet or partner template without that photo. */
  | 'slot_missing'
  /** The pet or partner photo is not a usable image. */
  | 'bad_slot_photo'
  /** A couple template: the uploader did not confirm the partner agreed. */
  | 'partner_consent_required'
  /** The pet photo shows a person, or no animal (lib/renders/pet-photo-check.ts). */
  | 'not_a_pet'
  /** The pet check could not run; fail-closed, so the photo is refused. */
  | 'pet_check_unavailable';

/** `held`: stored and waiting for the person's face check — the studio sends them there and the job starts itself afterwards. */
export type CreateRenderOutcome = { ok: true; id: string; held: boolean } | { ok: false; code: CreateRenderFailure };

export interface CreateRenderInput {
  templateSlug: string;
  aspect: string;
  photo: { bytes: Uint8Array; mime: string } | null;
  locale: string | null;
  /** Store the photo and hold the job behind the face check instead of refusing (docs §8.2). */
  holdForIdentity?: boolean;
  /** Server-only payment proof. The public render endpoint never accepts this field. */
  paymentOrderId?: string;
  /** Server-resolved lineage (the saved selfie this job copied), never a caller-supplied storage key. */
  selfieId?: string;
  /**
   * '720p' | '1080p'; empty = 720p. Only an operator's free render reads this from a request. A paid
   * render takes it from the ORDER row (below) — whatever the caller passed is overwritten.
   */
  resolution?: string | null;
  /**
   * docs/CAST-CATEGORIES.md §3 — the pet or partner photo, posted with this request (an operator's
   * free render). A paid render binds them to the order's render id before payment instead
   * (lib/renders/cast-inputs.ts), and they are read from there.
   */
  slots?: Partial<Record<RenderSlot, SlotPhoto>>;
  /** The uploader confirmed the partner agreed to their photo being used (a couple template). */
  partnerConsent?: boolean;
  /** 0-based selected frame indices for multi-frame image sets (`null` = all frames). */
  selectedFrames?: number[] | null;
  /** Hydrogen customization spec + Seedance native audio mode (`ambient` | `bgm`). */
  directorSpec?: PersonalDirectorSpec | null;
}

export async function createRenderJob(deps: RenderServiceDeps, viewer: Viewer, input: CreateRenderInput): Promise<CreateRenderOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  if (viewer.isAdmin) return createAuthorizedRender(deps, viewer, input);
  // Opening the studio must never open a free direct POST /api/renders bypass.
  if (!input.paymentOrderId) return { ok: false, code: 'not_open' };
  return deps.sql.transaction(async (sql) => {
    const { rows } = await sql.query<{
      status: string; template_slug: string; aspect: string; render_ref: string; render_id: string | null; identity_selfie_id: string | null; resolution: string | null; selected_frames: number[] | null; director_spec: unknown;
    }>("select status,template_slug,aspect,render_ref,render_id,identity_selfie_id,resolution,selected_frames,director_spec from billing_payments where id=$1 and user_id=$2 and payment_type='NORMAL' for update", [input.paymentOrderId, viewer.userId]);
    const payment = rows[0];
    if (!payment || payment.status !== 'paid' || payment.template_slug !== input.templateSlug || payment.aspect !== input.aspect) return { ok: false, code: 'not_open' };
    if (payment.render_id) {
      const job = await loadRenderJob(sql, payment.render_id);
      return job ? { ok: true, id: job.id, held: job.status === 'held' } : { ok: false, code: 'not_found' };
    }
    const result = await createAuthorizedRender({ ...deps, sql }, viewer, {
      ...input,
      selfieId: payment.identity_selfie_id ?? undefined,
      resolution: payment.resolution,
      selectedFrames: parseSelectedFrames(payment.selected_frames),
      directorSpec: parseDirectorSpecInput(payment.director_spec),
    }, payment.render_ref);
    if (result.ok) await sql.query('update billing_payments set render_id=$2,fulfilled_at=$3,lease_until=null where id=$1', [input.paymentOrderId, result.id, deps.now ?? new Date()]);
    return result;
  });
}

/** Separate contract authorization; never impersonates an admin or accepts client storage keys. */
export async function createBrandRenderJob(deps: RenderServiceDeps, viewer: Viewer, input: {contractId:string;templateId:string;requestId:string;selfieId:string;ownFaceConfirmed:boolean;locale:string|null}) {
  if (!viewer.userId) return {ok:false as const,code:'sign_in_required' as const};
  if (!input.ownFaceConfirmed) return {ok:false as const,code:'consent_required' as const};
  const fingerprint=createHash('sha256').update(JSON.stringify([input.contractId,input.templateId,input.selfieId])).digest('hex');
  return reserveProduction(deps,viewer,{...input,fingerprint},async(sql,template)=>{
    const photo=await savedSelfiePhoto(sql,deps.store,viewer.userId!,input.selfieId);
    if(!photo)return {ok:false as const,code:'identity_required' as const};
    return createAuthorizedRender({...deps,sql},viewer,{templateSlug:template.slug,aspect:template.aspectDefault??'9:16',photo,locale:input.locale,selfieId:input.selfieId,resolution:null},undefined,template);
  });
}

export interface CreateSubscriptionRenderInput {
  requestId: string;
  templateSlug: string;
  ownFaceConsent: boolean;
  selfieId?: string;
  photo?: { bytes: Uint8Array; mime: string } | null;
  locale: string | null;
  editText?: string;
  references?: readonly EditReference[];
  /** Includes the disclosed OpenAI processing of the optional reference images. */
  referencesConsent?: boolean;
}
export type CreateSubscriptionRenderOutcome = { ok: true; id: string; held: boolean } | { ok: false; code: CreateRenderFailure | EditValidationCode | 'consent_required' | 'bad_request' | 'unsupported_template' | 'subscription_required' | 'premium_required' | 'usage_exhausted' | 'conflict' | 'not_open' | 'edit_unavailable' | 'edit_request_limit' };
class SubscriptionEnqueueAbort extends Error { constructor(readonly code: CreateRenderFailure | 'edit_unavailable' | 'edit_request_limit') { super(code); } }
const SUBSCRIPTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Paid monthly usage is an independent authorization path. It never impersonates an admin,
 * creates a free regeneration, accepts a recipe/storage key or derives entitlement from a quote.
 */
export async function createSubscriptionRenderJob(deps: RenderServiceDeps & { environment: BillingEnvironment }, viewer: Viewer, input: CreateSubscriptionRenderInput): Promise<CreateSubscriptionRenderOutcome> {
  if (!viewer.userId) return { ok: false, code: 'sign_in_required' };
  if (input.ownFaceConsent !== true) return { ok: false, code: 'consent_required' };
  const allowedKeys = ['requestId', 'templateSlug', 'ownFaceConsent', 'selfieId', 'photo', 'locale', 'editText', 'references', 'referencesConsent'];
  if (!SUBSCRIPTION_UUID.test(input.requestId) || typeof input.templateSlug !== 'string' || !['test', 'live'].includes(deps.environment) || Object.keys(input).some(key => !allowedKeys.includes(key)) || (input.editText !== undefined && typeof input.editText !== 'string') || (input.references !== undefined && !Array.isArray(input.references))) return { ok: false, code: 'bad_request' };
  const references = input.references ?? [];
  const wantsEdit = !!input.editText?.trim() || references.length > 0;
  const text = wantsEdit ? validateEditRequest(input.editText, references.length) : null;
  if (text && !text.ok) return text;
  if (references.length && !input.referencesConsent) return { ok: false, code: 'reference_consent_required' };
  const totalBytes = (input.photo?.bytes.length ?? 0) + references.reduce((sum, reference) => sum + reference.bytes.length, 0) + Buffer.byteLength(input.editText ?? '', 'utf8');
  if (totalBytes >= MAX_SUBSCRIPTION_BODY_BYTES) return { ok: false, code: 'references_too_large' };
  const cleaned = await cleanEditReferences(references);
  if (!cleaned.ok) return cleaned;
  const fingerprint = createHash('sha256').update(JSON.stringify([input.templateSlug, input.selfieId ?? null,
    input.selfieId ? null : input.photo ? createHash('sha256').update(input.photo.bytes).digest('hex') : null,
    input.selfieId ? null : input.photo?.mime ?? null, text?.ok ? text.text : null,
    cleaned.references.map(reference => createHash('sha256').update(reference.bytes).digest('hex'))])).digest('hex');
  const now = deps.now ?? new Date();
  const writtenKeys: string[] = [];
  try {
    return await deps.sql.transaction(async sql => {
      // Serializes this account's request keys without blocking foreign-key KEY SHARE locks.
      await sql.query('select id from profiles where id=$1 for no key update', [viewer.userId]);
      const existing = (await sql.query<{ render_ref: string; fingerprint: string }>('select render_ref,fingerprint from creator_subscription_renders where user_id=$1 and environment=$2 and request_id=$3', [viewer.userId, deps.environment, input.requestId])).rows[0];
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { ok: false, code: 'conflict' };
        const job = await loadRenderJob(sql, existing.render_ref);
        return job?.userId === viewer.userId ? { ok: true, id: job.id, held: job.status === 'held' } : { ok: false, code: 'not_found' };
      }
      const template = await loadPromptBySlug(sql, input.templateSlug);
      if (!template || template.status !== 'published' || template.audience === 'brand') return { ok: false, code: 'not_found' };
      if (!isForSale(template)) return { ok: false, code: 'not_for_sale' };
      const eligibility = subscriptionTemplateEligibility(template);
      if (!eligibility) return { ok: false, code: 'unsupported_template' };
      // A paid edit rewrites one prompt; a maker recipe has several and is not offered for it.
      if (await loadTemplateRecipe(sql, template.id)) return { ok: false, code: 'unsupported_template' };
      const { quote, scopes } = eligibility;
      const photo = input.selfieId ? await savedSelfiePhoto(sql, deps.store, viewer.userId!, input.selfieId) : input.photo ?? null;
      if (input.selfieId && !photo) return { ok: false, code: 'identity_required' };
      const id = randomUUID();
      const reservation = await reserveSubscriptionUsage(sql, { userId: viewer.userId!, renderRef: id, units: quote.units, environment: deps.environment, now, premium: wantsEdit });
      if (!reservation.ok) return { ok: false, code: reservation.code === 'premium_required' ? 'premium_required' : reservation.code === 'insufficient_allowance' ? 'usage_exhausted' : 'subscription_required' };
      if (wantsEdit) {
        const budget = await getPremiumEditBudget(sql, viewer.userId!, { environment: deps.environment, now });
        if (!budget) throw new SubscriptionEnqueueAbort('edit_unavailable');
        if (!budget.remaining) throw new SubscriptionEnqueueAbort('edit_request_limit');
      }
      if (photo) writtenKeys.push(`${id}/input.${extensionFor(photo.mime)}`);
      const result = await createAuthorizedRender({ ...deps, sql }, viewer, { templateSlug: template.slug, aspect: template.aspectDefault ?? '9:16', photo, selfieId: input.selfieId, locale: input.locale, resolution: '720p', holdForIdentity: true }, id);
      if (!result.ok) throw new SubscriptionEnqueueAbort(result.code);
      const referenceKeys: string[] = [];
      for (const [index, reference] of cleaned.references.entries()) {
        const key = `${id}/reference${String.fromCharCode(97 + index)}.jpg`;
        writtenKeys.push(key);
        await deps.store.put(key, reference.bytes, reference.mime);
        referenceKeys.push(key);
      }
      await sql.query(`insert into creator_subscription_renders(render_ref,user_id,environment,request_id,fingerprint,base_prompt,runtime_seconds,edit_text,allowed_scopes,reference_keys,guide_version,edit_status,references_expire_at,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)`, [id, viewer.userId, deps.environment, input.requestId, fingerprint, template.promptText, template.runtimeSeconds, text?.ok ? text.text : null, scopes, JSON.stringify(referenceKeys), PREMIUM_EDIT_GUIDE_VERSION, wantsEdit ? 'pending' : 'not_requested', new Date(now.getTime() + EDIT_REFERENCE_RETENTION_DAYS * 86400000), now]);
      return result;
    });
  } catch (error) {
    // Rollback also removes the reservation. Clean only this server-generated request's objects.
    if (deps.store.delete) for (const key of writtenKeys) { try { await deps.store.delete(key); } catch { /* Private storage cleanup can retry separately. */ } }
    if (error instanceof SubscriptionEnqueueAbort) return { ok: false, code: error.code };
    throw error;
  }
}

/** Server-authorized image reward only. All likeness/provider safeguards remain in the common path. */
export async function createRewardImageJob(deps:RenderServiceDeps,viewer:Viewer,input:{requestId:string;offerId:string;selfieId:string}) {
  demand(viewer.userId,'sign_in_required');
  demand([input.requestId,input.offerId,input.selfieId].every(v=>SUBSCRIPTION_UUID.test(v)));
  return reserveRewardImage(deps.sql,viewer,input,async(sql,templateId)=>{
    const template=await loadPromptById(sql,templateId);
    demand(template?.medium==='image'&&template.audience==='public','not_eligible');
    const photo=await savedSelfiePhoto(sql,deps.store,viewer.userId!,input.selfieId);
    demand(photo,'identity_required');
    return createAuthorizedRender({...deps,sql},viewer,{templateSlug:template.slug,aspect:template.aspectDefault??'4:5',photo,selfieId:input.selfieId,locale:viewer.locale,holdForIdentity:true},undefined,template);
  });
}

async function createAuthorizedRender(deps: RenderServiceDeps, viewer: Viewer, input: CreateRenderInput, reservedId?: string, brandTemplate?: PromptRow): Promise<CreateRenderOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  const now = deps.now ?? new Date();

  const template = brandTemplate ?? await loadPromptBySlug(deps.sql, input.templateSlug);
  if (template === null || template.status !== 'published') return { ok: false, code: 'not_found' };
  if (!brandTemplate && template.audience === 'brand') return {ok:false,code:'not_found'};
  if (!brandTemplate && !isForSale(template)) return { ok: false, code: 'not_for_sale' };

  const engine = resolveEngine(template.engine, template.medium);
  if (!(aspectsForMedium(template.medium) as readonly string[]).includes(input.aspect)) return { ok: false, code: 'bad_aspect' };
  const resolution = renderableResolution(template, input.resolution);
  if (!resolution.ok) return { ok: false, code: 'bad_resolution' };

  if (input.photo === null || input.photo.bytes.byteLength === 0 || !isPhotoMime(input.photo.mime)) return { ok: false, code: 'bad_photo' };
  if (input.photo.bytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, code: 'photo_too_large' };

  // docs/CAST-CATEGORIES.md §3·§4 — who is in it decides which photos the job needs. Couples do not
  // exist while their flag is off; a pet or couple template without a matching recipe is not makeable.
  if (!castOpen(template.cast)) return { ok: false, code: 'not_found' };
  const recipe = await loadTemplateRecipe(deps.sql, template.id);
  const makeInputs = makeInputsFrom(template, recipe);
  if (makeInputs === null) return { ok: false, code: 'not_for_sale' };
  const id = reservedId ?? randomUUID();
  let primary = input.photo;
  // A pet-only template's one photo is the pet: cleaned of its metadata like every slot photo.
  if (petIsPrimary(makeInputs)) {
    // A pet-only job never carries the buyer's face: a saved selfie posted here is the wrong photo.
    if (input.selfieId) return { ok: false, code: 'bad_photo' };
    try { primary = await cleanSlotPhoto(input.photo); } catch { return { ok: false, code: 'bad_photo' }; }
    // A paid render's pet was checked when its order was made (lib/renders/cast-form.ts); a photo posted
    // straight here is checked now. A person in the pet slot would skip every face rule.
    if (reservedId === undefined) {
      const refused = petRefusal(await (deps.petCheck ?? checkPetPhoto)(primary));
      if (refused) return { ok: false, code: refused };
    }
  }
  const slotPhotos: Partial<Record<RenderSlot, SlotPhoto>> = {};
  for (const customSlot of CUSTOM_REF_SLOTS) {
    const given = input.slots?.[customSlot];
    if (given) {
      try { slotPhotos[customSlot] = await cleanSlotPhoto(given); } catch { return { ok: false, code: 'bad_slot_photo' }; }
    }
  }
  const needed = extraSlots(makeInputs);
  if (needed.length > 0) {
    // A paid render's photos were bound to its render id when the order was made.
    const bound = await liveSlotRows(deps.sql, id);
    for (const slot of needed) {
      const given = input.slots?.[slot];
      if (given) {
        try { slotPhotos[slot] = await cleanSlotPhoto(given); } catch { return { ok: false, code: 'bad_slot_photo' }; }
        if (slot === PET_SLOT) {
          const refused = petRefusal(await (deps.petCheck ?? checkPetPhoto)(slotPhotos[slot]!));
          if (refused) return { ok: false, code: refused };
        }
      } else if (!bound.some((row) => row.slot === slot)) return { ok: false, code: 'slot_missing' };
    }
    if (needed.includes(PARTNER_SLOT)) {
      const consented = slotPhotos.partner ? input.partnerConsent === true : Boolean(bound.find((row) => row.slot === PARTNER_SLOT)?.partner_consent_at);
      if (!consented) return { ok: false, code: 'partner_consent_required' };
    }
  }

  // ModelArk refuses a real person's photo in the bytes: the person verifies their face once
  // (docs/TEMPLATES-IA.md §8.2) and the pass sends an asset reference instead. Asked to, the job
  // is HELD with its photo until the check completes — one upload, no second visit to the studio.
  const mode = deps.mode ?? assetLibraryMode();
  // A recipe sends the face to ModelArk if ANY step does (an OpenAI result can still feed a Seedance film).
  // A pet is never a face (lib/recipes/schema.ts), so a pet-only recipe never waits for the check.
  const viaLibrary = recipe ? mode === 'liveness' && recipeNeedsIdentity(recipe) : needsLiveness(engine, mode);
  // Only the liveness mode has a door to hold a job behind; the virtual library makes the group on the way.
  const held = viaLibrary && (await identityStatusFor(deps.sql, viewer.userId, mode)) !== 'active';
  if (held && !input.holdForIdentity) return { ok: false, code: 'identity_required' };

  const recent = await countRenderJobsSince(deps.sql, viewer.userId, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (recent >= RENDER_JOBS_PER_DAY) return { ok: false, code: 'rate_limited' };

  const inputKey = `${id}/input.${extensionFor(primary.mime)}`;
  await deps.store.put(inputKey, primary.bytes, primary.mime);
  // Slot photos go in before the job does, so no pass can claim a job whose photos are not there yet.
  if (Object.keys(slotPhotos).length > 0) {
    await storeSlotPhotos(deps.sql, deps.store, { renderId: id, userId: viewer.userId, templateId: template.id, photos: slotPhotos, partnerConsentAt: input.partnerConsent === true ? now : null, now });
  }
  if (petIsPrimary(makeInputs)) {
    await recordPrimaryPetPhoto(deps.sql, { renderId: id, userId: viewer.userId, templateId: template.id, key: inputKey, mime: primary.mime, now });
  }
  const normalizedFrames =
    template.medium === 'image'
      ? selectiveOrderKrw(template, recipe, input.selectedFrames, resolution.resolution).normalizedFrames
      : null;
  const directorSpec = parseDirectorSpecInput(input.directorSpec);
  await insertRenderJob(deps.sql, {
    id,
    userId: viewer.userId!,
    templateId: template.id,
    templateSlug: template.slug,
    medium: template.medium,
    engine,
    aspect: input.aspect,
    resolution: resolution.resolution,
    locale: isLocale(input.locale) ? input.locale : (viewer.locale ?? DEFAULT_LOCALE),
    inputKey,
    inputMime: primary.mime,
    status: held ? 'held' : 'queued',
    selectedFrames: normalizedFrames,
    directorSpec,
  });
  if (input.selfieId) await deps.sql.query('update render_jobs set identity_selfie_id=$2 where id=$1',[id,input.selfieId]);
  return { ok: true, id, held };
}

/**
 * A maker's test render or the studio's review render (docs/PLATFORM-2.0.md §7.4): the recipe runs
 * through the same pass, face check and engine adapters as an order, but the job points at the
 * internal sandbox template, carries its recipe snapshot, sends no email and has no share link.
 * The caller has authorised the person, the format and the count; this only writes the job.
 */
export async function createRecipeSandboxRender(deps: RenderServiceDeps, input: {
  userId: string; locale: string | null; formatId: string; purpose: 'maker_test' | 'studio_review';
  recipe: Recipe; photo: { bytes: Uint8Array; mime: string }; selfieId?: string;
}): Promise<{ ok: true; id: string; held: boolean } | { ok: false; code: 'bad_photo' | 'photo_too_large' }> {
  if (!input.photo.bytes.byteLength || !isPhotoMime(input.photo.mime)) return { ok: false, code: 'bad_photo' };
  if (input.photo.bytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, code: 'photo_too_large' };
  const templateId = await ensureMakerSandbox(deps.sql);
  const mode = deps.mode ?? assetLibraryMode();
  const held = mode === 'liveness' && recipeNeedsIdentity(input.recipe) && (await identityStatusFor(deps.sql, input.userId, mode)) !== 'active';
  const primary = primaryStep(input.recipe);
  const film = input.recipe.steps.find((step) => step.kind === 'video');
  const id = randomUUID();
  const inputKey = `${id}/input.${extensionFor(input.photo.mime)}`;
  await deps.store.put(inputKey, input.photo.bytes, input.photo.mime);
  await insertRenderJob(deps.sql, {
    id, userId: input.userId, templateId, templateSlug: MAKER_SANDBOX_SLUG,
    medium: primary.kind, engine: primary.engine, aspect: primary.params.aspect,
    resolution: film?.kind === 'video' ? film.params.resolution : null,
    locale: isLocale(input.locale) ? input.locale : DEFAULT_LOCALE,
    inputKey, inputMime: input.photo.mime, status: held ? 'held' : 'queued',
  });
  await insertJobRecipe(deps.sql, { renderId: id, purpose: input.purpose, formatId: input.formatId, recipe: input.recipe });
  if (input.selfieId) await deps.sql.query('update render_jobs set identity_selfie_id=$2 where id=$1', [id, input.selfieId]);
  return { ok: true, id, held };
}

/** The identity callback's half: the person is verified, so their held renders join the queue. */
export async function releaseHeldRendersFor(sql: SqlRunner, userId: string): Promise<string[]> {
  return releaseHeldRenderJobs(sql, userId);
}

// ---------------------------------------------------------------------------
// the pass
// ---------------------------------------------------------------------------

export interface RenderPassDeps extends RenderServiceDeps {
  premiumEditor?: PremiumEditClient | null;
  /** Set by the pass's schema probe, never an authorization claim from a request. */
  subscriptionSchemaReady?: boolean;
  /** Payment seam; tests inject their gateway, runtime resolves the configured provider. */
  tossGateway?: TossGateway | null;
  engines?: RenderEngineDeps;
  /** null = no channel configured; finished jobs keep `notify_status = pending` until one is. */
  notifier: RenderNotifier | null;
  siteUrl: string;
  siteName?: string;
  /** Where ModelArk posts task completion; optional, the poll covers a lost callback. */
  callbackUrl?: string | null;
  /** The bank's asset client (docs §8.2); null = AK/SK not configured, ModelArk renders with a photo fail as `identity_unavailable`. */
  assets?: ArkAssetsClient | null;
  /** Pinned by tests; production reads `releaseAfterUseEnabled()` (lib/flags.ts ASSET_RELEASE_AFTER_USE). */
  releaseAfterUse?: boolean;
  /** Real elapsed time for the recipe budget; `now` is pinned to the pass's start. Pinned by tests. */
  clock?: () => number;
}

export interface RenderPassReport {
  recovered: { requeued: number; failed: number };
  claimed: number;
  succeeded: number;
  failed: number;
  requeued: number;
  /** Recipe jobs that stopped between steps for lack of time; queued to continue (not a failure). */
  yielded: number;
  /** Film jobs handed to the provider (or still with it) at the end of the pass. */
  waiting: number;
  notified: number;
  notifyFailed: number;
  notifyPending: number;
  notifier: string;
  /** AIGC people whose face was deleted at the bank after their last render (release after use). */
  released: number;
  /** What the Toss reconcile settled this pass (docs/PLATFORM-2.0.md §2.2-4). */
  payments: TossReconcileReport;
  errors: string[];
}

export interface RenderPassOptions {
  /** How many queued jobs to claim; 0 = poll and notify only. */
  limit?: number;
  /** Run exactly this queued job (the request that enqueued it). */
  jobId?: string | null;
  /** Poll only this specific running job (used by `/renders/[id]` page refresh to avoid O(N²) global polling). */
  pollJobId?: string | null;
}

export async function runRenderPass(deps: RenderPassDeps, options: RenderPassOptions = {}): Promise<RenderPassReport> {
  deps = { ...deps, subscriptionSchemaReady: await subscriptionRenderSchemaReady(deps.sql) };
  const canTrackSubscriptions = !deps.subscriptionSchemaReady && await subscriptionUsageTrackingPresent(deps.sql);
  const now = deps.now ?? new Date();
  const limit = options.limit ?? 5;
  const report: RenderPassReport = {
    recovered: { requeued: 0, failed: 0 },
    claimed: 0,
    succeeded: 0,
    failed: 0,
    requeued: 0,
    yielded: 0,
    waiting: 0,
    notified: 0,
    notifyFailed: 0,
    notifyPending: 0,
    notifier: deps.notifier === null ? 'unconfigured' : `${deps.notifier.channel}:${deps.notifier.kind}`,
    released: 0,
    payments: emptyTossReport(),
    errors: [],
  };

  // Payments never stop renders (docs/PLATFORM-2.0.md §2.2-3): a broken key configuration or a
  // provider outage is one structured log line — no key value — and the queue below still runs.
  let gateway: TossGateway | null = null;
  try {
    gateway = deps.tossGateway === undefined ? getTossGateway() : deps.tossGateway;
  } catch (error) {
    logBilling('error', 'toss_gateway_unavailable', { code: billingErrorCode(error) });
  }
  const settlePayments = async () => {
    if (!gateway) return;
    try {
      addTossReport(report.payments, await reconcileTossPayments({ ...deps, gateway, createRender: createRenderJob }));
    } catch (error) {
      logBilling('error', 'toss_reconcile_failed', { code: billingErrorCode(error) });
    }
  };
  const isTargetedPoll = Boolean(options.pollJobId) && limit === 0 && !options.jobId;
  // Recover approved orders before claiming, and refunds before sending the failure notice.
  // Skip global table-wide sweeps on a targeted single-job page refresh unless that job transitions.
  if (!isTargetedPoll) {
    await settlePayments();
    // 1 — orphaned synchronous renders back to the queue (or failed once the budget is spent).
    report.recovered = await recoverStaleRenderJobs(deps.sql, { now, leaseMinutes: LEASE_MINUTES, maxAttempts: MAX_ATTEMPTS });
    if (deps.subscriptionSchemaReady) {
      report.failed += await expireUnpreparedSubscriptionRenders(deps.sql, now);
      await reconcileFinishedSubscriptionRenders(deps.sql);
    }
  }

  // 2 — claim and run.
  const handedOff = new Set<string>();
  const privateJobBlocked = async (job: RenderJob): Promise<boolean> => {
    if (!canTrackSubscriptions) return false;
    const linked = await deps.sql.query('select render_ref from creator_subscription_usage where render_ref=$1', [job.id]);
    if (!linked.rows.length) return false;
    // A missing/unsafe optional schema must never turn a paid edit into a legacy dispatch.
    // Keep its lease for repair; the next ready pass reconciles terminal usage as usual.
    report.waiting += 1;
    return true;
  };
  if (limit > 0 || options.jobId) {
    const claimed = await claimRenderJobs(deps.sql, { now, limit: options.jobId ? 1 : limit, jobId: options.jobId ?? null });
    report.claimed = claimed.length;
    for (const job of claimed) if (!await privateJobBlocked(job)) await executeClaimed(deps, job, now, report, handedOff);
  }

  // 3 — films the provider is still rendering (not the ones handed over a moment ago).
  const singlePollJob = options.pollJobId ? await loadRenderJob(deps.sql, options.pollJobId) : null;
  const awaiting = options.pollJobId
    ? (singlePollJob && singlePollJob.status === 'running' && singlePollJob.providerTaskId !== null ? [singlePollJob] : [])
    : await listRenderJobsAwaitingProvider(deps.sql, 20);
  for (const job of awaiting) {
    if (handedOff.has(job.id)) continue;
    if (await privateJobBlocked(job)) continue;
    await pollAwaiting(deps, job, now, report);
  }

  const targetedJobSettled = report.succeeded > 0 || report.failed > 0;
  if (!isTargetedPoll || targetedJobSettled) {
    // 3b — the free tier's face slots: whoever has nothing in flight is released at the bank.
    if (deps.releaseAfterUse ?? releaseAfterUseEnabled()) {
      try {
        const released = await releaseAfterUse(identityDeps(deps));
        report.released = released.released;
        if (released.failed > 0) report.errors.push(`release: the bank refused a delete; left for the next pass`);
      } catch (error) {
        report.errors.push(`release: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await settlePayments();
    if (deps.subscriptionSchemaReady) {
      await reconcileFinishedSubscriptionRenders(deps.sql);
      if (!isTargetedPoll) await deleteExpiredEditReferences(deps.sql, deps.store, now);
    }
    // 3c — docs/CAST-CATEGORIES.md §3: a pet or partner photo goes once its render is finished.
    try {
      await deleteSpentSlotPhotos(deps.sql, deps.store, now);
    } catch (error) {
      report.errors.push(`slot photos: ${error instanceof Error ? error.message : String(error)}`);
    }
    // 4 — say so.
    if (!isTargetedPoll) await reconcileRewards(deps.sql);
    await notifyFinished(deps, now, report);
  }
  return report;
}

const ASSET_URL_TTL_SECONDS = 15 * 60;

function identityDeps(deps: RenderPassDeps): IdentityDeps {
  return { sql: deps.sql, assets: deps.assets ?? null, siteUrl: deps.siteUrl, mode: deps.mode ?? assetLibraryMode(), ...(deps.now ? { now: deps.now } : {}) };
}

type Reference =
  | { kind: 'bytes' }
  | { kind: 'asset'; assetId: string }
  | { kind: 'wait'; assetId: string }
  | { kind: 'fail'; failure: RenderFailure };

/**
 * How the person's photo reaches the engine. OpenAI takes the bytes. ModelArk takes only an
 * `asset://` from the person's verified group (docs/TEMPLATES-IA.md §8.2) — registered here by
 * content hash and, while the bank is still comparing, waited on rather than sent.
 */
async function resolveReference(deps: RenderPassDeps, job: RenderJob, photo: RenderPhoto | null): Promise<Reference> {
  if (photo === null || !isEngineId(job.engine) || !needsIdentity(job.engine)) return { kind: 'bytes' };
  return personAsset(deps, job, photo.bytes, job.inputKey);
}

/** Any image of the job's person (their photo, or a recipe step made from it) as a verified-library asset. */
async function personAsset(deps: RenderPassDeps, job: RenderJob, bytes: Uint8Array, key: string | null): Promise<Reference> {
  const ideps = identityDeps(deps);
  let group;
  if (ideps.mode === 'virtual') {
    // The virtual library: the account's AIGC group, made on first use. No door, no wait.
    const ensuredGroup = await ensureVirtualGroup(ideps, job.userId);
    // A retryable refusal (no room yet, bank throttling) requeues the job; the next pass tries again.
    if (!ensuredGroup.ok) return { kind: 'fail', failure: new RenderFailure(ensuredGroup.reason, `no asset group for the person (${ensuredGroup.reason})`, ensuredGroup.retryable === true) };
    group = ensuredGroup.group;
  } else {
    group = await loadIdentityGroup(deps.sql, job.userId);
    if (group === null || group.status !== 'active' || group.groupType !== 'LivenessFace') {
      return { kind: 'fail', failure: new RenderFailure('identity_required', 'the person has not verified their face', false) };
    }
  }
  const photoUrl = key === null ? null : await deps.store.url(key, ASSET_URL_TTL_SECONDS);
  const ensured = await ensureIdentityAsset(ideps, { group, photo: bytes, photoUrl });
  if (ensured.status === 'active') return { kind: 'asset', assetId: ensured.assetId };
  if (ensured.status === 'processing') return { kind: 'wait', assetId: ensured.assetId };
  const code: RenderFailureCode = ensured.reason === 'identity_required' || ensured.reason === 'identity_unavailable' ? ensured.reason : 'asset_failed';
  return { kind: 'fail', failure: new RenderFailure(code, `the photo could not become an asset (${ensured.reason})`, ensured.retryable === true) };
}

/** The engine call itself, once the reference is settled. Films are handed over; images finish here. */
async function renderNow(
  deps: RenderPassDeps,
  job: RenderJob,
  template: PromptRow,
  photo: RenderPhoto | null,
  assetId: string | null,
  now: Date,
  report: RenderPassReport,
  handedOff: Set<string>,
): Promise<void> {
  const request = deps.subscriptionSchemaReady ? await loadSubscriptionRender(deps.sql, job.id) : null;
  const prepared = request ? await prepareSubscriptionPrompt(deps.sql, deps.store, request, now, deps.premiumEditor) : null;
  const prompt = buildRenderPrompt({ promptText: prepared?.promptText ?? template.promptText, medium: job.medium, hasPhoto: photo !== null || assetId !== null });
  const slotFiles = job.directorSpec || (await liveSlotRows(deps.sql, job.id)).length > 0
    ? await loadSlotPhotos(deps.sql, deps.store, job.id)
    : {};
  const customSlots = CUSTOM_REF_SLOTS.filter((slot) => Boolean(slotFiles[slot]));
  const finalPromptText = !prepared && (job.directorSpec || customSlots.length > 0)
    ? await compileDirectorPrompt({
        basePrompt: prompt.text,
        medium: job.medium,
        cast: template.cast,
        hasPersonSlot: photo !== null || assetId !== null,
        hasOutfitRef: Boolean(slotFiles.look_ref),
        hasPropRef: Boolean(slotFiles.prop_ref),
        hasSceneRef: Boolean(slotFiles.scene_ref),
        directorSpec: job.directorSpec,
      })
    : prompt.text;

  if (job.medium === 'image') {
    if (!isImageEngine(job.engine) || !isImageAspect(job.aspect)) throw new RenderFailure('engine_error', `unknown image engine/aspect ${job.engine} ${job.aspect}`, false);
    const customImageRefs: StepReference[] = customSlots
      .map((slot) => slotFiles[slot])
      .filter((f): f is RenderPhoto & { key: string } => Boolean(f))
      .map((f) => ({ kind: 'bytes', bytes: f.bytes, mime: f.mime }));
    const imageReferences: StepReference[] | undefined =
      customImageRefs.length > 0 && photo !== null
        ? [{ kind: 'bytes', bytes: photo.bytes, mime: photo.mime }, ...customImageRefs]
        : undefined;
    const output = await runImageRender(
      { engine: job.engine, prompt: finalPromptText, aspect: job.aspect, photo, assetId, ...(imageReferences ? { references: imageReferences } : {}) },
      deps.engines ?? {},
    );
    await finish(deps, job, output, now);
    if (assetId !== null) await recordIdentityUse(deps.sql, { userId: job.userId, assetId, now });
    report.succeeded += 1;
    return;
  }

  if (!isVideoEngine(job.engine) || !isVideoAspect(job.aspect)) throw new RenderFailure('engine_error', `unknown video engine/aspect ${job.engine} ${job.aspect}`, false);
  if (request) {
    // Asset polls can overlap. One provider dispatch per claimed attempt, after one cached edit.
    const dispatch = await deps.sql.query<{ render_ref: string }>(`update creator_subscription_renders e set dispatch_attempt=$2,dispatch_started_at=$3
      where e.render_ref=$1 and e.dispatch_attempt<$2 and exists(select 1 from render_jobs j where j.id=e.render_ref and j.status='running' and j.attempts=$2) returning e.render_ref`, [job.id, job.attempts, now]);
    if (!dispatch.rows.length) { report.waiting += 1; return; }
  }
  const customVideoUrls: string[] = [];
  for (const slot of customSlots) {
    const file = slotFiles[slot];
    if (!file) continue;
    const url = await deps.store.url(file.key, 30 * 60);
    customVideoUrls.push(url ?? `data:${file.mime};base64,${Buffer.from(file.bytes).toString('base64')}`);
  }
  const referenceUrls = [
    ...fixedVideoReferenceUrls(template.id, deps.siteUrl),
    ...await campaignRenderReferenceUrls(deps.sql, deps.store, job.id),
    ...customVideoUrls,
  ];
  const dispatch = await claimCampaignDispatch(deps.sql, job.id, job.attempts, now);
  if (dispatch.campaign && !dispatch.claimed) { report.waiting += 1; return; }
  try {
  const started = await startVideoRender(
    { engine: job.engine, prompt: finalPromptText, aspect: job.aspect, seconds: prepared?.seconds ?? template.runtimeSeconds ?? 5, photo, assetId,
      fixedReferenceUrls: referenceUrls,
      resolution: renderResolution(job.resolution),
      ...(deps.callbackUrl ? { callbackUrl: deps.callbackUrl } : {}) },
    deps.engines ?? {},
  );
  if (dispatch.campaign) await acknowledgeCampaignTask(deps.sql, job.id, started.taskId);
  else await markRenderRunningWithTask(deps.sql, job.id, { provider: started.provider, taskId: started.taskId });
  } catch (error) {
    if (!dispatch.campaign) throw error;
    // No blind repeat on a lost API response/DB acknowledgement. Marker keeps the live face asset
    // and contract capacity reserved until the studio recovers the original task or verifies absence.
    report.waiting += 1; return;
  }
  if (assetId !== null) await recordIdentityUse(deps.sql, { userId: job.userId, assetId, now });
  handedOff.add(job.id);
  report.waiting += 1;
}

async function executeClaimed(deps: RenderPassDeps, job: RenderJob, now: Date, report: RenderPassReport, handedOff: Set<string>): Promise<void> {
  try {
    const resumed = await resumeCampaignDispatch(deps.sql, job.id);
    if (resumed.resumed) { handedOff.add(job.id); report.waiting += 1; return; }
    const template = await loadPromptById(deps.sql, job.templateId);
    if (template === null) throw new RenderFailure('engine_error', 'the template no longer exists', false);
    const recipe = await jobRecipeFor(deps, job);
    if (recipe) { await renderRecipe(deps, job, recipe, now, report, handedOff); return; }
    const photo = await readPhoto(deps.store, job);
    const reference = await resolveReference(deps, job, photo);
    if (reference.kind === 'fail') throw reference.failure;
    if (reference.kind === 'wait') {
      // The bank is still comparing the photo: park the job on the asset; the poll picks it up.
      await markRenderWaitingForAsset(deps.sql, job.id, reference.assetId);
      handedOff.add(job.id);
      report.waiting += 1;
      return;
    }
    await renderNow(deps, job, template, photo, reference.kind === 'asset' ? reference.assetId : null, now, report, handedOff);
  } catch (error) {
    await settleFailure(deps, job, error, now, report);
  }
}

async function pollAwaiting(deps: RenderPassDeps, job: RenderJob, now: Date, report: RenderPassReport): Promise<void> {
  if (!job.providerTaskId) return;
  if (job.providerTaskId.startsWith(CAMPAIGN_DISPATCH_PREFIX)) { report.waiting += 1; return; }
  if (job.providerTaskId.startsWith(ASSET_TASK_PREFIX)) {
    await pollAssetWait(deps, job, parseAssetTask(job.providerTaskId).assetId, now, report);
    return;
  }
  if (!isVideoEngine(job.engine)) return;
  try {
    const template = await loadPromptById(deps.sql, job.templateId);
    const request = deps.subscriptionSchemaReady ? await loadSubscriptionRender(deps.sql, job.id) : null;
    const recipe = await loadJobRecipe(deps.sql, job.id);
    const effectiveRecipe = recipe?.recipe ? sliceCarouselRecipe(recipe.recipe, job.selectedFrames) : null;
    const film = effectiveRecipe ? primaryStep(effectiveRecipe) : null;
    const { model, seconds } = videoModelFor(job.engine, film?.kind === 'video' ? film.params.duration : request?.runtime_seconds ?? template?.runtimeSeconds ?? 5);
    const polled = await pollVideoRender(
      { taskId: job.providerTaskId, model, seconds, resolution: renderResolution(job.resolution), aspect: job.aspect, onProviderDone: () => markRenderFinishing(deps.sql, job.id, now) },
      deps.engines ?? {},
    );
    if (polled.status === 'pending') {
      report.waiting += 1;
      return;
    }
    if (polled.status === 'succeeded') {
      if (recipe?.recipe && film) {
        // The film is the recipe's last step: store it like any result, then book every step's cost.
        const key = `${job.id}/step-${film.id.replace(/_/g, '-')}.${extensionFor(polled.output.mime)}`;
        await deps.store.put(key, polled.output.bytes, polled.output.mime);
        await finishRecipe(deps, job, [{ step: film.id, key, mime: polled.output.mime, bytes: polled.output.bytes.byteLength }], addCost(recordedUsd(recipe.state), polled.output.costUsd), polled.output, now);
      } else await finish(deps, job, polled.output, now);
      report.succeeded += 1;
      return;
    }
    await settleFailure(deps, job, film ? new RenderFailure(polled.failure.code, `[${film.id}] ${polled.failure.message}`, polled.failure.retryable, film.id) : polled.failure, now, report);
  } catch (error) {
    await settleFailure(deps, job, error, now, report);
  }
}

/** The bank is comparing the photo: ask once; render when it says Active; give up on Failed, or after a day. */
async function pollAssetWait(deps: RenderPassDeps, job: RenderJob, assetId: string, now: Date, report: RenderPassReport): Promise<void> {
  try {
    const status = await pollIdentityAsset(identityDeps(deps), assetId);
    if (status === 'Active') {
      // Polls of a parked job overlap (open page, provider callback, tick). One of them sends it on.
      if (!(await claimAssetDispatch(deps.sql, job, now))) { report.waiting += 1; return; }
      const template = await loadPromptById(deps.sql, job.templateId);
      if (template === null) throw new RenderFailure('engine_error', 'the template no longer exists', false);
      const recipe = await jobRecipeFor(deps, job);
      if (recipe) { await renderRecipe(deps, job, recipe, now, report, new Set()); return; }
      const photo = await readPhoto(deps.store, job);
      // A job parked on an asset before its engine took bytes (Seedream, 2026-10-28) finishes on the photo.
      await renderNow(deps, job, template, photo, isEngineId(job.engine) && needsIdentity(job.engine) ? assetId : null, now, report, new Set());
      return;
    }
    if (status === 'Failed') throw new RenderFailure('asset_failed', 'the bank could not match the photo to the verified face', false);
    const since = Date.parse(job.claimedAt ?? job.createdAt);
    if (now.getTime() - since > ASSET_WAIT_HOURS * 60 * 60 * 1000) throw new RenderFailure('asset_failed', 'the photo was not registered in time', false);
    report.waiting += 1;
  } catch (error) {
    await settleFailure(deps, job, error, now, report);
  }
}

async function readPhoto(store: RenderStore, job: RenderJob): Promise<RenderPhoto | null> {
  if (job.inputKey === null || !isPhotoMime(job.inputMime)) return null;
  return { bytes: await store.read(job.inputKey), mime: job.inputMime };
}

// ---------------------------------------------------------------------------
// recipe v2 (lib/recipes/*) — maker templates, test renders and review renders
// ---------------------------------------------------------------------------

function addCost(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 10000) / 10000;
}

/** The recipe this job runs: its snapshot (test/review jobs, a retry), else the template's, snapshotted now. */
async function jobRecipeFor(deps: RenderPassDeps, job: RenderJob): Promise<JobRecipe | null> {
  const recipe = job.templateId === MAKER_SANDBOX_ID ? await loadJobRecipe(deps.sql, job.id) : await ensureJobRecipe(deps.sql, job.id, job.templateId);
  if (recipe === null && job.templateId === MAKER_SANDBOX_ID) throw new RenderFailure('engine_error', 'a sandbox job without its recipe', false);
  if (recipe !== null && recipe.recipe === null) throw new RenderFailure('engine_error', 'the stored recipe no longer passes the recipe rules', false);
  // A paid edit interprets one prompt; a recipe template is not offered for it (createSubscriptionRenderJob).
  if (recipe !== null && deps.subscriptionSchemaReady && await loadSubscriptionRender(deps.sql, job.id)) throw new RenderFailure('edit_unavailable', 'recipe templates take no subscription edit', false);
  return recipe;
}

async function renderRecipe(deps: RenderPassDeps, job: RenderJob, recipe: JobRecipe, now: Date, report: RenderPassReport, handedOff: Set<string>): Promise<void> {
  const startedAt = (deps.clock ?? Date.now)();
  const photo = await readPhoto(deps.store, job);
  const effectiveRecipe = sliceCarouselRecipe(recipe.recipe!, job.selectedFrames);
  const userSlots = await loadSlotPhotos(deps.sql, deps.store, job.id);
  const run = await runRecipe({
    jobId: job.id,
    recipe: effectiveRecipe,
    outputAspect: job.aspect,
    state: recipe.state,
    store: deps.store,
    engines: deps.engines ?? {},
    selfie: photo && job.inputKey ? { ...photo, key: job.inputKey } : null,
    // docs/CAST-CATEGORIES.md §3 — the pet or partner photo (a pet-only job's pet is its input photo).
    userSlots,
    audioMode: job.directorSpec?.audioMode,
    stepPromptOverride: job.directorSpec || CUSTOM_REF_SLOTS.some((slot) => Boolean(userSlots[slot]))
      ? ({ step, prompt, isOutput, customSlots }) => {
          if (!isOutput && customSlots.length === 0) return prompt;
          return compileDirectorPrompt({
            basePrompt: prompt,
            medium: step.kind,
            hasPersonSlot: step.inputs.includes('selfie'),
            hasOutfitRef: Boolean(userSlots.look_ref),
            hasPropRef: Boolean(userSlots.prop_ref),
            hasSceneRef: Boolean(userSlots.scene_ref),
            directorSpec: job.directorSpec,
          });
        }
      : undefined,
    makerFile: (handle) => readMakerFile(deps.sql, deps.store, handle),
    person: async ({ bytes, key }) => {
      const reference = await personAsset(deps, job, bytes, key);
      if (reference.kind === 'fail') throw reference.failure;
      if (reference.kind === 'bytes') throw new RenderFailure('identity_unavailable', 'the face could not reach the verified library', false);
      return reference;
    },
    saveStep: (stepId, record) => saveStepRecord(deps.sql, job.id, stepId, record),
    outOfTime: () => (deps.clock ?? Date.now)() - startedAt >= RECIPE_PASS_BUDGET_MS,
    ...(deps.callbackUrl ? { callbackUrl: deps.callbackUrl } : {}),
  });
  if (run.kind === 'yield') {
    await yieldRenderJob(deps.sql, job.id);
    report.yielded += 1;
    return;
  }
  if (run.kind === 'wait') {
    await markRenderWaitingForAsset(deps.sql, job.id, run.assetId);
    handedOff.add(job.id);
    report.waiting += 1;
    return;
  }
  if (run.kind === 'handed') {
    await markRenderRunningWithTask(deps.sql, job.id, { provider: run.provider, taskId: run.taskId });
    for (const assetId of new Set(run.assets)) await recordIdentityUse(deps.sql, { userId: job.userId, assetId, now });
    handedOff.add(job.id);
    report.waiting += 1;
    return;
  }
  const first = run.results[0]!;
  const primary = primaryStep(effectiveRecipe).engine;
  const provider = isEngineId(primary) ? engineProvider(primary) : 'modelark';
  await finishRecipe(deps, job, run.results, run.usd, { bytes: await deps.store.read(first.key), mime: first.mime, provider, costUsd: run.usd }, now);
  for (const assetId of new Set(run.assets)) await recordIdentityUse(deps.sql, { userId: job.userId, assetId, now });
  report.succeeded += 1;
}

/**
 * A recipe job's results: the first is the job's one result (`result.{ext}`, so every one-result page
 * works unchanged), every one is listed in render_job_outputs (a carousel's frames, in order).
 */
async function finishRecipe(deps: RenderPassDeps, job: RenderJob, results: RecipeResult[], usd: number | null, first: EngineOutput, now: Date): Promise<void> {
  await markRenderFinishing(deps.sql, job.id, now);
  const keys: string[] = [];
  for (const [index, result] of results.entries()) {
    const key = index === 0 ? `${job.id}/result.${extensionFor(result.mime)}` : `${job.id}/result-${index + 1}.${extensionFor(result.mime)}`;
    const bytes = index === 0 ? first.bytes : await deps.store.read(result.key);
    await deps.store.put(key, bytes, result.mime);
    keys.push(key);
  }
  await deps.sql.transaction(async sql => {
    const ended = await markRenderSucceeded(sql, job.id, {
      resultKey: keys[0]!,
      resultMime: results[0]!.mime,
      resultBytes: first.bytes.byteLength,
      provider: first.provider,
      costUsd: usd,
      shareToken: newShareToken(),
      shareExpiresAt: shareExpiresAt(now),
      finishedAt: now,
    }, { onlyRunning: true });
    if (!ended) return; // another pass already ended this job
    // Several steps are several provider calls: the sum stays an estimate until each has an invoice line.
    await sql.query('update render_jobs set provider_completion_tokens=$2,cost_source=$3 where id=$1', [job.id, results.length === 1 && first.completionTokens ? first.completionTokens : null, usd === null ? null : 'estimate']);
    await insertJobOutputs(sql, job.id, results.map((result, index) => ({ stepId: result.step, key: keys[index]!, mime: result.mime, bytes: result.bytes })));
    if (deps.subscriptionSchemaReady) await settleSubscriptionUsage(sql, job.id, 'completed');
  });
}

/**
 * The provider's result becomes ours: copied into the private bucket, then one transaction marks it
 * succeeded with its 3-day link. `finishing_at` goes in first (a film already recorded it the moment
 * the provider said done, before the download), so the wait page can name the copy "마무리".
 */
async function finish(deps: RenderPassDeps, job: RenderJob, output: EngineOutput, now: Date): Promise<void> {
  await markRenderFinishing(deps.sql, job.id, now);
  const resultKey = `${job.id}/result.${extensionFor(output.mime)}`;
  await deps.store.put(resultKey, output.bytes, output.mime);
  await deps.sql.transaction(async sql => {
    const ended = await markRenderSucceeded(sql, job.id, {
      resultKey,
      resultMime: output.mime,
      resultBytes: output.bytes.byteLength,
      provider: output.provider,
      costUsd: output.costUsd,
      shareToken: newShareToken(),
      shareExpiresAt: shareExpiresAt(now),
      finishedAt: now,
    }, { onlyRunning: true });
    if (!ended) return; // another pass already ended this job
    if (deps.subscriptionSchemaReady || await platformReady(sql)) await sql.query('update render_jobs set provider_completion_tokens=$2,cost_source=$3 where id=$1', [job.id, output.completionTokens ?? null, output.costSource ?? (output.costUsd === null ? null : 'estimate')]);
    if (deps.subscriptionSchemaReady) await settleSubscriptionUsage(sql, job.id, 'completed');
  });
}

async function settleFailure(deps: RenderPassDeps, job: RenderJob, error: unknown, now: Date, report: RenderPassReport): Promise<void> {
  const rawFailure = error instanceof RenderFailure ? error : new RenderFailure('engine_error', error instanceof Error ? error.message : String(error), false);
  const privateRequest = deps.subscriptionSchemaReady ? await loadSubscriptionRender(deps.sql, job.id) : null;
  const failure = privateRequest ? new RenderFailure(rawFailure.code, rawFailure.code, rawFailure.retryable) : rawFailure;
  // Another worker owns the one paid interpretation; leave its lease/status intact.
  if (privateRequest && failure.code === 'edit_in_progress') { report.waiting += 1; return; }
  // A recipe step failure is recorded as `code:step`; readers strip the step (`baseFailureCode`).
  const code = failure.step ? `${failure.code}:${failure.step}` : failure.code;
  report.errors.push(`${job.id}: ${code} — ${failure.message}`);
  // Overlapping polls: when another pass has already ended or requeued this job, this failure is not the job's.
  if (failure.retryable && job.attempts < MAX_ATTEMPTS) {
    if (await requeueRenderJob(deps.sql, job.id, { code, message: failure.message })) report.requeued += 1;
    return;
  }
  const failed = await deps.sql.transaction(async sql => {
    if (!(await markRenderFailed(sql, job.id, { code, message: failure.message, finishedAt: now, onlyRunning: true }))) return false;
    if (deps.subscriptionSchemaReady) await settleSubscriptionUsage(sql, job.id, 'failed');
    return true;
  });
  if (failed) report.failed += 1;
}

/** Handles jobs failed by stale recovery, plus a worker that died after its terminal row write. */
async function reconcileFinishedSubscriptionRenders(sql: SqlRunner): Promise<void> {
  const { rows } = await sql.query<{ render_ref: string; status: 'succeeded' | 'failed' }>(`select u.render_ref,j.status from creator_subscription_usage u join render_jobs j on j.id=u.render_ref
    where u.state='reserved' and j.status in ('succeeded','failed') order by j.finished_at asc nulls last limit 50`);
  for (const row of rows) await settleSubscriptionUsage(sql, row.render_ref, row.status === 'succeeded' ? 'completed' : 'failed');
}

/** Never retry an ambiguous paid edit, nor send a reference that has passed its retention date.
 * An actual video task already accepted by the provider remains owned by the normal poll.
 */
async function expireUnpreparedSubscriptionRenders(sql: SqlRunner, now: Date): Promise<number> {
  const { rows } = await sql.query<{ render_ref: string }>(`select e.render_ref from creator_subscription_renders e join render_jobs j on j.id=e.render_ref
    where j.status in ('held','queued','running') and (j.provider_task_id is null or j.provider_task_id like 'asset:%')
      and ((e.edit_status='preparing' and e.prepare_started_at <= $1::timestamptz - interval '20 minutes')
        or (e.edit_status='pending' and e.references_expire_at <= $1::timestamptz)
        or (e.dispatch_started_at <= $1::timestamptz - interval '20 minutes')) limit 50`, [now]);
  let expired = 0;
  for (const row of rows) await sql.transaction(async tx => {
    const locked = (await tx.query<{ id: string; provider_task_id: string | null; status: string }>('select id,provider_task_id,status from render_jobs where id=$1 for update', [row.render_ref])).rows[0];
    if (!locked || !['held', 'queued', 'running'].includes(locked.status) || (locked.provider_task_id && !locked.provider_task_id.startsWith('asset:'))) return;
    const changed = await tx.query<{ render_ref: string }>(`update creator_subscription_renders set edit_status=case when edit_status in ('pending','preparing') then 'failed' else edit_status end,failure_code='edit_unavailable'
      where render_ref=$1 and ((edit_status='preparing' and prepare_started_at <= $2::timestamptz - interval '20 minutes')
        or (edit_status='pending' and references_expire_at <= $2::timestamptz)
        or dispatch_started_at <= $2::timestamptz - interval '20 minutes') returning render_ref`, [row.render_ref, now]);
    if (!changed.rows.length) return;
    await markRenderFailed(tx, row.render_ref, { code: 'edit_unavailable', message: 'edit_unavailable', finishedAt: now });
    await settleSubscriptionUsage(tx, row.render_ref, 'failed');
    expired += 1;
  });
  return expired;
}

async function notifyFinished(deps: RenderPassDeps, now: Date, report: RenderPassReport): Promise<void> {
  const due = await listRenderJobsToNotify(deps.sql, { limit: 20, maxAttempts: NOTIFY_MAX_ATTEMPTS });
  if (deps.notifier === null) {
    report.notifyPending = due.length;
    return;
  }
  for (const job of due) {
    if ((await deps.sql.query('select render_id from brand_production_reservations where render_id=$1',[job.id])).rows.length || await renderPurpose(deps.sql, job.id) !== 'customer') {
      await markRenderNotified(deps.sql,job.id,{status:'skipped',at:now,spendAttempt:false});
      continue;
    }
    const payment = job.status === 'failed' ? await renderPaymentStatus(deps.sql, job.id) : null;
    if (payment === 'paid' || payment === 'refund_pending') {
      report.notifyPending += 1;
      continue;
    }
    const recipient = await loadRecipient(deps.sql, job.userId);
    if (recipient === null) {
      await markRenderNotified(deps.sql, job.id, { status: 'skipped', at: now, spendAttempt: false });
      continue;
    }
    const template = await loadPromptById(deps.sql, job.templateId);
    const locale = recipient.locale ?? job.locale;
    const outcome = await deps.notifier.send({
      job,
      templateTitle: templateTitle(template, locale, job.templateSlug),
      recipient: { email: recipient.email, locale },
      failureReason: job.status === 'failed' ? [failureReason(job.errorCode, locale), payment === 'refunded' ? getDictionary(locale).billing.toss.refunded : null].filter(Boolean).join(' ') : null,
      // A set's every picture, behind the same 3-day token as the link the message carries.
      frames: job.shareToken ? await loadRenderFrames(deps.sql, job, job.shareToken) : [],
      siteUrl: deps.siteUrl,
      siteName: deps.siteName ?? getDictionary(locale).meta.siteName,
    });
    if (outcome.ok) {
      await markRenderNotified(deps.sql, job.id, { status: 'sent', at: now, spendAttempt: true });
      report.notified += 1;
      continue;
    }
    // A refusal that is OUR configuration (the sending domain not yet verified at Resend, a bad
    // from address) is not this message's fault: leave it pending without spending an attempt, so
    // it goes out on the first pass after the founder fixes the console (2026-09-09 production).
    if (/domain is not verified|not verified|invalid_from_address|from address/i.test(outcome.error)) {
      await markRenderNotified(deps.sql, job.id, { status: 'pending', at: now, spendAttempt: false });
      report.notifyPending += 1;
      report.errors.push(`${job.id}: notify (config, waiting) — ${outcome.error}`);
      continue;
    }
    const terminal = !outcome.retryable || job.notifyAttempts + 1 >= NOTIFY_MAX_ATTEMPTS;
    await markRenderNotified(deps.sql, job.id, { status: terminal ? 'failed' : 'pending', at: now, spendAttempt: true });
    if (terminal) report.notifyFailed += 1;
    else report.notifyPending += 1;
    report.errors.push(`${job.id}: notify — ${outcome.error}`);
  }
}

async function loadRecipient(sql: SqlRunner, userId: string): Promise<{ email: string | null; locale: Locale | null } | null> {
  const { rows } = await sql.query<{ email: string | null; locale: string | null }>('select email, locale from profiles where id = $1', [userId]);
  const row = rows[0];
  if (!row) return null;
  return { email: row.email, locale: isLocale(row.locale) ? row.locale : null };
}

export function templateTitle(template: Pick<PromptRow, 'title' | 'titleKo'> | null, locale: Locale, fallback: string): string {
  if (template === null) return fallback;
  return locale === 'ko' && template.titleKo ? template.titleKo : template.title;
}

/** The reader-facing explanation of a failure code, in their language. */
export function failureReason(code: string | null, locale: Locale): string {
  const errors = getDictionary(locale).renders.error;
  const key = (baseFailureCode(code) ?? 'engine_error') as keyof typeof errors;
  return errors[key] ?? errors.engine_error;
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

export interface RenderView {
  job: RenderJob;
  templateTitle: string;
  templateTitleKo: string | null;
}

async function withTitles(sql: SqlRunner, jobs: RenderJob[]): Promise<RenderView[]> {
  if (jobs.length === 0) return [];
  const ids = [...new Set(jobs.map((job) => job.templateId))];
  const { rows } = await sql.query<{ id: string; title: string; title_ko: string | null }>('select id, title, title_ko from prompt_items where id = any($1::uuid[])', [ids]);
  const titles = new Map(rows.map((row) => [row.id, row]));
  return jobs.map((job) => {
    const row = titles.get(job.templateId);
    return { job, templateTitle: row?.title ?? job.templateSlug, templateTitleKo: row?.title_ko ?? null };
  });
}

/** The owner's own render, or null — another user's id is "not found", never "forbidden". */
export async function loadOwnRender(sql: SqlRunner, viewer: Viewer, id: string): Promise<RenderView | null> {
  if (viewer.userId === null || !isRenderId(id)) return null;
  const job = await loadRenderJob(sql, id);
  if (job === null || job.userId !== viewer.userId) return null;
  const [reserved, views] = await Promise.all([
    sql.query('select render_id from brand_production_reservations where render_id=$1', [id]),
    withTitles(sql, [job]),
  ]);
  if (reserved.rows.length) return null;
  return views[0] ?? null;
}

export type SharedRender = { status: 'ok'; view: RenderView } | { status: 'expired'; view: RenderView } | { status: 'not_found' };

/** The 3-day link: the token must match the row exactly; an expired one still names the render so the page can say so. */
export async function loadSharedRender(sql: SqlRunner, id: string, token: string, now: Date = new Date()): Promise<SharedRender> {
  if (!isRenderId(id) || !isShareTokenShape(token)) return { status: 'not_found' };
  const job = await loadRenderJob(sql, id);
  if (job === null || job.status !== 'succeeded' || job.shareToken === null || !constantTimeEqual(job.shareToken, token)) return { status: 'not_found' };
  // A maker's test render or the studio's review render is never a public link.
  if (job.templateId === MAKER_SANDBOX_ID) return { status: 'not_found' };
  const [reserved, views] = await Promise.all([
    sql.query('select render_id from brand_production_reservations where render_id=$1', [id]),
    withTitles(sql, [job]),
  ]);
  if (reserved.rows.length) return { status: 'not_found' };
  const view = views[0]!;
  return isShareExpired(job.shareExpiresAt, now) ? { status: 'expired', view } : { status: 'ok', view };
}

export async function listMyRenders(sql: SqlRunner, userId: string, limit = 50): Promise<RenderView[]> {
  // Test and review renders live in the maker editor and the review queue, not in "내 결과물".
  return withTitles(sql, (await listRenderJobsForUser(sql, userId, limit)).filter((job) => job.templateId !== MAKER_SANDBOX_ID));
}

export type CreateStoreIapRenderFailure =
  | CreateRenderFailure
  | 'bad_request'
  | 'insufficient_credits';

export type CreateStoreIapRenderOutcome =
  | { ok: true; id: string; held: boolean; creditsSpent: number; balance: number }
  | {
      ok: false;
      code: CreateStoreIapRenderFailure;
      creditsNeeded?: number;
      balance?: number;
    };

class StoreIapRenderAbort extends Error {
  constructor(
    readonly outcome: Exclude<CreateStoreIapRenderOutcome, { ok: true }>,
  ) {
    super(outcome.code);
  }
}

/**
 * Consumes pre-verified App Store / Google Play IAP credits to enqueue a personal render inside
 * native store wrappers (`ios-store` / `android-store`), keeping web checkout completely separate.
 */
export async function createStoreIapRenderJob(
  deps: RenderServiceDeps,
  viewer: Viewer,
  input: CreateRenderInput & {
    storePlatform: 'ios-store' | 'android-store';
    requestId: string;
  },
): Promise<CreateStoreIapRenderOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  if (!SUBSCRIPTION_UUID.test(input.requestId)) return { ok: false, code: 'bad_request' };
  if (!canStartRender(viewer, deps.pipelineMode)) return { ok: false, code: 'not_open' };

  const osPlatform = toNativeIapOs(input.storePlatform);
  const spendTxId = `spend:${input.requestId}`;

  try {
    return await deps.sql.transaction(async (sql) => {
      await sql.query('select id from profiles where id = $1 for no key update', [viewer.userId]);

      const existing = await sql.query<{ render_id: string | null; credits_delta: number }>(
        'select render_id, credits_delta from store_iap_transactions where platform = $1 and transaction_id = $2 for update',
        [osPlatform, spendTxId],
      );
      if (existing.rows[0]?.render_id) {
        const job = await loadRenderJob(sql, existing.rows[0].render_id);
        if (!job || job.userId !== viewer.userId) {
          throw new StoreIapRenderAbort({ ok: false, code: 'not_found' });
        }
        const wallet = await sql.query<{ credits_balance: number }>(
          'select credits_balance from store_iap_wallets where user_id = $1',
          [viewer.userId],
        );
        return {
          ok: true,
          id: job.id,
          held: job.status === 'held',
          creditsSpent: Math.abs(Number(existing.rows[0].credits_delta)),
          balance: Number(wallet.rows[0]?.credits_balance ?? 0),
        };
      }

      const template = await loadPromptBySlug(sql, input.templateSlug);
      if (!template || template.status !== 'published' || template.audience === 'brand') {
        throw new StoreIapRenderAbort({ ok: false, code: 'not_found' });
      }
      if (!isForSale(template)) {
        throw new StoreIapRenderAbort({ ok: false, code: 'not_for_sale' });
      }

      const resolution = renderableResolution(template, input.resolution);
      if (!resolution.ok) {
        throw new StoreIapRenderAbort({ ok: false, code: 'bad_resolution' });
      }

      const recipe = await loadTemplateRecipe(sql, template.id);
      const priced = selectiveOrderKrw(template, recipe, input.selectedFrames, resolution.resolution);
      if (priced.amountKrw === null || priced.amountKrw <= 0) {
        throw new StoreIapRenderAbort({ ok: false, code: 'not_for_sale' });
      }

      const creditsNeeded = creditsRequiredForKrw(priced.amountKrw);
      const wallet = await sql.query<{ credits_balance: number }>(
        'select credits_balance from store_iap_wallets where user_id = $1 for update',
        [viewer.userId],
      );
      const currentBalance = Number(wallet.rows[0]?.credits_balance ?? 0);
      if (currentBalance < creditsNeeded) {
        throw new StoreIapRenderAbort({
          ok: false,
          code: 'insufficient_credits',
          creditsNeeded,
          balance: currentBalance,
        });
      }

      const created = await createAuthorizedRender(
        { ...deps, sql },
        viewer,
        {
          ...input,
          selectedFrames: priced.normalizedFrames,
          resolution: resolution.resolution,
        },
        undefined,
        template,
      );
      if (!created.ok) {
        throw new StoreIapRenderAbort(created);
      }

      const updatedWallet = await sql.query<{ credits_balance: number }>(
        `update store_iap_wallets
           set credits_balance = credits_balance - $2,
               lifetime_spent = lifetime_spent + $2
         where user_id = $1
         returning credits_balance`,
        [viewer.userId, creditsNeeded],
      );

      await sql.query(
        `insert into store_iap_transactions
           (user_id, platform, product_id, transaction_id, kind, credits_delta, status, environment, render_id, verified_at)
         values ($1, $2, $3, $4, 'spend', $5, 'verified', 'production', $6, now())`,
        [
          viewer.userId,
          osPlatform,
          `render:${template.slug}`,
          spendTxId,
          -creditsNeeded,
          created.id,
        ],
      );

      return {
        ok: true,
        id: created.id,
        held: created.held,
        creditsSpent: creditsNeeded,
        balance: Number(updatedWallet.rows[0]?.credits_balance ?? currentBalance - creditsNeeded),
      };
    });
  } catch (error) {
    if (error instanceof StoreIapRenderAbort) {
      return error.outcome;
    }
    throw error;
  }
}
