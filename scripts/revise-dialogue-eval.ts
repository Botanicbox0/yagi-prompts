/**
 * Live evaluation of the revise conversation (lib/brand-studio/revision/talk.ts, docs/BRAND-STUDIO-VIDEO-REMIX.md
 * §3, flag `BRAND_STUDIO_REVISE_V2`). Scripted multi-turn conversations about two real clips are read by the
 * real model exactly as `revise.talk` reads them (`readTalk`), and the server's own rule (`settleTalk`) decides
 * the way, the credits and the button. Nothing is generated and nothing is spent but the readings.
 *
 *   npx tsx scripts/revise-dialogue-eval.ts <env-file> --out <dir> [--runs 2] [--thinking LOW|MEDIUM]
 *       [--only A05,N09] [--cap 600] [--concurrency 4] [--timeout 30000 (measuring only)]
 *   npx tsx scripts/revise-dialogue-eval.ts <env-file> --read-clips <bottle.mp4> <montage.mp4>
 *       (reads the two clips once and writes scripts/fixtures/revise-dialogue-clips.json)
 *
 * - Reads ONLY `GEMINI_API_KEY` (and `GEMINI_BASE_URL`) from <env-file>, inside this process. The key is never
 *   printed or written; every string that leaves the process is scrubbed of it.
 * - The model is the studio default (`gemini-4-hydrogen`); a request for any other model stops the run.
 * - Writes <dir>/revise-dialogue-eval.md (every turn verbatim, then the pass table) and <dir>/revise-dialogue-eval.json.
 * - Checks per turn are mechanical (button, question, kind, sheet contents, language, internal words, credit
 *   figures). Whether a reply restates the change well is read by a person in the transcript.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { FilmSheet, StudioTalkKind } from '@/lib/brand-studio/contracts';
import { studioGeminiConfig } from '@/lib/brand-studio/enhancer/gemini';
import { readFilm } from '@/lib/brand-studio/film-sheet';
import { studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { creditsOf } from '@/lib/brand-studio/credits';
import { billedResolution, remixRunUsd, usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import {
  factCredits,
  readTalk,
  settleTalk,
  talkFacts,
  type TalkSettled,
  type TalkTerms,
} from '@/lib/brand-studio/revision/talk';
import { emptySheet, openQuestion, type ReviseQuestion, type ReviseSheet, type ReviseTurn } from '@/lib/brand-studio/revision/sheet';

const EXPECTED_MODEL = 'gemini-4-hydrogen';
const FIXTURE = join(process.cwd(), 'scripts', 'fixtures', 'revise-dialogue-clips.json');

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
const scrub = (text: string) => (SECRET ? text.split(SECRET).join('[key]') : text);
const say = (text: string) => process.stdout.write(scrub(text) + '\n');

const state = { calls: 0, cap: 600, stop: '' };
interface Usage { ms: number; input: number; output: number; thinking: number }

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Checks the model, counts calls against the cap and reads each answer's token usage. */
function meteredFetch(onUsage: (u: Omit<Usage, 'ms'>) => void): typeof fetch {
  return async (input, init) => {
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
    try {
      const body = (await response.clone().json()) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
      const u = body.usageMetadata ?? {};
      onUsage({ input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0 });
    } catch {
      // No usage on a failed answer.
    }
    return response;
  };
}

/* ------------------------------------------------------------------ the two clips */

interface ClipFixture {
  reading: FilmSheet;
  madeWith: string;
}
type ClipName = 'bottle' | 'montage';

/** What the two seeded clips were made from (the bottle's is the studio's own final prompt of that run). */
const MADE_WITH: Record<ClipName, string> = {
  bottle:
    'Visual style: Deep sapphire shadow floor, crisp ivory white petals and translucent cobalt glass accented by cool silver mirror reflections. Soft, diffused blue light from camera-left. Shot on a 50mm prime lens with shallow depth of field. 0.0s–5.0s: Off-axis low-angle medium-close shot of the heart-shaped blue YAGI perfume bottle resting among scattered white flower petals in front of an oval mirror. The camera executes a slow, steady dolly-in toward the bottle, drawing focus onto the heart-shaped glass facets and YAGI label. Audio: quiet room ambience, no music.',
  montage:
    'Five quick shots, 0.0s–5.0s, soft blue studio light: a woman lies on white pearls among blue heart-shaped YAGI perfume bottles; the blue YAGI bottle on pearls in front of blurred bottles; a blonde woman lies on her side on pearls with a white ribbon; a dark-haired woman rests the bottle against her cheek, eyes closed; a woman with braided hair holds the bottle near her lips. Audio: no music.',
};

