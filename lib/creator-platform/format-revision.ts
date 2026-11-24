import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { quoteRecipeBase, quoteRecipeByResolution } from '@/lib/recipes/pricing';
import { MAX_STEP_PROMPT_CHARS, legacyPromptText, parseRecipe, type Recipe } from '@/lib/recipes/schema';
import { templateCardStyling, templateCompileSource } from '@/lib/template-director/compile-prompts';
import { checkLockBlock, lockBlockRefusalDetail } from '@/lib/template-director/locks';
import { checkStylingBlock, stylingBlockRefusalDetail } from '@/lib/template-director/styling';

/**
 * docs/CREATOR-PLATFORM.md "Recipe revisions of the studio's own formats (2026-11-25)" — `format.reviseRecipe`.
 *
 * 0046/0059's database guard freezes every format template's recipe: the studio must never swap, clear or disclose a
 * MAKER's recipe. A format owned by the studio's own company-payout account has no outside maker, so for those formats
 * only, migration 0192 opens one narrow door, and this module is the only code that walks through it:
 *
 *  - text only: the new recipe must be the stored one with nothing changed but the words of step `prompt`s, step
 *    `note`s and the recipe's `notes.intro` / `notes.outro` (`recipeTextOnlyDiff`) — same steps, ids, kinds, engines,
 *    inputs, slots, output, durations, resolutions, aspects, byte for byte after canonical JSON;
 *  - optimistic: the admin names the SHA-256 of the recipe they reviewed; a recipe that changed since is refused;
 *  - checked like a save: maker AND studio recipe rules (the template page reads with the maker's, the render pass with
 *    the studio's), every prompt the compile reads passes the lock and styling block checks, a styling block declared in
 *    some compiled prompts but not alike in all is refused (the card would show nothing), the price floors still hold;
 *  - never under a waiting order: refused while an order of this template is held, queued or running without its recipe
 *    snapshot (`render_job_recipes`, taken when the render pass first picks the job up);
 *  - recorded first: the `platform_audit` row (hashes and lengths, never a prompt), the `platform_format_revisions` row
 *    (the recipe exactly before and after, so a later revision can restore it), then the transaction-local setting the
 *    database guard checks — all in ONE transaction with the writes, which are read back before it commits.
 *
 * An external creative's format is refused here AND by the database, whatever the caller.
 */

export const FORMAT_REVISION_ACTION = 'format.reviseRecipe';
export const REVISION_REASON_MIN = 10;
export const REVISION_REASON_MAX = 2000;
/** The transaction-local setting 0192's guard reads (`set_config(…, true)`). */
export const FORMAT_REVISION_SETTING = 'app.format_revision';
/** The first migration of the pair; named in the refusal on a database without it. */
export const FORMAT_REVISION_MIGRATION = '0192';

// --- Canonical JSON and its hash ------------------------------------------------------------------------------------

/** JSON with every object's keys sorted (jsonb hands keys back in its own order; this does not depend on it). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The SHA-256 (hex) of a recipe's canonical JSON: what the admin reviewed, what the audit and revision record. */
export function recipeSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

// --- Text-only difference -------------------------------------------------------------------------------------------

/** The only fields whose WORDS a revision may change. Their presence (and every other byte) must stay. */
const TEXT_FIELDS: readonly RegExp[] = [/^steps\.\d+\.prompt$/, /^steps\.\d+\.note$/, /^notes\.intro$/, /^notes\.outro$/];
const isTextField = (path: string) => TEXT_FIELDS.some((re) => re.test(path));
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export type TextOnlyDiff =
  /** `changed`: the text fields whose words differ, as paths (`notes.intro`, `steps.0.prompt`), in sorted-key order. */
  | { ok: true; changed: string[] }
  /** `field`: the first path where the structure differs (`steps.1.engine`, `steps`, `(root)`). */
  | { ok: false; field: string };

