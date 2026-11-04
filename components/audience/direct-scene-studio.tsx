'use client';

import { useMemo, useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import {
  compileReferenceToTemplatePromotion,
  DIRECT_SCENE_WORDING_CANDIDATES,
  HIGH_QUALITY_REQUEST_GUIDE,
  PRESET_REFERENCE_SCENARIOS,
  type PresetReferenceScenario
} from '@/lib/template-director/freestyle-to-template';
import { diagnosePhotoSuitability } from '@/lib/template-director/schema';

export interface DirectSceneStudioProps {
  locale: Locale;
  videoCatalogHref: string;
  creatorWorkspaceHref: string;
}

export function DirectSceneStudio({
  locale,
  videoCatalogHref,
  creatorWorkspaceHref
}: DirectSceneStudioProps) {
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
  const [directorKeepNote, setDirectorKeepNote] = useState<string>(
    locale === 'en'
      ? 'Keep the reference camera tracking and night flash rhythm.'
      : '레퍼런스 영상의 카메라 워킹과 야간 플래시 리듬은 그대로 유지해 주세요.'
  );
  const [directorChangeNote, setDirectorChangeNote] = useState<string>(
    locale === 'en'
      ? 'Swap the protagonist to my front photo and match the attached black wool coat reference.'
      : '주인공 얼굴을 내 정면 사진으로 바꾸고, 의상만 직접 첨부한 블랙 울 코트 사진 핏으로 맞춰 주세요.'
  );

  // Interactive photo suitability simulation so users see why direct clean selfie upload matters
  const [selfieCheckMode, setSelfieCheckMode] = useState<'clean-front' | 'filtered-or-angled'>(
    'clean-front'
  );
  const [selectedLikenessCandidate, setSelectedLikenessCandidate] = useState<'candidate-a' | 'candidate-b'>(
    'candidate-a'
  );

  const handleSelectPreset = (preset: PresetReferenceScenario) => {
    setSelectedPresetId(preset.id);
    setLockOutfit(preset.input.lockOutfitAsSignature);
    setLockBackdrop(preset.input.lockBackdropAsSignature);
  };

  const compiled = useMemo(
    () =>
      compileReferenceToTemplatePromotion({
        ...activePreset.input,
        lockOutfitAsSignature: lockOutfit,
        lockBackdropAsSignature: lockBackdrop
      }),
    [activePreset, lockOutfit, lockBackdrop]
  );

  const suitability = useMemo(
    () =>
      selfieCheckMode === 'clean-front'
        ? diagnosePhotoSuitability([], 0.36)
        : diagnosePhotoSuitability(['heavy_filter', 'angle_extreme'], 0.36),
    [selfieCheckMode]
  );

  const recommendedWording = DIRECT_SCENE_WORDING_CANDIDATES[0]!;

  return (
    <div data-direct-scene-studio className="space-y-14">
      {/* SECTION 0: Magnetic Freestyle Yourself Value Proposition */}
      <section
        data-direct-wording-rationale
        className="rounded-[24px] border border-[#3875C5]/25 bg-[#F3F7FA] p-6 sm:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8EFF7] px-3 py-1 font-mono text-[0.7rem] font-semibold text-[#3063A7] uppercase tabular-nums">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3875C5]" />
              {locale === 'en'
                ? 'FREESTYLE YOURSELF · DIRECT YOUR SCENE & LAUNCH YOUR TEMPLATE'
                : 'FREESTYLE YOURSELF · 나만의 장면에서 나만의 공식 템플릿까지'}
            </span>
            <h2 className="mt-3 text-lg font-bold tracking-[-0.015em] text-[#0E1013] sm:text-xl">
              {locale === 'en'
                ? recommendedWording.headlineEn
                : recommendedWording.headlineKo}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-black/70 sm:text-sm">
              {locale === 'en'
                ? recommendedWording.subcopyEn
                : recommendedWording.subcopyKo}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-[16px] border border-white bg-white px-4 py-3 text-xs">
              <p className="font-mono text-[0.68rem] font-bold text-[#3063A7] tabular-nums">01 · DIRECT</p>
              <p className="mt-1 font-semibold text-[#0E1013]">레퍼런스 영상 + 내 사진</p>
              <p className="mt-0.5 text-[0.7rem] text-black/60">원하는 무드를 내 얼굴로 먼저 완성</p>
            </div>
            <div className="rounded-[16px] border border-white bg-white px-4 py-3 text-xs">
              <p className="font-mono text-[0.68rem] font-bold text-[#3063A7] tabular-nums">02 · LOCK</p>
              <p className="mt-1 font-semibold text-[#0E1013]">카메라·조명·의상 고정</p>
              <p className="mt-0.5 text-[0.7rem] text-black/60">누가 찍어도 같은 미감이 나오게 잠금</p>
            </div>
            <div className="rounded-[16px] border border-white bg-white px-4 py-3 text-xs">
              <p className="font-mono text-[0.68rem] font-bold text-[#3063A7] tabular-nums">03 · PUBLISH</p>
              <p className="mt-1 font-semibold text-[#0E1013]">내 공식 템플릿 등판</p>
              <p className="mt-0.5 text-[0.7rem] text-black/60">다음 유저는 셀카 1장으로 바로 참여</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 1: How to Request for Maximum Quality (3 Golden Rules) */}
      <section data-high-quality-guide aria-labelledby="quality-guide-heading" className="space-y-6">
        <div className="border-t border-hairline pt-8">
          <p className="font-mono text-[0.72rem] font-semibold tracking-[0.08em] text-[#3063A7] uppercase tabular-nums">
            {locale === 'en'
              ? 'PART 01 · HIGH-COMPLETION PRODUCTION FORMULA'
              : 'PART 01 · 가장 완성도 높은 영상이 나오는 3대 제작 공식'}
          </p>
          <h2
            id="quality-guide-heading"
            className="mt-2 font-display text-[clamp(1.5rem,2.8vw,2.25rem)] leading-[1.08] font-black tracking-[-0.025em] text-[#0E1013]"
          >
            {locale === 'en'
              ? 'How to structure your reference request for 99% natural likeness'
              : '이렇게 요청할 때 얼굴 닮음새와 영상 미감이 가장 완벽하게 나옵니다'}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-black/65">
            {locale === 'en'
              ? 'Instead of writing long abstract prompts, combine a single-sequence reference video with your unfiltered front photo and direct outfit reference images.'
              : '막연하게 긴 프롬프트를 적는 대신, 카메라 호흡이 분명한 레퍼런스 영상 + 보정 없는 정면 실사 사진 + 바꿀 의상·소품 원본 사진을 직접 매칭하는 것이 핵심입니다.'}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {HIGH_QUALITY_REQUEST_GUIDE.map((rule) => (
            <article
              key={rule.stepNumber}
              data-quality-rule={rule.stepNumber}
              className="flex flex-col justify-between rounded-[24px] border border-hairline bg-white p-6 shadow-[0_14px_34px_-24px_rgba(12,15,20,0.1)]"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center rounded-full bg-[#E8EFF7] px-3 py-1 font-mono text-xs font-bold text-[#3063A7] tabular-nums">
                    RULE {rule.stepNumber}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-bold tracking-[-0.015em] text-[#0E1013]">
                  {locale === 'en' ? rule.titleEn : rule.titleKo}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-black/65">
                  {locale === 'en' ? rule.summaryEn : rule.summaryKo}
                </p>

                <div className="mt-4 space-y-3 border-t border-hairline pt-4">
                  <div className="rounded-[16px] bg-[#F3F7FA] p-3.5">
                    <p className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase">
                      {locale === 'en' ? 'BEST PRACTICE (HIGH QUALITY)' : '권장 — 완성도 극대화'}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[#0E1013]">
                      {rule.goodExamplesKo.map((ex) => (
                        <li key={ex} className="flex items-start gap-2">
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#3875C5]" />
                          <span>{ex}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-[16px] border border-hairline bg-[#F6F7F9] p-3.5">
                    <p className="font-mono text-[0.68rem] font-semibold text-black/55 uppercase">
                      {locale === 'en' ? 'AVOID (DISTORTION RISK)' : '피해야 할 요청 — 얼굴 왜곡 위험'}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-black/65">
                      {rule.avoidExamplesKo.map((ex) => (
                        <li key={ex} className="flex items-start gap-2">
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-black/35" />
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

      {/* SECTION 2: Interactive 3-Stage Reference -> Personal Film -> Template Promotion Studio */}
      <section
        data-direct-scene-simulator
        aria-labelledby="simulator-heading"
        className="rounded-[24px] border border-hairline bg-white p-6 shadow-[0_18px_42px_-28px_rgba(12,15,20,0.12)] sm:p-8 lg:p-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
          <div>
            <p className="font-mono text-[0.72rem] font-semibold tracking-[0.08em] text-[#3063A7] uppercase tabular-nums">
              {locale === 'en'
                ? 'PART 02 · INTERACTIVE REFERENCE → PERSONAL FILM → TEMPLATE ENGINE'
                : 'PART 02 · 레퍼런스 영상 → 내 얼굴 연출 → 템플릿 등판 시뮬레이터'}
            </p>
            <h2
              id="simulator-heading"
              className="mt-2 font-display text-[clamp(1.45rem,2.6vw,2.1rem)] leading-[1.08] font-black tracking-[-0.025em] text-[#0E1013]"
            >
              {locale === 'en'
                ? 'See how your reference film becomes your scene — and locks into a reusable template'
                : '레퍼런스 영상을 내 사진으로 만들고, 그대로 템플릿으로 등판시키는 전 과정'}
            </h2>
          </div>

          {/* Preset Reference Video Selector */}
          <div
            role="group"
            aria-label={locale === 'en' ? 'Select reference scenario' : '레퍼런스 시나리오 선택'}
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
                    'inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'border-[#3875C5] bg-[#3875C5] text-white'
                      : 'border-hairline bg-[#F6F7F9] text-[#0E1013] hover:border-[#3875C5]/45'
                  ].join(' ')}
                >
                  {locale === 'en' ? preset.badgeEn : preset.badgeKo}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3-Column Pipeline Flow */}
        <div className="mt-8 grid gap-6 lg:grid-cols-12">
          {/* STAGE 1 (4 cols): Reference Video + Direct Photo & Keep/Change Input */}
          <div
            data-stage="reference-input"
            className="flex flex-col justify-between rounded-[20px] border border-hairline bg-[#F6F7F9] p-5 lg:col-span-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#3063A7] tabular-nums">
                  STAGE 01 · REFERENCE & MY PHOTO
                </span>
                <span className="rounded-full bg-white px-2.5 py-0.5 font-mono text-[0.68rem] text-black/65 tabular-nums">
                  {activePreset.input.aspect} · {activePreset.input.durationSeconds}s
                </span>
              </div>

              <h3 className="text-base font-bold text-[#0E1013]">
                {locale === 'en'
                  ? '1. Reference Film & Direct Photo Matching'
                  : '1. 레퍼런스 영상 해부 & 내 실사 사진 매칭'}
              </h3>

              {/* Deconstructed Reference Video Layers */}
              <div className="space-y-2 rounded-[16px] border border-hairline bg-white p-3.5 text-xs">
                <p className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase">
                  {locale === 'en'
                    ? 'EXTRACTED FROM REFERENCE VIDEO'
                    : '레퍼런스 영상에서 자동 추출되는 뼈대'}
                </p>
                <div>
                  <span className="font-semibold text-[#0E1013]">카메라·호흡: </span>
                  <span className="text-black/70">{activePreset.input.cameraMotionPrompt}</span>
                </div>
                <div>
                  <span className="font-semibold text-[#0E1013]">조명·색감: </span>
                  <span className="text-black/70">{activePreset.input.lightingAndGradePrompt}</span>
                </div>
              </div>

              {/* Direct Selfie Suitability Verification */}
              <div
                data-selfie-suitability-box
                className="space-y-2.5 rounded-[16px] border border-hairline bg-white p-3.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#0E1013]">
                    {locale === 'en' ? 'My Front Photo Check' : '내 얼굴 사진 자체 검수 (AI 변형 없음)'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      data-selfie-sim="clean-front"
                      onClick={() => setSelfieCheckMode('clean-front')}
                      className={[
                        'rounded-full px-2.5 py-1 text-[0.68rem] font-medium',
                        selfieCheckMode === 'clean-front'
                          ? 'bg-[#3875C5] text-white'
                          : 'bg-[#F6F7F9] text-black/65'
                      ].join(' ')}
                    >
                      정면 원본
                    </button>
                    <button
                      type="button"
                      data-selfie-sim="filtered-or-angled"
                      onClick={() => setSelfieCheckMode('filtered-or-angled')}
                      className={[
                        'rounded-full px-2.5 py-1 text-[0.68rem] font-medium',
                        selfieCheckMode === 'filtered-or-angled'
                          ? 'bg-[#3875C5] text-white'
                          : 'bg-[#F6F7F9] text-black/65'
                      ].join(' ')}
                    >
                      보정·측면 사진 테스트
                    </button>
                  </div>
                </div>

                {suitability.isSuitable ? (
                  <p className="rounded-[12px] bg-[#F3F7FA] p-2.5 text-[0.72rem] leading-relaxed text-[#3063A7]">
                    ✓ 정면 각도·조명·선명도 통과 — AI 임의 보정 없이 원본 이목구비 그대로 1단계 키프레임에 매칭합니다.
                  </p>
                ) : (
                  <div
                    data-reupload-warning
                    className="rounded-[12px] border border-[#3875C5]/35 bg-[#F3F7FA] p-2.5 text-[0.72rem] leading-relaxed text-[#0E1013]"
                  >
                    <p className="font-semibold text-[#3063A7]">
                      ! 이 사진은 얼굴 왜곡 가능성이 있어 다른 정면 실사 사진 업로드를 권장합니다
                    </p>
                    <p className="mt-1 text-black/70">
                      {suitability.whyUnsuitableKo} {suitability.reuploadTipKo}
                    </p>
                  </div>
                )}
              </div>

              {/* Keep vs Change One-Line Brief */}
              <div className="space-y-2 rounded-[16px] border border-hairline bg-white p-3.5 text-xs">
                <label className="block">
                  <span className="font-semibold text-[#0E1013]">
                    유지할 것 (Keep from Reference)
                  </span>
                  <input
                    type="text"
                    value={directorKeepNote}
                    onChange={(e) => setDirectorKeepNote(e.target.value)}
                    className="mt-1 w-full rounded-[10px] border border-hairline bg-[#F6F7F9] px-3 py-2 text-xs text-[#0E1013]"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-[#0E1013]">
                    바꿀 것 + 직접 첨부 이미지 (Change with Direct Image)
                  </span>
                  <input
                    type="text"
                    value={directorChangeNote}
                    onChange={(e) => setDirectorChangeNote(e.target.value)}
                    className="mt-1 w-full rounded-[10px] border border-hairline bg-[#F6F7F9] px-3 py-2 text-xs text-[#0E1013]"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* STAGE 2 (4 cols): Personal Film Synthesis & Dual-Anchor Facial Likeness Selection */}
          <div
            data-stage="personal-synthesis"
            className="flex flex-col justify-between rounded-[20px] border border-hairline bg-[#F6F7F9] p-5 lg:col-span-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#3063A7] tabular-nums">
                  STAGE 02 · PERSONAL SCENE RESULT
                </span>
                <span className="rounded-full bg-[#E8EFF7] px-2.5 py-0.5 font-mono text-[0.68rem] font-semibold text-[#3063A7]">
                  {activePreset.input.lightingRiskForFace
                    ? '듀얼 A/B 닮음새 보호 활성'
                    : '2단계 실사 고정 파이프라인'}
                </span>
              </div>

              <h3 className="text-base font-bold text-[#0E1013]">
                {locale === 'en'
                  ? '2. How Your Photo Becomes the Protagonist'
                  : '2. 내 사진 기반 제작 & 닮음새 A/B 픽'}
              </h3>

              {/* Step 2A: Dual Keyframe Likeness Comparison */}
              <div
                data-dual-likeness-preview
                className="space-y-3 rounded-[16px] border border-hairline bg-white p-4 text-xs"
              >
                <p className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase">
                  STEP 2-A · 첫 프레임 얼굴 닮음새 A/B 선택 (왜곡 원천 차단)
                </p>
                <p className="leading-relaxed text-black/65">
                  레퍼런스 영상의 조명이 강하거나 각도가 입체적일 때, 성향이 다른 두 실사 모델로 첫 장면을 동시에 그려 **내 눈매·턱선이 더 닮은 쪽을 직접 고른 뒤** 본 영상을 생성합니다.
                </p>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-likeness-option="candidate-a"
                    aria-pressed={selectedLikenessCandidate === 'candidate-a'}
                    onClick={() => setSelectedLikenessCandidate('candidate-a')}
                    className={[
                      'rounded-[14px] border p-3 text-left transition-colors',
                      selectedLikenessCandidate === 'candidate-a'
                        ? 'border-[#3875C5] bg-[#F3F7FA]'
                        : 'border-hairline bg-[#F6F7F9]'
                    ].join(' ')}
                  >
                    <span className="font-mono text-[0.66rem] font-bold text-[#3063A7]">
                      후보 A · 이목구비 구조 우선
                    </span>
                    <p className="mt-1 text-[0.72rem] font-semibold text-[#0E1013]">
                      눈매·콧대·턱선 골격 고정형
                    </p>
                    <p className="mt-0.5 text-[0.68rem] text-black/60">
                      강한 플래시·네온 조명에서도 얼굴 윤곽 왜곡을 막아줍니다.
                    </p>
                  </button>

                  <button
                    type="button"
                    data-likeness-option="candidate-b"
                    aria-pressed={selectedLikenessCandidate === 'candidate-b'}
                    onClick={() => setSelectedLikenessCandidate('candidate-b')}
                    className={[
                      'rounded-[14px] border p-3 text-left transition-colors',
                      selectedLikenessCandidate === 'candidate-b'
                        ? 'border-[#3875C5] bg-[#F3F7FA]'
                        : 'border-hairline bg-[#F6F7F9]'
                    ].join(' ')}
                  >
                    <span className="font-mono text-[0.66rem] font-bold text-[#3063A7]">
                      후보 B · 피부결·자연광 블렌딩
                    </span>
                    <p className="mt-1 text-[0.72rem] font-semibold text-[#0E1013]">
                      부드러운 필름 톤·표정 조화형
                    </p>
                    <p className="mt-0.5 text-[0.68rem] text-black/60">
                      자연광·레트로 필름 특유의 부드러운 피부 질감을 살려줍니다.
                    </p>
                  </button>
                </div>
              </div>

              {/* Step 2B: Motion Synthesis Result & Role in Template Promotion */}
              <div className="space-y-2 rounded-[16px] border border-hairline bg-white p-4 text-xs">
                <p className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase">
                  STEP 2-B · 완성된 내 영상의 2가지 역할
                </p>
                <p className="leading-relaxed text-[#0E1013]">
                  {compiled.personalToTemplateSummary.personalRenderRoleKo}
                </p>
                <p className="rounded-[12px] bg-[#F3F7FA] p-2.5 text-[0.72rem] text-[#3063A7]">
                  🔒 {compiled.personalToTemplateSummary.privacyGuaranteeKo}
                </p>
              </div>
            </div>
          </div>

          {/* STAGE 3 (4 cols): Promote to Template — Lock vs Open Matrix */}
          <div
            data-stage="template-promotion"
            data-template-freeze-matrix
            className="flex flex-col justify-between rounded-[20px] border border-[#3875C5]/35 bg-[#F3F7FA] p-5 lg:col-span-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#3063A7] tabular-nums">
                  STAGE 03 · PUBLISH AS TEMPLATE
                </span>
                <span className="rounded-full bg-[#3875C5] px-2.5 py-0.5 font-mono text-[0.68rem] font-semibold text-white">
                  RECIPE V2 자동 컴파일
                </span>
              </div>

              <h3 className="text-base font-bold text-[#0E1013]">
                {locale === 'en'
                  ? '3. Template Lock Rules (What Freezes vs Opens)'
                  : '3. 템플릿 등판 시 고정(Lock) vs 오픈(Open) 설계'}
              </h3>

              <p className="text-xs leading-relaxed text-black/70">
                내 결과물을 템플릿으로 올릴 때 **카메라·조명·닮음새 안전장치는 품질 유지를 위해 100% 고정**되고, **의상과 배경은 시그니처 고정 또는 구매자 이미지 첨부 허용** 중 선택할 수 있습니다.
              </p>

              {/* Interactive Maker Lock Toggles for Outfit & Backdrop */}
              <div className="space-y-2 rounded-[16px] border border-white bg-white p-3.5 text-xs">
                <p className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase">
                  메이커 유연성 설정 (클릭해서 전환해 보세요)
                </p>
                <label className="flex cursor-pointer items-center justify-between gap-2 py-1">
                  <span className="font-medium text-[#0E1013]">
                    의상·스타일링 (`styling_outfit`)
                  </span>
                  <button
                    type="button"
                    data-toggle-lock="outfit"
                    aria-pressed={lockOutfit}
                    onClick={() => setLockOutfit((prev) => !prev)}
                    className={[
                      'rounded-full px-3 py-1 font-mono text-[0.68rem] font-semibold transition-colors',
                      lockOutfit
                        ? 'bg-[#0E1013] text-white'
                        : 'bg-[#E8EFF7] text-[#3063A7]'
                    ].join(' ')}
                  >
                    {lockOutfit ? '시그니처 고정 (LOCKED)' : '구매자 의상 사진 허용 (OPEN)'}
                  </button>
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-2 border-t border-hairline pt-2">
                  <span className="font-medium text-[#0E1013]">
                    배경 공간·소품 (`scene_backdrop`)
                  </span>
                  <button
                    type="button"
                    data-toggle-lock="backdrop"
                    aria-pressed={lockBackdrop}
                    onClick={() => setLockBackdrop((prev) => !prev)}
                    className={[
                      'rounded-full px-3 py-1 font-mono text-[0.68rem] font-semibold transition-colors',
                      lockBackdrop
                        ? 'bg-[#0E1013] text-white'
                        : 'bg-[#E8EFF7] text-[#3063A7]'
                    ].join(' ')}
                  >
                    {lockBackdrop ? '시그니처 고정 (LOCKED)' : '구매자 배경 사진 허용 (OPEN)'}
                  </button>
                </label>
              </div>

              {/* Freeze Matrix Breakdown */}
              <ul className="space-y-2">
                {compiled.freezeMatrix.map((item) => (
                  <li
                    key={item.key}
                    data-freeze-item={item.key}
                    data-freeze-status={item.status}
                    className="rounded-[14px] border border-white bg-white p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-bold text-[#0E1013]">
                        {locale === 'en' ? item.labelEn : item.labelKo}
                      </span>
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 font-mono text-[0.64rem] font-semibold',
                          item.status === 'buyer_selfie_slot'
                            ? 'bg-[#3875C5] text-white'
                            : item.status === 'open_user_reference'
                              ? 'bg-[#E8EFF7] text-[#3063A7]'
                              : 'bg-[#F6F7F9] text-black/70'
                        ].join(' ')}
                      >
                        {locale === 'en' ? item.badgeEn : item.badgeKo}
                      </span>
                    </div>
                    <p className="mt-1 text-[0.72rem] leading-relaxed text-black/65">
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
          className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-hairline bg-[#F6F7F9] p-5"
        >
          <div className="max-w-2xl space-y-1">
            <p className="font-mono text-[0.68rem] font-semibold text-[#3063A7] uppercase tabular-nums">
              {locale === 'en'
                ? `BUYER EXPERIENCE PREVIEW · SLUG: /t/${compiled.slug}`
                : `템플릿 등판 후 다음 구매자에게 보이는 화면 · /t/${compiled.slug}`}
            </p>
            <p className="text-sm font-bold text-[#0E1013]">
              {compiled.personalToTemplateSummary.templateBuyerExperienceKo}
            </p>
            <p className="text-xs text-black/60">
              자동 생성된 고정 요소 {compiled.sceneLockSpec.lockedElements.length}개 · 구매자 맞춤 가능 항목{' '}
              {compiled.sceneLockSpec.customizableElements.length}개 · 필수 슬롯:{' '}
              {Object.keys(compiled.recipe.slots).join(', ')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={creatorWorkspaceHref}
              data-direct-workspace-cta
              className="audience-button"
            >
              {locale === 'en' ? 'Open Maker Recipe Studio →' : '메이커 작업공간에서 레시피 열기 →'}
            </a>
            <a
              href={videoCatalogHref}
              className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-white px-5 py-2.5 text-xs font-semibold text-[#0E1013] transition-colors hover:border-[#3875C5]"
            >
              {locale === 'en' ? 'Browse Official Templates ↗' : '기존 에디토리얼 템플릿 둘러보기 ↗'}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
