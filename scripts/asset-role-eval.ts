/**
 * Live evaluation of the upload category check (lib/brand-studio/asset-role.ts, docs/BRAND-STUDIO-V3.md §4.1):
 * every labelled picture is thumbnailed exactly as an upload is (512 px WebP, `thumbnailWebp`), read once by
 * the real model, and the server rule (`roleFromFacts`) decides save or leave empty. Nothing is generated.
 *
 *   npx tsx scripts/asset-role-eval.ts <env-file> --set <dir> --labels <labels.json> [--out <facts.json>]
 *       [--cap 80] [--concurrency 4] [--only a.png,b.png]
 *   npx tsx scripts/asset-role-eval.ts --facts <facts.json> --labels <labels.json>    (re-score, no calls)
 *
 * - Reads ONLY `GEMINI_API_KEY` (and `GEMINI_BASE_URL`) from <env-file>, inside this process. The key is never
 *   printed or written; every string that leaves the process is scrubbed of it.
 * - The model is the studio default (`gemini-4-hydrogen`); a request for any other model stops the run.
 * - <labels.json>: `[{ "file": "x.png", "label": "product|person|logo|style|place|other|ambiguous",
 *   "clear": true|false, "accept": ["product"] }]`. `accept` lists the roles that would not mislead the writer if
 *   saved; it defaults to `[label]` for the five roles and to `[]` for `other` and `ambiguous`. A saved role
 *   outside `accept` is a wrong save. `clear` marks pictures a careful person labels without hesitation; the
 *   target is every clear picture saved with its label. Pictures and labels live outside the repository.
 * - `--out` keeps every answer (facts, latency, tokens) so `--facts` can re-score a changed rule for free.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { STUDIO_ASSET_ROLES, type StudioAssetRole } from '@/lib/brand-studio/contracts';
import { assetRoleFactsSchema, readAssetRoleFacts, roleFromFacts, type AssetRoleFacts } from '@/lib/brand-studio/asset-role';
import { studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import { thumbnailWebp } from '@/lib/brand-studio/files';

const EXPECTED_MODEL = 'gemini-4-hydrogen';

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const at = argv.indexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1]! : null;
}
function intFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = flag(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return n;
}

type GeminiEnv = { GEMINI_API_KEY?: string; GEMINI_BASE_URL?: string };
/** Only these two names are read from the file; every other line is skipped unparsed. */
function readGeminiEnv(path: string): GeminiEnv {
  const out: GeminiEnv = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(GEMINI_API_KEY|GEMINI_BASE_URL)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2]!.trim();
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    const value = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, '').trim();
    if (value) out[m[1] as keyof GeminiEnv] = value;
  }
  return out;
}

let SECRET = '';
const scrub = (text: string): string => (SECRET ? text.split(SECRET).join('[redacted]') : text);
const say = (text: string) => console.log(scrub(text));

interface Label {
  file: string;
  label: StudioAssetRole | 'ambiguous';
  clear: boolean;
  accept?: StudioAssetRole[];
}
interface Answer {
  file: string;
  facts: AssetRoleFacts | null;
  ms: number;
  tokens: { input: number; output: number; thinking: number };
}

const accepted = (l: Label): StudioAssetRole[] =>
  l.accept ?? (l.label === 'other' || l.label === 'ambiguous' ? [] : [l.label]);

const state = { calls: 0, cap: 80, stop: '' };

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Checks the model, counts calls against the cap and reads the token usage of each answer. */
function meteredFetch(onUsage: (u: Answer['tokens']) => void): typeof fetch {
  return async (input, init) => {
    const model = /\/models\/([^/:]+):generateContent/.exec(requestUrl(input))?.[1] ?? '?';
    if (model !== EXPECTED_MODEL) {
      state.stop = `request for model ${model}`;
      throw new Error('unexpected_model');
    }
    if (state.calls >= state.cap) throw new Error('call_cap_reached');
    state.calls += 1;
    const response = await fetch(input, init);
    if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      state.stop = `API refused a request (HTTP ${response.status})`;
    }
    try {
      const body = (await response.clone().json()) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
      const u = body.usageMetadata ?? {};
      onUsage({ input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0 });
    } catch {
      // No usage on a failed answer.
    }
    return response;
  };
}

