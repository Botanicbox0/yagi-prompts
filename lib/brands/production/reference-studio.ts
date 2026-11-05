import type { BrandClientCategory } from "@/lib/brands/category-experience";

/**
 * Multi-Reference Slot Composer & Image Model Suitability Guide (`brand.twings.app/brand/studio`).
 *
 * Inspired by real production workflows on Sunra Dashboard, Oplux, and AMERICANO:
 *   1. Role-Locked Numbered Reference Slots (`1번 이미지` ~ `4번 이미지`):
 *      - Lookbook / Editorial Composite Mode:
 *        [1번 이미지: 인물] + [2번 이미지: 배경] + [3번 이미지: 구도·감도] + [4번 이미지: 색감·조명]
 *      - Product Swap / Packshot Reshoot Mode:
 *        [1번 이미지: 베이스 장면·구도] + [2번 이미지: 교체할 우리 제품] + [3번 이미지: 측면·디테일] + [4번 이미지: 조명·색감]
 *   2. Image Model Selector with Quick Characteristics & Detailed Use-Case Recommendations.
 */

export type StudioReferenceWorkflowId =
  | "lookbook_composite"
  | "product_swap";

export type StudioReferenceSlotNumber = 1 | 2 | 3 | 4;

export interface StudioReferenceSlotSpec {
  slotNumber: StudioReferenceSlotNumber;
  tagKo: string;
  tagEn: string;
  roleTitleKo: string;
  roleTitleEn: string;
  lockRuleKo: string;
  lockRuleEn: string;
  required: boolean;
  defaultThumb: string;
  defaultAssetNameKo: string;
  defaultAssetNameEn: string;
}

export interface StudioReferenceWorkflowPreset {
  id: StudioReferenceWorkflowId;
  labelKo: string;
  labelEn: string;
  summaryKo: string;
  summaryEn: string;
  formulaBadgeKo: string;
  formulaBadgeEn: string;
  defaultPromptKo: string;
  defaultPromptEn: string;
  quickRecipesKo: readonly [string, string, string];
  quickRecipesEn: readonly [string, string, string];
  slots: readonly [
    StudioReferenceSlotSpec,
    StudioReferenceSlotSpec,
    StudioReferenceSlotSpec,
    StudioReferenceSlotSpec,
  ];
}

export type BrandStudioImageModelId =
  | "multi_ref_standard"
  | "portrait_lookbook_pro"
  | "ultra_detail_label"
  | "vto_garment_lock";

export interface BrandStudioImageModelSpec {
  id: BrandStudioImageModelId;
  nameKo: string;
  nameEn: string;
  tierBadgeKo: string;
  tierBadgeEn: string;
  /** Short 1-line summary shown right inside the model selection card */
  shortTraitKo: string;
  shortTraitEn: string;
  /** Key strength tags shown as compact pills on the card */
  strengthsKo: readonly [string, string, string];
  strengthsEn: readonly [string, string, string];
  /** Detailed explanation of how the model behaves */
  detailDescriptionKo: string;
  detailDescriptionEn: string;
  /** Which deliverables / scenarios this model is best suited for */
  bestForDeliverablesKo: readonly [string, string, string];
  bestForDeliverablesEn: readonly [string, string, string];
  /** Recommended 1~4 reference slot combination for this model */
  recommendedSlotFormulaKo: string;
  recommendedSlotFormulaEn: string;
  /** Recommended workflow mode when this model is selected */
  preferredWorkflow: StudioReferenceWorkflowId;
  /** B2B credits for a 5-shot 2K set */
  creditsPer5Set: number;
  /** B2B card checkout KRW for a 5-shot 2K set */
  priceKrwPer5Set: number;
  /** B2B credits for 1 single 2K image */
  creditsPerSingle: number;
  supportedResolutions: readonly ("2K" | "4K")[];
}

