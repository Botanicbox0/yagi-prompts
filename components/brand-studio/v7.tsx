import type { CSSProperties, ReactNode } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { landingSrc, type LandingMedia } from '@/lib/content/landing-media';
import { Compare, ChapterScene, EngineSwitch, Film, PinnedTrack, Reveal, Tabs, Track, TypeLine } from './v7-client';
import { StudioVto } from './studio-vto';
import s from './v7.module.css';

/**
 * Brand landing v7 (2026-10-30 founder brief): "the creative platform that starts from your brand".
 * A studio that makes AI campaigns for global brands turned its working method into a platform, so the page
 * runs problem → brand first (hardlines, memory, one-line direction) → the real workflow → the work →
 * creator scale → production and what comes next. Screens fill the viewport, long runs go sideways
 * (tracks) or pin (the chapter scene), and every picture is a real output (docs/PLATFORM-2.0.md §21).
 * Colour, type and motion come from lib/design/identity.ts via the `.identity` wrapper.
 */

type Copy = Dictionary['brandLanding']['v7'];
type StudioCopy = Dictionary['brandLanding']['studio'];
/** Images the founder replaced in /admin/landing-media (#116); a slot that is absent shows its file. */
type Media = { media?: LandingMedia };

/** v7 media lives in /reel/landing/v7/; the product family and pairs stay where v5/v6 put them. */
const V = (name: string, ext = 'webp') => `/reel/landing/v7/${name}.${ext}`;
const L = (name: string, ext = 'webp') => `/reel/landing/${name}.${ext}`;

const PRODUCTS = ['parfum', 'blush', 'oil', 'compact', 'lipoil', 'serum', 'mist', 'balm'] as const;
const PAIRS = ['logo', 'skin', 'light'] as const;
/** YAGI's demo palette in the blue-world campaign: frost, sky, powder, slate, ink. */
const YAGI_PALETTE = ['#f4f6f8', '#dfe8f2', '#a9c4de', '#3a4a5e', '#0e1013'] as const;
const DOORS = ['work', 'campaign', 'production'] as const;
/** The fictional demo brand's site in the hardline chapter (an example domain, never a real one). */
const DEMO_SITE = 'yagi.example';
const RATIOS = ['9:16', '4:5', '16:9'] as const;
/** Product shots turned into 5-second clips (the work tab's first row of video). */
const CLIPS = ['parfum', 'mist', 'oil'] as const;
/** YAGI Production's own films (fictional casts), each at its own ratio. No client work: its posters carry real names. */
const FILMS = [
  { id: 'tutu', src: V('film-tutu', 'mp4'), poster: V('film-tutu', 'jpg'), ratio: '16 / 9' },
  { id: 'daydream', src: V('film-daydream', 'mp4'), poster: V('film-daydream', 'jpg'), ratio: '4 / 3' },
  { id: 'aquarium', src: V('film-aquarium', 'mp4'), poster: V('film-aquarium', 'jpg'), ratio: '4 / 3' },
  { id: 'tea', src: '/reel/brands/tea-editorial.mp4', poster: V('film-tea', 'jpg'), ratio: '16 / 9' },
] as const;
/** Creator-style posts made with fictional people, warm and cool in turn (the real Morphic case follows below). */
const FEED = [
  { id: 'peach', src: '/reel/landing/yunseol-peach' },
  { id: 'retro-01', src: '/reel/campaigns/retro-phone-01' },
  { id: 'blue', src: '/reel/landing/v7/beauty' },
  { id: 'y2k', src: '/reel/brands/y2k-flip-phone' },
] as const;

function Eyebrow({ children, status, tone = 'soon' }: { children: ReactNode; status?: string; tone?: 'soon' | 'live' }) {
  return (
    <p className={s.eyebrow}>
      <span className={s.eyebrowMark} aria-hidden="true" />
      {children}
      {status ? <span data-status={tone} className={s.status}>{status}</span> : null}
    </p>
  );
}

