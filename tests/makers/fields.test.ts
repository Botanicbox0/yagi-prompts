import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  COUNTRY_CODES, countryFlag, countryName, countryOf, emailOf, lineOf, linkLabel, linkOf, linksOf, storedLinks, toolsOf,
} from '@/lib/makers/fields';
import { checkedMediaUrl, decodeBase64Media, isBlockedAddress, MediaFetchError } from '@/lib/makers/fetch-media';

/**
 * docs/PLATFORM-2.0.md §20 — an AI creative's profile fields are checked the same way wherever they
 * arrive (studio form, MCP tool). Empty means "not shown", never a placeholder.
 */

describe('creative profile fields', () => {
  it('keeps single lines short and refuses control characters', () => {
    expect(lineOf('  Jun   Park  ', 40)).toBe('Jun Park');
    expect(lineOf('', 40)).toBeNull();
    expect(lineOf(undefined, 40)).toBeNull();
    expect(lineOf('가'.repeat(41), 40)).toBe(false);
    expect(lineOf('bell\u0007', 40)).toBe(false);
    expect(lineOf(42, 40)).toBe(false);
  });

  it('accepts current ISO country codes only', () => {
    expect(countryOf('kr')).toBe('KR');
    expect(countryOf('')).toBeNull();
    for (const retired of ['SU', 'YU', 'ZZ', 'EU', 'KOR']) expect(countryOf(retired), retired).toBe(false);
    expect(COUNTRY_CODES).toContain('US');
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(countryFlag('KR')).toBe('🇰🇷');
    expect(countryName('KR', 'ko')).toBe('대한민국');
    expect(countryName('KR', 'en')).toBe('South Korea');
  });

  it('normalises an email’s domain and refuses anything that is not one address', () => {
    expect(emailOf(' Hello@Jun.Studio ')).toBe('Hello@jun.studio');
    expect(emailOf('')).toBeNull();
    for (const bad of ['no-at.example', 'a@b', 'a b@c.d', 'a@b\u0007.c', 'a@b@c.d']) expect(emailOf(bad), bad).toBe(false);
  });

  it('reads tools from a comma list, drops duplicates and caps at eight', () => {
    expect(toolsOf('Seedance 2.5, Midjourney ,  seedance 2.5,,ComfyUI')).toEqual(['Seedance 2.5', 'Midjourney', 'ComfyUI']);
    expect(toolsOf(['A', 'B'])).toEqual(['A', 'B']);
    expect(toolsOf(Array.from({ length: 9 }, (_, i) => `T${i}`))).toBe(false);
    expect(toolsOf('x'.repeat(33))).toBe(false);
  });

  it('takes https links only, upgrades http, adds a missing scheme and recognises the platform', () => {
    expect(linkOf('instagram.com/jun.films')).toEqual({ kind: 'instagram', url: 'https://instagram.com/jun.films' });
    expect(linkOf('http://www.tiktok.com/@jun')).toEqual({ kind: 'tiktok', url: 'https://www.tiktok.com/@jun' });
    expect(linkOf('https://higgsfield.ai/@sadiesfaction')).toMatchObject({ kind: 'higgsfield' });
    expect(linkOf('https://youtu.be/abc')).toMatchObject({ kind: 'youtube' });
    expect(linkOf('https://jun.studio/#work')).toEqual({ kind: 'website', url: 'https://jun.studio/' });
    for (const bad of ['javascript:alert(1)', 'ftp://x.y/z', 'https://user:pw@x.y/', 'https://x.y:8443/', 'https://localhost/', 'not a url']) {
      expect(linkOf(bad), bad).toBe(false);
    }
    expect(linksOf(['instagram.com/a', '', 'instagram.com/a', { url: 'x.com/b' }])).toEqual([
      { kind: 'instagram', url: 'https://instagram.com/a' }, { kind: 'x', url: 'https://x.com/b' },
    ]);
    expect(linksOf(Array.from({ length: 7 }, (_, i) => `https://site${i}.com/`))).toBe(false);
    // What the database returns is read back defensively: a bad row is dropped, not rendered.
    expect(storedLinks([{ url: 'javascript:alert(1)' }, { url: 'https://ok.example/' }, 'junk'])).toEqual([{ kind: 'website', url: 'https://ok.example/' }]);
  });

  it('labels a social link by its name and a website by its host', () => {
    expect(linkLabel({ kind: 'instagram', url: 'https://www.instagram.com/jun.films/' })).toBe('@jun.films');
    expect(linkLabel({ kind: 'tiktok', url: 'https://www.tiktok.com/@jun' })).toBe('@jun');
    expect(linkLabel({ kind: 'instagram', url: 'https://www.instagram.com/p/Cxyz/' })).toBe('instagram.com');
    expect(linkLabel({ kind: 'website', url: 'https://www.jun.studio/about' })).toBe('jun.studio');
  });
});

describe('media import fence (SSRF)', () => {
  it('blocks private, loopback, link-local, CGNAT, multicast and mapped addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '13.32.0.1', '2606:4700::1111']) expect(isBlockedAddress(address), address).toBe(false);
  });

  it('accepts only https URLs on the default port without credentials or local names', () => {
    expect(checkedMediaUrl('https://d8j0ntlcm91z4.cloudfront.net/a.png').hostname).toBe('d8j0ntlcm91z4.cloudfront.net');
    for (const bad of ['http://example.com/a.png', 'https://user:pw@example.com/a', 'https://example.com:8080/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://metadata.internal/a', 'file:///etc/passwd']) {
      expect(() => checkedMediaUrl(bad), bad).toThrow(MediaFetchError);
    }
  });

  it('decodes base64 (or a data URL) within the cap', () => {
    expect(decodeBase64Media('data:image/png;base64,AAEC', 10)).toEqual(new Uint8Array([0, 1, 2]));
    expect(() => decodeBase64Media('A'.repeat(100), 10)).toThrow('too_large');
    expect(() => decodeBase64Media('not base64!', 10)).toThrow(MediaFetchError);
  });
});
