import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ASSET_ROLE_SCHEMA,
  assetAutoRoleConfig,
  pictureForReading,
  readAssetRoleFacts,
  roleFromFacts,
  wantsRoleCheck,
  type AssetRoleFacts,
} from '@/lib/brand-studio/asset-role';

/** docs/BRAND-STUDIO-V3.md §4.1 — the upload's role is saved only when the facts leave no doubt. */
const facts = (patch: Partial<AssetRoleFacts> = {}): AssetRoleFacts => ({
  role: 'product',
  alternative: 'none',
  kind: 'photo',
  people: 'none',
  framing: 'no_person',
  light: 'even',
  text: 'mark_or_label',
  surface: false,
  ...patch,
});
const portrait = (patch: Partial<AssetRoleFacts> = {}) =>
  facts({ role: 'person', people: 'one_face_visible', framing: 'head_and_shoulders', text: 'none', ...patch });

function geminiAnswer(body: unknown, init: { status?: number } = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }] }), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('the sureness rule', () => {
  it('saves the five roles when nothing casts doubt', () => {
    expect(roleFromFacts(facts())).toBe('product');
    expect(roleFromFacts(portrait())).toBe('person');
    expect(roleFromFacts(facts({ role: 'logo', kind: 'flat_graphic' }))).toBe('logo');
    expect(roleFromFacts(facts({ role: 'style', text: 'none', surface: true }))).toBe('style');
    expect(roleFromFacts(facts({ role: 'place', text: 'none' }))).toBe('place');
  });

  it('never saves other', () => {
    expect(roleFromFacts(facts({ role: 'other', kind: 'screenshot', text: 'lots' }))).toBeNull();
    expect(roleFromFacts(facts({ role: 'other' }))).toBeNull();
  });

  it('treats a style second reading as noise only under ordinary light', () => {
    expect(roleFromFacts(facts({ alternative: 'style', light: 'natural' }))).toBe('product');
    expect(roleFromFacts(portrait({ alternative: 'style', light: 'even' }))).toBe('person');
    // The light reference with a bottle in it: coloured or dramatic light makes the style reading real.
    expect(roleFromFacts(facts({ alternative: 'style', light: 'coloured_or_effect' }))).toBeNull();
    expect(roleFromFacts(facts({ alternative: 'style', light: 'dramatic' }))).toBeNull();
    expect(roleFromFacts(portrait({ alternative: 'style', light: 'coloured_or_effect' }))).toBeNull();
    // A place has light by nature; a style picture may read as a floor or a wall.
    expect(roleFromFacts(facts({ role: 'place', alternative: 'style', light: 'dramatic', text: 'none' }))).toBe('place');
    expect(roleFromFacts(facts({ role: 'style', alternative: 'place', text: 'none' }))).toBe('style');
  });

  it('leaves every other pair of readings empty', () => {
    expect(roleFromFacts(portrait({ alternative: 'product' }))).toBeNull(); // a person holding a product
    expect(roleFromFacts(facts({ alternative: 'person' }))).toBeNull();
    expect(roleFromFacts(facts({ alternative: 'place' }))).toBeNull(); // a product in a setting
    expect(roleFromFacts(facts({ role: 'style', alternative: 'product' }))).toBeNull(); // a still life or a look
    expect(roleFromFacts(facts({ role: 'logo', kind: 'flat_graphic', alternative: 'style' }))).toBeNull();
    expect(roleFromFacts(facts({ role: 'place', alternative: 'person', text: 'none' }))).toBeNull();
  });

  it('checks who is in the picture, how it is framed and what sort of picture it is', () => {
    expect(roleFromFacts(facts({ people: 'hands_or_body_part' }))).toBe('product'); // a product on a hand
    expect(roleFromFacts(facts({ people: 'one_face_visible' }))).toBeNull();
    expect(roleFromFacts(portrait({ framing: 'full_body' }))).toBeNull();
    expect(roleFromFacts(portrait({ framing: 'small_in_frame' }))).toBeNull();
    expect(roleFromFacts(portrait({ people: 'several' }))).toBeNull();
    expect(roleFromFacts(portrait({ people: 'one_face_hidden' }))).toBeNull();
    expect(roleFromFacts(facts({ role: 'place', people: 'one_face_visible', text: 'none' }))).toBeNull();
    expect(roleFromFacts(facts({ role: 'place', surface: true, text: 'none' }))).toBeNull(); // a floor filling the frame
    expect(roleFromFacts(facts({ kind: 'collage' }))).toBeNull();
    expect(roleFromFacts(facts({ kind: 'screenshot' }))).toBeNull();
    expect(roleFromFacts(facts({ role: 'logo', kind: 'photo' }))).toBeNull(); // a mark printed on something
    expect(roleFromFacts(facts({ role: 'logo', kind: 'flat_graphic', text: 'some' }))).toBeNull(); // a card or a page
    expect(roleFromFacts(facts({ text: 'lots' }))).toBeNull();
  });
});

