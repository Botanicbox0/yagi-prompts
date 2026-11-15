import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import type { RenderStore } from '@/lib/renders/store';
import type { StorageDriver } from '@/lib/storage';
import { demand, PlatformError } from '@/lib/creator-platform/contract';
import { approvedCreator, lockUser } from '@/lib/creator-platform/service';
import { canonicalPost } from '@/lib/creator-platform/social';
import { currentSelfie, savedSelfiePhoto } from '@/lib/identity/selfie-service';
import { createRecipeSandboxRender } from '@/lib/renders/service';
import { listMakerFiles, storeMakerFile, deleteMakerFiles, type MakerAsset } from './assets';
import { isRoyalty, quoteRecipeBase, ROYALTY_DEFAULT_KRW } from './pricing';
import { parseDisclosure, parsePresentation, recipeSchemaReady, type Disclosure, type Presentation } from './repo';
import { MAX_RECIPE_BYTES, parseRecipe, recipeCast, recipeMedium, type Recipe, type RecipeIssue, type RecipeMedium } from './schema';
import { selfPublishFormat, selfPublishOpen } from './self-publish';
import { parseVideoKeyframes, type VideoKeyframe } from '@/lib/prompts/keyframes';

/**
 * The maker editor's server half (`/creators/workspace/formats/new`, docs/PLATFORM-2.0.md §7.4).
 *
 *   save    a draft: title, recipe (any shape the editor holds mid-edit, bounded), example, page
 *           choices and the requested royalty. Only the owner's own draft changes.
 *   files   reference files and an uploaded example attach to a draft (lib/recipes/assets.ts).
 *   test    a test render with the maker's OWN saved photo — at most MAKER_TEST_RENDERS a format,
 *           counted in the same transaction that writes the job. TWINGS pays; the cost is recorded.
 *   submit  draft → submitted, after every recipe rule, the files check (each handle is this
 *           format's own reference file), the example and the rights confirmation.
 *
 * Every entry demands a signed-in, APPROVED supplier with the open supplier flag and 0059 applied.
 * Status, reviewer, price and template id are never read from a request.
 */

export const MAKER_TEST_RENDERS = 3;
export const MAKER_DRAFTS_PER_DAY = 3;

const Title = z.string().trim().min(3).max(120);
const Optional = z.string().trim().max(120).optional();
const DisclosureInput = z.object({ prompts: z.boolean(), assets: z.boolean() }).strict();
export const MakerSaveInput = z.object({
  action: z.literal('save'),
  id: z.uuid(),
  title: Title,
  titleKo: Optional,
  recipe: z.unknown(),
  example: z.string().trim().max(2048).default(''),
  disclosure: DisclosureInput,
  presentation: z.enum(['make-first', 'story-first']),
  royalty: z.number().int(),
  revisionOf: z.uuid().optional(),
}).strict();
export const MakerActionInput = z.discriminatedUnion('action', [
  MakerSaveInput,
  z.object({ action: z.literal('submit'), id: z.uuid(), rights: z.literal(true) }).strict(),
  // §20.6: the creative publishes it themself — no studio review, the machine checks instead.
  z.object({ action: z.literal('publish'), id: z.uuid(), rights: z.literal(true) }).strict(),
  z.object({ action: z.literal('test'), id: z.uuid(), selfieId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('deleteFile'), id: z.uuid(), file: z.string().regex(/^ast_[0-9a-f]{32}$/) }).strict(),
]);
export type MakerActionInput = z.infer<typeof MakerActionInput>;

export interface MakerAccess { creators: boolean }

export class RecipeRejected extends PlatformError {
  constructor(readonly issues: RecipeIssue[]) { super('recipe_invalid'); }
}

async function makerGate(sql: SqlRunner, viewer: Viewer, access: MakerAccess): Promise<string> {
  demand(viewer.userId, 'sign_in_required');
  demand(access.creators, 'not_open');
  demand(await recipeSchemaReady(sql), 'not_open');
  demand(await approvedCreator(sql, viewer.userId), 'forbidden');
  return viewer.userId;
}

