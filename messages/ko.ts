import type { Dictionary } from './en';

/** PLAN §3.9 — manual bilingual authoring in v1; the type keeps the two dictionaries in step. */
export const ko: Dictionary = {
  meta: {
    siteName: 'PLAYBOOK',
    tagline: 'AI 스튜디오의 작업실을 그대로 공개합니다.',
  },
  nav: {
    library: '라이브러리',
    pricing: '요금제',
    account: '내 계정',
    admin: '관리자',
    localeToggle: '언어',
    localeEn: 'EN',
    localeKo: 'KO',
    menu: '메뉴',
    close: '닫기',
  },
  auth: {
    signIn: '로그인',
    signOut: '로그아웃',
    startWithGoogle: 'Google로 시작하기',
    continueWithGoogle: 'Google로 계속하기',
    signedInAs: '로그인 계정',
    signInRequired: '라이브러리는 로그인 후 볼 수 있습니다.',
    adminOnly: '관리자 전용입니다.',
  },
  plan: {
    free: '무료',
    pro: '프로',
    upgrade: '모든 프롬프트 열기 — 월 $9',
    locked: '프로로 열기',
    lockedPrompt: '프롬프트 — 프로로 열기',
    lockedParams: '파라미터 — 프로로 열기',
    lockedWorkflow: '워크플로 파일 — 프로로 열기',
  },
  footer: {
    hireCta: '스튜디오와 함께 작업하기',
    advertise: '광고 문의',
    rights: 'YAGI Workshop',
    privacy: '개인정보',
    terms: '이용약관',
  },
  ad: {
    placeholder: 'YOUR AD HERE',
    contact: 'advertise@yagiworkshop.xyz',
  },
};
