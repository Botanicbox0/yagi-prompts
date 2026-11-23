import type { Viewer } from '@/lib/auth/identity';
import { reissueSubscriptionPeriod, startSubscription } from '@/lib/brands/subscriptions';

/**
 * Review rounds 3–4 (item 5 / B8): the service has exactly two modes — `previewOnly`, or `confirm` with the
 * preview digest. Tests that only need a started subscription (or a reissued month) go through the real two
 * steps here. A refusal at the preview step is returned as is.
 */
export async function startConfirmed(
  deps: Parameters<typeof startSubscription>[0],
  viewer: Viewer,
  input: Record<string, unknown>,
): ReturnType<typeof startSubscription> {
  const preview = await startSubscription(deps, viewer, { ...input, confirm: false, previewOnly: true });
  if (!preview.ok || preview.applied) return preview;
  return startSubscription(deps, viewer, { ...input, confirm: true, previewDigest: preview.preview.digest });
}

export async function reissueConfirmed(
  deps: Parameters<typeof reissueSubscriptionPeriod>[0],
  viewer: Viewer,
  input: Record<string, unknown>,
): ReturnType<typeof reissueSubscriptionPeriod> {
  const preview = await reissueSubscriptionPeriod(deps, viewer, { ...input, confirm: false, previewOnly: true });
  if (!preview.ok || preview.applied) return preview;
  return reissueSubscriptionPeriod(deps, viewer, { ...input, confirm: true, previewDigest: preview.preview.digest });
}

/**
 * Tests written before round 4 call the service in the earlier style: a plain call started a subscription
 * without early access, a call with early access and no `confirm` returned the preview, and a reissue without
 * `confirm` returned the preview. These wrappers map those calls onto the two modes; explicit `previewOnly` or
 * `confirm` calls pass through unchanged (so refusals such as a confirm without a digest are still tested).
 */
export async function startSubscriptionCompat(
  deps: Parameters<typeof startSubscription>[0],
  viewer: Viewer,
  input: Record<string, unknown>,
): ReturnType<typeof startSubscription> {
  if (input.previewOnly === true || input.confirm === true) return startSubscription(deps, viewer, input);
  if (input.activateBeforePayment === true) return startSubscription(deps, viewer, { ...input, previewOnly: true });
  return startConfirmed(deps, viewer, input);
}

export async function reissueCompat(
  deps: Parameters<typeof reissueSubscriptionPeriod>[0],
  viewer: Viewer,
  input: Record<string, unknown>,
): ReturnType<typeof reissueSubscriptionPeriod> {
  if (input.confirm === true || input.previewOnly === true) return reissueSubscriptionPeriod(deps, viewer, input);
  return reissueSubscriptionPeriod(deps, viewer, { ...input, previewOnly: true });
}
