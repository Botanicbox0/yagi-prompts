import { z } from 'zod';
import {
  parsePersonalCustomizableRecipe,
  parseRecipe,
  SELFIE_SLOT,
  type Recipe
} from '@/lib/recipes/schema';

export interface TemplateLockedElement {
  category: 'camera-composition' | 'lighting-color' | 'styling-outfit' | 'scene-backdrop';
  labelKo: string;
  labelEn: string;
  detailKo: string;
  detailEn: string;
}

export interface TemplateCustomizableElement {
  category: 'styling-outfit' | 'scene-backdrop' | 'motion-pacing';
  labelKo: string;
  labelEn: string;
  placeholderKo: string;
  placeholderEn: string;
  acceptsReferenceImage: boolean;
}

export interface TemplateSceneLockSpec {
  slug: string;
  lockedElements: readonly TemplateLockedElement[];
  customizableElements: readonly TemplateCustomizableElement[];
  recommendedModels: readonly ('seedream-5.0-pro' | 'nano-banana-2.1')[];
  dualAnchorWhenRisky: boolean;
}

/**
 * Naming & UX Architecture for the "Freestyle Yourself" concept:
 * Why "직접 연출 (Direct Scene)" is recommended over "Freestyle Yourself":
 * - "Freestyle" sounds like an unguided blank prompt box where users must invent prompts from scratch.
 * - "직접 연출 (Direct Scene)" / "내 장면 연출 & 템플릿 등판" positions the user as a film director who brings
 *   a Reference Video, casts their own face via a real selfie, and can promote the resulting scene into
 *   an official TWINGS template with clear lock rules.
 */
export interface TabWordingCandidate {
  id: 'direct-scene' | 'custom-scene' | 'freestyle-yourself';
  recommended: boolean;
  navKo: string;
  navEn: string;
  headlineKo: string;
  headlineEn: string;
  rationaleKo: string;
}

export const DIRECT_SCENE_WORDING_CANDIDATES: readonly TabWordingCandidate[] = [
  {
    id: 'direct-scene',
    recommended: true,
    navKo: '직접 연출',
    navEn: 'Direct Scene',
    headlineKo: '원하는 레퍼런스 영상에 내 얼굴을 넣고, 마음에 들면 내 템플릿으로 등판시키세요',
    headlineEn: 'Bring a reference film, star in it with your photo, and publish it as your own template',
    rationaleKo:
      '‘프리스타일’처럼 막막한 빈칸 프롬프트 인상을 주지 않고, 레퍼런스 영상을 바탕으로 내가 주인공이 되는 장면을 연출한 뒤 공식 템플릿으로 등록하는 ‘감독/메이커’ 경험을 명확히 전달합니다.'
  },
  {
    id: 'custom-scene',
    recommended: false,
    navKo: '맞춤 장면',
    navEn: 'Custom Scene',
    headlineKo: '레퍼런스 영상으로 만드는 나만의 맞춤 장면',
    headlineEn: 'Your custom scene from any reference film',
    rationaleKo:
      '직관적이지만 주문제작 의뢰 같은 인상을 줄 수 있어, 추후 템플릿으로 등판시키는 크리에이티브 확장성은 ‘직접 연출’보다 약합니다.'
  },
  {
    id: 'freestyle-yourself',
    recommended: false,
    navKo: '프리스타일',
    navEn: 'Freestyle Yourself',
    headlineKo: '자유롭게 만드는 내 영상',
    headlineEn: 'Freestyle your own scene',
    rationaleKo:
      '범용 AI 생성기처럼 보일 위험이 있고, 어떤 레퍼런스를 넣어야 고품질이 나오는지 가이드 없이 프롬프트만 치게 만들 우려가 있습니다.'
  }
] as const;

export interface RequestQualityRule {
  stepNumber: '01' | '02' | '03';
  titleKo: string;
  titleEn: string;
  summaryKo: string;
  summaryEn: string;
  goodExamplesKo: readonly string[];
  avoidExamplesKo: readonly string[];
}

/**
 * Explains to the user exactly how to submit a custom reference production request so that
 * facial likeness and cinematic quality come out at the highest level.
 */
