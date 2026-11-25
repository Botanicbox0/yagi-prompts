import { z } from 'zod';
import { canonicalPost } from '@/lib/creator-platform/social';
import { MAX_STEP_PROMPT_CHARS, MIN_STEP_PROMPT_CHARS, NOTE_MAX } from '@/lib/recipes/schema';

/**
 * AI creative blog post & block schema (Batch 3, maker-blog). Pure: imported by server services,
 * MCP tools, and client editors alike. Every limit is exported so UI hints, MCP guides, and tests
 * derive from one source of truth.
 */

export const POST_TITLE_MIN = 3;
export const POST_TITLE_MAX = 120;
export const POST_SUMMARY_MAX = 200;
export const POST_SLUG_MAX = 80;
export const POST_MAX_BLOCKS = 60;
export const POST_MAX_JSON_BYTES = 200_000;

export const POST_HEADING_MIN = 1;
export const POST_HEADING_MAX = 120;
export const POST_TEXT_MIN = 1;
export const POST_TEXT_MAX = 3_000;
export const POST_LIST_MIN_ITEMS = 1;
export const POST_LIST_MAX_ITEMS = 12;
export const POST_LIST_ITEM_MAX = 200;
export const POST_MEDIA_CAPTION_MAX = 120;
export const POST_WORK_ID_PATTERN = /^wrk_[0-9a-f]{32}$/;

export const POST_PROMPT_TITLE_MIN = 1;
export const POST_PROMPT_TITLE_MAX = 120;
export const POST_PROMPT_META_MAX = 80;
export const POST_PROMPT_MIN = MIN_STEP_PROMPT_CHARS;
export const POST_PROMPT_MAX = MAX_STEP_PROMPT_CHARS;
export const POST_PROMPT_NOTE_MAX = NOTE_MAX;

export const POST_TEMPLATE_SLUG_MAX = 120;
export const POST_TEMPLATE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const POST_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const POST_MAX_PER_MAKER = 50;
export const POST_MAX_NEW_PER_DAY = 5;

export const POST_STATUSES = ['draft', 'published', 'hidden'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_BLOCK_TYPES = [
  'heading',
  'text',
  'list',
  'media',
  'prompt',
  'template',
  'instagram',
] as const;
export type PostBlockType = (typeof POST_BLOCK_TYPES)[number];

const CONTROL_CHARS_ANY = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARS_KEEP_NEWLINES = /[\u0000-\u0009\u000b-\u001f\u007f]/;

function singleLineString(min: number, max: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= min && value.length <= max && !CONTROL_CHARS_ANY.test(value), {
      message: 'invalid_text',
    });
}

function optionalSingleLineString(max: number) {
  return z
    .string()
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    })
    .refine((value) => value === undefined || (value.length <= max && !CONTROL_CHARS_ANY.test(value)), {
      message: 'invalid_text',
    })
    .optional();
}

function multiLineString(min: number, max: number) {
  return z
    .string()
    .transform((value) => value.trim().replace(/\r\n?/g, '\n'))
    .refine((value) => value.length >= min && value.length <= max && !CONTROL_CHARS_KEEP_NEWLINES.test(value), {
      message: 'invalid_text',
    });
}

function optionalMultiLineString(max: number) {
  return z
    .string()
    .transform((value) => {
      const cleaned = value.trim().replace(/\r\n?/g, '\n');
      return cleaned === '' ? undefined : cleaned;
    })
    .refine((value) => value === undefined || (value.length <= max && !CONTROL_CHARS_KEEP_NEWLINES.test(value)), {
      message: 'invalid_text',
    })
    .optional();
}

export interface ParsedInstagramPost {
  kind: 'p' | 'reel';
  id: string;
  url: string;
  embedUrl: string;
}

/**
 * Validates and normalizes an Instagram post/reel URL using `canonicalPost`.
 * Rejects non-Instagram URLs and never performs any network request.
 */
export function parseInstagramPost(raw: string): ParsedInstagramPost | null {
  if (typeof raw !== 'string') return null;
  const parsed = canonicalPost(raw.trim());
  if (!parsed || parsed.platform !== 'instagram') return null;
  const match = /^https:\/\/www\.instagram\.com\/(p|reel)\/([A-Za-z0-9_-]{3,80})\/$/.exec(parsed.url);
  if (!match) return null;
  const kind = match[1] as 'p' | 'reel';
  const id = match[2]!;
  return {
    kind,
    id,
    url: parsed.url,
    embedUrl: `https://www.instagram.com/${kind}/${id}/embed`,
  };
}