/** The clips' ways and prices exactly as the server works them out for a 5 s 480p draft made by Seedance 2.5. */
function termsFor(): TalkTerms {
  const model = studioModel('seedance-2.5') as StudioVideoModel;
  const editUsd = remixRunUsd({ model, resolution: billedResolution('draft'), method: 'edit', seconds: null, referenceSeconds: 5, referenceMs: 5000 }).usd;
  const at = (s: number) => usageKrw(videoRunUsd({ resolution: 'draft', seconds: s }), 'video');
  return {
    edit: { available: true, estimateKrw: usageKrw(editUsd, 'video') },
    reshoot: { available: true, estimateKrw: at(5) },
    reshootAt: at,
    length: { current: 5, min: model.minSeconds, max: model.maxSeconds, changeable: true },
    stage: 'draft',
    finalKrw: usageKrw(videoRunUsd({ resolution: '1080p', seconds: 5 }), 'video'),
    remainingCredits: 29_741,
    picturesMax: 8,
    videosMax: 2,
  };
}

/* ------------------------------------------------------------------ the cases */

type Category = 'clear' | 'missing' | 'taste' | 'nonrequest' | 'limit' | 'misfit' | 'open' | 'followup';
interface Expect {
  make?: boolean;
  asks?: boolean;
  /** Either a question or a concrete proposal with a button (never neither). */
  askOrPropose?: boolean;
  kinds?: StudioTalkKind[];
  has?: RegExp[];
  lacks?: RegExp[];
  keepHas?: RegExp[];
  changeCount?: number;
  way?: 'edit' | 'reshoot' | null;
  seconds?: number | null;
  editStudio?: boolean;
  impossible?: boolean;
  replyHas?: RegExp[];
  /** The open question was paired with this answer text. */
  answered?: string;
}
interface Step {
  say: string;
  answering?: { option?: number; decide?: boolean };
  attachPictures?: number;
  category: Category;
  expect: Expect;
}
interface Case {
  id: string;
  group: 'audit' | 'english' | 'attack';
  clip: ClipName;
  history?: string[];
  steps: Step[];
}

const RAMBLE =
  '어제 팀 회의에서 이 영상 얘기가 나왔는데요, 다들 전반적으로는 괜찮다고 했어요. 마케팅 팀장님은 요즘 향수 광고가 다 비슷비슷해서 우리 것도 너무 튀지 않는 게 낫겠다고 하셨고, 디자인 팀은 파란색이 브랜드 색이랑 잘 맞는다고 좋아했어요. 저도 처음 봤을 때 꽃잎이 흩어져 있는 느낌이 예뻤고요. 대표님은 아직 못 보셨는데 아마 괜찮다고 하실 것 같아요. 다만 한 가지, 뒤에 있는 둥근 거울 테두리가 좀 밋밋해 보인다는 말이 있어서 그 테두리만 은은한 금색으로 바꿔 보면 어떨까 싶어요. 나머지는 손대지 말아 주세요. 아 그리고 다음 주에 인스타 릴스로 올릴 예정이라 세로 버전도 언젠가 필요할 것 같은데 그건 나중에 따로 말씀드릴게요. 혹시 금색이 너무 튀면 말씀해 주세요, 그럼 다른 방법을 생각해 볼게요. 바쁘실 텐데 늘 감사합니다!';
const LONG =
  '이번 주 금요일에 신제품 런칭 행사가 있어서 이 영상을 메인 화면에 띄울 예정이에요. 행사장 조명이 꽤 어두운 편이라 화면이 너무 밝으면 눈이 부시다는 의견이 있었고, 반대로 너무 어두우면 병이 안 보인다는 의견도 있었어요. 여러 의견을 정리해 보면 결국 세 가지예요. 첫째, 배경을 지금보다 깊은 남색으로 바꿔서 병의 파란색이 더 또렷하게 보이게 해 주세요. 둘째, 꽃잎은 행사 콘셉트와 맞지 않는다는 얘기가 많아서 이번에는 빼 주세요. 셋째, 카메라가 병 쪽으로 다가가는 속도를 지금보다 조금 더 천천히 해 주세요. 행사장에서 반복 재생될 거라 너무 빠르면 정신없어 보일 것 같아요. 병 모양이나 YAGI 글자는 절대 바뀌면 안 되고, 거울은 있어도 괜찮아요. 참고로 행사장 스크린은 가로형이라 비율은 지금 그대로 쓰면 돼요. 소리는 원래 없는 영상이라 신경 쓰지 않으셔도 돼요. 전체적으로는 지금 분위기가 마음에 들어서 크게 바꾸고 싶지는 않고, 위의 세 가지만 반영되면 충분할 것 같아요. 혹시 세 가지를 한 번에 하는 게 어렵다면 어떤 것부터 하면 좋을지 알려 주세요. 행사 준비로 정신이 없어서 메시지가 길어졌네요. 확인 부탁드려요.';

const S = (say: string, category: Category, expect: Expect, extra: Partial<Step> = {}): Step => ({ say, category, expect, ...extra });
const NON: Expect = { make: false };

