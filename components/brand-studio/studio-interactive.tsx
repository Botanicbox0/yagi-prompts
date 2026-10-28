'use client';

/**
 * PLATFORM-2.0 §20 — the moving pieces of the brand landing. Everything renders on the server;
 * JavaScript only drives the gather (GSAP ScrollTrigger through the site's Lenis proxy, PLAN §5.4),
 * the WebGL aura and the tab rotation. All three stop under prefers-reduced-motion.
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { useIsomorphicLayoutEffect } from '@/components/motion/use-isomorphic-layout-effect';
import styles from './studio.module.css';

type StudioCopy = Dictionary['brandLanding']['studio'];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/**
 * The example library: a fragrance campaign YAGI produced, with its product shots regenerated around
 * an original YAGI bottle (the client's packaging never appears). Files live in /reel/studio/.
 */
const studio = (name: string) => `/reel/studio/${name}.webp`;

/** Six frames from the library, each with the offset it floats at before the studio gathers it. */
const HERO_TILES = [
  { src: studio('amber-yagi'), file: 'amber_light_01.png', dx: -165, dy: -30, rot: -8, sc: 1.06 },
  { src: studio('smoke-1'), file: 'agarwood_smoke.png', dx: 45, dy: -58, rot: 6, sc: 0.96 },
  { src: studio('red-yagi'), file: 'red_object_01.png', dx: 172, dy: -26, rot: 9, sc: 1.04 },
  { src: studio('botanic-1'), file: 'botanical_leaf.png', dx: -182, dy: 42, rot: 7, sc: 0.98 },
  { src: studio('flora-yagi'), file: 'night_florals.png', dx: -30, dy: 92, rot: -5, sc: 1.02 },
  { src: studio('cream-yagi'), file: 'cream_driftwood.png', dx: 178, dy: 58, rot: -9, sc: 1 },
] as const;

/** The search demo: three frames that really show smoke, three that do not. */
const SEARCH_CELLS = [
  { src: studio('smoke-yagi'), hit: true },
  { src: studio('cream-1'), hit: false },
  { src: studio('smoke-1'), hit: true },
  { src: studio('flora-1'), hit: false },
  { src: studio('smoke-2'), hit: true },
  { src: studio('red-2'), hit: false },
] as const;

/** Dominant colors measured from amber-yagi.webp (median-cut quantize), not invented. */
const SWATCHES = ['#5D3B27', '#D0AA98', '#141C0D'] as const;
/** Same bottle, regenerated per mood: the packshot, then three moods from the library. */
const VARIANTS = [studio('bottle'), studio('flora-yagi'), studio('red-yagi'), studio('botanic-yagi')] as const;

/**
 * Mood clusters for the auto-sorting demo. Palettes are measured from each cluster's files
 * (median-cut quantize over every frame), and each cluster leads with its YAGI product shot.
 */
export const MOOD_LIBRARY = [
  { id: 'amber', product: 'amber-yagi', tiles: ['amber-1', 'amber-2'], palette: ['#513E2A', '#302517', '#181A11'] },
  { id: 'drape', product: 'drape-yagi', tiles: ['drape-2'], palette: ['#DBCCDA', '#7A5F50', '#462812'] },
  { id: 'smoke', product: 'smoke-yagi', tiles: ['smoke-1', 'smoke-2', 'smoke-3', 'smoke-4'], palette: ['#8F745F', '#755D4B', '#674D3A'] },
  { id: 'cream', product: 'cream-yagi', tiles: ['cream-1', 'cream-2', 'cream-3', 'cream-4'], palette: ['#D8D3D3', '#BFB7B2', '#332216'] },
  { id: 'flora', product: 'flora-yagi', tiles: ['flora-1', 'flora-2', 'flora-3', 'flora-4'], palette: ['#D8D6D3', '#0D0D09', '#050403'] },
  { id: 'botanic', product: 'botanic-yagi', tiles: ['botanic-1', 'botanic-2', 'botanic-3', 'botanic-4', 'botanic-5', 'botanic-6'], palette: ['#F5F3F5', '#E3E3E2', '#43372E'] },
  { id: 'mono', product: 'mono-yagi', tiles: ['mono-1', 'mono-2', 'mono-3', 'mono-4', 'mono-5'], palette: ['#B8B6B7', '#99989A', '#1C1E1C'] },
  { id: 'red', product: 'red-yagi', tiles: ['red-2', 'red-3'], palette: ['#6E0E10', '#560305', '#2A0203'] },
] as const;
const ROTATE_MS = 6000;
/** Panel order matches `copy.tabs`; ids are markup, not copy. */
const TAB_IDS = ['tag', 'search', 'make'] as const;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The hero glow as a fragment shader: three soft brand-colored fields drifting slowly, a little grain.
 * Plain WebGL, no library. The CSS radial stays underneath as the fallback and is hidden only once a
 * context exists. Renders one still frame under reduced motion and stops while off screen or hidden.
 */
