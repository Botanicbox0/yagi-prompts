import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG_TTL_SECONDS } from '@/lib/cache';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the template style must not make the shared lists dynamic: the viewer's choice
 * reaches them through a first-party cookie read IN THE BROWSER, never through `cookies()`, `next/headers` or
 * `searchParams` in a server component. (tests/routes/cache-contract.test.ts pins the pages; this pins what the
 * feature added under them.)
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

describe('the template style keeps the lists static', () => {
  const files = [
    ...readdirSync(join(ROOT, 'components', 'template-look')).map((name) => ['components', 'template-look', name]),
    ['components', 'templates', 'listing.tsx'],
    ['components', 'templates', 'cast-page.tsx'],
    ['components', 'prompts', 'rails.tsx'],
    ['components', 'prompts', 'detail.tsx'],
    ['components', 'audience', 'sequence-dispatch.tsx'],
    ['lib', 'template-look', 'look.ts'],
    ['lib', 'template-look', 'store.ts'],
  ];

  for (const file of files) {
    it(`${file.join('/')} reads no request state on the server`, () => {
      const source = code(read(...file));
      expect(source).not.toContain('next/headers');
      expect(source).not.toMatch(/\bcookies\(\)/);
      expect(source).not.toContain('searchParams');
    });
  }

  it('the list pages keep their static posture', () => {
    for (const page of [['video'], ['image'], ['t', '[slug]'], ['makers', '[handle]']]) {
      const source = read('app', '(marketing)', '[locale]', ...page, 'page.tsx');
      expect(source).toContain(`export const revalidate = ${CATALOG_TTL_SECONDS}`);
      expect(source).not.toContain("dynamic = 'force-dynamic'");
    }
  });
});
