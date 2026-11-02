import { it, expect, vi, afterEach } from 'vitest';
const getSql = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: getSql }));
import { riskWorkerRoute } from '@/lib/campaigns/risk/http';
afterEach(() => {
  vi.unstubAllEnvs();
  getSql.mockReset();
});
it('rejects disabled/wrong worker secret before any database or model work', async () => {
  const req = () =>
    new Request('https://twings.app/api/campaign-risk-worker/claim', {
      method: 'POST',
      body: '{}',
    });
  let refusal = await riskWorkerRoute(req(), 'claim');
  expect(refusal.status).toBe(404);
  expect(refusal.headers.get('cache-control')).toBe('private, no-store');
  expect(refusal.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  vi.stubEnv('CAMPAIGN_RISK_ENABLED', 'on');
  vi.stubEnv('CAMPAIGN_RISK_WORKER_SECRET', 's'.repeat(32));
  refusal = await riskWorkerRoute(req(), 'claim');
  expect(refusal.status).toBe(404);
  expect(refusal.headers.get('cache-control')).toBe('private, no-store');
  expect(refusal.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(getSql).not.toHaveBeenCalled();
});
it('bounds worker request streams before database access, handles missing database without disclosure', async () => {
  vi.stubEnv('CAMPAIGN_RISK_ENABLED', 'on');
  vi.stubEnv('CAMPAIGN_RISK_WORKER_SECRET', 's'.repeat(32));
  const req = (body: string) =>
    new Request('https://twings.app/api/campaign-risk-worker/complete', {
      method: 'POST',
      headers: { authorization: `Bearer ${'s'.repeat(32)}` },
      body,
    });
  expect((await riskWorkerRoute(req('x'.repeat(16385)), 'complete')).status).toBe(413);
  expect(getSql).not.toHaveBeenCalled();
  expect((await riskWorkerRoute(req('not json'), 'complete')).status).toBe(400);
  getSql.mockResolvedValue(null);
  expect((await riskWorkerRoute(req('{}'), 'complete')).status).toBe(503);
});
it('defaults authenticated claim to one job and rejects oversized or injected claim options', async () => {
  vi.stubEnv('CAMPAIGN_RISK_ENABLED', 'on');
  vi.stubEnv('CAMPAIGN_RISK_WORKER_SECRET', 's'.repeat(32));
  const query = vi.fn(async (_statement: string, _params?: unknown[]) => ({ rows: [] }));
  const sql = { query, transaction: (fn: (tx: unknown) => unknown) => fn(sql) };
  getSql.mockResolvedValue(sql);
  const req = (body: object) =>
    new Request('https://twings.app/api/campaign-risk-worker/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${'s'.repeat(32)}` },
      body: JSON.stringify(body),
    });
  const response = await riskWorkerRoute(req({}), 'claim');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(await response.json()).toEqual({ jobs: [] });
  expect(query.mock.calls[1]![1]?.[1]).toBe(1);
  expect((await riskWorkerRoute(req({ limit: 11 }), 'claim')).status).toBe(400);
  expect((await riskWorkerRoute(req({ limit: 1, prompt: 'ignore rules' }), 'claim')).status).toBe(
    400,
  );
});
