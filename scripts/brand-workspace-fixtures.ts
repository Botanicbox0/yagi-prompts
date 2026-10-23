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
  recordBrandPost, publishBrandReport, addBrandContract, shareBrandContract, sendBrandSupport, importBrandExternalPosts,
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
  let sharedContractId='';
  for(const version of [1,2]) {
    const pdf=Buffer.from('%PDF-1.7\nLocal contract storage fixture only. Version '+version+'\n%%EOF');
    const file=value(await reserveBrandAttachment(deps,studio,{projectId:project.id,requestId:randomUUID(),name:`local-contract-v${version}.pdf`,mime:'application/pdf',sizeBytes:pdf.length,purpose:'contract'}));
    await storage.putStaging(file.storageKey,pdf,'application/pdf');
    value(await completeBrandAttachment(deps,studio,file.id));
    const contract=value(await addBrandContract(deps,studio,{projectId:project.id,attachmentId:file.id,documentKey:'campaign-agreement',title:'[Local fixture] Campaign agreement',requestId:randomUUID()}));
    if(version===1){value(await shareBrandContract(deps,studio,{projectId:project.id,contractId:contract.id,shared:true,expectedRevision:0}));sharedContractId=contract.id;}
  }
  await seedUsageFixtures(deps, { owner, studio, projectId: project.id, contractId: sharedContractId, value });
  const production=value(await createProductionContract(deps,studio,{organizationId:org.id,projectId:project.id,title:'[Local fixture] Production agreement',startsAt:'2026-01-01T00:00:00Z',endsAt:'2099-01-01T00:00:00Z',limit:3,requestId:randomUUID()}));
  const template=value(await createProductionTemplate(deps,studio,{contractId:production.id,title:'[Local fixture] Portrait film',titleKo:'[로컬 예시] 인물 영상',promptText:'Local QA template only. Use the verified identity reference for a studio portrait film.',seconds:5,aspect:'9:16',previewAttachmentId:attachment.id,requestId:randomUUID()}));
  value(await sendBrandSupport(deps,studio,{organizationId:org.id,body:'[Local fixture] Welcome. You can ask the studio about your workspace here.',requestId:randomUUID()}));
  await seedCampaignWizardFixtures(deps, { owner, orgId: org.id, projectId: project.id, studioId: studio.userId!, contractId: production.id, templateId: template.id, value });
}

/**
 * The campaign wizard and timeline (docs/PLATFORM-2.0.md §16.3–16.4), local only: one brief sent from
 * the wizard (`requested`, with `campaign_terms`), and an invitation-only campaign linked to the active
 * fixture project with synthetic applicants, so the applicants tab has something to show when
 * `CAMPAIGN_COLLABORATION_PUBLIC=on`. `invited` keeps it off the public campaign list. No handle,
 * follower count or message here belongs to a real person.
 */
async function seedCampaignWizardFixtures(deps: { sql: SqlRunner }, f: { owner: Viewer; orgId: string; projectId: string; studioId: string; contractId: string; templateId: string; value: <T extends { ok: boolean }>(r: T) => Extract<T, { ok: true }> }) {
  const { sql } = deps;
  const day = (offset: number) => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  f.value(await createBrandProject(deps, f.owner, { organizationId: f.orgId, requestId: 'bb000000-0000-4000-8000-000000000004',
    title: '[로컬 예시] 가을 신제품 캠페인', objective: '로컬 확인용 요청입니다. 실제 브랜드 캠페인이 아니에요.', audience: '',
    budgetKrw: null, budgetTaxBasis: 'unspecified', startsOn: null, endsOn: null, productionMode: 'creator', referenceLinks: [],
    campaignTerms: { version: 1, format: { kind: 'custom', note: '[로컬 예시] 브랜드 전용 포맷을 요청합니다.' },
      reward: { model: 'hybrid', rewardMinKrw: 100000, rewardMaxKrw: 300000, perThousandViewsKrw: 2000, totalBudgetKrw: 3000000, taxBasis: 'excluded', slots: 10 },
      audience: { mode: 'criteria', platforms: ['instagram', 'tiktok'], minFollowers: 3000, gender: 'any', regions: ['서울'] },
      schedule: { applicationsCloseOn: day(14), postDeadlineOn: day(28), hashtags: ['로컬예시'], mentions: [], disclosure: true, prohibited: '[로컬 예시] 경쟁사 제품 노출 금지' } } }));
  const campaignId = 'bb000000-0000-4000-8000-0000000000c1';
  await sql.query(`insert into campaigns (id, slug, status, title, summary, host_name, host_kind, platforms, deliverable, slots, applications_close_at, post_deadline_at, published_at, payout, audience)
    values ($1, 'local-fixture-invited-campaign', 'selecting', $2::jsonb, $2::jsonb, '[Local fixture] Sample brand', 'brand', '{instagram,tiktok}', 'reel', 3, $3, $4, now(),
      '{"model":"flat","flatCents":100000,"currency":"KRW","holdDays":7}'::jsonb, 'invited') on conflict (id) do nothing`,
    [campaignId, JSON.stringify({ en: '[Local fixture] Invited campaign', ko: '[로컬 예시] 초대 캠페인' }), `${day(-2)}T23:59:00+09:00`, `${day(20)}T23:59:00+09:00`]);
  await sql.query('insert into campaign_collaboration_links (campaign_id, project_id, created_by) values ($1, $2, $3) on conflict do nothing', [campaignId, f.projectId, f.studioId]);
  // The production link is what the brand timeline and funnel read (loadCampaignParticipation); left disabled.
  await sql.query('insert into campaign_productions (campaign_id, contract_id, template_id, updated_by) values ($1, $2, $3, $4) on conflict do nothing', [campaignId, f.contractId, f.templateId, f.studioId]);
  const applicants = [
    { id: 'bb000000-0000-4000-8000-0000000000a1', handle: 'local.fixture.one', host: 'www.instagram.com', followers: 4200, status: 'applied', pitch: '[로컬 예시] 카페와 뷰티 리뷰를 주 3회 올려요.' },
    { id: 'bb000000-0000-4000-8000-0000000000a2', handle: '@local.fixture.two', host: 'www.tiktok.com', followers: 12800, status: 'applied', pitch: '[로컬 예시] 숏폼 메이크업 튜토리얼을 만들어요.' },
    { id: 'bb000000-0000-4000-8000-0000000000a3', handle: 'local.fixture.three', host: 'www.instagram.com', followers: 8900, status: 'posted', pitch: '[로컬 예시] 선정 후 게시까지 마친 예시예요.' },
  ];
  for (const a of applicants) {
    await sql.query('insert into auth.users (id) values ($1) on conflict do nothing', [a.id]);
    await sql.query("insert into profiles (id, email, locale) values ($1, $2, 'ko') on conflict (id) do nothing", [a.id, `${a.id.slice(-2)}@fixture.invalid`]);
    const posted = a.status === 'posted';
    await sql.query(`insert into campaign_applications (id, campaign_id, creator_id, status, pitch, sns_url, follower_count, selected_at, post_url, post_platform, posted_at, views_snapshot, metrics_source)
      values ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict do nothing`,
      [a.id, campaignId, a.status, a.pitch, `https://${a.host}/${a.handle}`, a.followers, posted ? new Date().toISOString() : null,
        posted ? 'https://www.instagram.com/p/LOCALFIXTUREPOST/' : null, posted ? 'instagram' : null, posted ? new Date().toISOString() : null, posted ? 15400 : null, posted ? 'self' : null]);
  }
}

