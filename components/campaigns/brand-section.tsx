import type { Dictionary } from '@/lib/i18n/dictionaries';
import { BRANDS_ANCHOR, BRAND_INQUIRY_ENDPOINT, brandWorkspaceHref } from '@/lib/campaigns/links';
import { BrandInquiryForm, type BrandFormTemplate } from './brand-form';

/**
 * The brand half of the campaigns page (founder, 2026-09-11): who this is for, the three things
 * that happen, and the form. One anchor — `#brands` — which the house ad, the footer and the empty
 * state all point at, so "how do I run one of these" has exactly one answer on the site.
 */
export function BrandSection({
  locale,
  copy,
  templates,
  privacy,
}: {
  locale: 'en' | 'ko';
  copy: Dictionary['campaigns']['brands'];
  templates: BrandFormTemplate[];
  privacy: { href: string; label: string };
}) {
  const steps = [copy.step1, copy.step2, copy.step3];
  return (
    <section id={BRANDS_ANCHOR} data-brands className="scroll-mt-24 pt-20 lg:pt-28">
      <p className="text-accent font-label text-eyebrow uppercase">{copy.eyebrow}</p>
      <h2 className="mt-6 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">{copy.heading}</h2>
      <p className="mt-8 max-w-detail text-body opacity-70">{copy.lede}</p>

      <ol className="mt-10 grid gap-4 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step} className="border-t border-current pt-3">
            <p className="font-mono text-[0.7rem] opacity-50">0{index + 1}</p>
            <p className="mt-2 text-[0.95rem] leading-snug">{step}</p>
          </li>
        ))}
      </ol>

      <div className="mt-14 max-w-detail">
        <a data-brand-workspace-entry href={brandWorkspaceHref(locale)} className="inline-flex min-h-12 items-center justify-center rounded-full bg-black px-7 py-3 font-medium text-white transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-4">
          {copy.workspaceCta}
        </a>
        <p className="mt-4 text-sm leading-relaxed opacity-65">{copy.workspaceHelp}</p>
        <details className="mt-10 border-t border-hairline pt-5">
          <summary className="cursor-pointer text-sm font-medium underline underline-offset-4">{copy.consultationToggle}</summary>
          <div className="pt-8"><BrandInquiryForm endpoint={BRAND_INQUIRY_ENDPOINT} locale={locale} labels={copy} templates={templates} privacy={privacy} /></div>
        </details>
      </div>
    </section>
  );
}
