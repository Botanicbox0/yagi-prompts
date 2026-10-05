import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { BUSINESS, businessFooterLines } from '@/lib/legal/documents';
import { brandEnquiryHref, brandWorkspaceHref } from '@/lib/campaigns/links';
import { WorkGallery } from '@/components/yagi/work-gallery';
import { FilmPlayer } from '@/components/yagi/film-player';
import { FormatDemo } from '@/components/yagi/format-demo';
import type { Metadata } from 'next';

export const revalidate = 3600;

// The root file-based TWINGS manifest is inherited by Next; clear it at the leaf.
export function generateMetadata(): Metadata { return { manifest: null }; }

export default async function YagiPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const t = dict.yagi;
  const app = `https://twings.app/${locale}`;
  const brief = `https://twings.app${brandEnquiryHref(locale)}`;
  return <>
    <a className="yagi-skip" href="#main">{t.skip}</a>
    <header className="yagi-header" id="top" data-yagi-header>
      <a className="yagi-brand" href={`./${locale}`} aria-label={t.brand}>
        <img src="/yagi/yagi-mark.png" width="2048" height="2048" alt="" /><span translate="no">{t.brand}</span>
      </a>
      <nav aria-label={dict.nav.primary}>
        <a href="#work">{t.nav.work}</a><a href="#approach">{t.nav.approach}</a><a href="#brands">{t.nav.brands}</a>
        <a href="#creators">{t.nav.creators}<span aria-hidden="true">↗</span></a>
      </nav>
      <div className="yagi-header-actions"><div className="yagi-languages" role="group" aria-label={t.nav.language}>
        <a href="./en" lang="en" hrefLang="en" aria-current={locale === 'en' ? 'page' : undefined}>EN</a>
        <a href="./ko" lang="ko" hrefLang="ko" aria-current={locale === 'ko' ? 'page' : undefined}>KO</a>
      </div><a className="yagi-button yagi-button-small" href={brief}>{t.nav.contact}<span aria-hidden="true">↗</span></a></div>
    </header>
    <main id="main">
      <section className="yagi-hero" data-yagi-hero>
        <div className="yagi-hero-top"><p className="yagi-label">{t.eyebrow}</p></div>
        <h1>{t.headline}</h1>
        <div className="yagi-hero-bottom"><p>{t.intro}</p><a className="yagi-text-link" href="#work">{t.viewWork}<span aria-hidden="true">↓</span></a></div>
        <div className="yagi-hero-film"><FilmPlayer src="/reel/campaigns/beauty-rose.mp4" poster="/reel/campaigns/beauty-rose.jpg"
          label={t.work.beauty.title} labels={t} autoplay eager /></div>
        <div className="yagi-film-caption"><span>{t.heroCaption}</span><span aria-hidden="true">{t.brand}</span></div>
      </section>
      <section className="yagi-definition yagi-pad"><p data-service-definition>{t.definition}</p><span aria-hidden="true">↘</span></section>
      <section id="work" className="yagi-pad yagi-work" data-yagi-work-section>
        <div className="yagi-section-head"><p className="yagi-label">{t.workLabel}</p><h2>{t.workTitle}</h2><p>{t.workBody}</p></div>
        <WorkGallery t={t} />
      </section>
      <section id="approach" className="yagi-dark yagi-pad yagi-approach" data-yagi-approach>
        <div className="yagi-section-head"><p className="yagi-label">{t.approachLabel}</p><h2>{t.approachTitle}</h2><p>{t.approachBody}</p></div>
        <div className="yagi-pillars">{Object.values(t.pillars).map(p => <article key={p.title}><h3>{p.title}</h3><p>{p.body}</p></article>)}</div>
        <div className="yagi-demo-heading"><p className="yagi-label">{t.demoLabel}</p><h3>{t.demoTitle}</h3><p>{t.demoBody}</p></div>
        <FormatDemo t={t} />
        <a className="yagi-text-link" href={`${app}/video`}>{t.demoCta}<span aria-hidden="true">↗</span></a>
      </section>
      <section id="brands" className="yagi-pad yagi-brands" data-yagi-brands>
        <div className="yagi-section-head"><p className="yagi-label">{t.brandLabel}</p><h2>{t.brandTitle}</h2><p>{t.brandBody}</p></div>
        <div className="yagi-services">{Object.values(t.services).map((s, i) => <article key={s.title}><span className="yagi-index" aria-hidden="true">0{i + 1}</span><h3>{s.title}</h3><p>{s.body}</p><a href={brief} aria-label={`${s.title}: ${t.briefCta}`} className="yagi-service-arrow">↗</a></article>)}</div>
        <div className="yagi-actions"><a className="yagi-button" href={brief}>{t.briefCta}<span aria-hidden="true">↗</span></a><a className="yagi-text-link" href={brandWorkspaceHref(locale)}>{t.workspaceCta}<span aria-hidden="true">↗</span></a></div>
        <p className="yagi-note">{t.scopeNote}</p>
      </section>
      <section className="yagi-proof yagi-pad" data-yagi-proof><p className="yagi-label">{t.proofLabel}</p><h2>{t.proofTitle}</h2>
        <dl><div><dt>{t.proofVideos}</dt><dd>{dict.campaigns.landing.proofStat1Value}</dd></div><div><dt>{t.proofViews}</dt><dd>{dict.campaigns.landing.proofStat2Value}</dd></div><div><dt>{t.proofOrganic}</dt><dd>{dict.campaigns.landing.proofStat3Value}</dd></div></dl><p className="yagi-note">{t.proofNote}</p>
      </section>
      <section id="creators" className="yagi-pad yagi-creators" data-yagi-creators>
        <div className="yagi-creator-art" aria-hidden="true"><img src="/yagi/twings-mark.png" width="2048" height="2048" alt="" loading="lazy" /><span>{dict.meta.siteName}</span></div>
        <div className="yagi-creator-copy"><p className="yagi-label">{t.creatorLabel}</p><h2>{t.creatorTitle}</h2><p>{t.creatorBody}</p>
          <div className="yagi-actions"><a className="yagi-button" href={`${app}/video`}>{t.creatorMake}<span aria-hidden="true">↗</span></a>
            <a className="yagi-text-link" href={`${app}/campaigns#creators`}>{t.creatorCampaigns}<span aria-hidden="true">↗</span></a></div>
          <p className="yagi-note">{t.creatorNote}</p></div>
      </section>
      <section className="yagi-pad yagi-flow" data-yagi-flow><div className="yagi-section-head"><p className="yagi-label">{t.flowLabel}</p><h2>{t.flowTitle}</h2></div>
        <ol>{Object.values(t.flow).map((step, i) => <li key={step.title}><span aria-hidden="true">0{i + 1}</span><h3>{step.title}</h3><p>{step.body}</p></li>)}</ol>
      </section>
      <section id="faq" className="yagi-pad yagi-faq" data-yagi-faq><h2>{t.faqTitle}</h2><div>{[1, 2, 3, 4].map(n => <details key={n}><summary><h3>{t.faq[`q${n}` as 'q1']}</h3><span aria-hidden="true">+</span></summary><p>{t.faq[`a${n}` as 'a1']}</p></details>)}</div></section>
      <section className="yagi-contact yagi-pad yagi-dark" data-yagi-contact><p className="yagi-label">{t.contactLabel}</p><h2>{t.contactTitle}</h2><div><p>{t.contactBody}</p><a className="yagi-button yagi-button-light" href={`mailto:${BUSINESS.email}`}>{t.emailCta}<span aria-hidden="true">↗</span></a></div><a className="yagi-email" href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a></section>
    </main>
    <footer className="yagi-footer yagi-pad"><a className="yagi-footer-wordmark" href="#top" translate="no">{t.brand}<span aria-hidden="true">↗</span></a><p>{t.footerLine}</p><div className="yagi-footer-bottom"><div>{businessFooterLines(locale).map(line => <p key={line}>{line}</p>)}<p>{t.rights}</p></div><nav aria-label={dict.footer.navHeading}><a href={`${app}/legal/privacy`}>{t.privacy}</a><a href={`${app}/legal/terms`}>{t.terms}</a><a href="#top">{t.backTop} ↑</a></nav></div></footer>
  </>;
}
