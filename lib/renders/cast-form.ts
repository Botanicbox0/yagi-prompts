import type { SqlRunner } from '@/lib/db/sql-runner';
import { savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import {
  CAST_SLOTS, castOpen, cleanSlotPhoto, extraSlots, liveSlotRows, petIsPrimary, storeSlotPhotos, templateMakeInputs,
  type CastSlot, type SlotPhoto,
} from './cast-inputs';
import type { RenderStore } from './store';
import { checkPetPhoto, petRefusal, type PetPhotoVerdict } from './pet-photo-check';

/**
 * docs/CAST-CATEGORIES.md §3 — the make request's photos, read the same way by the paid order route
 * (`/api/billing/toss/orders`) and the operator's free render (`/api/renders`).
 *
 * Field names: `selfieId` (the buyer's saved selfie, unchanged), `slot_pet`, `slot_partner` (files),
 * `partnerConsent=yes` (the uploader confirmed the partner agreed). Nothing here prices, charges or
 * changes an order: it only decides which photo the order carries and which extra photos go with it.
 */

export interface CastFormPhotos {
  slots: Partial<Record<CastSlot, SlotPhoto>>;
  partnerConsent: boolean;
}

export async function castFormPhotos(form: FormData): Promise<CastFormPhotos> {
  const slots: Partial<Record<CastSlot, SlotPhoto>> = {};
  for (const slot of CAST_SLOTS) {
    const file = form.get(`slot_${slot}`);
    if (file instanceof File && file.size > 0) slots[slot] = { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type };
  }
  return { slots, partnerConsent: form.get('partnerConsent') === 'yes' };
}

export type OrderPhotosFailure = 'selfie_required' | 'not_found' | 'not_for_sale' | 'slot_missing' | 'bad_slot_photo' | 'partner_consent_required' | 'not_a_pet' | 'pet_check_unavailable';
export type OrderPhotos =
  | { ok: true; photo: SlotPhoto; selfieId: string | null; extras: Partial<Record<CastSlot, SlotPhoto>>; partnerConsent: boolean; templateId: string | null }
  | { ok: false; code: OrderPhotosFailure };

/**
 * The photos a paid order carries. A solo template (and an unknown slug, which the order itself
 * refuses) keeps exactly today's rule: the saved selfie or `selfie_required`. A pet-only template's
 * one photo is the pet; a person + pet or couple template adds the second photo, bound to the order
 * by `bindOrderPhotos` once the order exists.
 */
export async function orderPhotos(sql: SqlRunner, store: RenderStore, userId: string, form: FormData, deps: { petCheck?: (photo: SlotPhoto) => Promise<PetPhotoVerdict> } = {}): Promise<OrderPhotos> {
  const petCheck = deps.petCheck ?? checkPetPhoto;
  const selfieId = String(form.get('selfieId') ?? '');
  const selfie = async () => (selfieId ? await savedSelfiePhoto(sql, store, userId, selfieId) : null);
  const template = await loadPromptBySlug(sql, String(form.get('template') ?? ''));
  if (template === null || template.cast === 'solo') {
    const saved = await selfie();
    return saved ? { ok: true, photo: saved, selfieId, extras: {}, partnerConsent: false, templateId: template?.id ?? null } : { ok: false, code: 'selfie_required' };
  }
  if (!castOpen(template.cast)) return { ok: false, code: 'not_found' };
  const inputs = await templateMakeInputs(sql, template);
  if (inputs === null) return { ok: false, code: 'not_for_sale' };
  const { slots, partnerConsent } = await castFormPhotos(form);
  let photo: SlotPhoto;
  let usedSelfie: string | null = null;
  if (petIsPrimary(inputs)) {
    if (!slots.pet) return { ok: false, code: 'slot_missing' };
    try { photo = await cleanSlotPhoto(slots.pet); } catch { return { ok: false, code: 'bad_slot_photo' }; }
    // Before anything is stored or charged: a person in the pet slot would skip every face rule.
    const refused = petRefusal(await petCheck(photo));
    if (refused) return { ok: false, code: refused };
  } else {
    const saved = await selfie();
    if (!saved) return { ok: false, code: 'selfie_required' };
    photo = saved;
    usedSelfie = selfieId;
  }
  const extras: Partial<Record<CastSlot, SlotPhoto>> = {};
  for (const slot of extraSlots(inputs)) {
    const given = slots[slot];
    if (!given) return { ok: false, code: 'slot_missing' };
    try { extras[slot] = await cleanSlotPhoto(given); } catch { return { ok: false, code: 'bad_slot_photo' }; }
    if (slot === 'pet') {
      const refused = petRefusal(await petCheck(extras[slot]!));
      if (refused) return { ok: false, code: refused };
    }
  }
  if (extras.partner && !partnerConsent) return { ok: false, code: 'partner_consent_required' };
  return { ok: true, photo, selfieId: usedSelfie, extras, partnerConsent, templateId: template.id };
}

/**
 * Bind the extra photos to the order's future render id (`billing_payments.render_ref`): the render
 * job is created with that id when the payment confirms, and reads them from there. An order that is
 * never paid leaves them unclaimed, and the render pass deletes them (lib/renders/cast-inputs.ts).
 */
export async function bindOrderPhotos(sql: SqlRunner, store: RenderStore, input: { orderId: string; userId: string; templateId: string; extras: Partial<Record<CastSlot, SlotPhoto>>; partnerConsent: boolean; now: Date }): Promise<void> {
  if (Object.keys(input.extras).length === 0) return;
  const { rows } = await sql.query<{ render_ref: string }>('select render_ref from billing_payments where id = $1 and user_id = $2', [input.orderId, input.userId]);
  const renderRef = rows[0]?.render_ref;
  if (!renderRef) throw Error('order_without_render_ref');
  await storeSlotPhotos(sql, store, {
    renderId: renderRef, userId: input.userId, templateId: input.templateId, photos: input.extras,
    partnerConsentAt: input.partnerConsent ? input.now : null, now: input.now,
  });
}

// ---------------------------------------------------------------------------
// 다시 결제하기 (docs/PLATFORM-2.0.md §2.2-1) — the retry makes a new order with a NEW render_ref
// (lib/billing/toss-service.ts, untouched). The order's own photo travels with it; the second photo
// lives in render_slot_inputs under the OLD render_ref, so the route copies it across. A solo order
// (every order before pets and couples) takes the 'solo' branch and the retry runs exactly as before.
// ---------------------------------------------------------------------------

export type RetryPhotoPlan =
  | { kind: 'solo' }
  | { kind: 'refuse'; code: 'not_found' | 'photos_gone' }
  | { kind: 'copy'; fromRef: string; templateId: string; slots: CastSlot[] };

export async function planRetryPhotos(sql: SqlRunner, userId: string, orderId: string): Promise<RetryPhotoPlan> {
  // A malformed id is the retry's own `not_found`; never a database error from this read.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return { kind: 'solo' };
  const { rows } = await sql.query<{ template_id: string | null; render_ref: string | null }>(
    'select template_id, render_ref from billing_payments where id = $1 and user_id = $2', [orderId, userId]);
  const order = rows[0];
  // Unknown order or template: the retry itself answers (not_found), exactly as before.
  if (!order?.template_id || !order.render_ref) return { kind: 'solo' };
  const { rows: templates } = await sql.query<{ id: string; cast: string }>(
    `select id, coalesce(to_jsonb(prompt_items.*)->>'cast_kind', 'solo') as cast from prompt_items where id = $1`, [order.template_id]);
  const template = templates[0];
  if (!template || template.cast === 'solo') return { kind: 'solo' };
  const cast = template.cast === 'pet' ? 'pet' : 'couple';
  if (!castOpen(cast)) return { kind: 'refuse', code: 'not_found' };
  const inputs = await templateMakeInputs(sql, { id: template.id, cast });
  if (inputs === null) return { kind: 'refuse', code: 'not_found' };
  const slots = extraSlots(inputs);
  if (slots.length === 0) return { kind: 'solo' };
  // The second photo is deleted two hours after an unpaid order (lib/renders/cast-inputs.ts): if it is
  // gone, the reader starts a new order with a new photo instead of paying for one that cannot render.
  const live = await liveSlotRows(sql, order.render_ref);
  if (!slots.every((slot) => live.some((row) => row.slot === slot))) return { kind: 'refuse', code: 'photos_gone' };
  return { kind: 'copy', fromRef: order.render_ref, templateId: template.id, slots };
}

/** Copy the live second photo(s) of the old order onto the new order's render_ref (files copied, not shared). */
export async function copyRetryPhotos(sql: SqlRunner, store: RenderStore, input: { plan: Extract<RetryPhotoPlan, { kind: 'copy' }>; newOrderId: string; userId: string; now: Date }): Promise<void> {
  const { rows } = await sql.query<{ render_ref: string }>('select render_ref from billing_payments where id = $1 and user_id = $2', [input.newOrderId, input.userId]);
  const toRef = rows[0]?.render_ref;
  if (!toRef) throw Error('order_without_render_ref');
  if (toRef === input.plan.fromRef) return;
  const live = await liveSlotRows(sql, input.plan.fromRef);
  const photos: Partial<Record<CastSlot, SlotPhoto>> = {};
  let consentAt: Date | null = null;
  for (const slot of input.plan.slots) {
    const row = live.find((item) => item.slot === slot);
    if (!row) throw Error('photos_gone');
    photos[slot] = { bytes: await store.read(row.storage_key), mime: row.mime };
    if (slot === 'partner' && row.partner_consent_at) consentAt = new Date(row.partner_consent_at);
  }
  await storeSlotPhotos(sql, store, { renderId: toRef, userId: input.userId, templateId: input.plan.templateId, photos, partnerConsentAt: consentAt, now: input.now });
}
