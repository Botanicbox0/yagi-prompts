import { BUSINESS } from '@/lib/legal/documents';
import type { EmailMessage, Mailer, SendOutcome } from '@/lib/notify/mailer';
import { getMailer } from '@/lib/notify/service';
import { siteUrl } from '@/lib/seo/site-url';
import { COST_ASSUMPTIONS } from './cost-model';
import { FOUNDER_CREDIT_PLANS, NET_SHARE, quoteVideoResolutionTiers } from './template-price';

/**
 * USD/KRW Exchange Rate Threshold Guard & Founder Email Alert (Founder Decision, 2026-11-05):
 *
 * - All TWINGS Korean template floors (`COST_ASSUMPTIONS.krwPerUsd = 1400`) and Korean subscription
 *   credit allocations (`1 cr = 10 KRW net`) are calibrated at `1 USD = 1,400 KRW`.
 * - As long as USD/KRW stays `<= 1,400 KRW`, Korean card single-purchases and subscriptions preserve
 *   or exceed their target margins (`6%` on video, `12%` markup on images).
 * - Whenever the live USD/KRW rate crosses ABOVE `1,400 KRW`, we send a one-per-day email alert
 *   to the founder (`FOUNDER_ALERT_EMAIL` or `BUSINESS.email`) detailing the exact KRW API cost
 *   increase and remaining net margin across `720p` / `1080p` and Korean subscription plans.
 */

export const FX_ALERT_THRESHOLD_KRW_PER_USD = COST_ASSUMPTIONS.krwPerUsd; // 1400

export interface FxMarginImpactSummary {
  triggered: boolean;
  liveKrwPerUsd: number;
  baselineKrwPerUsd: number;
  deltaKrwPerUsd: number;
  deltaPercent: number;
  observedDateUtc: string;
  /** 10s Seedance 2.5 720p ($2.3079 USD, 345 cr / 4,000 KRW single card price) */
  video10s720p: {
    providerUsd: number;
    baselineCostKrw: number;
    liveCostKrw: number;
    singleCardNetRevenueKrw: number;
    liveSingleCardMarginKrw: number;
    liveSingleCardMarginPercent: number;
  };
  /** 10s Seedance 2.5 1080p ($5.6862 USD, 847 cr / 9,700 KRW single card price) */
  video10s1080p: {
    providerUsd: number;
    baselineCostKrw: number;
    liveCostKrw: number;
    singleCardNetRevenueKrw: number;
    liveSingleCardMarginKrw: number;
    liveSingleCardMarginPercent: number;
  };
  /** Break-even USD/KRW exchange rate where a 10s 1080p single-card purchase (9,700 KRW) hits 0원 margin */
  breakEvenKrwPerUsd1080pSingleCard: number;
  /** Break-even USD/KRW exchange rate where Korean Creator Plan (24,900 KRW -> 18,900 KRW net after 15% store fee) hits 0원 margin if 100% spent on videos */
  breakEvenKrwPerUsdCreatorPlanStore: number;
}

