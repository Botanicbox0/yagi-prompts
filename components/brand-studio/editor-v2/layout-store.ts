'use client';

import {
  ASSIST_BAR_HEIGHT,
  DEFAULT_EDITOR_HEIGHT,
  DEFAULT_EDITOR_LAYOUT,
  LANE_GAP,
  LANE_KINDS,
  LANE_MAX_HEIGHT,
  LANE_MIN_HEIGHT,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  MAX_STORED_TIMELINE_HEIGHT,
  MAX_TIMELINE_RATIO,
  MIN_PREVIEW_HEIGHT,
  PREVIEW_CHROME_HEIGHT,
  REAL_BASE_LANES,
  ROOT_GAP,
  ROOT_MIN_HEIGHT,
  ROOT_SHELL_MARGIN,
  RULER_HEIGHT,
  SAMPLE_BASE_LANES,
  SAMPLE_WORKSPACE_OVERRIDES,
  TIMELINE_CHROME_HEIGHT,
  TOP_BAR_HEIGHT,
  parseEditorLayout,
  sanitizeEditorLayout,
  type EditorLayout,
  type TimelineBounds,
} from './layout-model';

const PREPAINT_CONFIG = JSON.stringify({
  k: LAYOUT_STORAGE_KEY,
  v: LAYOUT_VERSION,
  l: LANE_KINDS,
  minL: LANE_MIN_HEIGHT,
  maxL: LANE_MAX_HEIGHT,
  maxT: MAX_STORED_TIMELINE_HEIGHT,
  ratio: MAX_TIMELINE_RATIO,
  minP: MIN_PREVIEW_HEIGHT,
  pCh: PREVIEW_CHROME_HEIGHT,
  tlCh: TIMELINE_CHROME_HEIGHT,
  rul: RULER_HEIGHT,
  lGap: LANE_GAP,
  rGap: ROOT_GAP,
  topH: TOP_BAR_HEIGHT,
  astH: ASSIST_BAR_HEIGHT,
  defH: DEFAULT_EDITOR_HEIGHT,
  minRoot: ROOT_MIN_HEIGHT,
  shell: ROOT_SHELL_MARGIN,
  sampleTitles: SAMPLE_BASE_LANES.titles,
  realVideo: REAL_BASE_LANES.video,
  sampleVideo: {
    cut: SAMPLE_BASE_LANES.video,
    color: SAMPLE_WORKSPACE_OVERRIDES.color.video ?? SAMPLE_BASE_LANES.video,
    sound: SAMPLE_WORKSPACE_OVERRIDES.sound.video ?? SAMPLE_BASE_LANES.video,
    captions: SAMPLE_WORKSPACE_OVERRIDES.captions.video ?? SAMPLE_BASE_LANES.video,
  },
});

/**
 * Generates an inline script emitted inside `.root` (when a CSP nonce is present) to apply saved
 * timeline/lane sizes before first paint with only a loose safety bound (React enforces the exact
 * measured bound after mount only when exceeded, preventing a post-hydration jump on ordinary values).
 * Assistant dock is deliberately applied after mount (R4) so server-rendered bar contents never flash.
 */
export function layoutPrepaintScript(): string {
  return (
    '(function(c){var s=document.currentScript,e=s&&s.parentElement;if(!e)return;' +
    'try{' +
    'var r=window.localStorage.getItem(c.k);if(!r)return;' +
    'var d=JSON.parse(r);if(!d||typeof d!=="object"||Array.isArray(d)||d.v!==c.v)return;' +
    'var sized=false,vl=null;' +
    'if(d.lanes&&typeof d.lanes==="object"&&!Array.isArray(d.lanes)){' +
    'for(var i=0;i<c.l.length;i++){var n=c.l[i],w=d.lanes[n];' +
    'if(typeof w==="number"&&isFinite(w)){var lh=Math.min(c.maxL,Math.max(c.minL,Math.round(w)));e.style.setProperty("--ev-h-"+n,lh+"px");if(n==="video")vl=lh;sized=true;}}' +
    '}' +
    'var ih=window.innerHeight>0?Math.max(c.minRoot,window.innerHeight-c.shell):c.defH;' +
    'var rectH=e.getBoundingClientRect&&e.getBoundingClientRect().height;' +
    'var eh=rectH>=200?Math.round(rectH):ih;' +
    'var maxP=Math.max(0,Math.floor(eh-c.topH-2*c.rGap-(c.minP+c.pCh)));' +
    'var maxT=Math.min(Math.max(0,Math.floor(eh*c.ratio)),maxP);' +
    'if(typeof d.timelineHeight==="number"&&isFinite(d.timelineHeight)&&d.timelineHeight>0){' +
    'var isReal=e.getAttribute("data-editor-mode")==="real";' +
    'var ws=e.getAttribute("data-ws")||"cut";' +
    'var vH=vl!==null?vl:(isReal?c.realVideo:(c.sampleVideo[ws]||c.sampleVideo.cut));' +
    'var tC=d.lanes&&typeof d.lanes.titles==="number"&&isFinite(d.lanes.titles)?Math.min(c.maxL,Math.max(c.minL,Math.round(d.lanes.titles))):c.sampleTitles;' +
    'var rawMin=isReal?Math.round(c.tlCh+c.rul+c.lGap+vH):Math.round(c.tlCh+c.rul+tC+2*c.lGap+vH);' +
    'var minT=Math.min(rawMin,maxT);' +
    'var th=Math.min(c.maxT,Math.round(d.timelineHeight));' +
    'e.style.setProperty("--ev-timeline-h",Math.min(maxT,Math.max(minT,th))+"px");' +
    'sized=true;' +
    '}' +
    'if(sized){e.setAttribute("data-sized","");e.style.setProperty("--ev-timeline-max",maxT+"px");}' +
    '}catch(x){}' +
    '})(' +
    PREPAINT_CONFIG +
    ');'
  );
}

/**
 * Where a person's timeline and assistant-dock layout is kept: this browser.
 *
 * Storage can be missing, full or blocked, so every access stays inside a try/catch block and the
 * editor works with defaults without throwing.
 */
export function loadEditorLayout(bounds?: TimelineBounds): EditorLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? parseEditorLayout(JSON.parse(raw), bounds) : DEFAULT_EDITOR_LAYOUT;
  } catch {
    return DEFAULT_EDITOR_LAYOUT;
  }
}

export function saveEditorLayout(layout: EditorLayout): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(sanitizeEditorLayout(layout)));
  } catch {
    // Nothing to do: the layout stays active for this visit.
  }
}
