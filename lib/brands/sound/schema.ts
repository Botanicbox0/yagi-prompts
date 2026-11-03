import { z } from 'zod';

/**
 * S5 Sound Director Schemas (`BRAND-PRODUCT.md` §8, `argon-sound-assembly.md` §3).
 *
 * Argon (`gemini-3.8-pro-preview`) plans cues at 1 FPS (`MM:SS` `t_hint`) and judges aesthetic fit;
 * `cues.json` + `earshot` own frame-accurate timestamps (`offset_ms`) and loudness (`LUFS`, `dBTP`, `LRA`).
 */

export const SOUND_CUE_ID_REGEX = /^[a-z0-9_]+:[a-z0-9_]+:\d+$/;
export const TIME_HINT_MM_SS_REGEX = /^\d{2}:\d{2}$/;

export const SOUND_CUE_CATEGORIES = [
  'room_tone',
  'foley',
  'impact',
  'transition',
  'ambience',
  'silence'
] as const;

export type SoundCueCategory = (typeof SOUND_CUE_CATEGORIES)[number];

export const SoundCueAnchorSchema = z.object({
  id: z.string().regex(SOUND_CUE_ID_REGEX, {
    message: 'Cue id must match act:thing:n (e.g. act1:door_creak:1).'
  }),
  timestampSec: z.number().min(0).max(600),
  act: z.enum(['act1', 'act2', 'act3']),
  label: z.string().trim().min(1).max(200),
  isRevealPoint: z.boolean().default(false)
});

export type SoundCueAnchor = z.infer<typeof SoundCueAnchorSchema>;

export const ArgonCuePlanItemSchema = z.object({
  id: z.string().regex(SOUND_CUE_ID_REGEX, {
    message: 'Cue id must match act:thing:n.'
  }),
  t_hint: z.string().regex(TIME_HINT_MM_SS_REGEX, {
    message: 't_hint must be MM:SS (1-second resolution).'
  }),
  category: z.enum(SOUND_CUE_CATEGORIES),
  description: z.string().trim().min(2).max(240),
  level_db: z.number().min(-60).max(0),
  must_be_real_recording: z.boolean().default(true),
  reason: z.string().trim().min(2).max(240)
});

export type ArgonCuePlanItem = z.infer<typeof ArgonCuePlanItemSchema>;

export const ArgonCuePlanSchema = z.object({
  palette: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  cues: z.array(ArgonCuePlanItemSchema).min(1).max(40),
  music: z.object({
    needed: z.boolean(),
    role: z.string().trim().max(240),
    drop_cue: z
      .string()
      .regex(SOUND_CUE_ID_REGEX)
      .nullable()
      .default(null),
    duck_under_cues_db: z.number().min(-24).max(0).default(-6)
  }),
  no_sound_at: z
    .array(
      z.object({
        t_hint: z.string().regex(TIME_HINT_MM_SS_REGEX),
        reason: z.string().trim().min(2).max(200)
      })
    )
    .default([])
});

export type ArgonCuePlan = z.infer<typeof ArgonCuePlanSchema>;

export const ARGON_VERDICT_PROBLEMS = [
  'late',
  'early',
  'missing',
  'cheap',
  'masking',
  'rule_violation'
] as const;

export type ArgonVerdictProblem = (typeof ARGON_VERDICT_PROBLEMS)[number];

export const ArgonVerdictIssueSchema = z.object({
  cue_id: z.string().trim().min(1).max(120),
  problem: z.enum(ARGON_VERDICT_PROBLEMS),
  fix: z.string().trim().min(2).max(240)
});

export type ArgonVerdictIssue = z.infer<typeof ArgonVerdictIssueSchema>;

export const ArgonVerdictSchema = z.object({
  pass: z.boolean(),
  issues: z.array(ArgonVerdictIssueSchema).default([])
});

export type ArgonVerdict = z.infer<typeof ArgonVerdictSchema>;

export const EarshotDiagnosticsSchema = z.object({
  lufs_i: z.number().min(-70).max(0),
  true_peak_dbtp: z.number().min(-40).max(6),
  lra_lu: z.number().min(0).max(30),
  cue_offsets_ms: z.record(z.string(), z.number()).default({}),
  high_freq_crackle_detected: z.boolean().default(false),
  clipping_detected: z.boolean().default(false)
});

export type EarshotDiagnostics = z.infer<typeof EarshotDiagnosticsSchema>;
