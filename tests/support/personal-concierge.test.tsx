import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { TwingsAiConcierge } from '@/components/support/twings-ai-concierge';
import {
  answerPersonalConciergeQuery,
  getPersonalConciergeFaqs,
} from '@/lib/support/personal-concierge';
import {
  loadConsumerSupportReplies,
  recordConsumerEscalation,
  sendConsumerSupportReply,
} from '@/lib/support/concierge-service';
import { runTeamNoticeDeliveryPass, syncSlackSupportReplies } from '@/lib/brands/team-notice-outbox';

describe('TWINGS Personal AI Concierge & Durable Escalation', () => {
  it('renders the floating circular TWINGS logo launcher at bottom-right when closed', () => {
    const html = renderToStaticMarkup(<TwingsAiConcierge locale="ko" defaultOpen={false} />);
    expect(html).toContain('data-twings-ai-concierge-launcher');
    expect(html).toContain('data-twings-mark');
    expect(html).not.toContain('data-twings-ai-concierge-dialog');
  });

  it('renders the dialog with circular TWINGS mark and FAQ list, never naming Slack or webhooks', () => {
    for (const signedIn of [false, true]) {
      const html = renderToStaticMarkup(
        <TwingsAiConcierge locale="ko" defaultOpen={true} initialSignedIn={signedIn} />,
      );
      expect(html).toContain('data-twings-ai-concierge-dialog');
      expect(html).toContain('data-concierge-logo-circle');
      expect(html).toContain('TWINGS AI 상담센터');
      expect(html).toContain('data-concierge-faq-list');
      expect(html).toContain('data-concierge-faq-item="selfie-guide"');
      expect(html).toContain('data-concierge-faq-item="template-modify"');
      expect(html).toContain('data-concierge-faq-item="selective-5shot"');
      expect(html).toContain('data-concierge-faq-item="maker-revenue"');
      expect(html).toContain('data-concierge-faq-item="campaign-reward"');
      expect(html).toContain('data-concierge-request-human');
      expect(html).not.toMatch(/Slack|슬랙|webhook|웹훅/i);
    }

    const enHtml = renderToStaticMarkup(
      <TwingsAiConcierge locale="en" defaultOpen={true} initialSignedIn={true} />,
    );
    expect(enHtml).not.toMatch(/Slack|슬랙|webhook|웹훅/i);
  });

  it('answers known TWINGS FAQ questions directly without escalating', () => {
    const faqs = getPersonalConciergeFaqs('ko');
    expect(faqs.length).toBeGreaterThanOrEqual(6);

    const selective = answerPersonalConciergeQuery({
      query: '5장 화보 중에서 원하는 2장만 골라서 만들 수 있나요?',
      locale: 'ko',
    });
    expect(selective.answeredByAi).toBe(true);
    expect(selective.needsHumanEscalation).toBe(false);
    expect(selective.matchedFaqId).toBe('selective-5shot');
    expect(selective.reply).toContain('9 크레딧');

    const maker = answerPersonalConciergeQuery({
      query: '내가 만든 영상을 템플릿 등록하면 수익 80% 주나요?',
      locale: 'ko',
    });
    expect(maker.answeredByAi).toBe(true);
    expect(maker.needsHumanEscalation).toBe(false);
    expect(maker.matchedFaqId).toBe('maker-revenue');
    expect(maker.reply).toContain('80%');
  });

  it('flags human escalation when the user asks for a person or when the AI cannot answer', () => {
    const humanReq = answerPersonalConciergeQuery({
      query: '사람이랑 직접 대화하고 싶어요 상담원 연결해주세요',
      locale: 'ko',
    });
    expect(humanReq.answeredByAi).toBe(false);
    expect(humanReq.needsHumanEscalation).toBe(true);
    expect(humanReq.escalationReason).toBe('user_requested_human');

    const billingReq = answerPersonalConciergeQuery({
      query: '방금 카드 결제 오류가 났는데 확인하고 환불해주세요',
      locale: 'ko',
    });
    expect(billingReq.answeredByAi).toBe(false);
    expect(billingReq.needsHumanEscalation).toBe(true);
    expect(billingReq.escalationReason).toBe('account_or_billing_check');

    const unknownReq = answerPersonalConciergeQuery({
      query: '오프라인 팝업스토어 행사는 몇 월에 열리나요?',
      locale: 'ko',
    });
    expect(unknownReq.answeredByAi).toBe(false);
    expect(unknownReq.needsHumanEscalation).toBe(true);
    expect(unknownReq.escalationReason).toBe('ai_unanswered');
  });

  it('stores consumer escalations transactionally, omits email from Slack, and syncs bot thread replies', async () => {
    const db = await freshDb();
    const sql = runner(db);
    try {
      const userId = randomUUID();
      const adminId = randomUUID();
      await seedProfile(sql, { id: userId, email: 'private-consumer@example.test', isAdmin: false });
      await sql.query("update profiles set display_name = 'Sample Member' where id = $1", [userId]);
      await seedProfile(sql, { id: adminId, email: 'admin@example.test', isAdmin: true });

      const stored = await recordConsumerEscalation(sql, {
        userId,
        reason: 'ai_unanswered',
        message: '커스텀 로고 <!channel> 문의드립니다.',
        pagePath: '/ko/direct',
        transcript: [{ role: 'user', text: '커스텀 로고 문의' }],
        requestId: randomUUID(),
      });
      expect(stored).toMatchObject({ ok: true, available: true, duplicate: false });
      if (!stored.ok || !stored.available) throw new Error('expected stored');

      let postedText = '';
      const fakeFetcher: typeof fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('chat.postMessage')) {
          const parsed = JSON.parse(String(init?.body)) as { text: string };
          postedText = parsed.text;
          return new Response(
            JSON.stringify({ ok: true, channel: 'C0123456789', ts: '1793800000.000100' }),
            { status: 200 },
          );
        }
        if (u.includes('conversations.replies')) {
          return new Response(
            JSON.stringify({
              ok: true,
              messages: [
                { ts: '1793800000.000100', thread_ts: '1793800000.000100', text: postedText },
                { ts: '1793800010.000200', thread_ts: '1793800000.000100', bot_id: 'B1', text: 'ignore bot' },
                {
                  ts: '1793800015.000300',
                  thread_ts: '1793800000.000100',
                  text: '<@U999> 담당 팀에서 답변드립니다. 지금 정상 처리되었습니다.',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: false }), { status: 500 });
      };

      const env = {
        VERCEL_ENV: 'production',
        SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-test-token',
        SLACK_BRAND_CONCIERGE_CHANNEL_ID: 'C0123456789',
      };

      const pass = await runTeamNoticeDeliveryPass({ sql, env, fetcher: fakeFetcher });
      expect(pass.sent).toBe(1);
      expect(postedText).toContain('TWINGS · 고객 상담 요청');
      expect(postedText).toContain('&lt;!channel&gt;');
      expect(postedText).not.toContain('private-consumer@example.test');
      expect(postedText).toContain('https://admin.twings.app/admin/inquiries');

      const sync1 = await syncSlackSupportReplies(sql, { userId, env, fetcher: fakeFetcher, force: true });
      expect(sync1).toMatchObject({ available: true, skipped: false, checked: 1, synced: 1, errors: [] });

      // Idempotent repeat poll inserts nothing new
      const sync2 = await syncSlackSupportReplies(sql, { userId, env, fetcher: fakeFetcher, force: true });
      expect(sync2.synced).toBe(0);

      // Admin reply also saves cleanly
      expect(
        await sendConsumerSupportReply(
          sql,
          { userId: adminId, isAdmin: true, tier: 'admin', email: 'admin@example.test', locale: 'ko' },
          { userId, body: '추가 안내드립니다.' },
        ),
      ).toMatchObject({ ok: true });

      const replies = await loadConsumerSupportReplies(sql, userId, 'ko');
      expect(replies.map((r) => r.body)).toEqual([
        '담당 팀에서 답변드립니다. 지금 정상 처리되었습니다.',
        '추가 안내드립니다.',
      ]);
    } finally {
      await db.close();
    }
  });
});
