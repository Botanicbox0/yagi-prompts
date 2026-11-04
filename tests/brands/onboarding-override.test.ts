import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PGlite } from '@electric-sql/pglite';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  BrandOnboardingIngestInputSchema,
  PROJECT_DIRECTION_PRESETS,
  ProjectDirectionOverrideSchema,
  confirmedIdentityFor,
  filterMemoryForProjectScope,
  ingestBrandOnboarding,
  kaiperOnboardingPreset,
  listLooks,
  listMemory,
  loadBrandIdentity,
  loadProjectDirectionForProject,
  loadProjectDirectionOverrides,
  markConfirmedBrandIdentity,
  promoteProjectDirectionToBase,
  resolveEffectiveBrandDirection,
  saveProjectDirectionOverride,
  synthesizeBrandIdentityFromIngest
} from '@/lib/brands/identity/service';
import {
  approveBrandBrief,
  compileBrandBrief
} from '@/lib/brands/briefs/service';
import { BrandOnboardingWizard } from '@/components/brand-workspace/brand-onboarding-wizard';
import { BrandBriefStudio } from '@/components/brand-workspace/brand-brief-studio';

const adminId = randomUUID();
const ownerId = randomUUID();
const editorId = randomUUID();
const viewerId = randomUUID();

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

let db: PGlite;
let sql: SqlRunner;
let orgId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, editorId, viewerId]) {
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`
    });
  }
  const created = await createStudioOrganization({ sql }, admin, {
    name: 'KAIPER',
    requestId: randomUUID()
  });
  if (!created.ok) throw new Error(created.code);
  orgId = created.id;
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

describe('Bounded Multi-Channel Brand Onboarding Ingest', () => {
  it('synthesizes KAIPER Base Brand DNA from multi-channel ingest within system limits', () => {
    const preset = kaiperOnboardingPreset(orgId);
    const parsed = BrandOnboardingIngestInputSchema.safeParse(preset);
    expect(parsed.success).toBe(true);

    const result = synthesizeBrandIdentityFromIngest(preset);
    expect(result.summary.brandName).toBe('KAIPER');
    expect(result.summary.instagramHandle).toBe('@kaiper.official');
    expect(result.summary.websiteUrls).toHaveLength(2);
    expect(result.summary.instagramPostUrls).toHaveLength(3);
    expect(result.summary.assetCounts).toEqual({
      logo: 1,
      product: 2,
      mood: 2,
      total: 5
    });
    expect(result.identity.rules.consentedFacesOnly).toBe(true);
    expect(result.identity.world.skinProtected).toBe(true);
    expect(result.identity.rules.never).toHaveLength(3);
    expect(result.identity.references.length).toBeGreaterThanOrEqual(5);
  });

  it('strictly enforces system capacity caps and rejects non-https or local URLs', () => {
    const base = kaiperOnboardingPreset(orgId);

    // > 2 website URLs rejected
    expect(
      BrandOnboardingIngestInputSchema.safeParse({
        ...base,
        websiteUrls: [
          'https://kaiper.kr',
          'https://kaiper.kr/lookbook',
          'https://kaiper.kr/about'
        ]
      }).success
    ).toBe(false);

    // http:// or localhost rejected
    expect(
      BrandOnboardingIngestInputSchema.safeParse({
        ...base,
        websiteUrls: ['http://kaiper.kr']
      }).success
    ).toBe(false);
    expect(
      BrandOnboardingIngestInputSchema.safeParse({
        ...base,
        websiteUrls: ['https://localhost:3000/brand']
      }).success
    ).toBe(false);

    // > 6 Instagram post URLs rejected
    expect(
      BrandOnboardingIngestInputSchema.safeParse({
        ...base,
        instagramPostUrls: Array.from(
          { length: 7 },
          (_, i) => `https://www.instagram.com/p/kaiper-${i}/`
        )
      }).success
    ).toBe(false);

    // > 2 logo assets rejected
    expect(
      BrandOnboardingIngestInputSchema.safeParse({
        ...base,
        assets: [
          { slot: 'logo', label: 'L1', preserveNote: 'keep' },
          { slot: 'logo', label: 'L2', preserveNote: 'keep' },
          { slot: 'logo', label: 'L3', preserveNote: 'keep' }
        ]
      }).success
    ).toBe(false);

    // > 6 product assets rejected
    expect(
      BrandOnboardingIngestInputSchema.safeParse({
        ...base,
        assets: Array.from({ length: 7 }, (_, i) => ({
          slot: 'product' as const,
          label: `P${i}`,
          preserveNote: 'keep'
        }))
      }).success
    ).toBe(false);
  });

  it('persists onboarding ingest, auto-confirms Base DNA, seeds look preset, and blocks Morphic', async () => {
    const preset = {
      ...kaiperOnboardingPreset(orgId),
      autoConfirm: true
    };
    const res = await ingestBrandOnboarding({ sql }, owner, preset);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe('confirmed');
    expect(res.summary.brandName).toBe('KAIPER');

    const confirmed = await confirmedIdentityFor(sql, orgId);
    expect(confirmed).not.toBeNull();
    expect(confirmed?.rules.consentedFacesOnly).toBe(true);

    const looks = await listLooks(sql, orgId);
    expect(looks.length).toBeGreaterThanOrEqual(1);

    // Viewer cannot ingest
    const viewerTry = await ingestBrandOnboarding({ sql }, memberViewer, preset);
    expect(viewerTry).toEqual({ ok: false, code: 'forbidden' });

    // Morphic (generative_media denied) is blocked with feature_unavailable
    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['generative_media', 'sound', 'color_grading'],
      note: 'Morphic policy',
      expectedRevision: 0
    });
    const morphicTry = await ingestBrandOnboarding({ sql }, owner, preset);
    expect(morphicTry).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});

