import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuardLogLine } from '@/lib/ai-guard';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { STUDIO_LIMITS, type FilmSheet, type VideoUnderstandCard } from '@/lib/brand-studio/contracts';
import { writeCachedFilmSheet } from '@/lib/brand-studio/film-sheet';
import { resetFreeIntelRateLimits, FREE_INTEL_LIMITS } from '@/lib/brand-studio/jobs';
import { runStudioOperation } from '@/lib/brand-studio/service';
import {
  UNDERSTAND_MAX_CLIPS,
  UNDERSTAND_SYSTEM,
  VIDEO_UNDERSTAND_GUARD_SITE,
  audioMismatchSlip,
  buildAmbiguousRefQuestion,
  clampCardFromReading,
  hasHapsyoEnding,
  hasMalformedMentionToken,
  hasPrematureStartPromise,
  hasRawNumericPicturePhrase,
  josaIGa,
  mentionsMissingImageAttachment,
  parseCountingScheme,
  readUnderstand,
  readUnderstandWithTries,
  replaceResolvedPhrasesWithMentions,
  requestedAudioFromMessage,
  resolveImageReferencesInMessage,
  settleUnderstanding,
  stripCreditFigures,
  understandSlips,
  type UnderstandReading,
  type UnderstandRefItem,
} from '@/lib/brand-studio/video/understand';
import {
  VIDEO_UNDERSTAND_EVAL_CASES,
  checkUnderstandExpectation,
} from '../video/understand-eval-fixtures';
import { seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

const VID_1: UnderstandRefItem = { index: 1, kind: 'video', name: 'ref.mp4', seconds: 10 };
const IMG_1: UnderstandRefItem = { index: 1, kind: 'image', name: 'bottle.png' };
const IMG_2: UnderstandRefItem = { index: 2, kind: 'image', name: 'mood.jpg' };
const IMG_3: UnderstandRefItem = { index: 3, kind: 'image', name: 'model.jpg' };
const AUD_1: UnderstandRefItem = { index: 1, kind: 'audio', name: 'bgm.mp3', seconds: 10 };

const EMPTY_CARD: VideoUnderstandCard = {
  swaps: [],
  changeText: '',
  requestText: '',
  seconds: 5,
  clipCount: 1,
  targetTotalSeconds: 5,
  audio: 'ambient',
};

const STANDING_CARD: VideoUnderstandCard = {
  swaps: [{ refIndex: 1, role: 'product', label: '제품 교체', use: '', avoid: '' }],
  changeText: '1번 제품으로 교체',
  requestText: '참고 영상 연출을 따라가며 1번 이미지 제품으로 교체합니다.',
  seconds: 8,
  clipCount: 1,
  targetTotalSeconds: 8,
  audio: 'ambient',
};

function makeReading(patch: Partial<UnderstandReading> = {}): UnderstandReading {
  return {
    kind: 'plan',
    reply: '@image1의 미감을 반영하고 @image2 인물로 교체해 만들게요.',
    swaps: [
      { refIndex: 1, role: 'style', label: '미감', use: '', avoid: '' },
      { refIndex: 2, role: 'person', label: '인물', use: '', avoid: '' },
    ],
    changeText: '@image1 미감 반영, @image2 인물로 교체',
    requestText: '@video1의 연출을 따라가며 @image1의 미감을 적용하고 @image2의 인물로 교체해요.',
    seconds: 10,
    clipCount: 1,
    audio: 'ambient',
    question: null,
    ...patch,
  };
}

function fakeGeminiFetch(
  answerOrFn: ((body: Record<string, unknown>, call: number) => unknown) | UnderstandReading | Error,
) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const idx = calls.length;
    calls.push({ url: String(url), body });
    const payload = typeof answerOrFn === 'function' ? (answerOrFn as (b: Record<string, unknown>, i: number) => unknown)(body, idx) : answerOrFn;
    if (payload instanceof Error) throw payload;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  return { fetch: fn as unknown as typeof fetch, mock: fn, calls };
}

const BASIC_SHEET: FilmSheet = {
  seconds: 10,
  aspect: '9:16',
  shots: [{ start: 0, end: 10, framing: 'medium', camera: 'dolly in', action: 'model holds bottle' }],
  look: { lighting: 'soft daylight', palette: 'ivory and blue', texture: 'clean' },
  audio: { music: false, speech: false, effects: 'room ambience' },
  summary: '10초 분량의 스튜디오 룩북 영상.',
};