const HeadingBlockSchema = z
  .object({
    type: z.literal('heading'),
    text: singleLineString(POST_HEADING_MIN, POST_HEADING_MAX),
  })
  .strict();

const TextBlockSchema = z
  .object({
    type: z.literal('text'),
    text: multiLineString(POST_TEXT_MIN, POST_TEXT_MAX),
  })
  .strict();

const ListBlockSchema = z
  .object({
    type: z.literal('list'),
    items: z
      .array(singleLineString(1, POST_LIST_ITEM_MAX))
      .min(POST_LIST_MIN_ITEMS)
      .max(POST_LIST_MAX_ITEMS),
  })
  .strict();

const MediaBlockSchema = z
  .object({
    type: z.literal('media'),
    workId: z.string().trim().regex(POST_WORK_ID_PATTERN),
    caption: optionalSingleLineString(POST_MEDIA_CAPTION_MAX),
  })
  .strict();

const PromptBlockSchema = z
  .object({
    type: z.literal('prompt'),
    title: singleLineString(POST_PROMPT_TITLE_MIN, POST_PROMPT_TITLE_MAX),
    kind: z.enum(['image', 'video']),
    meta: optionalSingleLineString(POST_PROMPT_META_MAX),
    prompt: multiLineString(POST_PROMPT_MIN, POST_PROMPT_MAX),
    note: optionalMultiLineString(POST_PROMPT_NOTE_MAX),
  })
  .strict();

const TemplateBlockSchema = z
  .object({
    type: z.literal('template'),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(POST_TEMPLATE_SLUG_MAX)
      .regex(POST_TEMPLATE_SLUG_PATTERN),
  })
  .strict();

const InstagramBlockSchema = z
  .object({
    type: z.literal('instagram'),
    url: z
      .string()
      .trim()
      .transform((raw, ctx) => {
        const parsed = parseInstagramPost(raw);
        if (!parsed) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_instagram_url' });
          return z.NEVER;
        }
        return parsed.url;
      }),
  })
  .strict();

export const PostBlockSchema = z.discriminatedUnion('type', [
  HeadingBlockSchema,
  TextBlockSchema,
  ListBlockSchema,
  MediaBlockSchema,
  PromptBlockSchema,
  TemplateBlockSchema,
  InstagramBlockSchema,
]);

export type PostBlock = z.infer<typeof PostBlockSchema>;
export type PostHeadingBlock = z.infer<typeof HeadingBlockSchema>;
export type PostTextBlock = z.infer<typeof TextBlockSchema>;
export type PostListBlock = z.infer<typeof ListBlockSchema>;
export type PostMediaBlock = z.infer<typeof MediaBlockSchema>;
export type PostPromptBlock = z.infer<typeof PromptBlockSchema>;
export type PostTemplateBlock = z.infer<typeof TemplateBlockSchema>;
export type PostInstagramBlock = z.infer<typeof InstagramBlockSchema>;

export const PostBlocksSchema = z.array(PostBlockSchema).max(POST_MAX_BLOCKS);

const OptionalSummarySchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const cleaned = value.trim().replace(/\r\n?/g, ' ');
    return cleaned === '' ? null : cleaned;
  })
  .refine((value) => value === null || (value.length <= POST_SUMMARY_MAX && !CONTROL_CHARS_ANY.test(value)), {
    message: 'invalid_summary',
  });

const OptionalCoverWorkIdSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  })
  .refine((value) => value === null || POST_WORK_ID_PATTERN.test(value), {
    message: 'invalid_cover_work_id',
  });

export const PostSaveInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: singleLineString(POST_TITLE_MIN, POST_TITLE_MAX),
    summary: OptionalSummarySchema.optional(),
    coverWorkId: OptionalCoverWorkIdSchema.optional(),
    blocks: PostBlocksSchema,
  })
  .strict();

export type PostSaveInput = {
  id?: string;
  title: string;
  summary: string | null;
  coverWorkId: string | null;
  blocks: PostBlock[];
};

