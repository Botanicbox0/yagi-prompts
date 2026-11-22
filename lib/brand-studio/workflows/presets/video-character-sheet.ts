/**
 * The finished text behind the starter workflow `video-character-sheet` ("영상화용 캐릭터 시트 생성기"):
 * the founder's prompt (tests/brand-studio/fixtures/video-character-sheet-prompt.txt) as one constant, with
 * four short descriptions read from the two pictures filled in (./../sheet-analysis.ts).
 *
 * Server-only and a leaf: nothing here imports the studio runtime, and no client code imports this file
 * (lib/brand-studio/workflows/starters.ts must not either). The text is assembled when a job is prepared
 * (lib/brand-studio/prepare.ts) and travels only in `final_prompt`; no screen, list or tool answer shows it.
 *
 * The one change to the founder's wording: in "Ignore the charcoal t-shirt in Image 1 — it is placeholder"
 * the three words `the charcoal t-shirt` became `{{IMAGE1_WARDROBE}}`, so the sentence names what the person
 * in Image 1 actually wears. With `image1Wardrobe: 'the charcoal t-shirt'` the sentence is the original.
 */
import 'server-only';

export const VIDEO_CHARACTER_SHEET_PRESET_ID = 'video-character-sheet';

/** The founder's text, byte for byte (LF line breaks, em dashes), without a trailing line break. */
export const VIDEO_CHARACTER_SHEET_TEMPLATE = `A photorealistic three-panel character reference sheet — a real photograph taken on a real
camera in a professional studio, not an illustration or a render.

REFERENCES
Image 1 is the FACE REFERENCE and the only authority for identity. The face in PANEL 1
matches Image 1 exactly: bone structure, eye shape, nose, lip shape, hairline, brow shape,
skin undertone, and {{FACE_BOUND}}. Ignore {{IMAGE1_WARDROBE}} in Image 1 — it is placeholder
wardrobe only and does not appear anywhere in this sheet.

Image 2 is the WARDROBE REFERENCE ONLY — ignore its face, body, pose, background, lighting
and color grade entirely. Take only the garments: {{FASHION_TEXT}}.

SUBJECT
All three panels show one person: the face from Image 1 on a body of {{BUILD}}, wearing the
garments from Image 2, photographed in a single session under one light.

BACKDROP
One seamless mid neutral grey backdrop, hex #808080 — a true achromatic grey with red, green
and blue equal. Lit evenly edge to edge with one flat uniform tone, the same value in every
corner of the frame, no seam, no gradient, no vignette, no wall shadow, no visible floor line.
It never clips to white and never crushes to black — individual flyaway hairs and the garment
edge both stay clearly readable against it. Three vertical panels of equal width divided by
clean gutters of the same grey. All three figures stand on the same invisible ground line, at
the same scale, under the same light.

PANEL 1 — LEFT
Chest-up portrait matching Image 1, occupying about 28% of the total frame width. Shoulders
square to the camera, head turned 10 degrees to one side with the eyes returning level to the
lens, no torso rotation. Expression neutral and unperformed, lips softly closed. The neckline
of the Image 2 garment is visible across the shoulders and collarbone.
Real skin at pore level: visible pores across the cheeks and nose, a natural sebum sheen on
the forehead, nose bridge and cheekbones, fine vellus hair along the hairline and jaw, a faint
capillary flush under the cheekbones, and the subtle asymmetry between the left and right side
of the face. Both eyes fully open, iris pattern and color clearly readable, one large soft
rectangular catchlight at ten o'clock in each eye, lashes individually separated.
85mm portrait compression at f/4 — both eyes and the collarbone sharp, the hair edges softening.

PANEL 2 — CENTER
Full-body front view in a relaxed A-pose, arms hanging 15 degrees clear of the body, palms
turned inward, weight even on both feet, shoulders square to the camera. This panel is cropped
horizontally at the base of the neck: the head sits outside the panel and only the body from
the collarbone down is shown. The garments match Image 2 exactly in color, fabric, cut, length
and hardware — every seam, closure, hem and fabric weight readable. Footwear included, both
feet flat on the ground line. 50mm neutral perspective at f/8, the whole figure sharp from the
neck crop to the shoes.

PANEL 3 — RIGHT
Full-body back view in the identical A-pose, turned so the back faces camera, showing how the
hair falls down the back, the shoulder blade line, the posture, and the rear construction of
the garments. This panel is cropped horizontally at the base of the neck: the head sits outside
the panel. Image 2 shows only the front, so build the back from the front's construction logic —
continue every seam line, panel and hem around the body, keep the same fabric weight and drape,
place a plausible closure where the garment requires one, and hold the color and texture
identical to PANEL 2 under the same light. Same footwear seen from behind.
50mm neutral perspective at f/8.

LIGHTING (all three panels)
One large diffused key light 1.5 meters wide, frontal and 20 degrees above eye level, with a
gentle bounce fill from below at half the key intensity. Soft wraparound falloff, one soft
contact shadow at the feet, white balance 5600K. The same light on all three panels.

COLOR
Neutral and ungraded, true-to-life skin tone with its natural undertone preserved. The grey
backdrop reads the same value in every panel. No warm or yellow cast.

PRESERVE
The face in PANEL 1 stays identical to Image 1. All three figures are the same person with the
same body proportions, same hair, same skin tone. The garments stay identical in color, fabric,
cut and length between PANEL 2 and PANEL 3.

EXCLUDE
No text, no panel labels, no name plates, no captions, no measurement lines, no grid, no border,
no frame, no watermark, no logo, no signature. The backdrop carries nothing but the three figures.

FINISH
A clean digital capture with no film grain, with every bit of skin texture left intact — not
retouched, not smoothed, not airbrushed. 16:9.`;

