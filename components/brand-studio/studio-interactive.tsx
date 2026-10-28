'use client';

/**
 * PLATFORM-2.0 §20 — the two moving pieces of the brand landing. Both render their full content on
 * the server; JavaScript only drives the scroll-linked gather and the tab rotation, and both stop
 * under prefers-reduced-motion.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import styles from './studio.module.css';

type StudioCopy = Dictionary['brandLanding']['studio'];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Six real campaign stills, each with the offset it floats at before the studio gathers it. */
const HERO_TILES = [
  { src: '/reel/campaigns/beauty-rose.jpg', file: 'lipgloss_macro.jpg', dx: -165, dy: -30, rot: -8, sc: 1.06 },
  { src: '/reel/brands/y2k-flip-phone.jpg', file: 'y2k_flipphone.mp4', dx: 45, dy: -58, rot: 6, sc: 0.96 },
  { src: '/reel/brands/production-paris.jpg', file: 'paris_film.mov', dx: 172, dy: -26, rot: 9, sc: 1.04 },
  { src: '/reel/brands/tea-editorial.jpg', file: 'editorial_room.jpg', dx: -182, dy: 42, rot: 7, sc: 0.98 },
  { src: '/reel/studio-demo/designed-format.jpg', file: 'highteen_locker.jpg', dx: -30, dy: 92, rot: -5, sc: 1.02 },
  { src: '/reel/brands/city-fashion.jpg', file: 'city_look.jpg', dx: 178, dy: 58, rot: -9, sc: 1 },
] as const;

/** The search demo: three stills that really carry pink, three that do not. */
const SEARCH_CELLS = [
  { src: '/reel/campaigns/beauty-rose.jpg', hit: true },
  { src: '/reel/brands/tea-editorial.jpg', hit: false },
  { src: '/reel/campaigns/retro-phone-01.jpg', hit: true },
  { src: '/reel/brands/city-fashion.jpg', hit: false },
  { src: '/reel/brands/y2k-flip-phone.jpg', hit: true },
  { src: '/reel/brands/production-paris.jpg', hit: false },
] as const;

