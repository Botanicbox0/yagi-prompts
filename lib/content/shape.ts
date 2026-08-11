import type { AssetRef, BlockKind, Localized } from './schemas';
import { safeParseBlock } from './schemas';
import { canView, type Tier, type Visibility } from './visibility';

/**
 * PLAN §7 — the pure half of the one gate.
 *
 * `shapeRevision(revisionData, tier)` is deliberately pure and side-effect free: no session
 * lookup, no DB, no env. The façade (`getShapedPlaybook`, M2) resolves the session, verifies
 * eligibility and guarantees the invariant this function relies on — **every block arrives with a
 * non-null effective visibility** (published revisions carry the stamped `resolved_visibility`;
 * draft previews are normalised through `resolveVisibility` first).
 *
 * Two rules the tests pin:
 *   1. A gated block yields `{ locked: true, kind }` — chrome only, no teaser, no bytes.
 *   2. No storage key ever leaves this function. `staging_key` is dropped unconditionally;
 *      private published keys are replaced by the entitlement-checked media gateway path.
 */

// ---------------------------------------------------------------------------
// input (what the loader hands over)
// ---------------------------------------------------------------------------

export interface RevisionBlockInput {
  id: string;
  order: number;
  kind: BlockKind;
  content: unknown;
  /** Non-null by contract — see the façade note above. */
  effective_visibility: Visibility;
}

export interface RevisionStepInput {
  id: string;
  order: number;
  title: Localized;
  body: Localized | null;
  blocks: RevisionBlockInput[];
}

