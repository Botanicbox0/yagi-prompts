import { mkdtemp, rm } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// The one door to an unpaid recipe job, wrapped so every call it receives can be inspected.
vi.mock('@/lib/renders/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/renders/service')>();
  return { ...actual, createRecipeSandboxRender: vi.fn(actual.createRecipeSandboxRender) };
});
import { administerPlatform } from '@/lib/creator-platform/admin';
import { saveSelfie } from '@/lib/identity/selfie-service';
import { loadMakerDraft, makerAction, uploadMakerFile } from '@/lib/recipes/maker';
import { startReviewRenders } from '@/lib/recipes/review';
import { loadJobRecipe } from '@/lib/recipes/repo';
import { parseRecipe, type Recipe } from '@/lib/recipes/schema';
import { imageTestRecipe } from '@/lib/recipes/test-render';
import { createRecipeSandboxRender } from '@/lib/renders/service';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { saveMakerProfile } from '@/lib/makers/profile';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * Founder decision 2026-11-24 (docs/PERSONAL-STUDIO.md §0.2): "영상쪽은 테스트 생성은 없잖아. 재생성도
 * 없어 영상은. 만드는대로 무조건 credit이 나가야 함. 우리가 손해는 보면 안됨."
 *
 * A creative's test render and the studio's review render are not paid orders, so they never hand a
 * video step to the render service: the image steps run, the film is made when a buyer pays. A
 * video-only recipe cannot be tested and publishes on its uploaded example film instead.
 */

const creative = viewerOf('free'), open = { creators: true };
const selfie = { kind: 'image', source: 'user', required: true } as const;
const MUSIC = `ast_${'a'.repeat(32)}`, SCENE = `ast_${'b'.repeat(32)}`;
const still = (inputs: string[] = ['selfie'], prompt = 'A still of {{selfie}} in a neon diner at night.') =>
  ({ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs, prompt, params: { aspect: '9:16' } });
const film = (inputs: string[], prompt: string) =>
  ({ id: 'film', kind: 'video', engine: 'seedance-2.0', inputs, prompt, params: { aspect: '9:16', duration: 8, resolution: '720p' } });
const imageThenFilm = { version: 2, slots: { selfie }, steps: [still(), film(['still'], 'A slow dolly in on {{still}} in the rain.')], output: { from: 'film' } };
const filmOnly = { version: 2, slots: { selfie }, steps: [film(['selfie'], 'A slow dolly in on {{selfie}} in the rain.')], output: { from: 'film' } };
const imageOnly = { version: 2, slots: { selfie }, steps: [still()], output: { from: 'still' } };

const parsed = (raw: unknown): Recipe => {
  const checked = parseRecipe(raw);
  if (!checked.ok) throw new Error(`fixture must pass: ${JSON.stringify(checked.issues)}`);
  return checked.recipe;
};
const kinds = (recipe: Pick<Recipe, 'steps'> | null | undefined) => recipe?.steps.map((step) => step.kind) ?? null;
const png = (side = 320) => sharp({ create: { width: side, height: side, channels: 3, background: { r: 60, g: 100, b: 190 } } }).png().toBuffer().then((b) => new Uint8Array(b));
/** An MP4 header the upload sniffer accepts as a film (the file is never played here). */
const mp4 = () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const sandboxCalls = () => vi.mocked(createRecipeSandboxRender).mock.calls;

async function code(run: Promise<unknown>): Promise<string> {
  try { await run; } catch (error) { return (error as { code?: string }).code ?? String(error); }
  return 'resolved';
}

