import { Fragment, type ReactNode } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { AssetTabs, LoopVideo } from './landing-interactive';
import { StudioVto } from './studio-vto';
import styles from './landing.module.css';

/**
 * The brand landing, v6 (2026-10-29 founder review, after riverflow and magnific): the promise, a film of
 * one product becoming everything, and three doors (studio, campaign, production). Then why it is not
 * generic AI → asset studio → creator campaign → production → closing. Every picture is a real output
 * (docs/PLATFORM-2.0.md §21.11).
 */

type Copy = Dictionary['brandLanding']['landing'];
type StudioCopy = Dictionary['brandLanding']['studio'];

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

/** The hero's three doors, in the order the copy names them; each is a section id on this page. */
const DOORS = ['assets', 'campaign', 'production'] as const;

export function LandingHero({ copy, locale }: { copy: Copy; locale: Locale }) {
  const h = copy.hero;
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

        {/* The moat as a film: one product photo, the brand read and locked, the shots, the ad, the faces. */}
        <figure data-hero-film className={styles.heroFilm}>
          <div className={styles.tile}>
            <LoopVideo src={L(`hero-${locale}`, 'mp4')} poster={L(`hero-${locale}`, 'jpg')} label={h.filmLabel} />
          </div>
          <figcaption className={styles.note}>{h.note}</figcaption>
        </figure>

        <ul data-hero-doors className={styles.doors}>
          {h.doors.map((door, index) => (
            <li key={DOORS[index]} data-hero-door={DOORS[index]}>
              <a href={`#${DOORS[index]}`} className={styles.door}>
                <strong>{door.title}</strong>
                <span>{door.body}</span>
                <i aria-hidden="true">↓</i>
              </a>
            </li>
          ))}
        </ul>
        <p data-hero-proof className={styles.heroProof}><strong>{h.proof}</strong><span>{h.proofFigures}</span></p>
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
/** Each ad film sits next to the product shot it shows (the same bottle, the same tube), so product → film reads as one step. */
const ADS = [
  { id: 'highteen', still: L('highteen-product'), film: '/reel/campaigns/highteen.mp4', poster: '/reel/campaigns/highteen.jpg' },
  { id: 'ad', still: L('beauty-ad-product'), film: L('beauty-ad', 'mp4'), poster: L('beauty-ad', 'jpg') },
] as const;

export function LandingAssets({ copy, studio }: { copy: Copy; studio: StudioCopy }) {
  const a = copy.assets;
  const range = (
    <Fragment key="range">
      <p className={styles.panelNote}>{a.tabNotes[0]}</p>
      <ul data-product-range className={styles.rangeRow}>
        {PRODUCTS.map((key, index) => (
          <li key={key} data-range-product={key} className={styles.rangeItem}>
            <div className={styles.tile}><img src={L(`pk-${key}`)} alt={a.products[index]} width={720} height={900} loading="lazy" decoding="async" /></div>
            <span>{a.products[index]}</span>
          </li>
        ))}
      </ul>
    </Fragment>
  );
  const scenes = (
    <Fragment key="scenes">
      <p className={styles.panelNote}>{a.tabNotes[1]}</p>
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
      <p className={styles.panelNote}><span data-early-access="beta" className={`${styles.statusTag} mr-2`}>{studio.beta}</span>{a.tabNotes[2]}</p>
      <StudioVto copy={studio} />
    </div>
  );
  const video = (
    <Fragment key="video">
      <p className={styles.panelNote}>{a.tabNotes[3]}</p>
      <div className={styles.clips}>
        {CLIPS.map((key, index) => (
          <figure key={key} data-asset-clip={key} className={styles.tile}>
            <LoopVideo src={L(`clip-${key}`, 'mp4')} poster={L(`sc-${key}`)} label={a.clipLabels[index]!} />
            <figcaption className={styles.tileLabel}>{a.clipLabels[index]}</figcaption>
          </figure>
        ))}
        {ADS.map((ad, index) => (
          <div key={ad.id} data-asset-ad={ad.id} className={styles.adPair}>
            <figure data-asset-ad-still className={`${styles.tile} ${styles.adStill}`}>
              <img src={ad.still} alt="" width={900} height={1200} loading="lazy" decoding="async" />
              <figcaption className={styles.tileLabel}>{a.adStill}</figcaption>
            </figure>
            <span aria-hidden="true" className={styles.adArrow}>→</span>
            <figure data-asset-clip={ad.id} className={styles.tile}>
              <LoopVideo src={ad.film} poster={ad.poster} label={a.adLabels[index]!} />
              <figcaption className={styles.tileLabel}>{a.adLabels[index]}</figcaption>
            </figure>
          </div>
        ))}
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
            <AssetTabs labels={a.tabs} panels={[range, scenes, tryOn, video]} />
            <p className={styles.note}>{a.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Creator-style posts made with virtual people; real campaign posts follow in the Morphic case below. */
const MOSAIC = [
  { id: 'retro-01', src: '/reel/campaigns/retro-phone-01' },
  { id: 'retro-02', src: '/reel/campaigns/retro-phone-02' },
  { id: 'peach', src: '/reel/landing/yunseol-peach' },
  { id: 'y2k', src: '/reel/brands/y2k-flip-phone' },
] as const;

type Trust = Dictionary['brandLanding']['scalePillars'];

export function LandingCampaign({ copy, trust, children }: { copy: Copy; trust: Trust; children: ReactNode }) {
  const c = copy.campaign;
  const pillars = [[trust.networkValue, trust.networkLabel], [trust.shootsValue, trust.shootsLabel], [trust.complianceValue, trust.complianceLabel]] as const;
  return (
    <section id="campaign" data-section data-theme="light" data-campaign-scale className={`scroll-mt-20 ${styles.section} ${styles.surface}`}>
      <div className="audience-shell">
        {/* The body names the two markets the campaign runs in at once (Korea and Japan). */}
        <div data-brand-markets>
          <Head eyebrow={c.eyebrow} status={<span data-early-access="live" className={styles.statusTag}>{c.live}</span>} title={c.title} body={c.body} />
        </div>
        <ul data-studio-feed className={styles.mosaic}>
          {MOSAIC.map((item) => (
            <li key={item.id} data-feed-post={item.id}>
              <div className={styles.tile}>
                <LoopVideo src={`${item.src}.mp4`} poster={`${item.src}.jpg`} label={c.virtual} />
                <span className={styles.tileLabel}>{c.virtual}</span>
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
    <section id="production" data-section data-theme="light" data-production-service className={`scroll-mt-20 ${styles.sectionTight}`}>
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
