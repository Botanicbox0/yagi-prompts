import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceStudioJobsWith, requestInputOf } from '@/lib/brand-studio/engine';
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
import { buildStudioRequest, minimaxMusicRequestOf } from '@/lib/brand-studio/provider/requests';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import type { StudioProvider, StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { jobView } from '@/lib/brand-studio/repo';
import { runStudioOperation } from '@/lib/brand-studio/service';
import {
  buildClosedSunoSystemText,
  buildMusicSystemText,
  checkMinimaxArrangementTags,
  checkMinimaxLyrics,
  checkMusicDesign,
  checkMusicDesignForModel,
  DESIGN_TIMEOUT_MS,
  designMeta,
  designMetaForModel,
  designMusic,
  designMusicForModel,
  fallbackDesign,
  fallbackDesignForModel,
  inspectMusicDesignForModel,
  markMinimaxLyrics,
  MUSIC_PROFILE_VERSION,
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
import { musicDesignInputOf } from '@/lib/brand-studio/sound/prepare-music';
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
/** A sandboxed client organization id, taken from the source list (never written out here). */
const SANDBOXED_ORG_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

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

describe('1. Profiles, byte-identical Suno v6 system text, shared taskBlock, and MUST-FIX 1 v1 safeNotes parity', () => {
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

    const v1Stub = geminiStub({ style: GOOD_SUNO_STYLE, title: '맑은 아침', notes: minimaxNote });
    const v1Res = await designMusic(baseInput(), { fetch: v1Stub.fetchStub, env: { GEMINI_API_KEY: 'k' } });
    expect(v1Res.notes).toBe(minimaxNote);
  });

  it('sends byte-identical systemInstruction and user payload on Suno v6/Wild, and derives readings system text from today taskBlock without copying', async () => {
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
        ? GOOD_SUNO_STYLE.replace('around 96 BPM', `around ${c.plan.bpm} BPM`).replace(
            'Instrumental; a soft felt piano carries the melody.',
            'A clear Korean vocal sings warmly.',
          )
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

    // Round-2 Item 3: with readings + avoid + video, Suno v6/Wild system text is strictly `buildClosedSunoSystemText`
    // plus the single readings bullet inserted right before `- Notes language:`.
    const richSunoInput = baseInput({
      prompt: '상쾌한 탄산수 광고',
      vocal: true,
      avoid: true,
      video: { assetId: '00000000-0000-4000-8000-0000000000c1', seconds: 18, cuts: [4, 9, 14] },
      readings: { audio: 'warm electric piano, brushed drums' },
    });
    const closedText = buildClosedSunoSystemText(richSunoInput);
    const v6WithReadings = buildMusicSystemText('suno-v6', richSunoInput);
    const wildWithReadings = buildMusicSystemText('suno-v6-wild', richSunoInput);
    const expectedReadingsInsert =
      '- Reference readings are given in `readings` (priority: customer request > audio/voice reading > inspo). Fold their musical traits into the paragraph without naming any artist or technical source.';
    expect(v6WithReadings).toBe(closedText.replace('\n- Notes language:', `\n${expectedReadingsInsert}\n- Notes language:`));
    expect(wildWithReadings).toBe(v6WithReadings);
  });
});