describe('1. settleUnderstanding deterministic code rules', () => {
  const limits = { minSeconds: 4, maxSeconds: 15, maxClips: UNDERSTAND_MAX_CLIPS };

  it('founder sentence maps style + person swaps on [video, image, image], produces mention-tokenized requestText, and has NO mode or keep fields', () => {
    const settled = settleUnderstanding({
      reading: makeReading(),
      mode: 're_architect',
      message: '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해서 생성',
      references: [VID_1, IMG_1, IMG_2],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(settled.failed).toBeUndefined();
    expect(settled.readyToMake).toBe(true);
    expect(settled.card.swaps).toEqual([
      { refIndex: 1, role: 'style', label: '미감', use: '', avoid: '' },
      { refIndex: 2, role: 'person', label: '인물', use: '', avoid: '' },
    ]);
    // Contract requirement #1 & #6: NO mode, NO keep, NO keepLine
    expect('mode' in settled).toBe(false);
    expect('keep' in settled.card).toBe(false);
    expect('keepLine' in settled).toBe(false);
  });

  it('reclassifies confirm with nothing standing as unreadable; leaves standing card unchanged on confirm/tool_question/unreadable/not_possible', () => {
    const emptyConfirm = settleUnderstanding({
      reading: makeReading({ kind: 'confirm', reply: '알겠어요.' }),
      mode: 're_architect',
      message: 'ㅇㅇ',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(emptyConfirm.kind).toBe('unreadable');
    expect(emptyConfirm.readyToMake).toBe(false);
    expect(emptyConfirm.card).toEqual(EMPTY_CARD);

    for (const kind of ['confirm', 'tool_question', 'unreadable', 'not_possible'] as const) {
      const res = settleUnderstanding({
        reading: makeReading({
          kind,
          reply: '확인했어요.',
          swaps: [{ refIndex: 2, role: 'place', label: '다른 것', use: '', avoid: '' }],
          changeText: '다른 변경',
        }),
        mode: 're_architect',
        message: kind === 'confirm' ? 'ㅇㅇ' : '질문',
        references: [VID_1, IMG_1, IMG_2],
        modelLimits: limits,
        standing: { card: STANDING_CARD, questions: [] },
        answering: null,
      });
      expect(res.card, kind).toEqual(STANDING_CARD);
      expect(res.readyToMake, kind).toBe(kind === 'confirm');
    }
  });

  it('withdraw may ONLY remove (never adds new swaps), keeps readyToMake while a change stands, and clears readyToMake when empty', () => {
    const standingTwo: VideoUnderstandCard = {
      ...STANDING_CARD,
      swaps: [
        { refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' },
        { refIndex: 2, role: 'place', label: '배경', use: '', avoid: '' },
      ],
    };
    // Model tries to sneak in refIndex 3 during withdraw -> blocked!
    // SMALL #3: 1 standing swap still remains -> readyToMake stays true.
    const res = settleUnderstanding({
      reading: makeReading({
        kind: 'withdraw',
        reply: '배경 변경을 뺐어요.',
        swaps: [
          { refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' },
          { refIndex: 3, role: 'person', label: '인물', use: '', avoid: '' },
        ],
        changeText: '@image1 제품만',
        requestText: '@image1 제품만 교체해요.',
      }),
      mode: 're_architect',
      message: '배경은 빼줘',
      references: [VID_1, IMG_1, IMG_2, IMG_3],
      modelLimits: limits,
      standing: { card: standingTwo, questions: [] },
      answering: null,
    });
    expect(res.kind).toBe('withdraw');
    expect(res.card.swaps.map((s) => s.refIndex)).toEqual([1]);
    expect(res.readyToMake).toBe(true);

    // Full withdraw to nothing -> readyToMake is false!
    const emptied = settleUnderstanding({
      reading: makeReading({
        kind: 'withdraw',
        reply: '전부 취소했어요.',
        swaps: [],
        changeText: '',
        requestText: '',
      }),
      mode: 're_architect',
      message: '취소',
      references: [VID_1, IMG_1, IMG_2],
      modelLimits: limits,
      standing: { card: standingTwo, questions: [] },
      answering: null,
    });
    expect(emptied.card.swaps).toEqual([]);
    expect(emptied.card.changeText).toBe('');
    expect(emptied.card.requestText).toBe('');
    expect(emptied.readyToMake).toBe(false);
  });

  it('enforces max 1 question/turn, max 3 total, never same point twice, drops missing-attachment options/sentences', () => {
    expect(mentionsMissingImageAttachment('@image5로 바꿔줘', new Set([1, 2]))).toBe(true);
    expect(mentionsMissingImageAttachment('5번 이미지로 할까요?', new Set([1, 2]))).toBe(true);
    expect(mentionsMissingImageAttachment('2번 이미지로 할까요?', new Set([1, 2]))).toBe(false);

    // Duplicate point ignored (SMALL #2: uses shared `samePoint` from lib/revision/sheet-core.ts: spacing/punctuation insensitive)
    const prevQ = [{ point: 'target_ref', text: '무엇을 바꿀까요?', options: [{ label: '제품' }], answer: '제품' }];
    const dup = settleUnderstanding({
      reading: makeReading({
        reply: '@image1 제품으로 바꿀게요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품 교체',
        requestText: '@video1에 @image1 제품을 넣어요.',
        question: { point: 'Target Ref!', text: '다시 물어볼게요', options: [{ label: '인물' }] },
      }),
      mode: 're_architect',
      message: '제품',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: STANDING_CARD, questions: prevQ },
      answering: null,
    });
    expect(dup.openQuestion).toBeNull();
    expect(dup.questions).toHaveLength(1);

    // Max 3 questions reached -> 4th dropped
    const threeQ = [
      { point: 'p1', text: 'q1', options: [], answer: 'a1' },
      { point: 'p2', text: 'q2', options: [], answer: 'a2' },
      { point: 'p3', text: 'q3', options: [], answer: 'a3' },
    ];
    const fourth = settleUnderstanding({
      reading: makeReading({
        reply: '@image1 제품으로 진행할게요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품 교체',
        requestText: '@video1에 @image1 제품을 넣어요.',
        question: { point: 'p4', text: 'q4', options: [{ label: 'x' }] },
      }),
      mode: 're_architect',
      message: '계속',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: STANDING_CARD, questions: threeQ },
      answering: null,
    });
    expect(fourth.openQuestion).toBeNull();
    expect(fourth.questions).toHaveLength(3);

    // Option naming unattached image 5 is dropped, credit-bearing options/sentences dropped whole (W4), valid option kept
    const missingOpt = settleUnderstanding({
      reading: makeReading({
        reply: '어떤 이미지를 쓸까요?',
        swaps: [],
        changeText: '',
        requestText: '',
        question: {
          point: 'which_ref',
          text: '어떤 이미지를 쓸까요? 241 크레딧 들어요. 5번 이미지도 괜찮아요.',
          options: [{ label: '@image1' }, { label: '@image1 (120 크레딧)' }, { label: '@image5 사용' }, { label: '90 크레딧' }],
        },
      }),
      mode: 're_architect',
      message: '바꿔줘',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(missingOpt.openQuestion).toBe(0);
    expect(missingOpt.questions[0]!.options).toEqual([{ label: '@image1' }]);
    expect(missingOpt.questions[0]!.text).toBe('어떤 이미지를 쓸까요?');
    expect(missingOpt.readyToMake).toBe(false);
  });

  it('S2: checks requestText & changeText for missing attachments and credit figures in slips & clamping; fails if emptied', () => {
    const onlyImg1 = new Set([1]);
    const badReqReading = makeReading({
      reply: '알겠어요.',
      swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
      changeText: '120 크레딧',
      requestText: '3번 이미지의 인물로 교체해요.',
    });
    const slips = understandSlips(badReqReading, onlyImg1);
    expect(slips.missingAttachment).toBeGreaterThanOrEqual(1);
    expect(slips.creditFigure).toBeGreaterThanOrEqual(1);

    const clampedBad = clampCardFromReading(badReqReading, 're_architect', onlyImg1, limits, 'ambient');
    expect(clampedBad.requestEmptied).toBe(true);
    expect(clampedBad.changeEmptied).toBe(true);

    const settledBad = settleUnderstanding({
      reading: badReqReading,
      mode: 're_architect',
      message: '바꿔줘',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: STANDING_CARD, questions: [] },
      answering: null,
    });
    expect(settledBad.failed).toBe(true);
    expect(settledBad.reply).toBeNull();
    expect(settledBad.readyToMake).toBe(false);
    expect(settledBad.card).toEqual(STANDING_CARD);
  });

  it('W1: pure resolveImageReferencesInMessage test table (founder sentence, image-first, 3 images, @image2, 첫 번째 이미지, ambiguous)', () => {
    const vid = { position: 1, index: 1, mention: '@video1', kind: 'video' as const, name: 'ref.mp4', seconds: 10 };
    const i1 = { position: 2, index: 1, mention: '@image1', kind: 'image' as const, name: 'mood.jpg' };
    const i2 = { position: 3, index: 2, mention: '@image2', kind: 'image' as const, name: 'model.jpg' };

    // 1) Founder's sentence with [video, image, image]: 3번 ONLY exists at position 3 -> position counting -> 2번=@image1, 3번=@image2
    const founder = resolveImageReferencesInMessage(
      '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해서 생성',
      [vid, i1, i2],
    );
    expect(founder.ambiguous).toEqual([]);
    expect(founder.missing).toEqual([]);
    expect(founder.resolved.map((r) => [r.phrase, r.mention, r.refIndex])).toEqual([
      ['2번 이미지', '@image1', 1],
      ['3번 이미지', '@image2', 2],
    ]);

    // 2) [image, image, video]: position === per-kind index -> both_same, 3번 이미지 missing
    const imgFirst = resolveImageReferencesInMessage('1번 이미지와 2번 이미지 쓰고 3번 이미지는 없어', [
      { position: 1, index: 1, mention: '@image1', kind: 'image', name: 'a.png' },
      { position: 2, index: 2, mention: '@image2', kind: 'image', name: 'b.png' },
      { position: 3, index: 1, mention: '@video1', kind: 'video', name: 'ref.mp4' },
    ]);
    expect(imgFirst.ambiguous).toEqual([]);
    expect(imgFirst.resolved.map((r) => [r.phrase, r.refIndex, r.via])).toEqual([
      ['1번 이미지', 1, 'both_same'],
      ['2번 이미지', 2, 'both_same'],
    ]);
    expect(imgFirst.missing.map((m) => m.number)).toEqual([3]);

    // 3) Three images [image, image, image]
    const threeImgs = resolveImageReferencesInMessage('2번 이미지의 미감대로 3번 이미지의 인물로', [
      { position: 1, index: 1, mention: '@image1', kind: 'image', name: 'a.png' },
      { position: 2, index: 2, mention: '@image2', kind: 'image', name: 'b.png' },
      { position: 3, index: 3, mention: '@image3', kind: 'image', name: 'c.png' },
    ]);
    expect(threeImgs.ambiguous).toEqual([]);
    expect(threeImgs.resolved.map((r) => [r.phrase, r.refIndex])).toEqual([
      ['2번 이미지', 2],
      ['3번 이미지', 3],
    ]);

    // 4) Explicit `@image2` always means per-kind 2 even when video is at position 1
    const explicit = resolveImageReferencesInMessage('@image2로 인물 교체해줘', [vid, i1, i2]);
    expect(explicit.ambiguous).toEqual([]);
    expect(explicit.resolved.map((r) => [r.phrase, r.refIndex, r.via])).toEqual([['@image2', 2, 'explicit']]);

    // 5) `첫 번째 이미지` on [video, image, image]: pos 1 is video (not image), kind 1 is @image1 -> unambiguous @image1
    const ordinal = resolveImageReferencesInMessage('첫 번째 이미지로 배경 바꿔줘', [vid, i1, i2]);
    expect(ordinal.ambiguous).toEqual([]);
    expect(ordinal.resolved.map((r) => [r.phrase, r.refIndex, r.via])).toEqual([['첫 번째 이미지', 1, 'kind_only']]);

    // 6) Ambiguous case: `2번 이미지로 바꿔줘` on [video, image, image] -> candA=@image1 (pos 2) vs candB=@image2 (2nd image)
    const amb = resolveImageReferencesInMessage('2번 이미지로 바꿔줘', [vid, i1, i2]);
    expect(amb.ambiguous).toHaveLength(1);
    expect(amb.ambiguous[0]!.candidates.map((c) => c.refIndex)).toEqual([1, 2]);

    // 7) A1: Bare counts (`카메라를 2번 돌려`, `3번 반복`) produce NO reference; role-adjacent (`1번 인물로`, `2번으로 배경`) DO!
    expect(resolveImageReferencesInMessage('카메라를 2번 돌려주고 3번 반복해줘', [vid, i1, i2])).toEqual({
      resolved: [],
      ambiguous: [],
      missing: [],
      countingScheme: null,
    });
    const roleAdj = resolveImageReferencesInMessage('1번 인물로 바꾸고 2번으로 배경 써줘', [
      { position: 1, index: 1, mention: '@image1', kind: 'image', name: 'model.jpg' },
      { position: 2, index: 2, mention: '@image2', kind: 'image', name: 'place.jpg' },
    ]);
    expect(roleAdj.ambiguous).toEqual([]);
    expect(roleAdj.resolved.map((r) => [r.phrase, r.refIndex, r.replaceTarget])).toEqual([
      ['1번 인물', 1, '1번'],
      ['2번으로 배경', 2, '2번'],
    ]);

    // 8) A4: `마지막 이미지` + English ordinals (`the second image`, `second picture`, `image 2`)
    const lastImg = resolveImageReferencesInMessage('마지막 이미지의 인물로 교체해줘', [vid, i1, i2]);
    expect(lastImg.ambiguous).toEqual([]);
    expect(lastImg.resolved.map((r) => [r.phrase, r.mention, r.refIndex, r.via])).toEqual([
      ['마지막 이미지', '@image2', 2, 'last_image'],
    ]);
    const enImgs: UnderstandRefItem[] = [
      { position: 1, index: 1, mention: '@image1', kind: 'image', name: 'a.png' },
      { position: 2, index: 2, mention: '@image2', kind: 'image', name: 'b.png' },
    ];
    expect(resolveImageReferencesInMessage('Use the second image for lighting', enImgs).resolved.map((r) => r.refIndex)).toEqual([2]);
    expect(resolveImageReferencesInMessage('Swap with second picture', enImgs).resolved.map((r) => r.refIndex)).toEqual([2]);
    expect(resolveImageReferencesInMessage('Use image 2 here', enImgs).resolved.map((r) => r.refIndex)).toEqual([2]);
  });

  it('A2 + B3 + B6: tokenizes raw echoed founder sentence, retries on persistent raw numeric refs / audio mismatch / 합니다체 (soft tone)', async () => {
    const founderRefs: UnderstandRefItem[] = [
      { position: 1, index: 1, mention: '@video1', kind: 'video', name: 'ref.mp4', seconds: 10 },
      { position: 2, index: 1, mention: '@image1', kind: 'image', name: 'mood.jpg' },
      { position: 3, index: 2, mention: '@image2', kind: 'image', name: 'model.jpg' },
    ];
    const founderMsg = '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해서 생성';
    const founderRes = resolveImageReferencesInMessage(founderMsg, founderRefs);

    // A2: Fake model echoes the founder's raw positional phrases back in `requestText` and `changeText` -> rewritten to mention tokens!
    const tokenized = replaceResolvedPhrasesWithMentions(
      '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해요.',
      founderRes.resolved,
      founderRefs,
    );
    expect(tokenized).toBe('@video1에서 @image1의 미감대로 @image2의 인물로 교체해요.');
    expect(hasRawNumericPicturePhrase(tokenized)).toBe(false);

    const settledEcho = settleUnderstanding({
      reading: makeReading({
        reply: '@image1의 미감으로 @image2 인물을 넣어 만들게요.',
        swaps: [
          { refIndex: 1, role: 'style', label: '미감', use: '', avoid: '' },
          { refIndex: 2, role: 'person', label: '인물', use: '', avoid: '' },
        ],
        changeText: '2번 이미지의 미감, 3번 이미지의 인물',
        requestText: '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해요.',
      }),
      mode: 're_architect',
      message: founderMsg,
      references: founderRefs,
      resolvedReferences: founderRes.resolved,
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(settledEcho.failed).toBeUndefined();
    expect(settledEcho.card.requestText).toContain('@video1');
    expect(settledEcho.card.requestText).toContain('@image1');
    expect(settledEcho.card.requestText).toContain('@image2');
    expect(hasRawNumericPicturePhrase(settledEcho.card.requestText)).toBe(false);

    // A2: Unresolved raw numeric picture phrase still left after replacement -> slip -> 1 retry -> failure (`raw_picture_phrase`)
    const fakeRawRef = fakeGeminiFetch(() =>
      makeReading({
        reply: '@image1로 만들게요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '2번 이미지 교체',
        requestText: '2번 이미지로 교체해요.',
      }),
    );
    const rawFail = await readUnderstandWithTries(
      { fetch: fakeRawRef.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      {
        mode: 're_architect',
        message: '좀 바꿔줘',
        references: founderRefs,
        current: { seconds: 5, clipCount: 1, targetTotalSeconds: 5, audio: 'ambient', changeText: '' },
        modelLimits: limits,
        filmSummary: null,
        previous: null,
        answering: null,
        resolvedReferences: [],
      },
    );
    expect(rawFail.tries).toBe(2);
    expect(rawFail.outcome).toMatchObject({ ok: false, why: 'raw_picture_phrase' });

    // B3: Audio mismatch (music requested while audio=ambient) -> slip -> retry fixes to native!
    expect(
      audioMismatchSlip(
        makeReading({ audio: 'ambient', requestText: '배경음악을 넣어 만들어요.' }),
        '배경음악까지 함께 넣어줘',
      ),
    ).toBe(true);
    const fakeAudio = fakeGeminiFetch((_b, call) =>
      makeReading({
        reply: '@image1 제품으로 배경음악과 함께 만들게요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품 교체',
        requestText: '@video1에 @image1 제품과 배경음악을 넣어요.',
        audio: call === 0 ? 'ambient' : 'native',
      }),
    );
    const audioRetried = await readUnderstandWithTries(
      { fetch: fakeAudio.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      {
        mode: 'motion_transfer',
        message: '1번 제품으로 교체하고 배경음악까지 함께 넣어줘',
        references: [VID_1, IMG_1],
        current: { seconds: 5, clipCount: 1, targetTotalSeconds: 5, audio: 'ambient', changeText: '' },
        modelLimits: { minSeconds: 4, maxSeconds: 15, maxClips: 1 },
        filmSummary: null,
        previous: null,
        answering: null,
      },
    );
    expect(audioRetried.tries).toBe(2);
    expect(audioRetried.outcome.ok).toBe(true);
    if (audioRetried.outcome.ok) expect(audioRetried.outcome.reading.audio).toBe('native');

    // B6: 합니다체 triggers 1 retry; if still 합니다체 after retry, STILL succeeds (never fails a correct card for tone)
    expect(hasHapsyoEnding('확정했습니다. 이대로 진행해 주세요.')).toBe(true);
    expect(hasHapsyoEnding('@image1 제품으로 정리했어요.')).toBe(false);
    const fakeTone = fakeGeminiFetch(() =>
      makeReading({
        reply: '@image1 제품으로 구성했습니다.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품',
        requestText: '@video1에 @image1 제품을 넣어요.',
      }),
    );
    const toneRes = await readUnderstandWithTries(
      { fetch: fakeTone.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      {
        mode: 'motion_transfer',
        message: '1번 제품으로 교체해 주십시오.',
        references: [VID_1, IMG_1],
        current: { seconds: 5, clipCount: 1, targetTotalSeconds: 5, audio: 'ambient', changeText: '' },
        modelLimits: { minSeconds: 4, maxSeconds: 15, maxClips: 1 },
        filmSummary: null,
        previous: null,
        answering: null,
      },
    );
    expect(toneRes.tries).toBe(2);
    expect(toneRes.outcome.ok).toBe(true);
    expect(toneRes.slips.toneHapsyo).toBe(1);
  });

  it('Round 3 (#1, #2, #3): idempotent @video1 tokens, malformed token slip, session countingScheme, standing-card rule, josa, unreadable has no question', async () => {
    const founderRefs: UnderstandRefItem[] = [
      { position: 1, index: 1, mention: '@video1', kind: 'video', name: 'ref.mp4', seconds: 10 },
      { position: 2, index: 1, mention: '@image1', kind: 'image', name: 'mood.jpg' },
      { position: 3, index: 2, mention: '@image2', kind: 'image', name: 'model.jpg' },
    ];
    const founderRes = resolveImageReferencesInMessage(
      '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해서 생성',
      founderRefs,
    );

    // #1: Idempotent replacement: `@video1` stays `@video1`, `영상 1번` becomes `@video1`, mixed works, `@@video1` / `@ video1` are malformed slips!
    expect(replaceResolvedPhrasesWithMentions('@video1의 연출을 바탕으로 만들어요.', [], founderRefs)).toBe(
      '@video1의 연출을 바탕으로 만들어요.',
    );
    const once = replaceResolvedPhrasesWithMentions('영상 1번의 연출을 바탕으로 만들어요.', [], founderRefs);
    expect(once).toBe('@video1의 연출을 바탕으로 만들어요.');
    expect(replaceResolvedPhrasesWithMentions(once, [], founderRefs)).toBe('@video1의 연출을 바탕으로 만들어요.');
    expect(
      replaceResolvedPhrasesWithMentions('@video1에서 2번 이미지의 미감으로 만들어요.', founderRes.resolved, founderRefs),
    ).toBe('@video1에서 @image1의 미감으로 만들어요.');
    expect(hasMalformedMentionToken('@video1의 연출에 @image1 적용')).toBe(false);
    expect(hasMalformedMentionToken('@@video1의 연출')).toBe(true);
    expect(hasMalformedMentionToken('@ video1의 연출')).toBe(true);
    expect(hasMalformedMentionToken('@img1 적용')).toBe(true);

    // Malformed `@@video1` or `@ video1` from model -> slip -> 1 retry -> failure (`malformed_token`)
    for (const badToken of ['@@video1의 연출에 @image1 적용', '@ video1의 연출에 @image1 적용']) {
      const fakeMalformed = fakeGeminiFetch(() =>
        makeReading({
          reply: '@image1 제품으로 만들게요.',
          swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
          changeText: '@image1 제품',
          requestText: badToken,
        }),
      );
      const res = await readUnderstandWithTries(
        { fetch: fakeMalformed.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
        {
          mode: 're_architect',
          message: '@image1 제품으로',
          references: founderRefs,
          current: { seconds: 5, clipCount: 1, targetTotalSeconds: 5, audio: 'ambient', changeText: '' },
          modelLimits: limits,
          filmSummary: null,
          previous: null,
          answering: null,
        },
      );
      expect(res.tries, badToken).toBe(2);
      expect(res.outcome, badToken).toMatchObject({ ok: false, why: 'malformed_token' });
    }

    // #2a: Session counting scheme established by `position`, then ambiguous follow-up resolves without asking!
    expect(founderRes.countingScheme).toBe('position');
    const posFollowup = resolveImageReferencesInMessage('2번 인물로 바꿔줘', founderRefs, {
      countingScheme: founderRes.countingScheme,
    });
    expect(posFollowup.ambiguous).toEqual([]);
    expect(posFollowup.resolved.map((r) => [r.phrase, r.refIndex, r.via])).toEqual([
      ['2번 인물', 1, 'position_inferred'],
    ]);

    // #2b + Round 4 (E04): Session counting scheme established by `perKind` (E04 Turn 1 -> Turn 2),
    // then ambiguous follow-up with standing person swap on @image1 MUST follow `perKind` to @image2 (never hijacked back to @image1!).
    const e04Turn1 = resolveImageReferencesInMessage('1번 이미지 인물로 교체해줘', founderRefs);
    expect(e04Turn1.countingScheme).toBe('perKind');
    const e04Turn2 = resolveImageReferencesInMessage('아니, 2번 인물로', founderRefs, {
      countingScheme: e04Turn1.countingScheme,
      standingSwaps: [{ refIndex: 1, role: 'person', label: '인물', use: '', avoid: '' }],
    });
    expect(e04Turn2.ambiguous).toEqual([]);
    expect(e04Turn2.resolved.map((r) => [r.phrase, r.refIndex, r.via])).toEqual([['2번 인물', 2, 'kind_inferred']]);

    // #2c: Never established -> asks ONCE with proper Korean josa (`이/가`)
    expect(josaIGa('2번 인물')).toBe('이');
    expect(josaIGa('2번 이미지')).toBe('가');
    expect(josaIGa('2번 배경')).toBe('이');
    expect(josaIGa('@image1')).toBe('이');
    expect(josaIGa('@image2')).toBe('가');
    const noScheme = resolveImageReferencesInMessage('2번 인물로 바꿔줘', founderRefs);
    expect(noScheme.ambiguous).toHaveLength(1);
    expect(buildAmbiguousRefQuestion(noScheme.ambiguous[0]!, 'ko').question.text).toBe(
      "'2번 인물'이 어느 이미지인지 골라 주세요.",
    );
    const noSchemeImg = resolveImageReferencesInMessage('2번 이미지로 바꿔줘', founderRefs);
    expect(buildAmbiguousRefQuestion(noSchemeImg.ambiguous[0]!, 'ko').question.text).toBe(
      "'2번 이미지'가 어느 이미지인지 골라 주세요.",
    );

    // #2d: Standing-card rule (E07): `2번 배경은 빼줘` matches swap on standing card WITHOUT needing any prior scheme!
    const e07Turn2 = resolveImageReferencesInMessage('방금 말한 2번 배경은 빼줘', founderRefs, {
      countingScheme: null,
      standingSwaps: [
        { refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' },
        { refIndex: 2, role: 'place', label: '배경 장소', use: '', avoid: '' },
      ],
    });
    expect(e07Turn2.ambiguous).toEqual([]);
    expect(e07Turn2.resolved.map((r) => [r.phrase, r.refIndex, r.via])).toEqual([['2번 배경', 2, 'standing_card']]);

    // #2e: Forged scheme value is safely ignored (`parseCountingScheme` -> null)
    expect(parseCountingScheme('position')).toBe('position');
    expect(parseCountingScheme('perKind')).toBe('perKind');
    expect(parseCountingScheme('bogus')).toBeNull();
    expect(parseCountingScheme(123)).toBeNull();

    // #3: `unreadable` turn NEVER carries a formal question object or options (E06)
    const unreadableWithQ = settleUnderstanding({
      reading: makeReading({
        kind: 'unreadable',
        reply: '어떤 부분을 바꾸고 싶으신지 조금 더 구체적으로 말씀해 주세요.',
        swaps: [],
        changeText: '',
        requestText: '',
        question: {
          point: 'clarify',
          text: '어떤 작업을 원하시나요?',
          options: [{ label: '제품 교체' }, { label: '배경 변경' }],
        },
      }),
      mode: 're_architect',
      message: 'ㅇㅇ',
      references: founderRefs,
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(unreadableWithQ.kind).toBe('unreadable');
    expect(unreadableWithQ.openQuestion).toBeNull();
    expect(unreadableWithQ.questions).toEqual([]);
    expect(unreadableWithQ.readyToMake).toBe(false);
    expect(unreadableWithQ.reply).toContain('구체적으로');
  });

  it('W4 + Final round (#1-#4): whole-sentence credit/promise drop + summary fallback, dropped-picture retry-only slip, enforced audio, system rule', async () => {
    // W4: Whole-sentence drop for credit figures (never broken fragments like `이 작업은 이 들어요.`)
    expect(stripCreditFigures('이 작업은 120 크레딧이 들어요.')).toBe('');
    expect(stripCreditFigures('총 120 크레딧이 들어요. @image1 제품으로 정리했어요.')).toBe('@image1 제품으로 정리했어요.');
    expect(stripCreditFigures('80 credits')).toBe('');

    // W4: Premature-start promises (`바로 만들게요`, `지금 만들게요`, `시작할게요`) are detected as slips and dropped
    expect(hasPrematureStartPromise('총 120 크레딧이 들어요. 바로 만들게요.')).toBe(true);
    expect(hasPrematureStartPromise('지금 만들게요.')).toBe(true);
    expect(hasPrematureStartPromise('생성을 시작할게요.')).toBe(true);
    expect(hasPrematureStartPromise('@image1 제품으로 5초 영상을 구성할게요.')).toBe(false);

    // W4: When reply is emptied by credit + promise drops on a valid card, reply falls back to the card's summary line!
    const fallbackToSummary = settleUnderstanding({
      reading: makeReading({
        reply: '총 120 크레딧이 들어요. 바로 만들게요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품으로 교체',
        requestText: '@video1의 제품을 @image1로 교체해요.',
      }),
      mode: 're_architect',
      message: '1번 제품으로 교체해줘',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: STANDING_CARD, questions: [] },
      answering: null,
    });
    expect(fallbackToSummary.failed).toBeUndefined();
    expect(fallbackToSummary.reply).toBe('@image1 제품으로 교체');
    expect(fallbackToSummary.readyToMake).toBe(true);

    // When reply is emptied AND nothing stands on the card (no summary, no question), still fails safely
    const emptied = settleUnderstanding({
      reading: makeReading({
        kind: 'tool_question',
        reply: '120 크레딧',
        swaps: [],
        changeText: '',
        requestText: '',
      }),
      mode: 're_architect',
      message: '크레딧?',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(emptied.failed).toBe(true);
    expect(emptied.reply).toBeNull();
    expect(emptied.readyToMake).toBe(false);

    // Review #1: Dropped resolved picture (nothing unexpected added) -> retry-only slip (retries once; succeeds if still missing)
    const founderRefs: UnderstandRefItem[] = [
      { position: 1, index: 1, mention: '@video1', kind: 'video', name: 'ref.mp4', seconds: 10 },
      { position: 2, index: 1, mention: '@image1', kind: 'image', name: 'mood.jpg' },
      { position: 3, index: 2, mention: '@image2', kind: 'image', name: 'model.jpg' },
    ];
    const twoRefRes = resolveImageReferencesInMessage('1번 이미지 미감으로 하고 2번 이미지 인물로 교체해줘', founderRefs);
    expect(twoRefRes.resolved.map((r) => r.refIndex)).toEqual([1, 2]);
    const fakeDropped = fakeGeminiFetch(() =>
      makeReading({
        reply: '@image1 미감만 반영할게요.',
        swaps: [{ refIndex: 1, role: 'style', label: '미감', use: '', avoid: '' }],
        changeText: '@image1 미감 적용',
        requestText: '@video1에 @image1 미감을 적용해요.',
      }),
    );
    const dropRetry = await readUnderstandWithTries(
      { fetch: fakeDropped.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      {
        mode: 're_architect',
        message: '1번 이미지 미감으로 하고 2번 이미지 인물로 교체해줘',
        references: founderRefs,
        resolvedReferences: twoRefRes.resolved,
        current: { seconds: 5, clipCount: 1, targetTotalSeconds: 5, audio: 'ambient', changeText: '' },
        modelLimits: limits,
        filmSummary: null,
        previous: null,
        answering: null,
      },
    );
    expect(dropRetry.tries).toBe(2);
    expect(dropRetry.outcome.ok).toBe(true);
    expect(dropRetry.slips.refDropped).toBe(1);

    // Review #2 + Last-three #1: Enforced audio ONLY on clear silence/music requests; negated music NEVER forces `native`
    expect(requestedAudioFromMessage('무음으로 만들어줘')).toBe('silent');
    expect(requestedAudioFromMessage('소리 없이 만들어줘')).toBe('silent');
    expect(requestedAudioFromMessage('silent video please')).toBe('silent');
    expect(requestedAudioFromMessage('no sound')).toBe('silent');
    expect(requestedAudioFromMessage('배경음악 넣어줘')).toBe('native');
    expect(requestedAudioFromMessage('음악도 같이')).toBe('native');
    expect(requestedAudioFromMessage('음악 추가해줘')).toBe('native');
    expect(requestedAudioFromMessage('음악 넣어줘')).toBe('native');
    expect(requestedAudioFromMessage('BGM 넣어줘')).toBe('native');
    expect(requestedAudioFromMessage('with music')).toBe('native');
    expect(requestedAudioFromMessage('add music')).toBe('native');
    // Negated music: NEVER forces `native`; sets `ambient` ONLY when sentence also says 현장음/ambient
    expect(requestedAudioFromMessage('현장음만, 음악은 넣지 마')).toBe('ambient');
    expect(requestedAudioFromMessage('음악은 빼고')).toBeNull();
    expect(requestedAudioFromMessage('음악 없이 만들어줘')).toBeNull();
    expect(requestedAudioFromMessage('no music, ambient sound only')).toBe('ambient');
    expect(requestedAudioFromMessage('without music')).toBeNull();

    // `현장음만, 음악은 넣지 마` forces `ambient` even if model wrongly answered `native`; `음악은 빼고` leaves model's value untouched
    const negatedAmbient = settleUnderstanding({
      reading: makeReading({
        reply: '@image1 제품으로 현장음만 살려 정리했어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품, 현장음만',
        requestText: '@video1의 제품을 @image1로 교체하고 현장음만 살려요.',
        audio: 'native',
      }),
      mode: 're_architect',
      message: '1번 제품으로 현장음만, 음악은 넣지 마',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(negatedAmbient.card.audio).toBe('ambient');

    const negatedLeaveModel = settleUnderstanding({
      reading: makeReading({
        reply: '@image1 제품으로 음악 없이 정리했어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품 교체',
        requestText: '@video1의 제품을 @image1로 교체해요.',
        audio: 'ambient',
      }),
      mode: 're_architect',
      message: '1번 제품으로 음악은 빼고',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(negatedLeaveModel.card.audio).toBe('ambient');

    // Last-three #2: Customer won prices (`9,900원`) & percentages survive in `requestText`/`changeText`;
    // credit figures (`120 크레딧`) are still removed; model `reply` still drops whole credit sentences!
    const wonAdReading = makeReading({
      reply: '총 241 크레딧이 들어요. 자막에 특가 문구를 넣어 정리했어요.',
      swaps: [],
      changeText: '자막에 9,900원 특가 추가',
      requestText: '@video1 자막에 9,900원 특가와 30% 할인을 넣어 5초 영상을 만들어요.',
      audio: 'ambient',
    });
    const wonAdSlips = understandSlips(wonAdReading, new Set([1]), [], { message: '자막에 9,900원 특가 넣어줘', references: [VID_1, IMG_1] });
    expect(wonAdSlips.creditFigure).toBe(1); // ONLY reply (`241 크레딧`), NOT requestText/changeText (`9,900원`)
    const wonAdCleanSlips = understandSlips(
      { ...wonAdReading, reply: '자막에 특가 문구를 넣어 정리했어요.' },
      new Set([1]),
      [],
      { message: '자막에 9,900원 특가 넣어줘', references: [VID_1, IMG_1] },
    );
    expect(wonAdCleanSlips.creditFigure).toBe(0);
    const wonAdSettled = settleUnderstanding({
      reading: wonAdReading,
      mode: 're_architect',
      message: '자막에 9,900원 특가 넣어줘',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(wonAdSettled.failed).toBeUndefined();
    expect(wonAdSettled.card.changeText).toBe('자막에 9,900원 특가 추가');
    expect(wonAdSettled.card.requestText).toBe('@video1 자막에 9,900원 특가와 30% 할인을 넣어 5초 영상을 만들어요.');
    expect(wonAdSettled.reply).toBe('자막에 특가 문구를 넣어 정리했어요.');
    expect(wonAdSettled.readyToMake).toBe(true);
    const forcedSilent = settleUnderstanding({
      reading: makeReading({
        reply: '@image1 제품으로 정리했어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품으로 교체',
        requestText: '@video1의 제품을 @image1로 교체해요.',
        audio: 'ambient',
      }),
      mode: 're_architect',
      message: '1번 제품으로 소리 없이 무음으로 만들어줘',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(forcedSilent.card.audio).toBe('silent');

    const forcedMusic = settleUnderstanding({
      reading: makeReading({
        reply: '@image1 제품으로 정리했어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
        changeText: '@image1 제품으로 교체',
        requestText: '@video1의 제품을 @image1로 교체해요.',
        audio: 'ambient',
      }),
      mode: 're_architect',
      message: '1번 제품으로 BGM 음악도 같이 넣어줘',
      references: [VID_1, IMG_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(forcedMusic.card.audio).toBe('native');

    // Review #3: Credit-question instruction says credits are shown on the make button once the plan is ready
    expect(UNDERSTAND_SYSTEM).toContain('on the make button once the plan is ready');
    expect(UNDERSTAND_SYSTEM).not.toContain('right below the card');

    // Clamping: Motion Transfer forces clipCount=1, seconds clamped to 4..15, swaps IMAGES only (audio/video/missing dropped), notes cut to noteMax
    const longNote = 'x'.repeat(STUDIO_LIMITS.noteMax + 50);
    const longText = 'y'.repeat(STUDIO_LIMITS.promptMax + 50);
    const clamped = settleUnderstanding({
      reading: makeReading({
        reply: '1번 제품으로 최대 길이로 교체할게요.',
        swaps: [
          { refIndex: 1, role: 'product', label: '제품', use: longNote, avoid: longNote },
          { refIndex: 9, role: 'person', label: '없는 이미지', use: '', avoid: '' },
        ],
        seconds: 99,
        clipCount: 4,
        changeText: longText,
        requestText: longText,
        audio: 'silent',
      }),
      mode: 'motion_transfer',
      message: '최대로',
      references: [VID_1, IMG_1, AUD_1],
      modelLimits: limits,
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(clamped.card.clipCount).toBe(1);
    expect(clamped.card.seconds).toBe(15);
    expect(clamped.card.swaps).toHaveLength(1);
    expect(clamped.card.swaps[0]!.use.length).toBe(STUDIO_LIMITS.noteMax);
    expect(clamped.card.swaps[0]!.avoid.length).toBe(STUDIO_LIMITS.noteMax);
    expect(clamped.card.changeText.length).toBe(STUDIO_LIMITS.promptMax);
    expect(clamped.card.requestText.length).toBe(STUDIO_LIMITS.promptMax);
    expect(clamped.card.audio).toBe('silent');
  });
});

describe('2. Prompt guard (on / off / observe + canary + every output field)', () => {
  const baseInput = {
    mode: 'motion_transfer' as const,
    message: '1번 제품으로 교체해줘',
    references: [VID_1, IMG_1],
    current: { seconds: 5, clipCount: 1, targetTotalSeconds: 5, audio: 'ambient' as const, changeText: '' },
    modelLimits: { minSeconds: 4, maxSeconds: 15, maxClips: 1 },
    filmSummary: null,
    previous: null,
    answering: null,
  };

  it('PROMPT_GUARD=off sends no canary and passes through cleanly', async () => {
    const fake = fakeGeminiFetch(makeReading({ swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }] }));
    const res = await readUnderstand(
      { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      baseInput,
      { organizationId: 'org-1' },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.guardMode).toBe('off');
    const sysText = String((fake.calls[0]!.body.systemInstruction as { parts: Array<{ text: string }> }).parts[0]!.text);
    expect(sysText).not.toContain('<user_data');
    expect(sysText).not.toContain('INTERNAL_CANARY');
  });

  it('PROMPT_GUARD=enforce blocks canary in reply AND in every other free-text field (question, option, swap, changeText, requestText)', async () => {
    const fixedRandom = (size: number) => Uint8Array.from({ length: size }, (_, i) => (i + 1) % 256);
    const leakTargets = ['reply', 'question', 'option', 'swapLabel', 'swapUse', 'swapAvoid', 'changeText', 'requestText'] as const;

    for (const target of leakTargets) {
      const logs: GuardLogLine[] = [];
      const fake = fakeGeminiFetch((body) => {
        const sys = String((body.systemInstruction as { parts: Array<{ text: string }> }).parts[0]!.text);
        const canary = /pgc[a-z2-9]{20}/.exec(sys)?.[0] ?? 'CANARY_NOT_FOUND';
        expect(canary).toMatch(/^pgc[a-z2-9]{20}$/);
        const base = makeReading({
          swaps: [{ refIndex: 1, role: 'product', label: '제품 교체', use: '병 형태', avoid: '반사광' }],
          question: { point: 'tone', text: '톤은 어떻게 할까요?', options: [{ label: '따뜻하게' }] },
        });
        if (target === 'reply') base.reply = `알겠어요 ${canary}`;
        if (target === 'question') base.question!.text = `확인 ${canary}`;
        if (target === 'option') base.question!.options[0]!.label = `선택 ${canary}`;
        if (target === 'swapLabel') base.swaps[0]!.label = `교체 ${canary}`;
        if (target === 'swapUse') base.swaps[0]!.use = `사용 ${canary}`;
        if (target === 'swapAvoid') base.swaps[0]!.avoid = `피함 ${canary}`;
        if (target === 'changeText') base.changeText = `변경 ${canary}`;
        if (target === 'requestText') base.requestText = `요청 ${canary}`;
        return base;
      });
      const res = await readUnderstand(
        { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'enforce' } },
        baseInput,
        { organizationId: 'org-1', guardLog: (l) => logs.push(l), random: fixedRandom },
      );
      expect(res.ok, target).toBe(false);
      if (!res.ok) expect(res.why, target).toBe('guard_blocked');
      expect(logs.some((l) => l.site === VIDEO_UNDERSTAND_GUARD_SITE && l.action === 'fallback'), target).toBe(true);
    }
  });

  it('PROMPT_GUARD=observe blocks canary unconditionally, and logs non-canary leaks without blocking', async () => {
    const fixedRandom = (size: number) => Uint8Array.from({ length: size }, (_, i) => (size - i) % 256);
    // 1) Canary in observe -> STILL blocked!
    const logsCanary: GuardLogLine[] = [];
    const fakeCanary = fakeGeminiFetch((body) => {
      const sys = String((body.systemInstruction as { parts: Array<{ text: string }> }).parts[0]!.text);
      const canary = /pgc[a-z2-9]{20}/.exec(sys)?.[0] ?? '';
      return makeReading({ reply: `Secret ${canary}` });
    });
    const canaryRes = await readUnderstand(
      { fetch: fakeCanary.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'observe' } },
      baseInput,
      { organizationId: 'org-1', guardLog: (l) => logsCanary.push(l), random: fixedRandom },
    );
    expect(canaryRes.ok).toBe(false);
    if (!canaryRes.ok) expect(canaryRes.why).toBe('guard_blocked');
    expect(logsCanary[0]).toMatchObject({ site: VIDEO_UNDERSTAND_GUARD_SITE, mode: 'observe', action: 'fallback', reason: 'canary' });

    // 2) Benign answer in observe -> passes through with mode=observe
    const fakeBenign = fakeGeminiFetch(makeReading({ swaps: [{ refIndex: 1, role: 'product', label: '제품 교체', use: '', avoid: '' }] }));
    const benignRes = await readUnderstand(
      { fetch: fakeBenign.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'observe' } },
      baseInput,
      { organizationId: 'org-1', random: fixedRandom },
    );
    expect(benignRes.ok).toBe(true);
    if (benignRes.ok) expect(benignRes.guardMode).toBe('observe');
  });

  it('readUnderstandWithTries retries once on slip (bad refIndex) and fails after retry on persistent refMismatch', async () => {
    const fakeSlip = fakeGeminiFetch((_b, call) => {
      if (call === 0) {
        return makeReading({
          reply: '@image1 제품으로 교체할게요.',
          changeText: '@image1 제품 교체',
          requestText: '@video1에 @image1 제품을 넣어요.',
          swaps: [{ refIndex: 5, role: 'product', label: '없는 것', use: '', avoid: '' }],
        });
      }
      return makeReading({
        reply: '@image1 제품으로 교체할게요.',
        changeText: '@image1 제품 교체',
        requestText: '@video1에 @image1 제품을 넣어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품 교체', use: '', avoid: '' }],
      });
    });
    const retried = await readUnderstandWithTries(
      { fetch: fakeSlip.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      baseInput,
    );
    expect(retried.tries).toBe(2);
    expect(retried.slips.badSwapRef).toBe(1);
    expect(retried.outcome.ok).toBe(true);
    if (retried.outcome.ok) expect(retried.outcome.reading.swaps[0]!.refIndex).toBe(1);

    // W1: Contradicting resolved reference mapping -> 1 retry -> failure (`ref_mismatch`)
    const fakeMismatch = fakeGeminiFetch(() =>
      makeReading({
        reply: '@image1로 바꿀게요.',
        changeText: '@image1 교체',
        requestText: '@image1로 교체해요.',
        swaps: [{ refIndex: 1, role: 'person', label: '인물', use: '', avoid: '' }],
      }),
    );
    const mismatchRes = await readUnderstandWithTries(
      { fetch: fakeMismatch.fetch, env: { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } },
      {
        ...baseInput,
        message: '@image2로 인물 교체해줘',
        references: [VID_1, IMG_1, IMG_2],
        resolvedReferences: [{ phrase: '@image2', replaceTarget: '@image2', refIndex: 2, position: 3, mention: '@image2', name: 'mood.jpg', via: 'explicit' }],
      },
    );
    expect(mismatchRes.tries).toBe(2);
    expect(mismatchRes.outcome).toMatchObject({ ok: false, why: 'ref_mismatch' });
  });
});

describe('3. video.understand server operation: cold cache, seat matrix, rate limit, zero DB writes', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    resetFreeIntelRateLimits();
    f = await studioFixture({ capKrw: 5_000_000 });
  });
  afterEach(async () => {
    await f.db.close();
  });

  async function rowCounts() {
    return (
      await f.sql.query<{ jobs: number; assets: number; outputs: number; projects: number }>(
        `select
          (select count(*)::int from brand_studio_jobs) as jobs,
          (select count(*)::int from brand_studio_assets) as assets,
          (select count(*)::int from brand_studio_outputs) as outputs,
          (select count(*)::int from brand_projects) as projects`,
      )
    ).rows[0]!;
  }

  it('Re-Architect cold library cache -> reading; warm basic cache runs model, writes zero rows & logs zero customer text via console.warn', async () => {
    const fake = fakeGeminiFetch(
      makeReading({
        reply: '@image1 제품으로 교체해 만들게요.',
        changeText: '@image1 제품 교체',
        requestText: '@video1 연출대로 @image1 제품으로 교체해요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품 교체', use: '', avoid: '' }],
      }),
    );
    const deps = studioDeps(f.sql, {
      intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on', PROMPT_GUARD: 'enforce' } },
    });
    const vidId = await seedVideoAsset(deps, f.orgId, f.ids.owner, 10);

    const beforeCounts = await rowCounts();
    const cold = await runStudioOperation(deps, viewerOf(f.ids.owner), 'video.understand', {
      organizationId: f.orgId,
      mode: 're_architect',
      message: '1번 제품으로 교체',
      videoAssetId: vidId,
      references: [VID_1, IMG_1],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
    });
    expect(cold).toMatchObject({ ok: true, kind: 'reading', readyToMake: false, reply: null });
    expect(fake.mock).toHaveBeenCalledTimes(0);

    // Seed cached `basic` reading (what the dock's film.analyze stores)
    await writeCachedFilmSheet(f.sql, {
      organizationId: f.orgId,
      assetId: vidId,
      locale: 'ko',
      depth: 'basic',
      sheet: BASIC_SHEET,
    });

    const warmCountsBefore = await rowCounts();
    // SMALL #1: `studioLog` writes via `console.warn` — spy on `console.warn` and assert it ran with zero customer text/filenames/card text!
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const warm = await runStudioOperation(deps, viewerOf(f.ids.owner), 'video.understand', {
        organizationId: f.orgId,
        mode: 're_architect',
        message: '@image1 제품으로 교체 SECRET_CUSTOMER_TEXT',
        videoAssetId: vidId,
        references: [VID_1, IMG_1],
        current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
      });
      expect(warm).toMatchObject({ ok: true, kind: 'plan', readyToMake: true });
      expect(fake.mock).toHaveBeenCalledTimes(1);
      // Film summary passed, NOT shot timestamps
      const sentText = JSON.stringify(fake.calls[0]!.body);
      expect(sentText).toContain('10초 분량의 스튜디오 룩북 영상');
      expect(sentText).not.toContain('"shots"');
      // Logs ran via console.warn and contain ONLY codes & numbers — NEVER customer text, file names, or card text
      const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('[brand-studio] video_understand');
      expect(logged).not.toContain('SECRET_CUSTOMER_TEXT');
      expect(logged).not.toContain('bottle.png');
      expect(logged).not.toContain('ref.mp4');
      expect(logged).not.toContain('제품으로 교체');
    } finally {
      warnSpy.mockRestore();
    }

    // Zero rows written anywhere
    expect(await rowCounts()).toEqual(warmCountsBefore);
    expect(await rowCounts()).toEqual(beforeCounts);
  });

  it('B1 + S3 + W1: Re-Architect result video (no videoAssetId) succeeds without summary; forged previous.card is clamped; ambiguous ref asks thumbnail question', async () => {
    const fake = fakeGeminiFetch(
      makeReading({
        reply: '@image1 제품으로 교체할게요.',
        changeText: '@image1 제품 교체',
        requestText: '@video1 연출을 따라 @image1 제품으로 교체해요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
      }),
    );
    const deps = studioDeps(f.sql, {
      intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on' } },
    });

    // B1: Re-Architect WITHOUT `videoAssetId` (a customer RESULT video from wall / RecentCreations / SequenceRail)
    const resultVideoRes = await runStudioOperation(deps, viewerOf(f.ids.owner), 'video.understand', {
      organizationId: f.orgId,
      mode: 're_architect',
      message: '@image1 제품으로 교체해줘',
      references: [VID_1, IMG_1],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
    });
    expect(resultVideoRes).toMatchObject({ ok: true, kind: 'plan', readyToMake: true });
    expect(fake.mock).toHaveBeenCalledTimes(1);
    const contextPartText = String(
      ((fake.calls[0]!.body.contents as Array<{ parts: Array<{ text: string }> }>)[0]!.parts[1]!.text),
    );
    expect(contextPartText).toContain('"filmSummary":null');

    // S3: Forged `previous.card` on Motion Transfer (`clipCount: 4, seconds: 60, swaps: [{ refIndex: 9 }]`) -> clamped!
    const confirmFake = fakeGeminiFetch(
      makeReading({
        kind: 'confirm',
        reply: '이대로 만들 준비가 되었어요.',
        changeText: '@image1 제품 교체',
        requestText: '@image1 제품 교체해요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
      }),
    );
    const s3Deps = studioDeps(f.sql, {
      intelDeps: { fetch: confirmFake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on' } },
    });
    const forgedRes = await runStudioOperation(s3Deps, viewerOf(f.ids.owner), 'video.understand', {
      organizationId: f.orgId,
      mode: 'motion_transfer',
      message: 'ㅇㅇ',
      references: [VID_1, IMG_1],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
      previous: {
        card: {
          swaps: [
            { refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' },
            { refIndex: 9, role: 'person', label: '없는 것', use: '', avoid: '' },
          ],
          changeText: '@image1 제품 교체',
          requestText: '@image1 제품 교체해요.',
          seconds: 60,
          clipCount: 4,
          targetTotalSeconds: 60,
          audio: 'ambient',
        },
        questions: [],
        turns: [],
      },
    });
    expect(forgedRes).toMatchObject({
      ok: true,
      kind: 'confirm',
      readyToMake: true,
      card: {
        clipCount: 1,
        seconds: 15,
        targetTotalSeconds: 15,
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
      },
    });

    // W1: Ambiguous `2번 이미지로 바꿔줘` on [video, img1, img2] -> deterministic thumbnail question with 0 model calls!
    const ambCallsBefore = fake.calls.length;
    const ambRes = await runStudioOperation(deps, viewerOf(f.ids.owner), 'video.understand', {
      organizationId: f.orgId,
      mode: 're_architect',
      message: '2번 이미지로 바꿔줘',
      references: [
        { position: 1, index: 1, mention: '@video1', kind: 'video', name: 'ref.mp4', seconds: 10 },
        { position: 2, index: 1, mention: '@image1', kind: 'image', name: 'mood.jpg' },
        { position: 3, index: 2, mention: '@image2', kind: 'image', name: 'model.jpg' },
      ],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
    });
    expect(fake.calls.length).toBe(ambCallsBefore);
    expect(ambRes).toMatchObject({ ok: true, openQuestion: 0, readyToMake: false });
    if (ambRes.ok && 'questions' in ambRes) {
      expect(ambRes.questions[0]!.options.map((o) => o.refIndex)).toEqual([1, 2]);
    }

    // Round 3 #2: Server ignores forged `previous.countingScheme` (treated as null -> still asks on ambiguous phrase)
    const forgedSchemeRes = await runStudioOperation(deps, viewerOf(f.ids.owner), 'video.understand', {
      organizationId: f.orgId,
      mode: 're_architect',
      message: '2번 이미지로 바꿔줘',
      references: [
        { position: 1, index: 1, mention: '@video1', kind: 'video', name: 'ref.mp4', seconds: 10 },
        { position: 2, index: 1, mention: '@image1', kind: 'image', name: 'mood.jpg' },
        { position: 3, index: 2, mention: '@image2', kind: 'image', name: 'model.jpg' },
      ],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
      previous: {
        card: EMPTY_CARD,
        questions: [],
        turns: [],
        countingScheme: 'forged_scheme_value',
      },
    });
    expect(forgedSchemeRes).toMatchObject({ ok: true, openQuestion: 0, readyToMake: false, countingScheme: null });
  });

  it('Motion Transfer proceeds WITHOUT any cached film reading', async () => {
    const fake = fakeGeminiFetch(
      makeReading({
        reply: '@image1 제품으로 교체해 만들게요.',
        changeText: '@image1 제품 교체',
        requestText: '@video1 움직임에 @image1 제품을 넣어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품 교체', use: '', avoid: '' }],
      }),
    );
    const deps = studioDeps(f.sql, {
      intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on' } },
    });
    const res = await runStudioOperation(deps, viewerOf(f.ids.owner), 'video.understand', {
      organizationId: f.orgId,
      mode: 'motion_transfer',
      message: '@image1 제품으로 교체',
      references: [VID_1, IMG_1],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
    });
    expect(res).toMatchObject({ ok: true, kind: 'plan', readyToMake: true });
    expect(fake.mock).toHaveBeenCalledTimes(1);
  });

  it('enforces the full seat matrix, switch off -> invalid, allowance_closed, sandboxed, self_studio denied, and rate limit', async () => {
    const fake = fakeGeminiFetch(
      makeReading({
        reply: '@image1 제품으로 교체할게요.',
        changeText: '@image1 제품 교체',
        requestText: '@video1 움직임에 @image1 제품을 넣어요.',
        swaps: [{ refIndex: 1, role: 'product', label: '제품', use: '', avoid: '' }],
      }),
    );
    const payload = {
      organizationId: f.orgId,
      mode: 'motion_transfer',
      message: '1번 제품으로 교체',
      references: [VID_1, IMG_1],
      current: { seconds: 5, clipCount: 1, audio: 'ambient', changeText: '' },
    };

    // 1) Switch OFF -> invalid
    const offDeps = studioDeps(f.sql, {
      intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'off' } },
    });
    expect(await runStudioOperation(offDeps, viewerOf(f.ids.owner), 'video.understand', payload)).toEqual({
      ok: false,
      code: 'invalid',
    });

    const onDeps = studioDeps(f.sql, {
      intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on' } },
    });

    // 2) Viewer seat -> forbidden
    expect(await runStudioOperation(onDeps, viewerOf(f.ids.viewer), 'video.understand', payload)).toEqual({
      ok: false,
      code: 'forbidden',
    });

    // 3) Guest / unseated user -> not_found (or forbidden)
    const guestRes = await runStudioOperation(
      onDeps,
      viewerOf('99999999-9999-4999-8999-999999999999'),
      'video.understand',
      payload,
    );
    expect(guestRes.ok).toBe(false);

    // 4) self_studio denied -> feature_unavailable
    await f.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio'])`,
      [f.orgId],
    );
    expect(await runStudioOperation(onDeps, viewerOf(f.ids.owner), 'video.understand', payload)).toEqual({
      ok: false,
      code: 'feature_unavailable',
    });
    await f.sql.query(`delete from brand_feature_policies where organization_id = $1`, [f.orgId]);

    // 5) Sandboxed (Morphic) organization -> feature_unavailable
    const sandboxFixture = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]!, capKrw: 5_000_000 });
    try {
      const sbDeps = studioDeps(sandboxFixture.sql, {
        intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on' } },
      });
      expect(
        await runStudioOperation(sbDeps, viewerOf(sandboxFixture.ids.owner), 'video.understand', {
          ...payload,
          organizationId: sandboxFixture.orgId,
        }),
      ).toEqual({ ok: false, code: 'feature_unavailable' });
    } finally {
      await sandboxFixture.db.close();
    }

    // 6) allowance_closed (capKrw = 0)
    const closedAllowFixture = await studioFixture({ capKrw: 0 });
    try {
      const caDeps = studioDeps(closedAllowFixture.sql, {
        intelDeps: { fetch: fake.fetch, env: { GEMINI_API_KEY: 'test-key', BRAND_STUDIO_VIDEO_MODES: 'on' } },
      });
      expect(
        await runStudioOperation(caDeps, viewerOf(closedAllowFixture.ids.owner), 'video.understand', {
          ...payload,
          organizationId: closedAllowFixture.orgId,
        }),
      ).toEqual({ ok: false, code: 'allowance_closed' });
    } finally {
      await closedAllowFixture.db.close();
    }

    // 7) Rate limit (`FREE_INTEL_LIMITS.understandPerMinute`) -> `too_many_running`
    resetFreeIntelRateLimits();
    for (let i = 0; i < FREE_INTEL_LIMITS.understandPerMinute; i += 1) {
      const ok = await runStudioOperation(onDeps, viewerOf(f.ids.owner), 'video.understand', payload);
      expect(ok.ok, `call ${i + 1}`).toBe(true);
    }
    expect(await runStudioOperation(onDeps, viewerOf(f.ids.owner), 'video.understand', payload)).toEqual({
      ok: false,
      code: 'too_many_running',
    });
  });

  it('Batch C fixture suite has 28 distinct ko/en cases and checkUnderstandExpectation validates cleanly', () => {
    expect(VIDEO_UNDERSTAND_EVAL_CASES).toHaveLength(28);
    expect(new Set(VIDEO_UNDERSTAND_EVAL_CASES.map((c) => c.id)).size).toBe(28);
    // Founder case #1 first: exact founder tray [video, image1, image2] -> swaps [1=style, 2=person]
    expect(VIDEO_UNDERSTAND_EVAL_CASES[0]!.references).toHaveLength(3);
    expect(VIDEO_UNDERSTAND_EVAL_CASES[0]!.steps[0]!.message).toBe(
      '원본 영상 1번에서 2번 이미지의 미감대로 3번 이미지의 인물로 교체해서 생성',
    );
    const founderSettled = settleUnderstanding({
      reading: makeReading(),
      mode: 're_architect',
      message: VIDEO_UNDERSTAND_EVAL_CASES[0]!.steps[0]!.message,
      references: VIDEO_UNDERSTAND_EVAL_CASES[0]!.references,
      modelLimits: { minSeconds: 4, maxSeconds: 15, maxClips: 4 },
      standing: { card: EMPTY_CARD, questions: [] },
      answering: null,
    });
    expect(checkUnderstandExpectation(founderSettled, VIDEO_UNDERSTAND_EVAL_CASES[0]!.steps[0]!.expect)).toEqual([]);
  });
});
