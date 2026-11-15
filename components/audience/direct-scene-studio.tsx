'use client';

import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  compileReferenceToTemplatePromotion,
  DIRECT_SCENE_WORDING_CANDIDATES,
  HIGH_QUALITY_REQUEST_GUIDE,
  PRESET_REFERENCE_SCENARIOS,
  type PresetReferenceScenario
} from '@/lib/template-director/freestyle-to-template';
import {
  PERSONAL_NO_BGM_AUDIO_NOTICE_EN,
  PERSONAL_NO_BGM_AUDIO_NOTICE_KO
} from '@/lib/template-director/morphic-production-playbook';
import { diagnosePhotoSuitability } from '@/lib/template-director/schema';
import {
  simulateMakerTemplateRevenue,
  type PersonalVideoResolution
} from '@/lib/twings/template-price';

export interface DirectSceneStudioProps {
  locale: Locale;
  videoCatalogHref: string;
  creatorWorkspaceHref: string;
  /**
   * Credits are a subscription unit. Until web subscriptions open (terms: "충전식 재화 없음", one won
   * payment per template; docs/PLATFORM-2.0.md §19.2), this page shows won only and offers only the
   * resolutions a buyer can actually pay for (720p, 1080p). True once subscriptions are open.
   */
  showCredits?: boolean;
}

const RAISE_OPTIONS_KRW = [0, 500, 1000, 2000, 3000] as const;

