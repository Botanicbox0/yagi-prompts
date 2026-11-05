"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ONBOARDING_LIMITS,
  POMELLI_EXTRACTION_STEPS,
  synthesizeBrandIdentityFromIngest,
  type BrandOnboardingAsset,
  type OmniTriageBucket,
  type OnboardingAssetSlot,
  type OnboardingCategory,
  type OnboardingVibe,
  type RawOmniDropItem,
  type SynthesizedBrandOnboarding,
} from "@/lib/brands/identity/onboarding";

export interface BrandOnboardingWizardProps {
  organizationId: string;
  organizationName: string;
  locale: "ko" | "en";
  isOwner: boolean;
  currentStatus: "none" | "draft" | "confirmed";
  currentRevision: number;
  studioHref?: string;
}

const CATEGORY_OPTIONS: ReadonlyArray<{
  value: OnboardingCategory;
  ko: string;
  en: string;
}> = [
  { value: "fashion_apparel", ko: "패션 · 어패럴", en: "Fashion & Apparel" },
  { value: "beauty_skincare", ko: "뷰티 · 스킨케어", en: "Beauty & Skincare" },
  { value: "lifestyle_object", ko: "라이프스타일 · 오브제", en: "Lifestyle & Object" },
  { value: "tech_platform", ko: "테크 · 디지털 서비스", en: "Tech & Platform" },
  { value: "fnb_hospitality", ko: "F&B · 호스피탈리티", en: "F&B & Hospitality" },
];

const VIBE_OPTIONS: ReadonlyArray<{
  value: OnboardingVibe;
  ko: string;
  en: string;
}> = [
  {
    value: "minimal_editorial",
    ko: "미니멀 에디토리얼 (프렌치 블루 · 정갈한 여백)",
    en: "Minimal Editorial (French Blue & negative space)",
  },
  {
    value: "warm_film",
    ko: "웜 아날로그 필름 (아이보리 온기 · 자연광)",
    en: "Warm Analog Film (Ivory warmth & natural light)",
  },
  {
    value: "crisp_commercial",
    ko: "크리스프 커머셜 스튜디오 (라벨·기하 정밀 보존)",
    en: "Crisp Commercial Studio (Precision label & geometry)",
  },
  {
    value: "high_contrast_street",
    ko: "하이콘트라스트 스트리트 (크롬 대비 · 건축 앵글)",
    en: "High-Contrast Street (Chrome contrast & architectural angles)",
  },
  {
    value: "natural_daylight",
    ko: "서울 데이라이트 클린 (확산 창문광 · 일상 톤)",
    en: "Seoul Daylight Clean (Diffused window light)",
  },
];

const SLOT_LABELS: Record<OnboardingAssetSlot, { ko: string; en: string }> = {
  logo: { ko: "로고·심볼 (최대 2)", en: "Logo & Mark (max 2)" },
  product: { ko: "주력 제품 (최대 6)", en: "Hero Product (max 6)" },
  mood: { ko: "선호 무드·화보 (최대 6)", en: "Mood Reference (max 6)" },
};

const BUCKET_META: Record<
  OmniTriageBucket,
  { badgeKo: string; badgeEn: string; descKo: string; descEn: string }
> = {
  logo_vault: {
    badgeKo: "① 로고 · 심볼 금고 (1:1 비율 잠금)",
    badgeEn: "1. Logo & Symbol Vault (1:1 Lock)",
    descKo: "워드마크·심볼·라벨 원본을 분리해 생성 및 부분 수선 시 1:1 고정",
    descEn: "Isolates wordmarks & symbols for 1:1 lock during generation & repair",
  },
  product_vault: {
    badgeKo: "② 제품 · 패키지 마스터",
    badgeEn: "2. Product & Swatch Master",
    descKo: "주력 제품 실루엣·지퍼·보틀·원단 스와치 보존 체크리스트 자동 생성",
    descEn: "Builds geometry, label, and material preservation checklists",
  },
  brand_standard: {
    badgeKo: "③ 브랜드 스탠다드 & 절대 금기",
    badgeEn: "3. Brand Standard & Hard Taboos",
    descKo: "어떤 미감 기조에서도 공통으로 지켜야 할 컬러·서체·절대 금지 3항목",
    descEn: "Invariant colour, typography, and 3 strict taboos across all moods",
  },
  aesthetic_mood_pool: {
    badgeKo: "④ 다중 미감 풀 (기조 A / B / C 군집화)",
    badgeEn: "4. Multi-Aesthetic Pool (Cluster A / B / C)",
    descKo: "화보·핀터레스트 핀에서 조명·색온도·렌즈감만 추출해 3개 기조로 분류",
    descEn: "Clusters lookbook & Pinterest pins into 3 distinct optical/colour lines",
  },
};

const DEFAULT_OMNI_DROP_TEXT = [
  "kaiper-master-wordmark-vector.svg | 워드마크 자간과 심볼 직선 비례 100% 고정",
  "kaiper-symbol-monogram-white.png | 다크 배경용 화이트 반전 심볼 마크 고정",
  "kaiper-26ss-technical-jacket-packshot.jpg | 비대칭 지퍼 라인, 칼라 구조, 나일론 매트 텍스처 보존",
  "kaiper-wide-cargo-pocket-swatch.jpg | 사이드 포켓 입체 주름과 무광 스냅 버튼 위치 유지",
  "kaiper-brand-standard-guideline-v4.pdf | 과도한 네온 사이버펑크 조명 금지. 뷰티 필터 플라스틱 피부 금지.",
  "seongsu-daylight-campaign-01.jpg | 차분한 콘크리트 여백과 확산 자연광 무드",
  "golden-hour-courtyard-lookbook-08.jpg | 야외 골든아워 역광과 아날로그 필름 질감",
  "night-concrete-flash-editorial-14.jpg | 하이콘트라스트 나이트 조명과 깊은 그림자 대비",
].join("\n");

const KAIPER_SAMPLE_ASSETS: BrandOnboardingAsset[] = [
  {
    slot: "logo",
    label: "KAIPER 워드마크 & 심볼 (SVG/PNG)",
    urlOrKey: "brand-assets/kaiper/logo-wordmark.png",
    dominantHex: "#0c1320",
    preserveNote: "워드마크 자간과 심볼 직선 비례 100% 고정",
  },
  {
    slot: "product",
    label: "KAIPER 시그니처 테크니컬 재킷 정면",
    urlOrKey: "brand-assets/kaiper/jacket-front.jpg",
    dominantHex: "#1c2430",
    preserveNote: "비대칭 지퍼 라인, 칼라 구조, 나일론 매트 텍스처 보존",
  },
  {
    slot: "product",
    label: "KAIPER 와이드 카고 팬츠 디테일",
    urlOrKey: "brand-assets/kaiper/cargo-detail.jpg",
    dominantHex: "#2a3342",
    preserveNote: "사이드 포켓 입체 주름과 무광 스냅 버튼 위치 유지",
  },
  {
    slot: "mood",
    label: "서울 성수 콘크리트 데이라이트 룩북",
    urlOrKey: "brand-assets/kaiper/mood-seongsu-daylight.jpg",
    dominantHex: "#3063a7",
    preserveNote: "차가운 건축 콘크리트 여백과 확산 자연광 무드만 차용",
  },
  {
    slot: "mood",
    label: "에디토리얼 로우 앵글 전신 구도",
    urlOrKey: "brand-assets/kaiper/mood-low-angle.jpg",
    dominantHex: "#dce4ef",
    preserveNote: "전신 프레이밍과 절제된 그림자 대비 차용",
  },
];

const BEAUTY_SAMPLE_ASSETS: BrandOnboardingAsset[] = [
  {
    slot: "logo",
    label: "브랜드 보틀 엠블럼 & 세리프 로고",
    urlOrKey: "brand-assets/beauty/logo-monogram.png",
    dominantHex: "#162030",
    preserveNote: "전면 라벨 세리프 자간 및 심볼 중앙 정렬 고정",
  },
  {
    slot: "product",
    label: "히어로 세럼 50ml 프로스티드 글래스 보틀",
    urlOrKey: "brand-assets/beauty/serum-50ml.jpg",
    dominantHex: "#e8eef7",
    preserveNote: "원통형 프로스티드 유리 굴절률과 메탈 스포이드 캡 비례 유지",
  },
  {
    slot: "mood",
    label: "수분감 있는 라임스톤 스튜디오 정물",
    urlOrKey: "brand-assets/beauty/mood-limestone.jpg",
    dominantHex: "#3063a7",
    preserveNote: "측면 자연광 하이라이트와 정갈한 석재 테이블 여백 차용",
  },
];

