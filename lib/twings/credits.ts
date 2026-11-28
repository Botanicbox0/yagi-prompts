import type { PromptCard } from '@/lib/prompts/catalog';
import { estimateImageUsd, isImageEngine, isVideoEngine, resolveEngine } from '@/lib/images/engines';
import { quoteVideo, videoModelForEngine } from '@/lib/video/models';
import { defaultCreatorResolution } from './resolution';
import { baseCredits, PERSONAL_VIDEO_RESOLUTIONS, type PersonalVideoResolution } from './template-price';

/**
 * docs/PLATFORM-2.0.md §19.2 — what a template costs in credits, the one unit a template page shows
 * once subscriptions open (founder, 2026-10-29: "가격을 토큰 베이스로").
 *
 * 2026-11-02: one credit is 10원 of revenue after VAT and the store fee, and the margin sits in the
 * template (lib/twings/template-price.ts). A set is priced on all its frames together: Nano Banana 2.1
 * × 5 = 41, Seedance 2.5 10 s 720p = 345, 15 s = 517. A creative's raise on top is not here yet: the
 * page shows the base until the credit ledger carries it.
 *
 * 2026-11-05: 3-tier video resolution credit quotes (`480p` Draft = 154 cr, `720p` Standard = 345 cr,
 * `1080p` Masterpiece = 847 cr for a 10s Seedance 2.5 film).
 */

export function templateCredits(
  card: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'aspectDefault' | 'gallery'>,
  resolution?: PersonalVideoResolution
): number | null {
  const engine = resolveEngine(card.engine, card.medium);
  if (card.medium === 'image') {
    if (!isImageEngine(engine)) return null;
    const frames = Math.max(1, card.gallery?.length ?? 0);
    return baseCredits({ medium: 'image', providerUsd: estimateImageUsd(engine, 1) * frames });
  }
  if (!isVideoEngine(engine) || !card.runtimeSeconds || card.runtimeSeconds <= 0) return null;
  const resolvedResolution: PersonalVideoResolution =
    resolution ?? defaultCreatorResolution({ medium: 'video', engine, runtimeSeconds: card.runtimeSeconds });
  const { model, seconds } = videoModelForEngine(engine, card.runtimeSeconds);
  const quote = quoteVideo({ model, seconds, resolution: resolvedResolution, aspect: card.aspectDefault ?? '9:16' });
  return quote ? baseCredits({ medium: 'video', providerUsd: quote.providerUsd }) : null;
}

export function templateCreditsByResolution(
  card: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'aspectDefault' | 'gallery'>
): Partial<Record<PersonalVideoResolution, number>> | null {
  if (card.medium !== 'video' || !card.runtimeSeconds || card.runtimeSeconds <= 0) return null;
  const out: Partial<Record<PersonalVideoResolution, number>> = {};
  for (const res of PERSONAL_VIDEO_RESOLUTIONS) {
    const cr = templateCredits(card, res);
    if (cr !== null) {
      out[res] = cr;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
