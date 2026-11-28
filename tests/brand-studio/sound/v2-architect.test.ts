import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import {
  MINIMAX_MUSIC_3_HEADER,
  MINIMAX_MUSIC_3_PROFILE,
  MINIMAX_OPEN_WEIGHTS_TAGS,
  MUSIC_PROFILES,
  musicProfileForModel,
  SUNO_V6_HEADER,
  SUNO_V6_PROFILE,
  SUNO_V6_WILD_HEADER,
  SUNO_V6_WILD_NOTE,
  SUNO_V6_WILD_PROFILE,
} from '@/lib/brand-studio/enhancer/profiles/music';
import { SUNO_HEADER, SUNO_PROFILE } from '@/lib/brand-studio/enhancer/profiles/suno';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { jobView } from '@/lib/brand-studio/repo';
import { runStudioOperation } from '@/lib/brand-studio/service';
import {
  buildClosedSunoSystemText,
  buildMusicSystemText,
  checkMinimaxLyrics,
  checkMusicDesignForModel,
  DESIGN_TIMEOUT_MS,
  designMusic,
  designMusicForModel,
  fallbackDesign,
  fallbackDesignForModel,
  inspectMusicDesignForModel,
  markMinimaxLyrics,
  MUSIC_PROFILE_VERSION,
  type MusicDesignInput,
} from '@/lib/brand-studio/sound/architect';
import { sungPlan } from '@/lib/brand-studio/sound/length-plan';
import { markLyrics, withoutAddedLines } from '@/lib/brand-studio/sound/lyrics';
import { resetMusicBlocks } from '@/lib/brand-studio/sound/warnings';
import type { JobRow, OutputRow } from '@/lib/brand-studio/types';
import { loadV2Fixtures, runLiveV2Eval, validateV2Fixtures } from '../../../scripts/sound-architect-eval';
import { requestId, studioDeps, studioFixture, viewerOf } from '../server/helpers';

const ROOT = process.cwd();
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b1';
const MORPHIC_HARDCODED_ID = 'd425c3b1-4066-4970-8a3b-93c52b3eef70';

/**
 * Exact pre-B3 `SUNO_PROFILE` string from `lib/brand-studio/enhancer/profiles/suno.ts` (`2026-11-21.2`),
 * pinned verbatim so any future byte drift is caught immediately.
 */
const EXPECTED_ORIGINAL_SUNO_PROFILE = `Model: a song and music generator for short brand advertising and social videos. It reads one English style paragraph and, when given, lyrics.

Write the style as ONE paragraph of plain English, 400 to 900 characters, in this order:
1. Genre and feel in a few words.
2. Tempo as a number with a feel word ("around 92 BPM, relaxed"). It is only approximate.
3. The voice: gender, register and delivery, and the language it sings in when there are vocals; or "instrumental" and what carries the melody when there are none.
4. Two or three instruments, one short sentence each on what that instrument does.
5. Structure in a phrase (a short intro, where the hook lands, the build).
6. Mix and space in a phrase (warm and close, airy, punchy low end).

Never write a length in seconds or minutes, mixing console values, or a pile of adjectives. Never name a real singer, band, song, album, producer or label: describe the era and the musical traits instead. No brand names other than one the request itself gives, and never in the style.

Title: a short name for the track (at most 40 characters) in the language of the lyrics, or of the customer's request when there are none. It is the track's name in the customer's list: name the track, do not copy the request's first words, and never use a superlative or a claim (best, No.1, 최고, 1위).

Notes: one plain sentence in the customer's language saying what you designed (genre, voice, feel), for the customer to read. Describe the sound only: never repeat the request's claims or superlatives.`;

const GOOD_SUNO_STYLE =
  'Warm acoustic pop with a light, hopeful feel, around 96 BPM, relaxed. Instrumental; a soft felt piano carries the melody. ' +
  'Fingerpicked acoustic guitar keeps a steady pulse, a round upright bass walks underneath, and brushed drums keep time. ' +
  'A short intro, the main motif arrives early and returns once. Warm and close, a little room. Ends cleanly on a held chord.';

const GOOD_MINIMAX_INST_CAPTION =
  'Global Metadata: Calm contemporary ambient piano underscore for a skincare product video, 4/4, unhurried relaxed pulse, quietly warm and steady from start to finish. Intimate close-miked studio production with soft room air.\n' +
  'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.\n' +
  'Arrangement: Opening: solo felt piano introduces sparse open chords. Middle: warm sustained string pad and quiet shaker join gently underneath. Ending: accompaniment fades and the piano resolves on a held chord.';

const GOOD_MINIMAX_VOCAL_KO_CAPTION =
  'Global Metadata: Refreshing Korean commercial dance-pop for sparkling beverage brand "모아", 4/4, upbeat bouncy groove, bright and confident from the opening bar. Clean, punchy studio production with tight low end.\n' +
  'Vocal Details: Clear mid-register lead vocal singing in Korean, close and dry studio placement with light doubled harmonies on the chorus hook.\n' +
  'Arrangement: Intro: crisp muted rhythm guitar establishes the groove. Chorus: bouncy synth bass and tight drums lift the catchy hook. Outro: band stops cleanly on a bright downbeat chord.';

const baseInput = (over: Partial<MusicDesignInput> = {}): MusicDesignInput => ({
  prompt: '차분한 스킨케어 브랜드 필름 배경 음악',
  vocal: false,
  lyrics: '',
  careful: false,
  language: 'ko',
  locale: 'ko',
  ...over,
});

