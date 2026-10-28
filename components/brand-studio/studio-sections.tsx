/**
 * PLATFORM-2.0 §20 — the brand landing's studio chapters: sort → search & generate → memory → try-on
 * (beta), then the live "spread" chapter the page keeps from the campaign service. Server-rendered so
 * every line is in the initial HTML. Titles use the site's line reveal and card groups its stagger
 * (PLAN §5.3-4), both armed only on the client and dropped under reduced motion.
 */
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { Reveal } from '@/components/motion/reveal';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { StudioHeroStage, StudioMoodClusters, StudioPipeline, StudioVto } from './studio-interactive';
import styles from './studio.module.css';

type StudioCopy = Dictionary['brandLanding']['studio'];
type Locale = 'ko' | 'en';

/** The example brand's palette, measured from its library: walnut, skin-lit amber, smoked glass, rose. */
const MEMORY_SWATCHES = ['#5D3B27', '#D0AA98', '#141C0D', '#DBCCDA'] as const;
const MEMORY_THUMBS = ['/reel/studio/smoke-1.webp', '/reel/studio/flora-1.webp', '/reel/studio/cream-1.webp'] as const;
/** The personal layer's picture: the ratio this person keeps choosing (matches "4:5 first" in the copy). */
const MEMORY_RATIOS = [
  { label: '4:5', box: '4 / 5', preferred: true },
  { label: '9:16', box: '9 / 16', preferred: false },
  { label: '1:1', box: '1 / 1', preferred: false },
] as const;
/** Layer order matches `copy.memory`: brand → campaign → person. */
const MEMORY_IDS = ['org', 'project', 'me'] as const;
/** What the loop feeds back: three posted cuts from the example feed. */
const LOOP_THUMBS = ['/reel/studio/feed-cafe.webp', '/reel/studio/feed-taxi.webp', '/reel/studio/feed-street.webp'] as const;
/** The same bottle in eight fictional creators' posts (labelled on the page as examples). */
const FEED = ['feed-mirror', 'feed-wrist', 'feed-cafe', 'feed-taxi', 'feed-bed', 'feed-street', 'feed-desk', 'feed-gym'] as const;

function Tag({ kind, children }: { kind: 'early' | 'beta' | 'live'; children: string }) {
  return <span data-early-access={kind === 'live' ? undefined : kind} className={`${styles.statusTag} ${kind === 'live' ? styles.statusTagLive : ''}`}>{children}</span>;
}

/** One head for every chapter: index + status on one line, the title, and the body set beside it. */
function Head({ eyebrow, status, title, body }: { eyebrow: string; status?: React.ReactNode; title: string; body: string }) {
  return (
    <div className={styles.head}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}{status}</p>
        <Reveal lines={title.split('\n')} className={`${styles.title} ${styles.sectionTitle}`} lineClassName="block" />
      </div>
      <p className={`${styles.lede} ${styles.sectionBody}`}>{body}</p>
    </div>
  );
}

export function StudioHero({ copy, locale }: { copy: StudioCopy; locale: Locale }) {
  return (
    <section data-section data-theme="light" data-campaign-hero data-studio-hero className={`section ${styles.root} ${styles.hero}`}>
      <div className="audience-shell">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{copy.heroEyebrow}</p>
          <Reveal as="h1" immediate lines={copy.heroTitle.split('\n')} className={`${styles.title} ${styles.heroTitle}`} lineClassName="block" />
          <p className={`${styles.lede} ${styles.heroBody}`}>{copy.heroBody}</p>
          <div className={styles.heroActions}>
            <a data-campaign-cta-brand data-inquiry-trigger="hero" href={brandEnquiryHref(locale)} className={styles.primary}>{copy.heroCta} <span aria-hidden="true">↗</span></a>
            <a href="#spread" className={styles.secondary}>{copy.heroSecondary} <span aria-hidden="true">›</span></a>
          </div>
          <p className={styles.heroNote}><Tag kind="early">{copy.earlyAccess}</Tag>{copy.earlyNote}</p>
        </div>
        <StudioHeroStage copy={copy} />
      </div>
    </section>
  );
}

export function StudioMoods({ copy }: { copy: StudioCopy }) {
  return (
    <section id="moods" data-section data-theme="light" data-studio-moods className={`section scroll-mt-24 ${styles.root} ${styles.section}`}>
      <div className="audience-shell">
        <Head eyebrow={copy.moods.eyebrow} status={<Tag kind="early">{copy.earlyAccess}</Tag>} title={copy.moods.title} body={copy.moods.body} />
        <StudioMoodClusters copy={copy} />
      </div>
    </section>
  );
}

