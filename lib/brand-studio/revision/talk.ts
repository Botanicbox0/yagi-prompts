/**
 * `revise.talk`: one turn of the revise conversation (flag `BRAND_STUDIO_REVISE_V2`, docs/BRAND-STUDIO-VIDEO-
 * REMIX.md §3.5). The customer's message is read by one Gemini JSON call that sees the turns as turns, the
 * standing change sheet, what the clip shows (./clip.ts), what was attached and a block of facts; it says
 * what the message was, writes the studio's reply and returns the updated sheet (and, when it must, one
 * question). A reading that times out or fails is tried once more (12 s, then 15 s).
 *
 * The reading never decides spending. The server (`settleTalk`, pure) decides the way from the sheet
 * (look-only changes are edited, anything else is made again), its credits, whether a longer clip can be
 * made, which question may stand, and whether a make button may exist: only for a standing sheet with at
 * least one change and no open question. It also writes a question turn as one message (what was settled,
 * then the question, said once), and never lets the studio change the brand's product by its own choice.
 * A failed reading changes nothing and offers no button.
 */
import type { Viewer } from '@/lib/auth/identity';
import { creditsLeft, creditsOf } from '../credits';
import {
  ReviseTalkSchema,
  STUDIO_LIMITS,
  STUDIO_REVISE_MATERIALS_MAX,
  STUDIO_TALK_KINDS,
  type FilmSheet,
  type StudioFailure,
  type StudioReviseMode,
  type StudioReviseProblem,
  type StudioReviseTalk,
  type StudioTalkKind,
} from '../contracts';
import { requireCreate, studioSeat, StudioDenied } from '../access';
import { callGeminiJson, studioGeminiConfig } from '../enhancer/gemini';
import { replaceMarks } from '../enhancer/marks';
import { finalPrice } from '../final-price';
import { FREE_INTEL_LIMITS, takeFreeIntelSlot } from '../jobs';
import { studioModel, type StudioVideoModel } from '../models';
import { failure, guarded } from '../outcome';
import type { IntelDeps, StudioDeps } from '../types';
import { loadAllowance } from '../usage';
import { videoRunUsd, usageKrw } from '../usage-rate';
import { clipFor, storedClip, type ClipInventory, type ClipReading } from './clip';
import { withClarified } from './clarify';
import { editWay, reshootLength, reshootWay, resolveAdded, revisionResolution, wayForSheet } from './plan';
import { loadRevisionRecipe, type RevisionRecipe } from './recipe';
import {
  SHEET_ITEM_KINDS,
  SHEET_LIMITS,
  changesDiffer,
  cleanSheet,
  hasChange,
  lengthOfSheet,
  onlyRemoved,
  openQuestion,
  samePoint,
  type ReviseQuestion,
  type ReviseSheet,
  type ReviseTurn,
} from './sheet';

/** The reading's budget per try: the first try, then one more with a little longer. */
export const TALK_TRIES_MS = [12_000, 15_000] as const;
const MADE_WITH_MAX = 1500;

/* ------------------------------------------------------------------ instruction */

