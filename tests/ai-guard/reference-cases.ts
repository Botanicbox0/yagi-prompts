/**
 * The inputs the prompt-guard proof harness runs through its two reference sites (docs/PROMPT-GUARD.md):
 *   #1 the image prompt writer `enhancePrompt` (lib/brand-studio/enhancer/index.ts) and
 *   #2 the Seedance video director `compileDirectorPrompt` (lib/brand-studio/director/compiler.ts).
 * Both are reached by the free 설계 preview (`prompt.enhance`) and by the paid prepare path (`runEnhancer`).
 *
 * Every customer-controlled string carries a marker (`QX…`) so a test can prove none of them reaches the
 * system part. `benign` is what a well-behaved model answers; it must pass the guard in every mode.
 * Nothing here calls a network: every call goes to the `fetch` the runner is given.
 */
import type { FilmSheet } from '@/lib/brand-studio/contracts';
import { compileDirectorPrompt, type DirectorCompileInput } from '@/lib/brand-studio/director';
import type { MediaAnalysisDigest, MediaAnalyzer } from '@/lib/brand-studio/director/types';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';

export type ReferenceSite = 'brand-studio.enhancer' | 'brand-studio.director';

export interface ReferenceCase {
  id: string;
  site: ReferenceSite;
  input: EnhanceInput | DirectorCompileInput;
  /** The prompt a well-behaved model writes (the notes are `BENIGN_NOTES`). */
  benign: string;
  /** Run the director with the live analyzer (two calls through the same fetch). */
  liveAnalyzer?: boolean;
  /** The site never calls the model for this input (passthrough). */
  noCall?: boolean;
}

export const BENIGN_NOTES = '장면과 참조를 구체적으로 적었어요.';

/** Every marker a customer-controlled field carries below. None may reach a guarded system part. */
export const CUSTOMER_MARKERS = [
  'QXPROMPT',
  'QXCHANGE',
  'QXUSE',
  'QXAVOID',
  'QXBRANDNAME',
  'QXTONE',
  'QXRULE',
  'QXSHOTFRAMING',
  'QXSHOTCAMERA',
  'QXSHOTACTION',
  'QXLOOKLIGHT',
  'QXLOOKPALETTE',
  'QXLOOKTEXTURE',
  'QXEFFECTS',
  'QXSUMMARY',
  'QXSUBJECT',
  'QXSETTING',
  'QXMADEWITH',
  'QXHISTORY',
  'QXMARK',
  'QXMATERIAL',
  'QXCLARQ',
  'QXCLARA',
  'QXSHEETCHANGE',
  'QXSHEETKEEP',
  'QXSHEETEXCLUDE',
  'QXLIGHTNOTE',
  'QXTEXTURENOTE',
  'QXSUBJECTNOTE',
] as const;

/** A tiny fixed "picture": the writers only check the mime type and base64 the bytes. */
const THUMB = { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]), mime: 'image/png' };

export const MARKED_SHEET: FilmSheet = {
  seconds: 8,
  aspect: '9:16',
  shots: [
    { start: 0, end: 2, framing: 'close-up of a hand QXSHOTFRAMING', camera: 'slow push in toward the bottle QXSHOTCAMERA', action: 'a hand lifts the bottle QXSHOTACTION' },
    { start: 2, end: 5, framing: 'medium shot', camera: 'handheld follow from behind', action: 'she walks to the window' },
    { start: 5, end: 8, framing: 'wide shot', camera: 'locked-off', action: 'she sprays and turns away' },
  ],
  look: { lighting: 'soft daylight from the left QXLOOKLIGHT', palette: 'white walls, pale blue fabric QXLOOKPALETTE', texture: 'clean, light grain QXLOOKTEXTURE' },
  audio: { music: true, speech: false, effects: 'footsteps, a spray QXEFFECTS' },
  summary: '8초 영상이고 컷은 3개예요 QXSUMMARY.',
};

const BLUEPRINT_SHEET: FilmSheet = {
  ...MARKED_SHEET,
  shots: MARKED_SHEET.shots.map((shot, idx) => ({ ...shot, transition: idx < MARKED_SHEET.shots.length - 1 ? 'hard cut' : 'end' })),
  subjects: [{ id: 'A', what: 'woman in charcoal coat QXSUBJECT', count: 1 }],
  setting: 'wet evening alley with warm shopfront spill QXSETTING',
};

