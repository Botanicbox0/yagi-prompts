import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';

/**
 * The shared four-cut timeline for the edit-assist tests and the instruction table (`cases.ts`).
 *
 * | ref | id          | source | trim     | rate | plays | starts at | sound          |
 * | c1  | clip-open   | 6 s    | 0 – 5    | 1    | 5.0   | 0         | 100 %          |
 * | c2  | clip-hand   | 8 s    | 1 – 6    | 1    | 5.0   | 5         | 100 % (already trimmed) |
 * | c3  | clip-run    | 12 s   | 0 – 12   | 2    | 6.0   | 10        | 70 %           |
 * | c4  | clip-logo   | 4 s    | 0 – 4    | 1    | 4.0   | 16        | muted          |
 *
 * Total 20.0 s. Captions t1 "봄 신상 출시" 0–2.5 (bottom, md), t2 "지금 20% 할인" 17–20 (center, lg).
 * Music "Spring loop" at 60 %. No colour look. 9:16.
 */
export const FIXTURE_IDS = {
  c1: 'clip-open',
  c2: 'clip-hand',
  c3: 'clip-run',
  c4: 'clip-logo',
  t1: 'cap-hello',
  t2: 'cap-sale',
} as const;

export function assistFixture(): ComposerProject {
  return {
    version: 1,
    aspect: '9:16',
    clips: [
      {
        id: 'clip-open',
        label: '오프닝 향수 클로즈업',
        sourceKind: 'output',
        outputId: 'out-open',
        srcUrl: '/media/open.mp4',
        thumbUrl: null,
        durationSec: 6,
        trimStartSec: 0,
        trimEndSec: 5,
        volume: 1,
        muted: false,
      },
      {
        id: 'clip-hand',
        label: '손에 든 제품',
        sourceKind: 'asset',
        assetId: 'asset-hand',
        srcUrl: '/media/hand.mp4',
        durationSec: 8,
        trimStartSec: 1,
        trimEndSec: 6,
        volume: 1,
        muted: false,
      },
      {
        id: 'clip-run',
        label: '거리 달리기',
        sourceKind: 'output',
        outputId: 'out-run',
        srcUrl: '/media/run.mp4',
        durationSec: 12,
        trimStartSec: 0,
        trimEndSec: 12,
        volume: 0.7,
        muted: false,
        playbackRate: 2,
      },
      {
        id: 'clip-logo',
        label: '로고 엔딩',
        sourceKind: 'asset',
        assetId: 'asset-logo',
        srcUrl: '/media/logo.mp4',
        durationSec: 4,
        trimStartSec: 0,
        trimEndSec: 4,
        volume: 1,
        muted: true,
      },
    ],
    captions: [
      { id: 'cap-hello', text: '봄 신상 출시', startSec: 0, endSec: 2.5, position: 'bottom', size: 'md' },
      { id: 'cap-sale', text: '지금 20% 할인', startSec: 17, endSec: 20, position: 'center', size: 'lg' },
    ],
    bgm: {
      label: 'Spring loop',
      sourceKind: 'asset',
      assetId: 'asset-music',
      srcUrl: '/media/spring.mp3',
      durationSec: 30,
      trimStartSec: 0,
      volume: 0.6,
    },
    colorGrade: null,
  };
}

/** The refs `buildEditContext` gives the fixture (timeline order). */
export const FIXTURE_REFS = {
  clips: { c1: 'clip-open', c2: 'clip-hand', c3: 'clip-run', c4: 'clip-logo' },
  captions: { t1: 'cap-hello', t2: 'cap-sale' },
};

/** Recursively freezes a value so any write in the code under test throws (ES modules are strict). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}
