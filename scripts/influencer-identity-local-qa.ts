/**
 * Local-only browser QA fixture for the SNS check (docs/qa/influencer-identity/). Never reads an env
 * file, never calls a provider or sends mail. Every row is synthetic; every screenshot is a drawn
 * fake ("hana.local", "mina.local") — no real account appears anywhere.
 *
 *   mkdir -p .pglite/influencer-qa                                          # once
 *   npx tsx scripts/db-local.ts --dir .pglite/influencer-qa/data            # the usual fixtures, durable
 *   npx tsx scripts/influencer-identity-local-qa.ts                         # the rows below
 *   PLAYBOOK_LOCAL_DB_DIR=.pglite/influencer-qa/data TWINGS_INFLUENCERS=on PORT=3016 npm run dev:free   (or dev:pro / dev:admin)
 *
 *   free   tiktok submitted (AI read 4,215 · handle match) + instagram declined → not an influencer: teaser
 *   pro    instagram confirmed 12,400 → influencer: "인플루언서 캠페인" section; youtube submitted, not read yet
 *   two recruiting campaigns: one `influencers`, one `public` (0056's columns stand in until B1 lands)
 *
 * One process at a time: PGlite holds a lock on the data directory, so stop this before `dev:*`.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { FIXTURE_USERS } from './fixtures';
import { cleanEvidence, socialEvidenceKey } from '../lib/influencers/evidence';

const root = resolve(process.cwd());
const dbDir = join(root, '.pglite', 'influencer-qa', 'data');
const storage = join(root, process.env.STORAGE_LOCAL_ROOT ?? '.storage', 'renders');

/** A phone-sized fake profile screenshot: handle, three counters, nothing real. */
export async function fakeScreenshot(handle: string, followers: string): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1100">
    <rect width="750" height="1100" fill="#ffffff"/>
    <text x="40" y="90" font-family="Arial" font-size="40" font-weight="bold" fill="#111">${handle}</text>
    <circle cx="120" cy="240" r="80" fill="#d9d9d9"/>
    <text x="300" y="230" font-family="Arial" font-size="36" font-weight="bold" fill="#111">128</text>
    <text x="300" y="275" font-family="Arial" font-size="26" fill="#444">posts</text>
    <text x="440" y="230" font-family="Arial" font-size="36" font-weight="bold" fill="#111">${followers}</text>
    <text x="440" y="275" font-family="Arial" font-size="26" fill="#444">followers</text>
    <text x="620" y="230" font-family="Arial" font-size="36" font-weight="bold" fill="#111">310</text>
    <text x="620" y="275" font-family="Arial" font-size="26" fill="#444">following</text>
    <text x="40" y="380" font-family="Arial" font-size="28" fill="#111">Local QA fixture · not a real account</text>
    <rect x="40" y="430" width="670" height="64" rx="10" fill="#efefef"/>
    <text x="300" y="472" font-family="Arial" font-size="28" fill="#111">Edit profile</text>
    ${Array.from({ length: 6 }, (_, i) => `<rect x="${(i % 3) * 250}" y="${560 + Math.floor(i / 3) * 250}" width="248" height="248" fill="${['#c7d2fe', '#bfdbfe', '#a5b4fc'][i % 3]}"/>`).join('')}
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

async function evidence(id: string, handle: string, followers: string) {
  const key = socialEvidenceKey(id);
  const path = join(storage, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await cleanEvidence(await fakeScreenshot(handle, followers), 'image/png'));
  return key;
}

