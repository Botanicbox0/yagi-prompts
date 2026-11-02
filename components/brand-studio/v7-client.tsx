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

/** "@이미지2" stays on one line: a break right after the @ reads as a typo. */
function mentions(text: string) {
  return text.split(/(@\S+)/).map((part, index) => (part.startsWith('@') ? <span key={index} className={styles.mention}>{part}</span> : part));
}

/**
 * A local fix: one wide shot with a box on it, and the boxed region zoomed beside it. Drag (or use the arrow keys /
 * slider) to wipe between the broken shot and the fix. The box is why it works: a small region gets a whole canvas of
 * pixels of its own, and everything outside the box stays as it was.
 */
export function Compare({ pairs, labels }: {
  pairs: ReadonlyArray<{
    id: string;
    raw: string;
    ours: string;
    chip: string;
    prompt: string;
    note: string;
    alt: [string, string];
    box: { left: number; top: number; width: number; height: number };
    attachments: readonly string[];
    wide: string;
    wideAlt: string;
  }>;
  labels: { raw: string; ours: string; hint: string; slider: string; wide: string; image: string };
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
  const box = { left: `${pair.box.left * 100}%`, top: `${pair.box.top * 100}%`, width: `${pair.box.width * 100}%`, height: `${pair.box.height * 100}%` };
  return (
    <div data-v7-compare-ui className={styles.fix}>
      <div className={styles.fixPanel}>
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
        <div className={styles.remixChat} aria-live="polite">
          <ul key={pair.id} className={styles.fixAttachments}>
            {pair.attachments.map((src, i) => (
              <li key={src}>
                <img src={src} alt="" width={120} height={120} decoding="async" />
                <span>{`${labels.image}${i + 1}`}</span>
              </li>
            ))}
          </ul>
          <p className={styles.remixSaid}>{mentions(pair.prompt)}</p>
          <p className={styles.remixDone}><span aria-hidden="true">✓</span>{pair.note}</p>
        </div>
      </div>
      <div className={styles.fixStage}>
        <figure className={styles.fixWide}>
          <img key={pair.id} src={pair.wide} alt={pair.wideAlt} width={1200} height={1600} decoding="async" />
          <span data-fix-box={pair.id} className={styles.fixBox} style={box} aria-hidden="true" />
          <figcaption className={styles.tag}>{labels.wide}</figcaption>
        </figure>
        <div
          ref={frame}
          className={styles.compareFrame}
          style={{ '--split': `${split}%` } as CSSProperties}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <img className={styles.compareImg} src={pair.ours} alt={pair.alt[1]} width={1000} height={1000} decoding="async" />
          <div className={styles.compareRaw} aria-hidden="false">
            <img className={styles.compareImg} src={pair.raw} alt={pair.alt[0]} width={1000} height={1000} decoding="async" />
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
      </div>
      {/* Every pair stays in the markup for crawlers and no-JS readers; only the active one is drawn above. */}
      <ul hidden>{pairs.map((item) => <li key={item.id} data-contrast-source={item.id}><img src={item.wide} alt={item.wideAlt} /><img src={item.raw} alt={item.alt[0]} /><img src={item.ours} alt={item.alt[1]} /></li>)}</ul>
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
 * The hero film in three sizes: phones get their own 9:16 cut at 720p, large high-density screens get 4K, everyone else
 * 1080p. A browser that ignores `media` on a source takes the first one, the small file. `poster` on a video has no media
 * query, so the still behind it is a picture: phones wait on the first frame of their own cut, not a zoomed 16:9 frame.
 * One quiet spec line follows the cuts on larger screens.
 */
export function HeroFilm({ src, srcSmall, srcLarge, poster, posterSmall, label, cues, className, specClassName }: {
  src: string;
  srcSmall: string;
  srcLarge: string;
  poster: string;
  posterSmall: string;
  label: string;
  cues: ReadonlyArray<{ at: number; text: string }>;
  className?: string;
  specClassName?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [cue, setCue] = useState(0);
  useEffect(() => {
    const video = ref.current;
    if (!video || reducedMotion()) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    });
    observer.observe(video);
    const onTime = () => {
      let next = 0;
      cues.forEach((item, index) => { if (video.currentTime >= item.at) next = index; });
      setCue(next);
    };
    video.addEventListener('timeupdate', onTime);
    return () => { observer.disconnect(); video.removeEventListener('timeupdate', onTime); };
  }, [cues]);
  return (
    <>
      <picture>
        <source srcSet={posterSmall} media="(max-width: 759px)" />
        <img className={className} src={poster} alt="" fetchPriority="high" decoding="async" />
      </picture>
      <video ref={ref} className={className} muted loop playsInline preload="metadata" aria-label={label} data-loop-video>
        <source src={srcSmall} media="(max-width: 759px)" type="video/mp4" />
        <source src={srcLarge} media="(min-width: 1700px) and (min-resolution: 1.5dppx), (min-width: 2400px)" type="video/mp4" />
        <source src={src} type="video/mp4" />
      </video>
      <p className={specClassName} aria-hidden="true" data-hero-spec><span key={cue}>{cues[cue]?.text}</span></p>
    </>
  );
}

export type RemixEdit = { id: string; prompt: string; done: string; src: string; poster: string; attachment?: string };
export type RemixFormat = { id: string; title: string; ratio: number; src: string; poster: string; edits: readonly RemixEdit[] };

/**
 * The remix studio: pick a format, say what to change, and the real edited film replaces the original in
 * place. It runs through the edits on its own while on screen until the visitor takes over. Every result
 * is a file the engine really made; only the typing is staged.
 */
export function Remix({ formats, labels }: {
  formats: readonly RemixFormat[];
  labels: { original: string; composer: string; hint: string; working: string; formatsLabel: string; attached: string };
}) {
  const [format, setFormat] = useState(0);
  const [edit, setEdit] = useState(-1);
  const [phase, setPhase] = useState<'idle' | 'typing' | 'working'>('idle');
  const [typing, setTyping] = useState('');
  const [typed, setTyped] = useState(0);
  const [pending, setPending] = useState<string | undefined>();
  const [visible, setVisible] = useState(false);
  const touched = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const films = useRef<Array<HTMLVideoElement | null>>([]);
  const originalFilm = useRef<HTMLVideoElement>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const current = formats[format]!;

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) { clearTimeout(timer); clearInterval(timer); }
    timers.current = [];
  }, []);

  const run = useCallback((formatIndex: number, editIndex: number) => {
    clearTimers();
    const item = formats[formatIndex]?.edits[editIndex];
    const prompt = item?.prompt;
    if (!prompt || reducedMotion()) { setEdit(editIndex); setPhase('idle'); setTyping(''); setPending(undefined); return; }
    setTyping(prompt);
    setTyped(0);
    setPending(item.attachment);
    setPhase('typing');
    const type = () => {
      const step = setInterval(() => {
        setTyped((count) => {
          if (count < prompt.length) return count + 1;
          clearInterval(step);
          setPhase('working');
          timers.current.push(setTimeout(() => { setEdit(editIndex); setPhase('idle'); setTyping(''); setPending(undefined); }, 800));
          return count;
        });
      }, 34);
      timers.current.push(step);
    };
    // A picture lands in the composer first, and the sentence is written about it.
    if (item.attachment) timers.current.push(setTimeout(type, 520));
    else type();
  }, [clearTimers, formats]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Only the film on show plays; the rest wait at their first frame and load nothing until they are needed.
  useEffect(() => {
    films.current.forEach((video, index) => {
      if (!video) return;
      if (index === edit + 1 && visible && !reducedMotion()) {
        video.preload = 'auto';
        void video.play().catch(() => {});
      } else {
        video.pause();
        if (index !== edit + 1) video.currentTime = 0;
      }
    });
  }, [edit, format, visible]);

  // The original plays beside an edit, so the change reads at a glance.
  useEffect(() => {
    const video = originalFilm.current;
    if (!video) return;
    if (edit >= 0 && visible && !reducedMotion()) void video.play().catch(() => {});
    else video.pause();
  }, [edit, format, visible]);

  // Walks through the edits until the visitor picks one.
  useEffect(() => {
    if (!visible || touched.current || phase !== 'idle' || reducedMotion()) return;
    const timer = setTimeout(() => {
      const next = edit + 1;
      if (next < current.edits.length) run(format, next);
      else { setFormat((format + 1) % formats.length); setEdit(-1); }
    }, edit < 0 ? 2200 : 6500);
    return () => clearTimeout(timer);
  }, [visible, phase, edit, format, current.edits.length, formats.length, run]);

  const choose = (index: number) => { touched.current = true; run(format, index); };
  const chooseFormat = (index: number) => { touched.current = true; clearTimers(); setFormat(index); setEdit(-1); setPhase('idle'); setTyping(''); setPending(undefined); };
  const shown = edit >= 0 ? current.edits[edit] : undefined;

  return (
    <div ref={root} className={styles.remix} data-remix>
      <div className={styles.remixPanel}>
        <div role="tablist" aria-label={labels.formatsLabel} className={styles.chips}>
          {formats.map((item, index) => (
            <button key={item.id} type="button" role="tab" aria-selected={index === format} className={styles.chip} data-remix-format={item.id} onClick={() => chooseFormat(index)}>{item.title}</button>
          ))}
        </div>
        <div className={styles.remixChat} aria-live="polite">
          {shown ? (
            <>
              {shown.attachment ? <img key={shown.attachment} className={styles.remixAttached} src={shown.attachment} alt={labels.attached} width={240} height={320} decoding="async" /> : null}
              <p className={styles.remixSaid}>{shown.prompt}</p>
              <p className={styles.remixDone}><span aria-hidden="true">✓</span>{shown.done}</p>
            </>
          ) : <p className={styles.remixHint}>{labels.hint}</p>}
        </div>
        <ul className={styles.remixEdits}>
          {current.edits.map((item, index) => (
            <li key={item.id}>
              <button type="button" className={styles.remixEdit} data-remix-edit={item.id} aria-pressed={index === edit} onClick={() => choose(index)}>
                {item.attachment ? <img className={styles.remixEditThumb} src={item.attachment} alt="" width={30} height={40} loading="lazy" decoding="async" /> : null}
                {item.prompt}
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.composer} aria-hidden="true">
          {pending && phase !== 'idle' ? <img className={styles.composerAttach} src={pending} alt="" width={30} height={40} decoding="async" /> : null}
          <span data-empty={phase === 'idle' ? 'true' : undefined}>{phase === 'idle' ? labels.composer : typing.slice(0, typed)}</span>
          {phase === 'typing' ? <i className={styles.caret} /> : null}
          <b className={styles.composerSend} data-busy={phase === 'working' ? 'true' : undefined}>↑</b>
        </div>
      </div>
      <div className={styles.remixMedia}>
      {current.ratio < 1 ? (
        <figure className={styles.remixOriginal} data-shown={edit >= 0 ? 'true' : undefined} style={{ '--arn': current.ratio } as CSSProperties}>
          <video ref={originalFilm} src={current.src} poster={current.poster} muted loop playsInline preload="none" aria-hidden="true" data-loop-video />
          <figcaption className={styles.tag}>{labels.original}</figcaption>
        </figure>
      ) : null}
      <figure className={styles.remixStage} style={{ '--arn': current.ratio } as CSSProperties} data-working={phase === 'working' ? 'true' : undefined}>
        {[{ id: 'original', src: current.src, poster: current.poster }, ...current.edits].map((item, index) => (
          <video
            key={`${current.id}-${item.id}`}
            ref={(node) => { films.current[index] = node; }}
            className={styles.remixFilm}
            data-active={index === edit + 1 ? 'true' : undefined}
            src={item.src}
            poster={item.poster}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden={index === edit + 1 ? undefined : true}
            data-loop-video
          />
        ))}
        <figcaption className={styles.tag}>{phase === 'working' ? labels.working : shown ? shown.prompt : labels.original}</figcaption>
      </figure>
      </div>
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
