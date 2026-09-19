import type { Dictionary } from '@/lib/i18n/dictionaries';
import { CAMPAIGN_REEL } from '@/lib/campaigns/showreel';
import { Reveal, ScrubY } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { CampaignShowreel } from './showreel';

/**
 * The brand-facing half of `/[locale]/campaigns` (founder, 2026-09-14): "브랜드가 보고 캠페인
 * 의뢰하는 랜딩페이지". Four server sections in reading order —
 *
 *   hero        what a campaign IS, in one sentence, and the two doors (brand / creator)
 *   showreel    four studio formats, playing — the scene before the explanation
 *   principles  the three things that only work together here: licensed real faces, studio-grade
 *               formats, spread through real channels (the moat, stated as mechanism)
 *   proof       the one campaign that has already run, in three numbers, client unnamed by contract
 *
 * The enquiry form (`brand-section.tsx`) and the creator rails follow these on the page.
 * Every section paints its own theme (`data-section` + `data-theme`) so the nav and the ad rail
 * read the black↔white rhythm the landing uses.
 */

type Landing = Dictionary['campaigns']['landing'];

export const CREATORS_ANCHOR = 'creators';

export function CampaignHero({ copy, brandHref, creatorHref }: { copy: Landing; brandHref: string; creatorHref: string }) {
  return (
    <section data-section data-theme="light" data-campaign-hero className="section">
      <div className="band pt-28 pb-16 lg:pt-36 lg:pb-24">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
        <Reveal
          immediate
          delay={0.05}
          as="h1"
          lines={[copy.line1, copy.line2, copy.line3]}
          className="mt-6 font-display text-title font-black uppercase"
        />
        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-14 gap-y-6 lg:mt-10">
          <p data-campaign-definition className="max-w-detail text-body opacity-70">{copy.intro}</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <a href={brandHref} data-campaign-cta-brand className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase">
              <TextSwap>{copy.ctaBrand} →</TextSwap>
            </a>
            <a href={creatorHref} data-campaign-cta-creator className="inline-block border border-current px-6 py-3 font-label text-label uppercase">
              <TextSwap>{copy.ctaCreator} →</TextSwap>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CampaignReelSection({ copy }: { copy: Landing }) {
  return (
    <section data-section data-theme="dark" data-campaign-reel-section className="section border-y border-hairline">
      <div className="band py-16 lg:py-24">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.reelEyebrow}</p>
        <h2 className="mt-6 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">{copy.reelHeading}</h2>
        <p className="mt-6 max-w-detail text-body opacity-70">{copy.reelLede}</p>
        <div className="mt-10">
          <CampaignShowreel
            items={CAMPAIGN_REEL}
            captions={copy.reel}
            labels={{ play: copy.reelPlay, pause: copy.reelPause, unmute: copy.reelUnmute, mute: copy.reelMute }}
          />
        </div>
      </div>
    </section>
  );
}

export function CampaignPrinciples({ copy }: { copy: Landing }) {
  const pillars = [
    { title: copy.how1Title, body: copy.how1Body },
    { title: copy.how2Title, body: copy.how2Body },
    { title: copy.how3Title, body: copy.how3Body },
  ];
  return (
    <section data-section data-theme="light" data-campaign-principles className="section">
      <div className="band py-20 lg:py-28">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.howEyebrow}</p>
        <ScrubY className="mt-6">
          <Reveal as="h2" lines={copy.howHeading.split('\n')} className="font-display text-title font-black uppercase" />
        </ScrubY>
        <ol className="mt-12 grid gap-8 lg:grid-cols-3 lg:gap-10">
          {pillars.map((pillar, index) => (
            <li key={pillar.title} className="border-t border-current pt-4">
              <p className="font-mono text-[0.7rem] opacity-50">0{index + 1}</p>
              <h3 className="mt-3 font-display text-[1.35rem] leading-tight font-black">{pillar.title}</h3>
              <p className="mt-4 text-[0.95rem] leading-relaxed opacity-75">{pillar.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-12 max-w-detail border-l-2 border-accent pl-4 text-[0.95rem] leading-relaxed opacity-80">{copy.howNote}</p>
      </div>
    </section>
  );
}

export function CampaignProof({ copy }: { copy: Landing }) {
  const stats = [
    { value: copy.proofStat1Value, label: copy.proofStat1Label },
    { value: copy.proofStat2Value, label: copy.proofStat2Label },
    { value: copy.proofStat3Value, label: copy.proofStat3Label },
  ];
  return (
    <section data-section data-theme="dark" data-campaign-proof className="section border-y border-hairline">
      <div className="band py-20 lg:py-28">
        <p className="text-accent font-label text-eyebrow uppercase">{copy.proofEyebrow}</p>
        <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-14">
          <h2 className="font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">{copy.proofHeading}</h2>
          <p className="text-body opacity-70 lg:pt-2">{copy.proofBody}</p>
        </div>
        <dl className="mt-12 grid grid-cols-1 gap-px border border-hairline bg-hairline sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-surface px-5 py-7">
              <dt className="font-label text-eyebrow uppercase opacity-60">{stat.label}</dt>
              <dd className="text-stat mt-3 font-display font-black">{stat.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 font-mono text-[0.7rem] opacity-50">{copy.proofNote}</p>
      </div>
    </section>
  );
}