export interface SheetVars {
  faceBound: string;
  fashionText: string;
  build: string;
  image1Wardrobe: string;
}

export const SHEET_VAR_KEYS = ['faceBound', 'fashionText', 'build', 'image1Wardrobe'] as const satisfies ReadonlyArray<keyof SheetVars>;

/** Longest value each placeholder takes, in characters. */
export const SHEET_VAR_MAX = { faceBound: 400, fashionText: 900, build: 200, image1Wardrobe: 120 } as const;

/** What fills a placeholder when the pictures could not be read (or a value was refused). */
export const SHEET_VAR_FALLBACK: SheetVars = {
  faceBound: "every face-bound detail visible in Image 1 — eyewear, facial hair, moles, freckles, and the hair's color, length and parting",
  fashionText: 'every garment, shoe and accessory visible in Image 2, each in its exact color, fabric and cut',
  build: 'natural proportions consistent with the face, neck and shoulders in Image 1',
  image1Wardrobe: 'whatever the person is wearing',
};

const PLACEHOLDER: Record<keyof SheetVars, string> = {
  faceBound: '{{FACE_BOUND}}',
  fashionText: '{{FASHION_TEXT}}',
  build: '{{BUILD}}',
  image1Wardrobe: '{{IMAGE1_WARDROBE}}',
};

/** A numbered picture, video, audio or panel ("Image 1", "panel 2", "사진 3"): the template does the numbering. */
const MEDIA_MENTION = /(?:image|img|figure|video|audio|panel|이미지|사진|영상)\s*#?\s*\d/i;
const URL_MENTION = /https?:\/\//i;
const INSTRUCTION_LIKE = /\b(?:ignore|disregard|instructions?|system prompt)\b/i;

/*
 * Text inside the photographs (a sign, a caption, a sticker) is picture content, never an instruction. A value is a
 * list of noun phrases, so a piece of it that reads as a command is refused (the value falls back on its own).
 */

/** Verbs that almost never start a garment noun phrase: a piece starting with one is a command. */
export const SHEET_COMMAND_VERBS = ['add', 'write', 'replace', 'render', 'include', 'remove', 'insert', 'generate', 'create', 'delete', 'erase', 'display', 'type'] as const;
/**
 * Verbs that also start real garment phrases ("change purse", "print scarf", "set of rings", "overlay skirt",
 * "draw cord waistband"): a command only when what follows says so (see `readsAsCommand`). `overlay` and `draw`
 * sit here rather than with the verbs above because "overlay skirt" and "draw cord" are garment words.
 */
