import type { PromptCard } from '@/lib/prompts/catalog';
import { arkModelForVideo, videoModelForEngine, videoResolutions } from '@/lib/video/models';
import { formatKrw, formatPrice, krwPrice } from './products';

/**
 * Creator video resolution (docs/CREATOR-RESOLUTION.md) — the one place that decides which
 * resolutions a creator may buy, what each one costs, and what the provider is asked for.
 *
 * The rule: a creator film renders at 720p. 1080p is an explicit choice with its own price, and it
 * is offered only when (a) the template's engine can render 1080p and (b) the founder has set a
 * 1080p price on the row (`price_1080_cents` AND `price_1080_krw`, migration 0039). A template's
 * published example being 1080p changes neither: the example is the studio's, the default is 720p.
 *
 * Money never comes from the browser. The browser names a resolution; the server looks up the
 * price for that resolution on the template row, stores it on the order, and the confirm step
 * re-derives it and refuses a mismatch (`price_changed`). Brand production and images carry no
 * resolution (NULL), which the render pass reads as 720p — exactly what they rendered at before.
 */

export const CREATOR_RESOLUTIONS = ['720p', '1080p'] as const;
export type CreatorResolution = (typeof CREATOR_RESOLUTIONS)[number];
export const DEFAULT_CREATOR_RESOLUTION: CreatorResolution = '720p';

export function isCreatorResolution(value: unknown): value is CreatorResolution {
  return typeof value === 'string' && (CREATOR_RESOLUTIONS as readonly string[]).includes(value);
}

/** A stored value (NULL on legacy, image and brand rows) as the resolution the provider gets. */
export function renderResolution(stored: string | null | undefined): CreatorResolution {
  return isCreatorResolution(stored) ? stored : DEFAULT_CREATOR_RESOLUTION;
}

/** The model rule lives in lib/video/models.ts now (it covers Kling too); re-exported for its old callers. */
export { arkModelForVideo };

type ResolutionPriced = Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'priceCents' | 'priceKrw' | 'price1080Cents' | 'price1080Krw'>;

/** The resolutions this template sells, 720p first. Images sell none (their size is the engine's). */
export function offeredResolutions(template: ResolutionPriced): CreatorResolution[] {
  if (template.medium !== 'video' || template.priceCents <= 0) return [];
  const { model } = videoModelForEngine(template.engine, template.runtimeSeconds ?? 5);
  const hd = videoResolutions(model).includes('1080p') && template.price1080Cents > 0 && template.price1080Krw > 0;
  return hd ? ['720p', '1080p'] : ['720p'];
}

export type ResolutionChoice =
  | { ok: true; resolution: CreatorResolution | null }
  | { ok: false };

/**
 * What the server accepts from a request. Empty means the default; an image template takes no
 * resolution at all (NULL); anything not offered for THIS template is refused, never downgraded —
 * silently rendering 720p for someone who chose 1080p is the one outcome worse than an error.
 */
export function chooseResolution(template: ResolutionPriced, requested: string | null | undefined): ResolutionChoice {
  const raw = (requested ?? '').trim();
  if (template.medium !== 'video') return raw === '' ? { ok: true, resolution: null } : { ok: false };
  if (raw === '') return { ok: true, resolution: DEFAULT_CREATOR_RESOLUTION };
  if (!isCreatorResolution(raw)) return { ok: false };
  return offeredResolutions(template).includes(raw) ? { ok: true, resolution: raw } : { ok: false };
}

/**
 * What a job may render at once it is authorized — paid (the order's stored value), an operator's
 * free render, or brand production (none: 720p). No price gate here: the price was settled at
 * checkout, and a founder removing a 1080p price later must not break an order already paid for it.
 * Only what the engine can physically do is checked.
 */
export function renderableResolution(template: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds'>, requested: string | null | undefined): ResolutionChoice {
  const raw = (requested ?? '').trim();
  if (template.medium !== 'video') return raw === '' ? { ok: true, resolution: null } : { ok: false };
  if (raw === '') return { ok: true, resolution: DEFAULT_CREATOR_RESOLUTION };
  if (!isCreatorResolution(raw)) return { ok: false };
  const { model } = videoModelForEngine(template.engine, template.runtimeSeconds ?? 5);
  return videoResolutions(model).includes(raw) ? { ok: true, resolution: raw } : { ok: false };
}

/**
 * The won amount to CHARGE for a resolution: the row's own price, never a suggestion (the checkout
 * rule since 0018). `null` = not for sale at that resolution. A NULL stored resolution (legacy order,
 * image) is the base price — so an order made before 0039 confirms against exactly what it did.
 */
export function chargeKrwFor(template: ResolutionPriced, resolution: CreatorResolution | null): number | null {
  if (resolution === '1080p') {
    if (!offeredResolutions(template).includes('1080p')) return null;
    return Number.isSafeInteger(template.price1080Krw) && template.price1080Krw > 0 ? template.price1080Krw : null;
  }
  return Number.isSafeInteger(template.priceKrw) && template.priceKrw > 0 ? template.priceKrw : null;
}

/** The price a reader sees for a resolution, in their currency (won on a Korean page). */
export function formatResolutionPrice(template: ResolutionPriced, resolution: CreatorResolution, locale: string): string {
  if (resolution === '1080p') return locale === 'ko' ? formatKrw(template.price1080Krw) : formatPrice(template.price1080Cents);
  return locale === 'ko' ? formatKrw(krwPrice(template)) : formatPrice(template.priceCents);
}
