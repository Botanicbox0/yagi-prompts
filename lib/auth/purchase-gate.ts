import type { Viewer } from '@/lib/auth/identity';
import { RENDER_PIPELINE_MODE, type RenderPipelineMode } from '@/lib/flags';

/**
 * The ONE answer to "may this viewer buy and start a render right now", shared by the render
 * enqueue, the Toss order/confirm service, the consent route and the order page, so a PG reviewer
 * cannot be let through one of them and refused by another.
 *
 * A leaf module on purpose: `lib/flags.ts` and the `Viewer` type only, so both `lib/renders` and
 * `lib/billing` can import it without a cycle.
 *
 *   off     nobody but an admin (the default, and what every customer sees today)
 *   review  admins and the server-marked 심사 계정 only — test keys, no public sale (lib/flags.ts)
 *   on      every signed-in reader, and production demands live Toss keys before it means that
 */
export function purchaseOpenFor(
  viewer: Viewer,
  mode: RenderPipelineMode = RENDER_PIPELINE_MODE,
): boolean {
  if (viewer.userId === null) return false;
  if (viewer.isAdmin) return true;
  if (mode === 'on') return true;
  return mode === 'review' && viewer.review === true;
}

/**
 * Does the STOREFRONT read as open — a real price and a real buy CTA rather than "곧 열립니다"?
 *
 * Deliberately not the same question as `purchaseOpenFor`: 토스 심사자는 로그인하기 전에 먼저
 * 익명으로 상품 페이지를 본다. 체크리스트의 "판매 가능한 상품 1개 이상"은 그 화면에서 판정된다.
 * Saying "sign in to buy" to a signed-out visitor is true in `review` mode — the 심사 계정으로
 * 로그인하면 실제로 살 수 있다 — while the closed studio still refuses every ordinary account.
 */
export function storefrontOpen(mode: RenderPipelineMode = RENDER_PIPELINE_MODE): boolean {
  // Named states only: an unset or unrecognised mode is CLOSED, never open by omission.
  return mode === 'review' || mode === 'on';
}
