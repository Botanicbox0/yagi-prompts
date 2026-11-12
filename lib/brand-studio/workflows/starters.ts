/**
 * Built-in Starter Workflows (`docs/STUDIO-PRO-SUITE-V4.md` §1.5), led by #1 Flagship
 * `캐릭터 시트 메이커` (`slug: 'character-sheet-maker'`).
 *
 * Client-safe: pure data + credit estimation helpers only.
 */
import { creditsOf } from '@/lib/brand-studio/credits';
import { estimateImageUsd, estimateVideoUsd, type StudioVideoResolution } from '@/lib/brand-studio/models';
import type { WorkflowRecipe, WorkflowStep, WorkflowWire } from './contracts';

/** Approximate KRW-per-USD studio conversion matching `usage-rate.ts` for client-safe card display. */
const DISPLAY_KRW_PER_USD = 1450;

export function estimateStepCredits(step: WorkflowStep, hasImageRef = true): number {
  if (step.onlyWhenNoImageRef && hasImageRef) return 0;
  if (step.medium === 'video') {
    const res: StudioVideoResolution =
      step.resolution === '1080p' ? '1080p' : step.resolution === '480p' || step.resolution === 'draft' ? '480p' : '720p';
    const hasVideoRef = step.useReferenceSlots.includes('video1');
    const usd = estimateVideoUsd({
      resolution: res,
      seconds: step.seconds ?? 5,
      referenceVideoSeconds: hasVideoRef ? 5 : 0,
    });
    return creditsOf(Math.ceil(usd * DISPLAY_KRW_PER_USD));
  }
  const refs = step.useReferenceSlots.includes('image1') || step.useHeroOutputAsRef ? 1 : 0;
  const usd =
    estimateImageUsd({
      model: step.model,
      resolution: step.resolution,
      references: refs,
    }) * (step.count ?? 1);
  return creditsOf(Math.ceil(usd * DISPLAY_KRW_PER_USD));
}

export function estimateRecipeCredits(
  recipe: WorkflowRecipe,
  options?: { hasImageRef?: boolean; selectedPacks?: readonly string[] },
): number {
  const hasImageRef = options?.hasImageRef ?? true;
  const packSet = options?.selectedPacks ? new Set(options.selectedPacks) : null;
  let total = 0;
  for (const step of recipe.steps) {
    if (step.onlyWhenNoImageRef && hasImageRef) continue;
    if (step.packId && packSet && !packSet.has(step.packId)) continue;
    total += estimateStepCredits(step, hasImageRef);
  }
  return Math.max(1, total);
}

const STARTER_TIMESTAMP = '2026-11-13T00:00:00.000Z';

