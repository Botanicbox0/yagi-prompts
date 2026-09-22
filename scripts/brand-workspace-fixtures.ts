import {createProductionContract,createProductionTemplate} from '@/lib/brands/production/service';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import { STAGING_BUCKET } from '@/lib/storage';
import type { Viewer } from '@/lib/auth/identity';
import { FIXTURE_USERS } from './fixtures';
import { createBrandOrganization, createBrandProject, activateBrandProject, reserveBrandAttachment,
  completeBrandAttachment, addBrandContentVersion, approveBrandContent, sendBrandMessage,
  recordBrandPost, publishBrandReport, addBrandContract, shareBrandContract, sendBrandSupport,
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
  const bytes = await readFile(resolve('public/reel/campaigns/retro-phone-01.jpg'));
  const attachment = value(await reserveBrandAttachment(deps, studio, { projectId: project.id, requestId: randomUUID(), name: 'local-fixture-preview.jpg', mime: 'image/jpeg', sizeBytes: bytes.byteLength }));
  await storage.putStaging(attachment.storageKey, bytes, 'image/jpeg');
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
  for (const [index, file] of ['retro-phone-02.jpg', 'highteen.jpg', 'beauty-rose.jpg'].entries()) {
    const preview = await readFile(resolve('public/reel/campaigns', file));
    const media = value(await reserveBrandAttachment(deps, studio, { projectId: project.id, requestId: randomUUID(), name: `local-qa-${index + 1}.jpg`, mime: 'image/jpeg', sizeBytes: preview.length }));
    await storage.putStaging(media.storageKey, preview, 'image/jpeg');
    value(await completeBrandAttachment(deps, studio, media.id));
    const content = value(await addBrandContentVersion(deps, studio, { projectId: project.id, requestId: randomUUID(), slotKey: `ranking-${index}`, title: `[Local fixture] Creative ${index + 1}`, attachmentId: media.id, caption: 'Synthetic QA content', usageRights: 'Local development fixture only', creatorConsentConfirmed: false }));
    value(await approveBrandContent(deps, owner, { projectId: project.id, contentVersionId: content.id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() }));
    value(await recordBrandPost(deps, studio, { projectId: project.id, contentVersionId: content.id, requestId: randomUUID(), url: `https://www.instagram.com/p/LOCALQASAMPLE${index}/`, publishedAt: '2026-09-18T10:00:00+09:00', verification: 'manual', metricsSource: 'studio_review', measuredAt: '2026-09-21T09:00:00+09:00', views: [18000, 7000, 2000][index], likes: [120, 500, null][index], comments: [20, 90, 12][index], shares: null, saves: null }));
  }
  value(await publishBrandReport(deps, studio, { projectId: project.id, requestId: randomUUID(), summary: '[Local fixture] Synthetic comparison only. Creative 1 leads by views; Creative 2 leads by likes and comments. Missing likes remain unknown.', periodStart: '2026-09-01', periodEnd: '2026-09-30' }));
  value(await createBrandProject(deps, owner, { organizationId: org.id, requestId: 'bb000000-0000-4000-8000-000000000003',
    title: '[Local fixture] Winter launch', objective: 'Local layout fixture only. No customer results.', audience: 'Local QA audience',
    budgetKrw: 3000000, budgetTaxBasis: 'unspecified', startsOn: null, endsOn: null, productionMode: 'studio',
    criteria: { platforms: ['instagram'], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null }, referenceLinks: [] }));

  // Contract files stay separate from creative attachments, including in the local sample UI.
  for(const version of [1,2]) {
    const pdf=Buffer.from('%PDF-1.7\nLocal contract storage fixture only. Version '+version+'\n%%EOF');
    const file=value(await reserveBrandAttachment(deps,studio,{projectId:project.id,requestId:randomUUID(),name:`local-contract-v${version}.pdf`,mime:'application/pdf',sizeBytes:pdf.length,purpose:'contract'}));
    await storage.putStaging(file.storageKey,pdf,'application/pdf');
    value(await completeBrandAttachment(deps,studio,file.id));
    const contract=value(await addBrandContract(deps,studio,{projectId:project.id,attachmentId:file.id,documentKey:'campaign-agreement',title:'[Local fixture] Campaign agreement',requestId:randomUUID()}));
    if(version===1)value(await shareBrandContract(deps,studio,{projectId:project.id,contractId:contract.id,shared:true,expectedRevision:0}));
  }
  const production=value(await createProductionContract(deps,studio,{organizationId:org.id,projectId:project.id,title:'[Local fixture] Production agreement',startsAt:'2026-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z',limit:3,requestId:randomUUID()}));
  value(await createProductionTemplate(deps,studio,{contractId:production.id,title:'[Local fixture] Portrait film',titleKo:'[로컬 예시] 인물 영상',promptText:'Local QA template only. Use the verified identity reference for a studio portrait film.',seconds:5,aspect:'9:16',previewAttachmentId:attachment.id,requestId:randomUUID()}));
  value(await sendBrandSupport(deps,studio,{organizationId:org.id,body:'[Local fixture] Welcome. You can ask the studio about your workspace here.',requestId:randomUUID()}));

}
