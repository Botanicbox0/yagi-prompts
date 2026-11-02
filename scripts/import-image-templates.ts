import { config as loadEnv } from 'dotenv';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Client } from 'pg';
import sharp from 'sharp';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { buildImageTemplateSet, parseImageTemplateManifest, registerImageTemplateSet, type ImageTemplateSet, type PosterImage } from '@/lib/prompts/image-templates';
import { RUNTIME_MODE_ENV } from '@/lib/runtime-mode';
import type { StorageDriver } from '@/lib/storage';

/**
 * `npm run templates:import -- <manifest.json> --set <set.json> [--target local|cloud] [--apply]`
 *
 * Registers a studio IMAGE SET — one template that makes every manifest entry from one order — from
 * a production manifest plus a set file naming it (`content/templates/*.json`: slug, titles,
 * thumbnail). lib/prompts/image-templates.ts has the rules. Each entry's `file_name` sits next to
 * the manifest.
 *
 *   (no --apply)     validate both files, encode the images, print the plan. Writes nothing.
 *   --target local   the default: the local snapshot (`.pglite/catalog.tar.gz`) and `.storage/`.
 *                    `npm run db:local` rebuilds the snapshot from fixtures and drops the set, so
 *                    run this again after it.
 *   --target cloud   `DATABASE_URL` + Supabase storage from `.env.local` — twings.app itself. The
 *                    set is live once the catalogue cache turns over (tag `prompts`, ≤ 1 h) or at
 *                    the next `/admin` template action, which revalidates it.
 *
 * Images: the manifest's 2K PNGs are ~6 MB each and the pages render a plain `<img>` (no loader,
 * next.config.ts), so they are re-encoded to WebP at the same pixel size. Prompts are never touched.
 */

const WEBP_QUALITY = 88;
/** An image whose shape is further than this from the set's aspect is the wrong file. */
const ASPECT_TOLERANCE = 0.02;

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? null : (argv[index + 1] ?? '');
}

async function encodeImage(path: string, set: ImageTemplateSet): Promise<PosterImage> {
  const { data, info } = await sharp(await readFile(path)).webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  const [w, h] = set.aspect.split(':').map(Number) as [number, number];
  if (Math.abs(info.width / info.height - w / h) / (w / h) > ASPECT_TOLERANCE) {
    throw new Error(`${path} is ${info.width}x${info.height}, not ${set.aspect}`);
  }
  return { bytes: new Uint8Array(data), mime: 'image/webp', w: info.width, h: info.height };
}

function runnerFor(query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>): SqlRunner {
  return makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    const res = await query(text, params);
    return { rows: res.rows as T[] };
  });
}

async function main(): Promise<void> {
  const manifestPath = process.argv.slice(2).find((arg, index, argv) => arg.endsWith('.json') && argv[index - 1] !== '--set');
  const setPath = flag('set');
  if (!manifestPath || !setPath) {
    console.error('usage: npm run templates:import -- <manifest.json> --set <set.json> [--target local|cloud] [--apply]');
    process.exitCode = 1;
    return;
  }
  const target = flag('target') ?? 'local';
  if (target !== 'local' && target !== 'cloud') {
    console.error(`--target must be local or cloud, not ${target}`);
    process.exitCode = 1;
    return;
  }
  const apply = process.argv.includes('--apply');

  const manifest = parseImageTemplateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!manifest.ok) {
    console.error(`manifest refused:\n  ${manifest.errors.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  const built = buildImageTemplateSet(JSON.parse(await readFile(setPath, 'utf8')), manifest.frames);
  if (!built.ok) {
    console.error(`set refused:\n  ${built.errors.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  const set = built.set;

  const folder = dirname(resolve(manifestPath));
  const images = new Map<string, PosterImage>();
  for (const fileName of new Set([set.thumbnail, ...set.frames.map((frame) => frame.fileName)])) {
    images.set(fileName, await encodeImage(join(folder, fileName), set));
  }
  console.log(`${set.slug}  "${set.titleKo}" / "${set.title}"  ${set.engine} ${set.aspect}  thumbnail ${set.thumbnail}`);
  set.frames.forEach((frame, index) => {
    const image = images.get(frame.fileName)!;
    const sha = createHash('sha256').update(frame.promptText).digest('hex').slice(0, 12);
    console.log(
      `  shot${index + 1}  ${frame.key}  ${image.w}x${image.h} ${Math.round(image.bytes.byteLength / 1024)} KB  prompt ${frame.promptText.length} chars sha256:${sha}`,
    );
  });
  if (!apply) {
    console.log(`\ndry run (${target}): one set of ${set.frames.length} frames is valid. Add --apply to write.`);
    return;
  }

  let sql: SqlRunner;
  let storage: StorageDriver;
  let finish: () => Promise<void>;

  if (target === 'local') {
    process.env[RUNTIME_MODE_ENV] = 'local';
    const snapshot = resolve(process.env.PLAYBOOK_LOCAL_DB ?? DEFAULT_LOCAL_SNAPSHOT);
    const db = new PGlite({ loadDataDir: new Blob([new Uint8Array(await readFile(snapshot))]) });
    sql = runnerFor((text, params) => db.query(text, params as never[]));
    const { createLocalStorageDriver } = await import('@/lib/storage/local-driver');
    storage = createLocalStorageDriver();
    finish = async () => {
      const dump = await db.dumpDataDir('gzip');
      await mkdir(dirname(snapshot), { recursive: true });
      await writeFile(snapshot, new Uint8Array(await dump.arrayBuffer()));
      await db.close();
      console.log(`local snapshot updated: ${snapshot}`);
    };
  } else {
    loadEnv({ path: ['.env.local', '.env'], quiet: true });
    process.env[RUNTIME_MODE_ENV] = 'cloud';
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set (.env.local).');
      process.exitCode = 1;
      return;
    }
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    sql = runnerFor((text, params) => client.query(text, params));
    const { createSupabaseStorageDriver } = await import('@/lib/storage/supabase-driver');
    storage = createSupabaseStorageDriver();
    finish = () => client.end();
  }

  try {
    const outcome = await registerImageTemplateSet({ sql, storage }, set, (fileName) => images.get(fileName)!);
    console.log(outcome.status === 'created' ? `created  ${outcome.slug}` : `exists   ${outcome.slug} (left as it is)`);
  } finally {
    await finish();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
