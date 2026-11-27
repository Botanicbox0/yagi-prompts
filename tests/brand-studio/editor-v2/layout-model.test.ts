import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSIST_BAR_HEIGHT,
  DECODE_HEIGHT_STEPS,
  DEFAULT_EDITOR_LAYOUT,
  LANE_GAP,
  LANE_KINDS,
  LANE_MAX_HEIGHT,
  LANE_MIN_HEIGHT,
  LAYOUT_STORAGE_KEY,
  MIN_PREVIEW_HEIGHT,
  MIN_TILE_PX,
  PREVIEW_CHROME_HEIGHT,
  RULER_HEIGHT,
  TIMELINE_CHROME_HEIGHT,
  TOP_BAR_HEIGHT,
  aboveVideoLaneHeights,
  clampLaneHeight,
  clampLayoutForViewport,
  clampTimelineHeight,
  defaultLaneHeight,
  defaultTimelineHeight,
  effectiveLaneHeight,
  filmstripSampleStep,
  filmstripTileWidth,
  isLayoutSized,
  parseEditorLayout,
  stepLaneByKey,
  stepTimelineByKey,
  thumbDecodeHeight,
  timelineBounds,
  visibleLanes,
  withAssistDock,
  withLaneHeight,
  withTimelineHeight,
} from '@/components/brand-studio/editor-v2/layout-model';
import { layoutPrepaintScript, loadEditorLayout, saveEditorLayout } from '@/components/brand-studio/editor-v2/layout-store';
import { EDITOR_WORKSPACES } from '@/lib/brand-studio/editor-v2/model';

