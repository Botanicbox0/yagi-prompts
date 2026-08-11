import { describe, expect, it } from 'vitest';
import { createLiveStripeGateway, signWebhookPayload } from '@/lib/billing/stripe-live';
import { StripeSignatureError } from '@/lib/billing/stripe-gateway';

/**
 * PLAN §3.4 — "`/api/stripe/webhook`, signature-verified".
 *
 * This is the one part of the Stripe integration that is genuinely testable with no account and no
 * network: signing and verification are pure HMAC over the raw body, and the pinned SDK exposes
 * both halves (`generateTestHeaderStringAsync` / `constructEventAsync`). So the LIVE gateway is
 * under test here — not the fake — which means the thing shipping to production is the thing
 * verified.
 *
 * A forged or replayed body must be a refusal, never a throw the route turns into a 500 and Stripe
 * then retries forever.
 */

const SECRET = 'whsec_test_2f7c9d1a55b4e08c1f6d3a9b7e4c2510';

const CONFIG = {
  secretKey: 'sk_test_offline_never_used',
  webhookSecret: SECRET,
  pricePro: 'price_test_pro',
};

const gateway = createLiveStripeGateway(CONFIG);

const body = JSON.stringify({
  id: 'evt_signed_1',
  object: 'event',
  type: 'customer.subscription.updated',
  created: 1786000000,
  data: { object: { id: 'sub_1', customer: 'cus_signed_1', client_reference_id: null } },
});

describe('webhook signature verification (real SDK)', () => {
  it('accepts a correctly signed payload and flattens it', async () => {
    const signature = await signWebhookPayload(body, SECRET);
    const event = await gateway.constructWebhookEvent(body, signature);

    expect(event.id).toBe('evt_signed_1');
    expect(event.type).toBe('customer.subscription.updated');
    expect(event.created).toBe(1786000000);
    // The ONLY fields taken from a payload are identifiers — §3.4 "never trust event payloads as state".
    expect(event.customerId).toBe('cus_signed_1');
    expect(event.clientReferenceId).toBeNull();
  });

  it('rejects a tampered payload signed for different bytes', async () => {
    const signature = await signWebhookPayload(body, SECRET);
    const tampered = body.replace('cus_signed_1', 'cus_attacker');

    await expect(gateway.constructWebhookEvent(tampered, signature)).rejects.toBeInstanceOf(
      StripeSignatureError,
    );
  });

  it('rejects a signature made with a different secret', async () => {
    const signature = await signWebhookPayload(body, 'whsec_a_completely_different_secret_value');
    await expect(gateway.constructWebhookEvent(body, signature)).rejects.toBeInstanceOf(
      StripeSignatureError,
    );
  });

  it('rejects a missing, empty or malformed signature header', async () => {
    for (const header of [null, '', 'garbage', 't=1,v1=deadbeef']) {
      await expect(
        gateway.constructWebhookEvent(body, header),
        String(header),
      ).rejects.toBeInstanceOf(StripeSignatureError);
    }
  });

  it('rejects a replay outside the signature timestamp tolerance', async () => {
    // Signed with a timestamp far in the past: the body is authentic, the delivery is not fresh.
    const stale = await signWebhookPayload(body, SECRET, { timestamp: 1600000000 });
    await expect(gateway.constructWebhookEvent(body, stale)).rejects.toBeInstanceOf(
      StripeSignatureError,
    );
  });

  it('extracts client_reference_id when the event carries one', async () => {
    const withReference = JSON.stringify({
      id: 'evt_signed_2',
      object: 'event',
      type: 'checkout.session.completed',
      created: 1786000001,
      data: {
        object: {
          id: 'cs_1',
          customer: 'cus_signed_2',
          client_reference_id: 'f0000000-0000-4000-8000-000000000001',
        },
      },
    });
    const signature = await signWebhookPayload(withReference, SECRET);
    const event = await gateway.constructWebhookEvent(withReference, signature);
    expect(event.clientReferenceId).toBe('f0000000-0000-4000-8000-000000000001');
  });
});
