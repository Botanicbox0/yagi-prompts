/**
 * Skin rules for people (2026-11-19): when they apply, and what they tell the prompt writer, per model.
 *
 * Two levels and a tone rule:
 *   base     a person is in the request or a reference is marked as a person: real-photograph skin at the
 *            camera's distance, the person's own features and marks, no beauty words.
 *   realism  base + the brand asked for real skin (피부결, 모공, 실사, 보정 없이, "unretouched" … or a brand
 *            rule saying so): skin zone by zone, light that shows relief, a portrait perspective, hands / arms /
 *            neck in wider frames, no grain or sharpening to fake texture.
 *   tone     a person reference is attached and the brand wants that skin kept (or realism is on): the writer
 *            reads the reference's skin and states it as properties to keep, in one of three variants the eval
 *            compares (`none` role only, `short` depth + undertone, `full` the whole reading). `short` is the
 *            provisional default until the paid image test decides per model.
 *
 * Sources: the house skin study (2026-07: zone-varied texture, the replacement of "clear, even complexion",
 * lateral soft light, one identity authority, grain is a finishing step and never texture) [house]; OpenAI's
 * image-prompting guide (2026-11-19: "real skin texture … No glamorization, no heavy retouching") [official];
 * Google's image docs (2026-11-19: describe positively) [official]; practitioner notes on fake skin (getimg.ai,
 * 2026-09-04: beauty words and "every pore visible" both read as fake; detail must match the camera distance).
 *
 * Pure: no I/O. `planSkin` is what jobs record as `work.enhancer.skinMode` / `toneMatch`.
 */
import type { StudioPromptProfile } from '@/lib/brand-studio/models';

export type SkinMode = 'off' | 'base' | 'realism';
export type SkinVariant = 'none' | 'short' | 'full';
export const SKIN_VARIANTS: readonly SkinVariant[] = ['none', 'short', 'full'];

/** Provisional per-model defaults; the founder's paid image test (2026-11) sets them. */
export const SKIN_VARIANT_DEFAULT: Readonly<Record<string, SkinVariant>> = {
  'seedream-5.5': 'short',
  'nano-banana-pro': 'short',
  'nano-banana-2.1': 'short',
  'gpt-image-2.6-flare': 'short',
  'gpt-image-2.6-sunburst': 'short',
};

/* ------------------------------------------------------------------ detection */

/** Saying there is no one in the picture wins over everything else. */
const NO_PERSON = /(?:사람|인물|모델|사람은|인물은)\s*(?:없이|없는|없음|없게|빼고|제외)|\bno (?:people|person|humans?|models?)\b|\bwithout (?:people|a person|anyone|humans?|models?)\b|\bproduct only\b/i;

const PERSON_KO = new RegExp(
  [
    '모델(?!명|링|하우스)',
    '인물',
    '사람(?!들이 좋아|마다)',
    '여자',
    '남자',
    '여성(?!용)',
    '남성(?!용)',
    '소녀',
    '소년',
    '얼굴',
    '셀카',
    '인플루언서',
    '크리에이터',
    '친구',
    '커플',
    '엄마',
    '아빠',
    '할머니',
    '할아버지',
    '어부',
    '직원',
    '손님',
    '고객이',
    '그녀',
    '포트레이트',
    '초상',
    '\\d{1,2}\\s*대\\s*(?:여|남|인)',
    '(?:한|두|세|네|\\d)\\s*명',
    '손(?:이|에|으로|가|을|등|가락|목|바닥|끝)',
    '팔(?:이|에|을|로|꿈치|목)',
    '목선',
    '입술',
    '눈가',
    '이마',
    '볼(?:이|에|을)',
    '뺨',
    '턱선',
  ].join('|'),
);
const PERSON_EN = /\b(?:wom[ae]n|m[ae]n|girls?|boys?|persons?|people|models?(?! number)|faces?|portraits?|selfies?|hands?|arms?|couples?|friends?|fisherm[ae]n|lady|ladies|guys?|child(?:ren)?|kids?|influencers?|creators?|customers?|he|she|her|his|cheeks?|lips?|forehead)\b/i;

