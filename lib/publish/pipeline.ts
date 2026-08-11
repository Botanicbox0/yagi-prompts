import type { SqlRunner } from '@/lib/db/sql-runner';
import type { PublishedBucket } from '@/lib/content/schemas';
import type { StorageDriver } from '@/lib/storage';
import { NOTIFICATIONS_ENABLED } from '@/lib/flags';

/**
 * PLAN §6 — publication is a two-phase database operation with a server-side copier between.
 *
 *   Phase A  prepare_publish(revision)  — DB: stamp resolved_visibility, rewrite the manifest
 *   Phase B  copyPublishManifest()      — HERE: storage copy (upsert:false), stamp copied_at
 *   Phase C  publish_revision(...)      — DB: validate, stamp keys, transition, enqueue
 *
 * Phase B is the only part that lives in application code, and it is idempotent: rows already
 * carrying `copied_at` are skipped, and an object already at the target key counts as success.
 */

export type { NotifyKind } from '@/lib/notify/kinds';
import type { NotifyKind } from '@/lib/notify/kinds';

export interface ManifestRow {
  ref: string;
  sha256: string;
  source_staging_key: string;
  target_bucket: PublishedBucket;
  target_key: string;
  copied_at: string | null;
}

export async function preparePublish(sql: SqlRunner, revisionId: string): Promise<void> {
  await sql.query('select prepare_publish($1)', [revisionId]);
}

export async function readManifest(sql: SqlRunner, revisionId: string): Promise<ManifestRow[]> {
  const { rows } = await sql.query<ManifestRow>(
    `select ref, sha256, source_staging_key, target_bucket, target_key, copied_at
       from publish_assets where revision_id = $1 order by ref`,
    [revisionId],
  );
  return rows;
}

export interface CopyReport {
  copied: number;
  alreadyPresent: number;
  skipped: number;
}

/** Phase B. */
export async function copyPublishManifest(
  sql: SqlRunner,
  storage: StorageDriver,
  revisionId: string,
): Promise<CopyReport> {
  const rows = await readManifest(sql, revisionId);
  const report: CopyReport = { copied: 0, alreadyPresent: 0, skipped: 0 };

  for (const row of rows) {
    if (row.copied_at !== null) {
      report.skipped += 1;
      continue;
    }
    const outcome = await storage.copy({
      fromKey: row.source_staging_key,
      toBucket: row.target_bucket,
      toKey: row.target_key,
    });
    if (outcome === 'copied') report.copied += 1;
    else report.alreadyPresent += 1;

    await sql.query(
      'update publish_assets set copied_at = now() where revision_id = $1 and ref = $2',
      [revisionId, row.ref],
    );
  }

  return report;
}

export interface PublishArgs {
  playbookId: string;
  revisionId: string;
  notifyKind?: NotifyKind | null;
}

/**
 * Phase C.
 *
 * The notify kind passes through only while `NOTIFICATIONS_ENABLED` is on (§3.5). The flag stays in
 * this one line rather than at the call sites: it is the single point where a notification job can
 * be created, so "notifications are off" is enforceable by reading one expression, and the RPC
 * itself re-validates the value against its own CHECK.
 */
export async function publishRevision(sql: SqlRunner, args: PublishArgs): Promise<void> {
  const notify = NOTIFICATIONS_ENABLED ? (args.notifyKind ?? null) : null;
  await sql.query('select publish_revision($1, $2, $3)', [
    args.playbookId,
    args.revisionId,
    notify,
  ]);
}

/** prepare → copy → publish, through the real RPCs. */
export async function runPublishPipeline(
  sql: SqlRunner,
  storage: StorageDriver,
  args: PublishArgs,
): Promise<CopyReport> {
  await preparePublish(sql, args.revisionId);
  const report = await copyPublishManifest(sql, storage, args.revisionId);
  await publishRevision(sql, args);
  return report;
}
