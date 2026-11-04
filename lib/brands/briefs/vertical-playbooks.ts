import { z } from 'zod';
import type { OnboardingCategory } from '@/lib/brands/identity/onboarding';
import type {
  DeliverableMedium,
  DeliverableUse,
  ShotAspect,
  ShotCutKind
} from './schema';

/**
 * Design Principle Attachment Control & Fashion · Beauty · F&B Vertical Marketer Playbooks
 * (`lib/brands/briefs/vertical-playbooks.ts`)
 *
 * Synthesizes:
 * 1. Google Pomelli's Product Photoshoot 4-Shot Template Matrix (`Studio` / `Ingredients` / `In-Use` / `Contextual`)
 *    and bottom composer pills (`+ Image`, `+ Sizes`, `+ Elements / Design Principles`).
 * 2. Explicit Brand Design Principle Attachment (`full_attach` | `custom_partial` | `unbound_free`)
 *    so marketers, PMs, and creative directors can choose whether to strictly lock Brand DNA
 *    or detach palette/aesthetic locks for free concept exploration.
 * 3. Tailored workflows for Fashion, Beauty, and F&B marketers/PMs/directors inspired by top
 *    AI creative startups (Botika on-model lookbook, Flair/Pebblely ingredient & prop staging,
 *    Photoroom multi-ratio PDP/ad packs, Arcads 3-second hook variations).
 */

export const DESIGN_PRINCIPLE_ATTACHMENT_MODES = [
  'full_attach',
  'custom_partial',
  'unbound_free'
] as const;

export type DesignPrincipleAttachmentMode =
  (typeof DESIGN_PRINCIPLE_ATTACHMENT_MODES)[number];

export const DESIGN_PRINCIPLE_KEYS = [
  'logoLock',
  'colorPalette',
  'typographyGrid',
  'aestheticLine',
  'modelPersona',
  'brandTaboos'
] as const;

export type DesignPrincipleKey = (typeof DESIGN_PRINCIPLE_KEYS)[number];

export const DesignPrincipleAttachmentSchema = z.object({
  mode: z.enum(DESIGN_PRINCIPLE_ATTACHMENT_MODES).default('full_attach'),
  logoLock: z.boolean().default(true),
  colorPalette: z.boolean().default(true),
  typographyGrid: z.boolean().default(true),
  aestheticLine: z.boolean().default(true),
  modelPersona: z.boolean().default(true),
  brandTaboos: z.boolean().default(true),
  freeExplorationNote: z.string().trim().max(240).optional()
});

export type DesignPrincipleAttachment = z.infer<
  typeof DesignPrincipleAttachmentSchema
>;

export interface DesignPrincipleChipMeta {
  key: DesignPrincipleKey;
  labelKo: string;
  labelEn: string;
  attachedDescKo: string;
  attachedDescEn: string;
  detachedDescKo: string;
  detachedDescEn: string;
}

export const DESIGN_PRINCIPLE_CHIPS: readonly DesignPrincipleChipMeta[] = [
  {
    key: 'logoLock',
    labelKo: '로고·심볼 1:1 고정',
    labelEn: 'Logo 1:1 Lock',
    attachedDescKo: '워드마크 철자·심볼 비례·최소 여백(1.5x) 강제 잠금',
    attachedDescEn: 'Locks wordmark spelling, symbol ratio, and 1.5x clearspace',
    detachedDescKo: '로고 각인 없이 무지·컨셉 오브제로 자유 생성',
    detachedDescEn: 'Generates unbranded concept objects without logo lock'
  },
  {
    key: 'colorPalette',
    labelKo: '브랜드 컬러 팔레트',
    labelEn: 'Brand Color Palette',
    attachedDescKo: '브랜드 지정 색상 대역(Owned Hue) 및 배경/포인트 HEX 준수',
    attachedDescEn: 'Enforces brand owned hue band and primary HEX swatches',
    detachedDescKo: '기존 브랜드 컬러 제한 해제 (시즌 신규 컬러·보색 실험 허용)',
    detachedDescEn: 'Unlocks palette for seasonal or experimental color exploration'
  },
  {
    key: 'typographyGrid',
    labelKo: '서체·카피 세이프존',
    labelEn: 'Typography & Safe-Area',
    attachedDescKo: '헤드라인 서체 위계 및 상하단 15% 배너 카피 여백 확보',
    attachedDescEn: 'Preserves brand type hierarchy and 15% copy safe-area',
    detachedDescKo: '여백 제약 없는 풀프레임 클로즈업·자유 구도 허용',
    detachedDescEn: 'Allows full-bleed framing without banner copy margin locks'
  },
  {
    key: 'aestheticLine',
    labelKo: '선택된 미감 기조 (A/B/C)',
    labelEn: 'Active Aesthetic Line (A/B/C)',
    attachedDescKo: '현재 선택된 미감 기조(렌즈·색온도·공간 재질) 자동 결합',
    attachedDescEn: 'Applies the active Aesthetic Line optics, Kelvin, and surface',
    detachedDescKo: '기존 기조 A/B/C에서 벗어나 완전히 새로운 조명·공간 탐색',
    detachedDescEn: 'Detaches Aesthetic Line A/B/C for fresh lighting & set tests'
  },
  {
    key: 'modelPersona',
    labelKo: '모델 페르소나·매트 피부',
    labelEn: 'Model Persona & Matte Skin',
    attachedDescKo: '브랜드 지정 모델 분위기 및 자연스러운 매트 피부 질감 고정',
    attachedDescEn: 'Locks consistent brand model traits and natural matte skin',
    detachedDescKo: '다양한 신규 모델 캐스팅·연령대·스타일링 자유 테스트',
    detachedDescEn: 'Opens casting for new model personas and styling directions'
  },
  {
    key: 'brandTaboos',
    labelKo: '브랜드 절대 금기 방어',
    labelEn: 'Brand Taboo Guard',
    attachedDescKo: '온보딩에서 지정한 브랜드 금지 표현 3항목 자동 차단',
    attachedDescEn: 'Blocks all 3 brand-defined visual taboos and negative rules',
    detachedDescKo: '법적·초상권 안전장치만 유지하고 연출 금기어는 일시 해제',
    detachedDescEn: 'Keeps legal/consent safety while relaxing stylistic taboos'
  }
] as const;

