import { describe, expect, it } from 'vitest';
import type {
  StudioVideoCountingScheme,
  VideoUnderstandQuestion,
  VideoUnderstandSwap,
} from '@/lib/brand-studio/contracts';
import {
  buildAmbiguousRefQuestion,
  deriveSchemeFromDisambiguationAnswer,
  resolveImageReferencesInMessage,
  type UnderstandRefItem,
} from '@/lib/brand-studio/video/understand';

const VIDEO_FIRST_TRAY: UnderstandRefItem[] = [
  { position: 1, index: 1, mention: '@video1', kind: 'video', name: 'ref-commercial.mp4', seconds: 10 },
  { position: 2, index: 1, mention: '@image1', kind: 'image', name: 'product-bottle.png' },
  { position: 3, index: 2, mention: '@image2', kind: 'image', name: 'mood-editorial.jpg' },
];

const IMAGES_FIRST_TRAY: UnderstandRefItem[] = [
  { position: 1, index: 1, mention: '@image1', kind: 'image', name: 'product-bottle.png' },
  { position: 2, index: 2, mention: '@image2', kind: 'image', name: 'mood-editorial.jpg' },
  { position: 3, index: 1, mention: '@video1', kind: 'video', name: 'ref-commercial.mp4', seconds: 10 },
];

interface SequenceStep {
  label: string;
  message: string;
  standingSwaps?: readonly VideoUnderstandSwap[];
  pickOption?: 0 | 1;
  expectedScheme: StudioVideoCountingScheme | null;
  expectedAmbiguousCount: number;
  expectedResolvedRefIndices: number[];
}

interface SequenceCase {
  name: string;
  tray: readonly UnderstandRefItem[];
  steps: readonly SequenceStep[];
}

