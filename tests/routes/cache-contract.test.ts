import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_TAG, CATALOG_TTL_SECONDS } from '@/lib/cache';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

function sourcesUnder(...parts: string[]): string[] {
  const base = join(ROOT, ...parts);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(base);
  return out;
}

/**
 * PLAN §4 route table + §3.4 cache contract.
 *
 * Static marketing surfaces vs `force-dynamic` + `private, no-store` viewer-shaped surfaces is a
 * security property, not a performance preference: a cached gated page is a leak. These
 * assertions are cheap and fail loudly if someone flips a segment config by accident.
 */
describe('route cache modes (§3.4 / §4)', () => {
  it('keeps landing and pricing static with the catalog TTL floor', () => {
    for (const file of [
      ['app', '(marketing)', '[locale]', 'page.tsx'],
      ['app', '(marketing)', '[locale]', 'pricing', 'page.tsx'],
    ]) {
      const source = read(...file);
      expect(source, file.join('/')).toContain(`export const revalidate = ${CATALOG_TTL_SECONDS}`);
      expect(source, file.join('/')).not.toContain("dynamic = 'force-dynamic'");
      // dynamic APIs would silently downgrade these to SSR
      expect(source, file.join('/')).not.toContain('next/headers');
    }
    expect(CATALOG_TAG).toBe('catalog');
  });

  it('reads the catalog through the tagged projection, not a fixture shortcut', () => {
    for (const file of [
      ['app', '(marketing)', '[locale]', 'page.tsx'],
      ['app', '(marketing)', '[locale]', 'pricing', 'page.tsx'],
    ]) {
      expect(read(...file), file.join('/')).toContain(
        "from '@/lib/content/public-catalog'",
      );
    }
    const projection = read('lib', 'content', 'public-catalog.ts');
    expect(projection).toContain('unstable_cache');
    expect(projection).toContain('tags: [CATALOG_TAG]');
    expect(projection).toContain('revalidate: CATALOG_TTL_SECONDS');
  });

  /**
   * §3.1's cache mode is load-bearing, and the easiest way to lose it is a nav that renders
   * "Sign in / avatar" from the session: one `cookies()` anywhere in the marketing tree and both
   * pages become SSR. Authed chrome lives in the (app) group; the marketing nav is static.
   */
  it('never reads the session anywhere on the marketing surface', () => {
    const forbidden = [
      'next/headers',
      'getSessionUser',
      'auth-client',
      'data-client',
      'createDataClient',
    ];
    const files = [
      ...sourcesUnder('app', '(marketing)'),
      ...sourcesUnder('components', 'landing'),
      ...sourcesUnder('components', 'nav'),
      ...sourcesUnder('components', 'ad'),
      ...sourcesUnder('components', 'pricing'),
      ...sourcesUnder('components', 'ui'),
      ...sourcesUnder('components', 'marketing'),
      ...sourcesUnder('components', 'motion'),
    ];
    expect(files.length).toBeGreaterThan(15);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        expect(source.includes(needle), `${relative(ROOT, file)} must not use ${needle}`).toBe(
          false,
        );
      }
    }
  });

  it('forces every viewer-shaped surface dynamic', () => {
    for (const file of [
      ['app', '(app)', 'layout.tsx'],
      ['app', '(app)', 'library', 'page.tsx'],
      ['app', '(app)', 'account', 'page.tsx'],
      ['app', '(app)', 'billing', 'success', 'page.tsx'],
      ['app', '(app)', 'billing', 'cancelled', 'page.tsx'],
      ['app', '(admin)', 'layout.tsx'],
      ['app', '(admin)', 'admin', 'page.tsx'],
      ['app', 'api', 'media', '[blockId]', 'route.ts'],
      ['app', 'api', 'stripe', 'webhook', 'route.ts'],
    ]) {
      expect(read(...file), file.join('/')).toContain("export const dynamic = 'force-dynamic'");
    }
  });

  it('marks the app and admin surfaces noindex', () => {
    expect(read('app', '(app)', 'layout.tsx')).toContain('robots');
    expect(read('app', '(admin)', 'layout.tsx')).toContain('robots');
    expect(read('middleware.ts')).toContain("'X-Robots-Tag', 'noindex, nofollow'");
  });

  it('gates the admin surface on is_admin in the layout, not only at the edge', () => {
    const layout = read('app', '(admin)', 'layout.tsx');
    expect(layout).toContain('requireAdmin');
    expect(layout).toContain('notFound');
  });
});

describe('stub route handlers (§4)', () => {
  it('/api/media/[blockId] answers 501 with no-store until M2', async () => {
    const { GET } = await import('@/app/api/media/[blockId]/route');
    const response = await GET(new Request('http://localhost/api/media/abc'), {
      params: Promise.resolve({ blockId: 'abc' }),
    });
    expect(response.status).toBe(501);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ milestone: 'M2' });
  });

  it('/api/stripe/webhook answers 501 with no-store until M3', async () => {
    const { POST } = await import('@/app/api/stripe/webhook/route');
    const response = await POST();
    expect(response.status).toBe(501);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ milestone: 'M3' });
  });
});

describe('notification surface does not exist before M5 (§3.5)', () => {
  it('forces p_notify_kind to NULL through the server flag', () => {
    expect(read('lib', 'flags.ts')).toContain('export const NOTIFICATIONS_ENABLED = false');
    expect(read('lib', 'publish', 'pipeline.ts')).toContain(
      'NOTIFICATIONS_ENABLED ? (args.notifyKind ?? null) : null',
    );
  });
});