export const BRAND_STUDIO_IMAGE_MODELS: ReadonlyArray<BrandStudioImageModelSpec> =
  [
    {
      id: "multi_ref_standard",
      nameKo: "멀티 레퍼런스 합성 · 스탠다드 2K",
      nameEn: "Multi-Reference Composite · Standard 2K",
      tierBadgeKo: "제품 교체 · 빠른 합성 추천",
      tierBadgeEn: "Best for Product Swap & Fast Mix",
      shortTraitKo:
        "1~4번 레퍼런스 동시 조합 · 제품 교체 · 손/소품 가림 정리에 가장 빠르고 정확합니다",
      shortTraitEn:
        "Fastest and sharpest at combining 1–4 references, swapping products, and cleaning occlusions",
      strengthsKo: ["1→2번 제품 교체 특화", "빠른 시안 생성", "소품·배경 자연 합성"],
      strengthsEn: ["1→2 Product Swap", "Fast Iterations", "Clean Prop Composite"],
      detailDescriptionKo:
        "베이스 이미지(1번)의 조명·그림자·원근감을 그대로 읽어들여 지정한 영역만 우리 제품(2번)으로 감쪽같이 교체하거나, 최대 4장의 레퍼런스 이미지를 위화감 없이 한 장의 장면으로 합성합니다.",
      detailDescriptionEn:
        "Reads the base image's (Slot 1) lighting, contact shadows, and perspective to seamlessly swap in your product (Slot 2) or blend up to 4 reference images into one coherent frame.",
      bestForDeliverablesKo: [
        "1번 이미지 속 기존 제품을 2번 이미지의 우리 제품으로 교체할 때",
        "모델 손에 들린 컵·가방·화장품을 우리 브랜드 제품으로 바꿀 때",
        "여러 레퍼런스(배경+제품+색감)를 조합해 빠르게 시안 5장 세트를 뽑을 때",
      ],
      bestForDeliverablesEn: [
        "Replacing a product in Image 1 with your own product from Image 2",
        "Swapping held props (bottles, bags, cosmetics) in a model's hand",
        "Rapidly testing 5-shot variations across multiple mood & background references",
      ],
      recommendedSlotFormulaKo:
        "1번(베이스 장면) + 2번(교체할 우리 제품 정면) + 3번(제품 측면·질감) + 4번(색감 레퍼런스)",
      recommendedSlotFormulaEn:
        "Slot 1 (Base Scene) + Slot 2 (Target Product) + Slot 3 (Side Detail) + Slot 4 (Color Ref)",
      preferredWorkflow: "product_swap",
      creditsPer5Set: 41,
      priceKrwPer5Set: 500,
      creditsPerSingle: 9,
      supportedResolutions: ["2K", "4K"],
    },
    {
      id: "portrait_lookbook_pro",
      nameKo: "인물 화보 · 전신 룩북 마스터 2K",
      nameEn: "Portrait & Full-Body Lookbook Master 2K",
      tierBadgeKo: "인물 · 패션 · 뷰티 화보 추천",
      tierBadgeEn: "Best for Models & Editorial Lookbooks",
      shortTraitKo:
        "인물 이목구비 일관성 · 전신 8등신 비율 · 매트하고 자연스러운 피부 결 표현에 가장 뛰어납니다",
      shortTraitEn:
        "Superior facial likeness lock, full-body proportions, and natural matte skin texture",
      strengthsKo: ["인물 얼굴·비율 고정", "매트한 실사 피부 결", "배경·색감 무드 흡수"],
      strengthsEn: ["Facial Likeness Lock", "Matte Real Skin", "Mood & Color Transfer"],
      detailDescriptionKo:
        "1번 이미지의 인물 마스크와 피부 톤을 흔들림 없이 유지하면서, 2번 이미지의 배경 공간과 3번 이미지의 포즈·사진 감도, 4번 이미지의 색감을 영화 스틸컷처럼 결합합니다. 전신 컷에서도 모델 키와 비율이 안정적입니다.",
      detailDescriptionEn:
        "Locks the subject's facial identity and complexion from Image 1 while weaving in the location of Image 2, the pose/editorial sensitivity of Image 3, and the color grading of Image 4 with stable full-body proportions.",
      bestForDeliverablesKo: [
        "1번 인물이 2번 배경에서 3번 이미지 감도와 4번 색감으로 서 있는 캠페인 화보",
        "뷰티 브랜드의 피부 광채·립·아이 메이크업 클로즈업 뷰티 화보",
        "동일 모델로 정면·측면·워킹 전신 컷을 일관된 비율로 촬영할 때",
      ],
      bestForDeliverablesEn: [
        "Editorial campaigns combining Person (1) + Location (2) + Vibe (3) + Color Grade (4)",
        "Beauty & skincare close-ups requiring authentic skin pores and zero plastic sheen",
        "Full-body lookbook series keeping consistent model height and proportions",
      ],
      recommendedSlotFormulaKo:
        "1번(인물 얼굴·체형) + 2번(배경 공간) + 3번(포즈·사진 감도) + 4번(조명·색감 무드)",
      recommendedSlotFormulaEn:
        "Slot 1 (Model Identity) + Slot 2 (Background) + Slot 3 (Pose & Vibe) + Slot 4 (Color Grade)",
      preferredWorkflow: "lookbook_composite",
      creditsPer5Set: 71,
      priceKrwPer5Set: 900,
      creditsPerSingle: 15,
      supportedResolutions: ["2K", "4K"],
    },
    {
      id: "ultra_detail_label",
      nameKo: "하이엔드 디테일 · 타이포 마스터",
      nameEn: "Ultra-Detail & Typography Master",
      tierBadgeKo: "라벨 · 패키지 · 마크로 추천",
      tierBadgeEn: "Best for Labels & Macro Texture",
      shortTraitKo:
        "제품 라벨 글자 보존 · 유리 굴절/금속 헤어라인/원단 직조 등 초근접 디테일 묘사에 특화되었습니다",
      shortTraitEn:
        "Preserves fine package typography and renders glass refraction, brushed metal, and fabric weave",
      strengthsKo: ["라벨·로고 글자 보존", "초근접 제형·소재 질감", "복합 지시문 정밀 이행"],
      strengthsEn: ["Exact Label Typography", "Macro Material Realism", "Complex Prompt Fidelity"],
      detailDescriptionKo:
        "화장품 용기·음료 보틀·패키지 박스의 작은 영문/한글 로고 철자와 위치까지 정밀하게 보존하며, 물방울 결로·크림 제형 스미어·금속 각인 등 초근접(Macro) 스튜디오 디테일을 선명하게 구현합니다.",
      detailDescriptionEn:
        "Preserves small brand typography on bottles, jars, and boxes while rendering hyper-detailed macro textures such as condensation droplets, cream smears, and metallic engravings.",
      bestForDeliverablesKo: [
        "제품 전면 라벨 글자와 심볼 로고가 1mm도 틀어지면 안 되는 메인 히어로 팩샷",
        "스킨케어 제형 드롭·식음료 얼음 결로·주얼리 세공 등 100mm 마크로 클로즈업",
        "1~4번 레퍼런스의 세부 조건을 까다롭게 모두 지켜야 하는 광고 키비주얼",
      ],
      bestForDeliverablesEn: [
        "Hero packshots where front label lettering and brand symbols must stay razor-sharp",
        "100mm macro shots of skincare serum drops, beverage condensation, or fine jewelry",
        "Main campaign key visuals with strict multi-reference art direction constraints",
      ],
      recommendedSlotFormulaKo:
        "1번(구도·단상 베이스) + 2번(제품 정면 원판) + 3번(로고·라벨 클로즈업) + 4번(조명·반사광)",
      recommendedSlotFormulaEn:
        "Slot 1 (Plinth Base) + Slot 2 (Product Front) + Slot 3 (Label Close-Up) + Slot 4 (Specular Light)",
      preferredWorkflow: "product_swap",
      creditsPer5Set: 95,
      priceKrwPer5Set: 1100,
      creditsPerSingle: 20,
      supportedResolutions: ["2K", "4K"],
    },
    {
      id: "vto_garment_lock",
      nameKo: "가상 착장 · 의류 핏 고정 마스터",
      nameEn: "Virtual Try-On · Garment Fit-Lock Master",
      tierBadgeKo: "의류 · 가방 · 모자 착장 추천",
      tierBadgeEn: "Best for Apparel & Bag Try-On",
      shortTraitKo:
        "의류 원판의 기장·봉제선·프린트 패턴을 왜곡 없이 모델에게 그대로 입혀 상세페이지 컷을 만듭니다",
      shortTraitEn:
        "Dresses the model in your exact garment flat-lay without altering seam lines, length, or print",
      strengthsKo: ["의류 핏·기장 100% 보존", "프린트·패턴 왜곡 방지", "정면·측면·후면 동시 생성"],
      strengthsEn: ["100% Garment Fit Lock", "Zero Print Distortion", "Multi-Angle PDP Cuts"],
      detailDescriptionKo:
        "행거나 바닥에 놓고 찍은 의류·가방·모자 제품 사진(2번)의 스티치, 단추 개수, 로고 위치, 원단 드레이프를 그대로 고정한 채 지정한 모델(1번)에게 자연스럽게 입혀 쇼핑몰 상세페이지(PDP) 컷을 완성합니다.",
      detailDescriptionEn:
        "Preserves stitch lines, button count, logo placement, and fabric drape from a flat-lay or hanger photo (Slot 2) while dressing the target model (Slot 1) for e-commerce PDP shoots.",
      bestForDeliverablesKo: [
        "바닥컷·행거컷 의류 사진만 가지고 모델 착장 룩북(정면·측면·상반신)을 만들 때",
        "한 명의 브랜드 전속 모델에게 신상 의류 10~20벌을 일관된 톤으로 갈아입힐 때",
        "그래픽 티셔츠·스트라이프·체크 패턴 등 무늬가 복잡한 의류의 착장 컷",
      ],
      bestForDeliverablesEn: [
        "Turning hanger or flat-lay garment photos into full-body model lookbook cuts",
        "Dressing one house model across 10–20 new-season SKUs with identical studio lighting",
        "Apparel with graphic prints, stripes, or woven patterns that cannot be altered",
      ],
      recommendedSlotFormulaKo:
        "1번(착장할 모델) + 2번(의류 정면 원판) + 3번(의류 후면·원단 디테일) + 4번(스튜디오 배경·색감)",
      recommendedSlotFormulaEn:
        "Slot 1 (Model) + Slot 2 (Garment Front) + Slot 3 (Garment Back/Detail) + Slot 4 (Studio Tone)",
      preferredWorkflow: "lookbook_composite",
      creditsPer5Set: 65,
      priceKrwPer5Set: 800,
      creditsPerSingle: 13,
      supportedResolutions: ["2K", "4K"],
    },
  ];

