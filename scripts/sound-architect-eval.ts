/**
 * Evaluation of the music Prompt Architect (lib/brand-studio/sound/architect.ts, docs/BRAND-SOUND-STUDIO.md §12.6;
 * Sound Studio v2 Batch B3), text only: every case goes through `designMusic` / `designMusicForModel` and the design
 * is held to the deterministic per-model rule checks. No music model is ever called.
 *
 * v2 modes (12 rough requests × 3 models = 36 cases + regression probes + fallback validation):
 *   npx tsx --conditions=react-server scripts/sound-architect-eval.ts --dry-validate
 *   npx tsx --conditions=react-server scripts/sound-architect-eval.ts [env-file] --v2 --out <path> [--only id,id] [--cap 160]
 *
 * Existing v1 modes (unchanged):
 *   npx tsx scripts/sound-architect-eval.ts <env-file> [--label after] [--out-dir <dir>] [--only id,id] [--cap 120] [--describe-only]
 *   npx tsx scripts/sound-architect-eval.ts --label before [--out-dir <dir>]        (the fallback; no model, no key)
 *   npx tsx scripts/sound-architect-eval.ts <env-file> --emit <dir> [--only id,id]  (request bodies for a paid check)
 *   npx tsx scripts/sound-architect-eval.ts --sung <dir>                            (measure downloaded MP3s; no call)
 *   npx tsx scripts/sound-architect-eval.ts <env-file> --lyrics [--model gemini-3.8-flash] [--label after] [--no-fallback]
 *   npx tsx scripts/sound-architect-eval.ts --lyrics --label before
 *
 * Safety:
 * - Reads ONLY `GEMINI_API_KEY` and `GEMINI_BASE_URL` (and optional `BRAND_STUDIO_ENHANCER_MODEL` / `BRAND_SOUND_LYRICS_MODEL`).
 *   The API key is never printed or written; every string leaving this process is scrubbed of it.
 * - `--dry-validate` installs a throwing `fetch` guard so network calls are impossible.
 * - `--v2` refuses to run without `GEMINI_API_KEY`, and `guardedFetch` allows ONLY Gemini `:generateContent` endpoints
 *   for the configured text models (never Sunra or any music generation endpoint).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import { musicProfileForModel } from '@/lib/brand-studio/enhancer/profiles/music';
import {
  checkMinimaxLyrics,
  checkMusicDesign,
  designMusic,
  designMusicForModel,
  fallbackDesign,
  fallbackDesignForModel,
  inspectMusicDesignForModel,
  markMinimaxLyrics,
  MUSIC_PROFILE_VERSION,
  parseMinimaxCaptionSections,
  partitionMusicDesignProblemsForModel,
  planProblems,
  resolveMinimaxDurationSeconds,
  subjectSentence,
  type MusicDesign,
  type MusicDesignCheckItem,
  type MusicDesignInput,
  type MusicDesignReadings,
  type MusicWords,
} from '@/lib/brand-studio/sound/architect';
import { audioSeconds } from '@/lib/brand-studio/sound/audio-info';
import { musicEngine, musicEngineOfModel, type MusicModelId } from '@/lib/brand-studio/sound/engine';
import { cleanBpm, formText, lineSyllables, stanzaLines, sungPlan, type LengthPlan } from '@/lib/brand-studio/sound/length-plan';
import { defaultStructure, markLyrics, ownLyrics, tempoOf, withoutAddedLines, type LyricStructure } from '@/lib/brand-studio/sound/lyrics';
import {
  askedLines,
  draftProblems,
  localBpm,
  localLyrics,
  LYRICS_FALLBACK_MODEL,
  writeLyrics,
  writeLyricsWithFallback,
  type LyricsRequest,
  type WrittenLyrics,
} from '@/lib/brand-studio/sound/lyrics-draft';
import { isLyricsModel, LYRICS_DEFAULT_MODEL, lyricsGeminiConfig } from '@/lib/brand-studio/sound/lyrics-model';
import { namedArtist } from '@/lib/brand-studio/sound/names';
import { writeMinimaxLyricsWithFallback } from '@/lib/brand-studio/sound/prepare-music';
import { parseRequestedSeconds } from '@/lib/brand-studio/sound/requested-seconds';
import type { MusicVideoFit } from '@/lib/brand-studio/sound/video-fit';
import { judgeExistingLyrics } from '@/lib/brand-studio/sound/warnings';

export const V2_MODELS: readonly MusicModelId[] = ['suno-v6', 'suno-v6-wild', 'minimax-music-3'] as const;
export const V2_FIXTURES_PATH = resolve(process.cwd(), 'scripts/fixtures/sound-architect/v2-fixtures.json');

export interface EvalCase {
  id: string;
  input: MusicDesignInput;
  /** A trap the design must survive: what it checks. */
  trap?: 'name' | 'existing-lyrics' | 'superlative' | 'long-brand' | 'keep-lyrics';
  /** Words that must reach the engine (the brief's brand and "꼭 넣을 말") when it is sung without written lyrics. */
  expect?: { words: string[] };
}

/** The brief's brand (bold) and its "꼭 넣을 말", the brand first, without repeats. */
export function briefWords(line: string): string[] {
  const brand = /\*\*([^*]+)\*\*/.exec(line)?.[1]?.trim();
  const must = (/꼭 넣을 말:\s*([^.]+)\./.exec(line)?.[1] ?? '').split(/[,，、]/).map((w) => w.trim()).filter(Boolean);
  return [...new Set([...(brand ? [brand] : []), ...must])].slice(0, 6);
}