export const HIGH_QUALITY_REQUEST_GUIDE: readonly RequestQualityRule[] = [
  {
    stepNumber: '01',
    titleKo: '레퍼런스 영상 선택 공식 — 카메라 호흡과 얼굴 각도가 선명한 4~10초 단일 씬',
    titleEn: 'Reference Film Rule — Clear 4–10s single sequence with readable lighting',
    summaryKo:
      '레퍼런스 영상은 결과물의 카메라 무빙·조명·컷 호흡을 결정하는 설계도입니다. 주인공 1인의 동선이 또렷한 영상일수록 완성도가 급격히 올라갑니다.',
    summaryEn:
      'Your reference video defines the camera movement, lighting, and pacing. Single-protagonist shots with clear lighting yield the highest realism.',
    goodExamplesKo: [
      '1인 주인공 중심으로 카메라가 부드럽게 트래킹·줌인하는 4~10초 영상',
      '얼굴에 정면 또는 45도 자연광·스튜디오 조명이 또렷하게 들어오는 장면',
      '런웨이 워킹, 길거리 인터뷰, 카페 시선 처리처럼 행동 1개가 명확한 시퀀스'
    ],
    avoidExamplesKo: [
      '0.5초마다 화면이 바뀌는 빠른 교차편집(매드무비)이나 격렬한 카메라 흔들림',
      '손·선글라스·마스크·머리카락이 얼굴 절반 이상을 계속 가리는 영상',
      '3명 이상이 동시에 얽혀 누가 주인공인지 구분하기 어려운 군무 영상'
    ]
  },
  {
    stepNumber: '02',
    titleKo: '이미지 직접 매칭 공식 — AI 임의 변형 대신 실사 셀카 1장 + 의상·소품 원본 사진 첨부',
    titleEn: 'Direct Photo Rule — Unfiltered front selfie + direct outfit/prop reference image',
    summaryKo:
      '긴 글로 설명하는 것보다 실제 사진을 직접 넣을 때 AI 왜곡이 사라집니다. 조명이 까다로운 장면은 Seedream 5.0 Pro와 Nano Banana 2.1 키프레임 2종 중 더 닮은 내 얼굴을 먼저 고른 뒤 영상으로 만듭니다.',
    summaryEn:
      'Direct image uploads beat long text descriptions. For tricky lighting, pick your best facial likeness between Seedream 5.0 Pro and Nano Banana 2.1 before animating.',
    goodExamplesKo: [
      '내 얼굴: 뷰티 필터·보정 앱을 쓰지 않은 밝은 정면 실사 사진 1장 (부적합 시 AI 변형 대신 다른 사진 직접 재업로드 권장)',
      '의상·소품 변경 시: “예쁜 검정 자켓” 텍스트 대신 실제로 입히고 싶은 자켓·가방 사진 1장을 직접 업로드',
      '어두운 네온·역광 레퍼런스: 1단계에서 생성된 두 모델(Seedream 5.0 Pro vs Nano Banana 2.1) 중 내 눈매와 더 닮은 키프레임 선택'
    ],
    avoidExamplesKo: [
      '이미 보정 앱으로 턱선·눈 크기가 변형된 셀카나 어두운 클럽 조명 사진',
      '의상·배경·조명·카메라를 한꺼번에 글로만 길게 나열하는 요청'
    ]
  },
  {
    stepNumber: '03',
    titleKo: '한 줄 디렉팅 공식 — “유지할 것(Keep)”과 “바꿀 것(Change)”만 명확히 분리',
    titleEn: 'One-Line Direction Rule — Separate what to KEEP from what to CHANGE',
    summaryKo:
      '레퍼런스 영상이 이미 카메라 워크와 분위기를 책임지므로, 요청사항에는 레퍼런스에서 그대로 가져갈 요소와 내 이미지로 교체할 요소만 1~2문장으로 적어 주세요.',
    summaryEn:
      'Since the reference film already carries the camera and mood, simply state what to keep from the reference and what to swap with your uploaded image.',
    goodExamplesKo: [
      '“레퍼런스 영상의 카메라 무빙과 밤거리 조명은 그대로 유지하고, 주인공 얼굴을 내 사진으로, 의상만 첨부한 가죽 자켓 사진으로 바꿔주세요.”',
      '“원본 영상의 시선 처리와 바람 부는 연출은 유지하고, 배경 색감만 조금 더 따뜻한 오후 햇살 톤으로 맞춰주세요.”'
    ],
    avoidExamplesKo: [
      '“알아서 더 멋있고 영화처럼 시네마틱하게 해주세요” (기준이 모호해 원본 레퍼런스의 매력이 흐려짐)'
    ]
  }
] as const;

