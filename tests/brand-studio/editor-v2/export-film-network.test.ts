import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The editor's one network exception (flag-gate.test.ts: only `export-film.ts` may make a request, and
 * no component keeps storage, a database or a cache): the frame-exact export has to read the film's own
 * media to decode its sound. This pins how narrow that exception is: one call, only addresses that
 * belong to the film, refused otherwise.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, 'components/brand-studio/editor-v2');
const EXPORTER = 'export-film.ts';
const NETWORK = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource'];

describe('what the export may request', () => {
  const source = readFileSync(join(DIR, EXPORTER), 'utf8');

  it('the exporter has exactly one fetch call and no other network API', () => {
    expect(source.match(/\bfetch\(/g) ?? []).toHaveLength(1);
    for (const banned of NETWORK.filter((name) => name !== 'fetch(')) expect(source.includes(banned), banned).toBe(false);
  });

  it('that call sits behind the film-media allow list and asks only for the film’s own file', () => {
    const reader = source.slice(source.indexOf('function mediaReader('), source.indexOf('async function mixSound('));
    expect(reader).toContain('fetch(');
    // The refusal comes before the request.
    expect(reader.indexOf('if (!allowed.has(url)) throw')).toBeGreaterThan(-1);
    expect(reader.indexOf('if (!allowed.has(url)) throw')).toBeLessThan(reader.indexOf('fetch('));
    // The address is the allowed one, only rewritten for the media domain's cache entry; cookies stay on this
    // site. The method is GET (the bytes) or HEAD (only the size, checked before the export starts).
    expect(reader).toMatch(/fetch\(corsMediaUrl\(url\), \{ method, credentials: 'same-origin', signal \}\)/);
    expect(reader).toMatch(/method: 'GET' \| 'HEAD'/);
    // The allow list is the film's own media and nothing else.
    expect(source).toMatch(/mediaReader\(soundSourceUrls\(sequence, extras\), signal\)/);
  });

  it('the allow list holds the cuts and the stored film’s music and effects only', () => {
    const plan = readFileSync(join(ROOT, 'lib/brand-studio/editor-v2/export-plan.ts'), 'utf8');
    const body = plan.slice(plan.indexOf('export function soundSourceUrls('), plan.indexOf('// ── Labels'));
    const added = [...body.matchAll(/urls\.add\(([^)]+)\)/g)].map((m) => m[1]);
    expect(added).toEqual(['clip.srcUrl', 'extras.bgm.srcUrl', 'sfx.srcUrl']);
  });
});
