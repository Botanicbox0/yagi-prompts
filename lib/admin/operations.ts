import { BRAND_PRODUCTION_OPERATIONS } from './brand-production-operations';
import { PLATFORM_OPERATIONS } from './platform-operations';
import { CAMPAIGN_RISK_OPERATIONS } from './campaign-risk-operations';
import { CAMPAIGN_COLLABORATION_OPERATIONS } from './campaign-collaboration-operations';
import { CAMPAIGN_FUNDING_OPERATIONS } from './campaign-funding-operations';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AssetRefSchema,
  BLOCK_CONTENT_SCHEMAS,
  BLOCK_KINDS,
  BlockKindSchema,
  LocalizedSchema,
  type AssetRef,
  type BlockKind,
  type Localized,
} from '@/lib/content/schemas';
import { VISIBILITY_ORDER, type Visibility } from '@/lib/content/visibility';
import {
  copyPublishManifest,
  preparePublish,
  publishRevision,
} from '@/lib/publish/pipeline';
import { notifyKindFor } from '@/lib/notify/kinds';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import { PROMPT_OPERATIONS } from './prompt-operations';
import { CONTEST_OPERATIONS } from './contest-operations';
import { CAMPAIGN_OPERATIONS } from './campaign-operations';
import { CAMPAIGN_PRODUCTION_OPERATIONS } from './campaign-production-operations';
import { BRAND_OPERATIONS } from './brand-operations';
import { BRAND_WORKSPACE_OPERATIONS } from './brand-workspace-operations';
import { BRAND_USAGE_OPERATIONS } from './brand-usage-operations';
import { stageUpload } from './assets';
import { ensureDraftRevision } from './clone';
import * as f from './form';
import { moveRow, nextOrder, normalizeOrder } from './order';
import {
  blockParents,
  hasPublishedRevision,
  playbookIdOfRevision,
  revisionIdOfStep,
} from './repo';

/**
 * PLAN §3.8 — every admin mutation, as one registry.
 *
 * Why a registry rather than twenty exported server actions: the security property the milestone
 * has to prove is "non-admin blocked from EVERY admin action" (§8 M4 acceptance). With one guarded
 * dispatcher and a registry, that is a test that enumerates the registry and cannot miss a new
 * operation — whereas twenty copies of `await requireAdmin()` are twenty chances to forget one.
 * `app/(admin)/admin/actions.ts` is the thin `'use server'` wrapper that resolves the context.
 *
 * Division of labour, kept honest:
 *   · zod validates the §6.1 payloads at this boundary (the schemas are imported, never re-declared);
 *   · the DATABASE owns immutability, locale completeness, change notes and manifest currentness —
 *     those rules are not duplicated here, their rejections are classified in `errors.ts`.
 */

// ---------------------------------------------------------------------------
// registry shape
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

export interface AdminOperation<T = unknown> {
  /** Every mutation writes; the dispatcher uses this to decide whether to re-read the catalog. */
  parse(form: FormData): ParseResult<T>;
  run(ctx: AdminContext, input: T): Promise<AdminOutcome>;
}

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, detail: issues(result.error) };
}

// ---------------------------------------------------------------------------
// shared field schemas
// ---------------------------------------------------------------------------

const Uuid = z.string().uuid();
const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase words joined by hyphens')
  .min(3)
  .max(80);
const Category = z.enum(['image', 'video', 'character', 'voice', 'music', 'pipeline']);
const Difficulty = z.enum(['beginner', 'intermediate', 'advanced']);
const VisibilityOverride = z.enum(VISIBILITY_ORDER).nullable();
const Direction = z.enum(['up', 'down']);

const NOT_FOUND_DETAIL = 'the row this form points at no longer exists';

// ---------------------------------------------------------------------------
// block content assembly (§6.1 verbatim — the form fields ARE these schemas)
// ---------------------------------------------------------------------------

export interface BlockDraftInput {
  kind: BlockKind;
  text: string;
  model: string;
  negative: string;
  rows: Array<{ k: string; v: string }>;
  caption: Localized | null;
  md: Localized;
  url: string;
  label: Localized;
  filename: string;
  format: string;
  file: File | null;
}