const CHARACTER_SHEET_RECIPE: WorkflowRecipe = {
  version: 1,
  guide:
    '기준 캐릭터 정면 사진(@image1)을 고르거나 캐릭터·착장 설명을 입력하면, 단일 16:9 와이드 캔버스 3면 턴어라운드(정면·측면·후면)와 4종 표정 시트, 의상·소품 디테일 시트를 일관된 얼굴·실루엣으로 생성해 공유 폴더에 자동 정리합니다.',
  guideEn:
    'Attach a reference character photo (@image1) or write a character brief to generate a single-canvas 16:9 3-view orthographic turnaround, a 4-panel expression sheet, and an outfit detail sheet into a shared team folder.',
  defaultFolderPattern: '캐릭터 시트 · {subject}',
  defaultFolderPatternEn: 'Character Sheet · {subject}',
  consistencyCheck: 'character_sheet',
  slots: [
    {
      key: 'image1',
      kind: 'image_ref',
      label: '기준 캐릭터 이미지 (@image1)',
      labelEn: 'Character reference (@image1)',
      required: false,
      role: 'person',
    },
    {
      key: 'subject',
      kind: 'text',
      label: '캐릭터 이름',
      labelEn: 'Character name',
      placeholder: '예: 소라, 루카스, 26FW 버추얼 모델',
      placeholderEn: 'e.g. Sora, Lucas, 26FW Campaign Persona',
      required: false,
      defaultValue: '기본 캐릭터',
    },
    {
      key: 'prompt',
      kind: 'textarea',
      label: '캐릭터 · 의상 · 무드 설명',
      labelEn: 'Character, wardrobe & mood direction',
      placeholder:
        '예: 20대 중반 단정한 쇼트컷, 차콜 울 테일러드 재킷과 화이트 셔츠, 실버 이어커프, 자연스러운 피부 질감과 차분한 스튜디오 무드',
      placeholderEn:
        'e.g. Mid-20s tailored charcoal wool blazer over crisp white shirt, minimal silver ear cuff, natural skin texture, neutral daylight studio',
      required: false,
    },
    {
      key: 'outputs',
      kind: 'multiselect',
      label: '출력 구성 선택',
      labelEn: 'Sheets to generate',
      required: true,
      options: [
        {
          id: 'turnaround',
          label: '전신 3면 턴어라운드 (정면·측면·후면)',
          labelEn: 'Full-body 3-view turnaround (Front · Side · Back)',
          defaultSelected: true,
        },
        {
          id: 'expressions',
          label: '핵심 표정 4종 시트',
          labelEn: '4-panel core expression sheet',
          defaultSelected: true,
        },
        {
          id: 'details',
          label: '의상·소품 디테일 컷',
          labelEn: 'Wardrobe & prop detail sheet',
          defaultSelected: true,
        },
      ],
    },
    {
      key: 'folderName',
      kind: 'folder',
      label: '저장할 공유 폴더명',
      labelEn: 'Target shared folder',
      placeholder: '캐릭터 시트 · {이름}',
      placeholderEn: 'Character Sheet · {name}',
      required: false,
    },
  ],
  steps: [
    {
      id: 'hero_front',
      label: '기준 정면 마스터 컷 생성 (텍스트 전용 실행 시)',
      labelEn: 'Anchor front reference portrait (when no @image1)',
      onlyWhenNoImageRef: true,
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '3:4',
      resolution: '2K',
      count: 1,
      useReferenceSlots: [],
      promptTemplate:
        'Reference authority: Master character anchor portrait for {subject}. Full-body standing front view on clean #FFFFFF studio seamless background, neutral soft key + fill studio lighting, natural skin micro-texture without plastic gloss, crisp tailored wardrobe silhouette and clear footwear. Direction: {prompt}',
    },
    {
      id: 'turnaround',
      label: '전신 3면 턴어라운드 시트 (16:9 단일 캔버스)',
      labelEn: 'Full-body 3-view orthographic turnaround (16:9 single canvas)',
      packId: 'turnaround',
      useHeroOutputAsRef: true,
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '16:9',
      resolution: '2K',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        'Single-canvas orthographic character turnaround sheet for {subject} strictly locked to @image1 identity and wardrobe: Front · 90° Side · Back full-body views side by side on clean #FFFFFF studio seamless, identical facial structure, hair silhouette, height line, garment proportions, footwear, and neutral studio lighting. Natural skin texture, zero background clutter. {prompt}',
    },
    {
      id: 'expressions',
      label: '핵심 표정 4종 일관성 시트',
      labelEn: '4-panel reference-locked expression sheet',
      packId: 'expressions',
      useHeroOutputAsRef: true,
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        '4-panel expression grid for {subject} on clean #FFFFFF studio seamless: (1) calm neutral gaze, (2) subtle warm micro-smile, (3) focused off-axis side gaze, (4) lively candid expression, strictly preserving @image1 face structure, hair silhouette, skin tone, and collar/outfit details under uniform soft studio lighting. {prompt}',
    },
    {
      id: 'details',
      label: '의상 · 소재 · 소품 디테일 시트',
      labelEn: 'Wardrobe, material & prop detail sheet',
      packId: 'details',
      useHeroOutputAsRef: true,
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '4:3',
      resolution: '2K',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        'Editorial wardrobe and accessory callout sheet for {subject} strictly matching @image1 outfit: structured multi-panel close-ups of fabric weave, collar and lapel stitching, sleeve cuff hardware, and signature accessory details on clean #FFFFFF studio seamless, crisp macro studio lighting, true-to-reference colors. {prompt}',
    },
  ],
};