export function createAttachmentPreset(
  mode: DesignPrincipleAttachmentMode
): DesignPrincipleAttachment {
  if (mode === 'unbound_free') {
    return {
      mode: 'unbound_free',
      logoLock: false,
      colorPalette: false,
      typographyGrid: false,
      aestheticLine: false,
      modelPersona: false,
      brandTaboos: true
    };
  }
  if (mode === 'custom_partial') {
    return {
      mode: 'custom_partial',
      logoLock: true,
      colorPalette: false,
      typographyGrid: true,
      aestheticLine: false,
      modelPersona: true,
      brandTaboos: true
    };
  }
  return {
    mode: 'full_attach',
    logoLock: true,
    colorPalette: true,
    typographyGrid: true,
    aestheticLine: true,
    modelPersona: true,
    brandTaboos: true
  };
}

export function summarizeDesignPrincipleAttachment(
  raw?: Partial<DesignPrincipleAttachment> | null
): {
  attachment: DesignPrincipleAttachment;
  attachedKeys: DesignPrincipleKey[];
  detachedKeys: DesignPrincipleKey[];
  directiveSuffixKo: string;
  directiveSuffixEn: string;
} {
  const attachment = DesignPrincipleAttachmentSchema.parse(raw ?? {});
  const attachedKeys = DESIGN_PRINCIPLE_KEYS.filter((k) => attachment[k]);
  const detachedKeys = DESIGN_PRINCIPLE_KEYS.filter((k) => !attachment[k]);

  if (attachment.mode === 'unbound_free' || attachedKeys.length <= 1) {
    return {
      attachment,
      attachedKeys,
      detachedKeys,
      directiveSuffixKo:
        '[디자인 원칙 미적용 · 자유 탐색 모드: 기존 브랜드 컬러·미감 기조 제약을 해제하고 새로운 시각 컨셉을 자유롭게 탐색]',
      directiveSuffixEn:
        '[Unbound Free Exploration Mode: existing brand palette and aesthetic line locks detached for open concept exploration]'
    };
  }

  if (detachedKeys.length === 0) {
    return {
      attachment,
      attachedKeys,
      detachedKeys,
      directiveSuffixKo:
        '[브랜드 디자인 원칙 전체 연결: 로고 1:1·컬러 팔레트·타이포 여백·미감 기조·모델 페르소나·금기어 고정]',
      directiveSuffixEn:
        '[Full Brand DNA Attached: logo 1:1, color palette, typography safe-area, aesthetic line, model persona, and taboos locked]'
    };
  }

  const attachedLabelsEn = DESIGN_PRINCIPLE_CHIPS.filter((c) =>
    attachedKeys.includes(c.key)
  ).map((c) => c.labelEn);
  const detachedLabelsEn = DESIGN_PRINCIPLE_CHIPS.filter((c) =>
    detachedKeys.includes(c.key)
  ).map((c) => c.labelEn);

  const attachedLabelsKo = DESIGN_PRINCIPLE_CHIPS.filter((c) =>
    attachedKeys.includes(c.key)
  ).map((c) => c.labelKo);
  const detachedLabelsKo = DESIGN_PRINCIPLE_CHIPS.filter((c) =>
    detachedKeys.includes(c.key)
  ).map((c) => c.labelKo);

  return {
    attachment,
    attachedKeys,
    detachedKeys,
    directiveSuffixKo: `[선택적 디자인 원칙 연결 — 고정: ${attachedLabelsKo.join(', ')} | 자유 탐색 해제: ${detachedLabelsKo.join(', ')}]`,
    directiveSuffixEn: `[Custom Brand DNA Attach — Locked: ${attachedLabelsEn.join(', ')} | Unbound: ${detachedLabelsEn.join(', ')}]`
  };
}

