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
  type StudioBrandProjectCards,
  type StudioDone,
  type StudioLyricsDraft,
  type StudioMusicDesign,
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
  type StudioStateScope,
} from './contracts';
import { brandStudioV2Open } from '@/lib/flags';
import { studioSeat } from './access';
import { isBrandProjectRead, runBrandProjectRead, type BrandProjectReadResult } from './brand-project-files';
import {
  isBrandProjectOperation,
  runBrandProjectOperation,
  stateScopeFilter,
  withAssetBrandProjects,
  withBrandProjects,
  type BrandProjectOperationResult,
} from './brand-projects';
import { loadOrganizationStorageSummary, toStudioStorageQuotaView } from '@/lib/brands/storage-quota';
import { assetFromOutput, completeStudioAsset, deleteStudioAsset, deleteStudioOutput, reserveStudioAsset, updateStudioAsset } from './assets';
import { handoffToCampaign } from './handoff';
import { analyzeStudioFilm, cancelStudioJob, createStudioJob, deleteStudioJob, previewStudioPrompt } from './jobs';
import { createStudioJobGroup } from './job-group';
import { assignStudioJobProject, keepLiveProjectIds, liveProjectsOf, studioProjectsReady } from './job-projects';
import { failure, guarded } from './outcome';
import { saveOutputWaveform } from './sound/waveform-store';
import { draftLyrics } from './sound/lyrics-draft';
import { designMusicPreview } from './sound/design-op';
import { planStudioRevise } from './revision/advise';
import { talkStudioRevise } from './revision/talk';
import { readStudioMark } from './revision/mark';
import { assetView, assetsOf, campaignsOf, jobSoftDeleteReady, jobsByIds, jobsOfStudioState, viewsOf } from './repo';
import type { StudioDeps } from './types';
import { allowanceViewWithRefill, loadAllowanceViewWithRefill } from './allowance-refill';
import { loadAllowance } from './usage';

export function isStudioOperation(value: unknown): value is StudioOperation {
  return typeof value === 'string' && (STUDIO_OPERATIONS as readonly string[]).includes(value);
}

export type StudioOperationResult =
  | BrandProjectOperationResult
  | BrandProjectReadResult
  | StudioFailure
  | StudioJobCreated
  | StudioJobGroupCreated
  | StudioDone
  | StudioLyricsDraft
  | StudioMusicDesign
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

/**
 * The 직접 만들기 home's project cards for a server page (`project.cards`, ./brand-project-files.ts): what
 * `POST /api/brand-studio` answers the same caller, the route's own flag gate included (studio v2 off: `studio_closed`;
 * spine closed for the organization: `invalid`). Sign-in is the seat's (`sign_in_required`). `env` reaches the studio
 * switch only; the spine's own switch is read from the process environment, as the POST route reads it.
 */
export async function loadProjectCards(deps: StudioDeps, viewer: Viewer, organizationId: string, env: NodeJS.ProcessEnv = process.env): Promise<StudioBrandProjectCards | StudioFailure> {
  if (!brandStudioV2Open(env)) return failure('studio_closed');
  return (await runBrandProjectRead(deps, viewer, 'project.cards', { organizationId })) as StudioBrandProjectCards | StudioFailure;
}