const ROOT = process.cwd();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor-v2 layout-model', () => {
  it('clamps lane heights to [22, 160] and handles invalid inputs', () => {
    expect(LANE_MIN_HEIGHT).toBe(22);
    expect(LANE_MAX_HEIGHT).toBe(160);
    expect(clampLaneHeight(10)).toBe(22);
    expect(clampLaneHeight(22)).toBe(22);
    expect(clampLaneHeight(75.6)).toBe(76);
    expect(clampLaneHeight(160)).toBe(160);
    expect(clampLaneHeight(300)).toBe(160);
    expect(clampLaneHeight(Number.NaN)).toBe(22);
    expect(clampLaneHeight(Number.POSITIVE_INFINITY)).toBe(22);
  });

  it('preserves exact per-workspace default lane heights when untouched, and lets customer overrides apply across workspaces', () => {
    expect(visibleLanes(false)).toEqual(['titles', 'video', 'captions', 'voice', 'music']);
    expect(visibleLanes(true)).toEqual(['video', 'captions']);

    expect(Object.fromEntries(LANE_KINDS.map((k) => [k, defaultLaneHeight(k, 'cut', false)]))).toEqual({
      titles: 22,
      video: 54,
      captions: 22,
      voice: 28,
      music: 28,
    });
    expect(Object.fromEntries(LANE_KINDS.map((k) => [k, defaultLaneHeight(k, 'color', false)]))).toEqual({
      titles: 22,
      video: 66,
      captions: 22,
      voice: 22,
      music: 22,
    });
    expect(Object.fromEntries(LANE_KINDS.map((k) => [k, defaultLaneHeight(k, 'sound', false)]))).toEqual({
      titles: 22,
      video: 34,
      captions: 22,
      voice: 40,
      music: 40,
    });
    expect(Object.fromEntries(LANE_KINDS.map((k) => [k, defaultLaneHeight(k, 'captions', false)]))).toEqual({
      titles: 22,
      video: 40,
      captions: 38,
      voice: 28,
      music: 22,
    });
    for (const ws of EDITOR_WORKSPACES) {
      expect(defaultLaneHeight('video', ws, true)).toBe(64);
      expect(defaultLaneHeight('captions', ws, true)).toBe(24);
    }

    const custom = withLaneHeight(DEFAULT_EDITOR_LAYOUT, 'video', 110);
    for (const ws of EDITOR_WORKSPACES) {
      expect(effectiveLaneHeight(custom, 'video', ws, false)).toBe(110);
      expect(effectiveLaneHeight(custom, 'video', ws, true)).toBe(110);
    }
    expect(effectiveLaneHeight(custom, 'voice', 'cut', false)).toBe(28);
    expect(effectiveLaneHeight(custom, 'voice', 'sound', false)).toBe(40);
    expect(effectiveLaneHeight(custom, 'captions', 'captions', false)).toBe(38);

    const reset = withLaneHeight(custom, 'video', null);
    expect(reset.lanes.video).toBeUndefined();
    expect(effectiveLaneHeight(reset, 'video', 'color', false)).toBe(66);
    expect(effectiveLaneHeight(reset, 'video', 'cut', true)).toBe(64);
  });

  it('computes timeline min/max bounds honoring preview floor (180px + preview chrome), 65% editor cap, and lanes above video + video floor', () => {
    const boundsTall = timelineBounds({
      editorHeight: 1000,
      assistDock: 'bar',
      videoLaneHeight: 54,
      aboveVideoHeights: [22],
      topBarHeight: TOP_BAR_HEIGHT,
      assistBarHeight: ASSIST_BAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    });
    expect(boundsTall.min).toBe(TIMELINE_CHROME_HEIGHT + RULER_HEIGHT + 22 + 2 * LANE_GAP + 54);
    expect(boundsTall.max).toBe(Math.floor(1000 * 0.65));

    const boundsShortBar = timelineBounds({
      editorHeight: 700,
      assistDock: 'bar',
      videoLaneHeight: 54,
      aboveVideoHeights: [22],
      topBarHeight: TOP_BAR_HEIGHT,
      assistBarHeight: ASSIST_BAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    });
    // Available for preview + bottom = 700 - 44 - 16 = 640; preview >= 180 + 58 (238) => bottom <= 402; minus assistBar (44) + gap (8) => max timeline = 350
    expect(boundsShortBar.max).toBe(700 - TOP_BAR_HEIGHT - 16 - (MIN_PREVIEW_HEIGHT + PREVIEW_CHROME_HEIGHT) - ASSIST_BAR_HEIGHT - 8);
    expect(boundsShortBar.max).toBe(350);
    expect(boundsShortBar.max).toBeLessThanOrEqual(Math.floor(700 * 0.65));

    const boundsShortSide = timelineBounds({
      editorHeight: 700,
      assistDock: 'side',
      videoLaneHeight: 54,
      topBarHeight: TOP_BAR_HEIGHT,
      assistBarHeight: ASSIST_BAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    });
    // With assist in side column, bottom holds only timeline => max timeline = min(65% (455), 640 - 238) = 402
    expect(boundsShortSide.max).toBe(402);

    // Real mode has no lanes above video; sample mode includes titles above video
    expect(aboveVideoLaneHeights(DEFAULT_EDITOR_LAYOUT, 'cut', true)).toEqual([]);
    expect(aboveVideoLaneHeights(DEFAULT_EDITOR_LAYOUT, 'cut', false)).toEqual([22]);
    expect(aboveVideoLaneHeights(withLaneHeight(DEFAULT_EDITOR_LAYOUT, 'titles', 36), 'cut', false)).toEqual([36]);

    // When video lane is tall (160px), min timeline grows to fit ruler + lanes above video + video lane
    const boundsTallLane = timelineBounds({
      editorHeight: 900,
      assistDock: 'bar',
      videoLaneHeight: 160,
    });
    expect(boundsTallLane.min).toBe(TIMELINE_CHROME_HEIGHT + RULER_HEIGHT + LANE_GAP + 160);

    // Extreme tiny viewport: preview floor still dominates so min <= max
    const boundsTiny = timelineBounds({
      editorHeight: 360,
      assistDock: 'bar',
      videoLaneHeight: 160,
    });
    expect(boundsTiny.min).toBeLessThanOrEqual(boundsTiny.max);
    expect(clampTimelineHeight(300, boundsTiny)).toBe(boundsTiny.max);
  });

  it('re-clamps saved timeline height when window shrinks', () => {
    const saved = withTimelineHeight(DEFAULT_EDITOR_LAYOUT, 560);
    const smallBounds = timelineBounds({
      editorHeight: 700,
      assistDock: 'bar',
      videoLaneHeight: 54,
    });
    const clamped = clampLayoutForViewport(saved, smallBounds);
    expect(clamped.timelineHeight).toBe(smallBounds.max);
    expect(clamped.timelineHeight!).toBeLessThan(560);
    expect(clampLayoutForViewport(DEFAULT_EDITOR_LAYOUT, smallBounds).timelineHeight).toBeNull();
  });

  it('handles keyboard steps for main timeline handle and lane handles and ignores modified chords', () => {
    const bounds = { min: 128, max: 520 };
    expect(stepTimelineByKey('ArrowUp', 200, bounds)).toEqual({ handled: true, next: 216 });
    expect(stepTimelineByKey('ArrowDown', 200, bounds)).toEqual({ handled: true, next: 184 });
    expect(stepTimelineByKey('ArrowUp', 515, bounds)).toEqual({ handled: true, next: 520 });
    expect(stepTimelineByKey('ArrowDown', 135, bounds)).toEqual({ handled: true, next: 128 });
    expect(stepTimelineByKey('Home', 250, bounds)).toEqual({ handled: true, next: 128 });
    expect(stepTimelineByKey('End', 250, bounds)).toEqual({ handled: true, next: 520 });
    expect(stepTimelineByKey('Enter', 250, bounds)).toEqual({ handled: true, next: null });
    expect(stepTimelineByKey('Space', 250, bounds)).toEqual({ handled: false, next: 250 });
    expect(stepTimelineByKey('ArrowUp', 200, bounds, { shiftKey: true })).toEqual({ handled: false, next: 200 });
    expect(stepTimelineByKey('Enter', 250, bounds, { metaKey: true })).toEqual({ handled: false, next: 250 });

    expect(stepLaneByKey('ArrowDown', 54)).toEqual({ handled: true, next: 58 });
    expect(stepLaneByKey('ArrowUp', 54)).toEqual({ handled: true, next: 50 });
    expect(stepLaneByKey('ArrowDown', 158)).toEqual({ handled: true, next: 160 });
    expect(stepLaneByKey('ArrowUp', 23)).toEqual({ handled: true, next: 22 });
    expect(stepLaneByKey('Home', 54)).toEqual({ handled: true, next: 22 });
    expect(stepLaneByKey('End', 54)).toEqual({ handled: true, next: 160 });
    expect(stepLaneByKey('Enter', 80)).toEqual({ handled: true, next: null });
    expect(stepLaneByKey('Tab', 80)).toEqual({ handled: false, next: 80 });
    expect(stepLaneByKey('ArrowDown', 54, { shiftKey: true })).toEqual({ handled: false, next: 54 });
    expect(stepLaneByKey('ArrowUp', 54, { ctrlKey: true })).toEqual({ handled: false, next: 54 });
  });

  it('tracks isLayoutSized and computes filmstrip tile width & decode steps without increasing frame density', () => {
    expect(isLayoutSized(DEFAULT_EDITOR_LAYOUT)).toBe(false);
    expect(isLayoutSized(withAssistDock(DEFAULT_EDITOR_LAYOUT, 'side'))).toBe(false);
    expect(isLayoutSized(withTimelineHeight(DEFAULT_EDITOR_LAYOUT, 300))).toBe(true);
    expect(isLayoutSized(withLaneHeight(DEFAULT_EDITOR_LAYOUT, 'video', 100))).toBe(true);

    expect(defaultTimelineHeight(DEFAULT_EDITOR_LAYOUT, 'cut', false)).toBe(244);
    expect(defaultTimelineHeight(DEFAULT_EDITOR_LAYOUT, 'cut', true)).toBe(166);

    // Untouched video lane keeps main's exact 96px tiles and 72px decode height across aspect ratios
    expect(filmstripTileWidth(undefined, 16 / 9)).toBe(MIN_TILE_PX);
    expect(filmstripTileWidth(undefined, 9 / 16)).toBe(MIN_TILE_PX);
    expect(thumbDecodeHeight(undefined)).toBe(72);

    // Sized video lane uses clip aspect ratio quantized to 16px steps, and steps decode height
    expect(DECODE_HEIGHT_STEPS).toEqual([72, 108, 144, 160]);
    expect(thumbDecodeHeight(54)).toBe(72);
    expect(thumbDecodeHeight(72)).toBe(72);
    expect(thumbDecodeHeight(73)).toBe(108);
    expect(thumbDecodeHeight(108)).toBe(108);
    expect(thumbDecodeHeight(109)).toBe(144);
    expect(thumbDecodeHeight(144)).toBe(144);
    expect(thumbDecodeHeight(145)).toBe(160);
    expect(thumbDecodeHeight(160)).toBe(160);

    expect(filmstripTileWidth(120, 16 / 9)).toBe(208);
    expect(filmstripTileWidth(160, 16 / 9)).toBe(288);
    expect(filmstripTileWidth(110, 9 / 16)).toBe(64);
    expect(filmstripSampleStep(64)).toBe(MIN_TILE_PX);
    expect(filmstripSampleStep(208)).toBe(208);
  });

  it('parses and sanitizes stored layout values strictly', () => {
    expect(parseEditorLayout(null)).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(parseEditorLayout([])).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(parseEditorLayout({ v: 2, timelineHeight: 300, lanes: { video: 90 }, assistDock: 'side' })).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(
      parseEditorLayout(
        {
          v: 1,
          timelineHeight: 9999,
          lanes: { video: 5, music: 500, captions: Number.NaN, unknown: 80 },
          assistDock: 'invalid',
        },
        { min: 128, max: 420 },
      ),
    ).toEqual({
      v: 1,
      timelineHeight: 420,
      lanes: { video: 22, music: 160 },
      assistDock: 'bar',
    });
    expect(parseEditorLayout({ v: 1, timelineHeight: -5, lanes: {}, assistDock: 'side' })).toEqual({
      v: 1,
      timelineHeight: null,
      lanes: {},
      assistDock: 'side',
    });
  });
});

