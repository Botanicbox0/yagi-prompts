import { describe, expect, it } from 'vitest';
import { estimateImageUsd } from '@/lib/images/engines';
import { quoteVideo } from '@/lib/video/models';
import {
  baseCredits,
  baseKrw,
  canClaimFreeOnboardingImage,
  creditsToKrw,
  evaluateGlobalRenderVelocityGuard,
  FOUNDER_CREDIT_PLANS,
  GLOBAL_SUBSCRIPTION_GUARDRAILS,
  isRaise,
  makeEarning,
  NET_SHARE,
  quoteSelectiveImageSet,
  quoteVideoResolutionTiers,
  simulateMakerTemplateRevenue,
} from '@/lib/twings/template-price';
import { templateCreditsByResolution } from '@/lib/twings/credits';
import { quoteSelectiveRecipe, sliceImageSetRecipe } from '@/lib/recipes/pricing';
import { parseRecipe } from '@/lib/recipes/schema';

/** docs/PLATFORM-2.0.md §19.2 (founder, 2026-11-02): the numbers the founder agreed to, as a contract. */

const film = (seconds: number) => quoteVideo({ model: 'seedance-2.5', seconds, resolution: '720p', aspect: '9:16' })!.providerUsd;
const set = (engine: 'nano-banana-2.1' | 'seedream-5.5', n: number) => estimateImageUsd(engine, 1) * n;

