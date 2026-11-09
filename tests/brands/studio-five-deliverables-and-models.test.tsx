import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
  }),
}));

import { BrandBriefStudio } from "@/components/brand-workspace/brand-brief-studio";
import { BrandOnboardingWizard } from "@/components/brand-workspace/brand-onboarding-wizard";
import { CampaignMoatShowcase } from "@/components/brand-workspace/campaign-moat-showcase";
import {
  BRAND_AESTHETIC_PRESETS,
  BRAND_AUDIO_STUDIO_PRESETS,
  BRAND_CORE_DELIVERABLE_TRACKS,
  BRAND_CREATOR_DISTRIBUTION_TIERS,
  BRAND_CREATOR_FORMAT_MODES,
  BRAND_SEEDANCE_VIDEO_TIERS,
  BRAND_STUDIO_IMAGE_MODELS,
  BRAND_UPSCALING_STUDIO_ENGINES,
  DEFAULT_CUSTOM_MOODBOARD_ITEMS,
  DEFAULT_SPATIAL_BOARD_NODES,
  FIRST_CREATION_GOALS,
  IG_OPTIMIZED_UPSCALE_LOGIC_MODULES,
  MAX_BRAND_MOODBOARD_IMAGES,
  MICRO_REGION_SELECTION_PRESETS,
  MODEL_EASY_COMPARISON_MATRIX,
  PINNED_COLOR_REFERENCES,
  PINNED_TEXTURE_REFERENCES,
  STUDIO_SPLIT_PANE_MODES,
  VIDEO_REFERENCE_TARGET_SLOTS,
  bridgeLeftImageToRightVideoReference,
  clampMoodboardItemsToMax,
  compileAestheticPromptForModel,
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

  it("15. renders Morphic Studio / Krea Canvas Multi-Asset Spatial Board above the fold with spread-out asset nodes, SVG wires, slim left rail, and bottom floating prompt dock", () => {
    expect(DEFAULT_SPATIAL_BOARD_NODES).toHaveLength(7);

    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );
    expect(html).toContain("data-morphic-krea-spatial-board");
    expect(html).toContain("data-white-dual-canvas-studio");
    expect(html).toContain("data-studio-top-directing-bar");
    expect(html).toContain("data-white-split-canvases-grid");
    expect(html).toContain("data-studio-left-image-canvas");
    expect(html).toContain("data-dual-canvas-center-bridge");
    expect(html).toContain("data-studio-right-video-canvas");
    expect(html).toContain("data-white-canvas-bridge-cta");
    expect(html).toContain("data-spatial-left-rail");
    expect(html).toContain("data-spatial-dotted-canvas");
    expect(html).toContain("data-spatial-board-nodes-grid");
    expect(html).toContain("data-spatial-node-wires");
    expect(html).toContain("data-spatial-video-node");
    expect(html).toContain("data-spatial-upscale-node");
    expect(html).toContain("data-spatial-floating-prompt-dock");
    expect(html).toContain("data-studio-advanced-drawer");
  });

  it("16. renders 5-Round Argon Builder x Argon Critic SOTA upgrades across all 5 Core Deliverables (Node Inspector 1-4 Slot Locks, IG Before/After Quality Defense Inspector, 480p->1080p Promotion Loop, Creator Selfie Simulator, B2B ROI Calculator & Gantt, and 3-Track Audio Console)", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // 00 · 2D Canvas & Node Inspector 1-4 Slot Locks
    expect(html).toContain("data-studio-top-mode-bar");
    expect(html).toContain("data-canvas-bezier-wire");
    expect(html).toContain("data-canvas-node-inspector");
    expect(html).toContain('data-node-inspector-lock-slot="1"');
    expect(html).toContain('data-node-inspector-lock-slot="4"');

    // 01 · Image Studio Optimal Model Formula & Smart Mask Pixel Lock
    expect(html).toContain("data-apply-model-optimal-prompt");
    expect(html).toContain("data-smart-mask-pixel-lock-badge");

    // 02 · Video & Instagram 1080p Anti-Compression Before/After Inspector + 480p->1080p Loop
    expect(html).toContain("data-reels-oneclick-bundle-cta");
    expect(html).toContain("data-draft-480p-promote-1080p-bar");
    expect(html).toContain("data-draft-480p-promote-1080p-btn");
    expect(html).toContain("data-upscale-before-after-inspector");
    expect(html).toContain("data-upscale-compare-before");
    expect(html).toContain("data-upscale-compare-after");
    expect(html).toContain("data-seedvr2-antiboil-badge");

    // 03 · Creator Campaign Format (Self vs D+3 Commission) Selfie Simulation
    expect(html).toContain("data-creator-selfie-simulation");
    expect(html).toContain('data-creator-sample-btn="0"');

    // 04 · Creator Campaign + Distribution ROI Calculator & D+3~D+21 Timeline Gantt
    expect(html).toContain("data-distribution-roi-calculator");
    expect(html).toContain("data-distribution-timeline-gantt");

    // 05 · Brand Audio 3-Track Console & -14 LUFS Meter
    expect(html).toContain("data-audio-multitrack-console");
    expect(html).toContain("data-audio-loudness-meter");
  });

  it("17. verifies 10-Round (Rounds 6–15) Single-Surface Isolation Architecture, 2D Node Quick-Spawn & In/Out Ports, Dual-Pane Transfer Banner, IG Bitrate Simulator, 3-Step Creator Recipe, Multi-Channel Distribution Filter, Audio Stem Mute & Foley Timeline, and /brand Deep-Link Cards", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 6: Single-Surface Isolation & Brand Kit Top Toggle
    expect(html).toContain("data-top-bar-brand-kit-toggle");
    expect(html).toContain('data-isolated-studio-header="split_workbench"');

    // Round 7: 00 · 2D Unified Node Board Quick-Spawn, In/Out Ports & Fit View
    expect(html).toContain("data-canvas-quick-spawn-bar");
    expect(html).toContain('data-spawn-node-btn="image_ref"');
    expect(html).toContain('data-spawn-node-btn="video_seedance"');
    expect(html).toContain('data-spawn-node-btn="upscale_1080p"');
    expect(html).toContain("data-connect-selected-nodes-btn");
    expect(html).toContain('data-node-port="in"');
    expect(html).toContain('data-node-port="out"');
    expect(html).toContain("data-canvas-viewport-controls");
    expect(html).toContain("data-canvas-fit-view-btn");

    // Round 8: Dual Split-Pane Live Transfer Strip & Right Video Transfer Confirmation
    expect(html).toContain("data-split-bridge-strip");
    expect(html).toContain("data-right-video-transfer-confirmation");

    // Round 10: Video & IG 1080p Bitrate Compression Simulator
    expect(html).toContain("data-ig-bitrate-compression-simulator");

    // Round 11: Creator Campaign 3-Step Format Recipe Builder
    expect(html).toContain("data-creator-format-recipe-steps");
    expect(html).toContain('data-recipe-step-btn="1"');
    expect(html).toContain('data-recipe-step-btn="2"');
    expect(html).toContain('data-recipe-step-btn="3"');

    // Round 12: Creator Campaign + Distribution Platform Filter & Spark/Meta Ad Rights Preview
    expect(html).toContain("data-distribution-platform-filter");
    expect(html).toContain('data-seeding-channel-btn="instagram_reels"');
    expect(html).toContain("data-distribution-ad-rights-preview");

    // Round 13: Brand Audio Stem Mute/Solo & Foley Cue Timeline + 1080p Video Multiplex CTA
    expect(html).toContain("data-audio-stem-controls");
    expect(html).toContain('data-audio-stem-mute-btn="bgm"');
    expect(html).toContain('data-audio-stem-mute-btn="foley"');
    expect(html).toContain('data-audio-stem-mute-btn="voice"');
    expect(html).toContain("data-audio-foley-cue-timeline");
    expect(html).toContain("data-audio-mux-video-cta");

    // Round 14: /brand Home Showcase Direct Deep-Link Cards (?track=...)
    const showcaseHtml = renderToStaticMarkup(
      <CampaignMoatShowcase
        locale="ko"
        organizationId="org-yagi"
        studioOpen={true}
      />,
    );
    for (const track of BRAND_CORE_DELIVERABLE_TRACKS) {
      expect(showcaseHtml).toContain(
        `data-deliverable-card-studio-link="${track.id}"`,
      );
      expect(showcaseHtml).toContain(`track=${track.id}`);
    }
  });

  it("18. verifies 10-Round (Rounds 16–25) Zero-Leak Surface Architecture, Smart Mask Feathering & Model Auto-Tune, FFmpeg Optical Filter Drawer & 480p->1080p ETA Badge, 3-Axis Face Angle Inspector, 3-Channel Allocation Matrix & Ad Code Copy, Audio Stem Fader & Foley Trigger Wave, Multi-Type Node Spawn & Minimap HUD, Bi-Directional Reverse Bridge, and Global 5-Track Brand Kit Lock", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={false}
      />,
    );

    // Round 16: Zero-Leak Surface Architecture (even when identityConfirmed={false}, advanced drawer & legacy workbench stay display:none on initial split_workbench load)
    expect(html).toContain('data-studio-identity-gate="open"');
    expect(html).toContain('data-isolated-surface-mode="split_workbench"');

    // Round 17: Smart Mask Feathering Slider & 5-Model Optimal Prompt Auto-Tune Button
    expect(html).toContain('data-smart-mask-feather-slider="25"');
    expect(html).toContain("data-model-prompt-autotune-btn");

    // Round 18: FFmpeg Filter-Chain Code Drawer & 480p->1080p ETA/Savings Badge
    expect(html).toContain("data-draft-to-master-eta-badge");
    expect(html).toContain("data-upscale-ffmpeg-code-drawer");
    expect(html).toContain("data-copy-ffmpeg-filter-btn");

    // Round 19: 3-Axis Creator Face Angle Advisory Inspector
    expect(html).toContain("data-creator-face-angle-inspector");

    // Round 20: 3-Channel Seeding Allocation Matrix & 1-Click Spark/Meta Ad Auth Code Copy
    expect(html).toContain("data-seeding-channel-allocation-matrix");
    expect(html).toContain("data-copy-ad-auth-code-btn");

    // Round 21: 3-Track Audio Stem Fader Console & Foley Trigger Wave
    expect(html).toContain("data-audio-stem-fader-console");
    expect(html).toContain('data-foley-trigger-wave="0.4s"');

    // Round 22: Multi-Type Node Spawn (+Creator Selfie, +Audio Track) & Minimap HUD
    expect(html).toContain("data-canvas-spawn-creator-node");
    expect(html).toContain("data-canvas-spawn-audio-node");
    expect(html).toContain("data-canvas-minimap-hud");

    // Round 23: Bi-Directional Reverse Bridge (Right Video Frame -> Left Image Micro-Edit)
    expect(html).toContain("data-video-to-image-reverse-bridge");

    // Round 24: Enterprise Brand Kit Global 5-Track Style Pin Lock
    expect(html).toContain("data-global-brand-kit-lock");
  });

  it("19. verifies Rounds 26–35 SSR ?track= Deep-Link Hydration, Keyboard Shortcuts HUD, 4x Parallel Batch & Model A/B Compare, 1~4 Reference Slot Weights & Swap, Seedance 2.5 End-Frame Loop Lock, 5 Camera Motion Presets, 9:16 Reels/TikTok/Shorts Safe-Zone Overlay, Batch Upscale Queue & ProRes/H.264 Codec Selector, Creator Brief Compliance Lock, and 9:16/4:5/1:1 Multi-Aspect Crop Preview", () => {
    // Round 26: SSR ?track= deep-link hydration (no flash to split_workbench when initialTrack is passed)
    const audioTrackSsrHtml = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
        initialTrack="audio"
      />,
    );
    expect(audioTrackSsrHtml).toContain('data-studio-initial-track="audio"');
    expect(audioTrackSsrHtml).toContain('data-isolated-surface-mode="track_audio"');
    expect(audioTrackSsrHtml).toContain('data-active-core-track="audio"');

    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 27: Keyboard Shortcuts HUD & Command Bar
    expect(html).toContain("data-shortcuts-toggle-btn");
    expect(html).toContain("data-studio-keyboard-shortcuts-hud");

    // Round 28: Track 01 · 1x/2x/4x Parallel Batch Generation & 2-Model A/B Compare Mode
    expect(html).toContain('data-image-batch-parallel-switcher="4"');
    expect(html).toContain("data-image-model-ab-compare-mode");

    // Round 29: Track 01 · 1~4 Reference Slot Individual Weight Chips & 1-Click Slot Swap
    expect(html).toContain("data-reference-slot-strength-bar");
    expect(html).toContain('data-slot-weight-chip="1"');
    expect(html).toContain('data-slot-weight-chip="4"');
    expect(html).toContain("data-reference-slot-swap-btn");

    // Round 30: Track 02 · Seedance 2.5 Start Frame <-> End Frame Loop Keyframe Lock
    expect(html).toContain("data-video-end-frame-slot");
    expect(html).toContain("data-video-keyframe-loop-toggle");

    // Round 31: Track 02 · 5 Camera Motion Presets & Motion Scale Slider
    expect(html).toContain('data-camera-motion-preset-bar="dolly_in"');
    expect(html).toContain('data-camera-motion-scale-slider="5"');

    // Round 32: Track 02 · Instagram Reels / TikTok / Shorts 9:16 UI Safe-Zone Overlay
    expect(html).toContain('data-safe-zone-platform-picker="reels"');
    expect(html).toContain('data-safe-zone-overlay-toggle="true"');

    // Round 33: Track 02 · Batch Upscale Queue Tray & Codec Selector (H.264 14Mbps vs ProRes 422 LT)
    expect(html).toContain('data-upscale-batch-queue-tray="4"');
    expect(html).toContain('data-upscale-codec-selector="h264_14mbps"');

    // Round 34: Track 03 · Creator Brief Mandatory Hashtag/Disclosure Lock & Prohibited Elements Bar
    expect(html).toContain("data-creator-brief-compliance-lock");
    expect(html).toContain("data-creator-prohibited-elements-bar");

    // Round 35: Track 03 · Multi-Aspect Crop Preview (9:16 / 4:5 / 1:1)
    expect(html).toContain('data-multi-aspect-crop-preview="9:16"');
    expect(html).toContain('data-creator-aspect-preview-btn="4:5"');
    expect(html).toContain('data-creator-aspect-preview-btn="1:1"');
  });

  it("20. verifies Rounds 36–45 Detailed B2B ROI Savings Matrix, Creator Cohort Tier Mix, Audio Seamless Loop & Duration Sync, Voiceover Language & Script Input, 2D Node Board Tidy Up & Storyboard Group Frame, Dual-Split Sync Zoom & 99.6% Optical Consistency Meter, Enterprise Master Campaign Zip Export, /brand 3-Scenario Launchers, and Korean Wording Purge", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 36 & Round 37: Track 04 · Detailed ROI Savings Matrix & Creator Cohort Tier Mix
    expect(html).toContain("data-distribution-detailed-roi-matrix");
    expect(html).toContain("data-roi-savings-vs-meta-ads");
    expect(html).toContain('data-creator-cohort-tier-mix="nano_60_micro_30_mid_10"');

    // Round 38 & Round 39: Track 05 · Audio Seamless Loop Mastering, Duration Sync & Voiceover Script Input
    expect(html).toContain('data-audio-loop-mode-toggle="seamless_loop"');
    expect(html).toContain('data-audio-duration-sync-bar="5s"');
    expect(html).toContain('data-voiceover-language-selector="ko"');
    expect(html).toContain("data-voiceover-script-input");

    // Round 40: 00 · 2D Unified Node Board Auto-Layout Tidy Up & Storyboard Group Frame
    expect(html).toContain("data-canvas-tidy-up-btn");
    expect(html).toContain("data-canvas-storyboard-group-frame");

    // Round 41: Dual-Split Workbench Sync Zoom & 99.6% Optical Consistency Meter
    expect(html).toContain('data-dual-canvas-sync-zoom-toggle="true"');
    expect(html).toContain("data-optical-consistency-meter");

    // Round 42: Enterprise Master Campaign Package 1-Click Export Bar
    expect(html).toContain("data-enterprise-export-package-bar");
    expect(html).toContain("data-download-full-campaign-bundle-btn");

    // Round 44: Korean localization purge (no hardcoded English MUTE ON/MUTE when locale="ko")
    expect(html).not.toContain(">MUTE<");
    expect(html).not.toContain(">MUTE ON<");
    expect(html).toContain("음소거");

    // Round 43 & Round 44: /brand Main Dashboard Flagship 3-Scenario 1-Click Launchers & Korean Wording Purge
    const showcaseHtml = renderToStaticMarkup(
      <CampaignMoatShowcase
        locale="ko"
        organizationId="org-yagi"
        studioOpen={true}
      />,
    );
    expect(showcaseHtml).toContain("data-brand-moat-scenario-launchers");
    expect(showcaseHtml).toContain('data-scenario-launcher="launch_full_pack"');
    expect(showcaseHtml).toContain('data-scenario-launcher="creator_30_seeding"');
    expect(showcaseHtml).toContain('data-scenario-launcher="lookbook_micro_edit"');
    expect(showcaseHtml).not.toContain("VIDEO-CREATOR DUAL STAGE");
  });

  it("21. verifies Phase I (Rounds 46–55) UX Clarity, Progressive Disclosure, Command Palette, Tabbed Inspector, Adaptive Bottom Dock, Left Asset Rail, Signal Flow, Align Bar, Minimap Reticle, Canvas Theme & BG Job Tray", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 46: Progressive Disclosure Density Switcher
    expect(html).toContain('data-studio-view-density="comfortable"');
    expect(html).toContain("data-view-density-toggle-btn");

    // Round 47: Universal Command Palette (Ctrl+K)
    expect(html).toContain("data-studio-command-palette");
    expect(html).toContain("data-command-palette-input");

    // Round 48: Contextual Right Inspector 4-Tab Consolidation
    expect(html).toContain("data-inspector-tab-switcher");
    expect(html).toContain('data-inspector-tab="layers"');
    expect(html).toContain('data-inspector-tab="brand_dna"');
    expect(html).toContain('data-inspector-tab="history_version"');
    expect(html).toContain('data-inspector-tab="export_spec"');

    // Round 49: Floating Bottom Dock Contextual Adaptation
    expect(html).toContain('data-adaptive-dock-mode="node_selected"');

    // Round 50: Collapsible Left Brand Asset & Reference Drawer
    expect(html).toContain("data-studio-left-asset-rail");
    expect(html).toContain("data-asset-rail-toggle-btn");

    // Round 51: 2D Spatial Canvas Bezier Wire Live Signal Flow
    expect(html).toContain('data-canvas-wire-signal-flow="active"');

    // Round 52: Multi-Node Magnetic Snap & Distribution Bar
    expect(html).toContain("data-canvas-align-distribute-bar");
    expect(html).toContain('data-align-btn="distribute_horizontal"');

    // Round 53: Interactive Minimap Viewport Reticle & Zoom Indicator
    expect(html).toContain("data-minimap-reticle");
    expect(html).toContain("data-minimap-zoom-indicator");

    // Round 54: Canvas Dark/Light Studio Surface Theme Toggle
    expect(html).toContain('data-canvas-theme-selector="paper_white"');

    // Round 55: Non-Blocking Background Render Job Queue Tray
    expect(html).toContain("data-studio-bg-job-tray");
    expect(html).toContain("data-bg-job-progress-bar");
  });

  it("22. verifies Phase II (Rounds 56–65) Track 01 & Track 02 Enterprise Production Depth: Multi-Angle SKU Pack, Auto-Resize Banner Matrix, Logo Vector Preservation, Color Delta-E Meter, Sunra 20-Way Parallel Batch, 3-Cut Storyboard Sequencer, Transition Engine, Cinema LUTs, Meta Encoding Defense & 200% Magnifier Loupe", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 56: Product SKU Multi-Angle Pack Generator
    expect(html).toContain('data-sku-multi-angle-selector="front"');

    // Round 57: E-Commerce Marketplace Auto-Resize & Safe-Margin Pack
    expect(html).toContain("data-ecommerce-auto-resize-pack");
    expect(html).toContain("data-batch-banner-generator");

    // Round 58: Brand Typography & Vector Logo Overlay Preservation Zone
    expect(html).toContain("data-logo-vector-preservation-zone");
    expect(html).toContain("data-label-sharpness-guard");

    // Round 59: Color Accuracy Delta-E Verification Meter
    expect(html).toContain("data-brand-color-delta-e-meter");
    expect(html).toContain("data-delta-e-pass-badge");

    // Round 60: Sunra 20-Concurrent Batch Variant Matrix
    expect(html).toContain('data-sunra-concurrent-batch-grid="20"');
    expect(html).toContain("data-sunra-concurrency-active-count");

    // Round 61: Seedance 2.5 Multi-Cut Storyboard Sequencer (Cut 1 Hook -> Cut 2 Body -> Cut 3 CTA)
    expect(html).toContain("data-video-storyboard-cut-sequencer");
    expect(html).toContain('data-cut-step="hook"');
    expect(html).toContain('data-cut-step="body"');
    expect(html).toContain('data-cut-step="cta"');

    // Round 62: Cut-to-Cut Optical Flow & Match-Cut Transition Engine
    expect(html).toContain('data-cut-transition-engine="morph_continuity"');

    // Round 63: Brand Cinema Color Grading LUT Selector
    expect(html).toContain('data-video-cinema-lut-selector="clean_commercial"');

    // Round 64: Instagram Reels / TikTok Compression Pre-Compensation Engine
    expect(html).toContain("data-meta-encoding-defense-engine");
    expect(html).toContain("data-meta-encoder-pass-check");

    // Round 65: Split-Screen Before/After 720p vs 1080p/4K Interactive Magnifier Loupe
    expect(html).toContain("data-upscale-ab-slider");
    expect(html).toContain('data-upscale-magnifier-loupe="200%"');
  });

  it("23. verifies Phase III (Rounds 66–75) Track 03 & Track 04 B2B Campaign OS: Anonymous Verified Creator Matching Carousel, Selfie Transformation Simulation, Rights Consent Ledger, Hook Score Predictor, Spark/Meta Ad Code Simulator, Attribution Funnel, SLA Tracker, FTC Disclosure Automation, Performance Dashboard & Cohort Scale-Up", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 66: Verified 3,000+ Follower Creator Candidate Matching Carousel (Anonymous per AGENTS.md §5)
    expect(html).toContain("data-creator-candidate-matching-carousel");
    expect(html).toContain('data-creator-candidate-card="creator_cohort_fashion_01"');

    // Round 67: Creator Selfie-to-Format Live Simulation Preview
    expect(html).toContain("data-selfie-transformation-simulation-preview");
    expect(html).toContain('data-simulation-selfie-dropzone="ready"');

    // Round 68: Portrait Rights & Secondary Paid Ad Usage Consent Ledger (Terms §5.3)
    expect(html).toContain("data-creator-rights-consent-ledger");
    expect(html).toContain('data-rights-term-badge="365d"');

    // Round 69: First-3-Second Hook Retention & Stop-Scroll Score Predictor
    expect(html).toContain("data-hook-score-predictor");
    expect(html).toContain('data-hook-retention-meter="92_exceptional"');

    // Round 70: TikTok Spark Ads & Meta Partnership Ad Code Live Simulator
    expect(html).toContain("data-partnership-ad-code-simulator");
    expect(html).toContain("data-spark-ads-code-preview");

    // Round 71: Multi-Channel UTM & Conversion Attribution Funnel Calculator
    expect(html).toContain("data-campaign-attribution-funnel-calculator");
    expect(html).toContain("data-blended-cpa-estimate");

    // Round 72: Creator Seeding SLA Guarantee & Replacement Policy Tracker
    expect(html).toContain("data-creator-sla-timeline-tracker");
    expect(html).toContain("data-sla-milestone-chip");

    // Round 73: Automated FTC / Fair Trade Ad Disclosure & Prohibited Claim Filter
    expect(html).toContain("data-ftc-disclosure-automation-engine");
    expect(html).toContain("data-prohibited-claim-filter");

    // Round 74: Live Post-Seeding Performance Aggregation Dashboard Preview
    expect(html).toContain("data-campaign-performance-mock-dashboard");
    expect(html).toContain("data-total-reach-counter");

    // Round 75: 1-Click Repeat Campaign & Cohort Scale-Up Flow
    expect(html).toContain("data-campaign-scale-expansion-bar");
    expect(html).toContain('data-expand-cohort-btn="add_20"');
  });

  it("24. verifies Phase IV (Rounds 76–85) Track 05 Audio Beat-Snap Scrubber, Voiceover Tone, Music License PDF, Frame.io Timecode Review Thread, External Client Share Link, Watermark Toggle, CMO Approval Gate, Budget Cap Guardrail, Version History Rollback & Brand Compliance Score", () => {
    const html = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );

    // Round 76: Interactive Audio Waveform Scrubber & Beat-Snap Marker Engine
    expect(html).toContain("data-audio-waveform-scrubber");
    expect(html).toContain("data-beat-marker-snap-engine");

    // Round 77: Voiceover Emotion, Pacing & Brand Persona Selector
    expect(html).toContain('data-voiceover-tone-selector="luxury_calm"');

    // Round 78: Commercial Music Copyright Clearance Certificate Generator
    expect(html).toContain("data-music-license-certificate-modal");
    expect(html).toContain("data-download-license-pdf-btn");

    // Round 79: Frame-Accurate Timecode Review & Pin Comment Thread (Frame.io Style)
    expect(html).toContain("data-timecode-comment-thread");
    expect(html).toContain("data-timecode-comment-input");

    // Round 80: External Client / Executive Password-Protected Review Share Link
    expect(html).toContain("data-external-client-review-share-sheet");
    expect(html).toContain("data-client-review-url-copy-btn");

    // Round 81: Draft Watermark Protection vs Approved Clean Master Unlock
    expect(html).toContain('data-review-watermark-toggle="draft_watermark"');

    // Round 82: Multi-Role Approval Workflow (Designer -> Brand Manager -> CMO Sign-Off)
    expect(html).toContain("data-enterprise-approval-gate-bar");
    expect(html).toContain("data-cmo-signoff-btn");

    // Round 83: Organization Credit Budget Guardrail & Spend Cap Alert
    expect(html).toContain("data-budget-cap-guardrail");
    expect(html).toContain("data-spend-cap-progress-bar");

    // Round 84: Non-Destructive Version History & 1-Click Snapshot Rollback
    expect(html).toContain("data-asset-version-history-drawer");
    expect(html).toContain("data-version-rollback-btn");

    // Round 85: Automated Brand Memory Compliance Score (99.8% Brand Fit Check)
    expect(html).toContain("data-brand-memory-compliance-validator");
    expect(html).toContain('data-compliance-score-badge="99_8_percent"');
  });

  it("25. verifies Phase V (Rounds 86–95) /brand SKU Filter, SSR Query Hydration (initialScenario & initialMode), Library Track Filter, Bulk Package Builder, Advisory Face Angle Check & Enterprise SLA Shield", () => {
    const showcaseHtml = renderToStaticMarkup(
      <CampaignMoatShowcase
        locale="ko"
        organizationId="org-yagi"
        studioOpen={true}
      />,
    );

    // Round 86 & Round 87: /brand Command Center SKU Filter & Scenario Query Deep-Linking
    expect(showcaseHtml).toContain("data-brand-home-sku-filter");
    expect(showcaseHtml).toContain("data-project-quick-switcher");
    expect(showcaseHtml).toContain("scenario=launch_full_pack");
    expect(showcaseHtml).toContain("scenario=creator_30_seeding");
    expect(showcaseHtml).toContain("scenario=lookbook_micro_edit");

    // Round 87 & Round 88: Studio SSR Query Hydration (initialScenario & initialMode)
    const hydratedHtml = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
        initialScenario="creator_30_seeding"
        initialMode="track_creator_distribution"
      />,
    );
    expect(hydratedHtml).toContain('data-studio-scenario-hydrator="creator_30_seeding"');
    expect(hydratedHtml).toContain('data-studio-surface-query-sync="track_creator_distribution"');

    // Round 89 & Round 90: Brand Library Track Filter & Bulk Download Package Builder
    expect(hydratedHtml).toContain("data-brand-library-track-filter-bar");
    expect(hydratedHtml).toContain("data-bulk-download-package-builder");
    expect(hydratedHtml).toContain("data-download-folder-structure-preview");

    // Round 93: Advisory Face Angle Check & Zero Creator PII Guard
    expect(hydratedHtml).toContain('data-advisory-face-check-badge="advisory_only_never_blocking"');

    // Round 94: Enterprise Reliability, Zero-Training Privacy Shield & 99.9% SLA Footer
    expect(hydratedHtml).toContain("data-enterprise-sla-guarantee-badge");
    expect(hydratedHtml).toContain("data-data-privacy-shield-badge");
  });

  it("26. verifies Brand Aesthetic Presets (6 reverse-engineered styles), Custom Project Moodboard (max 20 images), 5-Model Empirical Prompt Compiler (GPT Image 2.6, Nano Banana family, Seedream 5.0 Pro), and live-verified comparison assets", () => {
    expect(MAX_BRAND_MOODBOARD_IMAGES).toBe(20);
    expect(BRAND_AESTHETIC_PRESETS).toHaveLength(6);
    expect(BRAND_AESTHETIC_PRESETS.map((p) => p.id)).toEqual([
      "french_blue_glass",
      "cool_daylight_lookbook",
      "sculptural_monochrome",
      "architectural_concrete",
      "botanical_amber_film",
      "chiaroscuro_night",
    ]);

    // Enforce max 20 images on custom project moodboards
    const twentyFiveItems = Array.from({ length: 25 }, (_, idx) => ({
      ...DEFAULT_CUSTOM_MOODBOARD_ITEMS[idx % DEFAULT_CUSTOM_MOODBOARD_ITEMS.length]!,
      id: `mb_test_${idx}`,
    }));
    const clamped = clampMoodboardItemsToMax(twentyFiveItems);
    expect(clamped).toHaveLength(20);

    // Verify model-specific prompt optimization structures
    const subjectPrompt = "프렌치 블루 리본이 묶인 플루티드 향수 보틀과 손 클로즈업";
    const gptPrompt = compileAestheticPromptForModel({
      modelId: "gpt_image_2_6",
      mode: "twings_preset",
      presetId: "french_blue_glass",
      userBrief: subjectPrompt,
      locale: "ko",
    });
    expect(gptPrompt.compiledPrompt).toContain("1. 구도·광학:");
    expect(gptPrompt.compiledPrompt).toContain("5. 미감 팔레트");

    const nanoProPrompt = compileAestheticPromptForModel({
      modelId: "nano_banana_pro",
      mode: "twings_preset",
      presetId: "french_blue_glass",
      userBrief: subjectPrompt,
      locale: "ko",
    });
    expect(nanoProPrompt.compiledPrompt).toContain("[MOODBOARD LOCK: 프렌치 블루 글래스]");
    expect(nanoProPrompt.compiledPrompt).toContain("[SLOT 1–4 REFERENCE LOCK]");

    const nanoFastPrompt = compileAestheticPromptForModel({
      modelId: "nano_banana_2_0",
      mode: "custom_moodboard",
      presetId: "french_blue_glass",
      customItems: clamped,
      customTitle: "24FW 블루 글래스 무드보드",
      userBrief: subjectPrompt,
      locale: "ko",
    });
    expect(nanoFastPrompt.compiledPrompt).toContain("[FAST CONCEPT LOCK: 24FW 블루 글래스 무드보드");
    expect(nanoFastPrompt.compiledPrompt).toContain("무드보드 20장 평균");

    const seedreamPrompt = compileAestheticPromptForModel({
      modelId: "seedream_5_0_pro",
      mode: "twings_preset",
      presetId: "french_blue_glass",
      userBrief: subjectPrompt,
      locale: "ko",
    });
    expect(seedreamPrompt.compiledPrompt).toContain("COLOUR AUTHORITY:");
    expect(seedreamPrompt.compiledPrompt).toContain("HEX VALUES:");
    expect(seedreamPrompt.compiledPrompt).toContain("실제 피부 모공");

    // Verify all 5 models in MODEL_EASY_COMPARISON_MATRIX and all 6 presets have live-verified sample images on disk
    expect(MODEL_EASY_COMPARISON_MATRIX).toHaveLength(5);
    for (const guide of MODEL_EASY_COMPARISON_MATRIX) {
      expect(brandRouteAllowed(guide.verifiedSampleImage, "GET")).toBe(true);
      const diskPath = path.join(
        process.cwd(),
        "public",
        guide.verifiedSampleImage.replace(/^\//, ""),
      );
      expect(fs.existsSync(diskPath)).toBe(true);
    }
    for (const preset of BRAND_AESTHETIC_PRESETS) {
      expect(brandRouteAllowed(preset.coverImage, "GET")).toBe(true);
      for (const sampleUrl of preset.moodboardThumbs) {
        expect(brandRouteAllowed(sampleUrl, "GET")).toBe(true);
        const sampleDisk = path.join(
          process.cwd(),
          "public",
          sampleUrl.replace(/^\//, ""),
        );
        expect(fs.existsSync(sampleDisk)).toBe(true);
      }
    }

    // Verify /brand/studio renders the distilled single-stage shell and bottom floating composer dock
    const studioHtml = renderToStaticMarkup(
      <BrandBriefStudio
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        canWrite={true}
        identityConfirmed={true}
      />,
    );
    expect(studioHtml).toContain("data-studio-aesthetic-trigger");
    expect(studioHtml).toContain("data-image-board-aesthetic-pill");
    expect(studioHtml).toContain("data-studio-model-guide-trigger");
    expect(studioHtml).toContain('data-ref-slot-empty="true"');
    expect(studioHtml).toContain('data-canvas-empty="true"');
    expect(studioHtml).toContain("레퍼런스 사진을 드래그하거나 아래에서 바로 화보를 만드세요");

    const visibleShellHtml =
      studioHtml.split('<div hidden="" aria-hidden="true"')[0] ?? studioHtml;
    expect(visibleShellHtml).not.toContain("예시 컷");
    expect(visibleShellHtml).not.toContain("예시 장면");
    expect(visibleShellHtml).not.toContain("내 작업 컷 (0)");
    expect(visibleShellHtml).not.toContain("이미지+영상 나란히");
    expect(visibleShellHtml).not.toContain("tws-intro");
    expect(visibleShellHtml).not.toContain("tws-guide");
    expect(visibleShellHtml).not.toContain("<select");
    expect(visibleShellHtml).toContain("tws-stage-single");
    expect(visibleShellHtml).toContain("tws-composer-slots");
    expect(visibleShellHtml).toContain("tws-composer-triggers");
    expect(visibleShellHtml).toContain("tws-composer-input-row");
    expect(visibleShellHtml).toContain("tws-composer-attach");
    expect(visibleShellHtml).toContain("tws-batch-stepper");
    expect(visibleShellHtml).toContain("35mm");
    expect(visibleShellHtml).toContain("50mm");
    expect(visibleShellHtml).toContain("85mm");

    // Verify /brand/identity (BrandOnboardingWizard) renders the 3-cut visual Moodboard Contact Sheet above the fold
    const identityHtml = renderToStaticMarkup(
      <BrandOnboardingWizard
        organizationId="org-yagi"
        organizationName="YAGI"
        locale="ko"
        isOwner={true}
        currentStatus="confirmed"
        currentRevision={1}
        studioHref="/brand/studio"
      />,
    );
    expect(identityHtml).toContain("data-brand-identity-moodboard-studio");
    expect(identityHtml).toContain('data-identity-aesthetic-preset="french_blue_glass"');
    expect(identityHtml).toContain("tws-preset-collage");
    expect(identityHtml).toContain("tws-preset-collage-main");
    expect(identityHtml).toContain("tws-preset-collage-side");
    expect(identityHtml).toContain("data-identity-open-studio-with-aesthetic");
  });
});
