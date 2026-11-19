/**
 * Brand studio v2 service (docs/BRAND-STUDIO-V2.md). The route parses the envelope; this module
 * parses every input with the contract schemas (lib/brand-studio/contracts.ts) and answers with the
 * contract types. Customer-visible text does not exist here: failures are `STUDIO_ERROR_CODES` only.
 *
 * Gate order for every read and write: seat (membership) -> Morphic hardline + feature policy -> role.
 * The flag (`BRAND_STUDIO_V2`) and sign-in are checked by the route before this module runs.
 */
import type { Viewer } from '@/lib/auth/identity';
import {
  STUDIO_OPERATIONS,
  type StudioAssetReserved,
  type StudioAssetSaved,
  type StudioDone,
  type StudioFailure,
  type StudioFilmAnalysis,
  type StudioHandoffDone,
  type StudioJobCreated,
  type StudioJobGroupCreated,
  type StudioJobsPoll,
  type StudioOperation,
  type StudioPromptPreview,
  type StudioReviseMarkRead,
  type StudioRevisePlan,
  type StudioState,
} from './contracts';
import { studioSeat } from './access';
import { loadOrganizationStorageSummary, toStudioStorageQuotaView } from '@/lib/brands/storage-quota';
import { assetFromOutput, completeStudioAsset, deleteStudioAsset, deleteStudioOutput, reserveStudioAsset, updateStudioAsset } from './assets';
import { handoffToCampaign } from './handoff';
import { analyzeStudioFilm, cancelStudioJob, createStudioJob, deleteStudioJob, previewStudioPrompt } from './jobs';
import { createStudioJobGroup } from './job-group';
import { assignStudioJobProject, liveProjectsOf, studioProjectsReady } from './job-projects';
import { failure, guarded } from './outcome';
import { planStudioRevise } from './revision/advise';
import { talkStudioRevise } from './revision/talk';
import { readStudioMark } from './revision/mark';
import { assetView, assetsOf, campaignsOf, jobSoftDeleteReady, jobsByIds, jobsOfStudioState, viewsOf } from './repo';
import type { StudioDeps } from './types';
import { allowanceView, loadAllowance } from './usage';

export function isStudioOperation(value: unknown): value is StudioOperation {
  return typeof value === 'string' && (STUDIO_OPERATIONS as readonly string[]).includes(value);
}

export type StudioOperationResult =
  | StudioFailure
  | StudioJobCreated
  | StudioJobGroupCreated
  | StudioDone
  | StudioPromptPreview
  | StudioFilmAnalysis
  | StudioRevisePlan
  | StudioReviseMarkRead
  | StudioAssetReserved
  | StudioAssetSaved
  | StudioHandoffDone;

const SELF_STUDIO_OPS: ReadonlySet<StudioOperation> = new Set([
  'job.create',
  'job.create_group',
  'job.cancel',
  'prompt.enhance',
  'film.analyze',
  'revise.plan',
  'revise.mark',
  'revise.talk',
  'handoff.campaign',
  'job.assign_project',
]);

/** One `POST /api/brand-studio` operation. Unknown names are `invalid`. */
export async function runStudioOperation(deps: StudioDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<StudioOperationResult> {
  if (!isStudioOperation(operation)) return failure('invalid');
  // The gate before any input detail is judged: a closed organization gets the same 404 whatever it sent.
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) return failure('invalid');
  const gate = await guarded(() =>
    deps.sql.transaction((sql) =>
      studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: SELF_STUDIO_OPS.has(operation) }),
    ),
  );
  if ('ok' in gate) return gate;
  switch (operation) {
    case 'job.create':
      return createStudioJob(deps, viewer, input);
    case 'job.create_group':
      return createStudioJobGroup(deps, viewer, input);
    case 'job.cancel':
      return cancelStudioJob(deps, viewer, input);
    case 'prompt.enhance':
      return previewStudioPrompt(deps, viewer, input);
    case 'film.analyze':
      return analyzeStudioFilm(deps, viewer, input);
    case 'revise.plan':
      return planStudioRevise(deps, viewer, input);
    case 'revise.mark':
      return readStudioMark(deps, viewer, input);
    case 'revise.talk':
      // Behind BRAND_STUDIO_REVISE_V2 (the handler answers `invalid` when it is off), after the same gate as every operation.
      return talkStudioRevise(deps, viewer, input);
    case 'asset.reserve':
      return reserveStudioAsset(deps, viewer, input);
    case 'asset.complete':
      return completeStudioAsset(deps, viewer, input);
    case 'asset.update':
      return updateStudioAsset(deps, viewer, input);
    case 'asset.delete':
      return deleteStudioAsset(deps, viewer, input);
    case 'asset.from_output':
      return assetFromOutput(deps, viewer, input);
    case 'output.delete':
      return deleteStudioOutput(deps, viewer, input);
    case 'job.delete':
      return deleteStudioJob(deps, viewer, input);
    case 'handoff.campaign':
      return handoffToCampaign(deps, viewer, input);
    case 'job.assign_project':
      return assignStudioJobProject(deps, viewer, input);
  }
}

