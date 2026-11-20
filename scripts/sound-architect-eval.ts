/**
 * Evaluation of the music Prompt Architect (lib/brand-studio/sound/architect.ts, docs/BRAND-SOUND-STUDIO.md §12.6),
 * text only: every case goes through `designMusic` and the design is held to the rule check without a model.
 * No music is made, ever: `--emit` only writes request bodies to files, `--sung` only measures files already
 * downloaded.
 *
 *   npx tsx scripts/sound-architect-eval.ts <env-file> [--label after] [--out-dir <dir>] [--only id,id] [--cap 120] [--describe-only]
 *   npx tsx scripts/sound-architect-eval.ts --label before [--out-dir <dir>]        (the fallback; no model, no key)
 *   npx tsx scripts/sound-architect-eval.ts <env-file> --emit <dir> [--only id,id]  (request bodies for a paid check)
 *   npx tsx scripts/sound-architect-eval.ts --sung <dir>                            (measure downloaded MP3s; no call)
 *
 * - Reads ONLY `GEMINI_API_KEY` and `GEMINI_BASE_URL` from <env-file>, inside this process; the key is never printed
 *   or written, and every string that leaves the process is scrubbed of it.
 * - Every request URL must name an expected model (the Architect's, and for lyrics drafted first the lyrics model and
 *   its fast fallback); the run stops at the first other one.
 * - One case's error (a timeout, a refusal) is recorded as `error` and the run goes on. Next to the table,
 *   `<label>-raw.md` keeps every case in full: the input, the lyrics and the model that wrote them, the design, the
 *   body the engine would get, and each call's model and time (eval fixes, 2026-11-21).
 * - Sung with no lyrics, the design run follows the product (the dock drafts the lyrics first, then designs for them;
 *   about 1-2 more calls per such case on the lyrics model). `--describe-only` scores the path without lyrics, where
 *   the brand and the words to include must still reach the engine.
 * - The fetch counts calls and stops at `--cap` (default 120).
 * - Cases: the 16 briefs of the lyrics blind comparison (docs/research/…/lyrics-blind-sheet.md), descriptions
 *   without lyrics, and traps (a singer's name, a line of existing lyrics, a superlative, a long English brand name,
 *   the customer's own lyrics that must reach the engine unchanged).
 * - Verdicts: `pass` = the model's design holds every rule. `allow` = the fallback was used (the run still goes, the
 *   customer's words with basic directions). `fail` = a design that breaks a rule reached the engine, or the
 *   customer's lyrics changed.
 * - `--lyrics` (SA2, §12.3): the lyrics engine instead of the style design. The 16 briefs become lyric requests
 *   (length, structure for that length, brand, words to include, language from the sheet), plus traps (a singer's
 *   name, a superlative, an English brand with a Korean reading (scored like any brand: Latin vs Hangul is the founder's call, §12.8 e), a polish of the customer's lyrics, the customer's
 *   lyrics sent as written). `--model <id>` picks one of the five compared models (default: the server default);
 *   `--label before` scores the local fixed text (no model). Verdicts: `pass` = every rule, `allow` = only soft
 *   rules broken (syllables by tempo, hook, finals, register, stanza count), `fail` = a hard rule broken or the customer's
 *   lyrics changed on the way to the engine.
 *
 *     npx tsx scripts/sound-architect-eval.ts <env-file> --lyrics [--model gemini-3.8-flash] [--label after] [--no-fallback]
 *   By default a timed-out first model hands the case to gemini-3.8-flash once, as the studio does; the table names
 *   who wrote each. `--no-fallback` keeps a model comparison to the one model.
 *     npx tsx scripts/sound-architect-eval.ts --lyrics --label before
 * - `--sung <dir>`: for each MP3 the measured length and the loudness of the last 3 seconds (ffmpeg); transcription
 *   is not run here (no speech model in the repository): the column says so.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import { checkMusicDesign, designMusic, fallbackDesign, MUSIC_PROFILE_VERSION, type MusicDesign, type MusicDesignInput } from '@/lib/brand-studio/sound/architect';
import { musicEngine } from '@/lib/brand-studio/sound/engine';
import { audioSeconds } from '@/lib/brand-studio/sound/audio-info';
import { defaultStructure, markLyrics, ownLyrics, tempoOf, withoutAddedLines } from '@/lib/brand-studio/sound/lyrics';
import { draftProblems, LYRICS_FALLBACK_MODEL, localLyrics, writeLyrics, writeLyricsWithFallback, type LyricsRequest } from '@/lib/brand-studio/sound/lyrics-draft';
import { isLyricsModel, LYRICS_DEFAULT_MODEL, lyricsGeminiConfig } from '@/lib/brand-studio/sound/lyrics-model';
import { namedArtist } from '@/lib/brand-studio/sound/names';

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
  if (c.input.lyrics.trim() && design.lyrics !== markLyrics(c.input.vocal ? c.input.lyrics : '', c.input.structure ?? null)) problems.push("the customer's lyrics changed");
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
    const m = /^\s*(GEMINI_API_KEY|GEMINI_BASE_URL)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
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

export const LYRICS_TRAPS: LyricsCase[] = [
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
  problems: string[];
  ms: number;
}

/** The rules, without a model: the engine's own check, and the customer's lyrics unchanged on the way out. */
export function scoreLyrics(c: LyricsCase, text: string | null, source: LyricsScored['source'], ms: number): LyricsScored {
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
  const found = draftProblems(c.req, text);
  const syllables = (text.match(/[가-힣]/g) ?? []).length;
  const verdict: LyricsScored['verdict'] = found.hard.length ? 'fail' : found.soft.length ? 'allow' : 'pass';
  return { id: c.id, verdict, source, syllables, problems: [...found.hard, ...found.soft], ms: round };
}

