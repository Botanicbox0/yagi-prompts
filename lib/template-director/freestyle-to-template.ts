import { z } from 'zod';
import {
  parsePersonalCustomizableRecipe,
  parseRecipe,
  SELFIE_SLOT,
  type Recipe
} from '@/lib/recipes/schema';
import {
  quoteVideoResolutionTiers,
  type PersonalVideoResolution,
  type VideoResolutionMultiTierQuote
} from '@/lib/twings/template-price';
import { PERSONAL_NO_BGM_AUDIO_CONTRACT_EN } from './morphic-production-playbook';

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
  id: 'freestyle-yourself' | 'direct-scene' | 'custom-scene';
  recommended: boolean;
  navKo: string;
  navEn: string;
  headlineKo: string;
  headlineEn: string;
  subcopyKo: string;
  subcopyEn: string;
  rationaleKo: string;
}

export const DIRECT_SCENE_WORDING_CANDIDATES: readonly TabWordingCandidate[] = [
  {
    id: 'freestyle-yourself',
    recommended: true,
    navKo: '나만의 영상 제작하기',
    navEn: 'Make Your Own Video',
    headlineKo: '저장해 둔 영상으로 내 장면을 만들고, 템플릿으로 올려 80% 수익도 받으세요',
    headlineEn: 'Make Your Own Video — Turn any reference clip into your scene, then earn 80% when others use your template',
    subcopyKo:
      '평소 저장해 둔 멋진 영상에 내 정면 사진 한 장을 올려 내가 주인공인 영상을 완성해 보세요. 완성된 영상이 마음에 들면 템플릿으로 공개할 수 있고, 다른 사람이 내 템플릿으로 만들 때마다 순이익의 80%가 내 수익으로 정산됩니다.',
    subcopyEn:
      'Upload a reference video you love and one front selfie to star in your own scene. Publish the finished video as a template and earn 80% of the net margin every time someone makes it.',
    rationaleKo:
      '어려운 기술 용어 없이 누구나 원하는 레퍼런스 영상으로 자기 영상을 만들고, 그대로 템플릿으로 등록해 수익(순마진 80%)까지 얻을 수 있다는 가치를 직관적으로 전달합니다.'
  },
  {
    id: 'direct-scene',
    recommended: false,
    navKo: '직접 연출',
    navEn: 'Direct Scene',
    headlineKo: '원하는 레퍼런스 영상에 내 얼굴을 넣고 내 템플릿으로 등판시키세요',
    headlineEn: 'Bring a reference film, star in it with your photo, and publish it as your own template',
    subcopyKo: '레퍼런스 영상을 바탕으로 내가 주인공이 되는 장면을 연출합니다.',
    subcopyEn: 'Direct your own scene from a reference film.',
    rationaleKo: '연출이라는 표현이 일반 유저에게는 다소 어렵게 느껴질 수 있습니다.'
  },
  {
    id: 'custom-scene',
    recommended: false,
    navKo: '맞춤 장면',
    navEn: 'Custom Scene',
    headlineKo: '레퍼런스 영상으로 만드는 나만의 맞춤 장면',
    headlineEn: 'Your custom scene from any reference film',
    subcopyKo: '원하는 레퍼런스로 맞춤 장면을 제작합니다.',
    subcopyEn: 'Create a custom scene from your reference.',
    rationaleKo: '1회성 주문제작 인상을 주어 템플릿 수익화 연결성이 약합니다.'
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
 * Consumer-friendly guide explaining how to get the most natural, high-quality video from a reference clip.
 */
export const HIGH_QUALITY_REQUEST_GUIDE: readonly RequestQualityRule[] = [
  {
    stepNumber: '01',
    titleKo: '어떤 영상을 올리면 가장 예쁘게 나오나요?',
    titleEn: 'What kind of reference video works best?',
    summaryKo:
      '한 사람이 주인공으로 나오고 얼굴에 빛이 잘 들어오는 4~10초 영상을 올리면, 영상 속 카메라 움직임과 분위기 그대로 내가 주인공이 됩니다.',
    summaryEn:
      'Pick a 4–10 second clip with one clear protagonist and good lighting.',
    goodExamplesKo: [
      '한 사람이 걷거나 돌아보는 4~10초 분량의 자연스러운 영상',
      '얼굴이 너무 작지 않고 정면이나 반측면이 잘 보이는 영상',
      '길거리 인터뷰, 런웨이, 카페 일상처럼 분위기가 뚜렷한 영상'
    ],
    avoidExamplesKo: [
      '1초마다 화면이 휙휙 바뀌거나 카메라가 심하게 흔들리는 영상',
      '선글라스·마스크·손으로 얼굴을 계속 가리고 있는 영상',
      '여러 명이 동시에 섞여 누가 주인공인지 알기 어려운 영상'
    ]
  },
  {
    stepNumber: '02',
    titleKo: '내 사진과 옷 사진은 어떻게 올리나요?',
    titleEn: 'How should I upload my photo and outfit?',
    summaryKo:
      '어플 보정이 없는 밝은 정면 사진 1장이면 충분합니다. 입고 싶은 옷이나 들고 싶은 소품이 있다면 글로 길게 설명하는 대신 옷 사진을 직접 한 장 올려주세요.',
    summaryEn:
      'Use one unfiltered front selfie. Want a different outfit? Upload a photo of the outfit directly.',
    goodExamplesKo: [
      '내 얼굴: 기본 카메라로 찍은 밝고 선명한 정면 사진 1장',
      '입고 싶은 옷이 있을 때: 쇼핑몰 캡처나 옷 사진을 그대로 함께 첨부',
      '조명이 어두운 영상일 때: 먼저 만들어드리는 2가지 얼굴 시안 중 더 나다운 사진을 선택'
    ],
    avoidExamplesKo: [
      '눈 크기나 턱선을 보정 앱으로 많이 바꾼 셀카',
      '사진 첨부 없이 글로만 옷 모양과 색깔을 길게 설명하는 요청'
    ]
  },
  {
    stepNumber: '03',
    titleKo: '요청사항은 딱 한 줄이면 충분해요',
    titleEn: 'One simple sentence is all you need',
    summaryKo:
      '올리신 영상이 이미 분위기와 카메라 구도를 잡아주니까, 그대로 둘 것과 바꿀 것만 편하게 한 줄로 적어 주세요.',
    summaryEn:
      'Your video already sets the mood — just write one line on what to keep or swap.',
    goodExamplesKo: [
      '“영상 속 밤거리 분위기는 그대로 두고, 내 사진 속 얼굴과 첨부한 검정 코트로만 바꿔주세요.”',
      '“원래 영상처럼 자연스럽게 웃는 표정으로 해주고, 배경만 조금 더 따뜻한 햇살 느낌으로 해주세요.”'
    ],
    avoidExamplesKo: [
      '“알아서 더 멋있고 영화처럼 해주세요”처럼 무엇을 바꿀지 모호한 요청'
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
  resolution: z.enum(['480p', '720p', '1080p']).default('720p'),
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
  /** User's chosen render resolution tier ('480p' draft, '720p' standard, or '1080p' masterpiece) */
  selectedResolution: PersonalVideoResolution;
  /** Real-time 3-tier credit & KRW quote for 480p Draft, 720p Standard, and 1080p Masterpiece */
  resolutionTiers: VideoResolutionMultiTierQuote;
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
    `Locked Lighting & Atmosphere: ${input.lightingAndGradePrompt}.`,
    PERSONAL_NO_BGM_AUDIO_CONTRACT_EN
  ].join(' ');

  const recipePublishedResolution: '720p' | '1080p' =
    input.resolution === '1080p' ? '1080p' : '720p';

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
          resolution: recipePublishedResolution
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
      badgeKo: '내 원본 사진 비공개 · 다음 사람 사진으로 자동 전환',
      badgeEn: 'Original Selfie Protected · Auto-Swapped for Buyers',
      labelKo: '주인공 얼굴 사진',
      labelEn: 'Protagonist Face Photo',
      detailKo:
        '내가 올렸던 원본 셀카 사진은 템플릿에 절대 남지 않고, 다음 제작자의 사진이 들어가는 빈자리로 바뀝니다. 내가 완성한 영상만 예시 영상으로 공개됩니다.',
      detailEn:
        'Your original selfie is never shared; only your finished video is shown as the public preview.'
    },
    {
      key: 'camera_and_motion',
      status: 'locked_signature',
      badgeKo: '영상 구도 · 무빙 고정',
      badgeEn: 'Camera & Motion Locked',
      labelKo: '카메라 움직임과 화면 비율',
      labelEn: 'Camera Movement & Aspect Ratio',
      detailKo: `다른 사람이 내 템플릿으로 만들 때도 내가 만든 영상과 똑같은 구도와 길이(${input.aspect}, ${input.durationSeconds}초)로 자연스럽게 완성됩니다.`,
      detailEn: `Every buyer gets the exact same camera movement and ${input.durationSeconds}s pacing (${input.aspect}).`
    },
    {
      key: 'lighting_and_grade',
      status: 'locked_signature',
      badgeKo: '조명 · 색감 분위기 고정',
      badgeEn: 'Lighting & Mood Locked',
      labelKo: '영상 조명과 색감 분위기',
      labelEn: 'Lighting & Color Mood',
      detailKo: '이 영상만의 매력적인 조명과 색감 톤이 흔들리지 않도록 그대로 유지됩니다.',
      detailEn: 'Preserves the signature lighting and color atmosphere of your video.'
    },
    {
      key: 'identity_anchor_pipeline',
      status: 'locked_signature',
      badgeKo: '얼굴 닮음새 보호 자동 적용',
      badgeEn: 'Likeness Protection Active',
      labelKo: '얼굴 닮음새 보호 과정',
      labelEn: 'Facial Likeness Protection',
      detailKo: input.lightingRiskForFace
        ? '조명이 강한 장면이라 다른 사람이 만들 때도 2가지 얼굴 시안 중 더 닮은 쪽을 먼저 고른 뒤 영상을 완성하도록 자동 보호됩니다.'
        : '첫 장면에서 내 얼굴을 자연스럽게 먼저 잡은 뒤 영상으로 이어지는 과정이 그대로 적용됩니다.',
      detailEn: input.lightingRiskForFace
        ? 'Automatically lets future buyers pick between two facial likeness previews before animating.'
        : 'Locks the two-step likeness protection process for future buyers.'
    },
    {
      key: 'styling_outfit',
      status: input.lockOutfitAsSignature ? 'locked_signature' : 'open_user_reference',
      badgeKo: input.lockOutfitAsSignature ? '내 의상 스타일로 고정' : '다른 사람 옷 사진 첨부 허용',
      badgeEn: input.lockOutfitAsSignature ? 'Keep My Outfit Style' : 'Allow Buyer Outfit Photo',
      labelKo: '의상 · 헤어 스타일',
      labelEn: 'Outfit & Hair Style',
      detailKo: input.lockOutfitAsSignature
        ? '다른 사람이 정면 사진 1장만 올리면 내가 완성한 이 의상 스타일 그대로 입고 주인공이 됩니다.'
        : '기본은 내 의상 스타일로 나오지만, 다른 사람이 원하면 자기 옷 사진을 올려 갈아입힐 수 있게 열어 둡니다.',
      detailEn: input.lockOutfitAsSignature
        ? 'Buyers wear your exact curated outfit style with just one selfie.'
        : 'Buyers can either use your default outfit or upload their own outfit photo.'
    },
    {
      key: 'scene_backdrop',
      status: input.lockBackdropAsSignature ? 'locked_signature' : 'open_user_reference',
      badgeKo: input.lockBackdropAsSignature ? '내 배경 공간으로 고정' : '다른 사람 배경·소품 변경 허용',
      badgeEn: input.lockBackdropAsSignature ? 'Keep My Backdrop' : 'Allow Buyer Backdrop Photo',
      labelKo: '배경 공간 · 소품 분위기',
      labelEn: 'Backdrop & Props',
      detailKo: input.lockBackdropAsSignature
        ? '영상 속 배경 공간과 분위기가 그대로 유지되어 누구나 같은 장소에서 찍은 것처럼 나옵니다.'
        : '다른 사람이 원하면 배경이나 손에 든 소품 사진을 첨부해 바꿀 수 있게 열어 둡니다.',
      detailEn: input.lockBackdropAsSignature
        ? 'Keeps the backdrop and setting fixed for all buyers.'
        : 'Allows buyers to attach their own backdrop or prop reference image.'
    }
  ];

  const resolutionTiers = quoteVideoResolutionTiers({
    seconds: input.durationSeconds,
    aspect: input.aspect
  });

  return {
    ok: true,
    slug: input.slugCandidate,
    selectedResolution: input.resolution,
    resolutionTiers,
    recipe: checked.recipe,
    sceneLockSpec,
    freezeMatrix,
    personalToTemplateSummary: {
      personalRenderRoleKo:
        '먼저 내 사진과 레퍼런스 영상으로 완성한 결과물은 내 소장용 영상이 되며, 템플릿으로 등록하면 다른 사람들에게 보여주는 대표 예시 영상으로 쓰입니다.',
      templateBuyerExperienceKo: input.lockOutfitAsSignature && input.lockBackdropAsSignature
        ? '다른 사람은 복잡한 설명 없이 정면 사진 1장만 올리면 내가 만든 분위기·의상 그대로 주인공이 됩니다.'
        : '다른 사람은 정면 사진 1장으로 바로 만들거나, 내가 열어 둔 의상·배경 칸에 자기 사진을 올려 맞춤 제작할 수 있습니다.',
      privacyGuaranteeKo:
        '내가 올린 원본 셀카 사진은 템플릿에 절대 남지 않으며, 완성된 영상만 예시로 보여집니다.'
    }
  };
}

export interface PresetReferenceScenario {
  id: 'seoul-night-runway' | 'vintage-camcorder-interview' | 'luxury-beauty-closeup';
  badgeKo: string;
  badgeEn: string;
  cameraSummaryKo: string;
  lightingSummaryKo: string;
  stylingSummaryKo: string;
  backdropSummaryKo: string;
  providerUsd: number;
  input: ReferenceSceneInput;
}

export const PRESET_REFERENCE_SCENARIOS: readonly PresetReferenceScenario[] = [
  {
    id: 'seoul-night-runway',
    badgeKo: '밤거리 플래시 런웨이 (10초)',
    badgeEn: 'Night Flash Street Runway (10s)',
    cameraSummaryKo: '걸어 나오는 주인공을 따라가다 카메라 플래시가 터지며 클로즈업되는 구도',
    lightingSummaryKo: '밤거리 조명과 카메라 플래시가 어우러진 선명하고 힙한 색감',
    stylingSummaryKo: '시크한 블랙 롱코트와 실버 이어커프 스타일',
    backdropSummaryKo: '비에 젖은 도심 밤거리 골목과 플래시 불빛',
    providerUsd: 2.31,
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
    badgeKo: '90년대 캠코더 인터뷰 (8초)',
    badgeEn: '90s Camcorder Street Interview (8s)',
    cameraSummaryKo: '눈높이에서 마이크를 건네며 자연스럽게 줌인되는 레트로 캠코더 구도',
    lightingSummaryKo: '따뜻한 오후 햇살과 90년대 아날로그 필름 색감',
    stylingSummaryKo: '빈티지 데님 자켓과 화이트 티셔츠, 레트로 헤드폰',
    backdropSummaryKo: '따스한 햇살이 비치는 레코드샵 앞 거리',
    providerUsd: 1.85,
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
    badgeKo: '햇살 스튜디오 클로즈업 (6초)',
    badgeEn: 'Sunlight Beauty Studio Close-Up (6s)',
    cameraSummaryKo: '머릿결이 살랑이며 카메라를 향해 부드럽게 미소 짓는 인물 클로즈업',
    lightingSummaryKo: '피부결이 가장 맑고 깨끗하게 나오는 스튜디오 자연광 조명',
    stylingSummaryKo: '아이보리 실크 탑과 맑고 투명한 데일리 메이크업',
    backdropSummaryKo: '은은한 햇살 그림자가 비치는 화이트 스튜디오',
    providerUsd: 1.39,
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

export interface MakerDbTableLinkage {
  table: 'platform_creators' | 'platform_formats' | 'prompt_items' | 'render_job_recipes' | 'platform_settlements';
  migration: string;
  roleKo: string;
  keyColumns: readonly string[];
}

/**
 * Documents and verifies how the "나만의 영상 제작하기 -> 템플릿 수익화" flow connects to the live Supabase schema.
 */
export const MAKER_DB_ARCHITECTURE_READINESS: readonly MakerDbTableLinkage[] = [
  {
    table: 'platform_creators',
    migration: '0046_core_creator_platform.sql + 0073_core_maker_payout.sql',
    roleKo: '메이커(AI 크리에이티브) 프로필·핸들(@handle) 및 80% 정산 자격(`payout: external | company`) 관리',
    keyColumns: ['user_id', 'active', 'handle', 'display_name', 'public_profile', 'payout']
  },
  {
    table: 'platform_formats',
    migration: '0046 + 0059_core_maker_recipes.sql + 0073',
    roleKo: '유저가 완성한 레퍼런스 기반 레시피(`recipe_v2`), 희망 추가 수익금(`royalty_krw` 0~5,000원), 공개 범위(`disclosure`), 카탈로그 연결(`template_id`) 저장',
    keyColumns: ['id', 'user_id', 'recipe_v2', 'royalty_krw', 'disclosure', 'presentation', 'template_id', 'status']
  },
  {
    table: 'prompt_items',
    migration: '0015 + 0018 + 0059 + 0060',
    roleKo: '공개된 템플릿 카드(`price_krw = floorKrw + royalty_krw`, `author_handle`, 예시 영상 `media`) 노출',
    keyColumns: ['id', 'slug', 'price_krw', 'price_cents', 'author_handle', 'maker_profile', 'media']
  },
  {
    table: 'render_job_recipes',
    migration: '0059_core_maker_recipes.sql',
    roleKo: '다른 유저가 이 템플릿으로 제작할 때 그 시점의 레시피 스냅샷을 고정해 안전하게 실행',
    keyColumns: ['render_id', 'format_id', 'recipe_v2']
  },
  {
    table: 'platform_settlements',
    migration: '0046_core_creator_platform.sql',
    roleKo: '누군가 내 템플릿으로 결제·제작을 완료할 때마다 순이익(매출 - 부가세 - PG수수료 - 실측 원가)의 80%를 `creator_due`로 자동 원장 기록 (`creator_due + platform_margin = margin`)',
    keyColumns: ['render_id', 'payment_id', 'creator_id', 'revenue', 'tax', 'fees', 'provider_cost', 'margin', 'creator_due', 'platform_margin']
  }
] as const;
