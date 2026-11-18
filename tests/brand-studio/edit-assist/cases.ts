/**
 * "말로 편집" instruction table (docs/BRAND-EDITING-STUDIO.md §4.5): 61 marketer instructions, 45 Korean
 * and 16 English (the 61st, `en-remove-last-shorten-first`, added 2026-11-18 from a live misreading), on the
 * shared four-cut timeline (`fixture.ts`).
 *
 * Each case has a hand-written model answer (`reply`) and what must come of it (`expect`):
 * - `plan`: the deltas `diffTimelines` reports after resolve → apply, and whether the edit applies at once;
 * - `ask` / `cannot`: the structured question or refusal;
 * - `problems`: a plausible wrong answer and the problem codes the engine sends back for the one
 *   corrective call. `live` is the answer a good model should give to that instruction instead.
 *
 * `cases.test.ts` runs every canned reply through the engine. The same table is the live evaluation set:
 * a script can send `instruction` (with `context`) to a real model and compare the outcome with `expect`
 * (or `live`). That script does not exist yet and nothing here calls a model.
 */
import type { StepProblem } from '@/lib/brand-studio/edit-assist/apply';
import type { EditContext } from '@/lib/brand-studio/edit-assist/context';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import type { AskAbout, AskChoice, CannotReason, EditPlan } from '@/lib/brand-studio/edit-assist/plan';

export { assistFixture as editAssistCaseTimeline, FIXTURE_IDS as EDIT_ASSIST_CASE_IDS } from './fixture';

export interface EditAssistCase {
  id: string;
  locale: 'ko' | 'en';
  instruction: string;
  /** What the screen sends with the instruction. */
  context?: { playheadSec?: number; selectedClipId?: string };
  /** The part of the model's context the case depends on. */
  expectContext?: Partial<EditContext>;
  reply: EditPlan;
  expect:
    | { kind: 'plan'; deltas: EditDelta[]; instant: boolean }
    | { kind: 'problems'; problems: StepProblem[]; live: { kind: 'cannot'; reason: CannotReason } }
    | { kind: 'ask'; about: AskAbout; choices: AskChoice[] }
    | { kind: 'cannot'; reason: CannotReason };
}

const trimmed = (cut: number, beforeSec: number, afterSec: number): EditDelta => ({ kind: 'clip_trimmed', cut, beforeSec, afterSec });
const total = (afterSec: number): EditDelta => ({ kind: 'total', beforeSec: 20, afterSec });
const C = { c1: { clipId: 'clip-open' }, c2: { clipId: 'clip-hand' }, c3: { clipId: 'clip-run' }, c4: { clipId: 'clip-logo' } };

/** Fit to 15 s: 5 s off 5 / 5 / 6 / 4 s in proportion, the spare tenth to the first tie. */
const FIT_15: EditDelta[] = [trimmed(1, 5, 3.7), trimmed(2, 5, 3.8), trimmed(3, 6, 4.5), trimmed(4, 4, 3), total(15)];

