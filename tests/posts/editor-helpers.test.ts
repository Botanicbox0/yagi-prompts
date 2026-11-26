import { describe, expect, it } from 'vitest';
import {
  buildImportedTemplateBlocks,
  createEmptyBlock,
  duplicateBlock,
  moveBlock,
  removeBlock,
  sanitizeDraftBlocks,
} from '@/lib/posts/editor-helpers';
import type { PostBlock } from '@/lib/posts/schema';

describe('post editor helpers', () => {
  it('moves, duplicates, and deletes blocks while keeping selection valid', () => {
    const start: PostBlock[] = [
      createEmptyBlock('heading'),
      { type: 'text', text: 'First note' },
      { type: 'instagram', url: 'https://www.instagram.com/reel/C9AbCdEf123/' },
    ];

    const moved = moveBlock(start, 1, -1);
    expect(moved.nextIndex).toBe(0);
    expect(moved.blocks[0]).toEqual({ type: 'text', text: 'First note' });

    const duplicated = duplicateBlock(moved.blocks, 0);
    expect(duplicated.nextIndex).toBe(1);
    expect(duplicated.blocks).toHaveLength(4);
    expect(duplicated.blocks[1]).toEqual({ type: 'text', text: 'First note' });

    const removed = removeBlock(duplicated.blocks, 3);
    expect(removed.nextIndex).toBe(2);
    expect(removed.blocks).toHaveLength(3);
  });

  it('imports clips + template block from owned template without leaking raw slots', () => {
    const blocks = buildImportedTemplateBlocks({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'rainy-cafe',
      title: 'Rainy Cafe',
      titleKo: '비 오는 카페',
      clips: [
        {
          title: '첫 장면',
          kind: 'image',
          meta: '9:16',
          prompt: '[내 사진] rain reflections on window',
          note: '빗방울 초점을 잡으세요.',
        },
      ],
    });

    expect(blocks).toEqual([
      {
        type: 'prompt',
        title: '첫 장면',
        kind: 'image',
        meta: '9:16',
        prompt: '[내 사진] rain reflections on window',
        note: '빗방울 초점을 잡으세요.',
      },
      {
        type: 'template',
        slug: 'rainy-cafe',
      },
    ]);
  });

  it('sanitizes draft blocks before submit', () => {
    const cleaned = sanitizeDraftBlocks([
      { type: 'list', items: ['  첫째 ', '', ' 둘째  '] },
      { type: 'prompt', title: ' 컷 1 ', kind: 'video', meta: '   ', prompt: '  pan left\r\n ', note: '' },
    ]);
    expect(cleaned).toEqual([
      { type: 'list', items: ['첫째', '둘째'] },
      { type: 'prompt', title: '컷 1', kind: 'video', prompt: 'pan left' },
    ]);
  });
});
