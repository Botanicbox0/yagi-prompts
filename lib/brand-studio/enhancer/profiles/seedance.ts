/**
 * Seedance (ByteDance video model with native sound). Grammar from the seedance-film-director
 * skill: reference authority first, a visual-style block, a timeline in seconds, plain camera words
 * with a start and an end, the last frame, one sound line.
 */
import { brandSeedanceRulesV2Open } from '@/lib/flags';
import type { ProfileHeader } from './meta';

export const SEEDANCE_HEADER: ProfileHeader = {
  id: 'seedance',
  version: '2026-11-15.1',
  models: ['seedance-2.5'],
  sources: [
    { url: 'skill:seedance-film-director', seen: '2026-11-15', claim: 'reference authority, visual style, timeline in seconds, camera start and end, last frame, one sound line [house]' },
    { url: 'docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt', seen: '2026-11-10', claim: '@Image1 / @Video1 / @Audio1 tokens on reference-to-video [aggregator]' },
  ],
  lastVerified: '2026-11-15',
};

export const SEEDANCE_HEADER_V1: ProfileHeader = SEEDANCE_HEADER;

export const SEEDANCE_HEADER_V2: ProfileHeader = {
  id: 'seedance',
  version: '2026-11-27.1',
  models: ['seedance-2.5'],
  sources: [
    { url: 'skill:seedance-film-director', seen: '2026-11-27', claim: '1-stop underexposed 35mm skin/exposure law, face-and-hair vs separate wardrobe authority, genre-adaptive camera, anti-boilerplate [house]' },
    { url: 'docs/SEEDANCE-BRIDGE-2026-11-26.md', seen: '2026-11-27', claim: 'SB-2 brand-studio Seedance 2.5 rules behind BRAND_SEEDANCE_RULES_V2 [house]' },
    { url: 'docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt', seen: '2026-11-10', claim: '@Image1 / @Video1 / @Audio1 tokens on reference-to-video [aggregator]' },
  ],
  lastVerified: '2026-11-27',
};

export function seedanceHeader(env: Record<string, string | undefined> = process.env): ProfileHeader {
  return brandSeedanceRulesV2Open(env) ? SEEDANCE_HEADER_V2 : SEEDANCE_HEADER;
}

export function seedanceProfileVersion(env: Record<string, string | undefined> = process.env): string {
  const h = seedanceHeader(env);
  return `${h.id}@${h.version}`;
}

export const SEEDANCE_PROFILE = `Model: a video model that generates picture and sound together and follows time-ranged directions.

Write in English, in this order, as short blocks separated by line breaks:
1. Reference authority, one line per attached reference using the tokens exactly as given ("@Image1", "@Video1", "@Audio1"): what each supplies and what it does not ("@Image1 supplies only the bottle: its exact shape, label and colours"). Skip this block when no token is given.
2. "Visual style:" one or two sentences: concrete #Hex palette roles (shadow floor, primary surfaces/wardrobe, key accent), motivated light direction with grounded ambient shadow floor and color spill (never pasted-on or flat front-lit), and natural lens/material texture. No equipment, film-stock or camera brands.
3. The action. Begin already in motion, writing self-contained visible action, camera and lighting prose (never write "same as original video").
   - Longer than 5 seconds: a timeline of ranges in seconds, one per line ("0.0–2.5s: …"), starting at 0 and ending exactly at the length given, with no gaps or overlaps. Alternate off-axis eyelines and camera angles across cuts (18° / 45° / 90° / OTS; avoid static front-on passport stares). Each range has the framing, ONE action, the camera in plain words with where it starts and where it ends (slow push in from waist height to a close-up of the label; handheld follow behind her at walking pace; locked-off; slow orbit left around the table), and how it hands over ("Hard cut.", "Match cut on …", or "Continuous into the next range."). Short ranges are fine for quick inserts.
   - 5 seconds or less: ordered prose for one continuous shot, with off-axis eyeline and the camera's start and end.
4. The last frame: one sentence on what is on screen when the video ends.
5. The sound, as ONE line starting "Audio:" — spoken words in double quotes with who speaks and in which language ("A woman, in Korean, softly: \\"…\\""), diegetic Foley, room ambience, effects, and whether there is music. Speech only when the request gives the words; keep them verbatim.

People: natural skin texture faithful to @Image1 (when a person reference is attached), zero plastic/waxy beauty-filter glare — never write "glass-skin", "poreless porcelain" or "dewy highlighter"; performance, expression and off-axis gaze follow the request, and when it says nothing, calm and unposed; the face matches the ambient shadow floor and color spill of the room.
Products: the same shape, label and size in every range; never mirrored.
On-screen text only when asked for, verbatim, inside 【】. Omit all redundant headers: never write "Create a Seedance video", model names, duration, aspect ratio, resolution or FPS headers.`;

