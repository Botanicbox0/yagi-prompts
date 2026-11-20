import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StudioAssetView, StudioOutputView } from '@/lib/brand-studio/contracts';
import type { FrameClip } from '@/lib/brand-studio/editor-v2/frames';
import { REAL_ASSIST_KINDS, emptyFilm, realAssistAllowed, realDoc, sampleHrefFor, workspaceLocked } from '@/lib/brand-studio/editor-v2/real';
import { composeStreamUrl, deepLinkSource, editorSources, parseClipParam, sourceSeconds } from '@/lib/brand-studio/editor-v2/sources';
import { interpretUtterance } from '@/lib/brand-studio/editor-v2/model';

/** The organization's footage in the bin, the `clip=` link, and what a real film offers (V1). */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const A1 = '20000000-0000-4000-8000-000000000001';
const O1 = '20000000-0000-4000-8000-000000000002';

function asset(id: string, kind: StudioAssetView['kind'], createdAt: string): StudioAssetView {
  return { id, kind, role: null, name: `asset ${id.slice(-1)}`, tags: [], url: `/m/${id}.mp4`, thumbUrl: `/m/${id}.jpg`, width: 720, height: 1280, seconds: 5.7, durationMs: 5705, source: 'upload', createdAt } as StudioAssetView;
}
function output(id: string, kind: StudioOutputView['kind'], createdAt: string): StudioOutputView & { label: string } {
  return { id, jobId: 'job', kind, url: `/m/${id}.mp4`, thumbUrl: null, width: 1080, height: 1920, seconds: 4, draft: false, savedAssetId: null, createdAt, label: 'A morning walk' } as StudioOutputView & { label: string };
}

describe('the bin', () => {
  const sources = editorSources(
    ORG,
    [asset(A1, 'video', '2026-11-20T10:00:00.000Z'), asset('20000000-0000-4000-8000-000000000009', 'image', '2026-11-21T10:00:00.000Z'), asset('20000000-0000-4000-8000-000000000008', 'audio', '2026-11-21T10:00:00.000Z')],
    [output(O1, 'video', '2026-11-21T09:00:00.000Z'), output('20000000-0000-4000-8000-000000000007', 'image', '2026-11-21T11:00:00.000Z')],
  );

  it('holds video only, newest first, keyed like the library', () => {
    expect(sources.map((s) => s.key)).toEqual([`o:${O1}`, `a:${A1}`]);
    expect(sources[0]).toMatchObject({ kind: 'output', id: O1, label: 'A morning walk', thumbUrl: null, seconds: 4, durationMs: null });
    expect(sources[1]).toMatchObject({ kind: 'asset', id: A1, label: 'asset 1', thumbUrl: `/m/${A1}.jpg`, durationMs: 5705 });
  });

  it('streams through exactly the address the current editor stores', () => {
    const composer = readFileSync(join(process.cwd(), 'components/brand-studio/compose/video-composer.tsx'), 'utf8');
    expect(composer).toContain("const q = new URLSearchParams({ organizationId, source, id });");
    expect(composer).toContain('return `/api/brand-studio/compose?${q.toString()}`;');
    expect(sources[1]!.srcUrl).toBe(`/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=${A1}`);
    expect(composeStreamUrl(ORG, 'output', O1)).toBe(`/api/brand-studio/compose?organizationId=${ORG}&source=output&id=${O1}`);
  });

  it('knows a length exactly when it can', () => {
    expect(sourceSeconds({ seconds: 5.7, durationMs: 5705 })).toBe(5.705);
    expect(sourceSeconds({ seconds: 4, durationMs: null })).toBe(4);
    expect(sourceSeconds({ seconds: null, durationMs: null })).toBeNull();
  });
});

