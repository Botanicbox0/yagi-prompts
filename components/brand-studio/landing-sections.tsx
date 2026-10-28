import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { AssetTabs, LoopVideo } from './landing-interactive';
import { StudioVto } from './studio-vto';
import styles from './landing.module.css';

/**
 * The brand landing, v5 (2026-10-29 founder review): one promise, two proofs, a quiet third offer.
 * Hero → why it is not generic AI → asset studio → creator campaign → production → closing. The
 * imagery is the colour; every picture on the page is a real output (docs/PLATFORM-2.0.md §20.11).
 */

type Copy = Dictionary['brandLanding']['landing'];
type StudioCopy = Dictionary['brandLanding']['studio'];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Landing media lives in /reel/landing/; campaign films stay where the case pages already use them. */
const L = (name: string, ext = 'webp') => `/reel/landing/${name}.${ext}`;

/** The eight products of the demo family, in the order the copy names them. */
const PRODUCTS = ['parfum', 'blush', 'oil', 'compact', 'lipoil', 'serum', 'mist', 'balm'] as const;
/** Each product's vessel colour (the trend brief's hexes), shown as the brand kit palette. */
const PALETTE = ['#C98A3D', '#E2B3A8', '#5B5752', '#EDE4D3', '#6B1E44', '#B7C4A6', '#F2F0EC', '#B3141E'] as const;

function Head({ eyebrow, title, body, status }: { eyebrow: string; title: string; body: string; status?: ReactNode }) {
  return (
    <div className={styles.headSplit}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>{eyebrow}{status}</p>
        <h2 className={`${styles.title} ${styles.h2}`}>{title}</h2>
      </div>
      <p className={styles.body}>{body}</p>
    </div>
  );
}

export function LandingHero({ copy, locale }: { copy: Copy; locale: Locale }) {
  const h = copy.hero;
  const outputs = [
    { area: 'shot', src: L('hero-shot'), label: h.outputs[0] },
    { area: 'tex', src: L('hero-texture'), label: h.outputs[1] },
    { area: 'hand', src: L('hero-hand'), label: h.outputs[2] },
    { area: 'model', src: L('hero-model'), label: h.outputs[3] },
  ] as const;
  return (
    <section data-section data-theme="light" data-campaign-hero data-studio-hero className={styles.hero}>
      <div className="audience-shell">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{h.eyebrow}</p>
          <h1 className={`${styles.title} ${styles.h1}`}>{h.title}</h1>
          <p className={styles.body}>{h.body}</p>
          <div className={`${styles.actions} justify-center`}>
            <a data-inquiry-trigger href={brandEnquiryHref(locale)} className={styles.cta}>{h.cta}</a>
            <a href="#campaign" className={styles.link}>{h.secondary}</a>
          </div>
        </div>

        {/* The moat in one frame: the uploaded photo stays fixed while everything around it is made from it. */}
        <div data-hero-grid className={styles.heroGrid}>
          <figure data-hero-lock className={styles.heroLock}>
            <div className={styles.tile}>
              <img src={L('hero-input')} alt={h.inputAlt} width={900} height={900} fetchPriority="high" decoding="async" />
            </div>
            <figcaption className={styles.lockMeta}>
              <span>{h.input}</span>
              <span><span aria-hidden="true" className={styles.liveDot} />{h.lock}</span>
            </figcaption>
          </figure>
          {outputs.map((output, index) => (
            <figure key={output.area} data-hero-output={output.area} data-area={output.area} className={`${styles.tile} ${styles.heroOut}`} style={{ '--i': index } as Vars}>
              <img src={output.src} alt="" width={900} height={1125} decoding="async" />
              <figcaption className={styles.tileLabel}>{output.label} <em>{h.image}</em></figcaption>
            </figure>
          ))}
          <figure data-hero-output="video" className={`${styles.tile} ${styles.heroOut} ${styles.heroVideo}`} style={{ '--i': outputs.length } as Vars}>
            <LoopVideo src={L('beauty-ad', 'mp4')} poster={L('beauty-ad', 'jpg')} label={h.outputs[4]} />
            <figcaption className={styles.tileLabel}>{h.outputs[4]} <em>{h.video}</em></figcaption>
          </figure>
        </div>
        <p data-hero-proof className={styles.heroProof}><strong>{h.proof}</strong><span>{h.proofFigures}</span></p>
        <p className={`${styles.note} ${styles.heroNote}`}>{h.note}</p>
      </div>
    </section>
  );
}

