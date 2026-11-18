/**
 * Live evaluation of Prompt Architect (lib/brand-studio/enhancer, docs/BRAND-STUDIO-V2.md §8.1), text only:
 * every case below goes through `enhancePrompt` against the real model and the designed prompt is held to
 * deterministic rules (reference naming, skin rules, banned words, length, phrasing). No image is generated.
 *
 *   npx tsx scripts/architect-eval.ts <env-file> --refs <dir> [--label after] [--out-dir <dir>] [--only id,id]
 *       [--reruns 1] [--cap 150] [--concurrency 3] [--variant none|short|full]
 *   npx tsx scripts/architect-eval.ts <env-file> --refs <dir> --emit <dir> [--cap 80]
 *   npx tsx scripts/architect-eval.ts <env-file> --refs <dir> --emit-plain <dir> [--only <cell>] [--cap 6]
 *
 * - Reads ONLY `GEMINI_API_KEY` (and `GEMINI_BASE_URL`) from <env-file>, inside this process. The key is never
 *   printed or written; every string that leaves the process is scrubbed of it.
 * - The model is the enhancer's own default (`gemini-4-hydrogen`); the run stops before the first call when the
 *   enhancer would call anything else, and every request URL is checked against it.
 * - `--refs <dir>` holds the reference pictures the cases attach (subject-a-light.png, subject-b-medium.png,
 *   subject-c-deep.png, product-bottle.png, logo-mark.png, style-light.png). They are resized to 768 px like the
 *   studio does. They are not part of the repository (virtual cast only; see the pack's README).
 * - Verdicts: `pass` = every check holds. `acceptable` = only soft checks missed (length within 15 % over, a
 *   use-case phrase, one or two "no" words on Nano Banana, "no other text"). `fail` = a hard check missed,
 *   the enhancer fell back, or the call failed. Each first-pass fail runs `--reruns` more times.
 * - `--emit <dir>`: writes the image-test matrix (models x subjects x framing x arm x tone variant) as files to
 *   paste into the production studio with Prompt Architect OFF, plus the Korean request for the "current" arm,
 *   which is run with Prompt Architect ON in production instead (no model call is spent on it here).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { enhancePrompt, type EnhanceInput, type EnhanceReference } from '@/lib/brand-studio/enhancer';

const EXPECTED_MODEL = 'gemini-4-hydrogen';

/* ------------------------------------------------------------------ flags, env, secrets */

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const at = argv.indexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1]! : null;
}
function intFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = flag(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return n;
}

type GeminiEnv = { GEMINI_API_KEY?: string; GEMINI_BASE_URL?: string };

/** Only these two names are read from the file; every other line is skipped unparsed. */
function readGeminiEnv(path: string): GeminiEnv {
  const out: GeminiEnv = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(GEMINI_API_KEY|GEMINI_BASE_URL)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2]!.trim();
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    const value = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, '').trim();
    if (value) out[m[1] as keyof GeminiEnv] = value;
  }
  return out;
}

let SECRET = '';
const scrub = (text: string): string => (SECRET ? text.split(SECRET).join('[redacted]') : text);
const say = (text: string) => console.log(scrub(text));

const state = { calls: 0, cap: 150, stop: '' };

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A fetch that checks the model in the URL and counts every call against the cap. */
const countedFetch: typeof fetch = async (input, init) => {
  const model = /\/models\/([^/:]+):generateContent/.exec(requestUrl(input))?.[1] ?? '?';
  if (model !== EXPECTED_MODEL) {
    state.stop = `request for model ${model}`;
    throw new Error('unexpected_model');
  }
  if (state.calls >= state.cap) throw new Error('call_cap_reached');
  state.calls += 1;
  const response = await fetch(input, init);
  if (!response.ok && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
    state.stop = `API refused a request (HTTP ${response.status})`;
  }
  return response;
};

/* ------------------------------------------------------------------ references */

type RefKey = 'a' | 'b' | 'c' | 'product' | 'logo' | 'style';
const REF_FILES: Record<RefKey, string> = {
  a: 'subject-a-light.png',
  b: 'subject-b-medium.png',
  c: 'subject-c-deep.png',
  product: 'product-bottle.png',
  logo: 'logo-mark.png',
  style: 'style-light.png',
};
const thumbs = new Map<string, { bytes: Uint8Array; mime: string }>();

async function thumb(dir: string, key: RefKey | 'face-crop' | 'bottle-crop'): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const cached = thumbs.get(key);
  if (cached) return cached;
  let image: ReturnType<typeof sharp>;
  if (key === 'face-crop' || key === 'bottle-crop') {
    // The studio's region edit sends a wide window of the picture; the close-up of the box is for the writer's eyes.
    const file = join(dir, key === 'face-crop' ? REF_FILES.b : REF_FILES.product);
    if (!existsSync(file)) return undefined;
    image = sharp(readFileSync(file));
  } else {
    const file = join(dir, REF_FILES[key]);
    if (!existsSync(file)) return undefined;
    image = sharp(readFileSync(file));
  }
  const bytes = new Uint8Array(await image.resize({ width: 768, height: 768, fit: 'inside' }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer());
  const t = { bytes, mime: 'image/jpeg' };
  thumbs.set(key, t);
  return t;
}

/* ------------------------------------------------------------------ cases */