const FNB_SAMPLE_ASSETS: BrandOnboardingAsset[] = [
  {
    slot: "logo",
    label: "MAISON ROAST 엠보싱 워드마크 & 크레스트",
    urlOrKey: "brand-assets/fnb/logo-crest.svg",
    dominantHex: "#141c28",
    preserveNote: "컵 슬리브 및 패키지 상단 엠보싱 로고 비율 1:1 고정",
  },
  {
    slot: "product",
    label: "시그니처 콜드브루 보틀 & 세라믹 라떼 잔",
    urlOrKey: "brand-assets/fnb/coldbrew-bottle.jpg",
    dominantHex: "#243040",
    preserveNote: "원통형 보틀 라벨 곡률과 세라믹 잔 유약 질감 보존",
  },
  {
    slot: "mood",
    label: "성수 로스터리 바 골든아워 다이닝 무드",
    urlOrKey: "brand-assets/fnb/mood-roastery.jpg",
    dominantHex: "#3063a7",
    preserveNote: "오후 자연광 결로 하이라이트와 따뜻한 오크·스틸 카운터 무드 차용",
  },
];

function parseRawDropLines(text: string): RawOmniDropItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ONBOARDING_LIMITS.maxRawDropItems)
    .map((line) => {
      const [first, ...rest] = line.split("|");
      const nameOrUrl = (first ?? "").trim();
      const note = rest.join("|").trim();
      return {
        nameOrUrl,
        ...(note ? { note } : {}),
      };
    })
    .filter((item) => item.nameOrUrl.length > 0);
}

