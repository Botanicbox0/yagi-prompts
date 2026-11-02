import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({context:vi.fn(),run:vi.fn(),shown:vi.fn(),current:vi.fn(),tag:vi.fn(),path:vi.fn()}));
vi.mock('next/cache',()=>({revalidateTag:mock.tag,revalidatePath:mock.path}));
vi.mock('@/lib/creator-subscriptions/cached-availability',()=>({cachedPublicSubscriptionAnswer:mock.shown,freshPublicSubscriptionAnswer:mock.current}));
vi.mock('@/lib/creator-subscriptions/runtime',()=>({
  getSubscriptionContext:mock.context,
  SUBSCRIPTION_HEADERS:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'},
}));
vi.mock('@/lib/creator-subscriptions/maintenance',async original=>({
  ...await original<typeof import('@/lib/creator-subscriptions/maintenance')>(),
  runSubscriptionMaintenance:mock.run,
}));
import { GET,POST,maxDuration } from '@/app/api/creator-subscriptions/tick/route';

const answer=(status:'open'|'preparing',termsApproved=true)=>
  [{status,version:'fixture',plans:{creator:{status},premium:{status}},editing:status,premiumEditRequestsPerPeriod:30},termsApproved];
// Spelled out, not derived from lib/cache.ts: this is what one heartbeat purged before 2026-11-02.
const EVERY_SUBSCRIPTION_PAGE=[
  ['/en'],['/en/pricing'],['/en/faq'],['/en/legal/terms'],['/en/legal/refund'],['/en/legal/privacy'],
  ['/ko'],['/ko/pricing'],['/ko/faq'],['/ko/legal/terms'],['/ko/legal/refund'],['/ko/legal/privacy'],
  ['/[locale]/t/[slug]','page'],['/llms.txt'],['/llms-full.txt'],
];

describe('subscription tick route',()=>{
  const request=(secret?:string)=>new Request('https://twings.app/api/creator-subscriptions/tick',{method:'POST',headers:secret?{authorization:`Bearer ${secret}`}:{}});
  const sql={query:vi.fn(),transaction:vi.fn()};
  const heartbeat={ok:true,processed:0,pending:0,hasMore:false,remaining:0,heartbeatRecorded:true};
  beforeEach(()=>{
    mock.tag.mockClear();mock.path.mockClear();
    vi.stubEnv('CRON_SECRET','fixture-private-cron');mock.context.mockReset().mockResolvedValue({environment:'test',sql});
    mock.run.mockReset().mockResolvedValue({ok:true,processed:1,pending:0,hasMore:false,remaining:0,heartbeatRecorded:false});
    mock.shown.mockReset().mockResolvedValue(answer('open'));mock.current.mockReset().mockResolvedValue(answer('open'));
  });
  afterEach(()=>{vi.unstubAllEnvs();});
  it('rejects unset and incorrect credentials before touching database or payment runtime',async()=>{
    vi.stubEnv('CRON_SECRET','');expect((await POST(request())).status).toBe(401);
    vi.stubEnv('CRON_SECRET','fixture-private-cron');expect((await GET(request('wrong'))).status).toBe(401);
    expect(mock.context).not.toHaveBeenCalled();expect(mock.run).not.toHaveBeenCalled();
    expect(mock.shown).not.toHaveBeenCalled();expect(mock.current).not.toHaveBeenCalled();
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
    expect(mock.run).not.toHaveBeenCalled();expect(mock.current).not.toHaveBeenCalled();
    mock.context.mockResolvedValue({environment:'live',sql});mock.run.mockResolvedValue({ok:false,code:'contract_unverified'});
    expect((await POST(request('fixture-private-cron'))).status).toBe(503);
  });
  it('purges nothing when a heartbeat leaves the public answer as it was',async()=>{
    mock.run.mockResolvedValue(heartbeat);
    const response=await POST(request('fixture-private-cron'));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({heartbeatRecorded:true});
    // The answer pages were built from, against the answer read now, after the heartbeat was written.
    expect(mock.shown).toHaveBeenCalledOnce();expect(mock.current).toHaveBeenCalledExactlyOnceWith(sql);
    expect(mock.run.mock.invocationCallOrder[0]).toBeLessThan(mock.current.mock.invocationCallOrder[0]!);
    expect(mock.tag).not.toHaveBeenCalled();expect(mock.path).not.toHaveBeenCalled();
  });
  it('purges every subscription page when the heartbeat that ends a lapse reopens subscriptions',async()=>{
    mock.run.mockResolvedValue(heartbeat);mock.shown.mockResolvedValue(answer('preparing'));
    expect((await POST(request('fixture-private-cron'))).status).toBe(200);
    expect(mock.tag.mock.calls).toEqual([['creator-subscription-status']]);
    expect(mock.path.mock.calls).toEqual(EVERY_SUBSCRIPTION_PAGE);
  });
  it.each([
    ['maintenance throws',()=>mock.run.mockRejectedValue(new Error('processor failed')),'maintenance_failed'],
    ['maintenance refuses',()=>mock.run.mockResolvedValue({ok:false,code:'contract_unverified'}),'contract_unverified'],
  ])('purges every subscription page when a lapse closes subscriptions on a tick where %s',async(_name,arrange,code)=>{
    arrange();mock.current.mockResolvedValue(answer('preparing'));
    const response=await POST(request('fixture-private-cron'));
    expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code});
    expect(mock.tag.mock.calls).toEqual([['creator-subscription-status']]);
    expect(mock.path.mock.calls).toEqual(EVERY_SUBSCRIPTION_PAGE);
  });
  it('purges when only the approval of the monthly terms changed, since the legal pages show it',async()=>{
    mock.run.mockResolvedValue(heartbeat);mock.shown.mockResolvedValue(answer('open',false));
    await POST(request('fixture-private-cron'));
    expect(mock.tag).toHaveBeenCalledOnce();expect(mock.path).toHaveBeenCalledTimes(EVERY_SUBSCRIPTION_PAGE.length);
  });
  it.each([
    ['the answer pages were built from',()=>mock.shown.mockRejectedValue(new Error('timeout exceeded when trying to connect'))],
    ['the answer read now',()=>mock.current.mockRejectedValue(new Error('timeout exceeded when trying to connect'))],
  ])('keeps every page when reading %s fails, and still reports the heartbeat',async(_name,arrange)=>{
    // A read that failed gave no answer, and a purge during an outage leaves visitors a render that throws.
    mock.run.mockResolvedValue(heartbeat);mock.shown.mockResolvedValue(answer('preparing'));arrange();
    const response=await POST(request('fixture-private-cron'));
    expect(response.status).toBe(200);expect(await response.json()).toEqual(heartbeat);
    expect(mock.tag).not.toHaveBeenCalled();expect(mock.path).not.toHaveBeenCalled();
  });
  it('never exposes transport errors or secret-bearing provider bodies',async()=>{
    mock.run.mockRejectedValue(new Error('private-billing-key https://private-provider.invalid'));
    const response=await POST(request('fixture-private-cron'));
    expect(response.status).toBe(503);expect(await response.text()).toBe('{"ok":false,"code":"maintenance_failed"}');
  });
});
