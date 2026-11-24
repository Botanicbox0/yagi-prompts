/**
 * R3 item 1: the step-1 previews of the subscription start, the reissue and the plan default travel to their confirm
 * form in the outcome URL's `detail` (lib/admin/dispatch.ts `outcomeUrl`), like the plan upgrade's
 * (lib/admin/plan-upgrade-detail.ts). One formatter and one parser per preview, so the operation and the page agree on
 * the shape and tests/admin/outcome-detail-roundtrip.test.ts can build each one's longest detail. The formats are the
 * ones the operations already sent. Pure, client-safe.
 */

const DAY = '\\d{4}-\\d{2}-\\d{2}';
const PLAN = 'b2b_(?:29|49|69)';
const DIGEST = '[0-9a-f]{16}';

type PaidPlan = 'b2b_29' | 'b2b_49' | 'b2b_69';

export interface SubscriptionStartDetail {
  planId: PaidPlan;
  startedOn: string;
  activateBeforePayment: boolean;
  dueOn: string;
  totalKrw: number;
  digest: string;
  shortWindow: boolean;
}

/** `b2b_29|2026-11-25|early=0 · due=2026-12-09 · 319000 · digest=…[ · short_window=1]` */
export function formatSubscriptionStartDetail(d: SubscriptionStartDetail): string {
  return `${d.planId}|${d.startedOn}|early=${d.activateBeforePayment ? '1' : '0'} · due=${d.dueOn} · ${d.totalKrw} · digest=${d.digest}${d.shortWindow ? ' · short_window=1' : ''}`;
}

const START_RE = new RegExp(`^(${PLAN})\\|(${DAY})\\|early=(0|1) · due=(${DAY}) · (\\d+) · digest=(${DIGEST})( · short_window=1)?$`);

export function parseSubscriptionStartDetail(detail: string | null | undefined): SubscriptionStartDetail | null {
  const m = detail ? START_RE.exec(detail) : null;
  if (!m) return null;
  return {
    planId: m[1] as PaidPlan,
    startedOn: m[2]!,
    activateBeforePayment: m[3] === '1',
    dueOn: m[4]!,
    totalKrw: Number(m[5]),
    digest: m[6]!,
    shortWindow: Boolean(m[7]),
  };
}

export interface ReissueDetail {
  period: string;
  planId: PaidPlan;
  prorateFromDay: string | null;
  dueOn: string;
  totalKrw: number;
  digest: string;
  shortWindow: boolean;
}

/** `reissue=2026-11|b2b_29|full|due=2026-12-09|319000|digest=…[|short_window=1]` */
export function formatReissueDetail(d: ReissueDetail): string {
  return `reissue=${d.period}|${d.planId}|${d.prorateFromDay ?? 'full'}|due=${d.dueOn}|${d.totalKrw}|digest=${d.digest}${d.shortWindow ? '|short_window=1' : ''}`;
}

const REISSUE_RE = new RegExp(`^reissue=(\\d{4}-\\d{2})\\|(${PLAN})\\|(full|${DAY})\\|due=(${DAY})\\|(\\d+)\\|digest=(${DIGEST})(\\|short_window=1)?$`);

export function parseReissueDetail(detail: string | null | undefined): ReissueDetail | null {
  const m = detail ? REISSUE_RE.exec(detail) : null;
  if (!m) return null;
  return {
    period: m[1]!,
    planId: m[2] as PaidPlan,
    prorateFromDay: m[3] === 'full' ? null : m[3]!,
    dueOn: m[4]!,
    totalKrw: Number(m[5]),
    digest: m[6]!,
    shortWindow: Boolean(m[7]),
  };
}

/**
 * The affected organizations listed in a plan-default preview are bounded (the digest covers all of them): the list
 * stops before it passes these lengths and says how many more there are (`,+N`), so the whole detail always fits the
 * outcome URL (`OUTCOME_DETAIL_MAX_CHARS` / `OUTCOME_DETAIL_MAX_ENCODED` in lib/admin/dispatch.ts).
 */
// Fix round 1 (review m4): no more customer organization names in the redirect URL (and request logs) than before R3.
export const PLAN_DEFAULT_NAMES_MAX_CHARS = 160;
export const PLAN_DEFAULT_NAMES_MAX_ENCODED = 480;

export interface PlanDefaultPreviewInput {
  planId: PaidPlan;
  /** null: the default is being cleared. */
  capKrw: number | null;
  affected: ReadonlyArray<{ name: string; beforeCapKrw: number; afterCapKrw: number }>;
  /** Only a clear carries one (review round 2, item 9). */
  digest?: string;
}

/** `b2b_29=270000 · 2 (A:0->270000,B:0->270000)[ · digest=…]`; a long list ends with `,+N`. */
export function formatPlanDefaultPreviewDetail(p: PlanDefaultPreviewInput): string {
  const entries = p.affected.map((o) => `${o.name}:${o.beforeCapKrw}->${o.afterCapKrw}`);
  let shown = 0;
  let names = '';
  for (const entry of entries) {
    const next = names ? `${names},${entry}` : entry;
    if (next.length > PLAN_DEFAULT_NAMES_MAX_CHARS || encodeURIComponent(next).length > PLAN_DEFAULT_NAMES_MAX_ENCODED) break;
    names = next;
    shown += 1;
  }
  if (shown < entries.length) names = `${names}${names ? ',' : ''}+${entries.length - shown}`;
  const cap = p.capKrw === null ? 'unset' : String(p.capKrw);
  return `${p.planId}=${cap} · ${p.affected.length}${names ? ` (${names})` : ''}${p.digest ? ` · digest=${p.digest}` : ''}`;
}

export interface PlanDefaultPreviewDetail {
  planId: PaidPlan;
  capKrw: number | null;
  affectedCount: number;
  digest: string | null;
}

const PLAN_DEFAULT_RE = new RegExp(`^(${PLAN})=(\\d+|unset) · (\\d+)(?: \\(.*\\))?(?: · digest=(${DIGEST}))?$`, 's');

export function parsePlanDefaultPreviewDetail(detail: string | null | undefined): PlanDefaultPreviewDetail | null {
  const m = detail ? PLAN_DEFAULT_RE.exec(detail) : null;
  if (!m) return null;
  return {
    planId: m[1] as PaidPlan,
    capKrw: m[2] === 'unset' ? null : Number(m[2]),
    affectedCount: Number(m[3]),
    digest: m[4] ?? null,
  };
}