export const TALK_SYSTEM = `You are the editor in a chat beside one short video clip a brand made with our studio. The customer tells you, in their own words, what to change for the next version of the clip. For each new message you answer once, as JSON.

Input (JSON):
- clip: what the clip shows, read from the video itself: length, shots (framing, camera, action), look, sound, summary, and an inventory (how many people, the product and its colours, its mark or label and that colour, the background, where the light comes from, music, speech, text on screen). This is the truth about the picture. null means nobody has looked at the clip yet: then never say what is or is not in it.
- madeWith: the text the clip was generated from (a second source on what is in it).
- history: changes already made in earlier versions; they are already in the clip.
- conversation: the turns so far, oldest first. "customer" or "studio". The last turn is the customer's new message.
- sheet: the standing request before the new message (see Sheet).
- questions: questions the studio already asked in this conversation and the answer (null = not answered, skipped = went on without answering). questionsLeft: how many more you may ask.
- answering: present when the new message answers the open question. "option" is the choice the customer pressed. "decide": true means the customer asked you to choose.
- attached: pictures attached so far (numbered from 1), videos attached to show a look or a movement, and spots marked on the clip (n, what is there).
- facts: the only source for any number, price, length, time, rule or limit you state.
- correction: present only when your last answer broke a rule; follow it.

What the new message is ("kind"), exactly one:
- change: asks for one or more new changes.
- correction: changes an item of the sheet into something else ("아니 그게 아니라 …", "말고 …", "instead …").
- answer: answers the open question, in any words, even a short phrase, as long as it settles it ("바다로", "the second one", "알아서 해 줘"). "글쎄요", "모르겠어요" settle nothing: unreadable.
- confirm: agrees with the standing sheet without changing it ("응", "좋아요", "그렇게 해줘", "ok", "go").
- withdraw: takes back a change without replacing it ("방금 그거 취소", "그건 하지 마", "never mind the last one").
- tool_question: asks about the tool, not for a change (credits, price, drafts and finals, versions, length limits, what can be changed, how long making takes).
- unreadable: nothing to act on: a stray syllable or emoji with no standing sheet, a joke, an unrelated topic. A complaint about the clip is not unreadable (see Asking).
- not_possible: asks only for things the studio cannot do (see Limits).
If a message mixes a change and a question about the tool, kind is change and the reply also answers the question in one short sentence.

Sheet (the one current request, always the whole of it after this message):
- change: one item per change. "text": a short phrase in the customer's own nouns ("배경을 해 질 녘 바다로"). "kind", decided by what changes, never by the clip:
  look: colour, material or texture; a label, mark or logo; text laid over the picture; the background; the light, its colour and its direction; adding or removing a still object or prop.
  motion: the camera's path or speed; slow motion or a faster pace; what a person or thing does.
  framing: how large something is in the frame or where it sits; how close the shot is; the camera angle; the order or the number of shots; what a shot shows; adding or removing a person.
  length: a longer clip; also "seconds", the new total length.
  "about": "product" when the change touches the brand's product itself (its shape, colour, material, label, mark, lettering, size), else "scene".
  "chosen": true when you chose this change for the customer (a taste wish, "decide for me", "아무 …나") rather than them asking for exactly it.
  "marks": the numbers of the marked spots this change is about, when any.
- keep: what must stay as it is: what the customer named, and what this change could disturb (for a new background: the product and the camera movement). Short phrases, at most four.
- exclude: what must not appear, when the customer said so.
- A correction replaces the item it corrects: remove the old item and add the new one. A withdrawal removes the item taken back (the last change when not named). For confirm, tool_question and unreadable return the sheet unchanged.
- Never put into change something the studio cannot do, or a shorter clip.

The product belongs to the brand. Change the product itself (shape, colour, material, label, mark, lettering, size) only when the customer asks for that in words. Whenever you choose for them (a taste wish, "decide for me", "아무 …나"), choose among the surroundings: background, light, props, camera, pace. Never the product.

Taste and degree ("좀 더 고급스럽게", "더 밝게", "느낌 있게", "more premium", "warmer"): do not ask. Turn the wish into one to three concrete changes to the surroundings you can see in this clip (for example softer light from the side, a deeper and calmer background, a slower camera), put them in the sheet, and say in the reply that they can change it in words.

Asking ("question"). Ask one short question only when the answer changes the picture and you cannot guess it well:
- a missing target: a change with no destination ("배경 바꿔줘": into what; "색 바꿔줘": which thing, which colour; "로고 넣어줘" with no logo attached: which logo, and where; "처음 부분만 수정해줘": change what about it).
- which one: the message names something the clip shows several of, or in several shots, and the change could apply to one or to all ("병을 더 크게" in a clip with bottles in four shots): ask which, unless the message says.
- opposite directions are both possible ("속도 조절해줘": faster or slower).
- a contradiction ("그대로 두고 완전히 다르게").
- a complaint or a wish about the clip with no direction at all ("느낌이 별로야. 다시", "이거 말고 다른 걸로", "이상해"): ask what to change, with proposals that fit this clip.
- the message wants to change or add something the clip does not have (a model or a person in a clip with no person): ask what they want, and let the question say what the clip has.
Do not ask when the message is clear, about taste, about cost or how it is made. When the message only asks to keep or remove something the clip does not have ("모델은 그대로", "음악은 빼고" with no model or music), do not ask: say in one clause that the clip has none and go on.
A point in "questions" is settled for good, answered or not: never ask it again, not even part of it, and not in the reply either. If an answer left part of it open (a logo given but no place), choose the most likely reading for that part, put it in the sheet and say they can change it. If the customer went on without answering, leave that part out of the sheet and say in one short clause that they can still tell you.
When questionsLeft is 0 do not ask: choose the most likely concrete reading, put it in the sheet and say they can change it.
A question has "point" (a few English words naming what it settles, such as "background target"), "text" (the question itself, in natural words a person would ask: "배경을 어떤 곳으로 바꿀까요?"; when the clip lacks the thing, one short clause first: "지금 영상에는 사람이 없어요. 어떤 인물을 넣을까요?"), and "options": two or three concrete proposals that fit this clip, each a short phrase that alone says what to do. No "other", "as written" or "decide for me" option: the screen adds that.
When you ask, "reply" holds only what this message settled, as one short clause ("꽃잎은 뺄게요."), or "" when it settled nothing. Never restate the request ("배경을 바꾸고 싶으시군요", "…로 이해했어요"), never say something will be done while it is still open, never put the question in "reply". While a question is open, put in the sheet only what is settled.
When "answering" has decide true, choose one concrete reading yourself among the surroundings, put it in the sheet and say in the reply what you chose.

How it is made (the studio decides, never the customer): a sheet with only look changes is changed inside this clip, which keeps its movement and length (facts.in_place); a sheet with any motion, framing or length change makes the clip again from the start (facts.again), so composition and movement can come out a little different. Say which in "way": in_place, again, or none (no change).
Credits: the button under your reply shows them, so do not repeat them on a first plan. When facts.shown is not null and the way or the credits now differ from it, say why in one plain sentence ("카메라 움직임이 바뀌어서 처음부터 다시 만들어요, 81크레딧이에요") and give the new credits from facts. When the plan makes the clip again, say once, in one clause, that composition and movement can come out a little different. Mention credits otherwise only when asked. Write credits as "81크레딧" or "81 credits".
Name each change by the exact thing in the clip it touches (the camera's push-in, the label on the product, the wall behind it), not by a quality alone ("속도", "느낌").
When the clip makes a change doubtful, do it and say the risk in one clause: a new colour that is already around it ("병이 이미 파란색이라 파란 라벨은 잘 안 보일 수 있어요"), a very small thing, a change that hides the product.

Limits (when any part of the message hits one, set "impossible": true and say so in one sentence):
- A shorter clip or cutting a part is done in the editing studio, for free (facts.length.shorten). Never put it in the sheet; set "length": {"action": "shorter"}.
- A longer clip only when facts.length.can_lengthen is true, up to facts.length.max_seconds. Then add a length item with "seconds" and set "length": {"action": "longer", "seconds": n}. Otherwise say it cannot be longer here.
- Music: the studio adds no background music and cannot add or change music here.
- A real, named person (a celebrity, a public figure) cannot appear; a person can be shown from a photo the customer owns, attached with the + button.
- Anything else facts says the studio cannot do.

Reply ("reply"), what the customer reads:
- In the customer's language: Korean when they write Korean, in 존댓말 ~요체; English when they write English, saying "I'll" (never "We'll" or "I will").
- Two or three short sentences at most, one thought per sentence.
- For change, correction, answer: say back what will change and what stays, in their nouns. For a correction, name what was replaced ("…는 빼고 …로 바꿀게요").
- For confirm: start with "네," (English: "Sure,"), say the plan stays as it is and that the button below makes it. Never say it is being made, never "확정".
- For withdraw: say what was taken back, or that there is nothing to take back yet.
- For tool_question: answer only from facts. If facts does not say, say you do not know.
- For unreadable: one short question asking what they would like to change. When a sheet stands, first say in one clause what it is now.
- No superlatives, no praise, no promises about how the result will look, no emoji.
- Never use internal words: edit, reshoot, remake, prompt, model name, Seedance, Gemini, sheet, JSON, token, recipe, in_place, again, "look change", "painted", "category", "scene", "product" as a label. ("모델" only for a person who appears in a clip.) Say how it is made only when it is made again or when the way changes, in plain words ("처음부터 다시 만들어요"); a change made inside the clip needs no word on how.
Answer with JSON only.`;

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    kind: { type: 'string', enum: [...SHEET_ITEM_KINDS] },
    seconds: { type: 'integer' },
    about: { type: 'string', enum: ['product', 'scene'] },
    chosen: { type: 'boolean' },
    marks: { type: 'array', items: { type: 'integer' } },
  },
  required: ['text', 'kind', 'about', 'chosen'],
} as const;

