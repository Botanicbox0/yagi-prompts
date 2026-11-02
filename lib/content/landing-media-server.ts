import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATALOG_TTL_SECONDS, LANDING_MEDIA_TAG } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { publicMediaCacheKey } from './asset-url';
import { NO_LANDING_MEDIA, type LandingMedia } from './landing-media';
import { landingMediaMap, loadLandingMediaRows } from './landing-media-repo';
import { refreshPublicMediaKeys } from './public-media-registry';

async function readLandingMedia(): Promise<LandingMedia> {
  const sql = await getSqlRunner();
  if (sql === null) return NO_LANDING_MEDIA;
  // This document stores media addresses for up to an hour, so it asks which keys are on R2 right now.
  await refreshPublicMediaKeys(sql, { force: true });
  return landingMediaMap(await loadLandingMediaRows(sql));
}

/** Same posture as the other public projections: one cached document, tag + 1h TTL. */
const cached = unstable_cache(readLandingMedia, ['landing-media', 'v1', resolveRuntimeMode(), publicMediaCacheKey()], {
  tags: [LANDING_MEDIA_TAG],
  revalidate: CATALOG_TTL_SECONDS,
});

export async function getLandingMedia(): Promise<LandingMedia> {
  try {
    return await cached();
  } catch (error) {
    // Outside a Next request (unit tests, scripts) there is no cache to ask, and a database outage
    // must not take a marketing page down: the files in public/ are always a correct answer.
    if (process.env.NODE_ENV !== 'test') console.error('[landing-media] read failed, showing defaults', error);
    return NO_LANDING_MEDIA;
  }
}
