import type { CSSProperties, ReactNode } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { LANDING_CUTS, LANDING_GRID, landingSrc, studioSrc, type LandingMedia } from '@/lib/content/landing-media';
import { Compare, ChapterScene, Film, HeroFilm, Remix, Reveal, Tabs, Track, TypeLine, type RemixFormat } from './v7-client';
import { StudioVto } from './studio-vto';
import s from './v7.module.css';

/**
 * Brand landing (founder feedback round, 2026-10-30): the brand's own AI media engine. It learns the brand,
 * anyone can direct it at an expert's level, and great formats remix into the brand. Each screen says one
 * thing: hero film → learns your brand → remix → what you get → local fixes → creators → production. Every
 * picture and film is a real output in the blue world of docs/design/IDENTITY.md; the old problem screen and
 * the six-step workflow rail are gone because they did not explain the service.
 */

type Copy = Dictionary['brandLanding']['v7'];
type StudioCopy = Dictionary['brandLanding']['studio'];
/** Images the founder replaced in /admin/landing-media (#116); a slot that is absent shows its file. */
type Media = { media?: LandingMedia };

/** v7 media lives in /reel/landing/v7/; the product family and pairs stay where v5/v6 put them. */
const V = (name: string, ext = 'webp') => `/reel/landing/v7/${name}.${ext}`;
const L = (name: string, ext = 'webp') => `/reel/landing/${name}.${ext}`;

/**
 * The beauty cuts are 16:9 frames the founder passed (2026-11-01). Where a slot shows them at 3:4, this keeps the
 * bottle in the crop.
 */
const CUT_FOCUS: Record<(typeof LANDING_CUTS)[number], string> = { cheek: '77% 50%', hands: '52% 50%', scent: '95% 50%', pump: '21% 50%', beads: '50% 50%', mark: '31% 50%' };
const PAIRS = ['logo', 'garment', 'skin'] as const;
/**
 * Each local fix has its own wide shot (c-*-wide), 1536 x 2048 as generated. The box is in those pixels and the zoomed
 * pair (c-*-raw, c-*-ours) is that region, so replacing a wide shot in /admin/landing-media means moving its box too.
 */
