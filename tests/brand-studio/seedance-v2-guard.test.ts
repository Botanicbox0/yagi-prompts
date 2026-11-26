/**
 * Prompt-guard proof table for BRAND_SEEDANCE_RULES_V2=on (`brand-studio.director`).
 * Proves that under `off`, `observe`, and `enforce`:
 *   1) benign switch-on prompts carrying the canonical v2 skin/film and sleeve lines pass untouched with 0 log lines;
 *   2) worst-case echo answers (full system, 60-word window, canary, reordered8, base64, notes8) are still
 *      stopped in `enforce`, returning the site's v2 fallback (or default notes on `notes8`);
 *   3) no customer marker (`QX…`) ever leaves `<customer_data>` blocks in `observe` or `enforce`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_LINE, NON_DISCLOSURE_RULE, type GuardLogLine } from '@/lib/ai-guard';
import {
  compileDirectorPrompt,
  DIRECTOR_NO_BGM_AUDIO_LINE,
  buildSeedanceDirectorSystemInstruction,
  composeDirectorFallbackPrompt,
  directorAllowV2,
  SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
  SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
  sleeveVolumeLine,
  type DirectorCompileInput,
} from '@/lib/brand-studio/director';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import { guardRequest } from '@/lib/ai-guard';
import {
  ANSWER_KINDS,
  canaryOf,
  emptyNotesFetch,
  failingSiteFetch,
  leakAnswer,
  leakingFetch,
  systemOf,
  userTextOf,
  type AnswerKind,
} from '../ai-guard/leaks';
import { BENIGN_NOTES, CUSTOMER_MARKERS, FAKE_ANALYZER, isSiteCall } from '../ai-guard/reference-cases';
import { FIXED_THUMB } from './seedance-v2-fixtures';

const BASE_ENV = { GEMINI_API_KEY: 'test-key', BRAND_SEEDANCE_RULES_V2: 'on' } as const;

interface V2GuardCase {
  id: string;
  input: DirectorCompileInput;
  benign: string;
  /** Runs `notes8` test (English notes avoid cleanNotes's Korean language check before the guard). */
  englishNotes?: boolean;
}

