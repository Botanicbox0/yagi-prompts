import { copiedPublicMediaKeys } from '@/lib/content/public-media-registry';
import { publicMediaR2Config } from '@/lib/runtime-mode';
import type { StorageDriver } from './index';
import { PUBLIC_MEDIA_KEY_PATTERN } from './public-media-sync';

/**
 * Every published public file passes through `StorageDriver.copy`, whichever flow publishes it, so this
 * is the one place to notice a new one. The copy to R2 runs after the response, so a slow or broken R2
 * never slows or fails a publish. A publish outside a request (a seed script) schedules nothing, and
 * the daily tick picks that file up.
 *
 * Also imported under plain `tsx` through `getStorage()`, so the `server-only` run is imported only
 * once there is a request to run it after.
 */
const KICK_BUDGET_MS = 120_000;

let active: Promise<void> | null = null;
let again = false;

async function drain(): Promise<void> {
  try {
    const { runPublicMediaSync } = await import('./public-media-runtime');
    do {
      again = false;
      await runPublicMediaSync(KICK_BUDGET_MS);
    } while (again);
  } catch {
    console.warn('[public-media] copy after publish failed; the daily tick retries');
  }
}

function run(): Promise<void> {
  // The running pass may have listed the bucket before this file landed, so it goes round once more.
  if (active) {
    again = true;
    return active;
  }
  active = drain().finally(() => { active = null; });
  return active;
}

async function requestPublicMediaSync(): Promise<void> {
  try {
    const { after } = await import('next/server');
    after(run);
  } catch {
    // Outside a request. The daily tick takes it.
  }
}

export function withPublicMediaSync(driver: StorageDriver): StorageDriver {
  if (publicMediaR2Config() === null) return driver;
  return {
    ...driver,
    async copy(request) {
      const outcome = await driver.copy(request);
      if (request.toBucket === 'public-content' && PUBLIC_MEDIA_KEY_PATTERN.test(request.toKey) && !copiedPublicMediaKeys().has(request.toKey)) {
        await requestPublicMediaSync();
      }
      return outcome;
    },
  };
}