interface DraftRow { id: string; user_id: string; status: string; title: string; title_ko: string | null; recipe_v2: unknown; example_url: string | null; disclosure: unknown; presentation: string; royalty_krw: number | null; test_renders_used: number; revision_of: string | null; review_note?: string | null; medium: 'image' | 'video' }

async function ownFormat(sql: SqlRunner, userId: string, id: string, lock = false): Promise<DraftRow> {
  const { rows } = await sql.query<DraftRow>(`select id,user_id,status,title,title_ko,recipe_v2,example_url,disclosure,presentation,royalty_krw,test_renders_used,revision_of,medium from platform_formats where id=$1${lock ? ' for update' : ''}`, [id]);
  const row = rows[0];
  // Someone else's format is "not found", never "forbidden".
  demand(row && row.user_id === userId, 'not_found');
  return row;
}

/** The full check a submission and a test render both need: the rules, then the files belong here. */
async function checkedRecipe(sql: SqlRunner, row: DraftRow): Promise<{ recipe: Recipe; medium: RecipeMedium }> {
  const checked = parseRecipe(row.recipe_v2);
  if (!checked.ok) throw new RecipeRejected(checked.issues);
  const files = new Map((await listMakerFiles(sql, row.id)).filter((file) => file.role === 'reference').map((file) => [file.id, file]));
  const issues: RecipeIssue[] = [];
  for (const [name, slot] of Object.entries(checked.recipe.slots)) {
    if (slot.source !== 'creator') continue;
    const file = files.get(slot.asset);
    if (!file || file.kind !== slot.kind) issues.push({ code: 'unknown_input', slot: name });
  }
  if (issues.length) throw new RecipeRejected(issues);
  return { recipe: checked.recipe, medium: checked.medium };
}

