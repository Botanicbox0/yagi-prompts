import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/viewer';
import { decideEligibility } from '@/lib/content/eligibility';
import { parseMediaRef } from '@/lib/content/media-ref';
import {
  AssetRefSchema,
  safeParseBlock,
  type AssetRef,
  type BlockKind,
  type PublishedBucket,
} from '@/lib/content/schemas';
import { canView, isVisibility, type Visibility } from '@/lib/content/visibility';

/**
 * PLAN §3.3 — the media gateway's FULL-CHAIN authorization, as a function of (ref × viewer × db).
 *
 * The chain, in order, and every link is a refusal not a filter:
 *   1. ref → block → step → revision, and that revision MUST be the playbook's current
 *      `published_revision_id` (a draft or superseded id is 404 — the bytes may be identical, the
 *      capability is not);
 *   2. the playbook must itself be published (an archived playbook keeps its pointer, §6);
 *   3. playbook eligibility for the viewer — the SAME `decideEligibility` the page uses, so a page
 *      the viewer cannot open can never hand out media either;
 *   4. effective (stamped) visibility ≤ tier;
 *   5. only then does anything about the object leave this function.
 *
 * Heroes ride the same chain under the ref `{revisionId}:hero` and are treated as `public`
 * visibility — §3.1 makes hero media public marketing surface for every published playbook. Step 3
 * still applies, so an anon cannot pull the hero of a non-showcase playbook through here.
 */

export interface MediaObject {
  ref: string;
  kind: BlockKind | 'hero';
  bucket: PublishedBucket;
  /** Content-addressed published key — never a staging key. */
  key: string;
  mime: string;
  /** Only workflow files carry one; it drives `Content-Disposition: attachment`. */
  filename: string | null;
  visibility: Visibility;
  slug: string;
}

export type MediaAuthorization =
  | { status: 'ok'; object: MediaObject }
  /** 404 — unknown ref, broken chain, non-current revision, unpublished/archived playbook. */
  | { status: 'not_found' }
  /** 401 — an anonymous viewer who could see this after signing in (Journey A). */
  | { status: 'unauthorized' }
  /** 403 — a signed-in viewer whose tier is below the block's gate. */
  | { status: 'forbidden' };

const NOT_FOUND = { status: 'not_found' } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChainRow {
  kind: BlockKind;
  content: unknown;
  resolved_visibility: Visibility | null;
  revision_id: string;
  state: string;
  is_showcase: boolean;
  playbook_id: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  published_revision_id: string | null;
}

interface HeroRow {
  hero_asset: unknown;
  revision_id: string;
  state: string;
  is_showcase: boolean;
  playbook_id: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  published_revision_id: string | null;
}

/** Steps 1–3, shared by both ref kinds. */
function gateChain(
  row: Pick<
    ChainRow,
    'revision_id' | 'state' | 'is_showcase' | 'playbook_id' | 'slug' | 'status' | 'published_revision_id'
  >,
  viewer: Viewer,
): MediaAuthorization | null {
  // 1. current published revision — nothing else is ever servable, admin included. Admin preview of
  //    draft media is an M4 concern with its own authorization; widening this would make the
  //    "draft/superseded refuse" acceptance untestable.
  if (row.published_revision_id === null || row.published_revision_id !== row.revision_id) {
    return NOT_FOUND;
  }
  if (row.state !== 'published') return NOT_FOUND;

  // 2 + 3. playbook eligibility, decided by the same pure rule the page uses.
  const eligibility = decideEligibility(
    {
      playbookId: row.playbook_id,
      slug: row.slug,
      status: row.status,
      publishedRevisionId: row.published_revision_id,
      isShowcase: row.is_showcase,
    },
    viewer.tier,
  );
  if (eligibility === 'not_found') return NOT_FOUND;
  if (eligibility === 'requires_signin') return { status: 'unauthorized' };
  return null;
}

