export const campaignCollaborationKo = {
  participantProfile: "참여자 SNS",
  title: "캠페인 참여자",
  intro: "초대, 참여 현황과 개별 대화를 한곳에서 확인하세요.",
  unavailable: "참여 공간을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.",
  back: "캠페인으로 돌아가기",
  invite: "참여 링크 만들기",
  email: "받는 분 이메일 (선택)",
  emailHint: "입력하면 해당 이메일을 인증한 계정만 수락할 수 있습니다.",
  link: "참여 링크",
  linkHint:
    "이 링크는 한 사람만 수락할 수 있습니다. 직접 전달해 주세요. 자동으로 발송하지 않습니다.",
  revoke: "초대 철회",
  join: "캠페인 참여 신청",
  joinIntro:
    "본인 계정으로 참여 조건을 확인하고 신청하세요. 신청 후 TWINGS가 참여자를 선정합니다.",
  consent: "캠페인 참여 조건과 게시 요구사항을 확인하고 동의합니다.",
  pitch: "참여 소개",
  snsUrl: "본인 SNS 프로필 주소",
  followers: "팔로워 수",
  accept: "확인하고 신청하기",
  signIn: "로그인하고 참여하기",
  tokenMissing: "초대 링크가 없습니다. 받은 참여 링크를 다시 열어 주세요.",
  storageBlocked:
    "이 브라우저에서는 초대 링크를 임시 보관할 수 없습니다. 로그인한 뒤 받은 초대 링크를 다시 열어 주세요.",
  waiting:
    "신청을 접수했습니다. 선정 후 대화와 파일 공유를 이용할 수 있습니다.",
  conversation: "참여자 대화",
  privacy:
    "이 대화와 파일은 해당 참여자, 브랜드 담당자와 검토 목적의 TWINGS 담당자만 볼 수 있습니다.",
  empty: "아직 대화가 없습니다.",
  message: "메시지",
  send: "보내기",
  files: "공유 파일",
  file: "파일",
  fileHint:
    "PDF, JPG, PNG, WebP · 최대 3MB. 얼굴 등록용 사진은 이곳에 올리지 마세요.",
  upload: "파일 공유하기",
  pending: "처리 중입니다…",
  done: "저장했습니다.",
  failed:
    "처리하지 못했습니다. 권한과 입력 내용을 확인하고 다시 시도해 주세요.",
  errors: {
    application_ended:
      "이 캠페인의 이전 신청이 종료되었습니다. 초대는 사용하지 않았습니다. TWINGS에 참여 상태 확인을 요청해 주세요.",
    invitation_retry:
      "초대 링크 응답을 복구할 수 없습니다. 초대 현황에서 수락 전 초대를 철회한 뒤 새 링크를 만들어 주세요.",
    not_found:
      "초대가 만료되었거나 접근 권한이 없습니다. 새 참여 링크를 요청해 주세요.",
    forbidden: "초대받은 이메일로 인증한 계정인지 확인해 주세요.",
    not_open: "현재 캠페인에서 신청이나 변경을 받지 않습니다.",
    not_selected: "선정 후 대화와 파일 공유를 이용할 수 있습니다.",
    slots_full: "모집 인원이 마감되었습니다.",
    influencer_required:
      "인플루언서 캠페인이에요. 팔로워 3,000명 이상인 계정을 연결하고 확인을 받으면 참여할 수 있어요.",
    conflict:
      "이미 처리되었거나 입력이 바뀌었습니다. 새로고침 후 상태를 확인해 주세요.",
    rate_limited: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
    invalid: "입력 내용과 파일 형식·용량을 확인해 주세요.",
    unavailable: "참여 공간을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.",
    sign_in_required: "로그인 후 다시 시도해 주세요.",
  },
  participants: "참여 현황",
  none: "아직 참여자가 없습니다.",
  open: "참여 공간 열기",
  invitations: "초대 현황",
  make: "캠페인 영상 만들기",
  mine: "내 캠페인 · 게시 링크 제출",
  post: "제출된 게시 링크 · 검수 상태 확인 필요",
  readOnly: "현재 이 공간은 읽기 전용입니다.",
  bind: "브랜드 프로젝트 연결",
  projectId: "브랜드 프로젝트 ID",
  bindHint:
    "참여자 공간의 프로젝트 연결은 저장 후 변경할 수 없습니다. 제작 계약과 같은 프로젝트인지 확인하세요.",
  save: "연결 저장",
  roles: { creator: "참여자", brand: "브랜드", studio: "TWINGS" },
  states: {
    applied: "신청 접수",
    selected: "선정됨",
    declined: "미선정",
    withdrawn: "참여 철회",
    posted: "게시 링크 제출 · 검수 전",
    verified: "검수 통과",
    rejected: "게시 수정 요청",
    paid: "지급 기록됨",
    expired: "참여 종료",
    pending: "수락 전",
    accepted: "수락됨",
    revoked: "철회됨",
  },
};
export const campaignCollaborationEn: typeof campaignCollaborationKo = {
  participantProfile: "Participant profile",
  title: "Campaign participants",
  intro: "Manage invitations, participation and private conversations.",
  unavailable:
    "The participant workspace is being prepared. Please check again later.",
  back: "Back to campaign",
  invite: "Create invitation link",
  email: "Recipient email (optional)",
  emailHint:
    "Only an account with this verified email can accept a restricted invitation.",
  link: "Invitation link",
  linkHint:
    "One person can accept this link. Share it directly. It is not emailed automatically.",
  revoke: "Revoke invitation",
  join: "Apply to this campaign",
  joinIntro:
    "Review the participation terms with your own account. TWINGS reviews applications before selecting participants.",
  consent:
    "I have reviewed and accept the campaign terms and posting requirements.",
  pitch: "Introduce yourself",
  snsUrl: "Your social profile URL",
  followers: "Follower count",
  accept: "Accept and apply",
  signIn: "Sign in to participate",
  tokenMissing:
    "No invitation was found. Open the invitation link you received again.",
  storageBlocked:
    "This browser cannot temporarily keep the invitation. Sign in, then reopen the invitation link you received.",
  waiting:
    "Your application is received. Conversation and files open after selection.",
  conversation: "Participant conversation",
  privacy:
    "This conversation and its files are visible to this participant, authorized brand members and TWINGS staff for review.",
  empty: "No messages yet.",
  message: "Message",
  send: "Send",
  files: "Shared files",
  file: "File",
  fileHint:
    "PDF, JPG, PNG, WebP · up to 3 MB. Do not upload face registration photos here.",
  upload: "Share file",
  pending: "Processing…",
  done: "Saved.",
  failed:
    "The request could not be completed. Check your access and input, then try again.",
  errors: {
    application_ended:
      "Your previous application for this campaign has ended. This invitation was not used. Ask TWINGS to review your participation status.",
    invitation_retry:
      "The invitation link response cannot be recovered. Revoke the pending invitation below, then create a new link.",
    not_found:
      "The invitation expired or access is unavailable. Ask for a new invitation link.",
    forbidden:
      "Check that your account has verified the invited email address.",
    not_open:
      "This campaign is not currently accepting applications or changes.",
    not_selected: "Conversation and files open after selection.",
    slots_full: "All campaign places have been filled.",
    influencer_required:
      "This campaign is for influencers. Link an account with 3,000+ followers and, once it is confirmed, you can join.",
    conflict:
      "This request was already processed or its input changed. Refresh to check its status.",
    rate_limited: "Too many requests. Please try again shortly.",
    invalid: "Check the input and the file type and size.",
    unavailable:
      "The participant workspace is being prepared. Please check again later.",
    sign_in_required: "Sign in and try again.",
  },
  participants: "Participation",
  none: "No participants yet.",
  open: "Open participant workspace",
  invitations: "Invitations",
  make: "Make campaign video",
  mine: "My campaigns · submit post link",
  post: "Submitted post · review status must be checked",
  readOnly: "This workspace is currently read-only.",
  bind: "Connect brand project",
  projectId: "Brand project ID",
  bindHint:
    "The participant project binding cannot change after saving. Confirm it matches the production contract project.",
  save: "Save connection",
  roles: { creator: "Participant", brand: "Brand", studio: "TWINGS" },
  states: {
    applied: "Application received",
    selected: "Selected",
    declined: "Not selected",
    withdrawn: "Withdrawn",
    posted: "Post submitted · not reviewed",
    verified: "Review passed",
    rejected: "Post changes requested",
    paid: "Payout recorded",
    expired: "Participation ended",
    pending: "Awaiting acceptance",
    accepted: "Accepted",
    revoked: "Revoked",
  },
};
export const collaborationCopy = (locale: string) =>
  locale === "en" ? campaignCollaborationEn : campaignCollaborationKo;