describe('video.understand pure countingScheme derivation & resolution (Fix round 4)', () => {
  const cases: readonly SequenceCase[] = [
    {
      name: '[video, image, image]: 1번 이미지 -> perKind; then 2번 인물 (even with standing person swap on @image1, E04) -> image 2',
      tray: VIDEO_FIRST_TRAY,
      steps: [
        {
          label: 'T1: 1번 이미지 has no position image candidate -> perKind',
          message: '1번 이미지 인물로 교체해줘',
          expectedScheme: 'perKind',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [1],
        },
        {
          label: 'T2: 아니, 2번 인물로 with standing person=@image1 -> must follow perKind to @image2',
          message: '아니, 2번 인물로',
          standingSwaps: [{ refIndex: 1, role: 'person', label: '인물', use: '', avoid: '' }],
          expectedScheme: 'perKind',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [2],
        },
      ],
    },
    {
      name: '[video, image, image]: 3번 이미지 -> position; then 2번 -> image 1',
      tray: VIDEO_FIRST_TRAY,
      steps: [
        {
          label: 'T1: 3번 이미지 has only position candidate -> position',
          message: '3번 이미지로 바꿔줘',
          expectedScheme: 'position',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [2],
        },
        {
          label: 'T2: bare 2번 -> follows position to tray pos 2 (@image1)',
          message: '2번',
          expectedScheme: 'position',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [1],
        },
        {
          label: 'T3: case-marked 2번으로 바꿔줘 with standing swap -> still follows position to @image1',
          message: '2번으로 바꿔줘',
          standingSwaps: [{ refIndex: 2, role: 'person', label: '인물', use: '', avoid: '' }],
          expectedScheme: 'position',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [1],
        },
      ],
    },
    {
      name: '[image, image, video]: 1번 이미지 -> both candidates same picture -> no scheme; then 2번 이미지 -> image 2, still no scheme',
      tray: IMAGES_FIRST_TRAY,
      steps: [
        {
          label: 'T1: 1번 이미지 matches pos 1 & perKind 1 (same picture) -> establishes nothing',
          message: '1번 이미지로 바꿔줘',
          expectedScheme: null,
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [1],
        },
        {
          label: 'T2: 2번 이미지 matches pos 2 & perKind 2 (same picture) -> image 2, still no scheme',
          message: '2번 이미지로 바꿔줘',
          expectedScheme: null,
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [2],
        },
      ],
    },
    {
      name: '[video, image, image]: 2번 이미지 first -> ask once; customer picks option 0 (@image1 / position) -> establishes position for rest of session',
      tray: VIDEO_FIRST_TRAY,
      steps: [
        {
          label: 'T1: 2번 이미지 with no scheme -> ambiguous, asks once',
          message: '2번 이미지로 바꿔줘',
          expectedScheme: null,
          expectedAmbiguousCount: 1,
          expectedResolvedRefIndices: [],
        },
        {
          label: 'T2: customer picks option 0 (@image1, tray position 2) -> establishes position',
          message: '@image1 (product-bottle.png)',
          pickOption: 0,
          expectedScheme: 'position',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [1],
        },
        {
          label: 'T3: later 2번 인물 resolves directly to @image1 via position without asking again',
          message: '2번 인물로 바꿔줘',
          expectedScheme: 'position',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [1],
        },
      ],
    },
    {
      name: '[video, image, image]: 2번 이미지 first -> ask once; customer picks option 1 (@image2 / perKind) -> establishes perKind for rest of session',
      tray: VIDEO_FIRST_TRAY,
      steps: [
        {
          label: 'T1: 2번 이미지 with no scheme -> ambiguous, asks once',
          message: '2번 이미지로 바꿔줘',
          expectedScheme: null,
          expectedAmbiguousCount: 1,
          expectedResolvedRefIndices: [],
        },
        {
          label: 'T2: customer picks option 1 (@image2, 2nd image) -> establishes perKind',
          message: '@image2 (mood-editorial.jpg)',
          pickOption: 1,
          expectedScheme: 'perKind',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [2],
        },
        {
          label: 'T3: later 2번 인물 resolves directly to @image2 via perKind without asking again',
          message: '2번 인물로 바꿔줘',
          expectedScheme: 'perKind',
          expectedAmbiguousCount: 0,
          expectedResolvedRefIndices: [2],
        },
      ],
    },
  ];

  it.each(cases)('$name', ({ tray, steps }) => {
    let scheme: StudioVideoCountingScheme | null = null;
    let questions: VideoUnderstandQuestion[] = [];

    for (const step of steps) {
      const answering = step.pickOption !== undefined ? { option: step.pickOption } : null;
      const res = resolveImageReferencesInMessage(step.message, tray, {
        countingScheme: scheme,
        standingSwaps: step.standingSwaps,
        disambiguationAnswer: { questions, answering },
      });

      expect(res.countingScheme, step.label).toBe(step.expectedScheme);
      expect(res.ambiguous.length, step.label).toBe(step.expectedAmbiguousCount);
      expect(
        res.resolved.map((r) => r.refIndex),
        step.label,
      ).toEqual(step.expectedResolvedRefIndices);

      if (res.ambiguous.length > 0) {
        const { question } = buildAmbiguousRefQuestion(res.ambiguous[0]!, 'ko');
        questions = [...questions, question];
      } else if (answering && questions.length > 0) {
        // Mark answered so later turns cannot re-derive from a closed question.
        questions = questions.map((q, idx) =>
          idx === questions.length - 1 ? { ...q, answer: q.options[answering.option!]?.label ?? step.message } : q,
        );
      }

      scheme = res.countingScheme;
    }
  });

  it('guards bare verb counts and video/audio prefixes, and never lets standingSwaps hijack a correction when no scheme is set', () => {
    // Bare verb counts AND Review #4 particle over-match (`2번 돌리고 3번은 줌인`) produce NO image ref when no image/role word or standing swap exists.
    expect(resolveImageReferencesInMessage('카메라를 2번 돌려주고 3번 반복해줘', VIDEO_FIRST_TRAY)).toEqual({
      resolved: [],
      ambiguous: [],
      missing: [],
      countingScheme: null,
    });
    expect(resolveImageReferencesInMessage('2번 돌리고 3번은 줌인', VIDEO_FIRST_TRAY)).toEqual({
      resolved: [],
      ambiguous: [],
      missing: [],
      countingScheme: null,
    });
    // When the sentence DOES contain an image/role word (`인물`), particle form `3번은` resolves cleanly!
    const withRoleWord = resolveImageReferencesInMessage('3번은 인물로 바꿔줘', VIDEO_FIRST_TRAY);
    expect(withRoleWord.countingScheme).toBe('position');
    expect(withRoleWord.resolved.map((r) => r.refIndex)).toEqual([2]);

    // Video prefix (`원본 영상 1번`, `영상 1번을`) is never misread as an image reference.
    expect(resolveImageReferencesInMessage('원본 영상 1번을 참고해서 만들어줘', VIDEO_FIRST_TRAY)).toEqual({
      resolved: [],
      ambiguous: [],
      missing: [],
      countingScheme: null,
    });

    // Without an established scheme, a correction (`아니, 2번 인물로`) is NEVER hijacked by standingSwaps;
    // it asks once instead of silently sticking to `@image1`.
    const corrNoScheme = resolveImageReferencesInMessage('아니, 2번 인물로', VIDEO_FIRST_TRAY, {
      countingScheme: null,
      standingSwaps: [{ refIndex: 1, role: 'person', label: '인물', use: '', avoid: '' }],
    });
    expect(corrNoScheme.resolved).toEqual([]);
    expect(corrNoScheme.ambiguous).toHaveLength(1);

    // Typed `@image2` answer (without option index) to an open ref_disambiguation question also derives `perKind`.
    const amb = resolveImageReferencesInMessage('2번 이미지로 바꿔줘', VIDEO_FIRST_TRAY);
    const { question } = buildAmbiguousRefQuestion(amb.ambiguous[0]!, 'ko');
    expect(
      deriveSchemeFromDisambiguationAnswer({
        questions: [question],
        answering: null,
        message: '@image2 로 해줘',
      }),
    ).toBe('perKind');
    expect(
      deriveSchemeFromDisambiguationAnswer({
        questions: [{ ...question, answer: question.options[0]!.label }],
        answering: { option: 0 },
        message: '',
      }),
    ).toBeNull();
  });
});
