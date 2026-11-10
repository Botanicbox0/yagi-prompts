/**
 * PLAN §3.5 — "delivery ships in M5; zero notification UI before that. Until M5, the publish RPC
 * is called with p_notify_kind = NULL (enforced by a server flag) and no checkbox exists in admin."
 *
 * This is that server flag. **M5 flipped it**, and flipping it is what turns on, together:
 *   · the admin publish checkbox (`components/admin/editor-panels.tsx`) and the `p_notify_kind`
 *     argument it reaches the RPC through (`lib/publish/pipeline.ts`);
 *   · the two `/account` toggles;
 *   · the worker's willingness to find work at all — with no jobs enqueued, it has none.
 * Turning it back off stops NEW jobs being enqueued; jobs already in the outbox stay valid, which
 * is the correct kill-switch semantics for a durable queue.
 */
export const NOTIFICATIONS_ENABLED = true;

/** PLAN §3.6 — the ad rail is a single house placeholder until a real advertiser exists. */
export const AD_SLOTS_DB_BACKED = false;

/**
 * PLAN §4 — `/[locale]/p/[slug]`. M2 shipped it, so the §3.1 split is live again: showcase cards
 * link to the public detail page, everything else funnels through the login wall.
 */
export const PLAYBOOK_DETAIL_ROUTE_READY = true;

/**
 * PLAN §13.2 — "Nav becomes: **Prompts · Pricing** (+ locale toggle, sign in). Library/playbooks
 * denavigated behind `PLAYBOOKS_IN_NAV=false` (routes stay functional; fixtures keep the machinery
 * tested)."
 *
 * DENAVIGATED, not deleted, and the distinction is the whole point of the flag: `/library`,
 * `/[locale]/p/[slug]`, the media gateway, the publish RPCs and every one of their tests keep
 * working exactly as merged. Flipping this back to `true` restores the link in the nav and the
 * footer and nothing else has to change — which is what "leave the nav until re-activated" asks
 * for, as one greppable constant rather than a deletion somebody has to undo by hand.
 */
export const PLAYBOOKS_IN_NAV = false;

/**
 * docs/TEMPLATES-IA.md §8 — the render queue is LIVE for admins and a demo for everyone else until
 * payment is live. Opening it lets every signed-in reader pay (Toss) and start a render; the studio
 * follows through `/api/renders/access`.
 *
 * Going live is an ENVIRONMENT change, not a code deploy (docs/qa/toss-checkout/README.md "운영
 * 개시"): `RENDER_PIPELINE_PUBLIC=on` in Vercel, then redeploy. Production additionally refuses to
 * open unless BOTH Toss keys are a live widget pair (`live_gck_`/`live_gsk_`, `tossKeyKind`) — a
 * test key there would take no money and hand every visitor a free film. Preview and local runs
 * may open on test keys for QA.
 *
 * `=review` is the third state, and it exists because `=on` alone cannot pass a PG review.
 * 토스페이먼츠 심사 체크리스트(notice/20057)는 **테스트 API 키로 결제창 연동을 끝낸 상태**와
 * **판매 가능한 상품 1개 이상**을 요구한다. 그런데 라이브 키는 그 심사를 통과해야 발급된다. 즉
 * `=on`의 라이브 키 조건은 심사를 구조적으로 통과 불가능하게 만든다 — 이것이 반려의 실제 원인이다.
 *
 * `review` resolves that without handing anyone a free film: the storefront reads as open (a real
 * price and a real buy CTA, which is what an anonymous reviewer checks), but only the server-marked
 * 심사 계정(`app_metadata.purpose = 'toss_review'`, lib/auth/review-login.ts)이 결제·생성까지 끝낼
 * 수 있다. Ordinary customers keep seeing the closed studio, so test keys can never take a real
 * order. It is NOT 공개 판매 개시 — that stays `=on`, and stays 대표 결정 (AGENTS.md §6).
 */
export type RenderPipelineMode = 'off' | 'review' | 'on';

/**
 * The one rule for a usable Toss key pair, shared with `lib/billing/toss-gateway.ts`: a payment-widget
 * client key (`*_gck_`) and the secret key of the same kind (`*_gsk_`). null = not a usable pair.
 *
 * docs/PLATFORM-2.0.md §2.2-3 — production reads the keys by THIS rule, not by a `live_` prefix: `on`
 * needs a live widget pair, `review` a test widget pair. Anything else closes the pipeline with one
 * error line, because an open storefront whose every payment the gateway refuses is worse than a
 * closed one. Preview and local runs keep opening on any keys, for QA.
 */