export async function makerAction(deps: { sql: SqlRunner; store: RenderStore; storage?: StorageDriver }, viewer: Viewer, raw: unknown, access: MakerAccess): Promise<{ id: string; renderId?: string; templateId?: string; slug?: string; priceKrw?: number }> {
  const parsed = MakerActionInput.safeParse(raw);
  demand(parsed.success, 'invalid');
  const input = parsed.data;
  const userId = await makerGate(deps.sql, viewer, access);

  if (input.action === 'save') {
    demand(isRoyalty(input.royalty), 'invalid');
    demand(Buffer.byteLength(JSON.stringify(input.recipe ?? null), 'utf8') <= MAX_RECIPE_BYTES, 'too_large');
    // A draft may be mid-edit, but it is still a version-2 object of bounded size.
    demand(input.recipe && typeof input.recipe === 'object' && !Array.isArray(input.recipe) && (input.recipe as { version?: unknown }).version === 2, 'invalid');
    const example = input.example ? canonicalPost(input.example)?.url ?? null : null;
    demand(!input.example || example, 'bad_example');
    const medium = (() => { const checked = parseRecipe(input.recipe); return checked.ok && recipeMedium(checked.recipe) === 'video' ? 'video' : 'image'; })();
    return deps.sql.transaction(async (tx) => {
      await lockUser(tx, userId);
      const old = await tx.query<{ user_id: string; status: string }>('select user_id,status from platform_formats where id=$1 for update', [input.id]);
      if (old.rows[0]) {
        demand(old.rows[0].user_id === userId, 'not_found');
        demand(old.rows[0].status === 'draft', 'conflict');
        await tx.query(`update platform_formats set title=$2,title_ko=$3,recipe_v2=$4::jsonb,example_url=$5,disclosure=$6::jsonb,presentation=$7,royalty_krw=$8,medium=$9,updated_at=now() where id=$1`,
          [input.id, input.title, input.titleKo || null, JSON.stringify(input.recipe), example, JSON.stringify(input.disclosure), input.presentation, input.royalty, medium]);
        return { id: input.id };
      }
      const count = await tx.query<{ n: number }>("select count(*)::int n from platform_formats where user_id=$1 and created_at>now()-interval '1 day'", [userId]);
      demand(count.rows[0]!.n < MAKER_DRAFTS_PER_DAY, 'rate_limited');
      if (input.revisionOf) demand((await tx.query("select id from platform_formats where id=$1 and user_id=$2 and status='rejected'", [input.revisionOf, userId])).rows.length, 'not_found');
      await tx.query(`insert into platform_formats(id,user_id,title,title_ko,recipe,recipe_v2,example_url,medium,status,disclosure,presentation,royalty_krw,revision_of)
        values($1,$2,$3,$4,'',$5::jsonb,$6,$7,'draft',$8::jsonb,$9,$10,$11)`,
        [input.id, userId, input.title, input.titleKo || null, JSON.stringify(input.recipe), example, medium, JSON.stringify(input.disclosure), input.presentation, input.royalty, input.revisionOf ?? null]);
      return { id: input.id };
    });
  }

  if (input.action === 'deleteFile') {
    return deps.sql.transaction(async (tx) => {
      const row = await ownFormat(tx, userId, input.id, true);
      demand(row.status === 'draft', 'conflict');
      const removed = (await deleteMakerFiles(tx, deps.store, input.id, 'reference', input.file)) + (await deleteMakerFiles(tx, deps.store, input.id, 'example', input.file));
      demand(removed, 'not_found');
      return { id: input.id };
    });
  }

  if (input.action === 'submit') {
    return deps.sql.transaction(async (tx) => {
      const row = await ownFormat(tx, userId, input.id, true);
      if (row.status === 'submitted') return { id: input.id };
      demand(row.status === 'draft', 'conflict');
      const { medium } = await checkedRecipe(tx, row);
      demand(row.royalty_krw !== null && isRoyalty(row.royalty_krw), 'invalid');
      const files = await listMakerFiles(tx, row.id);
      demand(row.example_url || files.some((file) => file.role === 'example'), 'example_required');
      await tx.query("update platform_formats set status='submitted',medium=$2,rights_at=now(),updated_at=now() where id=$1", [row.id, medium === 'video' ? 'video' : 'image']);
      return { id: input.id };
    });
  }

  if (input.action === 'publish') {
    demand(selfPublishOpen(), 'not_open');
    const storage = deps.storage;
    demand(storage, 'unavailable');
    return deps.sql.transaction(async (tx) => {
      const row = await ownFormat(tx, userId, input.id, true);
      // Publishing twice answers with the template it already made.
      if (row.status === 'accepted') {
        const { rows } = await tx.query<{ template_id: string; slug: string }>('select f.template_id,p.slug from platform_formats f join prompt_items p on p.id=f.template_id where f.id=$1', [row.id]);
        return { id: row.id, templateId: rows[0]?.template_id, slug: rows[0]?.slug };
      }
      demand(row.status === 'draft' || row.status === 'submitted', 'conflict');
      const { recipe } = await checkedRecipe(tx, row);
      return selfPublishFormat(tx, { store: deps.store, storage }, userId, row, recipe);
    });
  }

  // test: the maker's own saved photo through the real pipeline, at most three times a format.
  return deps.sql.transaction(async (tx) => {
    await lockUser(tx, userId);
    const row = await ownFormat(tx, userId, input.id, true);
    demand(row.status === 'draft' || row.status === 'submitted', 'conflict');
    const { recipe } = await checkedRecipe(tx, row);
    // docs/CAST-CATEGORIES.md §3: a test render sends only the maker's own selfie. A pet or couple recipe
    // also needs the pet or partner photo, so it is refused here — before a test render is counted.
    demand(recipeCast(recipe) === 'solo', 'cast_test_unavailable');
    const used = await tx.query<{ n: number }>("update platform_formats set test_renders_used=test_renders_used+1 where id=$1 and test_renders_used<$2 returning test_renders_used n", [row.id, MAKER_TEST_RENDERS]);
    demand(used.rows.length, 'test_limit');
    const selfieId = input.selfieId ?? (await currentSelfie(tx, userId))?.id;
    demand(selfieId, 'selfie_required');
    const photo = await savedSelfiePhoto(tx, deps.store, userId, selfieId);
    demand(photo, 'selfie_required');
    const created = await createRecipeSandboxRender({ sql: tx, store: deps.store }, { userId, locale: viewer.locale ?? null, formatId: row.id, purpose: 'maker_test', recipe, photo, selfieId });
    demand(created.ok, 'selfie_required');
    return { id: row.id, renderId: created.id };
  });
}

