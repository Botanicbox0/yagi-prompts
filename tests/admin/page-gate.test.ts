import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The admin layout checks `is_admin`, but a layout is not a gate for its pages: Next renders layout and
 * page segments independently, and a client navigation request can ask for the page segment alone.
 * A signed-in non-admin could then read a page's data without the layout ever running. So every admin
 * page must verify the admin itself, before it loads anything.
 */
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

describe('admin pages', () => {
  const root = process.cwd();
  const files = pages(join(root, 'app', '(admin)'));

  it('finds the admin pages', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files.map((file) => [file.slice(root.length + 1).split(sep).join('/'), file]))('%s checks the admin itself', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const body = source.slice(source.indexOf('export default'));
    // Either the throwing check, or a viewer read that is tested for `isAdmin`.
    expect(body.includes('requireAdmin()') || body.includes('.isAdmin')).toBe(true);
  });
});
