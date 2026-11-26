import type { FilmSheet } from '@/lib/brand-studio/contracts';
import type { DirectorCompileInput } from '@/lib/brand-studio/director';
import type { EnhanceInput } from '@/lib/brand-studio/enhancer';
import type { MediaAnalysisDigest, MediaAnalyzer } from '@/lib/brand-studio/director/types';
import { SHEET } from './intel/helpers';

/** Fixed 16-byte PNG signature/IHDR stub used across deterministic tests (never hits network). */
export const FIXED_THUMB = {
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]),
  mime: 'image/png',
} as const;

export const FIXED_BLUEPRINT_SHEET: FilmSheet = {
  ...SHEET,
  shots: SHEET.shots.map((shot, idx) => ({
    ...shot,
    transition: idx < SHEET.shots.length - 1 ? 'hard cut' : 'end',
  })),
  subjects: [{ id: 'A', what: 'woman in charcoal coat', count: 1 }],
  setting: 'wet evening alley with warm shopfront spill',
};

export const FIXED_DIGEST: MediaAnalysisDigest = {
  provider: 'gemini-4-hydrogen',
  fallbackUsed: false,
  paletteHex: ['#14171C', '#E6DFD5', '#3875C5'],
  lightingNotes: 'one soft window key from left with grounded room shadow',
  textureNotes: 'natural stone grain and unretouched matte fabric',
  subjectNotes: 'woman holding ceramic bottle by sunlit window',
  references: [],
  filmSummary: null,
};

export const FIXED_PRODUCT_ONLY_DIGEST: MediaAnalysisDigest = {
  provider: 'gemini-4-hydrogen',
  fallbackUsed: false,
  paletteHex: ['#14171C', '#EAE4DC', '#3875C5'],
  lightingNotes: 'soft angled morning daylight across honed travertine',
  textureNotes: 'frosted glass micro-grain and matte limestone',
  subjectNotes: 'frosted glass perfume bottle standing alone on stone',
  references: [],
  filmSummary: null,
};

export const FIXED_ANALYZER: MediaAnalyzer = {
  provider: 'gemini-4-hydrogen',
  async analyze(input) {
    return /product only|no person|사람\s*없이/i.test(input.prompt) ? FIXED_PRODUCT_ONLY_DIGEST : FIXED_DIGEST;
  },
};

// Carefully written without `TECHNICAL_DIRECTION_RE` tokens so `classifyPromptIntent` routes to `slot_fill`.
const VERY_LONG_BRIEF_PARAGRAPH =
  'At dawn inside a quiet limestone courtyard, a woman wearing an ivory wool coat walks beside tall arched windows carrying a matte ceramic bottle in one hand as cool morning air moves softly through sheer linen curtains and across pale flagstones. ';

export const VERY_LONG_NARRATIVE_BRIEF =
  `Editorial lookbook sequence: ${VERY_LONG_BRIEF_PARAGRAPH.repeat(14)}She pauses beside the stone plinth, rests her fingertips gently along the bottle shoulder, breathes calmly, and turns her gaze slightly toward the courtyard garden as warm sunlight shifts across the wool fabric.`.slice(
    0,
    3400,
  );

export interface SeedanceParityCase {
  id: string;
  label: string;
  input: DirectorCompileInput;
  /** Expected director failure (HTTP 500) rather than model JSON output. */
  failModel?: boolean;
  /** Deterministic schema-valid JSON output when the model succeeds. */
  mockAnswer: { prompt: string; notes: string };
}

