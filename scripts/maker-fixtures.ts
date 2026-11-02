import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { saveMakerProfile } from '@/lib/makers/profile';
import { listMakerWorks, storeMakerAvatar, storeMakerCover, storeMakerWork } from '@/lib/makers/works';
import { createLocalRenderStore } from '@/lib/renders/store';
import { FIXTURE_USERS } from './fixtures';

/**
 * docs/PLATFORM-2.0.md §7.5·§20 — one public AI creative in the LOCAL snapshot only, so the anon
 * sweep can open a real `/{locale}/makers/{handle}` page with every part of it: name, headline,
 * place, links, tools, an email behind a button, an avatar and three works. The pro fixture already
 * authored the published community fixture `cafe-window-timelapse` as `@jun`; here that account
 * becomes an approved creative who turned their profile on, through the same functions the studio
 * uses. Never part of the base `seed()` (tests build their own) and never cloud data. Every value
 * says TEST so no screenshot can be mistaken for a real person.
 */
export const LOCAL_MAKER = {
  userId: FIXTURE_USERS.pro.id,
  handle: 'jun',
  bio: 'TEST ONLY · 로컬 검증용 AI 크리에이티브 프로필입니다.',
  displayName: 'Jun (TEST)',
  headline: 'TEST ONLY · 셀카 한 장으로 패션 필름을 만듭니다',
  publicEmail: 'jun.test@example.com',
} as const;

export const LOCAL_RECIPE_SLUG = 'neon-alley-dolly';
/** Past step 1's public opening (lib/recipes/public.ts TEASER_CHARS), so only a member ever reads it. */
export const LOCAL_RECIPE_CANARY = 'LOCAL_RECIPE_CANARY_members_only';
const LOCAL_RECIPE = {
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [
    { id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `TEST ONLY · the person in {{selfie}} under neon signs in a wet alley at night, 35mm look, rain beading on the lens, magenta and cyan signage mirrored in puddles, steam rising behind them. ${LOCAL_RECIPE_CANARY}: keep the likeness.`, note: 'TEST tip: a front-facing selfie keeps the likeness.', params: { aspect: '9:16' } },
    { id: 'film', kind: 'video', engine: 'seedance-2.5', inputs: ['still'], prompt: `${LOCAL_RECIPE_CANARY}: a slow dolly in on the person in {{still}} as the neon flickers. One take.`, params: { aspect: '9:16', duration: 10, resolution: '720p' } },
  ],
  output: { from: 'film' },
  notes: { intro: 'TEST ONLY · 셀카 → 스틸 → 10초 필름, 두 단계로 만듭니다.', outro: 'TEST ONLY · 결과를 올릴 때 @jun을 태그해 주세요.' },
};

/** Flat colour fields with a soft gradient — stand-ins for works, made here so no asset is checked in. */
function swatch(width: number, height: number, from: [number, number, number], to: [number, number, number]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgb(${from.join(',')})"/><stop offset="1" stop-color="rgb(${to.join(',')})"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-family="sans-serif" font-size="${Math.round(width / 9)}" fill="rgba(255,255,255,0.85)" text-anchor="middle">TEST</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

export async function seedMakerFixtures(sql: SqlRunner): Promise<void> {
  await sql.query(
    `insert into platform_creators(user_id, active, contract_version) values ($1, true, 'local-fixture')
     on conflict (user_id) do nothing`,
    [LOCAL_MAKER.userId],
  );
  const settings = await saveMakerProfile(sql, LOCAL_MAKER.userId, {
    handle: LOCAL_MAKER.handle, bio: LOCAL_MAKER.bio, publicProfile: true,
    displayName: LOCAL_MAKER.displayName, headline: LOCAL_MAKER.headline, country: 'KR', city: 'Seoul',
    links: ['https://example.com/jun-test-portfolio'], publicEmail: LOCAL_MAKER.publicEmail, tools: 'Seedance 2.5, GPT Image 2, Midjourney', openToBrands: true,
  });
  // One studio original shows its recipe locally (prompts disclosed, an intro), so the sweep can see
  // the members-only recipe section: the outline in the HTML, the prompt text never.
  await sql.query(
    `update prompt_items set recipe=$2::jsonb, disclosure='{"prompts":true,"assets":false}'::jsonb
      where slug=$1 and source::text='yagi' and recipe is null`,
    [LOCAL_RECIPE_SLUG, JSON.stringify(LOCAL_RECIPE)],
  );
  if (!settings.extended) return;
  const store = createLocalRenderStore();
  if (!settings.avatarVersion) await storeMakerAvatar(sql, store, LOCAL_MAKER.userId, new Uint8Array(await swatch(600, 600, [24, 24, 28], [56, 117, 197])));
  if (settings.coverReady && !settings.coverVersion) await storeMakerCover(sql, store, LOCAL_MAKER.userId, new Uint8Array(await swatch(1800, 900, [56, 117, 197], [232, 238, 246])));
  if ((await listMakerWorks(sql, LOCAL_MAKER.userId)).length === 0) {
    const works: Array<[number, number, [number, number, number], [number, number, number], string]> = [
      [960, 1200, [20, 20, 28], [92, 54, 255], 'TEST · Neon diner'],
      [1200, 900, [255, 140, 198], [18, 18, 18], 'TEST · Train at dusk'],
      [900, 1600, [10, 10, 10], [237, 30, 30], 'TEST · Lens portal'],
    ];
    for (const [w, h, from, to, title] of works) {
      await storeMakerWork(sql, store, { userId: LOCAL_MAKER.userId, bytes: new Uint8Array(await swatch(w, h, from, to)), title, caption: 'TEST ONLY — a local stand-in work.' });
    }
  }
}