/** Step 4. Anonymous refusals are 401 (sign in and you may); signed-in ones are 403 (upgrade). */
function gateVisibility(visibility: Visibility, viewer: Viewer): MediaAuthorization | null {
  if (canView(viewer.tier, visibility)) return null;
  return viewer.tier === 'anon' ? { status: 'unauthorized' } : { status: 'forbidden' };
}

function assetOf(ref: AssetRef): { bucket: PublishedBucket; key: string } | null {
  if (!ref.bucket || !ref.published_key) return null;
  return { bucket: ref.bucket, key: ref.published_key };
}

async function authorizeBlock(
  sql: SqlRunner,
  viewer: Viewer,
  blockId: string,
): Promise<MediaAuthorization> {
  if (!UUID.test(blockId)) return NOT_FOUND;

  const { rows } = await sql.query<ChainRow>(
    `select b.kind, b.content, b.resolved_visibility,
            r.id as revision_id, r.state, r.is_showcase,
            p.id as playbook_id, p.slug, p.status, p.published_revision_id
       from blocks b
       join steps s on s.id = b.step_id
       join playbook_revisions r on r.id = s.revision_id
       join playbooks p on p.id = r.playbook_id
      where b.id = $1`,
    [blockId],
  );
  const row = rows[0];
  if (!row) return NOT_FOUND;

  const chain = gateChain(row, viewer);
  if (chain) return chain;

  // A published revision always carries a stamped visibility (prepare_publish guarantees it and
  // publish_revision re-checks). Missing ⇒ something is wrong ⇒ refuse.
  if (!isVisibility(row.resolved_visibility)) return NOT_FOUND;
  const visibility = row.resolved_visibility;

  const gated = gateVisibility(visibility, viewer);
  if (gated) return gated;

  const parsed = safeParseBlock(row.kind, row.content);
  if (!parsed.success) return NOT_FOUND;
  const block = parsed.data;
  if (block.kind !== 'asset' && block.kind !== 'workflow_file') return NOT_FOUND;

  const object = assetOf(block.content.asset);
  if (!object) return NOT_FOUND;

  return {
    status: 'ok',
    object: {
      ref: blockId,
      kind: block.kind,
      bucket: object.bucket,
      key: object.key,
      mime: block.content.asset.mime,
      filename: block.kind === 'workflow_file' ? block.content.filename : null,
      visibility,
      slug: row.slug,
    },
  };
}

async function authorizeHero(
  sql: SqlRunner,
  viewer: Viewer,
  revisionId: string,
): Promise<MediaAuthorization> {
  if (!UUID.test(revisionId)) return NOT_FOUND;

  const { rows } = await sql.query<HeroRow>(
    `select r.hero_asset, r.id as revision_id, r.state, r.is_showcase,
            p.id as playbook_id, p.slug, p.status, p.published_revision_id
       from playbook_revisions r
       join playbooks p on p.id = r.playbook_id
      where r.id = $1`,
    [revisionId],
  );
  const row = rows[0];
  if (!row) return NOT_FOUND;

  const chain = gateChain(row, viewer);
  if (chain) return chain;

  const parsed = AssetRefSchema.safeParse(row.hero_asset);
  if (!parsed.success) return NOT_FOUND;
  const object = assetOf(parsed.data);
  if (!object) return NOT_FOUND;

  return {
    status: 'ok',
    object: {
      ref: `${revisionId}:hero`,
      kind: 'hero',
      bucket: object.bucket,
      key: object.key,
      mime: parsed.data.mime,
      filename: null,
      visibility: 'public',
      slug: row.slug,
    },
  };
}

export async function authorizeMedia(
  sql: SqlRunner,
  viewer: Viewer,
  rawRef: string,
): Promise<MediaAuthorization> {
  const ref = parseMediaRef(rawRef);
  if (ref === null) return NOT_FOUND;
  return ref.kind === 'hero'
    ? authorizeHero(sql, viewer, ref.revisionId)
    : authorizeBlock(sql, viewer, ref.blockId);
}