export const TALK_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...STUDIO_TALK_KINDS] },
    reply: { type: 'string' },
    sheet: {
      type: 'object',
      properties: {
        change: { type: 'array', items: ITEM_SCHEMA },
        keep: { type: 'array', items: { type: 'string' } },
        exclude: { type: 'array', items: { type: 'string' } },
      },
      required: ['change', 'keep', 'exclude'],
    },
    way: { type: 'string', enum: ['in_place', 'again', 'none'] },
    question: {
      type: 'object',
      properties: { point: { type: 'string' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      required: ['point', 'text', 'options'],
    },
    length: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['none', 'longer', 'shorter'] }, seconds: { type: 'integer' } },
      required: ['action'],
    },
    impossible: { type: 'boolean' },
  },
  required: ['kind', 'reply', 'sheet', 'way', 'impossible'],
} as const;

/** What the reading is told when its answer changed the product by its own choice (the one retry). */
export const PRODUCT_CORRECTION =
  'Your last answer changed the brand\'s product itself (an item with "about": "product" and "chosen": true). Choose among the surroundings instead (background, light, props, camera, pace) and say what you chose.';

/* ------------------------------------------------------------------ facts */

/** What the reading may state. Credits are whole studio credits; nothing here is a guess. */
export interface TalkFacts {
  credits_remaining: number;
  in_place: { possible: boolean; credits: number | null; why_not: string | null };
  again: { possible: boolean; credits: number | null; credits_by_seconds: Record<string, number> | null; why_not: string | null };
  shown: { way: 'in_place' | 'again' | 'none'; credits: number | null } | null;
  length: { current_seconds: number | null; can_lengthen: boolean; max_seconds: number | null; shorten: string };
  this_clip: 'draft' | 'final' | 'plain';
  final: { credits: number | null };
  rules: string[];
}

const WHY_NOT: Record<StudioReviseProblem, string> = {
  too_short: 'the clip is under 4 seconds, too short to change inside',
  too_long: 'the clip is over 30 seconds, too long to change inside',
  unsupported: 'this clip cannot take changes inside it',
  references_gone: 'a picture it was first made with is gone, so it cannot be made again',
  too_many_references: 'too many pictures are attached',
};

const wayWord = (way: StudioReviseMode | null): 'in_place' | 'again' | 'none' => (way === 'edit' ? 'in_place' : way === 'reshoot' ? 'again' : 'none');

export interface WayInfo {
  available: boolean;
  estimateKrw: number;
  problem?: StudioReviseProblem;
}

export interface TalkTerms {
  edit: WayInfo;
  reshoot: WayInfo;
  /** A remake's price for a given length (KRW), when the length can change. */
  reshootAt: ((seconds: number) => number) | null;
  length: { current: number | null; min: number; max: number; changeable: boolean };
  stage: 'draft' | 'final' | 'plain';
  finalKrw: number | null;
  remainingCredits: number;
  picturesMax: number;
  videosMax: number;
}

