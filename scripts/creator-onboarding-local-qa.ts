/**
 * Local-only browser QA fixture for the format creator program. Never reads an env file, never
 * forwards cloud credentials, never sends mail or calls a provider. Every row is synthetic.
 *
 *   mkdir .pglite/creator-onboarding-qa                                       # once (PGlite does not create parents)
 *   npx tsx scripts/db-local.ts --dir .pglite/creator-onboarding-qa/data   # existing fixtures, durable
 *   node --conditions=react-server --import tsx scripts/creator-onboarding-local-qa.ts seed   # program states below
 *   npx tsx scripts/creator-onboarding-local-qa.ts serve <role>               # next dev on http://localhost:3108 (open localhost, not 127.0.0.1); Ctrl+C stops it
 *
 * `seed` calls the real server-only domain modules, so it needs the `react-server` condition (the
 * `server-only` guard then resolves to its empty server build). `serve` imports none of them and must
 * NOT run with that condition: the Next child gets a whitelisted env only (no NODE_OPTIONS/execArgv).
 *
 * Roles: applicant (nothing sent), reviewing, declined, creator (formats + records), revoked, admin.
 * One server at a time: PGlite holds a lock on the data directory. Stop the server before
 * `build:local`/`start:local` so the final release loop has no .next or port conflicts.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { makeSingleConnectionRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { FIXTURE_USERS } from './fixtures';

const root = resolve(process.cwd()), qaRoot = join(root, '.pglite', 'creator-onboarding-qa'), dbDir = join(qaRoot, 'data'), manifestPath = join(qaRoot, 'manifest.json');
// localhost, not 127.0.0.1: Next on Windows reports Request.url as http://localhost:3108, and the
// production same-origin check (unchanged) refuses a JSON POST whose Origin is the IP form.
const origin = 'http://localhost:3108';
const ROLES = ['applicant', 'reviewing', 'declined', 'creator', 'revoked', 'admin'] as const;
type Role = (typeof ROLES)[number];
type Manifest = Record<Role, string> & { createdAt: string };

const admin: Viewer = { tier: 'admin', userId: FIXTURE_USERS.admin.id, email: FIXTURE_USERS.admin.email, isAdmin: true, locale: 'ko' };
const viewer = (id: string): Viewer => ({ tier: 'free', userId: id, email: null, isAdmin: false, locale: 'ko' });
const access = { applications: true }, platform = { community: false, creators: true, rewards: false };
const application = () => ({
  requestId: randomUUID(), displayName: 'TEST ONLY 템플릿 메이커', portfolioUrl: 'https://example.com/test-only-portfolio',
  samples: ['https://www.instagram.com/reel/TESTONLY01/'], mediums: ['video'], tools: 'TEST ONLY',
  message: 'TEST ONLY · 로컬 브라우저 검증용 합성 지원서입니다. 실제 메이커가 아닙니다.', rights: true, program: true,
});
const format = (title: string) => ({ action: 'format', requestId: randomUUID(), title, recipe: 'TEST ONLY · PRIVATE_RECIPE_CANARY local QA recipe, never rendered', example: 'https://www.instagram.com/reel/TESTONLY02/', medium: 'video', rights: true });

async function seed() {
  if (existsSync(manifestPath)) { console.log(JSON.stringify({ fixtureAlreadyExists: true, ...JSON.parse(readFileSync(manifestPath, 'utf8')) })); return; }
  if (!existsSync(dbDir)) throw Error(`Run first: npx tsx scripts/db-local.ts --dir ${dbDir}`);
  // Loaded here, not at the top, so `serve` never touches server-only modules.
  const domain = await Promise.all([import('@/lib/creator-platform/onboarding'), import('@/lib/creator-platform/admin'), import('@/lib/creator-platform/service'), import('@/lib/prompts/repo'), import('@/lib/renders/repo')])
    .catch((error: Error) => { throw Error(`${error.message}
Run seed as: node --conditions=react-server --import tsx scripts/creator-onboarding-local-qa.ts seed`); });
  const [{ submitCreatorApplication }, { administerPlatform }, { submitPlatform }, { approvePrompt }, { insertRenderJob }] = domain;
  const db = new PGlite({ dataDir: dbDir });
  await db.waitReady;
  try {
    const sql = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => ({ rows: (await db.query<T>(text, values as never[])).rows }));
    const ids = Object.fromEntries(ROLES.filter((r) => r !== 'admin').map((r) => [r, randomUUID()])) as Record<Exclude<Role, 'admin'>, string>;
    for (const [role, id] of Object.entries(ids)) {
      await sql.query('insert into auth.users(id) values($1)', [id]);
      await sql.query("insert into profiles(id,email,display_name,locale,plan,is_admin) values($1,$2,$3,'ko','free',false)", [id, `creator-${role}@twings.test`, `TEST ONLY ${role}`]);
    }
    for (const role of ['reviewing', 'declined', 'creator', 'revoked'] as const) await submitCreatorApplication(sql, viewer(ids[role]), application(), access);
    const appId = async (id: string) => (await sql.query<{ id: string }>('select id from platform_creator_applications where user_id=$1', [id])).rows[0]!.id;
    await administerPlatform(sql, admin, { action: 'application', id: await appId(ids.declined), decision: 'decline', note: 'TEST ONLY · 다른 사람의 얼굴로도 재현되는 예시를 보내 주세요.', reason: 'TEST ONLY local QA' });
    for (const role of ['creator', 'revoked'] as const) await administerPlatform(sql, admin, { action: 'application', id: await appId(ids[role]), decision: 'approve', contract: 'TEST-ONLY-NOT-A-CONTRACT', note: 'TEST ONLY · 승인 메모', reason: 'TEST ONLY local QA' });

    const creator = viewer(ids.creator);
    const submitted = format('TEST ONLY · 검토 중 포맷'), rejected = format('TEST ONLY · 반려된 포맷'), published = format('TEST ONLY · 공개된 포맷');
    for (const f of [rejected, published, submitted]) await submitPlatform(sql, creator, f, platform);
    await administerPlatform(sql, admin, { action: 'format', id: rejected.requestId, accept: false, note: 'TEST ONLY · 얼굴이 대부분 가려져 있어요.', reason: 'TEST ONLY local QA' });
    const accepted = await administerPlatform(sql, admin, { action: 'format', id: published.requestId, accept: true, note: 'TEST ONLY · 스튜디오 QA로 넘겼어요.', reason: 'TEST ONLY local QA' });
    await approvePrompt(sql, { id: accepted.id, slug: 'test-only-creator-format', authorHandle: null, useCase: [], featured: false });
    // Two synthetic one-time orders: one with a recorded share, one still awaiting cost evidence.
    const buyer = FIXTURE_USERS.pro.id;
    for (const settle of [true, false]) {
      const renderId = randomUUID(), paymentId = randomUUID();
      await insertRenderJob(sql, { id: renderId, userId: buyer, templateId: accepted.id, templateSlug: 'test-only-creator-format', medium: 'video', engine: 'seedance-2.0', aspect: '9:16', locale: 'ko', inputKey: null, inputMime: null });
      await sql.query("update render_jobs set status='succeeded',attempts=1,cost_usd=1,cost_source=$2,result_key='test/qa.mp4',result_mime='video/mp4',share_token=id::text,share_expires_at=now()+interval '1 day',finished_at=now() where id=$1", [renderId, settle ? 'provider_usage' : 'estimate']);
      await sql.query(`insert into billing_payments(id,user_id,environment,amount_krw,status,payment_key,template_id,template_slug,order_name,aspect,locale,render_ref,input_key,input_mime,render_id,consent_at,approved_at,expires_at)
        values($1,$2,'live',10000,'paid',$3,$4,'test-only-creator-format','TEST ONLY synthetic order','9:16','ko',$5,'private/qa.jpg','image/jpeg',$5,now(),now(),now()+interval '1 day')`, [paymentId, buyer, `TEST-ONLY-${paymentId}`, accepted.id, renderId]);
      if (settle) await administerPlatform(sql, admin, { action: 'settle', id: renderId, tax: 900, fees: 300, fx: 1000, reason: 'TEST ONLY synthetic evidence, not a real invoice' });
    }
    await administerPlatform(sql, admin, { action: 'creator', id: ids.revoked, active: false, contract: 'TEST-ONLY-NOT-A-CONTRACT', reason: 'TEST ONLY local QA' });
    const record: Manifest = { ...ids, admin: FIXTURE_USERS.admin.id, createdAt: new Date().toISOString() };
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
    PLAYBOOK_DEV_IDENTITY: m[role as Role], TWINGS_FORMAT_CREATORS: 'on', TWINGS_CREATOR_APPLICATIONS: 'on',
  });
  const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('next/dist/bin/next'), 'dev', '--hostname', 'localhost', '--port', '3108'], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  console.log(JSON.stringify({ role, identity: m[role as Role], urls: [`${origin}/ko/creators`, `${origin}/creators/apply`, `${origin}/creators/workspace`, `${origin}/admin/community#applications`], cloudCredentialsForwarded: false }));
  child.on('exit', (code) => { process.exitCode = code ?? 0; });
}

const [command, role] = process.argv.slice(2);
if (command === 'seed') seed().catch((error) => { console.error(error); process.exitCode = 1; });
else if (command === 'serve') serve(role ?? '');
else { console.error('usage: tsx scripts/creator-onboarding-local-qa.ts seed | serve <role>'); process.exitCode = 1; }
