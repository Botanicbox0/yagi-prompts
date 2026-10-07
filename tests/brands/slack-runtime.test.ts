import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
vi.mock('server-only', () => ({}));
import { runLiveBrandInquiryDelivery } from '@/lib/brands/slack-runtime';

describe('live Slack delivery deployment guard', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it.each(['preview', 'development', undefined])('does not query or send in %s even with copied production settings', async environment => {
    vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('SLACK_BRAND_INQUIRIES_ENABLED', 'on');
    vi.stubEnv('SLACK_BRAND_INQUIRIES_WEBHOOK_URL', 'https://hooks.slack.com/services/TTEST/BTEST/test-secret');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const query = vi.fn();
    const sql: SqlRunner = { query, transaction: async fn => fn(sql) };
    expect(await runLiveBrandInquiryDelivery(sql)).toMatchObject({ configuration: 'disabled', claimed: 0 });
    expect(query).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