describe('imageTestRecipe — what a test or review render may run', () => {
  it('leaves an image recipe and a carousel as they are', () => {
    const image = parsed(imageOnly);
    expect(imageTestRecipe(image)).toEqual({ ok: true, recipe: image, skipped: [] });
    const carousel = parsed({ version: 2, slots: { selfie }, steps: [still(), { ...still(), id: 'still2' }], output: { frames: ['still', 'still2'] } });
    expect(imageTestRecipe(carousel)).toEqual({ ok: true, recipe: carousel, skipped: [] });
  });

  it('runs the image step of an image → film recipe and drops what only the film read', () => {
    const recipe = parsed({ ...imageThenFilm, slots: { selfie, music: { kind: 'audio', source: 'creator', asset: MUSIC } }, steps: [still(), film(['still', 'music'], 'A slow dolly in on {{still}} to {{music}}.')] });
    const plan = imageTestRecipe(recipe);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.skipped).toEqual(['film']);
    expect(kinds(plan.recipe)).toEqual(['image']);
    expect(plan.recipe.output).toEqual({ from: 'still' });
    expect(Object.keys(plan.recipe.slots)).toEqual(['selfie']);
    // The pass re-checks the stored snapshot; the trimmed recipe passes it.
    expect(parseRecipe(plan.recipe, { studio: true }).ok).toBe(true);
  });

  it('refuses a film-only recipe, and one whose image step never shows the buyer', () => {
    expect(imageTestRecipe(parsed(filmOnly))).toEqual({ ok: false, code: 'video_test_unavailable', skipped: ['film'] });
    const faceOnlyInFilm = parsed({
      version: 2, slots: { selfie, scene: { kind: 'image', source: 'creator', asset: SCENE } },
      steps: [still(['scene'], 'An empty neon diner like {{scene}} at night.'), film(['selfie', 'still'], 'The person in {{selfie}} walks into {{still}}.')],
      output: { from: 'film' },
    });
    expect(imageTestRecipe(faceOnlyInFilm)).toEqual({ ok: false, code: 'video_test_unavailable', skipped: ['film'] });
  });
});

describe('the money rule at the test, review and publish doors', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    vi.mocked(createRecipeSandboxRender).mockClear();
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-money-rule-'));
    store = createLocalRenderStore(root);
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: creative.userId, active: true, contract: 'pilot-v1', reason: 'Owner-approved invitation' });
    await saveMakerProfile(h.sql, creative.userId!, { handle: 'night_film', publicProfile: true });
  });
  afterEach(async () => { await h.close(); await rm(root, { recursive: true, force: true }); });

  const deps = () => ({ sql: h.sql, store, storage: h.storage });
  const draft = async (recipe: unknown) => {
    const id = randomUUID();
    await makerAction(deps(), creative, { action: 'save', id, title: 'Neon rain', titleKo: '네온 빗속', example: 'https://www.instagram.com/reel/abc123/', disclosure: { prompts: false, assets: false }, presentation: 'make-first', royalty: 0, recipe }, open);
    return id;
  };
  const withSelfie = async () => { await saveSelfie({ sql: h.sql, store }, creative.userId!, { bytes: await png(), mime: 'image/png', consent: true }); };
  const jobCount = async () => (await h.sql.query<{ n: number }>('select count(*)::int as n from render_jobs')).rows[0]!.n;
  const used = async (id: string) => (await loadMakerDraft(h.sql, creative, id, open))!.testRendersUsed;
  const faces = async () => [await png(300), await png(310), await png(320)].map((bytes) => ({ bytes, mime: 'image/png' as const }));
  const succeed = (renderId: string) => h.sql.query("update render_jobs set status='succeeded',result_key=$2,result_mime='image/jpeg',share_token=id::text,share_expires_at=now(),finished_at=now() where id=$1", [renderId, `${renderId}/result.jpg`]);

  it('a test of an image → film recipe queues the image step only', async () => {
    const id = await draft(imageThenFilm);
    await withSelfie();
    const result = await makerAction(deps(), creative, { action: 'test', id }, open);
    expect(result).toMatchObject({ id, skipped: ['film'] });
    const job = await loadJobRecipe(h.sql, result.renderId!);
    expect(job).toMatchObject({ purpose: 'maker_test', formatId: id });
    expect(kinds(job!.recipe)).toEqual(['image']);
    const row = (await h.sql.query<{ medium: string; engine: string; resolution: string | null }>('select medium,engine,resolution from render_jobs where id=$1', [result.renderId])).rows[0]!;
    expect(row).toEqual({ medium: 'image', engine: 'gpt-image-2', resolution: null });
    expect(await used(id)).toBe(1);
  });

  it('refuses a test of a film-only recipe before any job, without spending a test', async () => {
    const id = await draft(filmOnly);
    await withSelfie();
    expect(await code(makerAction(deps(), creative, { action: 'test', id }, open))).toBe('video_test_unavailable');
    expect(await used(id)).toBe(0);
    expect(await jobCount()).toBe(0);
    expect(sandboxCalls()).toHaveLength(0);
  });

  it('review renders run the image step only, and refuse a film-only recipe', async () => {
    const id = await draft(imageThenFilm);
    await makerAction(deps(), creative, { action: 'submit', id, rights: true }, open);
    const review = await startReviewRenders({ sql: h.sql, store, faces }, ADMIN_VIEWER, { action: 'render', id, reason: 'Face retention check' });
    expect(review.renderIds).toHaveLength(3);
    for (const renderId of review.renderIds) expect(kinds((await loadJobRecipe(h.sql, renderId))!.recipe)).toEqual(['image']);

    const filmId = await draft(filmOnly);
    await makerAction(deps(), creative, { action: 'submit', id: filmId, rights: true }, open);
    const before = await jobCount();
    expect(await code(startReviewRenders({ sql: h.sql, store, faces }, ADMIN_VIEWER, { action: 'render', id: filmId, reason: 'Face retention check' }))).toBe('video_test_unavailable');
    expect(await jobCount()).toBe(before);
  });

  it('publishes an image → film recipe after its image test succeeds', async () => {
    const id = await draft(imageThenFilm);
    const publish = () => makerAction(deps(), creative, { action: 'publish', id, rights: true }, open);
    await uploadMakerFile(deps(), creative, { formatId: id, role: 'example', bytes: mp4() }, open);
    expect(await code(publish())).toBe('test_required');
    await withSelfie();
    const { renderId } = await makerAction(deps(), creative, { action: 'test', id }, open);
    await succeed(renderId!);
    expect(await publish()).toMatchObject({ id, templateId: expect.any(String) });
  });

  it('publishes a film-only recipe on its uploaded example film, with no test render', async () => {
    const id = await draft(filmOnly);
    const publish = () => makerAction(deps(), creative, { action: 'publish', id, rights: true }, open);
    expect(await code(publish())).toBe('example_file_required');
    // An example still is not a film: the card of a film template must be the film it sells.
    await uploadMakerFile(deps(), creative, { formatId: id, role: 'example', bytes: await png(640) }, open);
    expect(await code(publish())).toBe('example_film_required');
    await uploadMakerFile(deps(), creative, { formatId: id, role: 'example', bytes: mp4() }, open);
    const published = await publish();
    expect(published).toMatchObject({ id, templateId: expect.any(String) });
    expect((await h.sql.query<{ medium: string }>('select medium from prompt_items where id=$1', [published.templateId])).rows[0]!.medium).toBe('video');
    expect(await jobCount()).toBe(0);
  });

  it('never hands a video step to the render service from a test or review door', async () => {
    await withSelfie();
    for (const recipe of [imageOnly, imageThenFilm, filmOnly]) {
      const id = await draft(recipe);
      await code(makerAction(deps(), creative, { action: 'test', id }, open));
      await makerAction(deps(), creative, { action: 'submit', id, rights: true }, open);
      await code(startReviewRenders({ sql: h.sql, store, faces }, ADMIN_VIEWER, { action: 'render', id, reason: 'Face retention check' }));
    }
    // image: 1 test + 3 review; image → film: 1 + 3; film only: none.
    expect(sandboxCalls()).toHaveLength(8);
    for (const [, input] of sandboxCalls()) expect(input.recipe.steps.filter((step) => step.kind === 'video')).toEqual([]);
  });
});