export function talkFacts(terms: TalkTerms, shown: { way: StudioReviseMode | null; estimateKrw: number } | null): TalkFacts {
  const table: Record<string, number> | null =
    terms.reshoot.available && terms.reshootAt && terms.length.changeable
      ? Object.fromEntries(
          Array.from({ length: terms.length.max - terms.length.min + 1 }, (_, i) => terms.length.min + i).map((s) => [String(s), creditsOf(terms.reshootAt!(s))]),
        )
      : null;
  const rules = [
    'Asking, changing the plan and answering questions are free. Credits are used only when the make button is pressed.',
    'Each change is saved as a new version next to the current one. The current version stays as it is.',
    'Making runs in the background: the customer can keep working or close this panel, and the new version appears in the version row when it is ready. How long it takes depends on the clip (its length and quality) and on how busy the service is; there is no fixed time.',
    terms.stage === 'draft'
      ? `This clip is a draft: the quick 480p take. Its final is the same take made again at 1080p, from the button on the version card${terms.finalKrw ? ` (${creditsOf(terms.finalKrw)} credits)` : ''}. A version with changes made inside a draft comes out as a plain 480p clip that cannot become a final; to get a final with the change, make the final first and change that.`
      : terms.stage === 'final'
        ? 'This clip is a final (1080p). A new version keeps that quality.'
        : 'A new version keeps this clip’s quality.',
    'Cutting a part or making the clip shorter is done in the editing studio, for free.',
    terms.length.changeable ? `Made again, the clip can be ${terms.length.min} to ${terms.length.max} seconds long.` : 'This clip’s length cannot be changed here.',
    'The studio adds no background music and cannot add or change music here.',
    `Pictures (a logo, a product, a person's own photo) can be attached with the + button under the message box: up to ${terms.picturesMax} pictures and ${terms.videosMax} videos for one version.`,
    'A real, named person (a celebrity or public figure) cannot be put in a clip.',
  ];
  return {
    credits_remaining: terms.remainingCredits,
    in_place: { possible: terms.edit.available, credits: terms.edit.available ? creditsOf(terms.edit.estimateKrw) : null, why_not: terms.edit.available ? null : WHY_NOT[terms.edit.problem ?? 'unsupported'] },
    again: {
      possible: terms.reshoot.available,
      credits: terms.reshoot.available ? creditsOf(terms.reshoot.estimateKrw) : null,
      credits_by_seconds: table,
      why_not: terms.reshoot.available ? null : WHY_NOT[terms.reshoot.problem ?? 'unsupported'],
    },
    shown: shown ? { way: wayWord(shown.way), credits: shown.estimateKrw > 0 ? creditsOf(shown.estimateKrw) : null } : null,
    length: {
      current_seconds: terms.length.current,
      can_lengthen: terms.length.changeable && terms.reshoot.available && (terms.length.current ?? 0) < terms.length.max,
      max_seconds: terms.length.changeable ? terms.length.max : null,
      shorten: 'in the editing studio, free',
    },
    this_clip: terms.stage,
    final: { credits: terms.finalKrw ? creditsOf(terms.finalKrw) : null },
    rules,
  };
}

/* ------------------------------------------------------------------ the reading */

export interface TalkReadingInput {
  message: string;
  turns: readonly ReviseTurn[];
  sheet: ReviseSheet;
  questions: readonly ReviseQuestion[];
  answering: { question: string; option?: string; decide?: boolean } | null;
  attached: { pictures: number; videos: number; marks: Array<{ n: number; what: string | null }> };
  clip: ClipReading | null;
  madeWith: string;
  history: string[];
  facts: TalkFacts;
  /** Set only on the retry after a broken rule. */
  correction?: string;
}

/** The reading as the server takes it: shape-checked, trimmed; never trusted for spending. */
export interface TalkReading {
  kind: StudioTalkKind;
  reply: string;
  sheet: ReviseSheet;
  way: 'in_place' | 'again' | 'none';
  question: { point: string; text: string; options: string[] } | null;
  length: { action: 'none' | 'longer' | 'shorter'; seconds: number | null };
  impossible: boolean;
}

const oneLine = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

function inventoryForReading(i: ClipInventory) {
  return {
    people: i.people,
    people_note: i.peopleNote,
    product: i.product,
    product_colours: i.productColours,
    mark: i.mark,
    background: i.background,
    light: i.light,
    music: i.music,
    speech: i.speech,
    text_on_screen: i.textOnScreen,
  };
}

/** The clip as the reading sees it: no base64, no blueprint extras. */
function clipForReading(clip: ClipReading | null) {
  if (!clip) return null;
  const s: FilmSheet = clip.sheet;
  return {
    seconds: s.seconds,
    aspect: s.aspect,
    shots: s.shots.map((x) => ({ start: x.start, end: x.end, framing: x.framing, camera: x.camera, action: x.action })),
    look: s.look,
    audio: s.audio,
    summary: s.summary,
    inventory: inventoryForReading(clip.inventory),
  };
}

export function talkPayload(input: TalkReadingInput): Record<string, unknown> {
  return {
    clip: clipForReading(input.clip),
    madeWith: input.madeWith.slice(0, MADE_WITH_MAX),
    history: input.history,
    conversation: [...input.turns.map((t) => ({ from: t.role, text: t.text })), { from: 'customer', text: input.message }],
    sheet: input.sheet,
    questions: input.questions.map((q) => ({ point: q.point, question: q.question, options: q.options, answer: q.answer, ...(q.skipped ? { skipped: true } : {}) })),
    questionsLeft: Math.max(0, SHEET_LIMITS.questionsMax - input.questions.length),
    answering: input.answering,
    attached: input.attached,
    facts: input.facts,
    ...(input.correction ? { correction: input.correction } : {}),
  };
}

