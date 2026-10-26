import { describe, expect, it } from 'vitest';
import {
  brandSlackHandle,
  deterministicSlackMessageUuid,
  formatOutboundSlackInquiry,
  parseSlackConciergeReply,
  resolveActiveConciergeChannel,
} from '@/lib/brands/concierge-slack';

const ORGS = [
  { id: 'deb648e9-c2df-43d4-b2a7-7f9eff8180d9', name: 'Morphic' },
  { id: 'd425c3b1-4066-4970-8a3b-93c52b3eef70', name: 'KAIPER' },
  { id: 'f5a6993b-1951-497e-a4da-3f221892f85e', name: 'YAGI WORKSHOP TEST' },
] as const;

describe('brand concierge ↔ Slack bridge', () => {
  it('normalizes brand names into @handles', () => {
    expect(brandSlackHandle('Morphic')).toBe('@morphic');
    expect(brandSlackHandle('KAIPER')).toBe('@kaiper');
    expect(brandSlackHandle('YAGI WORKSHOP TEST')).toBe('@yagi-workshop-test');
  });

  it('formats outbound inquiries with client organization, sender identity, and @handle instructions', () => {
    const text = formatOutboundSlackInquiry({
      organizationId: ORGS[0].id,
      organizationName: ORGS[0].name,
      senderEmail: 'karina.lim@morphicbusiness.com',
      senderRole: 'owner',
      body: '이번 달 크리에이터 리스트 요청드립니다.',
      messageId: '00000000-0000-4000-8000-000000000001',
    });
    expect(text).toContain('고객사:* *Morphic* (`@morphic`)');
    expect(text).toContain('karina.lim@morphicbusiness.com (owner)');
    expect(text).toContain('> 이번 달 크리에이터 리스트 요청드립니다.');
    expect(text).toContain('`@morphic 답변내용`');
    expect(text).toContain(`[org:${ORGS[0].id}]`);
  });

  it('parses @morphic and @brand replies from Slack into studio messages', () => {
    expect(
      parseSlackConciergeReply('@morphic 안녕하세요! 오늘 오후 4시에 리스트 전달드리겠습니다.', ORGS),
    ).toEqual({
      organizationId: ORGS[0].id,
      body: '안녕하세요! 오늘 오후 4시에 리스트 전달드리겠습니다.',
    });

    expect(
      parseSlackConciergeReply('[@Morphic]: 시안 v2 업로드 완료했습니다.', ORGS),
    ).toEqual({
      organizationId: ORGS[0].id,
      body: '시안 v2 업로드 완료했습니다.',
    });

    expect(
      parseSlackConciergeReply('@kaiper 일정 확인 후 회신드립니다.', ORGS),
    ).toEqual({
      organizationId: ORGS[1].id,
      body: '일정 확인 후 회신드립니다.',
    });
  });

  it('parses Slack thread replies under an outbound [org:UUID] inquiry message', () => {
    const parent = formatOutboundSlackInquiry({
      organizationId: ORGS[0].id,
      organizationName: ORGS[0].name,
      senderEmail: 'karina.lim@morphicbusiness.com',
      senderRole: 'owner',
      body: '문의드립니다',
      messageId: '00000000-0000-4000-8000-000000000001',
    });

    expect(
      parseSlackConciergeReply('스레드에서 바로 답변드립니다!', ORGS, parent),
    ).toEqual({
      organizationId: ORGS[0].id,
      body: '스레드에서 바로 답변드립니다!',
    });

    // Outbound message itself is never mistaken for an inbound reply
    expect(parseSlackConciergeReply(parent, ORGS)).toBeNull();
  });

  it('produces deterministic UUIDs for Slack message timestamps to guarantee idempotency', () => {
    const a = deterministicSlackMessageUuid('C0C7V2PB079', '1792713624.982099');
    const b = deterministicSlackMessageUuid('C0C7V2PB079', '1792713624.982099');
    const c = deterministicSlackMessageUuid('C0C7V2PB079', '1792713625.000001');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('auto-discovers #twings-brand-concierge from Slack conversations.list instead of #sales-inbox', async () => {
    const fakeFetcher: typeof fetch = async (url) => {
      if (String(url).includes('conversations.list')) {
        return new Response(
          JSON.stringify({
            ok: true,
            channels: [
              { id: 'C0C7V2PB079', name: 'sales-inbox', is_member: true },
              { id: 'C0TWINGSCON', name: 'twings-brand-concierge', is_member: true },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    };

    const resolved = await resolveActiveConciergeChannel(
      { enabled: true, token: 'xoxb-test', channelId: 'twings-brand-concierge' },
      fakeFetcher,
    );
    expect(resolved.channelId).toBe('C0TWINGSCON');
    expect(resolved.channelName).toBe('twings-brand-concierge');
    expect(resolved.isDedicated).toBe(true);
    expect(resolved.isMember).toBe(true);
  });
});