const PRODUCT_PACKSHOT_RECIPE: WorkflowRecipe = {
  version: 1,
  guide:
    '제품 원본 사진(@image1) 1장으로 이커머스 상세페이지와 룩북에 바로 쓸 수 있는 정면 히어로 팩샷, 45도 입체 앵글, 소재·텍스처 매크로 컷을 한 번에 생성합니다.',
  guideEn:
    'Turn one product photo (@image1) into a front hero packshot, a 45-degree dimensional angle, and a macro texture callout shot ready for PDPs and campaign decks.',
  defaultFolderPattern: '제품 팩샷 · {subject}',
  defaultFolderPatternEn: 'Packshot Sheet · {subject}',
  consistencyCheck: 'none',
  slots: [
    {
      key: 'image1',
      kind: 'image_ref',
      label: '기준 제품 사진 (@image1)',
      labelEn: 'Product photo (@image1)',
      required: false,
      role: 'product',
    },
    {
      key: 'subject',
      kind: 'text',
      label: '제품명',
      labelEn: 'Product name',
      placeholder: '예: 세럼 50ml 보틀, 미니 크로스백',
      placeholderEn: 'e.g. Glass Serum 50ml, Leather Mini Bag',
      required: false,
      defaultValue: '주력 제품',
    },
    {
      key: 'prompt',
      kind: 'textarea',
      label: '배경 톤 · 재질 · 연출 포인트',
      labelEn: 'Surface, lighting & styling direction',
      placeholder: '예: 매트한 라이트 스톤 단상 위, 자연광 그림자, 라벨 타이포그래피와 유리 굴절 선명하게 유지',
      placeholderEn: 'e.g. Honed limestone plinth, crisp morning side light, preserve exact bottle geometry and label',
      required: false,
    },
    {
      key: 'outputs',
      kind: 'multiselect',
      label: '출력 구성 선택',
      labelEn: 'Angles to generate',
      required: true,
      options: [
        { id: 'front_hero', label: '정면 히어로 팩샷 (4:5)', labelEn: 'Front hero packshot (4:5)', defaultSelected: true },
        { id: 'angle_45', label: '45도 입체 스튜디오 컷 (1:1)', labelEn: '45° dimensional studio cut (1:1)', defaultSelected: true },
        { id: 'macro_detail', label: '제형 · 소재 디테일 클로즈업 (4:3)', labelEn: 'Material & texture macro (4:3)', defaultSelected: true },
      ],
    },
    {
      key: 'folderName',
      kind: 'folder',
      label: '저장할 공유 폴더명',
      labelEn: 'Target shared folder',
      placeholder: '제품 팩샷 · {제품명}',
      placeholderEn: 'Packshot Sheet · {name}',
      required: false,
    },
  ],
  steps: [
    {
      id: 'front_hero',
      label: '정면 히어로 팩샷 (4:5)',
      labelEn: 'Front hero packshot (4:5)',
      packId: 'front_hero',
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '4:5',
      resolution: '2K',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        'Commercial studio front hero packshot of {subject} strictly preserving @image1 geometry, proportions, cap, and surface finish. Clean architectural studio backdrop (#F4F4F5 to #FFFFFF soft gradient), controlled softbox rim light, crisp contact shadow. {prompt}',
    },
    {
      id: 'angle_45',
      label: '45도 입체 스튜디오 앵글 (1:1)',
      labelEn: '45° dimensional studio angle (1:1)',
      packId: 'angle_45',
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        'Three-quarter 45-degree editorial product photograph of {subject} locked to @image1 silhouette, color accuracy, and branding proportions. Minimalist stone podium, directional natural window light, subtle specular highlights. {prompt}',
    },
    {
      id: 'macro_detail',
      label: '소재 · 마감 매크로 디테일 컷 (4:3)',
      labelEn: 'Material & finish macro detail (4:3)',
      packId: 'macro_detail',
      medium: 'image',
      model: 'nano-banana-pro',
      aspect: '4:3',
      resolution: '2K',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        'Optical macro detail photograph of {subject} faithful to @image1 material finish, hardware edge, and tactile surface texture. Shallow depth of field, crisp studio micro-contrast, zero distortion. {prompt}',
    },
  ],
};

