import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T>(fn: T) => fn,
}));

import { postGuide } from '@/lib/mcp/server';
import { parsePostSaveInput, type PostSaveInput } from '@/lib/posts/schema';

describe('blog posts allow model and tool names', () => {
  it('passes model and tool names unchanged through the post schema', () => {
    const input: PostSaveInput = {
      title: 'Seedance 2.5 & Seedream 5.5 workflow notes',
      summary: 'Comparing Seedance 2.5, Seedream 5.5, Nano Banana 2.1, Kling, Midjourney, and ComfyUI.',
      coverWorkId: null,
      blocks: [
        { type: 'heading', text: '1. Generating stills in Seedream 5.5 and Midjourney' },
        {
          type: 'text',
          text: 'For this look I tested Seedance 2.5, Seedream 5.5, Nano Banana 2.1, Kling, Midjourney, and ComfyUI side by side.',
        },
        {
          type: 'list',
          items: [
            'Base still: Seedream 5.5 or Nano Banana 2.1',
            'Concept refs: Midjourney + ComfyUI upscale pass',
            'Motion cut: Seedance 2.5 vs Kling 9:16',
          ],
        },
        {
          type: 'media',
          workId: `wrk_${'a'.repeat(32)}`,
          caption: 'Rendered with Seedance 2.5 after a ComfyUI & Midjourney still pass',
        },
        {
          type: 'prompt',
          title: 'Seedance 2.5 / Kling motion beat from Seedream 5.5 still',
          kind: 'video',
          meta: 'Seedance 2.5 · Kling · 9:16 · 5s',
          prompt:
            'Animate the portrait generated in Seedream 5.5 and Nano Banana 2.1 with gentle camera drift, keeping Midjourney lighting and ComfyUI grain.',
          note: 'Tested on Seedance 2.5 and Kling; Nano Banana 2.1 stills held skin tone best.',
        },
      ],
    };

    const parsed = parsePostSaveInput(input);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(input);
    }
  });

  it('documents the blog naming rule in postGuide().naming', () => {
    const guide = postGuide();
    expect(typeof guide.naming).toBe('string');
    expect(guide.naming).toMatch(/models/i);
    expect(guide.naming).toMatch(/tools/i);
  });
});
