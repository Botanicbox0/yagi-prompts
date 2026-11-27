import {
  SetOriginalPostInput,
  originalPostRefusalDetail,
  setFormatOriginalPost,
} from '@/lib/creator-platform/original-post';
import { fail, ok } from './context';
import type { AdminOperation } from './operations';

/**
 * Admin setting of `platform_formats.example_url` for the studio's own company-payout formats
 * (`format.setOriginalPost`).
 *
 * The form posts `id` (prompt_items.id) and `url` (an Instagram post/reel URL, or empty to clear).
 * On success, `ctx.revalidatePrompts?.()` calls `revalidatePrompts()` (`lib/cache.ts`), which
 * executes `revalidateTag(PROMPTS_TAG)` — invalidating `cachedOriginalInstagram` (`lib/posts/cached-public.ts`,
 * tagged `[POSTS_TAG, PROMPTS_TAG]`).
 */
const setOriginalPost: AdminOperation<SetOriginalPostInput> = {
  parse(form) {
    const rawUrl = form.get('url');
    const parsed = SetOriginalPostInput.safeParse({
      id: form.get('id'),
      url: typeof rawUrl === 'string' ? rawUrl : undefined,
    });
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, detail: 'originalPost:input' };
  },
  async run(ctx, input) {
    const result = await setFormatOriginalPost(ctx.sql, ctx.viewer.userId ?? null, input);
    if (!result.ok) {
      return fail(result.code === 'not_found' ? 'notFound' : 'invalid', originalPostRefusalDetail(result));
    }
    ctx.revalidatePrompts?.();
    return ok('saved', { detail: result.slug });
  },
};

export const ORIGINAL_POST_OPERATIONS = {
  'format.setOriginalPost': setOriginalPost,
};