/** The 16 briefs of the blind sheet: "## <id> — <kind>, 약 N초, <언어>" then "브리프: …". */
export function briefCases(sheet: string): EvalCase[] {
  const out: EvalCase[] = [];
  const blocks = sheet.split(/^## /m).slice(1);
  for (const block of blocks) {
    const head = block.split('\n')[0] ?? '';
    const id = head.split(/\s+—\s+/)[0]?.trim();
    const line = /^브리프:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const brief = line?.replace(/\*\*/g, '').trim();
    if (!id || !line || !brief) continue;
    const korean = /한국어/.test(head);
    out.push({
      id: `brief-${id}`,
      input: { prompt: brief.slice(0, 1000), vocal: true, lyrics: '', careful: false, language: korean ? 'ko' : 'en', locale: korean ? 'ko' : 'en' },
      expect: { words: briefWords(line) },
    });
  }
  return out;
}

const base = (over: Partial<MusicDesignInput>): MusicDesignInput => ({ prompt: '', vocal: false, lyrics: '', careful: false, language: 'ko', locale: 'ko', ...over });

export const EXTRA_CASES: EvalCase[] = [
  { id: 'describe-skincare-inst', input: base({ prompt: '아침 스킨케어 광고, 잔잔하고 따뜻한 어쿠스틱, 느리게' }) },
  { id: 'describe-fashion-inst', input: base({ prompt: '패션 필름, 미니멀 하우스, 차갑고 세련되게' }) },
  { id: 'describe-shortform-vocal', input: base({ prompt: '여름 음료 숏폼, 밝은 여성 보컬 팝', vocal: true }) },
  { id: 'describe-en-launch', input: base({ prompt: 'Product launch film, confident and modern, building to a clean finish', locale: 'en', language: 'en' }) },
  { id: 'trap-name', input: base({ prompt: '아이유 느낌의 잔잔한 발라드' }), trap: 'name' },
  { id: 'trap-existing-lyrics', input: base({ prompt: '밝은 팝', vocal: true, lyrics: 'Is this the real life? Is this just fantasy?' }), trap: 'existing-lyrics' },
  { id: 'trap-superlative', input: base({ prompt: '국내 최고 1위 브랜드답게 웅장하게' }), trap: 'superlative' },
  { id: 'trap-long-brand', input: base({ prompt: 'Brand film for Northwind Botanical Laboratories, calm and premium', locale: 'en', language: 'en', vocal: true }), trap: 'long-brand' },
  {
    id: 'trap-keep-lyrics',
    input: base({ prompt: '맑은 어쿠스틱 팝, 따뜻한 여성 보컬', vocal: true, lyrics: '아침 햇살이 창을 두드리면\n물 한 잔으로 하루를 열어요\n\n오늘도 맑게 오늘도 가볍게' }),
    trap: 'keep-lyrics',
  },
];

export interface Scored {
  id: string;
  /** `error`: the case threw (a timeout, a refusal); the run went on and the raw file has the message. */
  verdict: 'pass' | 'allow' | 'fail' | 'error';
  source: MusicDesign['source'];
  problems: string[];
  chars: number;
  ms: number;
}

/** The rules, without a model. The same check the studio runs, plus the traps. */
export function scoreDesign(c: EvalCase, design: MusicDesign, ms: number): Scored {
  // The studio refuses a description naming a real singer before anything is designed or reserved.
  if (namedArtist(c.input.prompt) || (c.input.vocal && namedArtist(c.input.lyrics))) {
    return { id: c.id, verdict: 'pass', source: design.source, problems: ['refused before design (name check)'], chars: 0, ms: Math.round(ms) };
  }
  const problems = design.source === 'model' ? checkMusicDesign({ style: design.style, title: design.title }, design.mode) : [];
  if (c.input.lyrics.trim() && design.lyrics !== markLyrics(c.input.vocal ? c.input.lyrics : '', c.input.structure ?? null, c.input.plan?.form ?? null)) {
    problems.push('the lyrics sent are not the planned form of the lyrics');
  }
  // The length plan (§12.11): the style keeps the planned tempo and does not contradict the form.
  if (design.source === 'model') problems.push(...planProblems(design.style, c.input));
  if (namedArtist(design.style)) problems.push('a name reached the style');
  if (c.trap === 'superlative' && /\b(best|no\.?\s*1|number one|#1)\b/i.test(design.style)) problems.push('a superlative reached the style');
  // Sung with no lyrics written: what the song is about must reach the engine (2026-11-21 real run: the brand was lost).
  if (c.input.vocal && c.expect?.words.length) {
    const sent = JSON.stringify(engineBody(c.input, design)).toLowerCase();
    for (const word of c.expect.words) if (!sent.includes(word.toLowerCase())) problems.push(`"${word}" did not reach the engine`);
  }
  const verdict: Scored['verdict'] = problems.length ? 'fail' : design.source === 'model' ? 'pass' : 'allow';
  return { id: c.id, verdict, source: design.source, problems, chars: design.style.length, ms: Math.round(ms) };
}

/** The body the engine would receive for this design (nothing is sent). */
export function engineBody(input: MusicDesignInput, design: MusicDesign): unknown {
  const engine = musicEngine({});
  return engine.request({ mode: design.mode, prompt: design.style, vocal: input.vocal, title: design.title, lyrics: design.lyrics, careful: input.careful }).body;
}

export function table(label: string, rows: readonly Scored[]): string {
  const head = `### ${label} (${MUSIC_PROFILE_VERSION})\n\n| case | verdict | source | style chars | ms | problems |\n| --- | --- | --- | --- | --- | --- |`;
  const body = rows.map((r) => `| ${r.id} | ${r.verdict} | ${r.source} | ${r.chars} | ${r.ms} | ${r.problems.join('; ') || '—'} |`);
  const count = (v: Scored['verdict']) => rows.filter((r) => r.verdict === v).length;
  return `${head}\n${body.join('\n')}\n\npass ${count('pass')} · allow ${count('allow')} · fail ${count('fail')} · error ${count('error')} of ${rows.length}\n`;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function readKeys(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(GEMINI_API_KEY|GEMINI_BASE_URL|BRAND_STUDIO_ENHANCER_MODEL|BRAND_SOUND_LYRICS_MODEL)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(
      line,
    );
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

/* ------------------------------------------------------------------ v2 per-model evaluation (Batch B3) */

export interface StoredModelFixtureOutput {
  blocked?: 'name' | 'lyrics';
  mode?: 'describe' | 'custom';
  style?: string;
  prompt?: string;
  title?: string;
  lyrics?: string;
  notes?: string | null;
  durationSeconds?: number;
}

export interface V2EvalFixtureCase {
  id: string;
  description: string;
  prompt: string;
  locale: 'ko' | 'en';
  language: 'ko' | 'en';
  vocal: boolean;
  lyrics: string;
  structure?: LyricStructure | null;
  explicitTargetSeconds: number | null;
  video?: MusicVideoFit | null;
  readings: MusicDesignReadings | null;
  words: MusicWords | null;
  expectBlocked?: 'name' | 'lyrics';
  outputs: Record<MusicModelId, StoredModelFixtureOutput>;
}

export interface V2RegressionProbe {
  id: string;
  description: string;
  model: MusicModelId;
  prompt: string;
  vocal: boolean;
  language?: 'ko' | 'en';
  readings?: MusicDesignReadings | null;
  words?: MusicWords | null;
  design: {
    style?: string;
    prompt?: string;
    title: string;
    lyrics?: string;
  };
  expectPass: boolean;
  expectCaptionClean: boolean;
  expectTitleClean: boolean;
  expectFailedCheckIds?: string[];
}

export interface V2EvalFixtureFile {
  version: string;
  cases: V2EvalFixtureCase[];
  regressionProbes?: V2RegressionProbe[];
}

export interface V2CaseEvaluation {
  caseId: string;
  model: MusicModelId;
  profileVersion: string;
  passed: boolean;
  blocked: 'name' | 'lyrics' | null;
  rewriteNeeded: boolean;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  latencyMs: number;
  checks: MusicDesignCheckItem[];
  extraProblems: string[];
  design: {
    mode?: 'describe' | 'custom';
    style?: string;
    prompt?: string;
    title?: string;
    lyrics?: string;
    notes?: string | null;
    source?: MusicDesign['source'];
    durationSeconds?: number;
  } | null;
  engineEndpoint: string | null;
  engineBody: unknown;
}

export interface V2FallbackValidation {
  caseId: string;
  model: MusicModelId;
  passed: boolean;
  problems: string[];
  endpoint: string | null;
}

export interface V2ProbeValidation {
  id: string;
  model: MusicModelId;
  passed: boolean;
  problems: string[];
}

export function loadV2Fixtures(path: string = V2_FIXTURES_PATH): V2EvalFixtureFile {
  return JSON.parse(readFileSync(path, 'utf8')) as V2EvalFixtureFile;
}

export function buildV2CaseInput(c: V2EvalFixtureCase, model: MusicModelId): {
  input: MusicDesignInput;
  sunoTargetSeconds: number | null;
  minimaxDurationSeconds: number;
} {
  const fromSentence = parseRequestedSeconds(c.prompt);
  const sunoTargetSeconds =
    c.explicitTargetSeconds ??
    (c.video ? Math.min(240, Math.max(5, Math.round(c.video.seconds))) : fromSentence !== null ? Math.min(240, Math.max(5, fromSentence)) : null);
  const minimaxDurationSeconds = resolveMinimaxDurationSeconds({
    durationSeconds: c.explicitTargetSeconds,
    video: c.video ?? null,
    prompt: c.prompt,
  });
  const own = c.vocal ? ownLyrics(c.lyrics) : '';
  const structure = c.structure ?? (sunoTargetSeconds ? defaultStructure(sunoTargetSeconds) : null);

  const plan =
    model === 'minimax-music-3'
      ? null
      : sungPlan({
          prompt: c.prompt,
          vocal: c.vocal,
          lyrics: own,
          structure,
          seconds: sunoTargetSeconds,
          draftBpm: null,
          drafted: false,
        });

  return {
    sunoTargetSeconds,
    minimaxDurationSeconds,
    input: {
      prompt: c.prompt,
      vocal: c.vocal,
      lyrics: own,
      careful: false,
      structure,
      language: c.language,
      locale: c.locale,
      words: c.words,
      video: c.video ?? null,
      plan,
      targetSeconds: model === 'minimax-music-3' ? undefined : sunoTargetSeconds,
      ...(model === 'minimax-music-3' && c.explicitTargetSeconds !== null ? { durationSeconds: c.explicitTargetSeconds } : {}),
      ...(c.readings ? { readings: c.readings } : {}),
      customerLyrics: Boolean(own),
    },
  };
}

export function enginePayloadForModel(
  model: MusicModelId,
  input: MusicDesignInput,
  design: { mode: 'describe' | 'custom'; style: string; prompt?: string; title: string; lyrics: string; durationSeconds?: number },
): { endpoint: string; body: unknown } {
  const engine = musicEngineOfModel(model);
  if (!engine) throw new Error(`unknown music engine for ${model}`);
  if (model === 'minimax-music-3') {
    const durationSeconds =
      design.durationSeconds ??
      resolveMinimaxDurationSeconds({
        durationSeconds: input.durationSeconds,
        video: input.video,
        prompt: input.prompt,
      });
    return engine.request({
      mode: design.mode,
      prompt: design.prompt ?? design.style,
      vocal: input.vocal,
      durationSeconds,
      ...(input.vocal ? { lyrics: design.lyrics } : {}),
    });
  }
  return engine.request({
    mode: design.mode,
    prompt: design.style,
    vocal: input.vocal,
    ...(design.mode === 'custom' ? { title: design.title, lyrics: design.lyrics, careful: false } : {}),
  });
}

/**
 * Evaluates one `(case, model)` result against every deterministic rule for `model` (`inspectMusicDesignForModel`),
 * customer-lyrics byte preservation, duration precedence, and exact Sunra adapter request validation.
 */
export function evaluateV2CaseOutput(
  c: V2EvalFixtureCase,
  model: MusicModelId,
  output: StoredModelFixtureOutput,
  meta: {
    source?: MusicDesign['source'];
    fallbackReason?: string | null;
    rewriteNeeded?: boolean;
    latencyMs?: number;
    lyricStageProblems?: readonly string[];
  } = {},
): V2CaseEvaluation {
  const profile = musicProfileForModel(model);
  const artistBlocked = namedArtist(c.prompt) ? ('name' as const) : c.vocal && namedArtist(c.lyrics) ? ('lyrics' as const) : null;

  if (c.expectBlocked || artistBlocked) {
    const expected = c.expectBlocked ?? artistBlocked;
    const passed = output.blocked === expected && !output.style && !output.prompt;
    const check: MusicDesignCheckItem = {
      id: 'pre_design_artist_block',
      category: 'caption',
      rule: 'Requests naming a real artist or song are refused before any model call',
      support: 'official',
      passed,
      ...(!passed ? { problem: `expected pre-design block "${expected}", got "${output.blocked ?? 'none'}"` } : {}),
    };
    return {
      caseId: c.id,
      model,
      profileVersion: profile.version,
      passed,
      blocked: output.blocked ?? null,
      rewriteNeeded: false,
      fallbackUsed: false,
      fallbackReason: null,
      latencyMs: meta.latencyMs ?? 0,
      checks: [check],
      extraProblems: passed ? [] : [check.problem!],
      design: null,
      engineEndpoint: null,
      engineBody: null,
    };
  }

  const { input, minimaxDurationSeconds } = buildV2CaseInput(c, model);
  const mode = output.mode ?? 'describe';
  const rawStyle = output.style ?? output.prompt ?? '';
  const subject = model === 'minimax-music-3' ? '' : subjectSentence(input);

  // On Suno describe-mode vocals without lyrics, `subjectSentence` is appended by us after the model paragraph check.
  let paragraphForCheck = rawStyle;
  let styleMax = model === 'minimax-music-3' ? 2000 : 1000;
  const extraProblems: string[] = [...(meta.lyricStageProblems ?? [])];

  if (model !== 'minimax-music-3' && subject) {
    styleMax = 1000 - subject.length - 1;
    if (rawStyle.endsWith(` ${subject}`)) {
      paragraphForCheck = rawStyle.slice(0, rawStyle.length - subject.length - 1);
    } else if ((meta.source ?? 'model') === 'model') {
      extraProblems.push('missing appended subjectSentence on Suno vocal describe run');
    }
  }

  const customerOwn = c.vocal ? ownLyrics(c.lyrics) : '';
  const checks =
    (meta.source ?? 'model') === 'fallback'
      ? []
      : inspectMusicDesignForModel(
          model,
          {
            style: paragraphForCheck,
            ...(model === 'minimax-music-3' ? { prompt: output.prompt ?? rawStyle } : {}),
            title: output.title ?? '',
            lyrics: output.lyrics ?? '',
          },
          {
            prompt: c.prompt,
            vocal: c.vocal,
            lyrics: output.lyrics ?? '',
            language: c.language,
            plan: input.plan ?? null,
            words: c.words,
            readings: c.readings,
            styleMax,
            customerLyrics: Boolean(customerOwn),
            source: meta.source ?? 'model',
          },
        );

  // Customer lyrics must pass through with sung lines byte-for-byte identical (including leading/trailing whitespace on every sung line).
  if (customerOwn) {
    const expectedMarked =
      model === 'minimax-music-3'
        ? markMinimaxLyrics(customerOwn, input.structure ?? null)
        : markLyrics(customerOwn, input.structure ?? null, input.plan?.form ?? null);
    if ((output.lyrics ?? '') !== expectedMarked) {
      extraProblems.push(`marked lyrics do not match deterministic section marking (expected ${JSON.stringify(expectedMarked)})`);
    }
    const ownSungLines = customerOwn.split('\n').filter((line) => line.trim() !== '');
    const sentSungLines = (output.lyrics ?? '')
      .split('\n')
      .filter((line) => line.trim() !== '' && (ownSungLines.includes(line) || !/^\[[^\]\n]{1,40}\]$/.test(line.trim())));
    if (JSON.stringify(sentSungLines) !== JSON.stringify(ownSungLines)) {
      extraProblems.push('customer sung lyric lines were altered');
    }
  }

  // MiniMax duration precedence + >75s clamp check.
  if (model === 'minimax-music-3') {
    const gotDuration = output.durationSeconds ?? minimaxDurationSeconds;
    if (gotDuration !== minimaxDurationSeconds) {
      extraProblems.push(`expected MiniMax durationSeconds ${minimaxDurationSeconds}, got ${gotDuration}`);
    }
  }

  // Exclusion preservation check on MiniMax when brief says "no drums".
  if (model === 'minimax-music-3' && /\bno drums\b/i.test(c.prompt) && (meta.source ?? 'model') === 'model') {
    if (!/\b(?:no drums|drumless|without drums|zero percussion)\b/i.test(rawStyle)) {
      extraProblems.push('MiniMax caption dropped explicit "no drums" exclusion');
    }
  }

  let engineEndpoint: string | null = null;
  let builtBody: unknown = null;
  try {
    const built = enginePayloadForModel(model, input, {
      mode,
      style: rawStyle,
      ...(output.prompt !== undefined ? { prompt: output.prompt } : {}),
      title: output.title ?? '',
      lyrics: output.lyrics ?? '',
      ...(output.durationSeconds !== undefined ? { durationSeconds: output.durationSeconds } : {}),
    });
    engineEndpoint = built.endpoint;
    builtBody = built.body;
  } catch (error) {
    extraProblems.push(`engine request build failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const checkFailures = checks.filter((item) => !item.passed);
  const fallbackUsed = meta.source === 'fallback';
  const passed = !fallbackUsed && checkFailures.length === 0 && extraProblems.length === 0;

  return {
    caseId: c.id,
    model,
    profileVersion: profile.version,
    passed,
    blocked: null,
    rewriteNeeded: meta.rewriteNeeded ?? false,
    fallbackUsed,
    fallbackReason: meta.fallbackReason ?? null,
    latencyMs: meta.latencyMs ?? 0,
    checks,
    extraProblems,
    design: {
      mode,
      style: rawStyle,
      ...(model === 'minimax-music-3' ? { prompt: output.prompt ?? rawStyle } : {}),
      title: output.title ?? '',
      lyrics: output.lyrics ?? '',
      notes: output.notes ?? null,
      source: meta.source ?? 'model',
      ...(model === 'minimax-music-3' ? { durationSeconds: output.durationSeconds ?? minimaxDurationSeconds } : {}),
    },
    engineEndpoint,
    engineBody: builtBody,
  };
}

/**
 * Validates deterministic `fallbackDesignForModel` across all 36 `(case, model)` pairs through `engine.request` (`SHOULD-FIX 7`).
 */
export function validateV2Fallbacks(fixtureFile: V2EvalFixtureFile = loadV2Fixtures()): V2FallbackValidation[] {
  const out: V2FallbackValidation[] = [];
  for (const c of fixtureFile.cases) {
    for (const model of V2_MODELS) {
      const problems: string[] = [];
      const artistHit = namedArtist(c.prompt) || (c.vocal && namedArtist(c.lyrics));
      if (c.expectBlocked || artistHit) {
        out.push({
          caseId: c.id,
          model,
          passed: Boolean(artistHit),
          problems: artistHit ? [] : ['expected pre-design artist block'],
          endpoint: null,
        });
        continue;
      }

      const { input, minimaxDurationSeconds } = buildV2CaseInput(c, model);
      const fb = fallbackDesignForModel(model, input, 'check_failed');
      if (fb.source !== 'fallback') problems.push(`expected source 'fallback', got '${fb.source}'`);
      if (fb.fallbackReason !== 'check_failed') problems.push(`expected fallbackReason 'check_failed', got '${fb.fallbackReason ?? 'none'}'`);
      if (fb.llmModel !== null) problems.push('fallback llmModel must be null');
      if (fb.notes !== null) problems.push('fallback notes must be null');
      if (fb.profileVersion !== musicProfileForModel(model).version) {
        problems.push(`fallback profileVersion mismatch: ${fb.profileVersion}`);
      }

      if (model === 'minimax-music-3') {
        const caption = fb.prompt ?? fb.style;
        if (!parseMinimaxCaptionSections(caption)) problems.push('MiniMax fallback missing three headings in order');
        if (caption.length < 200 || caption.length > 2000) problems.push(`MiniMax fallback length ${caption.length} out of 200..2000`);
        if (fb.durationSeconds !== minimaxDurationSeconds) {
          problems.push(`MiniMax fallback durationSeconds ${fb.durationSeconds} !== ${minimaxDurationSeconds}`);
        }
      } else {
        if (fb.style.length < 1 || fb.style.length > 1000) problems.push(`Suno fallback style length ${fb.style.length} out of 1..1000`);
        if (/\n/.test(fb.style)) problems.push('Suno fallback style contains newline');
      }

      let endpoint: string | null = null;
      try {
        // On MiniMax vocal runs with blank customer lyrics, `prepareMusicV2` drafts bare-tag lyrics before `engine.request`.
        const effectiveLyrics =
          model === 'minimax-music-3' && input.vocal && !fb.lyrics.trim() ? '[Chorus]\n_' : fb.lyrics;
        const built = enginePayloadForModel(model, input, {
          mode: fb.mode,
          style: fb.style,
          ...(fb.prompt !== undefined ? { prompt: fb.prompt } : {}),
          title: fb.title,
          lyrics: effectiveLyrics,
          ...(fb.durationSeconds !== undefined ? { durationSeconds: fb.durationSeconds } : {}),
        });
        endpoint = built.endpoint;
      } catch (error) {
        problems.push(`engine.request threw on fallback: ${error instanceof Error ? error.message : String(error)}`);
      }

      out.push({
        caseId: c.id,
        model,
        passed: problems.length === 0,
        problems,
        endpoint,
      });
    }
  }
  return out;
}

/**
 * Evaluates stored regression probes covering tricky check cases (`'in a ...'`, era words, supported/unsupported gender,
 * supported/mismatched/low-confidence BPM, two-problem title + clean/dirty caption, instrumental string harmonies).
 */
export function validateV2Probes(fixtureFile: V2EvalFixtureFile = loadV2Fixtures()): V2ProbeValidation[] {
  const probes = fixtureFile.regressionProbes ?? [];
  return probes.map((p) => {
    const partitioned = partitionMusicDesignProblemsForModel(
      p.model,
      p.design,
      {
        prompt: p.prompt,
        vocal: p.vocal,
        language: p.language ?? 'ko',
        lyrics: p.design.lyrics ?? '',
        readings: p.readings ?? null,
        words: p.words ?? null,
      },
    );
    const failedIds = partitioned.items.filter((i) => !i.passed).map((i) => i.id);
    const allClean =
      partitioned.captionProblems.length === 0 &&
      partitioned.titleProblems.length === 0 &&
      partitioned.lyricsProblems.length === 0;
    const captionClean = partitioned.captionProblems.length === 0;
    const titleClean = partitioned.titleProblems.length === 0;

    const problems: string[] = [];
    if (allClean !== p.expectPass) {
      problems.push(`expected overall pass=${p.expectPass}, got ${allClean} (failed: ${failedIds.join(', ') || 'none'})`);
    }
    if (captionClean !== p.expectCaptionClean) {
      problems.push(`expected captionClean=${p.expectCaptionClean}, got ${captionClean} (${partitioned.captionProblems.join('; ')})`);
    }
    if (titleClean !== p.expectTitleClean) {
      problems.push(`expected titleClean=${p.expectTitleClean}, got ${titleClean} (${partitioned.titleProblems.join('; ')})`);
    }
    if (p.expectFailedCheckIds) {
      const expectedSorted = [...p.expectFailedCheckIds].sort().join(',');
      const actualSorted = [...failedIds].sort().join(',');
      if (actualSorted !== expectedSorted) {
        problems.push(`expected failed check ids [${expectedSorted}], got [${actualSorted}]`);
      }
    }

    return {
      id: p.id,
      model: p.model,
      passed: problems.length === 0,
      problems,
    };
  });
}

/**
 * Offline `--dry-validate`: runs all 36 `(12 cases × 3 models)` stored fixture outputs, all 36 deterministic fallbacks
 * through `engine.request`, and all regression probes with zero network calls.
 */
export function validateV2Fixtures(fixtureFile: V2EvalFixtureFile = loadV2Fixtures()): {
  passed: boolean;
  total: number;
  passCount: number;
  failCount: number;
  results: V2CaseEvaluation[];
  fallbacks: V2FallbackValidation[];
  probes: V2ProbeValidation[];
} {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('network_forbidden_in_dry_validate');
  }) as unknown as typeof fetch;

  try {
    const results: V2CaseEvaluation[] = [];
    for (const c of fixtureFile.cases) {
      for (const model of V2_MODELS) {
        const stored = c.outputs[model];
        if (!stored) {
          results.push({
            caseId: c.id,
            model,
            profileVersion: musicProfileForModel(model).version,
            passed: false,
            blocked: null,
            rewriteNeeded: false,
            fallbackUsed: false,
            fallbackReason: null,
            latencyMs: 0,
            checks: [],
            extraProblems: [`missing fixture output for ${c.id} (${model})`],
            design: null,
            engineEndpoint: null,
            engineBody: null,
          });
          continue;
        }
        results.push(evaluateV2CaseOutput(c, model, stored, { source: 'model', rewriteNeeded: false, latencyMs: 0 }));
      }
    }
    const fallbacks = validateV2Fallbacks(fixtureFile);
    const probes = validateV2Probes(fixtureFile);

    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.length - passCount;
    const fallbacksPassed = fallbacks.every((f) => f.passed);
    const probesPassed = probes.length >= 6 && probes.every((p) => p.passed);

    return {
      passed: failCount === 0 && results.length === 36 && fallbacksPassed && probesPassed,
      total: results.length,
      passCount,
      failCount,
      results,
      fallbacks,
      probes,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function formatV2EvalSummary(
  results: readonly V2CaseEvaluation[],
  modeLabel: 'dry-validate' | 'live-v2',
  extras?: { fallbacks?: readonly V2FallbackValidation[]; probes?: readonly V2ProbeValidation[] },
): string {
  const lines: string[] = [
    `# Sound Prompt Architect v2 (${modeLabel}) — ${results.length} runs`,
    '',
  ];
  for (const r of results) {
    const checkSummary = r.checks.length
      ? r.checks.map((c) => `${c.id}:${c.passed ? 'PASS' : 'FAIL'}`).join(', ')
      : 'fallback(no-model-checks)';
    const status = r.passed ? 'PASS' : 'FAIL';
    lines.push(
      `[${status}] ${r.caseId} | ${r.model} (${r.profileVersion}) | rewrite=${r.rewriteNeeded} | fallback=${r.fallbackUsed}${r.fallbackReason ? `(${r.fallbackReason})` : ''} | ${r.latencyMs}ms | ${checkSummary}${r.extraProblems.length ? ` | extra=${r.extraProblems.join('; ')}` : ''}`,
    );
  }
  if (extras?.probes?.length) {
    lines.push('', `# Regression probes — ${extras.probes.length} cases`);
    for (const p of extras.probes) {
      lines.push(`[${p.passed ? 'PASS' : 'FAIL'}] ${p.id} | ${p.model}${p.problems.length ? ` | ${p.problems.join('; ')}` : ''}`);
    }
  }
  if (extras?.fallbacks?.length) {
    const fbPass = extras.fallbacks.filter((f) => f.passed).length;
    lines.push('', `# Deterministic fallbacks — ${fbPass}/${extras.fallbacks.length} valid through engine.request`);
    for (const f of extras.fallbacks.filter((x) => !x.passed)) {
      lines.push(`[FAIL] fallback ${f.caseId} | ${f.model} | ${f.problems.join('; ')}`);
    }
  }
  const passCount = results.filter((r) => r.passed).length;
  const fbSuffix = extras?.fallbacks
    ? `, fallbacks ${extras.fallbacks.filter((f) => f.passed).length}/${extras.fallbacks.length}`
    : '';
  const probeSuffix = extras?.probes
    ? `, probes ${extras.probes.filter((p) => p.passed).length}/${extras.probes.length}`
    : '';
  lines.push('', `Summary: ${passCount}/${results.length} passed, ${results.length - passCount} failed${probeSuffix}${fbSuffix}.`);
  return lines.join('\n');
}

export async function runLiveV2Eval(options: {
  env: Record<string, string | undefined>;
  outPath: string;
  only?: readonly string[];
  cap?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ passed: boolean; results: V2CaseEvaluation[] }> {
  const architectConfig = studioGeminiConfig(options.env);
  if (!architectConfig) {
    throw new Error(
      'Refusing to run --v2: GEMINI_API_KEY is required (provide an env file with GEMINI_API_KEY or set GEMINI_API_KEY in the environment).',
    );
  }
  const secret = options.env.GEMINI_API_KEY ?? '';
  const scrub = (text: string) => (secret ? text.split(secret).join('<redacted>') : text);

  const lyricsConfig = lyricsGeminiConfig(options.env);
  const allowedModels = [
    architectConfig.model,
    lyricsConfig?.model,
    lyricsConfig ? LYRICS_FALLBACK_MODEL : undefined,
  ].filter((m): m is string => Boolean(m));

  const guarded = guardedFetch(allowedModels, options.cap ?? 160, options.fetchImpl ?? fetch);
  const fixtureFile = loadV2Fixtures();
  const cases = fixtureFile.cases.filter((c) => !options.only?.length || options.only.includes(c.id));
  const results: V2CaseEvaluation[] = [];

  for (const c of cases) {
    for (const model of V2_MODELS) {
      const started = performance.now();
      const artistHit = namedArtist(c.prompt) ? ('name' as const) : c.vocal && namedArtist(c.lyrics) ? ('lyrics' as const) : null;
      if (artistHit) {
        results.push(
          evaluateV2CaseOutput(
            c,
            model,
            { blocked: artistHit },
            { latencyMs: Math.round(performance.now() - started) },
          ),
        );
        continue;
      }

      const calls: CallTime[] = [];
      let rejectedCount = 0;
      const fetcher = timedFetch(guarded, calls);
      const log = (event: string, detail?: Record<string, unknown>) => {
        if (event === 'studio_music_design_rejected') rejectedCount += 1;
        console.error(scrub(`${event} ${JSON.stringify(detail ?? {})}`));
      };

      const { input, minimaxDurationSeconds } = buildV2CaseInput(c, model);
      let effectiveInput = input;
      const lyricStageProblems: string[] = [];

      // SHOULD-FIX 6 / item 9: match production `prepareMusicV2` (`writeMinimaxLyricsWithFallback` + `judgeExistingLyrics`).
      if (model === 'minimax-music-3' && c.vocal && !ownLyrics(c.lyrics) && lyricsConfig) {
        const structure = c.structure ?? defaultStructure(minimaxDurationSeconds);
        const req: LyricsRequest = {
          flow: 'topic',
          topic: c.prompt,
          language: c.language,
          seconds: minimaxDurationSeconds,
          bpm: cleanBpm(/(\d{2,3})\s*bpm/i.exec(c.prompt)?.[1]),
          structure,
          tone: null,
          brand: c.words?.brand ? { name: c.words.brand.name, ...(c.words.brand.readAs ? { readAs: c.words.brand.readAs } : {}) } : null,
          mustInclude: c.words?.mustInclude ? [...c.words.mustInclude] : [],
        };
        const written = await writeMinimaxLyricsWithFallback(req, lyricsConfig, fetcher, log);
        const rawLyrics = ownLyrics(written.text);
        const marked = rawLyrics ? markMinimaxLyrics(rawLyrics, structure) : '';
        if (!marked) {
          lyricStageProblems.push('MiniMax lyric draft returned empty lyrics');
        } else {
          const lyricIssues = checkMinimaxLyrics(marked);
          if (lyricIssues.length > 0) {
            lyricStageProblems.push(...lyricIssues);
          } else {
            const verdict = await judgeExistingLyrics(rawLyrics, lyricsConfig, fetcher, log);
            if (verdict === 'existing') lyricStageProblems.push('MiniMax drafted lyrics flagged as existing song');
            else if (verdict !== 'original') lyricStageProblems.push('MiniMax lyrics originality judge failed');
          }
        }
        effectiveInput = {
          ...input,
          lyrics: marked,
          structure,
          customerLyrics: false,
        };
      }

      const design = await designMusicForModel(model, effectiveInput, {
        fetch: fetcher,
        env: options.env,
        log,
      });
      const latencyMs = Math.round(performance.now() - started);
      const evaluated = evaluateV2CaseOutput(
        c,
        model,
        {
          mode: design.mode,
          style: design.style,
          ...(design.prompt !== undefined ? { prompt: design.prompt } : {}),
          title: design.title,
          lyrics: design.lyrics,
          notes: design.notes,
          ...(design.durationSeconds !== undefined ? { durationSeconds: design.durationSeconds } : {}),
        },
        {
          source: design.source,
          fallbackReason: design.fallbackReason ?? null,
          rewriteNeeded: rejectedCount > 0,
          latencyMs,
          lyricStageProblems,
        },
      );
      results.push(evaluated);
    }
  }

  const summary = scrub(formatV2EvalSummary(results, 'live-v2'));
  console.log(summary);

  const outFile = resolve(options.outPath);
  mkdirSync(dirname(outFile), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    textModel: architectConfig.model,
    lyricsModel: lyricsConfig?.model ?? null,
    totalRuns: results.length,
    passedRuns: results.filter((r) => r.passed).length,
    failedRuns: results.filter((r) => !r.passed).length,
    results,
  };
  writeFileSync(outFile, `${scrub(JSON.stringify(payload, null, 2))}\n`, 'utf8');
  console.log(scrub(`Wrote full JSON outputs (${results.length} runs) to ${outFile}`));

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}

/* ------------------------------------------------------------------ the lyrics engine (SA2) */

export interface LyricsCase {
  id: string;
  req: LyricsRequest;
  trap?: 'name' | 'superlative' | 'reading' | 'polish' | 'keep-lyrics';
}

/** The 16 briefs as lyric requests: "약 N초" is the length, "꼭 넣을 말" the words, the bold name the brand. */
export function lyricsBriefCases(sheet: string): LyricsCase[] {
  const out: LyricsCase[] = [];
  for (const block of sheet.split(/^## /m).slice(1)) {
    const head = block.split('\n')[0] ?? '';
    const id = head.split(/\s+—\s+/)[0]?.trim();
    const line = /^브리프:\s*(.+)$/m.exec(block)?.[1]?.trim();
    if (!id || !line) continue;
    const seconds = Number(/약\s*(\d+)\s*초/.exec(head)?.[1] ?? 30);
    const brand = /\*\*([^*]+)\*\*/.exec(line)?.[1]?.trim() ?? null;
    const must = /꼭 넣을 말:\s*([^.]+)\./.exec(line)?.[1] ?? '';
    out.push({
      id: `lyrics-${id}`,
      req: {
        flow: 'topic',
        topic: line.replace(/\*\*/g, '').slice(0, 1000),
        language: /한국어/.test(head) ? 'ko' : 'en',
        seconds,
        bpm: tempoOf(line),
        structure: defaultStructure(seconds),
        tone: null,
        brand: brand ? { name: brand } : null,
        mustInclude: must.split(/[,，、]/).map((w) => w.trim()).filter((w) => w && w !== brand).slice(0, 5),
      },
    });
  }
  return out;
}

const lyricsBase = (over: Partial<LyricsRequest>): LyricsRequest => ({
  flow: 'topic',
  topic: '',
  language: 'ko',
  seconds: 30,
  structure: 'hook',
  tone: 'haeyo',
  brand: null,
  mustInclude: [],
  ...over,
});

/** The real-screen check of 2026-11-21: 30 s chosen, 3 lines came back, both versions 16 s (§12.10, §12.11). */
export const LENGTH_FIT_TOPIC = '레몬 탄산수 광고, 상쾌하고 가볍게, 밝은 여성 보컬';

export const LYRICS_TRAPS: LyricsCase[] = [
  { id: 'length-15-lemon', req: lyricsBase({ topic: LENGTH_FIT_TOPIC, seconds: 15, structure: 'hook', tone: null, brand: { name: '모아' } }) },
  { id: 'length-30-lemon', req: lyricsBase({ topic: LENGTH_FIT_TOPIC, seconds: 30, structure: 'hook', tone: null, brand: { name: '모아' } }) },
  { id: 'length-60-lemon', req: lyricsBase({ topic: LENGTH_FIT_TOPIC, seconds: 60, structure: 'hook-verse', tone: null, brand: { name: '모아' } }) },
  { id: 'trap-lyrics-name', trap: 'name', req: lyricsBase({ topic: '아이유 느낌의 잔잔한 카페 광고 노래' }) },
  { id: 'trap-lyrics-superlative', trap: 'superlative', req: lyricsBase({ topic: '업계 최고, 1위 정수기라고 강조하는 광고 노래' }) },
  { id: 'trap-lyrics-reading', trap: 'reading', req: lyricsBase({ topic: '친환경 세제 광고, 밝게', brand: { name: 'Ecofin', readAs: '에코핀' } }) },
  {
    id: 'trap-lyrics-polish',
    trap: 'polish',
    req: lyricsBase({ flow: 'polish', topic: '아침 스킨케어 광고', lyrics: '아침마다 거울 앞에서 나는 나에게 인사를 건네곤 해요\n\n하루결과 함께라면 오늘도 괜찮을 것 같아요', brand: { name: '하루결' } }),
  },
  {
    id: 'trap-lyrics-keep',
    trap: 'keep-lyrics',
    req: lyricsBase({ flow: 'polish', lyrics: '  들여 쓴 첫 줄.\r\n둘째 줄!\r\n\r\n\r\n(oh) 마지막 절 🌿' }),
  },
];

export interface LyricsScored {
  id: string;
  verdict: 'pass' | 'allow' | 'fail' | 'error';
  /** The model that wrote them (the fast model when the first one timed out). */
  model?: string;
  source: 'model' | 'local' | 'blocked' | 'none';
  syllables: number;
  /** The tempo the draft was planned at, and its lines per stanza against the plan at that tempo ("4 / 4"). */
  bpm?: number;
  lines?: string;
  problems: string[];
  ms: number;
}

/** The rules, without a model: the engine's own check, and the customer's lyrics unchanged on the way out. */
export function scoreLyrics(c: LyricsCase, text: string | null, source: LyricsScored['source'], ms: number, bpm?: number): LyricsScored {
  const round = Math.round(ms);
  if (c.trap === 'keep-lyrics') {
    // "내 가사 그대로": what the engine receives, minus the added marks and [End], is the customer's text.
    const original = c.req.lyrics ?? '';
    const problems: string[] = [];
    for (const structure of ['hook', 'hook-verse', 'full'] as const) {
      if (withoutAddedLines(markLyrics(original, structure), original) !== ownLyrics(original)) problems.push(`changed under ${structure}`);
    }
    return { id: c.id, verdict: problems.length ? 'fail' : 'pass', source: 'none', syllables: 0, problems, ms: round };
  }
  if (source === 'blocked') return { id: c.id, verdict: 'pass', source, syllables: 0, problems: ['refused before a call (name check)'], ms: round };
  if (text === null) return { id: c.id, verdict: 'allow', source, syllables: 0, problems: ['no lyrics after the rewrite (the screen says it could not draft)'], ms: round };
  const tempo = bpm ?? localBpm(c.req);
  const found = draftProblems(c.req, text, tempo);
  const syllables = (text.match(/[가-힣]/g) ?? []).length;
  const asked = askedLines(c.req, tempo);
  const lines = `${stanzaLines(text).join('/')}${asked ? ` / plan ${asked.join('/')}` : ''}`;
  const verdict: LyricsScored['verdict'] = found.hard.length ? 'fail' : found.soft.length ? 'allow' : 'pass';
  return { id: c.id, verdict, source, syllables, bpm: tempo, lines, problems: [...found.hard, ...found.soft], ms: round };
}

export function lyricsTable(label: string, model: string, rows: readonly LyricsScored[]): string {
  const head = `### lyrics ${label} (${model})\n\n| case | verdict | source | written by | bpm | lines | syllables | ms | problems |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |`;
  const body = rows.map(
    (r) => `| ${r.id} | ${r.verdict} | ${r.source} | ${r.model ?? '—'} | ${r.bpm ?? '—'} | ${r.lines ?? '—'} | ${r.syllables || '—'} | ${r.ms} | ${r.problems.join('; ') || '—'} |`,
  );
  const count = (v: LyricsScored['verdict']) => rows.filter((r) => r.verdict === v).length;
  return [head, ...body, '', `pass ${count('pass')} · allow ${count('allow')} · fail ${count('fail')} · error ${count('error')} of ${rows.length}`].join('\n');
}

/** A fetch that counts calls, stops at the cap, and only lets the expected Gemini text models through (never Sunra / music models). */
export function guardedFetch(model: string | readonly string[], cap: number, inner: typeof fetch = fetch): typeof fetch & { calls: () => number } {
  const models = typeof model === 'string' ? [model] : [...model];
  let calls = 0;
  const wrapped = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!models.some((m) => href.includes(`/models/${m}:`))) throw new Error(`stopped: a call to a model other than ${models.join(' or ')}`);
    calls += 1;
    if (calls > cap) throw new Error(`stopped: more than ${cap} calls`);
    return inner(url as string, init);
  }) as typeof fetch & { calls: () => number };
  wrapped.calls = () => calls;
  return wrapped;
}

/* ------------------------------------------------------------------ running cases, and what is kept */

export type CaseRun<T> = { id: string; ok: true; value: T; ms: number } | { id: string; ok: false; error: string; ms: number };

/** Runs each case on its own: one case's error (a timeout, a refusal) is recorded and the rest still run. */
export async function runCases<T>(ids: readonly string[], run: (id: string) => Promise<T>): Promise<Array<CaseRun<T>>> {
  const out: Array<CaseRun<T>> = [];
  for (const id of ids) {
    const started = performance.now();
    try {
      const value = await run(id);
      out.push({ id, ok: true, value, ms: Math.round(performance.now() - started) });
    } catch (error) {
      out.push({ id, ok: false, error: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) });
    }
  }
  return out;
}

export interface CallTime {
  model: string;
  ms: number;
  ok?: boolean;
}

/** Every call's model and time, read from the request URL (the eval keeps them per case). */
export function timedFetch(inner: typeof fetch, calls: CallTime[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const model = /\/models\/([^:]+):/.exec(String(url))?.[1] ?? '?';
    const started = performance.now();
    try {
      const response = await inner(url as string, init);
      calls.push({ model, ms: Math.round(performance.now() - started), ok: response.ok });
      return response;
    } catch (error) {
      calls.push({ model, ms: Math.round(performance.now() - started), ok: false });
      throw error;
    }
  }) as typeof fetch;
}

export interface RawEntry {
  id: string;
  input: unknown;
  lyrics: { text: string | null; model: string; bpm?: number } | null;
  /** The length plan the run would send (§12.11). */
  plan?: LengthPlan | null;
  design: MusicDesign | null;
  body: unknown;
  calls: readonly CallTime[];
  error: string | null;
}

/** One case in full, as text: what the table cannot show (the 2026-11-21 run needed the design itself to see the lost brand). */
export function rawSection(entry: RawEntry, scrub: (text: string) => string): string {
  const fence = (lang: string, value: string) => `\`\`\`${lang}\n${value}\n\`\`\``;
  const parts = [
    `## ${entry.id}`,
    '',
    `calls: ${entry.calls.length ? entry.calls.map((c) => `${c.model} ${c.ms} ms${c.ok === false ? ' (failed)' : ''}`).join(', ') : 'none'}`,
    '',
    'input:',
    fence('json', JSON.stringify(entry.input, null, 2)),
  ];
  if (entry.lyrics) {
    const text = entry.lyrics.text;
    parts.push('', `lyrics (${entry.lyrics.model}${entry.lyrics.bpm ? `, planned at ${entry.lyrics.bpm} BPM` : ''}):`, fence('text', text ?? '(none: the rules still failed after the rewrite)'));
    if (text) parts.push(`lines per stanza: ${stanzaLines(text).join('/')}; syllables per line: ${text.split('\n').filter((l) => l.trim()).map(lineSyllables).join(' ')}`);
  }
  if (entry.plan) {
    parts.push(
      '',
      `plan: ${entry.plan.bpm} BPM (${entry.plan.band}), ${entry.plan.seconds ?? '—'} s, ${entry.plan.bars} of ${entry.plan.targetBars} bars planned, ${entry.plan.enough ? 'enough' : `short by ${entry.plan.missingLines} lines`}, expected ${entry.plan.estimate.min}–${entry.plan.estimate.max} s`,
      `form: ${formText(entry.plan.form)}`,
    );
  }
  if (entry.design) parts.push('', 'design:', fence('json', JSON.stringify(entry.design, null, 2)));
  if (entry.body) parts.push('', 'engine body (not sent):', fence('json', JSON.stringify(entry.body, null, 2)));
  if (entry.error) parts.push('', `error: ${entry.error}`);
  return scrub(`${parts.join('\n')}\n`);
}

function measureSung(dir: string): void {
  const rows = ['| file | seconds | last 3 s mean dB | transcript |', '| --- | --- | --- | --- |'];
  for (const name of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.mp3')).sort()) {
    const path = join(dir, name);
    const seconds = audioSeconds(new Uint8Array(readFileSync(path)), 'audio/mpeg');
    let tail = 'not measured (no ffmpeg)';
    if (seconds) {
      const run = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(Math.max(0, seconds - 3)), '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
      tail = /mean_volume:\s*(-?[\d.]+)/.exec(`${run.stderr ?? ''}${run.stdout ?? ''}`)?.[1] ?? tail;
    }
    rows.push(`| ${name} | ${seconds?.toFixed(2) ?? '?'} | ${tail} | not run (no speech model here) |`);
  }
  console.log(rows.join('\n'));
}

function writeOut(outDir: string, name: string, tableText: string, raw: readonly string[], scrub: (text: string) => string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.md`), scrub(tableText));
  writeFileSync(join(outDir, `${name}-raw.md`), scrub(`# ${name}: every case in full\n\n${raw.join('\n')}`));
  console.log(scrub(tableText));
  console.log(`\nfull text: ${join(outDir, `${name}-raw.md`)}`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--dry-validate')) {
    const validated = validateV2Fixtures();
    console.log(
      formatV2EvalSummary(validated.results, 'dry-validate', {
        fallbacks: validated.fallbacks,
        probes: validated.probes,
      }),
    );
    if (!validated.passed) {
      process.exit(1);
    }
    return;
  }

  if (process.argv.includes('--v2')) {
    const envArg = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : null;
    if (envArg && !existsSync(envArg)) {
      throw new Error(`env file not found: ${envArg}`);
    }
    const fileKeys = envArg ? readKeys(envArg) : {};
    const mergedEnv: Record<string, string | undefined> = {
      GEMINI_API_KEY: fileKeys.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY,
      GEMINI_BASE_URL: fileKeys.GEMINI_BASE_URL ?? process.env.GEMINI_BASE_URL,
      BRAND_STUDIO_ENHANCER_MODEL: fileKeys.BRAND_STUDIO_ENHANCER_MODEL ?? process.env.BRAND_STUDIO_ENHANCER_MODEL,
      BRAND_SOUND_LYRICS_MODEL: fileKeys.BRAND_SOUND_LYRICS_MODEL ?? process.env.BRAND_SOUND_LYRICS_MODEL,
    };
    const outPath = arg('--out') ?? 'sound-architect-eval/v2-results.json';
    const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
    const cap = Number(arg('--cap') ?? 160);
    const live = await runLiveV2Eval({ env: mergedEnv, outPath, only, cap });
    if (!live.passed) {
      process.exit(1);
    }
    return;
  }

  const sung = arg('--sung');
  if (sung) return measureSung(resolve(sung));
  const envFile = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : null;
  const label = arg('--label') ?? (envFile ? 'after' : 'before');
  const only = arg('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const cap = Number(arg('--cap') ?? 120);
  const outDir = resolve(arg('--out-dir') ?? 'sound-architect-eval');
  const sheet = readFileSync(resolve('docs/research/brand-sound-studio-2026-11-20/lyrics-blind-sheet.md'), 'utf8');
  const cases = [...briefCases(sheet), ...EXTRA_CASES].filter((c) => !only || only.includes(c.id));

  const emit = arg('--emit');
  if (emit) {
    // Request bodies for a paid check, from the fallback design: no text-model call, no music made.
    mkdirSync(resolve(emit), { recursive: true });
    for (const c of cases) writeFileSync(join(resolve(emit), `${c.id}.json`), `${JSON.stringify(engineBody(c.input, fallbackDesign(c.input)), null, 2)}\n`);
    console.log(`wrote ${cases.length} request bodies to ${resolve(emit)} (nothing was sent)`);
    return;
  }

  const keys = envFile && existsSync(envFile) ? readKeys(envFile) : {};
  if (process.argv.includes('--lyrics')) return runLyrics(sheet, label, only, cap, outDir, keys);
  const env: Record<string, string | undefined> = label === 'before' ? {} : { GEMINI_API_KEY: keys.GEMINI_API_KEY, GEMINI_BASE_URL: keys.GEMINI_BASE_URL };
  const config = studioGeminiConfig(env);
  if (label !== 'before' && !config) throw new Error('no GEMINI_API_KEY in the env file');
  // The product path (the dock, 2026-11-21): sung with no lyrics, the lyrics are drafted first and the design is
  // made for them. `--describe-only` scores the other path (drafting failed or the Architect is off).
  const firstLyrics = !process.argv.includes('--describe-only');
  const lyricsConfig = config && firstLyrics ? lyricsGeminiConfig(env) : null;
  const allowed = [config?.model, lyricsConfig?.model, lyricsConfig ? LYRICS_FALLBACK_MODEL : undefined].filter((m): m is string => Boolean(m));
  const guarded = config ? guardedFetch(allowed, cap) : null;
  const scrub = (text: string) => (keys.GEMINI_API_KEY ? text.split(keys.GEMINI_API_KEY).join('<key>') : text);
  const log = (event: string, detail?: Record<string, unknown>) => console.error(scrub(`${event} ${JSON.stringify(detail ?? {})}`));
  const lyricsReqs = new Map(lyricsBriefCases(sheet).map((l) => [l.id.replace(/^lyrics-/, 'brief-'), l.req]));

  const raw: string[] = [];
  const runs = await runCases(cases.map((c) => c.id), async (id) => {
    const c = cases.find((x) => x.id === id)!;
    const calls: CallTime[] = [];
    const entry: RawEntry = { id, input: c.input, lyrics: null, design: null, body: null, calls, error: null };
    try {
      if (!guarded) {
        entry.design = fallbackDesign(c.input);
      } else {
        const fetcher = timedFetch(guarded, calls);
        let input = c.input;
        const req = lyricsReqs.get(id);
        if (lyricsConfig && req && input.vocal && !input.lyrics.trim() && !namedArtist(input.prompt)) {
          const written: WrittenLyrics = await writeLyricsWithFallback(req, lyricsConfig, fetcher, log);
          entry.lyrics = written;
          if (written.text) {
            // As the dock sends it: the lyrics, the length and the draft's tempo make the plan the run keeps.
            const plan = sungPlan({ prompt: input.prompt, vocal: true, lyrics: written.text, structure: req.structure, seconds: req.seconds, draftBpm: written.bpm, drafted: true });
            entry.plan = plan;
            input = { ...input, lyrics: written.text, structure: req.structure, plan };
          }
        }
        entry.design = await designMusic(input, { fetch: fetcher, env, log });
        entry.input = input;
      }
      entry.body = engineBody(entry.input as MusicDesignInput, entry.design);
      return { design: entry.design, input: entry.input as MusicDesignInput };
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      raw.push(rawSection(entry, scrub));
    }
  });
  const rows: Scored[] = runs.map((run) => {
    const c = cases.find((x) => x.id === run.id)!;
    if (!run.ok) return { id: run.id, verdict: 'error', source: 'fallback', problems: [run.error], chars: 0, ms: run.ms };
    return scoreDesign({ ...c, input: run.value.input }, run.value.design, run.ms);
  });
  writeOut(outDir, label, table(label, rows), raw, scrub);
}

async function runLyrics(sheet: string, label: string, only: string[] | undefined, cap: number, outDir: string, keys: Record<string, string>): Promise<void> {
  const picked = arg('--model') ?? LYRICS_DEFAULT_MODEL;
  if (!isLyricsModel(picked)) throw new Error(`--model must be one of the compared models, not ${picked}`);
  const fallback = !process.argv.includes('--no-fallback');
  const cases = [...lyricsBriefCases(sheet), ...LYRICS_TRAPS].filter((c) => !only || only.includes(c.id));
  const env: Record<string, string | undefined> =
    label === 'before' ? {} : { GEMINI_API_KEY: keys.GEMINI_API_KEY, GEMINI_BASE_URL: keys.GEMINI_BASE_URL, BRAND_SOUND_LYRICS_MODEL: picked };
  const config = lyricsGeminiConfig(env);
  if (label !== 'before' && !config) throw new Error('no GEMINI_API_KEY in the env file');
  const guarded = config ? guardedFetch(fallback ? [config.model, LYRICS_FALLBACK_MODEL] : [config.model], cap) : null;
  const scrub = (text: string) => (keys.GEMINI_API_KEY ? text.split(keys.GEMINI_API_KEY).join('<key>') : text);
  const log = (event: string, detail: Record<string, unknown>) => console.error(scrub(`${event} ${JSON.stringify(detail)}`));
  const raw: string[] = [];
  const runs = await runCases(cases.map((c) => c.id), async (id): Promise<LyricsScored> => {
    const c = cases.find((x) => x.id === id)!;
    const calls: CallTime[] = [];
    const entry: RawEntry = { id, input: c.req, lyrics: null, design: null, body: null, calls, error: null };
    const started = performance.now();
    try {
      if (c.trap === 'keep-lyrics') return scoreLyrics(c, null, 'none', 0);
      const asked = [c.req.topic, c.req.lyrics ?? '', c.req.brand?.name ?? '', ...c.req.mustInclude].join('\n');
      if (namedArtist(asked)) return scoreLyrics(c, null, 'blocked', performance.now() - started);
      if (!config || !guarded) {
        entry.lyrics = { text: localLyrics(c.req), model: 'local', bpm: localBpm(c.req) };
        if (c.req.flow === 'topic') entry.plan = sungPlan({ prompt: c.req.topic, vocal: true, lyrics: entry.lyrics.text, structure: c.req.structure, seconds: c.req.seconds, draftBpm: entry.lyrics.bpm, drafted: true });
        return scoreLyrics(c, entry.lyrics.text, 'local', performance.now() - started, entry.lyrics.bpm);
      }
      const fetcher = timedFetch(guarded, calls);
      const written: WrittenLyrics = fallback
        ? await writeLyricsWithFallback(c.req, config, fetcher, log)
        : await writeLyrics(c.req, config, fetcher, log).then((w) => ({ text: w?.text ?? null, bpm: w?.bpm ?? localBpm(c.req), model: config.model }));
      entry.lyrics = written;
      if (written.text && c.req.flow === 'topic') {
        entry.plan = sungPlan({ prompt: c.req.topic, vocal: true, lyrics: written.text, structure: c.req.structure, seconds: c.req.seconds, draftBpm: written.bpm, drafted: true });
      }
      return { ...scoreLyrics(c, written.text, 'model', performance.now() - started, written.bpm), model: written.model };
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      raw.push(rawSection(entry, scrub));
    }
  });
  const rows: LyricsScored[] = runs.map((run) =>
    run.ok ? run.value : { id: run.id, verdict: 'error', source: 'model', syllables: 0, problems: [run.error], ms: run.ms },
  );
  writeOut(outDir, `lyrics-${label}`, lyricsTable(label, config?.model ?? 'local', rows), raw, scrub);
}

if (process.argv[1] && /sound-architect-eval\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