const V2_GUARD_CASES: readonly V2GuardCase[] = [
  {
    id: 'director-v2-person-product-editorial',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '창가 테이블에서 여자가 이미지 1 세럼 병을 들어 올리는 에디토리얼 룩북 QXPROMPT',
      references: [
        {
          index: 1,
          kind: 'image',
          label: '이미지 1',
          role: 'product',
          use: '병 모양 QXUSE',
          avoid: '배경 QXAVOID',
          thumb: { bytes: new Uint8Array(FIXED_THUMB.bytes), mime: FIXED_THUMB.mime },
        },
      ],
      brand: { name: 'QXBRANDNAME', tone: 'calm QXTONE', palette: ['#14171C', '#EAE4DC', '#3875C5'], rules: ['Keep labels QXRULE'] },
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    },
    benign: [
      'Reference authority: @Image 1 supplies only the glass serum bottle, cap, and printed label.',
      `Visual style: #14171C shadow floor, #EAE4DC travertine, #3875C5 accent; ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}.`,
      '0.0s–4.0s: 18° three-quarter framing, the woman lifts @Image 1 with a small weight shift and slow head turn. Hard cut.',
      '4.0s–8.0s: 45° close framing as a hair strand moves gently in window air.',
      'Audio: soft glass click on stone and quiet room tone.',
    ].join('\n'),
  },
  {
    id: 'director-v2-action-mv',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: 'Rain-soaked neon alley music video chase as a woman sprints past glowing glass shopfronts QXPROMPT',
      references: [],
      brand: { name: 'QXBRANDNAME', tone: 'kinetic QXTONE', palette: ['#14171C', '#242A36', '#3875C5'], rules: ['Keep contrast clean QXRULE'] },
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    },
    englishNotes: true,
    benign: [
      `Visual style: #14171C shadow floor, #242A36 wet asphalt, #3875C5 reflection; ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}.`,
      '0.0s–4.0s: low-angle Steadicam tracking from behind as she sprints past lit windows. Hard cut.',
      '4.0s–8.0s: 90° orbital arc sweeping around her as she lands in stride.',
      'Audio: rapid footsteps splashing on wet pavement and rhythmic live music.',
    ].join('\n'),
  },
  {
    id: 'director-v2-product-only',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: 'A frosted perfume bottle stands alone on limestone, product only with no person QXPROMPT',
      references: [
        {
          index: 1,
          kind: 'image',
          label: 'Image 1',
          role: 'product',
          use: 'bottle geometry QXUSE',
          avoid: 'studio table QXAVOID',
        },
      ],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    },
    englishNotes: true,
    benign: [
      'Reference authority: @Image 1 supplies only the frosted perfume bottle and cap.',
      `Visual style: #14171C shadow floor, #EAE4DC limestone, #3875C5 reflection; ${SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA}.`,
      '0.0s–4.0s: 18° table-level framing, morning light sweeps smoothly across @Image 1. Hard cut.',
      '4.0s–8.0s: 45° close framing as shadows settle cleanly across the stone.',
      'Audio: quiet room tone.',
    ].join('\n'),
  },
  {
    id: 'director-v2-person-ref',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 아이보리 울 코트를 입고 창가에서 숨을 고르는 룩북 QXPROMPT',
      references: [
        {
          index: 1,
          kind: 'image',
          label: '이미지 1',
          role: 'person',
          use: '얼굴과 헤어 QXUSE',
          avoid: '배경 QXAVOID',
          thumb: { bytes: new Uint8Array(FIXED_THUMB.bytes), mime: FIXED_THUMB.mime },
        },
      ],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'sfx' },
    },
    benign: [
      `Reference authority: @Image 1 supplies only the person's face and hair; ${sleeveVolumeLine('@Image 1')}.`,
      `Visual style: #14171C shadow floor, #E8E1D6 plaster wall, #3875C5 window reflection; ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}.`,
      '0.0s–4.0s: 18° medium framing, she wears a tailored ivory wool coat with a small weight shift and calm breath. Hard cut.',
      '4.0s–8.0s: 45° close framing with a slow head turn and a fine hair strand moving.',
      'Audio: soft wool rustle and quiet room ambience.',
    ].join('\n'),
  },
  {
    id: 'director-v2-two-refs-mode-b',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 2 인물이 이미지 1 코트 의상을 입고 대리석 복도를 걷는 장면 QXPROMPT',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '코트 의상 실루엣과 소재만 QXUSE', avoid: '배경 QXAVOID' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'person', use: '얼굴과 헤어만 QXUSE', avoid: '평상복 소매 QXAVOID' },
      ],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    },
    benign: [
      `Reference authority: @Image 2 supplies only the person's face and hair; ${sleeveVolumeLine('@Image 2')}; @Image 1 supplies wardrobe only.`,
      `Visual style: #14171C shadow floor, #DFD8CD marble, #3875C5 skylight spill; ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}.`,
      '0.0s–4.0s: 18° medium framing, she walks slowly across marble wearing @Image 1 with subtle breath. Hard cut.',
      '4.0s–8.0s: 45° close framing with a slow head turn and calm expression.',
      'Audio: soft footsteps on marble and quiet hall ambience.',
    ].join('\n'),
  },
];

let logs: GuardLogLine[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    if (first.startsWith('[prompt-guard] ')) {
      logs.push(JSON.parse(first.slice('[prompt-guard] '.length)) as GuardLogLine);
    }
  });
});

afterEach(() => {
  warnSpy.mockRestore();
});

function grams8(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + 8 <= words.length; i += 1) out.add(words.slice(i, i + 8).join(' '));
  return out;
}

