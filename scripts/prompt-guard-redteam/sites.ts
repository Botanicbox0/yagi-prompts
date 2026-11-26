import { AsyncLocalStorage } from 'node:async_hooks';
import { dictatedSpans, type GuardLogLine } from '@/lib/ai-guard';
import {
  compileDirectorPrompt,
  composeDirectorFallbackPrompt,
  DIRECTOR_NO_BGM_AUDIO_LINE,
  directorAllow,
  directorAllowV2,
} from '@/lib/brand-studio/director';
import { composeFallbackPrompt, enhancePrompt, enhancerAllow } from '@/lib/brand-studio/enhancer';
import { studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import { AMBIENT_AUDIO_LINE, NATIVE_AUDIO_LINE } from '@/lib/brand-studio/enhancer/lines';
import { bindReferences } from '@/lib/brand-studio/enhancer/references';
import { brandSeedanceRulesV2Open } from '@/lib/flags';
import {
  countGeminiInlineImages,
  extractGeminiSystemText,
  extractGeminiUserTexts,
  type GeminiRequestBody,
} from './adapter';
import { estimateInputTokens, SITE_OUTPUT_TOKEN_CAP } from './cost';
import { customerExemptTexts, toDirectorInput, toEnhanceInput } from './inputs';
import type { GuardMode, RedteamInputItem, SiteId, TokenUsage } from './types';

export interface CapturedRequestMeta {
  model: string;
  system: string;
  userLabels: string[];
  internalTexts: string[];
  canary: string | null;
  requestTextChars: number;
  imageCount: number;
  rawChars: number;
  schemaValid: boolean;
  usage: TokenUsage | null;
  costKrw: number;
  transportError: string | null;
  skipReason: string | null;
}

export interface SiteInvocationResult {
  shown: Record<string, string>;
  source: 'model' | 'fallback';
  fallbackReason: string | null;
  logs: GuardLogLine[];
  captured: CapturedRequestMeta | null;
  durationMs: number;
}

export const PRE_G1B_ENHANCER_STATIC_ALLOW: readonly string[] = [
  AMBIENT_AUDIO_LINE,
  NATIVE_AUDIO_LINE,
  'Do not move or resize anything else.',
  'Everything else in @Video1 stays as it is.',
];

export const PRE_G1B_DIRECTOR_STATIC_ALLOW: readonly string[] = [
  DIRECTOR_NO_BGM_AUDIO_LINE,
  'Audio: live diegetic room sound, Foley and the requested musical performance.',
  'diegetic Foley, room ambience and requested dialogue only; no background music, no score, no musical instruments.',
  'natural skin texture with zero plastic beauty-filter glare',
];

export function legacyEnhancerAllowFor(
  item: RedteamInputItem,
  system: string,
  env: Record<string, string | undefined> = {},
): string[] {
  let fallbackPrompt = '';
  try {
    fallbackPrompt = composeFallbackPrompt(toEnhanceInput(item), { env }).prompt;
  } catch {
    fallbackPrompt = '';
  }
  return [...PRE_G1B_ENHANCER_STATIC_ALLOW, ...dictatedSpans(system), fallbackPrompt].filter(Boolean);
}

export function legacyDirectorAllowFor(
  item: RedteamInputItem,
  system: string,
  env: Record<string, string | undefined> = {},
): string[] {
  let fallbackPrompt = '';
  try {
    fallbackPrompt = composeDirectorFallbackPrompt(toDirectorInput(item), { env }).prompt;
  } catch {
    fallbackPrompt = '';
  }
  return [...PRE_G1B_DIRECTOR_STATIC_ALLOW, ...dictatedSpans(system), fallbackPrompt].filter(Boolean);
}

export interface GuardedSiteSpec {
  site: SiteId;
  file: string;
  modelFor(env: Record<string, string | undefined>): string;
  allowFor(item: RedteamInputItem, system: string, env?: Record<string, string | undefined>): string[];
  strictAllowFor(item: RedteamInputItem, system: string, env?: Record<string, string | undefined>): string[];
  invoke(
    item: RedteamInputItem,
    env: Record<string, string | undefined>,
    fetchImpl: typeof fetch,
    onFallback: (reason: string) => void,
  ): Promise<{ shown: Record<string, string>; source: 'model' | 'fallback' }>;
}

const DATA_BLOCK_RE = /<customer_data name="[^"]*">[\s\S]*?<\/customer_data>/g;

export function parseCapturedGeminiRequest(url: string, bodyText: string): {
  model: string;
  system: string;
  userLabels: string[];
  internalTexts: string[];
  canary: string | null;
  requestTextChars: number;
  imageCount: number;
} {
  const model = /\/models\/([^/:]+):generateContent/.exec(url)?.[1] ?? 'unknown';
  let parsed: GeminiRequestBody = {};
  try {
    parsed = JSON.parse(bodyText) as GeminiRequestBody;
  } catch {
    parsed = {};
  }
  const system = extractGeminiSystemText(parsed);
  const userTexts = extractGeminiUserTexts(parsed);
  const userLabels = userTexts
    .map((t) => t.replace(DATA_BLOCK_RE, ' ').trim())
    .filter((t) => t.length > 0);
  const internalTexts = [system, ...userLabels].filter((t) => t.length > 0);
  const canary = /\b(pgc[a-z2-9]{20})\b/.exec(system)?.[1] ?? null;
  const requestTextChars = system.length + userTexts.reduce((n, t) => n + t.length, 0);
  const imageCount = countGeminiInlineImages(parsed);
  return {
    model,
    system,
    userLabels,
    internalTexts,
    canary,
    requestTextChars,
    imageCount,
  };
}

