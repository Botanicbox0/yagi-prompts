import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandBriefStudio } from "@/components/brand-workspace/brand-brief-studio";
import { CampaignMoatShowcase } from "@/components/brand-workspace/campaign-moat-showcase";
import {
  BRAND_AUDIO_STUDIO_PRESETS,
  BRAND_CORE_DELIVERABLE_TRACKS,
  BRAND_CREATOR_DISTRIBUTION_TIERS,
  BRAND_CREATOR_FORMAT_MODES,
  BRAND_SEEDANCE_VIDEO_TIERS,
  BRAND_STUDIO_IMAGE_MODELS,
  BRAND_UPSCALING_STUDIO_ENGINES,
  FIRST_CREATION_GOALS,
  IG_OPTIMIZED_UPSCALE_LOGIC_MODULES,
  MICRO_REGION_SELECTION_PRESETS,
  PINNED_COLOR_REFERENCES,
  PINNED_TEXTURE_REFERENCES,
  STUDIO_SPLIT_PANE_MODES,
  VIDEO_REFERENCE_TARGET_SLOTS,
  bridgeLeftImageToRightVideoReference,
  compileSunraVideoAndUpscalePlan,
  extractBrandKitFromDomain,
  findClosestSupportedAspectRatio,
} from "@/lib/brands/production/reference-studio";
import { brandRouteAllowed } from "@/lib/routing/surfaces";

