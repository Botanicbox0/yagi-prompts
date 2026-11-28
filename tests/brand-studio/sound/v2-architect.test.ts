import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { minimaxMusicRequestOf } from '@/lib/brand-studio/provider/requests';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { jobView } from '@/lib/brand-studio/repo';
import { runStudioOperation } from '@/lib/brand-studio/service';
import {
  buildClosedSunoSystemText,
  buildMusicSystemText,
  checkMinimaxArrangementTags,
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
  partitionMusicDesignProblemsForModel,
  resolveMinimaxDurationSeconds,
  safeNotes,
  safeNotesForModel,
  type MusicDesignInput,
} from '@/lib/brand-studio/sound/architect';
import { V2_MUSIC_DESIGN_FIELDS } from '@/lib/brand-studio/sound/design-op';
import { minimaxMusic3Sunra } from '@/lib/brand-studio/sound/engines/minimax-sunra';
import { sungPlan } from '@/lib/brand-studio/sound/length-plan';
import { markLyrics, withoutAddedLines } from '@/lib/brand-studio/sound/lyrics';
import { planMusicV2, V2_MUSIC_FIELDS } from '@/lib/brand-studio/sound/music-jobs';
import type { MusicVideoFit } from '@/lib/brand-studio/sound/video-fit';
import { resetMusicBlocks } from '@/lib/brand-studio/sound/warnings';
import type { JobRow, OutputRow } from '@/lib/brand-studio/types';
import {
  buildV2CaseInput,
  loadV2Fixtures,
  runLiveV2Eval,
  validateV2Fallbacks,
  validateV2Fixtures,
  validateV2Probes,
} from '../../../scripts/sound-architect-eval';
import { requestId, studioDeps, studioFixture, viewerOf } from '../server/helpers';

const ROOT = process.cwd();
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
  'Global Metadata: Calm contemporary ambient piano underscore for a skincare product video, 4/4, unhurried relaxed pulse, quietly warm and steady from start to finish. Intimate close-miked studio production in a small room with soft air.\n' +
  'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.\n' +
  'Arrangement: Opening: solo felt piano introduces sparse open chords. Middle: warm sustained string pad and quiet shaker join gently underneath. Ending: accompaniment fades and the piano resolves on a held chord.';

const GOOD_MINIMAX_VOCAL_KO_CAPTION =
  'Global Metadata: Refreshing Korean commercial dance-pop for sparkling beverage brand "모아", 4/4, upbeat bouncy groove, bright and confident from the opening bar. Clean, punchy studio production with tight low end.\n' +
  'Vocal Details: Clear mid-register lead vocal singing in Korean in a warm, bright register, close and dry studio placement with light doubled harmonies on the chorus hook.\n' +
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