async function main() {
  if (!existsSync(dbDir)) throw Error(`Run first: npx tsx scripts/db-local.ts --dir ${dbDir}`);
  const db = new PGlite({ dataDir: dbDir });
  await db.waitReady;
  try {
    // 0056 (slice B1) stand-in, exactly its column and table, until that migration is on this branch.
    await db.exec(`alter table campaigns add column if not exists audience text not null default 'public';
      create table if not exists campaign_targets (campaign_id uuid not null references campaigns(id) on delete cascade, user_id uuid not null references profiles(id) on delete cascade, invited_by uuid references profiles(id) on delete set null, invited_at timestamptz not null default now(), primary key (campaign_id, user_id));`);
    for (const [slug, audience, en, ko] of [
      ['qa-influencer-reel', 'influencers', 'Night market reel (influencers)', '야시장 릴스 (인플루언서)'],
      ['qa-open-reel', 'public', 'Cafe morning reel', '카페 아침 릴스'],
    ] as const) {
      await db.query(
        `insert into campaigns (slug, status, title, summary, host_name, host_kind, platforms, deliverable, slots, applications_close_at, post_deadline_at, published_at, payout, audience)
         values ($1, 'recruiting', $2, $3, 'Local QA Brand', 'brand', '{instagram,tiktok}', 'reel', 5, now() + interval '20 days', now() + interval '40 days', now(), '{"model":"flat","flatCents":50000,"currency":"KRW","holdDays":7}', $4)
         on conflict (slug) do update set audience = excluded.audience, status = 'recruiting'`,
        [slug, JSON.stringify({ en, ko }), JSON.stringify({ en: 'Local QA fixture campaign.', ko: '로컬 QA용 가짜 캠페인이에요.' }), audience],
      );
    }
    await db.query('delete from social_accounts where user_id = any($1::uuid[])', [[FIXTURE_USERS.free.id, FIXTURE_USERS.pro.id]]);
    const rows: Array<{ user: string; platform: string; handle: string; url: string; followers: string; extra: Record<string, unknown> }> = [
      { user: FIXTURE_USERS.free.id, platform: 'tiktok', handle: 'mina.local', url: 'https://www.tiktok.com/@mina.local', followers: '4,215',
        extra: { claimed_count: 4200, ai_state: 'done', ai_count: 4215, ai_confidence: 0.93, ai_model: 'qwen3.8:27b-bf16', ai_note: 'handle_match' } },
      { user: FIXTURE_USERS.free.id, platform: 'instagram', handle: 'mina.local', url: 'https://www.instagram.com/mina.local/', followers: '1,980',
        extra: { status: 'rejected', note: '핸들이 캡처에 보이지 않아요. 프로필 맨 위가 함께 보이게 다시 찍어 주세요.', reviewed_at: new Date(), ai_state: 'done' } },
      { user: FIXTURE_USERS.pro.id, platform: 'instagram', handle: 'hana.local', url: 'https://www.instagram.com/hana.local/', followers: '12.4K',
        extra: { status: 'verified', follower_count: 12400, measured_at: new Date(), reviewed_at: new Date(), pool_consent_at: new Date(), ai_state: 'done' } },
      { user: FIXTURE_USERS.pro.id, platform: 'youtube', handle: 'hanatv.local', url: 'https://www.youtube.com/@hanatv.local', followers: '3,050', extra: { claimed_count: 3050 } },
    ];
    for (const r of rows) {
      const id = randomUUID();
      const key = await evidence(id, `${r.platform === 'youtube' ? '@' : ''}${r.handle}`, r.followers);
      const cols = ['id', 'user_id', 'platform', 'handle', 'profile_url', 'evidence_key', ...Object.keys(r.extra)];
      const values = [id, r.user, r.platform, r.handle, r.url, key, ...Object.values(r.extra)];
      await db.query(`insert into social_accounts(${cols.join(',')}) values(${cols.map((_, i) => `$${i + 1}`).join(',')})`, values);
    }
    await db.query('update profiles set influencer_since = coalesce(influencer_since, now()) where id = $1', [FIXTURE_USERS.pro.id]);
    const fake = join(root, 'docs', 'qa', 'influencer-identity', 'fake-follower-screenshot.png');
    await mkdir(dirname(fake), { recursive: true });
    await writeFile(fake, await fakeScreenshot('hanatv.local', '3,050'));
    console.log('influencer QA fixtures written (2 campaigns, 4 linked accounts, fake screenshots)');
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('influencer-identity-local-qa.ts')) main().catch(error => { console.error(error); process.exitCode = 1; });