export function resolveCategoryReferenceWorkflows(
  category: BrandClientCategory,
): Record<StudioReferenceWorkflowId, StudioReferenceWorkflowPreset> {
  const isBeauty = category === "beauty_skincare";
  const isFnb = category === "fnb_hospitality";

  const defaultModelThumb = isBeauty
    ? "/reel/landing/v7/rx-beauty-orig.jpg"
    : "/reel/studio/vto-look-front.webp";
  const defaultBgThumb = isBeauty
    ? "/reel/landing/v7/rx-beauty-world.jpg"
    : isFnb
      ? "/reel/landing/v7/film-tea.jpg"
      : "/reel/studio/vto-free-alley.webp";
  const defaultVibeThumb = isBeauty
    ? "/reel/landing/cut-cheek.webp"
    : "/reel/studio/vto-look-side.webp";
  const defaultColorThumb = isBeauty
    ? "/reel/campaigns/beauty-rose.jpg"
    : "/reel/brands/studio-editorial-blue-1080p.jpg";

  const defaultBaseSceneThumb = isBeauty
    ? "/reel/landing/cut-pump.webp"
    : isFnb
      ? "/reel/landing/v7/film-tea.jpg"
      : "/reel/studio/vto-set-front.webp";
  const defaultProductThumb = isBeauty
    ? "/reel/landing/v7/rx-beauty-product.jpg"
    : isFnb
      ? "/reel/brands/tea-editorial.jpg"
      : "/reel/studio/vto-garment.webp";
  const defaultDetailThumb = isBeauty
    ? "/reel/landing/cut-hands.webp"
    : isFnb
      ? "/reel/landing/cut-scent.webp"
      : "/reel/landing/c-garment-ours.webp";

  return {
    lookbook_composite: {
      id: "lookbook_composite",
      labelKo: "인물 · 배경 · 감도 · 색감 조합 (1~4번 레퍼런스)",
      labelEn: "Model · Background · Vibe · Color Mix (Slots 1–4)",
      summaryKo:
        "1번 인물 + 2번 배경 + 3번 이미지 감도(포즈·앵글) + 4번 색감을 역할별로 잠가 합성합니다",
      summaryEn:
        "Lock Slot 1 (Model), Slot 2 (Background), Slot 3 (Pose/Vibe), and Slot 4 (Color Grade) into one scene",
      formulaBadgeKo: "1번 인물 + 2번 배경 + 3번 감도 + 4번 색감",
      formulaBadgeEn: "1 Model + 2 Background + 3 Vibe + 4 Color",
      defaultPromptKo:
        "1번 이미지의 인물이 2번 이미지의 배경 공간에서, 3번 이미지의 구도·사진 감도로 자연스럽게 포즈를 취하고 4번 이미지의 조명과 색감을 적용해 줘.",
      defaultPromptEn:
        "Place the person from Image 1 inside the background of Image 2, matching the pose and editorial sensitivity of Image 3 and applying the lighting and color grade of Image 4.",
      quickRecipesKo: [
        "1번 이미지의 인물이 2번 이미지 배경에서, 3번 이미지의 이미지 감도로 서 있고 4번 이미지의 색감 적용해 줘",
        "1번 이미지 인물의 얼굴과 피부 톤은 그대로 고정하고, 2번 이미지 공간에서 3번 이미지의 로우앵글 구도로 촬영해 줘",
        "1번 이미지 인물에 3번 이미지의 착장 핏과 포즈를 입히고, 4번 이미지의 따뜻한 필름 색감으로 마감해 줘",
      ],
      quickRecipesEn: [
        "Place the person in Image 1 in the background of Image 2 with the editorial vibe of Image 3 and color tone of Image 4",
        "Lock the face and skin tone of Image 1, shooting in the space of Image 2 with the low-angle framing of Image 3",
        "Apply the outfit fit and pose of Image 3 to the person in Image 1, finished with the warm film grade of Image 4",
      ],
      slots: [
        {
          slotNumber: 1,
          tagKo: "1번 이미지 · 인물",
          tagEn: "Image 1 · Person",
          roleTitleKo: "인물 · 얼굴 / 헤어 / 피부",
          roleTitleEn: "Model · Face / Hair / Skin",
          lockRuleKo: "이목구비·피부톤·헤어 고정",
          lockRuleEn: "Locks facial identity & skin",
          required: true,
          defaultThumb: defaultModelThumb,
          defaultAssetNameKo: "브랜드 모델 정면 마스터",
          defaultAssetNameEn: "Brand Model Front Master",
        },
        {
          slotNumber: 2,
          tagKo: "2번 이미지 · 배경",
          tagEn: "Image 2 · Background",
          roleTitleKo: "배경 · 공간 / 장소",
          roleTitleEn: "Space · Location / Set",
          lockRuleKo: "공간 구조·원근감 반영",
          lockRuleEn: "Applies spatial depth & set",
          required: true,
          defaultThumb: defaultBgThumb,
          defaultAssetNameKo: "성수 콘크리트 & 채광 공간",
          defaultAssetNameEn: "Daylight Concrete Studio Set",
        },
        {
          slotNumber: 3,
          tagKo: "3번 이미지 · 이미지 감도",
          tagEn: "Image 3 · Editorial Vibe",
          roleTitleKo: "구도 · 포즈 / 사진 감도",
          roleTitleEn: "Vibe · Pose / Camera Angle",
          lockRuleKo: "프레이밍·포즈·렌즈 감도",
          lockRuleEn: "Matches pose & lens framing",
          required: false,
          defaultThumb: defaultVibeThumb,
          defaultAssetNameKo: "3/4 에디토리얼 앵글 감도",
          defaultAssetNameEn: "3/4 Editorial Framing Ref",
        },
        {
          slotNumber: 4,
          tagKo: "4번 이미지 · 색감",
          tagEn: "Image 4 · Color Grade",
          roleTitleKo: "색감 · 조명 / 필름 톤",
          roleTitleEn: "Color · Lighting & Moodprint",
          lockRuleKo: "색온도·대비·그레인 매칭",
          lockRuleEn: "Transfers color grade & light",
          required: false,
          defaultThumb: defaultColorThumb,
          defaultAssetNameKo: "프렌치 시네마 색감 무드",
          defaultAssetNameEn: "French Cinema Color Mood",
        },
      ],
    },
    product_swap: {
      id: "product_swap",
      labelKo: "제품 교체 · 팩샷 리슈팅 (1번 장면 ↔ 2번 제품)",
      labelEn: "Product Swap & Packshot Reshoot (Image 1 ↔ Image 2)",
      summaryKo:
        "1번 이미지의 구도·조명·손/배경은 유지하고, 제품만 2번 이미지의 우리 제품으로 정밀 교체합니다",
      summaryEn:
        "Keep the framing, lighting, and hands of Image 1 while swapping the product with your product in Image 2",
      formulaBadgeKo: "1번 기존 제품 → 2번 우리 제품으로 교체",
      formulaBadgeEn: "Swap Image 1 Product → Image 2 Product",
      defaultPromptKo:
        "1번 이미지의 배경·조명·구도는 그대로 유지하고, 1번 이미지 속 제품을 2번 이미지의 제품으로 정확히 변경해 줘. 3번 이미지의 디테일과 4번 이미지의 색감을 함께 반영해 줘.",
      defaultPromptEn:
        "Keep the background, lighting, and framing of Image 1 intact, and replace the product in Image 1 with the product from Image 2, preserving the detail of Image 3 and color tone of Image 4.",
      quickRecipesKo: [
        "1번 이미지 제품을 2번 이미지 제품으로 변경해 줘 (라벨 로고와 용기 비율 100% 유지)",
        "1번 이미지의 손 모양과 테이블 채광은 그대로 두고, 손에 들린 제품만 2번 이미지 제품으로 교체해 줘",
        "2번 이미지 제품 정면과 3번 이미지 측면 디테일을 결합해, 1번 이미지의 스튜디오 단상 위에 4번 색감으로 새로 촬영해 줘",
      ],
      quickRecipesEn: [
        "Replace the product in Image 1 with the product in Image 2 (keep 100% label typography and shape)",
        "Keep the hand pose and table daylight of Image 1, swapping only the held item with the product in Image 2",
        "Combine the front product in Image 2 and side detail in Image 3 onto the studio plinth of Image 1 with Image 4's color tone",
      ],
      slots: [
        {
          slotNumber: 1,
          tagKo: "1번 이미지 · 베이스 장면",
          tagEn: "Image 1 · Base Scene",
          roleTitleKo: "기존 장면 · 구도 / 손 / 배경",
          roleTitleEn: "Base Cut · Framing / Hand / Set",
          lockRuleKo: "구도·그림자·조명 위치 유지",
          lockRuleEn: "Keeps framing & shadow contact",
          required: true,
          defaultThumb: defaultBaseSceneThumb,
          defaultAssetNameKo: "베이스 스튜디오 구도 컷",
          defaultAssetNameEn: "Base Studio Framing Cut",
        },
        {
          slotNumber: 2,
          tagKo: "2번 이미지 · 교체할 제품",
          tagEn: "Image 2 · Target Product",
          roleTitleKo: "우리 제품 · 정면 마스터",
          roleTitleEn: "Our Product · Front Master",
          lockRuleKo: "제품 형태·로고·라벨 98% 보존",
          lockRuleEn: "98% shape & label preservation",
          required: true,
          defaultThumb: defaultProductThumb,
          defaultAssetNameKo: "우리 브랜드 제품 정면 원판",
          defaultAssetNameEn: "Brand Product Front Master",
        },
        {
          slotNumber: 3,
          tagKo: "3번 이미지 · 디테일 보조",
          tagEn: "Image 3 · Side / Detail",
          roleTitleKo: "측면 · 원단 / 제형 / 로고",
          roleTitleEn: "Detail · Side / Texture / Logo",
          lockRuleKo: "측면 두께·소재 질감 보강",
          lockRuleEn: "Reinforces texture & side profile",
          required: false,
          defaultThumb: defaultDetailThumb,
          defaultAssetNameKo: "소재 · 라벨 클로즈업 보조컷",
          defaultAssetNameEn: "Material & Label Detail Ref",
        },
        {
          slotNumber: 4,
          tagKo: "4번 이미지 · 색감·조명",
          tagEn: "Image 4 · Light & Color",
          roleTitleKo: "타깃 색감 · 하이라이트 무드",
          roleTitleEn: "Tone · Specular & Color Ref",
          lockRuleKo: "표면 반사광·색온도 매칭",
          lockRuleEn: "Matches specular & color tone",
          required: false,
          defaultThumb: defaultColorThumb,
          defaultAssetNameKo: "스튜디오 하이라이트 톤",
          defaultAssetNameEn: "Studio Specular Tone Ref",
        },
      ],
    },
  };
}