export function V7Hero({ copy, locale }: { copy: Copy; locale: Locale }) {
  const h = copy.hero;
  return (
    <section data-v7-hero data-campaign-hero data-section data-theme="light" className={s.hero}>
      <div className={s.heroFrame} data-hero-film>
        <Film className={s.heroFilm} src={V('hero', 'mp4')} poster={V('hero', 'jpg')} label={h.filmLabel} eager />
        <div className={s.heroScrim} aria-hidden="true" />
        <div className={s.heroCopy}>
          <Eyebrow>{h.eyebrow}</Eyebrow>
          <h1 className={s.display}>{h.title}</h1>
          <p className={s.lead}>{h.body}</p>
          <div className={s.actions}>
            <a data-inquiry-trigger href={brandEnquiryHref(locale)} className={s.cta}>{h.cta}</a>
            <a href="#work" className={s.ghost}>{h.secondary}</a>
          </div>
        </div>
        <span className={s.crosshairs} aria-hidden="true" />
      </div>
      <nav aria-label={h.eyebrow} data-hero-doors className={s.doors}>
        {h.doors.map((door, index) => (
          <a key={DOORS[index]} href={`#${DOORS[index]}`} data-hero-door={DOORS[index]} className={s.door}>
            <span className={s.mono}>{String(index + 1).padStart(2, '0')}</span>
            <strong>{door.title}</strong>
            <span>{door.body}</span>
            <i aria-hidden="true">↓</i>
          </a>
        ))}
      </nav>
    </section>
  );
}

export function V7Problem({ copy, media }: { copy: Copy } & Media) {
  const p = copy.problem;
  const pairs = PAIRS.map((id, index) => ({
    id,
    raw: landingSrc(media, `c-${id}-raw`),
    ours: landingSrc(media, `c-${id}-ours`),
    chip: p.pairs[index]!.chip,
    note: p.pairs[index]!.note,
    alt: [p.pairs[index]!.raw, p.pairs[index]!.ours] as [string, string],
  }));
  return (
    <section data-v7-problem data-section data-theme="light" className={s.section}>
      <div className={`${s.shell} ${s.split}`}>
        <Reveal className={s.head}>
          <Eyebrow>{p.eyebrow}</Eyebrow>
          <h2 className={s.h2}>{p.title}</h2>
          <p className={s.lead}>{p.body}</p>
          <p className={`${s.note} ${s.mono}`}>{p.caption}</p>
        </Reveal>
        <Reveal className={s.compareCol} data-contrast>
          <Compare pairs={pairs} labels={{ raw: p.raw, ours: 'TWINGS', hint: p.hint, slider: p.slider }} />
        </Reveal>
      </div>
    </section>
  );
}

function KitStage({ copy }: { copy: Copy }) {
  const k = copy.first.kit;
  return (
    <div className={s.card} data-stage="kit">
      <div className={s.urlBar}>
        <span className={s.urlDot} aria-hidden="true" />
        <TypeLine text={DEMO_SITE} className={s.mono} />
        <span className={s.urlStatus}>{k.reading}</span>
      </div>
      <dl className={s.kit}>
        <div className={s.kitRow}>
          <dt>{k.mark}</dt>
          <dd className={s.kitMark}><img src="/brand/yagi-mark-black.png" alt="" width={40} height={40} /><span>YAGI</span></dd>
        </div>
        <div className={s.kitRow}>
          <dt>{k.palette}</dt>
          <dd className={s.swatches}>
            {YAGI_PALETTE.map((hex) => <span key={hex}><i style={{ background: hex }} /><em className={s.mono}>{hex.toUpperCase()}</em></span>)}
          </dd>
        </div>
        <div className={s.kitRow}>
          <dt>{k.type}</dt>
          <dd>{k.typeValue}</dd>
        </div>
        <div className={s.kitRow}>
          <dt>{k.rules}</dt>
          <dd><ul data-hard-rules className={s.rules}>{k.ruleItems.map((rule) => <li key={rule}>{rule}</li>)}</ul></dd>
        </div>
      </dl>
      <p className={s.cardFoot}><span className={s.mono}>{k.draft}</span><span>{k.example}</span></p>
    </div>
  );
}