export const SEEDANCE_PROFILE_V2 = `Model: a video model that generates picture and sound together and follows time-ranged directions.

Write in English, in this order, as short blocks separated by line breaks (total prompt up to 15,000 characters):
1. Reference authority, one concise block per attached reference using the exact tokens given ("@Image1", "@Video1", "@Audio1"):
   - Person reference (when attached): a person reference supplies face and hair only (never background, lighting, body proportions, or casual clothing); wardrobe comes from the brief's words unless a separate clothing reference is bound, and include once: "ignore any wide casual top/sleeve volume from @Image 1" (using the exact person image number).
   - Separate clothing reference (when bound): it supplies wardrobe only (silhouette, tailoring, fabric and colour; never face or skin).
   - Product/logo/style/place references: state once what each supplies ("@Image1 supplies only the bottle: its exact shape, label and colours"). Skip this block when no token is given.
2. "Visual style:" once per prompt (never repeated per shot), combining concrete #Hex palette roles (shadow floor, primary surfaces/wardrobe, key accent), motivated light direction matching the room's ambient shadow floor and color spill, and the exposure/skin formula:
   - When a person appears: "looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under; skin stays natural and warm, unretouched matte-satin with visible micro-pores and fine stray flyaway hairs, never over-lit or glossy, with no blush".
   - Product-only (no person in the scene): "looking like scanned, slightly underexposed 35mm film: soft contrast, cool lifted blacks (#14171C), fine organic grain, gentle halation on the brightest whites; one soft key light a stop under".
   Never write over-smooth, beauty-filter, or wet-shine buzzwords anywhere, not even in exclusions.
3. The action. Begin already in motion, writing self-contained visible action, camera and lighting prose (never write "same as original video"). Keep per-shot lines free of physique, eyeline-defence, or negative-constraint boilerplate (state shared eyeline and exclusion rules once outside the shots).
   - Longer than 5 seconds: a timeline of ranges in seconds, one per line ("0.0–2.5s: …"), starting at 0 and ending exactly at the length given, with no gaps or overlaps. Alternate camera angles across cuts (18° / 45° / 90° / OTS). Choose camera movement from the request's genre (no global camera lock):
     * Action, music video, fantasy, chase, or kinetic narrative: moving camera with start, path and end (Steadicam tracking from behind at low angle, crane sweep rising over the space, 45°–180° orbital arc around the subject, FPV push-in).
     * Fashion editorial, lookbook, beauty, or portrait: cut rhythm and subtle micro-movement inside held poses (small weight shift, slow head turn, breath, a hair strand moving), avoiding forced pantomime.
     End each non-final range with its handoff ("Hard cut.", "Match cut on …", or "Continuous into the next range.").
   - 5 seconds or less: ordered prose for one continuous shot matching the genre's camera motion, with start, path and end.
4. The last frame: one sentence on what is on screen when the video ends.
5. One shared Exclusions block (when needed, e.g. natural off-axis gaze without staring into the lens) and ONE "Audio:" line — spoken words in double quotes with speaker and language ("A woman, in Korean, softly: \\"…\\""), diegetic Foley, room ambience, effects, and whether there is music. Speech only when the request gives the words; keep them verbatim.

Products: the same shape, label and size in every range; never mirrored.
On-screen text only when asked for, verbatim, inside 【】. Omit all redundant headers: never write "Create a Seedance video", model names, duration, aspect ratio, resolution or FPS headers.`;

export function seedanceProfile(env: Record<string, string | undefined> = process.env): string {
  return brandSeedanceRulesV2Open(env) ? SEEDANCE_PROFILE_V2 : SEEDANCE_PROFILE;
}