describe('clip= links', () => {
  const sources = editorSources(ORG, [asset(A1, 'video', '2026-11-20T10:00:00.000Z')], [output(O1, 'video', '2026-11-21T09:00:00.000Z')]);
  const cut = (srcUrl: string): FrameClip => ({ id: 'x', label: 'x', srcUrl, thumbUrl: null, sourceFps: 24, sourceFrames: 24, inFrame: 0, phase: 0, frames: 24, speedNum: 1, speedDen: 1, volume: 1, muted: false });

  it('reads the asset and result forms, and nothing else', () => {
    expect(parseClipParam(`a:${A1}`)).toBe(`a:${A1}`);
    expect(parseClipParam(`o:${O1.toUpperCase()}`)).toBe(`o:${O1}`);
    expect(parseClipParam(decodeURIComponent(`a%3A${A1}`))).toBe(`a:${A1}`);
    for (const bad of [null, undefined, '', 'a:', `x:${A1}`, 'a:not-a-uuid', `a:${A1}/..`, `${A1}`]) expect(parseClipParam(bad), String(bad)).toBeNull();
  });

  it('adds a known clip at the end once, and ignores an unknown one', () => {
    const key = parseClipParam(`a:${A1}`);
    expect(deepLinkSource(sources, key, emptyFilm())?.id).toBe(A1);
    expect(deepLinkSource(sources, key, { clips: [cut(composeStreamUrl(ORG, 'output', O1))] })?.id).toBe(A1);
    expect(deepLinkSource(sources, key, { clips: [cut(composeStreamUrl(ORG, 'asset', A1))] })).toBeNull();
    expect(deepLinkSource(sources, parseClipParam('o:20000000-0000-4000-8000-0000000000ff'), emptyFilm())).toBeNull();
    expect(deepLinkSource(sources, null, emptyFilm())).toBeNull();
  });
});

describe('what a real film offers in V1', () => {
  it('opens only the cut workspace', () => {
    expect(workspaceLocked(true, 'cut')).toBe(false);
    for (const ws of ['color', 'sound', 'captions'] as const) expect(workspaceLocked(true, ws)).toBe(true);
    for (const ws of ['cut', 'color', 'sound', 'captions'] as const) expect(workspaceLocked(false, ws)).toBe(false);
  });

  it('follows only the cut sentences', () => {
    expect([...REAL_ASSIST_KINDS].sort()).toEqual(['aspect', 'remove_last', 'trim']);
    const allowed = (text: string) => {
      const intent = interpretUtterance(text);
      return intent ? realAssistAllowed(intent) : null;
    };
    expect(allowed('세로 영상으로 바꿔 줘')).toBe(true);
    expect(allowed('두 번째 컷을 2초로 줄여 줘')).toBe(true);
    expect(allowed('마지막 컷 지워 줘')).toBe(true);
    expect(allowed('영상 전체 색을 균형 있게 맞춰 줘')).toBe(false);
    expect(allowed('말할 때는 음악을 줄여 줘')).toBe(false);
    expect(allowed('자막 만들어 줘')).toBe(false);
  });

  it('starts from a neutral document: no look, no music, no safe-area guide, no titles', () => {
    const doc = realDoc(emptyFilm(24, '16:9'));
    expect(doc).toEqual({
      sequence: { fps: 24, aspect: '16:9', clips: [], captions: [] },
      looks: {},
      reframe: {},
      sound: { speechClear: false, duck: null, loudness: false, fades: false, musicVolume: 1 },
      music: null,
      captionSettings: { styleId: 'clean', safeArea: 'none', lift: false, output: 'burn' },
      titles: [],
    });
  });

  it('points a locked workspace at the sample film for this organization', () => {
    const base = `/brand/studio/editor?sample=1&organizationId=${ORG}`;
    expect(sampleHrefFor(base, 'color')).toBe(`/brand/studio/editor?sample=1&organizationId=${ORG}&ws=color`);
    expect(sampleHrefFor('/brand/studio/editor', 'sound')).toBe('/brand/studio/editor?sample=1&ws=sound');
  });
});