const REFERENCE_VIDEO_AD_RECIPE: WorkflowRecipe = {
  version: 1,
  guide:
    '레퍼런스 영상(@video1)의 카메라 호흡과 컷 리듬을 설계도로 읽고, 우리 브랜드 제품·인물 이미지(@image1)를 주인공으로 바꾼 9:16 숏폼 3컷 광고 변주(훅 · 디테일 · 클로징)를 음악 없는 현장음(Strict No-BGM)으로 생성합니다.',
  guideEn:
    'Extract camera pacing and shot structure from a reference clip (@video1) and generate 3 vertical 9:16 ad variations (Hook, Product Detail, Hero Closing) starring your brand subject (@image1) with clean foley/ambience only.',
  defaultFolderPattern: '광고 변주 3컷 · {subject}',
  defaultFolderPatternEn: '3-Cut Ad Pack · {subject}',
  consistencyCheck: 'none',
  slots: [
    {
      key: 'video1',
      kind: 'video_ref',
      label: '레퍼런스 영상 (@video1, 선택)',
      labelEn: 'Reference video (@video1, optional)',
      required: false,
    },
    {
      key: 'image1',
      kind: 'image_ref',
      label: '우리 제품 · 인물 이미지 (@image1)',
      labelEn: 'Brand product or model (@image1)',
      required: false,
      role: 'product',
    },
    {
      key: 'subject',
      kind: 'text',
      label: '캠페인 · 제품명',
      labelEn: 'Campaign or product name',
      placeholder: '예: 26SS 글로우 쿠션 런칭',
      placeholderEn: 'e.g. 26SS Cushion Launch',
      required: false,
      defaultValue: '신규 캠페인',
    },
    {
      key: 'prompt',
      kind: 'textarea',
      label: '바꿀 연출 내용 · 핵심 메시지',
      labelEn: 'Scene adaptation & visual direction',
      placeholder: '예: 차가운 아침 자연광 욕실 무드로 바꾸고, 제품 클로즈업에서 유리 반사광 강조',
      placeholderEn: 'e.g. Morning daylight vanity setting, crisp glass reflections on the hero bottle',
      required: false,
    },
    {
      key: 'outputs',
      kind: 'multiselect',
      label: '생성할 3컷 변주 선택',
      labelEn: 'Ad cuts to generate',
      required: true,
      options: [
        { id: 'cut_hook', label: '컷 1 · 시선 고정 오프닝 훅 (9:16 · 5초)', labelEn: 'Cut 1 · Opening visual hook (9:16 · 5s)', defaultSelected: true },
        { id: 'cut_detail', label: '컷 2 · 제품 · 제형 포커스 무빙 (9:16 · 5초)', labelEn: 'Cut 2 · Tactile product motion (9:16 · 5s)', defaultSelected: true },
        { id: 'cut_outro', label: '컷 3 · 브랜드 무드 클로징 히어로 (9:16 · 5초)', labelEn: 'Cut 3 · Hero closing lockup (9:16 · 5s)', defaultSelected: true },
      ],
    },
    {
      key: 'folderName',
      kind: 'folder',
      label: '저장할 공유 폴더명',
      labelEn: 'Target shared folder',
      placeholder: '광고 변주 3컷 · {캠페인명}',
      placeholderEn: '3-Cut Ad Pack · {name}',
      required: false,
    },
  ],
  steps: [
    {
      id: 'cut_hook',
      label: '컷 1 · 오프닝 훅 (9:16 · 5초)',
      labelEn: 'Cut 1 · Opening visual hook (9:16 · 5s)',
      packId: 'cut_hook',
      medium: 'video',
      model: 'seedance-2.5',
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'ambient',
      count: 1,
      useReferenceSlots: ['video1', 'image1'],
      promptTemplate:
        'Reference authority: Follow the opening camera rhythm while featuring {subject} (@image1). 0.0s–2.2s dynamic push-in from off-axis three-quarter angle establishing spatial depth and crisp lighting; 2.2s–5.0s hard cut to tactile hero reveal. Natural foley and room ambience only, strict no BGM. {prompt}',
    },
    {
      id: 'cut_detail',
      label: '컷 2 · 디테일 포커스 (9:16 · 5초)',
      labelEn: 'Cut 2 · Product detail motion (9:16 · 5s)',
      packId: 'cut_detail',
      medium: 'video',
      model: 'seedance-2.5',
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'ambient',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        '0.0s–2.5s macro tracking glide across {subject} (@image1) highlighting authentic material micro-texture and controlled specular light; 2.5s–5.0s match cut to medium angled composition with clean negative space. Subtle tactile foley only, strict no BGM. {prompt}',
    },
    {
      id: 'cut_outro',
      label: '컷 3 · 히어로 클로징 (9:16 · 5초)',
      labelEn: 'Cut 3 · Hero closing frame (9:16 · 5s)',
      packId: 'cut_outro',
      medium: 'video',
      model: 'seedance-2.5',
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'ambient',
      count: 1,
      useReferenceSlots: ['image1'],
      promptTemplate:
        '0.0s–5.0s composed slow dolly-out hero lockup of {subject} (@image1) in cohesive architectural studio lighting, balanced shadows anchored to the surface, calm editorial finish ready for end-card typography. Clean room tone only, strict no BGM. {prompt}',
    },
  ],
};