function MemoryStage({ copy, media }: { copy: Copy } & Media) {
  const m = copy.first.memory;
  const shots = [V('dir-1'), landingSrc(media, 'sc-mist'), V('beauty'), landingSrc(media, 'sc-serum'), V('dir-3'), landingSrc(media, 'sc-parfum')];
  return (
    <div className={s.card} data-stage="memory">
      <div className={s.cardHead}>
        <strong>{m.title}</strong>
        <span className={s.campaigns}>{m.campaigns.map((c, i) => <span key={c} data-current={i === m.campaigns.length - 1 ? 'true' : undefined}>{c}</span>)}</span>
      </div>
      <ul className={s.memoryGrid}>
        {shots.map((src, index) => (
          <li key={src} className={s.memoryShot}>
            <img src={src} alt="" width={300} height={400} loading="lazy" decoding="async" />
            <span className={s.approved}>✓ {m.approved}</span>
            {m.notes[index] ? <span className={`${s.memoryNote} ${s.mono}`}>{m.notes[index]}</span> : null}
          </li>
        ))}
      </ul>
      <p className={s.cardFoot}>
        <span className={s.look} aria-hidden="true" />
        <span>{m.look}</span>
      </p>
    </div>
  );
}

function DirectionStage({ copy }: { copy: Copy }) {
  const d = copy.first.direction;
  return (
    <div className={s.card} data-stage="direction">
      <div className={s.prompt}><span className={s.promptIcon} aria-hidden="true">↳</span><TypeLine text={d.prompt} /></div>
      <div className={s.brief}>
        <span className={s.briefLabel}>{d.brief}</span>
        <ul className={s.spec}>{d.spec.map((item) => <li key={item} className={s.mono}>{item}</li>)}</ul>
      </div>
      <ul className={s.outputs} aria-label={d.outputs}>
        <li><img src={V('dir-1')} alt="" width={600} height={800} loading="lazy" decoding="async" /></li>
        <li><Film src={V('dir-2', 'mp4')} poster={V('dir-2', 'jpg')} label={d.clip} /></li>
        <li><img src={V('dir-3')} alt="" width={600} height={800} loading="lazy" decoding="async" /></li>
      </ul>
      <p className={s.cardFoot}><span>{d.outputs}</span></p>
    </div>
  );
}

export function V7BrandFirst({ copy, media }: { copy: Copy } & Media) {
  const f = copy.first;
  const chapters = f.chapters.map((chapter, index) => (
    <div key={chapter.label} data-chapter={index} className={s.chapter}>
      <p className={s.chapterLabel}>
        <span className={s.mono}>{String(index + 1).padStart(2, '0')}</span>
        {chapter.label}
        {/* The hardline pass already runs in studio work; memory and one-line direction are coming. */}
        <span data-status={index === 0 ? 'live' : 'soon'} className={s.status}>{chapter.status}</span>
      </p>
      <h3 className={s.h3}>{chapter.title}</h3>
      <p className={s.body}>{chapter.body}</p>
    </div>
  ));
  const stages = [<KitStage key="kit" copy={copy} />, <MemoryStage key="memory" copy={copy} media={media} />, <DirectionStage key="direction" copy={copy} />];
  const e = f.engine;
  const outputs = [
    { ratio: '3 / 4', media: <img src={V('dir-1')} alt="" width={900} height={1200} loading="lazy" decoding="async" /> },
    { ratio: '9 / 16', media: <Film src={V('beauty', 'mp4')} poster={V('beauty', 'jpg')} label={copy.closing.filmLabel} /> },
    { ratio: '4 / 5', media: <img src={V('dir-3')} alt="" width={900} height={1200} loading="lazy" decoding="async" /> },
  ];
  return (
    <section id="how" data-v7-first data-section data-theme="light" className={`${s.section} ${s.sky}`}>
      <div className={s.shell}>
        <Reveal className={s.head}>
          <Eyebrow>{f.eyebrow}</Eyebrow>
          <h2 className={s.h2}>{f.title}</h2>
          <p className={s.lead}>{f.body}</p>
        </Reveal>
        <Reveal>
          <EngineSwitch fixed={e.fixed} fixedItems={e.fixedItems} changes={e.changes} changeItems={e.changeItems} output={e.output} note={e.note} outputs={outputs} />
        </Reveal>
        <div className={s.layerHead}>
          <h3 className={s.h3}>{f.layerTitle}</h3>
          <p className={s.note}>{f.studio}</p>
        </div>
        <ChapterScene chapters={chapters} stages={stages} />
      </div>
    </section>
  );
}

