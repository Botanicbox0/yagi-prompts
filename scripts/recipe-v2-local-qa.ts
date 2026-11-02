/**
 * Local-only browser QA fixture for the maker recipe editor (docs/PLATFORM-2.0.md §7.4, §18 R1).
 * Never reads an env file, never forwards cloud credentials, never calls a provider (every "render"
 * result is a drawn image), never sends mail. Every row is synthetic and says TEST ONLY.
 *
 *   mkdir .pglite/recipe-v2-qa                                                # once (PGlite does not create parents)
 *   npx tsx scripts/db-local.ts --dir .pglite/recipe-v2-qa/data              # existing fixtures, durable
 *   node --conditions=react-server --import tsx scripts/recipe-v2-local-qa.ts seed
 *   npx tsx scripts/recipe-v2-local-qa.ts serve <maker|admin>                 # next dev on http://localhost:3109
 *
 * Seeds: an approved maker with a saved photo; a DRAFT image → film recipe with a reference file and
 * one finished test render; a SUBMITTED three-frame carousel with three finished studio review
 * renders; and a PUBLISHED maker template that shows its prompts and files, story-first.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { makeSingleConnectionRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { FIXTURE_USERS } from './fixtures';

const root = resolve(process.cwd()), qaRoot = join(root, '.pglite', 'recipe-v2-qa'), dbDir = join(qaRoot, 'data'), manifestPath = join(qaRoot, 'manifest.json');
const origin = 'http://localhost:3109';
const ROLES = ['maker', 'admin'] as const;
type Manifest = { maker: string; admin: string; draft: string; submitted: string; published: string; slug: string; createdAt: string };

const admin: Viewer = { tier: 'admin', userId: FIXTURE_USERS.admin.id, email: FIXTURE_USERS.admin.email, isAdmin: true, locale: 'ko' };
const open = { creators: true };

/** A flat drawn picture with a label — a stand-in for a product photo or a render result. */
async function drawn(label: string, color: { r: number; g: number; b: number }, width = 640, height = 800): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(${color.r},${color.g},${color.b})"/><text x="50%" y="50%" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer());
}

