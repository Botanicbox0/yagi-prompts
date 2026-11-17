/**
 * Project room notices — mail, push, the settings in the inbox and the page after unsubscribing
 * (docs/BRAND-ROOMS-FEEDBACK.md §2, §10). Wired into the dictionaries as `roomsNotices`, read by
 * lib/brand-rooms/notices.ts, lib/notify/unsubscribe-page.ts and components/brand-rooms/chat/notice-settings.tsx.
 *
 * Confirmed by the founder on 2026-11-18 (docs §10.2 Korean, §10.3 English): every string here is the
 * approved wording, character for character. Do not edit, shorten or add a sentence without a new
 * founder decision (AGENTS.md §5, outbound copy). Nothing is sent while `BRAND_ROOM_NOTIFY` is off.
 *
 * One mail is one kind (§10.1). `{project}` is the project's title, or the general conversation's name
 * (`roomsChat.inbox.general`). `{name}` is the author label below. The replies kind is the bundled mail
 * of the team's conversation lines and draft replies; `{count}` is how many it carries.
 */
export const roomsNoticesEn = {
  kinds: {
    newVersion: {
      subject: 'New version of {title} for {project}',
      heading: 'A new version of {title} is ready.',
      body: 'The YAGI team has uploaded version {version}. Please review it and share your feedback.',
      button: 'Review Draft',
      pushTitle: 'New Draft Ready',
      pushBody: 'Check out version {version} of {title} in {project}.',
    },
    storyboard: {
      subject: 'Storyboard shared for {project}',
      heading: 'Your storyboard for {title} is ready.',
      body: 'The YAGI team has shared the storyboard outlining the project direction. Please take a look.',
      button: 'View Storyboard',
      pushTitle: 'Storyboard Shared',
      pushBody: 'The storyboard for {title} in {project} is now available.',
    },
    replies: {
      subject: '{count} unread messages in {project}',
      heading: 'You have new messages from the YAGI team.',
      body: 'There are {count} unread replies and messages.',
      button: 'View Messages',
      pushTitle: '{count} New Messages',
      pushBody: 'You have {count} new messages from the YAGI team in {project}.',
      /**
       * Used only when `{count}` is exactly 1: the singular of the confirmed sentences above and nothing
       * else (docs §10.3, 2026-11-18). `{count}` stays in so both languages keep the same placeholders.
       */
      one: {
        subject: '{count} unread message in {project}',
        body: 'There is {count} unread reply or message.',
        pushTitle: '{count} New Message',
        pushBody: 'You have {count} new message from the YAGI team in {project}.',
      },
    },
    mention: {
      subject: '{name} mentioned you in {project}',
      heading: '{name} mentioned you',
      body: '{name} mentioned you in the project conversation. Please check the message.',
      button: 'Go to Chat',
      pushTitle: 'You were mentioned',
      pushBody: '[{project}] {name} mentioned you',
    },
    /** No push for the receipt (§2.1). */
    intakeReceived: {
      subject: 'Request received for {project}',
      heading: 'Your request has been submitted.',
      body: 'The YAGI team is reviewing your requirements.',
      button: 'View Request',
    },
  },
  /** Who wrote a quoted line (§10.1): the team, a team member by name; a brand member is their own name. */
  author: {
    team: 'YAGI team',
    teamMember: 'YAGI team · {name}',
  },
  footer: {
    text: 'This is a project notification. You can manage your notification settings in the workspace.',
    stop: 'Unsubscribe',
  },
  /** The inbox's settings section (`/brand/rooms`). */
  settings: {
    title: 'Notification settings',
    email: 'Email notifications',
    emailHelp: 'Get emails for new drafts, storyboards, messages, and mentions.',
    push: 'Push notifications',
    pushHelp: 'Get notifications on your current browser.',
    blocked: 'Please allow notifications in your browser settings.',
    unsupported: 'This browser does not support notifications.',
    saved: 'Saved',
    error: 'Failed to save. Please try again.',
  },
  /** The page the mail's unsubscribe link opens. */
  unsubscribed: {
    title: 'Email notifications turned off',
    body: 'You will no longer receive project emails from this brand. You can turn them back on in notification settings.',
    link: 'Go to notification settings',
  },
};