export function DirectSceneStudio({
  locale,
  videoCatalogHref,
  creatorWorkspaceHref,
  showCredits = false
}: DirectSceneStudioProps) {
  const resolutionOptions: readonly PersonalVideoResolution[] = showCredits ? ['480p', '720p', '1080p'] : ['720p', '1080p'];
  const [selectedPresetId, setSelectedPresetId] =
    useState<PresetReferenceScenario['id']>('seoul-night-runway');

  const activePreset = useMemo(
    () =>
      PRESET_REFERENCE_SCENARIOS.find((p) => p.id === selectedPresetId) ??
      PRESET_REFERENCE_SCENARIOS[0]!,
    [selectedPresetId]
  );

  // Interactive overrides for the Template Freeze Policy
  const [lockOutfit, setLockOutfit] = useState<boolean>(
    activePreset.input.lockOutfitAsSignature
  );
  const [lockBackdrop, setLockBackdrop] = useState<boolean>(
    activePreset.input.lockBackdropAsSignature
  );
  const [royaltyKrw, setRoyaltyKrw] = useState<number>(1000);
  const [directorKeepNote, setDirectorKeepNote] = useState<string>(
    locale === 'en'
      ? 'Keep the street atmosphere and camera movement from the video.'
      : '영상 속 밤거리 분위기와 카메라 움직임은 그대로 살려주세요.'
  );
  const [directorChangeNote, setDirectorChangeNote] = useState<string>(
    locale === 'en'
      ? 'Make me the protagonist with my front photo and dress me in the attached black coat photo.'
      : '내 정면 사진 속 얼굴로 주인공을 바꾸고, 첨부한 검정 롱코트 사진 스타일로 입혀주세요.'
  );

  // Interactive photo suitability simulation so users see why direct clean selfie upload matters
  const [selfieCheckMode, setSelfieCheckMode] = useState<'clean-front' | 'filtered-or-angled'>(
    'clean-front'
  );
  const [selectedLikenessCandidate, setSelectedLikenessCandidate] = useState<'candidate-a' | 'candidate-b'>(
    'candidate-a'
  );
  const [selectedResolution, setSelectedResolution] =
    useState<PersonalVideoResolution>('720p');

  const handleSelectPreset = (preset: PresetReferenceScenario) => {
    setSelectedPresetId(preset.id);
    setLockOutfit(preset.input.lockOutfitAsSignature);
    setLockBackdrop(preset.input.lockBackdropAsSignature);
    setSelectedResolution(preset.input.resolution ?? '720p');
  };

  const compiled = useMemo(
    () =>
      compileReferenceToTemplatePromotion({
        ...activePreset.input,
        resolution: selectedResolution,
        lockOutfitAsSignature: lockOutfit,
        lockBackdropAsSignature: lockBackdrop
      }),
    [activePreset, selectedResolution, lockOutfit, lockBackdrop]
  );

  const activeTierQuote = compiled.resolutionTiers.tiers[selectedResolution];

  const revenueSim = useMemo(
    () =>
      simulateMakerTemplateRevenue({
        medium: 'video',
        providerUsd: activeTierQuote.providerUsd,
        royaltyKrw
      }),
    [activeTierQuote.providerUsd, royaltyKrw]
  );

  const suitability = useMemo(
    () =>
      selfieCheckMode === 'clean-front'
        ? diagnosePhotoSuitability([], 0.36)
        : diagnosePhotoSuitability(['heavy_filter', 'angle_extreme'], 0.36),
    [selfieCheckMode]
  );

  const recommendedWording = DIRECT_SCENE_WORDING_CANDIDATES[0]!;
  const ds = getDictionary(locale).creatorJourney.directScene;

  return (
    <div data-direct-scene-studio className="space-y-12">
      {/* SECTION 0: Warm Consumer Value Proposition + Accruing Revenue Highlight */}
      <section
        data-direct-wording-rationale
        className="rounded-[16px] bg-[#F4F4F5] p-6 sm:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#52525B]">
              {ds.rationaleBadge}
            </span>
            <h2 className="mt-3 text-lg font-bold tracking-[-0.015em] text-[#09090B] sm:text-xl">
              {locale === 'en'
                ? recommendedWording.headlineEn
                : recommendedWording.headlineKo}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-[#52525B] sm:text-sm">
              {locale === 'en'
                ? recommendedWording.subcopyEn
                : recommendedWording.subcopyKo}
            </p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-[16px] bg-white px-4 py-3.5 text-xs">
              <p className="font-semibold text-[#71717A]">1단계 · 내 영상 만들기</p>
              <p className="mt-1 font-bold text-[#09090B]">저장해 둔 영상 + 내 사진</p>
              <p className="mt-0.5 text-[0.72rem] text-[#52525B]">원하는 분위기를 내 얼굴로 먼저 완성</p>
            </div>
            <div className="rounded-[16px] bg-white px-4 py-3.5 text-xs">
              <p className="font-semibold text-[#71717A]">2단계 · 템플릿으로 공개</p>
              <p className="mt-1 font-bold text-[#09090B]">내 셀카는 비공개로 보호</p>
              <p className="mt-0.5 text-[0.72rem] text-[#52525B]">완성된 영상만 예시로 올라가고 구도는 자동 고정</p>
            </div>
            <div className="rounded-[16px] bg-white px-4 py-3.5 text-xs">
              <p className="font-semibold text-[#71717A]">{ds.step3CardLabel}</p>
              <p className="mt-1 font-bold text-[#09090B]">{ds.step3CardTitle}</p>
              <p className="mt-0.5 text-[0.72rem] text-[#52525B]">{ds.step3CardSub}</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 1: Revenue Simulator */}
      <section
        data-maker-revenue-calculator
        aria-labelledby="maker-revenue-heading"
        className="border-t border-[#09090B]/[0.08] pt-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#09090B]/[0.08] pb-6">
          <div className="max-w-2xl">
            <span className="inline-flex items-center rounded-full bg-[#F4F4F5] px-3 py-1 text-xs font-semibold text-[#52525B]">
              {ds.simBadge}
            </span>
            <h2
              id="maker-revenue-heading"
              className="mt-3 font-display text-[clamp(1.45rem,2.6vw,2.15rem)] leading-[1.1] font-bold tracking-[-0.025em] text-[#09090B]"
            >
              {ds.simHeading}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#52525B]">
              {ds.simBody}
            </p>
          </div>

          <a
            href={creatorWorkspaceHref}
            data-maker-start-cta
            className="audience-button shrink-0"
          >
            {locale === 'en' ? 'Publish My Template & Earn →' : '내 영상 올리고 수익 만들기 →'}
          </a>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          {/* Left 5 cols: Choose your template price raise */}
          <div className="flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-5 lg:col-span-5">
            <div>
              <p className="text-xs font-semibold text-[#52525B]">
                {locale === 'en'
                  ? '1. Choose how much bonus to add to your template'
                  : '1. 내 템플릿에 붙일 추가 수익금을 골라보세요'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#52525B]">
                {locale === 'en'
                  ? `Base film price: ₩${revenueSim.floorKrw.toLocaleString('en-US')}${showCredits ? ` (${revenueSim.baseCredits} credits)` : ''}`
                  : `현재 선택한 영상(${activePreset.badgeKo}) 기본가: ${revenueSim.floorKrw.toLocaleString('ko-KR')}원${showCredits ? ` (${revenueSim.baseCredits} 크레딧)` : ''}`}
              </p>

              <div className="mt-3.5 flex flex-wrap gap-2" role="group" aria-label="추가 수익금 선택">
                {RAISE_OPTIONS_KRW.map((raise) => {
                  const active = royaltyKrw === raise;
                  return (
                    <button
                      key={raise}
                      type="button"
                      data-maker-raise-option={raise}
                      aria-pressed={active}
                      onClick={() => setRoyaltyKrw(raise)}
                      className={[
                        'inline-flex min-h-10 items-center rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors tabular-nums',
                        active
                          ? 'border-[#09090B] bg-[#09090B] text-white'
                          : 'border-[#09090B]/[0.08] bg-white text-[#09090B] hover:border-[#09090B]/[0.2]'
                      ].join(' ')}
                    >
                      {raise === 0
                        ? locale === 'en'
                          ? 'Base price (+₩0)'
                          : '기본가 그대로 (+0원)'
                        : `+${raise.toLocaleString('ko-KR')}원`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-[16px] bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-[#52525B]">
                  {locale === 'en' ? 'Template Sale Price' : '구매자에게 보이는 템플릿 가격'}
                </span>
                <span className="font-mono text-sm font-bold text-[#09090B] tabular-nums">
                  {revenueSim.salePriceKrw.toLocaleString('ko-KR')}원{showCredits ? ` (${revenueSim.totalCredits} 크레딧)` : ''}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-[#09090B]/[0.08] pt-2">
                <span className="text-xs font-semibold text-[#52525B]">
                  {ds.simPerMakeLabel}
                </span>
                <span
                  data-maker-earning-per-make
                  className="font-display text-lg font-bold text-[#09090B] tabular-nums"
                >
                  +{revenueSim.perMake.creator.toLocaleString('ko-KR')}원
                </span>
              </div>
            </div>
          </div>

          {/* Right 7 cols: Cumulative Earnings Milestones (10, 50, 100, 500 makes) */}
          <div className="flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-5 lg:col-span-7">
            <div>
              <p className="text-xs font-semibold text-[#52525B]">
                {ds.simMilestonesLabel}
              </p>
              <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {revenueSim.milestones.map((m) => (
                  <div
                    key={m.makes}
                    data-maker-milestone={m.makes}
                    className="rounded-[16px] bg-white p-4"
                  >
                    <p className="text-xs font-semibold text-[#52525B]">
                      {locale === 'en' ? `${m.makes} makes` : `${m.makes}명이 만들면`}
                    </p>
                    <p className="mt-2 font-display text-xl font-bold tracking-tight text-[#09090B] tabular-nums">
                      {m.creatorTotalKrw.toLocaleString('ko-KR')}원
                    </p>
                    <p className="mt-1 text-[0.7rem] text-[#71717A]">
                      {ds.simMilestoneSub}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Maker Account Connection Assurance */}
            <div
              data-maker-db-pipeline
              className="mt-4 rounded-[12px] bg-white px-4 py-3 text-xs leading-relaxed text-[#52525B]"
            >
              <span className="font-semibold text-[#09090B]">
                {ds.simLedgerTitle}
              </span>
              {ds.simLedgerNote}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Easy 3 Tips for Best Video Quality */}
      <section data-high-quality-guide aria-labelledby="quality-guide-heading" className="space-y-6">
        <div className="border-t border-[#09090B]/[0.08] pt-8">
          <p className="text-[13px] font-medium text-[#71717A]">
            {locale === 'en'
              ? 'EASY TIPS FOR NATURAL RESULTS'
              : '누구나 실패 없이 예쁜 영상을 뽑는 3가지 요령'}
          </p>
          <h2
            id="quality-guide-heading"
            className="mt-2 font-display text-[clamp(1.5rem,2.8vw,2.25rem)] leading-[1.08] font-bold tracking-[-0.025em] text-[#09090B]"
          >
            {locale === 'en'
              ? 'How to get the most natural face and mood on your first try'
              : '어려운 설정 없이 이것만 기억하면 가장 나답고 예쁘게 나옵니다'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#52525B]">
            {locale === 'en'
              ? 'No complicated prompts needed — just bring a clear 4–10s clip, one unfiltered front photo, and an outfit photo if you want to change clothes.'
              : '복잡한 명령어를 적을 필요가 전혀 없어요. 마음에 드는 짧은 영상 하나와 보정 없는 정면 사진 한 장이면 충분합니다.'}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {HIGH_QUALITY_REQUEST_GUIDE.map((rule, idx) => (
            <article
              key={rule.stepNumber}
              data-quality-rule={rule.stepNumber}
              className="flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-6"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#52525B]">
                    {locale === 'en' ? `Tip ${idx + 1}` : `요령 ${idx + 1}`}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-bold tracking-[-0.015em] text-[#09090B]">
                  {locale === 'en' ? rule.titleEn : rule.titleKo}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-[#52525B]">
                  {locale === 'en' ? rule.summaryEn : rule.summaryKo}
                </p>

                <div className="mt-4 space-y-3 border-t border-[#09090B]/[0.08] pt-4">
                  <div className="rounded-[12px] bg-white p-3.5">
                    <p className="text-xs font-semibold text-[#09090B]">
                      {locale === 'en' ? 'Recommended' : '이렇게 올리면 좋아요'}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#09090B]">
                      {rule.goodExamplesKo.map((ex) => (
                        <li key={ex} className="flex items-start gap-2">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#09090B]" />
                          <span>{ex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-[12px] border border-[#09090B]/[0.08] bg-white/75 p-3.5">
                    <p className="text-xs font-semibold text-[#71717A]">
                      {locale === 'en' ? 'Better to avoid' : '이런 경우는 피해주세요'}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#52525B]">
                      {rule.avoidExamplesKo.map((ex) => (
                        <li key={ex} className="flex items-start gap-2">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#71717A]" />
                          <span>{ex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* SECTION 3: Step-by-Step Preview — Make My Video & Set Up My Template */}
      <section
        data-direct-scene-simulator
        aria-labelledby="simulator-heading"
        className="border-t border-[#09090B]/[0.08] pt-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#09090B]/[0.08] pb-6">
          <div>
            <p className="text-[13px] font-medium text-[#71717A]">
              {locale === 'en'
                ? 'HOW IT WORKS · FROM MY VIDEO TO MY TEMPLATE'
                : '한눈에 보는 제작 과정 · 내 영상 완성부터 템플릿 등록까지'}
            </p>
            <h2
              id="simulator-heading"
              className="mt-2 font-display text-[clamp(1.45rem,2.6vw,2.1rem)] leading-[1.08] font-bold tracking-[-0.025em] text-[#09090B]"
            >
              {locale === 'en'
                ? 'See how your video is made and shared as a template'
                : '원하는 영상 예시를 골라 어떻게 만들어지고 템플릿이 되는지 확인해 보세요'}
            </h2>
          </div>

          {/* Friendly Scenario Selector */}
          <div
            role="group"
            aria-label={locale === 'en' ? 'Select example video' : '예시 영상 선택'}
            className="flex flex-wrap gap-2"
          >
            {PRESET_REFERENCE_SCENARIOS.map((preset) => {
              const active = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-preset-scenario={preset.id}
                  aria-pressed={active}
                  onClick={() => handleSelectPreset(preset)}
                  className={[
                    'inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                    active
                      ? 'border-[#09090B] bg-[#09090B] text-white'
                      : 'border-[#09090B]/[0.08] bg-[#F4F4F5] text-[#09090B] hover:border-[#09090B]/[0.2]'
                  ].join(' ')}
                >
                  {locale === 'en' ? preset.badgeEn : preset.badgeKo}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 Friendly Steps */}
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          {/* STEP 1 (4 cols): Upload Reference Video & My Photo */}
          <div
            data-stage="reference-input"
            className="flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-5 lg:col-span-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#52525B]">
                  1단계 · 영상과 내 사진 올리기
                </span>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-[#52525B]">
                  {activePreset.input.aspect} · {activePreset.input.durationSeconds}초
                </span>
              </div>

              <h3 className="text-base font-bold text-[#09090B]">
                {locale === 'en'
                  ? '1. Upload Reference Clip & Front Selfie'
                  : '1. 저장해 둔 영상 + 내 정면 사진 준비'}
              </h3>

              {/* Friendly Korean summary of what the reference video brings */}
              <div className="space-y-2 rounded-[16px] bg-white p-3.5 text-xs">
                <p className="font-semibold text-[#09090B]">
                  {locale === 'en'
                    ? 'What we keep from your reference video'
                    : '올리신 영상에서 자동으로 가져오는 분위기'}
                </p>
                <div>
                  <span className="font-semibold text-[#09090B]">카메라 움직임: </span>
                  <span className="text-[#52525B]">{activePreset.cameraSummaryKo}</span>
                </div>
                <div>
                  <span className="font-semibold text-[#09090B]">조명과 색감: </span>
                  <span className="text-[#52525B]">{activePreset.lightingSummaryKo}</span>
                </div>
                <div>
                  <span className="font-semibold text-[#09090B]">기본 스타일: </span>
                  <span className="text-[#52525B]">{activePreset.stylingSummaryKo}</span>
                </div>
              </div>

              {/* Direct Selfie Suitability Verification */}
              <div
                data-selfie-suitability-box
                className="space-y-2.5 rounded-[16px] bg-white p-3.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#09090B]">
                    {locale === 'en' ? 'My Photo Check' : '내 사진 자동 확인'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      data-selfie-sim="clean-front"
                      onClick={() => setSelfieCheckMode('clean-front')}
                      className={[
                        'rounded-full px-2.5 py-1 text-[0.68rem] font-medium transition-colors',
                        selfieCheckMode === 'clean-front'
                          ? 'bg-[#09090B] text-white'
                          : 'bg-[#F4F4F5] text-[#52525B]'
                      ].join(' ')}
                    >
                      밝은 정면 사진
                    </button>
                    <button
                      type="button"
                      data-selfie-sim="filtered-or-angled"
                      onClick={() => setSelfieCheckMode('filtered-or-angled')}
                      className={[
                        'rounded-full px-2.5 py-1 text-[0.68rem] font-medium transition-colors',
                        selfieCheckMode === 'filtered-or-angled'
                          ? 'bg-[#09090B] text-white'
                          : 'bg-[#F4F4F5] text-[#52525B]'
                      ].join(' ')}
                    >
                      보정·측면 사진일 때
                    </button>
                  </div>
                </div>

                {suitability.isSuitable ? (
                  <p className="rounded-[12px] bg-[#F4F4F5] p-2.5 text-[0.72rem] leading-relaxed text-[#09090B]">
                    ✓ 얼굴이 또렷하게 잘 보이는 사진이에요! 인위적인 AI 얼굴 변형 없이 내 인상 그대로 영상을 만듭니다.
                  </p>
                ) : (
                  <div
                    data-reupload-warning
                    className="rounded-[12px] border border-[#09090B]/20 bg-[#F4F4F5] p-2.5 text-[0.72rem] leading-relaxed text-[#09090B]"
                  >
                    <p className="font-semibold text-[#09090B]">
                      ! 이 사진은 영상에서 얼굴이 다르게 나올 수 있어 다른 정면 사진을 추천드려요
                    </p>
                    <p className="mt-1 text-[#52525B]">
                      {suitability.whyUnsuitableKo} {suitability.reuploadTipKo}
                    </p>
                  </div>
                )}
              </div>

              {/* Simple Keep vs Change Note */}
              <div className="space-y-2 rounded-[16px] bg-white p-3.5 text-xs">
                <label className="block">
                  <span className="font-semibold text-[#09090B]">
                    영상에서 그대로 살릴 분위기
                  </span>
                  <input
                    type="text"
                    value={directorKeepNote}
                    onChange={(e) => setDirectorKeepNote(e.target.value)}
                    className="mt-1 w-full rounded-[10px] border border-[#09090B]/[0.08] bg-[#F4F4F5] px-3 py-2 text-xs text-[#09090B]"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-[#09090B]">
                    내 사진·옷 사진으로 바꿀 부분
                  </span>
                  <input
                    type="text"
                    value={directorChangeNote}
                    onChange={(e) => setDirectorChangeNote(e.target.value)}
                    className="mt-1 w-full rounded-[10px] border border-[#09090B]/[0.08] bg-[#F4F4F5] px-3 py-2 text-xs text-[#09090B]"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* STEP 2 (4 cols): Pick Your Best Face Preview & Finish Video */}
          <div
            data-stage="personal-synthesis"
            className="flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-5 lg:col-span-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#52525B]">
                  2단계 · 내 영상 완성하기
                </span>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#52525B]">
                  더 닮은 얼굴 시안 선택 가능
                </span>
              </div>

              <h3 className="text-base font-bold text-[#09090B]">
                {locale === 'en'
                  ? '2. Pick the Most Natural Likeness & Create'
                  : '2. 더 나다운 첫 장면을 고르고 영상 완성'}
              </h3>

              {/* Step 2A: Friendly A/B Likeness Choice */}
              <div
                data-dual-likeness-preview
                className="space-y-3 rounded-[16px] bg-white p-4 text-xs"
              >
                <p className="font-semibold text-[#09090B]">
                  내가 보기에 더 닮은 첫 장면을 직접 고를 수 있어요
                </p>
                <p className="leading-relaxed text-[#52525B]">
                  조명이 화려하거나 어두운 영상에서도 얼굴이 어색해지지 않도록, 두 가지 느낌의 첫 장면을 먼저 보여드립니다.{' '}
                  <strong className="font-semibold text-[#09090B]">내 실물과 더 가까운 쪽을 고르면</strong> 그 얼굴 그대로 영상이 움직입니다.
                </p>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-likeness-option="candidate-a"
                    aria-pressed={selectedLikenessCandidate === 'candidate-a'}
                    onClick={() => setSelectedLikenessCandidate('candidate-a')}
                    className={[
                      'rounded-[12px] p-3 text-left transition-all',
                      selectedLikenessCandidate === 'candidate-a'
                        ? 'bg-white ring-[1.5px] ring-[#09090B]'
                        : 'bg-[#F4F4F5] hover:bg-[#ECECEF]'
                    ].join(' ')}
                  >
                    <span className="text-[0.7rem] font-bold text-[#09090B]">
                      시안 A · 또렷한 이목구비
                    </span>
                    <p className="mt-1 text-xs font-semibold text-[#09090B]">
                      눈매·콧대·턱선이 선명한 느낌
                    </p>
                    <p className="mt-0.5 text-[0.7rem] text-[#52525B]">
                      어두운 밤거리나 플래시 조명에서 내 이목구비를 또렷하게 살려줍니다.
                    </p>
                  </button>

                  <button
                    type="button"
                    data-likeness-option="candidate-b"
                    aria-pressed={selectedLikenessCandidate === 'candidate-b'}
                    onClick={() => setSelectedLikenessCandidate('candidate-b')}
                    className={[
                      'rounded-[12px] p-3 text-left transition-all',
                      selectedLikenessCandidate === 'candidate-b'
                        ? 'bg-white ring-[1.5px] ring-[#09090B]'
                        : 'bg-[#F4F4F5] hover:bg-[#ECECEF]'
                    ].join(' ')}
                  >
                    <span className="text-[0.7rem] font-bold text-[#09090B]">
                      시안 B · 부드러운 자연 인상
                    </span>
                    <p className="mt-1 text-xs font-semibold text-[#09090B]">
                      맑은 피부결과 자연스러운 표정
                    </p>
                    <p className="mt-0.5 text-[0.7rem] text-[#52525B]">
                      햇살이나 필름 카메라 특유의 부드럽고 자연스러운 분위기를 살려줍니다.
                    </p>
                  </button>
                </div>
              </div>

              {/* Step 2B: 3-Tier Video Resolution & Credit Mode Switcher (480p Draft · 720p Standard · 1080p Masterpiece) */}
              <div
                data-direct-resolution-tiers
                data-direct-selected-resolution={selectedResolution}
                className="space-y-2.5 rounded-[16px] bg-white p-4 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <p className="font-semibold text-[#09090B]">
                    {showCredits
                      ? locale === 'en'
                        ? 'Choose Video Resolution & Credit Mode'
                        : '화질 · 크레딧 모드 선택 (480p Draft · 720p · 1080p)'
                      : locale === 'en'
                        ? 'Choose Video Resolution'
                        : '화질 선택'}
                  </p>
                  {showCredits && (
                    <span className="rounded-full bg-[#F4F4F5] px-2 py-0.5 font-mono text-[0.65rem] font-semibold text-[#52525B] tabular-nums">
                      {locale === 'en'
                        ? `480p saves ${compiled.resolutionTiers.draftWorkflow.draftSavedPercentVs720p}%`
                        : `480p Draft · ${compiled.resolutionTiers.draftWorkflow.draftSavedPercentVs720p}% 크레딧 절약`}
                    </span>
                  )}
                </div>

                <div className={showCredits ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
                  {resolutionOptions.map((res) => {
                    const tier = compiled.resolutionTiers.tiers[res];
                    const active = selectedResolution === res;
                    return (
                      <button
                        key={res}
                        type="button"
                        data-direct-resolution-option={res}
                        aria-pressed={active}
                        onClick={() => setSelectedResolution(res)}
                        className={[
                          'flex flex-col justify-between rounded-[12px] p-2.5 text-left transition-all',
                          active
                            ? 'bg-white ring-[1.5px] ring-[#09090B]'
                            : 'bg-[#F4F4F5] hover:bg-[#ECECEF]'
                        ].join(' ')}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-xs font-bold text-[#09090B] tabular-nums">
                              {res}
                            </span>
                            <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold text-[#52525B]">
                              {res === '480p' ? 'DRAFT' : res === '720p' ? 'STD' : 'MAX'}
                            </span>
                          </div>
                          <p className="mt-1 text-[0.7rem] font-semibold text-[#09090B]">
                            {res === '480p'
                              ? '사전 테스트'
                              : res === '720p'
                                ? '스탠다드 고화질'
                                : '최고 화질'}
                          </p>
                        </div>
                        <p className="mt-2 font-mono text-[0.72rem] font-bold text-[#09090B] tabular-nums">
                          {showCredits
                            ? `${tier.totalCredits} cr`
                            : locale === 'en'
                              ? `₩${tier.totalKrw.toLocaleString('en-US')}`
                              : `${tier.totalKrw.toLocaleString('ko-KR')}원`}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <p
                  data-direct-no-bgm-rule
                  className="rounded-[12px] bg-[#F4F4F5] p-2.5 text-[0.71rem] leading-relaxed text-[#52525B]"
                >
                  🔊 {locale === 'en' ? PERSONAL_NO_BGM_AUDIO_NOTICE_EN : PERSONAL_NO_BGM_AUDIO_NOTICE_KO}
                </p>
              </div>

              {/* Step 2C: Privacy Guarantee */}
              <div className="space-y-2 rounded-[16px] bg-white p-4 text-xs">
                <p className="font-semibold text-[#09090B]">
                  완성된 영상은 소장하거나 템플릿으로 올릴 수 있어요
                </p>
                <p className="leading-relaxed text-[#09090B]">
                  {compiled.personalToTemplateSummary.personalRenderRoleKo}
                </p>
                <p className="rounded-[12px] bg-[#F4F4F5] p-2.5 text-[0.72rem] font-medium text-[#52525B]">
                  🔒 {compiled.personalToTemplateSummary.privacyGuaranteeKo}
                </p>
              </div>
            </div>
          </div>

          {/* STEP 3 (4 cols): Publish as Template & Set What Others Can Customize */}
          <div
            data-stage="template-promotion"
            data-template-freeze-matrix
            className="flex flex-col justify-between rounded-[16px] bg-[#F4F4F5] p-5 lg:col-span-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-[#09090B] px-3 py-1 text-xs font-bold text-white">
                  3단계 · 템플릿 등록 & 수익화
                </span>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#52525B]">
                  {ds.stage3PayoutBadge}
                </span>
              </div>

              <h3 className="text-base font-bold text-[#09090B]">
                {locale === 'en'
                  ? '3. Publish as Your Template & Earn'
                  : '3. 다른 사람이 만들 때 어디까지 바꿀 수 있게 할까요?'}
              </h3>

              <p className="text-xs leading-relaxed text-[#52525B]">
                내 영상을 템플릿으로 올리면{' '}
                <strong className="font-semibold text-[#09090B]">
                  카메라 구도와 조명은 깨지지 않게 자동으로 고정
                </strong>
                됩니다. 의상과 배경만 내 스타일로 고정할지, 다른 사람도 바꿀 수 있게 열어둘지 선택해 주세요.
              </p>

              {/* Simple Friendly Toggles for Outfit & Backdrop */}
              <div className="space-y-2 rounded-[16px] bg-white p-3.5 text-xs">
                <p className="font-semibold text-[#09090B]">
                  다른 사람이 내 템플릿을 쓸 때 설정 (클릭해서 변경)
                </p>
                <div className="flex items-center justify-between gap-2 py-1">
                  <span className="font-medium text-[#09090B]">
                    의상 스타일
                  </span>
                  <button
                    type="button"
                    data-toggle-lock="outfit"
                    aria-pressed={lockOutfit}
                    onClick={() => setLockOutfit((prev) => !prev)}
                    className={[
                      'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                      lockOutfit
                        ? 'bg-[#09090B] text-white'
                        : 'bg-[#F4F4F5] text-[#52525B] hover:bg-[#ECECEF]'
                    ].join(' ')}
                  >
                    {lockOutfit ? '내 의상 스타일로 고정' : '다른 사람 옷 사진 허용'}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-[#09090B]/[0.08] pt-2">
                  <span className="font-medium text-[#09090B]">
                    배경·소품 분위기
                  </span>
                  <button
                    type="button"
                    data-toggle-lock="backdrop"
                    aria-pressed={lockBackdrop}
                    onClick={() => setLockBackdrop((prev) => !prev)}
                    className={[
                      'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                      lockBackdrop
                        ? 'bg-[#09090B] text-white'
                        : 'bg-[#F4F4F5] text-[#52525B] hover:bg-[#ECECEF]'
                    ].join(' ')}
                  >
                    {lockBackdrop ? '내 배경으로 고정' : '다른 사람 배경 변경 허용'}
                  </button>
                </div>
              </div>

              {/* Friendly Freeze Summary List */}
              <ul className="space-y-2">
                {compiled.freezeMatrix.map((item) => (
                  <li
                    key={item.key}
                    data-freeze-item={item.key}
                    data-freeze-status={item.status}
                    className="rounded-[12px] bg-white p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-bold text-[#09090B]">
                        {locale === 'en' ? item.labelEn : item.labelKo}
                      </span>
                      <span
                        className={[
                          'rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold',
                          item.status === 'buyer_selfie_slot'
                            ? 'bg-[#09090B] text-white'
                            : item.status === 'open_user_reference'
                              ? 'bg-[#F4F4F5] text-[#09090B]'
                              : 'bg-[#F4F4F5] text-[#52525B]'
                        ].join(' ')}
                      >
                        {locale === 'en' ? item.badgeEn : item.badgeKo}
                      </span>
                    </div>
                    <p className="mt-1 text-[0.72rem] leading-relaxed text-[#52525B]">
                      {locale === 'en' ? item.detailEn : item.detailKo}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Summary Bar: How Future Buyers See This Published Template */}
        <div
          data-buyer-preview-card
          className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[16px] bg-[#F4F4F5] p-5"
        >
          <div className="max-w-2xl space-y-1">
            <p className="text-xs font-semibold text-[#71717A]">
              {locale === 'en'
                ? 'HOW OTHERS WILL USE YOUR TEMPLATE'
                : '템플릿으로 등록되면 다른 사람들에게 이렇게 보입니다'}
            </p>
            <p className="text-sm font-bold text-[#09090B]">
              {compiled.personalToTemplateSummary.templateBuyerExperienceKo}
            </p>
            <p className="text-xs text-[#52525B]">
              {ds.buyerPreviewEarningPattern
                .replace('{salePrice}', revenueSim.salePriceKrw.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR'))
                .replace('{perMake}', revenueSim.perMake.creator.toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR'))}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={creatorWorkspaceHref}
              data-direct-workspace-cta
              className="audience-button"
            >
              {locale === 'en' ? 'Start Making & Publish Template →' : '나만의 영상 만들고 템플릿 등록하기 →'}
            </a>
            <a
              href={videoCatalogHref}
              className="audience-button-quiet min-h-11 px-5 text-xs"
            >
              {locale === 'en' ? 'Browse Templates ↗' : '인기 템플릿 먼저 둘러보기 ↗'}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
