import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PromptDetailMedia } from '@/components/prompts/detail-media';
import { defaultTimelineKeyframes, formatKeyframeSeconds, loadPromptKeyframesBySlug } from '@/lib/prompts/keyframes';

describe('Video 3-second keyframe strip & slug loader', () => {
  it('renders PromptDetailMedia without the strip when keyframes are omitted', () => {
    const html = renderToStaticMarkup(
      <PromptDetailMedia
        poster={{ src: '/poster.jpg', mime: 'image/jpeg' }}
        video={{ src: '/clip.mp4', mime: 'video/mp4' }}
        alt="Night clip"
        aspect="9:16"
        controls={{ play: 'Play', pause: 'Pause', unmute: 'Sound on', mute: 'Sound off' }}
        fallback={null}
      />,
    );
    expect(html).not.toContain('data-video-keyframe-strip');
    expect(html).not.toMatch(/[가-힣]/);
  });

  it('renders the 3-second keyframe beat strip beneath video when keyframes are supplied', () => {
    const beats = defaultTimelineKeyframes(10, 4);
    const html = renderToStaticMarkup(
      <PromptDetailMedia
        poster={{ src: '/poster.jpg', mime: 'image/jpeg' }}
        video={{ src: '/clip.mp4', mime: 'video/mp4' }}
        alt="Seoul runway"
        aspect="9:16"
        locale="ko"
        keyframes={beats}
        controls={{ play: '재생', pause: '정지', unmute: '소리 켜기', mute: '소리 끄기' }}
        fallback={null}
      />,
    );
    expect(html).toContain('data-video-keyframe-strip');
    expect(html).toContain('data-video-keyframe="0"');
    expect(html).toContain('data-video-keyframe="3"');
    expect(html).toContain('1.0s');
    expect(html).toContain('8.8s');
    expect(html).toContain('오프닝');
    expect(html).toContain('피날레');
  });

  it('computes default beats cleanly and degrades gracefully if keyframes column lookup fails', async () => {
    expect(formatKeyframeSeconds(3.45)).toBe('3.5s');
    const beats = defaultTimelineKeyframes(12, 4);
    expect(beats).toHaveLength(4);
    expect(beats[0]?.timeSeconds).toBeLessThan(beats[3]!.timeSeconds);

    const failingSql = { query: vi.fn().mockRejectedValue(new Error('column missing')) };
    expect(await loadPromptKeyframesBySlug(failingSql as never, 'runway')).toBeNull();

    const validSql = {
      query: vi.fn().mockResolvedValue({
        rows: [{ keyframes: [{ index: 0, timeSeconds: 4.5, labelKo: '하이라이트' }, { index: 1, timeSeconds: 0.8, labelKo: '오프닝' }] }],
      }),
    };
    const loaded = await loadPromptKeyframesBySlug(validSql as never, 'runway');
    expect(loaded).toHaveLength(2);
    expect(loaded?.[0]).toMatchObject({ index: 0, timeSeconds: 0.8, labelKo: '오프닝' });
  });
});
