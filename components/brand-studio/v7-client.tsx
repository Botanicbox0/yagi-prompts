'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import styles from './v7.module.css';

/**
 * Brand landing v7 (2026-10-30), the client islands. Everything here works without JavaScript as a plain
 * page (the server markup already holds every image, chapter and step), stops under reduced motion, and
 * uses no motion library: IntersectionObserver, pointer events and CSS transitions only.
 */

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Marks children with data-inview once they enter the screen, for the CSS blur-to-sharp reveal. */
export function Reveal({ children, className, as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'figure' } & Record<`data-${string}`, string | boolean | undefined>) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reducedMotion()) { setSeen(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setSeen(true); observer.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Tag ref={ref as never} className={className} data-reveal data-inview={seen ? 'true' : undefined} {...rest}>{children}</Tag>;
}

/** A muted loop that plays only while on screen; poster first, nothing downloads before it is near. */
export function Film({ src, poster, label, className, eager = false }: { src: string; poster: string; label: string; className?: string; eager?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || reducedMotion()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        if (video.preload !== 'auto') video.preload = 'auto';
        void video.play().catch(() => {});
      } else video.pause();
    }, { rootMargin: '160px 0px' });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  return <video ref={ref} className={className} src={src} poster={poster} muted loop playsInline preload={eager ? 'metadata' : 'none'} aria-label={label} data-loop-video />;
}

/** Same product, same request: drag (or use the arrow keys / slider) to wipe between the two shots. */
export function Compare({ pairs, labels }: {
  pairs: ReadonlyArray<{ id: string; raw: string; ours: string; chip: string; note: string; alt: [string, string] }>;
  labels: { raw: string; ours: string; hint: string; slider: string };
}) {
  const [index, setIndex] = useState(0);
  const [split, setSplit] = useState(50);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fromPointer = useCallback((clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    setSplit(Math.min(96, Math.max(4, ((clientX - box.left) / box.width) * 100)));
  }, []);
  const onDown = (event: PointerEvent<HTMLDivElement>) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); fromPointer(event.clientX); };
  const onMove = (event: PointerEvent<HTMLDivElement>) => { if (dragging.current) fromPointer(event.clientX); };
  const onUp = () => { dragging.current = false; };
  const pair = pairs[index]!;
  return (
    <div data-v7-compare-ui className={styles.compare}>
      <div
        ref={frame}
        className={styles.compareFrame}
        style={{ '--split': `${split}%` } as CSSProperties}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <img className={styles.compareImg} src={pair.ours} alt={pair.alt[1]} width={640} height={640} decoding="async" />
        <div className={styles.compareRaw} aria-hidden="false">
          <img className={styles.compareImg} src={pair.raw} alt={pair.alt[0]} width={640} height={640} decoding="async" />
        </div>
        <span className={`${styles.compareTag} ${styles.compareTagRaw}`}>{labels.raw}</span>
        <span className={`${styles.compareTag} ${styles.compareTagOurs}`}>{labels.ours}</span>
        <span className={styles.compareHandle} aria-hidden="true"><i /></span>
        <input
          className={styles.compareRange}
          type="range"
          min={4}
          max={96}
          value={Math.round(split)}
          onChange={(event) => setSplit(Number(event.target.value))}
          aria-label={labels.slider}
        />
      </div>
      <div className={styles.compareBar}>
        <div role="tablist" aria-label={labels.hint} className={styles.chips}>
          {pairs.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              data-contrast-pair={item.id}
              className={styles.chip}
              onClick={() => { setIndex(i); setSplit(50); }}
            >
              {item.chip}
            </button>
          ))}
        </div>
        <p className={styles.compareNote} aria-live="polite">{pair.note}</p>
      </div>
      {/* Every pair stays in the markup for crawlers and no-JS readers; only the active one is drawn above. */}
      <ul hidden>{pairs.map((item) => <li key={item.id} data-contrast-source={item.id}><img src={item.raw} alt={item.alt[0]} /><img src={item.ours} alt={item.alt[1]} /></li>)}</ul>
    </div>
  );
}

/** Types a line once the element is on screen (instantly under reduced motion). */
export function TypeLine({ text, className, active = true }: { text: string; className?: string; active?: boolean }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active) return;
    if (reducedMotion()) { setCount(text.length); return; }
    const node = ref.current;
    if (!node) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      setCount(0);
      timer = setInterval(() => setCount((n) => { if (n >= text.length) { clearInterval(timer); return n; } return n + 1; }), 55);
    });
    observer.observe(node);
    return () => { observer.disconnect(); if (timer) clearInterval(timer); };
  }, [text, active]);
  return (
    <span ref={ref} className={className} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, count)}</span>
      <span aria-hidden="true" className={styles.caret} data-done={count >= text.length ? 'true' : undefined} />
    </span>
  );
}

