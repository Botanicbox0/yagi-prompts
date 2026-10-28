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

/** The search demo: three frames that really show smoke, three that do not. */
const SEARCH_CELLS = [
  { src: studio('p-smoke-1'), hit: true },
  { src: studio('cream-1'), hit: false },
  { src: studio('smoke-1'), hit: true },
  { src: studio('flora-1'), hit: false },
  { src: studio('p-smoke-2'), hit: true },
  { src: studio('red-2'), hit: false },
] as const;

/** Dominant colors measured from p-amber-1.webp (median-cut quantize), not invented. */
const SWATCHES = ['#5E3819', '#854C20', '#CFA161'] as const;
/** One bottle, regenerated in other moods: the cut-out, then three moods. */
const VARIANTS = [studio('bottle-amber'), studio('x-drape'), studio('x-botanic'), studio('x-mono')] as const;

/**
 * Mood clusters for the auto-sorting demo. Every mood has its own bottle (one family, eight forms),
 * its own textured folder, two product shots and the library frames that share its mood. Palettes are
 * measured from each cluster's files (median-cut quantize over every frame).
 */
export const MOOD_LIBRARY = [
  { id: 'amber', product: 'p-amber-1', tiles: ['p-amber-2'], palette: ['#5F391B', '#CC9E62', '#7D3007'], folder: 'folder-amber', bottle: 'bottle-amber' },
  { id: 'drape', product: 'p-drape-1', tiles: ['p-drape-2'], palette: ['#C28A83', '#D6B1AB', '#E0CCC7'], folder: 'folder-drape', bottle: 'bottle-drape' },
  { id: 'smoke', product: 'p-smoke-1', tiles: ['smoke-1', 'p-smoke-2', 'smoke-2', 'smoke-3', 'smoke-4'], palette: ['#856B58', '#6D5947', '#130E08'], folder: 'folder-smoke', bottle: 'bottle-smoke' },
  { id: 'cream', product: 'p-cream-1', tiles: ['cream-1', 'p-cream-2', 'cream-2', 'cream-3', 'cream-4'], palette: ['#D5CFCB', '#5D3D2A', '#E5E1DE'], folder: 'folder-cream', bottle: 'bottle-cream' },
  { id: 'flora', product: 'p-flora-1', tiles: ['flora-1', 'p-flora-2', 'flora-2', 'flora-3', 'flora-4'], palette: ['#090907', '#DCD7D0', '#E9E6E4'], folder: 'folder-flora', bottle: 'bottle-flora' },
  { id: 'botanic', product: 'p-botanic-1', tiles: ['botanic-1', 'botanic-2', 'p-botanic-2', 'botanic-3', 'botanic-4', 'botanic-5', 'botanic-6'], palette: ['#EAE9E9', '#B3B0A5', '#DCDBDA'], folder: 'folder-botanic', bottle: 'bottle-botanic' },
  { id: 'mono', product: 'p-mono-1', tiles: ['mono-1', 'p-mono-2', 'mono-2', 'mono-3', 'mono-4', 'mono-5'], palette: ['#AFAEAE', '#6E6F6E', '#1E201E'], folder: 'folder-mono', bottle: 'bottle-mono' },
  { id: 'red', product: 'p-red-1', tiles: ['red-2', 'p-red-2', 'red-3'], palette: ['#DED2C0', '#570304', '#240302'], folder: 'folder-red', bottle: 'bottle-red' },
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
  float b3=f(u,vec2(m+.24*sin(k*.7+4.),.52+.12*cos(k*.8+3.)),.36)*.22;
  float s=b1+b2+b3;
  vec3 c=(vec3(.82,.52,.26)*b1+vec3(.86,.72,.80)*b2+vec3(.93,.12,.12)*b3)/max(s,.001);
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

const ORBIT_PERIOD_S = 64;

/** Where a bottle sits on the ring for a given angle: front is lower, larger, sharper. */
function orbitStyle(index: number, count: number, angle: number, rx: number, ry: number): CSSProperties {
  const a = angle + (index / count) * Math.PI * 2;
  const x = Math.sin(a);
  const z = Math.cos(a);
  const scale = 0.58 + (z + 1) * 0.23;
  return {
    transform: `translate(-50%, -100%) translate(${(x * rx).toFixed(1)}px, ${(z * ry).toFixed(1)}px) scale(${scale.toFixed(3)})`,
    zIndex: Math.round((z + 1) * 10),
    opacity: (0.5 + (z + 1) * 0.25).toFixed(3),
    filter: z < -0.2 ? `blur(${((-z - 0.2) * 2.2).toFixed(2)}px)` : 'none',
  };
}

export function StudioHeroOrbit({ copy }: { copy: StudioCopy }) {
  const ringRef = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(false);
  const markReady = useRef(() => setWebgl(true)).current;
  const count = MOOD_LIBRARY.length;

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const items = Array.from(ring.querySelectorAll<HTMLElement>('[data-orbit-bottle]'));
    let angle = 0;
    let last = performance.now();
    let frame = 0;
    let hovered = false;
    let visible = true;
    const place = () => {
      const rx = ring.clientWidth * 0.4;
      const ry = ring.clientHeight * 0.2;
      items.forEach((el, i) => Object.assign(el.style, orbitStyle(i, count, angle, rx, ry)));
    };
    place();
    if (prefersReducedMotion()) {
      window.addEventListener('resize', place);
      return () => window.removeEventListener('resize', place);
    }
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!hovered) angle -= (dt / ORBIT_PERIOD_S) * Math.PI * 2;
      place();
      frame = requestAnimationFrame(loop);
    };
    const sync = () => {
      const run = visible && !document.hidden;
      if (run && !frame) { last = performance.now(); frame = requestAnimationFrame(loop); }
      if (!run && frame) { cancelAnimationFrame(frame); frame = 0; }
    };
    const enter = () => { hovered = true; };
    const leave = () => { hovered = false; };
    ring.addEventListener('pointerenter', enter);
    ring.addEventListener('pointerleave', leave);
    ring.addEventListener('focusin', enter);
    ring.addEventListener('focusout', leave);
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); sync(); });
    observer.observe(ring);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', place);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      ring.removeEventListener('pointerenter', enter);
      ring.removeEventListener('pointerleave', leave);
      ring.removeEventListener('focusin', enter);
      ring.removeEventListener('focusout', leave);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', place);
    };
  }, [count]);

  return (
    <div data-studio-orbit data-webgl={webgl ? 'on' : undefined} className={styles.orbitStage}>
      <div aria-hidden="true" className={styles.aura} />
      <StudioAura onReady={markReady} />
      <div ref={ringRef} className={styles.orbit} aria-label={copy.moods.eyebrow}>
        <span aria-hidden="true" className={styles.orbitTrack} />
        {MOOD_LIBRARY.map((mood, index) => (
          <a
            key={mood.id}
            href={`#mood-${mood.id}`}
            data-orbit-bottle={mood.id}
            className={styles.orbitBottle}
            // Server render: the ring at rest, so nothing jumps when the loop starts.
            style={orbitStyle(index, count, 0, 440, 70)}
          >
            <img src={studio(mood.bottle)} alt="" width={260} height={325} loading="eager" fetchPriority={index < 3 ? 'high' : 'auto'} decoding="async" />
            <span className={styles.orbitLabel}>{copy.moods.names[index]}</span>
          </a>
        ))}
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
        <img src={studio('p-amber-1')} alt="" width={600} height={750} loading="lazy" decoding="async" />
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
  // Read by the delayed auto-sort, so a folder opened first (a hero bottle, a click) is not reset to "all".
  const sortedRef = useRef(false);

  const change = (nextSorted: boolean, nextFocus: number | null) => {
    sortedRef.current = nextSorted;
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
      timer = window.setTimeout(() => { if (!sortedRef.current) change(true, null); }, 650);
    }, { rootMargin: '0px 0px -35% 0px' });
    observer.observe(grid);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  // A bottle in the hero links to #mood-<id>: open that folder on arrival and on later clicks.
  useEffect(() => {
    const open = () => {
      const match = window.location.hash.match(/^#mood-([a-z]+)$/);
      const index = match ? MOOD_LIBRARY.findIndex((mood) => mood.id === match[1]) : -1;
      if (index >= 0) change(true, index);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  const focused = focus === null ? null : MOOD_LIBRARY[focus]!;
  const firstOfMood = new Set<string>(MOOD_LIBRARY.map((mood) => mood.product));

  return (
    <div data-mood-clusters data-sorted={sorted ? 'true' : 'false'} className={styles.moods}>
      <div role="toolbar" aria-label={t.eyebrow} className={styles.folders}>
        <button type="button" aria-pressed={sorted && focus === null} data-mood-chip="all" className={styles.folderAll} onClick={() => change(true, null)}>
          <span className={styles.folderAllStack} aria-hidden="true">{MOOD_LIBRARY.slice(0, 3).map((mood) => <img key={mood.id} src={studio(mood.folder)} alt="" width={60} height={60} loading="lazy" decoding="async" />)}</span>
          <span className={styles.folderName}>{t.all}</span>
          <span className={styles.folderCount}>{MOOD_TILES.length}</span>
        </button>
        {MOOD_LIBRARY.map((mood, index) => (
          <button key={mood.id} id={`mood-${mood.id}`} type="button" aria-pressed={focus === index} data-mood-chip={mood.id} className={`${styles.folder} scroll-mt-28`} onClick={() => change(true, focus === index ? null : index)}>
            <img src={studio(mood.folder)} alt="" width={120} height={120} loading="lazy" decoding="async" />
            <span className={styles.folderName}>{t.names[index]}</span>
            <span className={styles.folderCount}>{mood.tiles.length + 1}</span>
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

/**
 * Try-on (beta), PLATFORM-2.0 §20.8. Lookbook is the Americano shape (fixed cuts on white); free mode
 * relaxes scene, pose and ratio while the garment and the virtual model stay locked. Both panels ship in
 * the initial HTML; only the visible one changes.
 */
const VTO_LOOK = ['vto-look-front', 'vto-look-upper', 'vto-look-side'] as const;
const VTO_FREE = [
  { name: 'vto-free-amber', ratio: '3 / 4' },
  { name: 'vto-free-alley', ratio: '9 / 16' },
  { name: 'vto-free-mirror', ratio: '9 / 16' },
  { name: 'vto-free-sofa', ratio: '3 / 4' },
  { name: 'vto-free-drape', ratio: '3 / 4' },
] as const;
const VTO_MODES = ['lookbook', 'free'] as const;

export function StudioVto({ copy }: { copy: StudioCopy }) {
  const t = copy.vto;
  const [mode, setMode] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = mode === 0 ? 1 : 0;
    setMode(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div data-vto className={styles.vto}>
      <aside className={styles.vtoInput}>
        <figure className={styles.vtoGarment}>
          <img src={studio('vto-garment')} alt="" width={480} height={480} loading="lazy" decoding="async" />
          <figcaption><span>{t.garmentNote}</span>{t.garment}</figcaption>
        </figure>
        <div className={styles.vtoLists}>
          <div>
            <p className={styles.vtoListLabel}>{t.lockLabel}</p>
            <ul>{t.locks.map((item) => <li key={item}><span aria-hidden="true" className={styles.vtoLockMark} />{item}</li>)}</ul>
          </div>
          <div data-active={mode === 1 ? 'true' : 'false'} className={styles.vtoFrees}>
            <p className={styles.vtoListLabel}>{t.freeLabel}</p>
            <ul>{t.frees.map((item) => <li key={item}><span aria-hidden="true" className={styles.vtoFreeMark} />{item}</li>)}</ul>
          </div>
        </div>
      </aside>

      <div className={styles.vtoStage}>
        <div role="tablist" aria-label={t.eyebrow} className={styles.vtoModes}>
          {t.modes.map((item, index) => (
            <button
              key={VTO_MODES[index]}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              id={`vto-tab-${VTO_MODES[index]}`}
              aria-controls={`vto-panel-${VTO_MODES[index]}`}
              aria-selected={mode === index}
              tabIndex={mode === index ? 0 : -1}
              data-vto-mode={VTO_MODES[index]}
              className={styles.vtoMode}
              onClick={() => setMode(index)}
              onKeyDown={onKeyDown}
            >
              <span className={styles.vtoModeLabel}>{item.label}{index === 1 && <em>{copy.beta}</em>}</span>
              <span className={styles.vtoModeBody}>{item.body}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel" id="vto-panel-lookbook" aria-labelledby="vto-tab-lookbook" hidden={mode !== 0} data-vto-panel="lookbook" className={styles.vtoLook}>
          {VTO_LOOK.map((name, index) => (
            <figure key={name} className={styles.appear} style={{ '--i': index } as Vars}>
              <img src={studio(name)} alt="" width={420} height={560} loading="lazy" decoding="async" />
              <figcaption>{t.lookbookCuts[index]}</figcaption>
            </figure>
          ))}
        </div>
        <div role="tabpanel" id="vto-panel-free" aria-labelledby="vto-tab-free" hidden={mode !== 1} data-vto-panel="free" className={styles.vtoFree}>
          {VTO_FREE.map((cut, index) => (
            <figure key={cut.name} className={styles.appear} style={{ '--i': index, aspectRatio: cut.ratio } as Vars}>
              <img src={studio(cut.name)} alt="" width={420} height={560} loading="lazy" decoding="async" />
              <figcaption>{t.freeCuts[index]}</figcaption>
            </figure>
          ))}
        </div>
        <p className={styles.vtoNote}>{t.note}</p>
      </div>
    </div>
  );
}