export function tossKeyKind(env: Record<string, string | undefined>): 'test' | 'live' | null {
  const client = env.TOSS_CLIENT_KEY?.trim() ?? '';
  const secret = env.TOSS_SECRET_KEY?.trim() ?? '';
  const kind = client.startsWith('test_gck_') ? 'test' : client.startsWith('live_gck_') ? 'live' : null;
  return kind !== null && secret.startsWith(`${kind}_gsk_`) ? kind : null;
}

type FlagLog = Pick<Console, 'warn' | 'error'>;

export function renderPipelineMode(
  env: Record<string, string | undefined> = process.env,
  log: FlagLog = console,
): RenderPipelineMode {
  const setting = env.RENDER_PIPELINE_PUBLIC?.trim().toLowerCase();
  if (setting !== 'review' && setting !== 'on') return 'off';
  // A documentation example key takes no payment at THIS shop: no review evidence, no sale. Said, not blocked.
  if (`${env.TOSS_CLIENT_KEY ?? ''} ${env.TOSS_SECRET_KEY ?? ''}`.includes('_docs_'))
    log.warn(`[billing] ${JSON.stringify({ event: 'toss_docs_key', setting })}`);
  if (env.VERCEL_ENV !== 'production') return setting;
  const required = setting === 'on' ? 'live' : 'test';
  const keys = tossKeyKind(env);
  if (keys === required) return setting;
  // Kinds only, never a key value.
  log.error(`[billing] ${JSON.stringify({ event: 'render_pipeline_closed', setting, required, keys: keys ?? 'invalid' })}`);
  return 'off';
}

/** Unchanged meaning: the pipeline is open to EVERY signed-in reader. `review` is not that. */
export function renderPipelinePublic(env: Record<string, string | undefined> = process.env): boolean {
  return renderPipelineMode(env) === 'on';
}

export const RENDER_PIPELINE_MODE = renderPipelineMode();
export const RENDER_PIPELINE_PUBLIC = RENDER_PIPELINE_MODE === 'on';

/**
 * docs/TEMPLATES-IA.md §12 (2026-09-14) — how a person's photo becomes a ModelArk reference.
 *
 *   `virtual`   the AIGC ("digital character") library: no camera check, one group per account,
 *               the photo is the asset. What the product runs on — BytePlus's account manager
 *               confirmed in writing (2026-09-13) that a person's own consented selfie may use it.
 *   `liveness`  the H5 real-person check first, then assets compared to the verified face. Kept
 *               whole; `ARK_ASSET_MODE=liveness` switches back without a deploy of new code, and
 *               tests pin their mode explicitly.
 */
export const ASSET_LIBRARY_MODE: 'virtual' | 'liveness' = 'virtual';

/**
 * docs/TEMPLATES-IA.md §12 (founder, 2026-09-30) — on the free asset tier, a person's face stays at
 * the bank only while one of their renders is in flight; each render pass then deletes it
 * (lib/identity/rotation.ts `releaseAfterUse`). `ARK_RELEASE_AFTER_USE=off` stops it without a code
 * change — e.g. after moving to the paid tier, where keeping faces saves a re-upload.
 */
export const ASSET_RELEASE_AFTER_USE = true;

/**
 * docs/SECONDARY-USAGE.md — on-site payment for brand secondary-usage ("2차 활용") quotes. Default
 * OFF: open only when the server environment says exactly `BRAND_USAGE_PAYMENTS=on`. Independent of
 * `RENDER_PIPELINE_PUBLIC` (neither opens the other). Inquiries, the studio's scope/consent/quote work
 * and the brand's view of a quote all work while it is off; only acceptance and payment wait for it.
 * Payment recovery (reconcile, admin refund) runs regardless, so an in-flight payment is never stranded.
 */
export function brandUsagePaymentsOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_USAGE_PAYMENTS === 'on';
}

/**
 * docs/BRAND-STUDIO-V2.md — the brand studio v2 (real generation, asset library, campaign handoff).
 * Default OFF: open only when the server environment says exactly `BRAND_STUDIO_V2=on`. Off means
 * every studio v2 API answers `studio_closed` and the screens stay as they were.
 */
export function brandStudioV2Open(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAND_STUDIO_V2 === 'on';
}