const FIX_SHOT = { width: 1536, height: 2048 };
const FIX_BOXES = { logo: [628, 1140, 220, 220], garment: [320, 810, 640, 640], skin: [360, 138, 471, 471] } as const;
/** YAGI's demo palette: the blue world from lib/design/identity.ts, as a brand kit would hold it. */
const YAGI_PALETTE = ['#f3f7fa', '#d0dbe7', '#3875c5', '#2e5f9f', '#16233f'] as const;
const DOORS = ['work', 'campaign', 'production'] as const;
/** The fictional demo brand's site in the hardline chapter (an example domain, never a real one). */
const DEMO_SITE = 'yagi.example';
/** One quiet spec line over the hero film, following its cuts. Spec sheet language, the same in both locales. */
const HERO_CUES = [
  { at: 0, text: 'Cast 01 / French Blue Muslin / 180mm' },
  { at: 0.63, text: 'Look 02 / White Flare / 85mm' },
  { at: 1.42, text: 'Detail / Crystal Embroidery / Macro' },
  { at: 1.96, text: 'Look 03 / Washed Denim / 85mm' },
  { at: 2.58, text: 'Prop / Keys + Silver Nails / Macro' },
  { at: 3.12, text: 'Split / Face + Boombox' },
  { at: 4.41, text: 'Look 01 / Black Denim / 50mm' },
  { at: 5.12, text: 'Look 03 / Fur Hat / 135mm' },
  { at: 5.58, text: 'Cast / Group of Four / 50mm' },
  { at: 6.25, text: 'Detail / White Denim / 100mm' },
  { at: 6.83, text: 'Look 04 / Platinum + Fur / 85mm' },
  { at: 7.25, text: 'Look 02 / Zip Top / 85mm' },
  { at: 7.75, text: 'Set / Sculpture / 85mm' },
  { at: 8.25, text: 'Look 02 / Full Length / 85mm' },
  { at: 8.96, text: 'Cast 01 / Hand to Lens / 50mm' },
  { at: 9.59, text: 'Look 02 / Light Falling / 85mm' },
  { at: 10.59, text: 'Prop / Boombox + Bangles / 85mm' },
  { at: 11.51, text: 'Cast 01 / Final Frame / 135mm' },
] as const;
/** YAGI Production's own films, each at its own ratio. No client work: its posters carry real names. */
const FILMS = [
  { id: 'runway', src: V('film-runway', 'mp4'), poster: V('film-runway', 'jpg'), ratio: '9 / 16' },
  { id: 'tutu', src: V('film-tutu', 'mp4'), poster: V('film-tutu', 'jpg'), ratio: '16 / 9' },
  { id: 'daydream', src: V('film-daydream', 'mp4'), poster: V('film-daydream', 'jpg'), ratio: '4 / 3' },
  { id: 'aquarium', src: V('film-aquarium', 'mp4'), poster: V('film-aquarium', 'jpg'), ratio: '4 / 3' },
  { id: 'tea', src: '/reel/brands/tea-editorial.mp4', poster: V('film-tea', 'jpg'), ratio: '16 / 9' },
] as const;
/** Creator-style posts made with fictional people, warm and cool in turn (the real Morphic case follows below). */
const FEED = [
  { id: 'peach', src: '/reel/landing/yunseol-peach' },
  { id: 'retro-01', src: '/reel/campaigns/retro-phone-01' },
  { id: 'blue', src: '/reel/landing/v7/feed-blue' },
  { id: 'y2k', src: '/reel/brands/y2k-flip-phone' },
] as const;
/** The fashion looks, in page order. `studio` marks the founder's own picks from /admin/landing-media. */
const LOOKS = [
  { id: 'look-feather' },
  { id: 'vto-look-upper', studio: true },
  { id: 'look-drape' },
  { id: 'look-street' },
  { id: 'vto-look-side', studio: true },
  { id: 'look-knit' },
  { id: 'look-carpet' },
  { id: 'vto-look-front', studio: true },
  { id: 'look-sculpt' },
] as const;
/**
 * The two ads and what each one features. The fashion film is the hero film, so no extra bytes. The pink perfume
 * ad is the founder's original and the page's one warm counterpoint (docs/design/IDENTITY.md §2).
 */
