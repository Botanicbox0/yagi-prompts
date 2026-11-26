import { describe, expect, it, vi } from 'vitest';
import {
  buildSeedanceDirectorSystemInstruction,
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
  directorRulesVersion,
  guessDirectorCameraGenre,
  hasPersonInDirectorScene,
  scrubSeedanceAntiPatterns,
  scrubSeedanceAntiPatternsV2,
  SEEDANCE_25_PROMPT_CHARS,
  SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA,
  SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA,
  sleeveVolumeLine,
} from '@/lib/brand-studio/director';
import { composeFallbackPrompt, enhanceMeta, enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { referenceClause } from '@/lib/brand-studio/enhancer/lines';
import { buildSystemInstruction, PROFILE_BLOCKS, PROFILE_HEADERS, profileVersionOf } from '@/lib/brand-studio/enhancer/profiles';
import {
  SEEDANCE_HEADER,
  SEEDANCE_HEADER_V1,
  SEEDANCE_HEADER_V2,
  SEEDANCE_PROFILE,
  SEEDANCE_PROFILE_V2,
  seedanceHeader,
  seedanceProfile,
  seedanceProfileVersion,
} from '@/lib/brand-studio/enhancer/profiles/seedance';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import { tidyPrompt } from '@/lib/brand-studio/enhancer/schema';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import type { JobRow } from '@/lib/brand-studio/types';
import { brandSeedanceRulesV2Open } from '@/lib/flags';
import {
  CLIP_REVISION_ENHANCER_PARITY_INPUT,
  FIXED_ANALYZER,
  REVISION_ENHANCER_FALLBACK_EDIT_INPUT,
  SEEDANCE_PARITY_CASES,
  type SeedanceParityCase,
} from './seedance-v2-fixtures';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf } from './server/helpers';

const ENV_V2 = { GEMINI_API_KEY: 'test-key', BRAND_SEEDANCE_RULES_V2: 'on' } as const;
const ENV_V2_ONLY = { BRAND_SEEDANCE_RULES_V2: 'on' } as const;

const BANNED_GLOSSY_RE = /\b(?:porcelain|glass[- ]skin|dewy|flawless|poreless)\b/i;
const TIGHT_CROP_RE = /tight head-and-neck|head-and-neck crop|head & neck only/i;
const THREE_PANEL_RE = /3-panel|three-panel|turnaround sheet|character turnaround/i;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    count += 1;
    idx = found + needle.length;
  }
  return count;
}