describe('editor-v2 layout-store', () => {
  it('round-trips through twings_editor_layout_v1 and resists corrupt data or throwing storage', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
      },
    });
    expect(LAYOUT_STORAGE_KEY).toBe('twings_editor_layout_v1');
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);

    const saved = withAssistDock(withLaneHeight(withTimelineHeight(DEFAULT_EDITOR_LAYOUT, 340), 'video', 96), 'side');
    saveEditorLayout(saved);
    expect(JSON.parse(map.get(LAYOUT_STORAGE_KEY)!)).toEqual(saved);
    expect(loadEditorLayout()).toEqual(saved);

    map.set(LAYOUT_STORAGE_KEY, '{not-json');
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);

    map.set(LAYOUT_STORAGE_KEY, JSON.stringify({ v: 99, timelineHeight: 300, lanes: { video: 999 }, assistDock: 'side' }));
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);

    map.set(LAYOUT_STORAGE_KEY, JSON.stringify({ v: 1, timelineHeight: 1200, lanes: { video: 4, captions: 300 }, assistDock: 'bar' }));
    expect(loadEditorLayout({ min: 128, max: 400 })).toEqual({
      v: 1,
      timelineHeight: 400,
      lanes: { video: 22, captions: 160 },
      assistDock: 'bar',
    });

    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    expect(loadEditorLayout()).toEqual(DEFAULT_EDITOR_LAYOUT);
    expect(() => saveEditorLayout(saved)).not.toThrow();
  });

  it('generates valid pre-paint script that sets saved CSS variables without throwing or dirtying defaults', () => {
    const script = layoutPrepaintScript();
    expect(script).toContain(LAYOUT_STORAGE_KEY);
    // Must parse as valid ES script
    expect(() => new Function(script)).not.toThrow();

    const makeMockRoot = () => {
      const attrs = new Map<string, string>([
        ['data-editor-mode', 'sample'],
        ['data-ws', 'cut'],
        ['data-dock', 'bar'],
      ]);
      const styles = new Map<string, string>();
      const el = {
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        hasAttribute: (k: string) => attrs.has(k),
        getBoundingClientRect: () => ({ height: 900 }),
        style: {
          setProperty: (k: string, v: string) => styles.set(k, v),
          getPropertyValue: (k: string) => styles.get(k) ?? '',
        },
      };
      return { el, attrs, styles };
    };

    const runWithStorage = (getItem: (key: string) => string | null) => {
      const mock = makeMockRoot();
      vi.stubGlobal('window', { innerHeight: 924, localStorage: { getItem } });
      vi.stubGlobal('document', { currentScript: { parentElement: mock.el } });
      new Function(script)();
      return mock;
    };

    // Empty storage: leaves default root untouched (no data-sized, no --ev-timeline-h)
    const clean = runWithStorage(() => null);
    expect(clean.attrs.has('data-sized')).toBe(false);
    expect(clean.attrs.get('data-dock')).toBe('bar');
    expect(clean.styles.size).toBe(0);

    // Throwing storage: caught cleanly
    const blocked = runWithStorage(() => {
      throw new Error('denied');
    });
    expect(blocked.attrs.has('data-sized')).toBe(false);

    // Saved layout (R4 + Item 5 loose safety bound): leaves assistDock untouched ('bar') before mount
    // and applies a loose safety cap without subtracting assistBar overhead so side-dock & ordinary heights don't jump
    const saved = runWithStorage(() =>
      JSON.stringify({ v: 1, timelineHeight: 360, lanes: { video: 120 }, assistDock: 'side' }),
    );
    expect(saved.attrs.get('data-dock')).toBe('bar');
    expect(saved.attrs.has('data-sized')).toBe(true);
    expect(saved.styles.get('--ev-timeline-h')).toBe('360px');
    expect(saved.styles.get('--ev-h-video')).toBe('120px');
    expect(saved.styles.get('--ev-timeline-max')).toBe(String(Math.floor(900 * 0.65)) + 'px');

    const sideNearMax = runWithStorage(() =>
      JSON.stringify({ v: 1, timelineHeight: 565, lanes: {}, assistDock: 'side' }),
    );
    expect(sideNearMax.styles.get('--ev-timeline-h')).toBe('565px');
  });
});