export const ReferenceSceneInputSchema = z.object({
  slugCandidate: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  titleKo: z.string().trim().min(2).max(120),
  titleEn: z.string().trim().min(2).max(120),
  aspect: z.enum(['9:16', '16:9', '4:3', '3:4', '1:1']),
  durationSeconds: z.number().int().min(4).max(15),
  resolution: z.enum(['720p', '1080p']).default('720p'),
  cameraMotionPrompt: z.string().trim().min(10).max(1200),
  lightingAndGradePrompt: z.string().trim().min(10).max(1200),
  stylingPrompt: z.string().trim().min(5).max(1200),
  sceneBackdropPrompt: z.string().trim().min(5).max(1200),
  lightingRiskForFace: z.boolean().default(false),
  preferredAnchorEngine: z.enum(['seedream-5.0-pro', 'nano-banana-2.1']).default('seedream-5.0-pro'),
  /**
   * Template Freeze Policy when promoting this personal scene into a reusable template:
   * - `camera_and_motion` and `lighting_and_grade` are ALWAYS locked to preserve quality.
   * - `buyer_selfie` is ALWAYS open (`{{selfie}}`) so buyers cast their own face.
   * - `lockOutfitAsSignature`: if true (default), outfit is locked to the creator's styling;
   *   if false, buyers can upload their own outfit reference image (`look_ref`).
   * - `lockBackdropAsSignature`: if true (default), backdrop/props are locked;
   *   if false, buyers can upload their own scene/prop reference image (`scene_ref`).
   */
  lockOutfitAsSignature: z.boolean().default(true),
  lockBackdropAsSignature: z.boolean().default(true)
});

export type ReferenceSceneInput = z.infer<typeof ReferenceSceneInputSchema>;

export interface TemplateFreezeItem {
  key: 'buyer_selfie' | 'camera_and_motion' | 'lighting_and_grade' | 'identity_anchor_pipeline' | 'styling_outfit' | 'scene_backdrop';
  status: 'buyer_selfie_slot' | 'locked_signature' | 'open_user_reference';
  badgeKo: string;
  badgeEn: string;
  labelKo: string;
  labelEn: string;
  detailKo: string;
  detailEn: string;
}

export interface TemplatePromotionResult {
  ok: true;
  slug: string;
  /** Validated Recipe v2 ready to save into `prompt_items.recipe` and `platform_formats.recipe_v2` */
  recipe: Recipe;
  /** Scene lock specification automatically wired into `TemplateDirectorPanel` for future buyers */
  sceneLockSpec: TemplateSceneLockSpec;
  /** Human-readable breakdown of what freezes vs what stays open when published as a template */
  freezeMatrix: readonly TemplateFreezeItem[];
  /** Explaining how Stage 1 (Personal Render) transitions to Stage 2 (Published Template) */
  personalToTemplateSummary: {
    personalRenderRoleKo: string;
    templateBuyerExperienceKo: string;
    privacyGuaranteeKo: string;
  };
}

/**
 * Compiles a user's Reference-Video + Personal-Selfie scene into:
 * 1. A validated TWINGS Recipe v2 (`keyframe` -> `film` two-step pipeline).
 * 2. A `TemplateSceneLockSpec` that tells future template buyers what is fixed vs customizable.
 * 3. A `TemplateFreezeItem[]` matrix explaining exactly what gets locked when published as a template.
 */
