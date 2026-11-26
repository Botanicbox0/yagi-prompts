import type { MakerImportableTemplate } from './service';
import {
  POST_MAX_BLOCKS,
  type PostBlock,
  type PostBlockType,
} from './schema';

/**
 * Pure block-list helpers shared by the workspace post editor (`components/posts/post-editor.tsx`)
 * and unit tests. Kept free of `'use client'` so server tests can verify every edit transition.
 */

export interface EditorBlockContext {
  defaultWorkId?: string | null;
  defaultTemplateSlug?: string | null;
}

export function createEmptyBlock(
  type: PostBlockType,
  context: EditorBlockContext = {},
): PostBlock {
  switch (type) {
    case 'heading':
      return { type: 'heading', text: '' };
    case 'text':
      return { type: 'text', text: '' };
    case 'list':
      return { type: 'list', items: [''] };
    case 'media':
      return { type: 'media', workId: context.defaultWorkId ?? '', caption: '' };
    case 'prompt':
      return {
        type: 'prompt',
        title: '',
        kind: 'image',
        meta: '',
        prompt: '',
        note: '',
      };
    case 'template':
      return { type: 'template', slug: context.defaultTemplateSlug ?? '' };
    case 'instagram':
      return { type: 'instagram', url: '' };
  }
}

export function moveBlock(
  blocks: readonly PostBlock[],
  index: number,
  delta: -1 | 1,
): { blocks: PostBlock[]; nextIndex: number } {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return { blocks: [...blocks], nextIndex: index };
  }
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return { blocks: next, nextIndex: target };
}

export function duplicateBlock(
  blocks: readonly PostBlock[],
  index: number,
): { blocks: PostBlock[]; nextIndex: number } {
  if (index < 0 || index >= blocks.length || blocks.length >= POST_MAX_BLOCKS) {
    return { blocks: [...blocks], nextIndex: index };
  }
  const copy = structuredClone(blocks[index]!);
  const next = [...blocks];
  next.splice(index + 1, 0, copy);
  return { blocks: next, nextIndex: index + 1 };
}

export function removeBlock(
  blocks: readonly PostBlock[],
  index: number,
): { blocks: PostBlock[]; nextIndex: number } {
  if (index < 0 || index >= blocks.length) {
    return { blocks: [...blocks], nextIndex: index };
  }
  const next = blocks.filter((_, idx) => idx !== index);
  const nextIndex = next.length === 0 ? -1 : Math.min(index, next.length - 1);
  return { blocks: next, nextIndex };
}

/**
 * Expands one importable template (produced by `loadMakerTemplatesForImport` with buyer-readable
 * `[내 사진]` placeholders) into a sequence of `prompt` blocks followed by a closing `template` block.
 */
export function buildImportedTemplateBlocks(
  template: MakerImportableTemplate,
  remainingSlots = POST_MAX_BLOCKS,
): PostBlock[] {
  if (remainingSlots <= 0) return [];
  const promptBlocks: PostBlock[] = template.clips.map((clip) => ({
    type: 'prompt',
    title: clip.title,
    kind: clip.kind,
    ...(clip.meta ? { meta: clip.meta } : {}),
    prompt: clip.prompt,
    ...(clip.note ? { note: clip.note } : {}),
  }));
  const all: PostBlock[] = [...promptBlocks, { type: 'template', slug: template.slug }];
  return all.slice(0, remainingSlots);
}

/** Normalizes editor draft blocks into clean schema payloads right before saving. */
export function sanitizeDraftBlocks(blocks: readonly PostBlock[]): PostBlock[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return { type: 'heading', text: block.text.trim() };
      case 'text':
        return { type: 'text', text: block.text.trim().replace(/\r\n?/g, '\n') };
      case 'list': {
        const cleaned = block.items.map((item) => item.trim()).filter(Boolean);
        return { type: 'list', items: cleaned };
      }
      case 'media':
        return block.caption?.trim()
          ? { type: 'media', workId: block.workId.trim(), caption: block.caption.trim() }
          : { type: 'media', workId: block.workId.trim() };
      case 'prompt':
        return {
          type: 'prompt',
          title: block.title.trim(),
          kind: block.kind,
          ...(block.meta?.trim() ? { meta: block.meta.trim() } : {}),
          prompt: block.prompt.trim().replace(/\r\n?/g, '\n'),
          ...(block.note?.trim() ? { note: block.note.trim().replace(/\r\n?/g, '\n') } : {}),
        };
      case 'template':
        return { type: 'template', slug: block.slug.trim().toLowerCase() };
      case 'instagram':
        return { type: 'instagram', url: block.url.trim() };
    }
  });
}
