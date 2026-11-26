/**
 * Step 0 parity snapshots for Prompt Guard G1b (frozen before any G1b edits and never regenerated).
 *
 * Captures the exact system text and user text parts handed to the model for every enhancer profile
 * (every image model family/variant, region edit crop & wide, Seedance video / remix / revision;
 * skin modes off / base / realism / restore / maybePerson; skin tone-match variants none / short / full;
 * BRAND_SEEDANCE_RULES_V2 off & on) and the director (first run & fallback input; switch off & on),
 * across PROMPT_GUARD = off, observe, enforce.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileDirectorPrompt, type DirectorCompileInput } from '@/lib/brand-studio/director';
import { enhancePrompt, type EnhanceInput } from '@/lib/brand-studio/enhancer';
import { FAKE_ANALYZER, isSiteCall, MARKED_SHEET, recordingFetch } from './reference-cases';

const THUMB = {
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]),
  mime: 'image/png',
} as const;

const BASE_BRAND = {
  name: 'Atelier Test',
  tone: 'calm editorial minimalism',
  palette: ['#14171C', '#EAE4DC', '#3875C5'],
  rules: ['Keep labels upright and legible'],
};

interface ParityCase {
  id: string;
  site: 'enhancer' | 'director';
  env: Record<string, string | undefined>;
  input: EnhanceInput | DirectorCompileInput;
  mockPrompt: string;
  mockNotes: string;
  failModel?: boolean;
}

const PERSON_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'person' as const,
  use: '얼굴과 피부 톤 그대로 유지',
  avoid: '원본 배경 제외',
  thumb: THUMB,
};

const PERSON_BASE_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'person' as const,
  use: '얼굴 유지',
  avoid: '원본 배경 제외',
  thumb: THUMB,
};

const PRODUCT_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'product' as const,
  use: '유리 용기와 라벨 비율 유지',
  avoid: '원본 배경 제외',
  thumb: THUMB,
};

const OTHER_REF = {
  index: 1,
  kind: 'image' as const,
  label: '이미지 1',
  role: 'other' as const,
  use: '전체 분위기 참고',
  thumb: THUMB,
};

const PARITY_CASES: readonly ParityCase[] = [
  // Seedream 5.5 image profiles & skin variants
  {
    id: 'g1b-enhancer-seedream-55-skin-off',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '대리석 위 이미지 1 세럼 병 제품 사진',
      references: [PRODUCT_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'A frosted glass serum bottle from Image 1 stands upright on pale marble in soft daylight from the left, a product photo for a feed post.',
    mockNotes: '대리석 위 제품 배치를 구체적으로 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedream-55-skin-base',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '창가에서 이미지 1 인물이 세럼 병을 들고 있는 장면',
      references: [PERSON_BASE_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'The woman from Image 1 holds a glass bottle beside a bright window in soft morning daylight, a lookbook photograph.',
    mockNotes: '인물과 창가 조명을 구체적으로 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedream-55-skin-realism-short',
    site: 'enhancer',
    env: { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'short' },
    input: {
      kind: 'image',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 세럼을 볼에 바르는 피부결 클로즈업 실사',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Close-up photograph of the woman from Image 1 applying serum to her cheek in soft side light, with natural unretouched skin.',
    mockNotes: '자연스러운 피부결과 측면광을 구체적으로 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedream-55-skin-realism-full',
    site: 'enhancer',
    env: { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'full' },
    input: {
      kind: 'image',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 세럼을 볼에 바르는 피부결 클로즈업 실사',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Close-up photograph of the woman from Image 1 applying serum to her cheek in soft side light, with natural unretouched skin.',
    mockNotes: '피부 묘사와 측면광을 구체적으로 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedream-55-skin-realism-none',
    site: 'enhancer',
    env: { BRAND_STUDIO_ENHANCER_SKIN_VARIANT: 'none' },
    input: {
      kind: 'image',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 세럼을 볼에 바르는 피부결 클로즈업 실사',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Close-up photograph of the woman from Image 1 applying serum to her cheek in soft side light, with natural unretouched skin.',
    mockNotes: '자연스러운 피부결을 중심으로 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedream-55-maybe-person',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '이미지 1 분위기를 살린 조용한 아침 화장대 장면',
      references: [OTHER_REF],
      brand: null,
      video: null,
    },
    mockPrompt: 'A quiet morning vanity scene matching Image 1 in soft window light, a calm editorial photograph.',
    mockNotes: '화장대 장면을 구체적으로 적었어요.',
  },

  // Nano Banana Pro & 2.1
  {
    id: 'g1b-enhancer-nano-banana-pro-skin-off',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'nano-banana',
      model: 'nano-banana-pro',
      locale: 'ko',
      prompt: '이미지 1 세럼 병을 석회석 받침대 위에 배치',
      references: [PRODUCT_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Using image 1, place the glass bottle upright on pale limestone in soft side daylight, a product photo for a shop page. Keep its exact label and shape.',
    mockNotes: '석회석 위 제품 배치를 적었어요.',
  },
  {
    id: 'g1b-enhancer-nano-banana-pro-skin-realism',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'nano-banana',
      model: 'nano-banana-pro',
      locale: 'ko',
      prompt: '이미지 1 모델의 자연스러운 피부결이 보이는 뷰티 클로즈업',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Using image 1, create a close-up beauty portrait in soft directional light showing natural skin detail. Keep her exact features and expression.',
    mockNotes: '인물 피부 표현과 조명을 적었어요.',
  },
  {
    id: 'g1b-enhancer-nano-banana-21-skin-off',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'nano-banana',
      model: 'nano-banana-2.1',
      locale: 'ko',
      prompt: '이미지 1 세럼 병을 석회석 받침대 위에 배치',
      references: [PRODUCT_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Using image 1, place the glass bottle upright on pale limestone in soft side daylight, a product photo for a shop page. Keep its exact label and shape.',
    mockNotes: '석회석 위 제품 배치를 적었어요.',
  },
  {
    id: 'g1b-enhancer-nano-banana-21-skin-realism',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'nano-banana',
      model: 'nano-banana-2.1',
      locale: 'ko',
      prompt: '이미지 1 모델의 자연스러운 피부결이 보이는 뷰티 클로즈업',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'Using image 1, create a close-up beauty portrait in soft directional light showing natural skin detail. Keep her exact features and expression.',
    mockNotes: '인물 피부 표현과 조명을 적었어요.',
  },

  // GPT Image 2.6 Flare & Sunburst
  {
    id: 'g1b-enhancer-gpt-image-flare-skin-off',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'gpt-image',
      model: 'gpt-image-2.6-flare',
      locale: 'ko',
      prompt: '이미지 1 세럼 병을 밝은 타일 위에 놓은 제품 컷',
      references: [PRODUCT_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'A photorealistic photograph using image 1 on pale ceramic tile in soft morning window light. Keep the exact label, proportions and colours of image 1.',
    mockNotes: '밝은 타일 위 제품 배치를 적었어요.',
  },
  {
    id: 'g1b-enhancer-gpt-image-flare-skin-realism',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'gpt-image',
      model: 'gpt-image-2.6-flare',
      locale: 'ko',
      prompt: '이미지 1 모델의 피부결을 살린 스킨케어 포트레이트',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'A photorealistic photograph using image 1 framed head and shoulders in soft side light with real natural skin. Keep her features unchanged.',
    mockNotes: '인물 프레이밍과 피부 표현을 적었어요.',
  },
  {
    id: 'g1b-enhancer-gpt-image-sunburst-skin-realism',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'image',
      profile: 'gpt-image',
      model: 'gpt-image-2.6-sunburst',
      locale: 'ko',
      prompt: '이미지 1 모델의 피부결을 살린 스킨케어 포트레이트',
      references: [PERSON_REF],
      brand: BASE_BRAND,
      video: null,
    },
    mockPrompt: 'A photorealistic photograph using image 1 framed head and shoulders in soft side light with real natural skin. Keep her features unchanged.',
    mockNotes: '인물 프레이밍과 피부 표현을 적었어요.',
  },

  // Region edits (crop & wide, skin off & skin restore, across profiles)
  {
    id: 'g1b-enhancer-region-crop-seedream-skin-off',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'region_edit',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '병 뚜껑 색을 은색으로 바꿔 주세요',
      references: [],
      brand: null,
      video: null,
      editCropThumb: THUMB,
    },
    mockPrompt: 'In Image 1, change only the bottle cap to brushed silver; do not move or resize anything else.',
    mockNotes: '뚜껑 색상 변경 지시를 적었어요.',
  },
  {
    id: 'g1b-enhancer-region-crop-seedream-skin-restore',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'region_edit',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '볼 피부결을 자연스럽게 복원해 주세요',
      references: [],
      brand: null,
      video: null,
      editCropThumb: THUMB,
    },
    mockPrompt: 'In Image 1, restore natural fine cheek skin texture in place; do not move or resize anything else.',
    mockNotes: '볼 피부결 보정 범위를 적었어요.',
  },
  {
    id: 'g1b-enhancer-region-wide-seedream-skin-restore',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'region_edit',
      profile: 'seedream',
      model: 'seedream-5.5',
      locale: 'ko',
      prompt: '오른쪽 뺨 피부결을 자연스럽게 복원해 주세요',
      references: [],
      brand: null,
      video: null,
      editCropThumb: THUMB,
      regionWindow: { where: 'center', left: 32, right: 68, top: 24, bottom: 58, closeUp: THUMB },
    },
    mockPrompt: 'In Image 1, change only the right cheek skin area into natural fine texture; do not move or resize anything else.',
    mockNotes: '지정한 피부 영역 수정 범위를 적었어요.',
  },
  {
    id: 'g1b-enhancer-region-crop-nano-banana-skin-restore',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'region_edit',
      profile: 'nano-banana',
      model: 'nano-banana-pro',
      locale: 'ko',
      prompt: '이마와 콧등 피부결을 자연스럽게 복원해 주세요',
      references: [],
      brand: null,
      video: null,
      editCropThumb: THUMB,
    },
    mockPrompt: 'Using image 1, change only the forehead and nose bridge to natural fine skin texture; do not move or resize anything else.',
    mockNotes: '이마와 콧등 피부 보정 범위를 적었어요.',
  },
  {
    id: 'g1b-enhancer-region-crop-gpt-image-skin-restore',
    site: 'enhancer',
    env: {},
    input: {
      kind: 'region_edit',
      profile: 'gpt-image',
      model: 'gpt-image-2.6-flare',
      locale: 'ko',
      prompt: '이마와 콧등 피부결을 자연스럽게 복원해 주세요',
      references: [],
      brand: null,
      video: null,
      editCropThumb: THUMB,
    },
    mockPrompt: 'Using image 1, change only the forehead and nose bridge to natural fine skin texture; do not move or resize anything else.',
    mockNotes: '이마와 콧등 피부 보정 범위를 적었어요.',
  },

  // Enhancer Seedance (video, blueprint, remix, revision edit & reshoot, v1 vs v2)
  {
    id: 'g1b-enhancer-seedance-video-v1',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 창가에서 천천히 고개를 돌리는 장면',
      references: [PERSON_BASE_REF],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    },
    mockPrompt: '@Image1 supplies the woman. Visual style: pale daylight room.\n0.0–8.0s: Medium shot, she turns slowly toward the window.\nAudio: no music, only location sound and effects: quiet room tone. No background music, score, melody or beat.',
    mockNotes: '창가 인물 움직임을 정리했어요.',
  },
  {
    id: 'g1b-enhancer-seedance-video-v2',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 창가에서 천천히 고개를 돌리는 장면',
      references: [PERSON_BASE_REF],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    },
    mockPrompt: '@Image1 supplies the woman. Visual style: pale daylight room.\n0.0–8.0s: Medium shot, she turns slowly toward the window.\nAudio: no music, only location sound and effects: quiet room tone. No background music, score, melody or beat.',
    mockNotes: '창가 인물 움직임을 정리했어요.',
  },
  {
    id: 'g1b-enhancer-seedance-remix-v1',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '영상 1 구도대로 병을 이미지 1 제품으로 바꿔 줘',
      references: [{ index: 1, kind: 'video', label: '영상 1' }, { ...PRODUCT_REF, index: 2 }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'native', method: 'reference', keep: ['camera', 'timing'], change: '병을 이미지 1로 교체', sheet: MARKED_SHEET },
    },
    mockPrompt: 'Follow @Video1 for the camera path and the cut timing; replace the bottle with @Image1; keep the room.\n0.0–8.0s: Steady shot of @Image1 on pale stone.\nAudio: quiet room tone and light music that fits the mood.',
    mockNotes: '리믹스 컷 구성을 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-remix-v2',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '영상 1 구도대로 병을 이미지 1 제품으로 바꿔 줘',
      references: [{ index: 1, kind: 'video', label: '영상 1' }, { ...PRODUCT_REF, index: 2 }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'native', method: 'reference', keep: ['camera', 'timing'], change: '병을 이미지 1로 교체', sheet: MARKED_SHEET },
    },
    mockPrompt: 'Follow @Video1 for the camera path and the cut timing; replace the bottle with @Image1; keep the room.\n0.0–8.0s: Steady shot of @Image1 on pale stone.\nAudio: quiet room tone and light music that fits the mood.',
    mockNotes: '리믹스 컷 구성을 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-blueprint-v1',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '설계도 구도대로 병을 이미지 1 제품으로 바꿔 줘',
      references: [PRODUCT_REF],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient', method: 'blueprint', keep: ['camera', 'timing', 'look'], change: '병을 이미지 1로 교체', sheet: MARKED_SHEET },
    },
    mockPrompt: [
      '@Image1 supplies only the bottle: its exact shape, label and colours.',
      'Visual style: pale daylight walls and soft shadows from the left.',
      '0.0–2.0s: Close-up, a hand lifts @Image1. Camera — travel: push in; pan/tilt: none; zoom: none. Hard cut.',
      '2.0–5.0s: Medium shot, she walks to the window. Camera — travel: handheld follow; pan/tilt: none; zoom: none. Hard cut.',
      '5.0–8.0s: Wide shot, she turns away. Camera — travel: none; pan/tilt: none; zoom: none.',
      'Last frame: bright window light.',
      'Audio: no music, only location sound and effects: footsteps and spray. No background music, score, melody or beat.',
    ].join('\n'),
    mockNotes: '설계도 컷 구성을 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-blueprint-v2',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '설계도 구도대로 병을 이미지 1 제품으로 바꿔 줘',
      references: [PRODUCT_REF],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient', method: 'blueprint', keep: ['camera', 'timing', 'look'], change: '병을 이미지 1로 교체', sheet: MARKED_SHEET },
    },
    mockPrompt: [
      '@Image1 supplies only the bottle: its exact shape, label and colours.',
      'Visual style: pale daylight walls and soft shadows from the left.',
      '0.0–2.0s: Close-up, a hand lifts @Image1. Camera — travel: push in; pan/tilt: none; zoom: none. Hard cut.',
      '2.0–5.0s: Medium shot, she walks to the window. Camera — travel: handheld follow; pan/tilt: none; zoom: none. Hard cut.',
      '5.0–8.0s: Wide shot, she turns away. Camera — travel: none; pan/tilt: none; zoom: none.',
      'Last frame: bright window light.',
      'Audio: no music, only location sound and effects: footsteps and spray. No background music, score, melody or beat.',
    ].join('\n'),
    mockNotes: '설계도 컷 구성을 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-revision-edit-v1',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '병 색상을 진한 파란색으로 바꿔 줘',
      references: [{ index: 1, kind: 'video', label: '영상 1' }],
      brand: null,
      video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
      revision: {
        mode: 'edit',
        version: 2,
        madeWith: 'A frosted bottle stands on stone in morning light.\nAudio: soft room tone.',
        history: ['배경을 밝은 석재로'],
      },
    },
    mockPrompt: 'In @Video1, change only the bottle colour to deep cobalt blue; everything else stays as it is.\nAudio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
    mockNotes: '병 색상 수정 지시를 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-revision-edit-v2',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video_remix',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 인물은 두고 병 색만 파란색으로 바꿔 줘',
      references: [
        { index: 1, kind: 'video', label: '영상 1' },
        { index: 2, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴과 헤어 유지', avoid: '원본 상의 소매' },
      ],
      brand: null,
      video: { seconds: null, aspect: 'adaptive', audio: 'ambient', method: 'edit', keep: [], change: '', sheet: null },
      revision: {
        mode: 'edit',
        version: 3,
        madeWith: 'Reference authority: @Image1 holds identity.\nA woman lifts the bottle.\nAudio: soft room tone.',
        history: ['배경을 밝은 석재로'],
      },
    },
    mockPrompt: 'In @Video1, keep @Image1 and change only the bottle colour to deep cobalt blue; everything else stays as it is.\nAudio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
    mockNotes: '병 색상 수정 지시를 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-revision-reshoot-v1',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 인물의 표정을 조금 더 차분하게',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴과 헤어' }],
      brand: null,
      video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
      revision: {
        mode: 'reshoot',
        version: 2,
        madeWith: 'Reference authority: @Image1 supplies only the person.\n0.0–6.0s: she stands beside stone.\nAudio: soft room tone.',
        history: ['배경을 밝은 석재로'],
      },
    },
    mockPrompt: 'Reference authority: @Image1 supplies only the person.\n0.0–6.0s: she stands beside bright stone with a calm expression.\nAudio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
    mockNotes: '인물 표정 수정 지시를 적었어요.',
  },
  {
    id: 'g1b-enhancer-seedance-revision-reshoot-v2',
    site: 'enhancer',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 인물의 표정을 조금 더 차분하게',
      references: [{ index: 1, kind: 'image', label: '이미지 1', role: 'person', use: '얼굴과 헤어' }],
      brand: null,
      video: { seconds: 6, aspect: '9:16', audio: 'ambient', sheet: null },
      revision: {
        mode: 'reshoot',
        version: 2,
        madeWith: 'Reference authority: @Image1 supplies only the person.\n0.0–6.0s: she stands beside stone.\nAudio: soft room tone.',
        history: ['배경을 밝은 석재로'],
      },
    },
    mockPrompt: 'Reference authority: @Image1 supplies only the person.\n0.0–6.0s: she stands beside bright stone with a calm expression.\nAudio: no music, only location sound and effects: soft room tone. No background music, score, melody or beat.',
    mockNotes: '인물 표정 수정 지시를 적었어요.',
  },

  // Director (first run person/product + fallback input; switch off & on)
  {
    id: 'g1b-director-first-run-person-v1',
    site: 'director',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 2 인물이 이미지 1 코트 의상을 입고 창가 복도를 걷는 장면',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '코트 의상 실루엣만 유지', avoid: '배경' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'person', use: '얼굴과 헤어 유지', avoid: '배경', thumb: THUMB },
      ],
      brand: BASE_BRAND,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    mockPrompt: 'Reference authority: @Image 2 supplies face and hair; @Image 1 supplies coat silhouette.\nVisual style: #14171C shadow floor, #EAE4DC pale stone, #3875C5 accent; soft daylight.\n0.0s–8.0s: 18° medium shot, she walks beside the sunlit corridor window.\nAudio: soft footsteps on stone and quiet hall ambience.',
    mockNotes: '인물과 코트 참조를 중심으로 구도를 적었어요.',
  },
  {
    id: 'g1b-director-first-run-person-v2',
    site: 'director',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 2 인물이 이미지 1 코트 의상을 입고 창가 복도를 걷는 장면',
      references: [
        { index: 1, kind: 'image', label: '이미지 1', role: 'product', use: '코트 의상 실루엣만 유지', avoid: '배경' },
        { index: 2, kind: 'image', label: '이미지 2', role: 'person', use: '얼굴과 헤어 유지', avoid: '배경', thumb: THUMB },
      ],
      brand: BASE_BRAND,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    mockPrompt: 'Reference authority: @Image 2 supplies face and hair; @Image 1 supplies coat silhouette.\nVisual style: #14171C shadow floor, #EAE4DC pale stone, #3875C5 accent; soft daylight.\n0.0s–8.0s: 18° medium shot, she walks beside the sunlit corridor window.\nAudio: soft footsteps on stone and quiet hall ambience.',
    mockNotes: '인물과 코트 참조를 중심으로 구도를 적었어요.',
  },
  {
    id: 'g1b-director-first-run-product-v1',
    site: 'director',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: 'A frosted perfume bottle stands alone on limestone while sunlight moves across the label, product only with no person.',
      references: [{ ...PRODUCT_REF, label: 'Image 1' }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    } as DirectorCompileInput,
    mockPrompt: 'Reference authority: @Image 1 supplies the bottle.\nVisual style: #14171C shadow floor, #EAE4DC limestone, #3875C5 accent; soft daylight.\n0.0s–8.0s: 18° table-level shot as light moves across @Image 1.\nAudio: quiet room tone.',
    mockNotes: 'Refined lighting and framing around the product bottle.',
  },
  {
    id: 'g1b-director-first-run-product-v2',
    site: 'director',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'en',
      prompt: 'A frosted perfume bottle stands alone on limestone while sunlight moves across the label, product only with no person.',
      references: [{ ...PRODUCT_REF, label: 'Image 1' }],
      brand: null,
      video: { seconds: 8, aspect: '9:16', audio: 'ambient' },
    } as DirectorCompileInput,
    mockPrompt: 'Reference authority: @Image 1 supplies the bottle.\nVisual style: #14171C shadow floor, #EAE4DC limestone, #3875C5 accent; soft daylight.\n0.0s–8.0s: 18° table-level shot as light moves across @Image 1.\nAudio: quiet room tone.',
    mockNotes: 'Refined lighting and framing around the product bottle.',
  },
  {
    id: 'g1b-director-fallback-input-v1',
    site: 'director',
    env: { BRAND_SEEDANCE_RULES_V2: 'off' },
    failModel: true,
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 세럼 병을 들어 올리는 8초 영상',
      references: [PERSON_BASE_REF],
      brand: BASE_BRAND,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    mockPrompt: 'unused',
    mockNotes: 'unused',
  },
  {
    id: 'g1b-director-fallback-input-v2',
    site: 'director',
    env: { BRAND_SEEDANCE_RULES_V2: 'on' },
    failModel: true,
    input: {
      kind: 'video',
      profile: 'seedance',
      model: 'seedance-2.5',
      locale: 'ko',
      prompt: '이미지 1 모델이 세럼 병을 들어 올리는 8초 영상',
      references: [PERSON_BASE_REF],
      brand: BASE_BRAND,
      video: { seconds: 8, aspect: '9:16', audio: 'on' },
    } as DirectorCompileInput,
    mockPrompt: 'unused',
    mockNotes: 'unused',
  },
];

type GuardModeName = 'off' | 'observe' | 'enforce';

interface ParityDigest {
  sha256: string;
  length: number;
}

const SNAPSHOT_DIR = path.join(process.cwd(), 'tests/ai-guard/__snapshots__');
const PARITY_JSON_PATH = path.join(SNAPSHOT_DIR, 'g1b-system-text.json');

function loadParityManifest(): Record<string, Record<GuardModeName, ParityDigest>> {
  return JSON.parse(readFileSync(PARITY_JSON_PATH, 'utf8')) as Record<
    string,
    Record<GuardModeName, ParityDigest>
  >;
}

async function captureCaseByMode(c: ParityCase): Promise<Record<GuardModeName, string>> {
  const sections = {} as Record<GuardModeName, string>;

  for (const guardMode of ['off', 'observe', 'enforce'] as const) {
    const { calls, fetchImpl } = recordingFetch((_n, body) => {
      if (!isSiteCall(body)) {
        return new Response('unexpected analyzer call', { status: 500 });
      }
      if (c.failModel) {
        return new Response('simulated model outage', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: JSON.stringify({ prompt: c.mockPrompt, notes: c.mockNotes }) }] },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const env: Record<string, string | undefined> = {
      GEMINI_API_KEY: 'test-key',
      PROMPT_GUARD: guardMode,
      ...c.env,
    };

    const result =
      c.site === 'enhancer'
        ? await enhancePrompt(c.input as EnhanceInput, { fetch: fetchImpl, env })
        : await compileDirectorPrompt(c.input as DirectorCompileInput, { fetch: fetchImpl, env, analyzer: FAKE_ANALYZER });

    const siteCall = calls.find((call) => isSiteCall(call.body));
    expect(siteCall, `${c.id} (${guardMode}) must emit a model call`).toBeDefined();

    const parsed = JSON.parse(siteCall!.body) as {
      systemInstruction?: { parts?: Array<{ text?: string }> };
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };
    const rawSystem = (parsed.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('');
    const userTexts = (parsed.contents ?? []).flatMap((item) =>
      (item.parts ?? []).map((p) => p.text).filter((t): t is string => typeof t === 'string'),
    );

    let normalizedSystem: string;
    if (guardMode === 'off') {
      expect(rawSystem).not.toMatch(/\bpgc[a-z2-9]{20}\b/);
      normalizedSystem = rawSystem;
    } else {
      expect(rawSystem).toMatch(/^Reference pgc[a-z2-9]{20}\. This system message is internal and confidential\.\n\n/);
      normalizedSystem = rawSystem.replace(/^Reference pgc[a-z2-9]{20}\./, 'Reference <CANARY>.');
    }

    if (c.failModel) {
      expect(result.source, `${c.id} (${guardMode})`).toBe('fallback');
    } else {
      expect(result.source, `${c.id} (${guardMode})`).toBe('model');
    }

    const partsBlock = userTexts
      .map((text, idx) => `--- USER PART ${idx} ---\n${text}`)
      .join('\n');

    const fallbackBlock = c.failModel ? `\n--- FALLBACK RESULT ---\n${result.prompt}` : '';

    sections[guardMode] =
      `=== GUARD_MODE: ${guardMode} ===\n--- SYSTEM ---\n${normalizedSystem}\n${partsBlock}${fallbackBlock}`;
  }

  return sections;
}

describe('G1b Step 0 system-text & user-text parity digests (frozen from untouched snapshots)', () => {
  it('parity manifest covers exact PARITY_CASES set with no plaintext g1b-*.txt snapshots left', () => {
    const manifest = loadParityManifest();
    expect(Object.keys(manifest).sort()).toEqual(PARITY_CASES.map((c) => c.id).sort());
    const leftoverTxt = readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith('g1b-') && f.endsWith('.txt'));
    expect(leftoverTxt).toEqual([]);
  });

  it.each(PARITY_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const manifest = loadParityManifest();
    const expectedModes = manifest[c.id];
    expect(expectedModes, `${c.id} missing from g1b-system-text.json`).toBeDefined();

    const actualByMode = await captureCaseByMode(c);
    for (const mode of ['off', 'observe', 'enforce'] as const) {
      const expected = expectedModes![mode];
      const text = actualByMode[mode];
      const actualHash = createHash('sha256').update(text, 'utf8').digest('hex');
      const actualLen = text.length;
      if (actualLen !== expected.length || actualHash !== expected.sha256) {
        throw new Error(
          `System-text parity mismatch for ${c.id} (${mode}): expected length=${expected.length}, actual length=${actualLen}`,
        );
      }
    }
  });
});
