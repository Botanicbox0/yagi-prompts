/**
 * The bundle check behind `video-character-sheet` (scripts/brand-studio-preset-bundle-check.mjs): the server-side
 * text of lib/brand-studio/workflows/presets must never reach a browser bundle. The needles come from the founder
 * fixture itself, so the check follows the text if it ever changes. No `.next` is needed here: every case runs on a
 * temporary folder.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error -- plain Node module of the bundle check, without type declarations
import { findPresetTextInBundle, listBundleFiles, presetNeedles } from '@/scripts/brand-studio-preset-bundle-check.mjs';
import { renderVideoCharacterSheetPrompt } from '@/lib/brand-studio/workflows/presets/video-character-sheet';

type Hit = { file: string; needle: string };
const needlesOf = presetNeedles as () => string[];
const find = findPresetTextInBundle as (dir: string, needles?: string[]) => Hit[];
const filesIn = listBundleFiles as (dir: string) => string[];

/** The founder's own values: the rendered text is then the fixture with its three placeholders filled. */
const FOUNDER = renderVideoCharacterSheetPrompt({
  faceBound: 'thin gold-rimmed glasses, light stubble along the jaw, short black hair parted on the right',
  fashionText: 'a camel wool overcoat with notch lapels and two horn buttons, a cream merino turtleneck, charcoal pleated trousers, black leather derby shoes',
  build: 'a man in his early thirties, tall, with a lean athletic build',
  image1Wardrobe: 'the charcoal t-shirt',
});

const dirs: string[] = [];
function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'preset-bundle-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SCRIPT = 'scripts/brand-studio-preset-bundle-check.mjs';
function cli(dir: string) {
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', windowsHide: true });
}

describe('preset bundle check', () => {
  it('derives a non-trivial needle list from the fixture, every needle a real piece of the rendered text', () => {
    const needles = needlesOf();
    expect(needles.length).toBeGreaterThanOrEqual(30);
    expect(new Set(needles).size).toBe(needles.length);
    const unwrapped = FOUNDER.replace(/\n/g, ' ');
    for (const needle of needles) {
      expect(needle.includes('{{'), needle).toBe(false);
      expect(FOUNDER.includes(needle) || unwrapped.includes(needle), needle).toBe(true);
    }
    // Both forms of a wrapped sentence, and the short distinctive fragments.
    expect(needles).toContain('A photorealistic three-panel character reference sheet — a real photograph taken on a real\ncamera in a professional studio, not an illustration or a render.');
    expect(needles).toContain('A photorealistic three-panel character reference sheet — a real photograph taken on a real camera in a professional studio, not an illustration or a render.');
    for (const fragment of ['seamless mid neutral grey', 'FACE REFERENCE', 'PANEL 1 — LEFT']) expect(needles).toContain(fragment);
  });

  it('finds nothing in a clean folder and skips files it does not read', () => {
    const dir = tempDir({
      'chunks/app.js': 'export const title = "영상화용 캐릭터 시트 생성기"; const why = "Grey backdrop, one light";',
      'page.html': '<p>Character Sheet for Video</p>',
      'data.json': JSON.stringify({ starters: ['video-character-sheet'] }),
      'image.png': 'seamless mid neutral grey',
    });
    expect(filesIn(dir)).toHaveLength(3);
    expect(find(dir)).toEqual([]);
  });

  it('finds one template sentence, plain or as an escaped string literal, in any read file type', () => {
    const sentence = 'Image 2 is the WARDROBE REFERENCE ONLY — ignore its face, body, pose, background, lighting\nand color grade entirely.';
    expect(FOUNDER).toContain(sentence);
    const plain = tempDir({ 'static/chunks/leak.js': `var a = \`${sentence}\`;` });
    const plainHits = find(plain);
    expect(plainHits.map((h) => h.needle)).toContain(sentence);
    expect(plainHits.every((h) => h.file.replace(/\\/g, '/') === 'static/chunks/leak.js')).toBe(true);

    // A bundler keeps the line break as the two characters `\n` inside a quoted string (JSON.stringify does the same).
    const escaped = tempDir({ 'leak.txt': `var a = ${JSON.stringify(sentence)};` });
    expect(find(escaped).map((h) => h.needle)).toContain(sentence);
    // …and may write a non-ASCII character such as the em dash as `—`.
    const ascii = tempDir({ 'leak.map': JSON.stringify(sentence).replace(/—/g, '\\u2014') });
    expect(find(ascii).map((h) => h.needle)).toContain(sentence);
    // A distinctive fragment alone is enough.
    expect(find(tempDir({ 'a.css': '/* seamless mid neutral grey */' })).map((h) => h.needle)).toEqual(['seamless mid neutral grey']);
  });

  it('CLI: passes on a clean folder, fails with the hits, and stops on a missing folder', () => {
    const clean = cli(tempDir({ 'a.js': 'console.log(1)', 'b.html': '<p></p>' }));
    expect(clean.status).toBe(0);
    expect(clean.stdout.trim()).toBe('PRESET BUNDLE CHECK PASSED — 0 hits in 2 files');

    const leaking = cli(tempDir({ 'a.js': 'console.log("FACE REFERENCE")' }));
    expect(leaking.status).toBe(1);
    expect(leaking.stdout).toContain('PRESET BUNDLE CHECK FAILED');
    expect(leaking.stdout).toContain('FACE REFERENCE');

    const missing = cli(join(tmpdir(), `no-such-bundle-${Date.now()}`));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('not found');
  });
});
