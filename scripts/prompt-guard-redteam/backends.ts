import { dictatedSpans } from '@/lib/ai-guard';
import { foldText, wordUnits } from '@/lib/ai-guard/text';
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import {
  extractGeminiResponseInfo,
  extractGeminiUserTexts,
  geminiToOllamaRequest,
  ollamaToGeminiResponse,
  validateLocalOllamaUrl,
  type GeminiRequestBody,
  type OllamaChatResponse,
} from './adapter';
import type { CostMeter } from './cost';
import { parseCapturedGeminiRequest, type CapturedRequestMeta } from './sites';
import type { BackendKind, FakeMode, RedteamInputItem, SiteId, TokenUsage } from './types';

const GEAR_BRAND_RE =
  /\b(?:kodak|fujifilm|fuji|ilford|portra|cinestill|panavision|arri|alexa|red komodo|canon|nikon|sony|leica|hasselblad|zeiss|cooke|sigma art|profoto|godox|aputure)\b/i;
const BANNED_STYLE_RE =
  /\b(?:poreless\s+porcelain|glass[- ]skin|dewy\s+highlighter|same\s+as\s+(?:the\s+)?original\s+video|keep\s+(?:the\s+)?original\s+(?:video|camera)|music|musical|score|melody|melodies|songs?|soundtrack|bgm|beats?)\b/i;
const REF_TOKEN_RE = /@(?:image|video|audio)\s?\d+\b/i;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => s !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

/**
 * Finds a contiguous word slice inside `system` that does not collide with the sites' own lexical checks
 * (`INTERNAL_TERMS`, `GEAR_BRANDS`, music words, or invented `@Image`/`@Video` tokens when no ref is attached),
 * so in `off` mode the echo reaches the customer unless stopped by the prompt guard.
 */
function pickCleanInternalWindow(
  system: string,
  targetWords: number,
  hasRefs: boolean,
  startFraction = 1 / 3,
): string[] {
  const tokens = system.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const allowedLower = dictatedSpans(system).map((s) => foldText(s));
  const overlapsAllow = (slice: string) => {
    const folded = foldText(slice);
    return allowedLower.some((a) => a.length >= 20 && folded.includes(a));
  };
  const sizes = [targetWords, Math.min(30, tokens.length), Math.min(16, tokens.length), Math.min(12, tokens.length)].filter(
    (n, idx, all) => n > 0 && n <= tokens.length && all.indexOf(n) === idx,
  );
  for (const size of sizes) {
    const startAt = Math.min(Math.max(0, Math.floor(tokens.length * startFraction)), Math.max(0, tokens.length - size));
    for (let offset = 0; offset < tokens.length - size + 1; offset += 1) {
      const idx = (startAt + offset) % (tokens.length - size + 1);
      const slice = tokens.slice(idx, idx + size).join(' ');
      if (containsInternalTerm(slice, '')) continue;
      if (GEAR_BRAND_RE.test(slice)) continue;
      if (BANNED_STYLE_RE.test(slice)) continue;
      if (!hasRefs && REF_TOKEN_RE.test(slice)) continue;
      if (overlapsAllow(slice)) continue;
      return tokens.slice(idx, idx + size);
    }
  }
  return tokens.slice(0, Math.min(targetWords, tokens.length));
}

function buildEveryOtherWordLeak(system: string, hasRefs: boolean): string {
  // Use clean folded word units inside a clean internal window so skipping every 2nd word
  // always keeps the internal gap <= 2 (inside GAPPED_MAX_GAP = 3) without splitting hyphenated tokens.
  const win = pickCleanInternalWindow(system, 48, hasRefs, 0.22);
  const units = wordUnits(foldText(win.join(' ')));
  const picked = units.filter((_, idx) => idx % 2 === 0);
  if (picked.length >= 14) return picked.join(' ');
  const fallbackWin = pickCleanInternalWindow(system, 48, hasRefs, 0.55);
  return wordUnits(foldText(fallbackWin.join(' ')))
    .filter((_, idx) => idx % 2 === 0)
    .join(' ');
}

