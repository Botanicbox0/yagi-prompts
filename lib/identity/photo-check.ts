import sharp from 'sharp';
import { z } from 'zod';
import type { PhotoCheck, PhotoCheckIssue } from './photo-check-view';

/**
 * The advisory photo check (server only — it reads GEMINI_API_KEY; not marked `server-only` so the
 * vitest node runner can import it, and nothing on the client imports it).
 *
 * One saved photo goes to Google Gemini once; the model reports photo-quality FACTS only (how many
 * faces, cover, angle, sharpness, light, size). It never identifies anyone. The server turns the facts
 * into a verdict (`photoVerdict`), and the screens say it in our own words. Advisory only: nothing that
 * reads this result may block saving, choosing or paying (AGENTS.md §5).
 *
 * Off unless TWINGS_PHOTO_CHECK=on AND GEMINI_API_KEY is set: the privacy policy must first name the
 * processor (founder's call; `lib/legal/documents.ts` is untouched here).
 *
 * The prompt and schema were validated against the real model by the founder's session (8 images).
 * `lib/template-director/flash-director.ts`'s `inspectPhoto` is a different, older prompt — not reused.
 */
export const PHOTO_CHECK_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const PHOTO_CHECK_DEFAULT_MODEL = 'gemini-4-hydrogen';
/** A real call took up to 11.7 s (2026-11-15, 8 images, median 3.5 s). Past this the screens simply show nothing. */
export const PHOTO_CHECK_TIMEOUT_MS = 20_000;

export const PHOTO_CHECK_SYSTEM = [
  'You check whether ONE uploaded photo is usable as the face reference for an AI video of the person in it.',
  'Report only what is visible about the PHOTO. Never identify the person, never guess name, age, ethnicity, health or emotion, and never describe who they are.',
  'Answer with the JSON object only.',
  'Definitions:',
  '- faceCount: human faces a viewer would notice (0, 1, or 2 for two or more). Tiny background faces do not count.',
  '- realPerson: false for a drawing, 3D character, doll, statue, pet, or a photo of a screen/poster.',
  '- faceCover: what hides part of the face. "none" when eyes, nose, mouth and jawline are all visible.',
  '- angle: "front" within about 15 degrees of the camera, "turned" up to about 45 degrees, "side" beyond that, "tilted" when the head is strongly tilted up or down.',
  '- sharpness: judge the face only. "blurry" when eyes and lips have no crisp edges.',
  '- lighting: judge the face only. "dark" when features are hard to read, "backlit" when the face is in shadow against a bright background, "harsh" for strong shadows or blown highlights across the face.',
  '- faceSize: "small" when the face is under roughly one eighth of the image width, "close" when the face fills the frame so the chin, forehead or hairline is cut off, else "ok".',
].join('\n');

const COVERS = ['none', 'hand', 'mask', 'sunglasses', 'hair', 'object', 'hat'] as const;
const ANGLES = ['front', 'turned', 'side', 'tilted'] as const;
const SHARPNESS = ['sharp', 'soft', 'blurry'] as const;
const LIGHTING = ['even', 'dark', 'backlit', 'harsh'] as const;
const SIZES = ['small', 'ok', 'close'] as const;

export const PHOTO_CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    faceCount: { type: 'INTEGER' },
    realPerson: { type: 'BOOLEAN' },
    faceCover: { type: 'ARRAY', items: { type: 'STRING', enum: [...COVERS] } },
    angle: { type: 'STRING', enum: [...ANGLES] },
    sharpness: { type: 'STRING', enum: [...SHARPNESS] },
    lighting: { type: 'STRING', enum: [...LIGHTING] },
    faceSize: { type: 'STRING', enum: [...SIZES] },
  },
  required: ['faceCount', 'realPerson', 'faceCover', 'angle', 'sharpness', 'lighting', 'faceSize'],
} as const;