function captureV2(c: SeedanceParityCase) {
  const requests: Array<{ systemText: string; userTexts: string[] }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body ?? '{}')) as {
      systemInstruction?: { parts?: Array<{ text?: string }> };
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };
    const systemText = (parsed.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('');
    const userTexts = (parsed.contents ?? []).flatMap((item) =>
      (item.parts ?? []).map((p) => p.text).filter((t): t is string => typeof t === 'string'),
    );
    requests.push({ systemText, userTexts });
    if (c.failModel) return new Response('server down', { status: 500 });
    return new Response(
      JSON.stringify({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(c.mockAnswer) }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe('BRAND_SEEDANCE_RULES_V2 flag & version bump', () => {
  it('is strictly off unless env.BRAND_SEEDANCE_RULES_V2 === "on"', () => {
    expect(brandSeedanceRulesV2Open({})).toBe(false);
    expect(brandSeedanceRulesV2Open({ BRAND_SEEDANCE_RULES_V2: '' })).toBe(false);
    expect(brandSeedanceRulesV2Open({ BRAND_SEEDANCE_RULES_V2: 'off' })).toBe(false);
    expect(brandSeedanceRulesV2Open({ BRAND_SEEDANCE_RULES_V2: 'true' })).toBe(false);
    expect(brandSeedanceRulesV2Open({ BRAND_SEEDANCE_RULES_V2: '1' })).toBe(false);
    expect(brandSeedanceRulesV2Open({ BRAND_SEEDANCE_RULES_V2: 'on' })).toBe(true);
  });

  it('keeps SEEDANCE_HEADER as plain V1 constant (no getters) while seedanceHeader/profileVersionOf switch explicitly on env', () => {
    expect(SEEDANCE_HEADER_V1).toBe(SEEDANCE_HEADER);
    expect(SEEDANCE_HEADER.version).toBe('2026-11-15.1');
    expect(SEEDANCE_HEADER_V2.version).not.toBe(SEEDANCE_HEADER.version);
    expect(SEEDANCE_HEADER_V2.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    for (const prop of ['version', 'sources', 'lastVerified'] as const) {
      expect(Object.getOwnPropertyDescriptor(SEEDANCE_HEADER, prop)?.get).toBeUndefined();
    }

    expect(seedanceHeader({}).version).toBe(SEEDANCE_HEADER.version);
    expect(seedanceHeader(ENV_V2_ONLY).version).toBe(SEEDANCE_HEADER_V2.version);
    expect(seedanceProfileVersion({})).toBe(`seedance@${SEEDANCE_HEADER.version}`);
    expect(seedanceProfileVersion(ENV_V2_ONLY)).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);

    expect(directorRulesVersion({})).toBe('2026-11-15.1');
    expect(directorRulesVersion(ENV_V2_ONLY)).not.toBe(directorRulesVersion({}));

    const prev = process.env.BRAND_SEEDANCE_RULES_V2;
    try {
      delete process.env.BRAND_SEEDANCE_RULES_V2;
      expect(SEEDANCE_HEADER.version).toBe('2026-11-15.1');
      expect(PROFILE_HEADERS.seedance).toBe(SEEDANCE_HEADER);
      expect(PROFILE_BLOCKS.seedance).toBe(SEEDANCE_PROFILE);
      expect(profileVersionOf('seedance', 'seedance-2.5')).toBe(`seedance@${SEEDANCE_HEADER.version}`);
      expect(seedanceProfile()).toBe(SEEDANCE_PROFILE);

      process.env.BRAND_SEEDANCE_RULES_V2 = 'on';
      // Static exports stay plain V1 constants (no process.env getters); explicit helpers follow process.env by default
      // and let per-call env win when provided.
      expect(SEEDANCE_HEADER.version).toBe('2026-11-15.1');
      expect(PROFILE_HEADERS.seedance).toBe(SEEDANCE_HEADER);
      expect(PROFILE_BLOCKS.seedance).toBe(SEEDANCE_PROFILE);
      expect(profileVersionOf('seedance', 'seedance-2.5')).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);
      expect(profileVersionOf('seedance', 'seedance-2.5', {})).toBe(`seedance@${SEEDANCE_HEADER.version}`);
      expect(seedanceProfile()).toBe(SEEDANCE_PROFILE_V2);
      expect(seedanceProfile({})).toBe(SEEDANCE_PROFILE);
    } finally {
      if (prev === undefined) delete process.env.BRAND_SEEDANCE_RULES_V2;
      else process.env.BRAND_SEEDANCE_RULES_V2 = prev;
    }
  });

  it('prepareJob records the bumped profileVersion on work.enhancer when BRAND_SEEDANCE_RULES_V2=on', async () => {
    const f = await studioFixture();
    try {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        prompt: [
                          `Visual style: #14171C shadow floor, #E6DFD5 marble; ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}.`,
                          '0.0s–6.0s: 18° medium framing, a woman lifts the ceramic bottle with a small weight shift and breath.',
                          'Audio: soft room tone.',
                        ].join('\n'),
                        notes: '조명과 피부 표현을 다듬었어요.',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      const deps = studioDeps(f.sql, {
        intelDeps: { fetch: fetchMock as unknown as typeof fetch, env: ENV_V2 },
        intel: {
          ...studioDeps(f.sql).intel,
          enhancePrompt: (input, intelDeps) => compileDirectorPrompt(input, intelDeps),
          composeFallbackPrompt: (input) => composeDirectorFallbackPrompt(input, { env: ENV_V2 }),
        },
      });
      const refId = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'person', width: 900, height: 1200 });
      const made = await createStudioJob(deps, viewerOf(f.ids.owner), {
        kind: 'video',
        organizationId: f.orgId,
        requestId: requestId(),
        model: 'seedance-2.5',
        prompt: '이미지 1 모델이 세럼 병을 들어 올리는 에디토리얼 룩북',
        references: [{ assetId: refId, role: 'person' }],
        aspect: '9:16',
        seconds: 6,
        audio: 'ambient',
        resolution: 'draft',
        enhance: true,
      });
      if (!made.ok) throw new Error(JSON.stringify(made));
      const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
      const prepared = await prepareJob(deps, job);
      expect(prepared.work.enhancer?.profileVersion).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);
    } finally {
      await f.db.close();
    }
  });
});