/**
 * Pomelli-style 4 Product Photoshoot Shot Templates (`Studio` / `Ingredients` / `In-Use` / `Contextual`)
 */
export const POMELLI_SHOT_TEMPLATE_IDS = [
  'studio',
  'ingredients',
  'in_use',
  'contextual'
] as const;

export type PomelliShotTemplateId = (typeof POMELLI_SHOT_TEMPLATE_IDS)[number];

export interface PomelliShotTemplate {
  id: PomelliShotTemplateId;
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  subtitleKo: string;
  subtitleEn: string;
  previewImageUrl: string;
  cutKind: ShotCutKind;
  medium: DeliverableMedium;
  defaultAspect: ShotAspect;
  defaultUse: DeliverableUse;
  focalMm: number;
  lightColourK: number;
  lightModifier: string;
  spaceBackground: string;
  spaceSurface: string;
}

export const POMELLI_SHOT_TEMPLATES: readonly PomelliShotTemplate[] = [
  {
    id: 'studio',
    badgeKo: 'SHOT 01 · STUDIO',
    badgeEn: 'SHOT 01 · STUDIO',
    titleKo: '스튜디오 정물 히어로 (Studio Packshot)',
    titleEn: 'Studio Hero Packshot',
    subtitleKo: '단상·호리존 위에서 제품 실루엣과 전면 라벨을 왜곡 없이 깔끔하게 촬영',
    subtitleEn: 'Clean pedestal & seamless backdrop with zero label distortion',
    previewImageUrl: '/reel/cases/case-lookbook-still.jpg',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    defaultAspect: '4:5',
    defaultUse: 'catalog',
    focalMm: 85,
    lightColourK: 5500,
    lightModifier: 'dual diffused strip softboxes with crisp negative fill',
    spaceBackground: 'clean seamless architectural paper backdrop with generous margin',
    spaceSurface: 'honed limestone studio plinth'
  },
  {
    id: 'ingredients',
    badgeKo: 'SHOT 02 · INGREDIENTS & TEXTURE',
    badgeEn: 'SHOT 02 · INGREDIENTS & TEXTURE',
    titleKo: '원료 · 제형 · 원단 마크로 (Ingredients & Texture)',
    titleEn: 'Ingredients, Swatch & Texture Macro',
    subtitleKo: '뷰티 제형 스미어·원물, 패션 원단 직조·스티치, F&B 식재료·물방울 초근접 연출',
    subtitleEn: 'Cream smears, botanicals, fabric weave macro, or fresh culinary ingredients',
    previewImageUrl: '/reel/cases/case-beauty-still.jpg',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    defaultAspect: '1:1',
    defaultUse: 'feed',
    focalMm: 100,
    lightColourK: 5400,
    lightModifier: 'overhead diffused scrim with grazing side texture key light',
    spaceBackground: 'softly defocused botanical and raw material elements in brand palette',
    spaceSurface: 'wet brushed slate and frosted glass texture plate'
  },
  {
    id: 'in_use',
    badgeKo: 'SHOT 03 · IN USE & MODEL',
    badgeEn: 'SHOT 03 · IN USE & MODEL',
    titleKo: '모델 착장 · 사용 · 시식 컷 (In-Use & On-Model)',
    titleEn: 'In-Use & On-Model Lookbook',
    subtitleKo: '의류 핏·드레이프 착장, 스킨케어 발림·피부 결, F&B 핸드모델 페어링 연출',
    subtitleEn: 'On-model garment drape, skincare application glow, or hand-model dining',
    previewImageUrl: '/reel/lifestyle-1.jpg',
    cutKind: 'editorial_full_body',
    medium: 'editorial still',
    defaultAspect: '4:5',
    defaultUse: 'feed',
    focalMm: 50,
    lightColourK: 5200,
    lightModifier: 'large diffused window key light with soft warm bounce',
    spaceBackground: 'minimal daylight architectural interior with natural depth',
    spaceSurface: 'warm travertine and matte oak floor'
  },
  {
    id: 'contextual',
    badgeKo: 'SHOT 04 · CONTEXTUAL',
    badgeEn: 'SHOT 04 · CONTEXTUAL',
    titleKo: '공간 · 라이프스타일 무드 (Contextual Space)',
    titleEn: 'Contextual Lifestyle Scene',
    subtitleKo: '성수 쇼룸·자연광 배스룸·다이닝 테이블 등 타겟 고객의 실제 공간 속 연출',
    subtitleEn: 'Placed inside flagship showrooms, sunlit bathrooms, or curated dining tables',
    previewImageUrl: '/reel/lifestyle-2.jpg',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    defaultAspect: '9:16',
    defaultUse: 'story',
    focalMm: 35,
    lightColourK: 4300,
    lightModifier: 'afternoon sunlight streaming through architectural blinds',
    spaceBackground: 'sunlit flagship showroom shelf with subtle architectural shadow play',
    spaceSurface: 'brushed stainless steel and natural travertine counter'
  }
] as const;

