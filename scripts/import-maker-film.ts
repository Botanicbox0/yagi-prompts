import { config as loadEnv } from 'dotenv';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { Client } from 'pg';
import sharp from 'sharp';
import { DEFAULT_LOCAL_SNAPSHOT } from '@/lib/db/connect-shared';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { buildMakerFilm, registerMakerFilm, type FilmMedia } from '@/lib/prompts/maker-film';
import { quoteRecipe } from '@/lib/recipes/pricing';
import { RUNTIME_MODE_ENV } from '@/lib/runtime-mode';
import type { StorageDriver } from '@/lib/storage';

/**
 * `npm run templates:film -- <template.json> --prompt <prompt.txt> --video <master.mp4> --poster-at <s> [--target local|cloud] [--apply]`
 *
 * Registers a creative's film as their template (lib/prompts/maker-film.ts has the rules): the
 * template file (`content/templates/*.json`), the post's prompt as written (`@Image 1` = the photo)
 * and the mastered film. The creative must already be an active maker with a public profile.
 *
 *   (no --apply)     check everything, print the plan. Writes nothing.
 *   --target local   the default: the local snapshot (`.pglite/catalog.tar.gz`) and `.storage/`.
 *   --target cloud   `DATABASE_URL` + Supabase storage from `.env.local` — twings.app itself. Live once
 *                    the catalogue cache turns over (tag `prompts`, ≤ 1 h) or the next `/admin`
 *                    template action revalidates it.
 *
 * The film is remuxed with `+faststart` (no re-encode) so a phone starts playing before the whole
 * file arrives; the poster is the frame at `--poster-at`, full size, JPEG. Needs ffmpeg/ffprobe.
 */

const run = promisify(execFile);

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? null : (argv[index + 1] ?? '');
}

async function probe(path: string): Promise<{ w: number; h: number; seconds: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path], { windowsHide: true });
  const info = JSON.parse(stdout) as { streams: Array<{ width: number; height: number }>; format: { duration: string } };
  return { w: info.streams[0]!.width, h: info.streams[0]!.height, seconds: Math.round(Number(info.format.duration) * 100) / 100 };
}

async function media(videoPath: string, posterAt: number, work: string): Promise<FilmMedia> {
  const film = join(work, 'film.mp4');
  const frame = join(work, 'poster.png');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', videoPath, '-c', 'copy', '-movflags', '+faststart', film], { windowsHide: true });
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(posterAt), '-i', videoPath, '-frames:v', '1', frame], { windowsHide: true });
  const shape = await probe(film);
  const { data, info } = await sharp(await readFile(frame)).jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return {
    video: { bytes: new Uint8Array(await readFile(film)), mime: 'video/mp4', w: shape.w, h: shape.h, seconds: shape.seconds },
    poster: { bytes: new Uint8Array(data), mime: 'image/jpeg', w: info.width, h: info.height },
  };
}

function runnerFor(query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>): SqlRunner {
  return makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    const res = await query(text, params);
    return { rows: res.rows as T[] };
  });
}

async function main(): Promise<void> {
  const templatePath = process.argv.slice(2).find((arg, index, argv) => arg.endsWith('.json') && !argv[index - 1]?.startsWith('--'));
  const promptPath = flag('prompt');
  const videoPath = flag('video');
  const posterAt = Number(flag('poster-at') ?? 'NaN');
  if (!templatePath || !promptPath || !videoPath || !Number.isFinite(posterAt)) {
    console.error('usage: npm run templates:film -- <template.json> --prompt <prompt.txt> --video <master.mp4> --poster-at <seconds> [--target local|cloud] [--apply]');
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

  const built = buildMakerFilm(JSON.parse(await readFile(templatePath, 'utf8')), await readFile(promptPath, 'utf8'));
  if (!built.ok) {
    console.error(`refused:\n  ${built.errors.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  const film = built.film;
  const work = await mkdtemp(join(tmpdir(), 'twings-film-'));
  try {
    const files = await media(videoPath, posterAt, work);
    const quote = quoteRecipe(film.recipe, film.royalty_krw);
    console.log(`${film.slug}  "${film.title_ko}" / "${film.title_en}"  by @${film.handle}`);
    console.log(`  ${film.engine} ${film.aspect} ${film.duration}s ${film.resolution}  price ${film.price_krw}원 (floor ${quote.floorKrw}원, royalty ${film.royalty_krw}원)`);
    console.log(`  film ${files.video.w}x${files.video.h} ${files.video.seconds}s ${Math.round(files.video.bytes.byteLength / 1024)} KB · poster ${files.poster.w}x${files.poster.h} ${Math.round(files.poster.bytes.byteLength / 1024)} KB @ ${posterAt}s`);
    console.log(`  prompt ${film.recipe.steps[0]!.prompt.length} chars · ${film.presentation} · disclosure ${JSON.stringify(film.disclosure)}`);
    if (!apply) {
      console.log(`\ndry run (${target}): valid. Add --apply to write.`);
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
      const outcome = await registerMakerFilm({ sql, storage }, film, files);
      console.log(outcome.status === 'created' ? `created  ${outcome.slug} (${outcome.id})` : `exists   ${outcome.slug} (left as it is)`);
    } finally {
      await finish();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
