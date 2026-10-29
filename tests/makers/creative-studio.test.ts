import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn }));
import { administerPlatform } from '@/lib/creator-platform/admin';
import { creativeProfilesReady, loadMakerSettings, patchMakerProfile, saveMakerProfile } from '@/lib/makers/profile';
import {
  COVER_HEIGHT, COVER_WIDTH, WorkError, deleteMakerAvatar, deleteMakerCover, deleteMakerWork, listMakerWorks, listPublicWorks, makerMediaObject, reorderMakerWorks,
  storeMakerAvatar, storeMakerCover, storeMakerWork, updateMakerWork,
} from '@/lib/makers/works';
import { createMakerToken, listMakerTokens, resolveMakerToken, revokeMakerToken, MAKER_TOKENS_MAX } from '@/lib/makers/tokens';
import { recordRecipeOpen } from '@/lib/recipes/public';
import { loadPromptCatalog } from '@/lib/prompts/catalog';
import { handleMcp, MCP_TOOLS } from '@/lib/mcp/server';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { FIXTURE_USERS } from '../../scripts/fixtures';

/**
 * docs/PLATFORM-2.0.md §20 — the creative profile (0065) against real Postgres: the extended fields,
 * the works, avatar and cover (0071) with their visibility rule, the agent tokens, recipe opens, and the MCP
 * server that wraps all of it for a creative's own agent.
 */

const CREATIVE = viewerOf('free');
const OTHER = FIXTURE_USERS.pro;
const jpeg = (w = 640, h = 800) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 80 } } })
  .withMetadata({ exif: { IFD0: { Copyright: 'GPS-CANARY' } } }).jpeg().toBuffer().then((b) => new Uint8Array(b));

async function code(run: Promise<unknown>): Promise<string> {
  try { await run; } catch (error) { return (error as { code?: string }).code ?? String(error); }
  return 'resolved';
}