export function compileReferenceToTemplatePromotion(
  rawInput: ReferenceSceneInput
): TemplatePromotionResult {
  const input = ReferenceSceneInputSchema.parse(rawInput);

  // Map aspect to valid IMAGE_ASPECTS ('1:1' | '4:5' | '3:4' | '16:9' | '9:16') for Step 1 keyframe
  const keyframeAspect = input.aspect === '4:3' ? '3:4' : input.aspect;

  // Step 1 (Keyframe): In Maker Recipe v2, `seedream-5.0-pro` is a registered maker image engine.
  const step1Engine = 'seedream-5.0-pro' as const;

  const slots: Record<
    string,
    { kind: 'image'; source: 'user'; required: boolean; role?: 'person' | 'look' | 'scene' }
  > = {
    [SELFIE_SLOT]: { kind: 'image', source: 'user', required: true, role: 'person' }
  };

  const step1Inputs: string[] = [SELFIE_SLOT];
  const promptParts: string[] = [
    `Cast the person from {{${SELFIE_SLOT}}} as the protagonist, keeping exact facial structure, eye shape, nose bridge, and natural skin texture.`
  ];

  if (input.lockOutfitAsSignature) {
    promptParts.push(`Signature Locked Styling: ${input.stylingPrompt}.`);
  } else {
    slots.look_ref = { kind: 'image', source: 'user', required: false, role: 'look' };
    step1Inputs.push('look_ref');
    promptParts.push(
      `Outfit & Styling: Follow the garment silhouette, fabric texture, and color from {{look_ref}} (default look: ${input.stylingPrompt}).`
    );
  }

  if (input.lockBackdropAsSignature) {
    promptParts.push(`Signature Locked Environment: ${input.sceneBackdropPrompt}.`);
  } else {
    slots.scene_ref = { kind: 'image', source: 'user', required: false, role: 'scene' };
    step1Inputs.push('scene_ref');
    promptParts.push(
      `Environment & Props: Place the protagonist inside the setting/props shown in {{scene_ref}} (default environment: ${input.sceneBackdropPrompt}).`
    );
  }

  promptParts.push(`Reference Lighting & Color Grade (Locked): ${input.lightingAndGradePrompt}.`);

  const keyframePrompt = promptParts.join(' ');
  const filmPrompt = [
    `Animate the protagonist from {{keyframe}} with exact facial identity continuity.`,
    `Locked Reference Camera & Motion Beat: ${input.cameraMotionPrompt}.`,
    `Locked Lighting & Atmosphere: ${input.lightingAndGradePrompt}.`
  ].join(' ');

  const rawRecipe = {
    version: 2 as const,
    slots,
    steps: [
      {
        id: 'keyframe',
        kind: 'image' as const,
        engine: step1Engine,
        inputs: step1Inputs,
        prompt: keyframePrompt,
        params: { aspect: keyframeAspect as '9:16' | '16:9' | '3:4' | '1:1' }
      },
      {
        id: 'film',
        kind: 'video' as const,
        engine: 'seedance-2.5',
        inputs: ['keyframe'],
        prompt: filmPrompt,
        params: {
          aspect: input.aspect,
          duration: input.durationSeconds,
          resolution: input.resolution
        }
      }
    ],
    output: { from: 'film' }
  };

  const hasCustomUserSlots = !input.lockOutfitAsSignature || !input.lockBackdropAsSignature;
  const checked = hasCustomUserSlots
    ? parsePersonalCustomizableRecipe(rawRecipe)
    : parseRecipe(rawRecipe);

  if (!checked.ok) {
    throw new Error(
      `Failed to compile template recipe: ${checked.issues.map((i) => i.code).join(', ')}`
    );
  }

  const lockedElements: TemplateLockedElement[] = [
    {
      category: 'camera-composition',
      labelKo: '레퍼런스 카메라 무빙 & 구도 (고정)',
      labelEn: 'Reference Camera & Framing (Locked)',
      detailKo: input.cameraMotionPrompt,
      detailEn: input.cameraMotionPrompt
    },
    {
      category: 'lighting-color',
      labelKo: '시그니처 조명 & 필름 색감 (고정)',
      labelEn: 'Signature Lighting & Grade (Locked)',
      detailKo: input.lightingAndGradePrompt,
      detailEn: input.lightingAndGradePrompt
    }
  ];

  const customizableElements: TemplateCustomizableElement[] = [];

  if (input.lockOutfitAsSignature) {
    lockedElements.push({
      category: 'styling-outfit',
      labelKo: '시그니처 의상 & 스타일링 (고정)',
      labelEn: 'Signature Outfit & Styling (Locked)',
      detailKo: input.stylingPrompt,
      detailEn: input.stylingPrompt
    });
  } else {
    customizableElements.push({
      category: 'styling-outfit',
      labelKo: '의상 · 헤어 · 메이크업 (직접 이미지 첨부 가능)',
      labelEn: 'Outfit & Styling (Direct Reference Image Allowed)',
      placeholderKo: '입히고 싶은 의상 사진을 첨부하거나 원하는 스타일을 적어 주세요',
      placeholderEn: 'Attach a reference outfit photo or describe your desired look',
      acceptsReferenceImage: true
    });
  }

  if (input.lockBackdropAsSignature) {
    lockedElements.push({
      category: 'scene-backdrop',
      labelKo: '시그니처 배경 & 공간 연출 (고정)',
      labelEn: 'Signature Scene & Backdrop (Locked)',
      detailKo: input.sceneBackdropPrompt,
      detailEn: input.sceneBackdropPrompt
    });
  } else {
    customizableElements.push({
      category: 'scene-backdrop',
      labelKo: '배경 · 소품 무드 (직접 이미지 첨부 가능)',
      labelEn: 'Scene & Props (Direct Reference Image Allowed)',
      placeholderKo: '원하는 배경·소품 사진을 첨부하거나 공간 톤을 적어 주세요',
      placeholderEn: 'Attach a reference backdrop/prop photo or describe the setting',
      acceptsReferenceImage: true
    });
  }

  // Always allow minor motion/gaze pacing note so buyers can express subtle preferences
  customizableElements.push({
    category: 'motion-pacing',
    labelKo: '시선 처리 · 표정 무드 미세 조정',
    labelEn: 'Subtle Gaze & Expression Note',
    placeholderKo: '예: 카메라를 보며 살짝 미소 짓는 표정으로 연출해 주세요',
    placeholderEn: 'e.g., Soft smile looking directly into the lens',
    acceptsReferenceImage: false
  });

  const sceneLockSpec: TemplateSceneLockSpec = {
    slug: input.slugCandidate,
    lockedElements,
    customizableElements,
    recommendedModels: input.lightingRiskForFace
      ? ['seedream-5.0-pro', 'nano-banana-2.1']
      : [input.preferredAnchorEngine, 'seedream-5.0-pro'],
    dualAnchorWhenRisky: true
  };

  const freezeMatrix: TemplateFreezeItem[] = [
    {
      key: 'buyer_selfie',
      status: 'buyer_selfie_slot',
      badgeKo: '구매자 사진 자동 치환 ({{selfie}})',
      badgeEn: 'Auto-Swapped Buyer Selfie ({{selfie}})',
      labelKo: '주인공 얼굴 슬롯',
      labelEn: 'Protagonist Face Slot',
      detailKo:
        '내가 넣었던 내 얼굴 사진은 레시피에서 빠져나가고 [구매자 본인 사진] 슬롯으로 자동 변환됩니다. 내가 만든 완성 영상만 템플릿 예시 영상으로 노출됩니다.',
      detailEn:
        'Your personal photo is replaced by the buyer selfie slot ({{selfie}}). Only your finished film is shown as the public preview.'
    },
    {
      key: 'camera_and_motion',
      status: 'locked_signature',
      badgeKo: '템플릿 고정 (LOCKED)',
      badgeEn: 'Locked by Template',
      labelKo: '카메라 무빙 · 컷 호흡 · 화면 비율',
      labelEn: 'Camera Movement, Pacing & Aspect Ratio',
      detailKo: `${input.cameraMotionPrompt} (${input.aspect}, ${input.durationSeconds}초) — 다음 유저가 제작할 때도 흔들림 없이 동일한 구도로 고정됩니다.`,
      detailEn: `${input.cameraMotionPrompt} (${input.aspect}, ${input.durationSeconds}s) — Frozen so every buyer gets the exact same cinematic framing.`
    },
    {
      key: 'lighting_and_grade',
      status: 'locked_signature',
      badgeKo: '템플릿 고정 (LOCKED)',
      badgeEn: 'Locked by Template',
      labelKo: '조명 무드 · 필름 색감',
      labelEn: 'Lighting Mood & Film Color Grade',
      detailKo: `${input.lightingAndGradePrompt} — 이 장면의 핵심 미감을 만드는 조명과 색온도가 고정됩니다.`,
      detailEn: `${input.lightingAndGradePrompt} — Preserves the signature atmosphere of your scene.`
    },
    {
      key: 'identity_anchor_pipeline',
      status: 'locked_signature',
      badgeKo: '품질 보호 고정 (LOCKED)',
      badgeEn: 'Quality Guard Locked',
      labelKo: '2단계 닮음새 보호 엔진 파이프라인',
      labelEn: '2-Step Facial Likeness Protection Pipeline',
      detailKo: input.lightingRiskForFace
        ? '조명 대비가 강한 장면이므로 다음 구매자에게도 [Seedream 5.0 Pro vs Nano Banana 2.1] A/B 닮음새 선택 후 영상화하는 안전장치가 자동 적용됩니다.'
        : '1단계 실사 키프레임 고정 후 2단계 영상으로 이어지는 얼굴 왜곡 방지 파이프라인이 그대로 고정됩니다.',
      detailEn: input.lightingRiskForFace
        ? 'Automatically enables Dual A/B Identity Anchor selection (Seedream 5.0 Pro vs Nano Banana 2.1) for future buyers.'
        : 'Locks the 2-step keyframe-to-video pipeline so facial likeness stays sharp.'
    },
    {
      key: 'styling_outfit',
      status: input.lockOutfitAsSignature ? 'locked_signature' : 'open_user_reference',
      badgeKo: input.lockOutfitAsSignature ? '시그니처 고정 (LOCKED)' : '구매자 이미지 첨부 허용 (OPEN)',
      badgeEn: input.lockOutfitAsSignature ? 'Locked Signature' : 'Open for Buyer Image',
      labelKo: '의상 · 헤어 · 스타일링',
      labelEn: 'Outfit, Hair & Styling',
      detailKo: input.lockOutfitAsSignature
        ? `${input.stylingPrompt} — 구매자가 셀카 1장만 올리면 내가 연출한 이 의상 그대로 입고 등장합니다.`
        : `${input.stylingPrompt} (기본값) — 구매자가 원할 경우 본인 의상 참조 사진(look_ref)을 직접 업로드해 갈아입을 수 있게 열어 둡니다.`,
      detailEn: input.lockOutfitAsSignature
        ? `${input.stylingPrompt} — Buyers step right into your curated outfit with just one selfie.`
        : `${input.stylingPrompt} (Default) — Buyers may upload their own outfit reference image (look_ref).`
    },
    {
      key: 'scene_backdrop',
      status: input.lockBackdropAsSignature ? 'locked_signature' : 'open_user_reference',
      badgeKo: input.lockBackdropAsSignature ? '시그니처 고정 (LOCKED)' : '구매자 이미지 첨부 허용 (OPEN)',
      badgeEn: input.lockBackdropAsSignature ? 'Locked Signature' : 'Open for Buyer Image',
      labelKo: '배경 공간 · 소품 연출',
      labelEn: 'Scene Backdrop & Props',
      detailKo: input.lockBackdropAsSignature
        ? `${input.sceneBackdropPrompt} — 배경 공간과 오브제가 템플릿의 고정 세계관으로 유지됩니다.`
        : `${input.sceneBackdropPrompt} (기본값) — 구매자가 원하는 배경·소품 이미지(scene_ref)를 직접 첨부할 수 있게 열어 둡니다.`,
      detailEn: input.lockBackdropAsSignature
        ? `${input.sceneBackdropPrompt} — Keeps the environment fixed as part of the template world.`
        : `${input.sceneBackdropPrompt} (Default) — Buyers may upload their own backdrop/prop reference image.`
    }
  ];

  return {
    ok: true,
    slug: input.slugCandidate,
    recipe: checked.recipe,
    sceneLockSpec,
    freezeMatrix,
    personalToTemplateSummary: {
      personalRenderRoleKo:
        '1단계에서 내 사진과 레퍼런스 영상으로 완성한 결과물은 내 소장용 원본 영상이 되며, 템플릿 등판 시에는 이 템플릿의 공식 샘플 영상(Preview Film)으로 등록됩니다.',
      templateBuyerExperienceKo: input.lockOutfitAsSignature && input.lockBackdropAsSignature
        ? '다음 유저는 복잡한 프롬프트 입력 없이 정면 셀카 1장만 올리면 내가 세팅한 카메라·조명·의상 그대로 주인공이 됩니다.'
        : '다음 유저는 정면 셀카 1장으로 바로 만들거나, 내가 열어 둔 의상·배경 슬롯에 자기 레퍼런스 이미지를 직접 첨부해 맞춤 제작할 수 있습니다.',
      privacyGuaranteeKo:
        '내 원본 셀카 파일은 레시피에 절대 포함되지 않으며, 레시피 내부의 얼굴 슬롯은 {{selfie}}(구매자 본인 사진)로 100% 치환되어 저장됩니다.'
    }
  };
}