/**
 * Tailored Industry Vertical Playbooks for Fashion, Beauty & F&B Marketers, PMs & Creative Directors
 */
export type CoreBrandVertical =
  | 'fashion_apparel'
  | 'beauty_skincare'
  | 'fnb_hospitality';

export interface VerticalMarketerPlaybook {
  id: string;
  vertical: CoreBrandVertical;
  shotTemplateId: PomelliShotTemplateId;
  targetPersonaKo: string;
  targetPersonaEn: string;
  startupPatternBadgeKo: string;
  startupPatternBadgeEn: string;
  titleKo: string;
  titleEn: string;
  painSolvedKo: string;
  painSolvedEn: string;
  previewImageUrl: string;
  recommendedRatios: readonly ShotAspect[];
  defaultAspect: ShotAspect;
  defaultUse: DeliverableUse;
  cutKind: ShotCutKind;
  medium: DeliverableMedium;
  focalMm: number;
  lightColourK: number;
  lightModifier: string;
  spaceBackground: string;
  spaceSurface: string;
  productNameKo: string;
  productNameEn: string;
  labelLockKo: string;
  labelLockEn: string;
  briefKo: string;
  briefEn: string;
  recommendedAttachmentMode: DesignPrincipleAttachmentMode;
}

export const VERTICAL_MARKETER_PLAYBOOKS: readonly VerticalMarketerPlaybook[] = [
  // 1. FASHION & APPAREL (패션 MD · 브랜드 디렉터 · 캠페인 PM)
  {
    id: 'fashion-flatlay-to-lookbook',
    vertical: 'fashion_apparel',
    shotTemplateId: 'in_use',
    targetPersonaKo: '패션 MD · 아트디렉터',
    targetPersonaEn: 'Fashion MD · Art Director',
    startupPatternBadgeKo: '플랫레이 → 온모델 룩북 전환',
    startupPatternBadgeEn: 'Flat-Lay to On-Model Lookbook',
    titleKo: '바닥컷·마네킹 의류를 모델 착장 화보로 전환',
    titleEn: 'Garment Flat-Lay to Editorial On-Model Lookbook',
    painSolvedKo:
      '스튜디오 대관·외국인 모델 섭외 없이도 아우터·팬츠의 핏·원단 드레이프·지퍼 디테일을 100% 유지한 채 성수·밀라노 무드 착장 컷을 즉시 생성합니다.',
    painSolvedEn:
      'Turns flat-lay or mannequin garment photos into editorial on-model lookbook shots while locking zipper lines, stitching, and fabric drape.',
    previewImageUrl: '/reel/cases/case-lookbook-still.jpg',
    recommendedRatios: ['4:5', '9:16', '1:1'],
    defaultAspect: '4:5',
    defaultUse: 'feed',
    cutKind: 'editorial_full_body',
    medium: 'editorial still',
    focalMm: 50,
    lightColourK: 5400,
    lightModifier: 'large diffused daylight window softbox with clean negative fill',
    spaceBackground: 'minimal architectural concrete gallery with generous negative space',
    spaceSurface: 'honed travertine gallery floor',
    productNameKo: '26SS 시그니처 테크니컬 재킷 & 와이드 팬츠',
    productNameEn: '26SS Signature Technical Jacket & Wide Trousers',
    labelLockKo: '비대칭 지퍼 라인, 칼라 비례, 가슴 워드마크 자수 1:1 고정',
    labelLockEn: 'Lock asymmetrical zipper geometry, collar proportion, and chest wordmark',
    briefKo:
      '콘크리트 갤러리 자연광 아래 26SS 테크니컬 재킷을 착용한 전신 룩북 컷, 의류 봉제선과 매트 나일론 드레이프 정밀 보존',
    briefEn:
      'Full-body editorial lookbook in a daylight concrete gallery, preserving technical jacket seam construction and matte nylon drape',
    recommendedAttachmentMode: 'full_attach'
  },
  {
    id: 'fashion-fabric-stitch-macro',
    vertical: 'fashion_apparel',
    shotTemplateId: 'ingredients',
    targetPersonaKo: '어패럴 디자이너 · 이커머스 PM',
    targetPersonaEn: 'Apparel Designer · E-Commerce PM',
    startupPatternBadgeKo: '원단 직조 · 부자재 마크로',
    startupPatternBadgeEn: 'Fabric Weave & Hardware Macro',
    titleKo: '상세페이지용 원단 결 · 직조 라벨 · 금속 스냅 초근접 컷',
    titleEn: 'PDP Fabric Weave, Woven Label & Hardware Macro',
    painSolvedKo:
      '무신사·29CM·자사몰 상세페이지에서 구매 전환율을 결정짓는 원단 두께감, 발수 코팅 입자, 각인 스냅 버튼을 100mm 마크로 렌즈 질감으로 보여줍니다.',
    painSolvedEn:
      'Highlights fabric weave density, water-repellent texture, and engraved hardware for high-converting PDP detail blocks.',
    previewImageUrl: '/reel/lifestyle-1.jpg',
    recommendedRatios: ['1:1', '4:5'],
    defaultAspect: '1:1',
    defaultUse: 'catalog',
    cutKind: 'logo_mark_preserve',
    medium: 'product still',
    focalMm: 100,
    lightColourK: 5500,
    lightModifier: 'grazing side strip light to reveal micro-weave relief',
    spaceBackground: 'shallow depth-of-field dark slate studio backdrop',
    spaceSurface: 'brushed anodised aluminium inspection table',
    productNameKo: '3-레이어 고밀도 나일론 원단 & 직조 케어라벨',
    productNameEn: '3-Layer High-Density Nylon & Woven Label',
    labelLockKo: '직조 라벨 내 브랜드 워드마크 철자 및 폰트 자간 100% 보존',
    labelLockEn: 'Preserve woven label wordmark spelling and kerning at 100% accuracy',
    briefKo:
      '100mm 마크로 렌즈로 촬영한 3-레이어 나일론 원단 직조결과 무광 금속 스냅, 브랜드 직조 라벨 클로즈업',
    briefEn:
      '100mm macro close-up of 3-layer nylon weave, matte metal snap hardware, and crisp woven brand label',
    recommendedAttachmentMode: 'full_attach'
  },
  {
    id: 'fashion-seasonal-drop-reel',
    vertical: 'fashion_apparel',
    shotTemplateId: 'contextual',
    targetPersonaKo: '브랜드 마케터 · 콘텐츠 디렉터',
    targetPersonaEn: 'Brand Marketer · Content Director',
    startupPatternBadgeKo: '시즌 드롭 티저 · 자유 무드 실험',
    startupPatternBadgeEn: 'Seasonal Drop Teaser & Mood Test',
    titleKo: '콜라보 · 팝업 오픈용 9:16 숏필름 & 신규 시즌 컬러 탐색',
    titleEn: '9:16 Drop Teaser Film & Seasonal Color Exploration',
    painSolvedKo:
      '로고와 의류 실루엣은 유지하되 기존 브랜드 컬러 팔레트 잠금을 일시 해제(선택적 원칙 연결)하여 성수 팝업·시즌 콜라보의 파격적인 색감을 빠르게 테스트합니다.',
    painSolvedEn:
      'Keeps logo and garment geometry locked while detaching the base color palette to test bold seasonal drop atmospheres.',
    previewImageUrl: '/reel/lifestyle-2.jpg',
    recommendedRatios: ['9:16', '4:5', '16:9'],
    defaultAspect: '9:16',
    defaultUse: 'reel',
    cutKind: 'short_film_clip',
    medium: 'short film',
    focalMm: 35,
    lightColourK: 4100,
    lightModifier: 'golden hour architectural rim light with long courtyard shadows',
    spaceBackground: 'seongsu industrial concrete courtyard at late afternoon',
    spaceSurface: 'weathered basalt stone courtyard',
    productNameKo: '시즌 캡슐 아우터 컬렉션',
    productNameEn: 'Seasonal Capsule Outerwear Collection',
    labelLockKo: '아우터 실루엣과 후면 심볼 엠블럼 비례 고정',
    labelLockEn: 'Lock outerwear silhouette and back symbol emblem proportions',
    briefKo:
      '성수동 콘크리트 중정 골든아워 역광 속 캡슐 아우터 워킹 숏필름, 바람에 흔들리는 원단 질감과 묵직한 카메라 돌리 인',
    briefEn:
      'Golden hour courtyard short film featuring capsule outerwear in motion, steady camera dolly-in with natural fabric movement',
    recommendedAttachmentMode: 'custom_partial'
  },

  // 2. BEAUTY & SKINCARE (뷰티 BM · 올리브영/글로벌 마케터 · 크리에이티브 디렉터)
  {
    id: 'beauty-ingredient-texture-smear',
    vertical: 'beauty_skincare',
    shotTemplateId: 'ingredients',
    targetPersonaKo: '뷰티 BM · 상세페이지 PM',
    targetPersonaEn: 'Beauty BM · PDP Product Manager',
    startupPatternBadgeKo: '제형 스미어 & 원료 페어링',
    startupPatternBadgeEn: 'Texture Smear & Botanical Staging',
    titleKo: '보틀 원본 100% 보존 + 수분 세럼·크림 제형 스미어 화보',
    titleEn: 'Exact Bottle Lock + Serum/Cream Texture Smear Still',
    painSolvedKo:
      '용기 형태나 전면 라벨 글자가 일그러지는 AI 오류를 원천 차단하고, 보틀 옆에 투명한 수분 제형 스와치와 핵심 원물(시카·세라마이드·워터 드롭)을 정교하게 배치합니다.',
    painSolvedEn:
      'Locks bottle geometry and front typography while staging realistic serum droplets, cream smears, and raw botanical ingredients.',
    previewImageUrl: '/reel/cases/case-beauty-still.jpg',
    recommendedRatios: ['4:5', '1:1', '9:16'],
    defaultAspect: '4:5',
    defaultUse: 'feed',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    focalMm: 85,
    lightColourK: 5500,
    lightModifier: 'diffused overhead scrim with crisp glass caustic backlight',
    spaceBackground: 'clean frosted glass and soft water ripple refraction backdrop',
    spaceSurface: 'wet white limestone slab with translucent serum smear',
    productNameKo: '히어로 배리어 세럼 50ml 프로스티드 보틀',
    productNameEn: 'Hero Barrier Serum 50ml Frosted Bottle',
    labelLockKo: '보틀 전면 세리프 로고·용량 표기(50ml)·스포이드 캡 비율 100% 고정',
    labelLockEn: '100% lock on front serif logo, 50ml capacity text, and dropper cap geometry',
    briefKo:
      '촉촉한 라임스톤 단상 위 프로스티드 유리 세럼 보틀과 투명하게 번지는 수분 에센스 제형 스미어, 맑은 자연광 굴절 하이라이트',
    briefEn:
      'Frosted glass serum bottle on wet limestone alongside a translucent essence texture smear and crisp daylight water caustics',
    recommendedAttachmentMode: 'full_attach'
  },
  {
    id: 'beauty-skin-glow-inuse',
    vertical: 'beauty_skincare',
    shotTemplateId: 'in_use',
    targetPersonaKo: '뷰티 퍼포먼스 마케터 · 디렉터',
    targetPersonaEn: 'Beauty Performance Marketer · Director',
    startupPatternBadgeKo: '무결점 피부 결 · 발림 클로즈업',
    startupPatternBadgeEn: 'True-Skin Texture & Application Cut',
    titleKo: '뷰티 필터 없는 실제 피부 결(a10 규약) + 세럼 발림 포트레이트',
    titleEn: 'Filter-Free Real Skin Texture (a10) & Serum Application Portrait',
    painSolvedKo:
      '인위적인 플라스틱 AI 피부나 과도한 핑크 블러셔를 자동 차단하고, 실제 모공과 자연스러운 수분 속광이 살아있는 클린 뷰티 모델 컷을 제작합니다.',
    painSolvedEn:
      'Blocks plastic beauty-filter smoothing and artificial blush, delivering authentic pore-level skin texture with natural hydration roll-off.',
    previewImageUrl: '/reel/cases/case-beauty-still.jpg',
    recommendedRatios: ['4:5', '9:16', '1:1'],
    defaultAspect: '4:5',
    defaultUse: 'feed',
    cutKind: 'person_portrait',
    medium: 'editorial still',
    focalMm: 85,
    lightColourK: 5300,
    lightModifier: 'large octabox key light with white bounce card one stop under',
    spaceBackground: 'sunlit minimal plaster bathroom with soft morning shadows',
    spaceSurface: 'clean travertine vanity counter',
    productNameKo: '하이드라 카밍 앰플 & 모델 클로즈업',
    productNameEn: 'Hydra Calming Ampoule & Talent Close-Up',
    labelLockKo: '손에 쥔 보틀 라벨 가독성 유지 및 실제 매트 피부 질감 보호',
    labelLockEn: 'Maintain bottle label legibility in hand and protect natural skin texture',
    briefKo:
      '아침 햇살이 들어오는 미니멀 욕실에서 앰플 보틀을 든 3/4 각도 인물 클로즈업, 인위적 보정 없는 맑고 건강한 실제 피부 결과 은은한 수분 하이라이트',
    briefEn:
      '3/4 portrait holding the ampoule bottle in morning window light, authentic pore-level skin texture with soft hydration highlight roll-off',
    recommendedAttachmentMode: 'full_attach'
  },
  {
    id: 'beauty-oliveyoung-multi-ratio-pack',
    vertical: 'beauty_skincare',
    shotTemplateId: 'studio',
    targetPersonaKo: '올리브영 · 아마존 · 자사몰 PM',
    targetPersonaEn: 'Retail & Paid Social Growth PM',
    startupPatternBadgeKo: '멀티 채널 규격 팩 (1:1 · 4:5 · 9:16)',
    startupPatternBadgeEn: 'Multi-Ratio Channel Pack',
    titleKo: '올리브영 기획전 썸네일(1:1) · 메타 피드(4:5) · 릴스(9:16) 원스톱 팩',
    titleEn: 'Retail Thumbnail (1:1), Meta Feed (4:5) & Reels (9:16) Launch Pack',
    painSolvedKo:
      '신제품 런칭이나 빅세일 때마다 채널별 규격과 카피 여백(Safe-zone)을 다시 잡느라 소모되는 디자이너 리소스를 한 번의 브리프로 해결합니다.',
    painSolvedEn:
      'Generates retail thumbnails, paid social feeds, and vertical stories with pre-reserved headline safe-areas from a single product brief.',
    previewImageUrl: '/reel/cases/case-beauty-still.jpg',
    recommendedRatios: ['1:1', '4:5', '9:16', '16:9'],
    defaultAspect: '1:1',
    defaultUse: 'hero',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    focalMm: 85,
    lightColourK: 5600,
    lightModifier: 'high-key commercial studio softbox with crisp rim separation',
    spaceBackground: 'clean alabaster and subtle French blue gradient studio horizon',
    spaceSurface: 'matte acrylic podium with soft contact shadow',
    productNameKo: '더마 리페어 크림 & 세럼 듀오 기획세트',
    productNameEn: 'Derma Repair Cream & Serum Duo Set',
    labelLockKo: '듀오 용기 높이 비례 및 전면 타이포그래피 100% 수평 정렬',
    labelLockEn: 'Lock duo vessel height ratio and keep front typography 100% level',
    briefKo:
      '화이트·프렌치블루 아크릴 단상 위 더마 크림·세럼 듀오 정면 히어로 컷, 상단 20% 프로모션 배너 타이포그래피 여백 확보',
    briefEn:
      'Front hero shot of the Derma Cream & Serum duo on a matte acrylic podium with top 20% negative space reserved for campaign copy',
    recommendedAttachmentMode: 'full_attach'
  },

  // 3. F&B & HOSPITALITY (F&B 브랜드 마케터 · 메뉴 PM · 공간 디렉터)
  {
    id: 'fnb-condensation-beverage-hero',
    vertical: 'fnb_hospitality',
    shotTemplateId: 'studio',
    targetPersonaKo: 'F&B 브랜드 마케터 · 음료 PM',
    targetPersonaEn: 'F&B Brand Marketer · Beverage PM',
    startupPatternBadgeKo: '컨덴세이션 물방울 · 패키지 락',
    startupPatternBadgeEn: 'Condensation Macro & Label Lock',
    titleKo: '캔·보틀 라벨 100% 고정 + 차가운 결로(물방울)·얼음 시즐 히어로',
    titleEn: '100% Can/Bottle Label Lock + Ice Condensation Sizzle Hero',
    painSolvedKo:
      '음료·주류·RTD 캔 표면의 브랜드 로고 곡률 왜곡을 막고, 방금 냉장고에서 꺼낸 듯한 영롱한 결로 물방울과 얼음 굴절광을 정밀 연출합니다.',
    painSolvedEn:
      'Preserves curved can/bottle label typography while adding natural cold condensation droplets and crisp ice refraction.',
    previewImageUrl: '/reel/lifestyle-2.jpg',
    recommendedRatios: ['4:5', '9:16', '1:1'],
    defaultAspect: '4:5',
    defaultUse: 'feed',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    focalMm: 85,
    lightColourK: 5400,
    lightModifier: 'crisp backlight through crushed ice with soft front fill',
    spaceBackground: 'sunlit cafe counter with subtle bokeh greenery',
    spaceSurface: 'brushed stainless steel bar top with natural water droplets',
    productNameKo: '시그니처 스파클링 보틀 & 크리스탈 글래스',
    productNameEn: 'Signature Sparkling Bottle & Crystal Glass',
    labelLockKo: '보틀 전면 브랜드 로고 철자 및 원통형 라벨 곡률 100% 유지',
    labelLockEn: 'Preserve bottle front logo spelling and cylindrical label curvature',
    briefKo:
      '스테인리스 바 테이블 위 차가운 물방울이 맺힌 스파클링 보틀과 투명한 얼음 잔, 오후 햇살이 투과하는 청량한 하이라이트',
    briefEn:
      'Chilled sparkling bottle with fine condensation droplets beside a crystal glass of ice on a sunlit stainless steel bar top',
    recommendedAttachmentMode: 'full_attach'
  },
  {
    id: 'fnb-ingredient-table-flatlay',
    vertical: 'fnb_hospitality',
    shotTemplateId: 'ingredients',
    targetPersonaKo: '다이닝 디렉터 · 시즌 메뉴 PM',
    targetPersonaEn: 'Dining Director · Menu PM',
    startupPatternBadgeKo: '원재료 페어링 · 테이블웨어 플랫레이',
    startupPatternBadgeEn: 'Fresh Ingredient & Tableware Flat-Lay',
    titleKo: '신메뉴 원재료(원두·시트러스·허브) & 세라믹 플레이트 탑뷰 화보',
    titleEn: 'Seasonal Menu Ingredients & Ceramic Tableware Overhead Still',
    painSolvedKo:
      '매장 신메뉴 출시나 배달앱·인스타 공지용으로 식재료의 신선한 단면과 브랜드 고유의 테이블웨어·냅킨 로고 각인을 한 프레임에 담아냅니다.',
    painSolvedEn:
      'Combines fresh cut ingredients, ceramic plating, and branded linen/packaging in an editorial overhead table composition.',
    previewImageUrl: '/reel/lifestyle-1.jpg',
    recommendedRatios: ['1:1', '4:5'],
    defaultAspect: '1:1',
    defaultUse: 'feed',
    cutKind: 'reference_exact_product',
    medium: 'product still',
    focalMm: 50,
    lightColourK: 4800,
    lightModifier: 'soft side window daylight with natural linen shadow texture',
    spaceBackground: 'overhead dining table composition with generous margin',
    spaceSurface: 'warm natural oak table with stoneware plate and linen napkin',
    productNameKo: '시즌 시그니처 디저트 플레이트 & 로고 패키징 박스',
    productNameEn: 'Seasonal Signature Dessert Plate & Branded Box',
    labelLockKo: '패키지 박스 상단 로고 엠보싱 및 식기 컬러 톤 고정',
    labelLockEn: 'Lock packaging box logo embossing and ceramic glaze color tone',
    briefKo:
      '따뜻한 오크 테이블 위 시즌 디저트 세라믹 플레이트와 신선한 시트러스·허브 원재료, 브랜드 로고가 각인된 패키지 박스 탑뷰 연출',
    briefEn:
      'Overhead editorial flat-lay of the seasonal dessert on stoneware alongside fresh citrus, herbs, and the embossed brand packaging box',
    recommendedAttachmentMode: 'full_attach'
  },
  {
    id: 'fnb-pour-steam-motion-reel',
    vertical: 'fnb_hospitality',
    shotTemplateId: 'in_use',
    targetPersonaKo: 'F&B 퍼포먼스 마케터 · 릴스 PM',
    targetPersonaEn: 'F&B Performance Marketer · Reels PM',
    startupPatternBadgeKo: '3초 시즐 훅 · 푸어링 숏필름',
    startupPatternBadgeEn: '3-Second Sizzle Hook · Pouring Film',
    titleKo: '첫 3초 스크롤을 멈추는 에스프레소 푸어링 · 온기 스팀 9:16 릴스',
    titleEn: 'Scroll-Stopping Espresso Pour & Warm Steam 9:16 Reels Clip',
    painSolvedKo:
      'F&B 광고에서 클릭률을 2배 이상 높이는 첫 3초 시즐 모션(음료 따르기, 크림 드롭, 모락모락 피어오르는 스팀)을 2컷 타임라인으로 즉시 설계합니다.',
    painSolvedEn:
      'Designs a 2-cut timeline film with a high-converting 3-second sizzle hook (pouring, cream swirl, warm steam) and branded cup reveal.',
    previewImageUrl: '/reel/lifestyle-2.jpg',
    recommendedRatios: ['9:16', '4:5'],
    defaultAspect: '9:16',
    defaultUse: 'reel',
    cutKind: 'short_film_clip',
    medium: 'short film',
    focalMm: 65,
    lightColourK: 4400,
    lightModifier: 'warm morning side key light highlighting rising steam and liquid gloss',
    spaceBackground: 'minimalist specialty coffee bar with warm wood and steel',
    spaceSurface: 'honed basalt espresso bar counter',
    productNameKo: '시그니처 라떼 잔 & 브랜드 슬리브',
    productNameEn: 'Signature Latte Cup & Branded Sleeve',
    labelLockKo: '컵 슬리브 전면 브랜드 심볼 마크와 타이포그래피 왜곡 제로',
    labelLockEn: 'Zero distortion on cup sleeve front brand symbol and typography',
    briefKo:
      '첫 컷에서 진한 에스프레소가 우유 위로 쏟아지며 마블링이 번지는 클로즈업, 두 번째 컷에서 브랜드 로고 슬리브가 선명한 시그니처 잔 정면 고정 리빌',
    briefEn:
      'Shot 1 macro pour of rich espresso swirling into milk; Shot 2 locked hero reveal of the signature cup with crisp branded sleeve',
    recommendedAttachmentMode: 'full_attach'
  }
] as const;

export function listPlaybooksForVertical(
  vertical: CoreBrandVertical
): readonly VerticalMarketerPlaybook[] {
  return VERTICAL_MARKETER_PLAYBOOKS.filter((p) => p.vertical === vertical);
}
