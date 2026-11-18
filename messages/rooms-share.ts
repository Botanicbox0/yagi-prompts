/**
 * Project room sharing by invitation — the share dialog's people and link sections, the invitation mail
 * and the line on the acceptance page (docs/BRAND-ROOMS-FEEDBACK.md §12). Wired into the dictionaries as
 * `roomsShare`; read by components/brand-rooms/share/invite-dialog.tsx, lib/brand-rooms/invites.ts and
 * app/(brand)/brand/invite/page.tsx. Shown only while `BRAND_ROOM_INVITES` is on.
 *
 * The two link modes ("초대한 사람만", "링크가 있는 누구나") are the founder's names (2026-11-18). Every
 * other string is the house two-pass with local Gemma 4 (2026-11-18, `yagi-crm-gemma4:31b-q8_0`, both
 * passes ran), checked against the facts; §12 lists the two lines changed in that check. The invitation
 * mail is outbound copy: it is sent only once the founder turns the switch on.
 */
export const roomsShareKo = {
  people: {
    title: '사람 초대',
    scopeNote: '초대받은 사람은 이 프로젝트의 시안, 스토리보드, 대화를 확인할 수 있습니다.',
    emailLabel: '이메일',
    emailPlaceholder: '이메일을 입력하세요. 쉼표로 구분해 여러 명을 초대할 수 있습니다.',
    permissionLabel: '권한',
    permView: '보기',
    permComment: '의견 남기기',
    send: '초대하기',
    sending: '초대 보내는 중',
    sent: '{count}명에게 초대를 보냈습니다.',
    mailFailed: '일부 메일을 보내지 못했습니다. 아래 링크를 복사해 직접 전달해 주세요.',
    listTitle: '접근 가능한 사람',
    memberTag: '멤버',
    guestTag: '게스트',
    noEmail: '이메일 없음',
    remove: '내보내기',
    removeConfirm: '{name}님을 이 프로젝트에서 내보낼까요?',
    pending: '{days}일 후 만료',
    pendingToday: '오늘 만료',
    failed: '전송 실패',
    resend: '다시 보내기',
    cancel: '초대 취소',
    cancelConfirm: '{email}님의 초대를 취소할까요?',
    copyLink: '링크 복사',
    copied: '링크를 복사했습니다.',
    empty: '초대한 사람이 없습니다.',
    errors: {
      email: '{email}은(는) 유효한 이메일 주소가 아닙니다.',
      too_many: '한 번에 최대 10명까지 초대할 수 있습니다.',
      rate_limited: '오늘 보낼 수 있는 초대 횟수를 모두 사용했습니다.',
      project_limit: '수락 대기 중인 초대가 너무 많아 초대를 더 보낼 수 없습니다.',
      already_member: '{email}님은 이미 브랜드 멤버입니다.',
    },
  },
  link: {
    title: '링크 공유',
    invited: '초대한 사람만',
    anyone: '링크가 있는 누구나',
    invitedHelp: '초대한 사람만 로그인해서 볼 수 있습니다.',
    anyoneHelp: '로그인 없이 누구나 이 작업 하나만 확인할 수 있습니다.',
    recommend: '보안을 위해 만료일과 암호를 설정해 주세요.',
    create: '링크 만들기',
    offConfirm: "'초대한 사람만'으로 변경하면 기존 링크가 즉시 꺼집니다. 변경하시겠어요?",
    offOk: '변경하기',
    offCancel: '취소',
  },
  mail: {
    subject: '{inviter}님이 {project} 프로젝트에 초대했습니다.',
    heading: '{organization}의 {project} 프로젝트에 초대받았습니다.',
    body: '{inviter}님이 초대를 보냈습니다. 아래 버튼을 눌러 로그인하면 시안과 스토리보드를 확인할 수 있습니다.',
    bodyComment: '시안에 의견을 남길 수도 있습니다.',
    expiry: '이 링크는 {date}까지 유효합니다.',
    personal: '이 링크는 초대받은 분만 사용해 주세요.',
    button: '초대 수락하기',
    why: '{inviter}님이 프로젝트 협업을 위해 이 메일을 보냈습니다.',
  },
  accept: {
    login: '로그인 후 초대를 수락해 주세요. 작업공간 초대를 받으셨다면 초대받은 이메일로 로그인해야 합니다.',
    note: '현재 로그인한 계정으로 접속합니다. 초대한 사람이 이 계정 정보를 확인할 수 있습니다.',
  },
};

export const roomsShareEn: typeof roomsShareKo = {
  people: {
    title: 'Invite people',
    scopeNote: 'Invited people can view drafts, storyboards, and chats in this project.',
    emailLabel: 'Email',
    emailPlaceholder: 'Enter emails. Separate multiple addresses with commas.',
    permissionLabel: 'Permission',
    permView: 'View',
    permComment: 'Comment',
    send: 'Invite',
    sending: 'Sending invitation',
    sent: 'Sent invitations to {count} people.',
    mailFailed: "Some emails couldn't be sent. Please copy the link below and send it directly.",
    listTitle: 'People with access',
    memberTag: 'Member',
    guestTag: 'Guest',
    noEmail: 'No email',
    remove: 'Remove',
    removeConfirm: 'Remove {name} from this project?',
    pending: 'Expires in {days} days',
    pendingToday: 'Expires today',
    failed: 'Failed to send',
    resend: 'Resend',
    cancel: 'Cancel invitation',
    cancelConfirm: 'Cancel invitation for {email}?',
    copyLink: 'Copy link',
    copied: 'Link copied.',
    empty: 'No one has been invited yet.',
    errors: {
      email: '{email} is not a valid email address.',
      too_many: 'You can invite up to 10 people at a time.',
      rate_limited: "You've reached the daily invitation limit.",
      project_limit: 'Too many pending invitations to send more.',
      already_member: '{email} is already a brand member.',
    },
  },
  link: {
    title: 'Share link',
    invited: 'Only people invited',
    anyone: 'Anyone with the link',
    invitedHelp: 'Only people invited can open it, after signing in.',
    anyoneHelp: 'Anyone with the link can view this work without logging in.',
    recommend: 'We recommend setting an expiration date and password for security.',
    create: 'Create link',
    offConfirm: "Switching to 'Only people invited' will immediately turn off existing links. Do you want to proceed?",
    offOk: 'Change',
    offCancel: 'Cancel',
  },
  mail: {
    subject: '{inviter} invited you to the {project} project.',
    heading: "You've been invited to the {project} project by {organization}.",
    body: '{inviter} has sent you an invitation. Log in via the button below to view the drafts and storyboards.',
    bodyComment: 'You can also leave comments on the drafts.',
    expiry: 'This link is valid until {date}.',
    personal: 'Please use this link only if you were the intended recipient.',
    button: 'Accept invitation',
    why: '{inviter} sent this email for project collaboration.',
  },
  accept: {
    login: 'Log in to accept the invitation. For workspace invitations, please use the invited email address.',
    note: 'You will join with your current account, and the inviter will be able to see your account information.',
  },
};

export type RoomsShareCopy = typeof roomsShareKo;
