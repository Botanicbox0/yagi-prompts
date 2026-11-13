import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';

export function MakerMonetizationShowcase({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const t = dict.creatorJourney.makerShowcase;
  const steps = [
    {
      num: '01',
      title: t.step1Title,
      body: t.step1Body,
    },
    {
      num: '02',
      title: t.step2Title,
      body: t.step2Body,
    },
    {
      num: '03',
      title: t.step3Title,
      body: t.step3Body,
    },
  ];

  return (
    <section
      id="maker"
      data-section=""
      data-theme="light"
      data-maker-monetization-showcase
      lang={locale}
      className="border-t border-[#E4E4E7] bg-white py-14 text-[#09090B] shadow-none sm:py-20"
    >
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10">
        <div className="rounded-[24px] border border-[#E4E4E7] bg-[#F4F4F5] p-6 shadow-none sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[0.72rem] font-semibold tracking-[0.08em] text-[#CC1573] uppercase">
                  {t.eyebrow}
                </span>
                <span
                  data-maker-showcase-payout
                  className="inline-flex items-center rounded-full border border-[#E4E4E7] bg-white px-3 py-1 text-[0.72rem] font-semibold text-[#CC1573]"
                >
                  {t.payoutBadge}
                </span>
              </div>

              <h2
                className="mt-3 font-display text-[clamp(1.5rem,2.8vw,2.25rem)] leading-[1.12] font-bold tracking-[-0.025em] text-[#09090B]"
                style={{ wordBreak: 'keep-all' }}
              >
                {t.heading}
              </h2>

              <p
                className="mt-3 max-w-xl text-sm leading-relaxed text-[#52525B] sm:text-base"
                style={{ wordBreak: 'keep-all' }}
              >
                {t.body}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
              <a
                href="/creators/workspace"
                data-maker-showcase-cta
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#FF58AE] px-6 py-2.5 text-sm font-bold text-[#09090B] shadow-none transition-colors hover:bg-[#FF73BA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF58AE]"
              >
                <span>{t.cta}</span>
                <span aria-hidden="true">→</span>
              </a>
              <p className="text-xs text-[#71717A]" style={{ wordBreak: 'keep-all' }}>
                {t.desktopNote}
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <article
                key={step.num}
                className="flex flex-col justify-between rounded-[18px] border border-[#E4E4E7] bg-white p-5 shadow-none"
              >
                <div>
                  <h3
                    className="text-base font-bold tracking-[-0.01em] text-[#09090B]"
                    style={{ wordBreak: 'keep-all' }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="mt-2 text-sm leading-relaxed text-[#52525B]"
                    style={{ wordBreak: 'keep-all' }}
                  >
                    {step.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