/**
 * Belt and braces. `createRecipeSandboxRender` writes a render job nobody paid for. Only the two
 * doors above may call it, each handing it the image-only recipe from `imageTestRecipe`. A new caller
 * fails here until it is added with the same guard and a case in the test above.
 */
describe('unpaid recipe jobs have exactly two doors', () => {
  const ROOT = process.cwd();
  const sources = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : sources(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
  });
  const callers = ['lib', 'app', 'components'].flatMap(sources)
    .filter((path) => readFileSync(join(ROOT, path), 'utf8').includes('createRecipeSandboxRender'))
    .map((path) => relative('.', path).replace(/\\/g, '/'))
    .sort();

  it('only the creative test and the studio review call the sandbox render', () => {
    expect(callers).toEqual(['lib/recipes/maker.ts', 'lib/recipes/review.ts', 'lib/renders/service.ts']);
  });

  it.each(['lib/recipes/maker.ts', 'lib/recipes/review.ts'])('%s passes the image-only recipe', (path) => {
    const source = readFileSync(join(ROOT, path), 'utf8');
    expect(source).toMatch(/imageTestRecipe\(/);
    const calls = [...source.matchAll(/createRecipeSandboxRender\(([^;]*?)\);/gs)].map((match) => match[1]!);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/\brecipe: test\.recipe\b/);
  });
});
