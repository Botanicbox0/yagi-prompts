import type { SqlRunner } from '@/lib/db/sql-runner';
import { BrandFeatureDenied, assertBrandFeature } from '@/lib/brands/entitlements';
import type { BrandOutcome } from '@/lib/brands/workspace/types';
import {
  ArgonCuePlanSchema,
  ArgonVerdictSchema,
  EarshotDiagnosticsSchema,
  SoundCueAnchorSchema,
  type ArgonCuePlan,
  type ArgonVerdict,
  type ArgonVerdictIssue,
  type EarshotDiagnostics,
  type SoundCueAnchor,
  type SoundCueCategory
} from './schema';

export const MAX_SOUND_DIRECTOR_ROUNDS = 3;
export const EARSHOT_SYNC_TOLERANCE_MS = 40;
export const TARGET_LOUDNESS_LUFS = -14.0;
export const LOUDNESS_TOLERANCE_LU = 0.5;
export const MAX_TRUE_PEAK_DBTP = -1.0;
export const MIN_LRA_LU = 5.0;
export const MAX_LRA_LU = 9.0;

/**
 * Converts an Argon `"MM:SS"` 1-second resolution hint into seconds.
 */
export function parseTimeHintSeconds(tHint: string): number {
  const [mm, ss] = tHint.split(':').map((part) => Number(part));
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return 0;
  return mm! * 60 + ss!;
}

export interface SnappedSoundCue {
  id: string;
  act: 'act1' | 'act2' | 'act3';
  category: SoundCueCategory;
  description: string;
  frameTimestampSec: number;
  argonHintSec: number;
  levelDb: number;
  mustBeRealRecording: boolean;
  isRevealPoint: boolean;
}

/**
 * Snaps Argon's 1-FPS `cue_plan.json` items to the frame-accurate timestamps in `cues.json`
 * (`argon-sound-assembly.md` §2.3, §3.4) and applies Act 1 `-3 dB` foley ducking (`knowhow-corpus.md` §9.4).
 */
export function snapCuePlanToFrames(
  rawPlan: ArgonCuePlan,
  rawAnchors: readonly SoundCueAnchor[],
  options: { duckAct1FoleyDb?: number } = {}
): {
  cues: SnappedSoundCue[];
  unmatchedCueIds: string[];
  dropAnchor: SoundCueAnchor | null;
} {
  const plan = ArgonCuePlanSchema.parse(rawPlan);
  const anchors = rawAnchors.map((a) => SoundCueAnchorSchema.parse(a));
  const anchorById = new Map<string, SoundCueAnchor>(
    anchors.map((a) => [a.id, a])
  );
  const duckAct1Db = options.duckAct1FoleyDb ?? -3;

  const cues: SnappedSoundCue[] = [];
  const unmatchedCueIds: string[] = [];

  for (const item of plan.cues) {
    const anchor = anchorById.get(item.id);
    const argonHintSec = parseTimeHintSeconds(item.t_hint);
    if (!anchor) {
      unmatchedCueIds.push(item.id);
      const actPrefix = item.id.split(':')[0];
      const act =
        actPrefix === 'act1' || actPrefix === 'act2' || actPrefix === 'act3'
          ? actPrefix
          : 'act2';
      cues.push({
        id: item.id,
        act,
        category: item.category,
        description: item.description,
        frameTimestampSec: argonHintSec,
        argonHintSec,
        levelDb:
          act === 'act1' && item.category === 'foley'
            ? item.level_db + duckAct1Db
            : item.level_db,
        mustBeRealRecording: item.must_be_real_recording,
        isRevealPoint: false
      });
      continue;
    }

    const adjustedLevelDb =
      anchor.act === 'act1' && item.category === 'foley'
        ? Math.max(-60, item.level_db + duckAct1Db)
        : item.level_db;

    cues.push({
      id: item.id,
      act: anchor.act,
      category: item.category,
      description: item.description,
      frameTimestampSec: anchor.timestampSec,
      argonHintSec,
      levelDb: adjustedLevelDb,
      mustBeRealRecording: item.must_be_real_recording,
      isRevealPoint: anchor.isRevealPoint
    });
  }

  const dropAnchor =
    (plan.music.drop_cue ? anchorById.get(plan.music.drop_cue) : null) ??
    anchors.find((a) => a.isRevealPoint) ??
    null;

  return {
    cues,
    unmatchedCueIds,
    dropAnchor
  };
}