/** One `POST /api/brand-studio` operation. Unknown names are `invalid`. */
export async function runStudioOperation(deps: StudioDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<StudioOperationResult> {
  // The brand project spine (./brand-projects.ts, and the assets page's reads in ./brand-project-files.ts): closed
  // for the organization, these answer exactly like an unknown name; open, each runs the spine's member gate
  // itself inside its own transaction.
  if (isBrandProjectRead(operation)) return runBrandProjectRead(deps, viewer, operation, input);
  if (isBrandProjectOperation(operation)) return runBrandProjectOperation(deps, viewer, operation, input);
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
    // The create answers go to the member who made the run (owners and editors): `brandProjectId` is added here,
    // opt-in, never by `createStudioJob` itself (MCP and workflows call that directly and get nothing).
    case 'job.create': {
      const made = await createStudioJob(deps, viewer, input);
      if (!made.ok || !('job' in made)) return made;
      return { ...made, job: (await withBrandProjects(deps.sql, organizationId, [made.job]))[0]! };
    }
    case 'job.create_group': {
      const made = await createStudioJobGroup(deps, viewer, input);
      if (!made.ok) return made;
      return { ...made, jobs: await withBrandProjects(deps.sql, organizationId, made.jobs) };
    }
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
    // The library answers go to the member who sent them (owners and editors): `brandProjectId` is added here,
    // opt-in, never by the asset functions themselves. Closed for the organization, the answer is untouched.
    case 'asset.complete': {
      const done = await completeStudioAsset(deps, viewer, input);
      return done.ok ? { ...done, asset: (await withAssetBrandProjects(deps.sql, organizationId, [done.asset]))[0]! } : done;
    }
    case 'asset.update': {
      const done = await updateStudioAsset(deps, viewer, input);
      return done.ok ? { ...done, asset: (await withAssetBrandProjects(deps.sql, organizationId, [done.asset]))[0]! } : done;
    }
    case 'asset.delete':
      return deleteStudioAsset(deps, viewer, input);
    case 'asset.from_output': {
      const done = await assetFromOutput(deps, viewer, input);
      return done.ok ? { ...done, asset: (await withAssetBrandProjects(deps.sql, organizationId, [done.asset]))[0]! } : done;
    }
    case 'output.waveform':
      return saveOutputWaveform(deps, viewer, input);
    case 'lyrics.draft':
      return draftLyrics(deps, viewer, input);
    case 'music.design':
      return designMusicPreview(deps, viewer, input);
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

/**
 * `GET /api/brand-studio?organizationId=…` (`&brandProject=<id>|unfiled`). The optional scope exists only while
 * the brand project spine is open for the organization and only for its members: it narrows the runs to one
 * selectable project (`not_found` otherwise) or to the unfiled ones. A project guest's answer, and every answer
 * while the spine is closed, is exactly today's (the scope is ignored and no run carries `brandProjectId`).
 */
export async function loadStudioState(
  deps: StudioDeps,
  viewer: Viewer,
  organizationId: string,
  options: { scope?: StudioStateScope } = {},
): Promise<StudioState | StudioFailure> {
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId);
      const scope = await stateScopeFilter(sql, seat, options.scope);
      const now = deps.now?.() ?? new Date();
      const [allowance, storageSummary, assets, jobs, campaigns] = [
        await loadAllowance(sql, organizationId, deps.env, now),
        await loadOrganizationStorageSummary(sql, organizationId, now),
        await assetsOf(sql, organizationId),
        scope ? await jobsOfStudioState(sql, organizationId, 60, scope) : await jobsOfStudioState(sql, organizationId),
        await campaignsOf(sql, organizationId),
      ];
      // Runs can belong to a project only with the flag on and migration 0091 applied. A run whose project
      // was deleted or archived reads as being in no project (the row keeps its id).
      const projects = (await studioProjectsReady(deps, sql)) ? await liveProjectsOf(sql, organizationId) : null;
      const built = keepLiveProjectIds(await viewsOf(sql, jobs, deps.media), projects);
      // `brandProjectId` is opt-in, for members only (a project guest's answer stays exactly today's): runs and,
      // since slice 2a, library entries.
      const views = seat.role === 'guest' ? built : await withBrandProjects(sql, organizationId, built);
      const library = assets.map((a) => assetView(a, deps.media));
      const libraryViews = seat.role === 'guest' ? library : await withAssetBrandProjects(sql, organizationId, library);
      return {
        ok: true as const,
        canCreate: seat.canCreate,
        allowance: await allowanceViewWithRefill(sql, organizationId, allowance, { now }),
        storage: toStudioStorageQuotaView(storageSummary),
        assets: libraryViews,
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
      const seat = await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
      const jobs = await jobsByIds(sql, organizationId, ids);
      const views = await viewsOf(sql, jobs, deps.media);
      return {
        ok: true as const,
        jobs: seat.role === 'guest' ? views : await withBrandProjects(sql, organizationId, views),
        allowance: await loadAllowanceViewWithRefill(sql, organizationId, deps.env, deps.now?.() ?? new Date()),
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
