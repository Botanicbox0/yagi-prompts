import type { GeminiPricing, SiteId, TokenUsage } from './types';

export const INPUT_SAFETY_FACTOR = 1.25;

export const SITE_OUTPUT_TOKEN_CAP: Record<SiteId, number> = {
  'brand-studio.enhancer': 4096,
  'brand-studio.director': 4096,
};

export function validateGeminiPricing(raw: Partial<GeminiPricing>): GeminiPricing {
  const fields: Array<[keyof GeminiPricing, string]> = [
    ['maxKrw', '--max-krw'],
    ['usdKrw', '--usd-krw'],
    ['priceInUsdPerMtok', '--price-in-usd-per-mtok'],
    ['priceOutUsdPerMtok', '--price-out-usd-per-mtok'],
  ];
  const invalid: string[] = [];
  for (const [key, flagName] of fields) {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      invalid.push(flagName);
    }
  }
  if (invalid.length > 0) {
    throw new Error(`--backend=gemini requires positive numeric flags: ${invalid.join(', ')}`);
  }
  return {
    maxKrw: raw.maxKrw!,
    usdKrw: raw.usdKrw!,
    priceInUsdPerMtok: raw.priceInUsdPerMtok!,
    priceOutUsdPerMtok: raw.priceOutUsdPerMtok!,
  };
}

/**
 * Character-based worst-case input token estimate with a safety factor:
 * ASCII characters tokenize at ~3.5 chars/token conservatively, non-ASCII (Korean/CJK) up to ~1.2 tokens/char,
 * plus 258 tokens per inline image, multiplied by `INPUT_SAFETY_FACTOR`.
 */
export function estimateInputTokens(requestText: string, imageCount = 0): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of requestText) {
    if (ch.charCodeAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  const base = Math.ceil(ascii / 3.5 + nonAscii * 1.2 + Math.max(0, imageCount) * 258);
  return Math.max(1, Math.ceil(base * INPUT_SAFETY_FACTOR));
}

export function estimateWorstCaseCall(site: SiteId, requestText: string, imageCount = 0): TokenUsage {
  const inputTokens = estimateInputTokens(requestText, imageCount);
  const outputTokens = SITE_OUTPUT_TOKEN_CAP[site];
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function computeCostKrw(usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens'>, pricing: GeminiPricing): number {
  const usd =
    (usage.inputTokens / 1_000_000) * pricing.priceInUsdPerMtok +
    (usage.outputTokens / 1_000_000) * pricing.priceOutUsdPerMtok;
  return usd * pricing.usdKrw;
}

export type ReserveResult =
  | {
      ok: true;
      id: number;
      worstCaseTokens: TokenUsage;
      worstCaseKrw: number;
    }
  | {
      ok: false;
      reason: 'max_krw' | 'max_calls' | 'already_stopped';
      worstCaseTokens: TokenUsage;
      worstCaseKrw: number;
    };

export interface CostMeterSnapshot {
  startedCalls: number;
  settledCalls: number;
  spentKrw: number;
  reservedKrw: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stoppedReason: string | null;
}

interface PendingReservation {
  worstCaseTokens: TokenUsage;
  worstCaseKrw: number;
}

export class CostMeter {
  private readonly pricing: GeminiPricing | null;
  private readonly maxCalls: number | null;
  private nextId = 1;
  private startedCalls = 0;
  private settledCalls = 0;
  private spentKrw = 0;
  private reservedKrw = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;
  private stoppedReason: string | null = null;
  private readonly pending = new Map<number, PendingReservation>();

  constructor(options: { pricing: GeminiPricing | null; maxCalls: number | null }) {
    if (options.maxCalls !== null && (!Number.isInteger(options.maxCalls) || options.maxCalls < 1)) {
      throw new Error(`--max-calls must be a positive integer, got ${options.maxCalls}`);
    }
    this.pricing = options.pricing;
    this.maxCalls = options.maxCalls;
  }

  /**
   * Atomically checks caps and reserves worst-case cost before starting an outbound request.
   * Synchronous so concurrent callers cannot race past `--max-krw` or `--max-calls`.
   */
  tryReserve(site: SiteId, requestText: string, imageCount = 0): ReserveResult {
    const worstCaseTokens = estimateWorstCaseCall(site, requestText, imageCount);
    const worstCaseKrw = this.pricing ? computeCostKrw(worstCaseTokens, this.pricing) : 0;

    if (this.stoppedReason) {
      return { ok: false, reason: 'already_stopped', worstCaseTokens, worstCaseKrw };
    }
    if (this.maxCalls !== null && this.startedCalls >= this.maxCalls) {
      this.stoppedReason = 'max_calls';
      return { ok: false, reason: 'max_calls', worstCaseTokens, worstCaseKrw };
    }
    if (this.pricing && this.spentKrw + this.reservedKrw + worstCaseKrw > this.pricing.maxKrw) {
      this.stoppedReason = 'max_krw';
      return { ok: false, reason: 'max_krw', worstCaseTokens, worstCaseKrw };
    }

    const id = this.nextId;
    this.nextId += 1;
    this.startedCalls += 1;
    this.reservedKrw += worstCaseKrw;
    this.pending.set(id, { worstCaseTokens, worstCaseKrw });
    return { ok: true, id, worstCaseTokens, worstCaseKrw };
  }

  /**
   * Settles a previously reserved call using provider usage when available.
   */
  settle(
    id: number,
    actualUsage: TokenUsage | null,
    options: { chargeWorstCaseIfMissing?: boolean } = {},
  ): number {
    const reservation = this.pending.get(id);
    if (!reservation) return 0;
    this.pending.delete(id);
    this.reservedKrw = Math.max(0, this.reservedKrw - reservation.worstCaseKrw);
    this.settledCalls += 1;

    if (actualUsage) {
      this.inputTokens += actualUsage.inputTokens;
      this.outputTokens += actualUsage.outputTokens;
      this.totalTokens += actualUsage.totalTokens;
      const costKrw = this.pricing ? computeCostKrw(actualUsage, this.pricing) : 0;
      this.spentKrw += costKrw;
      return costKrw;
    }

    if (options.chargeWorstCaseIfMissing) {
      this.inputTokens += reservation.worstCaseTokens.inputTokens;
      this.outputTokens += reservation.worstCaseTokens.outputTokens;
      this.totalTokens += reservation.worstCaseTokens.totalTokens;
      this.spentKrw += reservation.worstCaseKrw;
      return reservation.worstCaseKrw;
    }

    return 0;
  }

  markStopped(reason: string): void {
    if (!this.stoppedReason) this.stoppedReason = reason;
  }

  snapshot(): CostMeterSnapshot {
    return {
      startedCalls: this.startedCalls,
      settledCalls: this.settledCalls,
      spentKrw: this.spentKrw,
      reservedKrw: this.reservedKrw,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
      stoppedReason: this.stoppedReason,
    };
  }
}
