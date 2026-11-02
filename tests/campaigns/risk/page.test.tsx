import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it, expect, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw Error('not_found');
  },
}));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => ({ userId: 'synthetic-admin' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/i18n/dictionaries', () => ({ getDictionary: () => ({ admin: {} }) }));
vi.mock('@/lib/campaigns/risk/admin', () => ({
  loadRiskInbox: async () => ({
    ready: true,
    enabled: false,
    workerUnavailable: true,
    modelUnavailable: true,
    lastSeen: null,
    jobs: [],
    slack: [],
    flags: [],
    slackConfig: 'disabled',
    source: null,
  }),
}));
vi.mock('@/components/admin/chrome', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  Panel: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  OpForm: () => null,
  INPUT: 'input',
  BUTTON: 'button',
}));
import RiskPage from '@/app/(admin)/admin/risk/page';
it('renders a localized disabled Slack status separately from the analysis-disabled explanation', async () => {
  const html = renderToStaticMarkup(await RiskPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain('발송 꺼짐');
  expect(html).toContain('분석이 꺼져 있습니다.');
  expect(html).toContain('로컬 모델 분석에 실패한 작업이 있습니다.');
  expect(html).not.toContain('>disabled<');
  expect(html).toContain('campaignRisk.slackConnectionTest');
  expect(html).toContain('Slack 연결 점검');
  expect(html).toMatch(/<button[^>]*disabled=""/);
});
