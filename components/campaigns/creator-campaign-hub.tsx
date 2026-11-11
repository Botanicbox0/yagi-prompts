'use client';

import { useState } from 'react';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard } from '@/lib/prompts/catalog';
import { templateHref, templatesHref } from '@/lib/prompts/links';
import { campaignHubEn, campaignHubKo, type CampaignHubCopy } from '@/messages/campaign-hub';

export interface CreatorCampaignHubProps {
  locale: Locale;
  copy?: CampaignHubCopy;
  featuredFormats: readonly PromptCard[];
  myCampaignsHref: string;
  directVideoHref: string;
}

type ArchetypeId = 'beauty-launch' | 'fashion-lookbook' | 'street-interview';

const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  'beauty-launch',
  'fashion-lookbook',
  'street-interview',
];

function resolveArchetype(copy: CampaignHubCopy, id: ArchetypeId) {
  switch (id) {
    case 'fashion-lookbook':
      return copy.archetypes.fashionLookbook;
    case 'street-interview':
      return copy.archetypes.streetInterview;
    default:
      return copy.archetypes.beautyLaunch;
  }
}

export function CreatorCampaignHub({
  locale,
  copy: providedCopy,
  featuredFormats,
  myCampaignsHref,
  directVideoHref,
}: CreatorCampaignHubProps) {
  const copy = providedCopy ?? (locale === 'en' ? campaignHubEn : campaignHubKo);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<ArchetypeId>('beauty-launch');
  const activeArchetype = resolveArchetype(copy, selectedArchetypeId);
  const guidePoints = [activeArchetype.point1, activeArchetype.point2, activeArchetype.point3];

  return (
    <div data-creator-campaign-hub className="mt-10 space-y-12">
      {/* 1. Two Ways to Monetize on TWINGS Campaigns: Official Format vs Guided Custom Video */}
      <section
        data-campaign-monetization-tracks
        aria-labelledby="monetization-tracks-heading"
        className="rounded-[24px] border border-[#3875C5]/20 bg-[#F3F7FA] p-6 sm:p-8 lg:p-10"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#3875C5]/15 pb-6">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8EFF7] px-3 py-1 text-xs font-semibold text-[#3063A7]">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[#3875C5]" />
              {copy.eyebrow}
            </span>
            <h2
              id="monetization-tracks-heading"
              className="mt-3 font-display text-[clamp(1.45rem,2.6vw,2.15rem)] leading-[1.15] font-semibold tracking-[-0.025em] text-[#0E1013]"
            >
              {copy.heading}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#41444D]">
              {copy.body}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={myCampaignsHref}
              data-campaign-hub-mine-cta
              className="inline-flex min-h-11 items-center rounded-full border border-hairline bg-white px-5 py-2.5 text-xs font-semibold text-[#0E1013] transition-colors hover:border-[#3875C5]"
            >
              {copy.mineCta}
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
                <span className="rounded-full bg-[#E8EFF7] px-3 py-1 text-xs font-semibold text-[#3063A7]">
                  {copy.track1.badge}
                </span>
                <span className="text-xs font-semibold text-[#3063A7]">
                  {copy.track1.sponsor}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-semibold tracking-[-0.015em] text-[#0E1013]">
                {copy.track1.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#41444D] sm:text-sm">
                {copy.track1.body}
              </p>

              <ol className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-4 text-xs">
                <li className="rounded-[14px] bg-[#F3F7FA] p-3">
                  <p className="font-semibold text-[#3063A7]">{copy.track1.step1Label}</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">{copy.track1.step1Title}</p>
                  <p className="mt-0.5 text-[0.72rem] text-[#41444D]">{copy.track1.step1Body}</p>
                </li>
                <li className="rounded-[14px] bg-[#F3F7FA] p-3">
                  <p className="font-semibold text-[#3063A7]">{copy.track1.step2Label}</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">{copy.track1.step2Title}</p>
                  <p className="mt-0.5 text-[0.72rem] text-[#41444D]">{copy.track1.step2Body}</p>
                </li>
                <li className="rounded-[14px] bg-[#F3F7FA] p-3">
                  <p className="font-semibold text-[#3063A7]">{copy.track1.step3Label}</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">{copy.track1.step3Title}</p>
                  <p className="mt-0.5 text-[0.72rem] text-[#41444D]">{copy.track1.step3Body}</p>
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
                <span className="rounded-full border border-hairline bg-[#F6F7F9] px-3 py-1 text-xs font-semibold text-[#0E1013]">
                  {copy.track2.badge}
                </span>
                <span className="text-xs font-semibold text-[#3063A7]">
                  {copy.track2.sponsor}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-semibold tracking-[-0.015em] text-[#0E1013]">
                {copy.track2.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#41444D] sm:text-sm">
                {copy.track2.body}
              </p>

              <ol className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-4 text-xs">
                <li className="rounded-[14px] bg-[#F6F7F9] p-3">
                  <p className="font-semibold text-[#3063A7]">{copy.track2.step1Label}</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">{copy.track2.step1Title}</p>
                  <p className="mt-0.5 text-[0.72rem] text-[#41444D]">{copy.track2.step1Body}</p>
                </li>
                <li className="rounded-[14px] bg-[#F6F7F9] p-3">
                  <p className="font-semibold text-[#3063A7]">{copy.track2.step2Label}</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">{copy.track2.step2Title}</p>
                  <p className="mt-0.5 text-[0.72rem] text-[#41444D]">{copy.track2.step2Body}</p>
                </li>
                <li className="rounded-[14px] bg-[#F6F7F9] p-3">
                  <p className="font-semibold text-[#3063A7]">{copy.track2.step3Label}</p>
                  <p className="mt-1 font-semibold text-[#0E1013]">{copy.track2.step3Title}</p>
                  <p className="mt-0.5 text-[0.72rem] text-[#41444D]">{copy.track2.step3Body}</p>
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
              {copy.simEyebrow}
            </p>
            <h2
              id="campaign-guide-sim-heading"
              className="mt-2 font-display text-[clamp(1.4rem,2.5vw,2.05rem)] leading-[1.15] font-semibold tracking-[-0.025em] text-[#0E1013]"
            >
              {copy.simHeading}
            </h2>
          </div>

          <div
            role="group"
            aria-label={copy.simGroupLabel}
            className="inline-flex flex-wrap gap-1.5 rounded-full bg-[#F3F7FA] p-1.5"
          >
            {ARCHETYPE_IDS.map((id) => {
              const arch = resolveArchetype(copy, id);
              const active = id === selectedArchetypeId;
              return (
                <button
                  key={id}
                  type="button"
                  data-campaign-archetype={id}
                  aria-pressed={active}
                  onClick={() => setSelectedArchetypeId(id)}
                  className={[
                    'inline-flex min-h-9 items-center rounded-full px-4 py-1.5 text-xs font-semibold transition-all',
                    active
                      ? 'bg-white text-[#0E1013] shadow-sm ring-1 ring-[#0E1013]/12'
                      : 'text-[#41444D] hover:text-[#0E1013]',
                  ].join(' ')}
                >
                  {arch.badge}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          {/* Left 7 cols: How to create for this campaign (Format vs Guided) */}
          <div className="space-y-4 rounded-[20px] border border-hairline bg-[#F6F7F9] p-5 lg:col-span-7">
            <h3 className="text-base font-semibold text-[#0E1013]">
              {activeArchetype.title}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[16px] border border-hairline bg-white p-4 text-xs">
                <span className="inline-block rounded-full bg-[#E8EFF7] px-2.5 py-0.5 font-semibold text-[#3063A7]">
                  {copy.wayALabel}
                </span>
                <p className="mt-2 leading-relaxed text-[#0E1013]">
                  {activeArchetype.formatWay}
                </p>
              </div>

              <div className="rounded-[16px] border border-hairline bg-white p-4 text-xs">
                <span className="inline-block rounded-full bg-[#F3F7FA] px-2.5 py-0.5 font-semibold text-[#0E1013]">
                  {copy.wayBLabel}
                </span>
                <p className="mt-2 leading-relaxed text-[#0E1013]">
                  {activeArchetype.guidedWay}
                </p>
              </div>
            </div>

            <div className="rounded-[16px] border border-[#3875C5]/25 bg-white p-4 text-xs">
              <p className="font-semibold text-[#3063A7]">
                {copy.payoutRuleLabel}
              </p>
              <p className="mt-1 font-medium text-[#0E1013]">
                {activeArchetype.payout}
              </p>
            </div>
          </div>

          {/* Right 5 cols: 3-Point Payout Checklist */}
          <div
            data-campaign-payout-checklist
            className="flex flex-col justify-between rounded-[20px] border border-[#3875C5]/25 bg-[#F3F7FA] p-5 lg:col-span-5"
          >
            <div>
              <span className="inline-block rounded-full bg-[#E8EFF7] px-3 py-1 text-xs font-semibold text-[#3063A7]">
                {copy.checklistBadge}
              </span>
              <p className="mt-2.5 text-xs leading-relaxed text-[#41444D]">
                {copy.checklistBody}
              </p>

              <ul className="mt-4 space-y-2.5">
                {guidePoints.map((point, idx) => (
                  <li
                    key={point}
                    className="flex items-start gap-2.5 rounded-[14px] border border-white bg-white p-3.5 text-xs text-[#0E1013] shadow-sm"
                  >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#E8EFF7] font-mono text-[0.7rem] font-semibold text-[#3063A7]">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed font-medium">{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-[0.75rem] leading-relaxed text-[#41444D]">
              {copy.proofFootnote}
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
                {copy.formatsEyebrow}
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.015em] text-[#0E1013]">
                {copy.formatsHeading}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={directVideoHref}
                className="inline-flex min-h-10 items-center rounded-full border border-hairline bg-white px-4 py-2 text-xs font-semibold text-[#0E1013] transition-colors hover:border-[#3875C5]"
              >
                {copy.directCta}
              </a>
              <a
                href={templatesHref(locale, 'video')}
                className="inline-flex min-h-10 items-center rounded-full border border-hairline bg-[#F6F7F9] px-4 py-2 text-xs font-semibold text-[#0E1013] hover:border-[#3875C5]"
              >
                {copy.allFormatsCta}
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
                    <span className="shrink-0 text-xs font-semibold text-[#3063A7]">{copy.viewFormat}</span>
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