/** Same product, same engine: what plain generation returned next to the TWINGS result. */
const PAIRS = [['c-logo-raw', 'c-logo-ours'], ['c-skin-raw', 'c-skin-ours'], ['c-light-raw', 'c-light-ours']] as const;

export function LandingContrast({ copy }: { copy: Copy }) {
  const c = copy.contrast;
  return (
    <section id="why" data-section data-theme="light" data-studio-contrast className={`${styles.section} ${styles.surface}`}>
      <div className="audience-shell">
        <Head eyebrow={c.eyebrow} title={c.title} body={c.body} />
        <div className={styles.pairs}>
          {c.pairs.map((pair, index) => (
            <article key={pair.label} data-contrast-pair className={styles.pair}>
              <h3 className={styles.pairLabel}>{pair.label}</h3>
              <div className={styles.pairMedia}>
                <figure className={styles.pairRaw}>
                  <div className={styles.tile}><img src={L(PAIRS[index]![0])} alt={`${c.raw}: ${pair.raw}`} width={640} height={640} loading="lazy" decoding="async" /></div>
                  <figcaption><b>{c.raw}</b>{pair.raw}</figcaption>
                </figure>
                <figure>
                  <div className={styles.tile}><img src={L(PAIRS[index]![1])} alt={`${c.ours}: ${pair.ours}`} width={640} height={640} loading="lazy" decoding="async" /></div>
                  <figcaption><b>{c.ours}</b>{pair.ours}</figcaption>
                </figure>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.pillars}>
          {c.pillars.map((pillar) => (
            <div key={pillar.title} data-contrast-pillar className={styles.pillar}>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const CLIPS = ['parfum', 'mist', 'oil'] as const;

export function LandingAssets({ copy, studio }: { copy: Copy; studio: StudioCopy }) {
  const a = copy.assets;
  const scenes = (
    <Fragment key="scenes">
      <p className={styles.panelNote}>{a.tabNotes[0]}</p>
      <ul className={styles.scenes}>
        {PRODUCTS.map((key, index) => (
          <li key={key} data-asset-scene={key} className={styles.tile}>
            <img src={L(`sc-${key}`)} alt="" width={900} height={1125} loading="lazy" decoding="async" />
            <span className={styles.tileLabel}>{a.products[index]}</span>
          </li>
        ))}
      </ul>
    </Fragment>
  );
  const tryOn = (
    <div key="try-on" data-studio-vto>
      <p className={styles.panelNote}><span data-early-access="beta" className={`${styles.statusTag} mr-2`}>{studio.beta}</span>{a.tabNotes[1]}</p>
      <StudioVto copy={studio} />
    </div>
  );
  const video = (
    <Fragment key="video">
      <p className={styles.panelNote}>{a.tabNotes[2]}</p>
      <div className={styles.clips}>
        {CLIPS.map((key, index) => (
          <figure key={key} data-asset-clip={key} className={styles.tile}>
            <LoopVideo src={L(`clip-${key}`, 'mp4')} poster={L(`sc-${key}`)} label={a.clipLabels[index]!} />
            <figcaption className={styles.tileLabel}>{a.clipLabels[index]}</figcaption>
          </figure>
        ))}
        <figure data-asset-clip="ad" className={`${styles.tile} ${styles.clipWide}`}>
          <LoopVideo src={L('beauty-ad', 'mp4')} poster={L('beauty-ad', 'jpg')} label={a.clipLabels[3]!} />
          <figcaption className={styles.tileLabel}>{a.clipLabels[3]}</figcaption>
        </figure>
      </div>
    </Fragment>
  );
  return (
    <section id="assets" data-section data-theme="light" data-studio-assets className={styles.section}>
      <div className="audience-shell">
        <Head eyebrow={a.eyebrow} status={<span data-early-access="early" className={styles.statusTag}>{a.early}</span>} title={a.title} body={a.body} />
        <div className={styles.studio}>
          <aside data-brand-kit className={styles.kit}>
            <p className={styles.kitTitle}>{a.kitTitle}</p>
            <div className={styles.kitRow}>
              <span className={styles.kitLabel}>{a.kitMark}</span>
              <div className={styles.kitMark}><img src="/brand/yagi-mark-black.png" alt="" width={44} height={44} /><span>YAGI</span></div>
            </div>
            <div className={styles.kitRow}>
              <span className={styles.kitLabel}>{a.kitPalette}</span>
              <div aria-hidden="true" className={styles.swatches}>{PALETTE.map((hex) => <span key={hex} style={{ background: hex }} />)}</div>
            </div>
            <div className={styles.kitRow}>
              <span className={styles.kitLabel}>{a.kitRules}</span>
              <ul data-hard-rules className={styles.rules}>{a.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </div>
          </aside>
          <div className={styles.panel}>
            <div data-product-range className={styles.range}>
              <p className={styles.rangeHead}><span>{a.range}</span></p>
              <ul className={styles.rangeRow}>
                {PRODUCTS.map((key, index) => (
                  <li key={key} data-range-product={key} className={styles.rangeItem}>
                    <div className={styles.tile}><img src={L(`pk-${key}`)} alt={a.products[index]} width={720} height={900} loading="lazy" decoding="async" /></div>
                    <span>{a.products[index]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <AssetTabs labels={a.tabs} panels={[scenes, tryOn, video]} />
            <p className={styles.note}>{a.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Two formats, each shown with two faces, plus two more creator-style posts. */
const MOSAIC = [
  { id: 'retro-01', src: '/reel/campaigns/retro-phone-01', pair: true },
  { id: 'retro-02', src: '/reel/campaigns/retro-phone-02', pair: true },
  { id: 'peach', src: '/reel/landing/yunseol-peach', pair: false },
  { id: 'y2k', src: '/reel/brands/y2k-flip-phone', pair: false },
] as const;

type Trust = Dictionary['brandLanding']['scalePillars'];

export function LandingCampaign({ copy, trust, children }: { copy: Copy; trust: Trust; children: ReactNode }) {
  const c = copy.campaign;
  const pillars = [[trust.networkValue, trust.networkLabel], [trust.shootsValue, trust.shootsLabel], [trust.complianceValue, trust.complianceLabel]] as const;
  return (
    <section id="campaign" data-section data-theme="light" data-campaign-scale className={`scroll-mt-20 ${styles.section} ${styles.surface}`}>
      <div className="audience-shell">
        <Head eyebrow={c.eyebrow} status={<span data-early-access="live" className={styles.statusTag}>{c.live}</span>} title={c.title} body={c.body} />
        <ul data-studio-feed className={styles.mosaic}>
          {MOSAIC.map((item) => (
            <li key={item.id} data-feed-post={item.id}>
              <div className={styles.tile}>
                <LoopVideo src={`${item.src}.mp4`} poster={`${item.src}.jpg`} label={item.pair ? c.sameFormat : c.virtual} />
                <span className={styles.tileLabel}>{item.pair ? c.sameFormat : c.virtual}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className={`${styles.note} mt-3`}>{c.note}</p>
        {/* Faces and data: the same three promises the campaign service has always made. */}
        <div data-brand-scale-pillars className={styles.trust}>
          <p className={styles.eyebrow}>{trust.eyebrow}</p>
          <dl className={styles.trustRow}>
            {pillars.map(([value, label]) => (
              <div key={value}><dt>{value}</dt><dd>{label}</dd></div>
            ))}
          </dl>
        </div>
        <div className="mt-16">{children}</div>
      </div>
    </section>
  );
}

export function LandingProduction({ copy, films, actions }: { copy: Copy; films: ReactNode; actions: ReactNode }) {
  const p = copy.production;
  return (
    <section data-section data-theme="light" data-production-service className={styles.sectionTight}>
      <div className={`audience-shell ${styles.production}`}>
        <div className="grid gap-5">
          <p className={styles.eyebrow}>{p.eyebrow}</p>
          <h2 className={`${styles.title} ${styles.h2}`}>{p.title}</h2>
          <p className={styles.body}>{p.body}</p>
          {actions}
        </div>
        <div data-production-films>{films}</div>
      </div>
    </section>
  );
}

export function LandingClosing({ copy, locale, children }: { copy: Copy; locale: Locale; children: ReactNode }) {
  const c = copy.closing;
  return (
    <section id="brands" data-section data-theme="light" data-brands className={`scroll-mt-24 ${styles.section} ${styles.surface}`}>
      <div className={`audience-shell ${styles.closing}`}>
        <div className="grid gap-5">
          <h2 className={`${styles.title} ${styles.h2}`}>{c.title}</h2>
          <p className={styles.body}>{c.body}</p>
        </div>
        <div className={styles.actions}>
          <a data-inquiry-trigger href={brandEnquiryHref(locale)} className={styles.cta}>{copy.hero.cta}</a>
        </div>
        {children}
      </div>
    </section>
  );
}
