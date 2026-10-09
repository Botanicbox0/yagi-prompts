import { describe, expect, it, vi } from 'vitest';
import { billingConfigFromEnv, createSubscriptionGateway } from '@/lib/creator-subscriptions/gateway';
import { createBillingKeyCipher } from '@/lib/creator-subscriptions/crypto';

describe('dedicated recurring billing provider boundary', () => {
  const config={kind:'test' as const,clientKey:'test_ck_fixture',secretKey:'test_sk_fixture'};
  it('never reuses widget credentials, mixed environments or incomplete billing pairs', () => {
    expect(billingConfigFromEnv({TOSS_CLIENT_KEY:'live_gck_widget',TOSS_SECRET_KEY:'live_gsk_widget'})).toBeNull();
    expect(()=>billingConfigFromEnv({TOSS_BILLING_CLIENT_KEY:'test_gck_widget',TOSS_BILLING_SECRET_KEY:'test_gsk_widget'})).toThrow();
    expect(()=>billingConfigFromEnv({TOSS_BILLING_CLIENT_KEY:'test_ck_fixture',TOSS_BILLING_SECRET_KEY:'live_sk_fixture'})).toThrow();
    expect(()=>billingConfigFromEnv({TOSS_BILLING_CLIENT_KEY:'test_ck_fixture'})).toThrow();
    expect(billingConfigFromEnv({TOSS_BILLING_CLIENT_KEY:config.clientKey,TOSS_BILLING_SECRET_KEY:config.secretKey})).toEqual(config);
  });
  it('encrypts with random nonce and binds the billing key to subscription and environment', () => {
    const c=createBillingKeyCipher(Buffer.alloc(32,5).toString('base64'));
    const a=c.encrypt('private-token','test:subscription-one');
    const b=c.encrypt('private-token','test:subscription-one');
    expect(a).not.toBe(b);expect(a).not.toContain('private-token');
    expect(c.decrypt(a,'test:subscription-one')).toBe('private-token');
    expect(()=>c.decrypt(a,'live:subscription-one')).toThrow();
    expect(()=>c.decrypt(a,'test:subscription-two')).toThrow();
    expect(()=>c.decrypt(a.slice(0,-3)+'xyz','test:subscription-one')).toThrow();
    expect(()=>createBillingKeyCipher('weak-key')).toThrow();
  });
  it('issues billing authorization then posts the server amount with idempotency and a 65-second timeout', async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({billingKey:'private-key',customerKey:'random-customer'}))
      .mockResolvedValueOnce(Response.json({paymentKey:'pk',orderId:'order-uuid',totalAmount:24900,balanceAmount:24900,currency:'KRW',status:'DONE'}));
    const timeout=vi.spyOn(AbortSignal,'timeout');
    const g=createSubscriptionGateway(config,fetcher);
    expect(await g.issue({authKey:'auth',customerKey:'random-customer',idempotencyKey:'issue-id'})).toEqual({billingKey:'private-key',customerKey:'random-customer'});
    await g.charge({billingKey:'private-key',customerKey:'random-customer',orderId:'order-uuid',orderName:'TWINGS Creator',amount:24900,idempotencyKey:'charge-id'});
    expect(timeout).toHaveBeenCalledWith(65000); timeout.mockRestore();
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.tosspayments.com/v1/billing/authorizations/issue');
    expect(fetcher.mock.calls[1]![0]).toBe('https://api.tosspayments.com/v1/billing/private-key');
    expect(fetcher.mock.calls[1]![1]).toMatchObject({redirect:'error',cache:'no-store',headers:{'Idempotency-Key':'charge-id'}});
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({amount:24900,orderId:'order-uuid'});
  });
  it('only a documented NOT_FOUND_PAYMENT result permits a retry; network and proxy errors stay ambiguous', async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({code:'NOT_FOUND_PAYMENT'},{status:404}))
      .mockResolvedValueOnce(new Response('proxy error',{status:404}))
      .mockRejectedValueOnce(new Error('private URL and secret transport detail'));
    const g=createSubscriptionGateway(config,fetcher);
    expect(await g.retrieveOrder('order')).toBeNull();
    await expect(g.retrieveOrder('order')).rejects.toThrow('Payment provider request could not be completed');
    await expect(g.retrieveOrder('order')).rejects.toThrow('Payment provider request could not be completed');
  });
  it('revokes an unused billing key through the documented DELETE endpoint with an empty success body', async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:200}));
    await createSubscriptionGateway(config,fetcher).revokeBillingKey({billingKey:'unused-key',idempotencyKey:'cleanup-key'});
    expect(fetcher.mock.calls[0]).toMatchObject(['https://api.tosspayments.com/v1/billing/unused-key',{method:'DELETE',headers:{'Idempotency-Key':'cleanup-key'}}]);
  });
});
