import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { DEFAULT_LOCAL_MODEL, DEFAULT_LOCAL_URL, validateLocalOllamaUrl, validateModelName } from './adapter';
import { createSiteTransport } from './backends';
import { computeCostKrw, CostMeter, validateGeminiPricing } from './cost';
import { loadInputs } from './inputs';
import { assertOutDirOutsideRepo, buildReport, scrubSecrets, writeReportFiles } from './report';
import { scoreOutcome, sha256Short } from './scorer';
import { exemptTextsForSiteItem, findSiteSpec, probeRequestSize, withGuardLogCapture } from './sites';
import type {
  BackendKind,
  CliOptions,
  DryRunPlan,
  DryRunPlanCell,
  FakeMode,
  GeminiPricing,
  GuardMode,
  InputClass,
  RedteamInputItem,
  RedteamReport,
  SiteId,
  TrialResult,
} from './types';

const ALL_SITES: readonly SiteId[] = ['brand-studio.enhancer', 'brand-studio.director'];
const ALL_MODES: readonly GuardMode[] = ['off', 'observe', 'enforce'];
const ALL_CLASSES: readonly InputClass[] = ['attack', 'benign'];

const ALLOWED_ENV_KEYS = ['GEMINI_API_KEY', 'GEMINI_BASE_URL', 'BRAND_STUDIO_ENHANCER_MODEL'] as const;

export interface LoadedGeminiEnv {
  env: Record<string, string | undefined>;
  keyPresent: boolean;
  secrets: string[];
}

export function loadGeminiEnv(
  repoRoot: string,
  envFile: string | null,
  baseProcessEnv: Record<string, string | undefined> = process.env,
): LoadedGeminiEnv {
  const fromFiles: Record<string, string> = {};
  const files = envFile
    ? [path.resolve(envFile)]
    : [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')];

  for (const file of files) {
    if (!existsSync(file)) {
      if (envFile) throw new Error(`Env file not found: ${file}`);
      continue;
    }
    const parsed = parseDotenv(readFileSync(file, 'utf8'));
    for (const key of ALLOWED_ENV_KEYS) {
      const value = parsed[key]?.trim();
      if (value) fromFiles[key] = value;
    }
  }

  const out: Record<string, string | undefined> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const procVal = baseProcessEnv[key]?.trim();
    out[key] = procVal || fromFiles[key];
  }

  const secrets = [out.GEMINI_API_KEY].filter((v): v is string => Boolean(v && v.length >= 4));
  return {
    env: out,
    keyPresent: Boolean(out.GEMINI_API_KEY),
    secrets,
  };
}

function defaultTimestampDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(tmpdir(), 'twings-prompt-guard-redteam', stamp);
}

function parseList<T extends string>(raw: string, allowed: readonly T[], flagName: string): T[] {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error(`${flagName} must not be empty`);
  const out: T[] = [];
  for (const item of items) {
    if (!(allowed as readonly string[]).includes(item)) {
      throw new Error(`Invalid value "${item}" for ${flagName}; expected one of ${allowed.join(', ')}`);
    }
    if (!out.includes(item as T)) out.push(item as T);
  }
  return out;
}

function parsePositiveInt(raw: string, flagName: string, min = 0): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${flagName} must be an integer >= ${min}, got "${raw}"`);
  }
  return n;
}

function parsePositiveNumber(raw: string, flagName: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flagName} must be a positive number, got "${raw}"`);
  }
  return n;
}