describe('template price', () => {
  it('puts an image set at cost × 1.12 and a film at a 6% margin, in 10원 credits', () => {
    expect(baseCredits({ medium: 'image', providerUsd: set('nano-banana-2.1', 5) })).toBe(41);
    expect(baseCredits({ medium: 'image', providerUsd: set('seedream-5.5', 5) })).toBe(34);
    expect(baseCredits({ medium: 'image', providerUsd: 0.09 * 5 })).toBe(71);
    expect(baseCredits({ medium: 'video', providerUsd: film(10) })).toBe(345);
    expect(baseCredits({ medium: 'video', providerUsd: film(15) })).toBe(517);
  });

  it('keeps the live film prices at the lower edge of the 5~7% band', () => {
    expect(baseKrw({ medium: 'video', providerUsd: film(10) }, 'min')).toBe(3900);
    expect(baseKrw({ medium: 'video', providerUsd: film(15) }, 'min')).toBe(5900);
    expect(baseKrw({ medium: 'video', providerUsd: film(10) })).toBe(4000);
  });

  it('sells credits in won after VAT and the contract card fee, never an image under 200원', () => {
    expect(NET_SHARE).toBeCloseTo(0.8751, 4);
    expect(creditsToKrw(41, 'image')).toBe(500);
    expect(creditsToKrw(6, 'image')).toBe(200);
  });

  it('gives the creative 80% of the whole margin, and nothing on a company account', () => {
    const providerUsd = set('nano-banana-2.1', 5);
    const at1000 = makeEarning({ medium: 'image', providerUsd, priceKrw: 1000 });
    expect(at1000.creator).toBe(Math.floor(at1000.margin * 0.8));
    expect(at1000.creator).toBeGreaterThan(400);
    const raised = makeEarning({ medium: 'image', providerUsd, priceKrw: 2000 });
    expect(raised.creator).toBeGreaterThan(at1000.creator);
    expect(makeEarning({ medium: 'image', providerUsd, priceKrw: 1000, company: true })).toMatchObject({ creator: 0, platform: at1000.margin });
  });

  it('never splits a loss', () => {
    expect(makeEarning({ medium: 'video', providerUsd: film(10), priceKrw: 1000 })).toEqual({ margin: 0, creator: 0, platform: 0 });
  });

  it('takes a raise in whole hundreds from 0 to 5,000원', () => {
    expect([0, 100, 5000].every(isRaise)).toBe(true);
    expect([-100, 50, 5100, 1.5].some(isRaise)).toBe(false);
  });

  it('defines the 3-tier founder credit plans (4,900원 Image-Only 370cr / 24,900원 1,890cr / 49,000원 3,720cr)', () => {
    expect(FOUNDER_CREDIT_PLANS.image_only.priceKrw).toBe(4900);
    expect(FOUNDER_CREDIT_PLANS.image_only.monthlyCredits).toBe(370);
    expect(FOUNDER_CREDIT_PLANS.image_only.allowsVideo).toBe(false);
    expect(FOUNDER_CREDIT_PLANS.image_only.maxSingleImagesSeedream).toBe(24);
    expect(FOUNDER_CREDIT_PLANS.image_only.maxImageSetsNanoBanana).toBe(9);

    expect(FOUNDER_CREDIT_PLANS.creator.priceKrw).toBe(24900);
    expect(FOUNDER_CREDIT_PLANS.creator.monthlyCredits).toBe(1890);
    expect(FOUNDER_CREDIT_PLANS.creator.maxFilms10s720p).toBe(5);

    expect(FOUNDER_CREDIT_PLANS.premium.priceKrw).toBe(49000);
    expect(FOUNDER_CREDIT_PLANS.premium.monthlyCredits).toBe(3720);
    expect(FOUNDER_CREDIT_PLANS.premium.maxFilms10s720p).toBe(10);
    expect(FOUNDER_CREDIT_PLANS.premium.upscaleIncluded).toBe(true);
  });

  it('calculates selective frame credits and KRW proportionally when picking 1..5 shots out of a 5-shot set', () => {
    expect(estimateImageUsd('seedream-5.5', 1)).toBe(0.043);
    const seedreamUsd = 0.09; // Founder credit plan baseline benchmark ($0.09/shot → 71 cr set)
    const shot1 = quoteSelectiveImageSet({
      perFrameProviderUsd: seedreamUsd,
      totalFrames: 5,
      selectedFrameIndices: [0],
    });
    expect(shot1.selectedCount).toBe(1);
    expect(shot1.totalCredits).toBe(15);
    expect(shot1.totalKrw).toBe(200);
    expect(shot1.fullSetCredits).toBe(71);
    expect(shot1.savedCredits).toBe(56);

    const shot3 = quoteSelectiveImageSet({
      perFrameProviderUsd: seedreamUsd,
      totalFrames: 5,
      selectedFrameIndices: [0, 2, 4],
    });
    expect(shot3.selectedCount).toBe(3);
    expect(shot3.totalCredits).toBe(43);
    expect(shot3.totalKrw).toBe(500);
    expect(shot3.savedCredits).toBe(28);

    const all5 = quoteSelectiveImageSet({
      perFrameProviderUsd: seedreamUsd,
      totalFrames: 5,
      selectedFrameIndices: [0, 1, 2, 3, 4],
    });
    expect(all5.selectedCount).toBe(5);
    expect(all5.isPartialSelection).toBe(false);
    expect(all5.totalCredits).toBe(71);
    expect(all5.totalKrw).toBe(900);
    expect(all5.savedCredits).toBe(0);
  });

  it('slices a 5-frame carousel Recipe v2 down to selected frames while keeping parseRecipe valid', () => {
    const raw5Shot = {
      version: 2 as const,
      slots: { selfie: { kind: 'image' as const, source: 'user' as const, required: true, role: 'person' as const } },
      steps: [1, 2, 3, 4, 5].map((n) => ({
        id: `shot${n}`,
        kind: 'image' as const,
        engine: 'seedream-5.5',
        inputs: ['selfie'],
        prompt: `Editorial portrait shot ${n} featuring {{selfie}} in natural studio light.`,
        params: { aspect: '3:4' as const },
      })),
      output: { frames: ['shot1', 'shot2', 'shot3', 'shot4', 'shot5'] },
    };
    const parsed = parseRecipe(raw5Shot, { studio: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const sliced = sliceImageSetRecipe(parsed.recipe, [1, 3]); // 2nd and 4th shots
    const rechecked = parseRecipe(sliced, { studio: true });
    expect(rechecked.ok).toBe(true);
    expect(sliced.steps.map((s) => s.id)).toEqual(['shot2', 'shot4']);
    expect(sliced.output).toEqual({ frames: ['shot2', 'shot4'] });

    const quote2 = quoteSelectiveRecipe(parsed.recipe, [1, 3], 1000);
    expect(quote2.selectedCount).toBe(2);
    expect(quote2.baseCredits).toBe(14);
    expect(quote2.savedCredits).toBe(20);
  });

  it('simulates Maker 80% template revenue milestones accurately', () => {
    const sim = simulateMakerTemplateRevenue({
      medium: 'video',
      providerUsd: film(10),
      royaltyKrw: 1000,
    });
    expect(sim.floorKrw).toBe(4000);
    expect(sim.salePriceKrw).toBe(5000);
    expect(sim.perMake.creator).toBeGreaterThan(800);
    expect(sim.milestones.find((m) => m.makes === 100)?.creatorTotalKrw).toBe(
      sim.perMake.creator * 100
    );
  });

  it('quotes 3-tier personal video resolutions (480p Draft · 720p Standard · 1080p Masterpiece) with 55% Draft credit savings', () => {
    const multi = quoteVideoResolutionTiers({ seconds: 10, aspect: '9:16' });

    // 480p Draft: $1.03 provider cost -> 154 credits (1,800 KRW) -> saves 191 credits (55%) vs 720p
    expect(multi.tiers['480p'].tierRole).toBe('draft_preview');
    expect(multi.tiers['480p'].providerUsd).toBeCloseTo(1.03, 2);
    expect(multi.tiers['480p'].baseCredits).toBe(154);
    expect(multi.tiers['480p'].totalKrw).toBe(1800);

    // 720p Standard High-Quality: $2.31 provider cost -> 345 credits (4,000 KRW)
    expect(multi.tiers['720p'].tierRole).toBe('standard_high');
    expect(multi.tiers['720p'].providerUsd).toBeCloseTo(2.31, 2);
    expect(multi.tiers['720p'].baseCredits).toBe(345);
    expect(multi.tiers['720p'].totalKrw).toBe(4000);
    expect(multi.tiers['720p'].recommendedDefault).toBe(true);

    // 1080p Masterpiece Flagship: $5.6862 provider cost -> 847 credits (9,700 KRW)
    expect(multi.tiers['1080p'].tierRole).toBe('masterpiece_max');
    expect(multi.tiers['1080p'].providerUsd).toBeCloseTo(5.6862, 4);
    expect(multi.tiers['1080p'].baseCredits).toBe(847);
    expect(multi.tiers['1080p'].totalKrw).toBe(9700);

    expect(multi.draftWorkflow.draftSavedCreditsVs720p).toBe(191);
    expect(multi.draftWorkflow.draftSavedPercentVs720p).toBe(55);
    expect(multi.draftWorkflow.draftSavedCreditsVs1080p).toBe(693);
    expect(multi.draftWorkflow.draftThen720pTotalCredits).toBe(499);

    expect(FOUNDER_CREDIT_PLANS.creator.maxDrafts10s480p).toBe(12);
    expect(FOUNDER_CREDIT_PLANS.creator.maxFilms10s720p).toBe(5);
    expect(FOUNDER_CREDIT_PLANS.creator.maxFilms10s1080p).toBe(2);

    expect(FOUNDER_CREDIT_PLANS.premium.maxDrafts10s480p).toBe(24);
    expect(FOUNDER_CREDIT_PLANS.premium.maxFilms10s720p).toBe(10);
    expect(FOUNDER_CREDIT_PLANS.premium.maxFilms10s1080p).toBe(4);

    const cardByRes = templateCreditsByResolution({
      engine: 'seedance-2.5',
      medium: 'video',
      aspectDefault: '9:16',
      runtimeSeconds: 10,
      gallery: [],
    });
    expect(cardByRes).toEqual({
      '480p': 154,
      '720p': 345,
      '1080p': 847,
    });
  });

  it('locks in Global USD Subscription Pricing ($4.99 / $19.99 / $39.99 tax-exclusive) and anti-abuse velocity/trial guardrails', () => {
    expect(FOUNDER_CREDIT_PLANS.image_only.priceUsd).toBe(4.99);
    expect(FOUNDER_CREDIT_PLANS.image_only.netStoreRevenueUsd).toBe(4.24);
    expect(FOUNDER_CREDIT_PLANS.creator.priceUsd).toBe(19.99);
    expect(FOUNDER_CREDIT_PLANS.creator.netStoreRevenueUsd).toBe(16.99);
    expect(FOUNDER_CREDIT_PLANS.premium.priceUsd).toBe(39.99);
    expect(FOUNDER_CREDIT_PLANS.premium.netStoreRevenueUsd).toBe(33.99);

    expect(GLOBAL_SUBSCRIPTION_GUARDRAILS.unifiedGlobalCreditLedger).toBe(true);
    expect(GLOBAL_SUBSCRIPTION_GUARDRAILS.globalPricingTaxMode).toBe('tax_exclusive_usd_base');
    expect(GLOBAL_SUBSCRIPTION_GUARDRAILS.require3DSecureOnStripe).toBe(true);
    expect(GLOBAL_SUBSCRIPTION_GUARDRAILS.max1080pRendersFirst24h).toBe(2);

    // Velocity guard: blocks 3rd 1080p render within first 24h on stripe_global, recommends 720p
    const blocked1080 = evaluateGlobalRenderVelocityGuard({
      resolution: '1080p',
      channel: 'stripe_global',
      hoursSinceFirstPayment: 2,
      completed1080pCountInWindow: 2,
    });
    expect(blocked1080.allowed).toBe(false);
    expect(blocked1080.reasonCode).toBe('first_24h_1080p_velocity_cap');
    expect(blocked1080.recommendedFallbackResolution).toBe('720p');

    // Velocity guard: always allows 720p/480p or native App Store / Toss KR
    expect(
      evaluateGlobalRenderVelocityGuard({
        resolution: '720p',
        channel: 'stripe_global',
        hoursSinceFirstPayment: 2,
        completed1080pCountInWindow: 5,
      }).allowed
    ).toBe(true);
    expect(
      evaluateGlobalRenderVelocityGuard({
        resolution: '1080p',
        channel: 'app_store',
        hoursSinceFirstPayment: 1,
        completed1080pCountInWindow: 3,
      }).allowed
    ).toBe(true);

    // Free onboarding image gate: blocks unverified global web signups, allows KR carrier or mobile hardware attestation once
    expect(
      canClaimFreeOnboardingImage({
        krCarrierIdentityVerified: false,
        mobileHardwareAttested: false,
        alreadyClaimedCount: 0,
      })
    ).toBe(false);
    expect(
      canClaimFreeOnboardingImage({
        krCarrierIdentityVerified: false,
        mobileHardwareAttested: true,
        alreadyClaimedCount: 0,
      })
    ).toBe(true);
    expect(
      canClaimFreeOnboardingImage({
        krCarrierIdentityVerified: true,
        mobileHardwareAttested: true,
        alreadyClaimedCount: 1,
      })
    ).toBe(false);
  });
});
