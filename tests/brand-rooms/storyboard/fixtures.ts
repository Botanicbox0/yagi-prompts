import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { runStoryboardOperation, type StoryboardDeps } from '@/lib/brand-rooms/storyboards';
import type { StoryboardFrameSaved, StoryboardOperationResult } from '@/lib/brand-rooms/storyboard-contracts';
import { pngBytes, studioDeps, type StudioFixture } from '../../brand-studio/server/helpers';

/** In-memory media and staging over the fixture's PGlite database. */
export function boardDeps(f: StudioFixture): StoryboardDeps & ReturnType<typeof studioDeps> {
  return studioDeps(f.sql);
}

export const scope = (f: StudioFixture) => ({ organizationId: f.orgId, projectId: f.projectId });

export function op(deps: StoryboardDeps, f: StudioFixture, viewer: Viewer, operation: string, input: Record<string, unknown> = {}): Promise<StoryboardOperationResult> {
  return runStoryboardOperation(deps, viewer, operation, { ...scope(f), ...input });
}

/** Reserve, put the bytes where the browser would, complete: one picture becomes one cut. */
export async function uploadCut(
  deps: ReturnType<typeof boardDeps>,
  f: StudioFixture,
  viewer: Viewer,
  storyboardId: string,
  options: { bytes?: Uint8Array; mime?: string; text?: Record<string, unknown> } = {},
): Promise<StoryboardFrameSaved> {
  const bytes = options.bytes ?? (await pngBytes(64, 36));
  const reserved = await op(deps, f, viewer, 'frame.reserve', {
    storyboardId,
    name: `cut-${randomUUID().slice(0, 4)}.png`,
    mime: options.mime ?? 'image/png',
    sizeBytes: bytes.byteLength,
    ...(options.text ? { text: options.text } : {}),
  });
  expect(reserved).toMatchObject({ ok: true, direct: false });
  const frameId = (reserved as { frameId: string }).frameId;
  const key = `brand-rooms/storyboards/${f.orgId}/${frameId}`;
  await deps.staging.putStaging(key, bytes, options.mime ?? 'image/png');
  const done = await op(deps, f, viewer, 'frame.complete', { storyboardId, frameId });
  expect(done).toMatchObject({ ok: true });
  return done as StoryboardFrameSaved;
}

export async function brandBoard(deps: StoryboardDeps, f: StudioFixture, viewer: Viewer, title = 'Spring film'): Promise<string> {
  const made = await op(deps, f, viewer, 'board.create', { title });
  expect(made).toMatchObject({ ok: true });
  return (made as { board: { id: string } }).board.id;
}

/** A message in a cut's thread, the way slice M stores it. */
export async function threadMessage(f: StudioFixture, storyboardId: string, frameId: string, extra: { deleted?: boolean } = {}): Promise<void> {
  await f.sql.query(
    `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, ref, ref_key, deleted_at)
       values ($1, $2, $7, $3, 'brand', 'text', 'Logo smaller', $4::jsonb, $5, $6)`,
    [
      f.orgId,
      f.projectId,
      f.ids.owner,
      JSON.stringify({ kind: 'storyboard', storyboardId, frameId }),
      `storyboard:${storyboardId}:${frameId}`,
      extra.deleted ? new Date().toISOString() : null,
      f.projectId,
    ],
  );
}
