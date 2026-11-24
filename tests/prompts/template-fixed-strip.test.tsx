import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import { PromptDetailMedia } from '@/components/prompts/detail-media';
import { TemplateFixedStrip, fixedRangeText } from '@/components/prompts/template-fixed-strip';
import { KeyframePicker } from '@/components/recipes/keyframe-picker';
import { defaultTimelineKeyframes } from '@/lib/prompts/keyframes';
import { parseTemplateLocks, publicLocks, renderLockBlock } from '@/lib/template-director/locks';
import { templatePartsView, type TemplatePartView } from '@/lib/template-director/parts-view';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — the "what this template decides" row under the example video. A template
 * with no declaration gets no new markup: the media block and the maker's keyframe picker are byte-identical to the
 * markup captured before this change (tests/prompts/fixtures/detail-media-baseline.json).
 */

const baseline = JSON.parse(readFileSync('tests/prompts/fixtures/detail-media-baseline.json', 'utf8')) as {
  detailMedia: Record<'noKeyframes' | 'beatsKo' | 'beatsEnLandscape' | 'posterOnly', string>;
  picker: Record<'makerKo' | 'makerEn', string>;
};
const controlsEn = { play: 'Play', pause: 'Pause', unmute: 'Sound on', mute: 'Sound off' };
const controlsKo = { play: '재생', pause: '정지', unmute: '소리 켜기', mute: '소리 끄기' };

const fixedCopy = (dict: typeof ko | typeof en) => ({
  heading: dict.templates.fixed.heading,
  hint: dict.templates.fixed.hint,
  wholeVideo: dict.templates.fixed.wholeVideo,
  locked: dict.templates.fixed.locked,
  lockedAll: dict.editSheet.lockedAll,
});

