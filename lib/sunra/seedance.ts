/**
 * Seedance 2.5 on Sunra's API lane, shared by the brand studio and the personal Sunra lane
 * (docs/PERSONAL-STUDIO.md §5.1). Pure: no network, no environment, no database.
 *
 *   seedanceReferenceRequest   the reference-to-video request: the same body the brand studio's builder
 *                              sends (lib/brand-studio/provider/requests.ts `videoRequest`, pinned by
 *                              tests/sunra/seedance.test.ts), restricted to what the personal lane sends:
 *                              reference images only, never a draft, always with sound.
 *   estimateSeedanceUsd        what one run is billed (moved here from lib/brand-studio/models.ts, which
 *                              re-exports it as `estimateVideoUsd`).
 *   toSunraReferenceSyntax     the recipe dialect ("Image 2", lib/recipes/schema.ts `engineStepPrompt`)
 *                              into Sunra's ("@Image2").
 *   unattachedReferences       which references a prompt names that the request does not carry.
 *
 * Nothing here decides who may be sent: the photos arrive as URLs a caller already chose. Every URL must be
 * a public https address; a `data:` URL, an `asset://` id or a local address is refused before any call.
 *
 * No Node imports: lib/brand-studio/models.ts re-exports the estimator and is read by client components.
 */

/** An IP literal as WHATWG URL leaves it (decimal and hex IPv4 forms come out dotted; IPv6 keeps its colons). */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export const SEEDANCE_REFERENCE_ENDPOINT = 'bytedance/seedance-2.5/reference-to-video' as const;
/** The Sunra catalogue's Seedance 2.5 frame list (lib/brand-studio/models.ts `SEEDANCE_ASPECTS`). */
export const SEEDANCE_RATIOS = ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'] as const;
/** The brand catalogue's limit for Seedance 2.5 on Sunra (`maxReferenceImages`). */
export const SEEDANCE_MAX_REFERENCE_IMAGES = 9;
/** The provider's range for one Seedance 2.5 run (whole seconds). */
export const SEEDANCE_MIN_SECONDS = 4;
export const SEEDANCE_MAX_SECONDS = 30;

export type SeedanceResolution = '480p' | '720p' | '1080p';

export class SeedanceRequestError extends Error {
  constructor(readonly reason: string) {
    super(`seedance request: ${reason}`);
    this.name = 'SeedanceRequestError';
  }
}

