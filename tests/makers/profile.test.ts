import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertPrompt } from '@/lib/prompts/repo';
import { loadPromptCatalog, promptOrigin } from '@/lib/prompts/catalog';
import {
  MakerProfileError,
  isReservedMakerHandle,
  loadMakerSettings,
  makerBioOf,
  makerHandleOf,
  makerProfilesReady,
  saveMakerProfile,
} from '@/lib/makers/profile';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { MIGRATIONS_DIR, coreMigrationFiles, glueMigrationFiles } from '../helpers/pglite';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * docs/PLATFORM-2.0.md §7.5·§14.1 — a template maker's public handle (0060). The credit on a maker
 * template follows the maker's opt-in in the database, and the public catalogue carries the handle
 * and nothing else about the person.
 */

const MAKER = FIXTURE_USERS.pro;
const OTHER = FIXTURE_USERS.free;
const TEMPLATE_ID = '7a000000-0000-4000-8000-000000000060';

async function errorCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof MakerProfileError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('maker handle and bio validation', () => {
  it('accepts 3–20 lowercase letters, digits and underscores, normalising "@" and case', () => {
    expect(makerHandleOf('jun_01')).toBe('jun_01');
    expect(makerHandleOf(' @Jun_01 ')).toBe('jun_01');
    for (const bad of ['ab', 'a'.repeat(21), 'jun-01', 'jun.01', '한글이름', 'jun 01', '', 12, null]) {
      expect(makerHandleOf(bad), String(bad)).toBeNull();
    }
    expect(isReservedMakerHandle('twings')).toBe(true);
    expect(isReservedMakerHandle('jun_01')).toBe(false);
  });

  it('keeps a bio to 200 characters, counting Korean as one each, and treats empty as none', () => {
    expect(makerBioOf('')).toEqual({ ok: true, bio: null });
    expect(makerBioOf(undefined)).toEqual({ ok: true, bio: null });
    expect(makerBioOf('가'.repeat(200))).toEqual({ ok: true, bio: '가'.repeat(200) });
    expect(makerBioOf('가'.repeat(201))).toEqual({ ok: false });
    expect(makerBioOf('line one\r\nline two')).toEqual({ ok: true, bio: 'line one\nline two' });
    expect(makerBioOf('bell\u0007')).toEqual({ ok: false });
  });
});

describe('0060 maker profiles migration', () => {
  it('is a core file with a glue partner, and both say they need cloud application', () => {
    expect(coreMigrationFiles()).toContain('0060_core_maker_profiles.sql');
    expect(glueMigrationFiles()).toContain('0143_glue_maker_profiles.sql');
    for (const file of ['0060_core_maker_profiles.sql', '0143_glue_maker_profiles.sql']) {
      expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split('\n')[0]).toMatch(/^-- CLOUD APPLICATION REQUIRED/);
    }
    const glue = readFileSync(join(MIGRATIONS_DIR, '0143_glue_maker_profiles.sql'), 'utf8');
    expect(glue).toContain('revoke all on function maker_template_handle() from public,anon,authenticated');
    expect(glue).toContain('revoke all on function maker_profile_sync() from public,anon,authenticated');
  });
});

