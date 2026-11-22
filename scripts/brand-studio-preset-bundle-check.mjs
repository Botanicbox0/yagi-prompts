#!/usr/bin/env node
/**
 * Checks a built bundle for the server-side preset text of `video-character-sheet`
 * (lib/brand-studio/workflows/presets, docs/STUDIO-PRO-SUITE-V4.md §3). That text must never reach a browser:
 * the modules are `server-only`, so a client import already fails the build; this check looks at the output
 * itself, after `npm run build:local`.
 *
 *   node scripts/brand-studio-preset-bundle-check.mjs [dir=.next/static]
 *
 * Exit 0: `PRESET BUNDLE CHECK PASSED — 0 hits in N files`. Exit 1: the hits. Exit 2: the folder does not exist.
 * Run it on `.next/server` to see it find the text where it belongs (proof that the needles work).
 *
 * The needles come from the founder's text (tests/brand-studio/fixtures/video-character-sheet-prompt.txt), not
 * from a hand-written list: every sentence-ish piece of 40 characters or more without a `{{` placeholder, both as
 * written (with its line breaks) and with the line breaks of its paragraph unwrapped, plus a few short
 * distinctive fragments. A bundler may write a line break as the two characters `\n` and a non-ASCII character
 * such as the em dash as `—` inside a string literal, so those forms are searched too.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRESET_FIXTURE = join(ROOT, 'tests/brand-studio/fixtures/video-character-sheet-prompt.txt');

/** The file types a bundle carries text in. */
export const BUNDLE_EXTENSIONS = ['.js', '.html', '.json', '.css', '.txt', '.map'];

/** Short single-line pieces no other screen or text of the product uses. */
export const DISTINCTIVE_FRAGMENTS = [
  'seamless mid neutral grey',
  'FACE REFERENCE',
  'WARDROBE REFERENCE ONLY',
  'PANEL 1 — LEFT',
  'PANEL 2 — CENTER',
  'PANEL 3 — RIGHT',
  'true achromatic grey',
];

const MIN_NEEDLE = 40;

/** The needles for the founder's text (the fixture file by default). */
export function presetNeedles(text = readFileSync(PRESET_FIXTURE, 'utf8')) {
  const needles = new Set();
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  for (const paragraph of paragraphs) {
    const asWritten = paragraph.trim();
    const unwrapped = asWritten.replace(/[ \t]*\n[ \t]*/g, ' ');
    for (const form of [asWritten, unwrapped]) {
      for (const piece of form.split(/(?<=[.:])\s+/)) {
        const chunk = piece.trim();
        if (chunk.length >= MIN_NEEDLE && !chunk.includes('{{')) needles.add(chunk);
      }
    }
  }
  for (const fragment of DISTINCTIVE_FRAGMENTS) needles.add(fragment);
  return [...needles];
}

/** The ways a needle may be written inside a bundle: as is, with `\n` escaped, with non-ASCII as `\uXXXX`. */
function writtenForms(needle) {
  const forms = new Set([needle]);
  if (needle.includes('\n')) forms.add(needle.replace(/\n/g, '\\n'));
  for (const form of [...forms]) {
    const ascii = form.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    if (ascii !== form) forms.add(ascii);
  }
  return [...forms];
}

/** Every file under `dir` (recursively, sorted) whose type a bundle carries text in. */
export function listBundleFiles(dir) {
  const out = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && BUNDLE_EXTENSIONS.includes(extname(name).toLowerCase())) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/**
 * Every place under `dir` where a needle occurs: `[{ file, needle }]`, `file` relative to `dir`, one entry per
 * file and needle (whichever written form matched).
 */
export function findPresetTextInBundle(dir, needles = presetNeedles()) {
  const searches = needles.map((needle) => ({ needle, forms: writtenForms(needle) }));
  const hits = [];
  for (const path of listBundleFiles(dir)) {
    const body = readFileSync(path, 'utf8');
    for (const { needle, forms } of searches) {
      if (forms.some((form) => body.includes(form))) hits.push({ file: relative(dir, path), needle });
    }
  }
  return hits;
}

function main(argv) {
  const dir = resolve(argv[0] ?? '.next/static');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`PRESET BUNDLE CHECK: folder not found: ${dir} (build first: npm run build:local)\n`);
    return 2;
  }
  const files = listBundleFiles(dir).length;
  const hits = findPresetTextInBundle(dir);
  if (hits.length === 0) {
    process.stdout.write(`PRESET BUNDLE CHECK PASSED — 0 hits in ${files} files\n`);
    return 0;
  }
  const hitFiles = new Set(hits.map((h) => h.file));
  process.stdout.write(`PRESET BUNDLE CHECK FAILED — ${hits.length} hits in ${hitFiles.size} of ${files} files\n`);
  const shown = 40;
  for (const { file, needle } of hits.slice(0, shown)) {
    process.stdout.write(`  ${file}: ${JSON.stringify(needle.length > 90 ? `${needle.slice(0, 90)}…` : needle)}\n`);
  }
  if (hits.length > shown) process.stdout.write(`  … and ${hits.length - shown} more\n`);
  return 1;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
