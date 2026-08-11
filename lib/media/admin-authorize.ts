import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { parseMediaRef } from '@/lib/content/media-ref';
import { AssetRefSchema, safeParseBlock, type AssetRef, type BlockKind } from '@/lib/content/schemas';
import { STAGING_BUCKET } from '@/lib/storage';

/**
 * The admin preview media path — the item M2 flagged and M4 owns.
 *
 * M2's ratification: "draft/superseded media refuse **for admins too** (admin media preview = M4
 * concern)". `/api/media/[blockId]` was therefore left unable to serve anything but the CURRENT
 * published revision, for everyone, and the anon sweep asserts exactly that. Widening it would have
 * made the "gateway refuses draft/superseded" acceptance untestable — so admin preview gets its own
 * endpoint instead, and the public gateway is not touched at all.
 *
 * What this authorizes, in order:
 *   1. the viewer is an admin (anon ⇒ 401, signed-in non-admin ⇒ 403 — never a hint that the ref
 *      exists);
 *   2. the ref resolves, through the database, to ONE revision and ONE AssetRef. The object key is
 *      read from that row and never from the request, which is what makes access revision-scoped:
 *      there is no key parameter to point somewhere else;
 *   3. only the private STAGING object is offered. Published buckets keep their own gateway; this
 *      one exists to look at bytes that have not shipped.
 *
 * The ≤60s token discipline is identical to §3.3's, with one difference: the token ref is prefixed
 * (`admin:`), so an admin-minted token cannot be replayed against the public gateway and a public
 * one cannot be replayed here — `verifyMediaToken` compares the ref before anything else.
 */

export const ADMIN_TOKEN_PREFIX = 'admin:';

export function adminTokenRef(ref: string): string {
  return `${ADMIN_TOKEN_PREFIX}${ref}`;
}

export function adminMediaPath(ref: string): string {
  return `/api/admin/media/${encodeURIComponent(ref)}`;
}

export interface AdminMediaObject {
  ref: string;
  kind: BlockKind | 'hero';
  /** Always the private staging bucket — this endpoint never serves a published copy. */
  bucket: typeof STAGING_BUCKET;
  key: string;
  mime: string;
  filename: string | null;
  revisionId: string;
  revisionState: 'draft' | 'published' | 'superseded';
  slug: string;
}

export type AdminMediaAuthorization =
  | { status: 'ok'; object: AdminMediaObject }
  | { status: 'not_found' }
  /** 401 — nobody is signed in. */
  | { status: 'unauthorized' }
  /** 403 — signed in, but not an admin. */
  | { status: 'forbidden' };

const NOT_FOUND = { status: 'not_found' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gateViewer(viewer: Viewer): AdminMediaAuthorization | null {
  if (viewer.isAdmin) return null;
  return viewer.userId === null ? { status: 'unauthorized' } : { status: 'forbidden' };
}

function stagingOf(ref: AssetRef): string | null {
  return ref.staging_key.length > 0 ? ref.staging_key : null;
}

export async function authorizeAdminMedia(
  sql: SqlRunner,
  viewer: Viewer,
  rawRef: string,
): Promise<AdminMediaAuthorization> {
  const denied = gateViewer(viewer);
  if (denied) return denied;

  const ref = parseMediaRef(rawRef);
  if (ref === null) return NOT_FOUND;

  if (ref.kind === 'hero') {
    if (!UUID.test(ref.revisionId)) return NOT_FOUND;
    const { rows } = await sql.query<{
      hero_asset: unknown;
      state: AdminMediaObject['revisionState'];
      slug: string;
    }>(
      `select r.hero_asset, r.state, p.slug
         from playbook_revisions r join playbooks p on p.id = r.playbook_id
        where r.id = $1`,
      [ref.revisionId],
    );
    const row = rows[0];
    if (!row) return NOT_FOUND;
    const parsedRef = AssetRefSchema.safeParse(row.hero_asset);
    if (!parsedRef.success) return NOT_FOUND;
    const key = stagingOf(parsedRef.data);
    if (key === null) return NOT_FOUND;
    return {
      status: 'ok',
      object: {
        ref: rawRef,
        kind: 'hero',
        bucket: STAGING_BUCKET,
        key,
        mime: parsedRef.data.mime,
        filename: null,
        revisionId: ref.revisionId,
        revisionState: row.state,
        slug: row.slug,
      },
    };
  }

  if (!UUID.test(ref.blockId)) return NOT_FOUND;
  const { rows } = await sql.query<{
    kind: BlockKind;
    content: unknown;
    revision_id: string;
    state: AdminMediaObject['revisionState'];
    slug: string;
  }>(
    `select b.kind, b.content, r.id as revision_id, r.state, p.slug
       from blocks b
       join steps s on s.id = b.step_id
       join playbook_revisions r on r.id = s.revision_id
       join playbooks p on p.id = r.playbook_id
      where b.id = $1`,
    [ref.blockId],
  );
  const row = rows[0];
  if (!row) return NOT_FOUND;

  const block = safeParseBlock(row.kind, row.content);
  if (!block.success) return NOT_FOUND;
  if (block.data.kind !== 'asset' && block.data.kind !== 'workflow_file') return NOT_FOUND;

  const key = stagingOf(block.data.content.asset);
  if (key === null) return NOT_FOUND;

  return {
    status: 'ok',
    object: {
      ref: rawRef,
      kind: block.data.kind,
      bucket: STAGING_BUCKET,
      key,
      mime: block.data.content.asset.mime,
      filename: block.data.kind === 'workflow_file' ? block.data.content.filename : null,
      revisionId: row.revision_id,
      revisionState: row.state,
      slug: row.slug,
    },
  };
}