const BODY = 'A woman walks through a neon alley at night.';
const LOCKS = publicLocks(parseTemplateLocks(`${BODY}\n\n${renderLockBlock([{ kind: 'product' }, { kind: 'slot', slot: 'hair', note: 'PRIVATE-TAIL pink bob' }, { kind: 'shots', from: 2, to: 3 }])}`))!;
const MARKS = [{ index: 0, timeSeconds: 3.2, endSeconds: 6.4, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' }];

function partsFor(locale: 'ko' | 'en'): TemplatePartView[] {
  return templatePartsView({ locks: LOCKS, marks: MARKS, copy: (locale === 'ko' ? ko : en).editSheet, locale });
}

describe('no declaration: the markup is exactly what it was', () => {
  it('PromptDetailMedia', () => {
    expect(
      renderToStaticMarkup(
        <PromptDetailMedia poster={{ src: '/poster.jpg', mime: 'image/jpeg' }} video={{ src: '/clip.mp4', mime: 'video/mp4' }} alt="Night clip" aspect="9:16" controls={controlsEn} fallback={null} />,
      ),
    ).toBe(baseline.detailMedia.noKeyframes);
    expect(
      renderToStaticMarkup(
        <PromptDetailMedia poster={{ src: '/poster.jpg', mime: 'image/jpeg' }} video={{ src: '/clip.mp4', mime: 'video/mp4' }} alt="Seoul runway" aspect="9:16" locale="ko" keyframes={defaultTimelineKeyframes(10, 4)} controls={controlsKo} fallback={null} fixed={null} />,
      ),
    ).toBe(baseline.detailMedia.beatsKo);
    expect(
      renderToStaticMarkup(
        <PromptDetailMedia poster={null} video={{ src: 'https://media.example.com/a.mp4', mime: 'video/mp4' }} alt="Wide" aspect="16:9" locale="en" keyframes={defaultTimelineKeyframes(12, 5)} controls={controlsEn} fallback={null} />,
      ),
    ).toBe(baseline.detailMedia.beatsEnLandscape);
    expect(
      renderToStaticMarkup(
        <PromptDetailMedia poster={{ src: '/poster.jpg', mime: 'image/jpeg', w: 720, h: 1280 }} video={null} alt="Still" aspect="4:5" keyframes={defaultTimelineKeyframes(10, 4)} controls={controlsEn} fallback={null} />,
      ),
    ).toBe(baseline.detailMedia.posterOnly);
  });

  it('an empty declaration adds nothing either', () => {
    const html = renderToStaticMarkup(
      <PromptDetailMedia poster={{ src: '/poster.jpg', mime: 'image/jpeg' }} video={{ src: '/clip.mp4', mime: 'video/mp4' }} alt="Seoul runway" aspect="9:16" locale="ko" keyframes={defaultTimelineKeyframes(10, 4)} controls={controlsKo} fallback={null} fixed={{ parts: [], all: false, copy: fixedCopy(ko) }} />,
    );
    expect(html).toBe(baseline.detailMedia.beatsKo);
    expect(html).not.toContain('data-template-fixed');
  });

  it('the maker keyframe picker', () => {
    expect(renderToStaticMarkup(createElement(KeyframePicker, { formatId: '00000000-0000-4000-8000-000000000001', durationSeconds: 10, title: 'Runway', locale: 'ko' }))).toBe(baseline.picker.makerKo);
    expect(
      renderToStaticMarkup(
        createElement(KeyframePicker, {
          formatId: '00000000-0000-4000-8000-000000000001',
          durationSeconds: 8,
          title: 'Runway',
          locale: 'en',
          exampleVideoSrc: '/clip.mp4',
          initialKeyframes: [
            { index: 0, timeSeconds: 1, labelKo: '오프닝', labelEn: 'Opening' },
            { index: 1, timeSeconds: 5.5, labelEn: 'Turn' },
          ],
        }),
      ),
    ).toBe(baseline.picker.makerEn);
  });
});

describe('a declared template', () => {
  const render = (locale: 'ko' | 'en', video = true) =>
    renderToStaticMarkup(
      <PromptDetailMedia
        poster={{ src: '/poster.jpg', mime: 'image/jpeg' }}
        video={video ? { src: '/clip.mp4', mime: 'video/mp4' } : null}
        alt="Serum"
        aspect="9:16"
        locale={locale}
        keyframes={defaultTimelineKeyframes(10, 4)}
        controls={locale === 'ko' ? controlsKo : controlsEn}
        fallback={null}
        fixed={{ parts: partsFor(locale), all: false, copy: fixedCopy(locale === 'ko' ? ko : en) }}
      />,
    );

  it('shows the row under the keyframe strip with each part, its state and its range', () => {
    const html = render('ko');
    expect(html).toContain('data-template-fixed');
    expect(html.indexOf('data-video-keyframe-strip')).toBeLessThan(html.indexOf('data-template-fixed'));
    expect(html).toContain('이 템플릿에서 정해진 것');
    for (const key of ['product', 'hair', 'shots-2-3']) expect(html).toContain(`data-fixed-part="${key}"`);
    expect(html).toContain('핑크 단발');
    expect(html).toContain('0:03–0:06');
    expect(html).toContain('바꿀 수 없어요');
    expect(html).toContain('영상 전체');
    expect(html).toContain('누르면 그 장면만 다시 볼 수 있어요.');
    // Only the part with a range is a button; it starts unpressed.
    expect(html.match(/<button[^>]*data-fixed-item/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*data-fixed-item="hair"[^>]*aria-pressed="false"/);
    expect(html).toContain('tabular-nums');
    // The lock block's words never reach the page.
    for (const needle of ['PRIVATE-TAIL', 'pink bob', 'Template locks', 'Keep exactly']) expect(html.includes(needle), needle).toBe(false);
  });

  it('speaks English on the English page, with no Korean', () => {
    const html = render('en');
    const fixed = html.slice(html.indexOf('data-template-fixed'));
    expect(fixed).toContain('What this template decides');
    expect(fixed).toContain('Pink bob');
    expect(fixed).toContain("Can&#x27;t be changed");
    expect(fixed).toContain('Whole video');
    expect(fixed).not.toMatch(/[가-힣]/);
  });

  it('still lists the parts when the clip is missing, with nothing to tap', () => {
    const html = render('ko', false);
    expect(html).toContain('data-template-fixed');
    expect(html).not.toMatch(/<button[^>]*data-fixed-item/);
    expect(html).not.toContain('누르면 그 장면만 다시 볼 수 있어요.');
  });

  it('says everything is fixed in one line for a block that did not parse', () => {
    const html = renderToStaticMarkup(createElement(TemplateFixedStrip, { parts: [], all: true, copy: fixedCopy(ko) }));
    expect(html).toContain('data-template-fixed');
    expect(html).toContain(ko.editSheet.lockedAll);
    expect(html).not.toContain('data-fixed-part');
  });

  it('renders nothing with nothing to say', () => {
    expect(renderToStaticMarkup(createElement(TemplateFixedStrip, { parts: [], all: false, copy: fixedCopy(ko) }))).toBe('');
  });

  it('formats the range: from–to, a lone start, the whole video, and nothing for a shot range', () => {
    const copy = fixedCopy(ko);
    const part = (over: Partial<TemplatePartView>): TemplatePartView => ({ id: 'x', key: 'hair', state: 'locked', label: '헤어', desc: null, from: null, to: null, choice: false, ...over });
    expect(fixedRangeText(part({ from: 3.2, to: 6.4 }), copy)).toBe('0:03–0:06');
    expect(fixedRangeText(part({ from: 3.2 }), copy)).toBe('0:03');
    expect(fixedRangeText(part({}), copy)).toBe('영상 전체');
    expect(fixedRangeText(part({ key: 'shots-2-3' }), copy)).toBeNull();
  });
});
