import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  compileReferenceToTemplatePromotion,
  DIRECT_SCENE_WORDING_CANDIDATES,
  HIGH_QUALITY_REQUEST_GUIDE,
  MAKER_DB_ARCHITECTURE_READINESS,
  PRESET_REFERENCE_SCENARIOS
} from '@/lib/template-director/freestyle-to-template';
import { parsePersonalCustomizableRecipe, parseRecipe } from '@/lib/recipes/schema';
import { PROMPT_MODEL_LABEL } from '@/lib/prompts/schemas';
import { DirectSceneStudio } from '@/components/audience/direct-scene-studio';
import { TemplateDirectorPanel } from '@/components/twings/template-director-panel';
import { CreatorCampaignHub } from '@/components/campaigns/creator-campaign-hub';

describe('Make Your Own Video & Maker 80% Revenue Engine + Selective Frame Picker + Creator Campaign Hub (2026-11-04)', () => {
  it('positions "나만의 영상 제작하기 · Make Your Own Video" with consumer-friendly copy and Maker 80% revenue share', () => {
    const recommended = DIRECT_SCENE_WORDING_CANDIDATES.find((c) => c.recommended);
    expect(recommended?.id).toBe('freestyle-yourself');
    expect(recommended?.navKo).toBe('나만의 영상 제작하기');
    expect(recommended?.navEn).toBe('Make Your Own Video');
    expect(recommended?.headlineKo).toContain('저장해 둔 영상으로 내 장면을 만들고');
    expect(recommended?.headlineKo).not.toContain('80%');
    expect(HIGH_QUALITY_REQUEST_GUIDE).toHaveLength(3);
    expect(MAKER_DB_ARCHITECTURE_READINESS.map((t) => t.table)).toEqual([
      'platform_creators',
      'platform_formats',
      'prompt_items',
      'render_job_recipes',
      'platform_settlements'
    ]);
  });

  it('compiles a locked signature reference scene into a strict Recipe v2 and TemplateSceneLockSpec', () => {
    const preset = PRESET_REFERENCE_SCENARIOS[1]!; // 90s camcorder interview (both outfit & backdrop locked)
    const result = compileReferenceToTemplatePromotion({
      ...preset.input,
      lockOutfitAsSignature: true,
      lockBackdropAsSignature: true
    });

    expect(result.ok).toBe(true);
    // Must pass strict consumer/maker `parseRecipe`
    const strictCheck = parseRecipe(result.recipe);
    expect(strictCheck.ok).toBe(true);
    expect(Object.keys(result.recipe.slots)).toEqual(['selfie']);
    expect(result.recipe.steps).toHaveLength(2);
    expect(result.recipe.steps[0]?.id).toBe('keyframe');
    expect(result.recipe.steps[1]?.id).toBe('film');

    // Camera, lighting, outfit, and backdrop are all locked in sceneLockSpec
    expect(result.sceneLockSpec.lockedElements.map((e) => e.category)).toEqual([
      'camera-composition',
      'lighting-color',
      'styling-outfit',
      'scene-backdrop'
    ]);

    // Freeze matrix marks buyer_selfie as auto-swapped and outfit/backdrop as locked_signature
    const selfieItem = result.freezeMatrix.find((i) => i.key === 'buyer_selfie');
    const outfitItem = result.freezeMatrix.find((i) => i.key === 'styling_outfit');
    expect(selfieItem?.status).toBe('buyer_selfie_slot');
    expect(outfitItem?.status).toBe('locked_signature');
  });

  it('opens look_ref and scene_ref user slots when the creator allows buyer reference image customization', () => {
    const preset = PRESET_REFERENCE_SCENARIOS[0]!;
    const result = compileReferenceToTemplatePromotion({
      ...preset.input,
      lockOutfitAsSignature: false,
      lockBackdropAsSignature: false
    });

    const customCheck = parsePersonalCustomizableRecipe(result.recipe);
    expect(customCheck.ok).toBe(true);
    expect(Object.keys(result.recipe.slots)).toEqual(['selfie', 'look_ref', 'scene_ref']);

    // Outfit and backdrop move from lockedElements to customizableElements with acceptsReferenceImage: true
    expect(result.sceneLockSpec.lockedElements.map((e) => e.category)).toEqual([
      'camera-composition',
      'lighting-color'
    ]);
    const customCategories = result.sceneLockSpec.customizableElements.map((e) => e.category);
    expect(customCategories).toContain('styling-outfit');
    expect(customCategories).toContain('scene-backdrop');

    const outfitFreeze = result.freezeMatrix.find((i) => i.key === 'styling_outfit');
    const backdropFreeze = result.freezeMatrix.find((i) => i.key === 'scene_backdrop');
    expect(outfitFreeze?.status).toBe('open_user_reference');
    expect(backdropFreeze?.status).toBe('open_user_reference');
  });

  it('renders DirectSceneStudio with the Maker 80% Revenue Calculator, friendly 3 tips, and 3-step simulator without tech jargon', () => {
    const html = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
      />
    );

    expect(html).toContain('data-direct-scene-studio');
    expect(html).toContain('data-maker-revenue-calculator');
    expect(html).toContain('data-maker-earning-per-make');
    expect(html).toContain('data-maker-db-pipeline');
    expect(html).toContain('data-high-quality-guide');
    expect(html).toContain('data-quality-rule="01"');
    expect(html).toContain('data-quality-rule="02"');
    expect(html).toContain('data-quality-rule="03"');
    expect(html).toContain('data-direct-scene-simulator');
    expect(html).toContain('data-stage="reference-input"');
    expect(html).toContain('data-stage="personal-synthesis"');
    expect(html).toContain('data-stage="template-promotion"');
    expect(html).toContain('data-template-freeze-matrix');
    expect(html).toContain('data-buyer-preview-card');
    expect(html).toContain('data-direct-resolution-tiers');
    // Until subscriptions open: won only, and only the resolutions a buyer can pay for (terms: no stored value).
    expect(html).not.toContain('data-direct-resolution-option="480p"');
    expect(html).toContain('data-direct-resolution-option="720p"');
    expect(html).toContain('data-direct-resolution-option="1080p"');
    expect(html).not.toContain('크레딧');
    expect(html).not.toContain(' cr<');
    expect(html).toContain('4,000원');
    expect(html).toContain('9,700원');
    // Once subscriptions are open the credit view returns, 480p Draft included.
    const withCredits = renderToStaticMarkup(
      <DirectSceneStudio locale="ko" videoCatalogHref="/ko/video" creatorWorkspaceHref="/creators/workspace/formats/new" showCredits />
    );
    expect(withCredits).toContain('data-direct-resolution-option="480p"');
    expect(withCredits).toContain('345 cr');
    expect(withCredits).toContain('크레딧');
    expect(html).toContain('data-direct-no-bgm-rule');

    // No raw compiler/developer/DB jargon on screen
    expect(html).not.toContain('RECIPE V2 자동 컴파일');
    expect(html).not.toContain('{{selfie}}');
    expect(html).not.toContain('5200K');
    expect(html).not.toContain('#ED1E1E');
    expect(html).not.toContain('#3875C5');
    expect(html).not.toContain('#3063A7');
    expect(html).not.toContain('80%');
    expect(html).not.toContain('platform_creators');
    expect(html).not.toContain('platform_formats');
    expect(html).not.toContain('platform_settlements');
    expect(html).not.toContain(PROMPT_MODEL_LABEL);
  });

  it('renders Selective Frame Picker inside TemplateDirectorPanel for 5-shot image templates with dynamic credit savings', () => {
    const html = renderToStaticMarkup(
      <TemplateDirectorPanel
        locale="ko"
        templateId="bridal-editorial-5-shots"
        imageSetSpec={{
          totalFrames: 5,
          perFrameProviderUsd: 0.09,
          royaltyKrw: 0
        }}
        initialSelectedFrames={[0, 2]}
      />
    );

    expect(html).toContain('data-selective-frame-picker');
    expect(html).toContain('data-selected-frame-count="2"');
    expect(html).toContain('data-total-frame-count="5"');
    expect(html).toContain('data-selective-credits="29"');
    expect(html).toContain('data-selective-krw="400"');
    expect(html).toContain('data-selective-saved-badge');
    expect(html).toContain('400원');
    expect(html).not.toContain('크레딧');
  });

  it('renders CreatorCampaignHub with 2 monetization tracks (Official Format vs Guided Custom Video) and 3-point payout checklist', () => {
    const html = renderToStaticMarkup(
      <CreatorCampaignHub
        locale="ko"
        featuredFormats={[]}
        myCampaignsHref="/campaigns/mine"
        directVideoHref="/ko/direct"
      />
    );

    expect(html).toContain('data-creator-campaign-hub');
    expect(html).toContain('data-campaign-monetization-tracks');
    expect(html).toContain('data-campaign-track="format"');
    expect(html).toContain('data-campaign-track="guided-custom"');
    expect(html).toContain('data-campaign-guide-simulator');
    expect(html).toContain('data-campaign-payout-checklist');
    expect(html).toContain('200만 뷰+');
    expect(html).not.toContain('#ED1E1E');
  });
});
