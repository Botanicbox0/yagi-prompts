import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { STAGING_BUCKET } from '@/lib/storage';
import type { Viewer } from '@/lib/auth/identity';
import { FIXTURE_USERS } from './fixtures';
import { createBrandOrganization, createBrandProject, activateBrandProject, reserveBrandAttachment,
  completeBrandAttachment, addBrandContentVersion, approveBrandContent, sendBrandMessage,
  recordBrandPost, publishBrandReport,
} from '@/lib/brands/workspace/service';

/** Local-only fixtures, never run in cloud seeds. No real client identity or claimed production results. */
export async function seedBrandWorkspaceFixtures(sql: SqlRunner, storage: StorageDriver): Promise<void> {
  if (process.env.PLAYBOOK_MODE !== 'local' || storage.name !== 'local') throw Error('Brand fixtures require explicit local database and storage mode');
  const toViewer = (kind: 'free' | 'admin'): Viewer => ({ userId: FIXTURE_USERS[kind].id, email: FIXTURE_USERS[kind].email,
    locale: 'ko', isAdmin: kind === 'admin', tier: kind === 'admin' ? 'admin' : 'free' });
  const owner = toViewer('free'), studio = toViewer('admin'), deps = { sql, storage };
  const value = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
    if (!result.ok) throw Error('Brand fixture service refused a step'); return result as Extract<T, { ok: true }>;
  };
  const org = value(await createBrandOrganization(deps, owner, { name: '[Local fixture] Sample brand', requestId: 'bb000000-0000-4000-8000-000000000001' }));
  // Idempotent at organization/project creation; do not duplicate a seeded demo on a durable DB.
  const existing = (await sql.query('select id from brand_projects where organization_id=$1', [org.id])).rows;
  if (existing.length) return;
  const project = value(await createBrandProject(deps, owner, { organizationId: org.id, requestId: 'bb000000-0000-4000-8000-000000000002',
    title: '[Local fixture] New collection', objective: 'Local test campaign. This is not a real brand campaign.', audience: 'Local QA audience',
    budgetKrw: 5000000, budgetTaxBasis: 'unspecified', startsOn: '2026-09-01', endsOn: '2026-09-30', productionMode: 'creator',
    criteria: { platforms: ['instagram'], minFollowers: 1000, maxFollowers: 50000, primaryMetric: 'views', targetValue: 10000 },
    referenceLinks: [{ url: 'https://example.com/reference', note: 'Local fixture reference link' }] }));
  value(await activateBrandProject(deps, studio, { projectId: project.id, expectedRevision: 0, status: 'active' }));
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const attachment = value(await reserveBrandAttachment(deps, studio, { projectId: project.id, requestId: randomUUID(), name: 'local-fixture-preview.png', mime: 'image/png', sizeBytes: bytes.byteLength }));
  await storage.putStaging(attachment.storageKey, bytes, 'image/png');
  value(await completeBrandAttachment(deps, studio, attachment.id));
  // Ensure no part of fixture media was copied to the public bucket.
  await storage.read(STAGING_BUCKET, attachment.storageKey);
  const makeVersion = async (slotKey: string) => value(await addBrandContentVersion(deps, studio, { projectId: project.id, requestId: randomUUID(), slotKey,
    title: '[Local fixture] Preview image', attachmentId: attachment.id, caption: 'Local QA only', usageRights: 'Local development fixture only', creatorConsentConfirmed: false }));
  const approved = await makeVersion('published-sample');
  value(await approveBrandContent(deps, owner, { projectId: project.id, contentVersionId: approved.id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() }));
  await makeVersion('awaiting-review');
  value(await sendBrandMessage(deps, studio, { projectId: project.id, body: '[Local fixture] A content version is ready for review.', requestId: randomUUID() }));
  value(await recordBrandPost(deps, studio, { projectId: project.id, contentVersionId: approved.id, requestId: randomUUID(), url: 'https://www.instagram.com/p/LOCALFIXTURE/',
    publishedAt: '2026-09-17T10:00:00+09:00', verification: 'unverified', metricsSource: 'unavailable', measuredAt: null,
    views: null, likes: null, comments: null, shares: null, saves: null }));
  value(await publishBrandReport(deps, studio, { projectId: project.id, requestId: randomUUID(), summary: '[Local fixture] One sample post. No performance metrics have been collected.', periodStart: '2026-09-01', periodEnd: '2026-09-30' }));
  // Synthetic results exercise rankings, partial coverage and frozen report versions.
  // The original unknown observation and report remain intact.
  for (const [index, color] of ['#cbd5bd', '#e5cfc0', '#bacbd6'].entries()) {
    const preview = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="${color}"/><circle cx="240" cy="280" r="130" fill="#f5f1e8"/><text x="240" y="310" text-anchor="middle" font-family="sans-serif" font-size="90" fill="#26332d">0${index + 1}</text><text x="240" y="550" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#26332d">LOCAL QA SAMPLE</text></svg>`)).png().toBuffer();
    const media = value(await reserveBrandAttachment(deps, studio, { projectId: project.id, requestId: randomUUID(), name: `local-qa-${index + 1}.png`, mime: 'image/png', sizeBytes: preview.length }));
    await storage.putStaging(media.storageKey, preview, 'image/png');
    value(await completeBrandAttachment(deps, studio, media.id));
    const content = value(await addBrandContentVersion(deps, studio, { projectId: project.id, requestId: randomUUID(), slotKey: `ranking-${index}`, title: `[Local fixture] Creative ${index + 1}`, attachmentId: media.id, caption: 'Synthetic QA content', usageRights: 'Local development fixture only', creatorConsentConfirmed: false }));
    value(await approveBrandContent(deps, owner, { projectId: project.id, contentVersionId: content.id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() }));
    value(await recordBrandPost(deps, studio, { projectId: project.id, contentVersionId: content.id, requestId: randomUUID(), url: `https://www.instagram.com/p/LOCALQASAMPLE${index}/`, publishedAt: '2026-09-18T10:00:00+09:00', verification: 'manual', metricsSource: 'studio_review', measuredAt: '2026-09-21T09:00:00+09:00', views: [18000, 7000, 2000][index], likes: [120, 500, null][index], comments: [20, 90, 12][index], shares: null, saves: null }));
  }
  value(await publishBrandReport(deps, studio, { projectId: project.id, requestId: randomUUID(), summary: '[Local fixture] Synthetic comparison only. Creative 1 leads by views; Creative 2 leads by likes and comments. Missing likes remain unknown.', periodStart: '2026-09-01', periodEnd: '2026-09-30' }));
}