describe('AI creative studio (0065)', () => {
  let h: PromptHarness, root: string, store: RenderStore;
  beforeEach(async () => {
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-creative-'));
    store = createLocalRenderStore(root);
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: CREATIVE.userId, active: true, contract: 'pilot-v1', reason: 'Owner-approved invitation' });
  });
  afterEach(async () => { vi.unstubAllEnvs(); await h.close(); await rm(root, { recursive: true, force: true }); });

  it('saves the full profile, patches single fields, and publishes it in the catalogue', async () => {
    expect(await creativeProfilesReady(h.sql)).toBe(true);
    const saved = await saveMakerProfile(h.sql, CREATIVE.userId!, {
      handle: 'jun_films', bio: 'Fashion films from one selfie.', publicProfile: true, displayName: 'Jun Park', headline: 'AI director, fashion films',
      country: 'kr', city: 'Seoul', links: ['instagram.com/jun.films', '', 'https://jun.studio'], publicEmail: 'hello@jun.studio', tools: 'Seedance 2.5, Midjourney', openToBrands: true,
    });
    expect(saved).toMatchObject({ handle: 'jun_films', displayName: 'Jun Park', country: 'KR', city: 'Seoul', tools: ['Seedance 2.5', 'Midjourney'], openToBrands: true, extended: true });
    expect(saved.links.map((link) => link.kind)).toEqual(['instagram', 'website']);
    expect(await code(saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', country: 'XX' }))).toBe('invalid_country');
    expect(await code(saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', links: ['javascript:alert(1)'] }))).toBe('invalid_links');
    expect(await code(saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicEmail: 'nope' }))).toBe('invalid_email');

    // A patch (the MCP tool) changes only what it names.
    const patched = await patchMakerProfile(h.sql, CREATIVE.userId!, { headline: 'Director of motion' });
    expect(patched).toMatchObject({ headline: 'Director of motion', displayName: 'Jun Park', city: 'Seoul', publicProfile: true, publicEmail: 'hello@jun.studio' });

    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null });
    expect(catalog.makers).toEqual([expect.objectContaining({ handle: 'jun_films', displayName: 'Jun Park', country: 'KR', openToBrands: true, avatar: null })]);
    const serialised = JSON.stringify(catalog);
    for (const secret of [CREATIVE.userId!, CREATIVE.email!, 'user_id', 'avatar_key']) expect(serialised.includes(secret), secret).toBe(false);
  });

  it('stores works without metadata, orders them, and shows them only while the profile is public', async () => {
    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicProfile: false });
    const first = await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpeg(), title: 'Neon diner', link: 'instagram.com/p/abc' });
    expect(first.work).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 640, height: 800, title: 'Neon diner', linkUrl: 'https://instagram.com/p/abc', position: 0 });
    // Same bytes → the same work, not a copy.
    expect((await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpeg() })).unchanged).toBe(true);
    const second = (await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpeg(800, 600) })).work;
    expect(await code(storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }))).toBe('bad_file');
    expect(await code(storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpeg(), title: 'x'.repeat(81) }))).toBe('invalid');

    // What the bucket holds was re-encoded: the EXIF canary is gone.
    const object = await makerMediaObject(h.sql, CREATIVE.userId!, first.work.id);
    expect(Buffer.from(await store.read(object!.key)).includes('GPS-CANARY')).toBe(false);

    // Private profile: the creative sees their own works; nobody else does, and the public list is empty.
    expect(object).toMatchObject({ publicCache: false });
    expect(await makerMediaObject(h.sql, null, first.work.id)).toBeNull();
    expect(await makerMediaObject(h.sql, OTHER.id, first.work.id)).toBeNull();
    expect(await listPublicWorks(h.sql, 'jun_films')).toEqual([]);

    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicProfile: true });
    expect(await makerMediaObject(h.sql, null, first.work.id)).toMatchObject({ publicCache: true });
    expect((await listPublicWorks(h.sql, 'jun_films')).map((work) => work.id)).toEqual([first.work.id, second.id]);

    expect((await reorderMakerWorks(h.sql, CREATIVE.userId!, [second.id])).map((work) => work.id)).toEqual([second.id, first.work.id]);
    expect(await code(reorderMakerWorks(h.sql, OTHER.id, [second.id]))).toBe('not_found');
    expect(await updateMakerWork(h.sql, CREATIVE.userId!, second.id, { title: 'Train', caption: 'One take', link: '' })).toMatchObject({ title: 'Train', caption: 'One take', linkUrl: null });
    expect(await code(updateMakerWork(h.sql, OTHER.id, second.id, { title: 'mine now' }))).toBe('not_found');
    await deleteMakerWork(h.sql, store, CREATIVE.userId!, first.work.id);
    expect((await listMakerWorks(h.sql, CREATIVE.userId!)).map((work) => work.id)).toEqual([second.id]);
    expect(await code(deleteMakerWork(h.sql, store, CREATIVE.userId!, first.work.id))).toBe('not_found');
  });

  it('caps a creative at twelve works', async () => {
    for (let i = 0; i < 12; i++) await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpeg(64 + i, 64) });
    const error = await storeMakerWork(h.sql, store, { userId: CREATIVE.userId!, bytes: await jpeg(200, 64) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkError);
    expect((error as WorkError).code).toBe('limit_reached');
  });

  it('crops the avatar square, replaces it, and serves it by handle while public', async () => {
    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicProfile: true });
    const version = await storeMakerAvatar(h.sql, store, CREATIVE.userId!, await jpeg(900, 400));
    expect((await loadMakerSettings(h.sql, CREATIVE.userId!))!.avatarVersion).toBe(version);
    const object = (await makerMediaObject(h.sql, null, 'avatar-jun_films'))!;
    expect(object.publicCache).toBe(true);
    expect(await sharp(await store.read(object.key)).metadata()).toMatchObject({ width: 512, height: 512, format: 'jpeg' });
    const next = await storeMakerAvatar(h.sql, store, CREATIVE.userId!, await jpeg());
    expect(next).not.toBe(version);
    expect((await loadPromptCatalog(h.sql, { publicUrl: () => null })).makers[0]!.avatar).toBe(`/creative-media/avatar-jun_films-${next}.jpg`);
    expect(await makerMediaObject(h.sql, CREATIVE.userId!, 'avatar-me')).toMatchObject({ publicCache: false });
    expect(await makerMediaObject(h.sql, null, 'avatar-me')).toBeNull();
    await deleteMakerAvatar(h.sql, store, CREATIVE.userId!);
    expect(await makerMediaObject(h.sql, null, 'avatar-jun_films')).toBeNull();
  });

  it('crops the cover 2:1 without metadata, replaces it, and serves it by handle while public (0071)', async () => {
    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicProfile: true });
    expect(await loadMakerSettings(h.sql, CREATIVE.userId!)).toMatchObject({ coverVersion: null, coverReady: true });
    expect(await code(storeMakerCover(h.sql, store, CREATIVE.userId!, new TextEncoder().encode('not an image')))).toBe('bad_file');

    const version = await storeMakerCover(h.sql, store, CREATIVE.userId!, await jpeg(3000, 900));
    expect((await loadMakerSettings(h.sql, CREATIVE.userId!))!.coverVersion).toBe(version);
    const object = (await makerMediaObject(h.sql, null, 'cover-jun_films'))!;
    expect(object).toMatchObject({ mime: 'image/jpeg', publicCache: true });
    const bytes = await store.read(object.key);
    expect(await sharp(bytes).metadata()).toMatchObject({ width: COVER_WIDTH, height: COVER_HEIGHT, format: 'jpeg' });
    expect(Buffer.from(bytes).includes('GPS-CANARY')).toBe(false);
    // The avatar and the cover are two objects: one never answers for the other.
    expect(await makerMediaObject(h.sql, null, 'avatar-jun_films')).toBeNull();

    // A portrait picture becomes the same banner; the old object is gone and the address moves.
    const next = await storeMakerCover(h.sql, store, CREATIVE.userId!, await jpeg(640, 800));
    expect(next).not.toBe(version);
    await expect(store.read(object.key)).rejects.toThrow();
    const catalog = await loadPromptCatalog(h.sql, { publicUrl: () => null });
    expect(catalog.makers[0]!.cover).toBe(`/creative-media/cover-jun_films-${next}.jpg`);
    expect(JSON.stringify(catalog)).not.toContain('cover_key');

    // The creative's own preview before the profile is public; never anyone else's.
    expect(await makerMediaObject(h.sql, CREATIVE.userId!, 'cover-me')).toMatchObject({ publicCache: false });
    expect(await makerMediaObject(h.sql, null, 'cover-me')).toBeNull();
    await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicProfile: false });
    expect(await makerMediaObject(h.sql, null, 'cover-jun_films')).toBeNull();
    expect(await makerMediaObject(h.sql, OTHER.id, 'cover-jun_films')).toBeNull();
    expect(await makerMediaObject(h.sql, CREATIVE.userId!, 'cover-jun_films')).toMatchObject({ publicCache: false });

    await deleteMakerCover(h.sql, store, CREATIVE.userId!);
    expect((await loadMakerSettings(h.sql, CREATIVE.userId!))!.coverVersion).toBeNull();
    expect(await makerMediaObject(h.sql, CREATIVE.userId!, 'cover-me')).toBeNull();
  });

  it('keeps answering on a database without 0071: no cover, no cover control, no cover upload', async () => {
    await h.sql.query('alter table platform_creators drop column cover_key');
    const saved = await saveMakerProfile(h.sql, CREATIVE.userId!, { handle: 'jun_films', publicProfile: true, displayName: 'Jun Park' });
    expect(saved).toMatchObject({ displayName: 'Jun Park', coverVersion: null, coverReady: false });
    expect(await code(storeMakerCover(h.sql, store, CREATIVE.userId!, await jpeg(3000, 900)))).toBe('unavailable');
    await deleteMakerCover(h.sql, store, CREATIVE.userId!);
    expect(await makerMediaObject(h.sql, CREATIVE.userId!, 'cover-me')).toBeNull();
    expect(await makerMediaObject(h.sql, null, 'cover-jun_films')).toBeNull();
    expect((await loadPromptCatalog(h.sql, { publicUrl: () => null })).makers).toEqual([expect.objectContaining({ handle: 'jun_films', displayName: 'Jun Park', cover: null })]);
  });

  it('issues tokens shown once, resolves them by hash, and stops them on revoke or a revoked creative', async () => {
    const { token, record } = await createMakerToken(h.sql, CREATIVE.userId!, 'Claude on my laptop');
    expect(token).toMatch(/^twk_[0-9a-z]{40}$/);
    expect(record.prefix).toBe(token.slice(0, 10));
    const stored = await h.sql.query<{ token_hash: string }>('select token_hash from maker_tokens where id=$1', [record.id]);
    expect(stored.rows[0]!.token_hash).not.toContain(token);
    expect(await resolveMakerToken(h.sql, `Bearer ${token}`)).toBe(CREATIVE.userId);
    for (const bad of [null, '', `Bearer ${token}x`, `Basic ${token}`, 'Bearer twk_short']) expect(await resolveMakerToken(h.sql, bad), String(bad)).toBeNull();
    expect((await listMakerTokens(h.sql, CREATIVE.userId!))[0]).toMatchObject({ id: record.id, name: 'Claude on my laptop' });
    expect(JSON.stringify(await listMakerTokens(h.sql, CREATIVE.userId!))).not.toContain(token);

    for (let i = 1; i < MAKER_TOKENS_MAX; i++) await createMakerToken(h.sql, CREATIVE.userId!, `t${i}`);
    expect(await code(createMakerToken(h.sql, CREATIVE.userId!, 'one too many'))).toBe('limit_reached');
    expect(await code(revokeMakerToken(h.sql, OTHER.id, record.id))).toBe('not_found');
    await revokeMakerToken(h.sql, CREATIVE.userId!, record.id);
    expect(await resolveMakerToken(h.sql, `Bearer ${token}`)).toBeNull();

    const live = (await createMakerToken(h.sql, CREATIVE.userId!, 'again')).token;
    await administerPlatform(h.sql, ADMIN_VIEWER, { action: 'creator', id: CREATIVE.userId, active: false, contract: 'pilot-v1', reason: 'Revoked for the test' });
    expect(await resolveMakerToken(h.sql, `Bearer ${live}`)).toBeNull();
  });

  it('counts recipe opens once per member, with repeat opens counted, not duplicated', async () => {
    const template = (await h.sql.query<{ id: string }>("select id from prompt_items where status='published' limit 1")).rows[0]!.id;
    await recordRecipeOpen(h.sql, template, CREATIVE.userId!);
    await recordRecipeOpen(h.sql, template, CREATIVE.userId!);
    await recordRecipeOpen(h.sql, template, OTHER.id);
    const rows = (await h.sql.query<{ n: number }>('select count(*)::int n from recipe_unlocks where template_id=$1', [template])).rows;
    expect(rows[0]!.n).toBe(2);
  });

  describe('MCP server', () => {
    const deps = () => ({ sql: h.sql, store, userId: CREATIVE.userId!, origin: 'https://twings.app' });
    const call = (name: string, args: Record<string, unknown> = {}) => handleMcp(deps(), { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
    const payload = (response: unknown) => JSON.parse(((response as { result: { content: Array<{ text: string }> } }).result.content[0]!.text));

    it('speaks the protocol: initialize, ping, tools/list, notifications and errors', async () => {
      const init = await handleMcp(deps(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
      expect(init).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'twings' } } });
      expect(await handleMcp(deps(), { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
      expect(await handleMcp(deps(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
      expect(await handleMcp(deps(), { jsonrpc: '2.0', id: 3, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
      const list = await handleMcp(deps(), { jsonrpc: '2.0', id: 4, method: 'tools/list' });
      expect((list as { result: { tools: Array<{ name: string; inputSchema: { type: string } }> } }).result.tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
      expect(await handleMcp(deps(), { jsonrpc: '2.0', id: 5, method: 'resources/list' })).toMatchObject({ error: { code: -32601 } });
      expect(await handleMcp(deps(), { id: 6, method: 'ping' })).toMatchObject({ error: { code: -32600 } });
      expect(await handleMcp(deps(), { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'drop_tables' } })).toMatchObject({ error: { code: -32602 } });
    });

    it('refuses every tool while the program is closed, then works for an active creative', async () => {
      vi.stubEnv('TWINGS_FORMAT_CREATORS', 'off');
      expect(payload(await call('whoami'))).toEqual({ code: 'not_open' });
      vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
      expect(payload(await call('whoami'))).toMatchObject({ programOpen: true, handle: null, publicProfile: false, extendedProfile: true });
      expect(payload(await call('get_recipe_guide'))).toMatchObject({ imageEngines: expect.arrayContaining(['gpt-image-2']), example: { version: 2 } });
    });

    it('validates, saves and reads back a draft, updates the profile and adds a work from base64', async () => {
      vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
      const recipe = {
        version: 2, slots: { selfie: { kind: 'image', source: 'user', required: true } },
        steps: [{ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'Studio portrait of {{selfie}} in soft light.', note: 'Front-facing selfie.', params: { aspect: '4:5' } }],
        output: { from: 'still' }, notes: { intro: 'One still from one selfie.' },
      };
      expect(payload(await call('validate_recipe', { recipe }))).toEqual({ ok: true, medium: 'image' });
      expect(payload(await call('validate_recipe', { recipe: { ...recipe, steps: [] } }))).toMatchObject({ ok: false });
      const saved = payload(await call('save_template', { title: 'Soft studio', recipe, show_prompts: true }));
      expect(saved).toMatchObject({ saved: true, complete: true, issues: [] });
      const draft = payload(await call('get_template', { id: saved.id }));
      expect(draft).toMatchObject({ status: 'draft', title: 'Soft studio', disclosure: { prompts: true, assets: false }, recipe: { notes: { intro: 'One still from one selfie.' } } });
      expect(payload(await call('list_templates'))).toEqual([expect.objectContaining({ id: saved.id, status: 'draft', url: null })]);

      const profile = payload(await call('update_profile', { handle: 'jun_films', display_name: 'Jun', country: 'KR', public_profile: true }));
      expect(profile).toMatchObject({ handle: 'jun_films', displayName: 'Jun', country: 'KR', publicProfile: true, profileUrl: 'https://twings.app/en/makers/jun_films' });
      expect(payload(await call('update_profile', { country: 'Atlantis' }))).toEqual({ code: 'invalid_country' });

      const work = payload(await call('add_work', { data_base64: Buffer.from(await jpeg()).toString('base64'), title: 'From my agent' }));
      expect(work).toMatchObject({ kind: 'image', title: 'From my agent', unchanged: false });
      expect(payload(await call('list_works'))).toEqual([expect.objectContaining({ id: work.id, src: `https://twings.app/creative-media/${work.id}.jpg` })]);
      expect(payload(await call('add_work', { url: 'https://127.0.0.1/a.png' }))).toEqual({ code: 'blocked' });
      expect(payload(await call('add_work', {}))).toEqual({ code: 'media_required' });
      expect(payload(await call('remove_work', { id: work.id }))).toEqual({ removed: true });
      expect(payload(await call('submit_template', { template_id: saved.id, rights_confirmed: false }))).toEqual({ code: 'rights_required' });
      // Someone else's draft does not exist to this token.
      expect(payload(await call('get_template', { id: randomUUID() }))).toEqual({ code: 'not_found' });
    });
  });
});
