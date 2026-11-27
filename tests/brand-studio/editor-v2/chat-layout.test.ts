import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSIST_BAR_HEIGHT,
  DEFAULT_EDITOR_LAYOUT,
  LAYOUT_STORAGE_KEY,
  PREVIEW_CHROME_HEIGHT,
  TOP_BAR_HEIGHT,
  editorColumnWidths,
  effectiveAssistDock,
  parseEditorLayout,
  sanitizeEditorLayout,
  timelineBounds,
  withAssistDock,
  withTimelineHeight,
} from '@/components/brand-studio/editor-v2/layout-model';
import { layoutPrepaintScript, loadEditorLayout, saveEditorLayout } from '@/components/brand-studio/editor-v2/layout-store';

const ROOT = process.cwd();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor-v2 E-C dock & layout model', () => {
  it('preserves assistDockSet on real toggles only (no-op toggles return same object reference without saving)', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, v),
      },
    });

    const legacy = parseEditorLayout({ v: 1, timelineHeight: 300, lanes: {}, assistDock: 'bar' });
    expect(legacy).toEqual({ v: 1, timelineHeight: 300, lanes: {}, assistDock: 'bar' });
    expect('assistDockSet' in legacy).toBe(false);

    // Calling withAssistDock with the already-effective dock is a no-op (exact same reference).
    expect(withAssistDock(DEFAULT_EDITOR_LAYOUT, 'bar', 'bar')).toBe(DEFAULT_EDITOR_LAYOUT);
    expect(withAssistDock(DEFAULT_EDITOR_LAYOUT, 'side', 'side')).toBe(DEFAULT_EDITOR_LAYOUT);

    // Real fold from open side-default -> bar sets assistDockSet: true and survives sanitize + storage round-trip.
    const baseSized = withTimelineHeight(DEFAULT_EDITOR_LAYOUT, 300);
    const folded = withAssistDock(baseSized, 'bar', 'side');
    expect(folded).toEqual({ v: 1, timelineHeight: 300, lanes: {}, assistDock: 'bar', assistDockSet: true });
    expect(withAssistDock(folded, 'bar', 'side')).toBe(folded);
    expect(sanitizeEditorLayout(folded)).toEqual(folded);

    saveEditorLayout(folded);
    expect(JSON.parse(map.get(LAYOUT_STORAGE_KEY)!)).toEqual(folded);
    expect(loadEditorLayout()).toEqual(folded);

    const bad = parseEditorLayout({ v: 1, timelineHeight: null, lanes: {}, assistDock: 'bar', assistDockSet: 'yes' });
    expect('assistDockSet' in bad).toBe(false);
  });

  it('resolves effectiveAssistDock: open switch defaults to side, explicit fold stays bar, closed switch never defaults to side', () => {
    expect(effectiveAssistDock(DEFAULT_EDITOR_LAYOUT, 'bar')).toBe('bar');
    const legacyTimelineOnly = parseEditorLayout({ v: 1, timelineHeight: 320, lanes: {}, assistDock: 'bar' });
    expect(effectiveAssistDock(legacyTimelineOnly, 'bar')).toBe('bar');
    const legacySide = parseEditorLayout({ v: 1, timelineHeight: null, lanes: {}, assistDock: 'side' });
    expect(effectiveAssistDock(legacySide, 'bar')).toBe('side');

    expect(effectiveAssistDock(DEFAULT_EDITOR_LAYOUT, 'side')).toBe('side');
    expect(effectiveAssistDock(legacyTimelineOnly, 'side')).toBe('side');
    const explicitFold = withAssistDock(DEFAULT_EDITOR_LAYOUT, 'bar', 'side');
    expect(effectiveAssistDock(explicitFold, 'side')).toBe('bar');
    const explicitReopen = withAssistDock(explicitFold, 'side', 'side');
    expect(effectiveAssistDock(explicitReopen, 'side')).toBe('side');
  });

  it('pins exact 1280 / 1440 / 1920 column & preview widths when right-side chat is open', () => {
    expect(editorColumnWidths(1280, 'side', true)).toEqual({
      mode: 'tabbed',
      left: 220,
      preview: 612,
      inspector: 320,
      chat: 320,
    });
    expect(editorColumnWidths(1440, 'side', true)).toEqual({
      mode: '4col',
      left: 232,
      preview: 464,
      inspector: 292,
      chat: 316,
    });
    expect(editorColumnWidths(1920, 'side', true)).toEqual({
      mode: '4col',
      left: 264,
      preview: 856,
      inspector: 324,
      chat: 340,
    });
    expect(editorColumnWidths(1280, 'bar', true)).toEqual({
      mode: '3col',
      left: 228,
      preview: 624,
      inspector: 300,
      chat: 0,
    });
    expect(editorColumnWidths(1440, 'bar', true)).toEqual({
      mode: '3col',
      left: 264,
      preview: 724,
      inspector: 324,
      chat: 0,
    });
  });

  it('computes timelineBounds and pre-paint clamp accurately for both bar and side effective docks', () => {
    const effective = effectiveAssistDock(DEFAULT_EDITOR_LAYOUT, 'side');
    const boundsSide = timelineBounds({
      editorHeight: 700,
      assistDock: effective,
      videoLaneHeight: 64,
      topBarHeight: TOP_BAR_HEIGHT,
      assistBarHeight: ASSIST_BAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    });
    const boundsBar = timelineBounds({
      editorHeight: 700,
      assistDock: 'bar',
      videoLaneHeight: 64,
      topBarHeight: TOP_BAR_HEIGHT,
      assistBarHeight: ASSIST_BAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    });
    expect(boundsSide.max).toBe(402);
    expect(boundsBar.max).toBe(350);
    expect(boundsSide.max - boundsBar.max).toBe(ASSIST_BAR_HEIGHT + 8);

    // Run layoutPrepaintScript for both 'bar' and 'side' defaults at 700px editor height.
    const runPrepaint = (defaultDock: 'bar' | 'side', stored: unknown | null) => {
      const attrs = new Map<string, string>([
        ['data-editor-mode', 'real'],
        ['data-ws', 'cut'],
        ['data-dock', defaultDock],
      ]);
      const styles = new Map<string, string>();
      const el = {
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getBoundingClientRect: () => ({ height: 700 }),
        style: {
          setProperty: (k: string, v: string) => styles.set(k, v),
          getPropertyValue: (k: string) => styles.get(k) ?? '',
        },
      };
      vi.stubGlobal('window', {
        innerHeight: 724,
        localStorage: { getItem: () => (stored === null ? null : JSON.stringify(stored)) },
      });
      vi.stubGlobal('document', { currentScript: { parentElement: el } });
      new Function(layoutPrepaintScript(defaultDock))();
      return { attrs, styles };
    };

    // Closed-switch ('bar') pre-paint script is byte-identical to main 5b0a84aa (1,971 chars, B1):
    // maxP = 700 - 44 - 16 - 238 = 402, so 390px is kept and 500px clamps to 402px, and data-dock is never written.
    expect(layoutPrepaintScript('bar').length).toBe(1971);
    const barOut = runPrepaint('bar', { v: 1, timelineHeight: 390, lanes: {}, assistDock: 'bar' });
    expect(barOut.attrs.get('data-dock')).toBe('bar');
    expect(barOut.styles.get('--ev-timeline-max')).toBe('402px');
    expect(barOut.styles.get('--ev-timeline-h')).toBe('390px');

    const barClampOut = runPrepaint('bar', { v: 1, timelineHeight: 500, lanes: {}, assistDock: 'bar' });
    expect(barClampOut.styles.get('--ev-timeline-max')).toBe('402px');
    expect(barClampOut.styles.get('--ev-timeline-h')).toBe('402px');

    // Switch open (side default): nothing stored -> keeps data-dock='side', writes nothing.
    const nothingOut = runPrepaint('side', null);
    expect(nothingOut.attrs.get('data-dock')).toBe('side');
    expect(nothingOut.attrs.has('data-sized')).toBe(false);
    expect(nothingOut.styles.size).toBe(0);

    // Switch open + stored side -> keeps data-dock='side' and keeps 390px under 402px max.
    const storedSideOut = runPrepaint('side', { v: 1, timelineHeight: 390, lanes: {}, assistDock: 'side', assistDockSet: true });
    expect(storedSideOut.attrs.get('data-dock')).toBe('side');
    expect(storedSideOut.styles.get('--ev-timeline-max')).toBe('402px');
    expect(storedSideOut.styles.get('--ev-timeline-h')).toBe('390px');

    // Switch open + legacy stored bar without assistDockSet -> effective dock is side (402px max, 390px kept).
    const legacyOut = runPrepaint('side', { v: 1, timelineHeight: 390, lanes: {}, assistDock: 'bar' });
    expect(legacyOut.attrs.get('data-dock')).toBe('side');
    expect(legacyOut.styles.get('--ev-timeline-max')).toBe('402px');
    expect(legacyOut.styles.get('--ev-timeline-h')).toBe('390px');

    // Switch open + stored bar (with timelineHeight) -> flips data-dock='bar' before paint AND clamps to 350px!
    const foldedOut = runPrepaint('side', { v: 1, timelineHeight: 390, lanes: {}, assistDock: 'bar', assistDockSet: true });
    expect(foldedOut.attrs.get('data-dock')).toBe('bar');
    expect(foldedOut.styles.get('--ev-timeline-max')).toBe('350px');
    expect(foldedOut.styles.get('--ev-timeline-h')).toBe('350px');

    // Switch open + stored bar WITHOUT timeline/lane sizes -> still flips data-dock='bar' at 0ms without dirtying data-sized!
    const foldedUnsizedOut = runPrepaint('side', { v: 1, timelineHeight: null, lanes: {}, assistDock: 'bar', assistDockSet: true });
    expect(foldedUnsizedOut.attrs.get('data-dock')).toBe('bar');
    expect(foldedUnsizedOut.attrs.has('data-sized')).toBe(false);
    expect(foldedUnsizedOut.styles.size).toBe(0);
  });

  it('pins CSS rules for 1280 tabs (W1), pre-paint bar mode (W2), and focus-within/empty alignment (W7)', () => {
    const css = readFileSync(join(ROOT, 'components/brand-studio/editor-v2/editor-v2.module.css'), 'utf8');
    // W1: <=1360px media query selects the visible pane from data-active-tab without JS width reads
    expect(css).toContain("@media (max-width: 1360px)");
    expect(css).toContain(".root[data-real-chat][data-dock='side'] .rightDock[data-active-tab='chat'] .rightPaneInspector");
    expect(css).toContain(".root[data-real-chat][data-dock='side'] .rightDock[data-active-tab='inspector'] .rightPaneChat");
    // W2: pre-paint bar hides side chat and reserves the 44px bar height before React mounts the bar
    expect(css).toContain(".root[data-real-chat][data-dock='bar'] .rightPaneChat");
    expect(css).toContain(".root[data-real-chat][data-dock='bar'] .bottom:not(:has([data-editor-chat='bar']))::before");
    // W7: focus ring on outer rounded containers using --ys-accent, inner textarea outline removed, empty state bottom-aligned
    expect(css).toMatch(/\.chatComposer:focus-within\s*\{[\s\S]*?outline:\s*2px solid var\(--ys-accent\);/);
    expect(css).toMatch(/\.chatBarForm:focus-within\s*\{[\s\S]*?outline:\s*2px solid var\(--ys-accent\);/);
    expect(css).toMatch(/\.root \.chatTextarea:focus-visible\s*\{\s*outline:\s*none;\s*\}/);
    expect(css).toMatch(/\.root \.chatBarTextarea:focus-visible\s*\{\s*outline:\s*none;\s*\}/);
    expect(css).toMatch(/\.chatEmpty\s*\{[\s\S]*?justify-content:\s*space-between;/);
  });
});