function firstStructuralDifference(a: unknown, b: unknown, path: string, changed: string[]): string | null {
  if (path !== '' && isTextField(path)) {
    if (typeof a !== 'string' || typeof b !== 'string') return path;
    if (a !== b) changed.push(path);
    return null;
  }
  const here = path || '(root)';
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return here;
    for (let i = 0; i < a.length; i += 1) {
      const found = firstStructuralDifference(a[i], b[i], path ? `${path}.${i}` : String(i), changed);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return here;
    const keysA = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    const keysB = Object.keys(b).filter((k) => b[k] !== undefined).sort();
    const missing = keysA.find((k) => !keysB.includes(k)) ?? keysB.find((k) => !keysA.includes(k));
    if (missing !== undefined) return path ? `${path}.${missing}` : missing;
    for (const key of keysA) {
      const found = firstStructuralDifference(a[key], b[key], path ? `${path}.${key}` : key, changed);
      if (found) return found;
    }
    return null;
  }
  // Numbers, strings, booleans, null: equal as JSON (the canonical form below compares them the same way).
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) ? null : here;
}

/** The recipe with every text field's words blanked: two recipes are text-only variants iff these are byte-equal. */
function blankText(value: unknown, path = ''): unknown {
  if (path !== '' && isTextField(path)) return typeof value === 'string' ? '' : value;
  if (Array.isArray(value)) return value.map((item, i) => blankText(item, path ? `${path}.${i}` : String(i)));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, blankText(item, path ? `${path}.${key}` : key)]));
  }
  return value;
}

/**
 * Whether `next` differs from `old` ONLY in the words of step `prompt`/`note` and `notes.intro`/`notes.outro` (a field
 * present in one and absent in the other is a structural change). Pure; both arguments are raw JSON values.
 */
export function recipeTextOnlyDiff(old: unknown, next: unknown): TextOnlyDiff {
  if (!isPlainObject(old) || !isPlainObject(next)) return { ok: false, field: '(root)' };
  const changed: string[] = [];
  const field = firstStructuralDifference(old, next, '', changed);
  if (field !== null) return { ok: false, field };
  // Belt and braces: the walk above and the canonical comparison must agree.
  if (canonicalJson(blankText(old)) !== canonicalJson(blankText(next))) return { ok: false, field: '(root)' };
  return { ok: true, changed };
}

// --- Schema --------------------------------------------------------------------------------------------------------

/**
 * True only when migration 0192 is there: the revision table AND the guard that reads the setting. Quietly false on an
 * older or unreadable database; nothing else in the app looks for these objects.
 */
export async function formatRevisionSchemaReady(sql: SqlRunner): Promise<boolean> {
  try {
    const { rows } = await sql.query<{ revisions: string | null; guard: boolean }>(
      `select to_regclass('public.platform_format_revisions')::text as revisions,
              exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'platform_private_format'
                        and p.prosrc like '%app.format_revision%') as guard`,
    );
    return Boolean(rows[0]?.revisions && rows[0].guard === true);
  } catch {
    return false;
  }
}

// --- The operation ---------------------------------------------------------------------------------------------------

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const StepId = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/);

/**
 * Either the full new recipe (`recipe`, a JSON value — the import path, scripts, tests) or new words for some steps'
 * prompts (`prompts`, the admin panel's textareas) laid on the reviewed recipe. Exactly one.
 */
export const ReviseRecipeInput = z
  .object({
    id: z.string().uuid(),
    reviewedSha256: Sha256,
    reason: z.string().trim().min(REVISION_REASON_MIN).max(REVISION_REASON_MAX),
    recipe: z.unknown().optional(),
    prompts: z.record(StepId, z.string().max(MAX_STEP_PROMPT_CHARS * 2)).optional(),
  })
  .strict()
  .refine((input) => (input.recipe === undefined) !== (input.prompts === undefined), { message: 'recipe or prompts, exactly one' });
export type ReviseRecipeInput = z.infer<typeof ReviseRecipeInput>;

export type RevisionRefusalCode =
  | 'schema_missing'
  | 'not_found'
  | 'not_format'
  | 'not_accepted'
  | 'not_company'
  | 'no_recipe'
  | 'stale'
  | 'unknown_step'
  | 'structural'
  | 'unchanged'
  | 'recipe_maker'
  | 'recipe_studio'
  | 'locks'
  | 'styling'
  | 'styling_partial'
  | 'price_floor'
  | 'price_floor_1080'
  | 'pending_jobs'
  | 'verify_failed'
  | 'trigger_refused';

