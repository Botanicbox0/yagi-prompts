import type { PromptCard } from '@/lib/prompts/catalog';
import { estimateImageUsd, isImageEngine, resolveEngine } from '@/lib/images/engines';
import { quoteVideo, videoModelForEngine } from '@/lib/video/models';
import { baseCredits } from './template-price';

/**
 * docs/PLATFORM-2.0.md §19.2 — what a template costs in credits, the one unit a template page shows
 * once subscriptions open (founder, 2026-10-29: "가격을 토큰 베이스로").
 *
 * 2026-11-02: one credit is 10원 of revenue after VAT and the store fee, and the margin sits in the
 * template (lib/twings/template-price.ts). A set is priced on all its frames together: Nano Banana 2.1
 * × 5 = 41, Seedance 2.5 10 s 720p = 345, 15 s = 517. A creative's raise on top is not here yet: the
 * page shows the base until the credit ledger carries it.
 */

export function templateCredits(card: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'aspectDefault' | 'gallery'>): number | null {
  const engine = resolveEngine(card.engine, card.medium);
  if (card.medium === 'image') {
    if (!isImageEngine(engine)) return null;
    const frames = Math.max(1, card.gallery?.length ?? 0);
    return baseCredits({ medium: 'image', providerUsd: estimateImageUsd(engine, 1) * frames });
  }
  if (!card.runtimeSeconds || card.runtimeSeconds <= 0) return null;
  const { model, seconds } = videoModelForEngine(engine, card.runtimeSeconds);
  const quote = quoteVideo({ model, seconds, resolution: '720p', aspect: card.aspectDefault ?? '9:16' });
  return quote ? baseCredits({ medium: 'video', providerUsd: quote.providerUsd }) : null;
}