/** `GET /api/brand-studio?organizationId=…` */
export async function loadStudioState(deps: StudioDeps, viewer: Viewer, organizationId: string): Promise<StudioState | StudioFailure> {
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId);
      const now = deps.now?.() ?? new Date();
      const [allowance, storageSummary, assets, jobs, campaigns] = [
        await loadAllowance(sql, organizationId, deps.env, now),
        await loadOrganizationStorageSummary(sql, organizationId, now),
        await assetsOf(sql, organizationId),
        await jobsOfStudioState(sql, organizationId),
        await campaignsOf(sql, organizationId),
      ];
      // Runs can belong to a project only with the flag on and migration 0091 applied. A run whose project
      // was deleted or archived reads as being in no project (the row keeps its id).
      const projects = (await studioProjectsReady(deps, sql)) ? await liveProjectsOf(sql, organizationId) : null;
      const live = new Set(projects?.map((project) => project.id));
      const views = (await viewsOf(sql, jobs, deps.media)).map((view) => {
        if (!view.projectId || live.has(view.projectId)) return view;
        const { projectId: _gone, ...rest } = view;
        return rest;
      });
      return {
        ok: true as const,
        canCreate: seat.canCreate,
        allowance: allowanceView(allowance),
        storage: toStudioStorageQuotaView(storageSummary),
        assets: assets.map((a) => assetView(a, deps.media)),
        jobs: views,
        campaigns,
        canRemoveRuns: seat.canCreate && (await jobSoftDeleteReady(sql)),
        // Off unless the flag is on: the key is left out entirely, so nothing about it reaches the client.
        ...(seat.canCreate && deps.env.outpaint ? { canFillEmpty: true } : {}),
        ...(seat.canCreate && deps.env.regionV2 ? { regionV2: true } : {}),
        ...(seat.canCreate && deps.env.reviseV2 ? { reviseV2: true } : {}),
        ...(projects ? { projects } : {}),
      };
    }),
  );
}

/** `GET /api/brand-studio?organizationId=…&jobs=a,b` — the board's poll. The route advances open jobs afterwards. */
export async function pollStudioJobs(deps: StudioDeps, viewer: Viewer, organizationId: string, jobIds: readonly string[]): Promise<StudioJobsPoll | StudioFailure> {
  const ids = [...new Set(jobIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 50);
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
      const jobs = await jobsByIds(sql, organizationId, ids);
      return {
        ok: true as const,
        jobs: await viewsOf(sql, jobs, deps.media),
        allowance: allowanceView(await loadAllowance(sql, organizationId, deps.env, deps.now?.() ?? new Date())),
      };
    }),
  );
}

/** Open job ids among `ids` that belong to `organizationId` (what a poll may advance). */
export async function openJobIds(deps: StudioDeps, organizationId: string, ids: readonly string[]): Promise<string[]> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return [];
  return (
    await deps.sql.query<{ id: string }>(
      "select id from brand_studio_jobs where organization_id = $1 and id = any($2::uuid[]) and status in ('held','queued','running','finishing')",
      [organizationId, valid],
    )
  ).rows.map((r) => r.id);
}
