import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  createBrandOrganization, createBrandProject, loadBrandWorkspace, loadBrandProject,
  activateBrandProject, addBrandContentVersion, approveBrandContent, sendBrandMessage,
  recordBrandPost, publishBrandReport, reserveBrandAttachment, completeBrandAttachment,
  loadBrandAttachmentAccess, loadStudioProject,
  updateBrandPostMetrics,
} from '@/lib/brands/workspace/service';

const A = 'f0000000-0000-4000-8000-000000000001';
const B = 'f0000000-0000-4000-8000-000000000002';
const S = 'f0000000-0000-4000-8000-000000000003';
const viewer = (id: string, isAdmin = false): Viewer => ({ userId: id, isAdmin, tier: isAdmin ? 'admin' : 'free', email: `${id}@example.test`, locale: 'ko' });
const a = viewer(A), b = viewer(B), studio = viewer(S, true);
const anon: Viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null };
const brief = (organizationId: string) => ({ organizationId, requestId: randomUUID(), title: 'New product campaign', objective: 'Introduce our new collection', audience: 'Adults interested in fashion', budgetKrw: 5000000, budgetTaxBasis: 'unspecified', startsOn: '2027-01-01', endsOn: '2027-02-01', productionMode: 'creator', referenceLinks: [{ url: 'https://example.com/reference', note: 'Pacing only' }] });
const content = (projectId: string) => ({ projectId, requestId: randomUUID(), slotKey: 'hero', title: 'Hero film', attachmentId: randomUUID(), caption: 'Final public caption', usageRights: 'Organic social only', creatorConsentConfirmed: false });

