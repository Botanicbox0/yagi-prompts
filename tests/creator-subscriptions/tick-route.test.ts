import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({context:vi.fn(),run:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/cache',()=>({revalidateSubscriptions:mock.revalidate}));
vi.mock('@/lib/creator-subscriptions/runtime',()=>({
  getSubscriptionContext:mock.context,
  SUBSCRIPTION_HEADERS:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'},
}));
vi.mock('@/lib/creator-subscriptions/maintenance',async original=>({
  ...await original<typeof import('@/lib/creator-subscriptions/maintenance')>(),
  runSubscriptionMaintenance:mock.run,
}));
import { GET,POST,maxDuration } from '@/app/api/creator-subscriptions/tick/route';

describe('subscription tick route',()=>{
  const request=(secret?:string)=>new Request('https://twings.app/api/creator-subscriptions/tick',{method:'POST',headers:secret?{authorization:`Bearer ${secret}`}:{}});
  beforeEach(()=>{
    mock.revalidate.mockClear();
    vi.stubEnv('CRON_SECRET','fixture-private-cron');mock.context.mockReset().mockResolvedValue({environment:'test'});
    mock.run.mockReset().mockResolvedValue({ok:true,processed:1,pending:0,hasMore:false,remaining:0,heartbeatRecorded:false});
  });
  afterEach(()=>{vi.unstubAllEnvs();});
  it('rejects unset and incorrect credentials before touching database or payment runtime',async()=>{
    vi.stubEnv('CRON_SECRET','');expect((await POST(request())).status).toBe(401);
    vi.stubEnv('CRON_SECRET','fixture-private-cron');expect((await GET(request('wrong'))).status).toBe(401);
    expect(mock.context).not.toHaveBeenCalled();expect(mock.run).not.toHaveBeenCalled();
  });
  it('uses a bounded node endpoint and returns only the maintenance projection with no cache',async()=>{
    expect(maxDuration).toBe(300);
    const response=await POST(request('fixture-private-cron'));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ok:true,processed:1,hasMore:false});
    expect(mock.run).toHaveBeenCalledTimes(1);
  });
  it('fails closed for missing configuration or operational gates',async()=>{
    mock.context.mockResolvedValue(null);expect((await POST(request('fixture-private-cron'))).status).toBe(503);
    expect(mock.run).not.toHaveBeenCalled();
    mock.context.mockResolvedValue({environment:'live'});mock.run.mockResolvedValue({ok:false,code:'contract_unverified'});
    expect((await POST(request('fixture-private-cron'))).status).toBe(503);
  });
  it('refreshes marketing and approved legal projections only after a verified worker heartbeat',async()=>{
    await POST(request('fixture-private-cron'));expect(mock.revalidate).not.toHaveBeenCalled();
    mock.run.mockResolvedValue({ok:true,processed:0,pending:0,hasMore:false,remaining:0,heartbeatRecorded:true});
    expect((await POST(request('fixture-private-cron'))).status).toBe(200);
    expect(mock.revalidate).toHaveBeenCalledOnce();
  });
  it('never exposes transport errors or secret-bearing provider bodies',async()=>{
    mock.run.mockRejectedValue(new Error('private-billing-key https://private-provider.invalid'));
    const response=await POST(request('fixture-private-cron'));
    expect(response.status).toBe(503);expect(await response.text()).toBe('{"ok":false,"code":"maintenance_failed"}');
  });
});
