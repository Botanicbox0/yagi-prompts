import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { canView } from '@/lib/content/visibility';
import { publicContentUrl } from '@/lib/content/asset-url';
import { getWallet, listUnlocks } from '@/lib/cookies/repo';
import { decideUnlockPanel, type UnlockPanel } from '@/lib/cookies/wallet';
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
 *
 * §15 adds the third clause without touching the first two: text is visible iff admin, OR the
 * dormant `pro` tier, OR an unlock row exists for (account, prompt). And it makes the signed-in
 * detail view a WALLET READ — `getWallet` runs the §15.1-3 lazy weekly grant inside its own
 * transaction, so browsing is where the free cookie actually lands. An anonymous request never
 * touches the wallet at all: no identity, no row, no query.
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
  /**
   * §15.3 — what the lock panel offers, resolved server-side next to the gate so the page cannot
   * disagree with it. `null` when the text is visible, and for the locked-but-unsellable edge
   * (a `hidden` item): a CTA for a spend `unlockPrompt` would refuse must never render.
   */
  unlockPanel: UnlockPanel | null;
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
    processMd: row.processMd,
    processMdKo: row.processMdKo,
    textVisibility: row.textVisibility,
    media: row.media,
    useCase: row.useCase,
    featured: row.featured,
    publishedAt: row.publishedAt,
  };
}

/** §15's one sellable shape: YAGI text behind the `pro` gate. Everything else has no unlock CTA. */
function isUnlockable(row: Pick<PromptRow, 'source' | 'textVisibility'>): boolean {
  return row.source === 'yagi' && row.textVisibility === 'pro';
}

export async function shapePromptDetail(
  deps: PromptAccessDeps,
  slug: string,
): Promise<PromptDetailResult> {
  const row = await loadPromptBySlug(deps.sql, slug);
  if (row === null || !isPubliclyVisible(row)) return PROMPT_NOT_FOUND;

  const { viewer } = deps;
  // The §15 wallet read point: every SIGNED-IN detail view, gated or not, so the weekly cookie
  // lands wherever a reader actually is. Anonymous readers have no wallet to read.
  const wallet = viewer.userId === null ? null : await getWallet(deps.sql, viewer.userId);

  // The unlock row only matters where the tier alone fails — one point lookup, and only then.
  const tierSees = canView(viewer.tier, row.textVisibility);
  const unlocked =
    !tierSees && viewer.userId !== null && isUnlockable(row)
      ? (await listUnlocks(deps.sql, viewer.userId, [row.id])).has(row.id)
      : false;

  const prompt = shapePrompt(toRowInput(row), viewer.tier, {
    publicUrl: publicContentUrl,
    unlocked,
  });
  const relatedRows = await loadRelatedPrompts(deps.sql, {
    id: row.id,
    source: row.source,
    useCase: row.useCase,
  });

  return {
    status: 'ok',
    prompt,
    related: relatedRows.map((r) => toPromptCard(r)),
    viewer,
    unlockPanel:
      prompt.locked && isUnlockable(row)
        ? decideUnlockPanel(viewer.userId, wallet?.balance ?? null)
        : null,
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
 * endpoint." The gate is the SAME decision the page shaper makes — tier via `canView`, then the
 * §15 unlock row — so the button and the page can never disagree about what a reader may have.
 * Copying an unlocked prompt charges nothing: the unlock is permanent and this is a re-read.
 */
export async function authorizePromptCopy(
  sql: SqlRunner,
  viewer: Viewer,
  id: string,
): Promise<CopyDecision> {
  const row = await loadPromptById(sql, id);
  if (row === null || !isPubliclyVisible(row)) return { status: 'not_found' };

  if (!canView(viewer.tier, row.textVisibility)) {
    const unlocked =
      viewer.userId !== null && isUnlockable(row)
        ? (await listUnlocks(sql, viewer.userId, [row.id])).has(row.id)
        : false;
    if (!unlocked) {
      return viewer.tier === 'anon' ? { status: 'unauthorized' } : { status: 'forbidden' };
    }
  }
  return { status: 'ok', id: row.id, slug: row.slug, text: row.promptText };
}