describe('maker profile against Postgres', () => {
  let harness: PromptHarness;

  beforeAll(async () => {
    harness = await promptHarness();
    for (const user of [MAKER, OTHER]) {
      await harness.sql.query(
        `insert into platform_creators(user_id, active, contract_version) values ($1, true, 'pilot-v1')`,
        [user.id],
      );
    }
    // The accept step's shape (lib/creator-platform/admin.ts): a hidden `source='yagi'` row with the
    // maker as author and NO handle — published here so it reaches the catalogue.
    await insertPrompt(harness.sql, {
      id: TEMPLATE_ID, slug: 'maker-golden-hour', source: 'yagi', authorId: MAKER.id, authorHandle: 'should-not-stick',
      status: 'published', publishedAt: 'now', models: ['seedance-2.5'], title: 'Golden hour', titleKo: '골든 아워',
      promptText: 'PRIVATE RECIPE', textVisibility: 'hidden', media: null, useCase: [], featured: false, medium: 'video',
    });
  });
  afterAll(async () => harness.close());

  const column = async () =>
    (await harness.sql.query<{ author_handle: string | null }>('select author_handle from prompt_items where id = $1', [TEMPLATE_ID])).rows[0]!.author_handle;

  it('has the three columns, and the database refuses a malformed handle or a public profile without one', async () => {
    expect(await makerProfilesReady(harness.sql)).toBe(true);
    const { rows } = await harness.sql.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_name = 'platform_creators' and column_name in ('handle', 'public_profile', 'bio') order by column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'bio', is_nullable: 'YES', column_default: null },
      { column_name: 'handle', is_nullable: 'YES', column_default: null },
      { column_name: 'public_profile', is_nullable: 'NO', column_default: 'false' },
    ]);
    await expect(harness.sql.query(`update platform_creators set handle = 'Jun' where user_id = $1`, [MAKER.id])).rejects.toThrow();
    await expect(harness.sql.query(`update platform_creators set public_profile = true where user_id = $1`, [MAKER.id])).rejects.toThrow();
  });

  it('keeps a maker template uncredited until the maker opts in, whatever the writer passed', async () => {
    expect(await column()).toBeNull();
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    const card = catalog.video.find((item) => item.slug === 'maker-golden-hour')!;
    expect(card).toMatchObject({ origin: 'maker', authorHandle: null, makerProfile: false });
    expect(catalog.yagi.some((item) => item.slug === 'maker-golden-hour')).toBe(false);
    expect(catalog.makers).toEqual([]);
  });

  it('derives origin from source and author, never from the credit', () => {
    expect(promptOrigin({ source: 'yagi', authorId: null })).toBe('studio');
    expect(promptOrigin({ source: 'yagi', authorId: MAKER.id })).toBe('maker');
    expect(promptOrigin({ source: 'community', authorId: null })).toBe('maker');
  });

  it('validates every field on save and refuses accounts that are not active makers', async () => {
    expect(await errorCode(saveMakerProfile(harness.sql, MAKER.id, { handle: 'no', publicProfile: true }))).toBe('invalid_handle');
    expect(await errorCode(saveMakerProfile(harness.sql, MAKER.id, { handle: 'twings' }))).toBe('reserved_handle');
    expect(await errorCode(saveMakerProfile(harness.sql, MAKER.id, { handle: '', publicProfile: true }))).toBe('handle_required');
    expect(await errorCode(saveMakerProfile(harness.sql, MAKER.id, { handle: 'jun_01', bio: 'x'.repeat(201) }))).toBe('invalid_bio');
    expect(await errorCode(saveMakerProfile(harness.sql, FIXTURE_USERS.admin.id, { handle: 'admin_maker' }))).toBe('not_maker');
    expect(await loadMakerSettings(harness.sql, FIXTURE_USERS.admin.id)).toBeNull();
  });

  it('fills the credit when the profile goes public, and the catalogue carries the handle only', async () => {
    expect(await saveMakerProfile(harness.sql, MAKER.id, { handle: '@Jun_01', bio: 'AI 영상 템플릿을 만듭니다.', publicProfile: true }))
      .toEqual({ handle: 'jun_01', bio: 'AI 영상 템플릿을 만듭니다.', publicProfile: true });
    expect(await column()).toBe('jun_01');

    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    const card = catalog.video.find((item) => item.slug === 'maker-golden-hour')!;
    expect(card).toMatchObject({ origin: 'maker', authorHandle: 'jun_01', makerProfile: true });
    // The maker's own legacy community prompt (fixture `cafe-window-timelapse`) is theirs too: one
    // public identity per person, so it carries the maker handle instead of its old submission handle.
    expect(catalog.video.find((item) => item.slug === 'cafe-window-timelapse')).toMatchObject({ origin: 'maker', authorHandle: 'jun_01', makerProfile: true });
    expect(catalog.makers).toEqual([{ handle: 'jun_01', bio: 'AI 영상 템플릿을 만듭니다.', bioEn: null, templateCount: 2, openRecipeCount: 0, latestPublishedAt: catalog.makers[0]!.latestPublishedAt }]);
    expect(catalog.makers[0]!.latestPublishedAt).toBe(card.publishedAt);

    // The canary: nothing that identifies the account behind the handle leaves the loader.
    const serialised = JSON.stringify(catalog);
    for (const secret of [MAKER.id, MAKER.email, 'authorId', 'author_id', 'userId', 'user_id', 'contract', 'PRIVATE RECIPE']) {
      expect(serialised.includes(secret), secret).toBe(false);
    }
    for (const maker of catalog.makers) expect(Object.keys(maker).sort()).toEqual(['bio', 'bioEn', 'handle', 'latestPublishedAt', 'openRecipeCount', 'templateCount']);
  });

  it('keeps handles unique across makers', async () => {
    expect(await errorCode(saveMakerProfile(harness.sql, OTHER.id, { handle: 'JUN_01' }))).toBe('handle_taken');
    expect(await saveMakerProfile(harness.sql, OTHER.id, { handle: 'hana_makes' })).toMatchObject({ handle: 'hana_makes', publicProfile: false });
    await expect(harness.sql.query(`update platform_creators set handle = 'jun_01' where user_id = $1`, [OTHER.id])).rejects.toThrow();
  });

  it('clears the credit when the profile goes private, and again when the maker is revoked', async () => {
    await saveMakerProfile(harness.sql, MAKER.id, { handle: 'jun_01', publicProfile: false });
    expect(await column()).toBeNull();
    expect((await loadPromptCatalog(harness.sql, { publicUrl: () => null })).makers).toEqual([]);

    await saveMakerProfile(harness.sql, MAKER.id, { handle: 'jun_01', publicProfile: true });
    expect(await column()).toBe('jun_01');
    await harness.sql.query('update platform_creators set active = false where user_id = $1', [MAKER.id]);
    expect(await column()).toBeNull();
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    expect(catalog.makers).toEqual([]);
    expect(catalog.video.find((item) => item.slug === 'maker-golden-hour')).toMatchObject({ authorHandle: null, makerProfile: false });
    // A revoked maker cannot edit a profile that is no longer shown.
    expect(await errorCode(saveMakerProfile(harness.sql, MAKER.id, { handle: 'jun_01', publicProfile: true }))).toBe('not_maker');
  });

  it('leaves a legacy community credit alone', async () => {
    const { rows } = await harness.sql.query<{ author_handle: string | null }>(
      `select author_handle from prompt_items where slug = 'skate-park-golden-hour'`,
    );
    expect(rows[0]!.author_handle).toBe('hana');
  });
});
