"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ONBOARDING_LIMITS,
  synthesizeBrandIdentityFromIngest,
  type BrandOnboardingAsset,
  type OnboardingAssetSlot,
  type OnboardingCategory,
  type OnboardingVibe,
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

const KAIPER_SAMPLE_ASSETS: BrandOnboardingAsset[] = [
  {
    slot: "logo",
    label: "KAIPER 워드마크 & 심볼 (SVG/PNG)",
    urlOrKey: "brand-assets/kaiper/logo-wordmark.png",
    dominantHex: "#0c1320",
    preserveNote: "워드마크 자간과 심볼 직선 비례 100% 고정 (mark_only)",
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
    preserveNote: "차가운 건축 콘크리트 여백과 5400K 확산 자연광 무드만 차용",
  },
  {
    slot: "mood",
    label: "에디토리얼 로우 앵글 전신 구도",
    urlOrKey: "brand-assets/kaiper/mood-low-angle.jpg",
    dominantHex: "#dce4ef",
    preserveNote: "35mm–50mm 전신 프레이밍과 절제된 그림자 대비 차용",
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
      assets,
      brandGuideNote,
    });
  } catch {
    preview = null;
  }

  function applyPreset(kind: "kaiper" | "beauty" | "blank") {
    setErrorMessage("");
    setStatusMessage("");
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
      setAssets(BEAUTY_SAMPLE_ASSETS);
      setBrandGuideNote(
        "용기 기하 변형 금지. 전면 라벨 타이포그래피 왜곡 금지. 과도한 웜톤 색번짐 금지."
      );
    } else {
      setBrandName(organizationName || "Brand");
      setWebsiteUrlsText("");
      setInstagramHandle("");
      setInstagramPostUrlsText("");
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
            ? "브랜드 온보딩 에셋·채널 분석 및 기준선 확정(Confirmed)이 완료되었습니다. 이제 스튜디오와 개별 프로젝트에서 이 기준선을 상속합니다."
            : "Brand onboarding ingested and confirmed as Base DNA."
          : isKo
            ? "브랜드 온보딩 초안(Draft)이 생성되었습니다. 아래 규칙을 검토한 뒤 확정할 수 있습니다."
            : "Brand onboarding draft synthesized."
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
            {isKo
              ? "STEP 1 · 멀티채널 브랜드 온보딩 인제스트 (BASE DNA)"
              : "STEP 1 · MULTI-CHANNEL BRAND ONBOARDING INGEST"}
          </p>
          <h2>
            {isKo
              ? "웹사이트 · 인스타그램 · 핵심 에셋으로 브랜드 기준선(Base DNA) 자동 조립"
              : "Synthesize Brand Base DNA from Website, Instagram & Core Visual Assets"}
          </h2>
          <p className="bw-muted">
            {isKo
              ? "수동으로 컬러코드와 수치를 입력할 필요 없이, 공식 웹사이트(최대 2개)·인스타그램(최대 6개)·시각 에셋(최대 14장: 로고 2 / 제품 6 / 무드 6)을 넣으면 브랜드 기본 규칙을 자동 추출합니다. 개별 프로젝트마다 다른 연출이 필요할 때는 스튜디오/프로젝트에서 오버라이드(Override)할 수 있습니다."
              : "Supply up to 2 website URLs, Instagram links, and up to 14 visual assets (2 logo, 6 product, 6 mood) to automatically synthesize your Brand Base DNA."}
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
            {isKo ? "KAIPER 온보딩 프리셋 채우기" : "Load KAIPER Preset"}
          </button>
          <button
            type="button"
            className="bw-button"
            data-onboarding-preset="beauty"
            onClick={() => applyPreset("beauty")}
            disabled={busy}
          >
            {isKo ? "뷰티·보틀 샘플" : "Beauty Sample"}
          </button>
          <button
            type="button"
            className="bw-button"
            data-onboarding-preset="blank"
            onClick={() => applyPreset("blank")}
            disabled={busy}
          >
            {isKo ? "빈 양식" : "Clear"}
          </button>
        </div>
      </div>

      <form onSubmit={onFormSubmit} className="bw-fields" data-onboarding-form>
        <div className="bw-grid-wide">
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
            {isKo ? "기본 비주얼 무드 (Base Vibe)" : "Base Visual Vibe"}
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

        <div className="bw-grid-wide">
          <label>
            {isKo
              ? `공식 웹사이트 · 대표 상품 URL (최대 ${ONBOARDING_LIMITS.maxWebsiteUrls}개, 줄바꿈)`
              : `Website URLs (max ${ONBOARDING_LIMITS.maxWebsiteUrls}, one per line)`}
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
        </div>

        <div className="bw-panel" data-onboarding-asset-slots>
          <div className="bw-row">
            <div>
              <h3>
                {isKo
                  ? "핵심 시각 에셋 슬롯 (로고 · 주력 제품 · 선호 무드)"
                  : "Core Visual Reference Assets (Logo · Product · Mood)"}
              </h3>
              <p className="bw-muted">
                {isKo
                  ? "시스템 수용 한도에 맞춰 총 14장 이내로 고정합니다. 로고는 원형 보존(mark_only), 제품은 기하·라벨 체크리스트, 무드는 색감·조명 참조로 자동 분리됩니다."
                  : "Bounded to 14 assets total: logos lock geometry, products build the preservation checklist, and mood images set lighting & palette."}
              </p>
            </div>
            <span className="bw-badge" data-onboarding-asset-counter>
              {isKo
                ? `총 ${assets.length}/${ONBOARDING_LIMITS.maxTotalAssets}장 (로고 ${logoCount}/${ONBOARDING_LIMITS.maxLogoAssets} · 제품 ${productCount}/${ONBOARDING_LIMITS.maxProductAssets} · 무드 ${moodCount}/${ONBOARDING_LIMITS.maxMoodAssets})`
                : `${assets.length}/${ONBOARDING_LIMITS.maxTotalAssets} assets (Logo ${logoCount}/${ONBOARDING_LIMITS.maxLogoAssets} · Product ${productCount}/${ONBOARDING_LIMITS.maxProductAssets} · Mood ${moodCount}/${ONBOARDING_LIMITS.maxMoodAssets})`}
            </span>
          </div>

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
                {isKo ? "에셋 이름 (예: 시그니처 아우터 정면)" : "Asset Label"}
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  maxLength={120}
                  disabled={busy}
                />
              </label>
              <label>
                {isKo ? "보존·차용 핵심 지침" : "Preservation / Reference Rule"}
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

        <label>
          {isKo
            ? "브랜드 가이드 핵심 메모 · 절대 금기사항 (최대 3가지 자동 추출)"
            : "Brand Guide Notes & Strict Taboos (up to 3 extracted)"}
          <textarea
            name="brandGuideNote"
            rows={2}
            value={brandGuideNote}
            onChange={(e) => setBrandGuideNote(e.target.value)}
            maxLength={800}
            disabled={!isOwner || busy}
          />
        </label>

        {preview && (
          <div className="bw-note" data-onboarding-preview>
            <div className="bw-row">
              <strong>
                {isKo
                  ? `추출된 ${preview.summary.brandName} 기본 DNA 미리보기`
                  : `Synthesized ${preview.summary.brandName} Base DNA Preview`}
              </strong>
              <span className="bw-badge" data-onboarding-recommended-look>
                {isKo
                  ? `추천 컬러 룩: ${preview.recommendedLookPresetId}`
                  : `Recommended Look: ${preview.recommendedLookPresetId}`}
              </span>
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
                    ? "모든 프로젝트에 공통 잠금되는 절대 금기(Hard Lock)"
                    : "Hard-locked Brand Taboos across all projects"}
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
              type="submit"
              className="bw-button"
              disabled={busy}
              data-onboarding-draft-submit
            >
              {isKo
                ? "에셋·채널 분석해 초안(Draft) 저장"
                : "Synthesize & Save Draft"}
            </button>
            <button
              type="button"
              className="bw-button bw-primary"
              onClick={() => void submitIngest(true)}
              disabled={busy}
              data-onboarding-confirm-submit
            >
              {isKo
                ? "이 기준선으로 브랜드 Base DNA 즉시 확정"
                : "Synthesize & Confirm Base DNA (1-Click)"}
            </button>
            {studioHref && (
              <a className="bw-button" href={studioHref}>
                {isKo
                  ? "스튜디오에서 컷·프로젝트별 연출 시작 →"
                  : "Open Studio with Base DNA →"}
              </a>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