function StepArtifact({ index, copy }: { index: number; copy: Copy }) {
  const w = copy.workflow;
  if (index === 0) {
    const spec = ['85mm · f/4', '↘ 10시 방향'.replace('10시 방향', w.analysis[1]!), '#3A4A5E', '#EEF3F8'];
    return (
      <div className={s.artifact}>
        <img src={V('dir-1')} alt="" width={600} height={800} loading="lazy" decoding="async" />
        <span className={s.lightRay} aria-hidden="true" />
        <ul className={s.readout}>{w.analysis.map((label, i) => <li key={label}><span>{label}</span><b className={s.mono}>{spec[i]}</b></li>)}</ul>
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className={`${s.artifact} ${s.artifactPair}`}>
        <figure><img src={V('model-a')} alt="" width={400} height={533} loading="lazy" decoding="async" /><figcaption className={s.mono}>{w.modelA}</figcaption></figure>
        <figure><img src={V('model-b')} alt="" width={400} height={533} loading="lazy" decoding="async" /><figcaption className={s.mono}>{w.modelB}</figcaption></figure>
        <p className={`${s.artifactNote} ${s.mono}`}>{w.modelNote}</p>
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className={s.artifact}>
        <img src={V('check')} alt="" width={600} height={800} loading="lazy" decoding="async" />
        <span className={s.checkBox} aria-hidden="true" />
        <ul className={s.checks}>{w.checks.map((label) => <li key={label}><span>{label}</span><b>{w.pass}</b></li>)}</ul>
      </div>
    );
  }
  if (index === 3) {
    return (
      <div className={s.artifact}>
        <img src={V('check')} alt="" width={600} height={800} loading="lazy" decoding="async" />
        <span className={s.brush} aria-hidden="true" />
        <span className={`${s.artifactNote} ${s.mono}`}>{w.fix}</span>
      </div>
    );
  }
  if (index === 4) {
    return (
      <div className={s.artifact}>
        <Film src={V('dir-2', 'mp4')} poster={V('dir-2', 'jpg')} label={copy.first.direction.clip} />
        <span className={`${s.badge} ${s.mono}`}>00:05</span>
      </div>
    );
  }
  return (
    <div className={s.artifact}>
      <img src={V('dir-3')} alt="" width={600} height={800} loading="lazy" decoding="async" />
      <span className={s.ratios} aria-hidden="true">{RATIOS.map((ratio) => <i key={ratio} data-ratio={ratio}><em className={s.mono}>{ratio}</em></i>)}</span>
    </div>
  );
}

export function V7Workflow({ copy }: { copy: Copy }) {
  const w = copy.workflow;
  const header = (
    <div className={s.shell}>
      <Reveal className={`${s.head} ${s.headRow}`}>
        <div>
          <Eyebrow>{w.eyebrow}</Eyebrow>
          <h2 className={s.h2}>{w.title}</h2>
        </div>
        <p className={s.lead}>{w.body}</p>
      </Reveal>
    </div>
  );
  return (
    <section data-v7-workflow data-section data-theme="light" className={`${s.section} ${s.workflow}`}>
      <PinnedTrack label={w.track} prev={w.prev} next={w.next} header={header}>
        {w.steps.map((step, index) => (
          <article key={step.title} data-track-item data-workflow-step={index} className={s.step}>
            <StepArtifact index={index} copy={copy} />
            <div className={s.stepText}>
              <span className={s.mono}>{String(index + 1).padStart(2, '0')}</span>
              <h3 className={s.h4}>{step.title}</h3>
              <p className={s.body}>{step.body}</p>
            </div>
          </article>
        ))}
      </PinnedTrack>
    </section>
  );
}

