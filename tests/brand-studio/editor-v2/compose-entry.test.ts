import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VideoComposer, type VideoComposerProps } from '@/components/brand-studio/compose/video-composer';
import { RAIL_HREF, railActive } from '@/components/brand-workspace/rail-model';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { assistFixture } from '../edit-assist/fixture';
import { allowance, ORG } from '../ui/fixtures';

/**
 * The founder (2026-11-20) opened 편집 스튜디오 from the rail, landed on the working editor and could
 * not find the new one without a typed address. While `BRAND_STUDIO_EDITOR_V2` is on, the working
 * editor's header carries one quiet link to it. With the flag off nothing changes anywhere, and the
 * rail keeps pointing at the working editor's address either way; organizations that open the new
 * editor by default get there through the page's redirect (compose-switch.test.ts).
 */
const root = process.cwd();
const HREF = `/brand/studio/editor?organizationId=${ORG}`;

function render(locale: 'ko' | 'en', extra: Partial<VideoComposerProps>): string {
  return renderToStaticMarkup(
    h(VideoComposer, {
      organizationId: ORG,
      locale,
      canCreate: true,
      copy: getDictionary(locale).studioCompose,
      videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
      initialAllowance: allowance(),
      initialAssets: [],
      initialVideoOutputs: [],
      initialProject: assistFixture(),
      ...extra,
    }),
  );
}

describe('the working editor links to the v2 prototype only while the flag is on', () => {
  it('flag off: the header is byte for byte what it was', () => {
    const absent = render('ko', {});
    expect(render('ko', { editorV2Href: null })).toBe(absent);
    expect(render('ko', { editorV2Href: undefined })).toBe(absent);
    expect(render('ko', { editorV2Href: '' })).toBe(absent);
    expect(absent).not.toContain('data-compose-editor-v2');
    expect(absent).not.toContain('/brand/studio/editor');
    expect(absent).not.toContain(getDictionary('ko').studioCompose.previewV2.link);
  });

  it('flag on: one link, marked as in progress, and nothing else changes', () => {
    for (const locale of ['ko', 'en'] as const) {
      const copy = getDictionary(locale).studioCompose.previewV2;
      const on = render(locale, { editorV2Href: HREF });
      const link = on.match(/<a[^>]*data-compose-editor-v2[^>]*>.*?<\/a>/)?.[0] ?? '';
      expect(on.match(/data-compose-editor-v2/g)).toHaveLength(1);
      expect(link).toContain(`href="${HREF.replace('&', '&amp;')}"`);
      expect(link).toContain(copy.link);
      expect(link).toContain(copy.tag);
      expect(link).toContain(`title="${copy.note}"`);
      expect(on.replace(link, '')).toBe(render(locale, {}));
    }
    // An organization not on the list previews the sample film there (review round 1, item 2): the link
    // says so, and its tooltip is the sample film's own notice.
    const ko = getDictionary('ko').studioCompose.previewV2;
    expect(ko).toEqual({
      link: '새 편집 스튜디오 미리 보기',
      tag: '구조 시안',
      note: '예시 영상으로 만든 시안입니다. 고친 내용은 저장되지 않습니다.',
      back: '새 편집 스튜디오로 돌아가기',
      backNote: '같은 영상을 새 화면에서 엽니다. 색, 사운드, 자막 공간은 아직 준비 중입니다.',
    });
    for (const locale of ['ko', 'en'] as const) {
      expect(getDictionary(locale).studioCompose.previewV2.note).toBe(getDictionary(locale).studioEditor.notice.body);
    }
  });

  it('an organization that opens the new editor by default sees the way back, without a tag', () => {
    for (const locale of ['ko', 'en'] as const) {
      const base = getDictionary(locale).studioCompose;
      const copy = { ...base, previewV2: { ...base.previewV2, link: base.previewV2.back, tag: '', note: base.previewV2.backNote } };
      const on = render(locale, { editorV2Href: HREF, copy });
      const link = on.match(/<a[^>]*data-compose-editor-v2[^>]*>.*?<\/a>/)?.[0] ?? '';
      expect(link).toBe(`<a class="${link.match(/class="([^"]*)"/)?.[1]}" href="${HREF.replace('&', '&amp;')}" title="${base.previewV2.backNote}" data-compose-editor-v2="true">${base.previewV2.back}</a>`);
      expect(link).not.toContain('classic');
      expect(on.replace(link, '')).toBe(render(locale, {}));
    }
  });

  it('the page hands over the address only when the flag function says so, after the studio guard', () => {
    const page = readFileSync(join(root, 'app/(brand)/brand/studio/compose/page.tsx'), 'utf8');
    expect(page).toContain('brandStudioEditorV2Open()');
    expect(page).toContain(
      "opensEditorV2 ? scopedHref('/brand/studio/editor', choice) : brandStudioEditorV2Open() && brandWorkspacePrototypeLayerOpen() ? scopedHref('/brand/studio/editor?sample=1', choice) : null",
    );
    expect(page.indexOf('studioRouteOrShowroom(')).toBeGreaterThan(-1);
    expect(page.indexOf('studioRouteOrShowroom(params.organizationId)')).toBeLessThan(page.indexOf('editorV2Href='));
    // The showroom branch (no studio seat) returns before the editor and never mentions the prototype.
    expect(page.indexOf("ctx.kind === 'showroom'")).toBeLessThan(page.indexOf('editorV2Href='));
    expect(page.match(/editorV2Href/g)).toHaveLength(1);
  });

  it('the rail still opens the working editor, and lights the same item on both screens', () => {
    expect(RAIL_HREF.compose).toBe('/brand/studio/compose');
    expect(Object.values(RAIL_HREF)).not.toContain('/brand/studio/editor');
    expect(railActive('/brand/studio/compose', '/brand/studio/compose')).toBe(true);
    expect(railActive('/brand/studio/compose', '/brand/studio/editor')).toBe(true);
  });

  it('the new editor keeps its way back to the working editor, which stays there (classic=1)', () => {
    const editor = readFileSync(join(root, 'components/brand-studio/editor-v2/editor-v2.tsx'), 'utf8');
    const page = readFileSync(join(root, 'app/(brand)/brand/studio/editor/page.tsx'), 'utf8');
    expect(editor).toContain('href={currentEditorHref}');
    expect(editor).toContain('copy.notice.current');
    expect(page).toContain("const currentEditorHref = scopedHref('/brand/studio/compose?classic=1', choice);");
    expect(page.match(/currentEditorHref=\{currentEditorHref\}/g)).toHaveLength(2);
  });
});
