/**
 * Deterministic genre classifier for Seedance 2.5 camera direction (docs/SEEDANCE-BRIDGE-2026-11-26.md SB-2).
 *
 * Splits requests into two camera families without imposing a global camera lock:
 *  - `'editorial'` (default): only STRONG editorial words (`editorial` / `에디토리얼`, `lookbook` / `룩북`,
 *    `화보`, `still life` / `정물`) override an explicit moving-camera cue. Weak editorial hints (`fashion` /
 *    `패션`, `beauty` / `뷰티`, `portrait` / `포트레이트`, `campaign` / `캠페인`, `minimalist`, `stillness`,
 *    `product only`) never override moving-camera cues; they lead to editorial only when no moving cue is present.
 *  - `'dynamic'`: explicit action scenes, music videos, fantasy, chase, pursuit, sports matches, or kinetic
 *    camera requests -> moving camera (Steadicam tracking, camera crane, orbital arc, FPV push-in) with
 *    explicit start, path, and end.
 */

export type DirectorCameraGenre = 'dynamic' | 'editorial';

export const DYNAMIC_CAMERA_KEYWORDS_EN: readonly string[] = [
  'action scene',
  'action sequence',
  'action film',
  'action movie',
  'action shot',
  'music video',
  'mv',
  'fantasy',
  'chase',
  'pursuit',
  'stunt',
  'parkour',
  'combat',
  'fight scene',
  'fight sequence',
  'battle scene',
  'battle sequence',
  'thriller',
  'sci-fi',
  'sports action',
  'sprint',
  'leap',
  'soaring',
  'steadicam',
  'camera crane',
  'crane sweep',
  'crane rise',
  'crane camera',
  'orbital arc',
  'fpv',
  'whip-pan',
  'tracking shot',
  'dance performance',
];

export const DYNAMIC_CAMERA_KEYWORDS_KO: readonly string[] = [
  '액션 씬',
  '액션 장면',
  '액션 시퀀스',
  '액션 영화',
  '와이어 액션',
  '뮤직비디오',
  '뮤직 비디오',
  '뮤비',
  '판타지',
  '추격',
  '추격전',
  '질주',
  '전력 질주',
  '전투',
  '격투',
  '스턴트',
  '댄스 퍼포먼스',
  '무대 퍼포먼스',
  '라이브 퍼포먼스',
  '콘서트',
  '스포츠 경기',
  '스포츠 액션',
  '파쿠르',
  '와이어 스턴트',
  '달려가',
  '달리는',
  '달리기',
  '뛰어가',
  '뛰어내리',
  '스테디캠',
  '카메라 크레인',
  '크레인 상승',
  '크레인 스윕',
  '오비탈',
  '트래킹 샷',
  '휩 팬',
];

export const STRONG_EDITORIAL_CAMERA_KEYWORDS_EN: readonly string[] = [
  'editorial',
  'lookbook',
  'still life',
];

export const STRONG_EDITORIAL_CAMERA_KEYWORDS_KO: readonly string[] = [
  '에디토리얼',
  '룩북',
  '화보',
  '정물',
];

export const WEAK_EDITORIAL_CAMERA_KEYWORDS_EN: readonly string[] = [
  'fashion',
  'beauty',
  'portrait',
  'campaign',
  'minimalist',
  'stillness',
  'product only',
];

export const WEAK_EDITORIAL_CAMERA_KEYWORDS_KO: readonly string[] = [
  '패션',
  '뷰티',
  '포트레이트',
  '캠페인',
];

export const EDITORIAL_CAMERA_KEYWORDS_EN: readonly string[] = [
  ...STRONG_EDITORIAL_CAMERA_KEYWORDS_EN,
  ...WEAK_EDITORIAL_CAMERA_KEYWORDS_EN,
];

export const EDITORIAL_CAMERA_KEYWORDS_KO: readonly string[] = [
  ...STRONG_EDITORIAL_CAMERA_KEYWORDS_KO,
  ...WEAK_EDITORIAL_CAMERA_KEYWORDS_KO,
];

const STRONG_EDITORIAL_EN_RE = /\b(?:editorial|lookbook|still\s+life)\b/i;

const STRONG_EDITORIAL_KO_RE = /(?<![가-힣])(?:에디토리얼|룩북|화보|정물)/;

const WEAK_EDITORIAL_EN_RE =
  /\b(?:fashion|beauty|portrait|campaign|minimalist|stillness|product\s+only)\b/i;

const WEAK_EDITORIAL_KO_RE = /(?<![가-힣])(?:패션|뷰티|포트레이트|캠페인)/;

const DYNAMIC_EN_RE =
  /\b(?:action\s+(?:scene|sequence|film|movie|shot)|(?:stunt|fight)\s+action|music\s+video|mv|fantasy|chase|pursuit|stunts?|parkour|combat|(?:fight|battle)\s+(?:scene|sequence)|sword\s+(?:fight|battle|combat)|dance\s+(?:battle|performance|sequence|video|routine)|thriller|sci-fi|sports\s+(?:action|match|race)|extreme\s+sports|sprint(?:ing|s)?|leap(?:ing|s)?|gallop(?:ing|s)?|soar(?:ing|s)?|steadicam|camera\s+crane|crane\s+(?:sweep|rise|camera|move(?:ment)?)|orbital\s+arc|fpv|whip[- ]?pan|tracking\s+shot|car\s+chase|stage\s+performance|concert)\b/i;

// Note: require Korean left boundaries and qualifiers so substrings like "와이어리스", "리액션",
// "스포츠웨어", adverb "달리", and unqualified "퍼포먼스 마케팅" stay editorial while inflected verbs/particles still work.
const DYNAMIC_KO_RE =
  /(?<![가-힣])(?:(?<!콜\s*투\s*)액션\s*(?:씬|장면|시퀀스|영화|촬영)|(?:와이어|무협|스턴트|추격)\s*액션|뮤직\s*비디오|뮤비|판타지|추격전?|전력\s*질주|질주|전투|격투|스턴트|(?:댄스|무대|라이브|액션|아크로바틱)\s*퍼포먼스|콘서트|댄스\s*(?:퍼포먼스|배틀|비디오|영상|안무|씬)|스포츠\s*(?:경기|액션|대회|시합|질주|추격|촬영)|파쿠르|와이어\s*(?:액션|스턴트|촬영)|달려가|달리는|달리기|뛰어가|뛰어내리|스테디캠|카메라\s*크레인|크레인\s*(?:상승|스윕|무브|카메라)|오비탈|트래킹\s*샷|휩\s*팬|달리\s*(?:샷|인|아웃))/;

/**
 * Classifies a prompt into `'editorial'` or `'dynamic'`.
 * Only strong editorial cues override moving-camera cues; weak hints (`campaign`, `fashion`, `beauty`,
 * `portrait`) indicate editorial only when no moving-camera cue is present; default is `'editorial'`.
 */
export function guessDirectorCameraGenre(text: string): DirectorCameraGenre {
  const normalized = text.trim();
  if (!normalized) return 'editorial';
  if (STRONG_EDITORIAL_EN_RE.test(normalized) || STRONG_EDITORIAL_KO_RE.test(normalized)) {
    return 'editorial';
  }
  if (DYNAMIC_EN_RE.test(normalized) || DYNAMIC_KO_RE.test(normalized)) {
    return 'dynamic';
  }
  if (WEAK_EDITORIAL_EN_RE.test(normalized) || WEAK_EDITORIAL_KO_RE.test(normalized)) {
    return 'editorial';
  }
  return 'editorial';
}