const REALISM_KO = /피부\s*결|피부\s*질감|모공|실사|사실적|리얼|보정\s*(?:없이|없는|없게|안\s*한)|무보정|생얼|쌩얼|민낯|진짜\s*(?:사람|피부)|실제\s*(?:사람|피부)|자연스러운\s*피부|피부\s*그대로|AI\s*(?:티|같|처럼)|인위적이지\s*않/;
const REALISM_EN = /\b(?:realistic skin|real skin|skin texture|pores?|unretouched|no retouch(?:ing)?|without retouch(?:ing)?|photo-?real(?:istic)?|real (?:person|people)|natural skin|raw skin|true-to-life skin|lifelike skin)\b/i;

const TONE_KO = /피부\s*톤|피부톤|피부\s*색|피부색|톤\s*(?:그대로|유지|맞춰|맞게|살려)|피부\s*그대로|피부를\s*그대로/;
const TONE_EN = /\b(?:skin ?tone|complexion|undertone|(?:keep|match|same)\b[^.]{0,20}\bskin)\b/i;

/** Region edit on a face or skin. */
const FACE_REGION = /얼굴|피부|입술|눈가|이마|뺨|볼|턱|\b(?:face|skin|cheeks?|lips?|forehead|eyes?)\b/i;

export function mentionsPerson(text: string): boolean {
  if (!text.trim() || NO_PERSON.test(text)) return false;
  return PERSON_KO.test(text) || PERSON_EN.test(text);
}

export function wantsRealSkin(text: string): boolean {
  return REALISM_KO.test(text) || REALISM_EN.test(text);
}

export function wantsToneKept(text: string): boolean {
  return TONE_KO.test(text) || TONE_EN.test(text);
}

export interface SkinInput {
  kind: 'image' | 'region_edit' | 'video' | 'video_remix';
  prompt: string;
  change?: string | null;
  references: ReadonlyArray<{ kind: 'image' | 'video' | 'audio'; role?: string | null; use?: string | null }>;
  brandRules?: readonly string[] | null;
}

export interface SkinPlan {
  mode: SkinMode;
  toneMatch: boolean;
  /** Region edit whose box is on a face or skin: the in-place restore sentence. */
  restore: boolean;
  /** A reference without a role may show a person: the base line is given as a condition. */
  maybePerson: boolean;
}

export function planSkin(input: SkinInput): SkinPlan {
  const words = [input.prompt, input.change ?? '', ...input.references.map((r) => r.use ?? '')].join('\n');
  const said = !NO_PERSON.test(words);
  const personRef = said && input.references.some((r) => r.kind === 'image' && r.role === 'person');
  const person = personRef || mentionsPerson(words);
  const rules = (input.brandRules ?? []).join('\n');
  const realismAsked = wantsRealSkin(words) || (wantsRealSkin(rules) && /인물|사람|모델|피부|people|person|skin/i.test(rules));
  if (input.kind === 'region_edit') {
    const face = said && FACE_REGION.test(words);
    return { mode: face ? 'realism' : person ? 'base' : 'off', toneMatch: false, restore: face, maybePerson: false };
  }
  // Video keeps the Seedance profile's own people rules (profiles/seedance.ts); nothing is added here.
  if (input.kind !== 'image') return { mode: 'off', toneMatch: false, restore: false, maybePerson: false };
  const mode: SkinMode = !person ? 'off' : realismAsked ? 'realism' : 'base';
  const maybePerson = mode === 'off' && said && input.references.some((r) => r.kind === 'image' && (r.role === undefined || r.role === null || r.role === 'other'));
  return { mode, toneMatch: personRef && (wantsToneKept(words) || mode === 'realism'), restore: false, maybePerson };
}