async function runCase(c: V2GuardCase, mode: 'off' | 'observe' | 'enforce', fetchOf: () => { calls: Array<{ body: string }>; fetchImpl: typeof fetch }) {
  const { calls, fetchImpl } = fetchOf();
  const result = await compileDirectorPrompt(c.input, {
    fetch: fetchImpl,
    env: { ...BASE_ENV, PROMPT_GUARD: mode },
    analyzer: FAKE_ANALYZER,
  });
  const siteCall = calls.find((call) => isSiteCall(call.body));
  return {
    result,
    system: siteCall ? systemOf(siteCall.body) : '',
    body: siteCall?.body ?? '',
  };
}

describe('Switch-on director prompt guard proof table (BRAND_SEEDANCE_RULES_V2=on)', () => {
  it.each(V2_GUARD_CASES.map((c) => [c.id, c] as const))('%s: benign allowed v2 prompt passes in off, observe, and enforce with 0 logs', async (_id, c) => {
    const ref = await runCase(c, 'off', () => leakingFetch('benign', c));
    expect(ref.result.source).toBe('model');

    for (const mode of ['observe', 'enforce'] as const) {
      logs = [];
      const guarded = await runCase(c, mode, () => leakingFetch('benign', c));
      expect(guarded.result.source, mode).toBe('model');
      expect(guarded.result.prompt, mode).toBe(ref.result.prompt);
      expect(guarded.result.notes, mode).toBe(ref.result.notes);
      expect(logs, mode).toEqual([]);
    }
  });

  it.each(V2_GUARD_CASES.map((c) => [c.id, c] as const))('%s: enforce stops every worst-case echo leak and answers v2 fallback', async (_id, c) => {
    const fallback = await runCase(c, 'enforce', () => failingSiteFetch());
    const defaultNotes = await runCase(c, 'enforce', () => emptyNotesFetch(c));
    const benign = await runCase(c, 'enforce', () => leakingFetch('benign', c));
    const anyway = grams8([fallback.result.prompt, benign.result.prompt, fallback.result.notes, benign.result.notes].join('\n'));

    for (const kind of ANSWER_KINDS.filter((k): k is Exclude<AnswerKind, 'benign'> => k !== 'benign')) {
      logs = [];
      const { result, system } = await runCase(c, 'enforce', () => leakingFetch(kind, c));
      const canary = canaryOf(system);
      expect(canary).not.toBe('pgcnocanarywasinthisrequest');
      expect(`${result.prompt}\n${result.notes}`.includes(canary), kind).toBe(false);

      const internal = grams8(system);
      const leaked = [...grams8(`${result.prompt}\n${result.notes}`)].filter((g) => internal.has(g) && !anyway.has(g));
      expect(leaked, `${c.id} ${kind}`).toEqual([]);

      if (kind === 'notes8') {
        expect(result.prompt).toBe(benign.result.prompt);
        expect(result.notes).toBe(defaultNotes.result.notes);
        if (c.englishNotes) {
          expect(logs).toContainEqual(expect.objectContaining({ site: 'brand-studio.director', mode: 'enforce', action: 'fallback', field: 'notes' }));
        }
      } else {
        expect(result.source, `${c.id} ${kind}`).toBe('fallback');
        expect(result.prompt, `${c.id} ${kind}`).toBe(fallback.result.prompt);
        expect(logs, `${c.id} ${kind}`).toContainEqual(expect.objectContaining({ site: 'brand-studio.director', mode: 'enforce', action: 'fallback', field: 'prompt' }));
      }
    }
  });

  it.each(V2_GUARD_CASES.map((c) => [c.id, c] as const))('%s: observe stops canary/full and logs non-canary leaks', async (_id, c) => {
    const fallback = await runCase(c, 'observe', () => failingSiteFetch());

    logs = [];
    const canaryRun = await runCase(c, 'observe', () => leakingFetch('canary', c));
    expect(canaryRun.result.source).toBe('fallback');
    expect(canaryRun.result.prompt).toBe(fallback.result.prompt);
    expect(logs).toContainEqual(expect.objectContaining({ site: 'brand-studio.director', mode: 'observe', action: 'fallback', reason: 'canary' }));

    logs = [];
    const win60 = await runCase(c, 'observe', () => leakingFetch('window60', c));
    expect(win60.result.source).toBe('model');
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) {
      expect(line).toMatchObject({ site: 'brand-studio.director', mode: 'observe', action: 'observed' });
    }
  });

  it.each(V2_GUARD_CASES.map((c) => [c.id, c] as const))('%s: customer QX markers never leak into system part in observe or enforce', async (_id, c) => {
    for (const mode of ['observe', 'enforce'] as const) {
      const { system, body } = await runCase(c, mode, () => leakingFetch('benign', c));
      expect(system.endsWith(NON_DISCLOSURE_RULE), mode).toBe(true);
      const markersPresent = CUSTOMER_MARKERS.filter((m) => body.includes(m));
      expect(markersPresent.length).toBeGreaterThan(0);
      for (const marker of CUSTOMER_MARKERS) expect(system, marker).not.toContain(marker);

      const texts = userTextOf(body);
      expect(texts[0]).toBe(DATA_LINE);
      const outsideBlocks = texts
        .slice(1)
        .map((t) => t.replace(/<customer_data name="[^"]*">[\s\S]*?<\/customer_data>/g, ''))
        .join('\n');
      for (const marker of CUSTOMER_MARKERS) expect(outsideBlocks, marker).not.toContain(marker);
    }
  });
});