export interface PresetReferenceScenario {
  id: 'seoul-night-runway' | 'vintage-camcorder-interview' | 'luxury-beauty-closeup';
  badgeKo: string;
  badgeEn: string;
  input: ReferenceSceneInput;
}

export const PRESET_REFERENCE_SCENARIOS: readonly PresetReferenceScenario[] = [
  {
    id: 'seoul-night-runway',
    badgeKo: '예시 01 · 도심 야간 플래시 런웨이',
    badgeEn: 'Preset 01 · Night Flash Street Runway',
    input: {
      slugCandidate: 'seoul-night-flash-runway',
      titleKo: '서울 야간 플래시 스트릿 런웨이',
      titleEn: 'Seoul Night Flash Street Runway',
      aspect: '9:16',
      durationSeconds: 10,
      resolution: '720p',
      cameraMotionPrompt:
        '35mm low-angle tracking shot walking backward ahead of the subject, followed by a crisp medium close-up pause as camera flashes fire',
      lightingAndGradePrompt:
        'Direct press-flash specular highlights against wet asphalt reflections, 5200K neutral skin tone preservation with deep cinematic contrast',
      stylingPrompt: 'Tailored oversized black wool trench coat with silver ear cuffs and sleek wet hair',
      sceneBackdropPrompt: 'Rain-slicked Euljiro alley at midnight with blurred paparazzi silhouettes in the background',
      lightingRiskForFace: true,
      preferredAnchorEngine: 'seedream-5.0-pro',
      lockOutfitAsSignature: false,
      lockBackdropAsSignature: true
    }
  },
  {
    id: 'vintage-camcorder-interview',
    badgeKo: '예시 02 · 90년대 캠코더 길거리 인터뷰',
    badgeEn: 'Preset 02 · 90s Camcorder Street Interview',
    input: {
      slugCandidate: '90s-camcorder-youth-interview',
      titleKo: '90년대 압구정 캠코더 인터뷰',
      titleEn: '90s Apgujeong Camcorder Interview',
      aspect: '4:3',
      durationSeconds: 8,
      resolution: '720p',
      cameraMotionPrompt:
        'Handheld Hi8 camcorder framing at eye level with a gentle zoom-in as the protagonist turns toward the microphone and laughs naturally',
      lightingAndGradePrompt:
        'Warm 4800K afternoon daylight with authentic analog halation and natural skin tone fidelity',
      stylingPrompt: 'Vintage denim jacket over white graphic tee with retro wired headphones around the neck',
      sceneBackdropPrompt: '1990s Seoul record shop street corner with warm afternoon sunlight',
      lightingRiskForFace: false,
      preferredAnchorEngine: 'nano-banana-2.1',
      lockOutfitAsSignature: true,
      lockBackdropAsSignature: true
    }
  },
  {
    id: 'luxury-beauty-closeup',
    badgeKo: '예시 03 · 하이엔드 뷰티 스튜디오 필름',
    badgeEn: 'Preset 03 · High-End Beauty Studio Film',
    input: {
      slugCandidate: 'luminous-studio-beauty-portrait',
      titleKo: '루미너스 뷰티 스튜디오 클로즈업',
      titleEn: 'Luminous Beauty Studio Close-Up',
      aspect: '9:16',
      durationSeconds: 6,
      resolution: '1080p',
      cameraMotionPrompt:
        '85mm macro-portrait dolly-in with slow-motion hair movement and direct eye contact into the lens',
      lightingAndGradePrompt:
        'Soft butterfly key light with warm golden rim light and zero harsh shadows on facial contours',
      stylingPrompt: 'Off-shoulder ivory silk top with dewy glass-skin makeup and minimalist gold jewelry',
      sceneBackdropPrompt: 'Warm champagne studio cyclorama with subtle sunlit water-ripple reflections',
      lightingRiskForFace: false,
      preferredAnchorEngine: 'seedream-5.0-pro',
      lockOutfitAsSignature: false,
      lockBackdropAsSignature: false
    }
  }
] as const;