export function evaluateFxThresholdAlert(input: {
  liveKrwPerUsd: number;
  thresholdKrwPerUsd?: number;
  now?: Date;
}): FxMarginImpactSummary {
  const threshold = input.thresholdKrwPerUsd ?? FX_ALERT_THRESHOLD_KRW_PER_USD;
  const liveKrwPerUsd = Math.round(input.liveKrwPerUsd * 100) / 100;
  const now = input.now ?? new Date();
  const observedDateUtc = now.toISOString().slice(0, 10);

  const deltaKrwPerUsd = Math.round((liveKrwPerUsd - threshold) * 100) / 100;
  const deltaPercent = Math.round(((liveKrwPerUsd - threshold) / threshold) * 10000) / 100;

  const tiers10s = quoteVideoResolutionTiers({ model: 'seedance-2.5', seconds: 10 });
  const q720 = tiers10s.tiers['720p'];
  const q1080 = tiers10s.tiers['1080p'];

  const net720Krw = Math.round(q720.totalKrw * NET_SHARE);
  const base720CostKrw = Math.round(q720.providerUsd * threshold);
  const live720CostKrw = Math.round(q720.providerUsd * liveKrwPerUsd);
  const live720MarginKrw = net720Krw - live720CostKrw;

  const net1080Krw = Math.round(q1080.totalKrw * NET_SHARE);
  const base1080CostKrw = Math.round(q1080.providerUsd * threshold);
  const live1080CostKrw = Math.round(q1080.providerUsd * liveKrwPerUsd);
  const live1080MarginKrw = net1080Krw - live1080CostKrw;

  // Break-even USD/KRW rate where net revenue in KRW == providerUsd * rate
  const breakEvenKrwPerUsd1080pSingleCard = Math.floor(net1080Krw / q1080.providerUsd);

  // On Creator plan (1,890 cr = 18,900 KRW net after 10% VAT and 15% store fee),
  // max video spend is 5x 720p (1,725 cr -> $11.5395) + remaining 165 cr on 1x 480p (154 cr -> $1.0318) = $12.5713 USD
  const creatorMaxVideoUsd = q720.providerUsd * 5 + tiers10s.tiers['480p'].providerUsd;
  const creatorNetStoreKrw = FOUNDER_CREDIT_PLANS.creator.monthlyCredits * 10; // 18,900 KRW
  const breakEvenKrwPerUsdCreatorPlanStore = Math.floor(creatorNetStoreKrw / creatorMaxVideoUsd);

  return {
    triggered: liveKrwPerUsd > threshold,
    liveKrwPerUsd,
    baselineKrwPerUsd: threshold,
    deltaKrwPerUsd,
    deltaPercent,
    observedDateUtc,
    video10s720p: {
      providerUsd: q720.providerUsd,
      baselineCostKrw: base720CostKrw,
      liveCostKrw: live720CostKrw,
      singleCardNetRevenueKrw: net720Krw,
      liveSingleCardMarginKrw: live720MarginKrw,
      liveSingleCardMarginPercent:
        Math.round((live720MarginKrw / net720Krw) * 1000) / 10
    },
    video10s1080p: {
      providerUsd: q1080.providerUsd,
      baselineCostKrw: base1080CostKrw,
      liveCostKrw: live1080CostKrw,
      singleCardNetRevenueKrw: net1080Krw,
      liveSingleCardMarginKrw: live1080MarginKrw,
      liveSingleCardMarginPercent:
        Math.round((live1080MarginKrw / net1080Krw) * 1000) / 10
    },
    breakEvenKrwPerUsd1080pSingleCard,
    breakEvenKrwPerUsdCreatorPlanStore
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildFxThresholdAlertEmail(args: {
  summary: FxMarginImpactSummary;
  toEmail?: string;
  originUrl?: string;
}): EmailMessage {
  const { summary } = args;
  const to = args.toEmail?.trim() || process.env.FOUNDER_ALERT_EMAIL?.trim() || BUSINESS.email;
  const origin = (args.originUrl ?? siteUrl()).replace(/\/+$/, '');
  const rateStr = summary.liveKrwPerUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const deltaStr = `+${summary.deltaKrwPerUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}원 (+${summary.deltaPercent.toFixed(2)}%)`;

  const subject = `[TWINGS 환율 알림] USD/KRW ${rateStr}원 돌파 (기준 1,400원 초과)`;

  const rows: Array<[string, string]> = [
    ['현재 실시간 환율 (USD/KRW)', `${rateStr}원 / $1`],
    ['설계 기준 환율', `${summary.baselineKrwPerUsd.toLocaleString('ko-KR')}원 / $1`],
    ['기준 대비 상승폭', deltaStr],
    [
      '10초 720p 단건 마진 (4,000원)',
      `원가 ${summary.video10s720p.baselineCostKrw.toLocaleString('ko-KR')}원 → ${summary.video10s720p.liveCostKrw.toLocaleString('ko-KR')}원 (순마진 ${summary.video10s720p.liveSingleCardMarginKrw.toLocaleString('ko-KR')}원 / ${summary.video10s720p.liveSingleCardMarginPercent}%)`
    ],
    [
      '10초 1080p 단건 마진 (9,700원)',
      `원가 ${summary.video10s1080p.baselineCostKrw.toLocaleString('ko-KR')}원 → ${summary.video10s1080p.liveCostKrw.toLocaleString('ko-KR')}원 (순마진 ${summary.video10s1080p.liveSingleCardMarginKrw.toLocaleString('ko-KR')}원 / ${summary.video10s1080p.liveSingleCardMarginPercent}%)`
    ],
    [
      '손익분기 환율 (Break-even)',
      `1080p 단건 카드결제: ${summary.breakEvenKrwPerUsd1080pSingleCard.toLocaleString('ko-KR')}원 / 앱스토어 구독(15% 수수료): ${summary.breakEvenKrwPerUsdCreatorPlanStore.toLocaleString('ko-KR')}원`
    ]
  ];

  const htmlRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 14px 8px 0;color:#71717a;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:8px 0;font-size:14px;color:#18181b;font-weight:500">${escapeHtml(v)}</td></tr>`
    )
    .join('');

  const html = [
    '<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Pretendard\',sans-serif;color:#18181b">',
    '<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px">',
    `<h1 style="margin:0 0 14px;font-size:20px;line-height:1.35">USD/KRW 환율이 1,400원을 넘어 ${escapeHtml(rateStr)}원을 기록했습니다.</h1>`,
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.6">TWINGS 원화 가격표 설계 기준(1,400원)을 초과하여 현재 환율 기준 영상 생성 원가 및 순마진 현황을 알려드립니다.</p>',
    `<table style="border-collapse:collapse;margin-top:16px;width:100%">${htmlRows}</table>`,
    `<p style="margin:28px 0 0"><a href="${escapeHtml(`${origin}/admin`)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:999px;padding:12px 22px;font-size:14px;font-weight:600">관리자 대시보드 열기</a></p>`,
    `<p style="margin:28px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5">TWINGS · 일일 환율 임계치(1,400원) 자동 감시 알림 (${escapeHtml(summary.observedDateUtc)})</p>`,
    '</div></body></html>'
  ].join('');

  const text = [
    subject,
    '',
    'TWINGS 원화 가격표 설계 기준(1,400원)을 초과하여 현재 환율 기준 영상 생성 원가 및 순마진 현황을 알려드립니다.',
    '',
    ...rows.map(([k, v]) => `· ${k}: ${v}`),
    '',
    `관리자 대시보드: ${origin}/admin`
  ].join('\n');

  return {
    to,
    subject,
    html,
    text,
    idempotencyKey: `fx-alert-krw-1400:${summary.observedDateUtc}`,
    unsubscribeUrl: `${origin}/admin`
  };
}

/**
 * Fetches live USD/KRW rate from public no-key exchange rate endpoints with fallback.
 */
export async function fetchLiveUsdKrwRate(
  fetcher: typeof fetch = fetch
): Promise<number | null> {
  const endpoints = [
    {
      url: 'https://open.er-api.com/v6/latest/USD',
      extract: (json: unknown) =>
        (json as { rates?: { KRW?: unknown } } | null)?.rates?.KRW
    },
    {
      url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW',
      extract: (json: unknown) =>
        (json as { rates?: { KRW?: unknown } } | null)?.rates?.KRW
    }
  ];

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetcher(ep.url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data: unknown = await res.json();
      const krw = ep.extract(data);
      if (typeof krw === 'number' && Number.isFinite(krw) && krw > 500 && krw < 5000) {
        return krw;
      }
    } catch {
      // Try next fallback endpoint
    }
  }
  return null;
}

