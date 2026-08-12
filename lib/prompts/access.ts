import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { canView } from '@/lib/content/visibility';
import { publicContentUrl } from '@/lib/content/asset-url';
import { toPromptCard, type PromptCard } from './catalog';
import { loadPromptById, loadPromptBySlug, loadRelatedPrompts, type PromptRow } from './repo';
import { shapePrompt, type ShapedPrompt } from './shape';

/**
 * PLAN §13.2/§13.3 — the prompts gate, as a pure function of (db × viewer × slug).
 *
 * Split from the façade for the reason M2 established: `getSqlRunner`/`getViewer` carry the
 * `server-only` guard and cannot be imported into vitest, so everything that DECIDES lives here
 * with its two dependencies injected, and `lib/prompts/facade.ts` is the four-line wrapper that
 * resolves them.
 *
 * Two rules, and the difference between them is the whole §13 gating doctrine:
 *
 *   · **Existence** is a status question. `pending`, `rejected` and `archived` items are 404 for
 *     everyone, admin included — a moderation queue is not a preview surface, and `/admin/prompts`
 *     shows those rows directly (§13.2), so widening this would buy nothing and cost the sweep its
 *     "pending/rejected slugs 404" assertion.
 *   · **Text** is a tier question, and it is never an error. A gated prompt renders its card, its
 *     media and the §5.5 lock panel; the shaper simply does not put `text` in the payload.
 */

export interface PromptAccessDeps {
  sql: SqlRunner;
  viewer: Viewer;
}

export interface PromptDetailOk {
  status: 'ok';
  prompt: ShapedPrompt;
  related: PromptCard[];
  viewer: Viewer;
}

export type PromptDetailResult = PromptDetailOk | { status: 'not_found' };

export const PROMPT_NOT_FOUND = { status: 'not_found' } as const;

/** A published item is visible to everyone; everything else does not exist on the public surface. */
export function isPubliclyVisible(row: Pick<PromptRow, 'status'>): boolean {
  return row.status === 'published';
}

function toRowInput(row: PromptRow) {
  return {
    id: row.id,
    slug: row.slug,
    source: row.source,
    authorHandle: row.authorHandle,
    model: row.model,
    title: row.title,
    titleKo: row.titleKo,
    promptText: row.promptText,
    textVisibility: row.textVisibility,
    media: row.media,
    useCase: row.useCase,
    featured: row.featured,
    publishedAt: row.publishedAt,
  };
}

export async function shapePromptDetail(
  deps: PromptAccessDeps,
  slug: string,
): Promise<PromptDetailResult> {
  const row = await loadPromptBySlug(deps.sql, slug);
  if (row === null || !isPubliclyVisible(row)) return PROMPT_NOT_FOUND;

  const prompt = shapePrompt(toRowInput(row), deps.viewer.tier, { publicUrl: publicContentUrl });
  const relatedRows = await loadRelatedPrompts(deps.sql, {
    id: row.id,
    source: row.source,
    useCase: row.useCase,
  });

  return {
    status: 'ok',
    prompt,
    related: relatedRows.map((r) => toPromptCard(r)),
    viewer: deps.viewer,
  };
}

// ---------------------------------------------------------------------------
// the copy endpoint (§13.2 / §13.3-5)
// ---------------------------------------------------------------------------

export type CopyDecision =
  | { status: 'ok'; id: string; slug: string; text: string }
  /** 404 — unknown id, or an item that is not published (pending/rejected/archived). */
  | { status: 'not_found' }
  /** 401 — anonymous, and signing in is a step towards seeing it (Journey A). */
  | { status: 'unauthorized' }
  /** 403 — signed in but not entitled; the answer carries the upgrade pointer, never the text. */
  | { status: 'forbidden' };

/**
 * §13.3-5: "Copy buttons: community/anon = free; YAGI-pro = entitlement-gated via the copy
 * endpoint." The gate is `canView(tier, text_visibility)` — the SAME comparison the page shaper
 * makes, so the button and the page can never disagree about what a reader may have.
 */
export async function authorizePromptCopy(
  sql: SqlRunner,
  viewer: Viewer,
  id: string,
): Promise<CopyDecision> {
  const row = await loadPromptById(sql, id);
  if (row === null || !isPubliclyVisible(row)) return { status: 'not_found' };

  if (!canView(viewer.tier, row.textVisibility)) {
    return viewer.tier === 'anon' ? { status: 'unauthorized' } : { status: 'forbidden' };
  }
  return { status: 'ok', id: row.id, slug: row.slug, text: row.promptText };
}
