import { writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { PUBLIC_MEDIA_KEYS } from '@/lib/content/public-media-keys';
import { createR2PublicMediaDeps } from '@/lib/storage/r2-public';
import { renderPublicMediaKeys, syncPublicMedia } from '@/lib/storage/public-media-sync';
import { createServiceClient } from '@/lib/supabase/service-client';

/**
 * `npm run r2:sync-public` re-checks every file by hand: it copies all of `public-content` to the R2
 * public bucket, reads each object back from `PUBLIC_MEDIA_BASE_URL`, and adds the keys that passed to
 * `lib/content/public-media-keys.ts`. A listed key stays on the list whatever this run finds, including
 * when its Supabase original is gone. It never deletes anything, on either side. Prints key names and
 * reasons, never a credential.
 *
 * New files no longer need this: the app copies them itself (docs/BRAND-MOAT-AND-STORAGE.md). This run
 * reads every file from Supabase, so it costs the whole bucket in egress.
 *
 * `R2_ENV_FILE` points at another env file, for running from a worktree.
 */
loadEnv({ path: [process.env.R2_ENV_FILE ?? '.env.local', '.env'], quiet: true });

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_BUCKET', 'PUBLIC_MEDIA_BASE_URL'] as const;
const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(1);
}

const env = (name: (typeof REQUIRED)[number]) => process.env[name]!.trim();

async function main(): Promise<void> {
  const deps = createR2PublicMediaDeps(
    {
      accountId: env('R2_ACCOUNT_ID'),
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      bucket: env('R2_PUBLIC_BUCKET'),
      mediaBaseUrl: env('PUBLIC_MEDIA_BASE_URL'),
    },
    createServiceClient(),
  );
  const report = await syncPublicMedia(deps);
  writeFileSync('lib/content/public-media-keys.ts', renderPublicMediaKeys(PUBLIC_MEDIA_KEYS, report.verified));
  const checked = new Set([...report.verified, ...report.failed.map(({ key }) => key)]);
  const unchecked = [...PUBLIC_MEDIA_KEYS].filter((key) => !checked.has(key));
  console.log(`verified ${report.verified.length} · failed ${report.failed.length} · left on Supabase ${report.skipped.length} · kept without a Supabase original ${unchecked.length}`);
  for (const { key, reason } of report.failed) console.log(`FAILED ${reason} ${key}`);
  for (const key of report.skipped) console.log(`LEFT ${key}`);
  if (report.failed.length > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'sync failed');
  process.exit(1);
});
