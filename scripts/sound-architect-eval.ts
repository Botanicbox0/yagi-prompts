/**
 * Evaluation of the music Prompt Architect (lib/brand-studio/sound/architect.ts, docs/BRAND-SOUND-STUDIO.md §12.6),
 * text only: every case goes through `designMusic` and the design is held to the rule check without a model.
 * No music is made, ever: `--emit` only writes request bodies to files, `--sung` only measures files already
 * downloaded.
 *
 *   npx tsx scripts/sound-architect-eval.ts <env-file> [--label after] [--out-dir <dir>] [--only id,id] [--cap 120]
 *   npx tsx scripts/sound-architect-eval.ts --label before [--out-dir <dir>]        (the fallback; no model, no key)
 *   npx tsx scripts/sound-architect-eval.ts <env-file> --emit <dir> [--only id,id]  (request bodies for a paid check)
 *   npx tsx scripts/sound-architect-eval.ts --sung <dir>                            (measure downloaded MP3s; no call)
 *
 * - Reads ONLY `GEMINI_API_KEY` and `GEMINI_BASE_URL` from <env-file>, inside this process; the key is never printed
 *   or written, and every string that leaves the process is scrubbed of it.
 * - Every request URL must name the model the Architect is set to use; the run stops at the first other one.
 * - The fetch counts calls and stops at `--cap` (default 120).
 * - Cases: the 16 briefs of the lyrics blind comparison (docs/research/…/lyrics-blind-sheet.md), descriptions
 *   without lyrics, and traps (a singer's name, a line of existing lyrics, a superlative, a long English brand name,
 *   the customer's own lyrics that must reach the engine unchanged).
 * - Verdicts: `pass` = the model's design holds every rule. `allow` = the fallback was used (the run still goes, the
 *   customer's words with basic directions). `fail` = a design that breaks a rule reached the engine, or the
 *   customer's lyrics changed.
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
import { withSections } from '@/lib/brand-studio/sound/lyrics';
import { namedArtist } from '@/lib/brand-studio/sound/names';

export interface EvalCase {
  id: string;
  input: MusicDesignInput;
  /** A trap the design must survive: what it checks. */
  trap?: 'name' | 'existing-lyrics' | 'superlative' | 'long-brand' | 'keep-lyrics';
}

/** The 16 briefs of the blind sheet: "## <id> — <kind>, 약 N초, <언어>" then "브리프: …". */
export function briefCases(sheet: string): EvalCase[] {
  const out: EvalCase[] = [];
  const blocks = sheet.split(/^## /m).slice(1);
  for (const block of blocks) {
    const head = block.split('\n')[0] ?? '';
    const id = head.split(/\s+—\s+/)[0]?.trim();
    const brief = /^브리프:\s*(.+)$/m.exec(block)?.[1]?.replace(/\*\*/g, '').trim();
    if (!id || !brief) continue;
    const korean = /한국어/.test(head);
    out.push({
      id: `brief-${id}`,
      input: { prompt: brief.slice(0, 1000), vocal: true, lyrics: '', careful: false, language: korean ? 'ko' : 'en', locale: korean ? 'ko' : 'en' },
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
  verdict: 'pass' | 'allow' | 'fail';
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
  if (c.input.lyrics.trim() && design.lyrics !== withSections(c.input.vocal ? c.input.lyrics.trim() : '')) problems.push("the customer's lyrics changed");
  if (namedArtist(design.style)) problems.push('a name reached the style');
  if (c.trap === 'superlative' && /\b(best|no\.?\s*1|number one|#1)\b/i.test(design.style)) problems.push('a superlative reached the style');
  const verdict: Scored['verdict'] = problems.length ? 'fail' : design.source === 'model' ? 'pass' : 'allow';
  return { id: c.id, verdict, source: design.source, problems, chars: design.style.length, ms: Math.round(ms) };
}

export function table(label: string, rows: readonly Scored[]): string {
  const head = `### ${label} (${MUSIC_PROFILE_VERSION})\n\n| case | verdict | source | style chars | ms | problems |\n| --- | --- | --- | --- | --- | --- |`;
  const body = rows.map((r) => `| ${r.id} | ${r.verdict} | ${r.source} | ${r.chars} | ${r.ms} | ${r.problems.join('; ') || '—'} |`);
  const count = (v: Scored['verdict']) => rows.filter((r) => r.verdict === v).length;
  return `${head}\n${body.join('\n')}\n\npass ${count('pass')} · allow ${count('allow')} · fail ${count('fail')} of ${rows.length}\n`;
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

/** A fetch that counts calls, stops at the cap, and only lets the expected model through. */
export function guardedFetch(model: string, cap: number, inner: typeof fetch = fetch): typeof fetch & { calls: () => number } {
  let calls = 0;
  const wrapped = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!href.includes(`/models/${model}:`)) throw new Error(`stopped: a call to a model other than ${model}`);
    calls += 1;
    if (calls > cap) throw new Error(`stopped: more than ${cap} calls`);
    return inner(url as string, init);
  }) as typeof fetch & { calls: () => number };
  wrapped.calls = () => calls;
  return wrapped;
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
    const engine = musicEngine({});
    for (const c of cases) {
      const d = fallbackDesign(c.input);
      const body = engine.request({ mode: d.mode, prompt: d.style, vocal: c.input.vocal, title: d.title, lyrics: d.lyrics, careful: c.input.careful });
      writeFileSync(join(resolve(emit), `${c.id}.json`), `${JSON.stringify(body, null, 2)}\n`);
    }
    console.log(`wrote ${cases.length} request bodies to ${resolve(emit)} (nothing was sent)`);
    return;
  }

  const keys = envFile && existsSync(envFile) ? readKeys(envFile) : {};
  const env: Record<string, string | undefined> = label === 'before' ? {} : { GEMINI_API_KEY: keys.GEMINI_API_KEY, GEMINI_BASE_URL: keys.GEMINI_BASE_URL };
  const config = studioGeminiConfig(env);
  if (label !== 'before' && !config) throw new Error('no GEMINI_API_KEY in the env file');
  const fetcher = config ? guardedFetch(config.model, cap) : (async () => { throw new Error('no model in a "before" run'); }) as unknown as typeof fetch;
  const scrub = (text: string) => (keys.GEMINI_API_KEY ? text.split(keys.GEMINI_API_KEY).join('<key>') : text);

  const rows: Scored[] = [];
  for (const c of cases) {
    const started = performance.now();
    const design = label === 'before' ? fallbackDesign(c.input) : await designMusic(c.input, { fetch: fetcher, env, log: (event, detail) => console.error(scrub(`${event} ${JSON.stringify(detail ?? {})}`)) });
    rows.push(scoreDesign(c, design, performance.now() - started));
  }
  const text = table(label, rows);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${label}.md`), scrub(text));
  console.log(scrub(text));
}

if (process.argv[1] && /sound-architect-eval\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
