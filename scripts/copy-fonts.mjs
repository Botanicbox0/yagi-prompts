/**
 * Font pipeline (PLAN §5.2) — npm-first, self-hosted, no runtime CDN.
 *
 *   assets/fonts/                  WOFF2 sources consumed by next/font/local (exact fallback
 *                                  metrics + automatic preload; see app/fonts.ts)
 *   public/fonts/pretendard/       Pretendard Variable dynamic subset (vendor CSS + 92 slices),
 *                                  linked directly because unicode-range subsets cannot go
 *                                  through next/font/local
 *   public/fonts/LICENSES/         license files, committed
 *
 * Run: npm run fonts   (idempotent; re-run after bumping a font package)
 */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nm = (...p) => join(root, 'node_modules', ...p);
const out = (...p) => join(root, ...p);

const FACES = [
  {
    from: nm('@fontsource/big-shoulders/files/big-shoulders-latin-700-normal.woff2'),
    to: out('assets/fonts/big-shoulders-latin-700.woff2'),
  },
  {
    from: nm('@fontsource/big-shoulders/files/big-shoulders-latin-900-normal.woff2'),
    to: out('assets/fonts/big-shoulders-latin-900.woff2'),
  },
  {
    from: nm('@fontsource/anton-sc/files/anton-sc-latin-400-normal.woff2'),
    to: out('assets/fonts/anton-sc-latin-400.woff2'),
  },
  {
    from: nm('geist/dist/fonts/geist-mono/GeistMono-Regular.woff2'),
    to: out('assets/fonts/geist-mono-400.woff2'),
  },
];

const LICENSES = [
  { from: nm('@fontsource/big-shoulders/LICENSE'), to: out('public/fonts/LICENSES/OFL-BigShoulders.txt') },
  { from: nm('@fontsource/anton-sc/LICENSE'), to: out('public/fonts/LICENSES/OFL-AntonSC.txt') },
  { from: nm('pretendard/dist/LICENSE.txt'), to: out('public/fonts/LICENSES/OFL-Pretendard.txt') },
  { from: nm('geist/LICENSE.txt'), to: out('public/fonts/LICENSES/OFL-Geist.txt') },
];

const PRETENDARD_CSS_SRC = nm('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css');
const PRETENDARD_SUBSET_SRC = nm('pretendard/dist/web/variable/woff2-dynamic-subset');
const PRETENDARD_DEST = out('public/fonts/pretendard');

async function copyFile(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to);
}

async function main() {
  for (const { from, to } of [...FACES, ...LICENSES]) {
    await copyFile(from, to);
    console.log(`· ${to.replace(root, '')}`);
  }

  // Pretendard keeps its vendor-relative ./woff2-dynamic-subset/ paths, so the tree is copied verbatim.
  await mkdir(join(PRETENDARD_DEST, 'woff2-dynamic-subset'), { recursive: true });
  const slices = await readdir(PRETENDARD_SUBSET_SRC);
  for (const slice of slices) {
    await copyFile(
      join(PRETENDARD_SUBSET_SRC, slice),
      join(PRETENDARD_DEST, 'woff2-dynamic-subset', slice),
    );
  }
  const css = await readFile(PRETENDARD_CSS_SRC, 'utf8');
  await writeFile(join(PRETENDARD_DEST, 'pretendard-dynamic-subset.css'), css, 'utf8');
  console.log(`· public/fonts/pretendard (${slices.length} subset slices + css)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