/** The model's JSON as a reading, or null when it is not the shape the server can use. */
export function cleanReading(raw: unknown): TalkReading | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  if (typeof r.kind !== 'string' || !(STUDIO_TALK_KINDS as readonly string[]).includes(r.kind)) return null;
  const reply = typeof r.reply === 'string' ? r.reply.replace(/[ \t]+/g, ' ').trim().slice(0, SHEET_LIMITS.replyMax).trim() : '';
  const q = r.question as { point?: unknown; text?: unknown; options?: unknown } | undefined;
  let question: TalkReading['question'] = null;
  if (q && typeof q === 'object') {
    const point = oneLine(q.point, SHEET_LIMITS.pointMax);
    const text = oneLine(q.text, SHEET_LIMITS.questionMax);
    const options: string[] = [];
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const option = oneLine(o, SHEET_LIMITS.optionMax);
      if (option && !options.some((x) => x.toLowerCase() === option.toLowerCase())) options.push(option);
    }
    if (point && text && options.length >= SHEET_LIMITS.optionsMin) question = { point, text, options: options.slice(0, SHEET_LIMITS.optionsMax) };
  }
  // A reply may be empty only when it carries a question (the question is then the whole message).
  if (!reply && !question) return null;
  const l = r.length as { action?: unknown; seconds?: unknown } | undefined;
  const action = l && (l.action === 'longer' || l.action === 'shorter') ? l.action : 'none';
  const seconds = l && typeof l.seconds === 'number' && Number.isFinite(l.seconds) ? Math.round(l.seconds) : null;
  return {
    kind: r.kind as StudioTalkKind,
    reply,
    sheet: cleanSheet(r.sheet),
    way: r.way === 'in_place' || r.way === 'again' ? r.way : 'none',
    question,
    length: { action, seconds },
    impossible: r.impossible === true,
  };
}

export type TalkReadOutcome =
  | { ok: true; reading: TalkReading; ms: number }
  | { ok: false; why: 'no_key' | 'failed' | 'shape'; ms: number };

/** One try. `opts` other than the budget exist for the eval (scripts/revise-dialogue-eval.ts). */
export async function readTalk(deps: IntelDeps, input: TalkReadingInput, opts: { thinking?: 'LOW' | 'MEDIUM'; timeoutMs?: number } = {}): Promise<TalkReadOutcome> {
  const started = Date.now();
  const config = studioGeminiConfig(deps.env);
  if (!config) return { ok: false, why: 'no_key', ms: 0 };
  try {
    const raw = await callGeminiJson(config, deps.fetch, {
      system: TALK_SYSTEM,
      parts: [{ text: JSON.stringify(talkPayload(input)) }],
      schema: TALK_SCHEMA as unknown as Record<string, unknown>,
      thinking: opts.thinking ?? 'LOW',
      timeoutMs: opts.timeoutMs ?? TALK_TRIES_MS[0],
    });
    const reading = cleanReading(raw);
    return reading ? { ok: true, reading, ms: Date.now() - started } : { ok: false, why: 'shape', ms: Date.now() - started };
  } catch {
    return { ok: false, why: 'failed', ms: Date.now() - started };
  }
}

/** Changes the studio chose by itself that touch the brand's product (never allowed). */
export const choseProduct = (reading: Pick<TalkReading, 'sheet'>) => reading.sheet.change.filter((c) => c.chosen && c.about === 'product');

export interface TalkTries {
  outcome: TalkReadOutcome;
  tries: number;
  /** The first answer changed the product by its own choice (before the retry). */
  productSlip: boolean;
  ms: number;
}

/**
 * The reading with its one retry: after a failure or a timeout (12 s, then 15 s), or after an answer that
 * changed the product by the studio's own choice (then told so). Nothing reaches the customer in between.
 */
export async function readTalkWithTries(deps: IntelDeps, input: TalkReadingInput, opts: { thinking?: 'LOW' | 'MEDIUM' } = {}): Promise<TalkTries> {
  const started = Date.now();
  const first = await readTalk(deps, input, { ...opts, timeoutMs: TALK_TRIES_MS[0] });
  if (first.ok && !choseProduct(first.reading).length) return { outcome: first, tries: 1, productSlip: false, ms: Date.now() - started };
  if (!first.ok && first.why === 'no_key') return { outcome: first, tries: 1, productSlip: false, ms: 0 };
  const slip = first.ok;
  const second = await readTalk(deps, slip ? { ...input, correction: PRODUCT_CORRECTION } : input, { ...opts, timeoutMs: slip ? TALK_TRIES_MS[0] : TALK_TRIES_MS[1] });
  return { outcome: second, tries: 2, productSlip: slip, ms: Date.now() - started };
}

/* ------------------------------------------------------------------ the server's decision */

export interface SettleInput {
  /** Null: the reading failed. */
  reading: TalkReading | null;
  message: string;
  standing: { sheet: ReviseSheet; questions: ReviseQuestion[] };
  answering: { option?: number; decide?: boolean } | null;
  terms: Pick<TalkTerms, 'edit' | 'reshoot' | 'reshootAt' | 'length'>;
  shown: { way: StudioReviseMode | null; estimateKrw: number } | null;
}

export type TalkSettled = Omit<StudioReviseTalk, 'ok' | 'version' | 'clipKnown'> & {
  /** For the eval and logs only: the reading named another way than the server chose. */
  wayAgrees: boolean;
  /** For the eval and logs only: what the server took out of the reply or the sheet. */
  dropped: { parroting: boolean; questionTwice: boolean; productChoices: number };
};