export interface RevisionInput {
  id: string;
  playbook_id: string;
  slug: string;
  category: string;
  rev_no: number;
  state: 'draft' | 'published' | 'superseded';
  is_showcase: boolean;
  title: Localized;
  summary: Localized;
  difficulty: string;
  tools: string[];
  models: string[];
  est_time_min: number | null;
  est_cost_usd: number | null;
  hero_asset: AssetRef | null;
  change_note: Localized | null;
  published_at: string | null;
  steps: RevisionStepInput[];
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

export interface ShapedAssetRef {
  /** 'public' = CDN object in `public-content`; 'gateway' = entitlement-checked /api/media. */
  source: 'public' | 'gateway';
  src: string;
  mime: string;
  w?: number;
  h?: number;
  duration_s?: number;
}

export type ShapedBlockContent =
  | { kind: 'prompt'; text: string; model?: string; negative?: string }
  | { kind: 'params'; rows: Array<{ k: string; v: string }> }
  | { kind: 'asset'; asset: ShapedAssetRef; caption?: Localized }
  | { kind: 'note'; md: Localized }
  | { kind: 'link'; url: string; label: Localized }
  | {
      kind: 'workflow_file';
      asset: ShapedAssetRef;
      filename: string;
      size_bytes: number;
      format: string;
    };

export type ShapedBlock =
  | { id: string; order: number; kind: BlockKind; visibility: Visibility; locked: true }
  | {
      id: string;
      order: number;
      kind: BlockKind;
      visibility: Visibility;
      locked: false;
      content: ShapedBlockContent;
    };

export interface ShapedStep {
  id: string;
  order: number;
  title: Localized;
  body: Localized | null;
  blocks: ShapedBlock[];
  lockedCount: number;
}

export interface ShapedRevision {
  id: string;
  playbook_id: string;
  slug: string;
  category: string;
  rev_no: number;
  is_showcase: boolean;
  title: Localized;
  summary: Localized;
  difficulty: string;
  tools: string[];
  models: string[];
  est_time_min: number | null;
  est_cost_usd: number | null;
  /** Heroes are always public marketing surface (§3.1) and are shaped for every tier. */
  hero: ShapedAssetRef | null;
  change_note: Localized | null;
  published_at: string | null;
  tier: Tier;
  steps: ShapedStep[];
  lockedCount: number;
}

export interface ShapeOptions {
  /** Resolve a `public-content` object key to a servable URL. Pure by default. */
  publicUrl?: (key: string) => string;
  /** Resolve a block id to the entitlement-checked media gateway path (§3.3). */
  mediaUrl?: (blockId: string) => string;
}

const defaultPublicUrl = (key: string) => `/storage/v1/object/public/public-content/${key}`;
const defaultMediaUrl = (blockId: string) => `/api/media/${blockId}`;

// ---------------------------------------------------------------------------
// shaper
// ---------------------------------------------------------------------------

function shapeAsset(
  ref: AssetRef,
  blockId: string,
  opts: Required<ShapeOptions>,
): ShapedAssetRef {
  const isPublicObject = ref.bucket === 'public-content' && Boolean(ref.published_key);
  const shaped: ShapedAssetRef = isPublicObject
    ? { source: 'public', src: opts.publicUrl(ref.published_key as string), mime: ref.mime }
    : { source: 'gateway', src: opts.mediaUrl(blockId), mime: ref.mime };
  if (ref.w !== undefined) shaped.w = ref.w;
  if (ref.h !== undefined) shaped.h = ref.h;
  if (ref.duration_s !== undefined) shaped.duration_s = ref.duration_s;
  return shaped;
}

function shapeContent(
  block: RevisionBlockInput,
  opts: Required<ShapeOptions>,
): ShapedBlockContent | null {
  const parsed = safeParseBlock(block.kind, block.content);
  if (!parsed.success) return null;
  const value = parsed.data;

  switch (value.kind) {
    case 'prompt': {
      const out: ShapedBlockContent = { kind: 'prompt', text: value.content.text };
      if (value.content.model !== undefined) out.model = value.content.model;
      if (value.content.negative !== undefined) out.negative = value.content.negative;
      return out;
    }
    case 'params':
      return { kind: 'params', rows: value.content.rows.map((r) => ({ k: r.k, v: r.v })) };
    case 'asset': {
      const out: ShapedBlockContent = {
        kind: 'asset',
        asset: shapeAsset(value.content.asset, block.id, opts),
      };
      if (value.content.caption !== undefined) out.caption = value.content.caption;
      return out;
    }
    case 'note':
      return { kind: 'note', md: value.content.md };
    case 'link':
      return { kind: 'link', url: value.content.url, label: value.content.label };
    case 'workflow_file':
      return {
        kind: 'workflow_file',
        asset: shapeAsset(value.content.asset, block.id, opts),
        filename: value.content.filename,
        size_bytes: value.content.size_bytes,
        format: value.content.format,
      };
  }
}

export function shapeRevision(
  revision: RevisionInput,
  tier: Tier,
  options: ShapeOptions = {},
): ShapedRevision {
  const opts: Required<ShapeOptions> = {
    publicUrl: options.publicUrl ?? defaultPublicUrl,
    mediaUrl: options.mediaUrl ?? defaultMediaUrl,
  };

  let lockedTotal = 0;

  const steps: ShapedStep[] = [...revision.steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => {
      let lockedInStep = 0;
      const blocks: ShapedBlock[] = [...step.blocks]
        .sort((a, b) => a.order - b.order)
        .map((block) => {
          const base = {
            id: block.id,
            order: block.order,
            kind: block.kind,
            visibility: block.effective_visibility,
          };
          if (!canView(tier, block.effective_visibility)) {
            lockedInStep += 1;
            return { ...base, locked: true as const };
          }
          const content = shapeContent(block, opts);
          if (content === null) {
            // Malformed jsonb can never be rendered — fail closed, never leak the raw payload.
            lockedInStep += 1;
            return { ...base, locked: true as const };
          }
          return { ...base, locked: false as const, content };
        });
      lockedTotal += lockedInStep;
      return {
        id: step.id,
        order: step.order,
        title: step.title,
        body: step.body,
        blocks,
        lockedCount: lockedInStep,
      };
    });

  const hero =
    revision.hero_asset === null
      ? null
      : shapeAsset(revision.hero_asset, `${revision.id}:hero`, opts);

  return {
    id: revision.id,
    playbook_id: revision.playbook_id,
    slug: revision.slug,
    category: revision.category,
    rev_no: revision.rev_no,
    is_showcase: revision.is_showcase,
    title: revision.title,
    summary: revision.summary,
    difficulty: revision.difficulty,
    tools: revision.tools,
    models: revision.models,
    est_time_min: revision.est_time_min,
    est_cost_usd: revision.est_cost_usd,
    hero,
    change_note: revision.change_note,
    published_at: revision.published_at,
    tier,
    steps,
    lockedCount: lockedTotal,
  };
}
