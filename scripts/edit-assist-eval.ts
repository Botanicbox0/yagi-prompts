/**
 * Live evaluation of "말로 편집" (docs/BRAND-EDITING-STUDIO.md §4.5): every instruction in
 * tests/brand-studio/edit-assist/cases.ts through `planEditAssist` against the real model, text only.
 *
 *   npx tsx scripts/edit-assist-eval.ts <env-file> [--out-dir <dir>] [--only id,id] [--reruns 2] [--cap 150] [--concurrency 3]
 *
 * - Reads ONLY `GEMINI_API_KEY` (and `GEMINI_BASE_URL` when set) from <env-file>, inside this process. The key
 *   is never printed or written; every string that leaves the process is scrubbed of it.
 * - The model is the feature's own (`editAssistGeminiConfig`). The run stops before the first call unless it
 *   is exactly `gemini-4-hydrogen`, and every request URL is checked against it.
 * - Each case is fed as the unit tests feed it (fixture timeline, instruction, locale, playhead / selection).
 *   The screen's own `draftFrom` (apply + `diffTimelines`) turns the answer into deltas, compared the way
 *   `cases.test.ts` compares them: deltas and `isInstantEdit`, resolved ask choices, the cannot reason; a
 *   `problems` case is held to its `live` answer.
 * - Verdicts: `pass` = exact. `acceptable` = one of the defensible readings declared per case in `LENIENT`
 *   (fixed before any live run, each with its reason). Everything else is `fail`, including every error,
 *   `could_not_plan` and `unavailable`.
 * - Each first-pass `fail` runs `--reruns` more times, to tell a stable failure from a flaky one.
 * - Hard cap on model calls for the whole run (default 150): past it the run stops and says so.
 *
 * Writes `<out-dir>/<model>-<n>-<timestamp>.json` (default: the OS temp folder) and prints a short summary.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { draftFrom } from '@/components/brand-studio/compose/assist/assist-model';
import { parseComposeChatCommand } from '@/lib/brand-studio/compose/chat-intent';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { applyEditSteps, resolveEditPlan } from '@/lib/brand-studio/edit-assist/apply';
import { buildEditContext } from '@/lib/brand-studio/edit-assist/context';
import { isInstantEdit, sameValue, type EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import { parseEditPlan, type AskAbout, type AskChoice } from '@/lib/brand-studio/edit-assist/plan';
import {
  AssistPlanInputSchema,
  EDIT_ASSIST_DEFAULT_MODEL,
  editAssistGeminiConfig,
  planEditAssist,
  type AssistCannotReason,
  type AssistPlanResult,
} from '@/lib/brand-studio/edit-assist/service';
import { EDIT_ASSIST_CASE_IDS, EDIT_ASSIST_CASES, type EditAssistCase } from '@/tests/brand-studio/edit-assist/cases';
import { assistFixture } from '@/tests/brand-studio/edit-assist/fixture';

const EXPECTED_MODEL = 'gemini-4-hydrogen';
const ORG = '00000000-0000-4000-8000-000000000000';
const EPS = 1e-6;

/* ------------------------------------------------------------------ args, env, secrets */

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = flag(name);
  const n = raw === undefined ? fallback : Number(raw);
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

/* ------------------------------------------------------------------ counted model calls */

type CallStatus = number | 'threw' | 'refused_by_cap' | 'refused_wrong_model';

interface CallRecord {
  ms: number;
  status: CallStatus;
  model: string;
  finishReason?: string;
  answer?: string;
  error?: string;
  usage?: unknown;
}