describe('Rule 1: canonical video skin & exposure formula + scrubbers', () => {
  it('defines the exact formula and its product-only film/exposure prefix split at "; skin stays"', () => {
    expect(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA).toBe(
      'looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under; skin stays natural and warm, unretouched matte-satin with visible micro-pores and fine stray flyaway hairs, never over-lit or glossy, with no blush',
    );
    expect(SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA).toBe(
      'looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under',
    );
    expect(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA.startsWith(`${SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA}; skin stays`)).toBe(true);
    expect(SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA).not.toMatch(/skin|micro-pores|flyaway|blush/i);
  });

  it('survives tidyPrompt, scrubSeedanceAntiPatterns, and scrubSeedanceAntiPatternsV2 completely unchanged', () => {
    for (const sentence of [SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA, SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA]) {
      const wrapped = `Visual style: #14171C shadow floor, #E6DFD5 linen; ${sentence}.`;
      expect(tidyPrompt(wrapped, '')).toBe(wrapped);
      expect(scrubSeedanceAntiPatterns(wrapped, '')).toBe(wrapped);
      expect(scrubSeedanceAntiPatternsV2(wrapped, '')).toBe(wrapped);
    }
  });

  it('scrubSeedanceAntiPatternsV2 removes banned glossy skin tokens while keeping customer-exempt nouns intact', () => {
    const dirty = [
      'Visual style: porcelain skin, poreless porcelain glass-skin, dewy highlighter glow, dewy sheen, and flawless skin.',
      'Exclusions: no porcelain, no glass skin, no dewy glow, never flawless.',
    ].join('\n');
    const scrubbed = scrubSeedanceAntiPatternsV2(dirty, '');
    expect(scrubbed).not.toMatch(BANNED_GLOSSY_RE);
    expect(scrubbed).not.toMatch(/\bno\s+natural unretouched matte-satin skin\b/i);

    // Exempt customer noun (e.g. a real porcelain teacup) stays intact while unexempt "glass-skin" is stripped.
    const withExempt = 'A porcelain teacup sits on marble; skin shows glass-skin glare and flawless finish.';
    const exemptScrubbed = scrubSeedanceAntiPatternsV2(withExempt, 'A porcelain teacup on marble');
    expect(exemptScrubbed).toContain('porcelain teacup');
    expect(exemptScrubbed).not.toMatch(/glass-skin|flawless/i);
  });

  it('compileDirectorPrompt with switch on scrubs glossy tokens returned by the model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      prompt: [
                        `Visual style: #14171C shadow floor; ${SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA}; porcelain skin and dewy highlighter glow and flawless finish.`,
                        '0.0s–6.0s: 18° medium shot, she turns calmly.',
                        'Audio: quiet room tone.',
                      ].join('\n'),
                      notes: '화면을 정리했어요.',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const out = await compileDirectorPrompt(SEEDANCE_PARITY_CASES[0]!.input, {
      fetch: fetchMock as unknown as typeof fetch,
      env: ENV_V2,
      analyzer: FIXED_ANALYZER,
    });
    expect(out.source).toBe('model');
    expect(out.prompt).not.toMatch(BANNED_GLOSSY_RE);
    expect(out.prompt).toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
  });
});

describe('Rule 2: referenceClause video-only gate (switch on vs still paths)', () => {
  const person1 = {
    ref: { index: 1, kind: 'image' as const, label: '이미지 1', role: 'person' as const, use: '얼굴 유지', avoid: '배경' },
    position: 1,
    ordinal: 1,
    token: '@Image1',
    name: 'the reference picture',
  };
  const person2 = { ...person1, ref: { ...person1.ref, index: 2, label: '이미지 2' }, position: 2, ordinal: 2, token: '@Image2' };

  it('replaces "build" and adds single sleeve-volume clause on Seedance video path with right image index', () => {
    const offLine = referenceClause('seedance', person1, {});
    expect(offLine).toContain('face, hair and build');
    expect(offLine).not.toContain('sleeve volume');

    const onLine1 = referenceClause('seedance', person1, ENV_V2_ONLY);
    expect(onLine1).not.toMatch(/\bbuild\b/i);
    expect(onLine1).toContain("face and hair");
    expect(onLine1).toContain(sleeveVolumeLine('@Image 1'));

    const onLine2 = referenceClause('seedance', person2, ENV_V2_ONLY);
    expect(onLine2).not.toMatch(/\bbuild\b/i);
    expect(onLine2).toContain(sleeveVolumeLine('@Image 2'));
    expect(onLine2).not.toContain('@Image 1');
  });

  it('leaves still-image profiles byte-identical regardless of switch', () => {
    for (const profile of ['seedream', 'nano-banana', 'gpt-image'] as const) {
      const token = profile === 'seedream' ? 'Image 1' : 'image 1';
      const off = referenceClause(profile, { ...person1, token }, {});
      const on = referenceClause(profile, { ...person1, token }, ENV_V2_ONLY);
      expect(on, profile).toBe(off);
      expect(on, profile).toContain('face, hair and build');
      expect(on, profile).not.toContain('sleeve volume');
    }
  });
});