export async function uploadMakerFile(deps: { sql: SqlRunner; store: RenderStore }, viewer: Viewer, input: { formatId: string; role: 'reference' | 'example'; bytes: Uint8Array; containsPerson?: boolean }, access: MakerAccess) {
  demand(z.uuid().safeParse(input.formatId).success, 'not_found');
  const userId = await makerGate(deps.sql, viewer, access);
  return deps.sql.transaction(async (tx) => {
    const row = await ownFormat(tx, userId, input.formatId, true);
    demand(row.status === 'draft', 'conflict');
    const stored = await storeMakerFile(tx, deps.store, { formatId: row.id, userId, role: input.role, bytes: input.bytes, containsPerson: input.containsPerson });
    demand(stored.ok, stored.ok ? 'invalid' : stored.code);
    return stored.asset;
  });
}

export interface MakerTestRender { id: string; status: string; errorCode: string | null; outputs: number; createdAt: string }
export interface MakerDraft {
  id: string; status: 'draft' | 'submitted' | 'accepted' | 'rejected'; title: string; titleKo: string | null; recipe: unknown; exampleUrl: string | null;
  disclosure: Disclosure; presentation: Presentation; royaltyKrw: number; testRendersUsed: number; files: MakerAsset[]; tests: MakerTestRender[]; revisionOf: string | null;
  keyframes?: VideoKeyframe[] | null;
}

/** The editor's state for one of the viewer's own formats — the recipe goes back to its own author only. */
export async function loadMakerDraft(sql: SqlRunner, viewer: Viewer, id: string, access: MakerAccess): Promise<MakerDraft | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const userId = await makerGate(sql, viewer, access);
  try {
    const row = await ownFormat(sql, userId, id);
    let keyframes: VideoKeyframe[] | null = null;
    try {
      const { rows: kfRows } = await sql.query<{ keyframes: unknown }>(
        "select coalesce(to_jsonb(f.*)->'keyframes', 'null'::jsonb) as keyframes from platform_formats f where f.id=$1 and f.user_id=$2",
        [id, userId],
      );
      keyframes = parseVideoKeyframes(kfRows[0]?.keyframes ?? null);
    } catch {
      keyframes = null;
    }
    const tests = await sql.query<{ id: string; status: string; error_code: string | null; outputs: number; created_at: unknown }>(`select j.id,j.status,j.error_code,(select count(*)::int from render_job_outputs o where o.render_id=j.id) outputs,j.created_at
      from render_job_recipes r join render_jobs j on j.id=r.render_id where r.format_id=$1 and r.purpose='maker_test' and j.user_id=$2 order by j.created_at desc limit 10`, [id, userId]);
    return {
      id: row.id, status: row.status as MakerDraft['status'], title: row.title, titleKo: row.title_ko, recipe: row.recipe_v2, exampleUrl: row.example_url,
      disclosure: parseDisclosure(row.disclosure), presentation: parsePresentation(row.presentation), royaltyKrw: row.royalty_krw ?? ROYALTY_DEFAULT_KRW,
      testRendersUsed: row.test_renders_used, files: await listMakerFiles(sql, id), revisionOf: row.revision_of, keyframes,
      tests: tests.rows.map((t) => ({ id: t.id, status: t.status, errorCode: t.error_code, outputs: t.outputs, createdAt: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at) })),
    };
  } catch (error) {
    if (error instanceof PlatformError && error.code === 'not_found') return null;
    throw error;
  }
}

/** For the editor's price line: the floor and the proposal, never a price the maker sets. */
export function previewQuote(recipeRaw: unknown, royalty: number): ReturnType<typeof quoteRecipeBase> | null {
  const checked = parseRecipe(recipeRaw);
  return checked.ok && isRoyalty(royalty) ? quoteRecipeBase(checked.recipe, royalty) : null;
}