const state = { calls: 0, cap: 150, capReached: false, stop: '' as string };

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A fetch that checks the model in the URL, counts every call against the cap and records what came back. */
function countedFetch(records: CallRecord[]): typeof fetch {
  return async (input, init) => {
    const model = /\/models\/([^/:]+):generateContent/.exec(requestUrl(input))?.[1] ?? '?';
    if (model !== EXPECTED_MODEL) {
      state.stop = `request for model ${model}`;
      records.push({ ms: 0, status: 'refused_wrong_model', model });
      throw new Error('unexpected_model');
    }
    if (state.calls >= state.cap) {
      state.capReached = true;
      records.push({ ms: 0, status: 'refused_by_cap', model });
      throw new Error('call_cap_reached');
    }
    state.calls += 1;
    const record: CallRecord = { ms: 0, status: 'threw', model };
    records.push(record);
    const t0 = performance.now();
    try {
      const response = await fetch(input, init);
      const body = await response.clone().text();
      record.ms = Math.round(performance.now() - t0);
      record.status = response.status;
      if (!response.ok) {
        record.error = scrub(body).replace(/\s+/g, ' ').slice(0, 600);
        // A refused request (schema, key, model) will refuse every case: stop instead of burning the cap.
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          state.stop = `API refused a request (HTTP ${response.status})`;
        }
      } else {
        try {
          const json = JSON.parse(body) as {
            candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }>;
            usageMetadata?: unknown;
          };
          const candidate = json.candidates?.[0];
          record.finishReason = candidate?.finishReason;
          record.answer = scrub(
            (candidate?.content?.parts ?? [])
              .filter((p) => !p.thought && typeof p.text === 'string')
              .map((p) => p.text as string)
              .join(''),
          ).slice(0, 4000);
          if (json.usageMetadata) record.usage = json.usageMetadata;
        } catch {
          record.error = `unparseable body: ${scrub(body).slice(0, 300)}`;
        }
      }
      return response;
    } catch (error) {
      record.ms = Math.round(performance.now() - t0);
      record.error = scrub(`${(error as Error)?.name}: ${(error as Error)?.message}`).slice(0, 300);
      throw error;
    }
  };
}

/* ------------------------------------------------------------------ outcome as the screen sees it */

type Outcome =
  | { kind: 'draft'; deltas: EditDelta[]; instant: boolean; final: ComposerProject }
  | { kind: 'nothing' }
  | { kind: 'stale' }
  | { kind: 'undo' }
  | { kind: 'ask'; about: AskAbout; choices: AskChoice[] }
  | { kind: 'cannot'; reason: AssistCannotReason }
  | { kind: 'error'; message: string };

/** The screen's path: `draftFrom` applies steps or patches to ITS timeline and diffs the result. */
function outcomeOf(result: AssistPlanResult, real: ComposerProject): Outcome {
  switch (result.kind) {
    case 'undo':
      return { kind: 'undo' };
    case 'ask':
      return { kind: 'ask', about: result.about, choices: result.choices };
    case 'cannot':
      return { kind: 'cannot', reason: result.reason };
    case 'plan':
    case 'patches': {
      const drafted = draftFrom(
        real,
        result.kind === 'plan' ? { kind: 'plan', steps: result.steps } : { kind: 'patches', patches: result.patches, base: real },
      );
      if (drafted.type !== 'draft') return { kind: drafted.type };
      return { kind: 'draft', deltas: drafted.deltas, instant: isInstantEdit(drafted.deltas), final: drafted.draft };
    }
  }
}

