import { describe,expect,it,vi } from 'vitest';
import worker,{ runScheduledRenewals,TICK_URL } from '@/ops/creator-subscriptions-worker/src/index';

describe('prepared Cloudflare renewal worker',()=>{
  const env={CRON_SECRET:'fixture-private-cron',SUBSCRIPTION_WORKER_ENABLED:'on'};
  it('does no network work without both explicit enablement and the private secret',async()=>{
    const fetcher=vi.fn<typeof fetch>();
    expect(await runScheduledRenewals({}, {fetcher})).toMatchObject({batches:0,stopped:'disabled'});
    expect(await runScheduledRenewals({SUBSCRIPTION_WORKER_ENABLED:'on'}, {fetcher})).toMatchObject({batches:0,stopped:'misconfigured'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('calls only the exact production endpoint and stops when no more work remains',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true,hasMore:false}));
    expect(await runScheduledRenewals({...env,TARGET_URL:'https://attacker.invalid'}, {fetcher})).toMatchObject({batches:1,stopped:'complete'});
    expect(TICK_URL).toBe('https://twings.app/api/creator-subscriptions/tick');
    expect(fetcher.mock.calls[0]).toMatchObject([TICK_URL,{method:'POST',redirect:'error',headers:{Authorization:'Bearer fixture-private-cron'}}]);
  });
  it('allows at most three batches and only after each successful hasMore response',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({ok:true,hasMore:true}));
    expect(await runScheduledRenewals(env,{fetcher})).toMatchObject({batches:3,stopped:'batch_limit'});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('never retries a timeout or HTTP error and never consumes an error body',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-bearing upstream URL'));
    expect(await runScheduledRenewals(env,{fetcher})).toMatchObject({batches:0,stopped:'request_failed'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const response=new Response('private provider details',{status:503});const read=vi.spyOn(response,'text');
    fetcher.mockReset().mockResolvedValue(response);
    expect(await runScheduledRenewals(env,{fetcher})).toMatchObject({batches:0,stopped:'unavailable'});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();
  });
  it('reserves a complete request window before starting another batch',async()=>{
    let time=0;const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>{time+=600000;return Response.json({ok:true,hasMore:true});});
    expect(await runScheduledRenewals(env,{fetcher,now:()=>time})).toMatchObject({batches:1,stopped:'budget'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed and oversized success bodies instead of treating them as another billing instruction',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ok:true,hasMore:'true'}))
      .mockResolvedValueOnce(Response.json({ok:true,hasMore:true,extra:'x'.repeat(4096)}));
    expect(await runScheduledRenewals(env,{fetcher})).toMatchObject({batches:0,stopped:'invalid_response'});
    expect(await runScheduledRenewals(env,{fetcher})).toMatchObject({batches:0,stopped:'invalid_response'});
  });
  it('uses a 270-second timeout and reports only a sanitized scheduler failure to Cloudflare',async()=>{
    const timeout=vi.spyOn(AbortSignal,'timeout');
    const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('private-secret transport detail'));
    vi.stubGlobal('fetch',fetcher);
    try {
      await expect(worker.scheduled({cron:'*/15 * * * *',scheduledTime:0},env)).rejects.toThrow('subscription_scheduler_request_failed');
      expect(timeout).toHaveBeenCalledWith(270000);expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {timeout.mockRestore();vi.unstubAllGlobals();}
  });
});