async function seed() {
  if (existsSync(manifestPath)) { console.log(JSON.stringify({ fixtureAlreadyExists: true, ...JSON.parse(readFileSync(manifestPath, 'utf8')) })); return; }
  if (!existsSync(dbDir)) throw Error(`Run first: npx tsx scripts/db-local.ts --dir ${dbDir}`);
  const [{ administerPlatform }, { makerAction, uploadMakerFile }, { startReviewRenders }, { approvePrompt }, { saveSelfie }, { createRecipeSandboxRender }, { createLocalRenderStore }, { parseRecipe }] = await Promise.all([
    import('@/lib/creator-platform/admin'), import('@/lib/recipes/maker'), import('@/lib/recipes/review'), import('@/lib/prompts/repo'),
    import('@/lib/identity/selfie-service'), import('@/lib/renders/service'), import('@/lib/renders/store'), import('@/lib/recipes/schema'),
  ]).catch((error: Error) => { throw Error(`${error.message}\nRun seed as: node --conditions=react-server --import tsx scripts/recipe-v2-local-qa.ts seed`); });
  const db = new PGlite({ dataDir: dbDir });
  await db.waitReady;
  try {
    const sql = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => ({ rows: (await db.query<T>(text, values as never[])).rows }));
    const store = createLocalRenderStore(), deps = { sql, store };
    const makerId = randomUUID();
    await sql.query('insert into auth.users(id) values($1)', [makerId]);
    await sql.query("insert into profiles(id,email,display_name,locale,plan,is_admin) values($1,'maker@twings.test','TEST ONLY 메이커','ko','free',false)", [makerId]);
    const maker: Viewer = { tier: 'free', userId: makerId, email: null, isAdmin: false, locale: 'ko' };
    await administerPlatform(sql, admin, { action: 'creator', id: makerId, active: true, contract: 'TEST-ONLY-NOT-A-CONTRACT', reason: 'TEST ONLY local QA' });
    const face = await readFile(join(root, 'public', 'images', 'portrait-guide', 'front-facing.webp'));
    await saveSelfie({ sql, store }, makerId, { bytes: new Uint8Array(face), mime: 'image/webp', consent: true });
    const selfie = { kind: 'image', source: 'user', required: true };
    const base = (id: string, title: string, titleKo: string, extra: Record<string, unknown> = {}) => ({ action: 'save', id, title, titleKo, example: 'https://www.instagram.com/reel/TESTONLYR2/', disclosure: { prompts: true, assets: true }, presentation: 'make-first', royalty: 1500, ...extra });
    const placeholder = { version: 2, slots: { selfie }, steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'TEST ONLY {{selfie}}', params: { aspect: '4:5' } }], output: { from: 'step1' } };
    const finish = async (renderId: string, frames: number, label: string) => {
      const keys: string[] = [];
      for (let n = 0; n < frames; n += 1) {
        const key = `${renderId}/${n === 0 ? 'result' : `result-${n + 1}`}.jpg`;
        await store.put(key, await drawn(`${label} ${n + 1}`, { r: 40 + n * 60, g: 90, b: 200 - n * 40 }), 'image/jpeg');
        keys.push(key);
      }
      await sql.query("update render_jobs set status='succeeded',attempts=1,cost_usd=0.19,cost_source='estimate',result_key=$2,result_mime='image/jpeg',result_bytes=1,share_token=id::text,share_expires_at=now()+interval '3 day',finished_at=now(),notify_status='skipped' where id=$1", [renderId, keys[0]]);
      for (const [position, key] of keys.entries()) await sql.query("insert into render_job_outputs(render_id,position,step_id,storage_key,mime,bytes) values($1,$2,$3,$4,'image/jpeg',1)", [renderId, position, `f${position + 1}`, key]);
    };

    // 1 — a draft: character sheet → film, with a product file and one finished test render.
    const draft = randomUUID();
    await makerAction(deps, maker, { ...base(draft, 'TEST ONLY Neon diner film', 'TEST ONLY 네온 다이너'), recipe: placeholder }, open);
    const product = await uploadMakerFile(deps, maker, { formatId: draft, role: 'reference', bytes: await drawn('TEST ONLY 제품', { r: 230, g: 120, b: 40 }) }, open);
    const film = {
      version: 2,
      slots: { selfie, ref1: { kind: 'image', source: 'creator', asset: product.id } },
      steps: [
        { id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'Character reference sheet of {{selfie}}: front, three-quarter and profile views on a plain grey background, soft studio light.', params: { aspect: '16:9' } },
        { id: 'step2', kind: 'video', engine: 'seedance-2.5', inputs: ['step1', 'ref1'], prompt: 'The person from {{step1}} sits in a neon-lit diner booth and lifts {{ref1}} toward the camera, slow dolly in, rain on the window.', params: { aspect: '9:16', duration: 10, resolution: '720p' } },
      ],
      output: { from: 'step2' },
    };
    await makerAction(deps, maker, { ...base(draft, 'TEST ONLY Neon diner film', 'TEST ONLY 네온 다이너', { disclosure: { prompts: true, assets: false } }), recipe: film }, open);
    const checkedFilm = parseRecipe(film);
    if (!checkedFilm.ok) throw Error(`TEST ONLY film recipe is invalid: ${JSON.stringify(checkedFilm.issues)}`);
    const test = await createRecipeSandboxRender(deps, { userId: makerId, locale: 'ko', formatId: draft, purpose: 'maker_test', recipe: checkedFilm.recipe, photo: { bytes: await drawn('TEST ONLY selfie', { r: 120, g: 120, b: 120 }), mime: 'image/jpeg' } });
    if (test.ok) { await finish(test.id, 1, 'TEST ONLY 테스트'); await sql.query('update platform_formats set test_renders_used=1 where id=$1', [draft]); }

    // 2 — submitted: a three-frame carousel with three finished studio review renders.
    const submitted = randomUUID();
    const carousel = {
      version: 2, slots: { selfie },
      steps: [1, 2, 3].map((n) => ({ id: `step${n}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Photo ${n} of a Seoul night-market photo dump: {{selfie}} ${['laughing at a tteokbokki stall', 'under paper lanterns', 'on the subway home'][n - 1]}, flash, film grain.`, params: { aspect: '4:5' } })),
      output: { frames: ['step1', 'step2', 'step3'] },
    };
    await makerAction(deps, maker, { ...base(submitted, 'TEST ONLY Night market dump', 'TEST ONLY 야시장 포토덤프', { royalty: 2000 }), recipe: carousel }, open);
    await makerAction(deps, maker, { action: 'submit', id: submitted, rights: true }, open);
    const faces = async () => Promise.all(['front-facing', 'clear-face', 'turned-face'].map(async (name) => ({ bytes: new Uint8Array(await readFile(join(root, 'public', 'images', 'portrait-guide', `${name}.webp`))), mime: 'image/webp' as const })));
    const review = await startReviewRenders({ sql, store, faces }, admin, { action: 'render', id: submitted, reason: 'TEST ONLY local QA' });
    for (const [i, id] of review.renderIds.entries()) await finish(id, 3, `TEST ONLY 검수 ${i + 1}`);

    // 3 — published: an image template that shows its prompt and file, story-first.
    const shown = randomUUID();
    await makerAction(deps, maker, { ...base(shown, 'TEST ONLY Film-camera portrait', 'TEST ONLY 필름카메라 인물', { presentation: 'story-first' }), recipe: placeholder }, open);
    const prop = await uploadMakerFile(deps, maker, { formatId: shown, role: 'reference', bytes: await drawn('TEST ONLY 소품', { r: 30, g: 140, b: 110 }) }, open);
    const portrait = {
      version: 2, slots: { selfie, ref1: { kind: 'image', source: 'creator', asset: prop.id } },
      steps: [{ id: 'step1', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie', 'ref1'], prompt: 'A 35mm film-camera portrait of {{selfie}} holding {{ref1}} by a window, late-afternoon light, Portra 400 colours, slight grain.', params: { aspect: '4:5' } }],
      output: { from: 'step1' },
    };
    await makerAction(deps, maker, { ...base(shown, 'TEST ONLY Film-camera portrait', 'TEST ONLY 필름카메라 인물', { presentation: 'story-first' }), recipe: portrait }, open);
    await makerAction(deps, maker, { action: 'submit', id: shown, rights: true }, open);
    const accepted = await administerPlatform(sql, admin, { action: 'format', id: shown, accept: true, priceKrw: 1900, reason: 'TEST ONLY local QA' });
    const slug = 'test-only-maker-recipe';
    await approvePrompt(sql, { id: accepted.id, slug, authorHandle: null, useCase: [], featured: false });

    const record: Manifest = { maker: makerId, admin: FIXTURE_USERS.admin.id, draft, submitted, published: accepted.id, slug, createdAt: new Date().toISOString() };
    await writeFile(manifestPath, JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record));
  } finally { await db.close(); }
}

