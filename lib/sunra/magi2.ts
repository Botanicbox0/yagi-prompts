import { isPublicHttpsUrl, outsideQuotes } from './seedance';

/**
 * MAGI-2 (Sand.ai) on Sunra's API-key lane (`POST {SUNRA_BASE_URL}/v1/queue/sand/magi-2/...`).
 * Pure: no network, no environment, no database, no Node imports.
 *
 * Verified provider contract (2026-11-28):
 *   - prompt: 1–15,000 characters
 *   - duration: integer 4–30 seconds (default 5)
 *   - aspect_ratio: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9
 *   - resolution: "1080p" only
 *   - generate_audio: boolean (default true)
 *   - references: <= 10 images, <= 5 videos, <= 5 audios (all public https URLs)
 *   - list price: US$0.08 per requested second (audio included), before Sunra's 5% top-up fee
 */

export const MAGI2_REFERENCE_ENDPOINT = 'sand/magi-2/reference-to-video' as const;
export const MAGI2_IMAGE_ENDPOINT = 'sand/magi-2/image-to-video' as const;
export const MAGI2_TEXT_ENDPOINT = 'sand/magi-2/text-to-video' as const;

export const MAGI2_ENDPOINTS = {
  reference: MAGI2_REFERENCE_ENDPOINT,
  image: MAGI2_IMAGE_ENDPOINT,
  text: MAGI2_TEXT_ENDPOINT,
} as const;

export const MAGI2_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export type Magi2Ratio = (typeof MAGI2_RATIOS)[number];

export const MAGI2_RESOLUTIONS = ['1080p'] as const;
export type Magi2Resolution = (typeof MAGI2_RESOLUTIONS)[number];

export const MAGI2_PROMPT_MIN_CHARS = 1;
export const MAGI2_PROMPT_MAX_CHARS = 15_000;
export const MAGI2_MIN_SECONDS = 4;
export const MAGI2_MAX_SECONDS = 30;
export const MAGI2_DEFAULT_SECONDS = 5;
export const MAGI2_MAX_REFERENCE_IMAGES = 10;
export const MAGI2_MAX_REFERENCE_VIDEOS = 5;
export const MAGI2_MAX_REFERENCE_AUDIOS = 5;
export const MAGI2_USD_PER_SECOND = 0.08;

export class Magi2RequestError extends Error {
  constructor(readonly reason: string) {
    super(`magi-2 request: ${reason}`);
    this.name = 'Magi2RequestError';
  }
}

export interface Magi2ReferenceInput {
  prompt: string;
  aspectRatio: string;
  /** Whole seconds 4–30, defaults to 5. Never clamped here: an unpriced length is refused. */
  seconds?: number;
  /** Only "1080p" is supported by MAGI-2. Defaults to "1080p". */
  resolution?: Magi2Resolution;
  /** Defaults to true. */
  generateAudio?: boolean;
  referenceImages?: readonly string[];
  referenceVideos?: readonly string[];
  referenceAudios?: readonly string[];
}

/* ------------------------------------------------------------------ prompt checks */

/**
 * What the prompt still carries of a recipe token: a `{{name}}` pair (lib/recipes/schema.ts `engineStepPrompt` replaces
 * every pair it knows), or a lone `{{` / `}}` left by a broken one. Either means the step prompt was not resolved; the
 * recipe rules and the set-prompt rules refuse both, so a prompt that reaches the provider with one is certainly wrong.
 * Read everywhere, quotes included: a token inside dialogue is still an unresolved token.
 */
export function unresolvedPromptTokens(prompt: string): string[] {
  const pairs = /\{\{[^{}]*\}\}/g;
  const found = [...prompt.matchAll(pairs)].map((match) => match[0]);
  const rest = prompt.replace(pairs, ' ');
  for (const stray of rest.matchAll(/\{\{|\}\}/g)) found.push(stray[0]);
  return found;
}

export interface Magi2ReferenceCounts {
  images: number;
  videos: number;
  audios: number;
}

/**
 * The references a prompt names, outside quotes, that this request does not carry: "Image N" / "@ImageN" past the
 * number of reference images, and the same for "Video N" and "Audio N" against the reference videos and audios
 * (lib/recipes/schema.ts numbers each kind on its own: Image 1.., Video 1.., Audio 1..). The token grammar and the
 * quote rule are the Seedance lane's (lib/sunra/seedance.ts `unattachedReferences`). MAGI-2's own in-prompt reference
 * syntax is NOT verified (2026-11-28), so this only refuses what is certainly wrong and the prompt is never rewritten.
 */