describe('2-Tier Brand Inheritance & Project-Specific Direction Override', () => {
  it('merges Project Soft Overrides while keeping Base Brand DNA Hard Locks immutable', () => {
    const base = markConfirmedBrandIdentity(
      synthesizeBrandIdentityFromIngest(kaiperOnboardingPreset(orgId)).identity
    );

    const override = ProjectDirectionOverrideSchema.parse({
      organizationId: orgId,
      projectId: 'kaiper-26ss-outdoor',
      enabled: true,
      ...PROJECT_DIRECTION_PRESETS.outdoor_golden_hour,
      title: 'KAIPER 26SS 야외 골든아워 캠페인',
      colourAccentOverride: '#1f4f8f',
      ownedHueOverride: [200, 230],
      isolateProjectMemory: true
    });

    const resolved = resolveEffectiveBrandDirection(base, override);
    expect(resolved.cascade.mode).toBe('project_override');
    expect(resolved.cascade.projectId).toBe('kaiper-26ss-outdoor');
    expect(resolved.cascade.lockedFromBase).toEqual([
      'consented_faces_only',
      'logo_geometry_and_clearspace',
      'base_never_taboos',
      'skin_tone_protection'
    ]);
    expect(resolved.cascade.overriddenByProject).toContain('colour_accent');
    expect(resolved.cascade.overriddenByProject).toContain('owned_hue_band');
    expect(resolved.cascade.overriddenByProject).toContain('camera_optics');
    expect(resolved.cascade.overriddenByProject).toContain('lighting_setup');
    expect(resolved.cascade.overriddenByProject).toContain('look_preset');

    // Hard Locks from Base DNA are never weakened:
    expect(resolved.effectiveIdentity.rules.consentedFacesOnly).toBe(true);
    expect(resolved.effectiveIdentity.world.skinProtected).toBe(true);
    expect(resolved.effectiveIdentity.rules.logo).toEqual(base.rules.logo);
    expect(resolved.effectiveIdentity.rules.never).toEqual(base.rules.never);

    // Soft Overrides are applied:
    expect(resolved.effectiveIdentity.colour.accent).toBe('#1f4f8f');
    expect(resolved.effectiveIdentity.world.ownedHue).toEqual([200, 230]);
    expect(resolved.shotDefaults.cameraFocalMm).toBe(35);
    expect(resolved.shotDefaults.lightColourK).toBe(3900);
    expect(resolved.shotDefaults.lookPresetId).toBe('kodak-2383-warm');
  });

  it('allows editors to save project direction overrides, isolates project memory, and promotes to Base DNA', async () => {
    await ingestBrandOnboarding(
      { sql },
      owner,
      { ...kaiperOnboardingPreset(orgId), autoConfirm: true }
    );

    // Editor can save a project direction override without changing Base DNA
    const savedOverride = await saveProjectDirectionOverride({ sql }, editor, {
      organizationId: orgId,
      projectId: 'kaiper-26ss-outdoor',
      enabled: true,
      ...PROJECT_DIRECTION_PRESETS.outdoor_golden_hour,
      colourAccentOverride: '#1f4f8f',
      isolateProjectMemory: true
    });
    expect(savedOverride.ok).toBe(true);

    const loaded = await loadProjectDirectionForProject(
      sql,
      orgId,
      'kaiper-26ss-outdoor'
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe(PROJECT_DIRECTION_PRESETS.outdoor_golden_hour.title);

    const allOverrides = await loadProjectDirectionOverrides(sql, orgId);
    expect(Object.keys(allOverrides)).toHaveLength(1);

    // Compile a ShotSpec using the saved project override
    const compiled = await compileBrandBrief({ sql }, editor, {
      organizationId: orgId,
      projectId: 'kaiper-26ss-outdoor',
      quick: {
        brief: '야외 한강 콘크리트 산책로에서 아우터 실루엣 클로즈업',
        cutKind: 'reference_exact_product',
        medium: 'product still',
        aspect: '4:5',
        use: 'feed'
      }
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.view.directionCascade?.mode).toBe('project_override');
    expect(compiled.view.directionCascade?.projectId).toBe('kaiper-26ss-outdoor');
    expect(compiled.view.prompt).toContain(
      PROJECT_DIRECTION_PRESETS.outdoor_golden_hour.projectRulePrompt
    );

    // Approve the brief with isolateProjectMemory: true
    const approved = await approveBrandBrief({ sql }, editor, {
      organizationId: orgId,
      current: compiled.brief,
      aestheticGatePassed: true,
      projectId: 'kaiper-26ss-outdoor',
      isolateProjectMemory: true
    });
    expect(approved.ok).toBe(true);

    // Verify memory isolation: included for kaiper-26ss-outdoor, excluded for other-project or base
    const rawMemory = await listMemory(sql, orgId);
    const forSameProject = filterMemoryForProjectScope(
      rawMemory,
      'kaiper-26ss-outdoor'
    );
    const forOtherProject = filterMemoryForProjectScope(
      rawMemory,
      'kaiper-fw-studio'
    );
    const forBase = filterMemoryForProjectScope(rawMemory, null);

    expect(
      forSameProject.some((m) => m.kind === 'approved_cut')
    ).toBe(true);
    expect(
      forOtherProject.some((m) => m.kind === 'approved_cut')
    ).toBe(false);
    expect(
      forBase.some((m) => m.kind === 'approved_cut')
    ).toBe(false);

    // Editor cannot promote project override to Base Brand DNA (owner only)
    const editorPromote = await promoteProjectDirectionToBase({ sql }, editor, {
      organizationId: orgId,
      projectId: 'kaiper-26ss-outdoor'
    });
    expect(editorPromote).toEqual({ ok: false, code: 'forbidden' });

    // Owner promotes project override to Base Brand DNA
    const ownerPromote = await promoteProjectDirectionToBase({ sql }, owner, {
      organizationId: orgId,
      projectId: 'kaiper-26ss-outdoor'
    });
    expect(ownerPromote.ok).toBe(true);
    const updatedBase = await loadBrandIdentity(sql, orgId);
    expect(updatedBase?.identity.colour.accent).toBe('#1f4f8f');
  });

  it('renders BrandOnboardingWizard and BrandBriefStudio 2-tier cascade UI markers', () => {
    const wizardHtml = renderToStaticMarkup(
      createElement(BrandOnboardingWizard, {
        organizationId: orgId,
        organizationName: 'KAIPER',
        locale: 'ko',
        isOwner: true,
        currentStatus: 'none',
        currentRevision: 0
      })
    );
    expect(wizardHtml).toContain('data-brand-onboarding-wizard');
    expect(wizardHtml).toContain('data-onboarding-preset="kaiper"');
    expect(wizardHtml).toContain('data-onboarding-confirm-submit');

    const studioHtml = renderToStaticMarkup(
      createElement(BrandBriefStudio, {
        organizationId: orgId,
        locale: 'ko',
        canWrite: true,
        identityConfirmed: true,
        initialProjectId: 'kaiper-26ss-outdoor'
      })
    );
    expect(studioHtml).toContain('data-project-direction-panel');
    expect(studioHtml).toContain('data-direction-cascade-summary');
    expect(studioHtml).toContain('data-project-direction-save');
    expect(studioHtml).toContain('data-project-direction-promote');
  });
});