/**
 * Pinned Color Reference & Pinned Texture Reference Presets.
 * When pinned (locked), these references persist across all image generation,
 * product swaps, and micro-region edits so every cut keeps identical brand tone & surface grain.
 */
export interface PinnedStyleReferencePreset {
  id: string;
  kind: "color" | "texture";
  titleKo: string;
  titleEn: string;
  ruleKo: string;
  ruleEn: string;
  swatchHex: string;
  thumb: string;
  promptTokenKo: string;
  promptTokenEn: string;
}

export const PINNED_COLOR_REFERENCES: ReadonlyArray<PinnedStyleReferencePreset> =
  [
    {
      id: "color_editorial_cobalt",
      kind: "color",
      titleKo: "프렌치 코발트 에디토리얼 톤",
      titleEn: "French Cobalt Editorial Tone",
      ruleKo: "5400K 쿨 데이라이트 · 딥 네이비 섀도우 · 중채도 피부톤 고정",
      ruleEn: "5400K cool daylight · deep navy shadows · balanced skin saturation",
      swatchHex: "#3875C5",
      thumb: "/reel/brands/studio-editorial-blue-1080p.jpg",
      promptTokenKo: "[고정 색감 레퍼런스: 5400K 프렌치 코발트 에디토리얼 색온도 및 섀도우 커브 유지]",
      promptTokenEn: "[Pinned Color Ref: 5400K French cobalt editorial color temperature and shadow curve]",
    },
    {
      id: "color_warm_film_2383",
      kind: "color",
      titleKo: "웜 데이라이트 필름 2383 톤",
      titleEn: "Warm Daylight 2383 Film Grade",
      ruleKo: "4800K 자연 채광 · 소프트 골든 하이라이트 · 따뜻한 필름 계조 고정",
      ruleEn: "4800K warm daylight · soft golden highlights · analog film roll-off",
      swatchHex: "#C89B6E",
      thumb: "/reel/campaigns/beauty-rose.jpg",
      promptTokenKo: "[고정 색감 레퍼런스: 4800K 웜 데이라이트 필름 2383 색감 및 소프트 하이라이트 유지]",
      promptTokenEn: "[Pinned Color Ref: 4800K warm daylight 2383 film grade and soft highlight roll-off]",
    },
    {
      id: "color_crisp_studio_neutral",
      kind: "color",
      titleKo: "선명한 뉴트럴 화이트 스튜디오",
      titleEn: "Crisp Neutral White Studio",
      ruleKo: "5800K 정밀 색재현 · 왜곡 없는 제품 고유 컬러 100% 유지",
      ruleEn: "5800K true-to-life color accuracy · zero color cast on product",
      swatchHex: "#64748B",
      thumb: "/reel/studio/vto-set-front.webp",
      promptTokenKo: "[고정 색감 레퍼런스: 5800K 무왜곡 뉴트럴 스튜디오 화이트밸런스 및 제품 고유 색상 고정]",
      promptTokenEn: "[Pinned Color Ref: 5800K neutral studio white balance with true product color lock]",
    },
  ];

