import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dismissBrandAnnouncement } from '@/components/brand-workspace/news-api';

/**
 * docs/BRAND-PROJECT-SPINE.md §6, slice 3b: the browser's one call (close the announcement) and where the slot's
 * server code may be used from.
 */
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('dismissBrandAnnouncement', () => {
  it('posts news.dismiss to the workspace door, same origin, and hands back the answer', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply(200, { ok: true });
    }) as unknown as typeof fetch;
    expect(await dismissBrandAnnouncement('org-1', 'news-1', fetcher)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/brand-workspace');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ operation: 'news.dismiss', input: { organizationId: 'org-1', announcementId: 'news-1' } });
  });

  it('names every other answer', async () => {
    const answer = (status: number, body: unknown) => dismissBrandAnnouncement('o', 'n', (async () => reply(status, body)) as unknown as typeof fetch);
    expect(await answer(404, { ok: false, code: 'not_found' })).toEqual({ ok: false, code: 'not_found' });
    expect(await answer(400, { ok: false, code: 'invalid' })).toEqual({ ok: false, code: 'closed' });
    expect(await answer(401, { ok: false, code: 'sign_in_required' })).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await answer(503, { ok: false, code: 'storage_unavailable' })).toEqual({ ok: false, code: 'failed' });
    expect(await answer(403, { ok: false, code: 'forbidden' })).toEqual({ ok: false, code: 'failed' });
    expect(await answer(200, { ok: false })).toEqual({ ok: false, code: 'failed' });
    expect(await dismissBrandAnnouncement('o', 'n', (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch)).toEqual({ ok: false, code: 'failed' });
    expect(
      await dismissBrandAnnouncement('o', 'n', (async () => {
        throw new TypeError('network');
      }) as unknown as typeof fetch),
    ).toEqual({ ok: false, code: 'offline' });
  });
});

describe('where the slot’s server code is used from', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const files = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((name) => {
      const rel = path.join(dir, name);
      if (name === 'node_modules' || name.startsWith('.')) return [];
      return statSync(path.join(ROOT, rel)).isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(name) ? [rel.replace(/\\/g, '/')] : [];
    });
  const code = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const all = [...files('app'), ...files('components'), ...files('lib')];

  it('the service is imported only by server code: the workspace door, the admin operations, and the two pages that come next', () => {
    const users = all.filter((file) => /brand-news\/service/.test(code(file)) && !file.startsWith('lib/brand-news/'));
    expect(users).toEqual(expect.arrayContaining(['app/api/brand-workspace/route.ts', 'lib/admin/brand-news-operations.ts']));
    // The screen half adds the home page and the admin page; nothing else (no client component) may import it.
    const allowed = /^(app\/api\/brand-workspace\/route\.ts|lib\/admin\/brand-news-operations\.ts|app\/\(brand\)\/brand\/home\/page\.tsx|app\/\(admin\)\/admin\/brand-news\/.+\.tsx?)$/;
    for (const file of users) expect(file, file).toMatch(allowed);
  });

  it('nothing under components/ imports the server module; the client method reads the pure contracts only', () => {
    for (const file of all.filter((f) => f.startsWith('components/'))) expect(code(file), file).not.toMatch(/brand-news\/service|brand-news-operations/);
    expect(code('components/brand-workspace/news-api.ts')).toMatch(/@\/lib\/brand-news\/contracts/);
    expect(code('lib/brand-news/contracts.ts')).not.toMatch(/from ['"](@\/lib\/(db|flags|brands|content)|node:|next\/)/);
  });
});