export interface FxThresholdAlertPassReport {
  checked: boolean;
  liveKrwPerUsd: number | null;
  thresholdKrwPerUsd: number;
  triggered: boolean;
  emailSent: boolean;
  outcome: SendOutcome | null;
}

/**
 * Runs the USD/KRW > 1,400원 check and dispatches the founder alert email if triggered.
 * Idempotent per UTC calendar day (`fx-alert-krw-1400:YYYY-MM-DD`).
 */
export async function runLiveFxThresholdAlertCheck(deps?: {
  mailer?: Mailer | null;
  fetcher?: typeof fetch;
  toEmail?: string;
  now?: Date;
}): Promise<FxThresholdAlertPassReport> {
  const thresholdKrwPerUsd = FX_ALERT_THRESHOLD_KRW_PER_USD;
  const liveKrwPerUsd = await fetchLiveUsdKrwRate(deps?.fetcher);
  if (liveKrwPerUsd === null) {
    return {
      checked: false,
      liveKrwPerUsd: null,
      thresholdKrwPerUsd,
      triggered: false,
      emailSent: false,
      outcome: null
    };
  }

  const summary = evaluateFxThresholdAlert({
    liveKrwPerUsd,
    thresholdKrwPerUsd,
    ...(deps?.now ? { now: deps.now } : {})
  });

  if (!summary.triggered) {
    return {
      checked: true,
      liveKrwPerUsd: summary.liveKrwPerUsd,
      thresholdKrwPerUsd,
      triggered: false,
      emailSent: false,
      outcome: null
    };
  }

  const mailer = deps?.mailer !== undefined ? deps.mailer : getMailer();
  if (!mailer) {
    return {
      checked: true,
      liveKrwPerUsd: summary.liveKrwPerUsd,
      thresholdKrwPerUsd,
      triggered: true,
      emailSent: false,
      outcome: null
    };
  }

  const message = buildFxThresholdAlertEmail({
    summary,
    ...(deps?.toEmail ? { toEmail: deps.toEmail } : {})
  });
  const outcome = await mailer.send(message).catch(
    (err: unknown): SendOutcome => ({
      ok: false,
      retryable: true,
      error: err instanceof Error ? err.message : String(err)
    })
  );

  return {
    checked: true,
    liveKrwPerUsd: summary.liveKrwPerUsd,
    thresholdKrwPerUsd,
    triggered: true,
    emailSent: outcome.ok,
    outcome
  };
}