export const PINNED_TEXTURE_REFERENCES: ReadonlyArray<PinnedStyleReferencePreset> =
  [
    {
      id: "texture_matte_skin_35mm",
      kind: "texture",
      titleKo: "35mm 파인 그레인 & 리얼 매트 피부결",
      titleEn: "35mm Fine Grain & Real Matte Skin",
      ruleKo: "AI 플라스틱 광택 제거 · 실제 피부 모공과 미세 아날로그 입자 고정",
      ruleEn: "Eliminates AI plastic sheen · locks authentic pores & 35mm fine grain",
      swatchHex: "#475569",
      thumb: "/reel/landing/cut-cheek.webp",
      promptTokenKo: "[고정 질감 레퍼런스: 35mm 아날로그 파인 그레인 및 매트한 실사 피부 모공 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: 35mm analog fine grain and authentic matte skin pore texture]",
    },
    {
      id: "texture_macro_fabric_weave",
      kind: "texture",
      titleKo: "원단 직조 · 스티치 · 메탈 마이크로 질감",
      titleEn: "Macro Fabric Weave & Brushed Metal",
      ruleKo: "울·데님 직조 결, 봉제 실땀, 브러시드 메탈 헤어라인 선명도 고정",
      ruleEn: "Locks wool/denim weave, stitch thread detail, and brushed metal grain",
      swatchHex: "#334155",
      thumb: "/reel/landing/c-garment-ours.webp",
      promptTokenKo: "[고정 질감 레퍼런스: 초근접 원단 직조 결·봉제 스티치·금속 표면 마이크로 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: hyper-sharp fabric weave, seam stitching, and surface micro-texture]",
    },
    {
      id: "texture_dewy_glass_smear",
      kind: "texture",
      titleKo: "유리 굴절 · 결로 · 수분 제형 클린 질감",
      titleEn: "Glass Refraction & Dewy Serum Texture",
      ruleKo: "투명 용기 굴절, 미세 물방울 결로, 스킨케어 제형 스미어 질감 고정",
      ruleEn: "Locks glass bottle refraction, fine condensation droplets, and serum smear",
      swatchHex: "#0EA5E9",
      thumb: "/reel/landing/cut-pump.webp",
      promptTokenKo: "[고정 질감 레퍼런스: 투명 유리 굴절·미세 결로 물방울·수분 제형 하이라이트 질감 고정]",
      promptTokenEn: "[Pinned Texture Ref: crisp glass refraction, micro condensation droplets, and serum texture]",
    },
  ];

