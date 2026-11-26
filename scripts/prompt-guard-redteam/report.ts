import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CANARY_FRAGMENT,
  CANARY_SPREAD,
  GAPPED_MAX_GAP,
  GAPPED_MIN_CONTENT_WORDS,
  GAPPED_MIN_WORDS,
  RUN_HANGUL,
  RUN_LATIN_CHARS,
  RUN_WORDS,
  SHARE_HANGUL_LIMIT,
  SHARE_HANGUL_N,
  SHARE_MIN_WINDOWS,
  SHARE_WORDS_COUNT,
  SHARE_WORDS_LIMIT,
  SHARE_WORDS_N,
  UNREADABLE_BASE64,
  UNREADABLE_TOKENS,
} from '@/lib/ai-guard';
import { GAPPED_ANSWER_SKIP, UNREADABLE_OTHER_SCRIPT } from '@/lib/ai-guard/outgoing';
import { VERBATIM_MIN_HANGUL, VERBATIM_MIN_WORDS } from './scorer';
import type {
  BackendKind,
  CellSummary,
  FakeMode,
  GeminiPricing,
  GuardMode,
  GuardThresholdsSnapshot,
  InputClass,
  LeakSignal,
  RedteamReport,
  SiteId,
  TrialResult,
} from './types';

function resolveExistingAncestor(target: string): string {
  const abs = path.resolve(target);
  const tail: string[] = [];
  let current = abs;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const realBase = existsSync(current) ? realpathSync(current) : current;
  return path.join(realBase, ...tail);
}

/**
 * Refuses `--out` inside (or equal to) the repository root so red-team reports never pollute git status or public commits.
 */
export function assertOutDirOutsideRepo(outDir: string, repoRoot: string): string {
  const resolvedOut = resolveExistingAncestor(outDir);
  const resolvedRoot = resolveExistingAncestor(repoRoot);
  const normOut = process.platform === 'win32' ? resolvedOut.toLowerCase() : resolvedOut;
  const normRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  const rel = path.relative(normRoot, normOut);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(`Refusing --out inside repository (${resolvedOut}). Choose a directory outside ${resolvedRoot}.`);
  }
  return resolvedOut;
}

export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join('[redacted]');
  }
  return out;
}

export function currentThresholds(): GuardThresholdsSnapshot {
  return {
    runWords: RUN_WORDS,
    runLatinChars: RUN_LATIN_CHARS,
    runHangul: RUN_HANGUL,
    shareWordsN: SHARE_WORDS_N,
    shareWordsLimit: SHARE_WORDS_LIMIT,
    shareWordsCount: SHARE_WORDS_COUNT,
    shareHangulN: SHARE_HANGUL_N,
    shareHangulLimit: SHARE_HANGUL_LIMIT,
    shareMinWindows: SHARE_MIN_WINDOWS,
    gappedMinWords: GAPPED_MIN_WORDS,
    gappedMaxGap: GAPPED_MAX_GAP,
    gappedAnswerSkip: GAPPED_ANSWER_SKIP,
    gappedMinContentWords: GAPPED_MIN_CONTENT_WORDS,
    canaryFragment: CANARY_FRAGMENT,
    canarySpread: CANARY_SPREAD,
    canarySpreadGap: 4,
    canaryPiece: 4,
    unreadableBase64: UNREADABLE_BASE64,
    unreadableTokens: UNREADABLE_TOKENS,
    unreadableOtherScript: UNREADABLE_OTHER_SCRIPT,
    verbatimMinWords: VERBATIM_MIN_WORDS,
    verbatimMinHangul: VERBATIM_MIN_HANGUL,
  };
}

function emptySignals(): Record<LeakSignal, number> {
  return {
    canary: 0,
    guard_overlap: 0,
    verbatim_words: 0,
    verbatim_hangul: 0,
  };
}

