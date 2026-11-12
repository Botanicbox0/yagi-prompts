/**
 * Brand Studio v5 — Org Workflows & Knowledge Hub server service (`docs/STUDIO-PRO-SUITE-V4.md` §1.5).
 *
 * Every read and write gates through `studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true })`
 * first: Morphic/sandboxed organizations, `generative_media`-denied organizations, `self_studio`-denied
 * organizations, and non-members all receive `feature_unavailable` / `not_found` (`404` at the route).
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import {
  STUDIO_LIMITS,
  type StudioAssetRole,
  type StudioFailure,
  type StudioJobCreate,
  type StudioJobView,
  type StudioReference,
} from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { studioModel } from '@/lib/brand-studio/models';
import { failure, guarded } from '@/lib/brand-studio/outcome';
import { jobsByIds, jobsOf, readyAsset, readyOutput, tagsOf, viewsOf } from '@/lib/brand-studio/repo';
import type { OutputRow, StudioDeps } from '@/lib/brand-studio/types';
import { allowanceView, loadAllowance } from '@/lib/brand-studio/usage';
import { buildWorkflowWithAi } from './ai-builder';
import { verifyCharacterSheetConsistency, type ConsistencyCandidateSheet } from './consistency';
import {
  isWorkflowOperation,
  PlaybookDeleteSchema,
  PlaybookSaveSchema,
  WorkflowBuildWithAiSchema,
  WorkflowCreateSchema,
  WorkflowDeleteSchema,
  WorkflowRecipeSchema,
  WorkflowRunSchema,
  WorkflowSaveFromJobSchema,
  WorkflowUpdateSchema,
  type CharacterConsistencyReport,
  type PlaybookSavedResult,
  type PlaybookStatus,
  type PlaybookWire,
  type RecentRunSummaryWire,
  type WorkflowCategory,
  type WorkflowDeletedResult,
  type WorkflowOperationResult,
  type WorkflowRecipe,
  type WorkflowRefChoice,
  type WorkflowRunResult,
  type WorkflowSavedResult,
  type WorkflowsHubState,
  type WorkflowSource,
  type WorkflowStep,
  type WorkflowWire,
} from './contracts';
import { estimateRecipeCredits, findStarterWorkflow, STARTER_WORKFLOWS } from './starters';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

interface WorkflowRow {
  id: string;
  organization_id: string;
  slug: string;
  title: string;
  summary: string;
  category: WorkflowCategory;
  recipe: unknown;
  source: WorkflowSource;
  revision: number;
  created_by: string | null;
  request_id: string;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlaybookRow {
  id: string;
  organization_id: string;
  title: string;
  body_md: string;
  tags: string[] | string;
  inject_director: boolean;
  status: PlaybookStatus;
  created_by: string | null;
  request_id: string;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface FolderRow {
  id: string;
  name: string;
}

function slugifyTitle(title: string, fallback = 'team-workflow'): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return ascii || fallback;
}

function parseStoredRecipe(raw: unknown): WorkflowRecipe {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const parsed = WorkflowRecipeSchema.safeParse(obj);
  if (parsed.success) return parsed.data;
  return {
    version: 1,
    guide: '',
    consistencyCheck: 'none',
    slots: [],
    steps: [
      {
        id: 'step_1',
        label: '스튜디오 생성',
        medium: 'image',
        model: 'nano-banana-pro',
        aspect: '4:5',
        resolution: '2K',
        count: 1,
        promptTemplate: '{prompt}',
        useReferenceSlots: [],
      },
    ],
  };
}

function workflowWireOf(row: WorkflowRow): WorkflowWire {
  const recipe = parseStoredRecipe(row.recipe);
  const visibleSteps = recipe.steps.filter((s) => !s.onlyWhenNoImageRef);
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    summary: String(row.summary ?? ''),
    category: row.category,
    source: row.source,
    starter: false,
    revision: Number(row.revision ?? 1),
    stepCount: Math.max(1, visibleSteps.length),
    estimatedCredits: estimateRecipeCredits(recipe, { hasImageRef: true }),
    recipe,
    updatedAt: iso(row.updated_at),
  };
}

function playbookWireOf(row: PlaybookRow): PlaybookWire {
  return {
    id: String(row.id),
    title: String(row.title),
    bodyMd: String(row.body_md ?? ''),
    tags: tagsOf(row.tags),
    injectDirector: Boolean(row.inject_director),
    status: row.status === 'draft' ? 'draft' : 'published',
    updatedAt: iso(row.updated_at),
  };
}

/* ------------------------------------------------------------------- reads */