export function skinVariantOf(model: string | undefined, env: Record<string, string | undefined>): SkinVariant {
  const forced = env.BRAND_STUDIO_ENHANCER_SKIN_VARIANT?.trim().toLowerCase();
  if (forced && (SKIN_VARIANTS as readonly string[]).includes(forced)) return forced as SkinVariant;
  return (model && SKIN_VARIANT_DEFAULT[model]) || 'short';
}

/* ------------------------------------------------------------------ rule text */

export const SKIN_BASE_NANO_BANANA_PHRASE =
  "fine natural texture with small changes of tone, soft highlights on the forehead, nose and cheekbones, and each person's own features, asymmetry and visible marks exactly as they are";

export const SKIN_BASE_DEFAULT_PHRASE =
  "fine natural texture with small changes of tone and highlights that sit softly on the forehead, nose and cheekbones. Keep each person's own features, asymmetry and visible marks";

export const SKIN_REALISM_ZONES_PHRASE =
  'slightly more visible fine pores across the forehead, nose and inner cheeks; softer texture on the outer cheeks and jaw; a little natural colour under the eyes and on the nose and cheeks; fine vellus hair along the hairline and jaw; natural lip lines and slightly uneven lip colour; healthy but locally varied skin rather than an even complexion';

export const SKIN_REALISM_LIGHT_PHRASE =
  'a broad soft source from one side, a little off the camera axis, with a gentle fill and controlled highlights';

export const SKIN_REALISM_PERSPECTIVE_PHRASE =
  'an eye-level portrait perspective (about 85 mm for a face, about 50 mm for a full figure) with natural optical sharpness';

export const SKIN_REALISM_WIDE_TEXTURE_PHRASE =
  'hands, arms and neck the same unretouched texture (fine hair, knuckle and wrist creases, faint veins)';

export const SKIN_REALISM_SEEDREAM_EXAMPLE = 'unretouched';
export const SKIN_REALISM_NB_PHOTO_LABEL = 'a real photograph';
export const SKIN_REALISM_GPT_PHOTO_LABEL = 'a photorealistic photograph';
export const SKIN_REALISM_GPT_CLOSER = 'No glamorization, no heavy retouching, no over-sharpened skin.';

export const SKIN_BASE_NO_EXTRA_MARKS_PHRASE = 'and add no freckles, moles or blemishes they do not have';

export const SKIN_TONE_DEPTH_LIST = 'fair, light, medium, tan or deep';
export const SKIN_TONE_UNDERTONE_LIST = 'warm, neutral, cool or olive';
export const SKIN_TONE_NONE_ROLE_PHRASE = "the person's face, hair, build and skin as they are";
export function skinToneNoneRolePhrase(tokens: readonly string[]): string {
  return `${tokens.join(', ')} ${tokens.length === 1 ? 'supplies' : 'supply'} ${SKIN_TONE_NONE_ROLE_PHRASE}`;
}
export const SKIN_TONE_KEEP_NANO_BANANA_PHRASE = 'keep them exactly as they are';
export const SKIN_TONE_KEEP_DEFAULT_PHRASE = 'do not lighten, darken, warm, cool or even them out';

export const SKIN_RESTORE_KEEP_PHRASE = 'the same person, the same face shape, expression, gaze, make-up and light';
export const SKIN_RESTORE_ACTION_NANO_BANANA_PHRASE = `restore fine, natural skin detail in place with ${SKIN_RESTORE_KEEP_PHRASE} as they are`;
export const SKIN_RESTORE_ACTION_DEFAULT_PHRASE = `restore fine, natural skin detail in place, with ${SKIN_RESTORE_KEEP_PHRASE} unchanged`;
export const SKIN_RESTORE_TEXTURE_PHRASE = 'Add only fine texture where the skin looks smoothed or waxy';
export const SKIN_RESTORE_ZONES_PHRASE =
  'slightly more visible fine pores on the forehead, nose and inner cheeks, softer outer cheeks, natural lip lines and a little natural colour variation';
export const SKIN_RESTORE_MARKS_NANO_BANANA_PHRASE = 'with every mark the person has kept where it is';
export const SKIN_RESTORE_MARKS_DEFAULT_PHRASE = 'Keep every mark the person has and add none.';

