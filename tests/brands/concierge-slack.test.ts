import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import {
  deterministicSlackMessageUuid,
  formatProjectRequestAlert,
  notifySlackBrandConcierge,
  resolveTeamNoticeConfig,
} from '@/lib/brands/concierge-slack';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { formatTeamNoticeSlackText } from '@/lib/brands/team-notice-outbox';

const ORGS = [
  { id: '11111111-1111-4111-8111-111111111101', name: 'Acme Studio' },
] as const;

describe('brand concierge <-> Slack bridge (strict outbox & dual-transport)', () => {
  it('formats outbound notices with slackSafe, adminUrl, display name only (no email/phone/user-id), and transport hint', () => {
    const botText = formatTeamNoticeSlackText({
      kind: 'support_message',
      organizationName: 'Acme & <!channel>',
      actorDisplayName: 'Alex <@U9999>',
      surface: 'support_drawer',
      preview: '문의합니다 <!here> & check <https://evil.example|link>',
      adminPath: `/admin/brand-workspace/organizations/${ORGS[0].id}#support`,
      transport: 'bot',
    });

    expect(botText).toContain('Acme &amp; &lt;!channel&gt;');
    expect(botText).toContain('Alex &lt;@U9999&gt;');
    expect(botText).toContain('&lt;!here&gt; &amp; check &lt;https://evil.example|link&gt;');
    expect(botText).not.toContain('<!channel>');
    expect(botText).not.toContain('<!here>');
    expect(botText).not.toContain('<@U9999>');
    expect(botText).toContain(`https://admin.twings.app/admin/brand-workspace/organizations/${ORGS[0].id}#support`);
    expect(botText).toContain('스레드에 답글을 남기면');

    const webhookText = formatTeamNoticeSlackText({
      kind: 'support_message',
      organizationName: 'Acme Studio',
      actorDisplayName: 'Alex',
      preview: '질문입니다',
      adminPath: `/admin/brand-workspace/organizations/${ORGS[0].id}#support`,
      transport: 'webhook',
      isRetry: true,
    });
    expect(webhookText).toContain('웹훅 단방향 알림');
    expect(webhookText).toContain('(재전송)');

    const projectText = formatProjectRequestAlert({
      organizationName: 'Acme <!channel>',
      title: '봄 캠페인',
      adminUrl: '/admin/brand-rooms/x',
    });
    expect(projectText).toContain('Acme &lt;!channel&gt;');
    expect(projectText).toContain('https://admin.twings.app/admin/brand-rooms/x');
  });

  it('produces deterministic UUIDs for Slack message timestamps to guarantee idempotency', () => {
    const a = deterministicSlackMessageUuid('C0C7V2PB079', '1792713624.982099');
    const b = deterministicSlackMessageUuid('C0C7V2PB079', '1792713624.982099');
    const c = deterministicSlackMessageUuid('C0C7V2PB079', '1792713625.000001');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('resolves strict dual-transport config without channel auto-discovery or fallback names', () => {
    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'preview',
        SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-123',
        SLACK_BRAND_CONCIERGE_CHANNEL_ID: 'C0123456789',
      }),
    ).toEqual({ status: 'skipped', code: 'non_production' });

    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'production',
        SLACK_BRAND_CONCIERGE_ENABLED: 'off',
        SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-123',
        SLACK_BRAND_CONCIERGE_CHANNEL_ID: 'C0123456789',
        SLACK_TEAM_NOTICE_WEBHOOK_URL: 'https://hooks.slack.com/services/T1/B1/S1',
      }),
    ).toEqual({ status: 'skipped', code: 'disabled' });

    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'production',
        SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-123',
      }),
    ).toEqual({ status: 'skipped', code: 'missing_channel_id' });

    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'production',
        SLACK_BRAND_CONCIERGE_BOT_TOKEN: 'xoxb-123',
        SLACK_BRAND_CONCIERGE_CHANNEL_ID: 'twings-brand-concierge',
      }),
    ).toEqual({ status: 'skipped', code: 'invalid_channel_id' });

    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'production',
        SLACK_BOT_TOKEN: 'xoxb-fallback',
        SLACK_BRAND_CONCIERGE_CHANNEL_ID: 'G0123456789',
        SLACK_BRAND_INQUIRIES_ENABLED: 'on',
        SLACK_BRAND_INQUIRIES_WEBHOOK_URL: 'https://hooks.slack.com/services/T1/B1/S1',
      }),
    ).toEqual({
      status: 'configured',
      transport: 'bot',
      token: 'xoxb-fallback',
      channelId: 'G0123456789',
    });

    expect(
      resolveTeamNoticeConfig({
        VERCEL_ENV: 'production',
        SLACK_BRAND_INQUIRIES_ENABLED: 'on',
        SLACK_BRAND_INQUIRIES_WEBHOOK_URL: 'https://hooks.slack.com/services/T1/B1/S1',
      }),
    ).toEqual({
      status: 'configured',
      transport: 'webhook',
      webhookUrl: 'https://hooks.slack.com/services/T1/B1/S1',
    });
  });

  it('labels pre-0178 fallback notices by kind and prints the admin link once without double escaping', async () => {
    const db = await freshDb();
    try {
      const sql = runner(db);
      const adminId = randomUUID();
      await seedProfile(sql, { id: adminId, email: 'admin@example.test', isAdmin: true });
      const org = await createStudioOrganization(
        { sql },
        { userId: adminId, isAdmin: true, tier: 'admin', email: 'admin@example.test', locale: 'ko' },
        { name: 'Pre0178 Brand', requestId: randomUUID() },
      );
      if (!org.ok) throw new Error('org');

      await db.exec('drop table if exists support_synced_replies, consumer_support_messages, team_notice_deliveries;');

      const sentPayloads: string[] = [];
      const fakeFetcher: typeof fetch = async (_u, init) => {
        sentPayloads.push((JSON.parse(String(init?.body)) as { text: string }).text);
        return new Response('ok', { status: 200 });
      };
      const prodEnv = {
        VERCEL_ENV: 'production',
        SLACK_TEAM_NOTICE_WEBHOOK_URL: 'https://hooks.slack.com/services/T1/B1/S1',
      };

      const boardId = randomUUID();
      await notifySlackBrandConcierge(
        sql,
        {
          organizationId: org.id,
          userId: null,
          kind: 'storyboard_approval',
          body: `[스토리보드 승인] Hero &amp; Cut v1\n관리자 화면: https://admin.twings.app/admin/brand-rooms/storyboards/${boardId}`,
          messageId: randomUUID(),
        },
        { env: prodEnv, fetcher: fakeFetcher },
      );

      await notifySlackBrandConcierge(
        sql,
        {
          organizationId: org.id,
          userId: null,
          body: `[리뷰 코멘트] Film v1 · 0:02\nPlease fix &lt;!channel&gt;\n관리자 화면: https://admin.twings.app/admin/brand-studio/reviews/${randomUUID()}`,
          messageId: randomUUID(),
        },
        { env: prodEnv, fetcher: fakeFetcher },
      );

      await notifySlackBrandConcierge(
        sql,
        {
          organizationId: org.id,
          userId: null,
          body: `[공유 링크 의견] Film Review\nCheck colors\n관리자 화면: https://admin.twings.app/admin/brand-rooms/${org.id}/${randomUUID()}?review=r1`,
          messageId: randomUUID(),
        },
        { env: prodEnv, fetcher: fakeFetcher },
      );

      await notifySlackBrandConcierge(
        sql,
        {
          organizationId: org.id,
          userId: null,
          body: `[프로젝트 룸] General\nNeed update\n관리자 화면: https://admin.twings.app/admin/brand-rooms/${org.id}?channel=general`,
          messageId: randomUUID(),
        },
        { env: prodEnv, fetcher: fakeFetcher },
      );

      expect(sentPayloads).toHaveLength(4);
      expect(sentPayloads[0]).toContain('스토리보드 결정');
      expect(sentPayloads[0]).not.toContain('실시간 문의');
      expect(sentPayloads[0]).toContain(`/admin/brand-rooms/storyboards/${boardId}`);
      expect(sentPayloads[1]).toContain('시안 리뷰 의견');
      expect(sentPayloads[1]).not.toContain('실시간 문의');
      expect(sentPayloads[1]).not.toContain('&amp;lt;');
      expect(sentPayloads[2]).toContain('공유 링크 의견');
      expect(sentPayloads[3]).toContain('프로젝트 룸 메시지');

      for (const text of sentPayloads) {
        expect(text.match(/관리자 화면/g)?.length ?? 0).toBe(1);
      }
    } finally {
      await db.close();
    }
  });
});