function geminiStub(...answers: Array<Record<string, unknown> | Error>) {
  const calls: Array<{
    url: string;
    system: string;
    userParts: Array<Record<string, unknown>>;
    generationConfig: Record<string, unknown>;
  }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    const parsed = JSON.parse(String(init.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: Record<string, unknown>;
    };
    calls.push({
      url: String(url),
      system: parsed.systemInstruction.parts[0]?.text ?? '',
      userParts: parsed.contents[0]?.parts ?? [],
      generationConfig: parsed.generationConfig,
    });
    const next = answers.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no queued gemini answer');
    return new Response(
      JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(next) }] } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchStub, calls };
}

function wrapRecordingProvider(inner: ReturnType<typeof createFakeStudioProvider>): StudioProvider & {
  sent: StudioProviderRequest[];
} {
  const sent: StudioProviderRequest[] = [];
  return {
    name: inner.name,
    sent,
    async submit(req, opts) {
      sent.push(req);
      return inner.submit(req, opts);
    },
    status: (taskId) => inner.status(taskId),
    cancel: (taskId) => inner.cancel?.(taskId) ?? Promise.resolve(),
    download: (url) => inner.download(url),
  };
}

beforeEach(() => {
  resetFreeIntelRateLimits();
  resetMusicBlocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetFreeIntelRateLimits();
  resetMusicBlocks();
});

