/**
 * The team page's "이번 달 크레딧 사용" (docs/BRAND-STUDIO-V3.md §3, slice A). Server-rendered, no state.
 *
 * Each person's credits and runs in the allowance window (the calendar month, or a plan organization's billing cycle
 * with "이번 이용 기간" words, R1) with a bar against the team's total, then the team's total against the allowance.
 * The page decides whether to show it at all (studio v2 visible for this brand, allowance above 0) and passes the members it already loaded, so the same privacy rule applies:
 * another owner's address is never shown, only the label the member list uses.
 */
import { refillWording, windowDayInstant } from '@/lib/brand-studio/allowance-window';
import { creditsLeft, creditsOf, formatCredits } from '@/lib/brand-studio/credits';
import type { MemberUsageRow } from '@/lib/brand-studio/member-usage';
import type { StudioAllowanceView } from '@/lib/brand-studio/contracts';
import { interpolate } from '@/lib/i18n/format';
import type { StudioShellCopy } from '@/messages/studio-shell';
import s from './rail-usage.module.css';

export interface UsageMember {
  userId: string;
  /** Null when this viewer may not see it (another owner). */
  email: string | null;
}

export interface UsageLine {
  key: string;
  name: string;
  detail: string | null;
  credits: number;
  runs: number;
  /** Share of the team's usage this month, 0..1. */
  share: number;
}

/** Rows as the page shows them: names follow the member list's privacy rule, amounts become credits. */
export function usageLines(rows: readonly MemberUsageRow[], members: readonly UsageMember[], labels: { otherOwner: string; formerMember: string }): UsageLine[] {
  const total = rows.reduce((sum, r) => sum + Math.max(0, r.usedKrw), 0);
  return rows.map((row, index) => {
    const member = row.userId ? members.find((m) => m.userId === row.userId) : undefined;
    // Not a member of this brand any more (or the profile is gone): no address, no name.
    const visible = member ? member.email : null;
    const name = !member ? labels.formerMember : visible === null ? labels.otherOwner : row.displayName ?? visible;
    const detail = member && visible !== null && row.displayName ? visible : null;
    return {
      key: row.userId ?? `former-${index}`,
      name,
      detail,
      credits: creditsOf(row.usedKrw),
      runs: row.runs,
      share: total > 0 ? Math.max(0, row.usedKrw) / total : 0,
    };
  });
}

export function MemberUsageSection({
  rows,
  members,
  allowance,
  copy,
  otherOwner,
  locale,
}: {
  rows: readonly MemberUsageRow[];
  members: readonly UsageMember[];
  allowance: StudioAllowanceView;
  copy: StudioShellCopy['usage'];
  otherOwner: string;
  locale: 'ko' | 'en';
}) {
  const lines = usageLines(rows, members, { otherOwner, formerMember: copy.formerMember });
  const cap = creditsOf(allowance.capKrw);
  const used = Math.min(cap, cap - creditsLeft(allowance.capKrw, allowance.usedKrw));
  const usedRatio = cap > 0 ? Math.max(0, Math.min(1, used / cap)) : 0;
  const day = new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
  // R4: today's refill line, the trial's last day for a trial-only organization, or none (extra credits only).
  const wording = refillWording(allowance.refill);
  const refillLine =
    wording.kind === 'trial'
      ? interpolate(copy.refillTrial, { date: day.format(windowDayInstant(wording.through)) })
      : wording.kind === 'hidden'
        ? null
        : interpolate(copy.refill, { date: day.format(new Date(allowance.resetsAt)) });
  // R1: a plan organization's credits run on its billing cycle — the cycle words, counted from the cycle's start day;
  // the calendar month (or no window) keeps today's words.
  const cycle = allowance.window?.kind === 'cycle' ? allowance.window : null;
  const title = cycle ? copy.titleCycle : copy.title;
  const hint = cycle ? interpolate(copy.hintCycle, { date: day.format(windowDayInstant(cycle.start)) }) : copy.hint;
  const empty = cycle ? copy.emptyCycle : copy.empty;
  const n = (value: number) => formatCredits(value, locale);
  return (
    <section className={`bw-panel ${s.section}`} data-team-credit-usage aria-labelledby="team-credit-usage-title">
      <div className={s.head}>
        <div>
          <h2 id="team-credit-usage-title" className={s.title}>
            {title}
          </h2>
          <p className={s.hint}>{hint}</p>
        </div>
        <div className={s.total} data-team-credit-total>
          <span className={s.totalLabel}>{copy.total}</span>
          <strong className={s.totalValue}>{interpolate(copy.totalAmount, { used: n(used), cap: n(cap) })}</strong>
          <span
            className={s.bar}
            role="meter"
            aria-label={copy.total}
            aria-valuemin={0}
            aria-valuemax={cap}
            aria-valuenow={used}
            aria-valuetext={interpolate(copy.totalAmount, { used: n(used), cap: n(cap) })}
          >
            <span style={{ width: `${(usedRatio * 100).toFixed(1)}%` }} />
          </span>
          {refillLine !== null ? <span className={s.refill}>{refillLine}</span> : null}
        </div>
      </div>
      {lines.length === 0 ? (
        <p className={s.empty} data-team-credit-empty>
          {empty}
        </p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{copy.member}</th>
              <th scope="col" className={s.num}>
                {copy.credits}
              </th>
              <th scope="col" className={s.num}>
                {copy.runs}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const percent = Math.round(line.share * 100);
              return (
                <tr key={line.key} data-team-credit-row>
                  <th scope="row" className={s.whoCell}>
                    <div className={s.who}>
                      <span className={s.name}>{line.name}</span>
                      {line.detail ? <span className={s.detail}>{line.detail}</span> : null}
                      <span className={s.share} role="img" aria-label={interpolate(copy.share, { percent })}>
                        <span style={{ width: `${Math.max(line.share > 0 ? 2 : 0, line.share * 100).toFixed(1)}%` }} />
                      </span>
                    </div>
                  </th>
                  <td className={s.num}>{n(line.credits)}</td>
                  <td className={s.num}>{interpolate(copy.runsCount, { count: n(line.runs) })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