export const SEEDANCE_PARITY_CASES: readonly SeedanceParityCase[] = [
  {
    id: '01-person-product-editorial',
    label: 'Person + product editorial brief',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '창가 테이블에서 여자가 천천히 이미지 1 세럼 병을 들어 올리고 고개를 살짝 돌리는 패션 에디토리얼 룩북 장면',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '병 모양과 라벨', avoid: '배경' }],
      brand: {
        name: 'Atelier North',
        tone: 'calm editorial',
        palette: ['#14171C', '#E6DFD5', '#3875C5'],
        rules: ['Keep bottle label upright and legible'],
      },
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    },
    mockAnswer: {
      prompt: [
        'Reference authority: @Image 1 supplies only the serum bottle with its exact glass shape and label.',
        'Visual style: #14171C lifted shadow floor, #E6DFD5 warm limestone, #3875C5 cool accent; one soft window key light from the left.',
        '0.0s–4.0s: 18° three-quarter framing, the woman lifts @Image 1 from the stone table with a small weight shift and slow head turn; quiet breath. Hard cut.',
        '4.0s–8.0s: 45° close framing as sunlight catches the glass label and a hair strand moves gently.',
        'Audio: soft glass lift on stone and quiet room ambience.',
      ].join('\n'),
      notes: '인물과 제품 참조를 기준으로 화면 빛과 컷 구성을 정리했어요.',
    },
  },
  {
    id: '02-action-music-video',
    label: 'Action / music-video brief',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: 'High-energy music video chase down a rain-slicked neon alley as a woman sprints past glowing shopfronts and leaps over a puddle.',
      references: [],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    },
    mockAnswer: {
      prompt: [
        'Visual style: #14171C shadow floor, #252A34 wet asphalt, #3875C5 neon reflection; motivated storefront backlight.',
        '0.0s–4.0s: low-angle Steadicam tracking behind the woman sprinting past rain-slicked storefronts. Hard cut.',
        '4.0s–8.0s: 90° orbital arc sweeping around her as she leaps clear over a puddle and lands in stride.',
        'Audio: rapid footsteps splashing through water and vibrant music performance.',
      ].join('\n'),
      notes: 'Prepared the action chase sequence with dynamic camera movement.',
    },
  },
  {
    id: '03-product-only-no-person',
    label: 'Product-only brief with no person',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: 'A frosted glass perfume bottle stands alone on pale travertine stone while morning sunlight glides across the label, product only with no person.',
      references: [{ index: 1, kind: 'image', label: 'Image 1', role: 'product', use: 'exact frosted bottle and silver cap', avoid: 'original backdrop' }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    },
    mockAnswer: {
      prompt: [
        'Reference authority: @Image 1 supplies only the frosted perfume bottle, cap, and printed label.',
        'Visual style: #14171C shadow floor, #EAE4DC honed travertine, #3875C5 cool reflection; soft directional morning light.',
        '0.0s–4.0s: 18° table-level framing, morning light sweeps across the bottle shoulder; slow dolly push-in. Hard cut.',
        '4.0s–8.0s: 45° close-up on the embossed glass neck as shadows lengthen smoothly across the stone.',
        'Audio: quiet morning room tone and subtle glass resonance.',
      ].join('\n'),
      notes: 'Refined the product lighting and close-up pacing around Image 1.',
    },
  },
  {
    id: '04-person-reference',
    label: 'Brief with person reference image',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 아이보리 테일러드 코트를 입고 조용한 갤러리 창가에서 숨을 고르는 룩북 장면',
      references: [
        {
          index: 1,
          kind: 'image',
          label: '이미지 1',
          role: 'person',
          use: '얼굴과 헤어 유지',
          avoid: '원본 배경',
          thumb: { bytes: new Uint8Array(FIXED_THUMB.bytes), mime: FIXED_THUMB.mime },
        },
      ],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'sfx' },
    },
    mockAnswer: {
      prompt: [
        'Reference authority: @Image 1 supplies only the person face and hair.',
        'Visual style: #14171C shadow floor, #ECE6DC plaster wall, #3875C5 window cool spill; soft directional gallery daylight.',
        '0.0s–4.0s: 18° medium framing, she wears a tailored ivory wool coat beside the tall window, subtle weight shift and breath. Hard cut.',
        '4.0s–8.0s: 45° close framing as she turns her head slowly toward the light and a loose hair strand moves.',
        'Audio: gentle wool fabric rustle and quiet gallery room tone.',
      ].join('\n'),
      notes: '인물 참조를 바탕으로 갤러리 창가 룩북 장면을 정리했어요.',
    },
  },
  {
    id: '05-two-references',
    label: 'Brief with two references (garment @Image 1 + person @Image 2)',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 2 인물이 이미지 1 코트 의상을 입고 대리석 로비를 천천히 걸어가는 패션 필름',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '아이보리 코트 의상 실루엣과 소재만 유지', avoid: '배경' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'person', use: '얼굴과 헤어만 유지', avoid: '원본 상의와 배경' },
      ],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    },
    mockAnswer: {
      prompt: [
        'Reference authority: @Image 2 supplies only the person face and hair; @Image 1 supplies only the tailored coat silhouette and wool texture.',
        'Visual style: #14171C shadow floor, #DFD8CD marble lobby, #3875C5 cool reflection; soft overhead skylight.',
        '0.0s–4.0s: 18° medium framing as she walks slowly across the marble wearing @Image 1 with calm off-axis gaze. Hard cut.',
        '4.0s–8.0s: 45° three-quarter framing, she pauses near the column with a slow head turn and subtle breath.',
        'Audio: quiet heels on marble and soft room ambience.',
      ].join('\n'),
      notes: '의상과 인물 참조 역할을 분리해 룩북 동선을 구성했어요.',
    },
  },
  {
    id: '06-clip-revision',
    label: 'New version of an existing clip (SEEDANCE_PROFILE revision path)',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '인물 조명을 조금 더 차분하게 맞추고 카메라가 천천히 다가오게',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'person' }],
      brand: null,
      video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
      revision: {
        mode: 'reshoot',
        version: 2,
        madeWith:
          'Reference authority: lock identity to @Image 1.\nVisual style: #14171C shadow floor, #E6DFD5 stone; soft window key light.\n0.0s–6.0s: 18° medium shot, she turns calmly beside the window.\nAudio: soft room tone.',
        history: ['배경을 밝은 석재로'],
      },
    },
    mockAnswer: {
      prompt: [
        'Reference authority: lock identity to @Image1.',
        'Visual style: #14171C shadow floor, #E6DFD5 pale stone; calm soft window key light.',
        '0.0s–6.0s: 18° medium shot, she turns calmly beside the bright stone window as the camera pushes in smoothly toward a close framing.',
        'The last frame: calm three-quarter framing by the bright stone window.',
        'Audio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
      ].join('\n'),
      notes: '이전 프롬프트의 인물 구성을 유지하면서 조명과 카메라 접근을 다듬었어요.',
    },
  },
  {
    id: '07-fallback-director-failure',
    label: 'Fallback path when director model fails (blueprint multi-shot with person + product)',
    failModel: true,
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 인물이 이미지 2 세럼을 들어 올리는 3컷 리믹스',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'person' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'product' },
      ],
      brand: null,
      video: {
        seconds: 8,
        aspect: '9:16',
        audio: 'on',
        method: 'blueprint',
        keep: ['camera', 'timing', 'look'],
        change: '병을 이미지 2 세럼으로',
        sheet: FIXED_BLUEPRINT_SHEET,
      },
    },
    mockAnswer: {
      prompt: 'unused',
      notes: 'unused',
    },
  },
  {
    id: '08-very-long-brief',
    label: 'Very long brief (~3,400 chars editorial narrative)',
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: VERY_LONG_NARRATIVE_BRIEF,
      references: [{ index: 1, kind: 'image', label: 'Image 1', role: 'person' }],
      brand: {
        name: 'Maison Slate',
        tone: 'quiet tactile realism',
        palette: ['#14171C', '#E4DDD2', '#3875C5'],
        rules: ['Keep surfaces matte and natural'],
      },
      video: { seconds: 12, aspect: '9:16', audio: 'on' },
    },
    mockAnswer: {
      prompt: [
        'Reference authority: @Image 1 supplies only the person face and hair.',
        'Visual style: #14171C shadow floor, #E4DDD2 limestone courtyard, #3875C5 sky reflection; soft dawn daylight.',
        '0.0s–5.5s: 18° three-quarter framing, she walks calmly past tall arched windows holding the matte ceramic bottle. Hard cut.',
        '5.5s–9.5s: 45° close framing as she pauses by the stone plinth with a gentle weight shift and slow head turn. Match cut.',
        '9.5s–12.0s: OTS framing on the bottle shoulder as sunlight warms the ivory wool sleeve and a hair strand lifts.',
        'Audio: soft footsteps on limestone, subtle wool rustle, and morning courtyard air.',
      ].join('\n'),
      notes: 'Structured the long editorial narrative into timed courtyard beats.',
    },
  },
];