describe('1. Profiles under enhancer/profiles/music/ & byte-identical Suno v6 system text', () => {
  it('looks up all three profiles by model id, carries valid headers/changelogs/support tags, and keeps suno-v6 + Wild byte-identical to SUNO_PROFILE', () => {
    expect(Object.keys(MUSIC_PROFILES)).toEqual(['suno-v6', 'suno-v6-wild', 'minimax-music-3']);
    expect(musicProfileForModel('suno-v6').header).toBe(SUNO_V6_HEADER);
    expect(musicProfileForModel('suno-v6-wild').header).toBe(SUNO_V6_WILD_HEADER);
    expect(musicProfileForModel('minimax-music-3').header).toBe(MINIMAX_MUSIC_3_HEADER);

    // Byte-identical proof for Suno v6 and Suno v6 Wild wording vs original SUNO_PROFILE
    expect(SUNO_PROFILE).toBe(EXPECTED_ORIGINAL_SUNO_PROFILE);
    expect(SUNO_V6_PROFILE).toBe(SUNO_PROFILE);
    expect(SUNO_V6_WILD_PROFILE).toBe(SUNO_V6_PROFILE);
    const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    expect(sha(SUNO_V6_PROFILE)).toBe(sha(EXPECTED_ORIGINAL_SUNO_PROFILE));
    expect(sha(SUNO_V6_WILD_PROFILE)).toBe(sha(EXPECTED_ORIGINAL_SUNO_PROFILE));

    // Wild has no invented "be bolder" wording rules — differs only in header id/models and informational note
    expect(SUNO_V6_WILD_HEADER.id).toBe('suno-v6-wild');
    expect(SUNO_V6_WILD_HEADER.models).toEqual(['suno-v6-wild']);
    expect(SUNO_V6_WILD_NOTE).toMatch(/further from the prompt/i);
    expect(SUNO_V6_WILD_PROFILE).not.toMatch(/wild|bolder|experimental/i);

    // Closed v1 header untouched
    expect(SUNO_HEADER.id).toBe('suno');
    expect(SUNO_HEADER.version).toBe('2026-11-21.2');
    expect(MUSIC_PROFILE_VERSION).toBe('suno@2026-11-21.2');

    // Every profile header has dated sources with research support tags and a CHANGELOG entry
    const changelog = readFileSync(join(ROOT, 'lib/brand-studio/enhancer/profiles/music/CHANGELOG.md'), 'utf8');
    for (const header of [SUNO_V6_HEADER, SUNO_V6_WILD_HEADER, MINIMAX_MUSIC_3_HEADER]) {
      expect(header.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(header.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(header.sources.length).toBeGreaterThanOrEqual(4);
      for (const src of header.sources) {
        expect(src.seen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(src.claim).toMatch(/\[(official|practitioner-consistent|single-source|our-measurement)\]/);
      }
      expect(changelog).toContain(`## ${header.id} ${header.version}`);
    }

    // MiniMax 9-tag open-weights allow-list
    expect(MINIMAX_OPEN_WEIGHTS_TAGS).toEqual([
      'Intro',
      'Verse',
      'Pre-Chorus',
      'Chorus',
      'Post-Chorus',
      'Bridge',
      'Instrumental',
      'Solo',
      'Outro',
    ]);
    expect(MINIMAX_MUSIC_3_PROFILE).toContain('Global Metadata:');
    expect(MINIMAX_MUSIC_3_PROFILE).toContain('Vocal Details:');
    expect(MINIMAX_MUSIC_3_PROFILE).toContain('Arrangement:');
  });

  it('sends byte-identical systemInstruction and user payload on Suno v6 before (designMusic) and after (designMusicForModel without readings)', async () => {
    const cases: MusicDesignInput[] = [
      baseInput({ vocal: false }),
      baseInput({ prompt: '상쾌한 탄산수 광고, 밝은 여성 보컬', vocal: true, words: { brand: { name: '모아' } } }),
      (() => {
        const lyrics = '햇살 같은 하루\n\n같이 걸어요';
        const plan = sungPlan({ prompt: '밝은 어쿠스틱 팝', vocal: true, lyrics, structure: 'hook', seconds: 30, drafted: false });
        return baseInput({ prompt: '밝은 어쿠스틱 팝', vocal: true, lyrics, structure: 'hook', plan });
      })(),
    ];

    for (const c of cases) {
      expect(buildMusicSystemText('suno-v6', c)).toBe(buildClosedSunoSystemText(c));
      expect(buildMusicSystemText('suno-v6-wild', c)).toBe(buildClosedSunoSystemText(c));

      const plannedStyle = c.plan
        ? GOOD_SUNO_STYLE.replace('around 96 BPM', `around ${c.plan.bpm} BPM`).replace('Instrumental; a soft felt piano carries the melody.', 'A clear Korean vocal sings warmly.')
        : GOOD_SUNO_STYLE;
      const v1Stub = geminiStub({ style: plannedStyle, title: '맑은 하루', notes: '따뜻하게 설계했어요.' });
      const v2Stub = geminiStub({ style: plannedStyle, title: '맑은 하루', notes: '따뜻하게 설계했어요.' });

      await designMusic(c, { fetch: v1Stub.fetchStub, env: { GEMINI_API_KEY: 'k' } });
      await designMusicForModel('suno-v6', c, { fetch: v2Stub.fetchStub, env: { GEMINI_API_KEY: 'k' } });

      expect(v2Stub.calls).toHaveLength(1);
      expect(v2Stub.calls[0]!.system).toBe(v1Stub.calls[0]!.system);
      expect(v2Stub.calls[0]!.userParts).toEqual(v1Stub.calls[0]!.userParts);
      expect(v2Stub.calls[0]!.generationConfig).toEqual(v1Stub.calls[0]!.generationConfig);
      expect(v2Stub.calls[0]!.generationConfig).toMatchObject({
        thinkingConfig: { thinkingLevel: 'LOW' },
      });
      expect(DESIGN_TIMEOUT_MS).toBe(25_000);
    }
  });
});

describe('2. Per-model code checks (every check tested with a passing and a failing example)', () => {
  it('validates every Suno v6 and Suno v6 Wild check identically (passing + failing examples)', () => {
    for (const model of ['suno-v6', 'suno-v6-wild'] as const) {
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '온기의 결', lyrics: '' }, { prompt: '차분한 피아노', vocal: false })).toEqual([]);

      // 1. min length (< 40 fails)
      expect(checkMusicDesignForModel(model, { style: 'Too short.', title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/too short/);

      // 2. max length (> 1000 fails)
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} `.repeat(5), title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/over 1000/);

      // 3. single paragraph (newline fails)
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE}\nSecond line.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/one paragraph/);

      // 4. internal terms (fails)
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Built for Sunra endpoint.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/technical term/);

      // 5. artist names (fails)
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Sounds like Dua Lipa.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/real artist/);

      // 6. seconds / minutes in style (fails)
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Exactly 30 seconds.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/seconds or minutes/);

      // 7. length plan BPM mismatch (passes at planned BPM, fails outside +-3 BPM)
      const lyrics = '햇살 같은 하루\n\n같이 걸어요';
      const plan = sungPlan({ prompt: '밝은 어쿠스틱 팝', vocal: true, lyrics, structure: 'hook', seconds: 30, drafted: false })!;
      const matchingPlanStyle = GOOD_SUNO_STYLE.replace('around 96 BPM', `around ${plan.bpm} BPM`);
      expect(checkMusicDesignForModel(model, { style: matchingPlanStyle, title: '온기의 결' }, { vocal: true, lyrics, plan })).toEqual([]);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE.replace('around 96 BPM', 'around 140 BPM'), title: '온기의 결' }, { vocal: true, lyrics, plan }).join(' | ')).toMatch(/planned at/);

      // 8. instrumental with non-empty lyrics (fails)
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '온기의 결', lyrics: '[Intro]' }, { vocal: false }).join(' | ')).toMatch(/lyrics must be empty/);

      // 9. title checks (empty, >40, artist, superlative, copies request start)
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '' }, { vocal: false }).join(' | ')).toMatch(/title is required/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '가'.repeat(41) }, { vocal: false }).join(' | ')).toMatch(/over 40/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '뉴진스 스타일' }, { vocal: false }).join(' | ')).toMatch(/real artist/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '국내 최고 1위' }, { vocal: false }).join(' | ')).toMatch(/superlative/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '차분한 스킨케어' }, { prompt: '차분한 스킨케어 브랜드 필름', vocal: false }).join(' | ')).toMatch(/copies the start/);
    }
  });

  it('validates every MiniMax Music 3.0 check with passing and failing examples', () => {
    // Baseline passing instrumental & passing Korean vocal
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: GOOD_MINIMAX_INST_CAPTION, title: '고요한 결', lyrics: '' },
        { prompt: '차분한 스킨케어 영상 음악', vocal: false },
      ),
    ).toEqual([]);
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        {
          prompt: GOOD_MINIMAX_VOCAL_KO_CAPTION,
          title: '상쾌한 탄산',
          lyrics: '[Intro]\n[Chorus]\n시원하게 깨어나는 하루\n모아와 함께 빛나\n[Outro]\n모아',
        },
        { prompt: "제로 탄산수 광고, 브랜드 '모아'", vocal: true, language: 'ko', words: { brand: { name: '모아' } } },
      ),
    ).toEqual([]);

    // Check 1: Three headings present and in order
    const swappedHeadings =
      'Global Metadata: Warm ambient piano underscore with steady calm phrasing and soft studio production.\n' +
      'Arrangement: Opening solo piano, middle warm pad, ending clean chord.\n' +
      'Vocal Details: Instrumental; a soft felt piano carries the main melody throughout the piece.';
    expect(
      inspectMusicDesignForModel('minimax-music-3', { prompt: swappedHeadings, title: '고요한 결', lyrics: '' }, { vocal: false }).find(
        (c) => c.id === 'minimax_headings_in_order',
      )?.passed,
    ).toBe(false);

    const missingHeading = GOOD_MINIMAX_INST_CAPTION.replace('Vocal Details:', 'Voice:');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: missingHeading, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /three headings/,
    );

    // Check 2: Length 200..2000
    const under200 = 'Global Metadata: Calm piano.\nVocal Details: Instrumental; piano lead.\nArrangement: Short opening and clean end.';
    expect(under200.length).toBeLessThan(200);
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: under200, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(/under 200/);

    const over2000 = `${GOOD_MINIMAX_INST_CAPTION} ${'Soft harmonic resonance continues smoothly across the wide stereo field. '.repeat(26)}`;
    expect(over2000.length).toBeGreaterThan(2000);
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: over2000, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(/over 2000/);

    // Check 3: English only (pinned Hangul rule: unquoted Hangul fails; unasked quoted Hangul fails; customer brand in quotes passes)
    const unquotedHangul = GOOD_MINIMAX_INST_CAPTION.replace('skincare product', '스킨케어 제품');
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: unquotedHangul, title: '고요한 결' }, { prompt: '스킨케어 제품', vocal: false }).join(' | '),
    ).toMatch(/English/);

    const unaskedQuotedHangul = GOOD_MINIMAX_INST_CAPTION.replace('skincare product', 'brand "엉뚱한브랜드"');
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: unaskedQuotedHangul, title: '고요한 결' },
        { prompt: '차분한 스킨케어 영상', vocal: false },
      ).join(' | '),
    ).toMatch(/not a brand or product name/);

    const validQuotedBrand = GOOD_MINIMAX_INST_CAPTION.replace('skincare product', 'skincare brand "하루결"');
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: validQuotedBrand, title: '고요한 결' },
        { prompt: "차분한 '하루결' 스킨케어 영상", vocal: false },
      ),
    ).toEqual([]);

    // Check 4: Artist names (fails on artist; passes when clean)
    const withArtist = GOOD_MINIMAX_INST_CAPTION.replace('felt upright piano', 'piano like Ryuichi Sakamoto');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withArtist, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /real artist/,
    );

    // Check 5: Internal terms (fails on minimax / text-to-music / guidance_scale)
    const withInternal = GOOD_MINIMAX_INST_CAPTION.replace('studio production', 'minimax text-to-music guidance_scale production');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withInternal, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /technical term/,
    );

    // Check 6: No 'N seconds / minutes' wording inside caption (fails on '30 seconds' / '30-second'; passes on 'late-80s')
    const withSeconds = GOOD_MINIMAX_INST_CAPTION.replace('product video', '30-second product video');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withSeconds, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /seconds or minutes/,
    );
    const withEraDecade = GOOD_MINIMAX_INST_CAPTION.replace('soft room air', 'late-80s chorus warmth');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withEraDecade, title: '고요한 결' }, { vocal: false })).toEqual([]);

    // Check 7a: BPM present ONLY if supported by customer's text or a reading
    const withBpm = GOOD_MINIMAX_INST_CAPTION.replace('unhurried relaxed pulse', 'relaxed pulse around 92 BPM');
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: withBpm, title: '고요한 결' }, { prompt: '차분한 스킨케어 음악', vocal: false }).join(' | '),
    ).toMatch(/BPM/);
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: withBpm, title: '고요한 결' },
        { prompt: '차분한 스킨케어 음악', vocal: false, readings: { audio: 'warm piano around 92 BPM' } },
      ),
    ).toEqual([]);

    // Check 7b: Musical key present ONLY if supported by customer's text or a reading
    const withKey = GOOD_MINIMAX_INST_CAPTION.replace('4/4,', '4/4 in C major,');
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: withKey, title: '고요한 결' }, { prompt: '차분한 스킨케어 음악', vocal: false }).join(' | '),
    ).toMatch(/musical key/);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: withKey, title: '고요한 결' }, { prompt: 'C 메이저 밝은 피아노 음악', vocal: false }),
    ).toEqual([]);

    // Check 7c: Gender words (English male/female AND Korean 남성/여성/남자/여자) ONLY if supported
    const withFemale = GOOD_MINIMAX_VOCAL_KO_CAPTION.replace('Clear mid-register lead vocal', 'Bright female lead vocal');
    const withMale = GOOD_MINIMAX_VOCAL_KO_CAPTION.replace('Clear mid-register lead vocal', 'Warm male lead vocal');
    const sampleLyrics = '[Chorus]\n시원하게 깨어나는 하루';

    // Unsupported when request has no gender
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: withFemale, title: '상쾌한 탄산', lyrics: sampleLyrics },
        { prompt: "제로 탄산수 광고, 브랜드 '모아'", vocal: true, language: 'ko' },
      ).join(' | '),
    ).toMatch(/vocal gender/);
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: withMale, title: '상쾌한 탄산', lyrics: sampleLyrics },
        { prompt: "제로 탄산수 광고, 브랜드 '모아'", vocal: true, language: 'ko' },
      ).join(' | '),
    ).toMatch(/vocal gender/);

    // Supported by Korean gender words 여성 / 여자 and 남성 / 남자, and English female / male in readings
    for (const femWord of ['여성 보컬', '여자 목소리', 'female vocal']) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: withFemale, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `제로 탄산수 광고, 브랜드 '모아', ${femWord}`, vocal: true, language: 'ko' },
        ),
        femWord,
      ).toEqual([]);
      // Asking for female still forbids inventing male!
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: withMale, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `제로 탄산수 광고, 브랜드 '모아', ${femWord}`, vocal: true, language: 'ko' },
        ).join(' | '),
      ).toMatch(/vocal gender/);
    }
    for (const maleWord of ['남성 보컬', '남자 보컬', 'male baritone']) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: withMale, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: "제로 탄산수 광고, 브랜드 '모아'", vocal: true, language: 'ko', readings: { voice: maleWord } },
        ),
        maleWord,
      ).toEqual([]);
    }

    // Exclusions ('no drums') ARE allowed on MiniMax
    const withExclusion = GOOD_MINIMAX_INST_CAPTION.replace('soft room air.', 'soft room air, strictly no drums.');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withExclusion, title: '고요한 결' }, { vocal: false })).toEqual([]);

    // Check 8: Instrumental -> no Vocal Details about a singer and no lyrics
    const instWithSinger = GOOD_MINIMAX_INST_CAPTION.replace(
      'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.',
      'Vocal Details: Soft airy vocalist singing wordless harmonies over piano.',
    );
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: instWithSinger, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /Instrumental|singer/,
    );
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: GOOD_MINIMAX_INST_CAPTION, title: '고요한 결', lyrics: '[Verse]\n안녕' }, { vocal: false }).join(
        ' | ',
      ),
    ).toMatch(/must not include lyrics/);

    // Vocal Korean -> requires "in Korean", and forbids quoting lyric lines in caption
    const missingInKorean = GOOD_MINIMAX_VOCAL_KO_CAPTION.replace('singing in Korean', 'singing clearly');
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: missingInKorean, title: '상쾌한 탄산', lyrics: sampleLyrics },
        { prompt: "브랜드 '모아'", vocal: true, language: 'ko' },
      ).join(' | '),
    ).toMatch(/in Korean/);

    const quotedEnglishLyric = GOOD_MINIMAX_VOCAL_KO_CAPTION.replace('singing in Korean', 'singing in English').replace(
      '"모아"',
      '"golden morning pouring in the cup"',
    );
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        { prompt: quotedEnglishLyric, title: 'Morning Cup', lyrics: '[Chorus]\nGolden morning pouring in the cup' },
        { prompt: 'Sunny coffee ad', vocal: true, language: 'en' },
      ).join(' | '),
    ).toMatch(/never quote/);

    // Check 9: Bare lyric tags from the 9-tag open-weights allow-list, <= 3500 chars
    expect(
      checkMinimaxLyrics(
        '[Intro]\n[Verse]\nFirst line\n[Pre-Chorus]\nBuild line\n[Chorus]\nHook line\n[Post-Chorus]\nEcho\n[Bridge]\nTurn\n[Instrumental]\n[Solo]\n[Outro]\nEnd line',
      ),
    ).toEqual([]);
    expect(checkMinimaxLyrics('[Chorus - full band]\nHook line').join(' | ')).toMatch(/bare \[Tag\]/);
    expect(checkMinimaxLyrics('[Chorus] sing loudly\nHook line').join(' | ')).toMatch(/bare \[Tag\]/);
    expect(checkMinimaxLyrics('[Hook]\nHook line').join(' | ')).toMatch(/not in the allowed MiniMax set/);
    expect(checkMinimaxLyrics('[Verse 1]\nFirst line').join(' | ')).toMatch(/not in the allowed MiniMax set/);
    expect(checkMinimaxLyrics(`[Verse]\n${'a'.repeat(3505)}`).join(' | ')).toMatch(/over 3500/);
  });
});

describe('3. Customer lyrics untouched, deterministic fallbacks, 1-retry loop, and readings slot', () => {
  it('never rewrites customer lyrics and never sends customer lyrics to the text model across all 3 models', async () => {
    const customerLyrics = '  첫 줄의 여백까지 그대로  \n둘째 줄 느낌표!\n\n(oh) 마지막 후렴구';
    for (const model of ['suno-v6', 'suno-v6-wild', 'minimax-music-3'] as const) {
      const planned =
        model === 'minimax-music-3'
          ? null
          : sungPlan({ prompt: '따뜻한 어쿠스틱 송', vocal: true, lyrics: customerLyrics, structure: 'hook', seconds: 30, drafted: false });
      const answerStyle =
        model === 'minimax-music-3'
          ? GOOD_MINIMAX_VOCAL_KO_CAPTION.replace(' for sparkling beverage brand "모아"', '')
          : GOOD_SUNO_STYLE.replace('around 96 BPM', `around ${planned?.bpm ?? 100} BPM`).replace(
              'Instrumental; a soft felt piano carries the melody.',
              'A warm vocal sings in Korean.',
            );
      const stub = geminiStub({ style: answerStyle, title: '아침의 노래', notes: '따뜻하게 설계했어요.' });
      const designed = await designMusicForModel(
        model,
        baseInput({
          prompt: '따뜻한 어쿠스틱 송',
          vocal: true,
          lyrics: customerLyrics,
          structure: 'hook',
          plan: planned,
          customerLyrics: true,
        }),
        { fetch: stub.fetchStub, env: { GEMINI_API_KEY: 'k' } },
      );

      expect(designed.source).toBe('model');
      const expectedSungLines = customerLyrics.split('\n').filter((l) => l.trim() !== '');
      const actualSungLines = designed.lyrics
        .split('\n')
        .filter((l) => l.trim() !== '' && (expectedSungLines.includes(l) || !/^\[[^\]\n]{1,40}\]$/.test(l.trim())));
      expect(actualSungLines).toEqual(expectedSungLines);
      if (model === 'minimax-music-3') {
        expect(withoutAddedLines(designed.lyrics, customerLyrics)).toBe(customerLyrics);
        expect(designed.lyrics).toBe(markMinimaxLyrics(customerLyrics, 'hook'));
        expect(designed.lyrics).not.toContain('[Instrumental Break]');
      } else {
        expect(designed.lyrics).toBe(markLyrics(customerLyrics, 'hook', planned?.form ?? null));
      }
      // Customer lyrics text never sent to the LLM
      expect(JSON.stringify(stub.calls[0]!.userParts)).not.toContain('첫 줄의 여백까지');
    }

    // Customer lyrics that already carry section tags pass through 100% byte-for-byte
    const taggedCustomerLyrics = '[Verse]\n내 가사 첫 줄\n[Chorus - softly]\n내 가사 후렴';
    expect(markMinimaxLyrics(taggedCustomerLyrics, 'full')).toBe(taggedCustomerLyrics);
    expect(markLyrics(taggedCustomerLyrics, 'full')).toBe(taggedCustomerLyrics);
  });

  it('produces deterministic per-model fallbacks without inventing translated terms on Korean MiniMax prompts, and marks fallback in stored job metadata', async () => {
    const koBrief = baseInput({
      prompt: '잔잔한 한옥 스테이 홍보 영상 배경 음악',
      vocal: false,
      durationSeconds: 45,
    });

    const sunoFb = fallbackDesignForModel('suno-v6', koBrief, 'no_key');
    const wildFb = fallbackDesignForModel('suno-v6-wild', koBrief, 'no_key');
    const mmFb = fallbackDesignForModel('minimax-music-3', koBrief, 'no_key');

    expect(sunoFb.style).toBe(fallbackDesign(koBrief, 'no_key').style);
    expect(wildFb.style).toBe(fallbackDesign(koBrief, 'no_key').style);
    expect(sunoFb.profileVersion).toBe(musicProfileForModel('suno-v6').version);
    expect(wildFb.profileVersion).toBe(musicProfileForModel('suno-v6-wild').version);

    expect(mmFb).toMatchObject({
      source: 'fallback',
      fallbackReason: 'no_key',
      llmModel: null,
      notes: null,
      profileVersion: musicProfileForModel('minimax-music-3').version,
      durationSeconds: 45,
    });
    expect(mmFb.prompt).toBe(mmFb.style);
    expect(mmFb.prompt!.length).toBeGreaterThanOrEqual(200);
    expect(mmFb.prompt!.length).toBeLessThanOrEqual(2000);
    expect(mmFb.prompt).toMatch(/^Global Metadata:[\s\S]+\nVocal Details:[\s\S]+\nArrangement:/);
    // Quotes customer's Korean sentence verbatim without inventing BPM, key, or gender
    expect(mmFb.prompt).toContain('"잔잔한 한옥 스테이 홍보 영상 배경 음악"');
    expect(mmFb.prompt).not.toMatch(/\b\d{2,3}\s*BPM\b/i);
    expect(mmFb.prompt).not.toMatch(/\b(?:male|female)\b/i);

    // Retry once with problems listed, then fall back cleanly and record fallback on job.work.enhancer + finalPrompt
    const badMinimax = { style: 'Too short without headings and 120 BPM.', title: '고택의 아침', notes: 'x' };
    const retryThenPass = geminiStub(badMinimax, {
      style: GOOD_MINIMAX_INST_CAPTION,
      title: '고택의 아침',
      notes: '차분한 피아노로 설계했어요.',
    });
    const recovered = await designMusicForModel('minimax-music-3', koBrief, {
      fetch: retryThenPass.fetchStub,
      env: { GEMINI_API_KEY: 'k' },
    });
    expect(recovered.source).toBe('model');
    expect(retryThenPass.calls).toHaveLength(2);
    expect(JSON.stringify(retryThenPass.calls[1]!.userParts)).toContain('three headings');
    expect(JSON.stringify(retryThenPass.calls[1]!.userParts)).toContain('BPM');

    const failTwice = geminiStub(badMinimax, badMinimax);
    const fellBack = await designMusicForModel('minimax-music-3', koBrief, {
      fetch: failTwice.fetchStub,
      env: { GEMINI_API_KEY: 'k' },
    });
    expect(fellBack).toMatchObject({ source: 'fallback', fallbackReason: 'check_failed' });
    expect(failTwice.calls).toHaveLength(2);
  });

  it('folds readings into system/payload/fallback when present, omits readings completely when absent, and drops voice reading on instrumentals', async () => {
    const withoutReadings = baseInput({ prompt: '차분한 브랜드 음악', vocal: true });
    const withReadings = baseInput({
      prompt: '차분한 브랜드 음악',
      vocal: true,
      readings: {
        audio: 'warm Rhodes piano around 94 BPM, brushed snare',
        voice: 'female alto vocal, breathy intimate tone',
        inspo: ['minimal acoustic guitar and soft bass'],
      },
    });

    for (const model of ['suno-v6', 'minimax-music-3'] as const) {
      const answer =
        model === 'minimax-music-3'
          ? GOOD_MINIMAX_VOCAL_KO_CAPTION.replace(' for sparkling beverage brand "모아"', '').replace('upbeat bouncy groove', 'relaxed groove around 94 BPM').replace('Clear mid-register lead vocal', 'Breathy female alto lead vocal')
          : GOOD_SUNO_STYLE.replace('Instrumental; a soft felt piano carries the melody.', 'A breathy female alto vocal sings in Korean.');

      const stubAbsent = geminiStub({ style: answer, title: '조용한 오후', notes: '차분하게 설계했어요.' });
      await designMusicForModel(model, withoutReadings, { fetch: stubAbsent.fetchStub, env: { GEMINI_API_KEY: 'k' } });
      expect(stubAbsent.calls[0]!.system).not.toContain('Reference readings');
      expect(JSON.stringify(stubAbsent.calls[0]!.userParts)).not.toContain('"readings"');

      const stubPresent = geminiStub({ style: answer, title: '조용한 오후', notes: '차분하게 설계했어요.' });
      await designMusicForModel(model, withReadings, { fetch: stubPresent.fetchStub, env: { GEMINI_API_KEY: 'k' } });
      expect(stubPresent.calls[0]!.system).toContain('Reference readings');
      const sentPayload = JSON.stringify(stubPresent.calls[0]!.userParts);
      expect(sentPayload).toContain('warm Rhodes piano around 94 BPM');
      expect(sentPayload).toContain('female alto vocal');
      expect(sentPayload).toContain('minimal acoustic guitar');

      // Fallback also folds readings when present and omits them when absent
      const fbAbsent = fallbackDesignForModel(model, withoutReadings, 'no_key');
      const fbPresent = fallbackDesignForModel(model, withReadings, 'no_key');
      expect(fbAbsent.style).not.toContain('Rhodes');
      expect(fbPresent.style).toContain('warm Rhodes piano around 94 BPM');
      expect(fbPresent.style).toContain('female alto vocal');

      // Instrumental run drops `readings.voice`
      const instWithVoice = { ...withReadings, vocal: false };
      const fbInst = fallbackDesignForModel(model, instWithVoice, 'no_key');
      expect(fbInst.style).toContain('warm Rhodes piano around 94 BPM');
      expect(fbInst.style).not.toContain('female alto vocal');
    }
  });
});

describe('4. v2 wiring in music.design and prepareMusic (closed path untouched)', () => {
  it('wires MusicDesignV2Schema into music.design for listed orgs, keeps unlisted/outsider/sandboxed gates, and keeps prepareMusic per-model accurate', async () => {
    const listedFx = await studioFixture({ capKrw: 5_000_000 });
    const unlistedFx = await studioFixture({ capKrw: 5_000_000 });
    const morphicFx = await studioFixture({ orgId: MORPHIC_HARDCODED_ID, orgName: 'Neutral Name' });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', `${listedFx.orgId},${morphicFx.orgId}`);

      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const stub = geminiStub(
        // 1. music.design minimax-music-3
        { style: GOOD_MINIMAX_INST_CAPTION, title: '설계된 미니맥스', notes: '피아노 연주곡으로 설계했어요.' },
        // 2. music.design suno-v6-wild
        { style: GOOD_SUNO_STYLE, title: '설계된 와일드', notes: '어쿠스틱 팝으로 설계했어요.' },
        // 3. prepareMusic minimax-music-3 fallback when model errors -> shows truth in finalPrompt & work.enhancer
        new Error('gemini_http_503'),
      );

      const liveEnv = studioEnv({
        BRAND_STUDIO_PROVIDER: 'live',
        SUNRA_API_KEY: 'sk-test',
        BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
        BRAND_SOUND_STUDIO: 'on',
      });
      const listedDeps = studioDeps(listedFx.sql, {
        env: liveEnv,
        provider,
        intelDeps: { fetch: stub.fetchStub, env: { GEMINI_API_KEY: 'k' } },
      });
      const unlistedDeps = studioDeps(unlistedFx.sql, { env: liveEnv, provider });
      const morphicDeps = studioDeps(morphicFx.sql, { env: liveEnv, provider });

      // Unlisted org sending v2 fields to `music.design` -> 400 invalid
      expect(
        await runStudioOperation(unlistedDeps, viewerOf(unlistedFx.ids.owner, 'ko'), 'music.design', {
          organizationId: unlistedFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'invalid' });

      // Sandboxed org (Morphic) listed -> still 404 feature_unavailable
      expect(
        await runStudioOperation(morphicDeps, viewerOf(morphicFx.ids.owner, 'ko'), 'music.design', {
          organizationId: morphicFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'feature_unavailable' });

      // Guest / viewer probes with v2 fields on listed org -> 400 invalid (anti-oracle)
      expect(
        await runStudioOperation(listedDeps, viewerOf(listedFx.ids.viewer, 'ko'), 'music.design', {
          organizationId: listedFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'invalid' });

      // Listed owner `music.design` on `minimax-music-3` returns `prompt` + `style` + `title`
      const mmPreview = await runStudioOperation(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), 'music.design', {
        organizationId: listedFx.orgId,
        model: 'minimax-music-3',
        prompt: '차분한 스킨케어 영상 음악',
        vocal: false,
        readings: { audio: 'soft felt piano and warm strings' },
      });
      expect(mmPreview).toEqual({
        ok: true,
        design: {
          mode: 'describe',
          style: GOOD_MINIMAX_INST_CAPTION,
          prompt: GOOD_MINIMAX_INST_CAPTION,
          title: '설계된 미니맥스',
          notes: '피아노 연주곡으로 설계했어요.',
          source: 'model',
        },
      });

      // Listed owner `music.design` on `suno-v6-wild` omits `prompt` field and returns Suno `style`
      const wildPreview = await runStudioOperation(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), 'music.design', {
        organizationId: listedFx.orgId,
        model: 'suno-v6-wild',
        prompt: '차분한 어쿠스틱 배경음',
        vocal: false,
      });
      expect(wildPreview).toEqual({
        ok: true,
        design: {
          mode: 'describe',
          style: GOOD_SUNO_STYLE,
          title: '설계된 와일드',
          notes: '어쿠스틱 팝으로 설계했어요.',
          source: 'model',
        },
      });

      // Fallback on MiniMax prepareMusic never blocks paid run and records `source: 'fallback'` + truthful `finalPrompt`
      const createdFallbackJob = await createStudioJob(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), {
        kind: 'music',
        organizationId: listedFx.orgId,
        requestId: requestId(),
        model: 'minimax-music-3',
        prompt: '30초 차분한 스킨케어 배경 음악',
        vocal: false,
      });
      if (!('job' in createdFallbackJob)) throw new Error(JSON.stringify(createdFallbackJob));
      await advanceStudioJobsWith(listedDeps, { jobIds: [createdFallbackJob.job.id] });

      const fbRow = (await listedFx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [createdFallbackJob.job.id])).rows[0]!;
      const fbOut = (await listedFx.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [createdFallbackJob.job.id])).rows;
      expect(fbRow.work.enhancer).toMatchObject({
        profile: 'suno',
        profileVersion: musicProfileForModel('minimax-music-3').version,
        source: 'fallback',
        fallbackReason: 'model_error',
      });
      expect(fbRow.final_prompt).toMatch(/^Global Metadata:[\s\S]+\nVocal Details:[\s\S]+\nArrangement:/);
      expect(provider.sent[0]).toEqual({
        endpoint: 'minimax/minimax-music3/text-to-music',
        body: {
          prompt: fbRow.final_prompt,
          duration: 30,
          is_instrumental: true,
        },
      });
      expect(jobView(fbRow, fbOut, listedDeps.media).finalPrompt).toBe(fbRow.final_prompt);
    } finally {
      await listedFx.db.close();
      await unlistedFx.db.close();
      await morphicFx.db.close();
    }
  });
});

describe('5. Evaluation script: 36 fixtures pass --dry-validate offline, and --v2 refuses without key', () => {
  it('validates all 36 stored fixtures (12 rough requests x 3 models) with zero network calls and covers every required scenario', () => {
    const fixtureFile = loadV2Fixtures();
    expect(fixtureFile.cases).toHaveLength(12);

    // Verify fixture set covers all required properties in Deliverable 6
    expect(fixtureFile.cases.some((c) => c.locale === 'ko')).toBe(true);
    expect(fixtureFile.cases.some((c) => c.locale === 'en')).toBe(true);
    expect(fixtureFile.cases.some((c) => c.vocal)).toBe(true);
    expect(fixtureFile.cases.some((c) => !c.vocal)).toBe(true);
    expect(fixtureFile.cases.some((c) => c.readings !== null)).toBe(true);
    expect(fixtureFile.cases.some((c) => c.readings === null)).toBe(true);
    expect(fixtureFile.cases.some((c) => c.prompt.includes('15'))).toBe(true);
    expect(fixtureFile.cases.some((c) => c.explicitTargetSeconds === 30 || c.prompt.includes('30'))).toBe(true);
    expect(fixtureFile.cases.some((c) => c.explicitTargetSeconds === 60)).toBe(true);
    expect(fixtureFile.cases.some((c) => c.explicitTargetSeconds === null && !/\d/.test(c.prompt))).toBe(true);
    expect(fixtureFile.cases.some((c) => c.expectBlocked === 'name')).toBe(true);
    expect(fixtureFile.cases.some((c) => Boolean(c.lyrics.trim()))).toBe(true);
    expect(fixtureFile.cases.some((c) => c.prompt.includes('90초'))).toBe(true);
    expect(fixtureFile.cases.some((c) => c.prompt.trim().split(/\s+/).length === 3)).toBe(true);

    const report = validateV2Fixtures(fixtureFile);
    expect(report.total).toBe(36);
    expect(report.failCount).toBe(0);
    expect(report.passed).toBe(true);
  });

  it('refuses --v2 without GEMINI_API_KEY with a clear message and never leaks a key', async () => {
    await expect(
      runLiveV2Eval({
        env: {},
        outPath: join(ROOT, 'sound-architect-eval/never-written.json'),
      }),
    ).rejects.toThrow(/Refusing to run --v2: GEMINI_API_KEY is required/);
  });
});