export interface ViralDropSlicePlan {
  valid: boolean;
  sliceStartSec: number;
  sliceEndSec: number;
  videoRevealSec: number;
  trackDropSec: number;
  alignedOffsetMs: number;
  reason?: string;
}

/**
 * Computes the exact audio slice `[T_drop - T_reveal, T_drop - T_reveal + D]` so the music drop
 * lands on the video reveal frame with `0ms` offset (`knowhow-corpus.md` §9.1, f7).
 */
export function computeViralDropSlice(input: {
  trackDurationSec: number;
  trackDropSec: number;
  videoRevealSec: number;
  videoDurationSec: number;
}): ViralDropSlicePlan {
  const sliceStartSec =
    Math.round((input.trackDropSec - input.videoRevealSec) * 1000) / 1000;
  const sliceEndSec =
    Math.round((sliceStartSec + input.videoDurationSec) * 1000) / 1000;

  if (sliceStartSec < 0) {
    return {
      valid: false,
      sliceStartSec,
      sliceEndSec,
      videoRevealSec: input.videoRevealSec,
      trackDropSec: input.trackDropSec,
      alignedOffsetMs: Math.round(sliceStartSec * 1000),
      reason: `Track drop (${input.trackDropSec}s) occurs earlier than video reveal (${input.videoRevealSec}s); cannot slice before 0s without pre-pad.`
    };
  }
  if (sliceEndSec > input.trackDurationSec) {
    return {
      valid: false,
      sliceStartSec,
      sliceEndSec,
      videoRevealSec: input.videoRevealSec,
      trackDropSec: input.trackDropSec,
      alignedOffsetMs: 0,
      reason: `Required slice end (${sliceEndSec}s) exceeds track duration (${input.trackDurationSec}s).`
    };
  }

  const dropInSliceSec = input.trackDropSec - sliceStartSec;
  const alignedOffsetMs = Math.round(
    (dropInSliceSec - input.videoRevealSec) * 1000
  );

  return {
    valid: alignedOffsetMs === 0,
    sliceStartSec,
    sliceEndSec,
    videoRevealSec: input.videoRevealSec,
    trackDropSec: input.trackDropSec,
    alignedOffsetMs
  };
}

export interface SoundReconciliationResult {
  status: 'approved' | 'retry_mix' | 'escalate_to_pd';
  passed: boolean;
  round: number;
  maxRounds: number;
  nextRound: number | null;
  effectiveIssues: ArgonVerdictIssue[];
  ignoredArgonTimingIssues: ArgonVerdictIssue[];
  earshotFailures: string[];
}

/**
 * Reconciles Argon's aesthetic `verdict.json` with `earshot` numeric measurements (`argon-sound-assembly.md` §3.3, §3.4):
 * - Earshot numbers beat Argon on sub-second timing: if Argon flags `late`/`early` but `|offset_ms| <= 40ms`,
 *   Argon's 1-FPS false alarm is ignored.
 * - Earshot numbers beat Argon on broadcast loudness (`-14.0 LUFS ± 0.5`, `<= -1.0 dBTP`, LRA `5..9 LU`, crackle/clip).
 * - Argon taste beats Earshot on `cheap`, `masking`, `missing`, and `rule_violation`.
 * - Capped at `MAX_SOUND_DIRECTOR_ROUNDS = 3`; round 3 failure escalates to a human PD.
 */