export const EDIT_ASSIST_CASES: readonly EditAssistCase[] = [
  /* ---------------------------------------------------- Korean: plans */
  {
    id: 'ko-trim-to-length',
    locale: 'ko',
    instruction: '두 번째 컷을 2초로 줄여줘',
    reply: { kind: 'plan', steps: [{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }] },
    expect: { kind: 'plan', deltas: [trimmed(2, 5, 2), total(17)], instant: true },
  },
  {
    id: 'ko-keep-last-seconds-fast-cut',
    locale: 'ko',
    instruction: '세 번째 컷 마지막 2초만 남겨',
    reply: { kind: 'plan', steps: [{ do: 'trim', clip: 'c3', keep: 'end', seconds: 2 }] },
    expect: { kind: 'plan', deltas: [trimmed(3, 6, 2), total(16)], instant: true },
  },
  {
    id: 'ko-keep-middle',
    locale: 'ko',
    instruction: '두 번째 컷 가운데 3초만 남겨줘',
    reply: { kind: 'plan', steps: [{ do: 'trim', clip: 'c2', keep: 'middle', seconds: 3 }] },
    expect: { kind: 'plan', deltas: [trimmed(2, 5, 3), total(18)], instant: true },
  },
  {
    id: 'ko-cut-first-second',
    locale: 'ko',
    instruction: '세 번째 컷 앞 1초 잘라줘',
    reply: { kind: 'plan', steps: [{ do: 'trim', clip: 'c3', keep: 'end', seconds: 5 }] },
    expect: { kind: 'plan', deltas: [trimmed(3, 6, 5), total(19)], instant: true },
  },
  {
    id: 'ko-fit-total',
    locale: 'ko',
    instruction: '전체를 15초로 맞춰줘',
    reply: { kind: 'plan', steps: [{ do: 'fit_total', seconds: 15 }] },
    expect: { kind: 'plan', deltas: FIT_15, instant: false },
  },
  {
    id: 'ko-fit-total-protect',
    locale: 'ko',
    instruction: '로고 컷은 그대로 두고 전체 10초로 줄여줘',
    reply: { kind: 'plan', steps: [{ do: 'fit_total', seconds: 10, protect: ['c4'] }] },
    expect: { kind: 'plan', deltas: [trimmed(1, 5, 1.9), trimmed(2, 5, 1.9), trimmed(3, 6, 2.2), total(10)], instant: false },
  },
  {
    id: 'ko-even-pace',
    locale: 'ko',
    instruction: '모든 컷 3초씩으로 맞춰줘',
    reply: { kind: 'plan', steps: [{ do: 'even_pace', secondsPerClip: 3 }] },
    expect: { kind: 'plan', deltas: [trimmed(1, 5, 3), trimmed(2, 5, 3), trimmed(3, 6, 3), trimmed(4, 4, 3), total(12)], instant: false },
  },
  {
    id: 'ko-remove-last',
    locale: 'ko',
    instruction: '마지막 컷 지워줘',
    reply: { kind: 'plan', steps: [{ do: 'remove', clip: 'c4' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_removed', cut: 4, label: '로고 엔딩' }, total(16)], instant: false },
  },
  {
    id: 'ko-remove-by-label',
    locale: 'ko',
    instruction: '손에 든 제품 컷 빼줘',
    reply: { kind: 'plan', steps: [{ do: 'remove', clip: 'c2' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_removed', cut: 2, label: '손에 든 제품' }, total(15)], instant: false },
  },
  {
    id: 'ko-swap-across',
    locale: 'ko',
    instruction: '첫 컷이랑 셋째 컷 순서 바꿔줘',
    reply: {
      kind: 'plan',
      steps: [
        { do: 'move', clip: 'c1', to: { after: 'c3' } },
        { do: 'move', clip: 'c3', to: 'first' },
      ],
    },
    expect: {
      kind: 'plan',
      deltas: [
        { kind: 'clip_moved', cut: 1, toPosition: 3 },
        { kind: 'clip_moved', cut: 3, toPosition: 1 },
      ],
      instant: false,
    },
  },
  {
    id: 'ko-move-first',
    locale: 'ko',
    instruction: '로고 컷을 맨 앞으로 옮겨줘',
    reply: { kind: 'plan', steps: [{ do: 'move', clip: 'c4', to: 'first' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_moved', cut: 4, toPosition: 1 }], instant: true },
  },
  {
    id: 'ko-swap-neighbours',
    locale: 'ko',
    instruction: '두 번째랑 세 번째 컷 자리 바꿔',
    reply: { kind: 'plan', steps: [{ do: 'move', clip: 'c2', to: { after: 'c3' } }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_moved', cut: 2, toPosition: 3 }], instant: true },
  },
  {
    id: 'ko-music-down',
    locale: 'ko',
    instruction: '음악 좀 줄여줘',
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'music', volume: 0.3 }] },
    expect: { kind: 'plan', deltas: [{ kind: 'music_volume', beforePct: 60, afterPct: 30 }], instant: true },
  },
  {
    id: 'ko-music-mute',
    locale: 'ko',
    instruction: '배경음악 꺼줘',
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'music', muted: true }] },
    expect: { kind: 'plan', deltas: [{ kind: 'music_volume', beforePct: 60, afterPct: 0 }], instant: true },
  },
  {
    id: 'ko-music-remove',
    locale: 'ko',
    instruction: '음악 빼줘',
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'music', remove: true }] },
    expect: { kind: 'plan', deltas: [{ kind: 'music_removed' }], instant: false },
  },
  {
    id: 'ko-mute-selected',
    locale: 'ko',
    instruction: '이 컷 소리 꺼줘',
    context: { selectedClipId: 'clip-hand' },
    expectContext: { selected: 'c2' },
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'c2', muted: true }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_sound', cut: 2, muted: true }], instant: true },
  },
  {
    id: 'ko-mute-all-clips',
    locale: 'ko',
    instruction: '모든 컷 원본 소리 꺼줘',
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'all_clips', muted: true }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_sound', cut: 'all', muted: true }], instant: true },
  },
  {
    id: 'ko-clip-volume',
    locale: 'ko',
    instruction: '세 번째 컷 소리 50%로',
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'c3', volume: 0.5 }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_sound', cut: 3, volumePct: 50 }], instant: true },
  },
  {
    id: 'ko-caption-end',
    locale: 'ko',
    instruction: "마지막에 '지금 만나보세요' 자막 넣어줘",
    reply: { kind: 'plan', steps: [{ do: 'caption_add', text: '지금 만나보세요', where: 'end' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_added', text: '지금 만나보세요', fromSec: 17.5, toSec: 20 }], instant: true },
  },
  {
    id: 'ko-caption-whole-top-small',
    locale: 'ko',
    instruction: "영상 내내 위쪽에 '#광고' 작게 넣어줘",
    reply: { kind: 'plan', steps: [{ do: 'caption_add', text: '#광고', where: 'whole', position: 'top', size: 'sm' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_added', text: '#광고', fromSec: 0, toSec: 20 }], instant: true },
  },
  {
    id: 'ko-caption-on-cut',
    locale: 'ko',
    instruction: "달리는 컷에 '도시를 달리다' 자막 달아줘",
    reply: { kind: 'plan', steps: [{ do: 'caption_add', text: '도시를 달리다', where: { clip: 'c3' } }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_added', text: '도시를 달리다', fromSec: 10, toSec: 16 }], instant: true },
  },
  {
    id: 'ko-caption-range',
    locale: 'ko',
    instruction: "5초부터 8초까지 '한정 수량' 자막 넣어",
    reply: { kind: 'plan', steps: [{ do: 'caption_add', text: '한정 수량', where: { from: 5, to: 8 } }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_added', text: '한정 수량', fromSec: 5, toSec: 8 }], instant: true },
  },
  {
    id: 'ko-caption-move-up',
    locale: 'ko',
    instruction: '첫 자막 위로 올려줘',
    reply: { kind: 'plan', steps: [{ do: 'caption_edit', caption: 't1', position: 'top' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_changed', text: '봄 신상 출시', changed: ['position'] }], instant: true },
  },
  {
    id: 'ko-caption-rewrite',
    locale: 'ko',
    instruction: "할인 자막을 '오늘만 30% 할인'으로 바꿔줘",
    reply: { kind: 'plan', steps: [{ do: 'caption_edit', caption: 't2', text: '오늘만 30% 할인' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_changed', text: '오늘만 30% 할인', changed: ['text'] }], instant: true },
  },
  {
    id: 'ko-captions-clear',
    locale: 'ko',
    instruction: '자막 다 지워줘',
    reply: { kind: 'plan', steps: [{ do: 'caption_remove', caption: 'all' }] },
    expect: {
      kind: 'plan',
      deltas: [
        { kind: 'caption_removed', text: '봄 신상 출시' },
        { kind: 'caption_removed', text: '지금 20% 할인' },
      ],
      instant: false,
    },
  },
  {
    id: 'ko-landscape',
    locale: 'ko',
    instruction: '가로 영상으로 바꿔줘',
    reply: { kind: 'plan', steps: [{ do: 'aspect', aspect: '16:9' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'aspect', before: '9:16', after: '16:9' }], instant: true },
  },
  {
    id: 'ko-warm-look',
    locale: 'ko',
    instruction: '따뜻한 필름 느낌으로 해줘',
    reply: { kind: 'plan', steps: [{ do: 'look', preset: 'kodak-2383-warm' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'look', preset: 'kodak-2383-warm' }], instant: true },
  },
  {
    id: 'ko-split-half',
    locale: 'ko',
    instruction: '두 번째 컷을 반으로 잘라줘',
    reply: { kind: 'plan', steps: [{ do: 'split', clip: 'c2', at: 2.5 }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_split', cut: 2, atSec: 2.5 }], instant: true },
  },
  {
    id: 'ko-split-here',
    locale: 'ko',
    instruction: '여기서 잘라줘',
    context: { playheadSec: 12 },
    expectContext: { playhead: { sec: 12, cut: 'c3', inCut: 2 } },
    reply: { kind: 'plan', steps: [{ do: 'split', clip: 'c3', at: 2 }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_split', cut: 3, atSec: 2 }], instant: true },
  },
  {
    id: 'ko-split-drop-back-half',
    locale: 'ko',
    instruction: '두 번째 컷 반으로 나누고 뒤쪽은 지워줘',
    reply: {
      kind: 'plan',
      steps: [
        { do: 'split', clip: 'c2', at: 2.5 },
        { do: 'remove', clip: 'c2b' },
      ],
    },
    expect: { kind: 'plan', deltas: [trimmed(2, 5, 2.5), total(17.5)], instant: true },
  },
  {
    id: 'ko-trim-then-end-caption',
    locale: 'ko',
    instruction: "첫 컷 2초로 줄이고 마지막에 '지금 만나보세요' 자막 넣어줘",
    reply: {
      kind: 'plan',
      steps: [
        { do: 'trim', clip: 'c1', keep: 'start', seconds: 2 },
        { do: 'caption_add', text: '지금 만나보세요', where: 'end' },
      ],
    },
    expect: {
      kind: 'plan',
      deltas: [trimmed(1, 5, 2), { kind: 'caption_added', text: '지금 만나보세요', fromSec: 14.5, toSec: 17 }, total(17)],
      instant: false,
    },
  },
  {
    id: 'ko-remove-then-trim-by-id',
    locale: 'ko',
    instruction: '첫 컷 지우고 두 번째 컷 3초로',
    reply: {
      kind: 'plan',
      steps: [
        { do: 'remove', clip: 'c1' },
        { do: 'trim', clip: 'c2', keep: 'start', seconds: 3 },
      ],
    },
    expect: {
      kind: 'plan',
      deltas: [{ kind: 'clip_removed', cut: 1, label: '오프닝 향수 클로즈업' }, trimmed(2, 5, 3), total(13)],
      instant: false,
    },
  },
  {
    id: 'ko-fit-and-music-up',
    locale: 'ko',
    instruction: '전체 12초로 맞추고 음악은 키워줘',
    reply: {
      kind: 'plan',
      steps: [
        { do: 'fit_total', seconds: 12 },
        { do: 'sound', target: 'music', volume: 0.8 },
      ],
    },
    expect: {
      kind: 'plan',
      deltas: [
        trimmed(1, 5, 3),
        trimmed(2, 5, 3),
        trimmed(3, 6, 3.6),
        trimmed(4, 4, 2.4),
        { kind: 'music_volume', beforePct: 60, afterPct: 80 },
        total(12),
      ],
      instant: false,
    },
  },

  /* ----------------------------------------------------- Korean: asks */
  {
    id: 'ko-ask-which-cut',
    locale: 'ko',
    instruction: '컷 하나만 좀 줄여줘',
    reply: { kind: 'ask', about: 'which_clip', choices: ['c1', 'c2', 'c3', 'c4'] },
    expect: { kind: 'ask', about: 'which_clip', choices: [C.c1, C.c2, C.c3, C.c4] },
  },
  {
    id: 'ko-ask-how-long',
    locale: 'ko',
    instruction: '두 번째 컷 좀 짧게',
    reply: { kind: 'ask', about: 'how_long', choices: ['2', '3'] },
    expect: { kind: 'ask', about: 'how_long', choices: [2, 3] },
  },
  {
    id: 'ko-ask-which-caption',
    locale: 'ko',
    instruction: '자막 고쳐줘',
    reply: { kind: 'ask', about: 'which_caption', choices: ['t1', 't2'] },
    expect: { kind: 'ask', about: 'which_caption', choices: [{ captionId: 'cap-hello' }, { captionId: 'cap-sale' }] },
  },
  {
    id: 'ko-ask-where-caption',
    locale: 'ko',
    instruction: "'한정판' 자막 넣어줘",
    reply: { kind: 'ask', about: 'where_caption', choices: ['start', 'end', 'whole'] },
    expect: { kind: 'ask', about: 'where_caption', choices: ['start', 'end', 'whole'] },
  },
  {
    id: 'ko-ask-which-sound',
    locale: 'ko',
    instruction: '소리 꺼줘',
    reply: { kind: 'ask', about: 'which_clip', choices: ['all', 'c1', 'c2'] },
    expect: { kind: 'ask', about: 'which_clip', choices: ['all', C.c1, C.c2] },
  },
  {
    id: 'ko-ask-total-length',
    locale: 'ko',
    instruction: '전체 길이 줄여줘',
    reply: { kind: 'ask', about: 'how_long', choices: ['10', '15'] },
    expect: { kind: 'ask', about: 'how_long', choices: [10, 15] },
  },

  /* -------------------------------------------------- Korean: refusals */
  {
    id: 'ko-cannot-text-in-footage',
    locale: 'ko',
    instruction: '영상 속 간판 글자 바꿔줘',
    reply: { kind: 'cannot', reason: 'not_timeline_edit' },
    expect: { kind: 'cannot', reason: 'not_timeline_edit' },
  },
  {
    id: 'ko-cannot-night-background',
    locale: 'ko',
    instruction: '배경을 밤으로 바꿔줘',
    reply: { kind: 'cannot', reason: 'not_timeline_edit' },
    expect: { kind: 'cannot', reason: 'not_timeline_edit' },
  },
  {
    id: 'ko-cannot-slow-motion',
    locale: 'ko',
    instruction: '두 번째 컷 슬로모션으로 해줘',
    reply: { kind: 'cannot', reason: 'not_timeline_edit' },
    expect: { kind: 'cannot', reason: 'not_timeline_edit' },
  },
  {
    id: 'ko-cannot-dissolve',
    locale: 'ko',
    instruction: '컷 사이에 디졸브 넣어줘',
    reply: { kind: 'cannot', reason: 'not_timeline_edit' },
    expect: { kind: 'cannot', reason: 'not_timeline_edit' },
  },
  {
    id: 'ko-cannot-longer',
    locale: 'ko',
    instruction: '전체를 30초로 늘려줘',
    reply: { kind: 'cannot', reason: 'not_possible' },
    expect: { kind: 'cannot', reason: 'not_possible' },
  },

  /* --------------------------------------- Korean: answers the engine refuses */
  {
    id: 'ko-problem-no-look-to-remove',
    locale: 'ko',
    instruction: '색보정 빼줘',
    reply: { kind: 'plan', steps: [{ do: 'look', preset: 'off' }] },
    expect: { kind: 'problems', problems: [{ step: null, code: 'no_change' }], live: { kind: 'cannot', reason: 'nothing_to_edit' } },
  },

  /* -------------------------------------------------------- English */
  {
    id: 'en-trim-to-length',
    locale: 'en',
    instruction: 'Make the second cut 2 seconds',
    reply: { kind: 'plan', steps: [{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }] },
    expect: { kind: 'plan', deltas: [trimmed(2, 5, 2), total(17)], instant: true },
  },
  {
    id: 'en-fit-total',
    locale: 'en',
    instruction: 'Trim the whole video to 15 seconds',
    reply: { kind: 'plan', steps: [{ do: 'fit_total', seconds: 15 }] },
    expect: { kind: 'plan', deltas: FIT_15, instant: false },
  },
  {
    id: 'en-remove-last',
    locale: 'en',
    instruction: 'Delete the last clip',
    reply: { kind: 'plan', steps: [{ do: 'remove', clip: 'c4' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_removed', cut: 4, label: '로고 엔딩' }, total(16)], instant: false },
  },
  {
    // Live 11-18: the rule parser read "1 to 2s" as the range 1–2 s (a 1 s cut). Now the model decides.
    id: 'en-remove-last-shorten-first',
    locale: 'en',
    instruction: 'Remove the last cut and shorten cut 1 to 2s',
    reply: {
      kind: 'plan',
      steps: [
        { do: 'remove', clip: 'c4' },
        { do: 'trim', clip: 'c1', keep: 'start', seconds: 2 },
      ],
    },
    expect: {
      kind: 'plan',
      deltas: [{ kind: 'clip_removed', cut: 4, label: '로고 엔딩' }, trimmed(1, 5, 2), total(13)],
      instant: false,
    },
  },
  {
    id: 'en-move-first',
    locale: 'en',
    instruction: 'Move the logo shot to the start',
    reply: { kind: 'plan', steps: [{ do: 'move', clip: 'c4', to: 'first' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_moved', cut: 4, toPosition: 1 }], instant: true },
  },
  {
    id: 'en-music-down',
    locale: 'en',
    instruction: 'Turn the music down a bit',
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'music', volume: 0.4 }] },
    expect: { kind: 'plan', deltas: [{ kind: 'music_volume', beforePct: 60, afterPct: 40 }], instant: true },
  },
  {
    id: 'en-mute-selected',
    locale: 'en',
    instruction: 'Mute this clip',
    context: { selectedClipId: 'clip-open' },
    expectContext: { selected: 'c1' },
    reply: { kind: 'plan', steps: [{ do: 'sound', target: 'c1', muted: true }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_sound', cut: 1, muted: true }], instant: true },
  },
  {
    id: 'en-caption-end',
    locale: 'en',
    instruction: "Add 'Shop now' at the end",
    reply: { kind: 'plan', steps: [{ do: 'caption_add', text: 'Shop now', where: 'end' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'caption_added', text: 'Shop now', fromSec: 17.5, toSec: 20 }], instant: true },
  },
  {
    id: 'en-captions-clear',
    locale: 'en',
    instruction: 'Remove all captions',
    reply: { kind: 'plan', steps: [{ do: 'caption_remove', caption: 'all' }] },
    expect: {
      kind: 'plan',
      deltas: [
        { kind: 'caption_removed', text: '봄 신상 출시' },
        { kind: 'caption_removed', text: '지금 20% 할인' },
      ],
      instant: false,
    },
  },
  {
    id: 'en-landscape',
    locale: 'en',
    instruction: 'Switch to landscape',
    reply: { kind: 'plan', steps: [{ do: 'aspect', aspect: '16:9' }] },
    expect: { kind: 'plan', deltas: [{ kind: 'aspect', before: '9:16', after: '16:9' }], instant: true },
  },
  {
    id: 'en-split-here',
    locale: 'en',
    instruction: 'Split here',
    context: { playheadSec: 3 },
    expectContext: { playhead: { sec: 3, cut: 'c1', inCut: 3 } },
    reply: { kind: 'plan', steps: [{ do: 'split', clip: 'c1', at: 3 }] },
    expect: { kind: 'plan', deltas: [{ kind: 'clip_split', cut: 1, atSec: 3 }], instant: true },
  },
  {
    id: 'en-even-pace',
    locale: 'en',
    instruction: 'Make every shot 2 seconds',
    reply: { kind: 'plan', steps: [{ do: 'even_pace', secondsPerClip: 2 }] },
    expect: { kind: 'plan', deltas: [trimmed(1, 5, 2), trimmed(2, 5, 2), trimmed(3, 6, 2), trimmed(4, 4, 2), total(8)], instant: false },
  },
  {
    id: 'en-ask-which-cut',
    locale: 'en',
    instruction: 'Shorten a clip',
    reply: { kind: 'ask', about: 'which_clip', choices: ['c1', 'c2', 'c3', 'c4'] },
    expect: { kind: 'ask', about: 'which_clip', choices: [C.c1, C.c2, C.c3, C.c4] },
  },
  {
    id: 'en-ask-how-long',
    locale: 'en',
    instruction: 'Make it shorter',
    reply: { kind: 'ask', about: 'how_long', choices: ['10', '15'] },
    expect: { kind: 'ask', about: 'how_long', choices: [10, 15] },
  },
  {
    id: 'en-cannot-generate',
    locale: 'en',
    instruction: 'Generate a new product shot for the ending',
    reply: { kind: 'cannot', reason: 'not_timeline_edit' },
    expect: { kind: 'cannot', reason: 'not_timeline_edit' },
  },
  {
    id: 'en-problem-longer-than-cut',
    locale: 'en',
    instruction: 'Make the first cut 10 seconds long',
    reply: { kind: 'plan', steps: [{ do: 'trim', clip: 'c1', keep: 'start', seconds: 10 }] },
    expect: { kind: 'problems', problems: [{ step: 0, code: 'range_outside_cut' }], live: { kind: 'cannot', reason: 'not_possible' } },
  },
];
