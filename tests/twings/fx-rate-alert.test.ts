import { describe, expect, it } from 'vitest';
import { createFakeMailer } from '@/lib/notify/mailer-fake';
import {
  buildFxThresholdAlertEmail,
  evaluateFxThresholdAlert,
  FX_ALERT_THRESHOLD_KRW_PER_USD,
  runLiveFxThresholdAlertCheck
} from '@/lib/twings/fx-rate-alert';

describe('USD/KRW > 1,400원 threshold guard and founder email alert', () => {
  it('stays silent when USD/KRW is at or below 1,400원', async () => {
    const at1380 = evaluateFxThresholdAlert({
      liveKrwPerUsd: 1380,
      now: new Date('2026-11-05T03:00:00Z')
    });
    expect(at1380.triggered).toBe(false);
    expect(at1380.baselineKrwPerUsd).toBe(1400);

    const at1400 = evaluateFxThresholdAlert({
      liveKrwPerUsd: 1400,
      now: new Date('2026-11-05T03:00:00Z')
    });
    expect(at1400.triggered).toBe(false);

    const mailer = createFakeMailer({ from: 'TWINGS <noreply@twings.app>' });
    const report = await runLiveFxThresholdAlertCheck({
      mailer,
      now: new Date('2026-11-05T03:00:00Z'),
      fetcher: async () =>
        new Response(JSON.stringify({ rates: { KRW: 1392.5 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    });

    expect(report.checked).toBe(true);
    expect(report.triggered).toBe(false);
    expect(report.emailSent).toBe(false);
    expect(mailer.sent).toHaveLength(0);
  });

  it('triggers and sends one daily email to founder when USD/KRW exceeds 1,400원', async () => {
    expect(FX_ALERT_THRESHOLD_KRW_PER_USD).toBe(1400);

    const mailer = createFakeMailer({ from: 'TWINGS <noreply@twings.app>' });
    const report = await runLiveFxThresholdAlertCheck({
      mailer,
      now: new Date('2026-11-05T03:00:00Z'),
      fetcher: async () =>
        new Response(JSON.stringify({ rates: { KRW: 1435.25 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    });

    expect(report.checked).toBe(true);
    expect(report.liveKrwPerUsd).toBe(1435.25);
    expect(report.triggered).toBe(true);
    expect(report.emailSent).toBe(true);
    expect(mailer.sent).toHaveLength(1);

    const sentMail = mailer.sent[0]!;
    expect(sentMail.to).toBe('hello@yagiworkshop.xyz');
    expect(sentMail.subject).toContain('1,435.25원 돌파');
    expect(sentMail.idempotencyKey).toBe('fx-alert-krw-1400:2026-11-05');
    expect(sentMail.text).toContain('10초 720p 단건 마진');
    expect(sentMail.text).toContain('10초 1080p 단건 마진');
    expect(sentMail.text).toContain('손익분기 환율');
  });

  it('computes accurate break-even exchange rates for 1080p single card (~1,492원) and Creator store plan (~1,503원)', () => {
    const summary = evaluateFxThresholdAlert({
      liveKrwPerUsd: 1420,
      now: new Date('2026-11-05T03:00:00Z')
    });

    expect(summary.triggered).toBe(true);
    // 10s 1080p single card: 9,700 KRW * 0.87509 = 8,488 KRW net / $5.6862 = ~1,492 KRW/USD
    expect(summary.breakEvenKrwPerUsd1080pSingleCard).toBeGreaterThanOrEqual(1490);
    expect(summary.breakEvenKrwPerUsd1080pSingleCard).toBeLessThanOrEqual(1495);

    // Creator store plan: 18,900 KRW net / $12.5713 max video spend = ~1,503 KRW/USD
    expect(summary.breakEvenKrwPerUsdCreatorPlanStore).toBeGreaterThanOrEqual(1500);
    expect(summary.breakEvenKrwPerUsdCreatorPlanStore).toBeLessThanOrEqual(1505);

    const email = buildFxThresholdAlertEmail({
      summary,
      toEmail: 'founder@yagiworkshop.xyz',
      originUrl: 'https://twings.app'
    });
    expect(email.to).toBe('founder@yagiworkshop.xyz');
    expect(email.html).toContain('1,420.00원');
  });
});
