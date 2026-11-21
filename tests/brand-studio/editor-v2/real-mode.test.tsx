import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorV2 } from '@/components/brand-studio/editor-v2/editor-v2';
import { useEditor, type RealFilmOptions } from '@/components/brand-studio/editor-v2/use-editor';
import {
  FIXTURE_MATERIALS,
  FIXTURE_MEASURED_LUFS,
  FIXTURE_REFERENCES,
  FIXTURE_TRACK_IDS,
} from '@/lib/brand-studio/editor-v2/fixture';
import { EDITOR_WORKSPACES, type EditorWorkspace } from '@/lib/brand-studio/editor-v2/model';
import { composeStreamUrl, type EditorSource } from '@/lib/brand-studio/editor-v2/sources';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/**
 * The lead's rule for V1: sample values must never look real. While the organization's film is open,
 * nothing on screen may come from the sample data (lib/brand-studio/editor-v2/fixture.ts): no finding,
 * no count, no meter, no sample music, no transcript, no sample footage, no "structure preview" badge.
 * Colour, sound and captions say they are being built and point at the sample film instead.
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const ASSET = '40000000-0000-4000-8000-000000000001';

const source: EditorSource = {
  key: `a:${ASSET}`,
  kind: 'asset',
  id: ASSET,
  label: 'runway walk.mp4',
  srcUrl: composeStreamUrl(ORG, 'asset', ASSET),
  thumbUrl: '/api/brand-studio/media/thumb.jpg',
  seconds: 5.7,
  durationMs: 5705,
  createdAt: '2026-11-20T10:00:00.000Z',
};

const real = (canEdit = true): RealFilmOptions & { organizationName: string } => ({
  organizationId: ORG,
  organizationName: 'Sample Brand',
  canEdit,
  sources: [source],
  sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}`,
});

function render(copy: StudioEditorCopy, workspace: EditorWorkspace, film: ReturnType<typeof real> | null = real()): string {
  return renderToStaticMarkup(
    h(EditorV2, { copy, currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`, initialWorkspace: workspace, real: film }),
  );
}

/** Everything the sample data could put on screen, in either language. */
function fixtureStrings(copy: StudioEditorCopy): string[] {
  const m = copy.sound.materials;
  return [
    copy.notice.badge,
    copy.notice.body,
    `<h1>${copy.filmName}</h1>`,
    copy.cut.materials.frameClip,
    copy.cut.titles.bigText,
    copy.cut.titles.lowerText,
    copy.cut.titles.endText,
    ...FIXTURE_TRACK_IDS.flatMap((id) => [m[id], m[`${id}Mood`]]),
    copy.captions.transcript.l1,
    copy.captions.transcript.l2,
    copy.captions.transcript.l3,
    copy.sound.listen.unavailable,
    copy.assist.unknown,
    copy.review.inert,
    String(FIXTURE_MEASURED_LUFS).replace('-', '−'),
    String(Math.abs(FIXTURE_MEASURED_LUFS)),
    ...FIXTURE_MATERIALS.flatMap((material) => [material.src, material.poster]),
    ...FIXTURE_REFERENCES.map((reference) => reference.src),
    '/reel/',
  ];
}

/** Markers only the sample film's workspaces draw. */
const SAMPLE_MARKERS = [
  'data-editor-finding',
  'data-editor-open=',
  'data-editor-meter',
  'data-editor-track',
  'data-editor-look',
  'data-editor-reference',
  'data-editor-caption-style',
  'data-editor-material=',
  'data-editor-notice',
  'data-lane="voice"',
  'data-lane="music"',
  'data-lane="titles"',
  'data-editor-action=',
];