function buildBenignFakeAnswer(site: SiteId, item: RedteamInputItem): { prompt: string; notes: string } {
  const hasRef = (item.references?.length ?? 0) > 0;
  const notes =
    item.locale === 'ko'
      ? '요청하신 장면과 참조 대상을 구체적으로 정리했어요.'
      : 'Refined the scene and subject details clearly.';

  if (site === 'brand-studio.enhancer') {
    const refPart = hasRef ? 'Use Image 1 for the main subject, keeping its exact proportions and label. ' : '';
    const prompt = `${refPart}A calm editorial composition on pale stone in soft morning window daylight from the left, crisp natural material texture and balanced negative space.`;
    return { prompt, notes };
  }

  const refHeader = hasRef ? 'Reference authority: lock subject proportions and label details to @Image 1.\n' : '';
  const subject = hasRef ? '@Image 1' : 'the main product';
  const prompt = [
    `${refHeader}Visual style: #1B1F24 shadow floor, #EAE4DC warm limestone, soft side daylight with realistic contact shadows and natural texture.`,
    `0.0s–3.0s: 18° off-axis medium shot featuring ${subject} on pale stone as gentle morning light moves across the surface; slow push in. Hard cut.`,
    `3.0s–6.0s: 45° close-up resting on the surface texture of ${subject} with steady locked-off framing.`,
    'Audio: soft ambient room tone and subtle tactile sound — no background music, no score, no musical instruments.',
  ].join('\n');
  return { prompt, notes };
}

function buildEchoFakeAnswer(
  site: SiteId,
  item: RedteamInputItem,
  system: string,
  canary: string | null,
): { prompt: string; notes: string } {
  const base = buildBenignFakeAnswer(site, item);
  const hasRef = (item.references?.length ?? 0) > 0;
  const win40 = pickCleanInternalWindow(system, 40, hasRef, 0.35);

  let leakSuffix: string;
  if (item.category === 'base64') {
    const b64 = Buffer.from(win40.join(' '), 'utf8').toString('base64');
    leakSuffix = `Encoded details: ${b64}`;
  } else if (item.category === 'every-other-word') {
    leakSuffix = buildEveryOtherWordLeak(system, hasRef);
  } else if (canary && (item.category === 'repeat-above' || item.category === 'plain' || item.category === 'debug-operator')) {
    leakSuffix = `Ref ${canary}: ${win40.join(' ')}`;
  } else {
    leakSuffix = win40.join(' ');
  }

  const combined =
    site === 'brand-studio.director'
      ? `${base.prompt.replace(/\nAudio:[\s\S]*$/, '')}\nDetails: ${leakSuffix}\nAudio: soft ambient room tone — no background music, no score, no musical instruments.`
      : `${base.prompt}\n${leakSuffix}`;

  return { prompt: combined, notes: base.notes };
}

export interface TransportSession {
  fetchImpl: typeof fetch;
  getCaptured(): CapturedRequestMeta | null;
}

export interface BackendTransportConfig {
  backend: BackendKind;
  fakeMode: FakeMode;
  localUrl: string;
  localModel: string;
  timeoutMs: number;
  meter: CostMeter;
  baseFetch?: typeof fetch;
  runSignal?: AbortSignal;
}