export const photoFactsSchema = z.object({
  faceCount: z.number().int().min(0),
  realPerson: z.boolean(),
  faceCover: z.array(z.enum(COVERS)),
  angle: z.enum(ANGLES),
  sharpness: z.enum(SHARPNESS),
  lighting: z.enum(LIGHTING),
  faceSize: z.enum(SIZES),
});
export type PhotoFacts = z.infer<typeof photoFactsSchema>;

/** Covers that hide what the video needs. Hair and hats are judged unreliably and are not issues. */
const BLOCKING_COVERS: ReadonlySet<string> = new Set(['mask', 'sunglasses', 'hand', 'object']);
const RETAKE: ReadonlySet<PhotoCheckIssue> = new Set(['no_face', 'multiple_faces', 'not_real_person', 'face_covered', 'blurry']);

/**
 * The verdict, derived here and nowhere else. Order matters (the screens show the first three).
 * `turned`, `soft`, `harsh`, `close`, hair and hat are deliberately not issues.
 */
export function photoVerdict(facts: PhotoFacts): PhotoCheck {
  if (facts.faceCount <= 0) return { status: 'retake', issues: ['no_face'] };
  const issues: PhotoCheckIssue[] = [];
  if (facts.faceCount >= 2) issues.push('multiple_faces');
  if (!facts.realPerson) issues.push('not_real_person');
  if (facts.faceCover.some(cover => BLOCKING_COVERS.has(cover))) issues.push('face_covered');
  if (facts.sharpness === 'blurry') issues.push('blurry');
  if (facts.angle === 'side' || facts.angle === 'tilted') issues.push('side_angle');
  if (facts.lighting === 'dark') issues.push('dark');
  if (facts.lighting === 'backlit') issues.push('backlit');
  if (facts.faceSize === 'small') issues.push('small_face');
  const status = issues.some(issue => RETAKE.has(issue)) ? 'retake' : issues.length ? 'check' : 'good';
  return { status, issues };
}

export interface PhotoCheckConfig { apiKey: string; baseUrl: string; model: string }

/** Null — the check is off — unless TWINGS_PHOTO_CHECK=on and GEMINI_API_KEY is present. */
export function photoCheckConfigFromEnv(env: Record<string, string | undefined> = process.env): PhotoCheckConfig | null {
  if (env.TWINGS_PHOTO_CHECK?.trim() !== 'on') return null;
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = env.GEMINI_BASE_URL?.trim().replace(/\/+$/, '') || PHOTO_CHECK_DEFAULT_BASE_URL;
  const override = env.GEMINI_PHOTO_CHECK_MODEL?.trim();
  const model = override && /^[a-z0-9.-]{1,60}$/i.test(override) ? override : PHOTO_CHECK_DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

interface GeminiResponse { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }

/** The model's facts about one photo, or null for ANY failure (bad image, HTTP, timeout, JSON, schema). */
export async function readPhotoFacts(config: PhotoCheckConfig, fetchImpl: typeof fetch, bytes: Uint8Array): Promise<PhotoFacts | null> {
  try {
    const jpeg = await sharp(bytes).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const response = await fetchImpl(`${config.baseUrl}/models/${config.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PHOTO_CHECK_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: PHOTO_CHECK_SCHEMA, thinkingConfig: { thinkingLevel: 'low' } },
      }),
      signal: AbortSignal.timeout(PHOTO_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json() as GeminiResponse;
    const text = (body.candidates?.[0]?.content?.parts ?? []).filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('');
    const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
    const parsed = photoFactsSchema.safeParse(JSON.parse(fenced ? fenced[1]! : text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type PhotoChecker = (bytes: Uint8Array) => Promise<PhotoCheck | null>;

/** The checker the service runs, or null when the check is off (no call is ever made then). */
export function photoCheckerFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): PhotoChecker | null {
  const config = photoCheckConfigFromEnv(env);
  if (!config) return null;
  return async bytes => {
    const facts = await readPhotoFacts(config, fetchImpl, bytes);
    return facts ? photoVerdict(facts) : null;
  };
}