describe('Rule 4: deterministic camera genre guess (Korean + English)', () => {
  it('classifies at least six clearly dynamic Korean and English briefs as dynamic', () => {
    for (const text of [
      'Rain-soaked neon alley chase scene as a runner sprints past glowing storefronts',
      'High-energy music video sequence with Steadicam tracking and 90-degree orbital arc',
      'Action sequence with sword combat and stunt leap across wet rooftops',
      '비 오는 밤 네온 골목길 추격전 액션 씬, 전력 질주하는 주인공',
      '화려한 아이돌 무대 퍼포먼스 뮤직비디오, 스테디캠 트래킹 샷',
      '판타지 성곽 위 와이어 액션 전투 장면, 카메라 크레인 상승 컷',
      'Live dance performance in a concert arena with handheld FPV push-in',
    ]) {
      expect(guessDirectorCameraGenre(text), text).toBe('dynamic');
    }
  });

  it('classifies ordinary Korean and English marketing briefs (and mixed editorial + dynamic keywords) as editorial', () => {
    for (const text of [
      'Clear call to action skincare serum reel on travertine stone',
      'Watch the ceramic tumbler in action on a calm studio desk',
      'Botanical scent drift rising gently above a frosted perfume bottle',
      'Folded origami paper crane beside a matte hand cream tube on linen',
      'Minimalist watch resting near a quiet harbour crane at dawn',
      'Fashion campaign film showing trail sneakers in action beside sunlit steps',
      'Beauty lookbook portrait with no crane shot or jarring whips',
      '퍼포먼스 마케팅용 수분크림 신제품 소개 릴스',
      '블랙 와이어리스 이어폰이 대리석 테이블 위에 놓인 정물 컷',
      '고객 리액션이 좋은 비타민 앰플 론칭 화보 영상',
      '종이 크레인 오브제와 함께 놓인 니치 향수 캠페인',
      '고퍼포먼스 선크림과 스포츠웨어 룩북, 이전 시즌과 달리 고요한 빛',
      '창가 테이블에서 여자가 세럼 병을 들어 올리는 패션 에디토리얼 룩북',
      '에디토리얼 화보 속 역동적인 액션 영화 콘셉트 포즈지만 차분한 정물 시선',
    ]) {
      expect(guessDirectorCameraGenre(text), text).toBe('editorial');
    }
  });

  it('allows only strong editorial words to override moving-camera cues while weak hints (campaign, fashion, beauty, portrait) do not', () => {
    for (const text of [
      '뮤직비디오 캠페인',
      'action film campaign',
      '패션 브랜드 뮤직비디오',
      'beauty brand fantasy short film',
      '뷰티 캠페인 액션 시퀀스',
    ]) {
      expect(guessDirectorCameraGenre(text), text).toBe('dynamic');
    }

    for (const text of [
      '패션 에디토리얼 캠페인',
      '룩북 캠페인',
      '뷰티 화보',
      'fashion campaign',
      '캠페인 영상',
      '액션 느낌의 룩북',
      'action sequence lookbook',
    ]) {
      expect(guessDirectorCameraGenre(text), text).toBe('editorial');
    }
  });
});