/** Dominant colors measured from beauty-rose.jpg (4-color quantize), not invented. */
const SWATCHES = ['#D69E9F', '#C25359', '#EDC6BE', '#D47E82'] as const;
const VARIANT_CLASSES = [styles.v1, styles.v2, styles.v3, styles.v4] as const;
const ROTATE_MS = 6000;
/** Panel order matches `copy.tabs`; ids are markup, not copy. */
const TAB_IDS = ['tag', 'search', 'make'] as const;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function StudioHeroStage({ copy }: { copy: StudioCopy }) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (prefersReducedMotion()) {
      stage.style.setProperty('--p', '1');
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      // Gathered after a little over half a screen of scrolling, whatever the stage's position.
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.55)));
      stage.style.setProperty('--p', progress.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <div ref={stageRef} data-studio-stage className={styles.stage}>
      <div aria-hidden="true" className={styles.aura} />
      <div className={styles.window} role="img" aria-label={`${copy.stage.window} — ${copy.example}`}>
        <div className={styles.windowBar}>
          <span aria-hidden="true" className={styles.lights}><span /><span /><span /></span>
          <span className={styles.windowTitle}>{copy.stage.window}</span>
          <span className={styles.search}>
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" /><path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <span className={styles.searchText}>{copy.stage.search}</span>
            <span aria-hidden="true" className={styles.caret} />
          </span>
        </div>
        <div className={styles.windowBody}>
          <div className={styles.rail}>
            <p className={styles.railTitle}>{copy.stage.memory}</p>
            <ul className={styles.rules}>
              {copy.stage.rules.map((rule) => (
                <li key={rule} className={styles.rule}><span aria-hidden="true" className={styles.dot} />{rule}</li>
              ))}
            </ul>
          </div>
          <div className={styles.slots}>
            {HERO_TILES.map((tile, index) => (
              <div key={tile.src} className={styles.slot}>
                <div className={styles.tile} style={{ '--dx': tile.dx, '--dy': tile.dy, '--rot': tile.rot, '--sc': tile.sc } as Vars}>
                  <div className={styles.tileMedia}>
                    <img src={tile.src} alt="" width={320} height={240} loading={index < 3 ? 'eager' : 'lazy'} decoding="async" />
                  </div>
                  <span className={styles.tag}>{copy.stage.tags[index]}</span>
                  <span className={styles.file}>{tile.file}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p aria-hidden="true" className={styles.drop}>{copy.stage.drop}</p>
      </div>
    </div>
  );
}

export function StudioPipeline({ copy }: { copy: StudioCopy }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const count = copy.tabs.length;
  const running = auto && inView && !reduced;

  useEffect(() => {
    setReduced(prefersReducedMotion());
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % count), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [active, running, count]);

  const choose = (index: number, focus = false) => {
    setAuto(false);
    setActive(index);
    if (focus) tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (next) {
      event.preventDefault();
      choose((index + next + count) % count, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      choose(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      choose(count - 1, true);
    }
  };

  return (
    <div ref={rootRef} data-studio-pipeline className={`${styles.demo} ${running ? '' : styles.paused}`}>
      <div role="tablist" aria-label={copy.pipelineEyebrow} aria-orientation="vertical" className={styles.tabs}>
        {copy.tabs.map((tab, index) => (
          <button
            key={TAB_IDS[index]}
            ref={(node) => { tabRefs.current[index] = node; }}
            type="button"
            role="tab"
            id={`studio-tab-${TAB_IDS[index]}`}
            aria-controls={`studio-panel-${TAB_IDS[index]}`}
            aria-selected={active === index}
            tabIndex={active === index ? 0 : -1}
            data-studio-tab={TAB_IDS[index]}
            className={styles.tab}
            onClick={() => choose(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className={styles.tabLabel}><span className={styles.tabNo}>0{index + 1}</span>{tab.label}</span>
            <span className={styles.tabBody}>{tab.body}</span>
            <span aria-hidden="true" className={styles.progress}>{running && active === index ? <span key={`${active}-${String(running)}`} /> : null}</span>
          </button>
        ))}
      </div>

      <div className={styles.panelFrame}>
        {copy.tabs.map((tab, index) => {
          const id = TAB_IDS[index];
          return (
            <div
              key={id}
              role="tabpanel"
              id={`studio-panel-${id}`}
              aria-labelledby={`studio-tab-${id}`}
              hidden={active !== index}
              data-studio-panel={id}
              className={styles.panel}
            >
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>{tab.title}</span>
                <span className={styles.example}>{copy.example}</span>
              </div>
              {id === 'tag' && <TagPanel copy={copy} />}
              {id === 'search' && <SearchPanel copy={copy} />}
              {id === 'make' && <MakePanel copy={copy} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TagPanel({ copy }: { copy: StudioCopy }) {
  const groups = copy.tagGroups;
  const values = copy.tagValues;
  return (
    <div className={styles.tagPanel}>
      <div className={styles.tagImage}>
        <img src="/reel/campaigns/beauty-rose.jpg" alt="" width={640} height={400} loading="lazy" decoding="async" />
        <span aria-hidden="true" className={`${styles.box} ${styles.appear}`} style={{ left: '4%', top: '16%', width: '86%', height: '58%', '--i': 1 } as Vars}>
          <span className={styles.boxLabel}>{values.object}</span>
        </span>
      </div>
      <dl className={styles.tagList}>
        <div className={`${styles.tagRow} ${styles.appear}`} style={{ '--i': 2 } as Vars}>
          <dt className={styles.tagKey}>{groups.object}</dt>
          <dd className={styles.tagVals}><span className={styles.chip}>{values.object}</span></dd>
        </div>
        <div className={`${styles.tagRow} ${styles.appear}`} style={{ '--i': 3 } as Vars}>
          <dt className={styles.tagKey}>{groups.color}</dt>
          <dd className={styles.tagVals}>
            {SWATCHES.map((hex) => (
              <span key={hex} className={styles.swatchRow}><span aria-hidden="true" className={styles.swatch} style={{ background: hex }} />{hex}</span>
            ))}
          </dd>
        </div>
        <div className={`${styles.tagRow} ${styles.appear}`} style={{ '--i': 4 } as Vars}>
          <dt className={styles.tagKey}>{groups.light}</dt>
          <dd className={styles.tagVals}><span className={styles.chip}>{values.light}</span></dd>
        </div>
        <div className={`${styles.tagRow} ${styles.appear}`} style={{ '--i': 5 } as Vars}>
          <dt className={styles.tagKey}>{groups.framing}</dt>
          <dd className={styles.tagVals}><span className={styles.chip}>{values.framing}</span></dd>
        </div>
        <div className={`${styles.tagRow} ${styles.appear}`} style={{ '--i': 6 } as Vars}>
          <dt className={styles.tagKey}>{groups.mood}</dt>
          <dd className={styles.tagVals}>
            {values.mood.map((mood) => <span key={mood} className={`${styles.chip} ${styles.chipLive}`}><span aria-hidden="true" className={styles.dot} />{mood}</span>)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function SearchPanel({ copy }: { copy: StudioCopy }) {
  return (
    <div className={styles.searchPanel}>
      <div className={styles.searchBar}>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" /><path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span>{copy.stage.search}</span>
        <span aria-hidden="true" className={styles.caret} />
        <span className={styles.searchCount}>{copy.searchResult}</span>
      </div>
      <ul className={styles.grid}>
        {SEARCH_CELLS.map((cell, index) => (
          <li key={cell.src} data-search-hit={cell.hit ? 'true' : 'false'} className={`${styles.cell} ${styles.appear} ${cell.hit ? styles.cellHit : styles.cellMiss}`} style={{ '--i': index } as Vars}>
            <img src={cell.src} alt="" width={240} height={240} loading="lazy" decoding="async" />
            {cell.hit && <span aria-hidden="true" className={styles.hitMark}>✓</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MakePanel({ copy }: { copy: StudioCopy }) {
  return (
    <div className={styles.makePanel}>
      <div className={styles.prompt}>
        <span aria-hidden="true" className={styles.dot} />
        <span>{copy.makePrompt}</span>
      </div>
      <ul className={styles.variants}>
        {copy.makeVariants.map((label, index) => (
          <li key={label} className={`${styles.variant} ${styles.appear} ${VARIANT_CLASSES[index] ?? ''}`} style={{ '--i': index } as Vars}>
            <div className={styles.variantMedia}><img src="/reel/campaigns/beauty-rose.jpg" alt="" width={240} height={300} loading="lazy" decoding="async" /></div>
            <span className={styles.variantLabel}>{label}</span>
          </li>
        ))}
      </ul>
      <ul className={styles.checks}>
        {copy.makeChecks.map((check, index) => (
          <li key={check} className={`${styles.check} ${styles.appear}`} style={{ '--i': index + 4 } as Vars}><span aria-hidden="true" className={styles.checkMark}>✓</span>{check}</li>
        ))}
      </ul>
    </div>
  );
}
