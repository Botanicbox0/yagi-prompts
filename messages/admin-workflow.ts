export const adminWorkflowEn = {
  navigation: "Administration tasks",
  skip: "Skip to content",
  unavailable:
    "The database is unavailable. Queue counts could not be loaded; open a section after the connection is restored.",
  riskDisabled:
    "Conversation risk analysis is disabled. Open risk review to check its setup.",
  riskUnavailable:
    "Risk review storage is not ready. Open the review page for setup status.",
  riskWorker:
    "The local analysis worker has no recent heartbeat. Check the analysis queue.",
  riskDead: "{count} conversations could not be analysed after retries.",
  tasks: {
    paymentsManual: {
      title: "Handle stuck payments",
      hint: "Automatic refund or fulfilment reached its ten-try cap. Handle the payment in the Toss console.",
      action: "Open payment checks",
    },
    renderFailures: {
      title: "Look at failed renders",
      hint: "Failures from the last seven days. Read the reason and the payment before a customer asks.",
      action: "Open render board",
    },
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
      title: "Review payouts past the waiting period",
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
    formats: {
      title: "Review submitted formats",
      hint: "Read the recipe and the example an AI creative submitted, then accept or reject it.",
      action: "Review formats",
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
      blocked: "Check verified posts, the waiting period, and payment records below.",
      waiting: "There are no payment records yet.",
    },
  },
};

export const adminWorkflowKo: typeof adminWorkflowEn = {
  navigation: "관리자 업무",
  skip: "본문으로 건너뛰기",
  unavailable:
    "데이터베이스에 연결되지 않아 대기 건수를 불러오지 못했습니다. 연결을 복구한 뒤 각 메뉴에서 확인하세요.",
  riskDisabled:
    "대화 위험 분석이 꺼져 있습니다. 위험 검토에서 설정을 확인하세요.",
  riskUnavailable:
    "위험 검토 저장소가 준비되지 않았습니다. 검토 화면에서 설정 상태를 확인하세요.",
  riskWorker:
    "로컬 분석 워커의 최근 접속 신호가 없습니다. 분석 대기 목록을 확인하세요.",
  riskDead: "재시도 후에도 분석하지 못한 대화가 {count}건 있습니다.",
  tasks: {
    paymentsManual: {
      title: "멈춘 결제를 처리하세요",
      hint: "자동 환불이나 이행이 10번 시도 상한에 닿았습니다. 토스 콘솔에서 결제를 처리합니다.",
      action: "결제 확인 열기",
    },
    renderFailures: {
      title: "실패한 렌더를 확인하세요",
      hint: "최근 7일 동안 실패한 렌더입니다. 고객이 묻기 전에 실패 사유와 결제 상태를 봅니다.",
      action: "렌더 보드 열기",
    },
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
      title: "대기 기간이 끝난 지급 건을 확인하세요",
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
    formats: {
      title: "제출된 포맷을 검수하세요",
      hint: "AI 크리에이티브가 보낸 레시피와 예시를 보고 수락하거나 반려합니다.",
      action: "포맷 검수하기",
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
      blocked: "검수 결과, 지급 대기 기간, 지급 기록을 확인하세요.",
      waiting: "아직 지급 기록이 없습니다.",
    },
  },
};
