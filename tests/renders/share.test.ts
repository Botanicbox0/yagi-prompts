import { describe, expect, it } from 'vitest';
import {
  SHARE_TTL_DAYS,
  isRenderId,
  isShareExpired,
  isShareTokenShape,
  newShareToken,
  renderHref,
  renderMediaHref,
  shareExpiresAt,
  shareHref,
} from '@/lib/renders/share';

describe('the 3-day link', () => {
  it('mints a 43-character url-safe token and recognises only that shape', () => {
    const token = newShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isShareTokenShape(token)).toBe(true);
    expect(newShareToken()).not.toBe(token);
    expect(isShareTokenShape('short')).toBe(false);
    expect(isShareTokenShape(`${token}/../x`)).toBe(false);
    expect(isShareTokenShape(null)).toBe(false);
  });

  it('expires three days after the render finished, to the millisecond', () => {
    const finished = new Date('2026-09-06T12:00:00.000Z');
    const expires = shareExpiresAt(finished);
    expect(expires.toISOString()).toBe('2026-09-09T12:00:00.000Z');
    expect(SHARE_TTL_DAYS).toBe(3);
    expect(isShareExpired(expires, new Date('2026-09-09T11:59:59.999Z'))).toBe(false);
    expect(isShareExpired(expires, expires)).toBe(true);
    expect(isShareExpired(null, finished)).toBe(true);
    expect(isShareExpired('not a date', finished)).toBe(true);
  });

  it('spells the three addresses once', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(renderHref(id)).toBe(`/renders/${id}`);
    expect(shareHref(id, 'tok')).toBe(`/r/${id}/tok`);
    expect(renderMediaHref(id)).toBe(`/api/renders/media/${id}`);
    expect(renderMediaHref(id, { share: 'tok', download: true })).toBe(`/api/renders/media/${id}?s=tok&download=1`);
    expect(isRenderId(id)).toBe(true);
    expect(isRenderId('nope')).toBe(false);
  });
});
