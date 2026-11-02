import 'server-only';
import { revalidatePublicMedia } from '@/lib/cache';
import { refreshPublicMediaKeys } from '@/lib/content/public-media-registry';
import { getSqlRunner } from '@/lib/db/connect';
import { publicMediaR2Config } from '@/lib/runtime-mode';
import { createServiceClient } from '@/lib/supabase/service-client';
import { publicMediaLedger } from './public-media-ledger';
import { syncNewPublicMedia, type NewPublicMediaReport } from './public-media-sync';
import { createR2PublicMediaDeps } from './r2-public';

/**
 * One copy run with the real network and the real ledger. `null` until the R2 keys exist. Called right
 * after a publish (`lib/storage/public-media-kick.ts`) and by the daily tick, which catches anything a
 * publish could not finish. Starts no new file once `budgetMs` has passed.
 */
export async function runPublicMediaSync(budgetMs: number): Promise<NewPublicMediaReport | null> {
  const config = publicMediaR2Config();
  if (config === null) return null;
  const sql = await getSqlRunner();
  if (sql === null) return null;

  const report = await syncNewPublicMedia(createR2PublicMediaDeps(config, createServiceClient()), publicMediaLedger(sql), {
    stopAt: Date.now() + budgetMs,
  });
  for (const { key, reason } of report.failed) console.warn(`[public-media] ${reason} ${key}`);

  if (report.verified.length > 0) {
    console.log(`[public-media] verified ${report.verified.length}`);
    await refreshPublicMediaKeys(sql, { force: true });
    try {
      revalidatePublicMedia();
    } catch {
      // The pages carry a 1h TTL and the old address still works, so a lost refresh heals by itself.
      console.warn('[public-media] could not refresh cached pages');
    }
  }
  return report;
}