export function V7Work({ copy, studio, media }: { copy: Copy; studio: StudioCopy } & Media) {
  const w = copy.work;
  const range = (
    <div key="range">
      <p className={s.note}>{w.notes[0]}</p>
      <ul data-product-range className={s.range}>
        {PRODUCTS.map((key) => (
          <li key={key} data-range-product={key} className={s.rangeItem}>
            <img src={landingSrc(media, `pk-${key}`)} alt="" width={720} height={900} loading="lazy" decoding="async" />
          </li>
        ))}
      </ul>
    </div>
  );
  const scenes = (
    <div key="scenes">
      <p className={s.note}>{w.notes[1]}</p>
      <ul className={s.scenes}>
        {PRODUCTS.map((key) => (
          <li key={key} data-asset-scene={key} className={s.sceneTile}>
            <img src={landingSrc(media, `sc-${key}`)} alt="" width={900} height={1125} loading="lazy" decoding="async" />
          </li>
        ))}
      </ul>
    </div>
  );
  const tryOn = (
    <div key="try-on" data-studio-vto>
      <p className={s.note}>{w.notes[2]}</p>
      <StudioVto copy={studio} media={media} />
    </div>
  );
  const ads = (
    <div key="ads">
      <p className={s.note}>{w.notes[3]}</p>
      <ul className={s.clips}>
        {CLIPS.map((key) => (
          <li key={key} data-asset-clip={key} className={s.clip}>
            <Film src={L(`clip-${key}`, 'mp4')} poster={L(`sc-${key}`)} label={w.clipLabel} />
            <span className={s.tag}>{w.clipLabel}</span>
          </li>
        ))}
      </ul>
      <div className={s.ads}>
        {[
          { id: 'highteen', still: L('highteen-product'), film: '/reel/campaigns/highteen.mp4', poster: '/reel/campaigns/highteen.jpg' },
          { id: 'ad', still: L('beauty-ad-product'), film: L('beauty-ad', 'mp4'), poster: L('beauty-ad', 'jpg') },
        ].map((ad, index) => (
          <div key={ad.id} data-asset-ad={ad.id} className={s.adPair}>
            <figure data-asset-ad-still className={s.adStill}>
              <img src={ad.still} alt="" width={900} height={1200} loading="lazy" decoding="async" />
              <figcaption className={s.tag}>{w.adStill}</figcaption>
            </figure>
            <span aria-hidden="true" className={s.adArrow}>→</span>
            <figure data-asset-clip={ad.id} className={s.adFilm}>
              <Film src={ad.film} poster={ad.poster} label={w.adLabels[index]!} />
              <figcaption className={s.tag}>{w.adLabels[index]}</figcaption>
            </figure>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <section id="work" data-v7-work data-section data-theme="light" data-studio-assets className={`${s.section} scroll-mt-20`}>
      <div className={s.shell}>
        <Reveal className={s.head}>
          <Eyebrow status={w.early}>{w.eyebrow}</Eyebrow>
          <h2 className={s.h2}>{w.title}</h2>
        </Reveal>
        <Tabs name="work" labels={w.tabs} panels={[range, scenes, tryOn, ads]} />
        <p className={`${s.note} mt-6`}>{w.note}</p>
      </div>
    </section>
  );
}

export function V7Campaign({ copy, locale }: { copy: Copy; locale: Locale }) {
  const c = copy.campaign;
  const proof = c.proof;
  return (
    <section id="campaign" data-v7-campaign data-section data-theme="light" data-campaign-scale className={`${s.section} ${s.canvas} scroll-mt-20`}>
      <div className={s.shell}>
        <Reveal className={`${s.head} ${s.headRow}`}>
          <div>
            <Eyebrow status={c.live} tone="live">{c.eyebrow}</Eyebrow>
            <h2 className={s.h2}>{c.title}</h2>
          </div>
          {/* The body names the two markets the campaign runs in at once (Korea and Japan). */}
          <div className={s.headAside} data-brand-markets>
            <p className={s.lead}>{c.body}</p>
            <p className={s.note}>{c.consent}</p>
          </div>
        </Reveal>
        <ul data-studio-feed className={s.feed}>
          {FEED.map((item) => (
            <li key={item.id} data-feed-post={item.id} className={s.feedItem}>
              <Film src={`${item.src}.mp4`} poster={`${item.src}.jpg`} label={c.virtual} />
              <span className={s.tag}>{c.virtual}</span>
            </li>
          ))}
        </ul>
        {/* The real case, in one card: the approved figures and a door to the full story page. */}
        <Reveal className={`${s.proofCard} scroll-mt-20`} data-campaign-proof data-morphic-card>
          <div id="morphic-case" className={s.proofHead}>
            <Eyebrow>{proof.eyebrow}</Eyebrow>
            <h3 className={s.h3}>{proof.title}</h3>
            <p className={s.note}>{proof.note}</p>
          </div>
          <ul className={s.figures}>
            {proof.figures.map((figure) => <li key={figure.label}><b>{figure.value}</b><span>{figure.label}</span></li>)}
          </ul>
          <a href={`/${locale}/brands/stories/morphic`} className={s.ghost}>{proof.cta} ↗</a>
        </Reveal>
      </div>
    </section>
  );
}

export function V7Production({ copy, actions }: { copy: Copy; actions: ReactNode }) {
  const p = copy.production;
  return (
    <section id="production" data-v7-production data-section data-theme="light" data-production-service className={`${s.section} scroll-mt-20`}>
      <div className={s.shell}>
        <Reveal className={`${s.head} ${s.headRow}`}>
          <div>
            <Eyebrow>{p.eyebrow}</Eyebrow>
            <h2 className={s.h2}>{p.title}</h2>
          </div>
          <div className={s.headAside}>
            <p className={s.lead}>{p.body}</p>
            {actions}
          </div>
        </Reveal>
      </div>
      <div data-production-films className={s.reel}>
        <Track label={p.reel} prev={p.prev} next={p.next2} className={s.shellBleed}>
          {FILMS.map((film, index) => (
            <figure key={film.id} data-track-item data-production-film={film.id} className={s.reelCard} style={{ '--ar': film.ratio } as CSSProperties}>
              <Film src={film.src} poster={film.poster} label={p.films[index]!} />
              <figcaption className={s.tag}>{p.films[index]}</figcaption>
            </figure>
          ))}
        </Track>
      </div>
      <div className={s.shell}>
        <p className={`${s.note} mt-4`}>{p.reelNote}</p>
        <aside data-v7-next className={s.next}>
          <p className={s.nextTitle}>{p.nextTitle}</p>
          <ul>{p.next.map((item, index) => <li key={item}><span className={s.mono}>{String(index + 1).padStart(2, '0')}</span>{item}<span data-status="soon" className={s.status}>{p.soon}</span></li>)}</ul>
        </aside>
      </div>
    </section>
  );
}

export function V7Closing({ copy, locale, children }: { copy: Copy; locale: Locale; children?: ReactNode }) {
  const c = copy.closing;
  return (
    <section id="brands" data-v7-closing data-brands data-section data-theme="dark" className={`${s.closing} scroll-mt-24`}>
      <div className={s.closingFrame}>
        <div className={s.closingCopy}>
          <Eyebrow>{c.eyebrow}</Eyebrow>
          <h2 className={s.display}>{c.title}</h2>
          <p className={s.lead}>{c.body}</p>
          <div className={s.actions}>
            <a data-inquiry-trigger href={brandEnquiryHref(locale)} className={s.cta}>{c.cta}</a>
          </div>
        </div>
        <figure className={s.closingMedia}>
          <Film src={V('beauty', 'mp4')} poster={V('beauty', 'jpg')} label={c.filmLabel} />
        </figure>
      </div>
      {children}
    </section>
  );
}
