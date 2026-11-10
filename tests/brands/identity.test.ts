import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import {
  ADMIN_VIEWER,
  adminHarness,
  expectOk,
  type AdminHarness
} from '@/tests/helpers/admin';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  createStudioOrganization,
  loadBrandWorkspaceScope
} from '@/lib/brands/workspace/service';
import {
  sectionVisibility,
  switchHref
} from '@/lib/brands/workspace/selection';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  BrandIdentitySchema,
  confirmBrandIdentity,
  confirmedIdentityFor,
  draftFromTwingsDefaults,
  listLooks,
  listMemory,
  loadBrandIdentity,
  recordMemory,
  saveBrandIdentity,
  saveLook,
  twingsDefaultIdentity
} from '@/lib/brands/identity/service';

const adminId = randomUUID();
const ownerId = randomUUID();
const editorId = randomUUID();
const viewerId = randomUUID();
const outsiderId = randomUUID();

const makeViewer = (userId: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? 'admin' : 'free',
  email: `${userId}@example.test`,
  locale: 'ko'
});

const admin = makeViewer(adminId, true);
const owner = makeViewer(ownerId);
const editor = makeViewer(editorId);
const memberViewer = makeViewer(viewerId);
const outsider = makeViewer(outsiderId);

let db: PGlite;
let sql: SqlRunner;
let orgId: string;

