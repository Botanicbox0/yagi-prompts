'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';

export interface CreatorCampaignHubProps {
  locale: Locale;
  featuredFormats: readonly PromptCard[];
  myCampaignsHref: string;
  directVideoHref: string;
}

interface CampaignArchetypeSpec {
  id: 'beauty-launch' | 'fashion-lookbook' | 'street-interview';
  badgeKo: string;
  badgeEn: string;
  titleKo: string;
  titleEn: string;
  formatWayKo: string;
  guidedWayKo: string;
  requiredGuidePointsKo: readonly string[];
  payoutConditionKo: string;
}

const CAMPAIGN_ARCHETYPES: readonly CampaignArchetypeSpec[] = [
  {
    id: 'beauty-launch',
    badgeKo: '뷰티 · 향수 캠페인 예시',
    badgeEn: 'Beauty & Perfume Campaign',
    titleKo: '신제품 향수 · 뷰티 클로즈업 릴스 캠페인',
    titleEn: 'New Perfume & Beauty Close-Up Reels Campaign',
    formatWayKo:
      '브랜드가 지정한 [뷰티 스튜디오 클로즈업] 공식 포맷을 선택하고 내 정면 사진 1장만 올리면, 브랜드 향수를 들고 미소 짓는 영상이 제작비 0원(브랜드 지원)으로 완성됩니다.',
    guidedWayKo:
      '브랜드가 제공한 향수 보틀 사진을 소품 칸에 첨부하고, “은은한 오후 햇살 아래 향수를 들고 카메라를 바라보는 장면” 가이드를 지켜 나만의 영상으로 만들어도 참여할 수 있습니다.',
    requiredGuidePointsKo: [
      '영상 내 브랜드 제품(향수 보틀) 2초 이상 선명하게 노출',
      '인스타그램 릴스 또는 틱톡 전체 공개 업로드 + 브랜드 공식 계정 태그',
      '필수 해시태그 및 광고·협찬 표기 문구 캡션 첫 줄 포함'
    ],
    payoutConditionKo:
      '게시물 링크 등록 후 가이드 준수 및 7일 공개 유지 확인 시 약정된 캠페인 리워드 현금 정산'
  },
  {
    id: 'fashion-lookbook',
    badgeKo: '패션 · 스트릿 룩북 예시',
    badgeEn: 'Fashion & Street Lookbook',
    titleKo: '시즌 시그니처 아우터 착용 & 런웨이 캠페인',
    titleEn: 'Seasonal Signature Outerwear Runway Campaign',
    formatWayKo:
      '브랜드의 시즌 아우터가 이미 세팅된 [도심 플래시 런웨이] 공식 포맷에 내 정면 사진만 넣어, 실제 옷을 배송받지 않고도 착용 영상을 즉시 완성합니다.',
    guidedWayKo:
      '브랜드 룩북 의상 사진을 의상 레퍼런스로 첨부하고, 내가 저장해 둔 스트릿 워킹 영상으로 나만의 런웨이 영상을 제작해 올릴 수 있습니다.',
    requiredGuidePointsKo: [
      '지정된 시즌 아우터 컬러·핏이 왜곡 없이 보이도록 공식 포맷 또는 의상 사진 첨부 사용',
      '9:16 세로 비율 영상으로 릴스·틱톡 게시 후 링크 제출',
      '캠페인 기간 내 게시물 유지 및 브랜드 공식 계정 멘션'
    ],
    payoutConditionKo:
      '가이드 검수 통과 즉시 기본 원고료 정산 + 우수 성과 콘텐츠 2차 광고 활용 시 추가 라이선스 수익 지급'
  },
  {
    id: 'street-interview',
    badgeKo: '트렌드 챌린지 · 인터뷰 예시',
    badgeEn: 'Trend Challenge & Street Interview',
    titleKo: '글로벌 AI 플랫폼 · 90년대 길거리 인터뷰 챌린지',
    titleEn: 'Global AI Platform · 90s Street Interview Challenge',
    formatWayKo:
      '검증된 [90년대 압구정 캠코더 인터뷰] 공식 포맷으로 내 얼굴이 나오는 인터뷰 영상을 만들고, 캠페인 주제에 맞는 재치 있는 한마디로 SNS에 게시합니다.',
    guidedWayKo:
      '90년대 레트로 캠코더 감성과 인터뷰 마이크 구도 가이드를 지켜 나만의 질문·답변 장면으로 연출해 올려도 동일하게 인정됩니다.',
    requiredGuidePointsKo: [
      '공식 인터뷰 포맷 사용 또는 레트로 인터뷰 가이드 준수 (실제 영상 9편 · 200만 뷰+ · 파생 오가닉 콘텐츠 300건+ 검증 구조)',
      '캠페인 지정 사운드 또는 자막 스타일 적용 후 SNS 전체 공개',
      '내 캠페인 페이지에 업로드 완료 링크 제출'
    ],
    payoutConditionKo:
      '공개 게시 확인 후 캠페인 리워드 정산 지급 (SNS 게시 보상 이미지 전용 크레딧 정책 별도 운영 가능)'
  }
] as const;

