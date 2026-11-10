import { describe, expect, it } from 'vitest';
import {
  findMissingReferences,
  findReferenceMentions,
  listReferenceMentions,
  rewriteReferenceMentions,
} from '@/lib/brand-studio/enhancer/mentions';

describe('findReferenceMentions — Korean', () => {
  it.each([
    ['이미지 1의 병을 이미지 2 배경 위에 올려 주세요', [1, 2]],
    ['이미지1을 크게', [1]],
    ['사진 3처럼 밝게', [3]],
    ['두 번째 이미지의 라벨', [2]],
    ['1번 사진 그대로', [1]],
    ['첫째 그림의 색감', [1]],
    ['이미지 1, 2를 나란히', [1, 2]],
    ['이미지 1과 3을 섞어서', [1, 3]],
    ['이미지 1~3 모두', [1, 2, 3]],
    ['@이미지2 의 로고', [2]],
    ['제품이미지 2 로', [2]],
    ['이미지 1 배경은 빼고', [1]],
  ])('%s', (prompt, expected) => {
    expect(findReferenceMentions(prompt, 'image')).toEqual(expected);
  });

  it.each([
    '이미지 2장 만들어 줘',
    '사진 4개',
    '이미지 16:9로',
    '이미지 2 장',
    '이미지 3컷',
    '이미지 1.5배',
  ])('a count or size is not a mention: %s', (prompt) => {
    expect(findReferenceMentions(prompt, 'image')).toEqual([]);
  });

  it('video and audio words', () => {
    expect(findReferenceMentions('영상 1처럼 카메라가 다가가고', 'video')).toEqual([1]);
    expect(findReferenceMentions('영상 1 초반의 움직임', 'video')).toEqual([1]);
    expect(findReferenceMentions('영상 15초짜리', 'video')).toEqual([]);
    expect(findReferenceMentions('오디오 1 분위기', 'audio')).toEqual([1]);
    expect(findReferenceMentions('영상 1처럼', 'image')).toEqual([]);
  });
});

describe('findReferenceMentions — English', () => {
  it.each([
    ['Put the bottle from image 2 on the table in image 1', [1, 2]],
    ['use Figure 3 for the light', [3]],
    ['like the second photo', [2]],
    ['images 1 and 3 side by side', [1, 3]],
    ['image #2 label', [2]],
    ['@image1 bottle', [1]],
  ])('%s', (prompt, expected) => {
    expect(findReferenceMentions(prompt, 'image')).toEqual(expected);
  });

  it.each(['image 16:9', 'image 2K', 'video 1080p', 'video 15s long', 'make 2 images', 'image 4x larger'])(
    'not a mention: %s',
    (prompt) => {
      expect([...findReferenceMentions(prompt, 'image'), ...findReferenceMentions(prompt, 'video')]).toEqual([]);
    },
  );

  it('video 1 is a video, not an image', () => {
    expect(findReferenceMentions('follow video 1', 'video')).toEqual([1]);
    expect(findReferenceMentions('follow video 1', 'image')).toEqual([]);
  });
});

describe('bare @N is a tray position', () => {
  it('reads @1 and @ 2 but not an address', () => {
    expect(findReferenceMentions('@1 병을 @ 2 위에', 'any')).toEqual([1, 2]);
    expect(findReferenceMentions('mail me at team@1studio', 'any')).toEqual([]);
  });
});

describe('findMissingReferences', () => {
  it('flags a number beyond the tray, per kind', () => {
    expect(findMissingReferences('이미지 3의 라벨', ['image', 'image'])).toEqual([{ kind: 'image', number: 3 }]);
    expect(findMissingReferences('영상 1처럼', ['image'])).toEqual([{ kind: 'video', number: 1 }]);
    expect(findMissingReferences('@3 위에', ['image', 'video'])).toEqual([{ kind: 'any', number: 3 }]);
  });

  it('is empty when every mention is attached', () => {
    expect(findMissingReferences('이미지 2와 영상 1, @3', ['image', 'image', 'video'])).toEqual([]);
    expect(findMissingReferences('이미지 2장 만들어 줘', [])).toEqual([]);
  });
});

describe('rewriteReferenceMentions', () => {
  it('rewrites spans and lists, keeps particles', () => {
    const out = rewriteReferenceMentions('이미지 1과 2를 영상 1처럼', (kind, n) =>
      kind === 'image' ? `Figure ${n}` : kind === 'video' ? `@Video${n}` : null,
    );
    expect(out).toBe('Figure 1 and Figure 2를 @Video1처럼');
  });

  it('leaves a mention it cannot resolve', () => {
    expect(rewriteReferenceMentions('이미지 4 그대로', () => null)).toBe('이미지 4 그대로');
  });

  it('reports spans in reading order', () => {
    const spans = listReferenceMentions('사진 2 다음 이미지 1');
    expect(spans.map((s) => s.number)).toEqual([2, 1]);
  });
});
