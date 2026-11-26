/**
 * Shared fixtures for 보내기 (docs/BRAND-PROJECT-SPINE.md §8; slice 4a): the studio fixture (one organization with an
 * owner, an editor, a viewer, a project guest, staff who are not members and an outsider, plus one team project), the
 * switches that open 보내기 for it, files to send, and a way to put members lines into the database directly (as the
 * migration allows), so the leak tests do not depend on the code they test.
 */
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import type { StudioBrandProject } from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';
import { seedRun } from '../../brand-studio/server/revision-helpers';

export const STUDIO_ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };

export interface SendWorld {
  f: StudioFixture;
  deps: ReturnType<typeof studioDeps>;
}

export async function sendWorld(): Promise<SendWorld> {
  resetSpineProbe();
  resetBrandSendProbe();
  const f = await studioFixture();
  const deps = studioDeps(f.sql, { env: studioEnv(STUDIO_ENV) });
  return { f, deps };
}

export async function closeWorld(w: SendWorld | undefined): Promise<void> {
  vi.unstubAllEnvs();
  resetSpineProbe();
  resetBrandSendProbe();
  await w?.f.db.close();
}

/** Every switch 보내기 needs, for `orgs` (the spine's organization list). Studio v2 too (the bell needs it). */
export function openSend(orgs: string): void {
  vi.stubEnv('BRAND_SEND', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
}

export const as = (userId: string): Viewer => viewerOf(userId);
export const staffViewer = (w: SendWorld): Viewer => ({ ...viewerOf(w.f.ids.admin), isAdmin: true });

/** One `send.*` (or any room) operation, as the route calls it. */
export async function op(w: SendWorld, viewer: Viewer, operation: string, input: Record<string, unknown>) {
  return runRoomOperation({ sql: w.f.sql, media: w.deps.media }, viewer, operation, { organizationId: w.f.orgId, ...input });
}

/** The answer, or a thrown error naming the refusal. */
export async function ok<T = Record<string, unknown>>(w: SendWorld, viewer: Viewer, operation: string, input: Record<string, unknown>): Promise<T> {
  const { result } = await op(w, viewer, operation, input);
  if (!result.ok) throw new Error(`${operation}: ${JSON.stringify(result)}`);
  return result as unknown as T;
}

export async function code(w: SendWorld, viewer: Viewer, operation: string, input: Record<string, unknown>): Promise<string> {
  const { result } = await op(w, viewer, operation, input);
  return result.ok ? 'ok' : result.code;
}

/** A brand's own project (the studio's `project.create`, needs the spine open). */
export async function selfProject(w: SendWorld, title = 'Our spring board'): Promise<string> {
  const made = await runStudioOperation(w.deps, as(w.f.ids.owner), 'project.create', { organizationId: w.f.orgId, requestId: requestId(), title });
  if (!made.ok || !('project' in made)) throw new Error(JSON.stringify(made));
  return (made.project as StudioBrandProject).id;
}

/** An image run with one ready result; filed in `projectId` when given. */
export async function imageResult(w: SendWorld, projectId: string | null = null, organizationId = w.f.orgId): Promise<{ jobId: string; outputId: string }> {
  const run = await seedRun(w.deps, organizationId, w.f.ids.owner, { kind: 'image' });
  if (projectId) await w.f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [run.jobId, projectId]);
  return { jobId: run.jobId, outputId: run.outputId };
}

/** A ready library picture; filed in `projectId` when given. */
export async function libraryPicture(w: SendWorld, projectId: string | null = null, organizationId = w.f.orgId): Promise<string> {
  const id = await seedImageAsset(w.deps, organizationId, w.f.ids.owner);
  if (projectId) await w.f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [id, projectId]);
  return id;
}

/**
 * A members line written straight into the table (what the migration allows), for the leak tests: a root about
 * `file` on `projectId`'s members channel (`members` when null), or a reply to `parentId`.
 */
export async function membersLine(
  sql: SqlRunner,
  line: { organizationId: string; projectId: string | null; authorId: string; body: string; file: { kind: 'output' | 'asset'; id: string }; parentId?: string | null; mentions?: string[]; at?: string },
): Promise<string> {
  const ref = line.file.kind === 'output' ? { kind: 'output', outputId: line.file.id } : { kind: 'asset', assetId: line.file.id };
  const channel = line.projectId ? `members:${line.projectId}` : 'members';
  return (
    await sql.query<{ id: string }>(
      `insert into brand_room_messages (organization_id, project_id, channel, parent_id, author_id, author_role, kind, body, ref, ref_key, mentions, created_at, updated_at)
        values ($1, $2, $3, $4, $5, 'brand', 'text', $6, $7::jsonb, $8, $9::uuid[], coalesce($10::timestamptz, now()), coalesce($10::timestamptz, now())) returning id::text as id`,
      [line.organizationId, line.projectId, channel, line.parentId ?? null, line.authorId, line.body, JSON.stringify(ref), `${line.file.kind}:${line.file.id}`, line.mentions ?? [], line.at ?? null],
    )
  ).rows[0]!.id;
}

export const newId = () => randomUUID();