export type RevisionResult =
  | { ok: true; slug: string; revisionId: string; auditId: string; changed: string[]; afterSha256: string }
  | { ok: false; code: RevisionRefusalCode; detail?: string };

/** `formatRevision:<code>[ <detail>]` — the admin outcome's detail; the panel says it in the admin's language. */
export function revisionRefusalDetail(result: Extract<RevisionResult, { ok: false }>): string {
  return `formatRevision:${result.code}${result.detail ? ` ${result.detail}` : ''}`.slice(0, 600);
}

/** Reads `formatRevision:<code>[ <detail>]` back (the page's banner note). */
export function readRevisionRefusal(detail: string | null | undefined): { code: RevisionRefusalCode; detail: string } | null {
  const match = /^formatRevision:([a-z_0-9]+)(?: ([\s\S]*))?$/.exec(detail ?? '');
  return match ? { code: match[1] as RevisionRefusalCode, detail: match[2] ?? '' } : null;
}

const refuse = (code: RevisionRefusalCode, detail?: string): Extract<RevisionResult, { ok: false }> =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail: detail.slice(0, 400) };

/** Thrown inside the transaction after a write, so it rolls back; caught below and returned as a refusal. */
class RevisionAbort extends Error {
  constructor(readonly refusal: Extract<RevisionResult, { ok: false }>) {
    super(`format revision refused: ${refusal.code}`);
  }
}

const normalizeText = (text: string) => text.replace(/\r\n?/g, '\n').trim();

/** Characters of every step prompt (what the panel's history and the audit report). */
export function recipePromptChars(recipe: unknown): number {
  const steps = isPlainObject(recipe) && Array.isArray(recipe.steps) ? recipe.steps : [];
  return steps.reduce<number>((sum, step) => sum + (isPlainObject(step) && typeof step.prompt === 'string' ? step.prompt.length : 0), 0);
}

/** The new raw recipe: the full value given, or the stored one with the given steps' prompts replaced. */
function nextRecipeOf(stored: Record<string, unknown>, input: ReviseRecipeInput): { ok: true; next: unknown } | { ok: false; refusal: Extract<RevisionResult, { ok: false }> } {
  if (input.recipe !== undefined) {
    let next = input.recipe;
    if (typeof next === 'string') {
      try {
        next = JSON.parse(next);
      } catch {
        return { ok: false, refusal: refuse('structural', '(root)') };
      }
    }
    return { ok: true, next };
  }
  const next = structuredClone(stored) as { steps?: Array<Record<string, unknown>> };
  for (const [id, text] of Object.entries(input.prompts ?? {})) {
    const step = Array.isArray(next.steps) ? next.steps.find((s) => isPlainObject(s) && s.id === id) : undefined;
    if (!step) return { ok: false, refusal: refuse('unknown_step', id) };
    step.prompt = normalizeText(text);
  }
  return { ok: true, next };
}

function compiledPromptRefusal(label: string, text: string): Extract<RevisionResult, { ok: false }> | null {
  const locks = checkLockBlock(text);
  if (locks.state === 'malformed' || locks.state === 'header_typo') return refuse('locks', lockBlockRefusalDetail(label, locks.problems));
  const styling = checkStylingBlock(text);
  if (styling.state === 'malformed') return refuse('styling', stylingBlockRefusalDetail(label, styling.problems));
  return null;
}

type PromptRowState = { slug: string; prompt_text: string; recipe: unknown; cast: string | null; price_krw: number; price_1080_krw: number | null; rest: unknown };

/**
 * `format.reviseRecipe` — see the module comment. `actorId` is the admin (the dispatcher has checked `isAdmin`). Every
 * refusal writes nothing; a success writes the audit row, the revision row, `prompt_items.recipe` + `prompt_text`,
 * `platform_formats.recipe_v2` (+ the legacy `recipe` text where it holds the film prompt) in one transaction.
 */
