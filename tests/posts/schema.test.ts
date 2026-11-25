import { describe, expect, it } from 'vitest';
import {
  POST_HEADING_MAX,
  POST_LIST_MAX_ITEMS,
  POST_LIST_ITEM_MAX,
  POST_MAX_BLOCKS,
  POST_MAX_JSON_BYTES,
  POST_MEDIA_CAPTION_MAX,
  POST_PROMPT_MAX,
  POST_PROMPT_META_MAX,
  POST_PROMPT_MIN,
  POST_PROMPT_NOTE_MAX,
  POST_PROMPT_TITLE_MAX,
  POST_SUMMARY_MAX,
  POST_TEXT_MAX,
  POST_TITLE_MAX,
  baseSlugFromTitle,
  estimateReadingMinutes,
  parseInstagramPost,
  parsePostSaveInput,
} from '@/lib/posts/schema';
import { toPublicBlock, toPublicBlocks } from '@/lib/posts/public';

const WORK_ID = `wrk_${'a'.repeat(32)}`;

describe('posts schema & public projection', () => {
  it('accepts all 7 valid block types and rejects unknown fields strictly', () => {
    const valid = parsePostSaveInput({
      title: 'Night alley look',
      summary: 'How we shot three rain beats.',
      coverWorkId: WORK_ID,
      blocks: [
        { type: 'heading', text: 'Camera & framing' },
        { type: 'text', text: 'Keep the horizon steady.\nWait two beats before the turn.' },
        { type: 'list', items: ['Front-facing photo', 'Even light'] },
        { type: 'media', workId: WORK_ID, caption: 'Frame test' },
        {
          type: 'prompt',
          title: 'Beat 1 — Arrival',
          kind: 'video',
          meta: 'Video · 9:16 · 4s',
          prompt: 'Wide tracking shot of [내 사진] walking past wet neon storefronts.',
          note: 'Keep backgrounds simple.',
        },
        { type: 'template', slug: 'neon-alley-dolly' },
        { type: 'instagram', url: 'https://instagram.com/reel/AbCdEf12345/?utm_source=ig_web_copy_link' },
      ],
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.blocks[6]).toEqual({
        type: 'instagram',
        url: 'https://www.instagram.com/reel/AbCdEf12345/',
      });
    }

    // Unknown top-level field
    expect(
      parsePostSaveInput({
        title: 'Valid title',
        blocks: [],
        userId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({ ok: false, code: 'invalid' });

    // Unknown block field
    expect(
      parsePostSaveInput({
        title: 'Valid title',
        blocks: [{ type: 'heading', text: 'Section', extra: true }],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
  });

  it('enforces title, summary, block count, per-block bounds, and 200KB JSON size cap', () => {
    expect(parsePostSaveInput({ title: 'ab', blocks: [] })).toEqual({ ok: false, code: 'invalid' });
    expect(parsePostSaveInput({ title: 'x'.repeat(POST_TITLE_MAX + 1), blocks: [] })).toEqual({
      ok: false,
      code: 'invalid',
    });
    expect(
      parsePostSaveInput({ title: 'Valid', summary: 'x'.repeat(POST_SUMMARY_MAX + 1), blocks: [] }),
    ).toEqual({ ok: false, code: 'invalid' });

    // 61 blocks > 60
    const tooMany = Array.from({ length: POST_MAX_BLOCKS + 1 }, (_, i) => ({
      type: 'heading' as const,
      text: `H${i}`,
    }));
    expect(parsePostSaveInput({ title: 'Too many blocks', blocks: tooMany })).toEqual({
      ok: false,
      code: 'invalid',
    });

    // Individual block caps
    expect(
      parsePostSaveInput({ title: 'Heading cap', blocks: [{ type: 'heading', text: 'h'.repeat(POST_HEADING_MAX + 1) }] }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({ title: 'Text cap', blocks: [{ type: 'text', text: 't'.repeat(POST_TEXT_MAX + 1) }] }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'List cap',
        blocks: [{ type: 'list', items: Array.from({ length: POST_LIST_MAX_ITEMS + 1 }, () => 'row') }],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'List item cap',
        blocks: [{ type: 'list', items: ['i'.repeat(POST_LIST_ITEM_MAX + 1)] }],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'Media cap',
        blocks: [{ type: 'media', workId: WORK_ID, caption: 'c'.repeat(POST_MEDIA_CAPTION_MAX + 1) }],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'Prompt min',
        blocks: [{ type: 'prompt', title: 'P', kind: 'image', prompt: 'x'.repeat(POST_PROMPT_MIN - 1) }],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'Prompt max',
        blocks: [
          { type: 'prompt', title: 'P', kind: 'video', prompt: 'x'.repeat(POST_PROMPT_MAX + 1) },
        ],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'Prompt title/meta/note caps',
        blocks: [
          {
            type: 'prompt',
            title: 'x'.repeat(POST_PROMPT_TITLE_MAX + 1),
            kind: 'image',
            prompt: 'Valid prompt text here',
          },
        ],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'Prompt meta cap',
        blocks: [
          {
            type: 'prompt',
            title: 'Ok',
            kind: 'image',
            meta: 'm'.repeat(POST_PROMPT_META_MAX + 1),
            prompt: 'Valid prompt text here',
          },
        ],
      }),
    ).toEqual({ ok: false, code: 'invalid' });
    expect(
      parsePostSaveInput({
        title: 'Prompt note cap',
        blocks: [
          {
            type: 'prompt',
            title: 'Ok',
            kind: 'image',
            prompt: 'Valid prompt text here',
            note: 'n'.repeat(POST_PROMPT_NOTE_MAX + 1),
          },
        ],
      }),
    ).toEqual({ ok: false, code: 'invalid' });

    // 200KB JSON cap: 20 x 15,000-char prompt blocks exceeds 200,000 bytes while <= 60 blocks.
    const hugeBlocks = Array.from({ length: 20 }, (_, i) => ({
      type: 'prompt' as const,
      title: `Clip ${i}`,
      kind: 'video' as const,
      prompt: 'a'.repeat(POST_PROMPT_MAX),
    }));
    expect(Buffer.byteLength(JSON.stringify(hugeBlocks), 'utf8')).toBeGreaterThan(POST_MAX_JSON_BYTES);
    expect(parsePostSaveInput({ title: 'Huge JSON', blocks: hugeBlocks })).toEqual({
      ok: false,
      code: 'too_large',
    });
  });

  it('rejects non-Instagram URLs and control characters, and normalizes Instagram embeds', () => {
    for (const bad of [
      'https://www.tiktok.com/@user/video/123456789',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://x.com/user/status/123456',
      'http://instagram.com/p/AbCdEf/',
      'https://instagram.com/stories/user/123/',
    ]) {
      expect(parseInstagramPost(bad)).toBeNull();
      expect(parsePostSaveInput({ title: 'Bad IG', blocks: [{ type: 'instagram', url: bad }] })).toEqual({
        ok: false,
        code: 'invalid',
      });
    }

    expect(parseInstagramPost('https://www.instagram.com/p/TestPost123/')).toEqual({
      kind: 'p',
      id: 'TestPost123',
      url: 'https://www.instagram.com/p/TestPost123/',
      embedUrl: 'https://www.instagram.com/p/TestPost123/embed',
    });
    expect(parseInstagramPost('https://instagram.com/reels/ReelClip99/')).toEqual({
      kind: 'reel',
      id: 'ReelClip99',
      url: 'https://www.instagram.com/reel/ReelClip99/',
      embedUrl: 'https://www.instagram.com/reel/ReelClip99/embed',
    });

    // Control characters rejected
    expect(parsePostSaveInput({ title: 'Null\u0000byte', blocks: [] })).toEqual({ ok: false, code: 'invalid' });
    expect(parsePostSaveInput({ title: 'Valid', blocks: [{ type: 'text', text: 'bad\u0007bell' }] })).toEqual({
      ok: false,
      code: 'invalid',
    });
  });

  it('strips prompt body, meta, and tip completely in public projection', () => {
    const SECRET_PROMPT = 'SECRET_PROMPT_CANARY_do_not_leak_to_anon';
    const SECRET_META = 'SECRET_META_CANARY_9x16';
    const SECRET_TIP = 'SECRET_TIP_CANARY_stay_centered';

    const pub = toPublicBlock({
      type: 'prompt',
      title: 'Visible Clip Title',
      kind: 'video',
      meta: SECRET_META,
      prompt: SECRET_PROMPT,
      note: SECRET_TIP,
    });

    expect(pub).toEqual({ type: 'prompt', title: 'Visible Clip Title', kind: 'video' });
    const serialized = JSON.stringify(
      toPublicBlocks([
        { type: 'heading', text: 'Intro' },
        {
          type: 'prompt',
          title: 'Visible Clip Title',
          kind: 'video',
          meta: SECRET_META,
          prompt: SECRET_PROMPT,
          note: SECRET_TIP,
        },
      ]),
    );
    expect(serialized).not.toContain(SECRET_PROMPT);
    expect(serialized).not.toContain(SECRET_META);
    expect(serialized).not.toContain(SECRET_TIP);
    expect(serialized).toContain('Visible Clip Title');
  });

  it('generates clean ASCII slugs or null for Korean titles and computes reading minutes from public text', () => {
    expect(baseSlugFromTitle('Neon Alley Breakdown!')).toBe('neon-alley-breakdown');
    expect(baseSlugFromTitle('서울 야경 릴스 제작기')).toBeNull();
    expect(estimateReadingMinutes('Hi', null, [{ type: 'text', text: 'short' }])).toBe(1);
    expect(
      estimateReadingMinutes('Long', null, [{ type: 'text', text: '가'.repeat(1000) }]),
    ).toBe(3);
  });
});
