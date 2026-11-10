import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { coupleTemplatesOpen } from '@/lib/flags';
import type { PromptRow } from '@/lib/prompts/repo';
import type { TemplateCast } from '@/lib/prompts/schemas';
import { loadTemplateRecipe } from '@/lib/recipes/repo';
import { PARTNER_SLOT, PET_SLOT, recipeCast, recipeMakeInputs, type Recipe } from '@/lib/recipes/schema';
import type { RenderPhoto } from './engines';
import type { RenderStore } from './store';

/**
 * docs/CAST-CATEGORIES.md §3 — the buyer's OTHER photos: a pet, or the partner of a couple template.
 *
 * What lives here and nowhere else:
 *   · what a template asks for (`templateMakeInputs`) — the recipe's slots, checked against the
 *     template's cast, so the page, the payment route and the render agree;
 *   · how those photos are cleaned, stored (`{render_id}/slot-{slot}.jpg`, private `renders` bucket),
 *     handed to the pass, and deleted once the render is finished (`deleteSpentSlotPhotos`).
 *
 * What does NOT happen here, on purpose: a pet photo is never face-checked and never joins an identity
 * group; a partner photo never joins the account's identity group either (lib/recipes/schema.ts refuses
 * any recipe that would send it to the verified library). The buyer's own selfie keeps every existing
 * rule — it does not pass through this file at all. Every image an engine receives still goes through
 * the provider's own moderation (lib/renders/engines.ts maps those refusals).
 */

export type CastSlot = typeof PET_SLOT | typeof PARTNER_SLOT;
export const CAST_SLOTS: readonly CastSlot[] = [PET_SLOT, PARTNER_SLOT];

/** What the make step asks the buyer for. `null` = this template cannot be made yet (see `templateMakeInputs`). */
export interface CastMakeInputs {
  cast: TemplateCast;
  selfie: boolean;
  pet: boolean;
  partner: boolean;
}

const SOLO: Omit<CastMakeInputs, 'cast'> = { selfie: true, pet: false, partner: false };

/** Couples exist only while their flag is on (docs/CAST-CATEGORIES.md §4). Solo and pet are always open. */
export function castOpen(cast: TemplateCast, env: Record<string, string | undefined> = process.env): boolean {
  return cast !== 'couple' || coupleTemplatesOpen(env);
}

/**
 * The photos a template takes. A solo template without a recipe is the classic one-selfie template.
 * A pet or couple template needs a recipe whose slots say so — the template's cast and the recipe's
 * must agree, or the template is not makeable (a mismatch is an authoring mistake, never a guess).
 */
export async function templateMakeInputs(sql: SqlRunner, template: Pick<PromptRow, 'id' | 'cast'>): Promise<CastMakeInputs | null> {
  return makeInputsFrom(template, await loadTemplateRecipe(sql, template.id));
}

/** The same rule over a recipe already loaded (null = the template has none, or none that passes). */
export function makeInputsFrom(template: Pick<PromptRow, 'cast'>, recipe: Recipe | null): CastMakeInputs | null {
  if (recipe === null) return template.cast === 'solo' ? { cast: 'solo', ...SOLO } : null;
  if (recipeCast(recipe) !== template.cast) return null;
  return { cast: template.cast, ...recipeMakeInputs(recipe) };
}

/** The extra photos a template needs besides the primary one (`render_jobs.input_key`). */
export function extraSlots(inputs: CastMakeInputs): CastSlot[] {
  // A pet-only template's ONE photo is the pet: it travels as the primary photo, not as an extra.
  const slots: CastSlot[] = [];
  if (inputs.pet && inputs.selfie) slots.push(PET_SLOT);
  if (inputs.partner) slots.push(PARTNER_SLOT);
  return slots;
}

/** True for a pet-only template: no selfie, the pet is the primary photo. */
export function petIsPrimary(inputs: CastMakeInputs): boolean {
  return inputs.pet && !inputs.selfie;
}

// ---------------------------------------------------------------------------
// the photo itself
// ---------------------------------------------------------------------------

export const SLOT_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const SLOT_PHOTO_MIN_SIDE = 256;
export const SLOT_PHOTO_MAX_SIDE = 1600;
/** The hard cap on how long a slot photo may live, whatever happens to its render (a backstop, not the rule). */
export const SLOT_PHOTO_RETENTION_DAYS = 7;
/** An order that was never paid leaves photos with no job: they go after this long. */
export const UNCLAIMED_SLOT_HOURS = 2;

export interface SlotPhoto { bytes: Uint8Array; mime: string }

/**
 * Decode the whole image, refuse animated or tiny ones, apply the EXIF orientation and strip every
 * other byte of metadata (location, device) — the same discipline as the selfie cleaner, as JPEG.
 */