describe('1. Profiles, byte-identical Suno v6 system text, and MUST-FIX 1 v1 safeNotes parity', () => {
  it('looks up all three profiles by model id, carries valid headers/changelogs/support tags, and keeps suno-v6 + Wild byte-identical to SUNO_PROFILE', () => {
    expect(Object.keys(MUSIC_PROFILES)).toEqual(['suno-v6', 'suno-v6-wild', 'minimax-music-3']);
    expect(musicProfileForModel('suno-v6').header).toBe(SUNO_V6_HEADER);
    expect(musicProfileForModel('suno-v6-wild').header).toBe(SUNO_V6_WILD_HEADER);
    expect(musicProfileForModel('minimax-music-3').header).toBe(MINIMAX_MUSIC_3_HEADER);
    expect(musicProfileForModel('suno-v6').limits.lyricsMax).toBe(5000);
    expect(musicProfileForModel('suno-v6-wild').limits.lyricsMax).toBe(5000);
    expect(musicProfileForModel('minimax-music-3').limits.lyricsMax).toBe(3500);

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

    // MiniMax 9-tag open-weights allow-list & clean profile wording
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
    expect(MINIMAX_MUSIC_3_PROFILE).not.toContain('singing in English');

    // SHOULD-FIX 8: shared V2_MUSIC_DESIGN_FIELDS derived from V2_MUSIC_FIELDS
    expect(V2_MUSIC_DESIGN_FIELDS).toEqual([...V2_MUSIC_FIELDS, 'readings']);
  });

  it('MUST-FIX 1: keeps v1 safeNotes exact 830d2258 behaviour (allows "MiniMax" on v1/Suno, sanitizes on MiniMax v2)', async () => {
    const minimaxNote = 'MiniMax 스타일로 밝게 설계했어요.';
    expect(safeNotes(minimaxNote)).toBe(minimaxNote);
    expect(safeNotes('text-to-music 감성으로 구성했어요.')).toBe('text-to-music 감성으로 구성했어요.');
    expect(safeNotes('Suno v6에 맞춰 설계했어요.')).toBeNull();

    expect(safeNotesForModel('suno-v6', minimaxNote)).toBe(minimaxNote);
    expect(safeNotesForModel('suno-v6-wild', minimaxNote)).toBe(minimaxNote);
    expect(safeNotesForModel('minimax-music-3', minimaxNote)).toBeNull();
    expect(safeNotesForModel('minimax-music-3', 'guidance_scale 값을 높여 설계했어요.')).toBeNull();
    expect(safeNotesForModel('minimax-music-3', '따뜻한 로즈 피아노로 차분하게 설계했어요.')).toBe(
      '따뜻한 로즈 피아노로 차분하게 설계했어요.',
    );

    // Closed v1 `designMusic` preserves `notes` mentioning "MiniMax"
    const v1Stub = geminiStub({ style: GOOD_SUNO_STYLE, title: '맑은 아침', notes: minimaxNote });
    const v1Res = await designMusic(baseInput(), { fetch: v1Stub.fetchStub, env: { GEMINI_API_KEY: 'k' } });
    expect(v1Res.notes).toBe(minimaxNote);
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

describe('2. Per-model code checks & table tests (key, gender, BPM, era words, harmonies, Arrangement tags, support labels)', () => {
  it('validates every Suno v6 and Suno v6 Wild check identically and labels support levels accurately', () => {
    for (const model of ['suno-v6', 'suno-v6-wild'] as const) {
      const items = inspectMusicDesignForModel(
        model,
        { style: GOOD_SUNO_STYLE, title: '온기의 결', lyrics: '' },
        { prompt: '차분한 피아노', vocal: false },
      );
      expect(items.every((i) => i.passed)).toBe(true);
      expect(items.find((i) => i.id === 'suno_no_internal_terms')?.support).toBe('house');
      expect(items.find((i) => i.id === 'suno_title')?.support).toBe('house');
      expect(items.find((i) => i.id === 'suno_length_plan')?.support).toBe('our-measurement');

      expect(checkMusicDesignForModel(model, { style: 'Too short.', title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/too short/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} `.repeat(5), title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/over 1000/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE}\nSecond line.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/one paragraph/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Built for Sunra endpoint.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/technical term/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Sounds like Dua Lipa.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/real artist/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Exactly 30 seconds.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/seconds or minutes/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '온기의 결', lyrics: '[Intro]' }, { vocal: false }).join(' | ')).toMatch(/lyrics must be empty/);
    }
  });

  it('MUST-FIX 2: table-tests musical key detection — plain English ("in a ...", "A major-label", "A minor adjustment") passes, real keys fail without support', () => {
    const passPhrases = [
      'in a warm, breathy register',
      'recorded in a small room',
      'in a clean modern studio mix',
      'A minor adjustment in percussion dynamics',
      'a minor adjustment to the groove',
      'A major-label pop production sheen',
      'A major lift in energy on the chorus',
      'low-key intimate phrasing with key elements up front',
    ];
    for (const phrase of passPhrases) {
      const caption =
        phrase === 'A major-label pop production sheen'
          ? GOOD_MINIMAX_INST_CAPTION.replace('Calm contemporary ambient piano underscore', phrase)
          : GOOD_MINIMAX_INST_CAPTION.replace('in a small room with soft air', phrase);
      expect(
        checkMusicDesignForModel('minimax-music-3', { prompt: caption, title: '고요한 결' }, { prompt: '차분한 스킨케어 음악', vocal: false }),
        `expected PASS for: ${phrase}`,
      ).toEqual([]);
    }

    const failKeys = [
      'in A minor',
      'in A major',
      'key of F#',
      'in the key of Bb',
      'key: D major',
      'C major',
      'd minor',
      'f# min',
      'E-flat major',
      'Ab maj',
      'A min',
      'A Major',
    ];
    for (const keyPhrase of failKeys) {
      const caption = GOOD_MINIMAX_INST_CAPTION.replace('4/4,', `4/4, ${keyPhrase},`);
      expect(
        checkMusicDesignForModel('minimax-music-3', { prompt: caption, title: '고요한 결' }, { prompt: '차분한 스킨케어 음악', vocal: false }).join(' | '),
        `expected FAIL for: ${keyPhrase}`,
      ).toMatch(/musical key/);
    }

    // Supported when customer text or reading states a key (Korean or English), unless reading is low-confidence
    const cMajorCaption = GOOD_MINIMAX_INST_CAPTION.replace('4/4,', '4/4 in C major,');
    for (const keySupport of ['C 메이저 밝은 피아노', '다장조 연주곡', 'bright piano in C major', 'key of C']) {
      expect(
        checkMusicDesignForModel('minimax-music-3', { prompt: cMajorCaption, title: '고요한 결' }, { prompt: keySupport, vocal: false }),
        keySupport,
      ).toEqual([]);
    }
  });

  it('SHOULD-FIX 1: table-tests caption gender detection AND singer-only gender support', () => {
    const sampleLyrics = '[Intro]\n[Chorus]\n시원하게 깨어나는 하루\n[Outro]\n모아';

    // Table 1: every gender word / pronoun in caption is caught when brief has NO singer gender
    const captionGenderWords = [
      'feminine',
      'masculine',
      'lady',
      'guy',
      'she sings',
      'he sings',
      'her voice',
      'his voice',
      'woman',
      'man',
      'girl',
      'boy',
      'female',
      'male',
      '여가수',
      '남가수',
      '여성',
      '남성',
      '여자 보컬',
      '남자 보컬',
    ];
    for (const gw of captionGenderWords) {
      const injected = /[가-힣]/.test(gw)
        ? GOOD_MINIMAX_VOCAL_KO_CAPTION.replace('"모아"', `"${gw}"`)
        : GOOD_MINIMAX_VOCAL_KO_CAPTION.replace('Clear mid-register lead vocal singing in Korean', `Lead vocal (${gw}) singing in Korean`);
      const brief = /[가-힣]/.test(gw) ? `탄산수 광고, 키워드 '${gw}'` : "제로 탄산수 광고, 브랜드 '모아'";
      const items = inspectMusicDesignForModel(
        'minimax-music-3',
        { prompt: injected, title: '상쾌한 탄산', lyrics: sampleLyrics },
        { prompt: /[가-힣]/.test(gw) ? '탄산수 광고' : brief, vocal: true, language: 'ko', words: { brand: { name: /[가-힣]/.test(gw) ? gw : '모아' } } },
      );
      expect(items.find((i) => i.id === 'minimax_no_invented_gender')?.passed, `caption word "${gw}" must be flagged`).toBe(false);
    }

    // Non-vocal product phrases in caption ("women's skincare", "men's grooming") are NOT flagged as vocal gender
    for (const productPhrase of ["women's skincare", "men's grooming"]) {
      const caption = GOOD_MINIMAX_INST_CAPTION.replace('skincare product', productPhrase);
      expect(checkMusicDesignForModel('minimax-music-3', { prompt: caption, title: '고요한 결' }, { vocal: false }), productPhrase).toEqual([]);
    }

    // Table 2a: valid singer-gender support expressions DO support gender in caption
    const femaleCaption = GOOD_MINIMAX_VOCAL_KO_CAPTION.replace(
      'Clear mid-register lead vocal singing in Korean',
      'Bright feminine female lead; she sings in Korean',
    );
    const maleCaption = GOOD_MINIMAX_VOCAL_KO_CAPTION.replace(
      'Clear mid-register lead vocal singing in Korean',
      'Warm masculine male lead; he sings in Korean',
    );

    const validFemaleSupports = ['여성 보컬', '여자 목소리', '여가수가 부르는 광고 노래', '여자 보컬', '걸그룹 스타일', 'female vocal', 'female singer', 'alto vocal'];
    for (const sup of validFemaleSupports) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: femaleCaption, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `제로 탄산수 광고, 브랜드 '모아', ${sup}`, vocal: true, language: 'ko' },
        ),
        `expected female support for: ${sup}`,
      ).toEqual([]);
    }

    const validMaleSupports = ['남성 보컬', '남자 목소리', '남가수가 부르는 노래', '남자 보컬', '보이그룹 느낌', 'male singer', 'male vocal', 'baritone vocal'];
    for (const sup of validMaleSupports) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: maleCaption, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `제로 탄산수 광고, 브랜드 '모아', ${sup}`, vocal: true, language: 'ko' },
        ),
        `expected male support for: ${sup}`,
      ).toEqual([]);
    }

    // Table 2b: non-singer words MUST NOT count as vocal gender support
    const nonSingerWords = [
      '여자친구 선물 광고 노래',
      '남자친구 향수 광고 노래',
      '여성복 봄 시즌 캠페인 노래',
      '남성용 스킨케어 광고 보컬 곡',
      '여성 화장품 브랜드 광고 노래',
      "women's skincare commercial song",
      "men's wear launch song",
    ];
    for (const nonSinger of nonSingerWords) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: femaleCaption, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `${nonSinger}, 브랜드 '모아'`, vocal: true, language: 'ko' },
        ).join(' | '),
        `non-singer "${nonSinger}" must NOT support female`,
      ).toMatch(/vocal gender/);
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: maleCaption, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `${nonSinger}, 브랜드 '모아'`, vocal: true, language: 'ko' },
        ).join(' | '),
        `non-singer "${nonSinger}" must NOT support male`,
      ).toMatch(/vocal gender/);
    }
  });

  it('SHOULD-FIX 2: table-tests MiniMax BPM rules — unstated ranges allowed (PROMPTING-RESEARCH.md:26), unstated exact BPM fails, stated agrees within +-3 or inside range, low-confidence ignored', () => {
    const captionWith = (bpmText: string) => GOOD_MINIMAX_INST_CAPTION.replace('unhurried relaxed pulse', bpmText);

    // Unstated BPM: exact single BPM fails; BPM range passes per research row 26
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('around 92 BPM'), title: '고요한 결' }, { prompt: '차분한 피아노', vocal: false }).join(' | '),
    ).toMatch(/BPM/);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('90–100 BPM relaxed pulse'), title: '고요한 결' }, { prompt: '차분한 피아노', vocal: false }),
    ).toEqual([]);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('90-98 BPM relaxed pulse'), title: '고요한 결' }, { prompt: '차분한 피아노', vocal: false }),
    ).toEqual([]);

    // Stated 120 BPM: within +-3 passes; 140 BPM fails; range containing 120 passes; range 90-100 fails
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('around 120 BPM'), title: '고요한 결' }, { prompt: '120 BPM 피아노', vocal: false }),
    ).toEqual([]);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('around 123 BPM'), title: '고요한 결' }, { prompt: '120 BPM 피아노', vocal: false }),
    ).toEqual([]);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('around 140 BPM'), title: '고요한 결' }, { prompt: '120 BPM 피아노', vocal: false }).join(' | '),
    ).toMatch(/does not match the stated tempo/);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('116–124 BPM pulse'), title: '고요한 결' }, { prompt: '120 BPM 피아노', vocal: false }),
    ).toEqual([]);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('90–100 BPM pulse'), title: '고요한 결' }, { prompt: '120 BPM 피아노', vocal: false }).join(' | '),
    ).toMatch(/does not match the stated tempo/);

    // Low-confidence readings never support an exact BPM
    for (const lowConf of [
      'tempo about 92 BPM, confidence: low',
      '92 BPM (low confidence)',
      'bpmConfidence: low, around 92 BPM',
      '템포 약 92 BPM 불확실',
    ]) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: captionWith('around 92 BPM'), title: '고요한 결' },
          { prompt: '차분한 피아노', vocal: false, readings: { audio: lowConf } },
        ).join(' | '),
        lowConf,
      ).toMatch(/BPM/);
    }
  });

  it('SHOULD-FIX 3 & 4 & Item 10 & SHOULD-FIX 9: validates era words across all models, instrumental string harmonies, concrete melodic instrument, Arrangement tags, and support labels', () => {
    // Era words pass on all 3 models; real durations fail on all 3 models
    for (const era of ['70s-inspired strings', '90s hip-hop groove', '80s synth warmth', 'late-80s gated snare', "'70s funk guitar", '1990s boom-bap']) {
      for (const model of ['suno-v6', 'suno-v6-wild'] as const) {
        expect(
          checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Features ${era}.`, title: '온기의 결' }, { vocal: false }),
          `${model}: ${era}`,
        ).toEqual([]);
      }
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: GOOD_MINIMAX_INST_CAPTION.replace('soft air', era), title: '고요한 결' },
          { vocal: false },
        ),
        `minimax: ${era}`,
      ).toEqual([]);
    }
    for (const dur of ['30 seconds', '30-second', '15 sec', '15s', '1 minute', '30초']) {
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: GOOD_MINIMAX_INST_CAPTION.replace('soft air', dur), title: '고요한 결' },
          { vocal: false },
        ).join(' | '),
        dur,
      ).toMatch(/seconds or minutes/);
    }

    // Instrumental: "lush string harmonies" passes; "vocal harmonies" fails; generic "lead line" without concrete instrument fails
    const stringHarmonies = GOOD_MINIMAX_INST_CAPTION.replace(
      'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.',
      'Vocal Details: Instrumental; a warm cello carries the melody over lush string harmonies.',
    );
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: stringHarmonies, title: '고요한 결' }, { vocal: false })).toEqual([]);

    const vocalHarmonies = GOOD_MINIMAX_INST_CAPTION.replace(
      'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.',
      'Vocal Details: Instrumental; a soft felt piano carries the melody with airy vocal harmonies.',
    );
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: vocalHarmonies, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /vocal harmonies/,
    );

    const genericLeadOnly = GOOD_MINIMAX_INST_CAPTION.replace(
      'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.',
      'Vocal Details: Instrumental; the lead line carries the central melody.',
    );
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: genericLeadOnly, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /concrete lead melodic instrument/,
    );

    // Item 10 (`PROMPTING-RESEARCH.md:28`): lyric tags matched in Arrangement:
    expect(
      checkMinimaxArrangementTags(
        'Intro: guitar enters. Verse: bass joins. Chorus: full drums lift the hook. Outro: clean stop.',
        '[Intro]\n[Verse]\n첫 줄\n[Chorus]\n후렴\n[Outro]\n마무리',
      ),
    ).toEqual([]);
    expect(
      checkMinimaxArrangementTags(
        'Chorus: full drums lift the hook. Outro: clean stop.',
        '[Verse]\n첫 줄\n[Bridge]\n전환\n[Chorus]\n후렴\n[Outro]\n마무리',
      ).join(' | '),
    ).toMatch(/\[Verse\], \[Bridge\] missing/);

    // Skipped on `source: 'reviewed'` (`CONTRACT-v2-REVIEW.md` S6)
    expect(
      checkMusicDesignForModel(
        'minimax-music-3',
        {
          prompt: GOOD_MINIMAX_VOCAL_KO_CAPTION,
          title: '상쾌한 탄산',
          lyrics: '[Bridge]\n새로운 전환\n[Chorus]\n모아',
        },
        { prompt: "브랜드 '모아'", vocal: true, language: 'ko', source: 'reviewed' },
      ),
    ).toEqual([]);

    // Support labels on MiniMax inspection items (`SHOULD-FIX 9`)
    const mmItems = inspectMusicDesignForModel('minimax-music-3', { prompt: GOOD_MINIMAX_INST_CAPTION, title: '고요한 결' }, { vocal: false });
    expect(mmItems.find((i) => i.id === 'minimax_no_internal_terms')?.support).toBe('house');
    expect(mmItems.find((i) => i.id === 'minimax_title')?.support).toBe('house');
    expect(mmItems.find((i) => i.id === 'minimax_korean_language_named')?.support).toBe('single-source');
    expect(mmItems.find((i) => i.id === 'minimax_arrangement_tags')?.support).toBe('official');
  });
});

