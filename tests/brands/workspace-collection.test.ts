import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  createBrandOrganization, createBrandProject, loadBrandProject, activateBrandProject, addBrandContentVersion,
  approveBrandContent, recordBrandPost, publishBrandReport, reserveBrandAttachment, completeBrandAttachment,
  updateBrandPostMetrics, saveBrandPostMetricsBatch,
} from '@/lib/brands/workspace/service';
import { BRAND_METRICS_BATCH_LIMIT } from '@/lib/brands/workspace/schemas';

const A = 'f0000000-0000-4000-8000-000000000011';
const S = 'f0000000-0000-4000-8000-000000000013';
const viewer = (id: string, isAdmin = false): Viewer => ({ userId: id, isAdmin, tier: isAdmin ? 'admin' : 'free', email: `${id}@example.test`, locale: 'ko' });
const a = viewer(A), studio = viewer(S, true);
const NULLS = { views: null, likes: null, comments: null, shares: null, saves: null };

describe('brand post collection: history, latest projection and the batch console', () => {
  let db: PGlite, sql: SqlRunner, orgId: string, projectId: string, revision: number;
  const newProject = async () => {
    const created = await createBrandProject({ sql }, a, { organizationId: orgId, requestId: randomUUID(), title: 'Launch campaign', objective: 'Introduce the new line', budgetKrw: null, productionMode: 'creator' });
    if (!created.ok) throw Error(created.code);
    expect(await activateBrandProject({ sql }, studio, { projectId: created.id, expectedRevision: 0, status: 'active' })).toMatchObject({ ok: true });
    return created.id;
  };
  beforeEach(async () => {
    db = await freshDb(); sql = runner(db);
    for (const id of [A, S]) await seedProfile(sql, { id, isAdmin: id === S });
    const org = await createBrandOrganization({ sql }, a, { name: 'Example Brand', requestId: randomUUID() });
    if (!org.ok) throw Error(org.code); orgId = org.id;
    projectId = await newProject(); revision = 1;
  });
  afterEach(async () => { vi.unstubAllEnvs(); await db?.close(); });

  let slot = 0;
  const newPost = async (metrics: Record<string, unknown> = {}, project = projectId) => {
    const file = await reserveBrandAttachment({ sql }, studio, { projectId: project, requestId: randomUUID(), name: 'review.pdf', mime: 'application/pdf', sizeBytes: 8 });
    if (!file.ok) throw Error(file.code);
    await completeBrandAttachment({ sql, storage: { read: async () => Buffer.from('%PDF-1.7') } }, studio, file.id);
    const content = await addBrandContentVersion({ sql }, studio, { projectId: project, requestId: randomUUID(), slotKey: `slot-${++slot}`, title: 'Film', attachmentId: file.id, usageRights: 'Organic social only' });
    if (!content.ok) throw Error(content.code);
    await approveBrandContent({ sql }, a, { projectId: project, contentVersionId: content.id, expectedRevision: 0, decision: 'approved', comment: '', requestId: randomUUID() });
    const post = await recordBrandPost({ sql }, studio, { projectId: project, contentVersionId: content.id, requestId: randomUUID(), url: `https://www.instagram.com/p/POST${slot}/`, publishedAt: '2026-09-01T10:00:00+09:00', ...metrics });
    if (!post.ok) throw Error(post.code); return post.id;
  };
  const history = async (postId: string) => (await sql.query<{ revision: number; views: string | null; measured_at: Date | null }>('select revision,views,measured_at from brand_post_measurements where post_id=$1 order by revision', [postId])).rows;
  const single = (postId: string, expectedRevision: number, changes: Record<string, unknown> = {}) => ({ projectId, postId, expectedRevision, requestId: randomUUID(), verification: 'manual', metricsSource: 'studio_review', measuredAt: '2026-09-10T10:00:00+09:00', ...NULLS, views: 100, ...changes });
  const row = (postId: string, expectedRevision: number, changes: Record<string, unknown> = {}) => ({ postId, expectedRevision, verification: 'manual', metricsSource: 'studio_review', ...NULLS, views: 100, ...changes });
  const batch = (rows: unknown[], changes: Record<string, unknown> = {}) => ({ projectId, requestId: randomUUID(), rows, ...changes });

  it('writes the initial observation into history with the post, and none when nothing was measured', async () => {
    const measured = await newPost({ verification: 'manual', metricsSource: 'creator_evidence', measuredAt: '2026-09-02T09:00:00+09:00', views: 0, likes: 3 });
    const unmeasured = await newPost();
    const rows = await history(measured);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ revision: 0 });
    expect(Number(rows[0]!.views)).toBe(0);
    expect(new Date(rows[0]!.measured_at!).toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(await history(unmeasured)).toEqual([]);
    const posts = (await loadBrandProject({ sql }, a, projectId))!.posts;
    expect(posts.find(p => p.id === measured)).toMatchObject({ views: 0, likes: 3, comments: null, metricRevision: 0 });
  });

  it('keeps every observation and projects only the latest one, allowing provider corrections downward', async () => {
    const postId = await newPost({ metricsSource: 'studio_review', measuredAt: '2026-09-02T09:00:00+09:00', views: 50 });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 0, { views: 500 }))).toMatchObject({ ok: true });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { views: 480, measuredAt: '2026-09-11T10:00:00+09:00' }))).toMatchObject({ ok: true });
    expect((await history(postId)).map(r => Number(r.views))).toEqual([50, 500, 480]);
    expect((await loadBrandProject({ sql }, a, projectId))!.posts[0]).toMatchObject({ views: 480, metricRevision: 2, measuredAt: '2026-09-11T01:00:00.000Z' });
  });

  it('refuses an older measurement time, a future one and erasing a known observation; the same instant is a correction', async () => {
    const postId = await newPost();
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 0))).toMatchObject({ ok: true });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { measuredAt: '2026-09-09T10:00:00+09:00', views: 90 }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { measuredAt: new Date(Date.now() + 3600000).toISOString() }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { metricsSource: 'unavailable', measuredAt: null, views: null }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([row(postId, 1, { metricsSource: 'unavailable', views: null })]))).toMatchObject({ ok: false, code: 'invalid' });
    expect((await loadBrandProject({ sql }, a, projectId))!.posts[0]).toMatchObject({ views: 100, metricRevision: 1 });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { views: 101 }))).toMatchObject({ ok: true });
    expect((await history(postId)).map(r => Number(r.views))).toEqual([100, 101]);
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { views: 300, measuredAt: '2026-09-12T10:00:00+09:00' }))).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('saves the selected rows in one transaction with one server-side measurement time, and zero is not blank', async () => {
    const [first, second, untouched] = [await newPost(), await newPost(), await newPost({ metricsSource: 'studio_review', measuredAt: '2026-09-02T09:00:00+09:00', views: 7 })];
    const before = Date.now();
    const saved = await saveBrandPostMetricsBatch({ sql }, studio, batch([row(first, 0, { views: 0 }), row(second, 0, { views: 20, saves: 0 })]));
    expect(saved).toMatchObject({ ok: true, saved: 2 });
    const posts = (await loadBrandProject({ sql }, a, projectId))!.posts;
    const find = (id: string) => posts.find(p => p.id === id)!;
    const p1 = find(first), p2 = find(second), p3 = find(untouched);
    expect(p1).toMatchObject({ views: 0, likes: null, metricRevision: 1, metricsSource: 'studio_review', verification: 'manual' });
    expect(p2).toMatchObject({ views: 20, saves: 0, likes: null, metricRevision: 1 });
    expect(p3).toMatchObject({ views: 7, metricRevision: 0, measuredAt: '2026-09-02T00:00:00.000Z' });
    expect(p1.measuredAt).toBe(p2.measuredAt);
    expect(+new Date(p1.measuredAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(+new Date(p1.measuredAt!)).toBeLessThanOrEqual(Date.now() + 1000);
    // A supplied time is never trusted for the console: the key is refused rather than ignored.
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([row(first, 1)], { measuredAt: '2020-01-01T00:00:00Z' }))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([{ ...row(first, 1), measuredAt: '2020-01-01T00:00:00Z' }]))).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('rolls back every row when one row is stale, missing or belongs to another project', async () => {
    const [first, second] = [await newPost(), await newPost()];
    const otherProject = await newProject();
    const foreign = await newPost({}, otherProject);
    for (const bad of [row(second, 5), row(foreign, 0), row(randomUUID(), 0)]) {
      const result = await saveBrandPostMetricsBatch({ sql }, studio, batch([row(first, 0), bad]));
      expect(result.ok).toBe(false);
    }
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([row(first, 0), row(second, 5)]))).toMatchObject({ ok: false, code: 'conflict' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([row(first, 0), row(foreign, 0)]))).toMatchObject({ ok: false, code: 'not_found' });
    expect((await sql.query('select id from brand_post_measurements')).rows).toEqual([]);
    expect((await sql.query('select id from brand_post_collection_batches')).rows).toEqual([]);
    expect((await loadBrandProject({ sql }, a, projectId))!.posts.every(p => p.metricRevision === 0 && p.views === null)).toBe(true);
    expect((await loadBrandProject({ sql }, a, otherProject))!.posts[0]).toMatchObject({ metricRevision: 0, views: null });
  });

  it('replays a retried batch without duplicates and refuses the same request with a different payload', async () => {
    const [first, second] = [await newPost(), await newPost()];
    const input = batch([row(first, 0), row(second, 0, { views: 40 })]);
    const saved = await saveBrandPostMetricsBatch({ sql }, studio, input);
    expect(saved).toMatchObject({ ok: true, saved: 2 });
    const measuredAt = (await loadBrandProject({ sql }, a, projectId))!.posts[0]!.measuredAt;
    expect(await saveBrandPostMetricsBatch({ sql }, studio, input)).toEqual(saved);
    // Row order is not part of the request identity.
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { ...input, rows: [...input.rows].reverse() })).toEqual(saved);
    expect((await sql.query('select id from brand_post_measurements')).rows).toHaveLength(2);
    expect((await loadBrandProject({ sql }, a, projectId))!.posts[0]).toMatchObject({ metricRevision: 1, measuredAt });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { ...input, rows: [row(first, 0), row(second, 0, { views: 41 })] })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { ...input, rows: [row(first, 0)] })).toMatchObject({ ok: false, code: 'conflict' });
    expect((await sql.query('select id from brand_post_measurements')).rows).toHaveLength(2);
  });

  it('refuses duplicate post ids, empty and oversized batches', async () => {
    const postId = await newPost();
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([row(postId, 0), row(postId, 0, { views: 5 })]))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([]))).toMatchObject({ ok: false, code: 'invalid' });
    const tooMany = Array.from({ length: BRAND_METRICS_BATCH_LIMIT + 1 }, () => row(randomUUID(), 0));
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch(tooMany))).toMatchObject({ ok: false, code: 'invalid' });
    expect(await history(postId)).toEqual([]);
  });

  it('requires a real administrator profile; a brand member or a self-asserted admin flag cannot collect', async () => {
    const postId = await newPost();
    expect(await saveBrandPostMetricsBatch({ sql }, a, batch([row(postId, 0)]))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await saveBrandPostMetricsBatch({ sql }, { ...a, isAdmin: true }, batch([row(postId, 0)]))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await saveBrandPostMetricsBatch({ sql }, { ...studio, userId: null }, batch([row(postId, 0)]))).toMatchObject({ ok: false, code: 'sign_in_required' });
    expect(await history(postId)).toEqual([]);
  });

  it('freezes collection once the studio completes or cancels the campaign, for the single operation too', async () => {
    const postId = await newPost();
    const retried = batch([row(postId, 0)]);
    expect(await saveBrandPostMetricsBatch({ sql }, studio, retried)).toMatchObject({ ok: true });
    const report = { projectId, requestId: randomUUID(), summary: 'Final', periodStart: '2026-09-01', periodEnd: '2026-09-30' };
    await publishBrandReport({ sql }, studio, report);
    expect(await activateBrandProject({ sql }, studio, { projectId, expectedRevision: revision, status: 'completed' })).toMatchObject({ ok: true });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, batch([row(postId, 1, { views: 900 })]))).toMatchObject({ ok: false, code: 'not_active' });
    expect(await updateBrandPostMetrics({ sql }, studio, single(postId, 1, { views: 900, measuredAt: new Date().toISOString() }))).toMatchObject({ ok: false, code: 'not_active' });
    // A lost response may still be confirmed after the close; it writes nothing new.
    expect(await saveBrandPostMetricsBatch({ sql }, studio, retried)).toMatchObject({ ok: true, saved: 1 });
    const loaded = (await loadBrandProject({ sql }, a, projectId))!;
    expect(loaded.posts[0]).toMatchObject({ views: 100, metricRevision: 1 });
    expect(loaded.reports[0]?.snapshot).toMatchObject({ viewsTotal: 100, metricDefinition: 'sum_of_latest_post_views' });
    expect(await history(postId)).toHaveLength(1);

    const cancelled = await newProject();
    const other = await newPost({}, cancelled);
    expect(await activateBrandProject({ sql }, studio, { projectId: cancelled, expectedRevision: 1, status: 'cancelled' })).toMatchObject({ ok: true });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { projectId: cancelled, requestId: randomUUID(), rows: [row(other, 0)] })).toMatchObject({ ok: false, code: 'not_active' });
  });

  it('keeps observation history and the batch ledger immutable', async () => {
    const postId = await newPost();
    await saveBrandPostMetricsBatch({ sql }, studio, batch([row(postId, 0)]));
    await expect(sql.query('update brand_post_measurements set views=1')).rejects.toThrow(/immutable/i);
    await expect(sql.query('delete from brand_post_measurements')).rejects.toThrow(/immutable/i);
    await expect(sql.query('update brand_post_collection_batches set row_count=9')).rejects.toThrow(/immutable/i);
    await expect(sql.query('delete from brand_post_collection_batches')).rejects.toThrow(/immutable/i);
  });

  it('allows only the configured completed campaign and request once, retaining frozen reports and normal guards', async () => {
    const first = await newPost({ metricsSource: 'studio_review', measuredAt: '2026-09-02T09:00:00+09:00', views: 50 });
    await publishBrandReport({ sql }, studio, { projectId, requestId: randomUUID(), summary: 'Original final', periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    await activateBrandProject({ sql }, studio, { projectId, expectedRevision: 1, status: 'completed' });
    const input = batch([row(first, 0, { views: 600 })]);
    const permit = { projectId, requestId: input.requestId, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    expect(await saveBrandPostMetricsBatch({ sql }, studio, input)).toMatchObject({ ok: false, code: 'not_active' });
    vi.stubEnv('BRAND_COMPLETED_METRICS_ONCE', JSON.stringify(permit));
    expect(await saveBrandPostMetricsBatch({ sql }, a, input)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { ...input, requestId: randomUUID() })).toMatchObject({ ok: false, code: 'not_active' });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { ...input, rows: [row(first, 9)] })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await updateBrandPostMetrics({ sql }, studio, single(first, 0, { measuredAt: new Date().toISOString() }))).toMatchObject({ ok: false, code: 'not_active' });
    expect((await sql.query('select id from brand_post_collection_batches')).rows).toHaveLength(0);
    const saved = await saveBrandPostMetricsBatch({ sql }, studio, input);
    expect(saved).toMatchObject({ ok: true, saved: 1 });
    expect(await saveBrandPostMetricsBatch({ sql }, studio, input)).toEqual(saved);
    expect(await saveBrandPostMetricsBatch({ sql }, studio, { ...input, rows: [row(first, 1, { views: 601 })] })).toMatchObject({ ok: false, code: 'conflict' });
    const otherAdmin = 'f0000000-0000-4000-8000-000000000014';
    await seedProfile(sql, { id: otherAdmin, isAdmin: true });
    expect(await saveBrandPostMetricsBatch({ sql }, viewer(otherAdmin, true), input)).toMatchObject({ ok: false, code: 'conflict' });
    const loaded = (await loadBrandProject({ sql }, a, projectId))!;
    expect(loaded.status).toBe('completed');
    expect(loaded.posts[0]).toMatchObject({ views: 600, metricRevision: 1 });
    expect(loaded.reports[0]!.snapshot.viewsTotal).toBe(50);
    expect((await history(first)).map(r => Number(r.views))).toEqual([50, 600]);
    expect((await sql.query('select id from brand_post_collection_batches')).rows).toHaveLength(1);
  });

  it('fails closed for expired, malformed or differently scoped one-time permits, including cancelled campaigns', async () => {
    const postId = await newPost();
    await activateBrandProject({ sql }, studio, { projectId, expectedRevision: 1, status: 'completed' });
    const input = batch([row(postId, 0)]);
    for (const value of [
      'invalid',
      JSON.stringify({ projectId, requestId: input.requestId, expiresAt: 'invalid' }),
      JSON.stringify({ projectId, requestId: input.requestId, expiresAt: new Date(Date.now() - 1000).toISOString() }),
      JSON.stringify({ projectId: randomUUID(), requestId: input.requestId, expiresAt: new Date(Date.now() + 3600000).toISOString() }),
    ]) {
      vi.stubEnv('BRAND_COMPLETED_METRICS_ONCE', value);
      expect(await saveBrandPostMetricsBatch({ sql }, studio, input)).toMatchObject({ ok: false, code: 'not_active' });
    }
    const cancelled = await newProject();
    const other = await newPost({}, cancelled);
    await activateBrandProject({ sql }, studio, { projectId: cancelled, expectedRevision: 1, status: 'cancelled' });
    const cancelledInput = { projectId: cancelled, requestId: randomUUID(), rows: [row(other, 0)] };
    vi.stubEnv('BRAND_COMPLETED_METRICS_ONCE', JSON.stringify({ ...cancelledInput, rows: undefined, expiresAt: new Date(Date.now() + 3600000).toISOString() }));
    expect(await saveBrandPostMetricsBatch({ sql }, studio, cancelledInput)).toMatchObject({ ok: false, code: 'not_active' });
    expect(await history(postId)).toHaveLength(0);
  });
});