export function summarizeCells(
  sites: readonly SiteId[],
  modes: readonly GuardMode[],
  classes: readonly InputClass[],
  plannedCounts: Readonly<Record<InputClass, number>>,
  trials: readonly TrialResult[],
): CellSummary[] {
  const cells: CellSummary[] = [];
  for (const site of sites) {
    for (const mode of modes) {
      for (const inputClass of classes) {
        const subset = trials.filter((t) => t.site === site && t.mode === mode && t.inputClass === inputClass);
        const leaksBySignal = emptySignals();
        let calls = 0;
        let skipped = 0;
        let unusableAnswers = 0;
        let leaks = 0;
        let strictLeaks = 0;
        let refusals = 0;
        let notesRefusals = 0;
        let guardObserved = 0;
        let otherFallbacks = 0;
        let falsePositives = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        let totalTokens = 0;
        let costKrw = 0;

        for (const t of subset) {
          if (t.status === 'skipped') {
            skipped += 1;
            continue;
          }
          calls += 1;
          if (t.status === 'unusable') unusableAnswers += 1;
          if (t.score.leaked) {
            leaks += 1;
            for (const s of t.score.signals) leaksBySignal[s] += 1;
          }
          if (t.score.strictLeaked ?? t.score.leaked) strictLeaks += 1;
          if (t.refusedByGuard) refusals += 1;
          if (t.notesRefusedByGuard) notesRefusals += 1;
          if (t.guardObserved) guardObserved += 1;
          if (t.source === 'fallback' && !t.refusedByGuard && t.status !== 'unusable') {
            otherFallbacks += 1;
          }
          if (t.score.falsePositive) falsePositives += 1;
          if (t.usage) {
            inputTokens += t.usage.inputTokens;
            outputTokens += t.usage.outputTokens;
            totalTokens += t.usage.totalTokens;
          }
          costKrw += t.costKrw;
        }

        cells.push({
          site,
          mode,
          inputClass,
          planned: plannedCounts[inputClass],
          calls,
          skipped,
          unusableAnswers,
          leaks,
          strictLeaks,
          leaksBySignal,
          refusals,
          notesRefusals,
          guardObserved,
          otherFallbacks,
          falsePositives,
          inputTokens,
          outputTokens,
          totalTokens,
          costKrw,
        });
      }
    }
  }
  return cells;
}

export function buildReport(params: {
  backend: BackendKind;
  fakeMode: FakeMode | null;
  models: Record<SiteId, string>;
  envKeyPresent: boolean;
  stoppedReason: string | null;
  sites: readonly SiteId[];
  modes: readonly GuardMode[];
  classes: readonly InputClass[];
  plannedCounts: Readonly<Record<InputClass, number>>;
  plannedTotalCalls: number;
  maxCalls: number | null;
  pricing: GeminiPricing | null;
  estimatedWorstCasePlanKrw: number | null;
  trials: TrialResult[];
}): RedteamReport {
  const cells = summarizeCells(params.sites, params.modes, params.classes, params.plannedCounts, params.trials);
  const executedCalls = cells.reduce((n, c) => n + c.calls, 0);
  const skippedCalls = Math.max(0, params.plannedTotalCalls - executedCalls);
  const spentKrw = cells.reduce((n, c) => n + c.costKrw, 0);
  const inputTokens = cells.reduce((n, c) => n + c.inputTokens, 0);
  const outputTokens = cells.reduce((n, c) => n + c.outputTokens, 0);
  const totalTokens = cells.reduce((n, c) => n + c.totalTokens, 0);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    backend: params.backend,
    fakeMode: params.fakeMode,
    models: params.models,
    envKeyPresent: params.envKeyPresent,
    stoppedReason: params.stoppedReason,
    plan: {
      sites: [...params.sites],
      modes: [...params.modes],
      classes: [...params.classes],
      plannedCalls: params.plannedTotalCalls,
      executedCalls,
      skippedCalls,
      maxCalls: params.maxCalls,
      maxKrw: params.pricing?.maxKrw ?? null,
    },
    cost: {
      currency: 'KRW',
      pricing: params.pricing,
      spentKrw,
      estimatedWorstCasePlanKrw: params.estimatedWorstCasePlanKrw,
      inputTokens,
      outputTokens,
      totalTokens,
    },
    thresholds: currentThresholds(),
    cells,
    trials: params.trials,
  };
}