/**
 * The pinned "brand comes first" scene. The left column scrolls through three chapters; the stage on the
 * right follows whichever chapter is in the middle of the screen. Below 960px the chapters simply stack,
 * each with its own stage, so nothing is pinned on phones.
 */
export function ChapterScene({ chapters, stages }: { chapters: ReadonlyArray<ReactNode>; stages: ReadonlyArray<ReactNode> }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.chapterIndex));
      }
    }, { rootMargin: '-45% 0px -45% 0px' });
    for (const node of refs.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={styles.scene} data-active-chapter={active}>
      <div className={styles.sceneSteps}>
        {chapters.map((chapter, index) => (
          <div
            key={index}
            ref={(node) => { refs.current[index] = node; }}
            data-chapter-index={index}
            data-chapter-active={index === active ? 'true' : undefined}
            className={styles.sceneStep}
          >
            {chapter}
            {/* The phone layout shows each stage right under its chapter. */}
            <div className={styles.sceneStageInline}>{stages[index]}</div>
          </div>
        ))}
      </div>
      <div className={styles.sceneStageWrap} aria-hidden="true">
        <div className={styles.sceneStage}>
          {stages.map((stage, index) => (
            <div key={index} className={styles.stageLayer} data-stage-active={index === active ? 'true' : undefined}>{stage}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A horizontal track with snap points, previous/next buttons and arrow keys. */
export function Track({ children, label, prev, next, className }: { children: ReactNode; label: string; prev: string; next: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: true, end: false });
  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setEdge({ start: node.scrollLeft <= 4, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    const node = ref.current;
    if (!node) return;
    node.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { node.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [update]);
  const step = (direction: 1 | -1) => {
    const node = ref.current;
    if (!node) return;
    const card = node.querySelector<HTMLElement>('[data-track-item]');
    const width = card ? card.getBoundingClientRect().width + 16 : node.clientWidth * 0.8;
    node.scrollBy({ left: direction * width, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  };
  return (
    <div className={`${styles.trackWrap} ${className ?? ''}`}>
      <div className={styles.trackButtons}>
        <button type="button" className={styles.round} onClick={() => step(-1)} disabled={edge.start} aria-label={prev}>←</button>
        <button type="button" className={styles.round} onClick={() => step(1)} disabled={edge.end} aria-label={next}>→</button>
      </div>
      <div ref={ref} className={styles.track} role="region" aria-label={label} tabIndex={0} onKeyDown={onKey} data-track>
        {children}
      </div>
    </div>
  );
}

/**
 * The workflow rail. On wide screens with motion allowed, vertical scroll drives it sideways while it is
 * pinned (one screen tall plus the rail's overflow). Elsewhere it is the plain snap track with buttons.
 * The same DOM serves both, so nothing shifts when the island wakes up.
 */
export function PinnedTrack({ children, label, prev, next, header }: { children: ReactNode; label: string; prev: string; next: string; header?: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)');
    const sync = () => setPinned(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const box = outer.current;
    const strip = rail.current;
    if (!pinned || !box || !strip) return;
    let distance = 0;
    let frame = 0;
    const measure = () => {
      const pad = parseFloat(getComputedStyle(strip).paddingRight) || 0;
      distance = Math.max(0, strip.scrollWidth - window.innerWidth + pad);
      box.style.height = `${window.innerHeight + distance}px`;
    };
    const paint = () => {
      frame = 0;
      const top = box.getBoundingClientRect().top;
      const progress = distance ? Math.min(1, Math.max(0, -top / distance)) : 0;
      strip.style.transform = `translate3d(${(-progress * distance).toFixed(1)}px, 0, 0)`;
      box.style.setProperty('--progress', progress.toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const onResize = () => { measure(); paint(); };
    measure();
    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
      box.style.height = '';
      strip.style.transform = '';
    };
  }, [pinned]);
  const step = (direction: 1 | -1) => {
    const node = rail.current;
    if (!node) return;
    const card = node.querySelector<HTMLElement>('[data-track-item]');
    node.scrollBy({ left: direction * (card ? card.getBoundingClientRect().width + 16 : node.clientWidth * 0.8), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  return (
    <div ref={outer} className={styles.pinOuter} data-pinned={pinned ? 'true' : undefined}>
      <div className={styles.pinSticky}>
        {header}
        <div className={styles.trackButtons}>
          <button type="button" className={styles.round} onClick={() => step(-1)} aria-label={prev}>←</button>
          <button type="button" className={styles.round} onClick={() => step(1)} aria-label={next}>→</button>
        </div>
        <div ref={rail} className={`${styles.pinRail} ${styles.shellBleed}`} role="region" aria-label={label} tabIndex={0} data-track>
          {children}
        </div>
        <div className={`${styles.pinBar} ${styles.shellBleed}`} aria-hidden="true"><i /></div>
      </div>
    </div>
  );
}

/** A small "Book a demo" pill that floats in after the hero and steps aside for the closing screen. */
export function DemoDock({ label, cta, href }: { label: string; cta: string; href: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const hero = document.querySelector('[data-v7-hero]');
    const closing = document.querySelector('[data-v7-closing]');
    if (!hero) return;
    const state = { pastHero: false, atClosing: false };
    const sync = () => setShown(state.pastHero && !state.atClosing);
    const heroWatch = new IntersectionObserver(([entry]) => { state.pastHero = !entry?.isIntersecting; sync(); }, { rootMargin: '-40% 0px 0px 0px' });
    // Hidden on the closing screen and everything below it (FAQ, footer): the closing has its own button.
    const closingWatch = new IntersectionObserver(([entry]) => { state.atClosing = Boolean(entry && (entry.isIntersecting || entry.boundingClientRect.top < 0)); sync(); });
    heroWatch.observe(hero);
    if (closing) closingWatch.observe(closing);
    return () => { heroWatch.disconnect(); closingWatch.disconnect(); };
  }, []);
  return (
    <div className={styles.dock} data-shown={shown ? 'true' : undefined} data-v7-dock aria-hidden={shown ? undefined : true}>
      <span className={styles.dockLabel}>{label}</span>
      <a data-inquiry-trigger href={href} className={styles.cta} tabIndex={shown ? 0 : -1}>{cta}</a>
    </div>
  );
}

/**
 * The engine band: the fixed layer (taste, hardlines, prompt rules, approved shots) stays locked while
 * the changing layer (season, channel, format) swaps the output. The frame morphs to each ratio.
 */
export function EngineSwitch({ fixed, fixedItems, changes, changeItems, output, note, outputs }: {
  fixed: string;
  fixedItems: readonly string[];
  changes: string;
  changeItems: readonly string[];
  output: string;
  note: string;
  outputs: ReadonlyArray<{ ratio: string; media: ReactNode }>;
}) {
  const [active, setActive] = useState(0);
  return (
    <div data-v7-engine className={styles.engine}>
      <div className={styles.engineCol}>
        <p className={styles.engineLabel}><span className={styles.lock} aria-hidden="true" />{fixed}</p>
        <ul className={styles.fixedList}>{fixedItems.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
      <span className={styles.enginePlus} aria-hidden="true">+</span>
      <div className={styles.engineCol}>
        <p className={styles.engineLabel}><span className={styles.dial} aria-hidden="true" />{changes}</p>
        <div role="radiogroup" aria-label={changes} className={styles.changeList}>
          {changeItems.map((item, index) => (
            <button key={item} type="button" role="radio" aria-checked={index === active} className={styles.change} onClick={() => setActive(index)} data-engine-change={index}>
              {item}
            </button>
          ))}
        </div>
        <p className={styles.note}>{note}</p>
      </div>
      <span className={styles.enginePlus} aria-hidden="true">=</span>
      <figure className={styles.engineOut} aria-label={output}>
        <div className={styles.engineFrame} style={{ '--ratio': outputs[active]?.ratio ?? '3 / 4' } as CSSProperties}>
          {outputs.map((item, index) => (
            <div key={index} className={styles.engineMedia} data-active={index === active ? 'true' : undefined}>{item.media}</div>
          ))}
        </div>
        <figcaption className={styles.note}>{output}</figcaption>
      </figure>
    </div>
  );
}

/** Tabs for the work gallery; every panel stays in the markup (hidden), so the page reads without JS. */
export function Tabs({ labels, panels, name }: { labels: readonly string[]; panels: readonly ReactNode[]; name: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + labels.length) % labels.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    <div data-asset-tabs>
      <div role="tablist" aria-label={name} className={styles.chips}>
        {labels.map((label, index) => (
          <button
            key={label}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="tab"
            id={`${name}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${name}-panel-${index}`}
            tabIndex={index === active ? 0 : -1}
            className={styles.chip}
            onClick={() => setActive(index)}
            onKeyDown={(event) => move(event, index)}
          >
            {label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div key={index} role="tabpanel" id={`${name}-panel-${index}`} aria-labelledby={`${name}-tab-${index}`} hidden={index !== active} data-asset-panel={index} className={styles.tabPanel}>
          {panel}
        </div>
      ))}
    </div>
  );
}