/** A public https address the provider can fetch: no credentials in it, no IP literal, no local host. */
export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (isIpLiteral(host) || host === 'localhost' || !host.includes('.') || /\.(?:local|internal|localhost)$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface SeedanceReferenceInput {
  prompt: string;
  resolution: '720p' | '1080p';
  ratio: string;
  /** Output seconds, whole, as priced. Never clamped here: a length the price did not cover is refused. */
  seconds: number;
  /** Public https URLs, in the order the prompt names them (@Image1, @Image2, …). */
  referenceImages: readonly string[];
}

export function seedanceReferenceRequest(input: SeedanceReferenceInput): { endpoint: string; body: Record<string, unknown> } {
  if (!input.prompt.trim()) throw new SeedanceRequestError('an empty prompt');
  if (input.resolution !== '720p' && input.resolution !== '1080p') throw new SeedanceRequestError(`resolution ${String(input.resolution)}`);
  if (!(SEEDANCE_RATIOS as readonly string[]).includes(input.ratio)) throw new SeedanceRequestError(`ratio ${input.ratio}`);
  if (!Number.isInteger(input.seconds) || input.seconds < SEEDANCE_MIN_SECONDS || input.seconds > SEEDANCE_MAX_SECONDS) {
    throw new SeedanceRequestError(`${input.seconds} seconds (whole seconds from ${SEEDANCE_MIN_SECONDS} to ${SEEDANCE_MAX_SECONDS})`);
  }
  if (input.referenceImages.length === 0) throw new SeedanceRequestError('needs at least one reference image');
  if (input.referenceImages.length > SEEDANCE_MAX_REFERENCE_IMAGES) throw new SeedanceRequestError(`takes at most ${SEEDANCE_MAX_REFERENCE_IMAGES} reference images`);
  for (const url of input.referenceImages) {
    if (!isPublicHttpsUrl(url)) throw new SeedanceRequestError('a reference image must be a public https URL');
  }
  // Key for key what lib/brand-studio/provider/requests.ts `videoRequest` sends for a reference run.
  return {
    endpoint: SEEDANCE_REFERENCE_ENDPOINT,
    body: {
      prompt: input.prompt,
      resolution: input.resolution,
      duration: input.seconds,
      draft: false,
      output_format: 'mp4',
      generate_audio: true,
      ratio: input.ratio,
      reference_images: [...input.referenceImages],
    },
  };
}

/* ------------------------------------------------------------------ prompt tokens */

/**
 * Double-quoted spans on one line ("…" or “…”): dialogue and on-screen text. A token inside one is words
 * the film should say or show, not a reference.
 *
 * LIMIT: this is a reading of the text, not a marker. Once a slot became "Image 2" (lib/recipes/schema.ts
 * `engineStepPrompt`), a slot a maker wrote inside quotes looks exactly like dialogue and stays plain words;
 * an unbalanced quote or one that runs over a line break opens no span at all. Single quotes are not read
 * (apostrophes). The identity line `engineStepPrompt` appends sits outside any quotes, so the people are
 * always bound by "@ImageN" there. tests/sunra/seedance.test.ts pins each of these cases.
 */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;

export function outsideQuotes(text: string, fn: (plain: string) => string): string {
  let out = '';
  let at = 0;
  for (const match of text.matchAll(QUOTED)) {
    out += fn(text.slice(at, match.index)) + match[0];
    at = match.index + match[0].length;
  }
  return out + fn(text.slice(at));
}

/** "Image 2" → "@Image2" for images 1..`images`; anything else (a higher number, "image 2", "@Image 2") is left as written. */
export function toSunraReferenceSyntax(prompt: string, images: number): string {
  return outsideQuotes(prompt, (plain) =>
    plain.replace(/(?<![\w@])Image (\d+)\b/g, (match, digits: string) => {
      const n = Number.parseInt(digits, 10);
      return n >= 1 && n <= images ? `@Image${n}` : match;
    }),
  );
}

/**
 * The references a prompt names, outside quotes, that a request with `images` reference images (and no video
 * or audio) does not carry: "@Image3" or "Image 3" past the count, any video or audio token. A prompt asking
 * for a missing reference still renders, is billed, and is wrong, so the caller refuses it before sending.
 */
export function unattachedReferences(prompt: string, images: number): string[] {
  const missing: string[] = [];
  outsideQuotes(prompt, (plain) => {
    for (const match of plain.matchAll(/(?<![\w@])(@(?:Image|Video|Audio) ?\d+|(?:Image|Video|Audio) \d+)\b/g)) {
      const token = match[1]!;
      const kind = /Image|Video|Audio/.exec(token)![0];
      const n = Number.parseInt(/\d+/.exec(token)![0], 10);
      if (kind !== 'Image' || n < 1 || n > images) missing.push(token);
    }
    return plain;
  });
  return missing;
}

/* ------------------------------------------------------------------ cost */

/**
 * The account lane charges whole credits and one credit is one US cent, so a figure is rounded up to the cent
 * (lib/brand-studio/models.ts `billedUsd` is this rule).
 */
export function roundUpToCent(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * 100 - 1e-6) / 100;
}

/** Pixel budget Seedance spends per frame at each resolution (independent of the aspect ratio). */
const SEEDANCE_PIXELS: Record<SeedanceResolution, number> = {
  '480p': 409_920, // 854 x 480
  '720p': 921_600, // 1280 x 720
  '1080p': 2_073_600, // 1920 x 1080
};
const SEEDANCE_FPS = 24;
/** USD per million tokens: [without an input video, with one]. */
const SEEDANCE_USD_PER_M: Record<SeedanceResolution, readonly [number, number]> = {
  '480p': [10.7, 6.4],
  '720p': [10.7, 6.4],
  '1080p': [11.7, 7.0],
};

/**
 * What one Seedance 2.5 run is billed, in USD (docs.sunra.ai/platform/pricing, "Seedance video token
 * pricing"), rounded up to the cent like every account-lane charge:
 *
 *   frames = 24 x output seconds + 1, plus 24 x billed input seconds with a reference video
 *   tokens = floor(frames x width x height / 1024)
 *
 * The input is billed for its own length, at least ceil(output x 2/3) seconds, and a run that carries a
 * video takes the lower rate for the whole request. No allowance on top: this is the provider's own
 * estimate to the credit (60 settings compared on 2026-11-18, tests/brand-studio/server/quote-parity).
 * Reference images are not billed. Sunra's 5% top-up fee is NOT included (`SUNRA_TOPUP_FEE_MULTIPLIER`).
 */
export function estimateSeedanceUsd(input: {
  resolution: SeedanceResolution;
  /** Output seconds; for an edit that follows the source, pass the source length. */
  seconds: number;
  /** Seconds of reference video attached, 0 when none. */
  referenceVideoSeconds: number;
}): number {
  const seconds = Math.max(1, input.seconds);
  const withVideo = input.referenceVideoSeconds > 0;
  const billedInput = withVideo ? Math.max(input.referenceVideoSeconds, Math.ceil((seconds * 2) / 3)) : 0;
  const frames = SEEDANCE_FPS * seconds + 1 + SEEDANCE_FPS * billedInput;
  const tokens = Math.floor((SEEDANCE_PIXELS[input.resolution] * frames) / 1024);
  const rate = SEEDANCE_USD_PER_M[input.resolution][withVideo ? 1 : 0];
  return roundUpToCent((tokens / 1_000_000) * rate);
}