export function renderMarkdownReport(report: RedteamReport): string {
  const lines: string[] = [];
  lines.push('# Prompt Guard Red-Team Report');
  lines.push('');
  lines.push(`- Generated: \`${report.generatedAt}\``);
  lines.push(`- Backend: \`${report.backend}\`${report.fakeMode ? ` (mode: \`${report.fakeMode}\`)` : ''}`);
  lines.push(`- Models: enhancer=\`${report.models['brand-studio.enhancer']}\`, director=\`${report.models['brand-studio.director']}\``);
  lines.push(`- GEMINI_API_KEY present: \`${report.envKeyPresent}\``);
  lines.push(`- Plan vs ran: ${report.plan.executedCalls} / ${report.plan.plannedCalls} calls executed (${report.plan.skippedCalls} skipped)`);
  if (report.stoppedReason) lines.push(`- Stopped early: \`${report.stoppedReason}\``);
  if (report.backend === 'gemini' || report.cost.spentKrw > 0) {
    lines.push(
      `- Usage & Cost: ${report.cost.inputTokens} in + ${report.cost.outputTokens} out = ${report.cost.totalTokens} tokens · **${report.cost.spentKrw.toFixed(2)} KRW**` +
        (report.cost.pricing ? ` (cap ${report.cost.pricing.maxKrw.toFixed(0)} KRW)` : ''),
    );
  }
  lines.push('');

  lines.push('## Guard Thresholds in Force');
  lines.push('');
  const t = report.thresholds;
  lines.push(
    `| Detector | Threshold |`,
  );
  lines.push('| --- | --- |');
  lines.push(`| Word run | ${t.runWords} words |`);
  lines.push(`| Latin character run | ${t.runLatinChars} chars |`);
  lines.push(`| Hangul syllable run | ${t.runHangul} syllables |`);
  lines.push(`| 5-word share | > ${t.shareWordsLimit} or >= ${t.shareWordsCount} windows (min ${t.shareMinWindows} windows) |`);
  lines.push(`| 4-syllable Hangul share | > ${t.shareHangulLimit} (min ${t.shareMinWindows} windows) |`);
  lines.push(`| Gapped in-order chain | >= ${t.gappedMinWords} words (>= ${t.gappedMinContentWords} content, max internal gap ${t.gappedMaxGap}, answer skip ${t.gappedAnswerSkip}) |`);
  lines.push(`| Canary | exact, ${t.canaryFragment}-char piece, or ${t.canarySpread}-char spread |`);
  lines.push(`| Verbatim scorer | >= ${t.verbatimMinWords} words or >= ${t.verbatimMinHangul} Hangul syllables |`);
  lines.push('');

  lines.push('## Summary by Site × Mode × Input Class');
  lines.push('');
  const header =
    report.backend === 'gemini'
      ? '| Site | Mode | Class | Planned | Calls | Unusable | Leaks | Strict Leaks | Refusals | Notes Ref | Observed | False Pos | Tokens | Cost (KRW) |'
      : '| Site | Mode | Class | Planned | Calls | Unusable | Leaks | Strict Leaks | Refusals | Notes Ref | Observed | False Pos |';
  const sep =
    report.backend === 'gemini'
      ? '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
      : '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
  lines.push(header);
  lines.push(sep);
  for (const c of report.cells) {
    const base = `| ${c.site} | ${c.mode} | ${c.inputClass} | ${c.planned} | ${c.calls} | ${c.unusableAnswers} | ${c.leaks} | ${c.strictLeaks} | ${c.refusals} | ${c.notesRefusals} | ${c.guardObserved} | ${c.falsePositives} |`;
    lines.push(
      report.backend === 'gemini'
        ? `${base} ${c.totalTokens} | ${c.costKrw.toFixed(2)} |`
        : base,
    );
  }
  lines.push('');

  lines.push('## Leak Signals by Cell');
  lines.push('');
  lines.push('| Site | Mode | Class | canary | guard_overlap | verbatim_words | verbatim_hangul |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const c of report.cells) {
    lines.push(
      `| ${c.site} | ${c.mode} | ${c.inputClass} | ${c.leaksBySignal.canary} | ${c.leaksBySignal.guard_overlap} | ${c.leaksBySignal.verbatim_words} | ${c.leaksBySignal.verbatim_hangul} |`,
    );
  }
  lines.push('');

  const notable = report.trials.filter(
    (tr) => tr.score.leaked || tr.score.falsePositive || tr.status === 'unusable' || tr.guardObserved,
  );
  lines.push('## Notable Trials (No Internal or Leaked Text)');
  lines.push('');
  if (notable.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Site | Mode | Input | Status | Signals | Reasons | Verbatim (w/ko) | Raw/Out Chars | Out Hash | Match Hash | Prefix (<=12) |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const tr of notable) {
      const reasons = [...tr.score.guardReasons, ...tr.guardObservedReasons, ...(tr.fallbackReason ? [tr.fallbackReason] : [])].join(', ') || '-';
      const signals = tr.score.signals.join(', ') || (tr.score.falsePositive ? 'false_positive' : tr.guardObserved ? 'observed' : '-');
      const prefix = tr.score.leakPrefix12 ? JSON.stringify(tr.score.leakPrefix12) : '-';
      lines.push(
        `| ${tr.site} | ${tr.mode} | ${tr.inputId} | ${tr.status} | ${signals} | ${reasons} | ${tr.score.verbatimWordRun}/${tr.score.verbatimHangulRun} | ${tr.rawChars}/${tr.outputChars} | \`${tr.outputSha256}\` | ${tr.score.leakMatchSha256 ? `\`${tr.score.leakMatchSha256}\`` : '-'} | ${prefix} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function writeReportFiles(
  outDir: string,
  repoRoot: string,
  report: RedteamReport,
  secrets: readonly string[],
): { dir: string; jsonPath: string; mdPath: string } {
  const dir = assertOutDirOutsideRepo(outDir, repoRoot);
  mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, 'report.json');
  const mdPath = path.join(dir, 'report.md');
  const jsonText = scrubSecrets(JSON.stringify(report, null, 2) + '\n', secrets);
  const mdText = scrubSecrets(renderMarkdownReport(report), secrets);
  writeFileSync(jsonPath, jsonText, 'utf8');
  writeFileSync(mdPath, mdText, 'utf8');
  return { dir, jsonPath, mdPath };
}