export async function cleanSlotPhoto(photo: SlotPhoto): Promise<SlotPhoto> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(photo.mime) || !photo.bytes.length || photo.bytes.length > SLOT_PHOTO_MAX_BYTES) throw Error('bad_slot_photo');
  const image = sharp(photo.bytes, { limitInputPixels: 36_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1 || !meta.width || !meta.height || Math.min(meta.width, meta.height) < SLOT_PHOTO_MIN_SIDE) throw Error('bad_slot_photo');
  const data = await image.rotate().resize({ width: SLOT_PHOTO_MAX_SIDE, height: SLOT_PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  return { bytes: new Uint8Array(data), mime: 'image/jpeg' };
}

export function slotKey(renderId: string, slot: CastSlot): string {
  return `${renderId}/slot-${slot}.jpg`;
}

// ---------------------------------------------------------------------------
// storage rows (0079)
// ---------------------------------------------------------------------------

export async function slotSchemaReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(`select to_regclass('public.render_slot_inputs') is not null as ready`);
  return rows[0]?.ready === true;
}

export interface StoreSlotPhotosInput {
  renderId: string;
  userId: string;
  templateId: string;
  /** Already cleaned (`cleanSlotPhoto`). */
  photos: Partial<Record<CastSlot, SlotPhoto>>;
  /** When the uploader confirmed the partner agreed; required with a partner photo. */
  partnerConsentAt: Date | null;
  now: Date;
}

/** Write the files, then the rows. A partner photo without the confirmation is refused before anything is written. */
export async function storeSlotPhotos(sql: SqlRunner, store: RenderStore, input: StoreSlotPhotosInput): Promise<void> {
  if (input.photos.partner && input.partnerConsentAt === null) throw Error('partner_consent_required');
  const expires = new Date(input.now.getTime() + SLOT_PHOTO_RETENTION_DAYS * 86_400_000);
  for (const slot of CAST_SLOTS) {
    const photo = input.photos[slot];
    if (!photo) continue;
    const key = slotKey(input.renderId, slot);
    await store.put(key, photo.bytes, photo.mime);
    await sql.query(
      `insert into render_slot_inputs (render_id, slot, user_id, template_id, storage_key, mime, partner_consent_at, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (render_id, slot) do update set storage_key = excluded.storage_key, mime = excluded.mime,
         partner_consent_at = excluded.partner_consent_at, created_at = excluded.created_at, expires_at = excluded.expires_at, deleted_at = null`,
      [input.renderId, slot, input.userId, input.templateId, key, photo.mime, slot === PARTNER_SLOT ? input.partnerConsentAt : null, input.now, expires],
    );
  }
}

/**
 * A pet-only template's pet IS the job's input photo. Recording it here puts it under the same
 * deletion rule as every other slot photo — gone once the render is finished.
 */
export async function recordPrimaryPetPhoto(sql: SqlRunner, input: { renderId: string; userId: string; templateId: string; key: string; mime: string; now: Date }): Promise<void> {
  const expires = new Date(input.now.getTime() + SLOT_PHOTO_RETENTION_DAYS * 86_400_000);
  await sql.query(
    `insert into render_slot_inputs (render_id, slot, user_id, template_id, storage_key, mime, created_at, expires_at)
     values ($1, 'pet', $2, $3, $4, $5, $6, $7)
     on conflict (render_id, slot) do update set storage_key = excluded.storage_key, mime = excluded.mime, deleted_at = null`,
    [input.renderId, input.userId, input.templateId, input.key, input.mime, input.now, expires],
  );
}

interface SlotRow { slot: CastSlot; storage_key: string; mime: string; partner_consent_at: Date | string | null }

/** The live (not yet deleted) slot photos bound to this render id. */
export async function liveSlotRows(sql: SqlRunner, renderId: string): Promise<SlotRow[]> {
  if (!(await slotSchemaReady(sql))) return [];
  const { rows } = await sql.query<SlotRow>(
    'select slot, storage_key, mime, partner_consent_at from render_slot_inputs where render_id = $1 and deleted_at is null',
    [renderId],
  );
  return rows;
}

/** The files the recipe's user slots read (`RecipeRunContext.userSlots`). */
export async function loadSlotPhotos(sql: SqlRunner, store: RenderStore, renderId: string): Promise<Record<string, RenderPhoto & { key: string }>> {
  const out: Record<string, RenderPhoto & { key: string }> = {};
  for (const row of await liveSlotRows(sql, renderId)) {
    // The column's CHECK holds the same three types RenderPhoto names.
    out[row.slot] = { bytes: await store.read(row.storage_key), mime: row.mime as RenderPhoto['mime'], key: row.storage_key };
  }
  return out;
}

/**
 * docs/CAST-CATEGORIES.md §3 — slot photos are deleted as soon as their render is finished
 * (succeeded or failed), and in any case after `SLOT_PHOTO_RETENTION_DAYS`. Photos bound to an order
 * that never became a job go after `UNCLAIMED_SLOT_HOURS`. Runs from every render pass.
 */
export async function deleteSpentSlotPhotos(sql: SqlRunner, store: RenderStore, now: Date, limit = 50): Promise<number> {
  if (!(await slotSchemaReady(sql))) return 0;
  const { rows } = await sql.query<{ render_id: string; slot: string; storage_key: string }>(
    `select s.render_id, s.slot, s.storage_key from render_slot_inputs s
       left join render_jobs j on j.id = s.render_id
      where s.deleted_at is null
        and (s.expires_at <= $1
             or j.status in ('succeeded', 'failed')
             or (j.id is null and s.created_at <= $2))
      order by s.created_at
      limit $3`,
    [now, new Date(now.getTime() - UNCLAIMED_SLOT_HOURS * 3_600_000), limit],
  );
  let deleted = 0;
  for (const row of rows) {
    try {
      await store.delete?.(row.storage_key);
    } catch {
      // Already gone is gone; anything else retries on the next pass because the row stays live.
      continue;
    }
    await sql.query('update render_slot_inputs set deleted_at = $3 where render_id = $1 and slot = $2', [row.render_id, row.slot, now]);
    deleted += 1;
  }
  return deleted;
}