function readBlockDraft(form: FormData, kind: BlockKind): BlockDraftInput {
  return {
    kind,
    text: f.text(form, 'text'),
    model: f.str(form, 'model'),
    negative: f.text(form, 'negative'),
    rows: f.rows(form, 'paramKey', 'paramValue'),
    caption: f.optionalLocalized(form, 'caption'),
    md: f.localized(form, 'md'),
    url: f.str(form, 'url'),
    label: f.localized(form, 'label'),
    filename: f.str(form, 'filename'),
    format: f.str(form, 'format'),
    file: f.file(form, 'file'),
  };
}

/** The AssetRef of a block already in the database, when the author did not upload a replacement. */
function existingAssetRef(content: unknown): AssetRef | null {
  if (content === null || typeof content !== 'object') return null;
  const parsedRef = AssetRefSchema.safeParse((content as Record<string, unknown>).asset);
  return parsedRef.success ? parsedRef.data : null;
}

interface ContentBuild {
  content: Record<string, unknown>;
  /** Uploaded size, so `workflow_file.size_bytes` is measured rather than typed by hand. */
  sizeBytes: number | null;
  uploadName: string | null;
}

async function buildBlockContent(
  ctx: AdminContext,
  revisionId: string,
  input: BlockDraftInput,
  existing: unknown,
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; detail: string }> {
  let build: ContentBuild;

  switch (input.kind) {
    case 'prompt':
      build = {
        content: {
          text: input.text,
          ...(input.model === '' ? {} : { model: input.model }),
          ...(input.negative === '' ? {} : { negative: input.negative }),
        },
        sizeBytes: null,
        uploadName: null,
      };
      break;
    case 'params':
      build = { content: { rows: input.rows }, sizeBytes: null, uploadName: null };
      break;
    case 'note':
      build = { content: { md: input.md }, sizeBytes: null, uploadName: null };
      break;
    case 'link':
      build = { content: { url: input.url, label: input.label }, sizeBytes: null, uploadName: null };
      break;
    case 'asset':
    case 'workflow_file': {
      let ref = existingAssetRef(existing);
      let sizeBytes: number | null = null;
      let uploadName: string | null = null;
      if (input.file !== null) {
        const uploaded = await stageUpload(ctx.storage, revisionId, input.file);
        ref = uploaded.ref;
        sizeBytes = uploaded.sizeBytes;
        uploadName = uploaded.filename;
      }
      if (ref === null) return { ok: false, detail: 'a file is required for this block kind' };
      build =
        input.kind === 'asset'
          ? {
              content: { asset: ref, ...(input.caption === null ? {} : { caption: input.caption }) },
              sizeBytes,
              uploadName,
            }
          : {
              content: {
                asset: ref,
                filename: input.filename || uploadName || 'workflow',
                size_bytes: sizeBytes ?? existingSize(existing),
                format: input.format,
              },
              sizeBytes,
              uploadName,
            };
      break;
    }
  }

  const result = BLOCK_CONTENT_SCHEMAS[input.kind].safeParse(build.content);
  if (!result.success) return { ok: false, detail: issues(result.error) };
  return { ok: true, value: build.content };
}