export const CASES: Case[] = [
  // The audit's twenty, with their follow-ups.
  { id: 'A01', group: 'audit', clip: 'bottle', steps: [S('병 라벨 색을 파란색으로 바꿔줘', 'clear', { make: true, has: [/라벨|YAGI|글자|로고/] })] },
  { id: 'A01v2', group: 'audit', clip: 'bottle', history: ['병 라벨 색을 파란색으로'], steps: [S('색은 좋은데 라벨 글자가 뭉개졌어', 'clear', { make: true, has: [/글자|라벨|YAGI|로고/] })] },
  { id: 'A02', group: 'audit', clip: 'bottle', steps: [S('카메라가 더 천천히 다가가게 해줘', 'clear', { make: true, way: 'reshoot', has: [/카메라|천천히/] })] },
  { id: 'A03', group: 'audit', clip: 'bottle', steps: [S('마지막 1초는 잘라줘', 'limit', { make: false, editStudio: true, replyHas: [/편집 스튜디오/] })] },
  { id: 'A04', group: 'audit', clip: 'bottle', steps: [S('배경을 해 질 녘 바다로 바꾸고 카메라 움직임은 그대로 둬', 'clear', { make: true, has: [/바다|노을|해 질/], keepHas: [/카메라/] })] },
  {
    id: 'A05', group: 'audit', clip: 'bottle', steps: [
      S('좀 더 고급스럽게', 'taste', { make: true, asks: false }),
      S('아니 그게 아니라 조명만 따뜻하게', 'followup', { make: true, kinds: ['correction', 'change'], has: [/조명|빛/], changeCount: 1 }),
    ],
  },
  { id: 'A06', group: 'audit', clip: 'bottle', steps: [S('느낌이 별로야. 다시', 'open', { askOrPropose: true })] },
  {
    id: 'A07', group: 'audit', clip: 'bottle', steps: [
      S('더 밝게', 'taste', { make: true, asks: false }),
      S('응 그렇게 해줘', 'followup', { make: true, kinds: ['confirm'] }),
    ],
  },
  {
    id: 'A08', group: 'audit', clip: 'bottle', steps: [
      S('속도 조절해줘', 'missing', { asks: true, make: false }),
      S('', 'followup', { make: true, way: 'reshoot', kinds: ['answer'] }, { answering: { option: 1 } }),
    ],
  },
  {
    id: 'A09', group: 'audit', clip: 'bottle', steps: [
      S('배경 바꿔줘', 'missing', { asks: true, make: false }),
      S('눈 오는 서울 골목', 'followup', { make: true, kinds: ['answer'], has: [/눈|서울|골목/], answered: '눈 오는 서울 골목' }),
    ],
  },
  {
    id: 'A10', group: 'audit', clip: 'bottle', steps: [
      S('로고 넣어줘', 'missing', { asks: true, make: false }),
      S('이 로고로', 'followup', { make: true, has: [/로고|이미지 1|1번/] }, { attachPictures: 1 }),
    ],
  },
  { id: 'A11', group: 'audit', clip: 'bottle', steps: [S('처음 부분만 수정해줘', 'missing', { asks: true, make: false })] },
  { id: 'A12', group: 'audit', clip: 'bottle', steps: [S('이거 말고 다른 걸로', 'missing', { asks: true, make: false })] },
  { id: 'A13', group: 'audit', clip: 'bottle', steps: [S('그대로 두고 완전히 다르게 해줘', 'missing', { asks: true, make: false })] },
  { id: 'A14', group: 'audit', clip: 'bottle', steps: [S('배경은 바다로, 모델은 그대로, 음악은 빼고, 길이는 두 배로', 'clear', { make: true, way: 'reshoot', seconds: 10, has: [/바다/] })] },
  { id: 'A15', group: 'audit', clip: 'bottle', steps: [S('여자 모델로 바꿔줘', 'misfit', { make: false, replyHas: [/인물|사람|모델/] })] },
  { id: 'A16', group: 'audit', clip: 'bottle', steps: [S('ㅇㅇ', 'nonrequest', NON)] },
  { id: 'A17', group: 'audit', clip: 'bottle', steps: [S(RAMBLE, 'clear', { make: true, has: [/거울|테두리|금색/], lacks: [/세로/] })] },
  { id: 'A18', group: 'audit', clip: 'bottle', steps: [S('이거 수정하면 크레딧 얼마나 들어?', 'nonrequest', { make: false, kinds: ['tool_question'], replyHas: [/\d+\s*크레딧/] })] },
  { id: 'A19', group: 'audit', clip: 'bottle', steps: [S('초안이랑 완성본이 뭐가 달라?', 'nonrequest', { make: false, kinds: ['tool_question'], replyHas: [/1080|완성본/] })] },
  { id: 'A20', group: 'audit', clip: 'bottle', steps: [S('방금 그거 취소', 'nonrequest', { make: false })] },
  // The English four.
  { id: 'E05', group: 'english', clip: 'bottle', steps: [S('Make it more premium', 'taste', { make: true, asks: false })] },
  {
    id: 'E09', group: 'english', clip: 'bottle', steps: [
      S('Change the background', 'missing', { asks: true, make: false }),
      S('a snowy alley in Seoul', 'followup', { make: true, kinds: ['answer'], has: [/snow|Seoul|alley/i], answered: 'a snowy alley in Seoul' }),
    ],
  },
  { id: 'E13', group: 'english', clip: 'bottle', steps: [S('Keep it as it is but make it completely different', 'missing', { asks: true, make: false })] },
  { id: 'E18', group: 'english', clip: 'bottle', steps: [S('How many credits would this edit cost?', 'nonrequest', { make: false, kinds: ['tool_question'], replyHas: [/\d+\s*credits?/i] })] },
  // New conversations written to attack the contract.
  { id: 'N01', group: 'attack', clip: 'bottle', steps: [S('로고를 조금 더 크게 해줘', 'clear', { make: true, has: [/로고|YAGI|글자/] })] },
  { id: 'N02', group: 'attack', clip: 'bottle', steps: [S('꽃잎을 빼줘', 'clear', { make: true })] },
  { id: 'N03', group: 'attack', clip: 'bottle', steps: [S('조명을 조금 더 따뜻하게', 'clear', { make: true, has: [/조명|빛/] })] },
  { id: 'N04', group: 'attack', clip: 'bottle', steps: [S('카메라를 고정해줘', 'clear', { make: true, way: 'reshoot' })] },
  { id: 'N05', group: 'attack', clip: 'bottle', steps: [S('Remove the petals and make the background white', 'clear', { make: true, has: [/white|petal/i] })] },
  { id: 'N06', group: 'attack', clip: 'bottle', steps: [S('색 바꿔줘', 'missing', { asks: true, make: false })] },
  { id: 'N07', group: 'attack', clip: 'bottle', steps: [S('소품 하나 추가해줘', 'missing', { asks: true, make: false })] },
  { id: 'N08', group: 'attack', clip: 'bottle', steps: [S('텍스트 넣어줘', 'missing', { asks: true, make: false })] },
  {
    id: 'N09', group: 'attack', clip: 'bottle', steps: [
      S('배경을 하얀색으로', 'clear', { make: true, has: [/하얀|흰/] }),
      S('아니 하얀색 말고 연한 회색으로', 'followup', { make: true, kinds: ['correction', 'change'], has: [/회색/], lacks: [/하얀|흰색/], changeCount: 1 }),
    ],
  },
  {
    id: 'N10', group: 'attack', clip: 'bottle', steps: [
      S('꽃잎 빼고 배경을 바다로', 'clear', { make: true, changeCount: 2 }),
      S('꽃잎은 그냥 둬', 'followup', { make: true, kinds: ['withdraw', 'correction', 'change'], has: [/바다/], lacks: [/꽃잎/] }),
    ],
  },
  {
    id: 'N11', group: 'attack', clip: 'bottle', steps: [
      S('배경을 바다로 바꿔줘', 'clear', { make: true }),
      S('병을 조금 더 크게', 'clear', { make: true, changeCount: 2 }),
      S('방금 그거 취소', 'followup', { make: true, kinds: ['withdraw'], has: [/바다/], lacks: [/크게/], changeCount: 1 }),
    ],
  },
  {
    id: 'N12', group: 'attack', clip: 'bottle', steps: [
      S('배경 바꿔줘', 'missing', { asks: true, make: false }),
      S('아 그리고 꽃잎도 빼줘', 'followup', { has: [/꽃잎/] }),
    ],
  },
  { id: 'N13', group: 'attack', clip: 'bottle', steps: [S('이게 뭐야 진짜 별로네', 'nonrequest', NON)] },
  { id: 'N14', group: 'attack', clip: 'bottle', steps: [S('ㅋㅋ 오늘 점심 뭐 먹지', 'nonrequest', { make: false, kinds: ['unreadable'] })] },
  { id: 'N15', group: 'attack', clip: 'bottle', steps: [S('background를 좀 더 dark하게, 그리고 bottle은 keep', 'clear', { make: true, has: [/배경|background/i] })] },
  { id: 'N16', group: 'attack', clip: 'bottle', steps: [S('아이유가 향수 뿌리는 장면으로 바꿔줘', 'nonrequest', { make: false, impossible: true })] },
  { id: 'N17', group: 'attack', clip: 'bottle', steps: [S('배경 음악을 신나는 걸로 바꿔줘', 'nonrequest', { make: false, impossible: true })] },
  { id: 'N18', group: 'attack', clip: 'bottle', steps: [S(LONG, 'clear', { make: true, way: 'reshoot', has: [/남색|배경/, /꽃잎/, /카메라|천천히/] })] },
  { id: 'N19', group: 'attack', clip: 'bottle', steps: [S('영상을 10초로 늘려줘', 'clear', { make: true, way: 'reshoot', seconds: 10, replyHas: [/10\s*초/] })] },
  { id: 'N20', group: 'attack', clip: 'bottle', steps: [S('30초로 늘려줘', 'limit', { make: false, impossible: true })] },
  { id: 'N21', group: 'attack', clip: 'bottle', steps: [S('응 그렇게 해줘', 'nonrequest', NON)] },
  {
    id: 'N22', group: 'attack', clip: 'bottle', steps: [
      S('배경을 바다로 바꿔줘', 'clear', { make: true }),
      S('이거 만드는 데 얼마나 걸려?', 'followup', { make: true, kinds: ['tool_question'], replyHas: [/모르|알 수 없|알려 드리기 어려|정확히 알 수|확인할 수 없/] }),
    ],
  },
  {
    id: 'N23', group: 'attack', clip: 'bottle', steps: [
      S('배경 바꿔줘', 'missing', { asks: true, make: false }),
      S('알아서 정해 주세요', 'followup', { make: true, kinds: ['answer'], changeCount: 1 }, { answering: { decide: true } }),
    ],
  },
  {
    id: 'N24', group: 'attack', clip: 'bottle', steps: [
      S('색 바꿔줘', 'missing', { asks: true, make: false }),
      S('글쎄요', 'followup', {}),
      S('아무 색이나', 'followup', {}),
      S('음 잘 모르겠어요', 'followup', {}),
    ],
  },
  { id: 'N25', group: 'attack', clip: 'bottle', steps: [S('Make the camera push in slower', 'clear', { make: true, way: 'reshoot' })] },
  { id: 'N26', group: 'attack', clip: 'montage', steps: [S('병을 더 크게 해줘', 'open', { askOrPropose: true })] },
  { id: 'N27', group: 'attack', clip: 'montage', steps: [S('여자 모델로 바꿔줘', 'misfit', { make: false, replyHas: [/여성|여자|인물|모델/] })] },
  { id: 'N28', group: 'attack', clip: 'bottle', steps: [S('음악은 빼줘', 'misfit', { make: false })] },
  { id: 'N29', group: 'attack', clip: 'bottle', steps: [S('마지막 장면에서 카메라가 병 쪽으로 더 가까이 가게', 'clear', { make: true, way: 'reshoot' })] },
  { id: 'N30', group: 'attack', clip: 'bottle', steps: [S('배경을 바다로 바꿔줘. 그리고 이거 얼마야?', 'clear', { make: true, kinds: ['change'], replyHas: [/\d+\s*크레딧/] })] },
];