export function CreatorCampaignHub({
  locale,
  featuredFormats,
  myCampaignsHref,
  directVideoHref
}: CreatorCampaignHubProps) {
  const [selectedArchetypeId, setSelectedArchetypeId] =
    useState<CampaignArchetypeSpec['id']>('beauty-launch');

  const activeArchetype =
    CAMPAIGN_ARCHETYPES.find((a) => a.id === selectedArchetypeId) ??
    CAMPAIGN_ARCHETYPES[0]!;

  return (
    <div data-creator-campaign-hub className="mt-10 space-y-12">
      {/* 1. Two Ways to Monetize on TWINGS Campaigns: Official Format vs Guided Custom Video */}
      <section
        data-campaign-monetization-tracks
        aria-labelledby="monetization-tracks-heading"
        className="rounded-[24px] border border-[#3875C5]/25 bg-[#F3F7FA] p-6 sm:p-8 lg:p-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#3875C5]/15 pb-6">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8EFF7] px-3 py-1 text-xs font-semibold text-[#3063A7]">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3875C5]" />
              {locale === 'en'
                ? 'HOW CREATORS MONETIZE ON TWINGS'
                : '크리에이터 캠페인 수익화 · 2가지 참여 방법'}
            </span>
            <h2
              id="monetization-tracks-heading"
              className="mt-3 font-display text-[clamp(1.45rem,2.6vw,2.15rem)] leading-[1.1] font-black tracking-[-0.025em] text-[#0E1013]"
            >
              {locale === 'en'
                ? 'Use a ready-made campaign format, or follow the brand guide to make your own video and get paid'
                : '지정된 포맷으로 간편하게 찍거나, 가이드에 맞춰 내 영상을 만들어 올리고 수익을 받으세요'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-black/65">
              {locale === 'en'
                ? 'Selected creators generate campaign videos for free (sponsored by the brand) and earn cash payouts after posting on Instagram Reels or TikTok.'
                : '직접 촬영 스튜디오에 가거나 제품을 배송받을 필요가 없습니다. 내 정면 사진 한 장으로 브랜드 캠페인 영상을 무료로 제작해 인스타그램 릴스·틱톡에 올리면 약정된 수익금을 정산받습니다.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={myCampaignsHref}
              data-campaign-hub-mine-cta
              className="audience-button"
            >
              {locale === 'en' ? 'My Campaigns & Payouts →' : '내 캠페인 · 수익 현황 보기 →'}
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {/* Track 1: Official Format Participation */}
          <article
            data-campaign-track="format"
            className="flex flex-col justify-between rounded-[22px] border border-white bg-white p-6 shadow-[0_14px_34px_-24px_rgba(12,15,20,0.1)]"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-[#3875C5] px-3 py-1 text-xs font-bold text-white">
                  {locale === 'en' ? 'WAY 01 · USE OFFICIAL FORMAT' : '방법 01 · 지정된 공식 포맷으로 바로 만들기'}
                </span>
                <span className="text-xs font-semibold text-[#3063A7]">
                  {locale === 'en' ? 'Production Cost ₩0 (Brand Sponsored)' : '제작비 0원 · 브랜드 전액 지원'}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-bold tracking-[-0.015em] text-[#0E1013]">
                {locale === 'en'
                  ? 'Pick the brand’s template + upload 1 selfie = Done'
                  : '브랜드가 준비한 인기 포맷에 내 사진 1장만 넣으면 끝납니다'}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-black/65 sm:text-sm">
                {locale === 'en'
                  ? 'Camera movement, lighting, and brand product styling are already pre-built in the template. Just add your front photo, post the finished video to your SNS, and get paid.'
                  : '카메라 구도, 조명, 브랜드 의상·제품이 이미 포맷 안에 완벽하게 세팅되어 있어요. 내 정면 사진만 넣어 영상을 뽑은 뒤 내 SNS에 올리면 캠페인 수익이 정산됩니다.'}
              </p>

              <ol className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-4 text-xs">
                <li className="rounded-[14px] bg-[#F3F7FA] p-3">
                  <p className="font-bold text-[#3063A7]">STEP 1</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">캠페인 포맷 선택</p>
                  <p className="mt-0.5 text-[0.7rem] text-black/60">지정된 공식 템플릿 열기</p>
                </li>
                <li className="rounded-[14px] bg-[#F3F7FA] p-3">
                  <p className="font-bold text-[#3063A7]">STEP 2</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">무료 스폰서 제작</p>
                  <p className="mt-0.5 text-[0.7rem] text-black/60">내 사진으로 비용 없이 생성</p>
                </li>
                <li className="rounded-[14px] bg-[#F3F7FA] p-3">
                  <p className="font-bold text-[#3063A7]">STEP 3</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">SNS 게시 & 정산</p>
                  <p className="mt-0.5 text-[0.7rem] text-black/60">링크 제출 후 현금 지급</p>
                </li>
              </ol>
            </div>
          </article>

          {/* Track 2: Guide-Compliant Custom Video */}
          <article
            data-campaign-track="guided-custom"
            className="flex flex-col justify-between rounded-[22px] border border-white bg-white p-6 shadow-[0_14px_34px_-24px_rgba(12,15,20,0.1)]"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-[#0E1013] px-3 py-1 text-xs font-bold text-white">
                  {locale === 'en' ? 'WAY 02 · FOLLOW GUIDE & MAKE YOUR OWN' : '방법 02 · 가이드 지켜 나만의 영상으로 만들기'}
                </span>
                <span className="text-xs font-semibold text-[#3063A7]">
                  {locale === 'en' ? 'Campaign Payout + 2nd License Bonus' : '캠페인 수익 + 2차 광고 활용 보너스'}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-bold tracking-[-0.015em] text-[#0E1013]">
                {locale === 'en'
                  ? 'Follow the brand brief and direct the video in your own vibe'
                  : '브랜드 핵심 가이드만 지키면 내 감성대로 만든 영상으로도 수익화됩니다'}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-black/65 sm:text-sm">
                {locale === 'en'
                  ? 'Attach the brand’s product or outfit image and keep the required hashtag/caption rules while directing a video that fits your feed.'
                  : '브랜드가 전달한 제품·의상 사진을 첨부하고 필수 노출 가이드(해시태그·멘션·분위기)만 지키면, 내 피드 감성에 맞춘 나만의 영상으로 참여해 수익을 받을 수 있습니다.'}
              </p>

              <ol className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-4 text-xs">
                <li className="rounded-[14px] bg-[#F6F7F9] p-3">
                  <p className="font-bold text-[#3063A7]">STEP 1</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">필수 가이드 확인</p>
                  <p className="mt-0.5 text-[0.7rem] text-black/60">제품 노출·해시태그 체크</p>
                </li>
                <li className="rounded-[14px] bg-[#F6F7F9] p-3">
                  <p className="font-bold text-[#3063A7]">STEP 2</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">내 스타일로 제작</p>
                  <p className="mt-0.5 text-[0.7rem] text-black/60">제품 사진 넣어 영상 완성</p>
                </li>
                <li className="rounded-[14px] bg-[#F6F7F9] p-3">
                  <p className="font-bold text-[#3063A7]">STEP 3</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">검수 통과 & 정산</p>
                  <p className="mt-0.5 text-[0.7rem] text-black/60">우수작 2차 활용 추가 수익</p>
                </li>
              </ol>
            </div>
          </article>
        </div>
      </section>

      {/* 2. Interactive Campaign Guide & Payout Simulator */}
      <section
        data-campaign-guide-simulator
        aria-labelledby="campaign-guide-sim-heading"
        className="rounded-[24px] border border-hairline bg-white p-6 shadow-[0_18px_42px_-28px_rgba(12,15,20,0.12)] sm:p-8 lg:p-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
          <div>
            <p className="text-xs font-semibold text-[#3063A7]">
              {locale === 'en'
                ? 'CAMPAIGN BRIEF & PAYOUT CHECKLIST'
                : '실제 캠페인 참여 가이드 & 정산 조건 미리보기'}
            </p>
            <h2
              id="campaign-guide-sim-heading"
              className="mt-2 font-display text-[clamp(1.4rem,2.5vw,2.05rem)] leading-[1.1] font-black tracking-[-0.025em] text-[#0E1013]"
            >
              {locale === 'en'
                ? 'See what a brand brief asks for — and how your post turns into a payout'
                : '어떤 가이드를 지키면 수익금이 정산되는지 예시로 확인해 보세요'}
            </h2>
          </div>

          <div role="group" aria-label="캠페인 유형 선택" className="flex flex-wrap gap-2">
            {CAMPAIGN_ARCHETYPES.map((arch) => {
              const active = arch.id === selectedArchetypeId;
              return (
                <button
                  key={arch.id}
                  type="button"
                  data-campaign-archetype={arch.id}
                  aria-pressed={active}
                  onClick={() => setSelectedArchetypeId(arch.id)}
                  className={[
                    'inline-flex min-h-10 items-center rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                    active
                      ? 'border-[#3875C5] bg-[#3875C5] text-white'
                      : 'border-hairline bg-[#F6F7F9] text-[#0E1013] hover:border-[#3875C5]'
                  ].join(' ')}
                >
                  {locale === 'en' ? arch.badgeEn : arch.badgeKo}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          {/* Left 7 cols: How to create for this campaign (Format vs Guided) */}
          <div className="space-y-4 rounded-[20px] border border-hairline bg-[#F6F7F9] p-5 lg:col-span-7">
            <h3 className="text-base font-bold text-[#0E1013]">
              {locale === 'en' ? activeArchetype.titleEn : activeArchetype.titleKo}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] border border-hairline bg-white p-4 text-xs">
                <span className="inline-block rounded-full bg-[#E8EFF7] px-2.5 py-0.5 font-bold text-[#3063A7]">
                  방법 A · 공식 포맷 활용 시
                </span>
                <p className="mt-2 leading-relaxed text-[#0E1013]">
                  {activeArchetype.formatWayKo}
                </p>
              </div>

              <div className="rounded-[16px] border border-hairline bg-white p-4 text-xs">
                <span className="inline-block rounded-full bg-[#F3F7FA] px-2.5 py-0.5 font-bold text-[#0E1013]">
                  방법 B · 가이드 맞춰 직접 제작 시
                </span>
                <p className="mt-2 leading-relaxed text-[#0E1013]">
                  {activeArchetype.guidedWayKo}
                </p>
              </div>
            </div>

            <div className="rounded-[16px] border border-[#3875C5]/25 bg-white p-4 text-xs">
              <p className="font-semibold text-[#3063A7]">
                수익 정산 기준
              </p>
              <p className="mt-1 font-medium text-[#0E1013]">
                {activeArchetype.payoutConditionKo}
              </p>
            </div>
          </div>

          {/* Right 5 cols: 3-Point Payout Checklist */}
          <div
            data-campaign-payout-checklist
            className="flex flex-col justify-between rounded-[20px] border border-[#3875C5]/30 bg-[#F3F7FA] p-5 lg:col-span-5"
          >
            <div>
              <span className="inline-block rounded-full bg-[#3875C5] px-3 py-1 text-xs font-bold text-white">
                업로드 전 필수 체크리스트 3가지
              </span>
              <p className="mt-2.5 text-xs leading-relaxed text-black/70">
                아래 3가지 가이드만 지켜서 올리고 링크를 제출하면 빠짐없이 정산됩니다.
              </p>

              <ul className="mt-4 space-y-2.5">
                {activeArchetype.requiredGuidePointsKo.map((point, idx) => (
                  <li
                    key={point}
                    className="flex items-start gap-2.5 rounded-[14px] border border-white bg-white p-3.5 text-xs text-[#0E1013] shadow-sm"
                  >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#E8EFF7] font-mono text-[0.7rem] font-bold text-[#3063A7]">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed font-medium">{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-[0.72rem] leading-relaxed text-black/60">
              * 글로벌 AI 플랫폼 캠페인 검증 실적: 영상 9편 · 200만 뷰+ · 파생 오가닉 콘텐츠 300건+ 달성
            </p>
          </div>
        </div>
      </section>

      {/* 3. Ready-to-Use Popular Formats + Dual Monetization Bridge */}
      {featuredFormats.length > 0 && (
        <section
          data-campaign-format-preview
          className="rounded-[24px] border border-hairline bg-white p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-5">
            <div>
              <p className="text-xs font-semibold text-[#3063A7]">
                {locale === 'en'
                  ? 'POPULAR CAMPAIGN-READY FORMATS'
                  : '캠페인과 릴스에서 가장 반응이 좋은 대표 포맷'}
              </p>
              <h3 className="mt-1 text-lg font-bold tracking-[-0.015em] text-[#0E1013]">
                {locale === 'en'
                  ? 'Practice with a trending format or make your own template to earn 80%'
                  : '인기 포맷으로 내 영상을 만들어 보거나, 나만의 템플릿을 올려 80% 수익도 함께 받아보세요'}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={directVideoHref}
                className="inline-flex min-h-10 items-center rounded-full bg-[#3875C5] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#3063A7]"
              >
                {locale === 'en' ? 'Make My Own Video & Earn 80% →' : '나만의 영상 제작 & 80% 템플릿 수익 보기 →'}
              </a>
              <a
                href={templatesHref(locale, 'video')}
                className="inline-flex min-h-10 items-center rounded-full border border-hairline bg-[#F6F7F9] px-4 py-2 text-xs font-semibold text-[#0E1013] hover:border-[#3875C5]"
              >
                {locale === 'en' ? 'All Video Formats ↗' : '전체 영상 포맷 보기 ↗'}
              </a>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {featuredFormats.slice(0, 3).map((card) => {
              const title = locale === 'ko' && card.titleKo ? card.titleKo : card.title;
              return (
                <a
                  key={card.slug}
                  href={templateHref(locale, card.slug)}
                  className="group flex flex-col justify-between rounded-[18px] border border-hairline bg-[#F6F7F9]/75 p-3 transition-colors hover:border-[#3875C5] hover:bg-white"
                >
                  <div className="aspect-[4/5] w-full overflow-hidden rounded-[12px] bg-sky">
                    {card.video ? (
                      <video
                        src={card.video.src}
                        poster={card.poster?.src}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    ) : card.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element -- public poster
                      <img
                        src={card.poster.src}
                        alt={title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2 px-0.5">
                    <span className="truncate text-sm font-semibold text-[#0E1013]">{title}</span>
                    <span className="shrink-0 text-xs font-semibold text-[#3063A7]">포맷 보기 →</span>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
