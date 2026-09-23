import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import * as s from '@/lib/brands/workspace/service';
import { loadStudioInbox } from '@/lib/brands/workspace/inbox';
import { TWINGS_STAFF_EMAIL_DOMAIN } from '@/lib/brands/workspace/staff';
import { StudioInboxPanel } from '@/components/admin/studio-inbox';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * P1-2: brand support messages (including the "전용 템플릿 의뢰" brief, which is a support message)
 * and campaign comments reach a studio queue. Real PGlite and the real brand-workspace service.
 */
const ids = { admin: randomUUID(), owner: randomUUID(), staff: randomUUID() };
const as = (userId: string, email: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? 'admin' : 'free', email, locale: 'ko' });
const admin = as(ids.admin, 'admin@example.test', true);
const owner = as(ids.owner, 'owner@example.test');
const staff = as(ids.staff, `ops@${TWINGS_STAFF_EMAIL_DOMAIN}`);
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

let db: PGlite;
let sql: SqlRunner;
let orgId: string;
let projectId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  await seedProfile(sql, { id: ids.admin, email: admin.email!, isAdmin: true });
  await seedProfile(sql, { id: ids.owner, email: owner.email! });
  await seedProfile(sql, { id: ids.staff, email: staff.email! });
  // The owner's own workspace (owner membership), with a studio-run campaign shared into it.
  orgId = idOf(await s.createBrandOrganization({ sql }, owner, { name: 'Fixture brand', requestId: randomUUID() }));
  projectId = idOf(await s.createStudioProject({ sql }, admin, { organizationId: orgId, title: 'Fixture campaign', objective: 'Fixture objective', budgetKrw: null, productionMode: 'creator', requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, admin, { projectId, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, admin, { projectId, expectedRevision: 1, status: 'active' }));
});
afterEach(async () => db.close());

describe('loadStudioInbox', () => {
  it('is empty until a brand writes', async () => {
    expect(await loadStudioInbox({ sql }, admin)).toEqual([]);
  });

  it('lists a brand support message (the studio inquiry path) until the studio replies', async () => {
    idOf(await s.sendBrandSupport({ sql }, owner, { organizationId: orgId, body: '전용 템플릿 의뢰\n\nFixture brief', requestId: randomUUID() }));
    expect(await loadStudioInbox({ sql }, admin)).toMatchObject([
      { kind: 'support', organizationId: orgId, organizationName: 'Fixture brand', projectId: null, href: `/admin/brand-workspace/organizations/${orgId}` },
    ]);
    idOf(await s.sendBrandSupport({ sql }, admin, { organizationId: orgId, body: 'Studio reply', requestId: randomUUID() }));
    expect(await loadStudioInbox({ sql }, admin)).toEqual([]);
  });

  it('lists a campaign comment until the studio replies', async () => {
    idOf(await s.sendBrandMessage({ sql }, owner, { projectId, body: 'Fixture question', requestId: randomUUID() }));
    expect(await loadStudioInbox({ sql }, admin)).toMatchObject([
      { kind: 'project', projectId, projectTitle: 'Fixture campaign', organizationName: 'Fixture brand', href: `/admin/brand-workspace/${projectId}` },
    ]);
    idOf(await s.sendBrandMessage({ sql }, admin, { projectId, body: 'Studio answer', requestId: randomUUID() }));
    expect(await loadStudioInbox({ sql }, admin)).toEqual([]);
  });

  it('refuses anyone who is not the studio, including domain-only staff and anonymous viewers', async () => {
    idOf(await s.sendBrandSupport({ sql }, owner, { organizationId: orgId, body: 'Waiting', requestId: randomUUID() }));
    expect(await loadStudioInbox({ sql }, owner)).toBeNull();
    expect(await loadStudioInbox({ sql }, staff)).toBeNull();
    // A forged client-side admin flag changes nothing: the profile row decides.
    expect(await loadStudioInbox({ sql }, { ...staff, isAdmin: true, tier: 'admin' })).toBeNull();
    expect(await loadStudioInbox({ sql }, { tier: 'anon', userId: null, email: null, isAdmin: false, locale: null })).toBeNull();
  });
});

describe('StudioInboxPanel', () => {
  it('links each waiting thread to the page where the studio answers it', async () => {
    idOf(await s.sendBrandSupport({ sql }, owner, { organizationId: orgId, body: 'Waiting', requestId: randomUUID() }));
    idOf(await s.sendBrandMessage({ sql }, owner, { projectId, body: 'Question', requestId: randomUUID() }));
    const entries = (await loadStudioInbox({ sql }, admin))!;
    const html = renderToStaticMarkup(<StudioInboxPanel entries={entries} admin={getDictionary('ko').admin} locale="ko" />);
    expect(html).toContain('data-studio-inbox="2"');
    expect(html).toContain(getDictionary('ko').admin.inboxHeading);
    expect(html).toContain(`href="/admin/brand-workspace/organizations/${orgId}"`);
    expect(html).toContain(`href="/admin/brand-workspace/${projectId}"`);
    expect(html).toContain('Fixture campaign');
  });

  it('says so when nothing is waiting', () => {
    const html = renderToStaticMarkup(<StudioInboxPanel entries={[]} admin={getDictionary('en').admin} locale="en" />);
    expect(html).toContain('data-studio-inbox="0"');
    expect(html).toContain(getDictionary('en').admin.inboxEmpty);
  });
});