/**
 * Oplux (`oplux-plugin.ccx` + `app.oplux.ai`) & Morphic Canvas-inspired
 * Micro-Region Image Editing (극소 부위 정밀 수정) Architecture.
 */
export type StudioImageSubMode =
  | "multi_ref_generate"
  | "micro_region_edit"
  | "canvas_drag_ref";

export type StudioCanvasToolId =
  | "pointer"
  | "marquee_select"
  | "brush_mask"
  | "crop_ratio";

export type MicroEditQualityTier = "Low" | "Medium" | "High";
export type MicroEditResolutionTier = "1K" | "2K" | "4K";

export interface MicroRegionSelectionPreset {
  id: string;
  labelKo: string;
  labelEn: string;
  targetPartKo: string;
  targetPartEn: string;
  /** Normalized selection bounds (0..100%) on the studio canvas */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  defaultEditPromptKo: string;
  defaultEditPromptEn: string;
}

export const MICRO_REGION_SELECTION_PRESETS: ReadonlyArray<MicroRegionSelectionPreset> =
  [
    {
      id: "region_product_label",
      labelKo: "제품 · 전면 라벨 극소 부위",
      labelEn: "Product & Front Label Micro-Region",
      targetPartKo: "제품 용기 · 로고 각인 · 전면 라벨 영역",
      targetPartEn: "Product container · logo engraving · front label",
      xPct: 30,
      yPct: 36,
      wPct: 40,
      hPct: 34,
      defaultEditPromptKo:
        "드래그한 선택 영역 안의 제품만 2번 레퍼런스 제품으로 교체하고, 전면 로고 철자와 표면 반사광을 선명하게 교정해 줘 (선택 영역 밖 배경·인물은 100% 원본 유지).",
      defaultEditPromptEn:
        "Replace only the product inside the selected region with Reference #2, keeping crisp front logo lettering and specular highlights (preserve 100% of pixels outside the selection).",
    },
    {
      id: "region_hand_grip",
      labelKo: "손 모양 · 소품 그립 극소 부위",
      labelEn: "Hand Grip & Held Prop Micro-Region",
      targetPartKo: "손가락 마디 · 그립 각도 · 접촉 그림자 영역",
      targetPartEn: "Finger joints · grip angle · contact shadow",
      xPct: 24,
      yPct: 48,
      wPct: 36,
      hPct: 28,
      defaultEditPromptKo:
        "선택한 손 부위가 제품을 자연스럽게 감싸 쥐도록 손가락 형태와 접촉 그림자만 정밀 교정해 줘 (의류 소매와 배경은 원본 그대로 보존).",
      defaultEditPromptEn:
        "Refine only the selected hand grip and contact shadow so the fingers hold the product naturally (keep sleeve and background untouched).",
    },
    {
      id: "region_face_expression",
      labelKo: "얼굴 표정 · 시선 · 잔머리 부위",
      labelEn: "Facial Expression · Gaze · Hairline",
      targetPartKo: "눈매 · 입꼬리 표정 · 헤어라인 · 피부결 영역",
      targetPartEn: "Eye gaze · subtle expression · hairline · skin pores",
      xPct: 32,
      yPct: 10,
      wPct: 36,
      hPct: 26,
      defaultEditPromptKo:
        "선택 영역 안의 인물 시선을 정면 카메라로 맞추고, 잔머리와 매트한 피부 모공 질감을 자연스럽게 다듬어 줘.",
      defaultEditPromptEn:
        "Adjust the gaze inside the selected region toward the camera and refine flyaway hair and natural matte skin pores.",
    },
    {
      id: "region_collar_stitch",
      labelKo: "옷깃 · 단추 · 소매 핏 극소 부위",
      labelEn: "Collar · Buttons · Sleeve Fit Region",
      targetPartKo: "라펠 대칭 · 단추 여밈 · 원단 주름 영역",
      targetPartEn: "Lapel symmetry · button closure · fabric fold",
      xPct: 26,
      yPct: 28,
      wPct: 48,
      hPct: 38,
      defaultEditPromptKo:
        "선택한 의류 부위의 옷깃 대칭과 봉제 스티치 선을 깔끔하게 정돈하고, 고정된 질감 레퍼런스의 원단 결을 적용해 줘.",
      defaultEditPromptEn:
        "Clean up the collar symmetry and stitch lines inside the selected garment region, applying the pinned fabric weave texture.",
    },
  ];

