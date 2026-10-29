export const adminWorkflowEn = {
  navigation: "Administration tasks",
  skip: "Skip to content",
  riskNav: "Risk review",
  fundingNav: "Quotes & receipts",
  groups: {
    operations: "Daily operations",
    campaigns: "Brands & campaigns",
    content: "Content",
    system: "System",
  },
  descriptions: {
    home: "See waiting work and choose the next action.",
    brandWorkspace:
      "Reply to brands; manage projects and production contracts.",
    campaigns:
      "Set up campaigns, select participants, review posts and record payments.",
    inquiries: "Review new brand requests and generation feedback.",
    prompts: "Register templates and manage their publication.",
    community: "Review creator posts and reports.",
    landingMedia: "Replace landing images in place, or put the originals back.",
    subscriptions: "Manage creator launch notifications.",
    playbooks: "Manage existing editorial collections.",
    policy: "Inspect access and publication rules.",
    risk: "Review signals in conversations. Signals do not impose sanctions.",
    funding: "Issue exact quotes, reconcile receipts and review full refunds.",
  },
  nextHeading: "What needs your attention",
  nextHint:
    "Open each queue to review the details before taking action. These counts do not execute approvals or payments.",
  empty:
    "No work is waiting in the queues below. Start with a brand project or a campaign.",
  unavailable:
    "The database is unavailable. Queue counts could not be loaded; open a section after the connection is restored.",
  queueCount: "{count} waiting",
  openQueue: "Open queue",
  riskDisabled:
    "Conversation risk analysis is disabled. Open risk review to check its setup.",
  riskUnavailable:
    "Risk review storage is not ready. Open the review page for setup status.",
  riskWorker:
    "The local analysis worker has no recent heartbeat. Check the analysis queue.",
  riskDead: "{count} conversations could not be analysed after retries.",
  tasks: {
    risk: {
      title: "Review conversation signals",
      hint: "Read the evidence and record a human review. Signals do not impose sanctions.",
      action: "Open risk review",
    },
    posts: {
      title: "Review submitted posts",
      hint: "Check the post link and campaign requirements before approval.",
      action: "Review posts",
    },
    applicants: {
      title: "Select campaign participants",
      hint: "Review applications and remaining places for each campaign.",
      action: "Review applicants",
    },
    payouts: {
      title: "Review payments after the hold",
      hint: "Check metrics and the amount, then record an actual payment. This queue does not transfer funds.",
      action: "Review payments",
    },
    studio: {
      title: "Reply to brands",
      hint: "A brand sent the latest message in these conversations.",
      action: "Open conversations",
    },
    inquiries: {
      title: "Review new brand requests",
      hint: "Read the brief and decide the next step with the brand.",
      action: "Review requests",
    },
    feedback: {
      title: "Check generation feedback",
      hint: "Review reported results and decide how to respond.",
      action: "Review feedback",
    },
    socialAccounts: {
      title: "Check linked SNS accounts",
      hint: "Look at the follower screenshot and type the number that counts. The local AI's reading is only a suggestion.",
      action: "Open SNS check",
    },
    creatorApplications: {
      title: "Review AI creative applications",
      hint: "Check the portfolio and example posts, then approve or decline. Approval does not publish any template.",
      action: "Review applications",
    },
    templates: {
      title: "Review submitted templates",
      hint: "Check content and publication requirements.",
      action: "Review templates",
    },
  },
  startHeading: "Setting up a brand campaign",
  startHint:
    "Keep the brand workspace, participant campaign and production setup connected. Each page saves its own changes.",
  start: {
    brand: {
      title: "Prepare the brand project",
      hint: "Create or open the brand organization, project and production contract.",
      action: "Open brand workspace",
    },
    campaign: {
      title: "Prepare the campaign",
      hint: "Set the brief, dates, places and agreed reward rule before recruiting.",
      action: "Open campaigns",
    },
    participants: {
      title: "Run the participant workflow",
      hint: "Open a campaign to connect production, select participants, review posts and record payments.",
      action: "Manage participants",
    },
  },
  overview: "Other activity",
  workflowHeading: "Campaign workflow",
  workflowHint:
    "These are separate checks, not a completion percentage. A configured reward rule does not prove a payment.",
  states: {
    blocked: "Needs setup",
    waiting: "Waiting",
    active: "In progress",
    done: "Confirmed",
  },
  stages: {
    brief: {
      title: "Brief and recruitment",
      ready: "The required recruitment fields are filled.",
      blocked: "Complete the missing fields in the campaign editor.",
    },
    production: {
      title: "Brand production",
      ready: "A contract and template are connected and production is enabled.",
      blocked:
        "Check the production connection, schema and rollout setting below.",
    },
    participants: {
      title: "Participant selection",
      ready: "Participants have been selected.",
      blocked: "Review waiting applications.",
      waiting: "No participants have been selected yet.",
    },
    posts: {
      title: "Post review",
      ready: "Submitted posts have been reviewed.",
      blocked: "Open the submitted posts below.",
      waiting: "Wait for a participant to submit a post link.",
    },
    reward: {
      title: "Reward rule",
      ready:
        "A reward rule is configured. Actual payments are tracked separately.",
      blocked: "Set the agreed reward rule in the campaign editor.",
    },
    payments: {
      title: "Payment records",
      ready:
        "All currently eligible selected participants have a payment record.",
      blocked: "Review verified posts, the hold and payment records below.",
      waiting: "There are no payment records yet.",
    },
  },
};

