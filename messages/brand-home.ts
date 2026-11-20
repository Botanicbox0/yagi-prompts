/**
 * The workspace home copy (`/brand/home`, docs/BRAND-STUDIO-V3.md §12). Wired into the dictionaries as
 * `brandHome`. Both languages live here so one owner edits one file.
 *
 * Only what is new lives here. The card names, the two group labels, the credits sentence and the
 * "waiting for your review" lines are the rail's and the inbox's own strings (`studioShell`,
 * `roomsShell.nav`, `roomsChat.inbox`), so a place is called the same thing everywhere.
 *
 * Wording: local Gemma 4, two passes (2026-11-19, AGENTS.md §2, twice: the first home and the v2 prompt
 * bar, starters and team tile), checked against what each screen does today. Where pass 2 dropped a fact
 * or got vaguer, the pass-1 line is used (compose, workflows, viewer note); role names are the members
 * page's own (워크스페이스 관리자 · 편집자). Two lines were corrected for facts: the prompt hint says credits
 * are used ONLY when 만들기 is pressed in a studio, and the projects line no longer says "in progress" (the
 * list holds finished projects too). The starter sentences describe exactly the house frame beside them.
 */
export const brandHomeEn = {
  nav: {
    home: 'Home',
  },
  title: 'Home',
  heading: '{name} Workspace',
  lines: {
    image: 'Create images with text and product photos.',
    video: 'Create short videos from text or images.',
    sound: 'Create background music from text.',
    compose: 'Edit clips and export them as one video.',
    workflows: 'Save successful workflows as reusable templates.',
    assets: 'Manage brand files and results in one place.',
    commission: 'Send a brief to the YAGI team for production.',
    campaign: 'Request a creator campaign or video production.',
    projects: "Check the projects you've handed to the YAGI team.",
  },
  prompt: {
    button: 'Open Studio',
    hint: 'Credits are used only when you click Create in the studio.',
    medium: { image: 'Image', video: 'Video' },
  },
  exampleBadge: 'Example',
  starters: {
    title: 'Try these examples',
    product: { name: 'Product shot', prompt: 'A white floral perfume bottle and a glass of water on wrinkled light blue satin, with strong sunlight and sharp shadows.' },
    look: { name: 'Fashion shot', prompt: 'A full-body fashion photo of a model wearing a cobalt blue cropped jacket and navy wide pants against a light grey background.' },
    film: { name: 'Product video', prompt: 'A video of a model with closed eyes holding a blue glass perfume bottle near their face against a light blue background, with a slow camera zoom-in.' },
  },
  continueTitle: 'Continue',
  recentTitle: 'Recent work',
  reviewMore: 'View all {count} items',
  viewerNote: 'Only workspace admins or editors can create and send requests.',
  result: {
    image: 'Open image result',
    video: 'Open video result',
  },
};

export const brandHomeKo: typeof brandHomeEn = {
  nav: {
    home: '홈',
  },
  title: '홈',
  heading: '{name} 작업공간',
  lines: {
    image: '텍스트와 제품 사진으로 이미지를 만들어요.',
    video: '텍스트나 이미지로 짧은 영상을 만들어요.',
    sound: '글로 설명해서 배경 음악을 만들어요.',
    compose: '영상 클립을 편집해 한 편의 영상으로 내보내요.',
    workflows: '잘 나온 작업 방식을 템플릿으로 저장해 써요.',
    assets: '브랜드 파일과 작업 결과물을 한곳에서 관리해요.',
    commission: '요청 사항을 적어 야기 팀에 제작을 맡겨요.',
    campaign: '크리에이터 캠페인이나 영상 제작을 의뢰해요.',
    projects: '야기 팀에 맡긴 프로젝트를 확인하세요.',
  },
  prompt: {
    button: '스튜디오로 이동',
    hint: '크레딧은 스튜디오에서 만들기를 누를 때만 사용돼요.',
    medium: { image: '이미지', video: '영상' },
  },
  exampleBadge: '예시',
  starters: {
    title: '이렇게 시작해 보세요',
    product: { name: '제품 사진', prompt: '주름진 연파란색 새틴 천 위, 강한 햇빛이 비치는 꽃무늬 흰색 향수병과 물잔' },
    look: { name: '패션 사진', prompt: '옅은 회색 배경 앞에서 코발트 블루 크롭 재킷과 네이비 와이드 팬츠를 입은 모델의 전신 사진' },
    film: { name: '제품 영상', prompt: '하늘색 배경 앞에서 모델이 눈을 감고 파란 유리 향수병을 얼굴 가까이 든 모습으로 카메라가 천천히 다가가는 영상' },
  },
  continueTitle: '이어서 하기',
  recentTitle: '최근 작업물',
  reviewMore: '{count}개 작업물 모두 보기',
  viewerNote: '워크스페이스 관리자나 편집자 권한이 있어야 만들기와 의뢰가 가능해요.',
  result: {
    image: '이미지 결과 열기',
    video: '영상 결과 열기',
  },
};

export type BrandHomeCopy = typeof brandHomeEn;