const NEVER_WORDS = 'Never write beauty or perfection words for skin (flawless, perfect, porcelain, glass skin, poreless, airbrushed, dewy glow) or realism tags (8k, hyper-detailed, "every pore visible").';

function baseRule(profile: StudioPromptProfile): string {
  if (profile === 'nano-banana') {
    return `People: describe their skin the way a real photograph shows it at this camera distance: ${SKIN_BASE_NANO_BANANA_PHRASE}. ${NEVER_WORDS} Phrase the skin positively; the picture needs no list of what to avoid.`;
  }
  const gaze = profile === 'gpt-image' ? ' Say how each person is framed and where they look.' : '';
  return `People: describe their skin the way a real photograph shows it at this camera distance: ${SKIN_BASE_DEFAULT_PHRASE}, ${SKIN_BASE_NO_EXTRA_MARKS_PHRASE}. ${NEVER_WORDS} When nothing is asked about expression or gaze, keep them relaxed and unposed.${gaze}`;
}

function realismRule(profile: StudioPromptProfile): string {
  const core = `Skin realism (the brand wants skin that reads as real at full size). Write the skin zone by zone before any constraint: ${SKIN_REALISM_ZONES_PHRASE}. Keep the setting, palette and mood the request asks for (a bright, airy campaign stays bright and airy; a person reference never sets the backdrop); within that scene, let the light on the face show this relief: ${SKIN_REALISM_LIGHT_PHRASE}, never flat frontal light or a glossy sheen. Use ${SKIN_REALISM_PERSPECTIVE_PHRASE}. Match the detail to the distance: in a full-figure or wide frame give the ${SKIN_REALISM_WIDE_TEXTURE_PHRASE} instead of pores the camera could not resolve. Texture comes from the skin and the light: never ask for film grain, noise or extra sharpening.`;
  switch (profile) {
    case 'seedream':
      return `${core} Fold the zones and the light into the one paragraph as plain description (this is when the 200-word ceiling applies); at most one short clause such as "${SKIN_REALISM_SEEDREAM_EXAMPLE}".`;
    case 'nano-banana':
      return `${core} Write all of it as what is visible, call the result "${SKIN_REALISM_NB_PHOTO_LABEL}", and give no list of things to avoid.`;
    case 'gpt-image':
      return `${core} Call the result "${SKIN_REALISM_GPT_PHOTO_LABEL}" and end with the sentence "${SKIN_REALISM_GPT_CLOSER}"`;
    default:
      return core;
  }
}

function toneRule(profile: StudioPromptProfile, variant: SkinVariant, tokens: readonly string[]): string {
  if (tokens.length === 0) return '';
  const who = tokens.length === 1 ? `the person in ${tokens[0]}` : `each person (${tokens.join(', ')})`;
  const keep = profile === 'nano-banana' ? `and ${SKIN_TONE_KEEP_NANO_BANANA_PHRASE}` : `and keep them: ${SKIN_TONE_KEEP_DEFAULT_PHRASE}`;
  switch (variant) {
    case 'none':
      return `Skin tone: ${skinToneNoneRolePhrase(tokens)}; state that role and add no description of the skin's colour.`;
    case 'short':
      return `Skin tone: name the skin of ${who} in one clause as you see it in the picture, its depth (${SKIN_TONE_DEPTH_LIST}) and its undertone (${SKIN_TONE_UNDERTONE_LIST}), ${keep}.`;
    case 'full':
      return `Skin tone: read the skin of ${who} in the picture and write it as properties to keep, in one or two sentences: depth (${SKIN_TONE_DEPTH_LIST}), undertone (${SKIN_TONE_UNDERTONE_LIST}), surface (matte or satin, how visible the texture is), any freckles, moles or marks and where they sit, and how the light in that picture sits on it (where the highlights fall, how warm the shadows are). State them ${keep}.`;
  }
}