const BRAND = { name: 'QXBRANDNAME', tone: 'calm and bright QXTONE', palette: ['#14181F', '#EAE4DC', '#3875C5'], rules: ['Never tilt the bottle QXRULE'] };

const DIGEST: MediaAnalysisDigest = {
  provider: 'gemini-4-hydrogen',
  fallbackUsed: false,
  paletteHex: ['#14181F', '#EAE4DC', '#3875C5'],
  lightingNotes: 'soft window key from camera-left QXLIGHTNOTE',
  textureNotes: 'matte glass grain QXTEXTURENOTE',
  subjectNotes: 'a matte serum bottle QXSUBJECTNOTE',
  references: [],
  filmSummary: null,
};

export const FAKE_ANALYZER: MediaAnalyzer = {
  provider: 'gemini-4-hydrogen',
  async analyze() {
    return DIGEST;
  },
};

function enhancerInput(over: Partial<EnhanceInput>): EnhanceInput {
  return { kind: 'image', profile: 'seedream', locale: 'ko', prompt: '흰 대리석 위에 놓인 향수병 QXPROMPT', references: [], brand: null, video: null, ...over };
}

const MADE_WITH = 'Reference authority: lock the bottle to @Image 1.\nA pink perfume bottle turns slowly on white stone QXMADEWITH.\nAudio: soft room tone.';

