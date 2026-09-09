import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { arkAssetsConfigFromEnv, createArkAssetsClient, type ArkAssetsClient } from '@/lib/ark/assets';
import { siteUrl } from '@/lib/seo/site-url';
import type { IdentityDeps } from './service';

/**
 * The bank's asset client from the live environment — `ARK_ACCESS_KEY` / `ARK_SECRET_KEY` (AK/SK,
 * the OpenAPI signature; NOT the Bearer key the render tasks use), or null when unset.
 */
export function liveAssetsClient(): ArkAssetsClient | null {
  const config = arkAssetsConfigFromEnv();
  return config === null ? null : createArkAssetsClient(config);
}

export function liveIdentityDeps(sql: SqlRunner): IdentityDeps {
  return { sql, assets: liveAssetsClient(), siteUrl: siteUrl() };
}