describe('3. MUST-FIX 3 & 4, customer lyrics, deterministic fallbacks, readings, and Item 8 single duration precedence', () => {
  it('MUST-FIX 3: never lets a two-problem title mask caption violations or >2000-char captions, and applies title_check_failed ONLY when captionProblems is empty', async () => {
    const twoProblemTitle = `최고의 ${'A'.repeat(45)}`;
    const brief = baseInput({ prompt: '차분한 스킨케어 배경 음악', vocal: false });

    // (a) Invented BPM + two-problem title -> rewrites once, then falls back (`source: 'fallback'`)
    const dirtyBpmCaption = GOOD_MINIMAX_INST_CAPTION.replace('unhurried relaxed pulse', 'relaxed pulse around 92 BPM');
    const dirtyStub = geminiStub(
      { style: dirtyBpmCaption, title: twoProblemTitle, notes: '피아노로 설계했어요.' },
      { style: dirtyBpmCaption, title: twoProblemTitle, notes: '피아노로 설계했어요.' },
    );
    const dirtyRes = await designMusicForModel('minimax-music-3', brief, {
      fetch: dirtyStub.fetchStub,
      env: { GEMINI_API_KEY: 'k' },
    });
    expect(dirtyStub.calls).toHaveLength(2);
    expect(dirtyRes.source).toBe('fallback');
    expect(dirtyRes.fallbackReason).toBe('check_failed');
    expect(dirtyRes.style).not.toContain('92 BPM');

    // (b) Over-2000-char caption + two-problem title -> falls back (`source: 'fallback'`), never emits >2000
    const over2000Caption = `${GOOD_MINIMAX_INST_CAPTION} ${'Soft harmonic resonance continues smoothly across the stereo field. '.repeat(26)}`;
    expect(over2000Caption.length).toBeGreaterThan(2000);
    const overStub = geminiStub(
      { style: over2000Caption, title: twoProblemTitle, notes: '피아노로 설계했어요.' },
      { style: over2000Caption, title: twoProblemTitle, notes: '피아노로 설계했어요.' },
    );
    const overRes = await designMusicForModel('minimax-music-3', brief, {
      fetch: overStub.fetchStub,
      env: { GEMINI_API_KEY: 'k' },
    });
    expect(overRes.source).toBe('fallback');
    expect(overRes.style.length).toBeLessThanOrEqual(2000);

    // (c) Clean caption + two-problem title -> keeps clean caption with safeTitle and `title_check_failed`
    const cleanCaptionBadTitleStub = geminiStub(
      { style: GOOD_MINIMAX_INST_CAPTION, title: twoProblemTitle, notes: '차분한 피아노로 설계했어요.' },
      { style: GOOD_MINIMAX_INST_CAPTION, title: twoProblemTitle, notes: '차분한 피아노로 설계했어요.' },
    );
    const titleFallbackRes = await designMusicForModel('minimax-music-3', brief, {
      fetch: cleanCaptionBadTitleStub.fetchStub,
      env: { GEMINI_API_KEY: 'k' },
    });
    expect(cleanCaptionBadTitleStub.calls).toHaveLength(2);
    expect(titleFallbackRes).toMatchObject({
      source: 'model',
      fallbackReason: 'title_check_failed',
      style: GOOD_MINIMAX_INST_CAPTION,
      prompt: GOOD_MINIMAX_INST_CAPTION,
      notes: '차분한 피아노로 설계했어요.',
    });
    expect(titleFallbackRes.title.length).toBeLessThanOrEqual(40);
  });

  it('MUST-FIX 4: vocal MiniMax preview with blank lyrics passes the real check loop in 1 call with source: "model"', async () => {
    const stub = geminiStub({
      style: GOOD_MINIMAX_VOCAL_KO_CAPTION,
      title: '톡 쏘는 순간',
      notes: '청량한 신스 팝으로 설계했어요.',
    });
    const directRes = await designMusicForModel(
      'minimax-music-3',
      baseInput({
        prompt: "15초 제로 탄산수 광고, 브랜드 '모아'",
        vocal: true,
        lyrics: '',
        customerLyrics: false,
        words: { brand: { name: '모아' } },
      }),
      { fetch: stub.fetchStub, env: { GEMINI_API_KEY: 'k' } },
    );
    expect(stub.calls).toHaveLength(1);
    expect(directRes).toMatchObject({
      source: 'model',
      style: GOOD_MINIMAX_VOCAL_KO_CAPTION,
      prompt: GOOD_MINIMAX_VOCAL_KO_CAPTION,
      title: '톡 쏘는 순간',
      lyrics: '',
      durationSeconds: 15,
    });
  });

  it('Item 8: exports a single MiniMax duration precedence resolver (customer > video > sentence > 60, clamped 1..75) and all callers agree', () => {
    const video43: MusicVideoFit = { assetId: '00000000-0000-4000-8000-0000000000a1', seconds: 42.6, cuts: [] };
    const video95: MusicVideoFit = { assetId: '00000000-0000-4000-8000-0000000000a2', seconds: 95, cuts: [] };
    const videoShort: MusicVideoFit = { assetId: '00000000-0000-4000-8000-0000000000a3', seconds: 2.1, cuts: [] };

    const scenarios: Array<{
      label: string;
      durationSeconds?: number;
      video?: MusicVideoFit | null;
      prompt: string;
      expected: number;
    }> = [
      { label: 'customer wins over video and sentence', durationSeconds: 22, video: video43, prompt: '15초 광고 음악', expected: 22 },
      { label: 'video wins over sentence', video: video43, prompt: '15초 광고 음악', expected: 43 },
      { label: 'video > 75s clamps to 75', video: video95, prompt: '15초 광고 음악', expected: 75 },
      { label: 'short video clamps to videoTargetSeconds min 5', video: videoShort, prompt: '차분한 음악', expected: 5 },
      { label: 'sentence wins over default 60', prompt: '15초 립틴트 광고', expected: 15 },
      { label: 'sentence > 75s clamps to 75', prompt: '90초 런칭 티저 음악', expected: 75 },
      { label: 'default 60 when nothing given', prompt: '차분한 피아노 연주곡', expected: 60 },
    ];

    for (const s of scenarios) {
      const resolved = resolveMinimaxDurationSeconds({
        durationSeconds: s.durationSeconds,
        video: s.video ?? null,
        prompt: s.prompt,
      });
      expect(resolved, `resolver: ${s.label}`).toBe(s.expected);

      // Caller 1: `planMusicV2` (`music-jobs.ts`)
      const planned = planMusicV2(
        {
          kind: 'music',
          organizationId: '00000000-0000-4000-8000-000000000001',
          requestId: 'req_duration_check_01',
          model: 'minimax-music-3',
          prompt: s.prompt,
          vocal: false,
          ...(s.durationSeconds !== undefined ? { durationSeconds: s.durationSeconds } : {}),
          ...(s.video ? { video: s.video } : {}),
        },
        'ko',
      );
      expect(planned.params.music?.durationSeconds, `planMusicV2: ${s.label}`).toBe(s.expected);

      // Caller 2: `fallbackDesignForModel` (`architect.ts`)
      const fb = fallbackDesignForModel(
        'minimax-music-3',
        baseInput({
          prompt: s.prompt,
          durationSeconds: s.durationSeconds ?? null,
          video: s.video ?? null,
        }),
        'no_key',
      );
      expect(fb.durationSeconds, `fallbackDesignForModel: ${s.label}`).toBe(s.expected);

      // Caller 3: `minimaxMusicRequestOf` (`provider/requests.ts`)
      const musicParams = {
        ...planned.params.music!,
        durationSeconds: s.durationSeconds,
        ...(s.video ? { video: s.video } : {}),
      };
      const builtReq = minimaxMusicRequestOf(
        minimaxMusic3Sunra,
        {
          kind: 'music',
          model: 'minimax-music-3',
          prompt: s.prompt,
          params: {
            ...planned.params,
            music: musicParams,
          },
          images: [],
          videos: [],
        },
        musicParams,
      );
      expect((builtReq.body as { duration: number }).duration, `minimaxMusicRequestOf: ${s.label}`).toBe(s.expected);

      // Caller 4: `buildV2CaseInput` (`scripts/sound-architect-eval.ts`)
      const evalBuilt = buildV2CaseInput(
        {
          id: 'check',
          description: s.label,
          prompt: s.prompt,
          locale: 'ko',
          language: 'ko',
          vocal: false,
          lyrics: '',
          explicitTargetSeconds: s.durationSeconds ?? null,
          video: s.video ?? null,
          readings: null,
          words: null,
          outputs: { 'suno-v6': {}, 'suno-v6-wild': {}, 'minimax-music-3': {} },
        },
        'minimax-music-3',
      );
      expect(evalBuilt.minimaxDurationSeconds, `buildV2CaseInput: ${s.label}`).toBe(s.expected);
    }
  });

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
      expect(JSON.stringify(stub.calls[0]!.userParts)).not.toContain('첫 줄의 여백까지');
    }

    const taggedCustomerLyrics = '[Verse]\n내 가사 첫 줄\n[Chorus - softly]\n내 가사 후렴';
    expect(markMinimaxLyrics(taggedCustomerLyrics, 'full')).toBe(taggedCustomerLyrics);
    expect(markLyrics(taggedCustomerLyrics, 'full')).toBe(taggedCustomerLyrics);
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

      const fbAbsent = fallbackDesignForModel(model, withoutReadings, 'no_key');
      const fbPresent = fallbackDesignForModel(model, withReadings, 'no_key');
      expect(fbAbsent.style).not.toContain('Rhodes');
      expect(fbPresent.style).toContain('warm Rhodes piano around 94 BPM');
      expect(fbPresent.style).toContain('female alto vocal');

      const instWithVoice = { ...withReadings, vocal: false };
      const fbInst = fallbackDesignForModel(model, instWithVoice, 'no_key');
      expect(fbInst.style).toContain('warm Rhodes piano around 94 BPM');
      expect(fbInst.style).not.toContain('female alto vocal');
    }
  });
});

