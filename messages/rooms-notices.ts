/**
 * Project room notices — mail, push and the unsubscribe page (docs/BRAND-ROOMS-FEEDBACK.md §2, §9).
 * Wired into the dictionaries as `roomsNotices`, read by lib/brand-rooms/notices.ts and
 * lib/notify/unsubscribe-page.ts.
 *
 * 초안 — 대표 확정 전. These are provisional strings for the plumbing (slice N2): outbound copy needs the
 * founder's approval (AGENTS.md §5), and with `BRAND_ROOM_NOTIFY` off nothing here is ever sent. Slice N4
 * replaces them with the approved wording. Rules kept even in the draft: no internal tool names, no
 * prices, no promised response times, no "reply to this email" (replies are not delivered).
 */
export const roomsNoticesEn = {
  email: {
    subject: 'News on {project}',
    subjectIntake: 'We got your request: {project}',
    subjectGeneral: 'News in General · {organization}',
    title: 'News on {project}',
    titleIntake: 'We got your request',
    titleGeneral: 'News in General',
    lines: {
      newVersion: 'The YAGI team posted a draft: {title} v{version}',
      storyboard: 'The YAGI team shared a storyboard: {title} v{version}',
      teamMessage: 'Message from {name}: {excerpt}',
      teamReply: 'Reply from {name} on {title}: {excerpt}',
      teamReplyBare: '{name} replied on {title}',
      mention: '{name} mentioned you: {excerpt}',
      intake: 'Your request "{project}" is in. You can follow it in the project.',
    },
    more: 'and {count} more',
    files: 'Sent {count} files',
    team: 'YAGI team',
    teamAuthor: 'YAGI team · {name}',
    cta: 'Open project',
    note: 'You get this because you are part of this project.',
    stop: 'Stop project emails',
  },
  push: {
    many: '{count} updates',
    generalTitle: '{organization} · General',
  },
  unsubscribed: {
    title: 'Unsubscribed.',
    done: 'You will not get project emails from this organization any more.',
    reversible: 'Messages and updates are still there in the workspace.',
    open: 'Open messages',
  },
};

export const roomsNoticesKo: typeof roomsNoticesEn = {
  email: {
    subject: '{project}에 새 소식이 있어요',
    subjectIntake: '의뢰를 받았어요: {project}',
    subjectGeneral: '일반 문의에 새 소식이 있어요 · {organization}',
    title: '{project}에 새 소식이 있어요',
    titleIntake: '의뢰를 받았어요',
    titleGeneral: '일반 문의에 새 소식이 있어요',
    lines: {
      newVersion: '야기 팀이 시안을 올렸어요: {title} v{version}',
      storyboard: '야기 팀이 스토리보드를 공유했어요: {title} v{version}',
      teamMessage: '{name}의 메시지: {excerpt}',
      teamReply: '{title} 의견에 {name} 답글: {excerpt}',
      teamReplyBare: '{title} 의견에 {name} 답글이 달렸어요',
      mention: '대화에서 나를 불렀어요 · {name}: {excerpt}',
      intake: '"{project}" 의뢰를 받았어요. 진행 상황은 프로젝트에서 볼 수 있어요.',
    },
    more: '외 {count}건',
    files: '파일 {count}개',
    team: '야기 팀',
    teamAuthor: '야기 팀 · {name}',
    cta: '프로젝트에서 보기',
    note: '이 프로젝트에 참여하고 있어 보내 드렸어요.',
    stop: '프로젝트 메일 그만 받기',
  },
  push: {
    many: '새 소식 {count}건',
    generalTitle: '{organization} · 일반 문의',
  },
  unsubscribed: {
    title: '수신을 해제했어요.',
    done: '이 조직의 프로젝트 메일을 더 보내지 않아요.',
    reversible: '메시지와 새 소식은 워크스페이스에서 계속 볼 수 있어요.',
    open: '메시지 열기',
  },
};