/**
 * Secondary usage (docs/SECONDARY-USAGE.md), local only: an imported post with a cost-only inquiry, and a
 * second inquiry taken to a tax-inclusive quote on the shared local terms, ready to accept and pay with the
 * local fake gateway (`BRAND_USAGE_PAYMENTS=on`). Dates are relative to when the snapshot is built.
 * Synthetic amounts; no creator, price or result here is real.
 */
async function seedUsageFixtures(deps: { sql: SqlRunner }, f: { owner: Viewer; studio: Viewer; projectId: string; contractId: string; value: <T extends { ok: boolean }>(r: T) => Extract<T, { ok: true }> }) {
  const u = await import('@/lib/brands/usage/service');
  const { sql } = deps, { owner, studio, projectId, value } = f;
  value(await importBrandExternalPosts(deps, studio, { projectId, requestId: randomUUID(), posts: [{ url: 'https://www.instagram.com/p/LOCALUSAGE01/', publishedAt: null }] }));
  const postId = String((await sql.query("select id from brand_posts where project_id=$1 and platform_post_id='LOCALUSAGE01'", [projectId])).rows[0]!.id);
  value(await u.submitUsageInquiry(deps, owner, { projectId, requestId: randomUUID(), subjects: [{ kind: 'post', id: postId }], intent: 'know_cost' }));
  const caseId = value(await u.submitUsageInquiry(deps, owner, { projectId, requestId: randomUUID(), subjects: [{ kind: 'post', id: postId }], intent: 'recommend_terms', question: '[Local fixture] Brand Instagram repost for one month?' })).id;
  const revision = async () => Number((await sql.query('select revision from brand_usage_cases where id=$1', [caseId])).rows[0]!.revision);
  const day = (offset: number) => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  value(await u.triageUsageCase(deps, studio, { caseId, expectedRevision: await revision() }));
  const itemId = String((await sql.query('select id from brand_usage_case_items where case_id=$1', [caseId])).rows[0]!.id);
  const scopeRevisionId = value(await u.defineUsageScope(deps, studio, { caseId, expectedRevision: await revision(), requestId: randomUUID(), items: [{ itemId, pin: { kind: 'original_post' },
    usageKinds: ['organic_repost'], channels: ['[Local fixture] Brand Instagram'], territory: ['KR'], advertiser: null, edits: 'none', timing: { kind: 'fixed', startsOn: day(7), endsOn: day(37) } }] })).id;
  const compensationId = value(await u.recordUsageCompensation(deps, studio, { caseId, scopeRevisionId, requestId: randomUUID(), amountKrw: 1000, taxBasis: 'included', note: '[Local fixture] synthetic' })).id;
  value(await u.recordUsageConsent(deps, studio, { caseId, itemId, scopeRevisionId, compensationId, requestId: randomUUID(), approverKind: 'creator', approvedAt: new Date().toISOString(),
    evidenceReference: '[Local fixture] no real evidence', rightsChecks: ['ownership', 'music', 'people', 'marks'] }));
  value(await u.issueUsageQuote(deps, studio, { caseId, expectedRevision: await revision(), requestId: randomUUID(), scopeRevisionId, totalKrw: 110000, taxBasis: 'included',
    validUntil: new Date(Date.now() + 14 * 86400000).toISOString(), contractId: f.contractId, note: '[Local fixture] Synthetic quote for local checkout testing.' }));
}
