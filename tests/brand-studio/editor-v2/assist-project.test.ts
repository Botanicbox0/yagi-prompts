import { describe, expect, it } from 'vitest';
import {
  ASSIST_CUT_MAX_SEC,
  ASSIST_MAX_CUTS,
  ASSIST_MESSAGE_MAX_CHARS,
  buildAssistPlanInput,
  buildPlannerProject,
  validateSequenceForAssist,
} from '@/lib/brand-studio/editor-v2/assist-project';
import { AssistPlanInputSchema } from '@/lib/brand-studio/edit-assist/service';
import type { FrameClip, FrameSequence } from '@/lib/brand-studio/editor-v2/frames';

const ORG = '00000000-0000-4000-8000-0000000000aa';

function makeClip(overrides: Partial<FrameClip> & { id: string; frames: number }): FrameClip {
  return {
    label: `${overrides.id}.mp4`,
    srcUrl: `/media/${overrides.id}.mp4`,
    thumbUrl: `/media/${overrides.id}.jpg`,
    sourceFps: 30,
    sourceFrames: Math.max(overrides.frames * 2, 300),
    inFrame: 0,
    speedNum: 1,
    speedDen: 1,
    phase: 0,
    volume: 0.8,
    muted: false,
    ...overrides,
  };
}

describe('editor-v2 assist-project (Batch 2)', () => {
  it('matches server AssistPlanInputSchema message max length (500) and builds exact wire shape matching old editor', () => {
    expect(ASSIST_MESSAGE_MAX_CHARS).toBe(AssistPlanInputSchema.shape.message.maxLength);
    expect(ASSIST_MESSAGE_MAX_CHARS).toBe(500);
    expect(ASSIST_CUT_MAX_SEC).toBe(600);
    expect(ASSIST_MAX_CUTS).toBe(24);

    const seq: FrameSequence = {
      fps: 30,
      aspect: '9:16',
      clips: [makeClip({ id: 'cut-a', frames: 90, volume: 0.75, muted: false })],
      captions: [],
    };
    const project = buildPlannerProject(seq);
    const recent = [{ said: '세로로 바꿔 줘', did: ['화면을 세로 비율로 바꿉니다'], kept: true }];

    // Exact request object built by components/brand-studio/compose/assist/use-edit-assist.ts:252-261
    const oldEditorShape = {
      organizationId: ORG,
      message: '1번 컷을 2초로 줄여 줘',
      locale: 'ko' as const,
      project,
      playheadSec: 1.5,
      selectedClipId: 'cut-a',
      recent,
      answer: { about: 'which_clip' as const, value: { clipId: 'cut-a' } },
    };

    const built = buildAssistPlanInput({
      organizationId: ORG,
      message: '  1번 컷을 2초로 줄여 줘  ',
      locale: 'ko',
      project,
      playheadSec: 1.5,
      selectedClipId: 'cut-a',
      recent,
      answer: { about: 'which_clip', value: { clipId: 'cut-a' } },
    });

    expect(built).toEqual(oldEditorShape);
    // Validate against the actual server Zod schema (zero drift!)
    const parsed = AssistPlanInputSchema.safeParse(built);
    expect(parsed.success).toBe(true);
  });

  it('builds frame-faithful seconds projects with zero drift across integer and fractional fps, constant speed, and speedCurve cuts', () => {
    const fpsRates = [24, 30, 24000 / 1001, 30000 / 1001];

    for (const fps of fpsRates) {
      const clips: FrameClip[] = [];
      for (let i = 0; i < 24; i += 1) {
        const frames = 17 + i * 19; // prime-ish frame counts to stress rounding
        const speedCases: Partial<FrameClip>[] = [
          { speedNum: 1, speedDen: 4 },
          { speedNum: 1, speedDen: 2 },
          { speedNum: 1, speedDen: 1 },
          { speedNum: 2, speedDen: 1 },
          { speedNum: 4, speedDen: 1 },
          {
            speedNum: 1,
            speedDen: 1,
            speedCurve: {
              startMedia: 0,
              spanMedia: frames,
              points: [
                { pos: 0, speed: 0.5 },
                { pos: 0.5, speed: 2 },
                { pos: 1, speed: 1 },
              ],
            },
          },
        ];
        const variant = speedCases[i % speedCases.length]!;
        clips.push(
          makeClip({
            id: `clip-${i + 1}`,
            frames,
            sourceFps: fps,
            sourceFrames: frames * 6,
            volume: i % 3 === 0 ? 0.5 : 1,
            muted: i % 5 === 0,
            ...variant,
          }),
        );
      }

      const seq: FrameSequence = { fps, aspect: '16:9', clips, captions: [] };
      const project = buildPlannerProject(seq);
      expect(project.clips).toHaveLength(24);
      expect(project.captions).toEqual([]);
      expect(project.bgm).toBeNull();

      let sumRoundTrip = 0;
      let sumOriginal = 0;
      for (let i = 0; i < 24; i += 1) {
        const orig = seq.clips[i]!;
        const sent = project.clips[i]!;
        expect(sent.id).toBe(orig.id);
        expect(sent.volume).toBe(orig.volume);
        expect(sent.muted).toBe(orig.muted);
        expect(sent.trimStartSec).toBe(0);
        expect(sent.trimEndSec).toBe(sent.durationSec);
        expect('playbackRate' in sent).toBe(false);
        expect(Math.round(sent.durationSec * fps)).toBe(orig.frames);
        sumRoundTrip += Math.round(sent.durationSec * fps);
        sumOriginal += orig.frames;
      }
      // Zero cumulative drift over 24 cuts
      expect(sumRoundTrip).toBe(sumOriginal);

      // Passes server AssistPlanInputSchema cleanly
      const parsed = AssistPlanInputSchema.safeParse(
        buildAssistPlanInput({
          organizationId: ORG,
          message: '전체 길이를 20초로 맞춰 줘',
          locale: 'ko',
          project,
          playheadSec: 0,
        }),
      );
      expect(parsed.success, `fps=${fps}`).toBe(true);
    }
  });

  it('checks 600s cut limit, 24-cut limit, 80-char id cap (no slicing), and omits playheadSec when absent (S4 / SMALL)', () => {
    const exact600: FrameSequence = {
      fps: 30,
      aspect: '16:9',
      clips: [makeClip({ id: 'c1', frames: 600 * 30 })],
      captions: [],
    };
    expect(validateSequenceForAssist(exact600)).toEqual({ ok: true });

    const over600: FrameSequence = {
      fps: 30,
      aspect: '16:9',
      clips: [makeClip({ id: 'c1', frames: 600 * 30 + 1 })],
      captions: [],
    };
    expect(validateSequenceForAssist(over600)).toEqual({ ok: false, reason: 'too_long_cut' });

    const exact24: FrameSequence = {
      fps: 30,
      aspect: '16:9',
      clips: Array.from({ length: 24 }, (_, i) => makeClip({ id: `c${i + 1}`, frames: 60 })),
      captions: [],
    };
    expect(validateSequenceForAssist(exact24)).toEqual({ ok: true });

    const over24: FrameSequence = {
      fps: 30,
      aspect: '16:9',
      clips: Array.from({ length: 25 }, (_, i) => makeClip({ id: `c${i + 1}`, frames: 60 })),
      captions: [],
    };
    expect(validateSequenceForAssist(over24)).toEqual({ ok: false, reason: 'too_many_cuts' });

    // SMALL: ids > 80 chars are refused instead of sliced (slicing would return target_missing)
    const exact80Id = 'x'.repeat(80);
    const over80Id = 'x'.repeat(81);
    expect(
      validateSequenceForAssist({ fps: 30, aspect: '16:9', clips: [makeClip({ id: exact80Id, frames: 60 })], captions: [] }),
    ).toEqual({ ok: true });
    expect(
      validateSequenceForAssist({ fps: 30, aspect: '16:9', clips: [makeClip({ id: over80Id, frames: 60 })], captions: [] }),
    ).toEqual({ ok: false, reason: 'id_too_long' });
    const builtNoSlice = buildPlannerProject({
      fps: 30,
      aspect: '16:9',
      clips: [makeClip({ id: over80Id, frames: 60 })],
      captions: [],
    });
    expect(builtNoSlice.clips[0]!.id).toBe(over80Id);

    // S4: omitting playheadSec omits it from wire input (and still satisfies server schema)
    const withoutPlayhead = buildAssistPlanInput({
      organizationId: ORG,
      message: '세로로 바꿔 줘',
      locale: 'ko',
      project: buildPlannerProject(exact600),
    });
    expect('playheadSec' in withoutPlayhead).toBe(false);
    expect('selectedClipId' in withoutPlayhead).toBe(false);
    expect(AssistPlanInputSchema.safeParse(withoutPlayhead).success).toBe(true);
  });
});