describe('the kill switch and the call', () => {
  it('is on with a key unless BRAND_STUDIO_ASSET_AUTO_ROLE=off, and never without a key', () => {
    expect(assetAutoRoleConfig({ GEMINI_API_KEY: 'k' })).toMatchObject({ model: 'gemini-4-hydrogen' });
    expect(assetAutoRoleConfig({ GEMINI_API_KEY: 'k', BRAND_STUDIO_ASSET_AUTO_ROLE: 'off' })).toBeNull();
    expect(assetAutoRoleConfig({ GEMINI_API_KEY: 'k', BRAND_STUDIO_ASSET_AUTO_ROLE: ' OFF ' })).toBeNull();
    expect(assetAutoRoleConfig({ GEMINI_API_KEY: 'k', BRAND_STUDIO_ASSET_AUTO_ROLE: 'on' })).not.toBeNull();
    expect(assetAutoRoleConfig({})).toBeNull();
  });

  it('asks for every fact the rule reads, and returns null for any failure', async () => {
    expect(ASSET_ROLE_SCHEMA.required).toEqual(['role', 'alternative', 'kind', 'people', 'framing', 'light', 'text', 'surface']);
    const config = assetAutoRoleConfig({ GEMINI_API_KEY: 'k' })!;
    const thumb = { bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).webp().toBuffer()), mime: 'image/webp' };
    expect(await readAssetRoleFacts(config, geminiAnswer(facts()), thumb)).toEqual(facts());
    expect(await readAssetRoleFacts(config, geminiAnswer(facts(), { status: 500 }), thumb)).toBeNull();
    expect(await readAssetRoleFacts(config, geminiAnswer({ role: 'bottle' }), thumb)).toBeNull();
    expect(await readAssetRoleFacts(config, (() => Promise.reject(new Error('offline'))) as typeof fetch, thumb)).toBeNull();
    const blocked = (async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 })) as typeof fetch;
    expect(await readAssetRoleFacts(config, blocked, thumb)).toBeNull();
    // A call that never answers is given up on at the timeout.
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    const started = Date.now();
    expect(await readAssetRoleFacts(config, hanging, thumb, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('shows a transparent thumbnail on grey and leaves an opaque one as it is', async () => {
    const clear = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer());
    const read = await pictureForReading({ bytes: clear, mime: 'image/webp' });
    const { data, info } = await sharp(read.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(Math.abs(data[0]! - 128)).toBeLessThan(6);
    const opaque = { bytes: new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).webp().toBuffer()), mime: 'image/webp' };
    expect(await pictureForReading(opaque)).toBe(opaque);
  });

  it('reads only image uploads nobody has categorised or checked', () => {
    const row = { id: 'a', kind: 'image' as const, source: 'upload' as const, role: null, role_source: null, thumb_key: 't', status: 'ready' as const, deleted_at: null };
    const env = { GEMINI_API_KEY: 'k' };
    expect(wantsRoleCheck(row, env)).toBe(true);
    expect(wantsRoleCheck({ ...row, kind: 'video' }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, kind: 'audio' }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, source: 'generation' }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, role: 'product' }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, role_source: 'user' }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, role_source: 'auto' }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, thumb_key: null }, env)).toBe(false);
    expect(wantsRoleCheck({ ...row, deleted_at: '2026-11-19' }, env)).toBe(false);
    expect(wantsRoleCheck(row, { ...env, BRAND_STUDIO_ASSET_AUTO_ROLE: 'off' })).toBe(false);
    expect(wantsRoleCheck(row, {})).toBe(false);
  });
});
