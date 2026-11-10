import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import { runRoomReviewOperation, staffDeliver, type DeliveredFile } from '@/lib/brand-studio/review';
import type { ReviewCreated } from '@/lib/brand-studio/review-contracts';
import { pngBytes, seedImageAsset, studioDeps, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, seedOutput } from '@/tests/brand-studio/review/fixtures';

export { reviewDeps, seedOutput };

/** A second project in the fixture organization, and one in another organization. */
export async function seedProject(f: StudioFixture, organizationId = f.orgId, title = 'Autumn film'): Promise<string> {
  const id = randomUUID();
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
      values ($1, $2, $3, 'Launch', 'creator', $4, $5, true)`,
    [id, organizationId, title, f.ids.owner, randomUUID()],
  );
  return id;
}

export function roomOp(f: StudioFixture, deps: ReturnType<typeof studioDeps>, viewer: Viewer, operation: string, input: Record<string, unknown>) {
  return runRoomReviewOperation(reviewDeps(deps), viewer, operation, { organizationId: f.orgId, projectId: f.projectId, ...input });
}

/** Put a studio result into the fixture project's room as a new draft; returns the review id. */
export async function roomDraft(f: StudioFixture, deps: ReturnType<typeof studioDeps>, kind: 'image' | 'video' = 'video', title = 'Spring film'): Promise<string> {
  const outputId = await seedOutput(deps, f.orgId, f.ids.owner, kind);
  const { result } = await roomOp(f, deps, viewerOf(f.ids.owner), 'review.create', { outputId, title });
  if (!result.ok) throw new Error(`room draft: ${result.code}`);
  return (result as ReviewCreated).review.id;
}

/** A file "already stored" for staffDeliver. */
export async function deliveredFile(deps: ReturnType<typeof studioDeps>, colour = 40): Promise<DeliveredFile> {
  const bytes = await pngBytes(30, 20, { r: colour, g: 80, b: 160 });
  const { key } = await deps.media.put(bytes, 'image/png');
  const sha = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  return { key, thumbKey: null, kind: 'image', mime: 'image/png', sizeBytes: bytes.byteLength, sha256: sha, width: 30, height: 20, durationMs: null, name: 'cut.png' };
}

export async function teamDelivery(f: StudioFixture, deps: ReturnType<typeof studioDeps>, extra: { stackReviewId?: string; colour?: number; title?: string } = {}) {
  return staffDeliver(reviewDeps(deps), { viewer: { ...viewerOf(f.ids.admin), isAdmin: true } }, {
    organizationId: f.orgId,
    projectId: f.projectId,
    title: extra.title ?? 'Main film',
    stackReviewId: extra.stackReviewId ?? null,
    file: await deliveredFile(deps, extra.colour ?? 40),
  });
}

export { seedImageAsset };