describe('Switch-on enhancer clip-revision guard proof (BRAND_SEEDANCE_RULES_V2=on)', () => {
  const revisionInput: EnhanceInput = {
    kind: 'video_remix',
    profile: 'seedance',
    model: 'seedance-2.5',
    locale: 'ko',
    prompt: '이미지 2 인물의 표정은 그대로 두고 병 색만 파랗게 바꿔 줘 QXPROMPT',
    references: [
      { index: 1, kind: 'video', label: '영상 1' },
      { index: 2, kind: 'image', label: '이미지 1', role: 'product', use: '라벨 QXUSE', avoid: '배경 QXAVOID' },
      { index: 3, kind: 'image', label: '이미지 2', role: 'person', use: '얼굴과 헤어 QXUSE', avoid: '평상복 소매 QXAVOID' },
    ],
    brand: { name: 'QXBRANDNAME', tone: 'calm QXTONE', palette: ['#14171C', '#E6DFD5', '#3875C5'], rules: ['Keep face natural QXRULE'] },
    video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
    revision: {
      mode: 'edit',
      version: 3,
      madeWith: 'Reference authority: @Image2 holds identity.\nVisual style: #14171C shadow floor, #E6DFD5 stone.\n0.0s–6.0s: 18° medium shot, a woman lifts the ceramic bottle beside a bright window.\nAudio: soft room tone.',
      history: ['배경을 밝은 석재로'],
    },
  };

  const revisionGuardCase: V2GuardCase = {
    id: 'enhancer-v2-clip-revision-edit',
    input: revisionInput,
    benign: [
      `In @Video1, change only the bottle to cobalt blue and apply ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA} with ignore any wide casual top/sleeve volume from @Image2; everything else stays as it is.`,
      'Audio: soft room tone.',
    ].join('\n'),
  };

  it('guard.system equals the sent SEEDANCE_PROFILE_V2 text and benign output passes off/observe/enforce with 0 logs', async () => {
    const runEnhancer = async (mode: 'off' | 'observe' | 'enforce', kind: AnswerKind) => {
      const { calls, fetchImpl } = leakingFetch(kind, revisionGuardCase);
      const result = await enhancePrompt(revisionInput, {
        fetch: fetchImpl,
        env: { ...BASE_ENV, PROMPT_GUARD: mode },
      });
      const siteCall = calls.find((call) => isSiteCall(call.body));
      return { result, system: siteCall ? systemOf(siteCall.body) : '', body: siteCall?.body ?? '' };
    };

    const ref = await runEnhancer('off', 'benign');
    expect(ref.result.source).toBe('model');
    expect(ref.result.meta?.profileVersion).toBe('seedance@2026-11-27.1');
    expect(ref.system).toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);

    for (const mode of ['observe', 'enforce'] as const) {
      logs = [];
      const guarded = await runEnhancer(mode, 'benign');
      expect(guarded.result.source, mode).toBe('model');
      expect(guarded.result.prompt, mode).toBe(ref.result.prompt);
      expect(guarded.result.meta?.profileVersion, mode).toBe('seedance@2026-11-27.1');
      expect(guarded.system, mode).toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
      expect(logs, mode).toEqual([]);
    }

    const fallbackRun = await enhancePrompt(revisionInput, {
      fetch: failingSiteFetch().fetchImpl,
      env: { ...BASE_ENV, PROMPT_GUARD: 'enforce' },
    });
    expect(fallbackRun.source).toBe('fallback');
    expect(fallbackRun.meta?.profileVersion).toBe('seedance@2026-11-27.1');
    expect(fallbackRun.prompt).toContain("supplies only the person's face and hair");
    expect(fallbackRun.prompt).toContain(sleeveVolumeLine('@Image 2'));
    expect(fallbackRun.prompt).not.toMatch(/\bbuild\b/i);

    const anyway = grams8([fallbackRun.prompt, ref.result.prompt, fallbackRun.notes, ref.result.notes].join('\n'));
    let guardStoppedCount = 0;

    for (const kind of ANSWER_KINDS.filter((k): k is Exclude<AnswerKind, 'benign'> => k !== 'benign')) {
      const offRun = await runEnhancer('off', kind);
      logs = [];
      const leakRun = await runEnhancer('enforce', kind);
      const canary = canaryOf(leakRun.system);
      expect(canary).not.toBe('pgcnocanarywasinthisrequest');
      expect(`${leakRun.result.prompt}\n${leakRun.result.notes}`.includes(canary), kind).toBe(false);
      const internal = grams8(leakRun.system);
      const leaked = [...grams8(`${leakRun.result.prompt}\n${leakRun.result.notes}`)].filter((g) => internal.has(g) && !anyway.has(g));
      expect(leaked, kind).toEqual([]);
      if (kind !== 'notes8') {
        expect(leakRun.result.source, kind).toBe('fallback');
        expect(leakRun.result.prompt, kind).toBe(fallbackRun.prompt);
        if (offRun.result.source === 'model') {
          guardStoppedCount += 1;
          expect(logs, kind).toContainEqual(expect.objectContaining({ site: 'brand-studio.enhancer', mode: 'enforce', action: 'fallback', field: 'prompt' }));
        }
      }
    }
    expect(guardStoppedCount).toBeGreaterThanOrEqual(4);

    const obs = await runEnhancer('observe', 'benign');
    for (const marker of CUSTOMER_MARKERS) expect(obs.system, marker).not.toContain(marker);
    const outsideBlocks = userTextOf(obs.body)
      .slice(1)
      .map((t) => t.replace(/<customer_data name="[^"]*">[\s\S]*?<\/customer_data>/g, ''))
      .join('\n');
    for (const marker of CUSTOMER_MARKERS) expect(outsideBlocks, marker).not.toContain(marker);
  });
});

