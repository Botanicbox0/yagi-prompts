export const INSTAGRAM_EMBED_ORIGIN = 'https://www.instagram.com';
export const INSTAGRAM_EMBED_MIN_HEIGHT = 240;
export const INSTAGRAM_EMBED_MAX_HEIGHT = 1600;

/**
 * Parses an Instagram embed `postMessage` payload (`{"type":"MEASURE","details":{"height":N}}`,
 * sent either as an object or a JSON string) and returns the clamped integer height in px,
 * or `null` for any other origin, message type, malformed JSON, or non-finite height.
 */
export function instagramEmbedHeight(origin: string, data: unknown): number | null {
  if (origin !== INSTAGRAM_EMBED_ORIGIN) return null;

  let payload: unknown = data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.type !== 'MEASURE') return null;

  const details = record.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const height = (details as Record<string, unknown>).height;
  if (typeof height !== 'number' || !Number.isFinite(height)) return null;

  const rounded = Math.round(height);
  return Math.min(INSTAGRAM_EMBED_MAX_HEIGHT, Math.max(INSTAGRAM_EMBED_MIN_HEIGHT, rounded));
}
