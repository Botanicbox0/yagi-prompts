import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { readMigration } from '@/lib/db/migrations';
import { normalizeBrandPostUrl, BrandCriteriaSchema } from '@/lib/brands/workspace/schemas';
import { createBrandOrganization, createBrandInvitation, acceptBrandInvitation, loadBrandMembers, revokeBrandMember,
  createBrandProject, sendBrandMessage, loadBrandProject, reserveBrandAttachment, completeBrandAttachment, loadBrandAttachmentAccess,
} from '@/lib/brands/workspace/service';

const A = 'f0000000-0000-4000-8000-000000000001', B = 'f0000000-0000-4000-8000-000000000002';
const a: Viewer = { userId: A, email: 'owner@example.com', tier: 'free', isAdmin: false, locale: 'ko' };
const b: Viewer = { ...a, userId: B, email: 'member@example.com' };
describe('brand invitations, attachment bytes and database boundary', () => {
  let db: PGlite, sql: SqlRunner, orgId: string;
  beforeEach(async () => {
    db = await freshDb(); sql = runner(db);
    await seedProfile(sql, { id: A, email: a.email! }); await seedProfile(sql, { id: B, email: b.email! });
    const org = await createBrandOrganization({ sql }, a, { name: 'Owner organization', requestId: randomUUID() });
    if (!org.ok) throw Error(org.code); orgId = org.id;
  });
  afterEach(async () => db?.close());
  const invite = async (role: 'editor' | 'viewer' = 'editor') => {
    const result = await createBrandInvitation({ sql }, a, { organizationId: orgId, email: b.email, role, requestId: randomUUID() });
    if (!result.ok) throw Error(result.code); return result;
  };
  const createProject = async () => {
    const p = await createBrandProject({ sql }, a, { organizationId: orgId, requestId: randomUUID(), title: 'Project test', objective: 'Measure the launch', audience: '', budgetKrw: null, productionMode: 'creator' });
    if (!p.ok) throw Error(p.code); return p.id;
  };
  it('stores invite hashes only and requires both verified session and matching profile email', async () => {
    const i = await invite();
    expect(JSON.stringify((await sql.query('select * from brand_invites')).rows)).not.toContain(i.token);
    expect((await sql.query('select token_hash from brand_invites')).rows[0]?.token_hash).toBe(createHash('sha256').update(i.token).digest('hex'));
    expect(await acceptBrandInvitation({ sql }, b, { token: i.token })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await acceptBrandInvitation({ sql, verifiedEmail: 'someone@example.com' }, b, { token: i.token })).toMatchObject({ ok: false });
    expect(await acceptBrandInvitation({ sql, verifiedEmail: b.email! }, b, { token: i.token })).toEqual({ ok: true, organizationId: orgId });
    expect(await acceptBrandInvitation({ sql, verifiedEmail: b.email! }, b, { token: i.token })).toEqual({ ok: true, organizationId: orgId });
    await revokeBrandMember({ sql }, a, { organizationId: orgId, userId: B });
    expect(await acceptBrandInvitation({ sql, verifiedEmail: b.email! }, b, { token: i.token })).toMatchObject({ ok: false, code: 'not_found' });
  });
  it('rejects expired invitations, invite escalation and nonowner member lists', async () => {
    const i = await invite('viewer');
    await sql.query("update brand_invites set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1", [i.id]);
    expect(await acceptBrandInvitation({ sql, verifiedEmail: b.email! }, b, { token: i.token })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await createBrandInvitation({ sql }, a, { organizationId: orgId, email: b.email, role: 'owner', requestId: randomUUID() })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await loadBrandMembers({ sql }, b, orgId)).toBeNull();
    const next = await invite('viewer'); await acceptBrandInvitation({ sql, verifiedEmail: b.email! }, b, { token: next.token });
    expect(await loadBrandMembers({ sql }, b, orgId)).toBeNull();
    const projectId = await createProject();
    expect(await loadBrandProject({ sql }, b, projectId)).not.toBeNull();
    expect(await sendBrandMessage({ sql }, b, { projectId, body: 'Not allowed', requestId: randomUUID() })).toMatchObject({ ok: false, code: 'forbidden' });
  });
  it('owner revocation takes effect immediately and the last owner cannot be removed', async () => {
    const i = await invite(); await acceptBrandInvitation({ sql, verifiedEmail: b.email! }, b, { token: i.token });
    const projectId = await createProject();
    expect((await loadBrandMembers({ sql }, a, orgId))?.members.find(m => m.userId === B)?.email).toBe(b.email);
    expect(await revokeBrandMember({ sql }, b, { organizationId: orgId, userId: A })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await revokeBrandMember({ sql }, a, { organizationId: orgId, userId: A })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await revokeBrandMember({ sql }, a, { organizationId: orgId, userId: B })).toMatchObject({ ok: true });
    expect(await loadBrandProject({ sql }, b, projectId)).toBeNull();
  });
  it('does not expose pending files and verifies real MIME/size before marking ready', async () => {
    const projectId = await createProject();
    const input = { projectId, requestId: randomUUID(), name: 'brief.pdf', mime: 'application/pdf', sizeBytes: 8 };
    const file = await reserveBrandAttachment({ sql }, a, input); if (!file.ok) throw Error(file.code);
    expect(await loadBrandAttachmentAccess({ sql }, a, file.id)).toBeNull();
    expect(await completeBrandAttachment({ sql, storage: { read: async () => Buffer.from('notapdf!') } }, a, file.id)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await completeBrandAttachment({ sql, storage: { read: async () => Buffer.from('%PDF-1.7 too long') } }, a, file.id)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await completeBrandAttachment({ sql, storage: { read: async () => Buffer.from('%PDF-1.7') } }, a, file.id)).toMatchObject({ ok: true });
    expect(await reserveBrandAttachment({ sql }, a, input)).toMatchObject({ ok: false, code: 'conflict' });
    expect(await reserveBrandAttachment({ sql }, a, { ...input, requestId: randomUUID(), mime: 'video/mp4', sizeBytes: 50_000_001 })).toMatchObject({ ok: false, code: 'invalid' });
  });
  it('forces RLS and denies all direct browser table access while granting minimal server writes', async () => {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
    await db.exec(readMigration('0113_glue_brand_workspace.sql'));
    await db.exec(readMigration('0116_glue_brand_post_collection.sql'));
    await db.exec(readMigration('0117_glue_brand_managed_workspace.sql'));
    await db.exec(readMigration('0118_glue_brand_profile_support.sql'));
    await db.exec(readMigration('0119_glue_brand_production.sql'));
    await db.exec(readMigration('0121_glue_brand_organization_logo.sql'));
    await db.exec(readMigration('0146_glue_brand_shortlist.sql'));
    await db.exec(readMigration('0150_glue_brand_entitlements.sql'));
    await db.exec(readMigration('0151_glue_brand_identity.sql'));
    const tables =(await sql.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relname,relrowsecurity,relforcerowsecurity from pg_class where relkind='r' and relname like 'brand_%' and relname not in ('brand_inquiries', 'brand_inquiry_deliveries') and relname not like 'brand_usage_%'")).rows; // Inquiry delivery and brand_usage_* have their own RLS tests.
    expect(tables.map(t=>t.relname)).toEqual(expect.arrayContaining(['brand_project_members','brand_contract_documents','brand_contract_sharing_events','brand_support_messages','brand_shortlist_candidates','brand_feature_policies','brand_feature_policy_events','brand_plan_assignments','brand_plan_events','brand_identities','brand_identity_events','brand_memory_events','brand_looks']));
    expect(tables.length).toBe(30);
    for (const table of tables) {
      expect(table.relrowsecurity && table.relforcerowsecurity).toBe(true);
      for (const role of ['anon', 'authenticated']) {
        expect((await sql.query<{ allowed: boolean }>('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') as allowed', [role, table.relname])).rows[0]?.allowed).toBe(false);
      }
    }
    expect((await sql.query<{ allowed: boolean }>("select has_table_privilege('service_role','brand_reports','UPDATE,DELETE') as allowed")).rows[0]?.allowed).toBe(false);
    for (const history of ['brand_post_measurements', 'brand_post_collection_batches', 'brand_organization_logos']) {
      expect((await sql.query<{ allowed: boolean }>('select has_table_privilege(\'service_role\',$1,\'UPDATE,DELETE\') as allowed', [history])).rows[0]?.allowed).toBe(false);
      expect((await sql.query<{ allowed: boolean }>('select has_table_privilege(\'service_role\',$1,\'SELECT\') and has_table_privilege(\'service_role\',$1,\'INSERT\') as allowed', [history])).rows[0]?.allowed).toBe(true);
    }
    await db.exec('set role authenticated');
    await expect(sql.query('select * from brand_projects')).rejects.toThrow(/permission denied/i);
    await db.exec('reset role');
  });
  it('validates campaign aspirations separately from measured results', () => {
    expect(BrandCriteriaSchema.safeParse({ minFollowers: 200, maxFollowers: 100 }).success).toBe(false);
    expect(BrandCriteriaSchema.safeParse({ platforms: ['linkedin'] }).success).toBe(false);
    expect(BrandCriteriaSchema.parse({ platforms: ['instagram','instagram'], primaryMetric: 'content_count', targetValue: 5 })).toMatchObject({ platforms: ['instagram'], targetValue: 5 });
  });
  it('normalizes alternate social URLs to one actual platform post identity', () => {
    expect(normalizeBrandPostUrl('https://youtu.be/abcdefghijk')).toEqual(normalizeBrandPostUrl('https://www.youtube.com/watch?v=abcdefghijk'));
    expect(normalizeBrandPostUrl('https://youtube.com/shorts/abcdefghijk')).toEqual(normalizeBrandPostUrl('https://youtu.be/abcdefghijk'));
    expect(normalizeBrandPostUrl('https://x.com/one/status/12345')).toEqual(normalizeBrandPostUrl('https://twitter.com/two/status/12345'));
  });
});