const AURA_VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const AURA_FRAGMENT = `precision mediump float;
uniform vec2 r;uniform float t;
float f(vec2 u,vec2 c,float s){return smoothstep(s,0.,length(u-c));}
void main(){
  vec2 u=gl_FragCoord.xy/r;float a=r.x/r.y;u.x*=a;float m=a*.5;float k=t*.12;
  float b1=f(u,vec2(m+.16*sin(k*1.3),.56+.08*cos(k*1.1)),.62)*.62;
  float b2=f(u,vec2(m+.30*cos(k*.9+1.),.46+.10*sin(k*1.4+2.)),.48)*.48;
  float b3=f(u,vec2(m+.24*sin(k*.7+4.),.52+.12*cos(k*.8+3.)),.52)*.42;
  float s=b1+b2+b3;
  vec3 c=(vec3(.93,.12,.12)*b1+vec3(1.,.55,.66)*b2+vec3(1.,.78,.70)*b3)/max(s,.001);
  float g=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;
  float al=clamp(s*.5+g*.02,0.,1.);
  gl_FragColor=vec4(c*al,al);
}`;

function StudioAura({ onReady }: { onReady: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
    if (!canvas || !gl) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, AURA_VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, AURA_FRAGMENT);
    if (!vertex || !fragment) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, 'r');
    const time = gl.getUniformLocation(program, 't');

    // The aura is blurred anyway: half resolution is invisible and a quarter of the fill cost.
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
    };
    const draw = (seconds: number) => {
      gl.uniform1f(time, seconds);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    resize();
    draw(0);
    onReady();
    if (prefersReducedMotion()) return;

    let frame = 0;
    let visible = false;
    const start = performance.now();
    const loop = (now: number) => {
      draw((now - start) / 1000);
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      const run = visible && !document.hidden;
      if (run && !frame) frame = requestAnimationFrame(loop);
      if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      sync();
    });
    observer.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', resize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', resize);
    };
  }, [onReady]);

  return <canvas ref={canvasRef} aria-hidden="true" className={styles.auraCanvas} />;
}

