import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_MATERIALS, FIXTURE_REFERENCES } from '@/lib/brand-studio/editor-v2/fixture';
import { brandRouteAllowed } from '@/lib/routing/surfaces';

/**
 * The prototype's sample files must load where the prototype runs: on the workspace host.
 *
 * 2026-11-20, production: two sample films were committed and loaded on twings.app, but
 * brand.twings.app serves public files by exact name only (`STUDIO_DEMO_FILES`), so they answered 404
 * there: black thumbnails in the bin, an empty cut on the timeline and one colour finding missing.
 * A file that merely exists on disk is not enough.
 */
const paths = [
  ...FIXTURE_MATERIALS.flatMap((material) => [material.src, material.poster]),
  ...FIXTURE_REFERENCES.map((reference) => reference.src),
];
const root = process.cwd();

describe('editing studio v2 sample files are served on the workspace host', () => {
  it('uses root-relative paths under /reel with no query, traversal or other origin', () => {
    for (const path of paths) expect(path, path).toMatch(/^\/reel\/[a-z0-9/_.-]+\.(?:mp4|jpg|jpeg|png|webp)$/);
    for (const path of paths) expect(path.includes('..'), path).toBe(false);
  });

  it('opens every sample file on the brand host for GET and HEAD, and for nothing else', () => {
    for (const path of paths) {
      expect(brandRouteAllowed(path, 'GET'), `${path} is not on the brand host's public file list`).toBe(true);
      expect(brandRouteAllowed(path, 'HEAD'), path).toBe(true);
      expect(brandRouteAllowed(path, 'POST'), path).toBe(false);
    }
  });

  it('would have caught the two films that failed on production', () => {
    expect(brandRouteAllowed('/reel/landing/v7/film-aquarium.mp4', 'GET')).toBe(false);
    expect(brandRouteAllowed('/reel/landing/v7/film-daydream.jpg', 'GET')).toBe(false);
  });

  it('points only at files that exist and are committed, so the deployed build carries them', () => {
    for (const path of paths) expect(existsSync(join(root, 'public', path)), `${path} is missing under public/`).toBe(true);
    const tracked = new Set(
      execFileSync('git', ['ls-files', '--', ...paths.map((path) => `public${path}`)], { cwd: root, encoding: 'utf8', windowsHide: true })
        .split(/\r?\n/)
        .filter(Boolean),
    );
    for (const path of paths) expect(tracked.has(`public${path}`), `${path} is not tracked by git`).toBe(true);
  });

  it('gives every material its own film and every film a poster beside it', () => {
    expect(new Set(FIXTURE_MATERIALS.map((material) => material.src)).size).toBe(FIXTURE_MATERIALS.length);
    for (const material of FIXTURE_MATERIALS) {
      expect(material.poster.replace(/\.(?:jpg|jpeg|png|webp)$/, ''), material.id).toBe(material.src.replace(/\.mp4$/, ''));
    }
  });
});
