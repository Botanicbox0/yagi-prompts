/**
 * Live evaluation script for `video.understand` (VM-2 Batch C, mirroring `scripts/revise-dialogue-eval.ts`).
 * Runs the 20 scripted conversations in `tests/brand-studio/video/understand-eval-fixtures.ts` through
 * `readUnderstandWithTries` + `settleUnderstanding` using the studio default model (`gemini-4-hydrogen`),
 * checks every turn mechanically via `checkUnderstandExpectation`, and writes a markdown transcript + JSON
 * report to `--out <dir>`.
 *
 * Usage (operator runs manually; NEVER invoked by automated tests):
 *   npx tsx --conditions=react-server scripts/video-understand-eval.ts [env-file] --out <dir> [--only E01,E04] [--thinking LOW|MEDIUM] [--cap 100]
 *   npm run studio:understand-eval -- [env-file] --out <dir> [--only E01,E04] [--thinking LOW|MEDIUM] [--cap 100]
 *
 * - Reads ONLY `GEMINI_API_KEY` (and optional `GEMINI_BASE_URL`) from env or `[env-file]`.
 * - Never prints or writes the API key; every string leaving this process is scrubbed of it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type {
  StudioVideoCountingScheme,
  VideoUnderstandCard,
  VideoUnderstandQuestion,
} from '@/lib/brand-studio/contracts';
import { studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import {
  UNDERSTAND_MAX_CLIPS,
  UNDERSTAND_MAX_QUESTIONS,
  buildAmbiguousRefQuestion,
  hasCreditFigure,
  hasHapsyoEnding,
  hasMalformedMentionToken,
  hasRawNumericPicturePhrase,
  hasStandingChange,
  readUnderstandWithTries,
  resolveImageReferencesInMessage,
  settleUnderstanding,
  type SettleUnderstandResult,
} from '@/lib/brand-studio/video/understand';
import { samePoint } from '@/lib/revision/sheet-core';
import {
  VIDEO_UNDERSTAND_EVAL_CASES,
  checkUnderstandExpectation,
  type UnderstandEvalCase,
} from '@/tests/brand-studio/video/understand-eval-fixtures';

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

function readGeminiEnvFile(filePath: string): GeminiEnv {
  const out: GeminiEnv = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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
const scrub = (text: string) => (SECRET ? text.split(SECRET).join('[key]') : text);
const say = (text: string) => process.stdout.write(scrub(text) + '\n');

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const callState = { calls: 0, cap: 120 };

function meteredFetch(): typeof fetch {
  return async (input, init) => {
    const model = /\/models\/([^/:]+):generateContent/.exec(requestUrl(input))?.[1] ?? '?';
    if (model !== EXPECTED_MODEL) throw new Error(`unexpected_model:${model}`);
    if (callState.calls >= callState.cap) throw new Error('call_cap_reached');
    callState.calls += 1;
    return fetch(input, init);
  };
}

interface TurnRecord {
  stepIndex: number;
  message: string;
  ms: number;
  tries: number;
  kind: string | null;
  reply: string | null;
  readyToMake: boolean;
  openQuestion: number | null;
  card: VideoUnderstandCard;
  schemeInForce: StudioVideoCountingScheme | null;
  resolvedRefs: Array<{ phrase: string; mention: string; refIndex: number; via: string }>;
  haeyocheOk: boolean;
  noCreditFigure: boolean;
  noRawPicturePhrase: boolean;
  noDoubleAt: boolean;
  errors: string[];
}

interface CaseRecord {
  id: string;
  title: string;
  mode: UnderstandEvalCase['mode'];
  passed: boolean;
  turns: TurnRecord[];
}

async function main() {
  const envFile = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  const outDir = flag('--out') ?? join(process.cwd(), '.tmp', 'video-understand-eval');
  const onlyRaw = flag('--only');
  const onlySet = onlyRaw ? new Set(onlyRaw.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const thinking = flag('--thinking') === 'MEDIUM' ? 'MEDIUM' : 'LOW';
  callState.cap = intFlag('--cap', 120, 1, 500);

  const fileEnv = envFile && existsSync(envFile) ? readGeminiEnvFile(envFile) : {};
  const apiKey = fileEnv.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '';
  const baseUrl = fileEnv.GEMINI_BASE_URL ?? process.env.GEMINI_BASE_URL;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in environment or env file.');
  }
  SECRET = apiKey;

  const model = studioModel('seedance-2.5') as StudioVideoModel;
  const intelEnv: Record<string, string | undefined> = {
    GEMINI_API_KEY: apiKey,
    ...(baseUrl ? { GEMINI_BASE_URL: baseUrl } : {}),
    PROMPT_GUARD: 'enforce',
  };
  const intelDeps = { fetch: meteredFetch(), env: intelEnv };

  const selected = onlySet
    ? VIDEO_UNDERSTAND_EVAL_CASES.filter((c) => onlySet.has(c.id) || [...onlySet].some((p) => c.id.startsWith(p)))
    : VIDEO_UNDERSTAND_EVAL_CASES;

  const results: CaseRecord[] = [];
  for (const item of selected) {
    let standingCard: VideoUnderstandCard = {
      swaps: [],
      changeText: '',
      requestText: '',
      seconds: model.defaultSeconds,
      clipCount: 1,
      targetTotalSeconds: model.defaultSeconds,
      audio: 'ambient',
    };
    let standingQuestions: VideoUnderstandQuestion[] = [];
    let standingScheme: StudioVideoCountingScheme | null = null;
    const turnsHistory: Array<{ who: 'customer' | 'studio'; text: string }> = [];
    const turnRecords: TurnRecord[] = [];
    const modelLimits = {
      minSeconds: model.minSeconds,
      maxSeconds: model.maxSeconds,
      maxClips: item.mode === 're_architect' ? UNDERSTAND_MAX_CLIPS : 1,
    };

    for (let i = 0; i < item.steps.length; i += 1) {
      const step = item.steps[i]!;
      const t0 = performance.now();
      // Mirror `understandStudioVideo`: run deterministic image-reference resolution with session scheme + standing swaps + disambiguation pick.
      const resolution = resolveImageReferencesInMessage(step.message, item.references, {
        countingScheme: standingScheme,
        standingSwaps: standingCard.swaps,
        disambiguationAnswer: {
          questions: standingQuestions,
          answering: step.answering ?? null,
        },
      });
      standingScheme = resolution.countingScheme;
      let settled: SettleUnderstandResult;
      let tries = 0;

      if (
        resolution.ambiguous.length > 0 &&
        !step.answering &&
        standingQuestions.length < UNDERSTAND_MAX_QUESTIONS &&
        !standingQuestions.some((q) => samePoint(q.point, 'ref_disambiguation'))
      ) {
        const disambigLocale: 'ko' | 'en' = /[가-힣]/.test(step.message) ? 'ko' : 'en';
        const { reply, question } = buildAmbiguousRefQuestion(resolution.ambiguous[0]!, disambigLocale);
        const questions = [...standingQuestions, question];
        settled = {
          kind: hasStandingChange(standingCard) ? 'correction' : 'plan',
          reply,
          card: standingCard,
          questions,
          openQuestion: questions.length - 1,
          readyToMake: false,
        };
      } else {
        const tried = await readUnderstandWithTries(
          intelDeps,
          {
            mode: item.mode,
            message: step.message,
            references: item.references,
            resolvedReferences: resolution.resolved,
            current: {
              seconds: standingCard.seconds,
              clipCount: standingCard.clipCount,
              targetTotalSeconds: standingCard.targetTotalSeconds,
              audio: standingCard.audio,
              changeText: standingCard.changeText,
            },
            modelLimits,
            filmSummary: item.filmSummary,
            previous:
              i > 0
                ? {
                    card: standingCard,
                    questions: standingQuestions,
                    turns: turnsHistory,
                  }
                : null,
            answering: step.answering ?? null,
          },
          { thinking },
        );
        tries = tried.tries;
        settled = settleUnderstanding({
          reading: tried.outcome.ok ? tried.outcome.reading : null,
          mode: item.mode,
          message: step.message,
          references: item.references,
          resolvedReferences: resolution.resolved,
          modelLimits,
          standing: { card: standingCard, questions: standingQuestions },
          answering: step.answering ?? null,
        });
      }

      const activeQ = settled.openQuestion !== null ? settled.questions[settled.openQuestion] : null;
      const koCheckTexts = [settled.reply ?? '', activeQ?.text ?? '', ...(activeQ?.options.map((o) => o.label) ?? [])];
      const haeyocheOk = !koCheckTexts.some((t) => hasHapsyoEnding(t));
      const noCreditFigure = !(settled.reply && hasCreditFigure(settled.reply));
      const noRawPicturePhrase = !hasRawNumericPicturePhrase(settled.card.requestText);
      const noDoubleAt =
        !hasMalformedMentionToken(settled.card.requestText) && !hasMalformedMentionToken(settled.card.changeText);

      const errors = checkUnderstandExpectation(settled, step.expect);
      turnRecords.push({
        stepIndex: i + 1,
        message: step.message,
        ms: Math.round(performance.now() - t0),
        tries,
        kind: settled.kind,
        reply: settled.reply,
        readyToMake: settled.readyToMake,
        openQuestion: settled.openQuestion,
        card: settled.card,
        schemeInForce: resolution.countingScheme,
        resolvedRefs: resolution.resolved.map((r) => ({
          phrase: r.phrase,
          mention: r.mention,
          refIndex: r.refIndex,
          via: r.via,
        })),
        haeyocheOk,
        noCreditFigure,
        noRawPicturePhrase,
        noDoubleAt,
        errors,
      });

      standingCard = settled.card;
      standingQuestions = settled.questions;
      turnsHistory.push({ who: 'customer', text: step.message });
      if (settled.reply) turnsHistory.push({ who: 'studio', text: settled.reply });
    }

    const passed = turnRecords.every((t) => t.errors.length === 0);
    results.push({ id: item.id, title: item.title, mode: item.mode, passed, turns: turnRecords });
    say(`[${passed ? 'PASS' : 'FAIL'}] ${item.id} (${turnRecords.length} turn${turnRecords.length === 1 ? '' : 's'})`);
  }

  mkdirSync(outDir, { recursive: true });
  const passCount = results.filter((r) => r.passed).length;
  const allTurns = results.flatMap((r) => r.turns);
  const haeyochePass = allTurns.filter((t) => t.haeyocheOk).length;
  const noCreditPass = allTurns.filter((t) => t.noCreditFigure).length;
  const noRawRefPass = allTurns.filter((t) => t.noRawPicturePhrase).length;
  const noDoubleAtPass = allTurns.filter((t) => t.noDoubleAt).length;
  const latencies = allTurns.map((t) => t.ms).sort((a, b) => a - b);
  const avgMs = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const p95Ms = latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : 0;
  const summaryLine = `Summary: pass=${passCount}/${results.length} | haeyoche=${haeyochePass}/${allTurns.length} | noCredit=${noCreditPass}/${allTurns.length} | noRawRef=${noRawRefPass}/${allTurns.length} | noDoubleAt=${noDoubleAtPass}/${allTurns.length} | latency avg=${avgMs}ms p95=${p95Ms}ms`;

  const mdLines: string[] = [
    `# video.understand Eval Transcript`,
    `- Model: \`${EXPECTED_MODEL}\` (thinking: \`${thinking}\`, PROMPT_GUARD: \`enforce\`)`,
    `- Passed: **${passCount} / ${results.length}** (total API calls: ${callState.calls})`,
    `- ${summaryLine}`,
    '',
    '| Case | Mode | Result | Notes |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of results) {
    const errs = r.turns.flatMap((t) => t.errors.map((e) => `T${t.stepIndex}: ${e}`));
    mdLines.push(`| ${r.id} | ${r.mode} | ${r.passed ? 'PASS' : 'FAIL'} | ${errs.join('; ') || 'ok'} |`);
  }
  mdLines.push('');
  for (const r of results) {
    mdLines.push(`## ${r.id} — ${r.title} (${r.mode})`);
    for (const t of r.turns) {
      mdLines.push(
        `- **Turn ${t.stepIndex}** (${t.ms}ms, tries=${t.tries}, kind=\`${t.kind}\`, readyToMake=\`${t.readyToMake}\`, haeyoche=${t.haeyocheOk}, noCredit=${t.noCreditFigure}, noRawRef=${t.noRawPicturePhrase}, noDoubleAt=${t.noDoubleAt})`,
      );
      mdLines.push(`  - Customer: ${t.message}`);
      const resolvedSummary =
        t.resolvedRefs.length > 0
          ? t.resolvedRefs.map((r) => `"${r.phrase}"->${r.mention}(ref=${r.refIndex},${r.via})`).join(', ')
          : '(none)';
      mdLines.push(`  - Resolved (scheme=\`${t.schemeInForce ?? 'none'}\`): ${resolvedSummary}`);
      mdLines.push(`  - Reply: ${t.reply ?? '(null)'}`);
      mdLines.push(`  - Card: \`${JSON.stringify(t.card)}\``);
      if (t.errors.length) mdLines.push(`  - Errors: ${t.errors.join('; ')}`);
    }
    mdLines.push('');
  }

  writeFileSync(join(outDir, 'video-understand-eval.md'), scrub(mdLines.join('\n')), 'utf8');
  writeFileSync(
    join(outDir, 'video-understand-eval.json'),
    scrub(
      JSON.stringify(
        {
          model: EXPECTED_MODEL,
          passCount,
          total: results.length,
          calls: callState.calls,
          metrics: {
            turns: allTurns.length,
            haeyochePass,
            noCreditPass,
            noRawRefPass,
            noDoubleAtPass,
            avgMs,
            p95Ms,
          },
          summaryLine,
          results,
        },
        null,
        2,
      ),
    ),
    'utf8',
  );
  say(summaryLine);
  say(`Wrote report to ${outDir} (${passCount}/${results.length} passed).`);
}

void main().catch((err) => {
  process.stderr.write(scrub(String(err instanceof Error ? err.stack ?? err.message : err)) + '\n');
  process.exitCode = 1;
});