export function StudioHeroStage({ copy }: { copy: StudioCopy }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(false);
  const markReady = useRef(() => setWebgl(true)).current;

  useIsomorphicLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    // The tiles gather over the first ~55% of a screen of scrolling, scrubbed through Lenis.
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(stage, { '--p': 0 }, {
        '--p': 1,
        ease: 'none',
        scrollTrigger: { trigger: document.documentElement, start: 0, end: () => window.innerHeight * 0.55, scrub: 0.6 },
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <div ref={stageRef} data-studio-stage data-webgl={webgl ? 'on' : undefined} className={styles.stage}>
      <div aria-hidden="true" className={styles.aura} />
      <StudioAura onReady={markReady} />
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
        <img src={studio('amber-yagi')} alt="" width={600} height={804} loading="lazy" decoding="async" />
        <span aria-hidden="true" className={`${styles.box} ${styles.appear}`} style={{ left: '20%', top: '22%', width: '56%', height: '56%', '--i': 1 } as Vars}>
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
          <li key={label} className={`${styles.variant} ${styles.appear}`} style={{ '--i': index } as Vars}>
            <div className={styles.variantMedia}><img src={VARIANTS[index]} alt="" width={240} height={300} loading="lazy" decoding="async" /></div>
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

type MoodTile = { key: string; mood: number; product: boolean };

/** Every frame once, in library order: each cluster's product shot first, then its frames. */
const MOOD_TILES: MoodTile[] = MOOD_LIBRARY.flatMap((mood, index) => [
  { key: mood.product, mood: index, product: true },
  ...mood.tiles.map((tile) => ({ key: tile, mood: index, product: false })),
]);

/** "Before": the same frames dealt out as an unsorted upload. Fixed, so server and client agree. */
const MIXED_ORDER: MoodTile[] = (() => {
  const tiles = [...MOOD_TILES];
  let seed = 7;
  for (let i = tiles.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
  }
  return tiles;
})();

function groupedOrder(focus: number | null): MoodTile[] {
  if (focus === null) return MOOD_TILES;
  return [...MOOD_TILES.filter((tile) => tile.mood === focus), ...MOOD_TILES.filter((tile) => tile.mood !== focus)];
}

/**
 * The aesthetic auto-sorting demo (PLATFORM-2.0 §20.3 "찾는다"): an unsorted pile of library frames
 * sorts itself into mood clusters when it scrolls into view (GSAP Flip), and choosing a mood brings its
 * tags, measured palette and the product shot made for it to the front. Under reduced motion the
 * frames simply sit in their clusters.
 */
export function StudioMoodClusters({ copy }: { copy: StudioCopy }) {
  const t = copy.moods;
  const gridRef = useRef<HTMLUListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const [sorted, setSorted] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const order = sorted ? groupedOrder(focus) : MIXED_ORDER;

  const change = (nextSorted: boolean, nextFocus: number | null) => {
    const grid = gridRef.current;
    if (grid && !prefersReducedMotion()) {
      gsap.registerPlugin(Flip);
      flipState.current = Flip.getState(grid.querySelectorAll('[data-mood-tile]'));
    }
    setSorted(nextSorted);
    setFocus(nextFocus);
  };

  useIsomorphicLayoutEffect(() => {
    const state = flipState.current;
    if (!state) return;
    flipState.current = null;
    // Tiles stay in flow (transform-only), so the grid keeps its height while they travel.
    Flip.from(state, { duration: 0.8, ease: 'power3.inOut', stagger: 0.012 });
  }, [sorted, focus]);

  // Sort itself once, when the top of the pile reaches the upper two thirds of the screen (tall on phones).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (prefersReducedMotion()) {
      setSorted(true);
      return;
    }
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      timer = window.setTimeout(() => change(true, null), 650);
    }, { rootMargin: '0px 0px -35% 0px' });
    observer.observe(grid);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const focused = focus === null ? null : MOOD_LIBRARY[focus]!;
  const firstOfMood = new Set<string>(MOOD_LIBRARY.map((mood) => mood.product));

  return (
    <div data-mood-clusters data-sorted={sorted ? 'true' : 'false'} className={styles.moods}>
      <div role="toolbar" aria-label={t.eyebrow} className={styles.moodChips}>
        <button type="button" aria-pressed={sorted && focus === null} data-mood-chip="all" className={styles.moodChip} onClick={() => change(true, null)}>
          {t.all}<span className={styles.moodCount}>{MOOD_TILES.length}</span>
        </button>
        {MOOD_LIBRARY.map((mood, index) => (
          <button key={mood.id} type="button" aria-pressed={focus === index} data-mood-chip={mood.id} className={styles.moodChip} onClick={() => change(true, focus === index ? null : index)}>
            <span aria-hidden="true" className={styles.moodDots}>{mood.palette.map((hex) => <span key={hex} style={{ background: hex }} />)}</span>
            {t.names[index]}
            <span className={styles.moodCount}>{mood.tiles.length + 1}</span>
          </button>
        ))}
      </div>

      <div aria-live="polite" className={styles.moodInfo} data-open={focused ? 'true' : 'false'}>
        {focused && focus !== null && (
          <>
            <p className={styles.moodInfoName}>{t.names[focus]}</p>
            <dl className={styles.moodInfoTags}>
              <div><dt>{t.light}</dt><dd>{t.tags[focus]!.light}</dd></div>
              <div><dt>{t.color}</dt><dd>{t.tags[focus]!.color}</dd></div>
              <div><dt>{t.mood}</dt><dd>{t.tags[focus]!.mood}</dd></div>
            </dl>
            <span aria-hidden="true" className={styles.moodPalette}>{focused.palette.map((hex) => <span key={hex} style={{ background: hex }}><em>{hex}</em></span>)}</span>
          </>
        )}
      </div>

      <ul ref={gridRef} className={styles.moodGrid}>
        {order.map((tile) => {
          const mood = MOOD_LIBRARY[tile.mood]!;
          const feature = focus === tile.mood && tile.product;
          const dim = focus !== null && focus !== tile.mood;
          return (
            <li
              key={tile.key}
              data-mood-tile={mood.id}
              data-flip-id={tile.key}
              data-dim={dim ? 'true' : undefined}
              className={`${styles.moodTile} ${feature ? styles.moodFeature : ''}`}
            >
              <img src={studio(tile.key)} alt="" width={360} height={450} loading="lazy" decoding="async" />
              {sorted && focus === null && firstOfMood.has(tile.key) && (
                <span className={styles.moodBadge}><span aria-hidden="true" style={{ background: mood.palette[0] }} />{t.names[tile.mood]}</span>
              )}
              {feature && <span className={styles.moodProduct}>{t.product}</span>}
            </li>
          );
        })}
      </ul>
      <p className={styles.moodNote}>{t.note}</p>
    </div>
  );
}
