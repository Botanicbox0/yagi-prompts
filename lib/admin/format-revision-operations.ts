import { ReviseRecipeInput, reviseFormatRecipe, revisionRefusalDetail } from '@/lib/creator-platform/format-revision';
import { fail, ok } from './context';
import type { AdminOperation } from './operations';

/**
 * docs/CREATOR-PLATFORM.md "Recipe revisions of the studio's own formats (2026-11-25)" — `format.reviseRecipe`, the
 * one audited way to change the words of a format template's recipe, for the studio's OWN company-payout formats only
 * (lib/creator-platform/format-revision.ts; the database guard of migration 0192 enforces the same).
 *
 * The form (the admin template page's "레시피 문구 개정" panel) posts `id`, `reviewedSha256`, `reason` and one
 * `prompt:<stepId>` field per result step; a script may post the full `recipe` JSON instead. The dispatcher has
 * already refused a non-admin. A refusal's detail is `formatRevision:<code>[ <detail>]`, which the panel says in the
 * admin's language (`admin.formatRevision.refusals`).
 */

const PROMPT_FIELD = /^prompt:([a-z][a-z0-9_]{0,23})$/;

const reviseRecipe: AdminOperation<ReviseRecipeInput> = {
  parse(form) {
    const prompts: Record<string, string> = {};
    let any = false;
    for (const [key, value] of form) {
      const match = PROMPT_FIELD.exec(key);
      if (match && typeof value === 'string') {
        prompts[match[1]!] = value;
        any = true;
      }
    }
    const recipe = form.get('recipe');
    const parsed = ReviseRecipeInput.safeParse({
      id: form.get('id'),
      reviewedSha256: form.get('reviewedSha256'),
      reason: typeof form.get('reason') === 'string' ? form.get('reason') : undefined,
      ...(typeof recipe === 'string' && recipe !== '' ? { recipe } : {}),
      ...(any ? { prompts } : {}),
    });
    if (parsed.success) return { ok: true, value: parsed.data };
    const reason = parsed.error.issues.some((issue) => issue.path[0] === 'reason');
    return { ok: false, detail: reason ? 'formatRevision:reason' : 'formatRevision:input' };
  },
  async run(ctx, input) {
    const result = await reviseFormatRecipe(ctx.sql, ctx.viewer.userId ?? null, input);
    if (!result.ok) return fail(result.code === 'not_found' ? 'notFound' : 'invalid', revisionRefusalDetail(result));
    ctx.revalidatePrompts?.();
    return ok('saved', { detail: result.slug });
  },
};

export const FORMAT_REVISION_OPERATIONS = {
  'format.reviseRecipe': reviseRecipe,
};