export function parseCliArgs(argv: readonly string[], repoRoot: string): CliOptions {
  const map = new Map<string, string>();
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === '--') continue;
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument "${token}"`);
    }
    const eq = token.indexOf('=');
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (key === 'dry-run' && eq === -1) {
      dryRun = true;
      continue;
    }
    if (key === 'dry-run' && eq >= 0) {
      const val = token.slice(eq + 1);
      dryRun = val === 'true' || val === '1' || val === '';
      continue;
    }
    const val = eq >= 0 ? token.slice(eq + 1) : argv[i + 1];
    if (eq === -1) {
      if (val === undefined || val.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      i += 1;
    }
    map.set(key, val!);
  }

  const known = new Set([
    'backend',
    'fake-mode',
    'sites',
    'modes',
    'classes',
    'local-url',
    'local-model',
    'out',
    'env-file',
    'concurrency',
    'delay-ms',
    'timeout-ms',
    'max-calls',
    'limit',
    'max-krw',
    'usd-krw',
    'price-in-usd-per-mtok',
    'price-out-usd-per-mtok',
  ]);
  for (const k of map.keys()) {
    if (!known.has(k)) throw new Error(`Unknown flag --${k}`);
  }

  const backendRaw = (map.get('backend') ?? 'fake').trim() as BackendKind;
  if (!['fake', 'local', 'gemini'].includes(backendRaw)) {
    throw new Error(`Invalid --backend "${backendRaw}"; expected fake, local, or gemini`);
  }

  const fakeModeRaw = (map.get('fake-mode') ?? 'auto').trim() as FakeMode;
  if (!['auto', 'echo', 'benign'].includes(fakeModeRaw)) {
    throw new Error(`Invalid --fake-mode "${fakeModeRaw}"; expected auto, echo, or benign`);
  }

  const sites = map.has('sites') ? parseList(map.get('sites')!, ALL_SITES, '--sites') : [...ALL_SITES];
  const modes = map.has('modes') ? parseList(map.get('modes')!, ALL_MODES, '--modes') : [...ALL_MODES];
  const classes = map.has('classes') ? parseList(map.get('classes')!, ALL_CLASSES, '--classes') : [...ALL_CLASSES];

  const localUrl = map.get('local-url') ?? DEFAULT_LOCAL_URL;
  validateLocalOllamaUrl(localUrl);
  const localModel = validateModelName(map.get('local-model') ?? DEFAULT_LOCAL_MODEL);

  const outRaw = map.get('out');
  const outDir = outRaw ? assertOutDirOutsideRepo(outRaw, repoRoot) : assertOutDirOutsideRepo(defaultTimestampDir(), repoRoot);

  const defaultConcurrency = backendRaw === 'local' ? 2 : backendRaw === 'gemini' ? 3 : 4;
  const defaultDelay = backendRaw === 'local' ? 200 : backendRaw === 'gemini' ? 250 : 0;
  const defaultTimeout = backendRaw === 'local' ? 120_000 : backendRaw === 'gemini' ? 60_000 : 10_000;

  const concurrency = map.has('concurrency') ? parsePositiveInt(map.get('concurrency')!, '--concurrency', 1) : defaultConcurrency;
  const delayMs = map.has('delay-ms') ? parsePositiveInt(map.get('delay-ms')!, '--delay-ms', 0) : defaultDelay;
  const timeoutMs = map.has('timeout-ms') ? parsePositiveInt(map.get('timeout-ms')!, '--timeout-ms', 1) : defaultTimeout;
  const maxCalls = map.has('max-calls') ? parsePositiveInt(map.get('max-calls')!, '--max-calls', 1) : null;
  const limit = map.has('limit') ? parsePositiveInt(map.get('limit')!, '--limit', 1) : null;

  let pricing: GeminiPricing | null = null;
  if (backendRaw === 'gemini') {
    pricing = validateGeminiPricing({
      maxKrw: map.has('max-krw') ? parsePositiveNumber(map.get('max-krw')!, '--max-krw') : undefined,
      usdKrw: map.has('usd-krw') ? parsePositiveNumber(map.get('usd-krw')!, '--usd-krw') : undefined,
      priceInUsdPerMtok: map.has('price-in-usd-per-mtok')
        ? parsePositiveNumber(map.get('price-in-usd-per-mtok')!, '--price-in-usd-per-mtok')
        : undefined,
      priceOutUsdPerMtok: map.has('price-out-usd-per-mtok')
        ? parsePositiveNumber(map.get('price-out-usd-per-mtok')!, '--price-out-usd-per-mtok')
        : undefined,
    });
  }

  return {
    backend: backendRaw,
    fakeMode: fakeModeRaw,
    sites,
    modes,
    classes,
    localUrl,
    localModel,
    outDir,
    outDirExplicit: Boolean(outRaw),
    envFile: map.get('env-file') ?? null,
    concurrency,
    delayMs,
    timeoutMs,
    maxCalls,
    limit,
    dryRun,
    pricing,
  };
}

export async function buildDryRunPlan(
  options: CliOptions,
  inputs: readonly RedteamInputItem[],
  env: Record<string, string | undefined>,
): Promise<DryRunPlan> {
  const cells: DryRunPlanCell[] = [];
  let totalInput = 0;
  let totalOutputCap = 0;
  let totalPlannedCalls = 0;

  for (const siteId of options.sites) {
    const spec = findSiteSpec(siteId);
    for (const mode of options.modes) {
      for (const inputClass of options.classes) {
        const subset = inputs.filter((i) => i.inputClass === inputClass);
        let cellIn = 0;
        let cellOut = 0;
        for (const item of subset) {
          const sz = await probeRequestSize(spec, mode, item, env);
          cellIn += sz.inputTokens;
          cellOut += sz.outputCapTokens;
        }
        const cellCost = options.pricing
          ? computeCostKrw({ inputTokens: cellIn, outputTokens: cellOut }, options.pricing)
          : null;
        cells.push({
          site: siteId,
          mode,
          inputClass,
          plannedCalls: subset.length,
          estimatedInputTokens: cellIn,
          estimatedOutputCapTokens: cellOut,
          estimatedWorstCaseKrw: cellCost,
        });
        totalPlannedCalls += subset.length;
        totalInput += cellIn;
        totalOutputCap += cellOut;
      }
    }
  }

  const attackCount = inputs.filter((i) => i.inputClass === 'attack').length;
  const benignCount = inputs.filter((i) => i.inputClass === 'benign').length;
  const estimatedWorstCaseKrw = options.pricing
    ? computeCostKrw({ inputTokens: totalInput, outputTokens: totalOutputCap }, options.pricing)
    : null;

  return {
    backend: options.backend,
    sites: [...options.sites],
    modes: [...options.modes],
    classes: [...options.classes],
    inputCounts: { attack: attackCount, benign: benignCount, total: inputs.length },
    totalPlannedCalls,
    cappedPlannedCalls:
      options.maxCalls !== null ? Math.min(totalPlannedCalls, options.maxCalls) : totalPlannedCalls,
    estimatedInputTokens: totalInput,
    estimatedOutputCapTokens: totalOutputCap,
    estimatedTotalWorstCaseTokens: totalInput + totalOutputCap,
    estimatedWorstCaseKrw,
    maxKrw: options.pricing?.maxKrw ?? null,
    maxCalls: options.maxCalls,
    cells,
  };
}

export function formatDryRunPlan(plan: DryRunPlan, models: Record<SiteId, string>, envKeyPresent: boolean): string {
  const lines: string[] = [];
  lines.push(`GEMINI_API_KEY present: ${envKeyPresent}`);
  lines.push(`Dry run — zero network/model calls.`);
  lines.push(`Backend: ${plan.backend}`);
  lines.push(`Models: brand-studio.enhancer=${models['brand-studio.enhancer']}, brand-studio.director=${models['brand-studio.director']}`);
  lines.push(`Sites: ${plan.sites.join(', ')}`);
  lines.push(`Modes: ${plan.modes.join(', ')}`);
  lines.push(`Inputs: ${plan.inputCounts.attack} attacks + ${plan.inputCounts.benign} benign = ${plan.inputCounts.total}`);
  lines.push(
    `Planned calls: ${plan.totalPlannedCalls}` +
      (plan.maxCalls !== null ? ` (capped by --max-calls=${plan.maxCalls} → ${plan.cappedPlannedCalls})` : ''),
  );
  lines.push(
    `Estimated worst-case tokens: ${plan.estimatedInputTokens} in + ${plan.estimatedOutputCapTokens} out = ${plan.estimatedTotalWorstCaseTokens} total`,
  );
  if (plan.estimatedWorstCaseKrw !== null) {
    lines.push(
      `Estimated worst-case cost: ${plan.estimatedWorstCaseKrw.toFixed(2)} KRW (cap: ${plan.maxKrw?.toFixed(2) ?? 'none'} KRW)`,
    );
  }
  return lines.join('\n');
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RunRedteamDeps {
  repoRoot?: string;
  baseFetch?: typeof fetch;
  processEnv?: Record<string, string | undefined>;
  inputs?: readonly RedteamInputItem[];
  registerSignalHandlers?: boolean;
  onLog?: (line: string) => void;
}

export type RunRedteamOutput =
  | {
      dryRun: true;
      plan: DryRunPlan;
      models: Record<SiteId, string>;
      envKeyPresent: boolean;
      summaryText: string;
    }
  | {
      dryRun: false;
      report: RedteamReport;
      reportPaths: { dir: string; jsonPath: string; mdPath: string };
      interrupted: boolean;
      summaryText: string;
    };

export async function runRedteam(options: CliOptions, deps: RunRedteamDeps = {}): Promise<RunRedteamOutput> {
  const repoRoot = path.resolve(deps.repoRoot ?? process.cwd());
  const procEnv = deps.processEnv ?? process.env;
  const loadedEnv = loadGeminiEnv(repoRoot, options.envFile, procEnv);
  const log = deps.onLog ?? ((line: string) => console.log(scrubSecrets(line, loadedEnv.secrets)));

  const inputs = deps.inputs ? [...deps.inputs] : loadInputs(options.classes, options.limit);
  const models: Record<SiteId, string> = {
    'brand-studio.enhancer':
      options.backend === 'local'
        ? options.localModel
        : findSiteSpec('brand-studio.enhancer').modelFor(loadedEnv.env),
    'brand-studio.director':
      options.backend === 'local'
        ? options.localModel
        : findSiteSpec('brand-studio.director').modelFor(loadedEnv.env),
  };

  if (options.dryRun) {
    const plan = await buildDryRunPlan(options, inputs, loadedEnv.env);
    const summaryText = formatDryRunPlan(plan, models, loadedEnv.keyPresent);
    log(summaryText);
    return {
      dryRun: true,
      plan,
      models,
      envKeyPresent: loadedEnv.keyPresent,
      summaryText,
    };
  }

  if (options.backend === 'gemini' && !loadedEnv.keyPresent) {
    throw new Error('GEMINI_API_KEY is not set in environment or .env/.env.local (required for --backend=gemini)');
  }

  const meter = new CostMeter({ pricing: options.pricing, maxCalls: options.maxCalls });
  const runAbort = new AbortController();
  let interrupted = false;

  const handleInterrupt = () => {
    interrupted = true;
    meter.markStopped('sigint');
    runAbort.abort();
  };

  const registerSignals = deps.registerSignalHandlers ?? true;
  if (registerSignals) {
    process.on('SIGINT', handleInterrupt);
    process.on('SIGTERM', handleInterrupt);
  }

  const trials: TrialResult[] = [];
  const prevPromptGuard = process.env.PROMPT_GUARD;
  const prevPromptGuardEnforce = process.env.PROMPT_GUARD_ENFORCE;
  delete process.env.PROMPT_GUARD_ENFORCE;
  let lastLaunchMs = 0;
  let launchChain = Promise.resolve();

  const waitTurnSpacing = async () => {
    if (options.delayMs <= 0) return;
    const gate = launchChain.then(async () => {
      if (interrupted || meter.snapshot().stoppedReason) return;
      const now = Date.now();
      const wait = Math.max(0, lastLaunchMs + options.delayMs - now);
      if (wait > 0) await sleepMs(wait, runAbort.signal);
      lastLaunchMs = Date.now();
    });
    launchChain = gate.catch(() => {});
    await gate;
  };

  const plannedCounts: Record<InputClass, number> = {
    attack: options.classes.includes('attack') ? inputs.filter((i) => i.inputClass === 'attack').length : 0,
    benign: options.classes.includes('benign') ? inputs.filter((i) => i.inputClass === 'benign').length : 0,
  };
  const plannedTotalCalls = options.sites.length * options.modes.length * inputs.length;

  const siteEnvBase: Record<string, string | undefined> = {
    ...loadedEnv.env,
    GEMINI_API_KEY:
      options.backend === 'gemini'
        ? loadedEnv.env.GEMINI_API_KEY
        : loadedEnv.env.GEMINI_API_KEY || 'redteam-local-placeholder-key',
  };

  log(`GEMINI_API_KEY present: ${loadedEnv.keyPresent}`);

  try {
    for (const mode of options.modes) {
      if (interrupted || meter.snapshot().stoppedReason) break;
      process.env.PROMPT_GUARD = mode;
      const siteEnv: Record<string, string | undefined> = { ...siteEnvBase, PROMPT_GUARD: mode };

      const queue: Array<{ site: SiteId; item: RedteamInputItem }> = [];
      for (const site of options.sites) {
        for (const item of inputs) {
          queue.push({ site, item });
        }
      }

      let cursor = 0;
      const workerCount = Math.min(options.concurrency, Math.max(1, queue.length));

      const worker = async () => {
        for (;;) {
          if (interrupted || meter.snapshot().stoppedReason) return;
          const idx = cursor;
          cursor += 1;
          if (idx >= queue.length) return;
          const task = queue[idx]!;
          await waitTurnSpacing();
          if (interrupted || meter.snapshot().stoppedReason) return;

          const spec = findSiteSpec(task.site);
          const transport = createSiteTransport(task.site, task.item, {
            backend: options.backend,
            fakeMode: options.fakeMode,
            localUrl: options.localUrl,
            localModel: options.localModel,
            timeoutMs: options.timeoutMs,
            meter,
            baseFetch: deps.baseFetch,
            runSignal: runAbort.signal,
          });

          const fallbackState: { reason: string | null } = { reason: null };
          const started = Date.now();
          const { result: outcome, logs } = await withGuardLogCapture(() =>
            spec.invoke(task.item, siteEnv, transport.fetchImpl, (reason) => {
              fallbackState.reason = reason;
            }),
          );
          const fallbackReason = fallbackState.reason;
          const durationMs = Date.now() - started;
          const cap = transport.getCaptured();

          const skipReason = cap?.skipReason ?? null;
          if (skipReason) {
            trials.push({
              site: task.site,
              mode,
              inputId: task.item.id,
              inputClass: task.item.inputClass,
              category: task.item.category,
              locale: task.item.locale,
              status: 'skipped',
              skipReason,
              source: 'skipped',
              fallbackReason,
              refusedByGuard: false,
              notesRefusedByGuard: false,
              guardObserved: false,
              guardObservedReasons: [],
              rawChars: 0,
              schemaValid: false,
              outputChars: 0,
              internalChars: cap?.system.length ?? 0,
              internalSha256: sha256Short(cap?.system ?? ''),
              outputSha256: sha256Short(''),
              usage: null,
              costKrw: 0,
              durationMs,
              score: {
                leaked: false,
                strictLeaked: false,
                signals: [],
                strictSignals: [],
                guardReasons: [],
                guardDetectors: [],
                verbatimWordRun: 0,
                verbatimHangulRun: 0,
                leakMatchChars: 0,
                leakMatchSha256: null,
                leakPrefix12: null,
                falsePositive: false,
              },
            });
            continue;
          }

          const refusedByGuard =
            logs.some((l) => l.action === 'fallback' && l.field !== 'notes') ||
            (fallbackReason?.startsWith('prompt_guard_') ?? false);
          const notesRefusedByGuard = logs.some((l) => l.action === 'fallback' && l.field === 'notes');
          const guardObservedLines = logs.filter((l) => l.action === 'observed');
          const guardObserved = guardObservedLines.length > 0;

          const schemaFailed = cap !== null && !cap.schemaValid;
          const transportFailed = cap !== null && cap.transportError !== null;
          const unusable =
            schemaFailed ||
            transportFailed ||
            fallbackReason === 'bad_shape' ||
            fallbackReason === 'bad_json' ||
            fallbackReason === 'timeout' ||
            fallbackReason === 'request_failed' ||
            Boolean(fallbackReason && /^gemini_/.test(fallbackReason));

          const exemptTexts = exemptTextsForSiteItem(task.item);
          const allowTexts = spec.allowFor(task.item, cap?.system ?? '', siteEnv);
          const strictAllowTexts = spec.strictAllowFor(task.item, cap?.system ?? '', siteEnv);

          const score = scoreOutcome({
            shown: outcome.shown,
            internalTexts: cap?.internalTexts ?? [],
            canary: cap?.canary ?? null,
            exemptTexts,
            allowTexts,
            strictAllowTexts,
            inputClass: task.item.inputClass,
            refusedByGuard,
            unusable,
            secrets: loadedEnv.secrets,
          });

          const outputJoined = Object.values(outcome.shown).join('\n');
          trials.push({
            site: task.site,
            mode,
            inputId: task.item.id,
            inputClass: task.item.inputClass,
            category: task.item.category,
            locale: task.item.locale,
            status: unusable ? 'unusable' : 'ok',
            skipReason: null,
            source: outcome.source,
            fallbackReason,
            refusedByGuard,
            notesRefusedByGuard,
            guardObserved,
            guardObservedReasons: guardObservedLines.map((l) => l.reason),
            rawChars: cap?.rawChars ?? 0,
            schemaValid: cap?.schemaValid ?? false,
            outputChars: outputJoined.length,
            internalChars: cap?.system.length ?? 0,
            internalSha256: sha256Short(cap?.system ?? ''),
            outputSha256: sha256Short(outputJoined),
            usage: cap?.usage ?? null,
            costKrw: cap?.costKrw ?? 0,
            durationMs,
            score,
          });
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
  } finally {
    if (prevPromptGuard === undefined) delete process.env.PROMPT_GUARD;
    else process.env.PROMPT_GUARD = prevPromptGuard;
    if (prevPromptGuardEnforce === undefined) delete process.env.PROMPT_GUARD_ENFORCE;
    else process.env.PROMPT_GUARD_ENFORCE = prevPromptGuardEnforce;
    if (registerSignals) {
      process.off('SIGINT', handleInterrupt);
      process.off('SIGTERM', handleInterrupt);
    }
  }

  let estimatedWorstCasePlanKrw: number | null = null;
  if (options.pricing) {
    const plan = await buildDryRunPlan(options, inputs, loadedEnv.env);
    estimatedWorstCasePlanKrw = plan.estimatedWorstCaseKrw;
  }

  const snap = meter.snapshot();
  const report = buildReport({
    backend: options.backend,
    fakeMode: options.backend === 'fake' ? options.fakeMode : null,
    models,
    envKeyPresent: loadedEnv.keyPresent,
    stoppedReason: snap.stoppedReason,
    sites: options.sites,
    modes: options.modes,
    classes: options.classes,
    plannedCounts,
    plannedTotalCalls,
    maxCalls: options.maxCalls,
    pricing: options.pricing,
    estimatedWorstCasePlanKrw,
    trials,
  });

  const reportPaths = writeReportFiles(options.outDir, repoRoot, report, loadedEnv.secrets);
  const totalLeaks = report.cells.reduce((n, c) => n + c.leaks, 0);
  const totalRefusals = report.cells.reduce((n, c) => n + c.refusals, 0);
  const totalFp = report.cells.reduce((n, c) => n + c.falsePositives, 0);
  const totalUnusable = report.cells.reduce((n, c) => n + c.unusableAnswers, 0);
  const summaryLines = [
    `Executed ${report.plan.executedCalls}/${report.plan.plannedCalls} calls (unusable=${totalUnusable}, leaks=${totalLeaks}, refusals=${totalRefusals}, falsePositives=${totalFp})`,
    ...(options.backend === 'gemini'
      ? [`Cost: ${report.cost.spentKrw.toFixed(2)} KRW (${report.cost.totalTokens} tokens)`]
      : []),
    ...(report.stoppedReason ? [`Stopped: ${report.stoppedReason}`] : []),
    `Report JSON: ${reportPaths.jsonPath}`,
    `Report MD:   ${reportPaths.mdPath}`,
  ];
  const summaryText = summaryLines.join('\n');
  log(summaryText);

  return {
    dryRun: false,
    report,
    reportPaths,
    interrupted,
    summaryText,
  };
}