describe('brand workspace isolation and durable workflow', () => {
  let db: PGlite, sql: SqlRunner, orgId: string, projectId: string;
  beforeEach(async () => {
    db = await freshDb(); sql = runner(db);
    for (const id of [A, B, S]) await seedProfile(sql, { id, isAdmin: id === S });
    const org = await createBrandOrganization({ sql }, a, { name: 'Example Brand', requestId: randomUUID() });
    if (!org.ok) throw Error(org.code); orgId = org.id;
    const project = await createBrandProject({ sql }, a, brief(orgId));
    if (!project.ok) throw Error(project.code); projectId = project.id;
  });
  afterEach(async () => { await db?.close(); });
  const activate = async () => { expect(await activateBrandProject({ sql }, studio, { projectId, expectedRevision: 0, status: 'active' })).toMatchObject({ ok: true }); };
  const fileFor = async (id = projectId) => {
    const file = await reserveBrandAttachment({ sql }, studio, { projectId: id, requestId: randomUUID(), name: 'review.pdf', mime: 'application/pdf', sizeBytes: 8 });
    if (!file.ok) throw Error(file.code);
    expect(await completeBrandAttachment({ sql, storage: { read: async () => Buffer.from('%PDF-1.7') } }, studio, file.id)).toMatchObject({ ok: true });
    return file.id;
  };
  const newContent = async () => {
    const result = await addBrandContentVersion({ sql }, studio, { ...content(projectId), attachmentId: await fileFor() });
    if (!result.ok) throw Error(result.code); return result.id;
  };

  it('requires a real profile, isolates organizations, and prevents self-granted studio access', async () => {
    expect(await createBrandOrganization({ sql }, anon, { name: 'Brand', requestId: randomUUID() })).toMatchObject({ ok: false, code: 'sign_in_required' });
    expect(await createBrandProject({ sql }, b, brief(orgId))).toMatchObject({ ok: false, code: 'not_found' });
    expect(await loadBrandProject({ sql }, b, projectId)).toBeNull();
    expect((await loadBrandWorkspace({ sql }, b)).projects).toEqual([]);
    expect(await activateBrandProject({ sql }, { ...a, isAdmin: true }, { projectId, expectedRevision: 0, status: 'active' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await loadStudioProject({ sql }, { ...a, isAdmin: true }, projectId)).toBeNull();
  });

  it('validates budget, dates and HTTPS references without contacting supplied URLs', async () => {
    for (const changes of [{ budgetKrw: -1 }, { endsOn: '2026-01-01' }, { referenceLinks: [{ url: 'http://example.com', note: '' }] }, { referenceLinks: [{ url: 'https://127.0.0.1/private', note: '' }] }]) {
      expect(await createBrandProject({ sql }, a, { ...brief(orgId), ...changes })).toMatchObject({ ok: false, code: 'invalid' });
    }
  });

  it('deduplicates creation and conversation retries instead of creating duplicates', async () => {
    const input = brief(orgId);
    const first = await createBrandProject({ sql }, a, input);
    expect(await createBrandProject({ sql }, a, input)).toEqual(first);
    const message = { projectId, requestId: randomUUID(), body: 'Could we review the schedule?' };
    const sent = await sendBrandMessage({ sql }, a, message);
    expect(await sendBrandMessage({ sql }, a, message)).toEqual(sent);
    expect((await loadBrandProject({ sql }, a, projectId))?.messages).toHaveLength(1);
  });

  it('requires studio activation and version-specific optimistic approval with append-only history', async () => {
    expect(await addBrandContentVersion({ sql }, studio, content(projectId))).toMatchObject({ ok: false, code: 'not_active' });
    await activate(); const id = await newContent();
    const decision = { projectId, contentVersionId: id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() };
    expect(await approveBrandContent({ sql }, b, decision)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await approveBrandContent({ sql }, a, decision)).toMatchObject({ ok: true });
    expect(await approveBrandContent({ sql }, a, decision)).toMatchObject({ ok: true });
    expect(await approveBrandContent({ sql }, a, { ...decision, requestId: randomUUID() })).toMatchObject({ ok: false, code: 'conflict' });
    await newContent();
    expect(await approveBrandContent({ sql }, a, { ...decision, expectedRevision: 1, requestId: randomUUID() })).toMatchObject({ ok: false, code: 'conflict' });
    const loaded = (await loadBrandProject({ sql }, a, projectId))!;
    expect(loaded.contents.map(c => c.decision)).toEqual(['pending', 'approved']);
    expect(loaded.decisions).toHaveLength(1);
    await expect(sql.query('update brand_content_decisions set comment = $1', ['rewritten'])).rejects.toThrow(/immutable/i);
    await expect(sql.query('delete from brand_content_decisions')).rejects.toThrow(/immutable/i);
  });

  it('requires documented creator expression consent for studio-produced content', async () => {
    const input = { ...brief(orgId), productionMode: 'studio' };
    const created = await createBrandProject({ sql }, a, input); if (!created.ok) throw Error(created.code);
    await activateBrandProject({ sql }, studio, { projectId: created.id, expectedRevision: 0, status: 'active' });
    expect(await addBrandContentVersion({ sql }, studio, content(created.id))).toMatchObject({ ok: false, code: 'consent_required' });
    expect(await addBrandContentVersion({ sql }, studio, { ...content(created.id), attachmentId: await fileFor(created.id), creatorConsentConfirmed: true })).toMatchObject({ ok: true });
  });

  it('revokes membership immediately for reads, writes and attachment access', async () => {
    const file = await reserveBrandAttachment({ sql }, a, { projectId, requestId: randomUUID(), name: 'brief.pdf', mime: 'application/pdf', sizeBytes: 100 });
    if (!file.ok) throw Error(file.code);
    const bytes = new Uint8Array(100); bytes.set(Buffer.from('%PDF-1.7'));
    await completeBrandAttachment({ sql, storage: { read: async () => bytes } }, a, file.id);
    expect(await loadBrandAttachmentAccess({ sql }, a, file.id)).not.toBeNull();
    await sql.query("update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2", [orgId, A]);
    expect(await loadBrandProject({ sql }, a, projectId)).toBeNull();
    expect(await loadBrandAttachmentAccess({ sql }, a, file.id)).toBeNull();
    expect(await sendBrandMessage({ sql }, a, { projectId, body: 'Forbidden now', requestId: randomUUID() })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('stores only approved post versions and publishes immutable source-aware reports without treating missing as zero', async () => {
    await activate(); const id = await newContent();
    const post = { projectId, contentVersionId: id, requestId: randomUUID(), url: 'https://www.instagram.com/reel/ABC123/', publishedAt: '2027-01-15T12:00:00+09:00', verification: 'unverified', metricsSource: 'unavailable', measuredAt: null, views: null, likes: null, comments: null, shares: null, saves: null };
    expect(await recordBrandPost({ sql }, studio, post)).toMatchObject({ ok: false, code: 'not_approved' });
    await approveBrandContent({ sql }, a, { projectId, contentVersionId: id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() });
    expect(await recordBrandPost({ sql }, studio, post)).toMatchObject({ ok: true });
    const report = { projectId, requestId: randomUUID(), summary: 'One post. Metrics are not available yet.', periodStart: '2027-01-01', periodEnd: '2027-02-01' };
    expect(await publishBrandReport({ sql }, a, report)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await publishBrandReport({ sql }, studio, report)).toMatchObject({ ok: true });
    const loaded = (await loadBrandProject({ sql }, a, projectId))!;
    expect(loaded.reports[0]?.snapshot).toMatchObject({ totalPosts: 1, measuredPosts: 0, viewsTotal: null });
    expect(loaded.posts[0]?.views).toBeNull();
    expect(await recordBrandPost({ sql }, studio, { ...post, requestId: randomUUID(), url: 'https://instagram.com/p/ABC123/' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await publishBrandReport({ sql }, studio, { ...report, requestId: randomUUID(), periodStart: '2027-02-01', periodEnd: '2027-02-28' })).toMatchObject({ ok: true });
    expect((await loadBrandProject({ sql }, a, projectId))?.reports[0]?.snapshot.totalPosts).toBe(0);
    await expect(sql.query("update brand_reports set summary = 'changed'")).rejects.toThrow(/immutable/i);
  });

  it('constructs allowlisted DTOs that contain neither profile identity nor storage keys', async () => {
    await sendBrandMessage({ sql }, studio, { projectId, body: 'The studio has received the brief.', requestId: randomUUID() });
    const serialized = JSON.stringify(await loadBrandProject({ sql }, a, projectId));
    for (const forbidden of ['@example.test', 'created_by', 'createdBy', 'user_id', 'userId', 'storageKey', 'payout', 'margin', 'cost', 'identity_assets']) expect(serialized).not.toContain(forbidden);
    const dto = (await loadBrandProject({ sql }, a, projectId))!;
    expect(dto.messages[0]?.authorRole).toBe('studio');
    expect(dto.budgetKrw).toBe(5000000);
  });
  it('refreshes post measurements with revision fencing while published report snapshots stay unchanged', async () => {
    await activate(); const id = await newContent();
    await approveBrandContent({ sql }, a, { projectId, contentVersionId: id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() });
    const post = await recordBrandPost({ sql }, studio, { projectId, contentVersionId: id, requestId: randomUUID(), url: 'https://instagram.com/p/MEASURED/', publishedAt: '2026-09-17T10:00:00+09:00' });
    if (!post.ok) throw Error(post.code);
    const report = { projectId, requestId: randomUUID(), summary: 'Snapshot at publication', periodStart: '2026-09-01', periodEnd: '2026-09-30' };
    await publishBrandReport({ sql }, studio, report);
    const update = { projectId, postId: post.id, expectedRevision: 0, requestId: randomUUID(), verification: 'manual', metricsSource: 'studio_review', measuredAt: '2026-09-18T10:00:00+09:00', views: 100, likes: 12, comments: null, shares: null, saves: null };
    expect(await updateBrandPostMetrics({ sql }, a, update)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await updateBrandPostMetrics({ sql }, studio, { ...update, measuredAt: null })).toMatchObject({ ok: false, code: 'invalid' });
    const saved = await updateBrandPostMetrics({ sql }, studio, update);
    expect(saved).toMatchObject({ ok: true });
    expect(await updateBrandPostMetrics({ sql }, studio, update)).toEqual(saved);
    expect(await updateBrandPostMetrics({ sql }, studio, { ...update, requestId: randomUUID(), views: 200 })).toMatchObject({ ok: false, code: 'conflict' });
    let current = (await loadBrandProject({ sql }, a, projectId))!;
    expect(current.posts[0]).toMatchObject({ views: 100, metricRevision: 1 });
    expect(current.reports[0]?.snapshot.viewsTotal).toBeNull();
    await publishBrandReport({ sql }, studio, { ...report, requestId: randomUUID() });
    current = (await loadBrandProject({ sql }, a, projectId))!;
    expect(current.reports.map(r => r.snapshot.viewsTotal)).toEqual([100, null]);
    await expect(sql.query("update brand_post_measurements set metrics_source='creator_evidence'")).rejects.toThrow(/immutable/i);
  });
});
