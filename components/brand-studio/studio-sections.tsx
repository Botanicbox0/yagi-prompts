/**
 * PLATFORM-2.0 §20 — the brand landing's studio chapters: remember → find → make, then the live
 * "spread" chapter that the page keeps from the campaign service. Server-rendered so every line is in
 * the initial HTML; only the stage and the tab demo hydrate.
 */
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { brandEnquiryHref } from '@/lib/campaigns/links';
import { StudioHeroStage, StudioPipeline } from './studio-interactive';
import styles from './studio.module.css';

type StudioCopy = Dictionary['brandLanding']['studio'];
type Locale = 'ko' | 'en';

const MEMORY_SWATCHES = ['#ED1E1E', '#141414', '#F5F5F6', '#FAD204'] as const;
const MEMORY_THUMBS = ['/reel/brands/tea-editorial.jpg', '/reel/campaigns/beauty-rose.jpg', '/reel/brands/city-fashion.jpg'] as const;
/** The personal layer's picture: the ratio this person keeps choosing (matches "4:5 first" in the copy). */
const MEMORY_RATIOS = [
  { label: '4:5', box: '4 / 5', preferred: true },
  { label: '9:16', box: '9 / 16', preferred: false },
  { label: '1:1', box: '1 / 1', preferred: false },
] as const;
/** Layer order matches `copy.memory`: brand → campaign → person. */
const MEMORY_IDS = ['org', 'project', 'me'] as const;

function EarlyAccess({ copy }: { copy: StudioCopy }) {
  return <span data-early-access className={styles.chip}><span aria-hidden="true" className={`${styles.dot} ${styles.dotMuted}`} />{copy.earlyAccess}</span>;
}

function Live({ copy }: { copy: StudioCopy }) {
  return <span className={`${styles.chip} ${styles.chipLive}`}><span aria-hidden="true" className={styles.dot} />{copy.live}</span>;
}

export function StudioHero({ copy, locale }: { copy: StudioCopy; locale: Locale }) {
  return (
    <section data-section data-theme="light" data-campaign-hero data-studio-hero className={`section ${styles.root} ${styles.hero}`}>
      <div className="audience-shell">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{copy.heroEyebrow}</p>
          <h1 className={`${styles.title} ${styles.heroTitle}`}>{copy.heroTitle}</h1>
          <p className={`${styles.lede} ${styles.heroBody}`}>{copy.heroBody}</p>
          <div className={styles.heroActions}>
            <a data-campaign-cta-brand data-inquiry-trigger="hero" href={brandEnquiryHref(locale)} className={styles.primary}>{copy.heroCta} <span aria-hidden="true">↗</span></a>
            <a href="#spread" className={styles.secondary}>{copy.heroSecondary} <span aria-hidden="true">›</span></a>
          </div>
          <p className={styles.heroNote}>{copy.earlyNote}</p>
        </div>
        <StudioHeroStage copy={copy} />
      </div>
    </section>
  );
}

export function StudioSplit({ copy }: { copy: StudioCopy }) {
  return (
    <section data-section data-theme="light" data-studio-split className={`section ${styles.root} ${styles.section}`}>
      <div className="audience-shell">
        <div className={styles.split}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>{copy.splitEyebrow}</p>
            <h2 className={`${styles.title} ${styles.sectionTitle}`}>{copy.splitTitle}</h2>
            <p className={`${styles.lede} ${styles.sectionBody}`}>{copy.splitBody}</p>
          </div>
          <ol className={styles.tools}>
            {copy.splitTools.map((tool, index) => (
              <li key={tool.label} className={styles.tool}>
                <span aria-hidden="true" className={styles.toolIndex}>0{index + 1}</span>
                <p><span className={styles.toolLabel}>{tool.label}</span><span className={styles.toolWhere}>{tool.where}</span></p>
                <p className={styles.toolLoss}>{tool.loss}</p>
              </li>
            ))}
          </ol>
        </div>
        <div data-studio-flow className={styles.flow}>
          <p className={styles.flowTitle}>{copy.flowTitle}</p>
          <ol className={styles.flowSteps}>
            {copy.flow.map((step, index) => {
              const live = index === copy.flow.length - 1;
              return (
                <li key={step.step} data-flow-step={live ? 'live' : 'early'} className={`${styles.flowStep} ${live ? styles.flowStepLive : ''}`}>
                  <div className={styles.flowStepHead}>
                    <span className={styles.flowStepName}>{step.step}</span>
                    {live ? <Live copy={copy} /> : <EarlyAccess copy={copy} />}
                  </div>
                  <p className={styles.flowStepBody}>{step.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function StudioPipelineSection({ copy }: { copy: StudioCopy }) {
  return (
    <section id="studio" data-section data-theme="light" className={`section scroll-mt-24 ${styles.root} ${styles.section}`} style={{ paddingTop: 0 }}>
      <div className="audience-shell">
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>{copy.pipelineEyebrow}</p>
          <h2 className={`${styles.title} ${styles.sectionTitle}`}>{copy.pipelineTitle}</h2>
          <p className={`${styles.lede} ${styles.sectionBody}`}>{copy.pipelineBody}</p>
          <div><EarlyAccess copy={copy} /></div>
        </div>
        <StudioPipeline copy={copy} />
      </div>
    </section>
  );
}

export function StudioMemory({ copy }: { copy: StudioCopy }) {
  return (
    <section data-section data-theme="light" data-brand-memory className={`section ${styles.root} ${styles.section}`} style={{ paddingTop: 0 }}>
      <div className="audience-shell">
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>{copy.memoryEyebrow}</p>
          <h2 className={`${styles.title} ${styles.sectionTitle}`}>{copy.memoryTitle}</h2>
          <p className={`${styles.lede} ${styles.sectionBody}`}>{copy.memoryBody}</p>
          <div><EarlyAccess copy={copy} /></div>
        </div>
        <ul className={styles.bento}>
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
        </ul>
      </div>
    </section>
  );
}

export function StudioContrast({ copy }: { copy: StudioCopy }) {
  return (
    <section data-section data-theme="light" data-studio-contrast className={`section ${styles.root} ${styles.section}`}>
      <div className="audience-shell">
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>{copy.contrastEyebrow}</p>
          <h2 className={`${styles.title} ${styles.sectionTitle}`}>{copy.contrastTitle}</h2>
        </div>
        <div className={styles.contrast}>
          <div className={styles.contrastCard}>
            <p className={styles.contrastLabel}>{copy.contrastHaveLabel}</p>
            <ul className={styles.contrastList}>
              {copy.contrastHave.map((item) => <li key={item} className={styles.contrastItem}><span aria-hidden="true" className={styles.tick}>✓</span>{item}</li>)}
            </ul>
          </div>
          <div className={`${styles.contrastCard} ${styles.contrastCardSkip}`}>
            <p className={styles.contrastLabel}>{copy.contrastSkipLabel}</p>
            <ul className={styles.contrastList}>
              {copy.contrastSkip.map((item) => <li key={item} className={`${styles.contrastItem} ${styles.contrastItemSkip}`}><span aria-hidden="true" className={styles.cross}>×</span>{item}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