/* ------------------------------------------------------------------ running */

const INTERNAL = /\b(edit|reshoot|remake|prompt|seedance|gemini|json|token|recipe|in_place|sheet)\b|프롬프트|시댄스|제미나이|리샷|에디트|레시피|시트/i;
const HANGUL = /[가-힣]/;

interface TurnRecord {
  step: number;
  say: string;
  answering: Step['answering'] | null;
  category: Category;
  ms: number;
  tokens: Omit<Usage, 'ms'>;
  failed: boolean;
  settled: TalkSettled;
  checks: Array<{ name: string; ok: boolean; note?: string }>;
}
interface CaseRecord {
  id: string;
  group: Case['group'];
  clip: ClipName;
  run: number;
  turns: TurnRecord[];
}

function sentences(text: string): number {
  return (text.match(/[^.!?。？！]+[.!?。？！]?/g) ?? []).filter((s) => s.trim().length > 1).length;
}

function check(step: Step, s: TalkSettled, standingBefore: ReviseSheet, questionsBefore: ReviseQuestion[], shownBefore: boolean): TurnRecord['checks'] {
  const out: TurnRecord['checks'] = [];
  const e = step.expect;
  const texts = s.sheet.change.map((c) => c.text);
  const any = (re: RegExp) => texts.some((t) => re.test(t));
  const asks = s.open !== null;
  if (e.make !== undefined) out.push({ name: `button ${e.make ? 'shown' : 'absent'}`, ok: s.canMake === e.make });
  if (e.asks !== undefined) out.push({ name: e.asks ? 'asks' : 'no question', ok: asks === e.asks });
  if (e.askOrPropose) out.push({ name: 'asks or proposes', ok: asks || (s.canMake && s.sheet.change.length > 0) });
  if (e.kinds) out.push({ name: `kind ${e.kinds.join('|')}`, ok: s.kind !== null && e.kinds.includes(s.kind), note: s.kind ?? 'none' });
  for (const re of e.has ?? []) out.push({ name: `change has ${re}`, ok: any(re) });
  for (const re of e.lacks ?? []) out.push({ name: `change lacks ${re}`, ok: !any(re) });
  for (const re of e.keepHas ?? []) out.push({ name: `keep has ${re}`, ok: s.sheet.keep.some((k) => re.test(k)) });
  if (e.changeCount !== undefined) out.push({ name: `${e.changeCount} change(s)`, ok: s.sheet.change.length === e.changeCount, note: String(s.sheet.change.length) });
  if (e.way !== undefined) out.push({ name: `way ${e.way}`, ok: s.way === e.way, note: String(s.way) });
  if (e.seconds !== undefined) out.push({ name: `length ${e.seconds}`, ok: s.seconds === e.seconds, note: String(s.seconds) });
  if (e.editStudio !== undefined) out.push({ name: 'editing studio offered', ok: s.editStudio === e.editStudio });
  if (e.impossible !== undefined) out.push({ name: 'impossible flagged', ok: s.impossible === e.impossible });
  for (const re of e.replyHas ?? []) out.push({ name: `reply has ${re}`, ok: re.test(s.reply ?? '') });
  if (e.answered !== undefined) {
    const at = questionsBefore.length - 1;
    out.push({ name: 'typed answer paired', ok: s.questions[at]?.answer === e.answered, note: s.questions[at]?.answer ?? 'none' });
  }
  // Every turn.
  if (s.reply) {
    const english = !HANGUL.test(step.say) && /[a-z]/i.test(step.say);
    out.push({ name: english ? 'reply in English' : 'reply in Korean', ok: english ? !HANGUL.test(s.reply) : HANGUL.test(s.reply) });
    out.push({ name: 'no internal words', ok: !INTERNAL.test(s.reply), note: INTERNAL.exec(s.reply)?.[0] });
    out.push({ name: 'at most three sentences', ok: sentences(s.reply) <= 3, note: String(sentences(s.reply)) });
  }
  if (s.reply && shownBefore && (s.changed.way || s.changed.credits) && s.way !== null) {
    out.push({ name: 'explains a change of way or credits', ok: /\d[\d,]*\s*(크레딧|credits?)/i.test(s.reply) });
  }
  if (!s.canMake && step.category === 'nonrequest' && standingBefore.change.length === 0) out.push({ name: 'no button after a non-request', ok: true });
  if (s.canMake && step.category === 'nonrequest' && standingBefore.change.length === 0) out.push({ name: 'no button after a non-request', ok: false });
  out.push({ name: 'never the same point twice', ok: new Set(s.questions.map((q) => q.point.toLowerCase())).size === s.questions.length });
  return out;
}