describe("Brand Studio 5 Core Deliverables & 5 Image Models (12-Round Verification Suite)", () => {
  it("01. defines all 5 Core Deliverable Tracks (image, video, creator_format, creator_distribution, audio) and renders them on /brand and /brand/studio", () => {
    expect(BRAND_CORE_DELIVERABLE_TRACKS.map((t) => t.id)).toEqual([
      "image",
      "video",
      "creator_format",
      "creator_distribution",
      "audio",
    ]);

    const landingHtml = renderToStaticMarkup(
      <CampaignMoatShowcase
        locale="ko"
        organizationId="org-yagi"
        studioOpen={true}
      />,
    );
    expect(landingHtml).toContain("data-brand-five-deliverables");
    for (const track of BRAND_CORE_DELIVERABLE_TRACKS) {
      expect(landingHtml).toContain(`data-five-deliverable-card="${track.id}"`);
    }

    const studioHtml = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );
    expect(studioHtml).toContain("data-studio-core-tracks");
    for (const track of BRAND_CORE_DELIVERABLE_TRACKS) {
      expect(studioHtml).toContain(`data-core-track-tab="${track.id}"`);
    }
  });

  it("02. includes the exact 5 founder-specified image models (GPT Image 2.6, Nano Banana Pro, 2.1, 2.0, Seedream 5.0 Pro) and excludes 2.5", () => {
    expect(BRAND_STUDIO_IMAGE_MODELS.map((m) => m.id)).toEqual([
      "gpt_image_2_6",
      "nano_banana_pro",
      "nano_banana_2_1",
      "nano_banana_2_0",
      "seedream_5_0_pro",
    ]);
    expect(BRAND_STUDIO_IMAGE_MODELS.map((m) => m.nameEn)).toEqual([
      "GPT Image 2.6",
      "Nano Banana Pro",
      "Nano Banana 2.1",
      "Nano Banana 2.0",
      "Seedream 5.0 Pro",
    ]);
    const serialized = JSON.stringify(BRAND_STUDIO_IMAGE_MODELS);
    expect(serialized).not.toMatch(/2\.5/);
  });

  it("03. provides prompt formula badges, 1-line traits, 3 strength pills, 3 best deliverables, and valid B2B pricing for each of the 5 image models", () => {
    for (const model of BRAND_STUDIO_IMAGE_MODELS) {
      expect(model.promptFormulaBadgeKo.length).toBeGreaterThan(10);
      expect(model.promptFormulaBadgeEn.length).toBeGreaterThan(10);
      expect(model.shortTraitKo.length).toBeGreaterThan(15);
      expect(model.strengthsKo).toHaveLength(3);
      expect(model.bestForDeliverablesKo).toHaveLength(3);
      expect(model.creditsPer5Set).toBeGreaterThan(0);
      expect(model.priceKrwPer5Set).toBeGreaterThanOrEqual(400);
    }
  });

  it("04. verifies all 6 bespoke Sunra AI editorial reference images exist on disk (>1MB each) and pass brandRouteAllowed on brand.twings.app", () => {
    const sunraAssets = [
      "/reel/brands/slot-1-subject-editorial.jpg",
      "/reel/brands/slot-2-space-concrete-blue.jpg",
      "/reel/brands/slot-3-pose-lowangle-lookbook.jpg",
      "/reel/brands/slot-4-color-french-cobalt.jpg",
      "/reel/brands/pin-texture-35mm-grain-weave.jpg",
      "/reel/brands/swap-product-luxury-bottle.jpg",
    ];
    for (const relUrl of sunraAssets) {
      expect(brandRouteAllowed(relUrl, "GET")).toBe(true);
      const diskPath = path.join(process.cwd(), "public", relUrl);
      expect(fs.existsSync(diskPath)).toBe(true);
      const stat = fs.statSync(diskPath);
      expect(stat.size).toBeGreaterThan(1_000_000);
    }
  });

  it("05. configures Track 03 (Creator Campaign Format) with Self-Build and D+3 Studio Commission modes", () => {
    expect(BRAND_CREATOR_FORMAT_MODES.map((m) => m.id)).toEqual([
      "self_build",
      "studio_commission",
    ]);
    for (const mode of BRAND_CREATOR_FORMAT_MODES) {
      expect(mode.lockedElementsKo).toHaveLength(3);
      expect(mode.creatorInputKo.length).toBeGreaterThan(10);
    }
  });

  it("06. configures Track 04 (Creator Campaign + Distribution) with 10-Seed, 30-Growth, and 50+ Mega cohorts and D+3->D+21 timeline", () => {
    expect(BRAND_CREATOR_DISTRIBUTION_TIERS.map((t) => t.id)).toEqual([
      "seed_10",
      "growth_30",
      "mega_50_plus",
    ]);
    for (const tier of BRAND_CREATOR_DISTRIBUTION_TIERS) {
      expect(tier.timelineSummaryKo).toContain("D+3");
      expect(tier.timelineSummaryKo).toContain("D+21");
      expect(tier.includesKo).toHaveLength(3);
    }
  });

  it("07. configures Track 05 (Audio Studio) with 4 presets, Act 1 -3 dB ducking, and -14 LUFS loudness mastering", () => {
    expect(BRAND_AUDIO_STUDIO_PRESETS.map((p) => p.id)).toEqual([
      "runway_french_house",
      "clinical_minimal_pulse",
      "warm_acoustic_lounge",
      "no_bgm_live_foley",
    ]);
    expect(BRAND_AUDIO_STUDIO_PRESETS[0]!.loudnessSpec).toContain("-14.0 LUFS");
    expect(BRAND_AUDIO_STUDIO_PRESETS[0]!.duckingRuleKo).toContain("-3 dB");
  });

  it("08. maps FIRST_CREATION_GOALS across all 5 Core Deliverable Tracks and valid 5-model IDs", () => {
    const coveredTracks = new Set(FIRST_CREATION_GOALS.map((g) => g.targetTrack));
    expect(Array.from(coveredTracks).sort()).toEqual(
      ["audio", "creator_distribution", "creator_format", "image", "video"],
    );
    const validModelIds = new Set(BRAND_STUDIO_IMAGE_MODELS.map((m) => m.id));
    for (const goal of FIRST_CREATION_GOALS) {
      expect(validModelIds.has(goal.targetImageModelId)).toBe(true);
    }
  });

  it("09. ensures extractBrandKitFromDomain returns valid Pinned Color & Pinned Texture preset IDs across all categories", () => {
    const colorIds = new Set(PINNED_COLOR_REFERENCES.map((c) => c.id));
    const textureIds = new Set(PINNED_TEXTURE_REFERENCES.map((t) => t.id));
    for (const cat of [
      "fashion_apparel",
      "beauty_skincare",
      "fnb_hospitality",
      "lifestyle_object",
      "tech_platform",
    ] as const) {
      const kit = extractBrandKitFromDomain("https://www.danayad.com/shop", cat);
      expect(kit.domain).toBe("danayad.com");
      expect(kit.monogram).toBe("DA");
      expect(kit.colors).toHaveLength(5);
      expect(colorIds.has(kit.recommendedPinnedColorId)).toBe(true);
      expect(textureIds.has(kit.recommendedPinnedTextureId)).toBe(true);
    }
  });

  it.each(["ko", "en"] as const)(
    "10. renders both /brand and /brand/studio in %s with zero banned internal jargon and zero raw palette leaks",
    (locale) => {
      const html =
        renderToStaticMarkup(
          <CampaignMoatShowcase
            locale={locale}
            organizationId="org-yagi"
            studioOpen={true}
          />,
        ) +
        renderToStaticMarkup(
          <BrandBriefStudio
            organizationId="org-yagi"
            organizationName="YAGI"
            locale={locale}
            canWrite={true}
            identityConfirmed={false}
          />,
        );

      expect(html).not.toContain("#ED1E1E");
      expect(html).not.toMatch(
        /Slack|슬랙|RECIPE V2|STAGE 01|\{\{selfie\}\}|ComfyUI|Higgsfield/i,
      );
    },
  );

  it("11. enforces Morphic sandbox isolation on CampaignMoatShowcase", () => {
    const morphicHtml = renderToStaticMarkup(
      <CampaignMoatShowcase
        locale="ko"
        organizationId="d425c3b1-4066-4970-8a3b-93c52b3eef70"
        studioOpen={true}
      />,
    );
    expect(morphicHtml).toBe("");
  });

  it("12. resolves Oplux closest aspect ratios accurately across all MICRO_REGION_SELECTION_PRESETS", () => {
    const allowed = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "5:4", "4:5"]);
    for (const preset of MICRO_REGION_SELECTION_PRESETS) {
      const ratio = findClosestSupportedAspectRatio(
        preset.wPct * 20.48,
        preset.hPct * 25.6,
      );
      expect(allowed.has(ratio)).toBe(true);
    }
  });

  it("13. provides Seedance 2.5 (480p Draft, 720p Standard, 1080p Native Master) and dedicated Upscaling & Instagram Reels Optimization Studio", () => {
    expect(BRAND_SEEDANCE_VIDEO_TIERS.map((t) => t.resolution)).toEqual([
      "480p",
      "720p",
      "1080p",
    ]);
    expect(BRAND_SEEDANCE_VIDEO_TIERS[0]!.draft).toBe(true);
    expect(BRAND_SEEDANCE_VIDEO_TIERS[1]!.draft).toBe(false);
    expect(BRAND_SEEDANCE_VIDEO_TIERS[2]!.draft).toBe(false);

    expect(BRAND_UPSCALING_STUDIO_ENGINES.map((e) => e.id)).toEqual([
      "sunra_ig_1080p_upscaler",
      "seedvr2_7b_optical_upscaler",
      "sunra_cloud_4k_upscaler",
    ]);
    expect(IG_OPTIMIZED_UPSCALE_LOGIC_MODULES).toHaveLength(5);

    const plan = compileSunraVideoAndUpscalePlan({
      seedanceTierId: "seedance_2_5_720p_standard",
      upscalerEngineId: "sunra_ig_1080p_upscaler",
      targetResolution: "1080p",
      aspectRatio: "9:16",
      durationSec: 5,
      enabledIgModules: IG_OPTIMIZED_UPSCALE_LOGIC_MODULES.map((m) => m.id),
    });
    expect(plan.seedanceGeneration.sunraArgs.model).toBe("seedance-2.5");
    expect(plan.seedanceGeneration.sunraArgs.resolution).toBe("720p");
    expect(plan.upscaleStudio.ffmpegFilterChain).toContain("scale=1080:1920");
    expect(plan.upscaleStudio.ffmpegFilterChain).toContain("cas=0.25");
    expect(plan.upscaleStudio.ffmpegFilterChain).toContain("noise=c0s=3.4:c0f=t+u");

    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );
    expect(html).toContain("data-studio-seedance-tier-section");
    expect(html).toContain("data-studio-upscaling-studio");
    expect(html).toContain("data-upscale-engine-picker");
    expect(html).toContain("data-upscale-ig-logic-bar");
  });

  it("14. provides Developer-IDE Inspired Collapsible Dual Split-Pane (Left: Image <-> Right: Video) and 1-click +References bridge", () => {
    expect(STUDIO_SPLIT_PANE_MODES.map((m) => m.id)).toEqual([
      "dual_split",
      "image_only",
      "video_only",
    ]);
    expect(VIDEO_REFERENCE_TARGET_SLOTS.map((s) => s.id)).toEqual([
      "first_frame",
      "character_ref",
      "product_ref",
      "color_mood_ref",
      "end_frame",
    ]);

    const bridged = bridgeLeftImageToRightVideoReference({
      currentRefs: [],
      slotId: "first_frame",
      imageSrc: "/reel/brands/slot-1-subject-editorial.jpg",
      imageLabelKo: "컷 01 · 정면 히어로",
      imageLabelEn: "Cut 01 · Front Hero",
      sourceModelNameKo: "GPT Image 2.6",
      sourceModelNameEn: "GPT Image 2.6",
    });
    expect(bridged).toHaveLength(1);
    expect(bridged[0]!.slotId).toBe("first_frame");
    expect(bridged[0]!.citationKo).toContain("시작 프레임");

    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );
    expect(html).toContain("data-studio-split-pane-toolbar");
    expect(html).toContain('data-active-split-mode="dual_split"');
    expect(html).toContain("data-cross-pane-image-to-video-bridge");
    expect(html).toContain('data-split-pane="left-image"');
    expect(html).toContain('data-split-pane="right-video"');
    expect(html).toContain("data-video-bridged-references-tray");
    expect(html).toContain("data-video-floating-composer-dock");
  });
});
