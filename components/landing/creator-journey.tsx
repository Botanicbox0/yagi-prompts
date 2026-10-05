import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { creatorCampaignsHref } from '@/lib/campaigns/links';

/** A durable participation door: an empty recruitment catalogue must not hide the earn loop. */
export function CreatorJourney({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.creatorJourney;
  return <section data-section data-theme="light" className="section" data-creator-journey>
    <div className="band pb-24 lg:pb-32">
      <div className="border-t border-hairline pt-10 lg:pt-16">
        <h2 className="font-display text-title font-black uppercase">{t.title}</h2>
        <p className="mt-6 max-w-detail text-body opacity-70">{t.body}</p>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">{Object.values(t.steps).map((s, i) => <li key={s.title} className="border-t border-hairline pt-5">
          <span aria-hidden="true" className="font-mono text-label opacity-50">0{i + 1}</span>
          <h3 className="mt-6 text-xl font-medium">{s.title}</h3><p className="mt-3 text-body opacity-70">{s.body}</p>
        </li>)}</ol>
      </div>
      <div className="mt-16 border-t border-hairline pt-8" data-creator-campaign-door>
        <h2 className="font-display text-[clamp(2rem,4vw,3.5rem)] leading-tight font-black uppercase">{t.campaignTitle}</h2>
        <p className="mt-5 max-w-detail text-body opacity-70">{t.campaignBody}</p>
        <div className="mt-7 flex flex-wrap gap-x-10 gap-y-5">
          <a href={creatorCampaignsHref(locale)} className="text-accent inline-flex min-h-11 items-center font-label text-label uppercase">{t.campaignCta} ↗</a>
          <a href={`/yagi/${locale}`} className="inline-flex min-h-11 items-center font-label text-label uppercase">{t.brandCta} ↗</a>
        </div>
      </div>
    </div>
  </section>;
}
