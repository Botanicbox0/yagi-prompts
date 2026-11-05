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
