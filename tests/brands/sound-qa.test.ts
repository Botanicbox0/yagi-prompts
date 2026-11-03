import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import {
  confirmBrandIdentity,
  draftFromTwingsDefaults,
  listMemory,
  twingsDefaultIdentity
} from '@/lib/brands/identity/service';
import {
  approveBrandBrief,
  compileBrandBrief,
  promoteBrandBrief,
  reviseBrandBrief
} from '@/lib/brands/briefs/service';
import {
  buildDeterministicSoundMasterSpec,
  computeViralDropSlice,
  prepareBrandSoundPlan,
  reconcileSoundVerdict,
  snapCuePlanToFrames,
  validateAudioLicenseGate
} from '@/lib/brands/sound';
import {
  computeDeltaE76,
  evaluatePaletteQa,
  evaluateProductChecklistQa,
  lintPublicBrandSurface
} from '@/lib/brands/qa';

const adminId = randomUUID();
const ownerId = randomUUID();

const makeViewer = (userId: string, isAdmin = false): Viewer => ({
  userId,
  isAdmin,
  tier: isAdmin ? 'admin' : 'free',
  email: `${userId}@example.test`,
  locale: 'ko'
});

const admin = makeViewer(adminId, true);
const owner = makeViewer(ownerId);

let db: PGlite;
let sql: SqlRunner;
let orgId: string;

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId]) {
    await seedProfile(sql, {
      id,
      isAdmin: id === adminId,
      email: `${id}@example.test`
    });
  }
  const orgRes = await createStudioOrganization({ sql }, admin, {
    name: 'Sound & QA fixture',
    requestId: randomUUID()
  });
  if (!orgRes.ok) throw Error(orgRes.code);
  orgId = orgRes.id;
  await sql.query(
    "insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
    [orgId, ownerId]
  );
});

afterEach(async () => {
  await db?.close();
});