function serve(role: string) {
  if (!(ROLES as readonly string[]).includes(role)) throw Error(`Use serve <${ROLES.join('|')}>.`);
  if (!existsSync(manifestPath)) throw Error('Run seed first.');
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
  for (const [key, value] of Object.entries(process.env)) if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)) env[key] = value;
  Object.assign(env, {
    NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', PLAYBOOK_MODE: 'local', STORAGE_DRIVER: 'local',
    PLAYBOOK_LOCAL_DB_DIR: dbDir, PLAYBOOK_LOCAL_DB: join(qaRoot, 'no-fallback-snapshot.tar.gz'),
    PLAYBOOK_DEV_IDENTITY: role === 'maker' ? m.maker : m.admin, TWINGS_FORMAT_CREATORS: 'on', NEXT_PUBLIC_APP_URL: origin,
  });
  const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'dev', '--hostname', 'localhost', '--port', '3109'], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  console.log(JSON.stringify({ role, urls: [`${origin}/creators/workspace`, `${origin}/creators/workspace/formats/${m.draft}`, `${origin}/creators/workspace/formats/new`, `${origin}/admin/community#format-${m.submitted}`, `${origin}/ko/t/${m.slug}`], cloudCredentialsForwarded: false }));
  child.on('exit', (code) => { process.exitCode = code ?? 0; });
}

const [command, role] = process.argv.slice(2);
if (command === 'seed') seed().catch((error) => { console.error(error); process.exitCode = 1; });
else if (command === 'serve') serve(role ?? '');
else { console.error('usage: tsx scripts/recipe-v2-local-qa.ts seed | serve <maker|admin>'); process.exitCode = 1; }