export function lyricsTable(label: string, model: string, rows: readonly LyricsScored[]): string {
  const head = `### lyrics ${label} (${model})\n\n| case | verdict | source | written by | syllables | ms | problems |\n| --- | --- | --- | --- | --- | --- | --- |`;
  const body = rows.map((r) => `| ${r.id} | ${r.verdict} | ${r.source} | ${r.model ?? '—'} | ${r.syllables || '—'} | ${r.ms} | ${r.problems.join('; ') || '—'} |`);
  const count = (v: LyricsScored['verdict']) => rows.filter((r) => r.verdict === v).length;
  return [head, ...body, '', `pass ${count('pass')} · allow ${count('allow')} · fail ${count('fail')} · error ${count('error')} of ${rows.length}`].join('\n');
}

/** A fetch that counts calls, stops at the cap, and only lets the expected models through. */
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
  lyrics: { text: string | null; model: string } | null;
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
  if (entry.lyrics) parts.push('', `lyrics (${entry.lyrics.model}):`, fence('text', entry.lyrics.text ?? '(none: the rules still failed after the rewrite)'));
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

function writeOut(outDir: string, name: string, table: string, raw: readonly string[], scrub: (text: string) => string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.md`), scrub(table));
  writeFileSync(join(outDir, `${name}-raw.md`), scrub(`# ${name}: every case in full\n\n${raw.join('\n')}`));
  console.log(scrub(table));
  console.log(`\nfull text: ${join(outDir, `${name}-raw.md`)}`);
}

async function main(): Promise<void> {
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
          entry.lyrics = await writeLyricsWithFallback(req, lyricsConfig, fetcher, log);
          if (entry.lyrics.text) input = { ...input, lyrics: entry.lyrics.text, structure: req.structure };
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
  // The studio's own way by default (a timed-out first model hands over to the fast one once); `--no-fallback` keeps a
  // model comparison to the one model.
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
        entry.lyrics = { text: localLyrics(c.req), model: 'local' };
        return scoreLyrics(c, entry.lyrics.text, 'local', performance.now() - started);
      }
      const fetcher = timedFetch(guarded, calls);
      entry.lyrics = fallback
        ? await writeLyricsWithFallback(c.req, config, fetcher, log)
        : { text: await writeLyrics(c.req, config, fetcher, log), model: config.model };
      return { ...scoreLyrics(c, entry.lyrics.text, 'model', performance.now() - started), model: entry.lyrics.model };
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