describe('4. v2 wiring in music.design (including blank-lyrics vocal MiniMax on live check loop) and prepareMusic', () => {
  it('wires MusicDesignV2Schema into music.design (including 1-call vocal MiniMax preview with blank lyrics), keeps gates, and records truthful prepareMusic fallback', async () => {
    const listedFx = await studioFixture({ capKrw: 5_000_000 });
    const unlistedFx = await studioFixture({ capKrw: 5_000_000 });
    const morphicFx = await studioFixture({ orgId: MORPHIC_HARDCODED_ID, orgName: 'Neutral Name' });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', `${listedFx.orgId},${morphicFx.orgId}`);

      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const stub = geminiStub(
        // 1. music.design minimax-music-3 instrumental
        { style: GOOD_MINIMAX_INST_CAPTION, title: '설계된 미니맥스', notes: '피아노 연주곡으로 설계했어요.' },
        // 2. music.design minimax-music-3 vocal with blank lyrics -> MUST-FIX 4: 1 call, source: 'model'
        { style: GOOD_MINIMAX_VOCAL_KO_CAPTION, title: '상쾌한 모아', notes: '청량한 보컬 곡으로 설계했어요.' },
        // 3. music.design suno-v6-wild
        { style: GOOD_SUNO_STYLE, title: '설계된 와일드', notes: '어쿠스틱 팝으로 설계했어요.' },
        // 4. prepareMusic minimax-music-3 fallback when model errors -> shows truth in finalPrompt & work.enhancer
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

      expect(
        await runStudioOperation(unlistedDeps, viewerOf(unlistedFx.ids.owner, 'ko'), 'music.design', {
          organizationId: unlistedFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'invalid' });

      expect(
        await runStudioOperation(morphicDeps, viewerOf(morphicFx.ids.owner, 'ko'), 'music.design', {
          organizationId: morphicFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'feature_unavailable' });

      expect(
        await runStudioOperation(listedDeps, viewerOf(listedFx.ids.viewer, 'ko'), 'music.design', {
          organizationId: listedFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'invalid' });

      const mmInstPreview = await runStudioOperation(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), 'music.design', {
        organizationId: listedFx.orgId,
        model: 'minimax-music-3',
        prompt: '차분한 스킨케어 영상 음악',
        vocal: false,
        readings: { audio: 'soft felt piano and warm strings' },
      });
      expect(mmInstPreview).toEqual({
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
      expect(stub.calls).toHaveLength(1);

      // MUST-FIX 4: vocal MiniMax preview with blank lyrics through real check loop -> 1 call, `source: 'model'`
      const mmVocalPreview = await runStudioOperation(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), 'music.design', {
        organizationId: listedFx.orgId,
        model: 'minimax-music-3',
        prompt: "15초 제로 탄산수 광고, 브랜드 '모아'",
        vocal: true,
        words: { brand: { name: '모아' } },
      });
      expect(mmVocalPreview).toEqual({
        ok: true,
        design: {
          mode: 'describe',
          style: GOOD_MINIMAX_VOCAL_KO_CAPTION,
          prompt: GOOD_MINIMAX_VOCAL_KO_CAPTION,
          title: '상쾌한 모아',
          notes: '청량한 보컬 곡으로 설계했어요.',
          source: 'model',
        },
      });
      expect(stub.calls).toHaveLength(2);

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

describe('5. Evaluation script: 36 fixtures + 10 probes + 36 fallbacks offline, and production MiniMax writer/judge in --v2', () => {
  it('validates all 36 stored fixtures, 10 regression probes, and all 36 fallbacks through engine.request with zero network calls', () => {
    const fixtureFile = loadV2Fixtures();
    expect(fixtureFile.cases).toHaveLength(12);
    expect((fixtureFile.regressionProbes ?? []).length).toBeGreaterThanOrEqual(6);

    const report = validateV2Fixtures(fixtureFile);
    expect(report.total).toBe(36);
    expect(report.failCount).toBe(0);
    expect(report.fallbacks).toHaveLength(36);
    expect(report.fallbacks.every((f) => f.passed)).toBe(true);
    expect(report.probes).toHaveLength(10);
    expect(report.probes.every((p) => p.passed)).toBe(true);
    expect(report.passed).toBe(true);

    expect(validateV2Fallbacks(fixtureFile).every((f) => f.passed)).toBe(true);
    expect(validateV2Probes(fixtureFile).every((p) => p.passed)).toBe(true);
  });

  it('SHOULD-FIX 6: --v2 uses production writeMinimaxLyricsWithFallback + judgeExistingLyrics for MiniMax blank-lyrics vocal runs, and refuses without key', async () => {
    await expect(
      runLiveV2Eval({
        env: {},
        outPath: join(ROOT, 'sound-architect-eval/never-written.json'),
      }),
    ).rejects.toThrow(/Refusing to run --v2: GEMINI_API_KEY is required/);

    // Stubbed live --v2 run on `04-ko-vocal-15-gender-brand`:
    //   1) suno-v6: 1 architect call
    //   2) suno-v6-wild: 1 architect call
    //   3) minimax-music-3: 1 MiniMax lyric draft + 1 originality judge + 1 architect call = 3 calls
    const outTmp = resolve(process.env.TEMP ?? join(ROOT, '.tmp'), `v2-eval-stub-${Date.now()}.json`);
    const suno04Style =
      'Crisp K-indie dance-pop with a bright summer bounce, around 120 BPM, lively. A bright female vocal sings in Korean in a crisp register. ' +
      'Clean rhythm guitar strums sixteenth notes, bouncy bass drives the groove, and tight drums lift the hook. Opens straight into the hook and stops cleanly. Airy mix.';
    const mm04Caption =
      'Global Metadata: Refreshing Korean commercial dance-pop for sparkling water brand "모아", 4/4, upbeat bouncy groove, crisp modern studio production.\n' +
      'Vocal Details: Bright female lead vocal singing in Korean in a crisp upper-mid register; she sings close at the front of the mix.\n' +
      'Arrangement: Chorus: crisp rhythm guitar, bouncy synth bass, and tight drums launch straight into the sparkling hook.';

    const stub = geminiStub(
      // suno-v6
      { style: suno04Style, title: '투명한 탄산', notes: '밝게 설계했어요.' },
      // suno-v6-wild
      { style: suno04Style, title: '투명한 탄산', notes: '밝게 설계했어요.' },
      // minimax-music-3 step 1: writeMinimaxLyricsWithFallback (`LYRICS_SCHEMA` -> `{ bpm, stanzas }`)
      { bpm: 120, stanzas: [['얼음 위로 부서지는 방울', '투명하게 피어나는 기포', '시원하게 채워지는 모아', '가벼워진 하루에 모아']] },
      // minimax-music-3 step 2: judgeExistingLyrics (`{ existing: false, confidence: 0.02 }`)
      { existing: false, confidence: 0.02 },
      // minimax-music-3 step 3: designMusicForModel
      { style: mm04Caption, title: '모아 스파클링', notes: '청량한 보컬 곡으로 설계했어요.' },
    );

    try {
      const live = await runLiveV2Eval({
        env: { GEMINI_API_KEY: 'sk-secret-test-key' },
        outPath: outTmp,
        only: ['04-ko-vocal-15-gender-brand'],
        fetchImpl: stub.fetchStub,
      });
      expect(stub.calls).toHaveLength(5);
      expect(live.passed).toBe(true);
      const mmRow = live.results.find((r) => r.model === 'minimax-music-3')!;
      expect(mmRow.passed).toBe(true);
      expect(mmRow.rewriteNeeded).toBe(false);
      expect(mmRow.design?.lyrics).toBe('[Chorus]\n얼음 위로 부서지는 방울\n투명하게 피어나는 기포\n시원하게 채워지는 모아\n가벼워진 하루에 모아');
      expect(readFileSync(outTmp, 'utf8')).not.toContain('sk-secret-test-key');
    } finally {
      if (existsSync(outTmp)) unlinkSync(outTmp);
    }
  });
});