/** The timeline the case's own canned answer produces: shows what differs when the deltas agree. */
function caseReplyFinal(c: EditAssistCase): ComposerProject | null {
  const parsed = parseEditPlan(c.reply);
  if (!parsed.ok || parsed.plan.kind !== 'plan') return null;
  const timeline = assistFixture();
  const { refs } = buildEditContext(timeline, c.context ?? {});
  const resolved = resolveEditPlan(parsed.plan.steps, refs);
  if (!resolved.ok) return null;
  const applied = applyEditSteps(timeline, resolved.steps);
  return applied.problems.length > 0 ? null : applied.project;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function timelineSummary(p: ComposerProject) {
  return {
    aspect: p.aspect,
    clips: p.clips.map((c) => ({
      src: c.srcUrl,
      trim: [r2(c.trimStartSec), r2(c.trimEndSec)],
      volume: c.volume,
      muted: c.muted,
      ...(c.playbackRate !== undefined ? { rate: c.playbackRate } : {}),
    })),
    captions: p.captions
      .map((c) => ({ text: c.text, from: r2(c.startSec), to: r2(c.endSec), position: c.position, size: c.size }))
      .sort((a, b) => a.from - b.from || a.text.localeCompare(b.text)),
    music: p.bgm ? { volume: p.bgm.volume } : null,
    look: p.colorGrade && p.colorGrade.enabled ? { preset: p.colorGrade.presetId, intensity: p.colorGrade.intensity } : null,
  };
}

/* ------------------------------------------------------------------ expectations and verdicts */

type Verdict = 'pass' | 'acceptable' | 'fail';

function expectedOf(c: EditAssistCase) {
  const e = c.expect;
  switch (e.kind) {
    case 'plan':
      return { kind: 'plan' as const, deltas: e.deltas, instant: e.instant };
    case 'ask':
      return { kind: 'ask' as const, about: e.about, choices: e.choices };
    case 'cannot':
      return { kind: 'cannot' as const, reason: e.reason };
    case 'problems':
      return { kind: 'cannot' as const, reason: e.live.reason, fromProblemsCase: true };
  }
}

const expectedDeltas = (c: EditAssistCase): EditDelta[] => (c.expect.kind === 'plan' ? c.expect.deltas : []);

/** Properties the instruction names that no delta carries (a caption's place and size). Null = fine. */
const NAMED: Record<string, (final: ComposerProject) => string | null> = {
  'ko-caption-whole-top-small': (p) => {
    const cap = p.captions.find((x) => x.text === '#광고');
    return cap && cap.position === 'top' && cap.size === 'sm' ? null : `asked top + small, got ${cap?.position}/${cap?.size}`;
  },
  'ko-caption-move-up': (p) => {
    const position = p.captions.find((x) => x.id === 'cap-hello')?.position;
    return position === 'top' ? null : `caption 1 position ${position}, table expects top`;
  },
};

type Lenient = (o: Outcome, c: EditAssistCase) => string | null;

function only<K extends EditDelta['kind']>(o: Outcome, kind: K): Extract<EditDelta, { kind: K }> | null {
  if (o.kind !== 'draft' || o.deltas.length !== 1) return null;
  const delta = o.deltas[0]!;
  return delta.kind === kind ? (delta as Extract<EditDelta, { kind: K }>) : null;
}

const isClip = (choice: AskChoice): choice is { clipId: string } => typeof choice === 'object' && 'clipId' in choice;
const isCaption = (choice: AskChoice): choice is { captionId: string } => typeof choice === 'object' && 'captionId' in choice;
const fmt = (n: number) => String(r2(n));

/** "좀 줄여줘" / "a bit": no number given, so any clear lowering that does not mute is a fair reading. */
const musicLoweredABit: Lenient = (o, c) => {
  const m = only(o, 'music_volume');
  const want = expectedDeltas(c)[0];
  return m && m.beforePct === 60 && m.afterPct >= 20 && m.afterPct <= 50
    ? `No number was given ("a bit"); music went down 60% → ${m.afterPct}% (table: ${want && want.kind === 'music_volume' ? want.afterPct : '?'}%), not muted.`
    : null;
};

/** "마지막에 …" / "at the end": the end is given, the duration is not. */
const captionAtEnd: Lenient = (o, c) => {
  if (o.kind !== 'draft') return null;
  const want = expectedDeltas(c);
  const cap = o.deltas.find((x) => x.kind === 'caption_added');
  const wantCap = want.find((x) => x.kind === 'caption_added');
  if (!cap || cap.kind !== 'caption_added' || !wantCap || wantCap.kind !== 'caption_added') return null;
  const length = cap.toSec - cap.fromSec;
  const sameRest = sameValue(
    o.deltas.filter((x) => x !== cap),
    want.filter((x) => x !== wantCap),
  );
  return cap.text === wantCap.text && Math.abs(cap.toSec - wantCap.toSec) < EPS && length >= 1 && length <= 5 && sameRest
    ? `No duration was given; the caption ends with the video as asked but shows ${fmt(length)} s (${fmt(cap.fromSec)}–${fmt(cap.toSec)}) instead of the default 2.5 s.`
    : null;
};

/** A cut named by what it shows, not by number: asking which cut, with the right one offered, is fair. */
const askOffers =
  (clipId: string): Lenient =>
  (o) =>
    o.kind === 'ask' && o.about === 'which_clip' && o.choices.some((ch) => isClip(ch) && ch.clipId === clipId)
      ? 'The cut is named by its content, not its number; the model asked which cut (offering the right one) instead of guessing.'
      : null;

const anyOf =
  (...rules: Lenient[]): Lenient =>
  (o, c) => {
    for (const rule of rules) {
      const why = rule(o, c);
      if (why) return why;
    }
    return null;
  };

const askSeconds =
  (about: AskAbout, min: number, below: number, what: string): Lenient =>
  (o) =>
    o.kind === 'ask' &&
    o.about === about &&
    o.choices.length >= 2 &&
    o.choices.every((ch) => typeof ch === 'number' && ch >= min && ch < below)
      ? `Same question; other second choices (${o.choices.join(', ')}), all ${what}.`
      : null;

const askOneCut: Lenient = (o) =>
  o.kind === 'ask' && o.about === 'which_clip' && o.choices.length >= 2 && o.choices.every(isClip)
    ? 'Same question; another set of real cuts and no "all" (the instruction asks for one cut).'
    : null;

/**
 * The defensible readings per case, fixed before the live run. Anything not listed here and not exact is a
 * fail. An edit on the wrong cut or with a wrong stated number never appears here.
 */
const LENIENT: Record<string, Lenient> = {
  'ko-music-down': musicLoweredABit,
  'en-music-down': musicLoweredABit,
  'ko-fit-and-music-up': (o, c) => {
    if (o.kind !== 'draft') return null;
    const music = o.deltas.filter((x) => x.kind === 'music_volume');
    const m = music[0];
    const sameRest = sameValue(
      o.deltas.filter((x) => x.kind !== 'music_volume'),
      expectedDeltas(c).filter((x) => x.kind !== 'music_volume'),
    );
    return music.length === 1 && m && m.kind === 'music_volume' && m.beforePct === 60 && m.afterPct > 60 && m.afterPct <= 100 && sameRest
      ? `No number was given for the music; it went up 60% → ${m.afterPct}% (table: 80%) and the 12 s fit is exact.`
      : null;
  },
  'ko-caption-end': captionAtEnd,
  'en-caption-end': captionAtEnd,
  'ko-trim-then-end-caption': captionAtEnd,
  'ko-caption-on-cut': anyOf((o) => {
    const cap = only(o, 'caption_added');
    return cap && cap.text === '도시를 달리다' && cap.fromSec >= 10 - EPS && cap.toSec <= 16 + EPS && cap.toSec - cap.fromSec >= 1
      ? `The caption sits inside the running cut (10–16 s) at ${fmt(cap.fromSec)}–${fmt(cap.toSec)} s rather than over all of it.`
      : null;
  }, askOffers(EDIT_ASSIST_CASE_IDS.c3)),
  'ko-caption-move-up': (o, c) =>
    o.kind === 'draft' &&
    sameValue(o.deltas, expectedDeltas(c)) &&
    o.final.captions.find((x) => x.id === 'cap-hello')?.position === 'center'
      ? '"위로 올려줘" from the bottom: center is also up; the table chose top.'
      : null,
  'ko-remove-by-label': askOffers(EDIT_ASSIST_CASE_IDS.c2),
  'ko-move-first': askOffers(EDIT_ASSIST_CASE_IDS.c4),
  'en-move-first': askOffers(EDIT_ASSIST_CASE_IDS.c4),
  'ko-fit-total-protect': askOffers(EDIT_ASSIST_CASE_IDS.c4),
  'ko-ask-which-cut': askOneCut,
  'en-ask-which-cut': askOneCut,
  'ko-ask-how-long': askSeconds('how_long', 0.3, 5, "shorter than the cut's 5 s"),
  'ko-ask-total-length': askSeconds('how_long', 4, 20, 'between the 4 s floor and the current 20 s'),
  'en-ask-how-long': askSeconds('how_long', 4, 20, 'between the 4 s floor and the current 20 s'),
  'ko-ask-which-caption': (o) =>
    o.kind === 'ask' &&
    o.about === 'which_caption' &&
    o.choices.length === 2 &&
    o.choices.every(isCaption) &&
    new Set(o.choices.map((ch) => (isCaption(ch) ? ch.captionId : ''))).size === 2
      ? 'Same question, both captions, another order.'
      : null,
  'ko-ask-where-caption': (o) => {
    if (o.kind === 'ask' && o.about === 'where_caption' && o.choices.length >= 2) return 'Same question, another set of places.';
    const cap = only(o, 'caption_added');
    return cap && cap.text === '한정판'
      ? `The text is exact and only the place was open; the caption went in at ${fmt(cap.fromSec)}–${fmt(cap.toSec)} s, a visible default the user can move (no question asked).`
      : null;
  },
  'ko-ask-which-sound': (o) => {
    if (o.kind === 'ask' && o.about === 'which_clip' && o.choices.length >= 2) return 'Same question, another set of choices.';
    if (o.kind !== 'draft') return null;
    // Exactly the 'all' choice's result: every cut muted and nothing else about the cuts (no volume reset).
    const allMuted = (x: EditDelta) => sameValue(x, { kind: 'clip_sound', cut: 'all', muted: true });
    const allCuts = o.deltas.some(allMuted);
    const allowed = o.deltas.every((x) => allMuted(x) || (x.kind === 'music_volume' && x.afterPct === 0));
    const music = o.deltas.some((x) => x.kind === 'music_volume');
    return allCuts && allowed
      ? `"All" is the first choice the table's own question offers; with nothing selected every cut's own sound was muted${music ? ', and the music' : ' (music left on)'} without asking.`
      : null;
  },
  'ko-problem-no-look-to-remove': (o) =>
    o.kind === 'nothing'
      ? 'There is no look to remove; the screen says "이미 그렇게 되어 있어 바꿀 내용이 없어요" (no_change note) instead of the nothing_to_edit note: the user learns the same thing and nothing changes.'
      : null,
};

for (const id of [...Object.keys(LENIENT), ...Object.keys(NAMED)]) {
  if (!EDIT_ASSIST_CASES.some((c) => c.id === id)) throw new Error(`LENIENT/NAMED names an unknown case: ${id}`);
}

const REF_OF: Record<string, string> = Object.fromEntries(Object.entries(EDIT_ASSIST_CASE_IDS).map(([ref, id]) => [id, ref]));

function describeChoice(choice: AskChoice): string {
  if (isClip(choice)) return REF_OF[choice.clipId] ?? choice.clipId;
  if (isCaption(choice)) return REF_OF[choice.captionId] ?? choice.captionId;
  return String(choice);
}

function describeDelta(delta: EditDelta): string {
  const { kind, ...rest } = delta as EditDelta & Record<string, unknown>;
  const values = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return `${kind}(${values.join(' ')})`;
}

function describeOutcome(o: Outcome): string {
  switch (o.kind) {
    case 'draft':
      return o.deltas.map(describeDelta).join(', ') || '(no deltas)';
    case 'ask':
      return `ask ${o.about} [${o.choices.map(describeChoice).join(', ')}]`;
    case 'cannot':
      return `cannot ${o.reason}`;
    case 'error':
      return `error ${o.message}`;
    default:
      return o.kind;
  }
}

function describeExpected(c: EditAssistCase): string {
  const e = expectedOf(c);
  if (e.kind === 'plan') return e.deltas.map(describeDelta).join(', ');
  if (e.kind === 'ask') return `ask ${e.about} [${e.choices.map(describeChoice).join(', ')}]`;
  return `cannot ${e.reason}`;
}

function judge(c: EditAssistCase, o: Outcome): { verdict: Verdict; why: string } {
  const e = expectedOf(c);
  const named = o.kind === 'draft' ? (NAMED[c.id]?.(o.final) ?? null) : null;
  let exact = false;
  if (e.kind === 'plan') exact = o.kind === 'draft' && sameValue(o.deltas, e.deltas) && o.instant === e.instant && named === null;
  else if (e.kind === 'ask') exact = o.kind === 'ask' && o.about === e.about && sameValue(o.choices, e.choices);
  else exact = o.kind === 'cannot' && o.reason === e.reason;
  if (exact) return { verdict: 'pass', why: '' };
  const lenient = o.kind === 'error' ? null : (LENIENT[c.id]?.(o, c) ?? null);
  if (lenient) return { verdict: 'acceptable', why: lenient };
  const instantNote =
    e.kind === 'plan' && o.kind === 'draft' && sameValue(o.deltas, e.deltas) && o.instant !== e.instant ? ' (instant differs)' : '';
  return { verdict: 'fail', why: `expected ${describeExpected(c)}; got ${describeOutcome(o)}${named ? ` (${named})` : ''}${instantNote}` };
}

/* ------------------------------------------------------------------ one case */

/** `model+retry`: the first call never answered (threw, 5xx, 408, 429) and the same request went once more. */
type Path = 'rule parser' | 'model' | 'model+repair' | 'model+retry' | 'none';

const passingStatus = (status: CallStatus) =>
  status === 'threw' || (typeof status === 'number' && (status >= 500 || status === 408 || status === 429));

interface CaseRun {
  id: string;
  locale: 'ko' | 'en';
  instruction: string;
  context?: EditAssistCase['context'];
  attempt: number;
  path: Path;
  ruleParser: string;
  modelCalls: number;
  latencyMs: number;
  calls: CallRecord[];
  result: AssistPlanResult | { error: string };
  outcome: Exclude<Outcome, { kind: 'draft' }> | { kind: 'draft'; deltas: EditDelta[]; instant: boolean };
  expected: ReturnType<typeof expectedOf>;
  verdict: Verdict;
  why: string;
  finalTimeline?: ReturnType<typeof timelineSummary>;
  finalMatchesCaseReply?: boolean;
}

async function runCase(c: EditAssistCase, env: GeminiEnv, attempt: number): Promise<CaseRun> {
  const calls: CallRecord[] = [];
  const real = assistFixture();
  const selectedIdx = c.context?.selectedClipId ? real.clips.findIndex((clip) => clip.id === c.context?.selectedClipId) : -1;
  const rule = parseComposeChatCommand(c.instruction, real, c.locale, {
    ...(c.context?.playheadSec !== undefined ? { playheadSec: c.context.playheadSec } : {}),
    ...(selectedIdx >= 0 ? { selectedClipIdx: selectedIdx } : {}),
  });
  let result: AssistPlanResult | { error: string };
  let outcome: Outcome;
  const t0 = performance.now();
  try {
    const input = AssistPlanInputSchema.parse({
      organizationId: ORG,
      message: c.instruction,
      locale: c.locale,
      project: assistFixture(),
      ...c.context,
    });
    result = await planEditAssist(input, { env: { ...env }, providerMode: 'live', fetchImpl: countedFetch(calls) });
    outcome = outcomeOf(result, real);
  } catch (error) {
    result = { error: scrub(String(error)).slice(0, 300) };
    outcome = { kind: 'error', message: result.error };
  }
  const latencyMs = Math.round(performance.now() - t0);
  const made = calls.filter((call) => typeof call.status === 'number' || call.status === 'threw');
  const modelCalls = made.length;
  if (calls.some((call) => call.status === 'refused_by_cap')) outcome = { kind: 'error', message: 'call cap reached' };
  const path: Path =
    modelCalls === 0
      ? calls.length === 0 && 'kind' in result
        ? 'rule parser'
        : 'none'
      : modelCalls === 1
        ? 'model'
        : passingStatus(made[0]!.status)
          ? 'model+retry'
          : 'model+repair';
  const { verdict, why } = judge(c, outcome);
  const replyFinal = caseReplyFinal(c);
  return {
    id: c.id,
    locale: c.locale,
    instruction: c.instruction,
    ...(c.context ? { context: c.context } : {}),
    attempt,
    path,
    ruleParser: rule.kind === 'patches' ? `patches ${rule.patches.map((p) => p.op).join('+')}` : rule.kind,
    modelCalls,
    latencyMs,
    calls,
    result,
    outcome: outcome.kind === 'draft' ? { kind: 'draft', deltas: outcome.deltas, instant: outcome.instant } : outcome,
    expected: expectedOf(c),
    verdict,
    why,
    ...(outcome.kind === 'draft'
      ? {
          finalTimeline: timelineSummary(outcome.final),
          ...(replyFinal ? { finalMatchesCaseReply: sameValue(timelineSummary(outcome.final), timelineSummary(replyFinal)) } : {}),
        }
      : {}),
  };
}

async function pool<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !state.stop && !state.capReached) {
      const i = next++;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(workers);
  return out.filter((x) => x !== undefined);
}