type Expect = {
  /** Skin rules the designed prompt must show. */
  skin: 'off' | 'base' | 'realism';
  /** A person reference whose skin should be named (depth + undertone). Checked only with --label after. */
  tone?: boolean;
  /** Exact text that must appear inside double quotes. */
  text?: string[];
  /** Region edit on a face: the in-place restore sentence. */
  restore?: boolean;
  /** People with GPT Image: framing / gaze / interaction words. */
  people?: boolean;
  /** Full body: hands / arms / neck texture. */
  body?: boolean;
  /** Only hands are in frame: the skin zones are the hands' (knuckles, creases, veins, fine hair). */
  handsOnly?: boolean;
};

interface EvalCase {
  id: string;
  model: string;
  profile: EnhanceInput['profile'];
  kind?: EnhanceInput['kind'];
  locale?: 'ko' | 'en';
  prompt: string;
  refs?: Array<{ key: RefKey; role?: EnhanceReference['role'] }>;
  rules?: string[];
  region?: 'face' | 'bottle';
  expect: Expect;
}

const SEEDREAM = 'seedream-5.5';
const NB_PRO = 'nano-banana-pro';
const NB_21 = 'nano-banana-2.1';
const GPT = 'gpt-image-2.6-flare';

export const CASES: EvalCase[] = [
  // Seedream 5.5
  { id: 's01-product-style', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 향수병을 이미지 2 빛처럼 화사하게, 피드용 제품 컷', refs: [{ key: 'product', role: 'product' }, { key: 'style', role: 'style' }], expect: { skin: 'off' } },
  { id: 's02-product-realistic', model: SEEDREAM, profile: 'seedream', prompt: '실사처럼 보이는 제품 사진. 이미지 1 병이 욕실 선반 위에', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off' } },
  { id: 's03-poster-text', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 병 옆에 "봄 한정" 문구가 들어간 세로 포스터', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off', text: ['봄 한정'] } },
  { id: 's04-person-closeup-realism', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 모델이 이미지 2 세럼 병을 얼굴 옆에 든 뷰티 클로즈업, 피부결 살려서', refs: [{ key: 'b', role: 'person' }, { key: 'product', role: 'product' }], expect: { skin: 'realism', tone: true } },
  { id: 's05-person-text-only-realism', model: SEEDREAM, profile: 'seedream', prompt: '30대 남성이 흰 셔츠를 입고 카페 창가에 앉아 있는 사진, 실사 느낌으로', expect: { skin: 'realism' } },
  { id: 's06-fullbody-realism', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 모델의 전신 룩북 컷, 보정 없이 진짜 사람처럼', refs: [{ key: 'c', role: 'person' }], expect: { skin: 'realism', body: true, tone: true } },
  { id: 's07-person-base', model: SEEDREAM, profile: 'seedream', prompt: '여성 모델이 향수병을 들고 웃는 광고 컷', expect: { skin: 'base' } },
  { id: 's08-three-refs', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 모델이 이미지 2 향수를 들고 이미지 3 같은 밝은 분위기에서', refs: [{ key: 'a', role: 'person' }, { key: 'product', role: 'product' }, { key: 'style', role: 'style' }], expect: { skin: 'base' } },
  { id: 's09-logo', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 병 라벨에 이미지 2 로고를 넣은 제품 컷', refs: [{ key: 'product', role: 'product' }, { key: 'logo', role: 'logo' }], expect: { skin: 'off' } },
  { id: 's10-en-unretouched', model: SEEDREAM, profile: 'seedream', locale: 'en', prompt: 'Unretouched close-up of the woman in image 1 holding the bottle from image 2, real skin with pores', refs: [{ key: 'b', role: 'person' }, { key: 'product', role: 'product' }], expect: { skin: 'realism', tone: true } },
  { id: 's11-tone-keep', model: SEEDREAM, profile: 'seedream', prompt: '이미지 1 모델 피부톤 그대로 유지해서 립밤 광고 컷', refs: [{ key: 'c', role: 'person' }], expect: { skin: 'base', tone: true } },
  { id: 's12-region-face', model: SEEDREAM, profile: 'seedream', kind: 'region_edit', prompt: '얼굴 피부가 AI 같아요. 자연스럽게 피부결만 살려 주세요', region: 'face', expect: { skin: 'realism', restore: true } },
  { id: 's13-region-logo', model: SEEDREAM, profile: 'seedream', kind: 'region_edit', prompt: '흐린 로고를 이미지 1 로고로 선명하게', region: 'bottle', refs: [{ key: 'logo', role: 'logo' }], expect: { skin: 'off' } },
  { id: 's14-brand-rule', model: SEEDREAM, profile: 'seedream', prompt: '모델이 크림을 바르는 욕실 장면', rules: ['인물은 보정 없는 실사 피부로 보여 준다'], expect: { skin: 'realism' } },
  { id: 's15-skin-cream-no-person', model: SEEDREAM, profile: 'seedream', prompt: '피부 크림 제품 컷, 사람 없이 이미지 1 병만', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off' } },
  // Nano Banana Pro
  { id: 'n01-pro-product', model: NB_PRO, profile: 'nano-banana', prompt: '이미지 1 병을 흰 대리석 위에', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off' } },
  { id: 'n02-pro-logo', model: NB_PRO, profile: 'nano-banana', prompt: '이미지 2 로고를 이미지 1 병 라벨에 넣어 주세요', refs: [{ key: 'product', role: 'product' }, { key: 'logo', role: 'logo' }], expect: { skin: 'off' } },
  { id: 'n03-pro-closeup-realism', model: NB_PRO, profile: 'nano-banana', prompt: '이미지 1 모델 뷰티 클로즈업, 모공 보이게 실사로', refs: [{ key: 'a', role: 'person' }], expect: { skin: 'realism', tone: true } },
  { id: 'n04-pro-three-refs', model: NB_PRO, profile: 'nano-banana', prompt: '이미지 1 인물이 이미지 2 병을 들고 이미지 3 분위기로', refs: [{ key: 'b', role: 'person' }, { key: 'product', role: 'product' }, { key: 'style', role: 'style' }], expect: { skin: 'base' } },
  { id: 'n05-pro-text', model: NB_PRO, profile: 'nano-banana', prompt: '이미지 1 병 위쪽에 "NEW" 글자를 크게', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off', text: ['NEW'] } },
  { id: 'n06-pro-en-realism', model: NB_PRO, profile: 'nano-banana', locale: 'en', prompt: 'A realistic photo of a man in his sixties fixing a fishing net, real skin, no retouching', expect: { skin: 'realism' } },
  { id: 'n07-pro-product-realistic', model: NB_PRO, profile: 'nano-banana', prompt: '실사처럼 보이는 제품 컷, 이미지 1 병이 창가에', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off' } },
  { id: 'n08-pro-region-face', model: NB_PRO, profile: 'nano-banana', kind: 'region_edit', prompt: '얼굴만 자연스러운 피부로', region: 'face', expect: { skin: 'realism', restore: true } },
  // Nano Banana 2.1
  { id: 'n09-21-product-place', model: NB_21, profile: 'nano-banana', prompt: '이미지 1 병을 이미지 2 장소에 놓은 장면', refs: [{ key: 'product', role: 'product' }, { key: 'style', role: 'place' }], expect: { skin: 'off' } },
  { id: 'n10-21-fullbody-realism', model: NB_21, profile: 'nano-banana', prompt: '이미지 1 모델 전신 사진, 생얼 느낌의 리얼한 피부', refs: [{ key: 'c', role: 'person' }], expect: { skin: 'realism', body: true, tone: true } },
  { id: 'n11-21-poster', model: NB_21, profile: 'nano-banana', prompt: '"여름 한정 세트" 제목과 "7월 31일까지" 작은 글씨가 있는 이미지 1 병 포스터', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off', text: ['여름 한정 세트', '7월 31일까지'] } },
  { id: 'n12-21-tone', model: NB_21, profile: 'nano-banana', prompt: '이미지 1 인물 피부톤을 그대로 살려서 쿠션 광고', refs: [{ key: 'b', role: 'person' }], expect: { skin: 'base', tone: true } },
  { id: 'n13-21-person-base', model: NB_21, profile: 'nano-banana', prompt: '두 친구가 공원 벤치에서 음료를 마시는 장면', expect: { skin: 'base' } },
  { id: 'n14-21-no-person', model: NB_21, profile: 'nano-banana', prompt: '피부결이 느껴지는 질감의 크림 텍스처 매크로, 사람 없음', expect: { skin: 'off' } },
  { id: 'n15-21-logo', model: NB_21, profile: 'nano-banana', prompt: '이미지 1 쇼핑백에 이미지 2 로고', refs: [{ key: 'product', role: 'product' }, { key: 'logo', role: 'logo' }], expect: { skin: 'off' } },
  // GPT Image 2.6
  { id: 'g01-product', model: GPT, profile: 'gpt-image', prompt: '이미지 1 병, 대리석 위 제품 컷', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off' } },
  { id: 'g02-closeup-realism', model: GPT, profile: 'gpt-image', prompt: '이미지 1 모델이 립밤을 바르는 클로즈업, 피부 질감 사실적으로', refs: [{ key: 'a', role: 'person' }], expect: { skin: 'realism', people: true, tone: true } },
  { id: 'g03-two-people', model: GPT, profile: 'gpt-image', prompt: '20대 여성 두 명이 카페에서 웃으며 대화하는 광고 사진', expect: { skin: 'base', people: true } },
  { id: 'g04-poster', model: GPT, profile: 'gpt-image', prompt: '"SUMMER SALE 30%" 큰 제목과 "7월 31일까지" 작은 글씨가 있는 포스터', expect: { skin: 'off', text: ['SUMMER SALE 30%', '7월 31일까지'] } },
  { id: 'g05-fullbody-realism', model: GPT, profile: 'gpt-image', prompt: '이미지 1 모델 전신 룩북, 실사 느낌으로', refs: [{ key: 'b', role: 'person' }], expect: { skin: 'realism', people: true, body: true, tone: true } },
  { id: 'g06-four-refs', model: GPT, profile: 'gpt-image', prompt: '이미지 1 모델이 이미지 2 병을 들고, 이미지 3 빛, 이미지 4 로고가 병에', refs: [{ key: 'c', role: 'person' }, { key: 'product', role: 'product' }, { key: 'style', role: 'style' }, { key: 'logo', role: 'logo' }], expect: { skin: 'base', people: true } },
  { id: 'g07-logo', model: GPT, profile: 'gpt-image', prompt: '이미지 1 병에 이미지 2 로고를 정확하게', refs: [{ key: 'product', role: 'product' }, { key: 'logo', role: 'logo' }], expect: { skin: 'off' } },
  { id: 'g08-en-real-person', model: GPT, profile: 'gpt-image', locale: 'en', prompt: 'Real person portrait for a skincare ad, visible pores, the man in image 1', refs: [{ key: 'a', role: 'person' }], expect: { skin: 'realism', people: true, tone: true } },
  { id: 'g09-tone', model: GPT, profile: 'gpt-image', prompt: '이미지 1 인물 피부톤 맞춰서 파운데이션 광고', refs: [{ key: 'c', role: 'person' }], expect: { skin: 'base', people: true, tone: true } },
  { id: 'g10-product-realistic', model: GPT, profile: 'gpt-image', prompt: '실사처럼 보이는 이미지 1 병 제품 사진', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'off' } },
  { id: 'g11-brand-rule', model: GPT, profile: 'gpt-image', prompt: '여성이 거울 앞에서 토너를 바르는 장면', rules: ['인물 피부는 보정 없이 실제 피부처럼'], expect: { skin: 'realism', people: true } },
  { id: 'g12-edit-shirt', model: GPT, profile: 'gpt-image', prompt: '이미지 1 사진에서 셔츠 색만 흰색으로 바꿔 주세요', refs: [{ key: 'a', role: 'person' }], expect: { skin: 'base' } },
  { id: 'g13-older-realism', model: GPT, profile: 'gpt-image', prompt: '60대 남성 어부 클로즈업, 실사', expect: { skin: 'realism', people: true } },
  { id: 'g14-hands', model: GPT, profile: 'gpt-image', prompt: '손이 이미지 1 크림을 짜는 클로즈업, 피부결 살려서', refs: [{ key: 'product', role: 'product' }], expect: { skin: 'realism', handsOnly: true } },
  { id: 'g15-infographic', model: GPT, profile: 'gpt-image', prompt: '보습 단계 3가지를 아이콘으로 보여 주는 인포그래픽', expect: { skin: 'off' } },
];

/* ------------------------------------------------------------------ rubric */

const BEAUTY = /\b(?:flawless|perfect (?:skin|complexion)|porcelain|glass[- ]skin|airbrush(?:ed)?|poreless|dewy|8k|4k|16k|masterpiece|hyper[- ]?realistic|ultra[- ]detailed|beauty filter)\b/i;
const GEAR = /\b(?:soft ?box(?:es)?|ring ?lights?|strobes?|beauty dish|LED panels?|canon|nikon|sony|leica|hasselblad|kodak|portra|fujifilm|cinestill|zeiss|profoto|godox|aputure)\b/i;
const ZONES = /\b(?:forehead|t-zone|nose|cheeks?|cheekbones?|jaw(?:line)?|under(?:-| the )eyes?|vellus|peach fuzz|lip lines?|pores?)\b/gi;
const NB_NEGATIVE = /\b(?:do not|don't|never|avoid|must not)\b/i;
const TONE_DEPTH = /\b(?:fair|light|medium|tan(?:ned)?|olive|deep|dark|rich)\b[^.]{0,40}\bskin\b|\bskin\b[^.]{0,60}\b(?:fair|light|medium|tan(?:ned)?|deep|dark|rich)\b/i;
const TONE_UNDER = /\b(?:warm|neutral|cool|olive|golden|pink|red|yellow)(?:[- ]?undertone|\b)/i;

interface Check {
  name: string;
  ok: boolean;
  soft?: boolean;
  note?: string;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
function sentences(text: string): number {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 2).length;
}

function expectedTokens(c: EvalCase): string[] {
  const offset = c.kind === 'region_edit' ? 1 : 0;
  const images = (c.refs ?? []).length + offset;
  const word = c.profile === 'seedream' ? 'Image' : 'image';
  return Array.from({ length: images }, (_, i) => `${word} ${i + 1}`);
}

function grade(c: EvalCase, prompt: string, source: string, after: boolean): Check[] {
  const checks: Check[] = [];
  checks.push({ name: 'model_answer', ok: source === 'model', note: source });
  const tokens = expectedTokens(c);
  const missing = tokens.filter((t) => !new RegExp(`\\b${t.replace(' ', '\\s?')}(?!\\d)`, c.profile === 'seedream' ? '' : 'i').test(prompt));
  checks.push({ name: 'references_bound', ok: missing.length === 0, note: missing.join(', ') || undefined });
  if (c.profile === 'seedream') checks.push({ name: 'seedream_image_n', ok: !/\bFigure\s?\d/i.test(prompt) });
  checks.push({ name: 'no_beauty_words', ok: !BEAUTY.test(prompt), note: BEAUTY.exec(prompt)?.[0] });
  checks.push({ name: 'no_gear', ok: !GEAR.test(prompt), note: GEAR.exec(prompt)?.[0] });
  const zones = new Set((prompt.match(ZONES) ?? []).map((z) => z.toLowerCase().replace(/s$/, '')));
  if (c.expect.skin === 'realism' && c.expect.handsOnly) {
    const hand = new Set((prompt.match(/(?:knuckles?|creases?|veins?|fine hair|nail beds?|tone variations?)/gi) ?? []).map((z) => z.toLowerCase()));
    checks.push({ name: 'skin_zones_hands', ok: hand.size >= 3, note: [...hand].join(',') });
  } else if (c.expect.skin === 'realism') checks.push({ name: 'skin_zones', ok: zones.size >= 3, note: [...zones].join(',') });
  if (c.expect.skin === 'off') checks.push({ name: 'no_skin_block', ok: !/\b(?:pores?|vellus|peach fuzz|under(?:-| the )eyes?|t-zone)\b/i.test(prompt), note: [...zones].join(',') || undefined });
  if (c.expect.skin === 'realism' && c.kind !== 'region_edit') {
    checks.push({ name: 'no_fake_texture', ok: !/\b(?:film grain|added grain|grainy|sensor noise|sharpen(?:ed|ing)?)\b/i.test(prompt.replace(/\bnot? (?:over-?)?sharpen(?:ed|ing)?\b|\bover-?sharpen(?:ed|ing)?\b/gi, '')) });
  }
  if (c.expect.body) checks.push({ name: 'body_texture', ok: /\b(?:hands?|arms?|forearms?|knuckles?|wrists?|neck|fingers?)\b/i.test(prompt) });
  if (c.expect.people && c.profile === 'gpt-image') {
    checks.push({ name: 'gpt_photoreal', ok: /\b(?:photorealistic|real photograph)\b/i.test(prompt) });
    checks.push({ name: 'gpt_framing_gaze', ok: /\b(?:gaze|looking|looks|eyes? (?:on|toward|to)|eye line|framed|framing|crop(?:ped)?|waist-up|head-and-shoulders|full body)\b/i.test(prompt) });
    if (c.expect.skin === 'realism') checks.push({ name: 'gpt_no_glamour', ok: /no glamori[sz]ation|no heavy retouching/i.test(prompt) });
  }
  if (c.expect.text) {
    for (const t of c.expect.text) checks.push({ name: `quoted:${t}`, ok: prompt.includes(`"${t}"`) || prompt.includes(`“${t}”`) });
    checks.push({ name: 'no_other_text', ok: /no other (?:text|words|letters)|never add other words|nothing else written/i.test(prompt), soft: true });
  }
  if (c.expect.restore) {
    checks.push({ name: 'restore_in_place', ok: /change only|only the/i.test(prompt) && /\b(?:identity|same face|same person|expression)\b/i.test(prompt) && /\b(?:texture|pores?|skin detail)\b/i.test(prompt) });
  }
  if (c.expect.tone && after) {
    checks.push({ name: 'tone_named', ok: TONE_DEPTH.test(prompt) && TONE_UNDER.test(prompt) });
  }
  if (c.profile === 'nano-banana') {
    const noCount = (prompt.match(/\bno\s+(?!longer)\w+/gi) ?? []).length;
    // The partial edit's guard sentence is a required line (enhancer/schema.ts), not a phrasing choice.
    const phrased = prompt.replace(/do not move or resize anything else\.?/gi, '');
    checks.push({ name: 'nb_positive', ok: !NB_NEGATIVE.test(phrased), note: NB_NEGATIVE.exec(phrased)?.[0] });
    checks.push({ name: 'nb_few_no', ok: noCount <= 2, soft: true, note: String(noCount) });
    const s = sentences(prompt);
    checks.push({ name: 'nb_sentences', ok: s <= 8, soft: s <= 9, note: String(s) });
  }
  if (c.profile === 'gpt-image') {
    const s = sentences(prompt);
    checks.push({ name: 'gpt_sentences', ok: s <= 10, soft: s <= 12, note: String(s) });
  }
  if (c.profile === 'seedream' && c.kind !== 'region_edit') {
    const big = (c.refs?.length ?? 0) >= 3 || c.expect.skin === 'realism';
    const ceiling = big ? 200 : 140;
    const n = words(prompt);
    checks.push({ name: 'seedream_words', ok: n <= ceiling, soft: n <= Math.round(ceiling * 1.15), note: `${n}/${ceiling}` });
    checks.push({ name: 'seedream_one_paragraph', ok: !/\n\s*\n|\n\s*[-*\d]/.test(prompt) });
  }
  if (c.kind !== 'region_edit' && c.profile !== 'gpt-image') {
    checks.push({ name: 'use_case', ok: /\b(?:for (?:a|an|the) [^.]{0,40}(?:post|ad|advert|campaign|poster|banner|page|lookbook|feed|story|listing|catalog)|product (?:shot|photo)|campaign|advertis|lookbook|editorial|poster|banner|packshot)\b/i.test(prompt), soft: true });
  }
  return checks;
}

function verdict(checks: Check[]): 'pass' | 'acceptable' | 'fail' {
  const missed = checks.filter((c) => !c.ok);
  if (missed.length === 0) return 'pass';
  // A missed check that still holds its softer bound (`soft: true`) is acceptable; any other miss is a fail.
  return missed.every((c) => c.soft === true) ? 'acceptable' : 'fail';
}

/* ------------------------------------------------------------------ running one case */

async function inputOf(c: EvalCase, refsDir: string): Promise<EnhanceInput> {
  const references: EnhanceReference[] = [];
  let i = 0;
  for (const r of c.refs ?? []) {
    i += 1;
    const t = await thumb(refsDir, r.key);
    references.push({ index: i, kind: 'image', label: `이미지 ${i}`, ...(r.role ? { role: r.role } : {}), ...(t ? { thumb: t } : {}) });
  }
  const base = {
    kind: c.kind ?? 'image',
    profile: c.profile,
    model: c.model,
    locale: c.locale ?? 'ko',
    prompt: c.prompt,
    references,
    brand: c.rules ? { name: 'Test brand', rules: c.rules } : null,
  } as EnhanceInput & { model: string };
  if (c.region) {
    const crop = await thumb(refsDir, c.region === 'face' ? 'face-crop' : 'bottle-crop');
    return {
      ...base,
      editCropThumb: crop ?? null,
      regionWindow:
        c.region === 'face'
          ? { where: 'top middle', left: 30, right: 70, top: 12, bottom: 52, closeUp: crop ?? null }
          : { where: 'middle', left: 40, right: 62, top: 30, bottom: 72, closeUp: crop ?? null },
    };
  }
  return base;
}

async function runCase(c: EvalCase, refsDir: string, env: Record<string, string | undefined>, after: boolean) {
  const reasons: string[] = [];
  const t0 = performance.now();
  try {
    const result = await enhancePrompt(await inputOf(c, refsDir), { fetch: countedFetch, env, onFallback: (r) => reasons.push(r) });
    const checks = grade(c, result.prompt, result.source, after);
    return { prompt: scrub(result.prompt), source: result.source, fallback: reasons[0] ?? null, checks, verdict: verdict(checks), ms: Math.round(performance.now() - t0) };
  } catch (error) {
    return { prompt: '', source: 'error', fallback: scrub(String(error)).slice(0, 200), checks: [] as Check[], verdict: 'fail' as const, ms: Math.round(performance.now() - t0) };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const at = next++;
        if (at >= items.length || state.stop) return;
        out[at] = await fn(items[at]!);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ the image-test matrix (--emit) */

const MATRIX_MODELS = [
  { id: SEEDREAM, profile: 'seedream' as const, label: 'Seedream 5.5', settings: { resolution: '2K' } },
  { id: NB_PRO, profile: 'nano-banana' as const, label: 'Nano Banana Pro', settings: { resolution: '2K' } },
  { id: NB_21, profile: 'nano-banana' as const, label: 'Nano Banana 2.1', settings: { resolution: '2K' } },
  { id: GPT, profile: 'gpt-image' as const, label: 'GPT Image 2.6 Flare', settings: { resolution: '2K', quality: 'high' } },
];
const SUBJECTS: Array<{ key: 'a' | 'b' | 'c'; note: string }> = [
  { key: 'a', note: 'fair, cool-neutral undertone, young man' },
  { key: 'b', note: 'medium, warm-olive undertone, freckles, young woman' },
  { key: 'c', note: 'deep, neutral undertone, young man' },
];
const FRAMINGS = [
  { key: 'closeup', aspect: '3:4', request: '이미지 1 모델이 이미지 2 향수병을 얼굴 가까이 들고 있는 뷰티 광고 클로즈업. 피부결 살려서, 보정 없이 실제 사람처럼.', variants: ['none', 'short', 'full'] },
  { key: 'fullbody', aspect: '2:3', request: '이미지 1 모델이 이미지 2 향수병을 들고 서 있는 전신 룩북 컷. 피부결 살려서 실사 느낌으로.', variants: ['none', 'short'] },
] as const;

async function emit(dir: string, refsDir: string, env: Record<string, string | undefined>) {
  mkdirSync(dir, { recursive: true });
  const rows: string[] = ['| cell | model | subject | framing | arm | tone | aspect | settings | file |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  const cells: Array<Record<string, unknown>> = [];
  for (const model of MATRIX_MODELS) {
    for (const subject of SUBJECTS) {
      for (const framing of FRAMINGS) {
        const base = `${model.id}__${subject.key}__${framing.key}`;
        const refs = [`refs/${REF_FILES[subject.key]}`, `refs/${REF_FILES.product}`];
        const settings = { aspect: framing.aspect, ...model.settings };
        // The current arm: the same request with Prompt Architect ON in production (main profiles).
        const currentFile = `${base}__current.txt`;
        writeFileSync(
          join(dir, currentFile),
          [`# ${model.label} · subject ${subject.key} (${subject.note}) · ${framing.key} · CURRENT arm`, `Prompt Architect: ON in production (do not paste a designed prompt)`, `Attach in this order: ${refs.join(', ')} (roles: person, product)`, `Settings: ${JSON.stringify(settings)}`, '', 'Type this request:', framing.request, ''].join('\n'),
        );
        rows.push(`| ${base}__current | ${model.label} | ${subject.key} | ${framing.key} | current (Architect ON in production) | — | ${framing.aspect} | ${JSON.stringify(model.settings)} | ${currentFile} |`);
        cells.push({ cell: `${base}__current`, model: model.id, subject: subject.key, framing: framing.key, arm: 'current', refs, settings, request: framing.request });
        for (const variant of framing.variants) {
          const c: EvalCase = { id: `${base}__new__${variant}`, model: model.id, profile: model.profile, prompt: framing.request, refs: [{ key: subject.key, role: 'person' }, { key: 'product', role: 'product' }], expect: { skin: 'realism', tone: variant !== 'none', body: framing.key === 'fullbody', people: model.profile === 'gpt-image' } };
          const result = await runCase(c, refsDir, { ...env, BRAND_STUDIO_ENHANCER_SKIN_VARIANT: variant }, true);
          const file = `${c.id}.txt`;
          writeFileSync(
            join(dir, file),
            [`# ${model.label} · subject ${subject.key} (${subject.note}) · ${framing.key} · NEW profile · tone:${variant}`, `Prompt Architect: OFF (paste the prompt below as it is)`, `Attach in this order: ${refs.join(', ')} (roles: person, product)`, `Settings: ${JSON.stringify(settings)}`, `Designed from the request: ${framing.request}`, `Source: ${result.source}${result.fallback ? ` (${result.fallback})` : ''} · checks: ${result.verdict}`, '', '--- prompt ---', result.prompt, ''].join('\n'),
          );
          rows.push(`| ${c.id} | ${model.label} | ${subject.key} | ${framing.key} | new | ${variant} | ${framing.aspect} | ${JSON.stringify(model.settings)} | ${file} |`);
          cells.push({ cell: c.id, model: model.id, subject: subject.key, framing: framing.key, arm: 'new', tone: variant, refs, settings, request: framing.request, prompt: result.prompt, source: result.source, verdict: result.verdict, checks: result.checks });
          say(`  ${c.id}: ${result.verdict} (${result.source})`);
          if (state.stop) throw new Error(state.stop);
        }
      }
    }
  }
  writeFileSync(join(dir, 'matrix.md'), [`# Image-test matrix (${new Date().toISOString().slice(0, 10)})`, '', `${cells.length} cells · ${state.calls} Prompt Architect calls`, '', ...rows, ''].join('\n'));
  writeFileSync(join(dir, 'matrix.json'), scrub(JSON.stringify(cells, null, 2)));
  say(`emitted ${cells.length} cells to ${dir} (${state.calls} calls)`);
}

/**
 * `--emit-plain <dir>`: the side-effect check (2026-11-19). An ordinary ad request with NO realism words, close-up
 * only, Seedream 5.5 and GPT Image 2.6 Flare x the three subjects x {current, new}. Does the new base rule keep the
 * scene the customer asked for, or drift to the person reference's own backdrop and light? Merged into the
 * existing matrix.json (cells named `<model>__<s>__closeup__plain__current|new`); 6 model calls.
 */
const PLAIN_REQUEST = '이미지 1 모델이 이미지 2 향수병을 들고 활짝 웃는 봄 캠페인 광고 컷. 햇살이 가득 들어오는 밝고 화사한 공간, 산뜻하고 가벼운 분위기로.';
const PLAIN_MODELS = MATRIX_MODELS.filter((m) => m.id === SEEDREAM || m.id === GPT);

async function emitPlain(dir: string, refsDir: string, env: Record<string, string | undefined>) {
  mkdirSync(dir, { recursive: true });
  const matrixFile = join(dir, 'matrix.json');
  const existing: Array<Record<string, unknown>> = existsSync(matrixFile) ? JSON.parse(readFileSync(matrixFile, 'utf8')) : [];
  const cells: Array<Record<string, unknown>> = [];
  const rows: string[] = [];
  const only = flag('--only')?.split(',').map((x) => x.trim()).filter(Boolean);
  for (const model of PLAIN_MODELS) {
    for (const subject of SUBJECTS) {
      const base = `${model.id}__${subject.key}__closeup__plain`;
      const refs = [`refs/${REF_FILES[subject.key]}`, `refs/${REF_FILES.product}`];
      const settings = { aspect: '3:4', ...model.settings };
      writeFileSync(
        join(dir, `${base}__current.txt`),
        [`# ${model.label} · subject ${subject.key} (${subject.note}) · closeup · PLAIN request · CURRENT arm`, 'Prompt Architect: ON in production (do not paste a designed prompt)', `Attach in this order: ${refs.join(', ')} (roles: person, product)`, `Settings: ${JSON.stringify(settings)}`, '', 'Type this request:', PLAIN_REQUEST, ''].join('\n'),
      );
      cells.push({ cell: `${base}__current`, model: model.id, subject: subject.key, framing: 'closeup', arm: 'current', plain: true, refs, settings, request: PLAIN_REQUEST });
      rows.push(`| ${base}__current | ${model.label} | ${subject.key} | closeup | current, plain request | — | 3:4 | ${JSON.stringify(model.settings)} | ${base}__current.txt |`);
      const c: EvalCase = { id: `${base}__new`, model: model.id, profile: model.profile, prompt: PLAIN_REQUEST, refs: [{ key: subject.key, role: 'person' }, { key: 'product', role: 'product' }], expect: { skin: 'base', people: model.profile === 'gpt-image' } };
      // `--only <cell>` designs just that cell again and keeps the others as they are in matrix.json.
      const kept = only?.length && !only.includes(c.id) ? existing.find((x) => x.cell === c.id) : undefined;
      if (kept) {
        cells.push(kept);
        rows.push(`| ${c.id} | ${model.label} | ${subject.key} | closeup | new, plain request | — | 3:4 | ${JSON.stringify(model.settings)} | ${c.id}.txt |`);
        continue;
      }
      const result = await runCase(c, refsDir, env, true);
      writeFileSync(
        join(dir, `${c.id}.txt`),
        [`# ${model.label} · subject ${subject.key} (${subject.note}) · closeup · PLAIN request · NEW profile`, 'Prompt Architect: OFF (paste the prompt below as it is)', `Attach in this order: ${refs.join(', ')} (roles: person, product)`, `Settings: ${JSON.stringify(settings)}`, `Designed from the request: ${PLAIN_REQUEST}`, `Source: ${result.source}${result.fallback ? ` (${result.fallback})` : ''} · checks: ${result.verdict}`, '', '--- prompt ---', result.prompt, ''].join('\n'),
      );
      cells.push({ cell: c.id, model: model.id, subject: subject.key, framing: 'closeup', arm: 'new', plain: true, refs, settings, request: PLAIN_REQUEST, prompt: result.prompt, source: result.source, verdict: result.verdict, checks: result.checks });
      rows.push(`| ${c.id} | ${model.label} | ${subject.key} | closeup | new, plain request | — | 3:4 | ${JSON.stringify(model.settings)} | ${c.id}.txt |`);
      say(`  ${c.id}: ${result.verdict} (${result.source})`);
      if (state.stop) throw new Error(state.stop);
    }
  }
  const merged = [...existing.filter((x) => !String(x.cell).includes('__plain__')), ...cells];
  writeFileSync(matrixFile, scrub(JSON.stringify(merged, null, 2)));
  const md = join(dir, 'matrix.md');
  const head = existsSync(md) ? readFileSync(md, 'utf8').split('\n## Plain request')[0]!.trimEnd() : '# Image-test matrix';
  writeFileSync(md, [head, '', `## Plain request (no realism words), ${new Date().toISOString().slice(0, 10)}`, '', `Request: ${PLAIN_REQUEST}`, '', '| cell | model | subject | framing | arm | tone | aspect | settings | file |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'));
  say(`emitted ${cells.length} plain cells into ${dir} (${state.calls} calls); matrix.json now ${merged.length} cells`);
}

/* ------------------------------------------------------------------ main */

async function main() {
  const envFile = argv[0];
  if (!envFile || envFile.startsWith('--')) throw new Error('usage: architect-eval.ts <env-file> --refs <dir> [...]');
  const gemini = readGeminiEnv(resolve(envFile));
  if (!gemini.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not in the env file');
  SECRET = gemini.GEMINI_API_KEY;
  const refsDir = resolve(flag('--refs') ?? '.');
  state.cap = intFlag('--cap', 150, 1, 400);
  const env: Record<string, string | undefined> = { GEMINI_API_KEY: gemini.GEMINI_API_KEY, ...(gemini.GEMINI_BASE_URL ? { GEMINI_BASE_URL: gemini.GEMINI_BASE_URL } : {}) };
  const variant = flag('--variant');
  if (variant) env.BRAND_STUDIO_ENHANCER_SKIN_VARIANT = variant;

  const plainDir = flag('--emit-plain');
  if (plainDir) return emitPlain(resolve(plainDir), refsDir, env);
  const emitDir = flag('--emit');
  if (emitDir) return emit(resolve(emitDir), refsDir, env);

  const label = flag('--label') ?? 'run';
  const after = label !== 'before';
  const only = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const cases = only?.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
  const reruns = intFlag('--reruns', 1, 0, 3);
  const concurrency = intFlag('--concurrency', 3, 1, 6);
  say(`architect-eval ${label}: ${cases.length} cases, cap ${state.cap}, model ${EXPECTED_MODEL}`);

  const first = await pool(cases, concurrency, (c) => runCase(c, refsDir, env, after));
  const results = cases.map((c, i) => ({ id: c.id, model: c.model, first: first[i], reruns: [] as Array<Awaited<ReturnType<typeof runCase>>> }));
  for (const r of results) {
    if (r.first?.verdict !== 'fail' || state.stop) continue;
    for (let k = 0; k < reruns && state.calls < state.cap; k += 1) r.reruns.push(await runCase(cases.find((c) => c.id === r.id)!, refsDir, env, after));
  }

  const tally = { pass: 0, acceptable: 0, fail: 0 };
  const lines = [`| case | model | verdict | reruns | missed checks |`, `| --- | --- | --- | --- | --- |`];
  for (const r of results) {
    const v = r.first?.verdict ?? 'fail';
    tally[v] += 1;
    const missed = (r.first?.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}${c.note ? ` (${c.note})` : ''}`).join('; ') || (r.first?.source === 'error' ? `error: ${r.first.fallback}` : '');
    lines.push(`| ${r.id} | ${r.model} | ${v} | ${r.reruns.map((x) => x.verdict).join(',') || '—'} | ${missed.replace(/\|/g, '/')} |`);
  }
  const summary = `**${label}**: ${tally.pass} pass · ${tally.acceptable} acceptable · ${tally.fail} fail of ${results.length} · ${state.calls} model calls`;
  say(['', summary, '', ...lines].join('\n'));
  const outDir = resolve(flag('--out-dir') ?? '.');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(join(outDir, `architect-eval-${label}-${stamp}.json`), scrub(JSON.stringify({ label, model: EXPECTED_MODEL, calls: state.calls, tally, results, cases }, null, 2)));
  writeFileSync(join(outDir, `architect-eval-${label}-${stamp}.md`), scrub([summary, '', ...lines, ''].join('\n')));
  if (state.stop) say(`stopped: ${state.stop}`);
}

main().catch((error) => {
  console.log(scrub(`architect-eval failed: ${String((error as Error)?.message ?? error)}`).slice(0, 300));
  process.exitCode = 1;
});
