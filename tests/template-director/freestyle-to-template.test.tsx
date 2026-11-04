import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  compileReferenceToTemplatePromotion,
  DIRECT_SCENE_WORDING_CANDIDATES,
  HIGH_QUALITY_REQUEST_GUIDE,
  PRESET_REFERENCE_SCENARIOS
} from '@/lib/template-director/freestyle-to-template';
import { parsePersonalCustomizableRecipe, parseRecipe } from '@/lib/recipes/schema';
import { PROMPT_MODEL_LABEL } from '@/lib/prompts/schemas';
import { DirectSceneStudio } from '@/components/audience/direct-scene-studio';

describe('Direct Scene (Freestyle-to-Template) Engine & UI (2026-11-04)', () => {
  it('positions "Freestyle Yourself · 나만의 템플릿" with magnetic copy and 3 golden quality rules', () => {
    const recommended = DIRECT_SCENE_WORDING_CANDIDATES.find((c) => c.recommended);
    expect(recommended?.id).toBe('freestyle-yourself');
    expect(recommended?.navKo).toBe('나만의 템플릿');
    expect(recommended?.navEn).toBe('Freestyle Yourself');
    expect(recommended?.headlineKo).toContain('세상에 없던 내 장면을 직접 찍고');
    expect(HIGH_QUALITY_REQUEST_GUIDE).toHaveLength(3);
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

  it('renders DirectSceneStudio with the 3 Golden Rules, 3-Stage Simulator, and Freeze Matrix without exposing engine names', () => {
    const html = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
      />
    );

    expect(html).toContain('data-direct-scene-studio');
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

    // TWINGS Identity compliance
    expect(html).not.toContain('#ED1E1E');
    expect(html).not.toContain(PROMPT_MODEL_LABEL);
  });
});