function existingSize(content: unknown): number {
  if (content === null || typeof content !== 'object') return 0;
  const value = (content as Record<string, unknown>).size_bytes;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// operations
// ---------------------------------------------------------------------------

const CreatePlaybook = z.object({
  slug: Slug,
  category: Category,
  title: LocalizedSchema,
});

const createPlaybook: AdminOperation<z.infer<typeof CreatePlaybook>> = {
  parse: (form) =>
    parsed(CreatePlaybook, {
      slug: f.str(form, 'slug'),
      category: f.str(form, 'category'),
      title: f.localized(form, 'title'),
    }),
  async run(ctx, input) {
    const playbookId = randomUUID();
    const revisionId = randomUUID();
    await ctx.sql.query(
      `insert into playbooks (id, slug, status, category, sort) values ($1, $2, 'draft', $3, 0)`,
      [playbookId, input.slug, input.category],
    );
    // Summary starts empty on purpose: the publish gate (§3.9) is what forces both locales, and a
    // fabricated placeholder would satisfy it silently.
    await ctx.sql.query(
      `insert into playbook_revisions (id, playbook_id, rev_no, state, title, summary)
       values ($1, $2, 1, 'draft', $3::jsonb, $4::jsonb)`,
      [revisionId, playbookId, JSON.stringify(input.title), JSON.stringify({ en: '', ko: '' })],
    );
    return ok('created', { detail: input.slug, to: `/admin/p/${playbookId}` });
  },
};

const ArchivePlaybook = z.object({ playbookId: Uuid, archived: z.boolean() });

const archivePlaybook: AdminOperation<z.infer<typeof ArchivePlaybook>> = {
  parse: (form) =>
    parsed(ArchivePlaybook, {
      playbookId: f.str(form, 'playbookId'),
      archived: f.bool(form, 'archived'),
    }),
  async run(ctx, input) {
    /**
     * `playbooks.status` is a plain column: 0003's `guard_playbooks` only reserves
     * `published_revision_id` to the publisher role, and the M2 edge fixtures archive exactly this
     * way. So archiving needs no RPC and no migration — and the published pointer deliberately
     * SURVIVES it (§6), which is what `decideEligibility` then refuses on.
     */
    const status = input.archived
      ? 'archived'
      : // Un-archiving restores the honest status: published iff a publication still exists.
        `case when published_revision_id is null then 'draft' else 'published' end`;
    const { rows } = input.archived
      ? await ctx.sql.query<{ id: string }>(
          `update playbooks set status = 'archived' where id = $1 returning id`,
          [input.playbookId],
        )
      : await ctx.sql.query<{ id: string }>(
          `update playbooks set status = ${status} where id = $1 returning id`,
          [input.playbookId],
        );
    if (rows.length === 0) return fail('notFound', NOT_FOUND_DETAIL);
    ctx.revalidate?.();
    return ok(input.archived ? 'archived' : 'unarchived');
  },
};

const refreshCaches: AdminOperation<Record<string, never>> = {
  parse: () => ({ ok: true, value: {} }),
  async run(ctx) {
    // §3.1 "An idempotent 'Refresh caches' button exists in /admin" — the same call the publish
    // flow makes, for when an invalidation was lost and the hourly TTL floor has not run yet.
    ctx.revalidate?.();
    return ok('cachesRefreshed');
  },
};

const OpenDraft = z.object({ playbookId: Uuid });

const openDraft: AdminOperation<z.infer<typeof OpenDraft>> = {
  parse: (form) => parsed(OpenDraft, { playbookId: f.str(form, 'playbookId') }),
  async run(ctx, input) {
    const result = await ensureDraftRevision(ctx, input.playbookId);
    return ok('draftOpened', {
      detail: result.cloned ? 'cloned' : 'existing',
      to: `/admin/p/${input.playbookId}`,
    });
  },
};

const DiscardDraft = z.object({ revisionId: Uuid });

const discardDraft: AdminOperation<z.infer<typeof DiscardDraft>> = {
  parse: (form) => parsed(DiscardDraft, { revisionId: f.str(form, 'revisionId') }),
  async run(ctx, input) {
    const playbookId = await playbookIdOfRevision(ctx.sql, input.revisionId);
    if (playbookId === null) return fail('notFound', NOT_FOUND_DETAIL);
    // The 0003 guard refuses to delete anything but a draft, so this is safe to attempt blind.
    await ctx.sql.query('delete from playbook_revisions where id = $1', [input.revisionId]);
    return ok('deleted', { to: `/admin/p/${playbookId}` });
  },
};

const Metadata = z.object({
  revisionId: Uuid,
  category: Category,
  title: z.object({ en: z.string(), ko: z.string() }),
  summary: z.object({ en: z.string(), ko: z.string() }),
  changeNote: z.object({ en: z.string(), ko: z.string() }).nullable(),
  difficulty: Difficulty,
  tools: z.array(z.string().min(1)),
  models: z.array(z.string().min(1)),
  estTimeMin: z.number().int().positive().nullable(),
  estCostUsd: z.number().nonnegative().nullable(),
  isShowcase: z.boolean(),
});

const saveMetadata: AdminOperation<z.infer<typeof Metadata>> = {
  parse: (form) =>
    parsed(Metadata, {
      revisionId: f.str(form, 'revisionId'),
      category: f.str(form, 'category'),
      // Blank locales are ALLOWED while drafting — §3.9 gates on publish, not on every keystroke.
      title: f.localized(form, 'title'),
      summary: f.localized(form, 'summary'),
      changeNote: f.optionalLocalized(form, 'changeNote'),
      difficulty: f.str(form, 'difficulty'),
      tools: f.tags(form, 'tools'),
      models: f.tags(form, 'models'),
      estTimeMin: f.optionalInt(form, 'estTimeMin'),
      estCostUsd: f.optionalNumber(form, 'estCostUsd'),
      isShowcase: f.bool(form, 'isShowcase'),
    }),
  async run(ctx, input) {
    const playbookId = await playbookIdOfRevision(ctx.sql, input.revisionId);
    if (playbookId === null) return fail('notFound', NOT_FOUND_DETAIL);

    await ctx.sql.query(
      `update playbook_revisions
          set title = $2::jsonb, summary = $3::jsonb, change_note = $4::jsonb,
              difficulty = $5, tools = $6, models = $7,
              est_time_min = $8, est_cost_usd = $9, is_showcase = $10
        where id = $1`,
      [
        input.revisionId,
        JSON.stringify(input.title),
        JSON.stringify(input.summary),
        input.changeNote === null ? null : JSON.stringify(input.changeNote),
        input.difficulty,
        input.tools,
        input.models,
        input.estTimeMin,
        input.estCostUsd,
        input.isShowcase,
      ],
    );
    // Category is playbook-level (§6), not revisioned — one write, one row.
    await ctx.sql.query('update playbooks set category = $2 where id = $1', [
      playbookId,
      input.category,
    ]);
    return ok('saved');
  },
};

const HeroUpload = z.object({ revisionId: Uuid });

const saveHero: AdminOperation<z.infer<typeof HeroUpload> & { file: File | null }> = {
  parse: (form) => {
    const base = parsed(HeroUpload, { revisionId: f.str(form, 'revisionId') });
    if (!base.ok) return base;
    const file = f.file(form, 'file');
    if (file === null) return { ok: false, detail: 'file: choose an image or video to upload' };
    return { ok: true, value: { ...base.value, file } };
  },
  async run(ctx, input) {
    const uploaded = await stageUpload(ctx.storage, input.revisionId, input.file!);
    const { rows } = await ctx.sql.query<{ id: string }>(
      'update playbook_revisions set hero_asset = $2::jsonb where id = $1 returning id',
      [input.revisionId, JSON.stringify(uploaded.ref)],
    );
    if (rows.length === 0) return fail('notFound', NOT_FOUND_DETAIL);
    return ok('saved', { detail: uploaded.filename });
  },
};

const clearHero: AdminOperation<z.infer<typeof HeroUpload>> = {
  parse: (form) => parsed(HeroUpload, { revisionId: f.str(form, 'revisionId') }),
  async run(ctx, input) {
    await ctx.sql.query('update playbook_revisions set hero_asset = null where id = $1', [
      input.revisionId,
    ]);
    return ok('saved');
  },
};

const StepCreate = z.object({ revisionId: Uuid, title: LocalizedSchema });

const createStep: AdminOperation<z.infer<typeof StepCreate>> = {
  parse: (form) =>
    parsed(StepCreate, {
      revisionId: f.str(form, 'revisionId'),
      title: f.localized(form, 'title'),
    }),
  async run(ctx, input) {
    const order = await nextOrder(ctx.sql, { table: 'steps', parentId: input.revisionId });
    await ctx.sql.query(
      `insert into steps (id, revision_id, "order", title) values ($1, $2, $3, $4::jsonb)`,
      [randomUUID(), input.revisionId, order, JSON.stringify(input.title)],
    );
    return ok('created');
  },
};

const StepUpdate = z.object({
  stepId: Uuid,
  title: LocalizedSchema,
  body: z.object({ en: z.string(), ko: z.string() }).nullable(),
});

const updateStep: AdminOperation<z.infer<typeof StepUpdate>> = {
  parse: (form) =>
    parsed(StepUpdate, {
      stepId: f.str(form, 'stepId'),
      title: f.localized(form, 'title'),
      body: f.optionalLocalized(form, 'body'),
    }),
  async run(ctx, input) {
    const { rows } = await ctx.sql.query<{ id: string }>(
      'update steps set title = $2::jsonb, body = $3::jsonb where id = $1 returning id',
      [input.stepId, JSON.stringify(input.title), input.body === null ? null : JSON.stringify(input.body)],
    );
    if (rows.length === 0) return fail('notFound', NOT_FOUND_DETAIL);
    return ok('saved');
  },
};

const StepMove = z.object({ stepId: Uuid, direction: Direction });

const moveStep: AdminOperation<z.infer<typeof StepMove>> = {
  parse: (form) =>
    parsed(StepMove, { stepId: f.str(form, 'stepId'), direction: f.str(form, 'direction') }),
  async run(ctx, input) {
    const moved = await moveRow(ctx.sql, 'steps', input.stepId, input.direction);
    return moved ? ok('moved') : ok('saved');
  },
};

const StepDelete = z.object({ stepId: Uuid });

const deleteStep: AdminOperation<z.infer<typeof StepDelete>> = {
  parse: (form) => parsed(StepDelete, { stepId: f.str(form, 'stepId') }),
  async run(ctx, input) {
    const revisionId = await revisionIdOfStep(ctx.sql, input.stepId);
    if (revisionId === null) return fail('notFound', NOT_FOUND_DETAIL);
    await ctx.sql.query('delete from steps where id = $1', [input.stepId]);
    await normalizeOrder(ctx.sql, { table: 'steps', parentId: revisionId });
    return ok('deleted');
  },
};

const BlockCreate = z.object({ stepId: Uuid, kind: BlockKindSchema, visibility: VisibilityOverride });

const createBlock: AdminOperation<z.infer<typeof BlockCreate> & { draft: BlockDraftInput }> = {
  parse: (form) => {
    const base = parsed(BlockCreate, {
      stepId: f.str(form, 'stepId'),
      kind: f.str(form, 'kind'),
      visibility: f.visibility(form, 'visibility'),
    });
    if (!base.ok) return base;
    return { ok: true, value: { ...base.value, draft: readBlockDraft(form, base.value.kind) } };
  },
  async run(ctx, input) {
    const revisionId = await revisionIdOfStep(ctx.sql, input.stepId);
    if (revisionId === null) return fail('notFound', NOT_FOUND_DETAIL);

    const content = await buildBlockContent(ctx, revisionId, input.draft, null);
    if (!content.ok) return fail('invalid', content.detail);

    const order = await nextOrder(ctx.sql, { table: 'blocks', parentId: input.stepId });
    await ctx.sql.query(
      `insert into blocks (id, step_id, "order", kind, content, visibility)
       values ($1, $2, $3, $4, $5::jsonb, $6::visibility)`,
      [randomUUID(), input.stepId, order, input.kind, JSON.stringify(content.value), input.visibility],
    );
    return ok('created');
  },
};

const BlockUpdate = z.object({ blockId: Uuid, visibility: VisibilityOverride });

const updateBlock: AdminOperation<z.infer<typeof BlockUpdate> & { form: FormData }> = {
  parse: (form) => {
    const base = parsed(BlockUpdate, {
      blockId: f.str(form, 'blockId'),
      visibility: f.visibility(form, 'visibility'),
    });
    if (!base.ok) return base;
    // The kind is not editable — it comes from the row, so a forged `kind` field cannot reshape an
    // existing block into another contract.
    return { ok: true, value: { ...base.value, form } };
  },
  async run(ctx, input) {
    const parents = await blockParents(ctx.sql, input.blockId);
    if (parents === null) return fail('notFound', NOT_FOUND_DETAIL);

    const draft = readBlockDraft(input.form, parents.kind);
    const content = await buildBlockContent(ctx, parents.revisionId, draft, parents.content);
    if (!content.ok) return fail('invalid', content.detail);

    await ctx.sql.query(
      'update blocks set content = $2::jsonb, visibility = $3::visibility where id = $1',
      [input.blockId, JSON.stringify(content.value), input.visibility],
    );
    return ok('saved');
  },
};

const BlockMove = z.object({ blockId: Uuid, direction: Direction });

const moveBlock: AdminOperation<z.infer<typeof BlockMove>> = {
  parse: (form) =>
    parsed(BlockMove, { blockId: f.str(form, 'blockId'), direction: f.str(form, 'direction') }),
  async run(ctx, input) {
    const moved = await moveRow(ctx.sql, 'blocks', input.blockId, input.direction);
    return moved ? ok('moved') : ok('saved');
  },
};

const BlockDelete = z.object({ blockId: Uuid });

const deleteBlock: AdminOperation<z.infer<typeof BlockDelete>> = {
  parse: (form) => parsed(BlockDelete, { blockId: f.str(form, 'blockId') }),
  async run(ctx, input) {
    const parents = await blockParents(ctx.sql, input.blockId);
    if (parents === null) return fail('notFound', NOT_FOUND_DETAIL);
    await ctx.sql.query('delete from blocks where id = $1', [input.blockId]);
    await normalizeOrder(ctx.sql, { table: 'blocks', parentId: parents.stepId });
    return ok('deleted');
  },
};

const BlockVisibility = z.object({ blockId: Uuid, visibility: VisibilityOverride });

const setBlockVisibility: AdminOperation<z.infer<typeof BlockVisibility>> = {
  parse: (form) =>
    parsed(BlockVisibility, {
      blockId: f.str(form, 'blockId'),
      visibility: f.visibility(form, 'visibility'),
    }),
  async run(ctx, input) {
    const { rows } = await ctx.sql.query<{ id: string }>(
      'update blocks set visibility = $2::visibility where id = $1 returning id',
      [input.blockId, input.visibility],
    );
    if (rows.length === 0) return fail('notFound', NOT_FOUND_DETAIL);
    return ok('saved');
  },
};

const Overrides = z.object({
  revisionId: Uuid,
  entries: z.array(z.object({ blockId: Uuid, visibility: VisibilityOverride })),
});

/** §3.8 "inline override editing" — the whole table posts in one go. */
const saveOverrides: AdminOperation<z.infer<typeof Overrides>> = {
  parse: (form) => {
    const entries: Array<{ blockId: string; visibility: Visibility | null | undefined }> = [];
    for (const [blockId, raw] of f.prefixedEntries(form, 'v:')) {
      entries.push({ blockId, visibility: f.visibilityChoice(raw) });
    }
    return parsed(Overrides, { revisionId: f.str(form, 'revisionId'), entries });
  },
  async run(ctx, input) {
    for (const entry of input.entries) {
      await ctx.sql.query(
        `update blocks set visibility = $2::visibility
          where id = $1 and visibility is distinct from $2::visibility`,
        [entry.blockId, entry.visibility],
      );
    }
    return ok('saved', { detail: String(input.entries.length) });
  },
};

const Policy = z.object({
  entries: z.array(z.object({ kind: BlockKindSchema, visibility: z.enum(VISIBILITY_ORDER) })),
});

const savePolicy: AdminOperation<z.infer<typeof Policy>> = {
  parse: (form) => {
    const entries = BLOCK_KINDS.map((kind) => ({ kind, visibility: f.str(form, `p:${kind}`) }));
    return parsed(Policy, { entries });
  },
  async run(ctx, input) {
    for (const entry of input.entries) {
      await ctx.sql.query(
        `insert into default_policy (kind, visibility) values ($1, $2::visibility)
         on conflict (kind) do update set visibility = excluded.visibility`,
        [entry.kind, entry.visibility],
      );
    }
    // Non-retroactive by construction (§3.8): nothing published is touched, because stamped
    // `resolved_visibility` is what the read path serves.
    return ok('saved');
  },
};

const Publish = z.object({
  playbookId: Uuid,
  revisionId: Uuid,
  /**
   * `full`   — the Publish button: prepare → copy → publish, the real three-phase pipeline (§6).
   * `commit` — phase C only, offered after an explicit Prepare so the author can preview exactly
   *            what will ship and then publish THAT. It is also the only path on which the RPC's
   *            edit-after-prepare guard is reachable, which is why the mismatch message exists.
   */
  mode: z.enum(['full', 'commit']),
  /**
   * §3.5 — the M5 checkbox. It says WHETHER to notify, never which kind: `new_playbook` vs
   * `playbook_update` is a fact about the playbook (has it been published before?), derived below
   * from `published_revision_id`. A form that could assert the kind could announce a rewrite of
   * something that never shipped, or a "new playbook" for its fourth revision.
   */
  notify: z.boolean(),
});

const prepare: AdminOperation<{ revisionId: string }> = {
  parse: (form) => parsed(z.object({ revisionId: Uuid }), { revisionId: f.str(form, 'revisionId') }),
  async run(ctx, input) {
    await preparePublish(ctx.sql, input.revisionId);
    const report = await copyPublishManifest(ctx.sql, ctx.storage, input.revisionId);
    return ok('prepared', {
      detail: `${report.copied} copied, ${report.alreadyPresent} already present`,
    });
  },
};

const publish: AdminOperation<z.infer<typeof Publish>> = {
  parse: (form) =>
    parsed(Publish, {
      playbookId: f.str(form, 'playbookId'),
      revisionId: f.str(form, 'revisionId'),
      mode: f.str(form, 'mode') || 'full',
      notify: f.bool(form, 'notify'),
    }),
  async run(ctx, input) {
    if (input.mode === 'full') {
      await preparePublish(ctx.sql, input.revisionId);
      await copyPublishManifest(ctx.sql, ctx.storage, input.revisionId);
    }

    // Read the pointer BEFORE the RPC swaps it — afterwards every publication looks like a
    // republication. `notifyKindFor` is the whole rule: a playbook with no live revision can only
    // be new, one with a live revision can only be an update (and the RPC already refuses to
    // republish without a bilingual change note, so an update email always has something to say).
    const notifyKind = input.notify
      ? notifyKindFor(await hasPublishedRevision(ctx.sql, input.playbookId))
      : null;

    await publishRevision(ctx.sql, {
      playbookId: input.playbookId,
      revisionId: input.revisionId,
      notifyKind,
    });
    ctx.revalidate?.();

    const { rows } = await ctx.sql.query<{ slug: string; rev_no: number }>(
      `select p.slug, r.rev_no from playbook_revisions r
         join playbooks p on p.id = r.playbook_id where r.id = $1`,
      [input.revisionId],
    );
    const row = rows[0];
    const what = row ? `${row.slug} · rev ${row.rev_no}` : input.revisionId;
    return ok('published', {
      detail: notifyKind === null ? what : `${what} · notify ${notifyKind}`,
    });
  },
};

// ---------------------------------------------------------------------------
// the registry
// ---------------------------------------------------------------------------

export const ADMIN_OPERATIONS = {
  'caches.refresh': refreshCaches,
  'playbook.create': createPlaybook,
  'playbook.archive': archivePlaybook,
  'revision.openDraft': openDraft,
  'revision.discardDraft': discardDraft,
  'revision.metadata': saveMetadata,
  'revision.hero': saveHero,
  'revision.heroClear': clearHero,
  'revision.overrides': saveOverrides,
  'revision.prepare': prepare,
  'revision.publish': publish,
  'step.create': createStep,
  'step.update': updateStep,
  'step.move': moveStep,
  'step.delete': deleteStep,
  'block.create': createBlock,
  'block.update': updateBlock,
  'block.move': moveBlock,
  'block.delete': deleteBlock,
  'block.visibility': setBlockVisibility,
  'policy.update': savePolicy,
  // §13.2/F — the prompts surface joins the SAME registry, so the auth enumeration in
  // tests/admin/auth.test.ts covers it without being told it exists.
  ...PROMPT_OPERATIONS,
  // §14 — and so does the contests surface, for the same reason and at the same cost: one line.
  ...CONTEST_OPERATIONS,
  // docs/CAMPAIGNS.md — and the campaigns surface.
  ...CAMPAIGN_OPERATIONS,
  ...CAMPAIGN_PRODUCTION_OPERATIONS,
  // 2026-09-11 — the brand enquiries that arrive through the campaigns page.
  ...BRAND_OPERATIONS,
  ...BRAND_WORKSPACE_OPERATIONS,
  ...BRAND_USAGE_OPERATIONS,
  ...BRAND_PRODUCTION_OPERATIONS,
  ...PLATFORM_OPERATIONS,
  ...CAMPAIGN_RISK_OPERATIONS,
  ...CAMPAIGN_COLLABORATION_OPERATIONS,
  ...CAMPAIGN_FUNDING_OPERATIONS,
};

export type AdminOperationName = keyof typeof ADMIN_OPERATIONS;

export const ADMIN_OPERATION_NAMES = Object.keys(ADMIN_OPERATIONS) as AdminOperationName[];

export function isAdminOperationName(value: string): value is AdminOperationName {
  return Object.prototype.hasOwnProperty.call(ADMIN_OPERATIONS, value);
}
