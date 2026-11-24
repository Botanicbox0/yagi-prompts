import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OldEditorLink, oldEditorLinkTitle } from '@/components/brand-studio/editor-v2/editor-v2';
import { ActionPanel } from '@/components/brand-studio/editor-v2/panels';
import { useEditor, type RealFilmOptions } from '@/components/brand-studio/editor-v2/use-editor';
import { setClipSpeedCurve, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { SPEED_PRESETS } from '@/lib/brand-studio/editor-v2/speed-curve';
import { filmHasSpeedTheOldEditorChanges, speedTheOldEditorChanges } from '@/lib/brand-studio/editor-v2/stored';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/**
 * Audit B5: a cut slower than 0.25×, faster than 4× or on a speed curve plays at another speed in the old
 * editor (measured in ./old-editor-speed.test.ts: 0.1× → 40 s instead of 100 s, 10× → 2.5 s instead of 1 s,
 * a curve at its average speed). The locked workspaces send people there to add captions and sound, so the
 * link says so, once, when the film has such a cut.
 */
const FPS = 24;
const cut = (extra: Partial<FrameClip> = {}): FrameClip => ({
  id: 'c',
  label: 'c',
  srcUrl: '/media/a.mp4',
  thumbUrl: null,
  sourceFps: FPS,
  sourceFrames: 240,
  inFrame: 0,
  phase: 0,
  frames: 240,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
  ...extra,
});
const film = (clips: FrameClip[]): FrameSequence => ({ fps: FPS, aspect: '9:16', captions: [], clips });
const curved = (): FrameClip => setClipSpeedCurve(film([cut()]), 0, SPEED_PRESETS.find((preset) => preset.id === 'slowMiddle')!.points).clips[0]!;

describe('the one rule that decides the warning next to the old-editor link', () => {
  it('0.25× and 4× are the old editor’s own range, and so is everything between: no warning', () => {
    expect(speedTheOldEditorChanges(cut({ speedNum: 1, speedDen: 4 }))).toBe(false);
    expect(speedTheOldEditorChanges(cut({ speedNum: 4, speedDen: 1 }))).toBe(false);
    expect(speedTheOldEditorChanges(cut())).toBe(false);
    expect(speedTheOldEditorChanges(cut({ speedNum: 3, speedDen: 2 }))).toBe(false);
  });

  it('just outside it (0.24×, 4.01×), the far ends (0.1×, 10×) and a curve: warning', () => {
    expect(speedTheOldEditorChanges(cut({ speedNum: 6, speedDen: 25 }))).toBe(true);
    expect(speedTheOldEditorChanges(cut({ speedNum: 401, speedDen: 100 }))).toBe(true);
    expect(speedTheOldEditorChanges(cut({ speedNum: 1, speedDen: 10 }))).toBe(true);
    expect(speedTheOldEditorChanges(cut({ speedNum: 10, speedDen: 1 }))).toBe(true);
    expect(curved().speedCurve).toBeDefined();
    expect(speedTheOldEditorChanges(curved())).toBe(true);
  });

  it('a film warns when at least one of its cuts does', () => {
    expect(filmHasSpeedTheOldEditorChanges(film([]))).toBe(false);
    expect(filmHasSpeedTheOldEditorChanges(film([cut(), cut({ speedNum: 4, speedDen: 1 })]))).toBe(false);
    expect(filmHasSpeedTheOldEditorChanges(film([cut(), cut({ speedNum: 6, speedDen: 25 })]))).toBe(true);
    expect(filmHasSpeedTheOldEditorChanges(film([cut(), curved()]))).toBe(true);
  });
});

describe('the locked workspace’s old-editor card says it once, only when it is true', () => {
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const real: RealFilmOptions = { organizationId: ORG, canEdit: true, sources: [], sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}` };
  const CLASSIC = `/brand/studio/compose?classic=1&organizationId=${ORG}`;

  function panel(copy: StudioEditorCopy, workspace: EditorWorkspace, sequence: FrameSequence | null, film: RealFilmOptions | null = real): string {
    let api: ReturnType<typeof useEditor> | null = null;
    function Probe() {
      api = useEditor(copy, { real: film, initialWorkspace: workspace });
      return null;
    }
    renderToStaticMarkup(h(Probe));
    const seen = api as unknown as ReturnType<typeof useEditor>;
    return renderToStaticMarkup(h(ActionPanel, { api: sequence ? { ...seen, sequence } : seen, classicHref: CLASSIC }));
  }

  const count = (html: string, text: string) => html.split(text).length - 1;

  for (const copy of [studioEditorKo, studioEditorEn]) {
    for (const workspace of ['color', 'sound', 'captions'] as const) {
      it(`${copy === studioEditorKo ? 'ko' : 'en'} · ${workspace}: a 0.1× cut or a curve shows the line beside the link`, () => {
        for (const clips of [[cut(), cut({ speedNum: 1, speedDen: 10 })], [curved()]]) {
          const html = panel(copy, workspace, film(clips));
          expect(html).toContain(`data-editor-classic-link="${workspace}"`);
          expect(count(html, 'data-editor-classic-speed')).toBe(1);
          expect(count(html, copy.real.locked.classicSpeed)).toBe(1);
        }
      });

      it(`${copy === studioEditorKo ? 'ko' : 'en'} · ${workspace}: speeds inside 0.25–4 show no such line`, () => {
        const html = panel(copy, workspace, film([cut(), cut({ speedNum: 4, speedDen: 1 }), cut({ speedNum: 1, speedDen: 4 })]));
        expect(html).toContain(`data-editor-classic-link="${workspace}"`);
        expect(html).not.toContain('data-editor-classic-speed');
        expect(html).not.toContain(copy.real.locked.classicSpeed);
      });
    }
  }

  it('the line names the range and what may move, in both languages', () => {
    expect(studioEditorKo.real.locked.classicSpeed).toContain('예전 편집기');
    expect(studioEditorKo.real.locked.classicSpeed).toContain('0.25');
    expect(studioEditorKo.real.locked.classicSpeed).toContain('4');
    expect(studioEditorKo.real.locked.classicSpeed).toContain('자막');
    expect(studioEditorEn.real.locked.classicSpeed).toContain('0.25');
    expect(studioEditorEn.real.locked.classicSpeed).toContain('caption');
  });
});

describe('the header’s way back to the earlier editor carries the same line, in its tooltip', () => {
  for (const copy of [studioEditorKo, studioEditorEn]) {
    it(copy === studioEditorKo ? 'ko' : 'en', () => {
      expect(oldEditorLinkTitle(copy, false)).toBe(copy.notice.current);
      expect(oldEditorLinkTitle(copy, true)).toContain(copy.notice.current);
      expect(oldEditorLinkTitle(copy, true)).toContain(copy.real.locked.classicSpeed);
    });
  }
});

describe('the header’s way back reaches keyboard and screen-reader users too (review item 4)', () => {
  /** Text as React writes it into markup. */
  const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const HREF = '/brand/studio/compose?classic=1';

  for (const copy of [studioEditorKo, studioEditorEn]) {
    it(`${copy === studioEditorKo ? 'ko' : 'en'}: with such a cut the link is described by hidden text holding the warning`, () => {
      const html = renderToStaticMarkup(h(OldEditorLink, { copy, href: HREF, speedDiffers: true }));
      const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(describedBy).not.toBe('');
      const at = html.indexOf(`id="${describedBy}"`);
      expect(at).toBeGreaterThan(-1);
      const open = html.lastIndexOf('<span', at);
      const element = html.slice(open, html.indexOf('</span>', at));
      expect(element).toMatch(/class="[^"]*srOnly/);
      expect(element).toContain(`>${esc(copy.real.locked.classicSpeed)}`);
      expect(html).toContain(`aria-label="${esc(copy.notice.current)}"`);
      expect(html).toContain(`title="${esc(oldEditorLinkTitle(copy, true))}"`);
    });

    it(`${copy === studioEditorKo ? 'ko' : 'en'}: without such a cut, no description and no hidden text`, () => {
      const html = renderToStaticMarkup(h(OldEditorLink, { copy, href: HREF, speedDiffers: false }));
      expect(html).not.toContain('aria-describedby');
      expect(html).not.toContain(esc(copy.real.locked.classicSpeed));
      expect(html).toContain(`title="${esc(copy.notice.current)}"`);
    });
  }
});