export const CLIP_REVISION_ENHANCER_PARITY_INPUT: EnhanceInput = {
  kind: 'video_remix',
  profile: 'seedance',
  model: 'seedance-2.5',
  locale: 'ko',
  prompt: '병 색을 파란색으로 바꾸고 배경 빛을 조금만 낮춰 줘',
  references: [
    { index: 1, kind: 'video', label: '영상 1' },
    { index: 2, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴과 헤어 유지', avoid: '원본 배경' },
  ],
  brand: null,
  video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
  revision: {
    mode: 'edit',
    version: 3,
    madeWith:
      'Reference authority: @Image 1 supplies the bottle.\nVisual style: #14171C shadow floor, #E6DFD5 stone.\n0.0s–6.0s: 18° medium shot, a woman lifts the perfume bottle beside stone.\nAudio: soft room tone.',
    history: ['배경을 밝은 석재로'],
  },
};

export const CLIP_REVISION_ENHANCER_PARITY_MOCK_ANSWER = {
  prompt: 'In @Video1, change only the perfume bottle colour to deep blue and lower the background light slightly; everything else stays as it is.\nAudio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
  notes: '이전 영상 구성을 유지하면서 병 색과 배경 빛만 다듬었어요.',
};

export const REVISION_ENHANCER_FALLBACK_EDIT_INPUT: EnhanceInput = {
  kind: 'video_remix',
  profile: 'seedance',
  model: 'seedance-2.5',
  locale: 'ko',
  prompt: '이미지 1 인물의 표정은 두고 병 라벨만 또렷하게',
  references: [
    { index: 1, kind: 'video', label: '영상 1' },
    { index: 2, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴 유지', avoid: '원본 옷' },
    { index: 3, kind: 'image', label: '이미지 2', role: 'product', use: '라벨 geometry' },
  ],
  brand: null,
  video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
  revision: {
    mode: 'edit',
    version: 2,
    madeWith: 'In @Image1, a woman holds the serum bottle in morning light.\nAudio: soft room tone.',
    history: ['조명을 조금 더 차분하게'],
  },
};

export const REVISION_ENHANCER_FALLBACK_RESHOOT_INPUT: EnhanceInput = {
  kind: 'video',
  profile: 'seedance',
  model: 'seedance-2.5',
  locale: 'ko',
  prompt: '이미지 1 인물 클로즈업 비중을 조금 늘려 줘',
  references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴과 헤어' }],
  brand: null,
  video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
  revision: {
    mode: 'reshoot',
    version: 2,
    madeWith: 'Reference authority: @Image1 supplies only the person.\n0.0–6.0s: she stands beside stone.\nAudio: soft room tone.',
    history: ['배경을 밝은 석재로'],
  },
};
