const en = {
  supportedMethods:
    "Use a card or Toss Pay for this campaign payment. Virtual accounts and other methods are not supported here.",
  pendingRefundHelp:
    "The cancellation result is unresolved. Do not send another cancellation. Ask the payment provider through its merchant console or support to confirm this order’s cancellation result, then check the provider status here again. A pending record is not a completed refund.",
  reward: {
    title: "Propose a participant reward",
    hint: "Send an amount per participant and conditions to the studio for review. This is a nonbinding proposal, separate from the TWINGS service quote. It does not change campaign terms already shown to applicants or trigger a payout.",
    amount: "Proposed amount per participant (KRW)",
    conditions: "Proposed posting requirements & reward conditions",
    send: "Send proposal to studio",
    empty: "No participant reward proposals yet.",
    review: "Record proposal review",
    note: "Review feedback shared with the brand",
    reviewed: "Review recorded",
    declined: "Declined",
    proposed: "Awaiting studio review",
    history: "Participant reward proposals",
    writer:
      "A current brand owner or editor can send a proposal. The studio records its review separately.",
  },
  returnConfirm: "Confirm my payment result",
  returnHint:
    "Confirm only if you just completed this campaign payment in the provider window. The server will verify the order and amount.",
  voidQuote: "Void expired unpaid quote",
  voidReason: "Reason for voiding the expired quote",
  confirmVoid:
    "I checked that this expired quote has no paid or unresolved order. Preserve its acceptance record and allow a new quote.",
  releaseOrder: "Verify and release an unpaid order",
  releaseHint:
    "Release requires provider evidence that no funds were taken. A missing response alone never clears the order.",
  confirmRelease:
    "Check provider evidence and release only a proven-unpaid order.",
  title: "Campaign payment",
  adminTitle: "Campaign quotes & receipts",
  intro:
    "Review the quoted service, total and agreed terms before accepting. Payment records a receipt only; it does not open a campaign, start production or pay participants.",
  back: "Back to project",
  adminBack: "Admin home",
  unavailable: "Campaign payment storage is not ready.",
  closed:
    "Payment and acceptance are closed until rollout, commercial policy and payment-provider settings are confirmed.",
  empty:
    "No campaign quote has been issued for this project. Ask the TWINGS studio to prepare a quote.",
  noCampaign:
    "Connect a campaign to a brand project before preparing its quote.",
  quote: "Quote",
  revision: "Revision",
  total: "Total (KRW)",
  tax: "Tax basis supplied with the quote",
  terms: "Agreed service & refund terms",
  termsRef: "Terms reference/version",
  valid: "Valid until",
  expired:
    "This quote has expired. Contact the studio to review the next step.",
  accept: "Accept this quote",
  consent:
    "I have read the exact total, tax basis, service scope, refund terms and their reference/version above.",
  pay: "Continue to payment",
  refresh: "Check current status",
  buyer:
    "Only a current brand owner can accept and pay. TWINGS administrators cannot act as the buyer.",
  test: "Test payment — no live receipt",
  fake: "Local simulation — no money is charged",
  live: "Live payment",
  receipt: "Payment receipt",
  noReceipt: "No payment receipt yet.",
  processing: "Processing…",
  preparing: "Loading payment methods…",
  payNow: "Pay the quoted total",
  error:
    "The request could not be completed. Check the current status before retrying.",
  pending:
    "The provider result is not confirmed yet. Check the payment status; do not start a second payment.",
  success: "Payment receipt recorded.",
  failed:
    "Payment was not completed. Check the existing order before trying again.",
  createQuote: "Issue quote",
  campaign: "Campaign",
  quoteHint:
    "Enter the exact agreed final total and tax basis. No tax rate or refund rule is calculated here. An accepted quote cannot be replaced.",
  validHint: "Korea time (UTC+9)",
  reason: "Reason for full refund",
  refund: "Request full refund",
  confirmRefund:
    "I have reviewed this payment and authorize a full refund to the original payment method.",
  reconcile: "Reconcile provider status",
  refundHint:
    "Refunds require an explicit administrator decision. An unknown cancellation is reconciled by checking the provider; the cancellation is not blindly sent again.",
  status: "Status",
  environment: "Environment",
  recordOnly:
    "A receipt does not establish campaign delivery, creator consent or participant payment.",
  states: {
    quoted: "Quote issued",
    proposed: "Awaiting acceptance",
    superseded: "Superseded",
    accepted: "Accepted",
    pending: "Awaiting payment",
    confirming: "Confirming",
    awaiting_deposit: "Awaiting bank deposit",
    voided: "Expired quote voided",
    paid: "Receipt recorded",
    review: "Human review required",
    failed: "Not paid",
    expired: "Expired",
    refund_pending: "Refund result pending",
    refunded: "Refund recorded",
  },
  errors: {
    invalid: "Check the required fields.",
    sign_in_required: "Sign in to continue.",
    forbidden: "Your current role cannot perform this action.",
    not_found: "This item is unavailable to your account.",
    conflict:
      "The state has changed. Refresh and review the current quote or order.",
    unavailable: "Payment storage is unavailable.",
    payments_closed: "Acceptance and checkout are closed.",
    amount_mismatch: "The submitted amount does not match the server quote.",
    confirm_pending:
      "The result is not confirmed. Check status before retrying.",
    payment_failed: "The provider reports that payment was not completed.",
    payment_review:
      "The provider result needs a human review. Do not pay again.",
    rate_limited:
      "This campaign has reached its order-attempt limit. Contact the studio.",
  },
};
const ko: typeof en = {
  supportedMethods:
    "캠페인 대금은 카드 또는 토스페이로 결제해 주세요. 가상계좌와 그 밖의 결제수단은 지원하지 않습니다.",
  pendingRefundHelp:
    "취소 결과를 확인하고 있습니다. 취소를 다시 요청하지 마세요. 결제 제공사 관리자 콘솔이나 고객센터에서 이 주문의 취소 결과를 확인한 뒤, 여기서 제공사 상태를 다시 확인해 주세요. 확인 중인 기록은 환불 완료를 뜻하지 않습니다.",
  reward: {
    title: "참여자 보상 제안",
    hint: "참여자 1명당 금액과 조건을 스튜디오에 검토 요청합니다. TWINGS 서비스 견적과 별개의 비확정 제안입니다. 기존 지원자에게 제시한 캠페인 조건을 바꾸거나 지급을 실행하지 않습니다.",
    amount: "참여자 1명당 제안 금액(원)",
    conditions: "제안하는 게시 요구사항·보상 조건",
    send: "스튜디오에 제안 보내기",
    empty: "아직 참여자 보상 제안이 없습니다.",
    review: "제안 검토 기록하기",
    note: "브랜드에 공유할 검토 의견",
    reviewed: "검토 기록됨",
    declined: "반려됨",
    proposed: "스튜디오 검토 대기",
    history: "참여자 보상 제안 내역",
    writer:
      "현재 브랜드 소유자나 편집자가 제안을 보낼 수 있습니다. 스튜디오의 검토 결과는 별도로 기록합니다.",
  },
  returnConfirm: "내 결제 결과 확인하기",
  returnHint:
    "방금 결제 제공사 화면에서 진행한 캠페인 결제일 때만 확인하세요. 서버가 주문과 금액을 검증합니다.",
  voidQuote: "만료된 미결제 견적 무효 처리",
  voidReason: "만료 견적 무효 처리 사유",
  confirmVoid:
    "만료된 견적에 입금되거나 결과가 불명확한 주문이 없는지 확인했습니다. 수락 기록을 보존하고 새 견적을 허용합니다.",
  releaseOrder: "미결제 근거 확인 후 주문 해제",
  releaseHint:
    "결제 제공사가 미결제를 확인한 주문만 해제합니다. 응답이 없다는 이유만으로 주문을 해제하지 않습니다.",
  confirmRelease: "제공사 근거를 확인하고 미결제가 입증된 주문만 해제합니다.",
  title: "캠페인 결제",
  adminTitle: "캠페인 견적·입금 기록",
  intro:
    "견적의 서비스 범위, 총액과 합의 조건을 읽고 수락하세요. 결제는 입금 기록만 남기며 캠페인 공개, 제작 시작, 참여자 지급을 실행하지 않습니다.",
  back: "프로젝트로 돌아가기",
  adminBack: "관리자 홈",
  unavailable: "캠페인 결제 저장소가 준비되지 않았습니다.",
  closed:
    "공개 설정, 상거래 정책과 결제 제공사 설정을 확인하기 전에는 견적 수락과 결제가 닫혀 있습니다.",
  empty:
    "아직 이 프로젝트에 발행된 캠페인 견적이 없습니다. TWINGS 스튜디오에 견적 준비를 요청하세요.",
  noCampaign: "견적을 작성하려면 먼저 캠페인을 브랜드 프로젝트에 연결하세요.",
  quote: "견적",
  revision: "버전",
  total: "최종 결제 총액(원)",
  tax: "견적에 명시된 세금 기준",
  terms: "합의된 서비스·환불 조건",
  termsRef: "조건 문서 참조·버전",
  valid: "유효기간",
  expired: "유효기간이 지난 견적입니다. 스튜디오와 다음 단계를 확인하세요.",
  accept: "이 견적 수락하기",
  consent:
    "위에 표시된 총액, 세금 기준, 서비스 범위, 환불 조건과 문서 참조·버전을 읽고 동의합니다.",
  pay: "결제로 이동하기",
  refresh: "현재 상태 확인하기",
  buyer:
    "현재 브랜드 소유자만 수락하고 결제할 수 있습니다. TWINGS 관리자는 구매자를 대신할 수 없습니다.",
  test: "테스트 결제 · 실제 입금 기록 아님",
  fake: "로컬 모의 결제 · 실제 돈이 결제되지 않음",
  live: "실결제",
  receipt: "입금 기록",
  noReceipt: "아직 입금 기록이 없습니다.",
  processing: "처리 중…",
  preparing: "결제 수단을 불러오는 중…",
  payNow: "견적 총액 결제하기",
  error:
    "요청을 처리하지 못했습니다. 다시 시도하기 전에 현재 상태를 확인하세요.",
  pending:
    "결제 제공사의 결과가 아직 확인되지 않았습니다. 상태를 확인하고 두 번째 결제를 시작하지 마세요.",
  success: "입금 기록이 저장되었습니다.",
  failed:
    "결제가 완료되지 않았습니다. 다시 시도하기 전에 기존 주문 상태를 확인하세요.",
  createQuote: "견적 발행하기",
  campaign: "캠페인",
  quoteHint:
    "합의된 최종 총액과 세금 기준을 그대로 입력합니다. 세율이나 환불 규칙을 자동 계산하지 않습니다. 수락된 견적은 교체할 수 없습니다.",
  validHint: "한국 시간(UTC+9)",
  reason: "전액 환불 사유",
  refund: "전액 환불 요청하기",
  confirmRefund:
    "이 결제를 확인했으며 원래 결제 수단으로 전액 환불하는 데 동의합니다.",
  reconcile: "결제 제공사 상태 확인하기",
  refundHint:
    "환불은 관리자의 명시적 판단으로 요청합니다. 취소 결과가 불명확하면 제공사 상태만 조회하며 취소 요청을 무조건 다시 보내지 않습니다.",
  status: "상태",
  environment: "결제 환경",
  recordOnly:
    "입금 기록은 캠페인 납품, 초상 사용 동의나 참여자 지급을 증명하지 않습니다.",
  states: {
    quoted: "견적 발행됨",
    proposed: "수락 대기",
    superseded: "이전 견적",
    accepted: "수락됨",
    pending: "결제 대기",
    confirming: "승인 확인 중",
    awaiting_deposit: "가상계좌 입금 대기",
    voided: "만료 견적 무효 처리됨",
    paid: "입금 기록됨",
    review: "사람의 검토 필요",
    failed: "미결제",
    expired: "유효기간 지남",
    refund_pending: "환불 결과 확인 중",
    refunded: "환불 기록됨",
  },
  errors: {
    invalid: "필수 입력값을 확인하세요.",
    sign_in_required: "로그인한 뒤 계속하세요.",
    forbidden: "현재 권한으로 처리할 수 없습니다.",
    not_found: "이 계정에서 확인할 수 없는 항목입니다.",
    conflict:
      "상태가 바뀌었습니다. 화면을 새로고침하고 현재 견적이나 주문을 확인하세요.",
    unavailable: "결제 저장소를 이용할 수 없습니다.",
    payments_closed: "견적 수락과 결제가 닫혀 있습니다.",
    amount_mismatch: "제출한 금액이 서버 견적과 다릅니다.",
    confirm_pending:
      "결과를 아직 확인하지 못했습니다. 다시 시도하기 전에 상태를 확인하세요.",
    payment_failed: "결제 제공사가 미결제 상태를 확인했습니다.",
    payment_review: "결제 결과를 사람이 검토해야 합니다. 다시 결제하지 마세요.",
    rate_limited:
      "캠페인의 주문 시도 한도에 도달했습니다. 스튜디오에 문의하세요.",
  },
};
export const fundingCopy = (locale: string) => (locale === "ko" ? ko : en);
export type FundingCopy = typeof en;
