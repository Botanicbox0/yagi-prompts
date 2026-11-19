/**
 * The category of an uploaded picture, recognised once (docs/BRAND-STUDIO-V3.md §4.1).
 *
 * After an image upload is finalized (`completeStudioAsset`), one Gemini call reads the asset's 512 px WebP
 * thumbnail. The model reports FACTS only (its best category, the next category a careful art director could
 * pick, what sort of picture it is, who is in it, how much text it carries); `roleFromFacts` alone decides.
 * A role is saved only when the facts leave no doubt; any doubt, failure, block or timeout leaves the role
 * empty and the writer keeps inferring it per run (enhancer/index.ts), as before this existed.
 *
 * Why so strict: the saved role steers Prompt Architect's reference directive (enhancer/lines.ts) and the
 * skin rules (enhancer/profiles/skin.ts). A style picture saved as `product` makes the writer say "keep the
 * label"; an empty role costs nothing.
 *
 * Never on the upload's path: the check runs after the answer is sent (`deps.later`, Next's `after()`), and
 * writes only while the row still has no role and no `role_source` (0098), so a customer's choice is never
 * overwritten. Images uploaded by a member only; video, audio, results and deliveries are not read.
 * Off with `BRAND_STUDIO_ASSET_AUTO_ROLE=off`, and whenever no Gemini key is configured.
 *
 * Server only (it reads GEMINI_API_KEY through the studio config); nothing on the client imports it.
 */
import sharp from 'sharp';
import { z } from 'zod';
import { STUDIO_ASSET_ROLES, type StudioAssetRole } from './contracts';
import { callGeminiJson, inlinePart, studioGeminiConfig, type GeminiConfig } from './enhancer/gemini';
import type { AssetRow, StudioDeps } from './types';

/** A real call measured about 3.5 s (2026-11-19); past this the role simply stays empty. */
export const ASSET_ROLE_TIMEOUT_MS = 15_000;

const ALTERNATIVES = [...STUDIO_ASSET_ROLES, 'none'] as const;
const KINDS = ['photo', 'render', 'flat_graphic', 'screenshot', 'document', 'collage'] as const;
const PEOPLE = ['none', 'hands_or_body_part', 'one_face_visible', 'one_face_hidden', 'several'] as const;
const FRAMING = ['no_person', 'close_up', 'head_and_shoulders', 'half_body', 'full_body', 'small_in_frame'] as const;
const LIGHT = ['even', 'natural', 'dramatic', 'coloured_or_effect'] as const;
const TEXT = ['none', 'mark_or_label', 'some', 'lots'] as const;

export const ASSET_ROLE_SYSTEM = [
  'You look at ONE picture a brand uploaded to its library and report facts about it. Never identify a person, brand or place by name. Answer with the JSON object only.',
  'The library sorts pictures by what the brand will take from them when making new images:',
  '- product: one manufactured item (bottle, jar, tube, box, bag, shoe, garment laid flat or on a hanger, device, book) is the subject, shown so its exact look can be copied. A hand may hold it; a face may not be part of the point.',
  '- person: one real-looking person is the subject and their face is clearly visible. The picture is about the person, not about something they hold, wear or present.',
  '- logo: a logo, symbol or wordmark shown on its own on a plain ground. Not a mark printed on a product, not a page or card with other text.',
  '- style: there is no single subject to copy; the picture is about light, colour, palette, texture, material or mood (a swatch, a fabric close-up, a colour board).',
  '- place: a location, room, set, backdrop or landscape with no person and no product as the subject.',
  '- other: none of these, e.g. a screenshot, a document, a collage of several pictures, a diagram.',
  'Facts:',
  '- role: the one best category.',
  '- alternative: the next category a careful art director could reasonably pick for this same picture; "none" only when no other category is reasonable. Be strict: when a person holds, wears or presents an item that could be the point, when a product sits in light or a setting that could be the point, or when a person is small in a setting, name that alternative.',
  '- kind: photo; render (3D or CGI); flat_graphic (a logo, icon, palette or illustration on a flat ground); screenshot (an app, web page or video player); document (a page, sheet or slide); collage (several pictures or panels in one).',
  '- people: none; hands_or_body_part (hands, arms, legs or a cropped body without a readable face); one_face_visible; one_face_hidden (one person whose face is turned away, covered or cut off); several (two or more people).',
  '- framing: how much of the person the picture shows; no_person when there is none; small_in_frame when the person fills under about a third of the picture height.',
  '- light: even (soft, flat or studio-even); natural (daylight or ordinary indoor light, sun patches included); dramatic (hard contrast, spotlight or deep shadow used as a look); coloured_or_effect (coloured gels, neon, strong colour casts, flares, light bands or other visible effects).',
  '- text: none; mark_or_label (only a logo, wordmark or a product label); some (a few words beyond a mark); lots (sentences, paragraphs, interface text).',
  '- surface: true when one surface or material (fabric, floor, wall, fur, liquid, paper, a palette) fills the picture edge to edge with no room, horizon or separate object to orient by; else false.',
].join('\n');

