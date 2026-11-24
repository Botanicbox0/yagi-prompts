/**
 * B1c-3: the plan-upgrade preview as it travels from step 1 to the confirm form (the operation's `detail`, the same way
 * the subscription start and reissue previews travel), and the admin lines for every upgrade refusal (internal
 * operator text, ko/en). Pure and client-safe.
 */

export interface PlanUpgradeDetail {
  oldPlanId: string;
  newPlanId: string;
  mode: 'manual' | 'subscription';
  todayKst: string;
  oldCycle: { start: string; end: string; endBefore: string };
  newCycle: { start: string; end: string };
  carryKrw: number;
  carryValidUntil: string;
  newPlanCapKrw: number;
  /** Subscribed organizations: the new plan's credits if the new invoice is still unpaid after its due date. */
  newPlanCapUnpaidKrw: number | null;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  discountPercent: number;
  dueOn: string;
  scheduledDowngradeCleared: string | null;
  draftsVoided: number;
  digest: string;
}

/** `upgrade=b2b_29>b2b_49|mode=…|today=…|old=start~end~endBefore|new=start~end|carry=…|…|digest=…` */
export function formatPlanUpgradeDetail(p: PlanUpgradeDetail): string {
  return [
    `upgrade=${p.oldPlanId}>${p.newPlanId}`,
    `mode=${p.mode}`,
    `today=${p.todayKst}`,
    `old=${p.oldCycle.start}~${p.oldCycle.end}~${p.oldCycle.endBefore}`,
    `new=${p.newCycle.start}~${p.newCycle.end}`,
    `carry=${p.carryKrw}`,
    `carryUntil=${p.carryValidUntil}`,
    `cap=${p.newPlanCapKrw}`,
    `capUnpaid=${p.newPlanCapUnpaidKrw ?? '-'}`,
    `supply=${p.supplyKrw}`,
    `vat=${p.vatKrw}`,
    `total=${p.totalKrw}`,
    `discount=${p.discountPercent}`,
    `due=${p.dueOn}`,
    `downgrade=${p.scheduledDowngradeCleared ?? '-'}`,
    `drafts=${p.draftsVoided}`,
    `digest=${p.digest}`,
  ].join('|');
}

const DAY = '\\d{4}-\\d{2}-\\d{2}';
const PLAN = 'b2b_(?:29|49|69)';
const DETAIL_RE = new RegExp(
  `^upgrade=(${PLAN})>(${PLAN})\\|mode=(manual|subscription)\\|today=(${DAY})\\|old=(${DAY})~(${DAY})~(${DAY})\\|new=(${DAY})~(${DAY})` +
    `\\|carry=(\\d+)\\|carryUntil=(${DAY})\\|cap=(\\d+)\\|capUnpaid=(\\d+|-)\\|supply=(\\d+)\\|vat=(\\d+)\\|total=(\\d+)\\|discount=(\\d+)` +
    `\\|due=(${DAY})\\|downgrade=(${PLAN}|-)\\|drafts=(\\d+)\\|digest=([0-9a-f]{16})$`,
);

export function parsePlanUpgradeDetail(detail: string | null | undefined): PlanUpgradeDetail | null {
  const m = detail ? DETAIL_RE.exec(detail) : null;
  if (!m) return null;
  return {
    oldPlanId: m[1]!,
    newPlanId: m[2]!,
    mode: m[3] as 'manual' | 'subscription',
    todayKst: m[4]!,
    oldCycle: { start: m[5]!, end: m[6]!, endBefore: m[7]! },
    newCycle: { start: m[8]!, end: m[9]! },
    carryKrw: Number(m[10]),
    carryValidUntil: m[11]!,
    newPlanCapKrw: Number(m[12]),
    newPlanCapUnpaidKrw: m[13] === '-' ? null : Number(m[13]),
    supplyKrw: Number(m[14]),
    vatKrw: Number(m[15]),
    totalKrw: Number(m[16]),
    discountPercent: Number(m[17]),
    dueOn: m[18]!,
    scheduledDowngradeCleared: m[19] === '-' ? null : m[19]!,
    draftsVoided: Number(m[20]),
    digest: m[21]!,
  };
}

const FAILED_KO = '플랜 올림을 끝내지 못해 아무것도 바꾸지 않았습니다. 오류 코드를 확인하고 다시 시도하세요';
const FAILED_EN = 'The upgrade could not be completed and nothing was changed; check the error code and try again';