const idOf = (r: { ok: boolean; id?: string; code?: string }) => {
  if (!r.ok || !r.id) throw Error(r.code);
  return r.id;
};

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, editorId, viewerId, outsiderId]) {
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`
    });
  }
  orgId = idOf(
    await createStudioOrganization({ sql }, admin, {
      name: 'Identity fixture',
      requestId: randomUUID()
    })
  );
  await sql.query(
    `insert into brand_memberships (organization_id, user_id, role)
       values ($1, $2, 'owner'),
              ($1, $3, 'editor'),
              ($1, $4, 'viewer')`,
    [orgId, ownerId, editorId, viewerId]
  );
});

afterEach(async () => {
  await db?.close();
});

describe('BrandIdentitySchema validation', () => {
  it('accepts twingsDefaultIdentity() and enforces contrast, never<=3, references<=14, consentedFacesOnly=true', () => {
    const base = twingsDefaultIdentity();
    expect(BrandIdentitySchema.safeParse(base).success).toBe(true);

    // Low-contrast accent colour against #ffffff (< 4.5:1)
    const lowContrast = BrandIdentitySchema.safeParse({
      ...base,
      colour: { ...base.colour, accent: '#8ab4f8' }
    });
    expect(lowContrast.success).toBe(false);
    if (!lowContrast.success) {
      expect(lowContrast.error.issues[0]?.path).toEqual(['colour', 'accent']);
    }

    // More than 3 never rules
    const fourNever = BrandIdentitySchema.safeParse({
      ...base,
      rules: {
        ...base.rules,
        never: ['one', 'two', 'three', 'four']
      }
    });
    expect(fourNever.success).toBe(false);

    // More than 14 references
    const fifteenRefs = BrandIdentitySchema.safeParse({
      ...base,
      references: Array.from({ length: 15 }, () => ({
        role: 'subject' as const,
        lend: 'bottle shape',
        not: 'background clutter'
      }))
    });
    expect(fifteenRefs.success).toBe(false);

    // consentedFacesOnly = false is rejected
    const unconsented = BrandIdentitySchema.safeParse({
      ...base,
      rules: {
        ...base.rules,
        consentedFacesOnly: false
      }
    });
    expect(unconsented.success).toBe(false);
  });
});

describe('brand identity lifecycle, permissions, and revision history', () => {
  it('allows only owner or admin to save and confirm, enforces revision checks, and hides drafts from confirmedIdentityFor', async () => {
    expect(await loadBrandIdentity(sql, orgId)).toBeNull();
    expect(await confirmedIdentityFor(sql, orgId)).toBeNull();

    const defaults = twingsDefaultIdentity();

    // Editor, viewer, and outsider are forbidden from saving identity
    for (const actor of [editor, memberViewer, outsider]) {
      expect(
        await saveBrandIdentity({ sql }, actor, {
          organizationId: orgId,
          expectedRevision: 0,
          identity: defaults
        })
      ).toMatchObject({ ok: false, code: 'forbidden' });
    }

    // Owner creates draft (revision 1)
    const draftRes = await draftFromTwingsDefaults({ sql }, owner, {
      organizationId: orgId,
      expectedRevision: 0
    });
    expect(draftRes).toMatchObject({
      ok: true,
      id: orgId,
      revision: 1,
      status: 'draft'
    });

    // Draft is readable via loadBrandIdentity, but NEVER returned by confirmedIdentityFor
    expect(await loadBrandIdentity(sql, orgId)).toMatchObject({
      organizationId: orgId,
      status: 'draft',
      revision: 1
    });
    expect(await confirmedIdentityFor(sql, orgId)).toBeNull();

    // Stale expectedRevision is rejected with conflict
    expect(
      await saveBrandIdentity({ sql }, owner, {
        organizationId: orgId,
        expectedRevision: 0,
        identity: defaults
      })
    ).toMatchObject({ ok: false, code: 'conflict' });

    // Editor and viewer cannot confirm
    for (const actor of [editor, memberViewer, outsider]) {
      expect(
        await confirmBrandIdentity({ sql }, actor, {
          organizationId: orgId,
          expectedRevision: 1
        })
      ).toMatchObject({ ok: false, code: 'forbidden' });
    }

    // Owner confirms (revision 2)
    const confirmRes = await confirmBrandIdentity({ sql }, owner, {
      organizationId: orgId,
      expectedRevision: 1
    });
    expect(confirmRes).toMatchObject({
      ok: true,
      id: orgId,
      revision: 2,
      status: 'confirmed'
    });

    // Now confirmedIdentityFor returns the confirmed identity
    const confirmed = await confirmedIdentityFor(sql, orgId);
    expect(confirmed).not.toBeNull();
    expect(confirmed?.colour.accent).toBe('#3875c5');

    // Admin saves a new draft edit (revision 3) -> status returns to draft until re-confirmed
    const edited = {
      ...defaults,
      voice: {
        ...defaults.voice,
        tone: '차분하고 정밀한 스튜디오 어조.'
      }
    };
    const editRes = await saveBrandIdentity({ sql }, admin, {
      organizationId: orgId,
      expectedRevision: 2,
      identity: edited
    });
    expect(editRes).toMatchObject({
      ok: true,
      id: orgId,
      revision: 3,
      status: 'draft'
    });
    expect(await confirmedIdentityFor(sql, orgId)).toBeNull();

    // Event log has all 3 transitions
    const events = (
      await sql.query<{ status: string; revision: number }>(
        'select status, revision from brand_identity_events where organization_id = $1 order by revision asc',
        [orgId]
      )
    ).rows;
    expect(events).toEqual([
      { status: 'draft', revision: 1 },
      { status: 'confirmed', revision: 2 },
      { status: 'draft', revision: 3 }
    ]);
  });
});

describe('brand_learning feature policy gate', () => {
  it('blocks identity, memory, look writes, confirmedIdentityFor, and sidebar visibility when brand_learning is denied', async () => {
    await draftFromTwingsDefaults({ sql }, owner, {
      organizationId: orgId,
      expectedRevision: 0
    });
    await confirmBrandIdentity({ sql }, owner, {
      organizationId: orgId,
      expectedRevision: 1
    });
    expect(await confirmedIdentityFor(sql, orgId)).not.toBeNull();

    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['brand_learning'],
      note: 'brand learning disabled',
      expectedRevision: 0
    });

    expect(await confirmedIdentityFor(sql, orgId)).toBeNull();
    expect(
      await saveBrandIdentity({ sql }, owner, {
        organizationId: orgId,
        expectedRevision: 2,
        identity: twingsDefaultIdentity()
      })
    ).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(
      await confirmBrandIdentity({ sql }, owner, {
        organizationId: orgId,
        expectedRevision: 2
      })
    ).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(
      await recordMemory({ sql }, owner, {
        organizationId: orgId,
        kind: 'note',
        payload: { summary: 'blocked' }
      })
    ).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(
      await saveLook({ sql }, owner, {
        organizationId: orgId,
        title: 'Blocked look',
        intensity: 0.8
      })
    ).toEqual({ ok: false, code: 'feature_unavailable' });

    const scope = await loadBrandWorkspaceScope({ sql }, owner);
    const choice = scope.choices.find((c) => c.id === orgId)!;
    expect(sectionVisibility(choice).identity).toBe(false);
    expect(switchHref('/brand/identity', choice)).toBe(
      `/brand?organizationId=${orgId}`
    );
  });
});

describe('operational memory and deterministic looks', () => {
  it('allows owner, editor, and admin to add memory events and looks, while rejecting viewer and invalid look intensity', async () => {
    // Viewer and outsider cannot add memory or looks
    for (const actor of [memberViewer, outsider]) {
      expect(
        await recordMemory({ sql }, actor, {
          organizationId: orgId,
          kind: 'note',
          payload: { summary: 'no' }
        })
      ).toMatchObject({ ok: false, code: 'forbidden' });
      expect(
        await saveLook({ sql }, actor, {
          organizationId: orgId,
          title: 'Denied look',
          intensity: 0.7
        })
      ).toMatchObject({ ok: false, code: 'forbidden' });
    }

    // Owner and editor can record memory
    const mem1 = await recordMemory({ sql }, owner, {
      organizationId: orgId,
      kind: 'approved_cut',
      payload: { summary: '자연광 창가 35mm 클로즈업 승인' }
    });
    expect(mem1.ok).toBe(true);

    const mem2 = await recordMemory({ sql }, editor, {
      organizationId: orgId,
      kind: 'banned_phrase',
      payload: { summary: '업계 최초라는 표현 금지' }
    });
    expect(mem2.ok).toBe(true);

    const memoryList = await listMemory(sql, orgId);
    expect(memoryList).toHaveLength(2);
    expect(memoryList.map((m) => m.kind)).toEqual([
      'banned_phrase',
      'approved_cut'
    ]);

    // Invalid look intensity outside 0..1 is rejected
    expect(
      await saveLook({ sql }, editor, {
        organizationId: orgId,
        title: 'Too strong',
        intensity: 1.25
      })
    ).toMatchObject({ ok: false, code: 'invalid', field: 'intensity' });
    expect(
      await saveLook({ sql }, editor, {
        organizationId: orgId,
        title: 'Negative',
        intensity: -0.1
      })
    ).toMatchObject({ ok: false, code: 'invalid', field: 'intensity' });

    // Valid looks saved by editor and admin
    const look1 = await saveLook({ sql }, editor, {
      organizationId: orgId,
      title: '쿨 데이라이트 에디토리얼',
      lutKey: 'luts/cool-daylight-v1.cube',
      intensity: 0.85,
      skinProtect: true,
      source: 'preset'
    });
    expect(look1.ok).toBe(true);

    const look2 = await saveLook({ sql }, admin, {
      organizationId: orgId,
      title: '레퍼런스 매칭 01',
      measurements: { lift: [0, 0, 0.02], gamma: [1, 1, 1.03] },
      intensity: 0.7,
      skinProtect: true,
      source: 'reference_match'
    });
    expect(look2.ok).toBe(true);

    const looks = await listLooks(sql, orgId);
    expect(looks).toHaveLength(2);
    expect(looks[0]).toMatchObject({
      title: '레퍼런스 매칭 01',
      intensity: 0.7,
      skinProtect: true,
      source: 'reference_match'
    });
    expect(looks[1]).toMatchObject({
      title: '쿨 데이라이트 에디토리얼',
      lutKey: 'luts/cool-daylight-v1.cube',
      intensity: 0.85,
      skinProtect: true,
      source: 'preset'
    });
  });
});

describe('admin registry: brandEngine.identityDraft and brandEngine.identityConfirm', () => {
  let harness: AdminHarness;
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('creates a draft and confirms it through /admin/do', async () => {
    const hsql = runner(harness.db);
    await seedProfile(hsql, {
      id: ADMIN_VIEWER.userId!,
      isAdmin: true,
      email: ADMIN_VIEWER.email!
    });
    const org = idOf(
      await createStudioOrganization({ sql: hsql }, ADMIN_VIEWER, {
        name: 'Admin identity fixture',
        requestId: randomUUID()
      })
    );

    const drafted = expectOk(
      await harness.run('brandEngine.identityDraft', {
        organizationId: org,
        expectedRevision: 0
      })
    );
    expect(drafted.to).toBe(`/admin/brand-workspace/organizations/${org}`);
    expect(await loadBrandIdentity(hsql, org)).toMatchObject({
      status: 'draft',
      revision: 1
    });
    expect(await confirmedIdentityFor(hsql, org)).toBeNull();

    const confirmed = expectOk(
      await harness.run('brandEngine.identityConfirm', {
        organizationId: org,
        expectedRevision: 1
      })
    );
    expect(confirmed.to).toBe(`/admin/brand-workspace/organizations/${org}`);
    expect(await loadBrandIdentity(hsql, org)).toMatchObject({
      status: 'confirmed',
      revision: 2
    });
    expect(await confirmedIdentityFor(hsql, org)).not.toBeNull();
  });
});