export const ASSET_ROLE_SCHEMA = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: [...STUDIO_ASSET_ROLES] },
    alternative: { type: 'string', enum: [...ALTERNATIVES] },
    kind: { type: 'string', enum: [...KINDS] },
    people: { type: 'string', enum: [...PEOPLE] },
    framing: { type: 'string', enum: [...FRAMING] },
    light: { type: 'string', enum: [...LIGHT] },
    text: { type: 'string', enum: [...TEXT] },
    surface: { type: 'boolean' },
  },
  required: ['role', 'alternative', 'kind', 'people', 'framing', 'light', 'text', 'surface'],
  additionalProperties: false,
} as const;

export const assetRoleFactsSchema = z.object({
  role: z.enum(STUDIO_ASSET_ROLES),
  alternative: z.enum(ALTERNATIVES),
  kind: z.enum(KINDS),
  people: z.enum(PEOPLE),
  framing: z.enum(FRAMING),
  light: z.enum(LIGHT),
  text: z.enum(TEXT),
  surface: z.boolean(),
});
export type AssetRoleFacts = z.infer<typeof assetRoleFactsSchema>;

/** Who may be in the picture for each role to be saved. */
const PEOPLE_ALLOWED: Record<Exclude<StudioAssetRole, 'other'>, ReadonlySet<AssetRoleFacts['people']>> = {
  product: new Set(['none', 'hands_or_body_part']),
  person: new Set(['one_face_visible']),
  logo: new Set(['none']),
  style: new Set(['none']),
  place: new Set(['none']),
};
const KINDS_ALLOWED: Record<Exclude<StudioAssetRole, 'other'>, ReadonlySet<AssetRoleFacts['kind']>> = {
  product: new Set(['photo', 'render']),
  person: new Set(['photo', 'render']),
  logo: new Set(['flat_graphic', 'render']),
  style: new Set(['photo', 'render', 'flat_graphic']),
  place: new Set(['photo', 'render']),
};

const PORTRAIT: ReadonlySet<AssetRoleFacts['framing']> = new Set(['close_up', 'head_and_shoulders', 'half_body']);
const PLAIN_LIGHT: ReadonlySet<AssetRoleFacts['light']> = new Set(['even', 'natural']);

/**
 * Second readings that do not cast doubt on the first. Measured on the labelled set (scripts/asset-role-eval.ts,
 * 2026-11-19): the model names `style` as the second reading for nearly every photo (every photo has light), so
 * `style` blocks a product or a person only when the light itself is unusual; a place may have any light. A
 * style picture may also read as a place (a floor, a fur). Every other pair stays doubtful: a person holding
 * a product (`person`/`product`), a still life that could be a look (`style`/`product`), a product in a setting
 * (`product`/`place`), any logo with a second reading.
 */
function secondReadingHarmless(facts: AssetRoleFacts): boolean {
  const { role, alternative } = facts;
  if (alternative === 'none' || alternative === role) return true;
  if (alternative === 'style' && (role === 'product' || role === 'person')) return PLAIN_LIGHT.has(facts.light);
  if (alternative === 'style' && role === 'place') return true;
  if (alternative === 'place' && role === 'style') return true;
  return false;
}

/**
 * The role to save, or null to leave it empty. Decided here and nowhere else. A role is saved only when the
 * second reading casts no doubt AND every other fact agrees with it; `other` is never saved (it steers nothing
 * and would stop the writer from inferring).
 */
export function roleFromFacts(facts: AssetRoleFacts): StudioAssetRole | null {
  const role = facts.role;
  if (role === 'other') return null;
  if (!secondReadingHarmless(facts)) return null;
  if (!KINDS_ALLOWED[role].has(facts.kind)) return null;
  if (!PEOPLE_ALLOWED[role].has(facts.people)) return null;
  if (role === 'person' && !PORTRAIT.has(facts.framing)) return null;
  // A floor or wall filling the frame is a material, not a location (measured: a marble-floor crop read as a place).
  if (role === 'place' && facts.surface) return null;
  if (facts.text === 'lots') return null;
  if (role === 'logo' && facts.text === 'some') return null;
  return role;
}

/**
 * A transparent thumbnail goes to the model on mid grey: a dark mark on transparency otherwise reads as
 * nothing (measured: two transparent logos came back `other`). Opaque pictures pass through unchanged.
 */