/** Sentences of `reply` that name a credit figure the facts never gave are taken out (a wrong price is never shown). */
export function guardCredits(reply: string, allowed: ReadonlySet<number>): string {
  const sentences = reply.match(/[^.!?。？！]+[.!?。？！]?/g) ?? [reply];
  const kept = sentences.filter((s) => {
    const figures = [
      ...[...s.matchAll(/(\d[\d,]*)\s*(?:크레딧|credits?)/gi)].map((m) => Number(m[1]!.replace(/,/g, ''))),
      ...[...s.matchAll(/(?:크레딧|credits?)\s*(?:은|는|이|가|:)?\s*(\d[\d,]*)/gi)].map((m) => Number(m[1]!.replace(/,/g, ''))),
    ];
    return figures.every((n) => allowed.has(n));
  });
  return kept.join('').trim();
}

/** "크레딧은 81이 들고" -> "81크레딧이 들고": a credit figure is always written as a number with its unit. */
export function tidyCredits(reply: string): string {
  return reply.replace(/크레딧은\s*(\d[\d,]*)\s*(이|가)\s/g, '$1크레딧이 ');
}

const PARROT = /(싶으시군요|하시는군요|시는군요|원하시는군요|이해했어요|이해했습니다|드릴게요|드리겠습니다|you'?d like to|you want to|I understand|I see you)/i;
const sentencesOf = (text: string) => (text.match(/[^.!?。？！]+[.!?。？！]?/g) ?? []).map((s) => s.trim()).filter(Boolean);

/**
 * A question turn as one message: what this message settled (one short clause, only when the sheet's
 * changes moved), then the question, said once. A clause that restates the request, sounds done while it
 * is open, or asks something itself is taken out.
 */
export function questionMessage(reply: string, question: string, settled: boolean): { text: string; parroting: boolean; twice: boolean } {
  let parroting = false;
  let twice = false;
  const kept: string[] = [];
  if (settled) {
    for (const s of sentencesOf(reply)) {
      if (/[?？]$/.test(s) || s.includes(question) || question.includes(s)) {
        twice = true;
        continue;
      }
      if (PARROT.test(s)) {
        parroting = true;
        continue;
      }
      kept.push(s);
      break;
    }
  } else if (reply.trim()) {
    parroting = sentencesOf(reply).some((s) => PARROT.test(s));
    twice = sentencesOf(reply).some((s) => /[?？]$/.test(s));
  }
  return { text: [...kept, question].join(' ').trim(), parroting, twice };
}

/** The server's own withdrawal of one line of the sheet (the line's remove control; no reading). */
/**
 * The sheet without one change, and without what that change put into "leave out" or "keep" (taking back
 * "꽃잎 빼기" also takes "꽃잎" out of what must not appear).
 */
export function withoutChange(sheet: ReviseSheet, index: number): ReviseSheet {
  const gone = sheet.change[index];
  if (!gone) return sheet;
  const k = (t: string) => t.replace(/\s+/g, '').toLowerCase();
  const touched = (item: string) => k(gone.text).includes(k(item)) || k(item).includes(k(gone.text));
  return { change: sheet.change.filter((_, i) => i !== index), keep: sheet.keep, exclude: sheet.exclude.filter((x) => !touched(x)) };
}

export function settleRemoval(input: Omit<SettleInput, 'reading' | 'message' | 'answering'> & { index: number }): TalkSettled {
  const { standing, terms } = input;
  const sheet = withoutChange(standing.sheet, input.index);
  const open = { edit: terms.edit.available, reshoot: terms.reshoot.available };
  const way = wayForSheet(sheet, open);
  const seconds = lengthOfSheet(sheet);
  const estimateKrw = way === 'edit' ? terms.edit.estimateKrw : way === 'reshoot' ? (seconds !== null && terms.reshootAt ? terms.reshootAt(seconds) : terms.reshoot.estimateKrw) : 0;
  const opened = openQuestion(standing.questions);
  return {
    kind: 'withdraw',
    reply: null,
    sheet,
    questions: standing.questions.map((q) => ({ ...q, options: [...q.options] })),
    open: opened,
    way,
    estimateKrw,
    seconds,
    canMake: way !== null && hasChange(sheet) && opened === null,
    impossible: false,
    editStudio: false,
    changed: input.shown ? { way: input.shown.way !== way, credits: input.shown.estimateKrw !== estimateKrw } : { way: false, credits: false },
    wayAgrees: true,
    dropped: { parroting: false, questionTwice: false, productChoices: 0 },
  };
}

export function settleTalk(input: SettleInput, allowedCredits: ReadonlySet<number> = new Set()): TalkSettled {
  const { reading, standing, terms } = input;
  const questions = standing.questions.map((q) => ({ ...q, options: [...q.options] }));
  const opened = openQuestion(questions);
  const priceOf = (sheet: ReviseSheet, way: StudioReviseMode | null) => {
    if (way === 'edit') return terms.edit.estimateKrw;
    if (way !== 'reshoot') return 0;
    const seconds = lengthOfSheet(sheet);
    return seconds !== null && terms.reshootAt ? terms.reshootAt(seconds) : terms.reshoot.estimateKrw;
  };
  const open = { edit: terms.edit.available, reshoot: terms.reshoot.available };
  const changedFrom = (way: StudioReviseMode | null, krw: number) =>
    input.shown ? { way: input.shown.way !== way, credits: input.shown.estimateKrw !== krw } : { way: false, credits: false };
  const dropped = { parroting: false, questionTwice: false, productChoices: 0 };

  if (!reading) {
    // Nothing was read: the sheet, the questions and the open question stay; no button until it is read.
    const way = wayForSheet(standing.sheet, open);
    const krw = priceOf(standing.sheet, way);
    return {
      kind: null, reply: null, sheet: standing.sheet, questions, open: opened, way, estimateKrw: krw, seconds: lengthOfSheet(standing.sheet),
      canMake: false, impossible: false, editStudio: false, changed: changedFrom(way, krw), failed: true, wayAgrees: true, dropped,
    };
  }

  let kind: StudioTalkKind = reading.kind;
  // The open question: a pressed choice or a reply read as an answer is its answer; anything else leaves it skipped.
  if (opened !== null) {
    const q = questions[opened]!;
    if (input.answering || kind === 'answer') {
      const option = input.answering?.option !== undefined ? q.options[input.answering.option] : undefined;
      q.answer = (option ?? input.message).trim().slice(0, SHEET_LIMITS.turnMax) || q.answer;
      if (input.answering?.decide) q.decided = true;
      kind = 'answer';
    } else {
      q.skipped = true;
    }
  } else if (kind === 'answer') {
    // An "answer" with no question open is a change in its own right.
    kind = 'change';
  }

  let sheet: ReviseSheet;
  let impossible = reading.impossible;
  let editStudio = reading.length.action === 'shorter';
  if (kind === 'confirm' || kind === 'tool_question' || kind === 'unreadable' || kind === 'not_possible') {
    sheet = standing.sheet;
  } else if (kind === 'withdraw') {
    sheet = !hasChange(standing.sheet) ? standing.sheet : onlyRemoved(standing.sheet, reading.sheet) ? reading.sheet : withoutChange(standing.sheet, standing.sheet.change.length - 1);
  } else {
    sheet = reading.sheet;
  }

  // The brand's product is never changed by the studio's own choice (the reading was retried once already).
  const slips = sheet.change.filter((c) => c.chosen && c.about === 'product');
  if (slips.length) {
    dropped.productChoices = slips.length;
    sheet = { ...sheet, change: sheet.change.filter((c) => !(c.chosen && c.about === 'product')) };
  }

  // Length is never booked as anything else: a longer clip only within what a remake of this clip can take;
  // shorter (or the same) never; and at most one length item.
  const lengths = sheet.change.filter((c) => c.kind === 'length');
  if (lengths.length) {
    const keepLast = lengths[lengths.length - 1]!;
    const s = keepLast.seconds ?? null;
    const current = terms.length.current;
    const fits = s !== null && terms.length.changeable && open.reshoot && s >= terms.length.min && s <= terms.length.max && (current === null || s > current);
    if (s !== null && current !== null && s <= current) editStudio = true;
    if (!fits) impossible = true;
    sheet = { ...sheet, change: sheet.change.filter((c) => c.kind !== 'length' || (fits && c === keepLast)) };
  }

  // One question at a time, three in all, never the same point twice; never while confirming or answering a tool question.
  let openNow: number | null = null;
  const q = reading.question;
  const asking = q && kind !== 'confirm' && kind !== 'tool_question' && kind !== 'withdraw';
  if (asking && questions.length < SHEET_LIMITS.questionsMax && !questions.some((x) => samePoint(x.point, q.point))) {
    questions.push({ point: q.point, question: q.text, options: q.options, answer: null });
    openNow = questions.length - 1;
  }

  const way = wayForSheet(sheet, open);
  const estimateKrw = priceOf(sheet, way);
  const seconds = lengthOfSheet(sheet);
  const canMake = way !== null && hasChange(sheet) && openNow === null && kind !== 'unreadable';
  const allowed = new Set<number>([...allowedCredits, creditsOf(estimateKrw)]);
  let reply = tidyCredits(guardCredits(reading.reply, allowed) || reading.reply.replace(/\d[\d,]*\s*(?:크레딧|credits?)/gi, '').trim());
  if (openNow !== null) {
    const message = questionMessage(reply, questions[openNow]!.question, changesDiffer(standing.sheet, sheet));
    reply = message.text;
    dropped.parroting = message.parroting;
    dropped.questionTwice = message.twice;
  }
  if (!reply) {
    // A reply emptied by the guards and no question to stand for it: nothing truthful to show.
    return { ...settleTalk({ ...input, reading: null }), wayAgrees: true, dropped };
  }
  return {
    kind,
    reply,
    sheet,
    questions,
    open: openNow,
    way,
    estimateKrw,
    seconds,
    canMake,
    impossible,
    editStudio,
    changed: changedFrom(way, estimateKrw),
    wayAgrees: reading.way === wayWord(way),
    dropped,
  };
}

/** Every credit figure the facts carry (a reply may name these and no others). */
export function factCredits(facts: TalkFacts): Set<number> {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (typeof n === 'number' && Number.isFinite(n)) out.add(n);
  };
  add(facts.in_place.credits);
  add(facts.again.credits);
  add(facts.final.credits);
  add(facts.shown?.credits);
  add(facts.credits_remaining);
  for (const v of Object.values(facts.again.credits_by_seconds ?? {})) add(v);
  return out;
}