export const adminWorkflowKo: typeof adminWorkflowEn = {
  navigation: "관리자 업무",
  skip: "본문으로 건너뛰기",
  riskNav: "위험 신호 검토",
  fundingNav: "견적·입금 기록",
  groups: {
    operations: "오늘의 운영",
    campaigns: "브랜드·캠페인",
    content: "콘텐츠 관리",
    system: "시스템",
  },
  descriptions: {
    home: "대기 중인 업무를 확인하고 다음 행동을 고릅니다.",
    brandWorkspace: "브랜드에 답변하고 프로젝트와 제작 계약을 관리합니다.",
    campaigns:
      "캠페인 설정부터 참여자 선정, 게시 검수, 지급 기록까지 관리합니다.",
    inquiries: "새 브랜드 의뢰와 생성 결과 문의를 확인합니다.",
    prompts: "템플릿을 등록하고 게시 상태를 관리합니다.",
    community: "크리에이터 게시물과 신고를 검토합니다.",
    landingMedia: "랜딩 이미지를 그 자리에서 바꾸거나 원래대로 되돌립니다.",
    subscriptions: "크리에이터 출시 알림 신청을 관리합니다.",
    playbooks: "기존 에디토리얼 모음을 관리합니다.",
    policy: "접근 권한과 게시 규칙을 확인합니다.",
    risk: "대화의 위험 신호를 검토합니다. 신호만으로 제재하지 않습니다.",
    funding: "합의된 견적을 발행하고 입금 기록과 전액 환불을 확인합니다.",
  },
  nextHeading: "지금 확인할 일",
  nextHint:
    "각 목록에서 내용을 확인한 뒤 처리하세요. 건수 표시만으로 승인이나 지급이 실행되지는 않습니다.",
  empty:
    "아래 목록에 대기 중인 업무가 없습니다. 새 업무는 브랜드 프로젝트나 캠페인에서 시작하세요.",
  unavailable:
    "데이터베이스에 연결되지 않아 대기 건수를 불러오지 못했습니다. 연결을 복구한 뒤 각 메뉴에서 확인하세요.",
  queueCount: "{count}건 대기",
  openQueue: "대기 목록 열기",
  riskDisabled:
    "대화 위험 분석이 꺼져 있습니다. 위험 검토에서 설정을 확인하세요.",
  riskUnavailable:
    "위험 검토 저장소가 준비되지 않았습니다. 검토 화면에서 설정 상태를 확인하세요.",
  riskWorker:
    "로컬 분석 워커의 최근 접속 신호가 없습니다. 분석 대기 목록을 확인하세요.",
  riskDead: "재시도 후에도 분석하지 못한 대화가 {count}건 있습니다.",
  tasks: {
    risk: {
      title: "대화의 위험 신호를 검토하세요",
      hint: "근거를 읽고 사람이 검토 결과를 기록합니다. 신호만으로 제재하지 않습니다.",
      action: "위험 신호 검토하기",
    },
    posts: {
      title: "제출된 게시물을 검수하세요",
      hint: "게시 링크와 캠페인 요구사항을 확인한 뒤 승인합니다.",
      action: "게시물 검수하기",
    },
    applicants: {
      title: "캠페인 참여자를 선정하세요",
      hint: "캠페인별 지원 내용과 남은 자리를 확인합니다.",
      action: "지원자 확인하기",
    },
    payouts: {
      title: "홀드가 끝난 지급 건을 확인하세요",
      hint: "조회수와 금액을 확인하고 실제 지급 내역을 기록합니다. 여기서 돈이 이체되지는 않습니다.",
      action: "지급 대기 확인하기",
    },
    studio: {
      title: "브랜드 대화에 답변하세요",
      hint: "브랜드가 마지막 메시지를 보낸 대화입니다.",
      action: "대화 열기",
    },
    inquiries: {
      title: "새 브랜드 의뢰를 확인하세요",
      hint: "의뢰 내용을 읽고 브랜드와 다음 단계를 정합니다.",
      action: "의뢰 확인하기",
    },
    feedback: {
      title: "생성 결과 문의를 확인하세요",
      hint: "접수된 결과물을 확인하고 대응 방법을 정합니다.",
      action: "결과 문의 확인하기",
    },
    socialAccounts: {
      title: "SNS 연결 신청을 확인하세요",
      hint: "팔로워 화면 캡처를 보고 인정할 숫자를 직접 입력합니다. 로컬 AI가 읽은 값은 참고만 합니다.",
      action: "SNS 확인 열기",
    },
    creatorApplications: {
      title: "AI 크리에이티브 지원서를 검토하세요",
      hint: "포트폴리오와 예시 게시물을 확인한 뒤 승인 또는 반려합니다. 승인만으로 템플릿이 공개되지는 않습니다.",
      action: "지원서 검토하기",
    },
    templates: {
      title: "제출된 템플릿을 검토하세요",
      hint: "콘텐츠와 게시에 필요한 항목을 확인합니다.",
      action: "템플릿 검토하기",
    },
  },
  startHeading: "브랜드 캠페인을 처음 운영한다면",
  startHint:
    "브랜드 작업공간, 참여 캠페인, 제작 설정을 연결합니다. 각 화면에서 변경 내용을 따로 저장하세요.",
  start: {
    brand: {
      title: "브랜드 프로젝트 준비",
      hint: "브랜드 조직과 프로젝트를 열고 제작 계약을 준비합니다.",
      action: "브랜드 작업공간 열기",
    },
    campaign: {
      title: "캠페인 조건 준비",
      hint: "모집 전에 브리프, 일정, 인원과 합의된 보상 규칙을 입력합니다.",
      action: "캠페인 열기",
    },
    participants: {
      title: "참여자 운영",
      hint: "캠페인 상세에서 제작을 연결하고 참여자 선정, 게시 검수, 지급 기록을 진행합니다.",
      action: "참여자 관리하기",
    },
  },
  overview: "다른 활동 현황",
  workflowHeading: "캠페인 진행 확인",
  workflowHint:
    "각 항목은 별도의 확인 사항이며 완료율이 아닙니다. 보상 규칙 저장과 실제 지급은 구분합니다.",
  states: {
    blocked: "설정 필요",
    waiting: "대기",
    active: "처리 중",
    done: "확인됨",
  },
  stages: {
    brief: {
      title: "브리프·모집 준비",
      ready: "모집에 필요한 필수 항목이 입력되어 있습니다.",
      blocked: "아래 캠페인 편집에서 빠진 항목을 채우세요.",
    },
    production: {
      title: "브랜드 제작 연결",
      ready: "계약과 템플릿이 연결되고 제작이 활성화되어 있습니다.",
      blocked: "아래 제작 설정에서 연결, 스키마, 공개 설정을 확인하세요.",
    },
    participants: {
      title: "참여자 선정",
      ready: "선정된 참여자가 있습니다.",
      blocked: "대기 중인 지원자를 확인하세요.",
      waiting: "아직 선정된 참여자가 없습니다.",
    },
    posts: {
      title: "게시물 검수",
      ready: "제출된 게시물의 검수 기록이 있습니다.",
      blocked: "아래 제출된 게시물을 확인하세요.",
      waiting: "참여자의 게시 링크 제출을 기다립니다.",
    },
    reward: {
      title: "보상 규칙",
      ready: "보상 규칙이 입력되어 있습니다. 실제 지급은 따로 기록합니다.",
      blocked: "캠페인 편집에서 합의된 보상 규칙을 입력하세요.",
    },
    payments: {
      title: "지급 기록",
      ready: "현재 지급 대상 참여자 모두에게 지급 기록이 있습니다.",
      blocked: "검수 결과, 홀드 기간과 지급 기록을 확인하세요.",
      waiting: "아직 지급 기록이 없습니다.",
    },
  },
};