describe('0030 backfill of stored initial observations', () => {
  it('copies only a really stored initial observation with its own time, and invents nothing else', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { coreMigrationFiles, readMigration } = await import('@/lib/db/migrations');
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      const files = coreMigrationFiles();
      const target = files.indexOf('0030_core_brand_post_collection.sql');
      expect(target).toBeGreaterThan(0);
      for (const file of files.slice(0, target)) await db.exec(readMigration(file));
      const sql = runner(db);
      for (const id of [A, S]) await seedProfile(sql, { id, isAdmin: id === S });
      const [org, project, content, file] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await sql.query('insert into brand_organizations(id,name,created_by,request_id) values($1,$2,$3,$4)', [org, 'Legacy Brand', A, randomUUID()]);
      await sql.query("insert into brand_projects(id,organization_id,title,objective,audience,production_mode,created_by,request_id,status) values($1,$2,'Legacy campaign','Objective','','creator',$3,$4,'active')", [project, org, A, randomUUID()]);
      await sql.query("insert into brand_attachments(id,organization_id,project_id,name,mime,size_bytes,storage_key,created_by,request_id) values($1,$2,$3,'a.pdf','application/pdf',8,$4,$5,$6)", [file, org, project, `brands/${file}`, S, randomUUID()]);
      await sql.query("insert into brand_content_versions(id,organization_id,project_id,slot_key,version,title,attachment_id,caption,usage_rights,creator_consent_confirmed,created_by,request_id,asset_sha256) values($1,$2,$3,'hero',1,'Film',$4,'','Organic',false,$5,$6,$7)", [content, org, project, file, S, randomUUID(), 'a'.repeat(64)]);
      const post = async (n: number, measured: boolean, metricRevision: number) => {
        const id = randomUUID();
        await sql.query(`insert into brand_posts(id,organization_id,project_id,content_version_id,url,platform,platform_post_id,published_at,metric_revision,verification,metrics_source,measured_at,views,created_by,request_id,created_at)
          values($1,$2,$3,$4,$5,'instagram',$6,'2026-08-01T00:00:00Z',$7,'manual',$8,$9,$10,$11,$12,'2026-08-03T00:00:00Z')`,
          [id, org, project, content, `https://www.instagram.com/p/OLD${n}/`, `OLD${n}`, metricRevision, measured ? 'studio_review' : 'unavailable', measured ? '2026-08-02T03:00:00Z' : null, measured ? 10 * n : null, S, randomUUID()]);
        return id;
      };
      const [initialOnly, neverMeasured, alreadyRevised] = [await post(1, true, 0), await post(2, false, 0), await post(3, true, 1)];
      await sql.query("insert into brand_post_measurements(organization_id,project_id,post_id,revision,verification,metrics_source,measured_at,views,created_by,request_id) values($1,$2,$3,1,'manual','studio_review','2026-08-02T03:00:00Z',30,$4,$5)", [org, project, alreadyRevised, S, randomUUID()]);
      await db.exec(readMigration('0030_core_brand_post_collection.sql'));
      const rows = (await sql.query<{ post_id: string; revision: number; views: string; measured_at: Date; created_at: Date }>('select post_id,revision,views,measured_at,created_at from brand_post_measurements order by revision')).rows;
      expect(rows.map(r => [r.post_id, r.revision, Number(r.views)])).toEqual([[initialOnly, 0, 10], [alreadyRevised, 1, 30]]);
      expect(new Date(rows[0]!.measured_at).toISOString()).toBe('2026-08-02T03:00:00.000Z');
      expect(new Date(rows[0]!.created_at).toISOString()).toBe('2026-08-03T00:00:00.000Z');
      expect(rows.some(r => r.post_id === neverMeasured)).toBe(false);
    } finally { await db.close(); }
  });
});