async function tableExists(sql: SqlRunner, tableName: string): Promise<boolean> {
  try {
    const row = (await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${tableName}`])).rows[0];
    return Boolean(row?.t);
  } catch {
    return false;
  }
}

export async function listOrgWorkflows(sql: SqlRunner, organizationId: string): Promise<WorkflowWire[]> {
  if (!(await tableExists(sql, 'brand_studio_workflows'))) return [];
  const rows = (
    await sql.query<WorkflowRow>(
      'select * from brand_studio_workflows where organization_id = $1 and deleted_at is null order by updated_at desc, id',
      [organizationId],
    )
  ).rows;
  return rows.map(workflowWireOf);
}

export async function listOrgPlaybooks(sql: SqlRunner, organizationId: string): Promise<PlaybookWire[]> {
  if (!(await tableExists(sql, 'brand_studio_playbooks'))) return [];
  const rows = (
    await sql.query<PlaybookRow>(
      'select * from brand_studio_playbooks where organization_id = $1 and deleted_at is null order by inject_director desc, updated_at desc, id',
      [organizationId],
    )
  ).rows;
  return rows.map(playbookWireOf);
}

export async function resolveWorkflowTarget(sql: SqlRunner, organizationId: string, idOrSlug: string): Promise<WorkflowWire | null> {
  const starter = findStarterWorkflow(idOrSlug);
  if (starter) return starter;
  if (!(await tableExists(sql, 'brand_studio_workflows'))) return null;
  if (UUID.test(idOrSlug)) {
    const byId = (
      await sql.query<WorkflowRow>(
        'select * from brand_studio_workflows where id = $1 and organization_id = $2 and deleted_at is null',
        [idOrSlug, organizationId],
      )
    ).rows[0];
    if (byId) return workflowWireOf(byId);
  }
  const bySlug = (
    await sql.query<WorkflowRow>(
      'select * from brand_studio_workflows where organization_id = $1 and slug = $2 and deleted_at is null order by updated_at desc limit 1',
      [organizationId, idOrSlug],
    )
  ).rows[0];
  return bySlug ? workflowWireOf(bySlug) : null;
}

async function recentRunSummaries(deps: StudioDeps, sql: SqlRunner, organizationId: string): Promise<RecentRunSummaryWire[]> {
  const rawJobs = await jobsOf(sql, organizationId, 16);
  const views = await viewsOf(sql, rawJobs, deps.media);
  return views
    .filter((j) => j.kind === 'image' || j.kind === 'video' || j.kind === 'video_remix')
    .slice(0, 12)
    .map((j) => ({
      jobId: j.id,
      kind: j.kind,
      model: j.model,
      aspect: j.aspect,
      resolution: j.resolution,
      seconds: j.seconds,
      audio: j.audio,
      prompt: j.prompt,
      referenceRoles: j.references.map((r) => r.role ?? 'media'),
      thumbUrl: j.outputs[0]?.thumbUrl ?? (j.outputs[0]?.kind === 'image' ? j.outputs[0]?.url : null) ?? null,
      createdAt: j.createdAt,
    }));
}

/** `GET /api/brand-studio/workflows?organizationId=…` */
export async function loadWorkflowsHubState(
  deps: StudioDeps,
  viewer: Viewer,
  organizationId: string,
): Promise<WorkflowsHubState | StudioFailure> {
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
      const now = deps.now?.() ?? new Date();
      const [allowance, workflows, playbooks, recentRuns] = await Promise.all([
        loadAllowance(sql, organizationId, deps.env, now),
        listOrgWorkflows(sql, organizationId),
        listOrgPlaybooks(sql, organizationId),
        recentRunSummaries(deps, sql, organizationId),
      ]);
      return {
        ok: true as const,
        canCreate: seat.canCreate,
        allowance: allowanceView(allowance),
        starters: [...STARTER_WORKFLOWS],
        workflows,
        playbooks,
        recentRuns,
      };
    }),
  );
}

/* -------------------------------------------------------------- dispatcher */

export async function runWorkflowOperation(
  deps: StudioDeps,
  viewer: Viewer,
  op: unknown,
  input: unknown,
): Promise<WorkflowOperationResult> {
  if (!isWorkflowOperation(op)) return failure('invalid');
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return failure('invalid');

  // Seat + Morphic sandbox + self_studio policy check BEFORE touching any payload detail.
  const gate = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      return seat;
    }),
  );
  if ('ok' in gate) return gate;

  switch (op) {
    case 'create':
      return createOrgWorkflow(deps, viewer, input);
    case 'update':
      return updateOrgWorkflow(deps, viewer, input);
    case 'delete':
      return deleteOrgWorkflow(deps, viewer, input);
    case 'run':
      return runWorkflow(deps, viewer, input);
    case 'save_from_job':
      return saveWorkflowFromJob(deps, viewer, input);
    case 'build_with_ai':
      return buildAndSaveWorkflowWithAi(deps, viewer, input);
    case 'save_playbook':
      return saveOrgPlaybook(deps, viewer, input);
    case 'delete_playbook':
      return deleteOrgPlaybook(deps, viewer, input);
  }
}

/* ----------------------------------------------------------- CRUD handlers */

export async function createOrgWorkflow(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowSavedResult | StudioFailure> {
  const parsed = WorkflowCreateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      await lockOrganization(sql, v.organizationId);
      const prior = (
        await sql.query<WorkflowRow>('select * from brand_studio_workflows where organization_id = $1 and request_id = $2', [
          v.organizationId,
          v.requestId,
        ])
      ).rows[0];
      if (prior) return { ok: true as const, workflow: workflowWireOf(prior) };

      const slug = v.slug ? slugifyTitle(v.slug) : slugifyTitle(v.title);
      const row = (
        await sql.query<WorkflowRow>(
          `insert into brand_studio_workflows (organization_id, slug, title, summary, category, recipe, source, created_by, request_id)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) returning *`,
          [
            v.organizationId,
            slug,
            v.title,
            v.summary,
            v.category,
            JSON.stringify(v.recipe),
            v.source,
            seat.userId,
            v.requestId,
          ],
        )
      ).rows[0]!;
      return { ok: true as const, workflow: workflowWireOf(row) };
    }),
  );
}

export async function updateOrgWorkflow(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowSavedResult | StudioFailure> {
  const parsed = WorkflowUpdateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      const current = (
        await sql.query<WorkflowRow>(
          'select * from brand_studio_workflows where id = $1 and organization_id = $2 and deleted_at is null for update',
          [v.workflowId, v.organizationId],
        )
      ).rows[0];
      if (!current) throw new StudioDenied('not_found');
      const nextTitle = v.title ?? current.title;
      const nextSummary = v.summary ?? current.summary;
      const nextCategory = v.category ?? current.category;
      const nextRecipe = v.recipe ?? parseStoredRecipe(current.recipe);
      const row = (
        await sql.query<WorkflowRow>(
          `update brand_studio_workflows
              set title = $3, summary = $4, category = $5, recipe = $6::jsonb, revision = revision + 1, updated_at = now()
            where id = $1 and organization_id = $2
            returning *`,
          [v.workflowId, v.organizationId, nextTitle, nextSummary, nextCategory, JSON.stringify(nextRecipe)],
        )
      ).rows[0]!;
      return { ok: true as const, workflow: workflowWireOf(row) };
    }),
  );
}

export async function deleteOrgWorkflow(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowDeletedResult | StudioFailure> {
  const parsed = WorkflowDeleteSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true }));
      const hit = (
        await sql.query<{ id: string }>('select id from brand_studio_workflows where id = $1 and organization_id = $2', [
          v.workflowId,
          v.organizationId,
        ])
      ).rows[0];
      if (!hit) throw new StudioDenied('not_found');
      await sql.query(
        'update brand_studio_workflows set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null',
        [v.workflowId],
      );
      return { ok: true as const };
    }),
  );
}

/* --------------------------------------------------------- save_from_job */

export async function saveWorkflowFromJob(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowSavedResult | StudioFailure> {
  const parsed = WorkflowSaveFromJobSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;

  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      await lockOrganization(sql, v.organizationId);

      const prior = (
        await sql.query<WorkflowRow>('select * from brand_studio_workflows where organization_id = $1 and request_id = $2', [
          v.organizationId,
          v.requestId,
        ])
      ).rows[0];
      if (prior) return { ok: true as const, workflow: workflowWireOf(prior) };

      const jobRows = await jobsByIds(sql, v.organizationId, [v.jobId]);
      const job = jobRows[0];
      if (!job) throw new StudioDenied('not_found');

      const isVideo = job.kind === 'video' || job.kind === 'video_remix' || job.kind === 'video_final';
      const hasVideoRef = job.kind === 'video_remix';
      const refs = Array.isArray(job.refs) ? job.refs : [];
      const firstImageRole: StudioAssetRole =
        refs.find((r) => r.role)?.role ?? (v.category === 'character' ? 'person' : 'product');

      const modelDef = studioModel(job.model);
      const safeModel =
        modelDef && modelDef.availability === 'live' && modelDef.medium === (isVideo ? 'video' : 'image')
          ? job.model
          : isVideo
            ? 'seedance-2.5'
            : 'nano-banana-pro';

      const aspect = job.params?.aspect ?? (isVideo ? '9:16' : '4:5');
      const resolution = isVideo
        ? job.params?.resolution === '1080p' || job.params?.resolution === '480p'
          ? job.params.resolution
          : '720p'
        : job.params?.resolution === '1K' || job.params?.resolution === '4K'
          ? job.params.resolution
          : '2K';
      const seconds = isVideo ? Math.max(4, Math.min(15, Number(job.params?.seconds ?? 5))) : undefined;
      const audio = isVideo ? (job.params?.audio ?? 'ambient') : undefined;
      const basePrompt = (job.prompt || '').trim().slice(0, 2200);
      const promptHasImageMention = /(?:@image1|이미지\s*1|image\s*1)/i.test(basePrompt);
      const templatePrompt = promptHasImageMention
        ? `${basePrompt} {prompt}`.trim()
        : `Reference authority: Preserve {subject} (@image1) key visual traits. ${basePrompt} {prompt}`.trim();

      const recipe: WorkflowRecipe = WorkflowRecipeSchema.parse({
        version: 1,
        guide:
          v.summary ||
          `스튜디오 작업(${safeModel} · ${aspect})에서 저장된 재사용 템플릿입니다. 기준 에셋과 추가 연출 메모만 바꿔 반복 실행할 수 있습니다.`,
        defaultFolderPattern: `${v.title.slice(0, 28)} · {subject}`,
        consistencyCheck: v.category === 'character' ? 'character_sheet' : 'none',
        slots: [
          ...(hasVideoRef
            ? [
                {
                  key: 'video1',
                  kind: 'video_ref' as const,
                  label: '기준 영상 (@video1)',
                  labelEn: 'Reference video (@video1)',
                  required: false,
                },
              ]
            : []),
          {
            key: 'image1',
            kind: 'image_ref' as const,
            label: '기준 이미지 (@image1)',
            labelEn: 'Reference image (@image1)',
            required: false,
            role: firstImageRole,
          },
          {
            key: 'subject',
            kind: 'text' as const,
            label: '대상 · 제품 이름',
            labelEn: 'Subject or product name',
            required: false,
            defaultValue: v.title.slice(0, 32),
          },
          {
            key: 'prompt',
            kind: 'textarea' as const,
            label: '이번 실행 추가 지시',
            labelEn: 'Per-run styling notes',
            placeholder: '유지할 요소나 바꿀 배경·조명을 적어 주세요…',
            required: false,
          },
          {
            key: 'folderName',
            kind: 'folder' as const,
            label: '저장할 공유 폴더명',
            labelEn: 'Target shared folder',
            required: false,
          },
        ],
        steps: [
          {
            id: 'saved_step_1',
            label: `${v.title.slice(0, 40)} (${aspect})`,
            medium: isVideo ? 'video' : 'image',
            model: safeModel,
            aspect,
            resolution,
            ...(isVideo ? { seconds, audio } : {}),
            count: isVideo ? 1 : Math.max(1, Math.min(4, Number(job.params?.count ?? 1))),
            useReferenceSlots: hasVideoRef ? ['video1', 'image1'] : ['image1'],
            promptTemplate: templatePrompt,
          },
        ],
      });

      const category: WorkflowCategory = v.category ?? (isVideo ? 'video' : 'product');
      const row = (
        await sql.query<WorkflowRow>(
          `insert into brand_studio_workflows (organization_id, slug, title, summary, category, recipe, source, created_by, request_id)
           values ($1, $2, $3, $4, $5, $6::jsonb, 'saved_run', $7, $8) returning *`,
          [
            v.organizationId,
            slugifyTitle(v.title, 'saved-run'),
            v.title,
            v.summary || `${safeModel} · ${aspect} 설정 고정 워크플로우`,
            category,
            JSON.stringify(recipe),
            seat.userId,
            v.requestId,
          ],
        )
      ).rows[0]!;

      return { ok: true as const, workflow: workflowWireOf(row) };
    }),
  );
}

/* --------------------------------------------------------- build_with_ai */

export async function buildAndSaveWorkflowWithAi(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowSavedResult | StudioFailure> {
  const parsed = WorkflowBuildWithAiSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;

  // Check idempotency before calling Gemini.
  const existing = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      const prior = (
        await sql.query<WorkflowRow>('select * from brand_studio_workflows where organization_id = $1 and request_id = $2', [
          v.organizationId,
          v.requestId,
        ])
      ).rows[0];
      return prior ? workflowWireOf(prior) : null;
    }),
  );
  if (existing && 'ok' in existing) return existing;
  if (existing) return { ok: true, workflow: existing };

  const compiled = await buildWorkflowWithAi(v.brief, deps.intelDeps);

  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      await lockOrganization(sql, v.organizationId);
      const prior = (
        await sql.query<WorkflowRow>('select * from brand_studio_workflows where organization_id = $1 and request_id = $2', [
          v.organizationId,
          v.requestId,
        ])
      ).rows[0];
      if (prior) return { ok: true as const, workflow: workflowWireOf(prior), builderMode: compiled.mode };

      const row = (
        await sql.query<WorkflowRow>(
          `insert into brand_studio_workflows (organization_id, slug, title, summary, category, recipe, source, created_by, request_id)
           values ($1, $2, $3, $4, $5, $6::jsonb, 'ai_builder', $7, $8) returning *`,
          [
            v.organizationId,
            slugifyTitle(compiled.title, 'ai-workflow'),
            compiled.title,
            compiled.summary,
            compiled.category,
            JSON.stringify(compiled.recipe),
            seat.userId,
            v.requestId,
          ],
        )
      ).rows[0]!;
      return { ok: true as const, workflow: workflowWireOf(row), builderMode: compiled.mode };
    }),
  );
}

/* ------------------------------------------------------------- playbooks */

export async function saveOrgPlaybook(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<PlaybookSavedResult | StudioFailure> {
  const parsed = PlaybookSaveSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const cleanTags = [...new Set(v.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 10);

  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);

      if (v.playbookId) {
        const current = (
          await sql.query<PlaybookRow>(
            'select * from brand_studio_playbooks where id = $1 and organization_id = $2 and deleted_at is null for update',
            [v.playbookId, v.organizationId],
          )
        ).rows[0];
        if (!current) throw new StudioDenied('not_found');
        const updated = (
          await sql.query<PlaybookRow>(
            `update brand_studio_playbooks
                set title = $3, body_md = $4, tags = $5::text[], inject_director = $6, status = $7, updated_at = now()
              where id = $1 and organization_id = $2
              returning *`,
            [v.playbookId, v.organizationId, v.title, v.bodyMd, cleanTags, v.injectDirector, v.status],
          )
        ).rows[0]!;
        return { ok: true as const, playbook: playbookWireOf(updated) };
      }

      await lockOrganization(sql, v.organizationId);
      const prior = (
        await sql.query<PlaybookRow>('select * from brand_studio_playbooks where organization_id = $1 and request_id = $2', [
          v.organizationId,
          v.requestId,
        ])
      ).rows[0];
      if (prior && !prior.deleted_at) return { ok: true as const, playbook: playbookWireOf(prior) };

      const inserted = (
        await sql.query<PlaybookRow>(
          `insert into brand_studio_playbooks (organization_id, title, body_md, tags, inject_director, status, created_by, request_id)
           values ($1, $2, $3, $4::text[], $5, $6, $7, $8) returning *`,
          [v.organizationId, v.title, v.bodyMd, cleanTags, v.injectDirector, v.status, seat.userId, v.requestId],
        )
      ).rows[0]!;
      return { ok: true as const, playbook: playbookWireOf(inserted) };
    }),
  );
}

export async function deleteOrgPlaybook(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowDeletedResult | StudioFailure> {
  const parsed = PlaybookDeleteSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  return guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true }));
      const row = (
        await sql.query<{ id: string }>('select id from brand_studio_playbooks where id = $1 and organization_id = $2', [
          v.playbookId,
          v.organizationId,
        ])
      ).rows[0];
      if (!row) throw new StudioDenied('not_found');
      await sql.query(
        'update brand_studio_playbooks set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null',
        [v.playbookId],
      );
      return { ok: true as const };
    }),
  );
}

/* --------------------------------------------------------- workflow runner */

function formatStepPrompt(input: {
  template: string;
  subject: string;
  userPrompt: string;
  directorRules: string;
  hasImageRef: boolean;
  hasVideoRef: boolean;
}): string {
  let rendered = input.template
    .replace(/\{subject\}/g, input.subject)
    .replace(/\{prompt\}/g, input.userPrompt);

  if (!input.hasImageRef) {
    rendered = rendered
      .replace(/@image\d+/gi, input.subject)
      .replace(/(?:이미지|사진|image|img|figure)\s*#?\s*\d{1,2}/gi, input.subject);
  }
  if (!input.hasVideoRef) {
    rendered = rendered
      .replace(/@video\d+/gi, 'the reference pacing')
      .replace(/(?:영상|비디오|video)\s*#?\s*\d{1,2}/gi, 'the reference pacing');
  }

  if (input.directorRules) {
    rendered = `${rendered}\n\nTeam brand guidelines: ${input.directorRules}`;
  }
  return rendered.trim().slice(0, STUDIO_LIMITS.promptMax);
}

async function settleFakeJobsIfLocal(deps: StudioDeps, jobIds: readonly string[]): Promise<void> {
  if (deps.env.provider !== 'fake' || jobIds.length === 0) return;
  for (let pass = 0; pass < 4; pass += 1) {
    const { advanced } = await advanceStudioJobsWith(deps, { jobIds });
    if (advanced === 0 && pass > 0) break;
  }
}

async function ensureSharedFolderAndFileOutputs(
  sql: SqlRunner,
  organizationId: string,
  userId: string,
  folderNameRaw: string,
  jobIds: readonly string[],
  anchorAssetId?: string | null,
): Promise<{ id: string; name: string } | null> {
  const cleanName = folderNameRaw.trim().replace(/\s+/g, ' ').slice(0, 60).trim();
  if (!cleanName || jobIds.length === 0) return null;

  let folder = (
    await sql.query<FolderRow>(
      'select id, name from brand_studio_folders where organization_id = $1 and deleted_at is null and lower(name) = lower($2) limit 1',
      [organizationId, cleanName],
    )
  ).rows[0];

  if (!folder) {
    folder = (
      await sql.query<FolderRow>(
        'insert into brand_studio_folders (organization_id, name, created_by) values ($1, $2, $3) returning id, name',
        [organizationId, cleanName, userId],
      )
    ).rows[0]!;
  }

  if (anchorAssetId) {
    await sql.query(
      `insert into brand_studio_folder_items (folder_id, organization_id, asset_id, output_id, added_by)
       values ($1, $2, $3, null, $4)
       on conflict do nothing`,
      [folder.id, organizationId, anchorAssetId, userId],
    );
  }

  const outputRows = (
    await sql.query<{ id: string }>(
      'select id from brand_studio_outputs where organization_id = $1 and job_id = any($2::uuid[]) and deleted_at is null order by created_at asc, idx asc',
      [organizationId, [...jobIds]],
    )
  ).rows;

  for (const out of outputRows) {
    await sql.query(
      `insert into brand_studio_folder_items (folder_id, organization_id, asset_id, output_id, added_by)
       values ($1, $2, null, $3, $4)
       on conflict do nothing`,
      [folder.id, organizationId, out.id, userId],
    );
  }

  await sql.query('update brand_studio_folders set updated_at = now() where id = $1', [folder.id]);
  return { id: String(folder.id), name: String(folder.name) };
}

function buildStepJobCreateInput(input: {
  organizationId: string;
  requestId: string;
  step: WorkflowStep;
  prompt: string;
  imageRef: StudioReference | null;
  videoRef: StudioReference | null;
  userPrompt: string;
}): StudioJobCreate {
  const { step, imageRef, videoRef } = input;
  const wantsImage = Boolean(imageRef && (step.useReferenceSlots.includes('image1') || step.useHeroOutputAsRef));
  const wantsVideo = Boolean(videoRef && step.useReferenceSlots.includes('video1'));

  if (step.medium === 'video') {
    if (wantsVideo && videoRef) {
      const refs: StudioReference[] = [videoRef, ...(wantsImage && imageRef ? [imageRef] : [])];
      return {
        kind: 'video_remix',
        organizationId: input.organizationId,
        requestId: input.requestId,
        model: step.model,
        prompt: input.prompt,
        enhance: true,
        references: refs,
        aspect: step.aspect,
        resolution: step.resolution === '1080p' || step.resolution === '480p' || step.resolution === 'draft' ? step.resolution : '720p',
        audio: step.audio ?? 'ambient',
        method: 'blueprint',
        keep: ['camera', 'timing', 'composition', 'look'],
        change: input.userPrompt || input.prompt.slice(0, 300),
        seconds: step.seconds ?? 5,
      };
    }
    return {
      kind: 'video',
      organizationId: input.organizationId,
      requestId: input.requestId,
      model: step.model,
      prompt: input.prompt,
      enhance: true,
      references: wantsImage && imageRef ? [imageRef] : [],
      aspect: step.aspect,
      resolution: step.resolution === '1080p' || step.resolution === '480p' || step.resolution === 'draft' ? step.resolution : '720p',
      audio: step.audio ?? 'ambient',
      seconds: step.seconds ?? 5,
    };
  }

  return {
    kind: 'image',
    organizationId: input.organizationId,
    requestId: input.requestId,
    model: step.model,
    prompt: input.prompt,
    enhance: true,
    references: wantsImage && imageRef ? [imageRef] : [],
    aspect: step.aspect,
    resolution: step.resolution,
    count: step.count ?? 1,
  };
}

async function loadRefBytesIfReady(
  deps: StudioDeps,
  organizationId: string,
  ref: WorkflowRefChoice | StudioReference | null,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!ref) return null;
  try {
    if (ref.assetId) {
      const row = await readyAsset(deps.sql, organizationId, ref.assetId);
      if (!row?.storage_key) return null;
      const bytes = await deps.media.read(row.storage_key);
      return bytes ? { bytes, mime: row.mime || 'image/png' } : null;
    }
    if (ref.outputId) {
      const row = await readyOutput(deps.sql, organizationId, ref.outputId);
      if (!row?.storage_key) return null;
      const bytes = await deps.media.read(row.storage_key);
      return bytes ? { bytes, mime: row.mime || 'image/png' } : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Executes any Starter or Organization Workflow (`character-sheet-maker`, `product-packshot-sheet`,
 * `reference-video-ad-pack`, or custom team recipe), dispatching real `brand_studio_jobs`, running
 * vision consistency verification (with 1-time auto-retry on drift for character sheets), and filing
 * outputs into a shared `brand_studio_folders` collection.
 */
export async function runWorkflow(
  deps: StudioDeps,
  viewer: Viewer,
  raw: unknown,
): Promise<WorkflowRunResult | StudioFailure> {
  const parsed = WorkflowRunSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;

  // Validate seat, workflow existence, references, and gather injected team playbooks first.
  const prep = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await studioSeat(sql, viewer.userId, v.organizationId, { requireSelfStudio: true });
      requireCreate(seat);
      const workflow = await resolveWorkflowTarget(sql, v.organizationId, v.workflowId);
      if (!workflow) throw new StudioDenied('not_found');

      let initialImageRef: StudioReference | null = null;
      if (v.inputs.image1Ref) {
        const ref = v.inputs.image1Ref;
        const ok = ref.assetId
          ? await readyAsset(sql, v.organizationId, ref.assetId)
          : await readyOutput(sql, v.organizationId, ref.outputId!);
        if (!ok || ok.kind !== 'image') throw new StudioDenied('reference_missing');
        initialImageRef = {
          ...(ref.assetId ? { assetId: ref.assetId } : { outputId: ref.outputId }),
          role: ref.role ?? (workflow.category === 'character' ? 'person' : 'product'),
        };
      }

      let initialVideoRef: StudioReference | null = null;
      if (v.inputs.video1Ref) {
        const ref = v.inputs.video1Ref;
        const ok = ref.assetId
          ? await readyAsset(sql, v.organizationId, ref.assetId)
          : await readyOutput(sql, v.organizationId, ref.outputId!);
        if (!ok || ok.kind !== 'video') throw new StudioDenied('reference_missing');
        initialVideoRef = ref.assetId ? { assetId: ref.assetId } : { outputId: ref.outputId };
      }

      const injectedRows = (await tableExists(sql, 'brand_studio_playbooks'))
        ? (
            await sql.query<{ title: string; body_md: string }>(
              `select title, body_md from brand_studio_playbooks
                where organization_id = $1 and deleted_at is null and status = 'published' and inject_director = true
                order by updated_at desc limit 4`,
              [v.organizationId],
            )
          ).rows
        : [];
      const directorRules = injectedRows
        .map((r) => `${r.title}: ${r.body_md.replace(/\s+/g, ' ').slice(0, 180)}`)
        .join(' | ')
        .slice(0, 600);

      return { seat, workflow, initialImageRef, initialVideoRef, directorRules };
    }),
  );
  if ('ok' in prep) return prep;

  const { seat, workflow, initialImageRef, initialVideoRef, directorRules } = prep;
  const { recipe } = workflow;
  const defaultSubject =
    recipe.slots.find((s) => s.key === 'subject')?.defaultValue ||
    (workflow.category === 'character' ? '기본 캐릭터' : workflow.title.slice(0, 24));
  const subject = (v.inputs.subject?.trim() || defaultSubject).slice(0, 60);
  const userPrompt = (v.inputs.prompt ?? '').trim();

  const packSlot = recipe.slots.find((s) => s.key === 'outputs' && s.kind === 'multiselect');
  const selectedPacks =
    v.inputs.packs && v.inputs.packs.length > 0
      ? new Set(v.inputs.packs)
      : packSlot?.options?.length
        ? new Set(packSlot.options.filter((o) => o.defaultSelected !== false).map((o) => o.id))
        : null;

  let lockedImageRef: StudioReference | null = initialImageRef;
  const stepJobMap = new Map<string, StudioJobView>();
  const orderedJobIds: string[] = [];

  // Step 1a: If no @image1 was supplied and the recipe defines an anchor step (e.g. Character Sheet Maker),
  // generate the front anchor reference first so subsequent sheets lock onto it.
  const heroStep = !lockedImageRef ? recipe.steps.find((s) => s.onlyWhenNoImageRef) : undefined;
  if (heroStep) {
    const heroPrompt = formatStepPrompt({
      template: heroStep.promptTemplate,
      subject,
      userPrompt: userPrompt || workflow.summary,
      directorRules,
      hasImageRef: false,
      hasVideoRef: Boolean(initialVideoRef),
    });
    const heroReqId = `${v.requestId}_s0_${heroStep.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    const heroCreated = await createStudioJob(
      deps,
      viewer,
      buildStepJobCreateInput({
        organizationId: v.organizationId,
        requestId: heroReqId,
        step: heroStep,
        prompt: heroPrompt,
        imageRef: null,
        videoRef: initialVideoRef,
        userPrompt,
      }),
    );
    if (!heroCreated.ok) return heroCreated;
    stepJobMap.set(heroStep.id, heroCreated.job);
    orderedJobIds.push(heroCreated.job.id);

    await settleFakeJobsIfLocal(deps, [heroCreated.job.id]);
    const readyHeroOut = (
      await deps.sql.query<OutputRow>(
        "select * from brand_studio_outputs where job_id = $1 and organization_id = $2 and status = 'ready' and storage_key is not null order by idx asc limit 1",
        [heroCreated.job.id, v.organizationId],
      )
    ).rows[0];
    if (readyHeroOut) {
      lockedImageRef = { outputId: readyHeroOut.id, role: 'person' };
    }
  }

  // Main pipeline steps (e.g. 16:9 turnaround, 4-expression sheet, wardrobe detail sheet).
  const activeSteps = recipe.steps.filter((s) => {
    if (s.onlyWhenNoImageRef) return false;
    if (s.packId && selectedPacks && !selectedPacks.has(s.packId)) return false;
    return true;
  });
  if (activeSteps.length === 0) return failure('invalid');

  for (const [idx, step] of activeSteps.entries()) {
    const stepImageRef =
      lockedImageRef && (step.useReferenceSlots.includes('image1') || step.useHeroOutputAsRef) ? lockedImageRef : null;
    const stepVideoRef = initialVideoRef && step.useReferenceSlots.includes('video1') ? initialVideoRef : null;
    const stepPrompt = formatStepPrompt({
      template: step.promptTemplate,
      subject,
      userPrompt,
      directorRules,
      hasImageRef: Boolean(stepImageRef),
      hasVideoRef: Boolean(stepVideoRef),
    });
    const stepReqId = `${v.requestId}_s${idx + 1}_${step.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    const created = await createStudioJob(
      deps,
      viewer,
      buildStepJobCreateInput({
        organizationId: v.organizationId,
        requestId: stepReqId,
        step,
        prompt: stepPrompt,
        imageRef: stepImageRef,
        videoRef: stepVideoRef,
        userPrompt,
      }),
    );
    if (!created.ok) return created;
    stepJobMap.set(step.id, created.job);
    orderedJobIds.push(created.job.id);
  }

  await settleFakeJobsIfLocal(deps, orderedJobIds);

  // Step 3a: Vision consistency check for Character Sheet workflows (with 1-time auto-retry on drift).
  let consistency: CharacterConsistencyReport | null = null;
  if (recipe.consistencyCheck === 'character_sheet' || workflow.slug === 'character-sheet-maker') {
    const collectCandidateSheets = async (): Promise<ConsistencyCandidateSheet[]> => {
      const list: ConsistencyCandidateSheet[] = [];
      for (const step of activeSteps) {
        const job = stepJobMap.get(step.id);
        if (!job) continue;
        const outRow = (
          await deps.sql.query<OutputRow>(
            "select * from brand_studio_outputs where job_id = $1 and organization_id = $2 and status = 'ready' and storage_key is not null order by idx asc limit 1",
            [job.id, v.organizationId],
          )
        ).rows[0];
        let bytes: Uint8Array | null = null;
        if (outRow?.storage_key) {
          try {
            bytes = await deps.media.read(outRow.storage_key);
          } catch {
            bytes = null;
          }
        }
        list.push({
          stepId: step.id,
          label: step.label,
          bytes,
          mime: outRow?.mime ?? 'image/png',
        });
      }
      return list;
    };

    const anchorMedia = await loadRefBytesIfReady(deps, v.organizationId, lockedImageRef);
    const firstVerdict = await verifyCharacterSheetConsistency(
      {
        subject,
        prompt: userPrompt,
        anchor: anchorMedia,
        sheets: await collectCandidateSheets(),
      },
      deps.intelDeps,
    );

    if (!firstVerdict.passed && firstVerdict.driftedStepId) {
      const driftedStep = activeSteps.find((s) => s.id === firstVerdict.driftedStepId);
      if (driftedStep) {
        const stepImageRef =
          lockedImageRef && (driftedStep.useReferenceSlots.includes('image1') || driftedStep.useHeroOutputAsRef)
            ? lockedImageRef
            : null;
        const retryPrompt = formatStepPrompt({
          template: `STRICT IDENTITY & WARDROBE LOCK RETRY: Match exact facial proportions, hair silhouette, skin tone, and garment colors of @image1 with zero drift. ${driftedStep.promptTemplate}`,
          subject,
          userPrompt,
          directorRules,
          hasImageRef: Boolean(stepImageRef),
          hasVideoRef: false,
        });
        const retryReqId = `${v.requestId}_retry_${driftedStep.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
        const retriedJob = await createStudioJob(
          deps,
          viewer,
          buildStepJobCreateInput({
            organizationId: v.organizationId,
            requestId: retryReqId,
            step: driftedStep,
            prompt: retryPrompt,
            imageRef: stepImageRef,
            videoRef: null,
            userPrompt,
          }),
        );
        if (retriedJob.ok) {
          const oldJob = stepJobMap.get(driftedStep.id);
          stepJobMap.set(driftedStep.id, retriedJob.job);
          const pos = oldJob ? orderedJobIds.indexOf(oldJob.id) : -1;
          if (pos >= 0) orderedJobIds[pos] = retriedJob.job.id;
          else orderedJobIds.push(retriedJob.job.id);
          await settleFakeJobsIfLocal(deps, [retriedJob.job.id]);

          const secondVerdict = await verifyCharacterSheetConsistency(
            {
              subject,
              prompt: userPrompt,
              anchor: anchorMedia,
              sheets: await collectCandidateSheets(),
              retried: true,
              retriedStepId: driftedStep.id,
            },
            deps.intelDeps,
          );
          const { driftedStepId: _d2, ...report2 } = secondVerdict;
          consistency = report2;
        }
      }
    }

    if (!consistency) {
      const { driftedStepId: _d1, ...report1 } = firstVerdict;
      consistency = report1;
    }
  }

  // Step 3b: Auto-organize outputs into the shared organization folder.
  const pattern =
    viewer.locale === 'en' && recipe.defaultFolderPatternEn && !/[가-힣]/.test(subject)
      ? recipe.defaultFolderPatternEn
      : recipe.defaultFolderPattern ?? `${workflow.title.slice(0, 28)} · {subject}`;
  const resolvedFolderName = (v.inputs.folderName?.trim() || pattern.replace(/\{subject\}/g, subject)).slice(0, 60);

  const finalized = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      const folder = await ensureSharedFolderAndFileOutputs(
        sql,
        v.organizationId,
        seat.userId,
        resolvedFolderName,
        orderedJobIds,
        initialImageRef?.assetId ?? null,
      );
      const rawJobs = await jobsByIds(sql, v.organizationId, orderedJobIds);
      const byId = new Map((await viewsOf(sql, rawJobs, deps.media)).map((j) => [j.id, j]));
      const jobs = orderedJobIds.map((id) => byId.get(id)).filter((j): j is StudioJobView => Boolean(j));
      const allowance = allowanceView(await loadAllowance(sql, v.organizationId, deps.env, deps.now?.() ?? new Date()));
      return { folder, jobs, allowance };
    }),
  );
  if ('ok' in finalized) return finalized;

  return {
    ok: true,
    workflowId: workflow.id,
    workflowSlug: workflow.slug,
    jobs: finalized.jobs,
    folder: finalized.folder,
    consistency,
    allowance: finalized.allowance,
  };
}

/** Dedicated convenience alias for Flagship #1 `캐릭터 시트 메이커`. */
export async function runCharacterSheetWorkflow(
  deps: StudioDeps,
  viewer: Viewer,
  input: {
    organizationId: string;
    requestId: string;
    image1Ref?: WorkflowRefChoice | null;
    subject?: string;
    prompt?: string;
    packs?: string[];
    folderName?: string;
  },
): Promise<WorkflowRunResult | StudioFailure> {
  return runWorkflow(deps, viewer, {
    organizationId: input.organizationId,
    requestId: input.requestId,
    workflowId: 'character-sheet-maker',
    inputs: {
      image1Ref: input.image1Ref ?? null,
      subject: input.subject,
      prompt: input.prompt ?? '',
      packs: input.packs,
      folderName: input.folderName,
    },
  });
}