export async function reviseFormatRecipe(sql: SqlRunner, actorId: string | null, raw: unknown): Promise<RevisionResult> {
  const parsedInput = ReviseRecipeInput.safeParse(raw);
  if (!parsedInput.success) return refuse('structural', 'input');
  const input = parsedInput.data;
  if (!(await formatRevisionSchemaReady(sql))) return refuse('schema_missing', FORMAT_REVISION_MIGRATION);

  try {
    return await sql.transaction(async (tx): Promise<RevisionResult> => {
      // 1. The template and its format, locked; the owner's payout held for the transaction.
      const { rows } = await tx.query<PromptRowState>(
        `select slug, prompt_text, to_jsonb(p.*)->'recipe' as recipe, to_jsonb(p.*)->>'cast' as cast,
                price_krw, to_jsonb(p.*)->'price_1080_krw' as price_1080_krw,
                to_jsonb(p.*) - 'recipe' - 'prompt_text' - 'updated_at' as rest
           from prompt_items p where id = $1 for update`,
        [input.id],
      );
      const row = rows[0];
      if (!row) return refuse('not_found');
      const { rows: formats } = await tx.query<{ id: string; user_id: string; status: string; recipe: string; recipe_v2: unknown }>(
        "select id, user_id, status, recipe, to_jsonb(f.*)->'recipe_v2' as recipe_v2 from platform_formats f where template_id = $1 for update",
        [input.id],
      );
      const format = formats[0];
      if (!format) return refuse('not_format');
      if (format.status !== 'accepted') return refuse('not_accepted');
      const { rows: owners } = await tx.query<{ payout: string | null }>(
        "select to_jsonb(c.*)->>'payout' as payout from platform_creators c where user_id = $1 for share",
        [format.user_id],
      );
      if (owners[0]?.payout !== 'company') return refuse('not_company');
      if (!isPlainObject(row.recipe)) return refuse('no_recipe');

      // Optimistic lock: what the admin reviewed is what is stored.
      const beforeSha256 = recipeSha256(row.recipe);
      if (beforeSha256 !== input.reviewedSha256) return refuse('stale');

      // 2–3. Text only, and both rule sets.
      const built = nextRecipeOf(row.recipe, input);
      if (!built.ok) return built.refusal;
      const next = built.next;
      const diff = recipeTextOnlyDiff(row.recipe, next);
      if (!diff.ok) return refuse('structural', diff.field);
      if (diff.changed.length === 0) return refuse('unchanged');
      const maker = parseRecipe(next);
      if (!maker.ok) return refuse('recipe_maker', maker.issues.slice(0, 4).map((i) => `${i.code}${i.step ? `(${i.step})` : ''}`).join(','));
      const studio = parseRecipe(next, { studio: true });
      if (!studio.ok) return refuse('recipe_studio', studio.issues.slice(0, 4).map((i) => `${i.code}${i.step ? `(${i.step})` : ''}`).join(','));
      const recipe: Recipe = studio.recipe;
      const promptText = legacyPromptText(recipe);

      // 4. Every prompt the compile reads: lock and styling blocks that read, and a styling the card can show.
      const cast = row.cast === 'pet' || row.cast === 'couple' ? row.cast : 'solo';
      const compiled = templateCompileSource({ promptText, recipe: next, recipeReady: true });
      for (const prompt of compiled.prompts) {
        const refused = compiledPromptRefusal(`step ${prompt.stepId ?? 'main'}`, prompt.text);
        if (refused) return refused;
      }
      const declares = compiled.prompts.some((prompt) => checkStylingBlock(prompt.text).state === 'ok');
      if (declares && templateCardStyling({ promptText, recipe: next, recipeReady: true, cast }) === null) return refuse('styling_partial');

      // 5. The price floors (text cannot move them; asserted anyway).
      const floor = quoteRecipeBase(recipe, 0).floorKrw;
      if (!(row.price_krw >= floor)) return refuse('price_floor', `${row.price_krw} < ${floor}`);
      const price1080 = Number(row.price_1080_krw ?? 0);
      const hd = quoteRecipeByResolution(recipe, 0)['1080p'];
      if (price1080 > 0 && hd && price1080 < hd.floorKrw) return refuse('price_floor_1080', `${price1080} < ${hd.floorKrw}`);

      // 6. Never under an order that has not taken its recipe snapshot yet.
      const { rows: waiting } = await tx.query<{ n: number }>(
        `select count(*)::int as n from render_jobs j
          where j.template_id = $1 and j.status in ('held','queued','running')
            and not exists (select 1 from render_job_recipes r where r.render_id = j.id)`,
        [input.id],
      );
      if (Number(waiting[0]?.n ?? 0) > 0) return refuse('pending_jobs', String(waiting[0]!.n));

      // 7. The evidence first: audit (hashes and lengths), revision (the bodies), then the guard's setting.
      const afterSha256 = recipeSha256(next);
      const auditId = randomUUID();
      const revisionId = randomUUID();
      const formatRecipeText = format.recipe !== '' && isPlainObject(row.recipe) && Array.isArray(row.recipe.steps) && isPlainObject(row.recipe.steps[0])
        && format.recipe === row.recipe.steps[0].prompt ? 'updated' : 'kept';
      const formatRecipeV2 = format.recipe_v2 === null || format.recipe_v2 === undefined ? 'absent' : 'updated';
      const steps = Array.isArray(row.recipe.steps) ? row.recipe.steps : [];
      const nextSteps = (next as { steps: unknown[] }).steps;
      const details = {
        slug: row.slug,
        formatId: format.id,
        revisionId,
        beforeSha256,
        afterSha256,
        beforeBytes: Buffer.byteLength(canonicalJson(row.recipe), 'utf8'),
        afterBytes: Buffer.byteLength(canonicalJson(next), 'utf8'),
        changed: diff.changed,
        steps: steps.map((step, i) => {
          const before = isPlainObject(step) ? step : {};
          const after = isPlainObject(nextSteps[i]) ? (nextSteps[i] as Record<string, unknown>) : {};
          return {
            id: String(before.id ?? ''),
            beforeChars: typeof before.prompt === 'string' ? before.prompt.length : 0,
            afterChars: typeof after.prompt === 'string' ? after.prompt.length : 0,
          };
        }),
        promptTextChars: { before: row.prompt_text.length, after: promptText.length },
        promptTextWasLegacy: (() => {
          const old = parseRecipe(row.recipe, { studio: true });
          return old.ok ? legacyPromptText(old.recipe) === row.prompt_text : false;
        })(),
        formatRecipeText,
        formatRecipeV2,
      };
      await tx.query(
        'insert into platform_audit (id, actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5, $6::jsonb)',
        [auditId, actorId, input.id, FORMAT_REVISION_ACTION, input.reason, JSON.stringify(details)],
      );
      await tx.query(
        `insert into platform_format_revisions (id, format_id, template_id, actor_id, audit_id, reason, before, after, before_sha256, after_sha256, prompt_text_before, prompt_text_after)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12)`,
        [revisionId, format.id, input.id, actorId, auditId, input.reason, JSON.stringify(row.recipe), JSON.stringify(next), beforeSha256, afterSha256, row.prompt_text, promptText],
      );
      await tx.query('select set_config($1, $2, true)', [FORMAT_REVISION_SETTING, auditId]);

      // 8. The writes.
      await tx.query('update prompt_items set recipe = $2::jsonb, prompt_text = $3 where id = $1', [input.id, JSON.stringify(next), promptText]);
      const firstNext = isPlainObject(nextSteps[0]) && typeof nextSteps[0].prompt === 'string' ? nextSteps[0].prompt : null;
      await tx.query(
        `update platform_formats
            set recipe_v2 = case when recipe_v2 is null then null else $2::jsonb end,
                recipe = case when $3::boolean then $4 else recipe end
          where id = $1`,
        [format.id, JSON.stringify(next), formatRecipeText === 'updated' && firstNext !== null, firstNext ?? ''],
      );
      // The setting is spent: nothing later in this transaction may lean on it.
      await tx.query('select set_config($1, $2, true)', [FORMAT_REVISION_SETTING, '']);

      // 9. Read back: the recipe is the input, the copy is the legacy text, nothing else on the row moved.
      const { rows: after } = await tx.query<{ recipe: unknown; prompt_text: string; rest: unknown }>(
        "select to_jsonb(p.*)->'recipe' as recipe, prompt_text, to_jsonb(p.*) - 'recipe' - 'prompt_text' - 'updated_at' as rest from prompt_items p where id = $1",
        [input.id],
      );
      const back = after[0];
      if (!back || canonicalJson(back.recipe) !== canonicalJson(next) || back.prompt_text !== promptText || canonicalJson(back.rest) !== canonicalJson(row.rest)) {
        throw new RevisionAbort(refuse('verify_failed', 'prompt_items'));
      }
      const { rows: formatAfter } = await tx.query<{ recipe: string; recipe_v2: unknown }>(
        "select recipe, to_jsonb(f.*)->'recipe_v2' as recipe_v2 from platform_formats f where id = $1",
        [format.id],
      );
      const fb = formatAfter[0];
      if (!fb || (formatRecipeV2 === 'updated' && canonicalJson(fb.recipe_v2) !== canonicalJson(next))
        || (formatRecipeText === 'updated' && fb.recipe !== firstNext) || (formatRecipeText === 'kept' && fb.recipe !== format.recipe)) {
        throw new RevisionAbort(refuse('verify_failed', 'platform_formats'));
      }
      return { ok: true, slug: row.slug, revisionId, auditId, changed: diff.changed, afterSha256 };
    });
  } catch (error) {
    if (error instanceof RevisionAbort) return error.refusal;
    if (error instanceof Error && error.message.includes('platform private format contract')) return refuse('trigger_refused');
    throw error;
  }
}

