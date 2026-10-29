import type { PromptCard } from '@/lib/prompts/catalog';
import { estimateImageUsd, isImageEngine, resolveEngine } from '@/lib/images/engines';
import { quoteVideo, videoModelForEngine } from '@/lib/video/models';

/**
 * docs/PLATFORM-2.0.md §19.2 — what a template costs in credits, the one unit a template page shows
 * (founder, 2026-10-29: "가격을 토큰 베이스로", no won or dollar on the page).
 *
 * 1 credit = 4% of a Seedance 2.5 10-second 720p film at the provider's list price — four of the
 * internal units in `lib/twings/subscription-plan.ts` (1% each). A film is its list price in units,
 * rounded up, then in credits, rounded up: 10 s 720p = 25, 15 s = 38, 10 s 1080p = 62. A picture is
 * one credit per frame at least. The maker's own credits on top (§19.3) are not here yet: their
 * unit and cap are still the founder's decision (§19.10).
 */

export const UNITS_PER_CREDIT = 4;
const BASE_USD = quoteVideo({ model: 'seedance-2.5', seconds: 10, resolution: '720p', aspect: '9:16' })!.providerUsd;
const CREDIT_USD = BASE_USD * UNITS_PER_CREDIT / 100;

function creditsFor(usd: number): number {
  // Units first (as the subscription plan counts them), then credits; only float noise is shaved.
  const units = Math.ceil(usd / BASE_USD * 100 - 1e-9);
  return Math.max(1, Math.ceil(units / UNITS_PER_CREDIT - 1e-9));
}

export function templateCredits(card: Pick<PromptCard, 'medium' | 'engine' | 'runtimeSeconds' | 'aspectDefault' | 'gallery'>): number | null {
  const engine = resolveEngine(card.engine, card.medium);
  if (card.medium === 'image') {
    const frames = Math.max(1, card.gallery?.length ?? 0);
    const perFrame = isImageEngine(engine) ? Math.max(1, Math.ceil(estimateImageUsd(engine, 1) / CREDIT_USD - 1e-9)) : 1;
    return frames * perFrame;
  }
  if (!card.runtimeSeconds || card.runtimeSeconds <= 0) return null;
  const { model, seconds } = videoModelForEngine(engine, card.runtimeSeconds);
  const quote = quoteVideo({ model, seconds, resolution: '720p', aspect: card.aspectDefault ?? '9:16' });
  return quote ? creditsFor(quote.providerUsd) : null;
}
