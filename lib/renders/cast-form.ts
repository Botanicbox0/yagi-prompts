import type { SqlRunner } from '@/lib/db/sql-runner';
import { savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import {
  CAST_SLOTS, castOpen, cleanSlotPhoto, extraSlots, petIsPrimary, storeSlotPhotos, templateMakeInputs,
  type CastSlot, type SlotPhoto,
} from './cast-inputs';
import type { RenderStore } from './store';

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

export type OrderPhotosFailure = 'selfie_required' | 'not_found' | 'not_for_sale' | 'slot_missing' | 'bad_slot_photo' | 'partner_consent_required';
export type OrderPhotos =
  | { ok: true; photo: SlotPhoto; selfieId: string | null; extras: Partial<Record<CastSlot, SlotPhoto>>; partnerConsent: boolean; templateId: string | null }
  | { ok: false; code: OrderPhotosFailure };

/**
 * The photos a paid order carries. A solo template (and an unknown slug, which the order itself
 * refuses) keeps exactly today's rule: the saved selfie or `selfie_required`. A pet-only template's
 * one photo is the pet; a person + pet or couple template adds the second photo, bound to the order
 * by `bindOrderPhotos` once the order exists.
 */
export async function orderPhotos(sql: SqlRunner, store: RenderStore, userId: string, form: FormData): Promise<OrderPhotos> {
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