describe('editor-v2 layout source guards', () => {
  it('layout-model.ts and layout-store.ts schedule no JS timers', () => {
    for (const file of ['layout-model.ts', 'layout-store.ts']) {
      const source = readFileSync(join(ROOT, 'components/brand-studio/editor-v2', file), 'utf8');
      expect(source).not.toMatch(/\b(setTimeout|setInterval)\b/);
    }
  });

  it('new CSS Module rules keep default rules intact, use tokens only (no colour literals), put local classes on every selector, and style main focus-visible clearly', () => {
    const css = readFileSync(join(ROOT, 'components/brand-studio/editor-v2/editor-v2.module.css'), 'utf8');
    // S4: default .root keeps main's grid-template-rows and default .timeline keeps overflow visible
    expect(css).toMatch(/\.root\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/);
    const defaultTimelineMatch = css.match(/\.timeline\s*\{[^}]*\}/);
    expect(defaultTimelineMatch?.[0]).not.toMatch(/overflow:\s*hidden|max-height:/);
    // Item 3: main handle has matching 2px accent :focus-visible treatment
    expect(css).toMatch(/\.root \.timelineResize:focus-visible::after\s*\{[^}]*height:\s*2px;[^}]*background:\s*var\(--ys-accent\)/);

    const blocks = [
      css.match(/\/\* ── Resize handles[\s\S]*?\/\* ── End resize handles ── \*\//)?.[0],
      css.match(/\/\* ── Customer-sized timeline layout[\s\S]*?\/\* ── End customer-sized timeline layout ── \*\//)?.[0],
    ];
    for (const block of blocks) {
      expect(block, 'layout CSS block present').toBeTruthy();
      expect(block!).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|rgba\(|hsl\(/i);
      for (const rule of block!.split('}')) {
        const selectorText = rule.split('{')[0]?.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!selectorText) continue;
        for (const selector of selectorText.split(',')) {
          expect(selector.trim(), selector).toMatch(/\.(root|timelineResize|laneResize|laneNames|timeline|rulerName|laneScroll|laneContent|ruler|lane|playhead)/);
        }
      }
    }
  });
});
