import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TwingsAiConcierge } from '@/components/support/twings-ai-concierge';
import {
  answerPersonalConciergeQuery,
  fetchSlackPersonalConciergeReplies,
  formatPersonalSupportSlackMessage,
  getPersonalConciergeFaqs,
  notifySlackPersonalConcierge,
  parsePersonalSupportSlackReply,
  personalSlackHandle,
} from '@/lib/support/personal-concierge';

describe('TWINGS Personal AI Concierge & Slack Human Escalation', () => {
  it('renders the floating circular TWINGS logo launcher at bottom-right when closed', () => {
    const html = renderToStaticMarkup(<TwingsAiConcierge locale="ko" defaultOpen={false} />);
    expect(html).toContain('data-twings-ai-concierge-launcher');
    expect(html).toContain('data-twings-mark');
    expect(html).not.toContain('data-twings-ai-concierge-dialog');
  });

  it('renders the ChannelTalk/Sendbird-style dialog with circular TWINGS mark and FAQ list when opened', () => {
    const html = renderToStaticMarkup(
      <TwingsAiConcierge locale="ko" defaultOpen={true} initialSignedIn={false} />,
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
    expect(html).not.toMatch(/Slack|슬랙/i);
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

  it('formats outbound Slack escalation messages and parses inbound thread or @handle replies', async () => {
    const userId = '11111111-2222-4333-8444-555555555555';
    const handle = personalSlackHandle('김트윙', 'twings.user@example.com', userId);
    expect(handle).toBe('@김트윙');

    const outbound = formatPersonalSupportSlackMessage({
      userId,
      displayName: '김트윙',
      email: 'twings.user@example.com',
      reason: 'ai_unanswered',
      message: '제가 방금 올린 영상에 커스텀 로고를 넣을 수 있는지 궁금합니다.',
      pagePath: '/ko/direct',
      transcript: [
        { role: 'user', text: '커스텀 로고 삽입 문의' },
        { role: 'ai', text: '담당 팀원에게 연결해 드립니다.' },
      ],
    });

    expect(outbound).toContain('[twings.app AI 상담센터 · 실시간 상담원 연결]');
    expect(outbound).toContain('김트윙');
    expect(outbound).toContain('twings.user@example.com');
    expect(outbound).toContain(`[twings-user:${userId}]`);

    // Thread reply under the parent escalation message
    expect(
      parsePersonalSupportSlackReply(
        '안녕하세요 김트윙님! 담당 PD입니다. 로고 삽입 방법 안내드리겠습니다.',
        userId,
        handle,
        outbound,
      ),
    ).toBe('안녕하세요 김트윙님! 담당 PD입니다. 로고 삽입 방법 안내드리겠습니다.');

    // Direct @handle reply in channel
    expect(
      parsePersonalSupportSlackReply(
        '@김트윙 확인 완료되어 크레딧 복구해 드렸습니다!',
        userId,
        handle,
        null,
      ),
    ).toBe('확인 완료되어 크레딧 복구해 드렸습니다!');

    // Outbound message itself is never mistaken for a reply
    expect(parsePersonalSupportSlackReply(outbound, userId, handle, null)).toBeNull();

    // End-to-end mock Slack send & thread poll
    const fakeFetcher: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('conversations.list')) {
        return new Response(
          JSON.stringify({
            ok: true,
            channels: [{ id: 'C0TWINGSSUP', name: 'twings-support', is_archived: false }],
          }),
          { status: 200 },
        );
      }
      if (u.includes('chat.postMessage')) {
        return new Response(JSON.stringify({ ok: true, ts: '1793800000.000100' }), {
          status: 200,
        });
      }
      if (u.includes('conversations.history')) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                ts: '1793800000.000100',
                text: outbound,
                reply_count: 1,
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes('conversations.replies')) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { ts: '1793800000.000100', text: outbound },
              {
                ts: '1793800015.000200',
                text: '슬랙에서 바로 답변드립니다! 지금 정상 처리되었습니다.',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    };

    const env = {
      VITEST: 'true',
      SLACK_PERSONAL_SUPPORT_FORCE_TEST: 'on',
      SLACK_BOT_TOKEN: 'xoxb-test-token',
    };

    const sent = await notifySlackPersonalConcierge(
      {
        userId,
        displayName: '김트윙',
        email: 'twings.user@example.com',
        reason: 'user_requested_human',
        message: '상담원 연결 부탁드립니다.',
      },
      { env, fetcher: fakeFetcher },
    );
    expect(sent.sent).toBe(true);
    expect(sent.channelId).toBe('C0TWINGSSUP');

    const replies = await fetchSlackPersonalConciergeReplies(
      { userId, displayName: '김트윙', email: 'twings.user@example.com' },
      { env, fetcher: fakeFetcher },
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toBe('슬랙에서 바로 답변드립니다! 지금 정상 처리되었습니다.');
  });
});