describe('Allow-list formula entry is position-independent (formula placed FIRST in system text)', () => {
  const POSITION_CASES = [
    V2_GUARD_CASES[0]!, // director-v2-person-product-editorial (person formula)
    V2_GUARD_CASES[2]!, // director-v2-product-only (product film-exposure formula)
  ] as const;

  it.each(POSITION_CASES.map((c) => [c.id, c] as const))(
    '%s: passes benign output in observe/enforce and still refuses echo leaks when formula is FIRST at index 0',
    async (_id, c) => {
      const hasPerson = c.id !== 'director-v2-product-only';
      const formula = hasPerson ? SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA : SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA;
      const binding = bindReferences({
        kind: c.input.kind,
        profile: c.input.profile,
        references: c.input.references,
      });

      const baseSys = buildSeedanceDirectorSystemInstruction({
        intent: 'slot_fill',
        seconds: c.input.video?.seconds ?? 8,
        blueprint: false,
        audioMode: c.input.video?.audio ?? 'on',
        explicitMusic: false,
        hasImageRefs: binding.bound.some((b) => b.token && b.ref.kind === 'image'),
        hasVideoRef: false,
        rulesV2: true,
        hasPerson,
        personTokens: [],
        hasSeparateGarmentRef: false,
      });
      // Test-only arrangement: strip any quoted copy of the formula from the body and put the bare formula FIRST.
      const strippedBody = baseSys.replaceAll(`"${formula}"`, '[formula applied above]');
      const formulaFirstInternal = `${formula}\n${strippedBody}`;
      expect(formulaFirstInternal.startsWith(formula)).toBe(true);

      const exempt = [
        c.input.prompt,
        c.input.video?.change ?? '',
        c.input.brand?.name ?? '',
        c.input.brand?.tone ?? '',
        ...(c.input.brand?.rules ?? []),
      ];

      for (const mode of ['observe', 'enforce'] as const) {
        logs = [];
        const env = { ...BASE_ENV, PROMPT_GUARD: mode };
        const guard = guardRequest({ site: 'brand-studio.director', env, internal: formulaFirstInternal });
        const allow = directorAllowV2(
          c.input,
          binding,
          guard.system,
          null,
          [],
          composeDirectorFallbackPrompt,
          DIRECTOR_NO_BGM_AUDIO_LINE,
          env,
        );
        const benignVerdict = guard.check(
          { prompt: c.benign, notes: BENIGN_NOTES },
          { exempt, allow, shapes: { prompt: { noMarkup: true }, notes: { maxChars: 160, oneSentence: true } } },
        );
        expect(benignVerdict.blocked, mode).toEqual([]);
        expect(logs, mode).toEqual([]);
      }

      const enforceEnv = { ...BASE_ENV, PROMPT_GUARD: 'enforce' as const };
      const enforceGuard = guardRequest({ site: 'brand-studio.director', env: enforceEnv, internal: formulaFirstInternal });
      const enforceAllow = directorAllowV2(
        c.input,
        binding,
        enforceGuard.system,
        null,
        [],
        composeDirectorFallbackPrompt,
        DIRECTOR_NO_BGM_AUDIO_LINE,
        enforceEnv,
      );
      const sysWords = enforceGuard.system.split(/\s+/).filter(Boolean);
      const prefixOverlapPrompt = `${c.benign}\n${sysWords.slice(0, 80).join(' ')}`;
      const prefixVerdict = enforceGuard.check(
        { prompt: prefixOverlapPrompt, notes: BENIGN_NOTES },
        { exempt, allow: enforceAllow, shapes: { prompt: { noMarkup: true }, notes: { maxChars: 160, oneSentence: true } } },
      );
      expect(prefixVerdict.blocked).toContain('prompt');

      for (const kind of ANSWER_KINDS.filter((k): k is Exclude<AnswerKind, 'benign'> => k !== 'benign')) {
        const leakedFields = leakAnswer(kind, enforceGuard.system, c.benign);
        const v = enforceGuard.check(leakedFields, {
          exempt,
          allow: enforceAllow,
          shapes: { prompt: { noMarkup: true }, notes: { maxChars: 160, oneSentence: true } },
        });
        expect(v.blocked, `${c.id} ${kind}`).toContain(kind === 'notes8' ? 'notes' : 'prompt');
      }
    },
  );
});
