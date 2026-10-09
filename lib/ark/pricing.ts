import { ARK_MODELS, type ArkModelKey } from './models';

/** BytePlus ModelArk list tariffs, verified 2026-10-09. Audio is included.
 * https://docs.byteplus.com/en/docs/modelark/model-pricing
 * Image/text references only; video references need an input-duration/minimum calculation.
 * The finished task's usage.completion_tokens is authoritative.
 */
const USD_PER_MILLION: Record<ArkModelKey, Partial<Record<'720p' | '1080p', number>>> = {
  'seedance-2.5': { '720p': 10.70, '1080p': 11.70 },
  'seedance-2.0': { '720p': 7.00, '1080p': 7.70 },
  'seedance-2.0-fast': { '720p': 5.60 },
  'seedance-2.0-mini': { '720p': 3.50 },
};
const DIMENSIONS: Record<'720p' | '1080p', Record<string, readonly [number, number]>> = {
  '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1112, 834], '3:4': [834, 1112], '1:1': [960, 960], '21:9': [1470, 630] },
  '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '4:3': [1664, 1248], '3:4': [1248, 1664], '1:1': [1440, 1440], '21:9': [2206, 946] },
};

export interface ArkVideoQuoteInput {
  model: ArkModelKey;
  resolution: '720p' | '1080p';
  seconds: number;
  aspect: string;
}

export function quoteArkVideo(input: ArkVideoQuoteInput) {
  const spec = ARK_MODELS[input.model];
  if (!spec || !Number.isInteger(input.seconds) || input.seconds < spec.minDurationSeconds || input.seconds > spec.maxDurationSeconds) return null;
  const table = DIMENSIONS[input.resolution];
  const dimensions = table && Object.hasOwn(table, input.aspect) ? table[input.aspect] : null;
  const rate = USD_PER_MILLION[input.model]?.[input.resolution];
  if (!dimensions || rate === undefined) return null;
  const providerTokens = input.seconds * dimensions[0] * dimensions[1] * 24 / 1024;
  return { providerTokens, providerUsd: providerTokens * rate / 1_000_000 };
}
