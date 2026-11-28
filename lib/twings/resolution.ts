import type { PromptCard } from '@/lib/prompts/catalog';
import { personalMagi2OrdersOpen } from '@/lib/flags';
import { isSunraEngine, isVideoEngine } from '@/lib/images/engines';
import { arkModelForVideo, videoModelForEngine, videoResolutions } from '@/lib/video/models';
import { formatKrw, formatPrice, krwPrice } from './products';

type Env = Record<string, string | undefined>;

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

type ResolutionTemplate = Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds'>;

function supportedCreatorResolutions(template: ResolutionTemplate): CreatorResolution[] {
  if (template.medium !== 'video') return [];
  const engine = template.engine && isVideoEngine(template.engine) ? template.engine : null;
  const { model } = videoModelForEngine(engine, template.runtimeSeconds ?? 5);
  const supported = videoResolutions(model);
  return CREATOR_RESOLUTIONS.filter((resolution) => supported.includes(resolution));
}

export function is1080pOnlyTemplate(template: ResolutionTemplate): boolean {
  const supported = supportedCreatorResolutions(template);
  return supported.length === 1 && supported[0] === '1080p';
}

export function defaultCreatorResolution(template: ResolutionTemplate): CreatorResolution {
  return is1080pOnlyTemplate(template) ? '1080p' : DEFAULT_CREATOR_RESOLUTION;
}

/** A stored value (NULL on legacy, image and brand rows) as the resolution the provider gets. */
export function renderResolution(stored: string | null | undefined, template?: ResolutionTemplate): CreatorResolution {
  if (isCreatorResolution(stored)) return stored;
  return template ? defaultCreatorResolution(template) : DEFAULT_CREATOR_RESOLUTION;
}

/** The model rule lives in lib/video/models.ts now (it covers Kling and MAGI-2 too); re-exported for its old callers. */
export { arkModelForVideo };

type ResolutionPriced = Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'priceCents' | 'priceKrw' | 'price1080Cents' | 'price1080Krw'>;

/**
 * Whether this template's ENGINE may be ordered at all — the one sale gate below the price. Only an engine served by
 * the personal Sunra lane alone (MAGI-2) can say no: no order reaches that lane until the order wiring (slice M2) is
 * merged, so such a template is sold only while `TWINGS_PERSONAL_MAGI2_ORDERS` is on (lib/flags.ts
 * `personalMagi2OrdersOpen`). Closed, it offers no resolution and has no charge, so checkout answers `not_for_sale`
 * (or `bad_resolution` for a named one) and confirmation `price_changed`, before any payment; a row saved while the
 * switch was on is covered too. Every other engine, and every image: always true, and the environment is not read.
 */
export function engineOrdersOpen(template: Pick<PromptCard, 'medium' | 'engine'>, env: Env = process.env): boolean {
  if (template.medium !== 'video' || !isSunraEngine(template.engine)) return true;
  return personalMagi2OrdersOpen(env);
}

/**
 * The resolutions this template sells, 720p first (or ['1080p'] for a 1080p-only engine). Images sell none, and
 * neither does a template whose engine is not open for orders (`engineOrdersOpen`).
 */
export function offeredResolutions(template: ResolutionPriced, env: Env = process.env): CreatorResolution[] {
  if (template.medium !== 'video' || template.priceCents <= 0) return [];
  if (!engineOrdersOpen(template, env)) return [];
  const supported = supportedCreatorResolutions(template);
  if (supported.length === 1 && supported[0] === '1080p') return ['1080p'];
  const hd = supported.includes('1080p') && template.price1080Cents > 0 && template.price1080Krw > 0;
  return hd ? ['720p', '1080p'] : ['720p'];
}

export type ResolutionChoice =
  | { ok: true; resolution: CreatorResolution | null }
  | { ok: false };

/**
 * What the server accepts from a request. Empty means the engine's default; an image template takes no
 * resolution at all (NULL); anything not offered for THIS template is refused, never downgraded —
 * silently rendering 720p for someone who chose 1080p is the one outcome worse than an error.
 */
export function chooseResolution(template: ResolutionPriced, requested: string | null | undefined, env: Env = process.env): ResolutionChoice {
  const raw = (requested ?? '').trim();
  if (template.medium !== 'video') return raw === '' ? { ok: true, resolution: null } : { ok: false };
  if (raw === '') return { ok: true, resolution: defaultCreatorResolution(template) };
  if (!isCreatorResolution(raw)) return { ok: false };
  return offeredResolutions(template, env).includes(raw) ? { ok: true, resolution: raw } : { ok: false };
}

/**
 * What a job may render at once it is authorized — paid (the order's stored value), an operator's
 * free render, or brand production (none: engine default). No price gate here: the price was settled at
 * checkout, and a founder removing a 1080p price later must not break an order already paid for it.
 * Only what the engine can physically do is checked. The order switch (`engineOrdersOpen`) is a sale gate, so it is
 * deliberately not read here either: a store-credit order still meets it through `chargeKrwFor`.
 */
export function renderableResolution(template: ResolutionTemplate, requested: string | null | undefined): ResolutionChoice {
  const raw = (requested ?? '').trim();
  if (template.medium !== 'video') return raw === '' ? { ok: true, resolution: null } : { ok: false };
  if (raw === '') return { ok: true, resolution: defaultCreatorResolution(template) };
  if (!isCreatorResolution(raw)) return { ok: false };
  return supportedCreatorResolutions(template).includes(raw) ? { ok: true, resolution: raw } : { ok: false };
}

/**
 * The won amount to CHARGE for a resolution: the row's own price, never a suggestion (the checkout
 * rule since 0018). For a 1080p-only engine, the single sale price lives in `priceKrw` (the engine's
 * default resolution) and `price1080Krw` stays empty/0. `null` = not for sale at that resolution — and at every
 * resolution, a NULL (legacy) one included, while the template's engine is not open for orders (`engineOrdersOpen`).
 */
export function chargeKrwFor(template: ResolutionPriced, resolution: CreatorResolution | null, env: Env = process.env): number | null {
  if (!engineOrdersOpen(template, env)) return null;
  if (resolution === '1080p') {
    if (!offeredResolutions(template, env).includes('1080p')) return null;
    if (is1080pOnlyTemplate(template)) {
      return Number.isSafeInteger(template.priceKrw) && template.priceKrw > 0 ? template.priceKrw : null;
    }
    return Number.isSafeInteger(template.price1080Krw) && template.price1080Krw > 0 ? template.price1080Krw : null;
  }
  if (resolution === '720p' && is1080pOnlyTemplate(template)) return null;
  return Number.isSafeInteger(template.priceKrw) && template.priceKrw > 0 ? template.priceKrw : null;
}

/** The price a reader sees for a resolution, in their currency (won on a Korean page). */
export function formatResolutionPrice(template: ResolutionPriced, resolution: CreatorResolution, locale: string): string {
  if (resolution === '1080p' && !is1080pOnlyTemplate(template)) {
    return locale === 'ko' ? formatKrw(template.price1080Krw) : formatPrice(template.price1080Cents);
  }
  return locale === 'ko' ? formatKrw(krwPrice(template)) : formatPrice(template.priceCents);
}
