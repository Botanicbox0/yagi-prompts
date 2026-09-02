import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  ESCROW,
  LEGAL_DOCS,
  LEGAL_EFFECTIVE,
  businessRows,
  isLegalDoc,
  legalDocument,
} from '@/lib/legal/documents';
import { legalHref } from '@/lib/legal/links';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { Markdown } from '@/components/playbook/markdown';

/**
 * `/[locale]/legal/[doc]` — 이용약관 · 환불정책 · 개인정보처리방침.
 *
 * STATIC and indexable, and both of those are requirements rather than preferences: a payment
 * provider's merchant review (and 전자상거래법 §21) expects these to be reachable by anyone at a
 * stable URL, without a session and without JavaScript. There is nothing viewer-shaped on the page,
 * so it is prerendered for every locale × document at build time.
 *
 * One route for three documents: they share a frame, a seller block and an effective date, and
 * three near-identical page files would be three places for that frame to drift.
 */
export const dynamic = 'force-static';

interface RouteParams {
  params: Promise<{ locale: string; doc: string }>;
}

export function generateStaticParams() {
  return LOCALES.flatMap((locale) => LEGAL_DOCS.map((doc) => ({ locale, doc })));
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: rawLocale, doc } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  if (!isLegalDoc(doc)) return {};
  const document = legalDocument(doc, locale);
  const rest = `/legal/${doc}`;
  return {
    title: document.title,
    description: document.summary,
    alternates: {
      canonical: `/${locale}${rest}`,
      languages: { en: `/en${rest}`, ko: `/ko${rest}`, 'x-default': `/en${rest}` },
    },
  };
}

export default async function LegalPage({ params }: RouteParams) {
  const { locale: rawLocale, doc } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  if (!isLegalDoc(doc)) notFound();

  const dict = getDictionary(locale);
  const document = legalDocument(doc, locale);
  const rows = businessRows(locale);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/legal/${doc}`} initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section">
        <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
          <p className="text-accent font-label text-eyebrow uppercase">{dict.legal.eyebrow}</p>
          <h1 className="mt-6 font-display text-[clamp(2rem,4vw,3rem)] leading-[0.95] font-black uppercase">
            {document.title}
          </h1>
          <p className="mt-5 max-w-detail text-body opacity-70">{document.summary}</p>
          <p className="mt-3 font-mono text-[0.72rem] tracking-[0.06em] uppercase opacity-45">
            {dict.legal.effective} {LEGAL_EFFECTIVE}
          </p>

          {/* The sibling documents, so a reviewer reaches all three from any one of them. */}
          <nav aria-label={dict.legal.eyebrow} className="mt-8 flex flex-wrap gap-2">
            {LEGAL_DOCS.map((name) => (
              <a
                key={name}
                href={legalHref(locale, name)}
                data-legal-link={name}
                aria-current={name === doc ? 'page' : undefined}
                className={[
                  'border px-3 py-1.5 font-label text-[0.65rem] tracking-[0.12em] uppercase',
                  name === doc ? 'border-current' : 'border-hairline opacity-60 hover:opacity-100',
                ].join(' ')}
              >
                {legalDocument(name, locale).title}
              </a>
            ))}
          </nav>

          <article data-legal-body className="mt-12 max-w-detail">
            <Markdown source={document.body} />
          </article>

          {/* 전자상거래법 §21 — the seller block, identical under every document. */}
          <section data-business-info className="mt-16 border-t border-hairline pt-8">
            <h2 className="font-label text-label uppercase">{dict.legal.businessHeading}</h2>
            <dl className="mt-5 grid max-w-detail gap-x-8 gap-y-2 font-mono text-[0.8rem] sm:grid-cols-[auto_1fr]">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="opacity-50">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            {/* 전자상거래법 §13 — the escrow enrolment is shown, and the mark opens the bank's own record. */}
            <a
              href={ESCROW.href}
              target="_blank"
              rel="noopener noreferrer"
              data-escrow-mark
              className="mt-6 inline-flex items-center gap-4 opacity-80 transition-opacity hover:opacity-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the bank hosts the mark */}
              <img src={ESCROW.mark} alt={`${ESCROW.service} 인증마크`} width={60} height={60} />
              <span className="max-w-[26rem] font-mono text-[0.72rem] leading-relaxed opacity-70">
                {dict.legal.escrowMark}
              </span>
            </a>
          </section>
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