export function StudioPipelineSection({ copy }: { copy: StudioCopy }) {
  return (
    <section id="studio" data-section data-theme="light" className={`section scroll-mt-24 ${styles.root} ${styles.section}`}>
      <div className="audience-shell">
        <Head eyebrow={copy.pipelineEyebrow} status={<Tag kind="early">{copy.earlyAccess}</Tag>} title={copy.pipelineTitle} body={copy.pipelineBody} />
        <StudioPipeline copy={copy} />
      </div>
    </section>
  );
}

export function StudioMemory({ copy }: { copy: StudioCopy }) {
  return (
    <section data-section data-theme="light" data-brand-memory className={`section ${styles.root} ${styles.section}`}>
      <div className="audience-shell">
        <Head eyebrow={copy.memoryEyebrow} status={<Tag kind="early">{copy.earlyAccess}</Tag>} title={copy.memoryTitle} body={copy.memoryBody} />
        <RevealGrid itemSelector="[data-memory-layer]" stagger={0.08}><ul className={styles.bento}>
          {copy.memory.map((layer, index) => {
            const id = MEMORY_IDS[index];
            return (
              <li key={id} data-memory-layer={id} className={styles.memCard}>
                <div>
                  <p className={styles.memLayer}><span>0{index + 1}</span></p>
                  <h3 className={styles.memTitle} style={{ marginTop: 14 }}>{layer.title}</h3>
                  <p className={styles.memBody}>{layer.body}</p>
                </div>
                <div aria-hidden="true" className={styles.memVisual}>
                  {id === 'org' && MEMORY_SWATCHES.map((hex) => <span key={hex} className={styles.memSwatch} style={{ background: hex }} />)}
                  {id === 'project' && MEMORY_THUMBS.map((src) => <span key={src} className={styles.memThumb}><img src={src} alt="" width={120} height={160} loading="lazy" decoding="async" /></span>)}
                  {id === 'me' && MEMORY_RATIOS.map((ratio) => <span key={ratio.label} className={`${styles.memRatio} ${ratio.preferred ? styles.memRatioOn : ''}`}><span className={styles.memRatioBox} style={{ aspectRatio: ratio.box }} />{ratio.label}</span>)}
                </div>
                <ul className={styles.memItems}>
                  {layer.items.map((item) => <li key={item} className={styles.memItem}><span aria-hidden="true" className={styles.dot} />{item}</li>)}
                </ul>
              </li>
            );
          })}
        </ul></RevealGrid>
        {/* The loop back from posting (PLATFORM-2.0 §20.3): results feed the next campaign's memory. */}
        <div data-memory-loop className={styles.loop}>
          <span aria-hidden="true" className={styles.loopThumbs}>{LOOP_THUMBS.map((src) => <img key={src} src={src} alt="" width={64} height={114} loading="lazy" decoding="async" />)}</span>
          <p><strong>{copy.memoryLoop.label}</strong> {copy.memoryLoop.body}</p>
          <span aria-hidden="true" className={styles.loopArrow}>↺</span>
        </div>
      </div>
    </section>
  );
}

export function StudioVtoSection({ copy }: { copy: StudioCopy }) {
  return (
    <section id="try-on" data-section data-theme="light" data-studio-vto className={`section scroll-mt-24 ${styles.root} ${styles.section}`}>
      <div className="audience-shell">
        <Head eyebrow={copy.vto.eyebrow} status={<Tag kind="beta">{copy.beta}</Tag>} title={copy.vto.title} body={copy.vto.body} />
        <StudioVto copy={copy} />
      </div>
    </section>
  );
}

/** The same bottle in eight feeds: a slow marquee (paused on hover, still under reduced motion). */
export function StudioFeed({ copy }: { copy: StudioCopy }) {
  const items = [...FEED, ...FEED];
  return (
    <div data-studio-feed className={`${styles.root} ${styles.feed}`}>
      <div className={styles.feedHead}>
        <p className={styles.feedTitle}>{copy.spreadFeed.title}</p>
        <p className={styles.feedNote}>{copy.spreadFeed.note}</p>
      </div>
      <div className={styles.feedTrack}>
        <ul className={styles.feedRow}>
          {items.map((name, index) => (
            <li key={`${name}-${index}`} data-feed-post={index < FEED.length ? name : undefined} aria-hidden={index >= FEED.length ? 'true' : undefined} className={styles.feedPost}>
              <img src={`/reel/studio/${name}.webp`} alt="" width={270} height={480} loading="lazy" decoding="async" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
