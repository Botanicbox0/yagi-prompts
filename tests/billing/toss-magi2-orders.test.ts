import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeTossGateway } from '@/lib/billing/toss-fake';
import { confirmTossOrder, createTossOrder } from '@/lib/billing/toss-service';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { createRenderJob } from '@/lib/renders/service';
import { createLocalRenderStore } from '@/lib/renders/store';
import { subscriptionTemplateEligibility } from '@/lib/premium-editing/eligibility';
import { selectiveOrderKrw } from '@/lib/twings/selective-frames';
import { viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * M1 fix 1, finding 1 — a MAGI-2 template can be sold only while `TWINGS_PERSONAL_MAGI2_ORDERS` is on (with both
 * render switches), because no order reaches the personal Sunra lane before slice M2. Driven through the REAL
 * checkout (lib/billing/toss-service.ts, unchanged) on the real schema: a row saved while the switch was on, or a
 * pending order made then, must be refused before any money moves once the switch is off.
 */

const gate = vi.hoisted(() => ({ open: true }));
vi.mock('@/lib/flags', async (original) => ({
  ...(await original<typeof import('@/lib/flags')>()),
  get RENDER_PIPELINE_PUBLIC() {
    return gate.open;
  },
  get RENDER_PIPELINE_MODE() {
    return gate.open ? 'on' : 'off';
  },
}));

const FILM = 'neon-alley-dolly'; // scripts/prompt-fixtures.ts; made a MAGI-2 row below
const buyer = viewerOf('free');
const PHOTO = { bytes: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg' };
const film = (resolution?: string) => ({ templateSlug: FILM, aspect: '9:16', locale: 'ko', photo: PHOTO, ...(resolution === undefined ? {} : { resolution }) });

function ordersSwitch(on: boolean) {
  vi.stubEnv('TWINGS_PERSONAL_MAGI2', 'on');
  vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', 'on');
  vi.stubEnv('TWINGS_PERSONAL_MAGI2_ORDERS', on ? 'on' : '');
}

describe('a MAGI-2 template at checkout while the order switch is off', () => {
  let h: PromptHarness;
  let gateway: ReturnType<typeof createFakeTossGateway>;
  beforeEach(async () => {
    gate.open = true;
    h = await promptHarness();
    gateway = createFakeTossGateway();
    // A MAGI-2 row as the admin form saves it: one 1080p price in price_krw, no second 1080p price.
    await h.sql.query(
      `update prompt_items set engine = 'magi-2', runtime_seconds = 10, price_cents = 300, price_krw = 4300,
         price_1080_cents = 0, price_1080_krw = 0 where slug = $1`,
      [FILM],
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
  });
  const deps = () => ({ sql: h.sql, store: createLocalRenderStore(h.root), gateway, createRender: createRenderJob });
  const orders = async () => (await h.sql.query<{ id: string; status: string; failure_code: string | null }>('select id,status,failure_code from billing_payments order by created_at')).rows;
  async function pay(orderId: string, amount: number) {
    gateway.authorize(orderId, amount);
    return confirmTossOrder(deps(), buyer, { orderId, paymentKey: gateway.keyFor(orderId), amount, consent: true });
  }

  it('creates no order: not_for_sale by default, bad_resolution for a named resolution', async () => {
    ordersSwitch(false);
    expect(await createTossOrder(deps(), buyer, film())).toEqual({ ok: false, code: 'not_for_sale' });
    expect(await createTossOrder(deps(), buyer, film(''))).toEqual({ ok: false, code: 'not_for_sale' });
    expect(await createTossOrder(deps(), buyer, film('1080p'))).toEqual({ ok: false, code: 'bad_resolution' });
    expect(await createTossOrder(deps(), buyer, film('720p'))).toEqual({ ok: false, code: 'bad_resolution' });
    // The render switches alone change nothing.
    vi.stubEnv('TWINGS_PERSONAL_MAGI2_ORDERS', '');
    vi.stubEnv('TWINGS_PERSONAL_MAGI2', '');
    vi.stubEnv('TWINGS_PERSONAL_SUNRA_FACES', '');
    expect(await createTossOrder(deps(), buyer, film())).toEqual({ ok: false, code: 'not_for_sale' });
    expect(await orders()).toEqual([]);
    expect(gateway.confirmCalls).toBe(0);
  });

  it('with all three switches on, sells it at its one price as a 1080p order', async () => {
    ordersSwitch(true);
    const created = await createTossOrder(deps(), buyer, film());
    if (!created.ok) throw new Error(created.code);
    expect(created.order).toMatchObject({ amountKrw: 4300, resolution: '1080p' });
  });

  it('refuses to approve an order made while the switch was on once it is off (price_changed, the provider never asked)', async () => {
    ordersSwitch(true);
    const created = await createTossOrder(deps(), buyer, film());
    if (!created.ok) throw new Error(created.code);
    ordersSwitch(false);
    expect(await pay(created.order.id, 4300)).toEqual({ ok: false, code: 'price_changed' });
    expect(gateway.confirmCalls).toBe(0);
    expect(await orders()).toEqual([{ id: created.order.id, status: 'failed', failure_code: 'price_changed' }]);
  });

  it('refuses a legacy order with no stored resolution the same way', async () => {
    ordersSwitch(true);
    const created = await createTossOrder(deps(), buyer, film());
    if (!created.ok) throw new Error(created.code);
    await h.sql.query('update billing_payments set resolution = null where id = $1', [created.order.id]);
    ordersSwitch(false);
    expect(await pay(created.order.id, 4300)).toEqual({ ok: false, code: 'price_changed' });
    expect(gateway.confirmCalls).toBe(0);
  });

  it('prices nothing on the store-credit and subscription paths either (the helpers they call)', async () => {
    ordersSwitch(false);
    const row = (await loadPromptBySlug(h.sql, FILM))!;
    expect(row.engine).toBe('magi-2');
    // lib/renders/service.ts createStoreIapRenderJob: renderableResolution → selectiveOrderKrw → not_for_sale on null.
    for (const resolution of ['1080p', '720p', null] as const) expect(selectiveOrderKrw(row, null, null, resolution).amountKrw).toBeNull();
    // The monthly-subscription path admits Seedance 2.5 templates only; a MAGI-2 row is never eligible.
    expect(subscriptionTemplateEligibility(row)).toBeNull();
    expect(subscriptionTemplateEligibility(row, '1080p')).toBeNull();
    ordersSwitch(true);
    expect(subscriptionTemplateEligibility(row, '1080p')).toBeNull();
  });
});