export async function pictureForReading(thumb: { bytes: Uint8Array; mime: string }): Promise<{ bytes: Uint8Array; mime: string }> {
  const image = sharp(thumb.bytes);
  const meta = await image.metadata();
  if (!meta.hasAlpha) return thumb;
  return { bytes: new Uint8Array(await image.flatten({ background: '#808080' }).webp({ quality: 85 }).toBuffer()), mime: 'image/webp' };
}

/** On unless `BRAND_STUDIO_ASSET_AUTO_ROLE=off`; never without a Gemini key. */
export function assetAutoRoleConfig(env: Record<string, string | undefined>): GeminiConfig | null {
  if (env.BRAND_STUDIO_ASSET_AUTO_ROLE?.trim().toLowerCase() === 'off') return null;
  return studioGeminiConfig(env);
}

/** The model's facts about one thumbnail, or null for ANY failure (HTTP, block, timeout, JSON, schema). */
export async function readAssetRoleFacts(
  config: GeminiConfig,
  fetchImpl: typeof fetch,
  thumb: { bytes: Uint8Array; mime: string },
  timeoutMs = ASSET_ROLE_TIMEOUT_MS,
): Promise<AssetRoleFacts | null> {
  try {
    const picture = await pictureForReading(thumb);
    const raw = await callGeminiJson(config, fetchImpl, {
      system: ASSET_ROLE_SYSTEM,
      parts: [inlinePart(picture.bytes, picture.mime)],
      schema: ASSET_ROLE_SCHEMA,
      thinking: 'LOW',
      timeoutMs,
    });
    const parsed = assetRoleFactsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type RoleCheckRow = Pick<AssetRow, 'id' | 'kind' | 'source' | 'role' | 'role_source' | 'thumb_key' | 'status' | 'deleted_at'>;

/** A member's image upload that nobody has given a category and that was never checked. */
export function wantsRoleCheck(row: RoleCheckRow, env: Record<string, string | undefined>): boolean {
  return (
    row.kind === 'image' &&
    row.source === 'upload' &&
    row.status === 'ready' &&
    !row.deleted_at &&
    !row.role &&
    !row.role_source &&
    Boolean(row.thumb_key) &&
    assetAutoRoleConfig(env) !== null
  );
}

export type RoleCheckOutcome = 'saved' | 'blank' | 'skipped' | 'failed';

/**
 * Reads the thumbnail, asks once, writes the verdict. A sure role is saved with `role_source = 'auto'`; a
 * doubtful picture keeps an empty role and is marked `'auto'` too, so it is never asked about again. A
 * failure writes nothing. The write only lands while the row still has no role and no source.
 */
export async function recogniseAssetRole(deps: StudioDeps, assetId: string): Promise<RoleCheckOutcome> {
  const row = (
    await deps.sql.query<RoleCheckRow>(
      'select id, kind, source, role, role_source, thumb_key, status, deleted_at from brand_studio_assets where id = $1',
      [assetId],
    )
  ).rows[0];
  const config = assetAutoRoleConfig(deps.intelDeps.env);
  if (!row || !config || !wantsRoleCheck(row, deps.intelDeps.env)) return 'skipped';
  let bytes: Uint8Array;
  try {
    bytes = await deps.media.read(row.thumb_key!);
  } catch {
    deps.log?.('asset_role_failed', { reason: 'thumb_unreadable' });
    return 'failed';
  }
  const facts = await readAssetRoleFacts(config, deps.intelDeps.fetch, { bytes, mime: 'image/webp' });
  if (!facts) {
    deps.log?.('asset_role_failed', { reason: 'no_answer' });
    return 'failed';
  }
  const role = roleFromFacts(facts);
  const written = (
    await deps.sql.query<{ id: string }>(
      `update brand_studio_assets set role = $2, role_source = 'auto'
        where id = $1 and role is null and role_source is null and deleted_at is null returning id`,
      [assetId, role],
    )
  ).rows[0];
  if (!written) return 'skipped';
  deps.log?.('asset_role', { result: role ? 'saved' : 'blank', role, model: facts.role, alternative: facts.alternative });
  return role ? 'saved' : 'blank';
}

/**
 * Schedules the check after the upload's answer (no-op without `deps.later`, e.g. in tests that do not ask
 * for it). True when a check was scheduled, so the screen knows to read the library again shortly.
 */
export function scheduleRoleCheck(deps: StudioDeps, row: RoleCheckRow): boolean {
  if (!deps.later || !wantsRoleCheck(row, deps.intelDeps.env)) return false;
  const assetId = row.id;
  deps.later(async () => {
    try {
      await recogniseAssetRole(deps, assetId);
    } catch (error) {
      deps.log?.('asset_role_failed', { reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    }
  });
  return true;
}