describe('Switch-on behavior across all 8 fixed fixtures', () => {
  it('person scenes include exact formula once; product-only scene includes film/exposure half without skin clause', () => {
    for (const c of SEEDANCE_PARITY_CASES) {
      if (c.input.revision) continue;
      const fb = composeDirectorFallbackPrompt(c.input, { env: ENV_V2 }).prompt;
      const isPerson = hasPersonInDirectorScene(c.input, null);
      if (c.id === '03-product-only-no-person') {
        expect(isPerson).toBe(false);
        expect(countOccurrences(fb, SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA)).toBe(1);
        expect(fb).not.toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
        expect(fb).not.toMatch(/skin stays|micro-pores|flyaway|blush|eyeline/i);
      } else {
        expect(isPerson, c.id).toBe(true);
        expect(countOccurrences(fb, SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA), c.id).toBe(1);
      }
      expect(fb, c.id).not.toMatch(BANNED_GLOSSY_RE);
      expect(fb, c.id).not.toMatch(TIGHT_CROP_RE);
      expect(fb, c.id).not.toMatch(THREE_PANEL_RE);
      expect(fb.length, c.id).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
    }
  });

  it('attaches sleeve line once with exact person image index, removes "build", and reflects Mode B garment authority', () => {
    const fb01 = composeDirectorFallbackPrompt(SEEDANCE_PARITY_CASES[0]!.input, { env: ENV_V2 }).prompt;
    expect(fb01).not.toContain('sleeve volume');
    expect(fb01).not.toMatch(/\bbuild\b/i);

    const fb04 = composeDirectorFallbackPrompt(SEEDANCE_PARITY_CASES[3]!.input, { env: ENV_V2 }).prompt;
    expect(countOccurrences(fb04, sleeveVolumeLine('@Image 1'))).toBe(1);
    expect(fb04).not.toMatch(/\bbuild\b/i);

    const fb05 = composeDirectorFallbackPrompt(SEEDANCE_PARITY_CASES[4]!.input, { env: ENV_V2 }).prompt;
    expect(countOccurrences(fb05, sleeveVolumeLine('@Image 2'))).toBe(1);
    expect(fb05).not.toContain(sleeveVolumeLine('@Image 1'));
    expect(fb05).toMatch(/@Image 1 supplies wardrobe only/i);
    expect(fb05).not.toMatch(/\bbuild\b/i);

    const fb07 = composeDirectorFallbackPrompt(SEEDANCE_PARITY_CASES[6]!.input, { env: ENV_V2 }).prompt;
    expect(countOccurrences(fb07, sleeveVolumeLine('@Image 1'))).toBe(1);
    expect(fb07).not.toMatch(/\bbuild\b/i);
  });

  it('removes per-shot off-axis eyeline and slender boilerplate from every timeline shot', () => {
    for (const c of SEEDANCE_PARITY_CASES) {
      if (c.input.revision) continue;
      const fb = composeDirectorFallbackPrompt(c.input, { env: ENV_V2 }).prompt;
      const shotLines = fb.split('\n').filter((l) => /^\s*\d+(?:\.\d+)?s\s*[–—-]/.test(l));
      expect(shotLines.length, c.id).toBeGreaterThan(0);
      for (const shot of shotLines) {
        expect(shot, `${c.id}: ${shot}`).not.toMatch(/eyeline/i);
        expect(shot, `${c.id}: ${shot}`).not.toMatch(/runway|slender|petite|toned arms|delicate collarbones/i);
      }
    }
  });

  it('uses distinct camera vocabulary between dynamic action/MV and editorial lookbook fixtures', () => {
    const actionFb = composeDirectorFallbackPrompt(SEEDANCE_PARITY_CASES[1]!.input, { env: ENV_V2 }).prompt;
    const editorialFb = composeDirectorFallbackPrompt(SEEDANCE_PARITY_CASES[0]!.input, { env: ENV_V2 }).prompt;

    expect(actionFb).toMatch(/tracking|crane|orbit|FPV|push-in/i);
    expect(actionFb).not.toMatch(/locked-off/i);

    expect(editorialFb).toMatch(/weight shift|head turn|breath|hair strand/i);
    expect(editorialFb).not.toMatch(/\b(?:crane|FPV|locked-off hold)\b/i);
  });

  it('director system prompts under switch on carry exact v2 rules, zero @Image 1 on no-ref runs, and zero banned tokens', async () => {
    for (const c of SEEDANCE_PARITY_CASES) {
      const { requests, fetchImpl } = captureV2(c);
      const compiled = await compileDirectorPrompt(c.input, {
        fetch: fetchImpl,
        env: ENV_V2,
        analyzer: FIXED_ANALYZER,
      });
      expect(compiled.prompt.length, c.id).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
      expect(requests).toHaveLength(1);
      const sys = requests[0]!.systemText;

      if (c.input.revision) {
        expect(sys, c.id).toContain(SEEDANCE_PROFILE_V2);
        expect(sys, c.id).not.toContain(SEEDANCE_PROFILE);
        expect(compiled.meta?.profileVersion).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);
      } else {
        expect(sys, c.id).toMatch(/Steadicam tracking/i);
        expect(sys, c.id).toMatch(/weight shift, slow head turn, breath, a hair strand moving/i);
        if (c.input.references.length === 0) {
          expect(sys, c.id).not.toContain('@Image 1');
        }
        if (c.id === '05-two-references') {
          expect(sys).toContain(sleeveVolumeLine('@Image 2'));
        }
      }

      expect(sys, c.id).not.toMatch(BANNED_GLOSSY_RE);
      expect(sys, c.id).not.toMatch(TIGHT_CROP_RE);
      expect(sys, c.id).not.toMatch(THREE_PANEL_RE);

      if (c.id === '03-product-only-no-person') {
        expect(sys).toContain(SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA);
        expect(sys).not.toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
      } else {
        expect(sys, c.id).toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
      }
    }

    // Also verify buildSeedanceDirectorSystemInstruction(rulesV2: true) never leaks @Image 1 when hasImageRefs is false.
    const noRefSys = buildSeedanceDirectorSystemInstruction({
      intent: 'expand',
      seconds: 6,
      blueprint: false,
      audioMode: 'on',
      explicitMusic: false,
      hasImageRefs: false,
      hasVideoRef: false,
      rulesV2: true,
      hasPerson: true,
    });
    expect(noRefSys).not.toContain('@Image 1');
  });

  it('caps extreme >15,000-character briefs cleanly at <= 15,000 characters in fallback without dropping structure', () => {
    const hugePrompt = 'An editorial model walks slowly through a quiet limestone courtyard holding a ceramic bottle. '.repeat(220);
    expect(hugePrompt.length).toBeGreaterThan(18_000);
    const out = composeDirectorFallbackPrompt(
      {
        ...SEEDANCE_PARITY_CASES[7]!.input,
        prompt: hugePrompt,
      },
      { env: ENV_V2 },
    );
    expect(out.prompt.length).toBeLessThanOrEqual(SEEDANCE_25_PROMPT_CHARS);
    expect(out.prompt).toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
    expect(out.prompt).toContain('Audio:');
  });

  it('SEEDANCE_PROFILE_V2 aligns with all v2 video rules and drops locked-off default and glossy buzzwords', () => {
    expect(SEEDANCE_PROFILE_V2).toContain(SEEDANCE_VIDEO_SKIN_EXPOSURE_FORMULA);
    expect(SEEDANCE_PROFILE_V2).toContain(SEEDANCE_VIDEO_FILM_EXPOSURE_FORMULA);
    expect(SEEDANCE_PROFILE_V2).toContain('ignore any wide casual top/sleeve volume from @Image 1');
    expect(SEEDANCE_PROFILE_V2).toContain('Steadicam tracking');
    expect(SEEDANCE_PROFILE_V2).toContain('weight shift, slow head turn, breath, a hair strand moving');
    expect(SEEDANCE_PROFILE_V2).not.toMatch(BANNED_GLOSSY_RE);
    expect(SEEDANCE_PROFILE_V2).not.toMatch(TIGHT_CROP_RE);
    expect(SEEDANCE_PROFILE_V2).not.toMatch(THREE_PANEL_RE);
    expect(SEEDANCE_PROFILE_V2).not.toMatch(/face, hair and build/i);
    expect(SEEDANCE_PROFILE_V2).not.toContain('locked-off');
  });
});