describe('S3 studio brief service (compile -> revise -> approve -> promoteFinal)', () => {
  it('runs the full brief lifecycle, records approved cuts to memory, strips engine names, and enforces generative_media gate', async () => {
    await draftFromTwingsDefaults({ sql }, owner, {
      organizationId: orgId,
      expectedRevision: 0
    });
    await confirmBrandIdentity({ sql }, owner, {
      organizationId: orgId,
      expectedRevision: 1
    });

    const compiled = await compileBrandBrief({ sql }, owner, {
      organizationId: orgId,
      quick: {
        brief: '자연광 테이블 위 세럼 보틀과 정갈한 여백',
        cutKind: 'short_film_clip',
        medium: 'short film',
        aspect: '9:16',
        use: 'reel',
        productName: 'TWINGS Serum 50ml'
      }
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.view.stage).toBe('draft');
    expect(compiled.view.resolution).toBe('480p');
    expect(compiled.view.identitySource).toBe('confirmed');
    expect(
      lintPublicBrandSurface(JSON.stringify(compiled.view)).clean
    ).toBe(true);

    // 1-axis revision succeeds (Round 2)
    const revised = await reviseBrandBrief({ sql }, owner, {
      organizationId: orgId,
      current: compiled.brief,
      nextSpec: {
        ...compiled.brief.spec,
        light: {
          ...compiled.brief.spec.light,
          key: {
            ...compiled.brief.spec.light.key,
            modifier: 'low-angle golden-hour window light from left'
          }
        }
      }
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(revised.view.round).toBe(2);
    expect(revised.view.lastChangedAxis).toBe('light');

    // Approve brief -> locks hash and appends approved_cut to brand_memory_events
    const approved = await approveBrandBrief({ sql }, owner, {
      organizationId: orgId,
      current: revised.brief,
      aestheticGatePassed: true
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.view.stage).toBe('approved');
    expect(approved.view.lockedSpecHash).toBeTruthy();

    const memories = await listMemory(sql, orgId);
    expect(memories.some((m) => m.kind === 'approved_cut')).toBe(true);

    // Promote to final 1080p master
    const promoted = await promoteBrandBrief({ sql }, owner, {
      organizationId: orgId,
      current: approved.brief,
      finalResolution: '1080p'
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.view.stage).toBe('final');
    expect(promoted.view.resolution).toBe('1080p');
    expect(promoted.view.draftFlag).toBe(false);

    // Deny generative_media -> compileBrandBrief returns feature_unavailable
    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['generative_media'],
      expectedRevision: 0
    });
    const blocked = await compileBrandBrief({ sql }, owner, {
      organizationId: orgId,
      quick: {
        brief: '차단 테스트',
        cutKind: 'reference_exact_product'
      }
    });
    expect(blocked).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});

describe('S5 Sound Director: 1-FPS cue snapping, 0ms drop alignment, and Argon vs earshot reconciliation', () => {
  it('snaps Argon MM:SS hints to frame-accurate cues.json anchors and ducks Act 1 foley by -3 dB', async () => {
    const plan = {
      palette: ['clean studio room tone', 'tactile glass foley', 'warm sub drop'],
      cues: [
        {
          id: 'act1:glass_set:1',
          t_hint: '00:01',
          category: 'foley' as const,
          description: 'Glass bottle set gently on stone table',
          level_db: -14,
          must_be_real_recording: true,
          reason: 'Entry tactile anchor'
        },
        {
          id: 'act3:reveal_hit:1',
          t_hint: '00:04',
          category: 'impact' as const,
          description: 'Clean low-end reveal pulse',
          level_db: -8,
          must_be_real_recording: true,
          reason: 'Hero lockup reveal'
        }
      ],
      music: {
        needed: true,
        role: 'minimal ambient pulse entering on reveal',
        drop_cue: 'act3:reveal_hit:1',
        duck_under_cues_db: -6
      },
      no_sound_at: [{ t_hint: '00:00', reason: '200ms pre-entry silence' }]
    };

    const anchors = [
      {
        id: 'act1:glass_set:1',
        timestampSec: 1.375,
        act: 'act1' as const,
        label: 'Glass bottle contact frame',
        isRevealPoint: false
      },
      {
        id: 'act3:reveal_hit:1',
        timestampSec: 4.167,
        act: 'act3' as const,
        label: 'Hero reveal lock frame',
        isRevealPoint: true
      }
    ];

    const snapped = snapCuePlanToFrames(plan, anchors);
    expect(snapped.unmatchedCueIds).toEqual([]);
    expect(snapped.cues[0]!.frameTimestampSec).toBe(1.375);
    expect(snapped.cues[0]!.levelDb).toBe(-17); // -14 dB - 3 dB Act 1 foley ducking
    expect(snapped.cues[1]!.frameTimestampSec).toBe(4.167);
    expect(snapped.dropAnchor?.timestampSec).toBe(4.167);

    // 0ms drop alignment slice [T_drop - T_reveal, T_drop - T_reveal + D]
    const slice = computeViralDropSlice({
      trackDurationSec: 120,
      trackDropSec: 32.5,
      videoRevealSec: 4.167,
      videoDurationSec: 8.0
    });
    expect(slice.valid).toBe(true);
    expect(slice.sliceStartSec).toBe(28.333);
    expect(slice.sliceEndSec).toBe(36.333);
    expect(slice.alignedOffsetMs).toBe(0);

    // Feature gate on sound
    await setFeaturePolicy({ sql }, admin, {
      organizationId: orgId,
      denied: ['sound'],
      expectedRevision: 0
    });
    const deniedSound = await prepareBrandSoundPlan(
      { sql },
      { organizationId: orgId, plan, anchors }
    );
    expect(deniedSound).toEqual({ ok: false, code: 'feature_unavailable' });
  });

  it('reconciles Argon vs earshot (earshot wins timing/LUFS, Argon wins taste, 3-round cap escalates to PD)', () => {
    // Case 1: Argon complains cue is "late", but earshot measures +15ms (<= 40ms) and LUFS is -14.0 -> APPROVED
    const falseAlarm = reconcileSoundVerdict({
      round: 1,
      argonVerdict: {
        pass: false,
        issues: [
          {
            cue_id: 'act3:reveal_hit:1',
            problem: 'late',
            fix: 'Move hit 200ms earlier'
          }
        ]
      },
      earshot: {
        lufs_i: -14.0,
        true_peak_dbtp: -1.2,
        lra_lu: 6.8,
        cue_offsets_ms: { 'act3:reveal_hit:1': 15 },
        high_freq_crackle_detected: false,
        clipping_detected: false
      }
    });
    expect(falseAlarm.status).toBe('approved');
    expect(falseAlarm.ignoredArgonTimingIssues).toHaveLength(1);

    // Case 2: Argon says pass: true, but earshot detects -11.2 LUFS and +0.2 dBTP -> RETRY_MIX
    const loudFail = reconcileSoundVerdict({
      round: 1,
      argonVerdict: { pass: true, issues: [] },
      earshot: {
        lufs_i: -11.2,
        true_peak_dbtp: 0.2,
        lra_lu: 6.5,
        cue_offsets_ms: {},
        high_freq_crackle_detected: false,
        clipping_detected: false
      }
    });
    expect(loudFail.status).toBe('retry_mix');
    expect(loudFail.nextRound).toBe(2);
    expect(loudFail.earshotFailures).toHaveLength(2);

    // Case 3: Round 3 aesthetic failure ("cheap" synth SFX) -> ESCALATE_TO_PD
    const round3Escalate = reconcileSoundVerdict({
      round: 3,
      argonVerdict: {
        pass: false,
        issues: [
          {
            cue_id: 'act1:glass_set:1',
            problem: 'cheap',
            fix: 'Replace synth click with real glass foley recording'
          }
        ]
      },
      earshot: {
        lufs_i: -14.0,
        true_peak_dbtp: -1.1,
        lra_lu: 6.5,
        cue_offsets_ms: { 'act1:glass_set:1': 5 },
        high_freq_crackle_detected: false,
        clipping_detected: false
      }
    });
    expect(round3Escalate.status).toBe('escalate_to_pd');
    expect(round3Escalate.nextRound).toBeNull();
  });

  it('blocks CC BY-NC and unlicensed viral tracks in the commercial audio license gate and builds -14 LUFS master', () => {
    const blocked = validateAudioLicenseGate([
      { assetId: 'foley-01', source: 'cc0_freesound' },
      { assetId: 'bgm-yue2', source: 'yue2_cc_by_nc' },
      { assetId: 'ref-track', source: 'viral_reference_unlicensed' }
    ]);
    expect(blocked.commercialAllowed).toBe(false);
    expect(blocked.blockedAssets.map((b) => b.assetId)).toEqual([
      'bgm-yue2',
      'ref-track'
    ]);

    const allowed = validateAudioLicenseGate([
      { assetId: 'foley-01', source: 'cc0_freesound' },
      {
        assetId: 'brand-theme',
        source: 'commercial_licensed',
        licenseCertificateRef: 'LIC-2026-991'
      }
    ]);
    expect(allowed.commercialAllowed).toBe(true);

    const master = buildDeterministicSoundMasterSpec({
      replaceNativeAudioCompletely: false
    });
    expect(master.nativeStemCleanFilter).toContain('lowpass=f=5500');
    expect(master.masterFilter).toContain('loudnorm=I=-14.0:TP=-1.0:LRA=7.0');
  });
});

describe('S5 Automated Result QA: pixel ΔE, owned hue band, product checklist, and public leak linter', () => {
  it('evaluates palette ΔE, TWINGS [195, 225] hue band, skin protection, and green cast rejection', () => {
    const identity = twingsDefaultIdentity();
    expect(computeDeltaE76('#3875C5', '#3875C5')).toBe(0);

    const passingQa = evaluatePaletteQa({
      identity,
      swatches: [
        { hex: '#FFFFFF', weight: 0.55, region: 'background' },
        { hex: '#F8F9FA', weight: 0.2, region: 'background' },
        { hex: '#3875C5', weight: 0.15, region: 'accent' },
        { hex: '#E0AC8B', weight: 0.1, region: 'skin' }
      ],
      warmElementCount: 1
    });
    expect(passingQa.passed).toBe(true);
    expect(passingQa.accentDeltaE).toBe(0);

    const greenAndWarmViolation = evaluatePaletteQa({
      identity,
      swatches: [
        { hex: '#22C55E', weight: 0.25, region: 'other' },
        { hex: '#ED1E1E', weight: 0.25, region: 'accent' }
      ],
      warmElementCount: 3
    });
    expect(greenAndWarmViolation.passed).toBe(false);
    expect(greenAndWarmViolation.greenCastWeight).toBeGreaterThan(0.02);
    expect(greenAndWarmViolation.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('marks unreadable small text as unverified_needs_local_fix, never pass', () => {
    const res = evaluateProductChecklistQa({
      requiredChecklist: [
        '보틀 전면 로고 비율 유지',
        '하단 50ml 용량 표기 가독성'
      ],
      inspections: [
        { item: '보틀 전면 로고 비율 유지', status: 'verified' },
        {
          item: '하단 50ml 용량 표기 가독성',
          status: 'unreadable_at_resolution'
        }
      ]
    });
    expect(res.verdict).toBe('unverified_needs_local_fix');
    expect(res.unverifiedItems).toEqual(['하단 50ml 용량 표기 가독성']);
  });

  it('catches engine names, internal benchmarks, provenance hashes, and commercial song titles on public surfaces', () => {
    expect(
      lintPublicBrandSurface(
        'TWINGS 브랜드 스튜디오는 확정된 브랜드 아이덴티티를 바탕으로 마스터 필름을 제작합니다.'
      ).clean
    ).toBe(true);

    const dirty = lintPublicBrandSurface(
      'Generated with Seedance 2.5 and SeedVR2 (8/8 pass, +165% lift, sha256: abc, BGM: Grimes Genesis).'
    );
    expect(dirty.clean).toBe(false);
    expect(dirty.violations.map((v) => v.category)).toEqual([
      'engine_name_leak',
      'internal_benchmark_leak',
      'private_provenance_leak',
      'commercial_audio_title_leak'
    ]);
  });
});