export const roomsNoticesKo: typeof roomsNoticesEn = {
  kinds: {
    newVersion: {
      subject: '[{project}] {title} 새 시안이 도착했어요',
      heading: '{title}의 새 버전이 올라왔습니다.',
      body: '야기 팀이 {version}번째 시안을 준비했어요. 확인하고 의견을 남겨주세요.',
      button: '시안 확인하기',
      pushTitle: '새 시안 도착',
      pushBody: '[{project}] {title}의 {version}번째 시안을 확인해 보세요.',
    },
    storyboard: {
      subject: '[{project}] 스토리보드가 공유되었습니다',
      heading: '{title} 스토리보드를 확인해 보세요.',
      body: '야기 팀이 작업 방향을 담은 스토리보드를 올렸습니다. 내용을 검토해 주세요.',
      button: '스토리보드 보기',
      pushTitle: '스토리보드 공유',
      pushBody: '[{project}] {title}의 스토리보드가 도착했습니다.',
    },
    replies: {
      subject: '[{project}] 읽지 않은 메시지가 {count}건 있어요',
      heading: '야기 팀의 메시지를 확인해 주세요.',
      body: '아직 확인하지 않은 의견과 답글이 {count}건 있습니다.',
      button: '메시지 확인하기',
      pushTitle: '새 메시지 {count}건',
      pushBody: '[{project}] 야기 팀이 보낸 메시지가 {count}건 있습니다.',
      /** Korean has no singular form: the same sentences (the dictionary needs the keys in both languages). */
      one: {
        subject: '[{project}] 읽지 않은 메시지가 {count}건 있어요',
        body: '아직 확인하지 않은 의견과 답글이 {count}건 있습니다.',
        pushTitle: '새 메시지 {count}건',
        pushBody: '[{project}] 야기 팀이 보낸 메시지가 {count}건 있습니다.',
      },
    },
    mention: {
      subject: '[{project}] {name}님이 불렀어요',
      heading: '{name}님이 불렀어요',
      body: '{name}님이 프로젝트 대화에서 불렀어요. 내용을 확인해 주세요.',
      button: '대화 바로가기',
      pushTitle: '나를 불렀어요',
      pushBody: '[{project}] {name}님이 불렀어요',
    },
    intakeReceived: {
      subject: '[{project}] 의뢰가 접수되었습니다',
      heading: '요청하신 내용이 잘 전달되었습니다.',
      body: '야기 팀이 보내주신 의뢰 내용을 확인하고 있습니다.',
      button: '내 의뢰 확인하기',
    },
  },
  author: {
    team: '야기 팀',
    teamMember: '야기 팀 · {name}',
  },
  footer: {
    text: '이 메일은 프로젝트 진행 알림이며, 알림 설정에서 수신 여부를 변경할 수 있습니다.',
    stop: '수신 거부',
  },
  settings: {
    title: '알림 설정',
    email: '이메일 알림',
    emailHelp: '새 시안, 스토리보드, 메시지, 멘션 알림을 메일로 보내드려요.',
    push: '푸시 알림',
    pushHelp: '현재 사용 중인 브라우저에서 알림을 보내드려요.',
    blocked: '브라우저 설정에서 알림을 허용해 주세요.',
    unsupported: '이 브라우저는 알림을 지원하지 않아요.',
    saved: '저장됐어요',
    error: '저장하지 못했어요. 다시 시도해 주세요.',
  },
  unsubscribed: {
    title: '메일 수신을 거부했습니다',
    body: '이제 이 브랜드의 프로젝트 메일은 발송되지 않아요. 다시 받으려면 알림 설정에서 켤 수 있어요.',
    link: '알림 설정으로 가기',
  },
};

export type RoomsNoticesCopy = typeof roomsNoticesEn;
export type RoomNoticeSettingsCopy = RoomsNoticesCopy['settings'];
