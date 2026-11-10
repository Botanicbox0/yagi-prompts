import { ManagedForm } from '@/components/brand-workspace/managed-form';
import type { BrandCopy } from '@/components/brand-workspace/action-form';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { STUDIO_LANES } from '@/lib/brand-studio/models';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadAllowance, loadAllowanceRow } from '@/lib/brand-studio/usage';

/**
 * Admin organization page panel: the brand studio v2 monthly allowance (KRW) and preferred lane
 * (docs/BRAND-STUDIO-V2.md §9). Operation `brand_studio.allowance.set`.
 *
 * Studio-internal console text only, never shown to a brand. It lives here, not in messages/*, because
 * this slice may not edit the dictionaries; move it to `adminConsole.brandStudio` when they are next
 * touched (reported in the S1 handoff).
 */
const COPY = {
  ko: {
    title: '스튜디오 사용 한도',
    hint: '브랜드 스튜디오(이미지·영상 생성)의 월 사용 한도(원)와 실행 경로. 0이면 생성이 닫힌다. 결제가 아니라 월 한도 차감이다.',
    current: (cap: string, used: string, resets: string) => `이번 달 ${used}원 사용 / 한도 ${cap}원 · ${resets} 초기화`,
    none: (fallback: string) => `설정 없음 — 기본값 ${fallback}원 적용`,
    cap: '월 한도(원)',
    lane: '선호 경로',
    laneDefault: '기본값 따름',
    lanes: { sunra_api: 'API 경로', sunra_mcp: '계정 경로(워크스테이션)' },
    note: '메모',
    save: '한도 저장',
    unavailable: '스튜디오 테이블이 아직 없다(0076 적용 전).',
  },
  en: {
    title: 'Studio allowance',
    hint: 'Monthly usage allowance (KRW) and execution lane for the brand studio (image and video generation). 0 closes generation. A limit, not a charge.',
    current: (cap: string, used: string, resets: string) => `${used} KRW used this month of ${cap} KRW · resets ${resets}`,
    none: (fallback: string) => `Not set — the default of ${fallback} KRW applies`,
    cap: 'Monthly allowance (KRW)',
    lane: 'Preferred lane',
    laneDefault: 'Use the default',
    lanes: { sunra_api: 'API lane', sunra_mcp: 'Account lane (workstation)' },
    note: 'Note',
    save: 'Save allowance',
    unavailable: 'The studio tables do not exist yet (apply 0076).',
  },
} as const;

export async function BrandStudioAllowancePanel({
  sql,
  organizationId,
  b,
  locale,
}: {
  sql: SqlRunner;
  organizationId: string;
  b: BrandCopy;
  locale: string;
}) {
  const c = locale === 'en' ? COPY.en : COPY.ko;
  const krw = new Intl.NumberFormat('ko-KR');
  const env = studioEnv();
  let row: Awaited<ReturnType<typeof loadAllowanceRow>> = null;
  let usage: Awaited<ReturnType<typeof loadAllowance>> | null = null;
  try {
    row = await loadAllowanceRow(sql, organizationId);
    usage = await loadAllowance(sql, organizationId, env);
  } catch {
    usage = null;
  }
  return (
    <section id="brand-studio-allowance" className="bw-panel" data-brand-studio-allowance={usage ? usage.capKrw : 'unavailable'}>
      <h2>{c.title}</h2>
      <p className="bw-muted">{c.hint}</p>
      <p data-brand-studio-allowance-state={row ? 'set' : 'default'}>
        {!usage
          ? c.unavailable
          : row
            ? c.current(krw.format(usage.capKrw), krw.format(usage.usedKrw), usage.resetsAt.slice(0, 10))
            : c.none(krw.format(env.defaultMonthlyKrw))}
      </p>
      <ManagedForm op="brand_studio.allowance.set" b={b} submit={c.save}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <label>
          {c.cap}
          <input name="monthlyCapKrw" type="number" min={0} max={100_000_000} step={1000} defaultValue={row?.monthlyCapKrw ?? 0} required />
        </label>
        <label>
          {c.lane}
          <select name="preferredLane" defaultValue={row?.preferredLane ?? ''}>
            <option value="">{c.laneDefault}</option>
            {STUDIO_LANES.map((lane) => (
              <option key={lane} value={lane}>
                {c.lanes[lane]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.note}
          <input name="note" defaultValue={row?.note ?? ''} maxLength={500} />
        </label>
      </ManagedForm>
    </section>
  );
}