describe('2. Per-model code checks & table tests (Suno parity with v1, MiniMax baseline + lyrics, key, gender, BPM, harmonies, Arrangement tags)', () => {
  it('validates every Suno v6 and Suno v6 Wild check identically to v1 checkMusicDesign / planProblems / checkMusicTitle (passing + failing examples)', () => {
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
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '온기의 결', lyrics: '' }, { prompt: '차분한 피아노', vocal: false })).toEqual([]);

      // 1–6. Style checks match v1 `checkMusicDesign` (including numeric `*0s` tokens like `80s synth`)
      expect(checkMusicDesignForModel(model, { style: 'Too short.', title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/too short/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} `.repeat(5), title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/over 1000/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE}\nSecond line.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/one paragraph/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Built for Sunra endpoint.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/technical term/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Sounds like Dua Lipa.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/real artist/);
      expect(checkMusicDesignForModel(model, { style: `${GOOD_SUNO_STYLE} Exactly 30 seconds.`, title: '온기의 결' }, { vocal: false }).join(' | ')).toMatch(/seconds or minutes/);
      for (const eraToken of ['70s-inspired strings', '80s synth warmth', '90s hip-hop groove']) {
        const styleWithEra = `${GOOD_SUNO_STYLE} Features ${eraToken}.`;
        const v1Issues = checkMusicDesign({ style: styleWithEra, title: '온기의 결' }, 'describe', '차분한 피아노');
        const v2Issues = checkMusicDesignForModel(model, { style: styleWithEra, title: '온기의 결' }, { prompt: '차분한 피아노', vocal: false });
        expect(v2Issues, `${model} matches v1 on ${eraToken}`).toEqual(v1Issues);
        expect(v2Issues.join(' | ')).toMatch(/seconds or minutes/);
      }

      // 7. Length plan BPM mismatch (+-3 BPM) and intro-form check (restored from HEAD~1)
      const lyrics = '햇살 같은 하루\n\n같이 걸어요';
      const plan = sungPlan({ prompt: '밝은 어쿠스틱 팝', vocal: true, lyrics, structure: 'full', seconds: 60, drafted: false })!;
      const matchingPlanStyle = GOOD_SUNO_STYLE.replace('around 96 BPM', `around ${plan.bpm} BPM`);
      expect(checkMusicDesignForModel(model, { style: matchingPlanStyle, title: '온기의 결' }, { vocal: true, lyrics, plan })).toEqual([]);
      expect(
        checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE.replace('around 96 BPM', 'around 140 BPM'), title: '온기의 결' }, { vocal: true, lyrics, plan }).join(
          ' | ',
        ),
      ).toMatch(/planned at/);

      // 8. Instrumental with non-empty lyrics (fails)
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '온기의 결', lyrics: '[Intro]' }, { vocal: false }).join(' | ')).toMatch(/lyrics must be empty/);

      // 9. All 5 Suno title checks (restored from HEAD~1: empty, >40, artist, superlative, copies request start)
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '' }, { vocal: false }).join(' | ')).toMatch(/title is required/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '가'.repeat(41) }, { vocal: false }).join(' | ')).toMatch(/over 40/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '뉴진스 스타일' }, { vocal: false }).join(' | ')).toMatch(/real artist/);
      expect(checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '국내 최고 1위' }, { vocal: false }).join(' | ')).toMatch(/superlative/);
      expect(
        checkMusicDesignForModel(model, { style: GOOD_SUNO_STYLE, title: '차분한 스킨케어' }, { prompt: '차분한 스킨케어 브랜드 필름', vocal: false }).join(' | '),
      ).toMatch(/copies the start/);
    }
  });

  it('validates every MiniMax Music 3.0 baseline check (headings, 200..2000 length, Hangul, artist, internal, exclusions, instrumental singer, Korean vocal, lyric quoting) and checkMinimaxLyrics unit cases', () => {
    const sampleLyrics = '[Intro]\n[Chorus]\n시원하게 깨어나는 하루\n모아와 함께 빛나\n[Outro]\n모아';

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
        { prompt: GOOD_MINIMAX_VOCAL_KO_CAPTION, title: '상쾌한 탄산', lyrics: sampleLyrics },
        { prompt: "제로 탄산수 광고, 브랜드 '모아'", vocal: true, language: 'ko', words: { brand: { name: '모아' } } },
      ),
    ).toEqual([]);

    // Check 1: Three headings present and in order (swapped headings + missing heading)
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

    // Check 2: Plain length 200..2000 check
    const under200 = 'Global Metadata: Calm piano.\nVocal Details: Instrumental; piano lead.\nArrangement: Short opening and clean end.';
    expect(under200.length).toBeLessThan(200);
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: under200, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(/under 200/);

    const over2000 = `${GOOD_MINIMAX_INST_CAPTION} ${'Soft harmonic resonance continues smoothly across the wide stereo field. '.repeat(26)}`;
    expect(over2000.length).toBeGreaterThan(2000);
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: over2000, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(/over 2000/);

    // Check 3: English only (unquoted Hangul fails; unasked quoted Hangul fails; customer brand in quotes passes)
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

    // Check 4: Artist names
    const withArtist = GOOD_MINIMAX_INST_CAPTION.replace('felt upright piano', 'piano like Ryuichi Sakamoto');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withArtist, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(/real artist/);

    // Check 5: Internal terms
    const withInternal = GOOD_MINIMAX_INST_CAPTION.replace('studio production', 'minimax text-to-music guidance_scale production');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withInternal, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /technical term/,
    );

    // Exclusions ('no drums') ARE allowed on MiniMax
    const withExclusion = GOOD_MINIMAX_INST_CAPTION.replace('soft air.', 'soft air, strictly no drums.');
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: withExclusion, title: '고요한 결' }, { vocal: false })).toEqual([]);

    // Check 8: Instrumental -> no Vocal Details about a singer and no lyrics
    const instWithSinger = GOOD_MINIMAX_INST_CAPTION.replace(
      'Vocal Details: Instrumental; a soft felt upright piano carries the lyrical main melody.',
      'Vocal Details: Soft airy vocalist singing wordless vocal harmonies over piano.',
    );
    expect(checkMusicDesignForModel('minimax-music-3', { prompt: instWithSinger, title: '고요한 결' }, { vocal: false }).join(' | ')).toMatch(
      /Instrumental|singer/,
    );
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: GOOD_MINIMAX_INST_CAPTION, title: '고요한 결', lyrics: '[Verse]\n안녕' }, { vocal: false }).join(
        ' | ',
      ),
    ).toMatch(/must not include lyrics/);

    // Vocal Korean -> requires "in Korean", and forbids quoting sung lyric lines in caption
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
        { prompt: quotedEnglishLyric, title: 'Morning Cup', lyrics: '[Intro]\n[Chorus]\nGolden morning pouring in the cup\n[Outro]\nMorning glow' },
        { prompt: 'Sunny coffee ad', vocal: true, language: 'en' },
      ).join(' | '),
    ).toMatch(/never quote/);

    // Check 9: Bare lyric tags from the 9-tag open-weights allow-list, <= 3,500 chars (restored unit cases from HEAD~1)
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

    for (const productPhrase of ["women's skincare", "men's grooming"]) {
      const caption = GOOD_MINIMAX_INST_CAPTION.replace('skincare product', productPhrase);
      expect(checkMusicDesignForModel('minimax-music-3', { prompt: caption, title: '고요한 결' }, { vocal: false }), productPhrase).toEqual([]);
    }

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
      // Asking for female still forbids inventing male
      expect(
        checkMusicDesignForModel(
          'minimax-music-3',
          { prompt: maleCaption, title: '상쾌한 탄산', lyrics: sampleLyrics },
          { prompt: `제로 탄산수 광고, 브랜드 '모아', ${sup}`, vocal: true, language: 'ko' },
        ).join(' | '),
      ).toMatch(/vocal gender/);
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

    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('around 92 BPM'), title: '고요한 결' }, { prompt: '차분한 피아노', vocal: false }).join(' | '),
    ).toMatch(/BPM/);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('90–100 BPM relaxed pulse'), title: '고요한 결' }, { prompt: '차분한 피아노', vocal: false }),
    ).toEqual([]);
    expect(
      checkMusicDesignForModel('minimax-music-3', { prompt: captionWith('90-98 BPM relaxed pulse'), title: '고요한 결' }, { prompt: '차분한 피아노', vocal: false }),
    ).toEqual([]);

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

  it('SHOULD-FIX 3 & 4 & Item 10 & SHOULD-FIX 9: validates MiniMax era words, instrumental string harmonies, concrete melodic instrument, Arrangement tags, and support labels', () => {
    for (const era of ['70s-inspired strings', '90s hip-hop groove', '80s synth warmth', 'late-80s gated snare', "'70s funk guitar", '1990s boom-bap']) {
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

    const mmItems = inspectMusicDesignForModel('minimax-music-3', { prompt: GOOD_MINIMAX_INST_CAPTION, title: '고요한 결' }, { vocal: false });
    expect(mmItems.find((i) => i.id === 'minimax_no_internal_terms')?.support).toBe('house');
    expect(mmItems.find((i) => i.id === 'minimax_title')?.support).toBe('house');
    expect(mmItems.find((i) => i.id === 'minimax_korean_language_named')?.support).toBe('single-source');
    expect(mmItems.find((i) => i.id === 'minimax_arrangement_tags')?.support).toBe('official');
  });
});

describe('3. MUST-FIX 3 & 4, fallback shapes & rewrite rules, customer lyrics, readings typing, and customer-sentence duration precedence', () => {
  it('MUST-FIX 3: never lets a two-problem title mask caption violations or >2000-char captions, and applies title_check_failed ONLY when captionProblems is empty', async () => {
    const twoProblemTitle = `최고의 ${'A'.repeat(45)}`;
    const brief = baseInput({ prompt: '차분한 스킨케어 배경 음악', vocal: false });

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

  it('produces deterministic per-model fallbacks without inventing translated terms on Korean MiniMax prompts, lists broken rules on rewrite, and falls back after two failures', async () => {
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

    // Retry once with broken rules listed ("three headings", "BPM"), then recover on second call
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

  it('Item 8 + Round-2 Item 1: resolves MiniMax duration from customer sentence (never designed caption) when durationSeconds is absent, and all callers agree', () => {
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
          prompt: GOOD_MINIMAX_INST_CAPTION,
          customerPrompt: s.prompt,
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

    // Round-2 Item 1 explicit diverging test: no `durationSeconds` stored on the job row, and the stored customer
    // sentence (`job.prompt`) and designed caption (`job.final_prompt`) would produce DIFFERENT durations.
    const basePlanned = planMusicV2(
      {
        kind: 'music',
        organizationId: '00000000-0000-4000-8000-000000000001',
        requestId: 'req_diverging_sentence_caption',
        model: 'minimax-music-3',
        prompt: '25초 차분한 스킨케어 배경 음악',
        vocal: false,
      },
      'ko',
    );
    const paramsWithoutStoredDuration = {
      ...basePlanned.params,
      music: {
        ...basePlanned.params.music!,
        durationSeconds: undefined,
      },
    };
    const stubMedia = { url: (k: string) => `https://cdn.example/${k}` } as unknown as Parameters<typeof requestInputOf>[0]['media'];
    const stubEnvForReq = studioEnv({ BRAND_SOUND_STUDIO: 'on' });

    // (a) Customer sentence says "25초" (25), designed caption has no duration (would give 60) -> resolves 25
    const rowSentence25: JobRow = {
      id: '00000000-0000-4000-8000-0000000000d1',
      organization_id: '00000000-0000-4000-8000-000000000001',
      created_by: null,
      request_id: 'req_d1',
      kind: 'music',
      status: 'queued',
      lane: 'sunra_api',
      model: 'minimax-music-3',
      prompt: '25초 차분한 스킨케어 배경 음악',
      final_prompt: GOOD_MINIMAX_INST_CAPTION,
      enhance: true,
      params: paramsWithoutStoredDuration,
      refs: [],
      parent_output_id: null,
      estimate_usd: 0.16,
      cost_usd: null,
      estimate_krw: 260,
      usage_krw: null,
      error_code: null,
      error_detail: null,
      work: { prepared: true },
      claimed_at: null,
      attempts: 0,
      created_at: new Date(),
      started_at: null,
      finished_at: null,
    };
    const sentFromRow25 = buildStudioRequest(requestInputOf({ media: stubMedia, env: stubEnvForReq }, rowSentence25));
    expect(sentFromRow25).toEqual({
      endpoint: 'minimax/minimax-music3/text-to-music',
      body: {
        prompt: GOOD_MINIMAX_INST_CAPTION,
        duration: 25,
        is_instrumental: true,
      },
    });

    // (b) Customer sentence has NO duration (60), edited caption mentions "45 seconds" (would give 45) -> resolves 60 (ignores caption)
    const editedCaptionWith45 = GOOD_MINIMAX_INST_CAPTION.replace('skincare product video', '45 seconds skincare video');
    const rowCaption45: JobRow = {
      ...rowSentence25,
      id: '00000000-0000-4000-8000-0000000000d2',
      prompt: '차분한 스킨케어 배경 음악',
      final_prompt: editedCaptionWith45,
    };
    const sentFromRow60 = buildStudioRequest(requestInputOf({ media: stubMedia, env: stubEnvForReq }, rowCaption45));
    expect((sentFromRow60.body as { duration: number }).duration).toBe(60);
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

  it('folds readings into system/payload/fallback when present, omits when absent, drops voice on instrumentals, and types StudioMusicParams.readings without casts', async () => {
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

    // Round-2 Item 4b: typed `StudioMusicParams.readings` flows through `musicDesignInputOf` with zero type casts
    const typedFromRow = musicDesignInputOf({
      prompt: '차분한 브랜드 음악',
      organization_id: '00000000-0000-4000-8000-000000000001',
      params: {
        aspect: null,
        resolution: null,
        seconds: null,
        audio: null,
        count: 1,
        locale: 'ko',
        music: {
          mode: 'describe',
          vocal: true,
          language: 'ko',
          title: '차분한 브랜드 음악',
          careful: false,
          readings: {
            audio: 'warm Rhodes piano around 94 BPM',
            voice: 'female alto vocal',
          },
          made: { engine: 'minimax-music-3-sunra', endpoint: 'minimax/minimax-music3/text-to-music', terms: 'sound-2026-11-20' },
        },
      },
    });
    expect(typedFromRow.readings).toEqual({
      audio: 'warm Rhodes piano around 94 BPM',
      voice: 'female alto vocal',
    });

    for (const model of ['suno-v6', 'minimax-music-3'] as const) {
      const answer =
        model === 'minimax-music-3'
          ? GOOD_MINIMAX_VOCAL_KO_CAPTION.replace(' for sparkling beverage brand "모아"', '')
              .replace('upbeat bouncy groove', 'relaxed groove around 94 BPM')
              .replace('Clear mid-register lead vocal', 'Breathy female alto lead vocal')
          : GOOD_SUNO_STYLE.replace(
              'Instrumental; a soft felt piano carries the melody.',
              'A breathy female alto vocal sings in Korean.',
            );

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

describe('4. v2 wiring in music.design, real per-model profile ids in prepareMusic, and untouched v1 enhancer metadata', () => {
  it('wires MusicDesignV2Schema into music.design, records real profile ids (suno-v6, suno-v6-wild, minimax-music-3) on v2 jobs while keeping profile: "suno" on non-v2 jobs', async () => {
    // Unit check on `designMeta` vs `designMetaForModel`
    const sampleFb = fallbackDesign(baseInput(), 'no_key');
    expect(designMeta(sampleFb).profile).toBe('suno');
    expect(designMetaForModel('suno-v6', fallbackDesignForModel('suno-v6', baseInput(), 'no_key')).profile).toBe('suno-v6');
    expect(designMetaForModel('suno-v6-wild', fallbackDesignForModel('suno-v6-wild', baseInput(), 'no_key')).profile).toBe('suno-v6-wild');
    expect(designMetaForModel('minimax-music-3', fallbackDesignForModel('minimax-music-3', baseInput(), 'no_key')).profile).toBe('minimax-music-3');

    const listedFx = await studioFixture({ capKrw: 5_000_000 });
    const unlistedFx = await studioFixture({ capKrw: 5_000_000 });
    const sandboxedFx = await studioFixture({ orgId: SANDBOXED_ORG_ID, orgName: 'Neutral Name' });
    try {
      vi.stubEnv('BRAND_SOUND_COMPOSER_V2_ORGS', `${listedFx.orgId},${sandboxedFx.orgId}`);

      const provider = wrapRecordingProvider(createFakeStudioProvider({ pollsBeforeDone: 1 }));
      const stub = geminiStub(
        // 1. music.design minimax-music-3 instrumental
        { style: GOOD_MINIMAX_INST_CAPTION, title: '설계된 미니맥스', notes: '피아노 연주곡으로 설계했어요.' },
        // 2. music.design minimax-music-3 vocal with blank lyrics -> 1 call, source: 'model'
        { style: GOOD_MINIMAX_VOCAL_KO_CAPTION, title: '상쾌한 모아', notes: '청량한 보컬 곡으로 설계했어요.' },
        // 3. music.design suno-v6-wild
        { style: GOOD_SUNO_STYLE, title: '설계된 와일드', notes: '어쿠스틱 팝으로 설계했어요.' },
        // 4. prepareMusic minimax-music-3 fallback when model errors -> records profile: 'minimax-music-3' + fallback
        new Error('gemini_http_503'),
        // 5. prepareMusic suno-v6-wild -> records profile: 'suno-v6-wild' and preserves designed title in jobView
        { style: GOOD_SUNO_STYLE, title: '와일드 설계 제목', notes: '어쿠스틱 팝으로 설계했어요.' },
        // 6. prepareMusic v2 suno-v6 (`composerMode: 'simple'`) -> records profile: 'suno-v6'
        { style: GOOD_SUNO_STYLE, title: '브이식스 설계 제목', notes: '따뜻하게 설계했어요.' },
        // 7. prepareMusic non-v2 job (no v2 fields) -> keeps profile: 'suno' and suno@2026-11-21.2
        { style: GOOD_SUNO_STYLE, title: '기존 경로 제목', notes: '기존 경로로 설계했어요.' },
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
      const sandboxedDeps = studioDeps(sandboxedFx.sql, { env: liveEnv, provider });

      expect(
        await runStudioOperation(unlistedDeps, viewerOf(unlistedFx.ids.owner, 'ko'), 'music.design', {
          organizationId: unlistedFx.orgId,
          model: 'minimax-music-3',
          prompt: '차분한 피아노',
          vocal: false,
        }),
      ).toEqual({ ok: false, code: 'invalid' });

      expect(
        await runStudioOperation(sandboxedDeps, viewerOf(sandboxedFx.ids.owner, 'ko'), 'music.design', {
          organizationId: sandboxedFx.orgId,
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

      // (a) MiniMax v2 job -> stores `profile: 'minimax-music-3'`
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
        profile: 'minimax-music-3',
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

      // (b) Suno v6 Wild v2 job -> stores `profile: 'suno-v6-wild'` and `jobView` keeps Architect's designed title
      const createdWildJob = await createStudioJob(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), {
        kind: 'music',
        organizationId: listedFx.orgId,
        requestId: requestId(),
        model: 'suno-v6-wild',
        prompt: '차분한 어쿠스틱 배경 음악',
        vocal: false,
      });
      if (!('job' in createdWildJob)) throw new Error(JSON.stringify(createdWildJob));
      await advanceStudioJobsWith(listedDeps, { jobIds: [createdWildJob.job.id] });
      const wildRow = (await listedFx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [createdWildJob.job.id])).rows[0]!;
      const wildOut = (await listedFx.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [createdWildJob.job.id])).rows;
      expect(wildRow.work.enhancer).toMatchObject({
        profile: 'suno-v6-wild',
        profileVersion: musicProfileForModel('suno-v6-wild').version,
        source: 'model',
        title: '와일드 설계 제목',
      });
      expect(jobView(wildRow, wildOut, listedDeps.media).music?.title).toBe('와일드 설계 제목');

      // (c) Suno v6 v2 job (`composerMode: 'simple'`) -> stores `profile: 'suno-v6'`
      const createdV6V2Job = await createStudioJob(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), {
        kind: 'music',
        organizationId: listedFx.orgId,
        requestId: requestId(),
        model: 'suno-v6',
        composerMode: 'simple',
        prompt: '차분한 어쿠스틱 배경 음악',
        vocal: false,
      });
      if (!('job' in createdV6V2Job)) throw new Error(JSON.stringify(createdV6V2Job));
      await advanceStudioJobsWith(listedDeps, { jobIds: [createdV6V2Job.job.id] });
      const v6V2Row = (await listedFx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [createdV6V2Job.job.id])).rows[0]!;
      const v6V2Out = (await listedFx.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1 order by idx', [createdV6V2Job.job.id])).rows;
      expect(v6V2Row.work.enhancer).toMatchObject({
        profile: 'suno-v6',
        profileVersion: musicProfileForModel('suno-v6').version,
        source: 'model',
        title: '브이식스 설계 제목',
      });
      expect(jobView(v6V2Row, v6V2Out, listedDeps.media).music?.title).toBe('브이식스 설계 제목');

      // (d) Today's non-v2 job (no v2 fields) -> keeps `profile: 'suno'` and `MUSIC_PROFILE_VERSION`
      const createdV1Job = await createStudioJob(listedDeps, viewerOf(listedFx.ids.owner, 'ko'), {
        kind: 'music',
        organizationId: listedFx.orgId,
        requestId: requestId(),
        prompt: '차분한 어쿠스틱 배경 음악',
        vocal: false,
      });
      if (!('job' in createdV1Job)) throw new Error(JSON.stringify(createdV1Job));
      await advanceStudioJobsWith(listedDeps, { jobIds: [createdV1Job.job.id] });
      const v1Row = (await listedFx.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [createdV1Job.job.id])).rows[0]!;
      expect(v1Row.work.enhancer).toMatchObject({
        profile: 'suno',
        profileVersion: MUSIC_PROFILE_VERSION,
        source: 'model',
        title: '기존 경로 제목',
      });
    } finally {
      await listedFx.db.close();
      await unlistedFx.db.close();
      await sandboxedFx.db.close();
    }
  });
});

describe('5. Evaluation script: 36 fixtures + 10 probes + 36 fallbacks offline, and production MiniMax writer/judge in --v2', () => {
  it('validates all 36 stored fixtures (covering every required scenario), 10 regression probes, and all 36 fallbacks through engine.request with zero network calls', () => {
    const fixtureFile = loadV2Fixtures();
    expect(fixtureFile.cases).toHaveLength(12);
    expect((fixtureFile.regressionProbes ?? []).length).toBeGreaterThanOrEqual(6);

    // Restored Deliverable 6 fixture-set coverage assertions from HEAD~1
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

    const outTmp = resolve(process.env.TEMP ?? join(ROOT, '.tmp'), `v2-eval-stub-${Date.now()}.json`);
    const suno04Style =
      'Crisp K-indie dance-pop with a bright summer bounce, around 120 BPM, lively. A bright female vocal sings in Korean in a crisp register. ' +
      'Clean rhythm guitar strums sixteenth notes, bouncy bass drives the groove, and tight drums lift the hook. Opens straight into the hook and stops cleanly. Airy mix.';
    const mm04Caption =
      'Global Metadata: Refreshing Korean commercial dance-pop for sparkling water brand "모아", 4/4, upbeat bouncy groove, crisp modern studio production.\n' +
      'Vocal Details: Bright female lead vocal singing in Korean in a crisp upper-mid register; she sings close at the front of the mix.\n' +
      'Arrangement: Chorus: crisp rhythm guitar, bouncy synth bass, and tight drums launch straight into the sparkling hook.';

    const stub = geminiStub(
      { style: suno04Style, title: '투명한 탄산', notes: '밝게 설계했어요.' },
      { style: suno04Style, title: '투명한 탄산', notes: '밝게 설계했어요.' },
      { bpm: 120, stanzas: [['얼음 위로 부서지는 방울', '투명하게 피어나는 기포', '시원하게 채워지는 모아', '가벼워진 하루에 모아']] },
      { existing: false, confidence: 0.02 },
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
