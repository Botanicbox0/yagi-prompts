import { describe, expect, it, vi } from 'vitest';
import { videoPromptShieldOpenFor } from '@/lib/flags';
import { sentVersion, shieldKeys, videoPromptShieldActive } from '@/lib/brand-studio/prompt-shield/shield';
import { openPromptToken, PROMPT_TOKEN_MAX, PROMPT_TOKEN_TTL_MS, sealPromptToken } from '@/lib/brand-studio/prompt-shield/token';
import { createHash } from 'node:crypto';
import { SENTINEL } from './world';

/**
 * The video prompt shield's switch, keys and designed-sentence token. The token is AES-256-GCM over the sentence
 * and who it was made for: anything altered, foreign, expired or oversized opens to the same null.
 */
const ORG = '00000000-0000-4000-8000-00000000a001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a002';
const USER = '00000000-0000-4000-8000-00000000b001';
const OTHER_USER = '00000000-0000-4000-8000-00000000b002';
const LOCAL: Record<string, string | undefined> = {};
const claims = { org: ORG, user: USER, model: 'seedance-2.5', kind: 'video' };
const expect_ = { org: ORG, user: USER, model: 'seedance-2.5', kind: 'video' as const };
const NOW = Date.UTC(2026, 10, 27, 12, 0);