async function runCase(c: Case, clips: Record<ClipName, ClipFixture>, run: number, thinking: 'LOW' | 'MEDIUM', key: GeminiEnv, timeoutMs?: number): Promise<CaseRecord> {
  const terms = termsFor();
  let sheet: ReviseSheet = emptySheet();
  let questions: ReviseQuestion[] = [];
  let shown: { way: 'edit' | 'reshoot' | null; estimateKrw: number } | null = null;
  const turns: ReviseTurn[] = [];
  let pictures = 0;
  const records: TurnRecord[] = [];
  for (const [i, step] of c.steps.entries()) {
    if (state.stop) break;
    pictures += step.attachPictures ?? 0;
    const opened = openQuestion(questions);
    const option = step.answering?.option !== undefined && opened !== null ? questions[opened]!.options[step.answering.option] : undefined;
    const message = step.say || option || '';
    const answering =
      opened !== null && step.answering
        ? { question: questions[opened]!.question, ...(option ? { option } : {}), ...(step.answering.decide ? { decide: true } : {}) }
        : null;
    const facts = talkFacts(terms, shown);
    let tokens = { input: 0, output: 0, thinking: 0 };
    const t0 = performance.now();
    const outcome = await readTalk(
      { fetch: meteredFetch((u) => (tokens = u)), env: { GEMINI_API_KEY: key.GEMINI_API_KEY, GEMINI_BASE_URL: key.GEMINI_BASE_URL } },
      {
        message,
        turns,
        sheet,
        questions,
        answering,
        attached: { pictures, videos: 0, marks: [] },
        clip: clips[c.clip].reading,
        madeWith: clips[c.clip].madeWith,
        history: c.history ?? [],
        facts,
      },
      { thinking, ...(timeoutMs ? { timeoutMs } : {}) },
    );
    const ms = Math.round(performance.now() - t0);
    const settled = settleTalk(
      { reading: outcome.ok ? outcome.reading : null, message, standing: { sheet, questions }, answering: opened !== null ? (step.answering ?? null) : null, terms, shown },
      factCredits(facts),
    );
    const checks = outcome.ok ? check({ ...step, say: message }, settled, sheet, questions, shown !== null) : [{ name: 'read', ok: false, note: outcome.why }];
    records.push({ step: i + 1, say: message, answering: step.answering ?? null, category: step.category, ms, tokens, failed: !outcome.ok, settled, checks });
    turns.push({ role: 'customer', text: message });
    if (settled.reply) turns.push({ role: 'studio', text: settled.reply });
    sheet = settled.sheet;
    questions = settled.questions;
    shown = settled.way ? { way: settled.way, estimateKrw: settled.estimateKrw } : shown;
  }
  return { id: c.id, group: c.group, clip: c.clip, run, turns: records };
}