function buildStarterWire(input: {
  slug: string;
  title: string;
  titleEn: string;
  summary: string;
  summaryEn: string;
  category: WorkflowWire['category'];
  recipe: WorkflowRecipe;
}): WorkflowWire {
  const visibleSteps = input.recipe.steps.filter((s) => !s.onlyWhenNoImageRef);
  return {
    id: `starter:${input.slug}`,
    slug: input.slug,
    title: input.title,
    titleEn: input.titleEn,
    summary: input.summary,
    summaryEn: input.summaryEn,
    category: input.category,
    source: 'starter',
    starter: true,
    revision: 1,
    stepCount: visibleSteps.length,
    estimatedCredits: estimateRecipeCredits(input.recipe, { hasImageRef: true }),
    recipe: input.recipe,
    updatedAt: STARTER_TIMESTAMP,
  };
}

export const STARTER_WORKFLOWS: readonly WorkflowWire[] = [
  buildStarterWire({
    slug: 'character-sheet-maker',
    title: '캐릭터 시트 메이커',
    titleEn: 'Character Sheet Maker',
    summary:
      '기준 인물·캐릭터 사진 1장(또는 설명)으로 16:9 전신 3면 턴어라운드, 핵심 표정 4종 시트, 의상·소품 디테일 컷을 비전 일관성 검수와 함께 공유 폴더 세트로 완성합니다.',
    summaryEn:
      'Generate a coherent 16:9 3-view full-body turnaround, 4-panel expression sheet, and wardrobe detail sheet from one character reference with vision consistency verification.',
    category: 'character',
    recipe: CHARACTER_SHEET_RECIPE,
  }),
  buildStarterWire({
    slug: 'product-packshot-sheet',
    title: '제품 다각도 팩샷 시트',
    titleEn: 'Multi-Angle Product Packshot Sheet',
    summary:
      '제품 사진 1장의 형태와 라벨을 고정한 채 정면 히어로 팩샷(4:5), 45도 입체 컷(1:1), 소재 매크로 디테일 컷(4:3)을 한 번에 뽑아 공유 폴더에 담습니다.',
    summaryEn:
      'Lock your product geometry and label from one photo to produce a 4:5 front hero packshot, 1:1 45° angle, and 4:3 macro texture shot.',
    category: 'product',
    recipe: PRODUCT_PACKSHOT_RECIPE,
  }),
  buildStarterWire({
    slug: 'reference-video-ad-pack',
    title: '레퍼런스 영상 리버스 → 3컷 광고 변주',
    titleEn: 'Reference Video Reverse → 3-Cut Ad Pack',
    summary:
      '참고 영상의 컷 전환과 카메라 움직임을 분석해 우리 브랜드 제품이 주인공인 9:16 오프닝 훅·디테일·클로징 3컷 영상을 일괄 생성합니다.',
    summaryEn:
      'Reverse-engineer a reference clip into 3 vertical 9:16 brand ad cuts (Opening Hook, Tactile Detail, Hero Closing) with clean foley sound.',
    category: 'video',
    recipe: REFERENCE_VIDEO_AD_RECIPE,
  }),
] as const;

export function findStarterWorkflow(idOrSlug: string): WorkflowWire | null {
  const clean = idOrSlug.startsWith('starter:') ? idOrSlug.slice('starter:'.length) : idOrSlug;
  return STARTER_WORKFLOWS.find((w) => w.slug === clean || w.id === idOrSlug) ?? null;
}