const ADS = [
  { id: 'fashion', still: L('ad-denim'), film: V('hero', 'mp4'), poster: V('hero', 'jpg') },
  { id: 'perfume', still: L('highteen-product'), film: '/reel/campaigns/highteen.mp4', poster: '/reel/campaigns/highteen.jpg' },
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
        <HeroFilm className={s.heroFilm} specClassName={s.heroSpec} src={V('hero', 'mp4')} srcSmall={V('hero-phone', 'mp4')} srcLarge={V('hero-2160', 'mp4')} poster={V('hero', 'jpg')} posterSmall={V('hero-phone', 'jpg')} label={h.filmLabel} cues={HERO_CUES} />
        <div className={s.heroScrim} aria-hidden="true" />
        <div className={s.heroCopy}>
          <h1 className={s.display}>{h.title}</h1>
          <p className={s.lead}>{h.body}</p>
          <div className={s.actions}>
            <a data-inquiry-trigger href={brandEnquiryHref(locale)} className={s.cta}>{h.cta}</a>
            <a href="#work" className={s.ghost}>{h.secondary}</a>
          </div>
        </div>
        <span className={s.crosshairs} aria-hidden="true" />
      </div>
      <nav aria-label={h.doorsLabel} data-hero-doors className={s.doors}>
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
  return (
    <div className={s.card} data-stage="memory">
      <div className={s.cardHead}>
        <strong>{m.title}</strong>
        <span className={s.campaigns}>{m.campaigns.map((c, i) => <span key={c} data-current={i === m.campaigns.length - 1 ? 'true' : undefined}>{c}</span>)}</span>
      </div>
      <ul className={s.memoryGrid}>
        {LANDING_CUTS.map((key, index) => (
          <li key={key} className={s.memoryShot}>
            <img src={landingSrc(media, `cut-${key}`)} alt="" width={1440} height={804} style={{ objectPosition: CUT_FOCUS[key] }} loading="lazy" decoding="async" />
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

function DirectionStage({ copy, media }: { copy: Copy } & Media) {
  const d = copy.first.direction;
  return (
    <div className={s.card} data-stage="direction">
      <div className={s.prompt}><span className={s.promptIcon} aria-hidden="true">↳</span><TypeLine text={d.prompt} /></div>
      <div className={s.brief}>
        <span className={s.briefLabel}>{d.brief}</span>
        <ul className={s.spec}>{d.spec.map((item) => <li key={item} className={s.mono}>{item}</li>)}</ul>
      </div>
      <ul className={s.outputs} aria-label={d.outputs}>
        {(['beads', 'pump', 'mark'] as const).map((key) => (
          <li key={key}><img src={landingSrc(media, `cut-${key}`)} alt="" width={1440} height={804} style={{ objectPosition: CUT_FOCUS[key] }} loading="lazy" decoding="async" /></li>
        ))}
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
  const stages = [<KitStage key="kit" copy={copy} />, <MemoryStage key="memory" copy={copy} media={media} />, <DirectionStage key="direction" copy={copy} media={media} />];
  return (
    <section id="how" data-v7-first data-section data-theme="light" className={`${s.section} ${s.sky}`}>
      <div className={s.shell}>
        <Reveal className={s.head}>
          <Eyebrow>{f.eyebrow}</Eyebrow>
          <h2 className={s.h2}>{f.title}</h2>
          <p className={s.lead}>{f.body}</p>
          <p className={s.note}>{f.studio}</p>
        </Reveal>
        <ChapterScene chapters={chapters} stages={stages} />
      </div>
    </section>
  );
}

/** The runway's edits, in dictionary order. Two start from a picture the visitor "attached". */
const RUNWAY_EDITS: ReadonlyArray<{ id: string; attach?: string }> = [
  { id: 'outfit', attach: 'rx-attach-look' },
  { id: 'model' },
  { id: 'set' },
  { id: 'duo', attach: 'rx-attach-model' },
];

export function V7Remix({ copy }: { copy: Copy }) {
  const r = copy.remix;
  const [runway, beauty] = r.formats;
  const formats: RemixFormat[] = [
    {
      id: 'runway',
      title: runway!.title,
      ratio: 9 / 16,
      src: V('rx-runway-orig', 'mp4'),
      poster: V('rx-runway-orig', 'jpg'),
      edits: RUNWAY_EDITS.map(({ id, attach }, index) => ({
        id,
        ...runway!.edits[index]!,
        src: V(`rx-runway-${id}`, 'mp4'),
        poster: V(`rx-runway-${id}`, 'jpg'),
        ...(attach ? { attachment: V(attach, 'webp') } : {}),
      })),
    },
    {
      id: 'beauty',
      title: beauty!.title,
      ratio: 16 / 9,
      src: V('rx-beauty-orig', 'mp4'),
      poster: V('rx-beauty-orig', 'jpg'),
      edits: ['product', 'world'].map((id, index) => ({
        id,
        ...beauty!.edits[index]!,
        src: V(`rx-beauty-${id}`, 'mp4'),
        poster: V(`rx-beauty-${id}`, 'jpg'),
        ...(id === 'product' ? { attachment: V('rx-attach-edition', 'webp') } : {}),
      })),
    },
  ];
  return (
    <section id="remix" data-v7-remix data-section data-theme="light" className={`${s.section} scroll-mt-20`}>
      <div className={s.shell}>
        <Reveal className={`${s.head} ${s.headRow}`}>
          <div>
            <Eyebrow status={r.early}>{r.eyebrow}</Eyebrow>
            <h2 className={s.h2}>{r.title}</h2>
          </div>
          <div className={s.headAside}>
            <p className={s.lead}>{r.body}</p>
            <p className={s.note}>{r.note}</p>
          </div>
        </Reveal>
        <Remix formats={formats} labels={{ original: r.original, composer: r.composer, hint: r.hint, working: r.working, formatsLabel: r.formatsLabel, attached: r.attached }} />
      </div>
    </section>
  );
}

export function V7Work({ copy, studio, media }: { copy: Copy; studio: StudioCopy } & Media) {
  const w = copy.work;
  const looks = (
    <div key="looks">
      <p className={s.note}>{w.notes[0]}</p>
      <ul data-asset-looks className={s.looks}>
        {LOOKS.map((look) => (
          <li key={look.id} data-asset-look={look.id}>
            <img src={'studio' in look ? studioSrc(media, look.id) : landingSrc(media, look.id)} alt="" width={1000} height={1500} loading="lazy" decoding="async" />
          </li>
        ))}
      </ul>
    </div>
  );
  const cuts = (
    <div key="cuts">
      <p className={s.note}>{w.notes[1]}</p>
      <ul data-asset-cuts className={s.cuts}>
        {LANDING_CUTS.map((key) => (
          <li key={key} data-asset-cut={key}>
            <img src={landingSrc(media, `cut-${key}`)} alt="" width={1440} height={804} loading="lazy" decoding="async" />
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
      <div className={s.ads}>
        {ADS.map((ad, index) => (
          <div key={ad.id} data-asset-ad={ad.id} className={s.adPair}>
            <figure data-asset-ad-still className={s.adStill}>
              <img src={ad.still} alt="" width={900} height={1200} loading="lazy" decoding="async" />
              <figcaption className={s.tag}>{index === 0 ? w.adStill : w.adStill2}</figcaption>
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
        <Tabs name="work" labels={w.tabs} panels={[looks, cuts, tryOn, ads]} />
        <p className={`${s.note} mt-6`}>{w.note}</p>
      </div>
    </section>
  );
}

export function V7Finish({ copy, media }: { copy: Copy } & Media) {
  const f = copy.finish;
  const pairs = PAIRS.map((id, index) => {
    const [x, y, width, height] = FIX_BOXES[id];
    const raw = landingSrc(media, `c-${id}-raw`);
    return {
      id,
      raw,
      ours: landingSrc(media, `c-${id}-ours`),
      chip: f.pairs[index]!.chip,
      prompt: f.pairs[index]!.prompt,
      note: f.pairs[index]!.note,
      alt: [f.pairs[index]!.raw, f.pairs[index]!.ours] as [string, string],
      wide: landingSrc(media, `c-${id}-wide`),
      wideAlt: f.pairs[index]!.wideAlt,
      box: { left: x / FIX_SHOT.width, top: y / FIX_SHOT.height, width: width / FIX_SHOT.width, height: height / FIX_SHOT.height },
      attachments: [raw, id === 'logo' ? '/brand/yagi-mark-black.png' : landingSrc(media, `c-${id}-ref`)],
    };
  });
  return (
    <section data-v7-finish data-section data-theme="light" className={`${s.section} ${s.sky}`}>
      <div className={s.shell}>
        <Reveal className={`${s.head} ${s.headRow}`}>
          <div>
            <Eyebrow status={f.soon}>{f.eyebrow}</Eyebrow>
            <h2 className={s.h2}>{f.title}</h2>
          </div>
          <div className={s.headAside}>
            <p className={s.lead}>{f.body}</p>
          </div>
        </Reveal>
        <Reveal data-contrast>
          <Compare pairs={pairs} labels={{ raw: f.raw, ours: f.ours, hint: f.hint, slider: f.slider, wide: f.wide, image: f.image }} />
        </Reveal>
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

export function V7Closing({ copy, locale, media, children }: { copy: Copy; locale: Locale; children?: ReactNode } & Media) {
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
        <ul data-closing-grid className={s.closingGrid} aria-label={c.gridLabel}>
          {LANDING_GRID.map((n) => (
            <li key={n}><img src={landingSrc(media, `grid-${n}`)} alt="" width={720} height={720} loading="lazy" decoding="async" /></li>
          ))}
        </ul>
      </div>
      {children}
    </section>
  );
}