export function reconcileSoundVerdict(input: {
  round: number;
  maxRounds?: number;
  argonVerdict: ArgonVerdict;
  earshot: EarshotDiagnostics;
}): SoundReconciliationResult {
  const maxRounds = input.maxRounds ?? MAX_SOUND_DIRECTOR_ROUNDS;
  const round = Math.max(1, Math.trunc(input.round));
  const verdict = ArgonVerdictSchema.parse(input.argonVerdict);
  const earshot = EarshotDiagnosticsSchema.parse(input.earshot);

  const effectiveIssues: ArgonVerdictIssue[] = [];
  const ignoredArgonTimingIssues: ArgonVerdictIssue[] = [];

  for (const issue of verdict.issues) {
    if (issue.problem === 'late' || issue.problem === 'early') {
      const measuredOffsetMs = earshot.cue_offsets_ms[issue.cue_id];
      if (
        typeof measuredOffsetMs === 'number' &&
        Math.abs(measuredOffsetMs) <= EARSHOT_SYNC_TOLERANCE_MS
      ) {
        ignoredArgonTimingIssues.push(issue);
        continue;
      }
    }
    effectiveIssues.push(issue);
  }

  const earshotFailures: string[] = [];
  if (Math.abs(earshot.lufs_i - TARGET_LOUDNESS_LUFS) > LOUDNESS_TOLERANCE_LU) {
    earshotFailures.push(
      `Integrated loudness (${earshot.lufs_i} LUFS) is outside target ${TARGET_LOUDNESS_LUFS} ± ${LOUDNESS_TOLERANCE_LU} LUFS.`
    );
  }
  if (earshot.true_peak_dbtp > MAX_TRUE_PEAK_DBTP) {
    earshotFailures.push(
      `True peak (${earshot.true_peak_dbtp} dBTP) exceeds ceiling ${MAX_TRUE_PEAK_DBTP} dBTP.`
    );
  }
  if (earshot.lra_lu < MIN_LRA_LU || earshot.lra_lu > MAX_LRA_LU) {
    earshotFailures.push(
      `Loudness range (${earshot.lra_lu} LU) is outside target [${MIN_LRA_LU}, ${MAX_LRA_LU}] LU.`
    );
  }
  if (earshot.clipping_detected) {
    earshotFailures.push('Sample clipping detected in mixed master.');
  }
  if (earshot.high_freq_crackle_detected) {
    earshotFailures.push(
      'High-frequency digital crackle (> 5.5 kHz / > 14 kHz) detected in audio stem.'
    );
  }

  const passed =
    effectiveIssues.length === 0 && earshotFailures.length === 0;

  if (passed) {
    return {
      status: 'approved',
      passed: true,
      round,
      maxRounds,
      nextRound: null,
      effectiveIssues: [],
      ignoredArgonTimingIssues,
      earshotFailures: []
    };
  }

  if (round >= maxRounds) {
    return {
      status: 'escalate_to_pd',
      passed: false,
      round,
      maxRounds,
      nextRound: null,
      effectiveIssues,
      ignoredArgonTimingIssues,
      earshotFailures
    };
  }

  return {
    status: 'retry_mix',
    passed: false,
    round,
    maxRounds,
    nextRound: round + 1,
    effectiveIssues,
    ignoredArgonTimingIssues,
    earshotFailures
  };
}

/**
 * Authorized S5 Sound Director cue-plan preparation gated by `sound` feature policy.
 */
export async function prepareBrandSoundPlan(
  deps: { sql: SqlRunner },
  input: {
    organizationId: string;
    plan: ArgonCuePlan;
    anchors: readonly SoundCueAnchor[];
  }
): Promise<
  BrandOutcome<{
    id: string;
    cues: SnappedSoundCue[];
    unmatchedCueIds: string[];
  }>
> {
  try {
    await assertBrandFeature(deps.sql, input.organizationId, 'sound');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) {
      return { ok: false, code: 'feature_unavailable' };
    }
    throw error;
  }

  const snapped = snapCuePlanToFrames(input.plan, input.anchors);
  return {
    ok: true,
    id: input.organizationId,
    cues: snapped.cues,
    unmatchedCueIds: snapped.unmatchedCueIds
  };
}