// --- The admin panel's view ------------------------------------------------------------------------------------------

export interface FormatRevisionView {
  formatId: string;
  /** False on a database without 0192: the panel says so and offers no form. */
  schemaReady: boolean;
  /** `recipeSha256` of the stored recipe: posted back as the optimistic lock. */
  reviewedSha256: string;
  /** The prompts the compile reads (the result steps), raw — `{{selfie}}` tokens and all — in recipe order. */
  steps: Array<{ id: string; kind: 'image' | 'video'; prompt: string }>;
  /** The last three revisions, newest first: date, reason, total step-prompt characters before and after. */
  revisions: Array<{ createdAt: string; reason: string; beforeChars: number; afterChars: number }>;
}

/**
 * What the admin template page shows in "레시피 문구 개정": null unless the template is an ACCEPTED format owned by the
 * company-payout account with a recipe the render pass reads. Never shown, never offered for a creative's format.
 */
export async function loadFormatRevisionView(sql: SqlRunner, templateId: string): Promise<FormatRevisionView | null> {
  const { rows: ready } = await sql.query<{ formats: string | null; creators: string | null }>(
    "select to_regclass('public.platform_formats')::text as formats, to_regclass('public.platform_creators')::text as creators",
  );
  if (!ready[0]?.formats || !ready[0].creators) return null;
  const { rows } = await sql.query<{ format_id: string; status: string; payout: string | null; recipe: unknown }>(
    `select f.id as format_id, f.status, to_jsonb(c.*)->>'payout' as payout, to_jsonb(p.*)->'recipe' as recipe
       from platform_formats f
       join prompt_items p on p.id = f.template_id
       left join platform_creators c on c.user_id = f.user_id
      where f.template_id = $1`,
    [templateId],
  );
  const row = rows[0];
  if (!row || row.status !== 'accepted' || row.payout !== 'company' || !isPlainObject(row.recipe)) return null;
  const checked = parseRecipe(row.recipe, { studio: true });
  if (!checked.ok) return null;
  const outputs = new Set('from' in checked.recipe.output ? [checked.recipe.output.from] : checked.recipe.output.frames);
  const rawSteps = Array.isArray(row.recipe.steps) ? row.recipe.steps : [];
  const steps = rawSteps.flatMap((step) =>
    isPlainObject(step) && typeof step.id === 'string' && outputs.has(step.id) && typeof step.prompt === 'string'
      ? [{ id: step.id, kind: step.kind === 'video' ? ('video' as const) : ('image' as const), prompt: step.prompt }]
      : [],
  );
  const schemaReady = await formatRevisionSchemaReady(sql);
  const revisions = schemaReady
    ? (
        await sql.query<{ created_at: Date | string; reason: string; before: unknown; after: unknown }>(
          'select created_at, reason, before, after from platform_format_revisions where template_id = $1 order by created_at desc, id limit 3',
          [templateId],
        )
      ).rows.map((r) => ({
        createdAt: new Date(r.created_at).toISOString(),
        reason: r.reason,
        beforeChars: recipePromptChars(r.before),
        afterChars: recipePromptChars(r.after),
      }))
    : [];
  return { formatId: row.format_id, schemaReady, reviewedSha256: recipeSha256(row.recipe), steps, revisions };
}