async function askAll(envFile: string, dir: string, labels: Label[]): Promise<Answer[]> {
  const env = readGeminiEnv(envFile);
  SECRET = env.GEMINI_API_KEY ?? '';
  const config = studioGeminiConfig({ GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_BASE_URL: env.GEMINI_BASE_URL });
  if (!config) throw new Error('no GEMINI_API_KEY in the env file');
  if (config.model !== EXPECTED_MODEL) throw new Error(`studio model is ${config.model}, expected ${EXPECTED_MODEL}`);
  const concurrency = intFlag('--concurrency', 4, 1, 8);
  const answers: Answer[] = [];
  let next = 0;
  async function worker() {
    while (next < labels.length && !state.stop) {
      const item = labels[next++]!;
      const thumb = await thumbnailWebp(new Uint8Array(readFileSync(join(dir, item.file))));
      let tokens = { input: 0, output: 0, thinking: 0 };
      const t0 = performance.now();
      const facts = await readAssetRoleFacts(config!, meteredFetch((u) => (tokens = u)), { bytes: thumb, mime: 'image/webp' });
      answers.push({ file: item.file, facts, ms: Math.round(performance.now() - t0), tokens });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return answers;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
}

function report(labels: Label[], answers: Answer[]): void {
  const byFile = new Map(answers.map((a) => [a.file, a]));
  const cols = [...STUDIO_ASSET_ROLES.filter((r) => r !== 'other'), 'blank', 'failed'] as const;
  const rows = ['product', 'person', 'logo', 'style', 'place', 'other', 'ambiguous'] as const;
  const table = new Map<string, Map<string, number>>(rows.map((r) => [r, new Map(cols.map((c) => [c, 0]))]));
  let saved = 0, blank = 0, failed = 0, wrong = 0, clear = 0, clearSaved = 0;
  const wrongs: string[] = [];
  const missedClear: string[] = [];
  for (const l of labels) {
    const a = byFile.get(l.file);
    if (!a) continue;
    const verdict = a.facts ? roleFromFacts(a.facts) : undefined;
    const col = verdict === undefined ? 'failed' : verdict === null ? 'blank' : verdict;
    const row = table.get(l.label)!;
    row.set(col, (row.get(col) ?? 0) + 1);
    if (verdict === undefined) failed += 1;
    else if (verdict === null) blank += 1;
    else {
      saved += 1;
      if (!accepted(l).includes(verdict)) {
        wrong += 1;
        wrongs.push(`${l.file} (${l.label}) saved as ${verdict} ${JSON.stringify(a.facts)}`);
      }
    }
    if (l.clear) {
      clear += 1;
      if (verdict === l.label) clearSaved += 1;
      else missedClear.push(`${l.file} (${l.label}) -> ${col} ${JSON.stringify(a.facts)}`);
    }
  }
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  say(`\nlabel \\ saved   ${cols.map((c) => pad(c, 8)).join('')}`);
  for (const r of rows) {
    const row = table.get(r)!;
    const total = [...row.values()].reduce((x, y) => x + y, 0);
    if (total) say(`${r.padEnd(10)} ${pad(total, 3)}  ${cols.map((c) => pad(row.get(c) ?? 0, 8)).join('')}`);
  }
  const ms = answers.filter((a) => a.facts).map((a) => a.ms);
  const sum = (k: keyof Answer['tokens']) => answers.reduce((s, a) => s + a.tokens[k], 0);
  say(`\nset ${labels.length} | saved ${saved} | blank ${blank} | failed ${failed} | wrong saved ${wrong}`);
  say(`clear ${clear} | clear saved with its label ${clearSaved} (${clear ? Math.round((clearSaved / clear) * 1000) / 10 : 0} %)`);
  say(`latency median ${median(ms)} ms | max ${ms.length ? Math.max(...ms) : 0} ms`);
  say(`tokens input ${sum('input')} | output ${sum('output')} | thinking ${sum('thinking')} | calls this run ${state.calls}`);
  if (wrongs.length) say(`\nwrong saves:\n  ${wrongs.join('\n  ')}`);
  if (missedClear.length) say(`\nclear pictures not saved with their label:\n  ${missedClear.join('\n  ')}`);
}

async function main() {
  const labelsPath = flag('--labels');
  if (!labelsPath) throw new Error('--labels <labels.json> is required');
  let labels = JSON.parse(readFileSync(resolve(labelsPath), 'utf8')) as Label[];
  const only = flag('--only');
  if (only) {
    const keep = new Set(only.split(','));
    labels = labels.filter((l) => keep.has(l.file));
  }
  const factsPath = flag('--facts');
  let answers: Answer[];
  if (factsPath) {
    answers = (JSON.parse(readFileSync(resolve(factsPath), 'utf8')) as Answer[]).map((a) => ({
      ...a,
      facts: a.facts ? assetRoleFactsSchema.parse(a.facts) : null,
    }));
    say(`asset-role-eval: re-scoring ${answers.length} saved answers (no calls)`);
  } else {
    const envFile = argv[0];
    const dir = flag('--set');
    if (!envFile || envFile.startsWith('--') || !dir) throw new Error('usage: <env-file> --set <dir> --labels <labels.json>');
    state.cap = intFlag('--cap', 80, 1, 400);
    say(`asset-role-eval: ${labels.length} pictures, cap ${state.cap}, model ${EXPECTED_MODEL}`);
    answers = await askAll(envFile, resolve(dir), labels);
    const out = flag('--out');
    if (out) writeFileSync(resolve(out), scrub(JSON.stringify(answers, null, 1)));
    if (state.stop) say(`stopped early: ${state.stop}`);
  }
  report(labels, answers);
}

main().catch((error) => {
  console.log(scrub(`asset-role-eval failed: ${String((error as Error)?.message ?? error)}`).slice(0, 300));
  process.exitCode = 1;
});