describe('Fix Round 1: Seedance clip revision env plumbing & non-Seedance invariance', () => {
  it('switches Seedance revision system text, fallback reference lines, and profileVersion on per-call deps.env or process.env default', async () => {
    const revInput = CLIP_REVISION_ENHANCER_PARITY_INPUT;
    const systems: Record<string, string> = {};
    const makeFetch = (tag: string, fail = false) =>
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as {
          systemInstruction?: { parts?: Array<{ text?: string }> };
        };
        systems[tag] = (parsed.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('');
        if (fail) return new Response('down', { status: 500 });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        prompt: 'In @Video1, change only the bottle to deep blue; everything else stays as it is.\nAudio: soft room tone.',
                        notes: '병 색만 바꿨어요.',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

    const offRes = await enhancePrompt(revInput, { fetch: makeFetch('off'), env: { GEMINI_API_KEY: 'test-key' } });
    const onRes = await enhancePrompt(revInput, { fetch: makeFetch('on'), env: ENV_V2 });
    expect(systems.off).toContain(SEEDANCE_PROFILE);
    expect(systems.off).not.toContain(SEEDANCE_PROFILE_V2);
    expect(offRes.meta?.profileVersion).toBe('seedance@2026-11-15.1');

    expect(systems.on).toContain(SEEDANCE_PROFILE_V2);
    expect(systems.on).not.toContain(SEEDANCE_PROFILE);
    expect(onRes.meta?.profileVersion).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);

    // Fallback path inside enhancePrompt and composeFallbackPrompt / composeDirectorFallbackPrompt
    const fbOn = await enhancePrompt(REVISION_ENHANCER_FALLBACK_EDIT_INPUT, {
      fetch: makeFetch('fbOn', true),
      env: ENV_V2,
    });
    expect(fbOn.source).toBe('fallback');
    expect(fbOn.meta?.profileVersion).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);
    expect(fbOn.prompt).toContain("supplies only the person's face and hair");
    expect(fbOn.prompt).toContain(sleeveVolumeLine('@Image 1'));
    expect(fbOn.prompt).not.toMatch(/\bbuild\b/i);

    const dirFbOn = composeDirectorFallbackPrompt(REVISION_ENHANCER_FALLBACK_EDIT_INPUT, { env: ENV_V2 });
    expect(dirFbOn.meta?.profileVersion).toBe(`seedance@${SEEDANCE_HEADER_V2.version}`);
    expect(dirFbOn.prompt).toContain(sleeveVolumeLine('@Image 1'));

    // Per-call env overrides process.env, while omitting env reads process.env as default.
    const prev = process.env.BRAND_SEEDANCE_RULES_V2;
    try {
      process.env.BRAND_SEEDANCE_RULES_V2 = 'on';
      expect(composeFallbackPrompt(REVISION_ENHANCER_FALLBACK_EDIT_INPUT).prompt).toContain(sleeveVolumeLine('@Image 1'));
      expect(composeFallbackPrompt(REVISION_ENHANCER_FALLBACK_EDIT_INPUT, { env: {} }).prompt).toContain('face, hair and build');

      const overridden = await enhancePrompt(revInput, {
        fetch: makeFetch('overrideOff'),
        env: { GEMINI_API_KEY: 'test-key' },
      });
      expect(systems.overrideOff).toContain(SEEDANCE_PROFILE);
      expect(systems.overrideOff).not.toContain(SEEDANCE_PROFILE_V2);
      expect(overridden.meta?.profileVersion).toBe('seedance@2026-11-15.1');
    } finally {
      if (prev === undefined) delete process.env.BRAND_SEEDANCE_RULES_V2;
      else process.env.BRAND_SEEDANCE_RULES_V2 = prev;
    }
  });

  it('keeps every non-Seedance profile system text, fallback, and version identical with BRAND_SEEDANCE_RULES_V2 on and off', async () => {
    const combos: Array<{ profile: EnhanceInput['profile']; model: string; kind: 'image' | 'region_edit' }> = [
      { profile: 'seedream', model: 'seedream-5.5', kind: 'image' },
      { profile: 'seedream', model: 'seedream-5.5', kind: 'region_edit' },
      { profile: 'nano-banana', model: 'nano-banana-pro', kind: 'image' },
      { profile: 'nano-banana', model: 'nano-banana-2.1', kind: 'image' },
      { profile: 'nano-banana', model: 'nano-banana-2.1', kind: 'region_edit' },
      { profile: 'gpt-image', model: 'gpt-image-2.6-flare', kind: 'image' },
      { profile: 'gpt-image', model: 'gpt-image-2.6-sunburst', kind: 'image' },
      { profile: 'gpt-image', model: 'gpt-image-2.6-sunburst', kind: 'region_edit' },
    ];

    const prev = process.env.BRAND_SEEDANCE_RULES_V2;
    try {
      for (const { profile, model, kind } of combos) {
        const input: EnhanceInput = {
          kind,
          profile,
          model,
          locale: 'ko',
          prompt: '이미지 1 모델이 이미지 2 세럼 병을 들고 서 있는 장면',
          references: [
            { index: 1, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴과 피부 톤 유지', avoid: '배경' },
            { index: 2, kind: 'image', label: '이미지 2', role: 'product', use: '라벨과 병 모양' },
          ],
          brand: { name: 'Atelier North', tone: 'calm natural', rules: ['Keep real skin texture'] },
        };
        const binding = bindReferences(input);

        delete process.env.BRAND_SEEDANCE_RULES_V2;
        const sysOff = buildSystemInstruction(input, binding, null, [], { skinVariant: 'short', env: {} });
        const sysOn = buildSystemInstruction(input, binding, null, [], { skinVariant: 'short', env: ENV_V2_ONLY });
        expect(sysOn, `${profile}/${model}/${kind} (env)`).toBe(sysOff);

        process.env.BRAND_SEEDANCE_RULES_V2 = 'on';
        const sysProcOn = buildSystemInstruction(input, binding, null, [], { skinVariant: 'short' });
        expect(sysProcOn, `${profile}/${model}/${kind} (process.env)`).toBe(sysOff);
        delete process.env.BRAND_SEEDANCE_RULES_V2;

        expect(composeFallbackPrompt(input, { env: ENV_V2_ONLY })).toEqual(composeFallbackPrompt(input, { env: {} }));
        expect(enhanceMeta(input, 'model', { llmModel: 'gemini-4-hydrogen', env: ENV_V2_ONLY })).toEqual(
          enhanceMeta(input, 'model', { llmModel: 'gemini-4-hydrogen', env: {} }),
        );

        const sentSystems: string[] = [];
        const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
          const parsed = JSON.parse(String(init?.body ?? '{}')) as {
            systemInstruction?: { parts?: Array<{ text?: string }> };
          };
          sentSystems.push((parsed.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join(''));
          const tok = profile === 'seedream' ? 'Image 1' : 'image 1';
          const tok2 = profile === 'seedream' ? 'Image 2' : 'image 2';
          const prompt =
            kind === 'region_edit'
              ? `In ${tok}, change only the bottle to ${tok2}; do not move or resize anything else. Keep the rest identical.`
              : `Using ${tok} and ${tok2}, keep natural skin and exact product proportions in calm daylight.`;
          return new Response(
            JSON.stringify({
              candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ prompt, notes: '장면을 정리했어요.' }) }] } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as unknown as typeof fetch;

        const offOut = await enhancePrompt(input, { fetch: fetchMock, env: { GEMINI_API_KEY: 'test-key' } });
        const onOut = await enhancePrompt(input, { fetch: fetchMock, env: ENV_V2 });
        expect(sentSystems).toHaveLength(2);
        expect(sentSystems[1], `${profile}/${model}/${kind} enhancePrompt system`).toBe(sentSystems[0]);
        expect(onOut, `${profile}/${model}/${kind} enhancePrompt result`).toEqual(offOut);
      }
    } finally {
      if (prev === undefined) delete process.env.BRAND_SEEDANCE_RULES_V2;
      else process.env.BRAND_SEEDANCE_RULES_V2 = prev;
    }
  });

  it('removes internal labels (Mode A/B/C, face master, 3-panel, turnaround) from v2 system rules, profiles, outputs, and fallbacks while keeping the behaviour', async () => {
    const INTERNAL_LABEL_RE = /\bmode\s*[abc]\b|face\s*master|3[- ]?panel|three[- ]?panel|turnaround/i;

    expect(SEEDANCE_PROFILE_V2).not.toMatch(INTERNAL_LABEL_RE);
    expect(SEEDANCE_PROFILE_V2).toMatch(/face and hair/i);
    expect(SEEDANCE_PROFILE_V2).toMatch(/wardrobe/i);
    expect(SEEDANCE_PROFILE_V2).toMatch(/separate clothing reference/i);

    const noSeparateSys = buildSeedanceDirectorSystemInstruction({
      intent: 'expand',
      seconds: 8,
      blueprint: false,
      audioMode: 'on',
      explicitMusic: false,
      hasImageRefs: true,
      hasVideoRef: false,
      rulesV2: true,
      hasPerson: true,
      personTokens: ['@Image 1'],
      hasSeparateGarmentRef: false,
    });
    const withSeparateSys = buildSeedanceDirectorSystemInstruction({
      intent: 'expand',
      seconds: 8,
      blueprint: false,
      audioMode: 'on',
      explicitMusic: false,
      hasImageRefs: true,
      hasVideoRef: false,
      rulesV2: true,
      hasPerson: true,
      personTokens: ['@Image 2'],
      hasSeparateGarmentRef: true,
    });

    for (const sys of [noSeparateSys, withSeparateSys]) {
      expect(sys).not.toMatch(INTERNAL_LABEL_RE);
      expect(sys).toMatch(/person reference supplies face and hair/i);
      expect(sys).toMatch(/separate clothing reference/i);
    }

    for (const c of SEEDANCE_PARITY_CASES) {
      const { requests, fetchImpl } = captureV2(c);
      const compiled = await compileDirectorPrompt(c.input, {
        fetch: fetchImpl,
        env: ENV_V2,
        analyzer: FIXED_ANALYZER,
      });
      const fb = composeDirectorFallbackPrompt(c.input, { env: ENV_V2 });
      expect(requests[0]?.systemText ?? '', c.id).not.toMatch(INTERNAL_LABEL_RE);
      expect(compiled.prompt, c.id).not.toMatch(INTERNAL_LABEL_RE);
      expect(compiled.notes, c.id).not.toMatch(INTERNAL_LABEL_RE);
      expect(fb.prompt, c.id).not.toMatch(INTERNAL_LABEL_RE);
    }

    const revFb = composeFallbackPrompt(REVISION_ENHANCER_FALLBACK_EDIT_INPUT, { env: ENV_V2 });
    expect(revFb.prompt).not.toMatch(INTERNAL_LABEL_RE);
  });
});
