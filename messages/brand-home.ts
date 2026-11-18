/**
 * The workspace home copy (`/brand/home`, docs/BRAND-STUDIO-V3.md §12). Wired into the dictionaries as
 * `brandHome`. Both languages live here so one owner edits one file.
 *
 * Only what is new lives here. The card names, the two group labels, the credits sentence and the
 * "waiting for your review" lines are the rail's and the inbox's own strings (`studioShell`,
 * `roomsShell.nav`, `roomsChat.inbox`), so a place is called the same thing everywhere.
 *
 * Wording: local Gemma 4, two passes (2026-11-19, AGENTS.md §2), checked against what each screen does
 * today. Where pass 2 dropped a fact or got vaguer, the pass-1 line is used (compose, workflows, viewer
 * note); role names are the members page's own (워크스페이스 관리자 · 편집자).
 */
export const brandHomeEn = {
  nav: {
    home: 'Home',
  },
  title: 'Home',
  heading: '{name} Workspace',
  actionsTitle: 'Available actions',
  lines: {
    image: 'Create images with text and product photos.',
    video: 'Create short videos from text or images.',
    compose: 'Edit clips and export them as one video.',
    workflows: 'Save successful workflows as reusable templates.',
    assets: 'Manage brand files and results in one place.',
    commission: 'Send a brief to the YAGI team for production.',
    campaign: 'Request a creator campaign or video production.',
  },
  continueTitle: 'Continue',
  recentTitle: 'Recent work',
  reviewMore: 'View all {count} items',
  emptyLine: 'Pending reviews and recent results will appear here.',
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
  actionsTitle: '할 수 있는 일',
  lines: {
    image: '텍스트와 제품 사진으로 이미지를 만들어요.',
    video: '텍스트나 이미지로 짧은 영상을 만들어요.',
    compose: '영상 클립을 편집해 한 편의 영상으로 내보내요.',
    workflows: '잘 나온 작업 방식을 템플릿으로 저장해 써요.',
    assets: '브랜드 파일과 작업 결과물을 한곳에서 관리해요.',
    commission: '요청 사항을 적어 야기 팀에 제작을 맡겨요.',
    campaign: '크리에이터 캠페인이나 영상 제작을 의뢰해요.',
  },
  continueTitle: '이어서 하기',
  recentTitle: '최근 작업물',
  reviewMore: '{count}개 작업물 모두 보기',
  emptyLine: '확인할 작업물과 최근 결과물이 여기에 표시돼요.',
  viewerNote: '워크스페이스 관리자나 편집자 권한이 있어야 만들기와 의뢰가 가능해요.',
  result: {
    image: '이미지 결과 열기',
    video: '영상 결과 열기',
  },
};

export type BrandHomeCopy = typeof brandHomeEn;