/* ------------------------------------------------------------------ report */

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
}

const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '—');

function metrics(records: CaseRecord[]) {
  const all = records.flatMap((r) => r.turns.map((t) => ({ r, t })));
  const first = (cat: Category) => all.filter(({ t }) => t.category === cat && !t.failed);
  const nonreq = all.filter(({ t }) => t.category === 'nonrequest' && !t.failed);
  const nonreqButtons = nonreq.filter(({ t }) => t.settled.canMake).length;
  const missing = first('missing');
  const missingAsked = missing.filter(({ t }) => t.settled.open !== null).length;
  const clear = first('clear');
  const clearNoQ = clear.filter(({ t }) => t.settled.open === null && t.settled.canMake).length;
  const taste = first('taste');
  const tasteOk = taste.filter(({ t }) => t.settled.open === null && t.settled.canMake && t.settled.sheet.change.length > 0).length;
  const checks = all.flatMap(({ t }) => t.checks);
  return {
    nonRequestButtons: `${nonreqButtons} of ${nonreq.length}`,
    missingAsked: pct(missingAsked, missing.length),
    clearNoQuestion: pct(clearNoQ, clear.length),
    tasteProposed: pct(tasteOk, taste.length),
    checks: pct(checks.filter((c) => c.ok).length, checks.length),
    failedReadings: all.filter(({ t }) => t.failed).length,
    wayDisagreements: all.filter(({ t }) => !t.failed && !t.settled.wayAgrees).length,
    latencyMedian: median(all.map(({ t }) => t.ms)),
    latencyMax: Math.max(0, ...all.map(({ t }) => t.ms)),
    inputTokensMedian: median(all.map(({ t }) => t.tokens.input)),
    outputTokensMedian: median(all.map(({ t }) => t.tokens.output)),
    thinkingTokensMedian: median(all.map(({ t }) => t.tokens.thinking)),
    turns: all.length,
  };
}