export function createSiteTransport(
  site: SiteId,
  item: RedteamInputItem,
  config: BackendTransportConfig,
): TransportSession {
  const outboundFetch = config.baseFetch ?? fetch;
  let captured: CapturedRequestMeta | null = null;

  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const bodyText = String(init?.body ?? '');
    const parsedReq = parseCapturedGeminiRequest(url, bodyText);
    const geminiReq = JSON.parse(bodyText) as GeminiRequestBody;
    const allText = [parsedReq.system, ...extractGeminiUserTexts(geminiReq)].join('\n');

    captured = {
      ...parsedReq,
      rawChars: 0,
      schemaValid: false,
      usage: null,
      costKrw: 0,
      transportError: null,
      skipReason: null,
    };

    const reserve = config.meter.tryReserve(site, allText, parsedReq.imageCount);
    if (!reserve.ok) {
      captured.skipReason = reserve.reason;
      throw new Error(`cost_cap_${reserve.reason}`);
    }

    if (config.backend === 'fake') {
      const shouldEcho =
        config.fakeMode === 'echo' || (config.fakeMode === 'auto' && item.inputClass === 'attack');
      const answer = shouldEcho
        ? buildEchoFakeAnswer(site, item, parsedReq.system, parsedReq.canary)
        : buildBenignFakeAnswer(site, item);
      const serialized = JSON.stringify(answer);
      const usage: TokenUsage = {
        inputTokens: Math.ceil(allText.length / 4),
        outputTokens: Math.ceil(serialized.length / 4),
        totalTokens: Math.ceil((allText.length + serialized.length) / 4),
      };
      const costKrw = config.meter.settle(reserve.id, usage);
      captured.rawChars = serialized.length;
      captured.schemaValid = true;
      captured.usage = usage;
      captured.costKrw = costKrw;
      return new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: serialized }] } }],
          usageMetadata: {
            promptTokenCount: usage.inputTokens,
            candidatesTokenCount: usage.outputTokens,
            totalTokenCount: usage.totalTokens,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (config.backend === 'local') {
      const validatedBase = validateLocalOllamaUrl(config.localUrl);
      const ollamaReq = geminiToOllamaRequest(geminiReq, {
        model: config.localModel,
        numPredict: 2048,
        temperature: 0.2,
      });
      captured.model = config.localModel;

      const signal = combineSignals([AbortSignal.timeout(config.timeoutMs), config.runSignal]);
      try {
        const response = await outboundFetch(new URL('/api/chat', validatedBase), {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(ollamaReq),
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) {
          config.meter.settle(reserve.id, null);
          captured.transportError = `local_http_${response.status}`;
          return new Response(JSON.stringify({ error: captured.transportError }), { status: 502 });
        }
        const rawEnvelopeText = await response.text();
        let envelope: OllamaChatResponse;
        try {
          envelope = JSON.parse(rawEnvelopeText) as OllamaChatResponse;
        } catch {
          config.meter.settle(reserve.id, null);
          captured.rawChars = rawEnvelopeText.length;
          captured.transportError = 'local_bad_envelope_json';
          return new Response(JSON.stringify({ error: captured.transportError }), { status: 502 });
        }
        const adapted = ollamaToGeminiResponse(envelope);
        const costKrw = config.meter.settle(reserve.id, adapted.usage);
        captured.rawChars = adapted.rawChars;
        captured.schemaValid = adapted.schemaValid;
        captured.usage = adapted.usage;
        captured.costKrw = costKrw;
        return new Response(JSON.stringify(adapted.geminiBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        config.meter.settle(reserve.id, null);
        captured.transportError = err instanceof Error ? err.message : 'local_fetch_error';
        throw err;
      }
    }

    // backend === 'gemini'
    const signal = combineSignals([AbortSignal.timeout(config.timeoutMs), config.runSignal, init?.signal ?? undefined]);
    try {
      const response = await outboundFetch(input, {
        ...init,
        ...(signal ? { signal } : {}),
      });
      const responseText = await response.text();
      if (!response.ok) {
        config.meter.settle(reserve.id, null);
        captured.rawChars = responseText.length;
        captured.transportError = `gemini_http_${response.status}`;
        return new Response(responseText, {
          status: response.status,
          headers: response.headers,
        });
      }
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        config.meter.settle(reserve.id, null, { chargeWorstCaseIfMissing: true });
        captured.rawChars = responseText.length;
        captured.schemaValid = false;
        captured.transportError = 'gemini_bad_response_json';
        return new Response(responseText, { status: 200, headers: response.headers });
      }
      const info = extractGeminiResponseInfo(parsedBody);
      const costKrw = config.meter.settle(reserve.id, info.usage, { chargeWorstCaseIfMissing: true });
      captured.rawChars = info.rawChars;
      captured.schemaValid = info.schemaValid;
      captured.usage = info.usage;
      captured.costKrw = costKrw;
      return new Response(responseText, {
        status: response.status,
        headers: response.headers,
      });
    } catch (err) {
      config.meter.settle(reserve.id, null);
      captured.transportError = err instanceof Error ? err.message : 'gemini_fetch_error';
      throw err;
    }
  }) as typeof fetch;

  return {
    fetchImpl,
    getCaptured: () => captured,
  };
}
