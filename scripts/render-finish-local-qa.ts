/**
 * Local-only browser QA fixture for the render-finish work (docs/qa/render-finish/). Never reads an
 * env file, never calls a provider or sends mail. Every row is synthetic and belongs to the `free`
 * fixture profile, so `npm run dev:free` sees them as its own.
 *
 *   mkdir .pglite/render-finish-qa                                         # once (PGlite does not create parents)
 *   npx tsx scripts/db-local.ts --dir .pglite/render-finish-qa/data      # the usual fixtures, durable
 *   npx tsx scripts/render-finish-local-qa.ts                            # the two jobs below; prints their ids
 *   PLAYBOOK_LOCAL_DB_DIR=.pglite/render-finish-qa/data PORT=3013 npm run dev:free
 *
 *   finishing  running, no provider task (the page's own pass leaves it alone), `finishing_at` set
 *              → /renders/{id} shows the third stage, "마무리"
 *   finished   a succeeded film whose result is a real mp4 copied into `.storage/renders/{id}/`
 *              → /renders/{id} captures its frame in the browser; /r/{id}/{token} then carries it
 *
 * One process at a time: PGlite holds a lock on the data directory, so stop this before `dev:free`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { FIXTURE_USERS } from './fixtures';

const root = resolve(process.cwd());
const dbDir = join(root, '.pglite', 'render-finish-qa', 'data');
const TEMPLATE = 'neon-alley-dolly';
const SAMPLE = join(root, 'public', 'reel', 'brands', 'morphic-august-01.mp4');

async function main() {
  if (!existsSync(dbDir)) throw Error(`Run first: npx tsx scripts/db-local.ts --dir ${dbDir}`);
  const db = new PGlite({ dataDir: dbDir });
  await db.waitReady;
  try {
    const template = (await db.query<{ id: string }>('select id from prompt_items where slug = $1', [TEMPLATE])).rows[0];
    if (!template) throw Error(`no ${TEMPLATE} in the fixture database`);
    const user = FIXTURE_USERS.free.id;
    const now = Date.now();

    const finishing = randomUUID();
    await db.query(
      `insert into render_jobs (id, user_id, template_id, template_slug, medium, engine, aspect, locale, status, attempts, claimed_at, started_at, finishing_at, created_at)
       values ($1, $2, $3, $4, 'video', 'seedance-2.0', '9:16', 'ko', 'running', 1, $5, $5, $6, $5)`,
      [finishing, user, template.id, TEMPLATE, new Date(now - 4 * 60_000), new Date(now - 10_000)],
    );

    const finished = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const resultKey = `${finished}/result.mp4`;
    await mkdir(join(root, '.storage', 'renders', finished), { recursive: true });
    await copyFile(SAMPLE, join(root, '.storage', 'renders', resultKey));
    await db.query(
      `insert into render_jobs (id, user_id, template_id, template_slug, medium, engine, aspect, locale, status, attempts, result_key, result_mime, provider,
         share_token, share_expires_at, notify_status, finishing_at, finished_at, created_at)
       values ($1, $2, $3, $4, 'video', 'seedance-2.0', '9:16', 'ko', 'succeeded', 1, $5, 'video/mp4', 'modelark', $6, $7, 'skipped', $8, $8, $9)`,
      [finished, user, template.id, TEMPLATE, resultKey, token, new Date(now + 3 * 86_400_000), new Date(now - 60_000), new Date(now - 6 * 60_000)],
    );
    console.log(JSON.stringify({ finishing: `/renders/${finishing}`, finished: `/renders/${finished}`, share: `/r/${finished}/${token}` }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