const LABELS: Record<'ko' | 'en', Record<string, string>> = {
  ko: {
    already_upgraded_today: '오늘 이미 플랜을 올렸습니다. 같은 날 두 번 올릴 수 없습니다',
    current_cycle_unpaid: '이번 주기 청구서가 아직 입금되지 않았습니다. 입금을 먼저 기록한 뒤 올리세요',
    current_cycle_not_invoiced: '이번 주기 청구서가 없거나 아직 발행 전입니다. 이번 주기를 먼저 청구하고 입금을 받으세요',
    current_cycle_waived: '이번 주기는 면제된 주기라 결제된 것으로 보지 않습니다. 결제된 주기에서만 올릴 수 있습니다',
    current_invoice_not_cycle: '오늘을 덮는 청구서가 달력 월 청구서라 주기를 자를 수 없습니다. 주기 청구서로 바뀐 뒤에 올리세요',
    upgrade_on_cycle_start: '주기 첫날에는 올릴 수 없습니다(이전 주기가 0일이 됩니다). 같은 날 바꾸려면 이번 주기 청구서를 취소하고 새 플랜으로 다시 청구하세요',
    later_cycle_already_issued: '다음 주기 청구서가 이미 발행되었습니다. 그 청구서를 먼저 취소하세요',
    subscription_upgrade_only: '구독 중인 조직은 구독 카드의 "플랜 올림"으로 올립니다',
    no_subscription: '구독이 없습니다. 플랜 패널의 "플랜 올림"을 쓰세요',
    subscription_not_active: '구독이 정상 상태일 때만 올릴 수 있습니다. 연체·정지 중이면 입금을 먼저 기록하세요',
    subscription_canceling: '해지 예약된 구독은 올릴 수 없습니다. 해지 예약을 먼저 취소하세요',
    plan_not_active: '플랜이 오늘 유효하지 않습니다(시작 전이거나 종료일이 지났습니다)',
    no_plan: '배정된 플랜이 없습니다',
    not_an_upgrade: '더 높은 플랜으로만 올릴 수 있습니다. 내림은 다음 주기부터 적용되는 "플랜 내림 예약"을 쓰세요',
    same_plan: '지금과 같은 플랜입니다',
    project_only: '프로젝트 전용 플랜은 올림 대상이 아닙니다',
    plan_cap_not_set: '새 플랜의 기본 크레딧(월 한도)이 정해지지 않았습니다. 플랜 기본값을 먼저 정하세요',
    cycle_mismatch: '이번 주기 청구서의 기간이 플랜 주기와 다릅니다. 플랜 시작일과 청구서를 확인하세요',
    overlapping_invoices: '오늘을 덮는 청구서가 둘 이상입니다. 청구서를 먼저 정리하세요',
    outside_current_cycle: '오늘이 이번 주기 청구서 기간 밖입니다. 청구서를 확인하세요',
    upgrade_confirm_check: '플랜을 올리면 새 플랜 전액이 청구됩니다. 확인 체크를 선택하세요',
    upgrade_use_upgrade_operation: '더 높은 플랜은 "플랜 올림"으로 올립니다(오늘 새 주기가 시작됩니다)',
    upgrade_issue_failed: FAILED_KO,
    upgrade_invoice_mismatch: FAILED_KO,
    upgrade_cut_failed: FAILED_KO,
    upgrade_void_failed: FAILED_KO,
    upgrade_carry_failed: FAILED_KO,
    upgrade_draft_failed: FAILED_KO,
    upgrade_plan_write_failed: FAILED_KO,
  },
  en: {
    already_upgraded_today: 'The plan was already upgraded today; it cannot be upgraded twice on one day',
    current_cycle_unpaid: "This cycle's invoice is not paid yet; record the payment first",
    current_cycle_not_invoiced: 'This cycle has no invoice, or it is not issued yet; bill this cycle and record its payment first',
    current_cycle_waived: 'This cycle was waived, which does not count as paid; upgrades need a paid cycle',
    current_invoice_not_cycle: 'The invoice covering today is a calendar-month invoice and cannot be cut; upgrade once billing is on cycles',
    upgrade_on_cycle_start:
      'No upgrade on the first day of a cycle (the old cycle would have no days); for a same-day change void this cycle\'s invoice and bill the new plan',
    later_cycle_already_issued: 'The next cycle is already invoiced; void that invoice first',
    subscription_upgrade_only: 'A subscribed organization is upgraded from the subscription card',
    no_subscription: 'There is no subscription; use the upgrade on the plan panel',
    subscription_not_active: 'Only an active subscription can be upgraded; record overdue payments first',
    subscription_canceling: 'A subscription scheduled to cancel cannot be upgraded; undo the cancellation first',
    plan_not_active: 'The plan is not in force today (not started, or past its end date)',
    no_plan: 'This organization has no plan',
    not_an_upgrade: 'Only a higher plan is an upgrade; schedule a downgrade for the next cycle instead',
    same_plan: 'This is the current plan',
    project_only: 'Project-only plans are not upgraded',
    plan_cap_not_set: "The new plan's default credits (monthly cap) are not set; set the plan default first",
    cycle_mismatch: "This cycle's invoice does not match the plan cycle; check the plan start day and the invoice",
    overlapping_invoices: 'More than one invoice covers today; settle the invoices first',
    outside_current_cycle: "Today is outside this cycle's invoice; check the invoice",
    upgrade_confirm_check: "An upgrade bills the new plan's full price; tick the confirmation",
    upgrade_use_upgrade_operation: 'A higher plan is an upgrade (a new cycle starts today); use the upgrade',
    upgrade_issue_failed: FAILED_EN,
    upgrade_invoice_mismatch: FAILED_EN,
    upgrade_cut_failed: FAILED_EN,
    upgrade_void_failed: FAILED_EN,
    upgrade_carry_failed: FAILED_EN,
    upgrade_draft_failed: FAILED_EN,
    upgrade_plan_write_failed: FAILED_EN,
  },
};

/** The operator line for an upgrade refusal (`<code>:<reason>` or `<field>:<reason>`), or undefined for other details. */
export function formatPlanUpgradeOutcomeDetail(detail: string, locale: 'ko' | 'en'): string | undefined {
  const labels = LABELS[locale];
  for (const [token, message] of Object.entries(labels)) {
    if (detail === token || detail.endsWith(`:${token}`) || detail.includes(`:${token}:`)) return `${message} (${detail})`;
  }
  return undefined;
}