export const REFERENCE_CASES: readonly ReferenceCase[] = [
  {
    id: 'enhancer-image-plain',
    site: 'brand-studio.enhancer',
    input: enhancerInput({}),
    benign: 'A frosted perfume bottle stands upright on white marble in soft morning light from the left, a clean product photo for a feed post. The camera sits at bottle height and the background falls out of focus.',
  },
  {
    id: 'enhancer-image-references',
    site: 'brand-studio.enhancer',
    input: enhancerInput({
      prompt: '이미지 1 향수병을 이미지 2 조명으로 배치 QXPROMPT',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '불투명 유리 실루엣과 라벨만 유지 QXUSE', avoid: '원본 배경 제거 QXAVOID', thumb: THUMB },
        { index: 2, kind: 'image', label: '이미지 2', role: 'style', use: '따뜻한 측면광과 그림자', thumb: THUMB },
      ],
      brand: BRAND,
    }),
    benign:
      'A frosted pale-blue cylindrical glass bottle from Image 1 stands upright on honed travertine; keep the exact label, proportions and colours of Image 1. Take only the warm golden side light and soft shadows from Image 2, ignoring its original setting. Eye-level medium shot, calm.',
  },
  {
    id: 'enhancer-region-crop',
    site: 'brand-studio.enhancer',
    input: enhancerInput({
      kind: 'region_edit',
      prompt: '라벨을 이미지 1 로고로 바꿔 주세요 QXPROMPT',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'logo', use: '로고 모양 그대로 QXUSE', thumb: THUMB }],
      editCropThumb: THUMB,
    }),
    benign:
      'In Image 1, change only the label so it carries the exact mark from Image 2, printed flat on the curved glass at the same size; do not move or resize anything else. Keep the light, reflections and grain of Image 1.',
  },
  {
    id: 'enhancer-video-ambient',
    site: 'brand-studio.enhancer',
    input: enhancerInput({
      profile: 'seedance',
      kind: 'video',
      prompt: '이미지 1 향수병을 손이 들어 올리는 장면 QXPROMPT',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product', thumb: THUMB }],
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    }),
    benign: [
      '@Image1 supplies only the bottle: its exact shape, label and colours.',
      'Visual style: a pale room in soft daylight from the left, clean picture with light grain.',
      '0.0–3.0s: Close-up, a hand already reaching in lifts the bottle; slow push in from the base to the label. Hard cut.',
      '3.0–8.0s: Medium shot, she turns the bottle toward the window; locked-off. Continuous.',
      'The last frame: the bottle in her hand against the bright window.',
      'Audio: footsteps on wood, a soft spray.',
    ].join('\n'),
  },
  {
    id: 'enhancer-remix-reference',
    site: 'brand-studio.enhancer',
    input: enhancerInput({
      profile: 'seedance',
      kind: 'video_remix',
      prompt: '영상 1처럼, 병은 이미지 1로 QXPROMPT',
      references: [
        { index: 1, kind: 'video', label: '영상 1' },
        { index: 2, kind: 'image', label: '이미지 1', role: 'product', thumb: THUMB },
      ],
      video: { seconds: null, aspect: '9:16', audio: 'native', method: 'reference', keep: ['camera', 'timing'], change: '병만 우리 제품으로 QXCHANGE', sheet: MARKED_SHEET },
    }),
    benign: [
      'Follow @Video1 for the camera path and the cut timing; replace the bottle with the bottle from @Image1; keep the room and the light.',
      '@Image1 supplies only the bottle: its exact shape, label and colours.',
      'Visual style: pale room, soft daylight from the left.',
      '0.0–2.0s: Close-up, a hand lifts the bottle; slow push in toward it. Hard cut.',
      '2.0–5.0s: Medium shot, she walks to the window; handheld follow from behind. Hard cut.',
      '5.0–8.0s: Wide shot, she sprays and turns away; locked-off.',
      'The last frame: the empty window light.',
      'Audio: footsteps, a soft spray, quiet music that fits the mood.',
    ].join('\n'),
  },
  {
    id: 'enhancer-revision-reshoot',
    site: 'brand-studio.enhancer',
    input: enhancerInput({
      profile: 'seedance',
      kind: 'video',
      prompt: '① 병을 파란색으로 QXPROMPT',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }],
      video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
      revision: {
        mode: 'reshoot',
        version: 4,
        madeWith: MADE_WITH,
        history: ['배경을 회색으로 QXHISTORY'],
        marks: [{ n: 1, time: 1.5, what: 'the pink bottle QXMARK', x: 0.5, y: 0.5 }],
        materials: [{ n: 1, kind: 'video', notes: 'a slow orbit around a bottle QXMATERIAL' }],
        clarified: { question: '병 전체인가요 QXCLARQ', answer: '병 전체 QXCLARA' },
        sheet: { change: ['bottle colour to deep blue QXSHEETCHANGE'], keep: ['the stone QXSHEETKEEP'], exclude: ['music QXSHEETEXCLUDE'] },
        seconds: 6,
      },
    }),
    benign: [
      'Reference authority: lock the bottle to @Image1.',
      'A deep blue perfume bottle turns slowly on grey stone.',
      'Audio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
    ].join('\n'),
  },
  {
    id: 'director-expand-thumb',
    site: 'brand-studio.director',
    input: {
      kind: 'video',
      profile: 'seedance',
      locale: 'ko',
      prompt: '이미지 1 세럼을 드는 장면 QXPROMPT',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '병 모양 QXUSE', avoid: '배경 QXAVOID', thumb: THUMB }],
      brand: BRAND,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    benign: [
      'Reference authority: lock identity and bottle geometry to @Image 1.',
      'Visual style: #181B20 shadow floor, #E6DFD5 linen, #3875C5 accent; a soft window key from the left with a grounded shadow under the bottle.',
      '0.0s–4.0s: 18° off-axis medium shot, she lifts @Image 1 with a calm eyeline; slow push-in. Hard cut.',
      '4.0s–8.0s: OTS close-up on @Image 1 resting on stone; the camera holds still.',
      'Audio: a soft glass click on stone and quiet room tone.',
    ].join('\n'),
  },
  {
    id: 'director-slotfill-noref',
    site: 'brand-studio.director',
    input: {
      kind: 'video',
      profile: 'seedance',
      locale: 'ko',
      prompt: '창가 테이블에서 여자가 천천히 세럼 병을 들어 올리고 카메라가 부드럽게 클로즈업으로 다가간다. 따뜻한 아침 햇살이 옆에서 비춘다 QXPROMPT.',
      references: [],
      brand: null,
      video: { seconds: 6, aspect: '9:16', audio: 'ambient' },
    } as DirectorCompileInput,
    benign: [
      'Visual style: warm morning sun from the side, pale table, soft shadows and fine natural grain.',
      '0.0s–3.0s: 45° three-quarter medium shot, a woman slowly lifts a serum bottle at the window table; the camera drifts closer. Hard cut.',
      '3.0s–6.0s: close-up on the bottle in her hand as the light catches the glass; the camera settles.',
      'Audio: the glass touching the table and quiet room tone.',
    ].join('\n'),
  },
  {
    id: 'director-blueprint',
    site: 'brand-studio.director',
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      locale: 'ko',
      prompt: '이미지 1 세럼을 드는 장면 QXPROMPT',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product', thumb: THUMB }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'on', method: 'blueprint', keep: ['camera', 'timing', 'look'], change: '병만 바꿔 QXCHANGE', sheet: BLUEPRINT_SHEET },
    } as DirectorCompileInput,
    benign: [
      'Reference authority: lock identity and bottle geometry to @Image 1.',
      'Visual style: a wet evening alley with warm shopfront spill and a cool shadow side.',
      '0.0s–2.0s: close-up of a hand lifting @Image 1; slow push in. Hard cut.',
      '2.0s–5.0s: medium shot, she walks to the window; handheld follow. Hard cut.',
      '5.0s–8.0s: wide shot, she sprays and turns away; locked-off.',
      'Audio: footsteps and a soft spray.',
    ].join('\n'),
  },
  {
    id: 'director-passthrough',
    site: 'brand-studio.director',
    input: {
      kind: 'video',
      profile: 'seedance',
      locale: 'ko',
      prompt: ['Visual style: #12151C shadow floor, #D9D2C5 limestone QXPROMPT.', '0.0s–4.0s: 18° medium close-up, model holds 이미지 1 bottle in rain. Hard cut.', '4.0s–8.0s: 45° close-up on label.'].join('\n'),
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product' }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    benign: 'unused',
    noCall: true,
  },
  {
    id: 'director-revision-edit',
    site: 'brand-studio.director',
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      locale: 'ko',
      prompt: '병을 파란색으로 QXPROMPT',
      references: [{ index: 1, kind: 'video', label: '영상 1' }],
      brand: null,
      video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
      revision: { mode: 'edit', version: 3, madeWith: MADE_WITH, history: ['배경을 회색으로 QXHISTORY'] },
    } as DirectorCompileInput,
    benign: 'In @Video1, change only the pink perfume bottle to deep blue; everything else stays as it is.\nAudio: soft room tone.',
  },
  {
    id: 'director-image-delegates',
    site: 'brand-studio.director',
    input: {
      kind: 'image',
      profile: 'nano-banana',
      locale: 'ko',
      prompt: '이미지 1 병을 대리석 위에 QXPROMPT',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '라벨 QXUSE', thumb: THUMB }],
      brand: BRAND,
      video: null,
    } as DirectorCompileInput,
    benign: "Using image 1, place the bottle upright on a white marble slab in soft morning light from the left. Keep the bottle's exact shape, label, proportions and colours.",
  },
  {
    id: 'director-analyzer-live',
    site: 'brand-studio.director',
    input: {
      kind: 'video',
      profile: 'seedance',
      locale: 'en',
      prompt: 'A serum bottle on dark stone, she lifts it QXPROMPT',
      references: [{ index: 1, kind: 'image', label: 'Image 1', role: 'product', thumb: THUMB }],
      brand: null,
      video: { seconds: 6, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    benign: [
      'Reference authority: lock the bottle geometry to @Image 1.',
      'Visual style: dark stone, a cool key from above and a soft rim on the glass.',
      '0.0s–6.0s: 18° off-axis medium shot, she lifts @Image 1 from the stone; slow push-in settling on the label.',
      'Audio: the bottle lifting off stone and quiet room tone.',
    ].join('\n'),
    liveAnalyzer: true,
  },
];

export interface RecordedCall {
  url: string;
  body: string;
}

/** A fetch double: records every request body and answers with `answer(callIndex, body)`. */
export function recordingFetch(answer: (call: number, body: string) => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    calls.push({ url: String(url), body });
    return answer(calls.length - 1, body);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export function geminiJson(value: unknown): Response {
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Runs one case through its site with the given env and fetch; never throws (both sites never do). */
export async function runSite(c: ReferenceCase, env: Record<string, string | undefined>, fetchImpl: typeof fetch, onFallback?: (reason: string) => void) {
  if (c.site === 'brand-studio.enhancer') {
    return enhancePrompt(c.input as EnhanceInput, { fetch: fetchImpl, env, ...(onFallback ? { onFallback } : {}) });
  }
  return compileDirectorPrompt(c.input as DirectorCompileInput, {
    fetch: fetchImpl,
    env,
    ...(c.liveAnalyzer ? {} : { analyzer: FAKE_ANALYZER }),
    ...(onFallback ? { onFallback } : {}),
  });
}

/** True for a request body sent by the site itself (not the director's media analyzer). */
export function isSiteCall(body: string): boolean {
  return body.includes('"responseJsonSchema":{"type":"object","properties":{"prompt"');
}