/* ------------------------------------------------------------------ the operation */

function remakePriceAt(recipe: RevisionRecipe): ((seconds: number) => number) | null {
  const run = recipe.recipeJob;
  const model = run ? (studioModel(run.model) as StudioVideoModel | null) : null;
  if (!run || !model || model.medium !== 'video') return null;
  const resolution = revisionResolution(recipe, model);
  return (seconds: number) => usageKrw(videoRunUsd({ resolution, seconds }), 'video');
}

export async function talkStudioRevise(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioReviseTalk | StudioFailure> {
  if (!deps.env.reviseV2) return failure('invalid');
  const parsed = ReviseTalkSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const locale: 'ko' | 'en' = viewer.locale === 'en' ? 'en' : 'ko';
  const now = deps.now?.() ?? new Date();
  const ready = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const allowance = await loadAllowance(sql, v.organizationId, deps.env, now);
      if (allowance.capKrw <= 0) throw new StudioDenied('allowance_closed');
      const recipe = await loadRevisionRecipe(sql, v.organizationId, v.outputId);
      // Only a turn that reads something takes a slot of the per-minute cap: a message, or an opening call
      // that has to read the clip. An opening call on a clip already read, and a line's removal, are free.
      const reads = v.remove === undefined && (Boolean(v.message) || !storedClip(recipe.baseJob, v.outputId, locale));
      if (reads && !takeFreeIntelSlot(`revise:${v.organizationId}`, FREE_INTEL_LIMITS.revisePerMinute, now.getTime())) throw new StudioDenied('too_many_running');
      await resolveAdded(sql, v.organizationId, v.references, deps.media, locale);
      const request = { prompt: v.message || 'x', references: [...v.references], marks: v.marks };
      const edit = await editWay(sql, v.organizationId, recipe, { ...request, mode: 'edit' }, deps.media, locale);
      const reshoot = await reshootWay(sql, v.organizationId, recipe, { ...request, mode: 'reshoot' }, deps.media, locale);
      if (!edit.ok && !reshoot.ok) throw new StudioDenied('invalid');
      return { recipe, edit, reshoot, allowance };
    }),
  );
  if ('ok' in ready) return ready;
  const { recipe, edit, reshoot, allowance } = ready;
  const model = studioModel(recipe.baseJob.model) as StudioVideoModel | null;
  const length = reshootLength(recipe);
  const terms: TalkTerms = {
    edit: edit.ok ? { available: true, estimateKrw: edit.plan.estimateKrw } : { available: false, estimateKrw: 0, problem: edit.problem },
    reshoot: reshoot.ok ? { available: true, estimateKrw: reshoot.plan.estimateKrw } : { available: false, estimateKrw: 0, problem: reshoot.problem },
    reshootAt: length.changeable ? remakePriceAt(recipe) : null,
    length,
    stage: recipe.base.isFinal ? 'final' : recipe.base.isDraft ? 'draft' : 'plain',
    finalKrw: recipe.base.isDraft && model ? finalPrice({ params: recipe.baseJob.params, draftDurationMs: recipe.base.seconds !== null ? recipe.base.seconds * 1000 : null, model }).krw : null,
    remainingCredits: creditsLeft(allowance.capKrw, allowance.usedKrw),
    picturesMax: STUDIO_LIMITS.referencesMax - 1,
    videosMax: STUDIO_REVISE_MATERIALS_MAX,
  };
  const standing = { sheet: cleanSheet(v.sheet), questions: v.questions };
  const base = { ok: true as const, version: recipe.nextVersion };
  const strip = ({ wayAgrees: _w, dropped: _d, ...rest }: TalkSettled) => rest;

  // A line's remove control: the server takes it out; nothing is read.
  if (v.remove !== undefined) {
    if (v.remove >= standing.sheet.change.length) return failure('invalid');
    return { ...base, clipKnown: Boolean(recipe.baseJob.params?.clipSheets), ...strip(settleRemoval({ standing, terms, shown: v.shown, index: v.remove })) };
  }

  const clip = await clipFor(deps, { organizationId: v.organizationId, job: recipe.baseJob, outputId: v.outputId, locale, read: !v.message });
  if (!v.message) {
    const way = wayForSheet(standing.sheet, { edit: terms.edit.available, reshoot: terms.reshoot.available });
    const settled = settleTalk({ reading: null, message: '', standing, answering: null, terms, shown: v.shown });
    const { failed: _f, ...rest } = strip(settled);
    return { ...base, clipKnown: Boolean(clip), ...rest, way, canMake: way !== null && hasChange(standing.sheet) && openQuestion(v.questions) === null };
  }
  const facts = talkFacts(terms, v.shown);
  const opened = openQuestion(v.questions);
  const answering =
    opened !== null && v.answering
      ? {
          question: v.questions[opened]!.question,
          ...(v.answering.option !== undefined && v.questions[opened]!.options[v.answering.option] ? { option: v.questions[opened]!.options[v.answering.option]! } : {}),
          ...(v.answering.decide ? { decide: true } : {}),
        }
      : null;
  const read = await readTalkWithTries(deps.intelDeps, {
    message: v.message,
    turns: v.turns,
    sheet: standing.sheet,
    questions: v.questions,
    answering,
    attached: { pictures: v.references.length, videos: v.materials, marks: v.marks.map((m, i) => ({ n: i + 1, what: m.what ?? m.label ?? null })) },
    clip,
    madeWith: recipe.madeWith,
    history: recipe.history.map((h) => withClarified(replaceMarks(h.request, h.marks ?? []), h.clarified)),
    facts,
  });
  const settled = settleTalk(
    {
      reading: read.outcome.ok ? read.outcome.reading : null,
      message: v.message,
      standing,
      answering: opened !== null ? (v.answering ?? null) : null,
      terms,
      shown: v.shown,
    },
    factCredits(facts),
  );
  return { ...base, clipKnown: Boolean(clip), ...strip(settled) };
}
