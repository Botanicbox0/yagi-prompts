import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T>(fn: T) => fn,
}));

import { postGuide } from '@/lib/mcp/server';
import { parsePostSaveInput, type PostSaveInput } from '@/lib/posts/schema';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

const FORBIDDEN_ENGINE_PATTERN =
  /\b(?:seedance|seedream|kling|nano\s*banana|midjourney|comfyui|gpt\s*image|higgsfield|sunra|sora|veo|runway)\b/i;

function flattenLeaves(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenLeaves(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

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

  it('keeps customer copy free of 메이커, Maker Studio, and engine/provider names outside post bodies', () => {
    const sections: Array<[string, unknown, unknown]> = [
      ['nav.blog', ko.nav.blog, en.nav.blog],
      ['appShell.tabs.maker', ko.appShell.tabs.maker, en.appShell.tabs.maker],
      ['renders.writePost', ko.renders.writePost, en.renders.writePost],
      ['creatorProgram.payoutStatusAccruing', ko.creatorProgram.payoutStatusAccruing, en.creatorProgram.payoutStatusAccruing],
      ['creatorProgram.openMaker', ko.creatorProgram.openMaker, en.creatorProgram.openMaker],
      ['makers', ko.makers, en.makers],
      ['makerBlog', ko.makerBlog, en.makerBlog],
    ];

    for (const [name, koVal, enVal] of sections) {
      for (const [key, text] of flattenLeaves(koVal, name)) {
        expect(text, `ko.${key}`).not.toContain('메이커');
        expect(text, `ko.${key}`).not.toMatch(/maker studio/i);
        if (!key.endsWith('fieldPromptMetaPlaceholder')) {
          expect(text, `ko.${key}`).not.toMatch(FORBIDDEN_ENGINE_PATTERN);
        }
      }
      for (const [key, text] of flattenLeaves(enVal, name)) {
        expect(text, `en.${key}`).not.toMatch(/maker studio/i);
        if (!key.endsWith('fieldPromptMetaPlaceholder')) {
          expect(text, `en.${key}`).not.toMatch(FORBIDDEN_ENGINE_PATTERN);
        }
      }
    }

    const openMakerCard = readFileSync(join(process.cwd(), 'components', 'creators', 'open-maker-card.tsx'), 'utf8');
    expect(openMakerCard).not.toContain('메이커');
    expect(openMakerCard).not.toMatch(/Maker Studio/);

    const workspaceComp = readFileSync(join(process.cwd(), 'components', 'creators', 'workspace.tsx'), 'utf8');
    expect(workspaceComp).not.toContain('예상 수익 적립');
    expect(workspaceComp).not.toContain('Estimated revenue accruing');

    const bottomTabs = readFileSync(join(process.cwd(), 'components', 'app', 'bottom-tabs.tsx'), 'utf8');
    expect(bottomTabs).not.toContain("'스튜디오'");
    expect(bottomTabs).not.toContain("'Maker'");
  });
});