function restoreRule(profile: StudioPromptProfile): string {
  if (profile === 'nano-banana') {
    return `The boxed part is a face or skin: ${SKIN_RESTORE_ACTION_NANO_BANANA_PHRASE}. ${SKIN_RESTORE_TEXTURE_PHRASE}: ${SKIN_RESTORE_ZONES_PHRASE}, ${SKIN_RESTORE_MARKS_NANO_BANANA_PHRASE}.`;
  }
  return `The boxed part is a face or skin: ${SKIN_RESTORE_ACTION_DEFAULT_PHRASE}. ${SKIN_RESTORE_TEXTURE_PHRASE}: ${SKIN_RESTORE_ZONES_PHRASE}. ${SKIN_RESTORE_MARKS_DEFAULT_PHRASE}`;
}

export interface SkinRulesInput {
  profile: StudioPromptProfile;
  plan: SkinPlan;
  variant: SkinVariant;
  /** Tokens of the person references, in tray order ("Image 1", "image 2"). */
  personTokens: readonly string[];
}

/** The skin lines for this run's task block; empty when no rule applies. */
export function skinRules(input: SkinRulesInput): string {
  const { profile, plan } = input;
  const lines: string[] = [];
  if (plan.restore) lines.push(restoreRule(profile));
  if (plan.mode === 'base' || plan.mode === 'realism') lines.push(baseRule(profile));
  if (plan.mode === 'realism' && !plan.restore) lines.push(realismRule(profile));
  if (plan.toneMatch) lines.push(toneRule(profile, input.variant, input.personTokens));
  if (plan.maybePerson) lines.push(`If an attached picture shows a person who appears in the result, apply this to them: ${baseRule(profile)}`);
  return lines.filter(Boolean).join('\n');
}

/** Output phrases the active skin rules tell the model to write into the prompt (never behaviour/prohibition rules). */
export function skinAllowPhrases(input: SkinRulesInput): string[] {
  if (input.profile === 'seedance') return [];
  const { profile, plan } = input;
  const out: string[] = [];
  if (plan.restore) {
    out.push(
      profile === 'nano-banana'
        ? `${SKIN_RESTORE_ACTION_NANO_BANANA_PHRASE}. ${SKIN_RESTORE_TEXTURE_PHRASE}: ${SKIN_RESTORE_ZONES_PHRASE}, ${SKIN_RESTORE_MARKS_NANO_BANANA_PHRASE}`
        : `${SKIN_RESTORE_ACTION_DEFAULT_PHRASE}. ${SKIN_RESTORE_TEXTURE_PHRASE}: ${SKIN_RESTORE_ZONES_PHRASE}. ${SKIN_RESTORE_MARKS_DEFAULT_PHRASE}`,
    );
  }
  if (plan.mode === 'base' || plan.mode === 'realism' || plan.maybePerson) {
    out.push(
      profile === 'nano-banana'
        ? SKIN_BASE_NANO_BANANA_PHRASE
        : `${SKIN_BASE_DEFAULT_PHRASE}, ${SKIN_BASE_NO_EXTRA_MARKS_PHRASE}`,
    );
  }
  if (plan.mode === 'realism' && !plan.restore) {
    out.push(
      SKIN_REALISM_ZONES_PHRASE,
      SKIN_REALISM_LIGHT_PHRASE,
      SKIN_REALISM_PERSPECTIVE_PHRASE,
      SKIN_REALISM_WIDE_TEXTURE_PHRASE,
    );
    if (profile === 'gpt-image') out.push(SKIN_REALISM_GPT_CLOSER);
  }
  if (plan.toneMatch && input.personTokens.length > 0) {
    if (input.variant === 'none') {
      out.push(skinToneNoneRolePhrase(input.personTokens));
    } else {
      out.push(
        SKIN_TONE_DEPTH_LIST,
        SKIN_TONE_UNDERTONE_LIST,
        profile === 'nano-banana' ? SKIN_TONE_KEEP_NANO_BANANA_PHRASE : SKIN_TONE_KEEP_DEFAULT_PHRASE,
      );
    }
  }
  return out;
}