export const SHEET_AMBIGUOUS_VERBS = ['change', 'show', 'use', 'make', 'put', 'place', 'print', 'paint', 'set', 'cover', 'turn', 'apply', 'swap', 'label', 'overlay', 'draw'] as const;
/** After an ambiguous verb, a determiner or pronoun, or a word about lettering or the scene, makes it a command. */
const COMMAND_OBJECTS = new Set([
  'the', 'a', 'an', 'all', 'any', 'every', 'this', 'that', 'these', 'those', 'it', 'its', 'them', 'your',
  'text', 'word', 'words', 'letter', 'letters', 'caption', 'slogan', 'logo', 'watermark', 'title', 'background', 'backdrop', 'sheet', 'panel',
]);
/** Words after which a new piece starts ("navy coat and then add …", "please render …"). */
const PIECE_STARTERS = new Set(['please', 'then', 'also', 'and', 'but']);
const COMMAND_VERB = new RegExp(`^[^\\p{L}\\p{N}]*(?:${SHEET_COMMAND_VERBS.join('|')})\\s`, 'iu');
const AMBIGUOUS_VERB = new RegExp(`^[^\\p{L}\\p{N}]*(?:${SHEET_AMBIGUOUS_VERBS.join('|')})\\s`, 'iu');
const QUOTED = /["“”„‟«»「」『』]|‘[^’]*’|(?:^|\s)'[^']+'(?=\s|$)/u;
const ONTO_THE = /\s(?:on|onto|across|over|into)\s+the\s/i;
const bareWord = (token: string): string => token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** One piece (from its first word on) read as a command. */
function pieceIsCommand(piece: string): boolean {
  if (COMMAND_VERB.test(piece)) return true;
  if (!AMBIGUOUS_VERB.test(piece)) return false;
  const next = bareWord(piece.trim().split(/\s+/)[1] ?? '');
  return COMMAND_OBJECTS.has(next) || QUOTED.test(piece) || ONTO_THE.test(` ${piece} `);
}

/**
 * True when any piece of the value reads as a command: the value is cut at `,` `;` and sentence ends, and a new
 * piece also starts after `please`, `then`, `also`, `and`, `but`. A hyphenated or longer word ("draw-string",
 * "added", "typewriter") is not the verb. A quoted word on its own is fine (a garment's print is part of it).
 */
export function readsAsCommand(value: string): boolean {
  for (const segment of value.split(/[,;]|[.!?](?=\s|$)/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    for (let start = 0; start < words.length; start += 1) {
      if (start > 0 && !PIECE_STARTERS.has(bareWord(words[start - 1]!))) continue;
      if (pieceIsCommand(words.slice(start).join(' '))) return true;
    }
  }
  return false;
}

/** The template supplies the punctuation after each value. */
const stripTail = (s: string): string => s.replace(/[\s.,;:]+$/u, '').trim();

/**
 * One value as it may enter the text: a single clean line, or null (the caller falls back). Whitespace and line
 * breaks collapse to single spaces; control and format characters, braces and backticks go; trailing `. , ; :`
 * go. Refused: a non-string, an empty value, a numbered media or panel mention, a link, instruction-like words,
 * a piece that reads as a command (`readsAsCommand`).
 * A value over its maximum is cut at the last comma or space at or before the maximum, never inside a word.
 */
export function sanitizeSheetVar(key: keyof SheetVars, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[{}`]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  value = stripTail(value);
  if (!value) return null;
  if (MEDIA_MENTION.test(value) || URL_MENTION.test(value) || INSTRUCTION_LIKE.test(value)) return null;
  if (readsAsCommand(value)) return null;
  const max = SHEET_VAR_MAX[key];
  if (value.length > max) {
    const head = value.slice(0, max + 1);
    const cut = Math.max(head.lastIndexOf(','), head.lastIndexOf(' '));
    if (cut <= 0) return null;
    value = stripTail(value.slice(0, cut));
    if (!value) return null;
  }
  return value;
}

/** The text sent for one run: every placeholder replaced exactly once (a refused or missing value by its fallback). */
export function renderVideoCharacterSheetPrompt(vars: Partial<Record<keyof SheetVars, unknown>>): string {
  let text = VIDEO_CHARACTER_SHEET_TEMPLATE;
  for (const key of SHEET_VAR_KEYS) {
    const value = sanitizeSheetVar(key, vars?.[key]) ?? SHEET_VAR_FALLBACK[key];
    // A function replacer, so `$&` and friends in a value stay literal.
    text = text.replace(PLACEHOLDER[key], () => value);
  }
  return text;
}
