import { describe, expect, it } from 'vitest';
import {
  MEDIA_TOKEN_TTL_SECONDS,
  mintMediaToken,
  signMediaToken,
  verifyMediaToken,
} from '@/lib/media/token';

/**
 * PLAN §3.3 — "a ≤60s signed URL against the published private copy".
 *
 * The local driver has no signing service, so these are the semantics the gateway implements
 * itself and the Supabase driver will inherit: bound to one ref, expiring inside the window,
 * unforgeable without the server secret.
 */

const SECRET = 'test-secret-at-least-16-chars';
const NOW = Date.parse('2026-08-12T12:00:00.000Z');

const mint = (ref: string, over: Parameters<typeof mintMediaToken>[1] = {}) =>
  mintMediaToken(
    { ref, bucket: 'content-published', key: 'abc.png', mime: 'image/png' },
    { now: NOW, secret: SECRET, ...over },
  );

describe('media token (§3.3)', () => {
  it('round-trips its claims', () => {
    const { token, expiresAt } = mint('block-1');
    const result = verifyMediaToken(token, { ref: 'block-1', now: NOW, secret: SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toMatchObject({
      ref: 'block-1',
      bucket: 'content-published',
      key: 'abc.png',
      mime: 'image/png',
      exp: expiresAt,
    });
  });

  it('caps the lifetime at 60 seconds however it is asked', () => {
    const { expiresAt } = mint('block-1', { now: NOW, secret: SECRET, ttlSeconds: 3600 });
    expect(expiresAt - Math.floor(NOW / 1000)).toBe(MEDIA_TOKEN_TTL_SECONDS);
    expect(MEDIA_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(60);
  });

  it('expires — verified against an injected clock, not a sleep', () => {
    const { token } = mint('block-1');
    const justInside = NOW + (MEDIA_TOKEN_TTL_SECONDS - 1) * 1000;
    const justOutside = NOW + (MEDIA_TOKEN_TTL_SECONDS + 1) * 1000;

    expect(verifyMediaToken(token, { ref: 'block-1', now: justInside, secret: SECRET }).ok).toBe(
      true,
    );
    const expired = verifyMediaToken(token, { ref: 'block-1', now: justOutside, secret: SECRET });
    expect(expired.ok).toBe(false);
    if (expired.ok) return;
    expect(expired.reason).toBe('expired');
  });

  it('is bound to ONE ref — a valid token cannot be replayed against another object', () => {
    const { token } = mint('block-1');
    const replay = verifyMediaToken(token, { ref: 'block-2', now: NOW, secret: SECRET });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe('ref_mismatch');
  });

  it('refuses a forged signature, a foreign secret and a truncated token', () => {
    const { token } = mint('block-1');
    const [payload, signature] = token.split('.') as [string, string];

    const forged = verifyMediaToken(`${payload}.${'a'.repeat(signature.length)}`, {
      ref: 'block-1',
      now: NOW,
      secret: SECRET,
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.reason).toBe('bad_signature');

    const otherSecret = verifyMediaToken(token, {
      ref: 'block-1',
      now: NOW,
      secret: 'a-different-secret-16+',
    });
    expect(otherSecret.ok).toBe(false);

    for (const bad of ['', '.', payload, `${payload}.`, `.${signature}`, 'not-a-token']) {
      expect(verifyMediaToken(bad, { ref: 'block-1', now: NOW, secret: SECRET }).ok, bad).toBe(
        false,
      );
    }
  });

  it('cannot be re-pointed at another bucket or key by editing the payload', () => {
    // The attack this defends against: swap `content-published/abc.png` for something else and
    // keep the signature. The HMAC covers the whole payload, so the edit invalidates it.
    const forgedPayload = Buffer.from(
      JSON.stringify({ r: 'block-1', b: 'content-published', k: 'secret.png', e: 9_999_999_999 }),
    ).toString('base64url');
    const { token } = mint('block-1');
    const signature = token.split('.')[1]!;

    expect(
      verifyMediaToken(`${forgedPayload}.${signature}`, {
        ref: 'block-1',
        now: NOW,
        secret: SECRET,
      }).ok,
    ).toBe(false);

    // …and re-signing it requires the secret, which is the whole point.
    const properlySigned = signMediaToken(
      { ref: 'block-1', bucket: 'content-published', key: 'secret.png', exp: 9_999_999_999 },
      SECRET,
    );
    expect(verifyMediaToken(properlySigned, { ref: 'block-1', now: NOW, secret: SECRET }).ok).toBe(
      true,
    );
  });
});