export type BrandStudioMicroEditModelId =
  | "precision_region_editor"
  | "seamless_edge_inpaint"
  | "texture_fit_reshape"
  | "film_grain_skin_enhancer";

export interface BrandStudioMicroEditModelSpec {
  id: BrandStudioMicroEditModelId;
  nameKo: string;
  nameEn: string;
  badgeKo: string;
  badgeEn: string;
  shortTraitKo: string;
  shortTraitEn: string;
  howItWorksKo: string;
  howItWorksEn: string;
  bestWhenKo: readonly [string, string, string];
  bestWhenEn: readonly [string, string, string];
  supportsQualityTier: boolean;
  supportedResolutions: readonly MicroEditResolutionTier[];
  smartMaskLock: boolean;
  creditsPerEdit: number;
  priceKrwPerEdit: number;
}

export const BRAND_STUDIO_MICRO_EDIT_MODELS: ReadonlyArray<BrandStudioMicroEditModelSpec> =
  [
    {
      id: "precision_region_editor",
      nameKo: "정밀 부위 리터칭 · 라벨/소품/손 교정 에디터",
      nameEn: "Precision Region Editor · Label / Prop / Hand",
      badgeKo: "극소 부위 수정 · 제품/라벨 교정 1순위",
      badgeEn: "Best for Micro-Region Product & Label Edit",
      shortTraitKo:
        "드래그한 선택 영역(Input Preview)과 레퍼런스 사진을 함께 읽어, 선택 부위 내부만 스마트 레이어 마스크로 정밀 교체·수정합니다",
      shortTraitEn:
        "Reads the cropped selection patch + reference images and replaces only the masked region via a non-destructive Smart Layer Mask",
      howItWorksKo:
        "캔버스에서 사각형이나 브러시로 지정한 영역만 가장 가까운 표준 비율(1:1, 4:5, 3:4 등)로 자동 크롭·패딩해 수정한 뒤, 그레이스케일 레이어 마스크(Layer Mask)를 씌워 새 레이어로 얹습니다. 선택 영역 바깥의 원본 픽셀은 1픽셀도 변하지 않습니다.",
      howItWorksEn:
        "Crops and pads only the selected bounds to the closest supported aspect ratio, runs multi-image region editing, and places the result as a masked layer so pixels outside the selection remain 100% untouched.",
      bestWhenKo: [
        "화보 컷에서 다른 부분은 다 마음에 드는데 제품 라벨 글자나 로고만 살짝 깨졌을 때",
        "모델 손에 들린 소품이나 손가락 그립 모양만 어색해서 그 부위만 다시 고치고 싶을 때",
        "특정 영역에 2번 레퍼런스 제품(화장품·음료·가방·시계)을 정확히 합성해 넣을 때",
      ],
      bestWhenEn: [
        "When the whole shot is great except a slightly distorted logo or package label",
        "When only a model's hand grip or held prop needs targeted correction",
        "When inserting Reference #2 (bottle, bag, watch) into a specific selected area",
      ],
      supportsQualityTier: true,
      supportedResolutions: ["1K", "2K"],
      smartMaskLock: true,
      creditsPerEdit: 11,
      priceKrwPerEdit: 140,
    },
    {
      id: "seamless_edge_inpaint",
      nameKo: "심리스 인페인팅 · 조명/피부/배경 경계 블렌딩 에디터",
      nameEn: "Seamless Edge Inpaint · Light / Skin / BG Blend",
      badgeKo: "경계선 티 안 나는 자연 합성 추천",
      badgeEn: "Best for Zero-Seam Edge & Lighting Blend",
      shortTraitKo:
        "선택 영역과 주변 원본 픽셀 사이의 조명·그림자·피부 톤을 자동으로 맞춰 수정 자국이 전혀 남지 않게 블렌딩합니다",
      shortTraitEn:
        "Automatically matches surrounding lighting, shadows, and skin tone across selection edges with zero visible seams",
      howItWorksKo:
        "선택된 영역의 경계면(Edge) 주변 문맥과 색온도를 함께 분석하여, 표정 수정·헤어라인 정리·불필요한 배경 사물 제거·부분 조명 수정 시 경계선 이질감 없이 매끄럽게 이어 붙입니다.",
      howItWorksEn:
        "Analyzes surrounding context and color temperature around the selection mask so expression tweaks, hairline cleanup, and object removal blend invisibly.",
      bestWhenKo: [
        "모델의 시선 방향, 미소 등 표정 일부나 잔머리·헤어라인만 자연스럽게 고칠 때",
        "배경에 걸린 불필요한 소품·전선·그림자를 지우고 주변 공간 질감으로 메울 때",
        "제품 바닥면의 접촉 그림자(Contact Shadow)나 반사광을 주변 채광에 맞게 다듬을 때",
      ],
      bestWhenEn: [
        "Refining gaze direction, subtle facial expressions, or flyaway hairlines",
        "Removing unwanted background objects or wires and filling with matching set texture",
        "Polishing contact shadows and reflections beneath a product",
      ],
      supportsQualityTier: false,
      supportedResolutions: ["1K", "2K", "4K"],
      smartMaskLock: true,
      creditsPerEdit: 14,
      priceKrwPerEdit: 180,
    },
    {
      id: "texture_fit_reshape",
      nameKo: "고해상도 질감 · 의류 핏/주름 부분 리셰이핑 에디터",
      nameEn: "High-Res Texture & Garment Fit Reshape Editor",
      badgeKo: "원단 주름 · 핏 · 4K 디테일 보정",
      badgeEn: "Best for Fabric Drape & 4K Detail",
      shortTraitKo:
        "선택한 의류·가방·제품 부위의 실루엣 핏과 2K/4K 초고해상도 표면 질감을 복원하고 정돈합니다",
      shortTraitEn:
        "Restores 2K/4K surface micro-textures and refines garment silhouette or drape within the selected region",
      howItWorksKo:
        "고정해 둔 질감 참고 레퍼런스(원단 직조·가죽 결·금속 헤어라인)를 선택 영역에 집중 주입하여, 뭉개진 옷 주름이나 흐릿한 디테일을 최대 4K 해상도로 선명하게 되살립니다.",
      howItWorksEn:
        "Injects your pinned texture reference directly into the selected bounds to sharpen fabric folds, leather grain, or metallic edges up to 4K.",
      bestWhenKo: [
        "아우터 옷깃·소매 기장·바지 밑단 주름 등 의류 핏 일부만 깔끔하게 잡을 때",
        "확대했을 때 흐릿해 보이는 원단 직조 결이나 금속 버클 디테일을 4K급으로 살릴 때",
        "뷰티 제형 스미어나 식음료 얼음/결로 부위의 디테일 밀도를 높일 때",
      ],
      bestWhenEn: [
        "Tailoring jacket lapels, sleeve lengths, or trouser hems in a lookbook cut",
        "Restoring 4K fabric weave or metallic hardware sharpness on zoomed-in regions",
        "Boosting macro detail on cosmetic smears or beverage ice condensation",
      ],
      supportsQualityTier: false,
      supportedResolutions: ["2K", "4K"],
      smartMaskLock: true,
      creditsPerEdit: 16,
      priceKrwPerEdit: 200,
    },
    {
      id: "film_grain_skin_enhancer",
      nameKo: "리얼 매트 스킨 & 35mm 물리 필름 그레인 마감",
      nameEn: "Real Matte Skin & 35mm Physical Film Grain Finish",
      badgeKo: "AI 플라스틱 느낌 제거 · 최종 마감",
      badgeEn: "Removes AI Plastic Look · Final Finish",
      shortTraitKo:
        "부분 수정 후 생기기 쉬운 매끈한 AI 피부 광택을 걷어내고, 실제 카메라 필름 입자와 모공 질감으로 톤을 통일합니다",
      shortTraitEn:
        "Eliminates synthetic AI smoothness by blending physical RGB/Mono film grain and matte skin pore micro-contrast",
      howItWorksKo:
        "영역별 밝기 보정(Brightness Correction)을 유지한 채 물리 노이즈 패치(RGB 컬러 그레인 또는 모노 그레인)와 피부결 인핸서를 레이어로 블렌딩해, 수정 부위와 원본 부위가 실제 스튜디오 카메라로 한 번에 찍은 것처럼 일체화됩니다.",
      howItWorksEn:
        "Blends brightness-compensated physical grain patches and skin pore micro-contrast so edited patches and original pixels share one cohesive camera sensor look.",
      bestWhenKo: [
        "극소 부위 수정 후 수정된 부위와 주변 영역의 입자감(Grain)을 완벽히 하나로 맞출 때",
        "인물 피부에서 인위적인 AI 윤기를 빼고 매거진 화보 같은 매트 피부결을 만들 때",
        "최종 화보 컷을 영상 제작(첫 프레임)으로 넘기기 전에 필름 룩 마감을 입힐 때",
      ],
      bestWhenEn: [
        "Unifying sensor grain between an edited micro-region and the rest of the frame",
        "Removing synthetic sheen from model skin for an authentic magazine finish",
        "Applying final film texture before sending the cut to Video Studio as Frame 1",
      ],
      supportsQualityTier: false,
      supportedResolutions: ["2K", "4K"],
      smartMaskLock: true,
      creditsPerEdit: 8,
      priceKrwPerEdit: 100,
    },
  ];

const SUPPORTED_EDIT_RATIOS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "1:1", value: 1 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "5:4", value: 5 / 4 },
  { label: "4:5", value: 0.8 },
];

/**
 * Mirrors `findClosestAspectRatio` from `oplux-plugin.ccx`:
 * Given a selection width & height, returns the closest supported aspect ratio label
 * so the cropped patch can be padded cleanly without geometric distortion.
 */
export function findClosestSupportedAspectRatio(
  width: number,
  height: number,
): string {
  if (height <= 0 || width <= 0) return "1:1";
  const ratio = width / height;
  let best = SUPPORTED_EDIT_RATIOS[0]!;
  let minDiff = Infinity;
  for (const candidate of SUPPORTED_EDIT_RATIOS) {
    const diff = Math.abs(ratio - candidate.value);
    if (diff < minDiff) {
      minDiff = diff;
      best = candidate;
    }
  }
  return best.label;
}

