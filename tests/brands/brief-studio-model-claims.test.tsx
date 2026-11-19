import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import { BrandBriefStudio } from "@/components/brand-workspace/brand-brief-studio";
import { BrandOnboardingWizard } from "@/components/brand-workspace/brand-onboarding-wizard";
import * as referenceStudio from "@/lib/brands/production/reference-studio";

/**
 * The old brief studio (/brand/studio while BRAND_STUDIO_V2 is off) runs nothing: its model choice only relabelled
 * sample pictures and a prompt preview, and its hard-coded model guide said untrue things (GPT Image 2.6 as the
 * partial-edit pick while partial edits run on Seedream 5.5 alone, Nano Banana 2.0 that is not offered, rankings).
 * Founder 2026-11-20: "옛 브리프 스튜디오 모델 카드도 정리해." The screen names no image model and makes no model
 * claim; the studio's one model list is lib/brand-studio/models.ts.
 */
const MODEL_NAMES = /Nano Banana|GPT Image|Seedream|FLUX/i;
const MODEL_CLAIMS = /부분 수정 1|정밀 수정 1|Surgical|Best for Text|4장 동시 조합|Multi-Ref & 4K|5대 (생성 )?모델|5종 이미지 모델|5 Models/i;
const MODEL_MARKERS = [
  "data-studio-model-guide-trigger",
  "data-quick-model-pill",
  "data-studio-image-model-section",
  "data-studio-image-model-picker",
  "data-studio-active-model-detail",
  "data-selected-image-model",
  "data-model-comparison-card",
  "data-apply-model-optimal-prompt",
  "data-image-model-ab-compare-mode",
];

describe("old brief studio: no image model claims", () => {
  for (const locale of ["ko", "en"] as const) {
    it(`${locale}: names no image model and makes no model claim`, () => {
      const html = renderToStaticMarkup(
        React.createElement(BrandBriefStudio, { organizationId: "00000000-0000-4000-8000-000000000001", locale, canWrite: true, identityConfirmed: true }),
      );
      expect(html).toContain("data-brand-brief-studio");
      expect(html.match(MODEL_NAMES)?.[0] ?? null).toBeNull();
      expect(html.match(MODEL_CLAIMS)?.[0] ?? null).toBeNull();
      for (const marker of MODEL_MARKERS) expect(html, marker).not.toContain(marker);
      // The video model of the video track is not an image model claim and stays.
      expect(html).toContain("data-brand-brief-studio");
    });
  }

  it("the identity wizard names no image model either", () => {
    for (const locale of ["ko", "en"] as const) {
      const html = renderToStaticMarkup(
        React.createElement(BrandOnboardingWizard, {
          organizationId: "00000000-0000-4000-8000-000000000001",
          organizationName: "Sample brand",
          locale,
          isOwner: true,
          currentStatus: "none",
          currentRevision: 0,
        }),
      );
      expect(html).toContain("data-brand-onboarding-wizard");
      expect(html.match(MODEL_NAMES)?.[0] ?? null).toBeNull();
    }
  });

  it("keeps no second image model list next to lib/brand-studio/models.ts", () => {
    const exported = Object.keys(referenceStudio);
    for (const gone of ["BRAND_STUDIO_IMAGE_MODELS", "MODEL_EASY_COMPARISON_MATRIX", "BRAND_STUDIO_MICRO_EDIT_MODELS", "compileAestheticPromptForModel"]) {
      expect(exported, gone).not.toContain(gone);
    }
    for (const goal of referenceStudio.FIRST_CREATION_GOALS) {
      expect(JSON.stringify(goal).match(MODEL_NAMES)?.[0] ?? null, goal.id).toBeNull();
      expect(goal).not.toHaveProperty("targetImageModelId");
    }
    for (const preset of referenceStudio.BRAND_AESTHETIC_PRESETS) expect(preset).not.toHaveProperty("recommendedModelId");
  });
});