const encoder = new TextEncoder();

export function jsonUtf8Bytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value ?? null)).byteLength;
}

export type ParsePostCheck =
  | { ok: true; value: PostSaveInput }
  | { ok: false; code: 'too_large' | 'invalid' };

export function parsePostSaveInput(raw: unknown): ParsePostCheck {
  if (jsonUtf8Bytes(raw) > POST_MAX_JSON_BYTES + 8_192) {
    return { ok: false, code: 'too_large' };
  }
  const parsed = PostSaveInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: 'invalid' };
  }
  if (jsonUtf8Bytes(parsed.data.blocks) > POST_MAX_JSON_BYTES) {
    return { ok: false, code: 'too_large' };
  }
  return {
    ok: true,
    value: {
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      title: parsed.data.title,
      summary: parsed.data.summary ?? null,
      coverWorkId: parsed.data.coverWorkId ?? null,
      blocks: parsed.data.blocks,
    },
  };
}

export type ParseStoredBlocksCheck =
  | { ok: true; blocks: PostBlock[] }
  | { ok: false; code: 'too_large' | 'invalid' };

export function parsePostBlocks(raw: unknown): ParseStoredBlocksCheck {
  if (jsonUtf8Bytes(raw) > POST_MAX_JSON_BYTES) {
    return { ok: false, code: 'too_large' };
  }
  const parsed = PostBlocksSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: 'invalid' };
  }
  return { ok: true, blocks: parsed.data };
}

/** Strips empty optional properties so stored JSON stays compact and canonical. */
export function compactPostBlock(block: PostBlock): PostBlock {
  switch (block.type) {
    case 'media':
      return block.caption ? { type: 'media', workId: block.workId, caption: block.caption } : { type: 'media', workId: block.workId };
    case 'prompt':
      return {
        type: 'prompt',
        title: block.title,
        kind: block.kind,
        ...(block.meta ? { meta: block.meta } : {}),
        prompt: block.prompt,
        ...(block.note ? { note: block.note } : {}),
      };
    default:
      return block;
  }
}

/**
 * Generates an ASCII slug prefix from a title, or `null` when the title has no ASCII
 * letters/digits (e.g. Korean-only titles), in which case the server assigns a short hex id.
 */
export function baseSlugFromTitle(title: string): string | null {
  const normalized = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return normalized && POST_SLUG_PATTERN.test(normalized) ? normalized : null;
}

export function extractTemplateSlugs(
  blocks: ReadonlyArray<{ type: string; slug?: unknown }>,
): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'template' && typeof block.slug === 'string') {
      seen.add(block.slug);
    }
  }
  return [...seen];
}

export function extractMediaWorkIds(coverWorkId: string | null, blocks: readonly PostBlock[]): string[] {
  const seen = new Set<string>();
  if (coverWorkId) seen.add(coverWorkId);
  for (const block of blocks) {
    if (block.type === 'media') seen.add(block.workId);
  }
  return [...seen];
}

export function headingAnchorId(headingNumber: number): string {
  return `sec-${headingNumber}`;
}

/**
 * Estimates reading time in whole minutes (>= 1) using public-visible fields only (title, summary,
 * heading, text, list, media caption, prompt title), so gated prompt/tip lengths are never reflected.
 */
export function estimateReadingMinutes(
  title: string,
  summary: string | null,
  blocks: ReadonlyArray<{
    type: string;
    text?: string;
    items?: readonly string[];
    caption?: string;
    title?: string;
  }>,
): number {
  let chars = title.trim().length + (summary?.trim().length ?? 0);
  for (const b of blocks) {
    if (b.type === 'heading' && typeof b.text === 'string') chars += b.text.length;
    else if (b.type === 'text' && typeof b.text === 'string') chars += b.text.length;
    else if (b.type === 'list' && Array.isArray(b.items)) {
      for (const item of b.items) if (typeof item === 'string') chars += item.length;
    } else if (b.type === 'media' && typeof b.caption === 'string') chars += b.caption.length;
    else if (b.type === 'prompt' && typeof b.title === 'string') chars += b.title.length;
  }
  // ~450 mixed Korean/English chars per minute, clamped at >= 1 minute.
  return Math.max(1, Math.ceil(chars / 450));
}