export const GUARDED_SITES: readonly GuardedSiteSpec[] = [
  {
    site: 'brand-studio.enhancer',
    file: 'lib/brand-studio/enhancer/index.ts',
    modelFor(env) {
      return studioGeminiConfig({ ...env, GEMINI_API_KEY: env.GEMINI_API_KEY?.trim() || 'probe-key' })?.model ?? 'gemini-4-hydrogen';
    },
    allowFor(item, system, env = {}) {
      const input = toEnhanceInput(item);
      return enhancerAllow(input, bindReferences(input), system, env);
    },
    strictAllowFor(item, system, env = {}) {
      return legacyEnhancerAllowFor(item, system, env);
    },
    async invoke(item, env, fetchImpl, onFallback) {
      const result = await enhancePrompt(toEnhanceInput(item), { fetch: fetchImpl, env, onFallback });
      return {
        shown: { prompt: result.prompt, notes: result.notes },
        source: result.source,
      };
    },
  },
  {
    site: 'brand-studio.director',
    file: 'lib/brand-studio/director/compiler.ts',
    modelFor(env) {
      return studioGeminiConfig({ ...env, GEMINI_API_KEY: env.GEMINI_API_KEY?.trim() || 'probe-key' })?.model ?? 'gemini-4-hydrogen';
    },
    allowFor(item, system, env = {}) {
      const input = toDirectorInput(item);
      if (brandSeedanceRulesV2Open(env)) {
        return directorAllowV2(
          input,
          bindReferences(input),
          system,
          null,
          [],
          composeDirectorFallbackPrompt,
          DIRECTOR_NO_BGM_AUDIO_LINE,
          env,
        );
      }
      return directorAllow(input, system, null, [], env);
    },
    strictAllowFor(item, system, env = {}) {
      return legacyDirectorAllowFor(item, system, env);
    },
    async invoke(item, env, fetchImpl, onFallback) {
      const result = await compileDirectorPrompt(toDirectorInput(item), { fetch: fetchImpl, env, onFallback });
      return {
        shown: { prompt: result.prompt, notes: result.notes },
        source: result.source,
      };
    },
  },
];

export function findSiteSpec(site: SiteId): GuardedSiteSpec {
  const found = GUARDED_SITES.find((s) => s.site === site);
  if (!found) throw new Error(`Unknown guarded site "${site}"`);
  return found;
}

/* ------------------------------------------------------------------ async-safe guard log capture */

const logStore = new AsyncLocalStorage<GuardLogLine[]>();
let captureDepth = 0;
let savedConsoleWarn: typeof console.warn | null = null;

export async function withGuardLogCapture<T>(fn: () => Promise<T>): Promise<{ result: T; logs: GuardLogLine[] }> {
  const logs: GuardLogLine[] = [];
  if (captureDepth === 0) {
    savedConsoleWarn = console.warn;
    const original = savedConsoleWarn;
    console.warn = (...args: unknown[]) => {
      const first = String(args[0] ?? '');
      if (first.startsWith('[prompt-guard] ')) {
        const current = logStore.getStore();
        if (current) {
          try {
            current.push(JSON.parse(first.slice('[prompt-guard] '.length)) as GuardLogLine);
          } catch {
            // ignore malformed log line
          }
          return;
        }
      }
      original.apply(console, args);
    };
  }
  captureDepth += 1;
  try {
    const result = await logStore.run(logs, fn);
    return { result, logs };
  } finally {
    captureDepth -= 1;
    if (captureDepth === 0 && savedConsoleWarn) {
      console.warn = savedConsoleWarn;
      savedConsoleWarn = null;
    }
  }
}

/**
 * Probes the real built Gemini request for a site × mode × input without making any network or model call.
 */
export async function probeRequestSize(
  spec: GuardedSiteSpec,
  mode: GuardMode,
  item: RedteamInputItem,
  baseEnv: Record<string, string | undefined>,
): Promise<{ inputTokens: number; outputCapTokens: number }> {
  let estimatedInput = 0;
  const probeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const bodyText = String(init?.body ?? '');
    const parsed = parseCapturedGeminiRequest(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, bodyText);
    const bodyObj = JSON.parse(bodyText) as GeminiRequestBody;
    const allText = [parsed.system, ...extractGeminiUserTexts(bodyObj)].join('\n');
    estimatedInput = estimateInputTokens(allText, parsed.imageCount);
    throw new Error('dry_run_probe');
  }) as typeof fetch;

  const probeEnv: Record<string, string | undefined> = {
    ...baseEnv,
    GEMINI_API_KEY: baseEnv.GEMINI_API_KEY?.trim() || 'dry-run-probe-key',
    PROMPT_GUARD: mode,
  };

  await withGuardLogCapture(() =>
    spec.invoke(item, probeEnv, probeFetch, () => {
      // probe always aborts before network
    }),
  );

  if (estimatedInput <= 0) {
    throw new Error(`Probe captured no model call for site=${spec.site} input=${item.id} (possible passthrough)`);
  }

  return {
    inputTokens: estimatedInput,
    outputCapTokens: SITE_OUTPUT_TOKEN_CAP[spec.site],
  };
}

export function exemptTextsForSiteItem(item: RedteamInputItem): string[] {
  return customerExemptTexts(item);
}