export function BrandOnboardingWizard({
  organizationId,
  organizationName,
  locale,
  isOwner,
  currentStatus,
  currentRevision,
  studioHref,
}: BrandOnboardingWizardProps) {
  const isKo = locale === "ko";
  const router = useRouter();

  const defaultIsKaiper = organizationName.toUpperCase().includes("KAIPER");

  const [brandName, setBrandName] = useState(
    defaultIsKaiper ? "KAIPER" : organizationName || "KAIPER"
  );
  const [category, setCategory] =
    useState<OnboardingCategory>("fashion_apparel");
  const [preferredVibe, setPreferredVibe] =
    useState<OnboardingVibe>("minimal_editorial");
  const [websiteUrlsText, setWebsiteUrlsText] = useState(
    "https://kaiper.kr\nhttps://kaiper.kr/collections/signature"
  );
  const [instagramHandle, setInstagramHandle] = useState("@kaiper.official");
  const [instagramPostUrlsText, setInstagramPostUrlsText] = useState(
    "https://www.instagram.com/p/C9KaiperLook01/\nhttps://www.instagram.com/p/C9KaiperLook02/"
  );
  const [pinterestBoardUrlsText, setPinterestBoardUrlsText] = useState(
    "https://www.pinterest.com/kaiper_official/26ss-editorial-mood/"
  );
  const [pinterestPinCountHint, setPinterestPinCountHint] = useState(1240);
  const [rawDropText, setRawDropText] = useState(DEFAULT_OMNI_DROP_TEXT);
  const [assets, setAssets] =
    useState<BrandOnboardingAsset[]>(KAIPER_SAMPLE_ASSETS);
  const [brandGuideNote, setBrandGuideNote] = useState(
    "과도한 네온 사이버펑크 조명 금지. 뷰티 필터로 뭉개진 플라스틱 피부 표현 금지. 의상 로고 철자 변형 절대 금지."
  );

  const [newSlot, setNewSlot] = useState<OnboardingAssetSlot>("product");
  const [newLabel, setNewLabel] = useState("");
  const [newUrlOrKey, setNewUrlOrKey] = useState("");
  const [newPreserveNote, setNewPreserveNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [bentoTab, setBentoTab] = useState<"overview" | "details">("overview");
  const [activeExtractionStepIndex, setActiveExtractionStepIndex] = useState(
    POMELLI_EXTRACTION_STEPS.length - 1
  );
  const [modelPersonaEnabled, setModelPersonaEnabled] = useState(true);

  const websiteUrls = websiteUrlsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, ONBOARDING_LIMITS.maxWebsiteUrls);

  const instagramPostUrls = instagramPostUrlsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, ONBOARDING_LIMITS.maxInstagramPostUrls);

  const pinterestBoardUrls = pinterestBoardUrlsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, ONBOARDING_LIMITS.maxPinterestBoardUrls);

  const rawAssetDrop = parseRawDropLines(rawDropText);

  const logoCount = assets.filter((a) => a.slot === "logo").length;
  const productCount = assets.filter((a) => a.slot === "product").length;
  const moodCount = assets.filter((a) => a.slot === "mood").length;

  let preview: SynthesizedBrandOnboarding | null = null;
  try {
    preview = synthesizeBrandIdentityFromIngest({
      organizationId,
      brandName: brandName.trim() || "KAIPER",
      category,
      preferredVibe,
      websiteUrls,
      instagramHandle: instagramHandle.trim() || undefined,
      instagramPostUrls,
      pinterestBoardUrls,
      pinterestBoardTotalPinCountHint: pinterestPinCountHint,
      rawAssetDrop,
      assets,
      brandGuideNote,
    });
  } catch {
    preview = null;
  }

  function handleFileDropInput(e: ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const addedLines: string[] = [];
    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList[i];
      if (!file) continue;
      addedLines.push(`${file.name} | 업로드 파일 (${file.type || "asset"})`);
    }
    setRawDropText((prev) =>
      [prev.trim(), ...addedLines].filter(Boolean).join("\n")
    );
    setStatusMessage(
      isKo
        ? `파일 ${addedLines.length}개가 무제한 인테이크 큐에 추가되어 4개 바구니(로고·제품·스탠다드·다중 미감)로 자동 분류되었습니다.`
        : `Added ${addedLines.length} files to the Omni-Intake queue and auto-sorted into 4 buckets.`
    );
  }

  function simulateBulk48AssetDrop() {
    const bulkLines: string[] = [
      "kaiper-primary-logo-lockup.svg | 메인 워드마크 원본 비율 1:1 고정",
      "kaiper-CareLabel-woven-mark.png | 내부 직조 라벨 타이포그래피 고정",
      "kaiper-brandbook-2026-standard.pdf | 로고 최소 크기 28px, 주변 여백 1.5x, 과장된 네온 조명 금지",
    ];
    for (let i = 1; i <= 10; i += 1) {
      bulkLines.push(
        `kaiper-26ss-product-packshot-${String(i).padStart(2, "0")}.jpg | 제품 실루엣·지퍼·원단 매트 질감 보존`
      );
    }
    for (let i = 1; i <= 35; i += 1) {
      const moodKind =
        i % 3 === 0
          ? "night-concrete-flash"
          : i % 2 === 0
            ? "golden-hour-outdoor"
            : "clean-studio-daylight";
      bulkLines.push(`kaiper-lookbook-${moodKind}-${String(i).padStart(2, "0")}.webp`);
    }
    setRawDropText(bulkLines.join("\n"));
    setPinterestBoardUrlsText(
      "https://www.pinterest.com/kaiper_official/26ss-editorial-mood/\nhttps://www.pinterest.com/kaiper_official/studio-object-archive/"
    );
    setPinterestPinCountHint(1480);
    setStatusMessage(
      isKo
        ? "브랜드 에셋과 핀터레스트 보드 자동 분류가 완료되었습니다."
        : "Brand assets and Pinterest boards have been auto-sorted."
    );
  }

  function applyPreset(kind: "kaiper" | "beauty" | "fnb" | "blank") {
    setErrorMessage("");
    setStatusMessage("");
    setActiveExtractionStepIndex(POMELLI_EXTRACTION_STEPS.length - 1);
    if (kind === "kaiper") {
      setBrandName("KAIPER");
      setCategory("fashion_apparel");
      setPreferredVibe("minimal_editorial");
      setWebsiteUrlsText(
        "https://kaiper.kr\nhttps://kaiper.kr/collections/signature"
      );
      setInstagramHandle("@kaiper.official");
      setInstagramPostUrlsText(
        "https://www.instagram.com/p/C9KaiperLook01/\nhttps://www.instagram.com/p/C9KaiperLook02/"
      );
      setPinterestBoardUrlsText(
        "https://www.pinterest.com/kaiper_official/26ss-editorial-mood/"
      );
      setPinterestPinCountHint(1240);
      setRawDropText(DEFAULT_OMNI_DROP_TEXT);
      setAssets(KAIPER_SAMPLE_ASSETS);
      setBrandGuideNote(
        "과도한 네온 사이버펑크 조명 금지. 뷰티 필터로 뭉개진 플라스틱 피부 표현 금지. 의상 로고 철자 변형 절대 금지."
      );
    } else if (kind === "beauty") {
      setBrandName(organizationName || "AURA LAB");
      setCategory("beauty_skincare");
      setPreferredVibe("crisp_commercial");
      setWebsiteUrlsText("https://auralab.kr");
      setInstagramHandle("@auralab.official");
      setInstagramPostUrlsText("https://www.instagram.com/p/C9AuraSerum01/");
      setPinterestBoardUrlsText(
        "https://www.pinterest.com/auralab/skincare-still-life/"
      );
      setPinterestPinCountHint(920);
      setRawDropText(
        [
          "auralab-monogram-mark.svg | 보틀 전면 세리프 로고 1:1 고정",
          "auralab-serum-50ml-packshot.jpg | 프로스티드 유리 굴절률과 스포이드 캡 비례 유지",
          "auralab-brand-standard.pdf | 용기 기하 변형 금지, 전면 라벨 왜곡 금지",
          "auralab-limestone-daylight-01.jpg | 클린 스튜디오 석재 여백",
          "auralab-warm-botanical-sunlight-02.jpg | 골든아워 자연광 그림자",
        ].join("\n")
      );
      setAssets(BEAUTY_SAMPLE_ASSETS);
      setBrandGuideNote(
        "용기 기하 변형 금지. 전면 라벨 타이포그래피 왜곡 금지. 과도한 웜톤 색번짐 금지."
      );
    } else if (kind === "fnb") {
      setBrandName("MAISON ROAST");
      setCategory("fnb_hospitality");
      setPreferredVibe("warm_film");
      setWebsiteUrlsText("https://maisonroast.kr");
      setInstagramHandle("@maisonroast.seoul");
      setInstagramPostUrlsText("https://www.instagram.com/p/C9MaisonPour01/");
      setPinterestBoardUrlsText(
        "https://www.pinterest.com/maisonroast/dining-sizzle-archive/"
      );
      setPinterestPinCountHint(760);
      setRawDropText(
        [
          "maisonroast-crest-logo.svg | 컵 슬리브 및 패키지 상단 로고 1:1 고정",
          "maisonroast-coldbrew-bottle-packshot.jpg | 원통형 보틀 라벨 곡률 및 결로 물방울 보존",
          "maisonroast-brand-standard.pdf | 식기 색감 왜곡 금지, 인공적인 연기 합성 금지",
          "maisonroast-morning-espresso-bar-01.jpg | 따뜻한 오크 테이블과 오전 창문광",
          "maisonroast-condensation-macro-04.jpg | 얼음 잔 결로 하이라이트",
        ].join("\n")
      );
      setAssets(FNB_SAMPLE_ASSETS);
      setBrandGuideNote(
        "패키지 로고 곡률 왜곡 금지. 식재료 색감 과포화 금지. 인위적인 그래픽 연기 합성 금지."
      );
    } else {
      setBrandName(organizationName || "Brand");
      setWebsiteUrlsText("");
      setInstagramHandle("");
      setInstagramPostUrlsText("");
      setPinterestBoardUrlsText("");
      setRawDropText("");
      setAssets([]);
      setBrandGuideNote("");
    }
  }

  function handleAddAsset() {
    setErrorMessage("");
    if (!newLabel.trim() || !newPreserveNote.trim()) {
      setErrorMessage(
        isKo
          ? "에셋 이름과 보존·차용 지침을 입력해 주세요."
          : "Please enter both asset label and preservation rule."
      );
      return;
    }
    if (assets.length >= ONBOARDING_LIMITS.maxTotalAssets) {
      setErrorMessage(
        isKo
          ? `시각 에셋은 최대 ${ONBOARDING_LIMITS.maxTotalAssets}장까지만 등록할 수 있습니다.`
          : `Maximum ${ONBOARDING_LIMITS.maxTotalAssets} visual assets allowed.`
      );
      return;
    }
    if (newSlot === "logo" && logoCount >= ONBOARDING_LIMITS.maxLogoAssets) {
      setErrorMessage(
        isKo
          ? `로고 에셋은 최대 ${ONBOARDING_LIMITS.maxLogoAssets}장까지 등록 가능합니다.`
          : `Logo assets cannot exceed ${ONBOARDING_LIMITS.maxLogoAssets}.`
      );
      return;
    }
    if (
      newSlot === "product" &&
      productCount >= ONBOARDING_LIMITS.maxProductAssets
    ) {
      setErrorMessage(
        isKo
          ? `제품 에셋은 최대 ${ONBOARDING_LIMITS.maxProductAssets}장까지 등록 가능합니다.`
          : `Product assets cannot exceed ${ONBOARDING_LIMITS.maxProductAssets}.`
      );
      return;
    }
    if (newSlot === "mood" && moodCount >= ONBOARDING_LIMITS.maxMoodAssets) {
      setErrorMessage(
        isKo
          ? `무드 레퍼런스는 최대 ${ONBOARDING_LIMITS.maxMoodAssets}장까지 등록 가능합니다.`
          : `Mood assets cannot exceed ${ONBOARDING_LIMITS.maxMoodAssets}.`
      );
      return;
    }

    setAssets([
      ...assets,
      {
        slot: newSlot,
        label: newLabel.trim(),
        urlOrKey: newUrlOrKey.trim() || undefined,
        preserveNote: newPreserveNote.trim(),
      },
    ]);
    setNewLabel("");
    setNewUrlOrKey("");
    setNewPreserveNote("");
  }

  function handleRemoveAsset(index: number) {
    setAssets(assets.filter((_, idx) => idx !== index));
  }

  async function submitIngest(autoConfirm: boolean) {
    setBusy(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "identity.ingest",
          input: {
            organizationId,
            brandName: brandName.trim() || "KAIPER",
            category,
            preferredVibe,
            websiteUrls,
            instagramHandle: instagramHandle.trim() || undefined,
            instagramPostUrls,
            pinterestBoardUrls,
            pinterestBoardTotalPinCountHint: pinterestPinCountHint,
            rawAssetDrop,
            assets,
            brandGuideNote,
            autoConfirm,
            expectedRevision: currentRevision,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setErrorMessage(
          typeof payload.message === "string" && payload.message
            ? payload.message
            : isKo
              ? "온보딩 인제스트 저장 중 오류가 발생했습니다."
              : "Failed to save brand onboarding ingest."
        );
        return;
      }
      setStatusMessage(
        autoConfirm
          ? isKo
            ? "브랜드 로고 금고 · 스탠다드 · 다중 미감 기조(A/B/C) 3종이 확정(Confirmed)되어 스튜디오에 즉시 연동되었습니다."
            : "Brand Logo Vault, Standard, and 3 Multi-Aesthetic Lines (A/B/C) confirmed and synced to Studio."
          : isKo
            ? "브랜드 에셋 자동 분류 및 다중 미감(A/B/C) 초안(Draft)이 저장되었습니다."
            : "Brand asset triage and Multi-Aesthetic draft saved."
      );
      router.refresh();
    } catch {
      setErrorMessage(
        isKo
          ? "네트워크 요청 중 오류가 발생했습니다."
          : "Network error while submitting onboarding."
      );
    } finally {
      setBusy(false);
    }
  }

  function onFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitIngest(false);
  }

  return (
    <section
      className="bw-panel"
      data-brand-onboarding-wizard
      data-onboarding-status={currentStatus}
    >
      <div className="bw-row">
        <div>
          <p className="bw-kicker">
            {isKo ? "브랜드 프로필 설정" : "BRAND PROFILE SETUP"}
          </p>
          <h2>
            {isKo
              ? "브랜드 에셋과 웹사이트·핀터레스트 링크를 넣으면 브랜드 톤을 자동으로 정리합니다"
              : "Add your brand assets, website & Pinterest links to organize your brand tone automatically"}
          </h2>
          <p className="bw-muted">
            {isKo
              ? "로고와 제품은 흔들리지 않게 고정하고, 화보와 레퍼런스 보드는 3가지 무드(A / B / C)로 정리해 스튜디오에서 바로 쓸 수 있게 준비합니다."
              : "We keep your logos and products consistent while organizing your lookbooks and reference boards into 3 ready-to-use moods (A / B / C)."}
          </p>
        </div>
        <div className="bw-row">
          <button
            type="button"
            className="bw-button"
            data-onboarding-preset="kaiper"
            onClick={() => applyPreset("kaiper")}
            disabled={busy}
          >
            {isKo ? "패션 샘플" : "Fashion Sample"}
          </button>
          <button
            type="button"
            className="bw-button"
            data-onboarding-bulk-sim
            onClick={simulateBulk48AssetDrop}
            disabled={busy}
          >
            {isKo ? "대량 에셋 샘플 불러오기" : "Load Bulk Sample"}
          </button>
          <button
            type="button"
            className="bw-button"
            data-onboarding-preset="beauty"
            onClick={() => applyPreset("beauty")}
            disabled={busy}
          >
            {isKo ? "뷰티 샘플" : "Beauty Sample"}
          </button>
          <button
            type="button"
            className="bw-button"
            data-onboarding-preset="fnb"
            onClick={() => applyPreset("fnb")}
            disabled={busy}
          >
            {isKo ? "F&B 샘플" : "F&B Sample"}
          </button>
          <button
            type="button"
            className="bw-button"
            data-onboarding-preset="blank"
            onClick={() => applyPreset("blank")}
            disabled={busy}
          >
            {isKo ? "초기화" : "Clear"}
          </button>
        </div>
      </div>

      <form onSubmit={onFormSubmit} className="bw-form bw-fields" data-onboarding-form>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <label>
            {isKo ? "브랜드 이름" : "Brand Name"}
            <input
              name="brandName"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              maxLength={120}
              required
              disabled={!isOwner || busy}
            />
          </label>
          <label>
            {isKo ? "업종 · 카테고리" : "Category"}
            <select
              name="category"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as OnboardingCategory)
              }
              disabled={!isOwner || busy}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isKo ? opt.ko : opt.en}
                </option>
              ))}
            </select>
          </label>
          <label>
            {isKo ? "대표 기본 기조 (Primary Vibe)" : "Primary Visual Vibe"}
            <select
              name="preferredVibe"
              value={preferredVibe}
              onChange={(e) =>
                setPreferredVibe(e.target.value as OnboardingVibe)
              }
              disabled={!isOwner || busy}
            >
              {VIBE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {isKo ? opt.ko : opt.en}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Above-the-Fold 1: Pomelli-Style Bento Business Profile + Right-Side Creative Director Co-Pilot Dock */}
        {preview && (
          <div
            className="bw-card bw-fields"
            data-pomelli-bento-profile
            data-bento-active-tab={bentoTab}
            style={{
              margin: 0,
              padding: 20,
              background: "#FFFFFF",
              borderRadius: 24,
              border: "1px solid rgba(15, 23, 42, 0.08)",
            }}
          >
            <div className="bw-row">
              <div>
                <p className="bw-kicker">
                  {isKo
                    ? "YOUR BUSINESS PROFILE · 벤토 그리드 비즈니스 프로필 & 디렉터 코파일럿"
                    : "YOUR BUSINESS PROFILE · BENTO BRAND OVERVIEW & DIRECTOR CO-PILOT"}
                </p>
                <h3 style={{ margin: "4px 0" }}>
                  {isKo
                    ? `${preview.bentoProfile.brandName} 비즈니스 프로필 — 로고·서체·컬러 스와치·모델 페르소나·톤앤매너 한눈에 보기`
                    : `${preview.bentoProfile.brandName} Business Profile — Logo, Fonts, Color Swatches, Model Persona & Voice`}
                </h3>
              </div>

              {/* Segmented Tab Switch: Brand overview | Business details */}
              <div
                className="bw-row"
                role="tablist"
                data-pomelli-bento-tabs
                style={{
                  background: "#F6F7F9",
                  padding: 4,
                  borderRadius: 999,
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={bentoTab === "overview"}
                  data-pomelli-tab="overview"
                  onClick={() => setBentoTab("overview")}
                  className={
                    bentoTab === "overview"
                      ? "bw-button bw-primary"
                      : "bw-button"
                  }
                  style={{ borderRadius: 999, padding: "6px 14px" }}
                >
                  {isKo
                    ? "Brand overview (브랜드 비주얼 프로필)"
                    : "Brand overview"}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bentoTab === "details"}
                  data-pomelli-tab="details"
                  onClick={() => setBentoTab("details")}
                  className={
                    bentoTab === "details"
                      ? "bw-button bw-primary"
                      : "bw-button"
                  }
                  style={{ borderRadius: 999, padding: "6px 14px" }}
                >
                  {isKo
                    ? "Business details (업종 · 채널 · CTA)"
                    : "Business details"}
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
                alignItems: "start",
                gap: 16,
              }}
            >
              {/* Left 2/3: Bento Cards */}
              <div className="bw-fields" style={{ margin: 0, gap: 12 }}>
                <div
                  className="bw-card"
                  data-pomelli-model-preferences
                  data-model-persona-enabled={modelPersonaEnabled}
                  style={{
                    margin: 0,
                    padding: 14,
                    borderRadius: 18,
                    background: modelPersonaEnabled
                      ? "rgba(56, 117, 197, 0.06)"
                      : "#F6F7F9",
                    border: modelPersonaEnabled
                      ? "1.5px solid #3875C5"
                      : "1px solid rgba(15, 23, 42, 0.08)",
                  }}
                >
                  <div className="bw-row">
                    <div>
                      <strong style={{ fontSize: 14 }}>
                        {isKo
                          ? "AI 모델 페르소나 & 실제 피부 결 일관성 고정 (Model Preferences)"
                          : "Choose Model Preferences (Consistent AI Model Traits)"}
                      </strong>
                      <p
                        className="bw-muted"
                        style={{ margin: "4px 0 0", fontSize: 12 }}
                      >
                        {isKo
                          ? preview.bentoProfile.modelPreferences.summaryKo
                          : preview.bentoProfile.modelPreferences.summaryEn}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={
                        modelPersonaEnabled
                          ? "bw-button bw-primary"
                          : "bw-button"
                      }
                      data-pomelli-model-toggle
                      onClick={() =>
                        setModelPersonaEnabled((prev) => !prev)
                      }
                    >
                      {modelPersonaEnabled
                        ? isKo
                          ? "✓ 일관성 켜짐 (Enabled)"
                          : "✓ Enabled"
                        : isKo
                          ? "켜기 (Enable)"
                          : "Enable"}
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {(isKo
                      ? preview.bentoProfile.modelPreferences.traitsKo
                      : preview.bentoProfile.modelPreferences.traitsEn
                    ).map((trait) => (
                      <span
                        key={trait}
                        className="bw-badge"
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid rgba(15, 23, 42, 0.1)",
                        }}
                      >
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>

                {bentoTab === "overview" ? (
                  <>
                    {/* Row 1: Logo Box + Fonts (Aa) Box + Brand Swatches */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div
                        className="bw-card"
                        data-bento-card="logo"
                        style={{
                          margin: 0,
                          padding: 16,
                          borderRadius: 18,
                          background: "#F6F7F9",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo ? "Logo (1:1 비율 잠금)" : "Logo (1:1 Lock)"}
                        </small>
                        <div
                          style={{
                            margin: "12px 0",
                            padding: "16px 12px",
                            borderRadius: 14,
                            background: "#FFFFFF",
                            border: "1px solid rgba(15, 23, 42, 0.08)",
                            textAlign: "center",
                            fontSize: 20,
                            fontWeight: 800,
                            letterSpacing: "-0.03em",
                            color: "#0B0D12",
                          }}
                        >
                          {preview.bentoProfile.brandName}
                        </div>
                        <small className="bw-muted">
                          🔗 {preview.bentoProfile.primaryWebsiteUrl}
                        </small>
                      </div>

                      <div
                        className="bw-card"
                        data-bento-card="fonts"
                        style={{
                          margin: 0,
                          padding: 16,
                          borderRadius: 18,
                          background: "#F6F7F9",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo ? "Fonts (지정 서체)" : "Fonts"}
                        </small>
                        <div style={{ textAlign: "center", margin: "8px 0" }}>
                          <div
                            style={{
                              fontSize: 34,
                              fontWeight: 700,
                              color: "#3875C5",
                              lineHeight: 1.1,
                            }}
                          >
                            {preview.bentoProfile.fontSpecimen.sampleGlyph}
                          </div>
                          <strong style={{ fontSize: 13 }}>
                            {preview.bentoProfile.fontSpecimen.displayFont}
                          </strong>
                        </div>
                        <small className="bw-muted">
                          Mono: {preview.bentoProfile.fontSpecimen.monoFont}
                        </small>
                      </div>

                      <div
                        className="bw-card"
                        data-bento-card="colors"
                        style={{
                          margin: 0,
                          padding: 16,
                          borderRadius: 18,
                          background: "#F6F7F9",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo
                            ? "Colors (브랜드 컬러 스와치)"
                            : "Colors (Brand Swatches)"}
                        </small>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            margin: "12px 0",
                            flexWrap: "wrap",
                          }}
                        >
                          {preview.bentoProfile.colorSwatches.map((swatch) => (
                            <div
                              key={`${swatch.roleEn}-${swatch.hex}`}
                              title={`${isKo ? swatch.roleKo : swatch.roleEn}: ${swatch.hex}`}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: "50%",
                                  background: swatch.hex,
                                  border: "1.5px solid rgba(15, 23, 42, 0.16)",
                                  display: "inline-block",
                                }}
                              />
                              <code style={{ fontSize: 10 }}>{swatch.hex}</code>
                            </div>
                          ))}
                        </div>
                        <small className="bw-muted">
                          {isKo
                            ? "WCAG 4.5:1 명도 대비 자동 검증됨"
                            : "WCAG 4.5:1 contrast verified"}
                        </small>
                      </div>
                    </div>

                    {/* Row 2: Tagline (One-liner) + Brand Values */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div
                        className="bw-card"
                        data-bento-card="tagline"
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 18,
                          background: "#F6F7F9",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo ? "Tagline (원라이너 슬로건)" : "One-liner Tagline"}
                        </small>
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 14,
                            fontWeight: 600,
                            color: "#0B0D12",
                          }}
                        >
                          {isKo
                            ? preview.bentoProfile.taglineKo
                            : preview.bentoProfile.taglineEn}
                        </p>
                      </div>

                      <div
                        className="bw-card"
                        data-bento-card="values"
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 18,
                          background: "#F6F7F9",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo ? "Brand values (핵심 가치)" : "Brand values"}
                        </small>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 8,
                          }}
                        >
                          {(isKo
                            ? preview.bentoProfile.brandValuesKo
                            : preview.bentoProfile.brandValuesEn
                          ).map((val) => (
                            <span
                              key={val}
                              className="bw-badge"
                              style={{ background: "#FFFFFF" }}
                            >
                              {val}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Brand Aesthetic Chips + Brand Tone of Voice Chips */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div
                        className="bw-card"
                        data-bento-card="aesthetic-tags"
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 18,
                          background: "#F6F7F9",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo
                            ? "Brand aesthetic (시각 미감 키워드)"
                            : "Brand aesthetic"}
                        </small>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 8,
                          }}
                        >
                          {(isKo
                            ? preview.bentoProfile.aestheticTagsKo
                            : preview.bentoProfile.aestheticTagsEn
                          ).map((tag) => (
                            <span
                              key={tag}
                              className="bw-badge"
                              style={{
                                background: "rgba(56, 117, 197, 0.1)",
                                color: "#3063A7",
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div
                        className="bw-card"
                        data-bento-card="tone-of-voice"
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 18,
                          background: "#F6F7F9",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo
                            ? "Brand tone of voice (브랜드 어조)"
                            : "Brand tone of voice"}
                        </small>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 8,
                          }}
                        >
                          {(isKo
                            ? preview.bentoProfile.toneOfVoiceTagsKo
                            : preview.bentoProfile.toneOfVoiceTagsEn
                          ).map((tag) => (
                            <span
                              key={tag}
                              className="bw-badge"
                              style={{ background: "#FFFFFF" }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Row 4: Business Overview Summary */}
                    <div
                      className="bw-card"
                      data-bento-card="business-overview"
                      style={{
                        margin: 0,
                        padding: 14,
                        borderRadius: 18,
                        background: "#F6F7F9",
                      }}
                    >
                      <small className="bw-muted">
                        {isKo
                          ? "Business overview (비즈니스 요약)"
                          : "Business overview"}
                      </small>
                      <p
                        className="bw-muted"
                        style={{
                          margin: "6px 0 0",
                          fontSize: 13,
                          color: "#0B0D12",
                        }}
                      >
                        {isKo
                          ? preview.bentoProfile.businessOverviewKo
                          : preview.bentoProfile.businessOverviewEn}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="bw-fields" style={{ margin: 0, gap: 12 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div
                        className="bw-card"
                        data-bento-card="industry-subcategory"
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 18,
                          background: "#F6F7F9",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo
                            ? "Industry / Subcategory (업종 · 세부 버티컬)"
                            : "Industry / Subcategory"}
                        </small>
                        <p style={{ margin: "6px 0 2px", fontWeight: 700 }}>
                          {isKo
                            ? preview.bentoProfile.industryLabelKo
                            : preview.bentoProfile.industryLabelEn}
                        </p>
                        <small className="bw-muted">
                          {isKo
                            ? preview.bentoProfile.subcategoryLabelKo
                            : preview.bentoProfile.subcategoryLabelEn}
                        </small>
                      </div>

                      <div
                        className="bw-card"
                        data-bento-card="cta-links"
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 18,
                          background: "#F6F7F9",
                        }}
                      >
                        <small className="bw-muted">
                          {isKo
                            ? "Social media & Call To Action Links"
                            : "Social media & Call To Action Links"}
                        </small>
                        <ul className="bw-list" style={{ marginTop: 8 }}>
                          {preview.bentoProfile.ctaLinks.map((cta) => (
                            <li key={cta.url} style={{ fontSize: 12 }}>
                              <strong>
                                {isKo ? cta.labelKo : cta.labelEn}:
                              </strong>{" "}
                              <span className="bw-muted">{cta.url}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right 1/3: Director Co-Pilot Quick-Start Dock */}
              <aside
                className="bw-card bw-fields"
                data-pomelli-director-dock
                style={{
                  margin: 0,
                  padding: 18,
                  borderRadius: 20,
                  background: "#F6F7F9",
                  border: "1px solid rgba(56, 117, 197, 0.24)",
                }}
              >
                <p className="bw-kicker">
                  {isKo ? "CREATIVE DIRECTOR CO-PILOT" : "CREATIVE DIRECTOR CO-PILOT"}
                </p>
                <strong style={{ fontSize: 15 }}>
                  {isKo
                    ? "비즈니스 프로필과 미감 기조(A/B/C) 분석이 끝났습니다"
                    : "Your Business Profile & Aesthetic Lines (A/B/C) are ready"}
                </strong>
                <p className="bw-muted" style={{ margin: 0, fontSize: 12.5 }}>
                  {isKo
                    ? "추출된 로고·컬러·서체·미감 기조를 확인하셨다면, 아래 워크플로 중 하나로 바로 제작을 시작해 보세요."
                    : "Review your extracted profile on the left, then jump straight into one of these studio workflows."}
                </p>

                <div className="bw-fields" style={{ margin: "6px 0 0", gap: 8 }}>
                  <a
                    href={studioHref || "/brand/studio"}
                    className="bw-button bw-primary"
                    data-director-dock-action="photoshoot"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>
                      {isKo
                        ? "↗ 제품 화보 촬영 (Studio · 원료 · 착장 · 공간)"
                        : "↗ Create Product Photoshoot"}
                    </span>
                  </a>
                  <a
                    href={studioHref || "/brand/studio"}
                    className="bw-button"
                    data-director-dock-action="campaigns"
                    style={{ justifyContent: "space-between", width: "100%" }}
                  >
                    <span>
                      {isKo
                        ? "↗ 패션·뷰티·F&B 멀티 비율 캠페인 팩"
                        : "↗ Create Multi-Ratio Campaign Pack"}
                    </span>
                  </a>
                  {isOwner && (
                    <button
                      type="button"
                      className="bw-button"
                      data-director-dock-action="confirm-brandbook"
                      onClick={() => void submitIngest(true)}
                      disabled={busy}
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <span>
                        {isKo
                          ? "↗ 브랜드북 & 다중 미감(A/B/C) 확정 저장"
                          : "↗ Confirm Brand Book & Aesthetic Lines"}
                      </span>
                    </button>
                  )}
                </div>

                {/* Bottom 100% Complete Indicator */}
                <div
                  data-pomelli-completion-bar
                  style={{
                    marginTop: 8,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(15, 23, 42, 0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div>
                    <small style={{ fontWeight: 700, color: "#3063A7" }}>
                      {isKo
                        ? `${preview.bentoProfile.completenessPct}% 프로필 준비 완료`
                        : `${preview.bentoProfile.completenessPct}% complete`}
                    </small>
                    <div
                      style={{
                        width: 110,
                        height: 6,
                        borderRadius: 999,
                        background: "rgba(56, 117, 197, 0.18)",
                        marginTop: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${preview.bentoProfile.completenessPct}%`,
                          height: "100%",
                          background: "#3875C5",
                        }}
                      />
                    </div>
                  </div>
                  <a
                    href={studioHref || "/brand/studio"}
                    className="bw-button bw-primary"
                    data-pomelli-lets-go
                  >
                    {isKo ? "Let's go →" : "Let's go →"}
                  </a>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* Above-the-Fold 2: Multi-Aesthetic Lines (A / B / C) Visual Cards */}
        {preview && (
          <div
            className="bw-card bw-fields"
            data-onboarding-aesthetic-lines
            style={{
              margin: 0,
              padding: 18,
              background: "#FFFFFF",
              borderRadius: 22,
            }}
          >
            <div className="bw-row">
              <div>
                <p className="bw-kicker">
                  {isKo
                    ? "MULTI-AESTHETIC LINES · 추출된 브랜드 다중 미감 기조 (A / B / C)"
                    : "MULTI-AESTHETIC LINES · EXTRACTED BRAND MOOD CLUSTERS (A / B / C)"}
                </p>
                <h3>
                  {isKo
                    ? "하나로 뭉뚱그리지 않고 3가지 미감 기조로 분리했습니다 — 스튜디오에서 언제든 골라 쓸 수 있습니다"
                    : "Clustered into 3 distinct Aesthetic Lines ready for 1-click selection in Studio"}
                </h3>
              </div>
              <span className="bw-badge" data-onboarding-recommended-look>
                {isKo
                  ? `대표 컬러 룩: ${preview.recommendedLookPresetId}`
                  : `Primary Look: ${preview.recommendedLookPresetId}`}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              {preview.aestheticLines.map((line) => (
                <div
                  key={line.id}
                  className="bw-card bw-fields"
                  data-aesthetic-line-card={line.code}
                  style={{
                    margin: 0,
                    padding: 14,
                    borderRadius: 18,
                    background: "#F6F7F9",
                    border: "1px solid rgba(15, 23, 42, 0.08)",
                  }}
                >
                  <div
                    style={{
                      height: 128,
                      borderRadius: 14,
                      backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.12) 0%, rgba(15,23,42,0.52) 100%), url(${line.previewImageUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      padding: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#FFFFFF",
                        background: "#3875C5",
                        padding: "3px 9px",
                        borderRadius: 999,
                      }}
                    >
                      {isKo
                        ? `기조 ${line.code} · 비중 ${line.sharePct}%`
                        : `Line ${line.code} · ${line.sharePct}%`}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#F8FAFC",
                        background: "rgba(15, 23, 42, 0.68)",
                        padding: "3px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {isKo ? `무드 ${line.code}` : `Mood ${line.code}`}
                    </span>
                  </div>
                  <div>
                    <strong style={{ fontSize: 14 }}>
                      {isKo ? line.titleKo : line.titleEn}
                    </strong>
                    <p
                      className="bw-muted"
                      style={{ margin: "4px 0 6px", fontSize: 12 }}
                    >
                      {isKo ? line.subtitleKo : line.subtitleEn}
                    </p>
                    <small className="bw-muted" style={{ display: "block" }}>
                      {isKo ? line.rulePromptKo : line.rulePromptEn}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progressive disclosure for raw URL / Pinterest / Omni-Asset dropzone */}
        <details className="bw-service-disclosure">
          <summary>
            {isKo
              ? `웹사이트 · 핀터레스트 보드 · 에셋 파일 원본 입력 및 수정 (${rawAssetDrop.length}개 에셋 · 대표 레퍼런스 ${preview?.pinterestFunnel.stage2MedoidsSelected ?? 12}장)`
              : `Edit Website, Pinterest Boards & Raw Asset Drop (${rawAssetDrop.length} assets)`}
          </summary>
          <div className="bw-fields" style={{ marginTop: 12 }}>
            {/* Pomelli-Inspired 1-URL Live Business Profile Analyzer */}
            <div
              className="bw-card bw-fields"
              data-pomelli-url-analyzer
              style={{
                margin: 0,
                padding: 18,
                background: "#FFFFFF",
                borderRadius: 22,
                border: "1px solid rgba(56, 117, 197, 0.22)",
              }}
            >
              <div className="bw-row">
                <div>
                  <p className="bw-kicker">
                    {isKo
                      ? "QUICK URL SCANNER · 웹사이트 URL 하나로 비즈니스 프로필 9단계 자동 추출"
                      : "QUICK URL SCANNER · 9-STEP AUTO BUSINESS PROFILE EXTRACTION"}
                  </p>
                  <h3 style={{ margin: "4px 0" }}>
                    {isKo
                      ? "웹사이트 URL을 입력하면 로고·서체·컬러 스와치·톤앤매너·다중 미감 기조(A/B/C)를 순차 추출합니다"
                      : "Enter your website URL to auto-extract logo, fonts, color swatches, tone of voice & Aesthetic Lines (A/B/C)"}
                  </h3>
                </div>
                <div className="bw-row">
                  <button
                    type="button"
                    className="bw-button"
                    data-pomelli-step-cycle
                    onClick={() =>
                      setActiveExtractionStepIndex(
                        (prev) => (prev + 1) % POMELLI_EXTRACTION_STEPS.length
                      )
                    }
                    disabled={busy}
                  >
                    {isKo
                      ? `추출 단계 보기 (${activeExtractionStepIndex + 1}/${POMELLI_EXTRACTION_STEPS.length})`
                      : `Cycle Scan Step (${activeExtractionStepIndex + 1}/${POMELLI_EXTRACTION_STEPS.length})`}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
                data-pomelli-extraction-pills
              >
                {POMELLI_EXTRACTION_STEPS.map((step, idx) => {
                  const isCurrent = idx === activeExtractionStepIndex;
                  const isDone = idx <= activeExtractionStepIndex;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      data-pomelli-step-pill={step.id}
                      aria-pressed={isCurrent}
                      onClick={() => setActiveExtractionStepIndex(idx)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: isCurrent ? 700 : 600,
                        border: isCurrent
                          ? "1.5px solid #3875C5"
                          : "1px solid rgba(15, 23, 42, 0.12)",
                        background: isCurrent
                          ? "rgba(56, 117, 197, 0.12)"
                          : isDone
                            ? "#F6F7F9"
                            : "#FFFFFF",
                        color: isCurrent ? "#3063A7" : "#0B0D12",
                        cursor: "pointer",
                      }}
                    >
                      ✦ {step.stepNumber}. {isKo ? step.pillKo : step.pillEn}
                    </button>
                  );
                })}
              </div>
              <small className="bw-muted" data-pomelli-active-step-detail>
                {isKo
                  ? POMELLI_EXTRACTION_STEPS[activeExtractionStepIndex]?.detailKo
                  : POMELLI_EXTRACTION_STEPS[activeExtractionStepIndex]?.detailEn}
              </small>
            </div>

            {/* 1. Omni-Asset Unlimited Drop + Pinterest 3-Stage Funnel */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                alignItems: "stretch",
                gap: 16,
              }}
              data-onboarding-omni-intake
            >
              {/* Left: Unlimited Omni-Asset Dropzone */}
              <div
                className="bw-card bw-fields"
                style={{
                  margin: 0,
                  padding: 16,
                  background: "#FFFFFF",
                  borderRadius: 20,
                }}
              >
                <div className="bw-row">
                  <strong>
                    {isKo
                      ? "① 무제한 에셋 드롭박스 (로고·제품·가이드 PDF·화보 폴더 일괄 투입)"
                      : "① Unlimited Omni-Asset Drop (Logos, Products, PDF Guides & Lookbooks)"}
                  </strong>
                  <span className="bw-badge" data-onboarding-raw-drop-count>
                    {isKo
                      ? `${rawAssetDrop.length}개 에셋 감지됨`
                      : `${rawAssetDrop.length} assets queued`}
                  </span>
                </div>
                <p className="bw-muted" style={{ margin: 0 }}>
                  {isKo
                    ? "사용자가 일일이 로고·제품·무드를 구분할 필요가 없습니다. 파일들을 한꺼번에 선택하거나 아래 목록에 붙여넣으면 디렉터 AI가 4개 바구니로 자동 분류합니다."
                    : "No need to pre-sort files. Select multiple files at once or paste filenames/URLs below; the Director engine auto-sorts them into 4 buckets."}
                </p>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    borderRadius: 14,
                    border: "1px dashed rgba(56, 117, 197, 0.45)",
                    background: "rgba(56, 117, 197, 0.05)",
                    cursor: isOwner && !busy ? "pointer" : "default",
                    fontSize: 13,
                  }}
                >
                  <span>
                    {isKo
                      ? "폴더/파일 제한 없이 한 번에 선택 (SVG, PNG, JPG, WEBP, PDF)"
                      : "Select unlimited brand files at once (SVG, PNG, JPG, WEBP, PDF)"}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept=".svg,.png,.jpg,.jpeg,.webp,.pdf"
                    onChange={handleFileDropInput}
                    disabled={!isOwner || busy}
                    style={{ maxWidth: 210, fontSize: 12 }}
                  />
                </label>
                <label>
                  {isKo
                    ? "일괄 투입된 에셋 목록 (파일명 또는 URL | 메모 — 최대 200개 동시 분류)"
                    : "Batch Dropped Assets (filename or URL | note — up to 200 items)"}
                  <textarea
                    rows={4}
                    value={rawDropText}
                    onChange={(e) => setRawDropText(e.target.value)}
                    disabled={!isOwner || busy}
                    data-onboarding-raw-drop-textarea
                  />
                </label>
              </div>

              {/* Right: Pinterest Public Board 3-Stage Funnel */}
              <div
                className="bw-card bw-fields"
                data-onboarding-pinterest-funnel
                style={{
                  margin: 0,
                  padding: 16,
                  background: "#FFFFFF",
                  borderRadius: 20,
                }}
              >
                <div className="bw-row">
                  <strong>
                    {isKo
                      ? "② 핀터레스트 공개 보드 · 웹사이트 · 인스타그램 인테이크"
                      : "② Public Pinterest Board, Website & Instagram Intake"}
                  </strong>
                  {preview && (
                    <span className="bw-badge" data-pinterest-token-savings>
                      {isKo
                        ? `대표 레퍼런스 ${preview.pinterestFunnel.stage2MedoidsSelected}장 자동 선별`
                        : `${preview.pinterestFunnel.stage2MedoidsSelected} key references selected`}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 12,
                  }}
                >
                  <label>
                    {isKo
                      ? "핀터레스트 공개 보드/섹션 URL (최대 3개, 줄바꿈)"
                      : "Public Pinterest Board URLs (max 3)"}
                    <textarea
                      name="pinterestBoardUrls"
                      rows={2}
                      value={pinterestBoardUrlsText}
                      onChange={(e) => setPinterestBoardUrlsText(e.target.value)}
                      placeholder="https://www.pinterest.com/brand/board-name/"
                      disabled={!isOwner || busy}
                      data-onboarding-pinterest-input
                    />
                  </label>
                  <label>
                    {isKo
                      ? "보드 내 대략적인 핀 수"
                      : "Approximate Pins in Board"}
                    <input
                      type="number"
                      min={12}
                      max={50000}
                      value={pinterestPinCountHint}
                      onChange={(e) =>
                        setPinterestPinCountHint(Number(e.target.value) || 120)
                      }
                      disabled={!isOwner || busy}
                      data-onboarding-pinterest-count
                    />
                    <small className="bw-muted">
                      {isKo
                        ? "1,000장이 넘는 대형 보드도 핵심 화보만 자동으로 추려냅니다."
                        : "Large boards are automatically distilled to core lookbook references."}
                    </small>
                  </label>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 12,
                  }}
                >
                  <label>
                    {isKo
                      ? `공식 웹사이트 URL (최대 ${ONBOARDING_LIMITS.maxWebsiteUrls}개)`
                      : `Website URLs (max ${ONBOARDING_LIMITS.maxWebsiteUrls})`}
                    <textarea
                      name="websiteUrls"
                      rows={2}
                      value={websiteUrlsText}
                      onChange={(e) => setWebsiteUrlsText(e.target.value)}
                      placeholder="https://kaiper.kr"
                      disabled={!isOwner || busy}
                    />
                  </label>
                  <label>
                    {isKo ? "인스타그램 공식 계정 (@handle)" : "Instagram Handle"}
                    <input
                      name="instagramHandle"
                      value={instagramHandle}
                      onChange={(e) => setInstagramHandle(e.target.value)}
                      placeholder="@kaiper.official"
                      maxLength={40}
                      disabled={!isOwner || busy}
                    />
                  </label>
                </div>

                {preview && (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(56, 117, 197, 0.07)",
                      border: "1px solid rgba(56, 117, 197, 0.22)",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                    data-pinterest-funnel-summary
                  >
                    <strong>
                      {isKo
                        ? "핀터레스트 보드 자동 정리 요약:"
                        : "Pinterest Board Summary:"}
                    </strong>
                    <div>
                      {isKo
                        ? `• 총 ${preview.pinterestFunnel.totalBoardPinsDetected.toLocaleString()}개 핀 중 중복·텍스트·저화질 이미지를 걸러내고 유효 화보 ${preview.pinterestFunnel.stage1CleanCandidates}장을 선별했습니다.`
                        : `• Filtered ${preview.pinterestFunnel.totalBoardPinsDetected} pins down to ${preview.pinterestFunnel.stage1CleanCandidates} clean photos.`}
                    </div>
                    <div>
                      {isKo
                        ? `• 대표 레퍼런스 ${preview.pinterestFunnel.stage2MedoidsSelected}장을 바탕으로 3가지 무드(A/B/C)를 구성했습니다.`
                        : `• Organized ${preview.pinterestFunnel.stage2MedoidsSelected} key references into 3 mood lines (A/B/C).`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 4-Bucket Auto-Triage Summary */}
            {preview && (
              <div
                className="bw-card bw-fields"
                data-onboarding-auto-triage
                style={{
                  margin: 0,
                  padding: 16,
                  background: "#FFFFFF",
                  borderRadius: 20,
                }}
              >
                <div className="bw-row">
                  <div>
                    <p className="bw-kicker">
                      {isKo
                        ? "AUTO-TRIAGE · 4대 브랜드 자산 바구니 자동 분류 결과"
                        : "AUTO-TRIAGE · 4-BUCKET BRAND ASSET CLASSIFICATION"}
                    </p>
                    <h3>
                      {isKo
                        ? "투입된 에셋이 역할에 따라 로고 금고 · 제품 마스터 · 브랜드 스탠다드 · 다중 미감 풀로 분류되었습니다"
                        : "Dropped assets automatically sorted into Logo Vault, Product Master, Brand Standard & Multi-Aesthetic Pool"}
                    </h3>
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 12,
                  }}
                >
                  {(Object.keys(BUCKET_META) as OmniTriageBucket[]).map((bucket) => {
                    const meta = BUCKET_META[bucket];
                    const count = preview.omniTriage.counts[bucket];
                    return (
                      <div
                        key={bucket}
                        className="bw-card"
                        data-triage-bucket={bucket}
                        style={{
                          margin: 0,
                          padding: 14,
                          borderRadius: 16,
                          background: "#F6F7F9",
                        }}
                      >
                        <div className="bw-row">
                          <strong style={{ fontSize: 13 }}>
                            {isKo ? meta.badgeKo : meta.badgeEn}
                          </strong>
                          <span className="bw-badge">
                            {isKo ? `${count}건` : `${count}`}
                          </span>
                        </div>
                        <p
                          className="bw-muted"
                          style={{ margin: "6px 0 0", fontSize: 12 }}
                        >
                          {isKo ? meta.descKo : meta.descEn}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <label>
              {isKo
                ? "브랜드 스탠다드 핵심 메모 · 절대 금기사항 (모든 미감 기조 A/B/C에 공통 잠금)"
                : "Brand Standard Notes & Strict Taboos (Hard-locked across all Aesthetic Lines A/B/C)"}
              <textarea
                name="brandGuideNote"
                rows={2}
                value={brandGuideNote}
                onChange={(e) => setBrandGuideNote(e.target.value)}
                maxLength={800}
                disabled={!isOwner || busy}
              />
            </label>
          </div>
        </details>

        {/* Progressive disclosure for manual slot editing & Instagram post URLs */}
        <details className="bw-service-disclosure">
          <summary>
            {isKo
              ? `개별 고정 슬롯 상세 관리 (로고 ${logoCount}/${ONBOARDING_LIMITS.maxLogoAssets} · 제품 ${productCount}/${ONBOARDING_LIMITS.maxProductAssets} · 무드 ${moodCount}/${ONBOARDING_LIMITS.maxMoodAssets})`
              : `Manage Individual Slot Assets (Logo ${logoCount}/${ONBOARDING_LIMITS.maxLogoAssets} · Product ${productCount}/${ONBOARDING_LIMITS.maxProductAssets} · Mood ${moodCount}/${ONBOARDING_LIMITS.maxMoodAssets})`}
          </summary>
          <div
            className="bw-panel"
            data-onboarding-asset-slots
            style={{ marginTop: 12 }}
          >
            <div className="bw-row">
              <div>
                <h3>
                  {isKo
                    ? "핵심 시각 에셋 슬롯 (로고 · 주력 제품 · 선호 무드)"
                    : "Core Visual Reference Assets (Logo · Product · Mood)"}
                </h3>
                <p className="bw-muted">
                  {isKo
                    ? "로고는 비율 1:1 고정, 제품은 형태·라벨 유지, 무드는 색감·조명 참조로 자동 분리됩니다."
                    : "Logos lock geometry, products build the preservation checklist, and mood images set lighting & palette."}
                </p>
              </div>
              <span className="bw-badge" data-onboarding-asset-counter>
                {isKo
                  ? `총 ${assets.length}/${ONBOARDING_LIMITS.maxTotalAssets}장 (로고 ${logoCount}/${ONBOARDING_LIMITS.maxLogoAssets} · 제품 ${productCount}/${ONBOARDING_LIMITS.maxProductAssets} · 무드 ${moodCount}/${ONBOARDING_LIMITS.maxMoodAssets})`
                  : `${assets.length}/${ONBOARDING_LIMITS.maxTotalAssets} assets (Logo ${logoCount}/${ONBOARDING_LIMITS.maxLogoAssets} · Product ${productCount}/${ONBOARDING_LIMITS.maxProductAssets} · Mood ${moodCount}/${ONBOARDING_LIMITS.maxMoodAssets})`}
              </span>
            </div>

            <label>
              {isKo
                ? `인스타그램 대표 게시물·릴스 링크 (최대 ${ONBOARDING_LIMITS.maxInstagramPostUrls}개)`
                : `Instagram Post Links (max ${ONBOARDING_LIMITS.maxInstagramPostUrls})`}
              <textarea
                name="instagramPostUrls"
                rows={2}
                value={instagramPostUrlsText}
                onChange={(e) => setInstagramPostUrlsText(e.target.value)}
                placeholder="https://www.instagram.com/p/..."
                disabled={!isOwner || busy}
              />
            </label>

            <ul className="bw-list" data-onboarding-asset-list>
              {assets.map((asset, idx) => (
                <li
                  key={`${asset.slot}-${asset.label}-${idx}`}
                  className="bw-row"
                  data-onboarding-asset-item={asset.slot}
                >
                  <div>
                    <span className="bw-badge">
                      {isKo
                        ? SLOT_LABELS[asset.slot].ko
                        : SLOT_LABELS[asset.slot].en}
                    </span>{" "}
                    <strong>{asset.label}</strong>
                    {asset.urlOrKey && (
                      <small className="bw-muted"> · {asset.urlOrKey}</small>
                    )}
                    <p className="bw-muted">{asset.preserveNote}</p>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      className="bw-button"
                      onClick={() => handleRemoveAsset(idx)}
                      disabled={busy}
                    >
                      {isKo ? "제거" : "Remove"}
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {isOwner && assets.length < ONBOARDING_LIMITS.maxTotalAssets && (
              <div className="bw-grid-wide" data-onboarding-add-asset>
                <label>
                  {isKo ? "슬롯 종류" : "Asset Slot"}
                  <select
                    value={newSlot}
                    onChange={(e) =>
                      setNewSlot(e.target.value as OnboardingAssetSlot)
                    }
                    disabled={busy}
                  >
                    <option value="logo">
                      {isKo ? SLOT_LABELS.logo.ko : SLOT_LABELS.logo.en}
                    </option>
                    <option value="product">
                      {isKo ? SLOT_LABELS.product.ko : SLOT_LABELS.product.en}
                    </option>
                    <option value="mood">
                      {isKo ? SLOT_LABELS.mood.ko : SLOT_LABELS.mood.en}
                    </option>
                  </select>
                </label>
                <label>
                  {isKo
                    ? "에셋 이름 (예: 시그니처 아우터 정면)"
                    : "Asset Label"}
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    maxLength={120}
                    disabled={busy}
                  />
                </label>
                <label>
                  {isKo
                    ? "보존·차용 핵심 지침"
                    : "Preservation / Reference Rule"}
                  <input
                    value={newPreserveNote}
                    onChange={(e) => setNewPreserveNote(e.target.value)}
                    placeholder={
                      isKo
                        ? "예: 지퍼 비대칭 라인과 매트 나일론 질감 고정"
                        : "e.g. Lock zipper line and matte nylon finish"
                    }
                    maxLength={240}
                    disabled={busy}
                  />
                </label>
                <div className="bw-row">
                  <button
                    type="button"
                    className="bw-button"
                    onClick={handleAddAsset}
                    disabled={busy}
                    data-onboarding-add-asset-btn
                  >
                    {isKo ? "+ 에셋 슬롯 추가" : "+ Add Asset Slot"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>

        {preview && (
          <div className="bw-note" data-onboarding-preview>
            <div className="bw-row">
              <strong>
                {isKo
                  ? `고정된 ${preview.summary.brandName} 스탠다드 & 로고·제품 체크리스트 요약`
                  : `Locked ${preview.summary.brandName} Standard & Logo/Product Checklist`}
              </strong>
            </div>
            <p className="bw-muted">{preview.identity.voice.tone}</p>
            <div className="bw-grid-wide">
              <div>
                <small className="bw-muted">
                  {isKo
                    ? "자동 조립된 제품·로고 보존 체크리스트"
                    : "Auto-assembled Product & Logo Checklist"}
                </small>
                <ul className="bw-list">
                  {preview.identity.productChecklist.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <small className="bw-muted">
                  {isKo
                    ? "모든 미감 기조에 공통 잠금되는 절대 금기(Hard Lock)"
                    : "Hard-locked Brand Taboos across all Aesthetic Lines"}
                </small>
                <ul className="bw-list">
                  {preview.identity.rules.never.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <p className="bw-status" data-tone="danger" role="alert">
            {errorMessage}
          </p>
        )}
        {statusMessage && (
          <p className="bw-status" role="status" data-onboarding-feedback>
            {statusMessage}
          </p>
        )}

        {isOwner && (
          <div className="bw-row">
            <button
              type="button"
              className="bw-button bw-primary"
              onClick={() => void submitIngest(true)}
              disabled={busy}
              data-onboarding-confirm-submit
            >
              {isKo
                ? "로고 금고 · 스탠다드 · 다중 미감(A/B/C) 즉시 확정 및 스튜디오 연동"
                : "Confirm Logo Vault, Standard & Aesthetic Lines (A/B/C)"}
            </button>
            <button
              type="submit"
              className="bw-button"
              disabled={busy}
              data-onboarding-draft-submit
            >
              {isKo
                ? "분류 초안(Draft)으로 저장"
                : "Save Triage Draft"}
            </button>
            {studioHref && (
              <a className="bw-button" href={studioHref}>
                {isKo
                  ? "스튜디오에서 기조 A/B/C 골라 바로 제작하기 →"
                  : "Open Studio & Pick Line A/B/C →"}
              </a>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