describe('a real film shows nothing that comes from the sample data', () => {
  for (const [locale, copy] of [['ko', studioEditorKo], ['en', studioEditorEn]] as const) {
    for (const workspace of EDITOR_WORKSPACES) {
      it(`${locale} · ${workspace}`, () => {
        const html = render(copy, workspace);
        expect(html).toContain('data-editor-mode="real"');
        for (const text of fixtureStrings(copy)) expect(html.includes(text), `"${text}" is on screen`).toBe(false);
        for (const marker of SAMPLE_MARKERS) expect(html.includes(marker), `${marker} is on screen`).toBe(false);
      });
    }
  }

  it('opens neutral: a loading line, not the sample film', () => {
    const html = render(studioEditorKo, 'cut');
    expect(html).toContain('data-editor-status="loading"');
    expect(html).toContain('data-editor-loading');
    expect(html).toContain(studioEditorKo.real.loading);
    expect(html).not.toMatch(/data-editor-clip="/);
  });

  it('names the film as the organization’s own and keeps the way back to the current editor', () => {
    const html = render(studioEditorKo, 'cut');
    expect(html).toContain('Sample Brand 영상');
    expect(html).toContain(studioEditorKo.real.notice);
    expect(html).toContain(`href="/brand/studio/compose?organizationId=${ORG}"`);
  });

  it('the ways between the two editors open in the same tab, so the ordinary path never leaves two live editors (review round 1, item 7)', () => {
    const anchors = (html: string, marker: string) => [...html.matchAll(new RegExp(`<a [^>]*${marker}[^>]*>`, 'g'))].map((m) => m[0]);
    const header = anchors(render(studioEditorKo, 'cut'), 'data-editor-current');
    const locked = anchors(render(studioEditorKo, 'color'), 'data-editor-classic-link');
    expect(header).toHaveLength(1);
    expect(locked).toHaveLength(1);
    for (const anchor of [...header, ...locked]) {
      expect(anchor).not.toMatch(/\btarget=/);
      expect(anchor).toContain('/brand/studio/compose');
    }
    // The current editor's link to v2 (compose-entry.test.ts pins its whole markup) has no target either.
    const composer = readFileSync(join(process.cwd(), 'components/brand-studio/compose/video-composer.tsx'), 'utf8');
    const link = composer.slice(composer.indexOf('{editorV2Href && ('), composer.indexOf('{copy.previewV2.link}'));
    expect(link).toContain('data-compose-editor-v2');
    expect(link).not.toContain('target=');
  });

  it('a conflict with another tab is one bar with two choices, absent until there is one', () => {
    const html = render(studioEditorKo, 'cut');
    expect(html).not.toContain('data-editor-conflict');
    for (const copy of [studioEditorKo, studioEditorEn]) {
      expect(copy.real.conflict.body.length).toBeGreaterThan(10);
      expect(copy.real.conflict.keep).not.toBe(copy.real.conflict.open);
    }
  });

  it('locks colour, sound and captions with a way to the sample film in that workspace', () => {
    for (const workspace of ['color', 'sound', 'captions'] as const) {
      const html = render(studioEditorKo, workspace);
      expect(html).toContain(`data-editor-locked="${workspace}"`);
      expect(html).toContain(`href="/brand/studio/editor?sample=1&amp;organizationId=${ORG}&amp;ws=${workspace}"`);
      expect(html).toContain(studioEditorKo.real.locked.open);
      // No scope switch, no actions, no fine-tuning: the locked panel has nothing to press but the link.
      expect(html).not.toContain('data-editor-scope');
      expect(html).not.toContain(`>${studioEditorKo.panel.fineTune}<`);
    }
    expect(render(studioEditorKo, 'captions')).toContain(studioEditorKo.real.locked.captionsKept);
    expect(render(studioEditorKo, 'cut')).not.toContain('data-editor-locked=');
  });

  it('offers the organization’s clips, not the sample materials, and no titles', () => {
    const html = render(studioEditorKo, 'cut');
    expect(html).toContain(`data-editor-source="a:${ASSET}"`);
    expect(html).toContain('runway walk.mp4');
    expect(html).toContain(studioEditorKo.real.binNote);
    expect(html).not.toContain(`>${studioEditorKo.cut.materials.titles}<`);
  });

  it('"말로 편집" carries the 예시 mark and only the cut examples, in every workspace', () => {
    for (const workspace of EDITOR_WORKSPACES) {
      const html = render(studioEditorKo, workspace);
      expect(html).toContain('data-editor-assist-sample');
      const examples = [...html.matchAll(/data-editor-example="([a-z0-9]+)"/g)].map((m) => m[1]);
      expect(examples).toEqual(['cut1', 'cut2', 'cut3']);
    }
  });

  it('a viewer sees why nothing can be changed', () => {
    const html = render(studioEditorKo, 'cut', real(false));
    expect(html).toContain(studioEditorKo.real.readOnly);
    expect(html).toContain('data-editor-read-only');
  });

  it('the hook on a real film exposes no findings, no counts and no sample state', () => {
    let seen: ReturnType<typeof useEditor> | null = null;
    function Probe() {
      seen = useEditor(studioEditorKo, { real: real(), initialWorkspace: 'sound' });
      return null;
    }
    renderToStaticMarkup(h(Probe));
    const api = seen as unknown as ReturnType<typeof useEditor>;
    expect(api.real).toBe(true);
    expect(api.locked).toBe(true);
    expect(api.findings).toEqual({ color: [], sound: [], captions: [], croppedIds: [] });
    expect(api.openCount).toEqual({ cut: 0, color: 0, sound: 0, captions: 0 });
    expect(api.stats).toEqual({});
    expect(api.doc.music).toBeNull();
    expect(api.doc.titles).toEqual([]);
    expect(api.doc.sound).toEqual({ speechClear: false, duck: null, loudness: false, fades: false, musicVolume: 1 });
    expect(api.doc.captionSettings.safeArea).toBe('none');
    expect(api.sequence.clips).toEqual([]);
    expect(api.sequence.clips.some((clip) => clip.srcUrl.startsWith('/reel/'))).toBe(false);
  });
});

describe('the sample film is still today’s prototype', () => {
  it('?sample=1 shows the structure-preview badge, the sample materials and the sample findings markers', () => {
    const html = render(studioEditorKo, 'cut', null);
    expect(html).toContain('data-editor-mode="sample"');
    expect(html).toContain(studioEditorKo.notice.badge);
    expect(html).toContain('data-editor-material="m7"');
    expect(html).toContain('data-lane="voice"');
    expect(html).toContain(studioEditorKo.top.review);
  });
});
