/**
 * Streamable HTTP MCP JSON-RPC 2.0 server (`2025-03-26`, `docs/STUDIO-PRO-SUITE-V4.md` §1.5).
 *
 * Exposes 8 tools and 2 resource namespaces scoped strictly to the authenticated member's
 * verified `StudioSeat` (`organizationId` + `userId`). Uses the organization's normal credit
 * allowance with zero artificial per-token daily cap.
 */
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { StudioSeat } from '@/lib/brand-studio/access';
import { STUDIO_JOB_OPEN_STATUSES, type StudioReference } from '@/lib/brand-studio/contracts';
import { creditsLeft, creditsOf } from '@/lib/brand-studio/credits';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/lib/brand-studio/models';
import { assetView, assetsOf, jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { loadAllowance } from '@/lib/brand-studio/usage';
import {
  buildWorkflowWithAi,
  createOrgWorkflow,
  listOrgPlaybooks,
  listOrgWorkflows,
  resolveWorkflowTarget,
  runWorkflow,
  saveOrgPlaybook,
  STARTER_WORKFLOWS,
  WORKFLOW_CATEGORIES,
  WorkflowRecipeSchema,
  withoutStepPresets,
  type WorkflowCategory,
} from '@/lib/brand-studio/workflows';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpDispatchContext {
  deps: StudioDeps;
  seat: StudioSeat;
  viewer: Viewer;
}

export type McpDispatchResult =
  | { kind: 'accepted'; queuedJobIds: string[] }
  | { kind: 'json'; payload: JsonRpcResponse | JsonRpcResponse[]; queuedJobIds: string[] };

const reqId = () => `mcp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

export const MCP_TOOL_DEFINITIONS = [
  {
    name: 'twings_list_assets',
    description: 'Search and list this workspace’s uploaded brand assets and recent generated studio outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword to filter by asset name, tag, or prompt.' },
        kind: { type: 'string', enum: ['image', 'video', 'audio'], description: 'Optional media kind filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 60, default: 24 },
      },
    },
  },
  {
    name: 'twings_list_workflows',
    description: 'List built-in starter workflows (including Character Sheet Maker and Character Sheet for Video) and custom workflows saved by your team, with the inputs each one takes.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...WORKFLOW_CATEGORIES] },
      },
    },
  },
  {
    name: 'twings_create_workflow',
    description:
      'Create and save a reusable custom workflow for your team, either from a plain-language brief or explicit steps.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Workflow title (1–120 chars).' },
        summary: { type: 'string', description: 'Short explanation for teammates.' },
        category: { type: 'string', enum: [...WORKFLOW_CATEGORIES] },
        brief: {
          type: 'string',
          description: 'Plain-language description of inputs and desired multi-step outputs (auto-compiles steps when steps are omitted).',
        },
        guide: { type: 'string', description: 'Team usage instructions.' },
        steps: {
          type: 'array',
          description: 'Optional explicit step list.',
          items: {
            type: 'object',
            required: ['id', 'label', 'medium', 'aspect', 'promptTemplate'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              medium: { type: 'string', enum: ['image', 'video'] },
              model: { type: 'string' },
              aspect: { type: 'string' },
              resolution: { type: 'string' },
              seconds: { type: 'integer' },
              promptTemplate: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'twings_run_workflow',
    description:
      'Execute Character Sheet Maker (`character-sheet-maker`), Character Sheet for Video (`video-character-sheet`, needs two pictures: a person photo as Image 1 and an outfit photo as Image 2) or any team workflow, creating real studio generation jobs and organizing results into a shared folder.',
    inputSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Starter slug (`character-sheet-maker`, `video-character-sheet`, `product-packshot-sheet`, `reference-video-ad-pack`) or team workflow UUID. `video-character-sheet` needs both Image 1 and Image 2.',
        },
        imageAssetId: { type: 'string', description: 'Optional reference image asset UUID (@image1). Image 1: person photo for `video-character-sheet`.' },
        imageOutputId: { type: 'string', description: 'Optional prior generated output UUID (@image1).' },
        image2AssetId: { type: 'string', description: 'Image 2: outfit photo for `video-character-sheet` (library image asset UUID).' },
        image2OutputId: { type: 'string', description: 'Image 2: outfit photo for `video-character-sheet` (prior generated output UUID).' },
        videoAssetId: { type: 'string', description: 'Optional reference video asset UUID (@video1).' },
        subject: { type: 'string', description: 'Character, model, or product name.' },
        prompt: { type: 'string', description: 'Styling, wardrobe, lighting, or scene direction.' },
        packs: { type: 'array', items: { type: 'string' }, description: 'Optional subset of output pack IDs to run.' },
        folderName: { type: 'string', description: 'Optional shared folder name for outputs.' },
      },
    },
  },
  {
    name: 'twings_list_playbooks',
    description: 'Read shared team knowledge cards, brand visual guidelines, and prompt guides.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string' },
        status: { type: 'string', enum: ['published', 'draft'] },
      },
    },
  },
  {
    name: 'twings_save_playbook',
    description: 'Create or update a shared team knowledge card / brand prompt guide.',
    inputSchema: {
      type: 'object',
      required: ['title', 'bodyMd'],
      properties: {
        playbookId: { type: 'string', description: 'Existing playbook UUID when updating.' },
        title: { type: 'string' },
        bodyMd: { type: 'string', description: 'Markdown content.' },
        tags: { type: 'array', items: { type: 'string' } },
        injectDirector: { type: 'boolean', description: 'When true, workflows automatically reference this guide.' },
        status: { type: 'string', enum: ['published', 'draft'] },
      },
    },
  },
  {
    name: 'twings_generate_image',
    description: 'Start a Brand Studio image generation job.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string', description: 'Defaults to nano-banana-pro.' },
        aspect: { type: 'string', default: '4:5' },
        resolution: { type: 'string', default: '2K' },
        count: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
        referenceAssetIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'twings_generate_video',
    description: 'Start a Brand Studio Seedance 2.5 video generation job (ambient foley by default, no BGM).',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        aspect: { type: 'string', default: '9:16' },
        resolution: { type: 'string', enum: ['480p', '720p', '1080p', 'draft'], default: '720p' },
        seconds: { type: 'integer', minimum: 4, maximum: 15, default: 5 },
        audio: { type: 'string', enum: ['ambient', 'native', 'silent'], default: 'ambient' },
        referenceAssetIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
] as const;

function toolSuccess(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: false,
  };
}

function toolFailure(code: string, message?: string) {
  const payload = { ok: false, code, ...(message ? { message } : {}) };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

async function settleIfFake(deps: StudioDeps, jobId: string): Promise<void> {
  if (deps.env.provider !== 'fake') return;
  for (let i = 0; i < 4; i += 1) {
    const { advanced } = await advanceStudioJobsWith(deps, { jobIds: [jobId] });
    if (advanced === 0 && i > 0) break;
  }
}

async function callMcpTool(
  ctx: McpDispatchContext,
  toolName: string,
  args: Record<string, unknown>,
  queuedJobIds: string[],
): Promise<ReturnType<typeof toolSuccess>> {
  const { deps, seat, viewer } = ctx;
  const orgId = seat.organizationId;

  switch (toolName) {
    case 'twings_list_assets': {
      const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const kind = typeof args.kind === 'string' ? args.kind : undefined;
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(60, Math.floor(args.limit))) : 24;

      const [rawAssets, rawJobs, allowance] = await Promise.all([
        assetsOf(deps.sql, orgId, 120),
        jobsOf(deps.sql, orgId, 30),
        loadAllowance(deps.sql, orgId, deps.env, deps.now?.() ?? new Date()),
      ]);
      const assets = rawAssets
        .map((a) => assetView(a, deps.media))
        .filter((a) => (!kind || a.kind === kind) && (!q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))))
        .slice(0, limit);

      const jobViews = await viewsOf(deps.sql, rawJobs, deps.media);
      const recentOutputs = jobViews
        .flatMap((j) =>
          j.outputs.map((o) => ({
            outputId: o.id,
            jobId: j.id,
            kind: o.kind,
            url: o.url,
            prompt: j.prompt.slice(0, 140),
            createdAt: o.createdAt,
          })),
        )
        .filter((o) => (!kind || o.kind === kind) && (!q || o.prompt.toLowerCase().includes(q)))
        .slice(0, limit);

      return toolSuccess({
        ok: true,
        organizationName: seat.organizationName,
        creditsRemaining: creditsLeft(allowance.capKrw, allowance.usedKrw),
        assets,
        recentOutputs,
      });
    }

    case 'twings_list_workflows': {
      const category = typeof args.category === 'string' ? args.category : undefined;
      const custom = await listOrgWorkflows(deps.sql, orgId);
      const all = [...STARTER_WORKFLOWS, ...custom].filter((w) => !category || w.category === category);
      return toolSuccess({
        ok: true,
        workflows: all.map((w) => ({
          id: w.id,
          slug: w.slug,
          title: w.title,
          summary: w.summary,
          category: w.category,
          starter: w.starter,
          stepCount: w.stepCount,
          estimatedCredits: w.estimatedCredits,
          slots: w.recipe.slots,
        })),
      });
    }

    case 'twings_create_workflow': {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return toolFailure('invalid', 'title is required.');
      const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
      const rawCategory = typeof args.category === 'string' && (WORKFLOW_CATEGORIES as readonly string[]).includes(args.category)
        ? (args.category as WorkflowCategory)
        : undefined;

      let recipe;
      let category: WorkflowCategory = rawCategory ?? 'custom';
      if (Array.isArray(args.steps) && args.steps.length > 0) {
        const normalizedSteps = args.steps.slice(0, 6).map((s: Record<string, unknown>, i: number) => {
          const medium = s.medium === 'video' ? 'video' : 'image';
          return {
            id: typeof s.id === 'string' && s.id.trim() ? s.id.trim().slice(0, 36) : `step_${i + 1}`,
            label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 90) : `단계 ${i + 1}`,
            medium,
            model: typeof s.model === 'string' && s.model.trim() ? s.model.trim() : medium === 'video' ? DEFAULT_VIDEO_MODEL : 'nano-banana-pro',
            aspect: typeof s.aspect === 'string' && s.aspect.trim() ? s.aspect.trim() : medium === 'video' ? '9:16' : '4:5',
            resolution: typeof s.resolution === 'string' && s.resolution.trim() ? s.resolution.trim() : medium === 'video' ? '720p' : '2K',
            ...(medium === 'video' ? { seconds: typeof s.seconds === 'number' ? s.seconds : 5, audio: 'ambient' as const } : { count: 1 }),
            promptTemplate: typeof s.promptTemplate === 'string' && s.promptTemplate.trim() ? s.promptTemplate.trim() : '{prompt}',
            useReferenceSlots: ['image1'],
            // Passed on, never dropped quietly: the schema or `createOrgWorkflow` answers a step `preset` with `invalid`.
            ...('preset' in s ? { preset: s.preset } : {}),
          };
        });
        const parsedRecipe = WorkflowRecipeSchema.safeParse({
          version: 1,
          guide: typeof args.guide === 'string' ? args.guide : summary,
          defaultFolderPattern: `${title.slice(0, 28)} · {subject}`,
          consistencyCheck: category === 'character' ? 'character_sheet' : 'none',
          slots: [
            { key: 'image1', kind: 'image_ref', label: '기준 이미지 (@image1)', required: false },
            { key: 'subject', kind: 'text', label: '대상 이름', required: false, defaultValue: title.slice(0, 24) },
            { key: 'prompt', kind: 'textarea', label: '연출 지시', required: false },
            { key: 'folderName', kind: 'folder', label: '공유 폴더명', required: false },
          ],
          steps: normalizedSteps,
        });
        if (!parsedRecipe.success) return toolFailure('invalid', 'Invalid workflow steps.');
        recipe = parsedRecipe.data;
      } else {
        const brief = typeof args.brief === 'string' && args.brief.trim().length >= 4 ? args.brief.trim() : `${title} ${summary}`.trim();
        const compiled = await buildWorkflowWithAi(brief, deps.intelDeps);
        recipe = compiled.recipe;
        if (!rawCategory) category = compiled.category;
      }

      const saved = await createOrgWorkflow(deps, viewer, {
        organizationId: orgId,
        requestId: reqId(),
        title,
        summary: summary || recipe.guide.slice(0, 180),
        category,
        source: 'mcp',
        recipe,
      });
      if (!saved.ok) return toolFailure(saved.code);
      return toolSuccess({ ok: true, workflow: saved.workflow });
    }

    case 'twings_run_workflow': {
      const workflowId = typeof args.workflowId === 'string' ? args.workflowId.trim() : '';
      if (!workflowId) return toolFailure('invalid', 'workflowId is required.');
      const image1Ref =
        typeof args.imageAssetId === 'string' && args.imageAssetId.trim()
          ? { assetId: args.imageAssetId.trim() }
          : typeof args.imageOutputId === 'string' && args.imageOutputId.trim()
            ? { outputId: args.imageOutputId.trim() }
            : null;
      const video1Ref =
        typeof args.videoAssetId === 'string' && args.videoAssetId.trim()
          ? { assetId: args.videoAssetId.trim() }
          : null;
      const image2Ref =
        typeof args.image2AssetId === 'string' && args.image2AssetId.trim()
          ? { assetId: args.image2AssetId.trim() }
          : typeof args.image2OutputId === 'string' && args.image2OutputId.trim()
            ? { outputId: args.image2OutputId.trim() }
            : null;

      const res = await runWorkflow(deps, viewer, {
        organizationId: orgId,
        requestId: reqId(),
        workflowId,
        inputs: {
          image1Ref,
          image2Ref,
          video1Ref,
          subject: typeof args.subject === 'string' ? args.subject : undefined,
          prompt: typeof args.prompt === 'string' ? args.prompt : '',
          packs: Array.isArray(args.packs) ? args.packs.filter((p): p is string => typeof p === 'string') : undefined,
          folderName: typeof args.folderName === 'string' ? args.folderName : undefined,
        },
      });
      if (!res.ok) return toolFailure(res.code);
      for (const j of res.jobs) {
        if (STUDIO_JOB_OPEN_STATUSES.includes(j.status)) queuedJobIds.push(j.id);
      }
      return toolSuccess({
        ok: true,
        workflowId: res.workflowId,
        workflowSlug: res.workflowSlug,
        folder: res.folder,
        consistency: res.consistency,
        creditsRemaining: creditsLeft(res.allowance.capKrw, res.allowance.usedKrw),
        jobs: res.jobs.map((j) => ({
          id: j.id,
          kind: j.kind,
          status: j.status,
          aspect: j.aspect,
          creditsEstimate: creditsOf(j.estimateKrw),
          outputs: j.outputs.map((o) => ({ id: o.id, url: o.url, kind: o.kind })),
        })),
      });
    }

    case 'twings_list_playbooks': {
      const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
      const status = args.status === 'draft' || args.status === 'published' ? args.status : undefined;
      const playbooks = (await listOrgPlaybooks(deps.sql, orgId)).filter(
        (p) => (!status || p.status === status) && (!tag || p.tags.some((t) => t.toLowerCase() === tag)),
      );
      return toolSuccess({ ok: true, playbooks });
    }

    case 'twings_save_playbook': {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const bodyMd = typeof args.bodyMd === 'string' ? args.bodyMd : '';
      if (!title) return toolFailure('invalid', 'title is required.');
      const res = await saveOrgPlaybook(deps, viewer, {
        organizationId: orgId,
        requestId: reqId(),
        playbookId: typeof args.playbookId === 'string' && args.playbookId.trim() ? args.playbookId.trim() : undefined,
        title,
        bodyMd,
        tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [],
        injectDirector: Boolean(args.injectDirector),
        status: args.status === 'draft' ? 'draft' : 'published',
      });
      if (!res.ok) return toolFailure(res.code);
      return toolSuccess({ ok: true, playbook: res.playbook });
    }

    case 'twings_generate_image': {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
      if (!prompt) return toolFailure('invalid', 'prompt is required.');
      const model = typeof args.model === 'string' && args.model.trim() ? args.model.trim() : 'nano-banana-pro';
      const aspect = typeof args.aspect === 'string' && args.aspect.trim() ? args.aspect.trim() : model === DEFAULT_IMAGE_MODEL ? '3:4' : '4:5';
      const resolution = typeof args.resolution === 'string' && args.resolution.trim() ? args.resolution.trim() : '2K';
      const count = typeof args.count === 'number' ? Math.max(1, Math.min(4, Math.floor(args.count))) : 1;
      const references: StudioReference[] = Array.isArray(args.referenceAssetIds)
        ? args.referenceAssetIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .slice(0, 6)
            .map((assetId) => ({ assetId: assetId.trim() }))
        : [];

      const created = await createStudioJob(deps, viewer, {
        kind: 'image',
        organizationId: orgId,
        requestId: reqId(),
        model,
        prompt,
        enhance: true,
        aspect,
        resolution,
        count,
        references,
      });
      if (!created.ok) return toolFailure(created.code);
      await settleIfFake(deps, created.job.id);
      if (STUDIO_JOB_OPEN_STATUSES.includes(created.job.status) && deps.env.provider !== 'fake') {
        queuedJobIds.push(created.job.id);
      }
      const freshRows = await jobsOf(deps.sql, orgId, 10);
      const hit = (await viewsOf(deps.sql, freshRows, deps.media)).find((j) => j.id === created.job.id) ?? created.job;
      return toolSuccess({
        ok: true,
        job: {
          id: hit.id,
          status: hit.status,
          model: hit.model,
          aspect: hit.aspect,
          creditsEstimate: creditsOf(hit.estimateKrw),
          outputs: hit.outputs.map((o) => ({ id: o.id, url: o.url })),
        },
      });
    }

    case 'twings_generate_video': {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
      if (!prompt) return toolFailure('invalid', 'prompt is required.');
      const aspect = typeof args.aspect === 'string' && args.aspect.trim() ? args.aspect.trim() : '9:16';
      const resolution =
        args.resolution === '480p' || args.resolution === '1080p' || args.resolution === 'draft' ? args.resolution : '720p';
      const seconds = typeof args.seconds === 'number' ? Math.max(4, Math.min(15, Math.round(args.seconds))) : 5;
      const audio = args.audio === 'native' || args.audio === 'silent' ? args.audio : 'ambient';
      const references: StudioReference[] = Array.isArray(args.referenceAssetIds)
        ? args.referenceAssetIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .slice(0, 6)
            .map((assetId) => ({ assetId: assetId.trim() }))
        : [];

      const created = await createStudioJob(deps, viewer, {
        kind: 'video',
        organizationId: orgId,
        requestId: reqId(),
        model: DEFAULT_VIDEO_MODEL,
        prompt,
        enhance: true,
        aspect,
        resolution,
        seconds,
        audio,
        references,
      });
      if (!created.ok) return toolFailure(created.code);
      await settleIfFake(deps, created.job.id);
      if (STUDIO_JOB_OPEN_STATUSES.includes(created.job.status) && deps.env.provider !== 'fake') {
        queuedJobIds.push(created.job.id);
      }
      const freshRows = await jobsOf(deps.sql, orgId, 10);
      const hit = (await viewsOf(deps.sql, freshRows, deps.media)).find((j) => j.id === created.job.id) ?? created.job;
      return toolSuccess({
        ok: true,
        job: {
          id: hit.id,
          status: hit.status,
          model: hit.model,
          aspect: hit.aspect,
          seconds: hit.seconds,
          audio: hit.audio,
          creditsEstimate: creditsOf(hit.estimateKrw),
          outputs: hit.outputs.map((o) => ({ id: o.id, url: o.url })),
        },
      });
    }

    default:
      return toolFailure('unknown_tool', `Unknown tool: ${toolName}`);
  }
}

async function handleSingleRpc(
  ctx: McpDispatchContext,
  msg: unknown,
  queuedJobIds: string[],
): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== 'object') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const req = msg as Partial<JsonRpcRequest>;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: (req.id as string | number | null | undefined) ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 envelope' },
    };
  }

  const isNotification = req.id === undefined;
  const id = (req.id as string | number | null) ?? null;
  const params = req.params && typeof req.params === 'object' ? (req.params as Record<string, unknown>) : {};

  if (isNotification || req.method.startsWith('notifications/')) {
    return null;
  }

  switch (req.method) {
    case 'initialize': {
      const clientProto = typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      const negotiated = clientProto === '2024-11-05' ? '2024-11-05' : MCP_PROTOCOL_VERSION;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: 'twings-brand-studio',
            version: '5.0.0',
          },
        },
      };
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOL_DEFINITIONS },
      };

    case 'tools/call': {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const toolArgs =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      if (!toolName) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
      }
      const result = await callMcpTool(ctx, toolName, toolArgs, queuedJobIds);
      return { jsonrpc: '2.0', id, result };
    }

    case 'resources/list': {
      const [playbooks, customWorkflows] = await Promise.all([
        listOrgPlaybooks(ctx.deps.sql, ctx.seat.organizationId),
        listOrgWorkflows(ctx.deps.sql, ctx.seat.organizationId),
      ]);
      const resources = [
        ...playbooks.map((p) => ({
          uri: `twings://playbooks/${p.id}`,
          name: p.title,
          description: p.tags.length ? `Tags: ${p.tags.join(', ')}` : 'Team knowledge guide',
          mimeType: 'text/markdown',
        })),
        ...STARTER_WORKFLOWS.map((w) => ({
          uri: `twings://workflows/${w.slug}`,
          name: w.title,
          description: w.summary,
          mimeType: 'application/json',
        })),
        ...customWorkflows.map((w) => ({
          uri: `twings://workflows/${w.id}`,
          name: w.title,
          description: w.summary,
          mimeType: 'application/json',
        })),
      ];
      return { jsonrpc: '2.0', id, result: { resources } };
    }

    case 'resources/read': {
      const uri = typeof params.uri === 'string' ? params.uri.trim() : '';
      const playbookMatch = /^twings:\/\/playbooks\/([0-9a-f-]{36})$/i.exec(uri);
      if (playbookMatch) {
        const playbooks = await listOrgPlaybooks(ctx.deps.sql, ctx.seat.organizationId);
        const hit = playbooks.find((p) => p.id.toLowerCase() === playbookMatch[1]!.toLowerCase());
        if (!hit) {
          return { jsonrpc: '2.0', id, error: { code: -32002, message: 'Playbook resource not found' } };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: `# ${hit.title}\n\n${hit.bodyMd}`,
              },
            ],
          },
        };
      }

      const workflowMatch = /^twings:\/\/workflows\/([A-Za-z0-9:_-]{1,100})$/.exec(uri);
      if (workflowMatch) {
        const wf = await resolveWorkflowTarget(ctx.deps.sql, ctx.seat.organizationId, workflowMatch[1]!);
        if (!wf) {
          return { jsonrpc: '2.0', id, error: { code: -32002, message: 'Workflow resource not found' } };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                // Everything the hub knows except a step's `preset` (which server-side text a starter sends).
                text: JSON.stringify({ ...wf, recipe: withoutStepPresets(wf.recipe) }, null, 2),
              },
            ],
          },
        };
      }

      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unsupported resource URI' } };
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

export async function dispatchMcpJsonRpc(ctx: McpDispatchContext, body: unknown): Promise<McpDispatchResult> {
  const queuedJobIds: string[] = [];

  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > 20) {
      return {
        kind: 'json',
        queuedJobIds,
        payload: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid batch size' } },
      };
    }
    const answers: JsonRpcResponse[] = [];
    for (const item of body) {
      const res = await handleSingleRpc(ctx, item, queuedJobIds);
      if (res) answers.push(res);
    }
    if (answers.length === 0) return { kind: 'accepted', queuedJobIds };
    return { kind: 'json', payload: answers, queuedJobIds };
  }

  const res = await handleSingleRpc(ctx, body, queuedJobIds);
  if (!res) return { kind: 'accepted', queuedJobIds };
  return { kind: 'json', payload: res, queuedJobIds };
}