/* ------------------------------------------------------------------ summary */

function stats(values: number[]) {
  if (values.length === 0) return { n: 0, median: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
  return { n: sorted.length, median: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1]! };
}

function counts(runs: CaseRun[]) {
  return {
    pass: runs.filter((r) => r.verdict === 'pass').length,
    acceptable: runs.filter((r) => r.verdict === 'acceptable').length,
    fail: runs.filter((r) => r.verdict === 'fail').length,
  };
}

const line = (c: { pass: number; acceptable: number; fail: number }) => `pass ${c.pass} · acceptable ${c.acceptable} · fail ${c.fail}`;

function gitInfo() {
  try {
    const opts = { encoding: 'utf8' as const, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
    return {
      head: execSync('git rev-parse HEAD', opts).trim(),
      branch: execSync('git rev-parse --abbrev-ref HEAD', opts).trim(),
      dirty: execSync('git status --porcelain', opts).split(/\r?\n/).filter(Boolean),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  const envPath = process.argv[2];
  if (!envPath || envPath.startsWith('--')) throw new Error('usage: npx tsx scripts/edit-assist-eval.ts <env-file> [--out-dir dir] [--only id,id]');
  if (!existsSync(envPath)) throw new Error('env file not found');
  const env = readGeminiEnv(envPath);
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing in the env file: refusing to run');
  SECRET = env.GEMINI_API_KEY;

  state.cap = intFlag('--cap', 150, 1, 1000);
  const concurrency = intFlag('--concurrency', 3, 1, 8);
  const reruns = intFlag('--reruns', 2, 0, 5);
  const outDir = resolve(flag('--out-dir') ?? join(tmpdir(), 'edit-assist-eval'));
  const only = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const cases = only ? EDIT_ASSIST_CASES.filter((c) => only.includes(c.id)) : [...EDIT_ASSIST_CASES];
  if (cases.length === 0) throw new Error('no case selected');

  const config = editAssistGeminiConfig(env);
  if (!config) throw new Error('no model config');
  if (config.model !== EXPECTED_MODEL || EDIT_ASSIST_DEFAULT_MODEL !== EXPECTED_MODEL) {
    throw new Error(`configured model is ${config.model} (default ${EDIT_ASSIST_DEFAULT_MODEL}), expected ${EXPECTED_MODEL}: not running`);
  }

  const serverLog: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    serverLog.push(scrub(args.map(String).join(' ')).slice(0, 500));
  };

  const startedAt = new Date();
  const wall0 = performance.now();
  let first: CaseRun[] = [];
  const rerunRuns: CaseRun[] = [];
  try {
    first = await pool(cases, concurrency, (c) => runCase(c, env, 1));
    const failed = first.filter((r) => r.verdict === 'fail');
    const jobs = failed.flatMap((r) => Array.from({ length: reruns }, (_, k) => ({ c: cases.find((x) => x.id === r.id)!, attempt: k + 2 })));
    rerunRuns.push(...(await pool(jobs, concurrency, (job) => runCase(job.c, env, job.attempt))));
  } finally {
    console.error = consoleError;
  }
  const wallMs = Math.round(performance.now() - wall0);

  const modelRuns = first.filter((r) => r.modelCalls > 0);
  const allCalls = [...first, ...rerunRuns].flatMap((r) => r.calls).filter((call) => typeof call.status === 'number');
  const stability = first
    .filter((r) => r.verdict === 'fail')
    .map((r) => {
      const attempts = [r, ...rerunRuns.filter((x) => x.id === r.id).sort((a, b) => a.attempt - b.attempt)];
      const fails = attempts.filter((x) => x.verdict === 'fail').length;
      return {
        id: r.id,
        path: r.path,
        attempts: attempts.map((x) => ({ attempt: x.attempt, path: x.path, verdict: x.verdict, got: describeOutcome(x.outcome as Outcome) })),
        failsOf: `${fails} of ${attempts.length}`,
        stable: fails === attempts.length,
      };
    });
  const byPath = (path: Path) => counts(first.filter((r) => r.path === path));
  const summary = {
    model: config.model,
    modelAsserted: `editAssistGeminiConfig(env).model === '${EXPECTED_MODEL}' and every request URL /models/${EXPECTED_MODEL}:generateContent`,
    customBaseUrl: Boolean(env.GEMINI_BASE_URL),
    cases: first.length,
    modelCalls: state.calls,
    modelCallsFirstPass: first.reduce((n, r) => n + r.modelCalls, 0),
    modelCallsReruns: rerunRuns.reduce((n, r) => n + r.modelCalls, 0),
    cap: state.cap,
    capReached: state.capReached,
    stoppedBecause: state.stop || null,
    wallMs,
    latencyModelCasesMs: stats(modelRuns.map((r) => r.latencyMs)),
    latencyPerCallMs: stats(allCalls.map((call) => call.ms)),
    callsByStatus: [...first, ...rerunRuns]
      .flatMap((r) => r.calls)
      .reduce<Record<string, number>>((acc, call) => ({ ...acc, [String(call.status)]: (acc[String(call.status)] ?? 0) + 1 }), {}),
    firstPass: counts(first),
    byPath: {
      'rule parser': byPath('rule parser'),
      model: byPath('model'),
      'model+repair': byPath('model+repair'),
      'model+retry': byPath('model+retry'),
      none: byPath('none'),
    },
    byLocale: { ko: counts(first.filter((r) => r.locale === 'ko')), en: counts(first.filter((r) => r.locale === 'en')) },
    nonPass: first
      .filter((r) => r.verdict !== 'pass')
      .map((r) => ({ id: r.id, verdict: r.verdict, path: r.path, instruction: r.instruction, why: r.why })),
    failStability: stability,
    serverLogLines: serverLog.length,
  };

  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outFile = join(outDir, `${config.model.replace(/^gemini-\d+-/, '')}-${first.length}-${stamp}.json`);
  const doc = {
    tool: 'scripts/edit-assist-eval.ts',
    startedAt: startedAt.toISOString(),
    git: gitInfo(),
    node: process.version,
    concurrency,
    reruns,
    summary,
    cases: first,
    rerunRuns,
    serverLog,
  };
  writeFileSync(outFile, scrub(JSON.stringify(doc, null, 2)));

  say(`model ${summary.model} (asserted) · model calls ${summary.modelCalls}/${summary.cap} (first pass ${summary.modelCallsFirstPass}, reruns ${summary.modelCallsReruns}) · wall ${(wallMs / 1000).toFixed(1)} s`);
  if (summary.capReached) say('CALL CAP REACHED: the run stopped early');
  if (summary.stoppedBecause) say(`STOPPED: ${summary.stoppedBecause}`);
  const l = summary.latencyModelCasesMs;
  const p = summary.latencyPerCallMs;
  say(`latency per model case: median ${l.median} ms · p90 ${l.p90} ms · max ${l.max} ms (n ${l.n}); per call: median ${p.median} · p90 ${p.p90} · max ${p.max} (n ${p.n})`);
  say(`call statuses: ${JSON.stringify(summary.callsByStatus)}`);
  say(`first pass (${first.length}): ${line(summary.firstPass)}`);
  for (const [path, c] of Object.entries(summary.byPath)) if (c.pass + c.acceptable + c.fail > 0) say(`  ${path.padEnd(12)} ${line(c)}`);
  for (const [locale, c] of Object.entries(summary.byLocale)) say(`  ${locale.padEnd(12)} ${line(c)}`);
  for (const r of summary.nonPass) say(`  ${r.verdict === 'fail' ? 'FAIL' : 'ACC '} ${r.id} [${r.path}] ${r.why}`);
  for (const s of stability) say(`  rerun ${s.id}: fail ${s.failsOf} (${s.stable ? 'stable' : 'flaky'}) ${s.attempts.map((a) => `#${a.attempt} ${a.verdict}`).join(' ')}`);
  if (serverLog.length) say(`server log lines: ${serverLog.length} (in the JSON)`);
  say(`json: ${outFile}`);
}

main().catch((error) => {
  console.log(scrub(`edit-assist-eval failed: ${String((error as Error)?.message ?? error)}`).slice(0, 300));
  process.exitCode = 1;
});