export function unattachedMagi2References(prompt: string, counts: Magi2ReferenceCounts): string[] {
  const missing: string[] = [];
  outsideQuotes(prompt, (plain) => {
    for (const match of plain.matchAll(/(?<![\w@])(@(?:Image|Video|Audio) ?\d+|(?:Image|Video|Audio) \d+)\b/g)) {
      const token = match[1]!;
      const kind = /Image|Video|Audio/.exec(token)![0];
      const n = Number.parseInt(/\d+/.exec(token)![0], 10);
      const have = kind === 'Image' ? counts.images : kind === 'Video' ? counts.videos : counts.audios;
      if (n < 1 || n > have) missing.push(token);
    }
    return plain;
  });
  return missing;
}

function validateUrlList(urls: readonly string[], label: string, max: number): void {
  if (urls.length > max) {
    throw new Magi2RequestError(`takes at most ${max} ${label}`);
  }
  for (const url of urls) {
    if (!isPublicHttpsUrl(url)) {
      throw new Magi2RequestError(`${label} must contain only public https URLs`);
    }
  }
}

export function magi2ReferenceRequest(input: Magi2ReferenceInput): {
  endpoint: typeof MAGI2_REFERENCE_ENDPOINT;
  body: Record<string, unknown>;
} {
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
    throw new Magi2RequestError('an empty prompt');
  }
  if (input.prompt.length > MAGI2_PROMPT_MAX_CHARS) {
    throw new Magi2RequestError(`prompt exceeds ${MAGI2_PROMPT_MAX_CHARS} characters`);
  }

  const duration = input.seconds ?? MAGI2_DEFAULT_SECONDS;
  if (!Number.isInteger(duration) || duration < MAGI2_MIN_SECONDS || duration > MAGI2_MAX_SECONDS) {
    throw new Magi2RequestError(
      `${String(duration)} seconds (whole seconds from ${MAGI2_MIN_SECONDS} to ${MAGI2_MAX_SECONDS})`,
    );
  }

  if (!(MAGI2_RATIOS as readonly string[]).includes(input.aspectRatio)) {
    throw new Magi2RequestError(`aspect_ratio ${String(input.aspectRatio)}`);
  }

  const resolution = input.resolution ?? '1080p';
  if (resolution !== '1080p') {
    throw new Magi2RequestError(`resolution ${String(resolution)} (only 1080p is supported)`);
  }

  const generateAudio = input.generateAudio ?? true;
  if (typeof generateAudio !== 'boolean') {
    throw new Magi2RequestError('generate_audio must be a boolean');
  }

  const images = input.referenceImages ?? [];
  const videos = input.referenceVideos ?? [];
  const audios = input.referenceAudios ?? [];
  if (images.length + videos.length + audios.length === 0) {
    throw new Magi2RequestError('needs at least one reference');
  }
  validateUrlList(images, 'reference_images', MAGI2_MAX_REFERENCE_IMAGES);
  validateUrlList(videos, 'reference_videos', MAGI2_MAX_REFERENCE_VIDEOS);
  validateUrlList(audios, 'reference_audios', MAGI2_MAX_REFERENCE_AUDIOS);

  // A prompt that still asks for a recipe token, or for a reference this request does not carry, would render,
  // be billed and be wrong: refused here, before anything is sent. The prompt itself is sent exactly as written.
  const unresolved = unresolvedPromptTokens(input.prompt);
  if (unresolved.length) throw new Magi2RequestError(`the prompt still holds unresolved tokens: ${unresolved.join(', ')}`);
  const missing = unattachedMagi2References(input.prompt, { images: images.length, videos: videos.length, audios: audios.length });
  if (missing.length) throw new Magi2RequestError(`the prompt names ${missing.join(', ')} that this request does not carry`);

  const body: Record<string, unknown> = {
    prompt: input.prompt,
    duration,
    aspect_ratio: input.aspectRatio,
    resolution,
    generate_audio: generateAudio,
    ...(images.length > 0 ? { reference_images: [...images] } : {}),
    ...(videos.length > 0 ? { reference_videos: [...videos] } : {}),
    ...(audios.length > 0 ? { reference_audios: [...audios] } : {}),
  };

  return { endpoint: MAGI2_REFERENCE_ENDPOINT, body };
}

/** Provider list price for MAGI-2 in USD ($0.08/s, audio included, before Sunra's 5% top-up fee). */
export function estimateMagi2Usd(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(MAGI2_USD_PER_SECOND * seconds * 10_000) / 10_000;
}