describe('switch', () => {
  it('is open only with BRAND_STUDIO_VIDEO_PROMPT_SHIELD=on, for every organization or the listed ones', () => {
    expect(videoPromptShieldOpenFor(ORG, {})).toBe(false);
    expect(videoPromptShieldOpenFor(ORG, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'off' })).toBe(false);
    expect(videoPromptShieldOpenFor(ORG, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'ON' })).toBe(false);
    expect(videoPromptShieldOpenFor(ORG, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: ORG })).toBe(false);
    expect(videoPromptShieldOpenFor(ORG, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on' })).toBe(true);
    expect(videoPromptShieldOpenFor(ORG, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on', BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: ' , ' })).toBe(true);
    const listed = { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on', BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: ` ${ORG.toUpperCase()} ,x` };
    expect(videoPromptShieldOpenFor(ORG, listed)).toBe(true);
    expect(videoPromptShieldOpenFor(OTHER_ORG, listed)).toBe(false);
    expect(videoPromptShieldOpenFor(OTHER_ORG, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on', BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: `${ORG},all` })).toBe(true);
    expect(videoPromptShieldOpenFor(null, { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on' })).toBe(false);
  });

  it('stays closed without a secret off local mode, and says so once without the secret', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const on = { BRAND_STUDIO_VIDEO_PROMPT_SHIELD: 'on' };
    expect(videoPromptShieldActive(ORG, { ...on, VERCEL: '1' })).toBe(false);
    expect(videoPromptShieldActive(ORG, { ...on, PLAYBOOK_MODE: 'cloud' })).toBe(false);
    expect(videoPromptShieldActive(ORG, { ...on, PLAYBOOK_MODE: 'cloud', SUPABASE_SERVICE_ROLE_KEY: 'YOUR-service-role-key-here' })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('video_prompt_shield_no_secret');
    expect(videoPromptShieldActive(ORG, { ...on, VERCEL: '1', SUPABASE_SERVICE_ROLE_KEY: 'a-long-server-only-service-role-key' })).toBe(true);
    expect(videoPromptShieldActive(ORG, { ...on, VERCEL: '1', BRAND_STUDIO_PROMPT_TOKEN_SECRET: 'a-dedicated-secret-of-length' })).toBe(true);
    // Local mode (no database URL, not on Vercel) works with no cloud secret at all.
    expect(videoPromptShieldActive(ORG, on)).toBe(true);
    warn.mockRestore();
  });

  it('a dedicated secret wins, and different secrets give different keys', () => {
    const a = shieldKeys({ VERCEL: '1', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-aaaaaaaa' })!;
    const b = shieldKeys({ VERCEL: '1', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-aaaaaaaa', BRAND_STUDIO_PROMPT_TOKEN_SECRET: 'dedicated-secret-bbbbbbbb' })!;
    expect(a.token.equals(b.token)).toBe(false);
    expect(a.token.equals(a.version)).toBe(false);
  });
});

describe('version', () => {
  it('changes with the text and the run, and is not a hash of the text alone', () => {
    const v = sentVersion('job-1', SENTINEL, LOCAL);
    expect(v).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(sentVersion('job-1', SENTINEL, LOCAL)).toBe(v);
    expect(sentVersion('job-1', `${SENTINEL}.`, LOCAL)).not.toBe(v);
    expect(sentVersion('job-2', SENTINEL, LOCAL)).not.toBe(v);
    for (const algo of ['sha256', 'sha1', 'md5']) {
      for (const enc of ['hex', 'base64url'] as const) expect(createHash(algo).update(SENTINEL).digest(enc)).not.toContain(v);
    }
  });
});

describe('token', () => {
  it('round trip', () => {
    const token = sealPromptToken({ ...claims, prompt: SENTINEL }, LOCAL, NOW)!;
    expect(openPromptToken(token, expect_, LOCAL, NOW)).toBe(SENTINEL);
    expect(openPromptToken(token, { ...expect_, model: null, kind: ['video', 'video_remix'] }, LOCAL, NOW)).toBe(SENTINEL);
  });

  it('never carries the sentence in clear, and two tokens for the same text differ', () => {
    const a = sealPromptToken({ ...claims, prompt: SENTINEL }, LOCAL, NOW)!;
    const b = sealPromptToken({ ...claims, prompt: SENTINEL }, LOCAL, NOW)!;
    expect(a).not.toBe(b);
    for (const t of [a, b]) {
      expect(t).not.toContain('Quillwort');
      expect(Buffer.from(t, 'base64url').includes(Buffer.from('Quillwort'))).toBe(false);
      expect(Buffer.from(t, 'base64url').includes(Buffer.from(ORG))).toBe(false);
      expect(Buffer.from(t, 'base64').includes(Buffer.from('Quillwort'))).toBe(false);
    }
  });

  it('refuses a flipped byte anywhere', () => {
    const token = sealPromptToken({ ...claims, prompt: SENTINEL }, LOCAL, NOW)!;
    const raw = Buffer.from(token, 'base64url');
    for (const at of [0, 1, 13, Math.floor(raw.length / 2), raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[at] = bad[at]! ^ 0x01;
      expect(openPromptToken(bad.toString('base64url'), expect_, LOCAL, NOW)).toBeNull();
    }
    expect(openPromptToken(`${token}A`, expect_, LOCAL, NOW)).toBeNull();
    expect(openPromptToken(token.slice(0, -2), expect_, LOCAL, NOW)).toBeNull();
  });

  it('refuses another organization, member, model or kind', () => {
    const token = sealPromptToken({ ...claims, prompt: SENTINEL }, LOCAL, NOW)!;
    expect(openPromptToken(token, { ...expect_, org: OTHER_ORG }, LOCAL, NOW)).toBeNull();
    expect(openPromptToken(token, { ...expect_, user: OTHER_USER }, LOCAL, NOW)).toBeNull();
    expect(openPromptToken(token, { ...expect_, model: 'seedance-3' }, LOCAL, NOW)).toBeNull();
    expect(openPromptToken(token, { ...expect_, kind: 'video_remix' }, LOCAL, NOW)).toBeNull();
    expect(openPromptToken(token, { ...expect_, kind: 'image' }, LOCAL, NOW)).toBeNull();
  });

  it('refuses one older than 24 hours or from the future, and one sealed with another key', () => {
    const token = sealPromptToken({ ...claims, prompt: SENTINEL }, LOCAL, NOW)!;
    expect(openPromptToken(token, expect_, LOCAL, NOW + PROMPT_TOKEN_TTL_MS - 1_000)).toBe(SENTINEL);
    expect(openPromptToken(token, expect_, LOCAL, NOW + PROMPT_TOKEN_TTL_MS + 1_000)).toBeNull();
    expect(openPromptToken(token, expect_, LOCAL, NOW - 10 * 60 * 1000)).toBeNull();
    expect(openPromptToken(token, expect_, { VERCEL: '1', SUPABASE_SERVICE_ROLE_KEY: 'another-service-role-key' }, NOW)).toBeNull();
    expect(openPromptToken(token, expect_, { VERCEL: '1' }, NOW)).toBeNull();
  });

  it('carries 15,000 characters and refuses more, and garbage', () => {
    const longest = '가'.repeat(15_000);
    const token = sealPromptToken({ ...claims, prompt: longest }, LOCAL, NOW)!;
    expect(token.length).toBeLessThanOrEqual(PROMPT_TOKEN_MAX);
    expect(openPromptToken(token, expect_, LOCAL, NOW)).toBe(longest);
    expect(sealPromptToken({ ...claims, prompt: 'a'.repeat(15_001) }, LOCAL, NOW)).toBeNull();
    expect(openPromptToken('A'.repeat(PROMPT_TOKEN_MAX + 1), expect_, LOCAL, NOW)).toBeNull();
    for (const junk of [undefined, null, 42, {}, '', 'short', 'not base64 !!!'.repeat(10)]) expect(openPromptToken(junk, expect_, LOCAL, NOW)).toBeNull();
  });
});