function markdown(records: CaseRecord[], runs: number, thinking: string): string {
  const lines: string[] = [`# Revise conversation eval (${thinking} thinking, ${runs} run${runs > 1 ? 's' : ''}, ${new Date().toISOString()})`, ''];
  for (let run = 1; run <= runs; run++) {
    const m = metrics(records.filter((r) => r.run === run));
    lines.push(`## Run ${run}: targets`, '', '| measure | result | target |', '| --- | --- | --- |');
    lines.push(`| make button after a non-request (no plan standing) | ${m.nonRequestButtons} | 0 |`);
    lines.push(`| missing-target requests asked | ${m.missingAsked} | ≥ 90% |`);
    lines.push(`| clear requests answered without a question | ${m.clearNoQuestion} | ≥ 90% |`);
    lines.push(`| taste requests: concrete proposal, no question | ${m.tasteProposed} | ≥ 90% |`);
    lines.push(`| all mechanical checks | ${m.checks} | |`);
    lines.push(`| failed readings | ${m.failedReadings} | |`, `| reading named another way than the server | ${m.wayDisagreements} | |`);
    lines.push(`| latency median / max (ms) | ${m.latencyMedian} / ${m.latencyMax} | 12,000 budget |`);
    lines.push(`| tokens per turn, median (input / output / thinking) | ${m.inputTokensMedian} / ${m.outputTokensMedian} / ${m.thinkingTokensMedian} | |`, '');
    lines.push('| case | turn | category | ms | kind | question | button | way · credits | failed checks |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of records.filter((x) => x.run === run)) {
      for (const t of r.turns) {
        const bad = t.checks.filter((c) => !c.ok).map((c) => c.name + (c.note ? ` (${c.note})` : '')).join('; ');
        const s = t.settled;
        lines.push(`| ${r.id} | ${t.step} | ${t.category} | ${t.ms} | ${s.kind ?? 'failed'} | ${s.open !== null ? 'yes' : '—'} | ${s.canMake ? 'yes' : '—'} | ${s.way ?? '—'} · ${creditsOf(s.estimateKrw)} | ${bad || 'ok'} |`);
      }
    }
    lines.push('');
  }
  lines.push('## Transcripts', '');
  for (const r of records) {
    lines.push(`### ${r.id} · run ${r.run} · ${r.clip}`, '');
    for (const t of r.turns) {
      const s = t.settled;
      lines.push(`**Customer${t.answering ? (t.answering.decide ? ' (pressed "decide for me")' : ` (pressed option ${(t.answering.option ?? 0) + 1})`) : ''}:** ${t.say}`, '');
      if (t.failed) {
        lines.push('_Reading failed._', '');
        continue;
      }
      lines.push(`**Studio** (${s.kind}, ${t.ms} ms): ${s.reply}`, '');
      if (s.open !== null) {
        const q = s.questions[s.open]!;
        lines.push(`> Question: ${q.question}  ·  options: ${q.options.map((o) => `[${o}]`).join(' ')}`, '');
      }
      const sheet = s.sheet;
      lines.push(
        `> Sheet — change: ${sheet.change.map((c) => `${c.text} (${c.kind}${c.seconds ? ` ${c.seconds}s` : ''})`).join('; ') || '—'} · keep: ${sheet.keep.join('; ') || '—'} · exclude: ${sheet.exclude.join('; ') || '—'}`,
        `> Server — way: ${s.way ?? '—'}, ${creditsOf(s.estimateKrw)} credits${s.seconds ? `, ${s.seconds} s` : ''}, button: ${s.canMake ? 'yes' : 'no'}${s.editStudio ? ', editing studio offered' : ''}${s.impossible ? ', impossible part' : ''}${s.changed.way || s.changed.credits ? `, changed (way ${s.changed.way}, credits ${s.changed.credits})` : ''}${s.wayAgrees ? '' : ', reading named another way'}`,
        `> Checks: ${t.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.note && !c.ok ? ` (${c.note})` : ''}`).join(' · ')}`,
        '',
      );
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ main */

async function readClips(env: GeminiEnv, bottle: string, montage: string): Promise<void> {
  const fetchImpl = meteredFetch(() => undefined);
  const out: Record<ClipName, ClipFixture> = {} as never;
  for (const [name, path] of [['bottle', bottle], ['montage', montage]] as const) {
    const reading = await readFilm({ video: { bytes: new Uint8Array(readFileSync(path)), mime: 'video/mp4' }, locale: 'ko' }, { fetch: fetchImpl, env: env as Record<string, string> });
    if (!reading) throw new Error(`could not read ${name}`);
    out[name] = { reading, madeWith: MADE_WITH[name] };
    say(`${name}: ${reading.summary}`);
  }
  mkdirSync(join(process.cwd(), 'scripts', 'fixtures'), { recursive: true });
  writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + '\n');
  say(`wrote ${FIXTURE} (${state.calls} calls)`);
}

async function main(): Promise<void> {
  const envFile = argv[0];
  if (!envFile || envFile.startsWith('--')) throw new Error('usage: revise-dialogue-eval.ts <env-file> --out <dir> | --read-clips <bottle.mp4> <montage.mp4>');
  const env = readGeminiEnv(envFile);
  SECRET = env.GEMINI_API_KEY ?? '';
  const config = studioGeminiConfig({ GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_BASE_URL: env.GEMINI_BASE_URL });
  if (!config) throw new Error('no GEMINI_API_KEY in the env file');
  if (config.model !== EXPECTED_MODEL) throw new Error(`studio model is ${config.model}, expected ${EXPECTED_MODEL}`);
  state.cap = intFlag('--cap', 600, 1, 2000);
  const readAt = argv.indexOf('--read-clips');
  if (readAt >= 0) return readClips(env, argv[readAt + 1]!, argv[readAt + 2]!);

  const outDir = flag('--out');
  if (!outDir) throw new Error('--out <dir> is required');
  if (!existsSync(FIXTURE)) throw new Error(`no clip readings at ${FIXTURE}: run with --read-clips first`);
  const clips = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<ClipName, ClipFixture>;
  const runs = intFlag('--runs', 2, 1, 5);
  const thinking = (flag('--thinking') ?? 'LOW').toUpperCase() === 'MEDIUM' ? 'MEDIUM' : 'LOW';
  const only = flag('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  const concurrency = intFlag('--concurrency', 4, 1, 8);
  // Measuring only: a longer budget than the operation's 12 s, to see how long slow readings really take.
  const timeoutMs = flag('--timeout') ? intFlag('--timeout', 12_000, 1_000, 60_000) : undefined;
  const records: CaseRecord[] = [];
  for (let run = 1; run <= runs && !state.stop; run++) {
    let next = 0;
    const worker = async () => {
      while (next < cases.length && !state.stop) {
        const c = cases[next++]!;
        records.push(await runCase(c, clips, run, thinking, env, timeoutMs));
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    say(`run ${run} done (${state.calls} calls so far)`);
  }
  const order = new Map(CASES.map((c, i) => [c.id, i]));
  records.sort((a, b) => a.run - b.run || order.get(a.id)! - order.get(b.id)!);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'revise-dialogue-eval.md'), scrub(markdown(records, runs, thinking)));
  writeFileSync(join(outDir, 'revise-dialogue-eval.json'), scrub(JSON.stringify(records, null, 1)));
  for (let run = 1; run <= runs; run++) say(`run ${run}: ${JSON.stringify(metrics(records.filter((r) => r.run === run)))}`);
  say(`calls: ${state.calls}${state.stop ? ` · stopped: ${state.stop}` : ''}`);
}

main().catch((error) => {
  say(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
