import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { detectStorePlatformFromRequest, isNativeStoreApp } from '@/lib/mobile/store-bridge';
import { STORE_IAP_PACKS } from '@/lib/mobile/iap/catalog';
import {
  getStoreWalletBalance,
  verifyAndCreditStorePurchase,
  type VerifyAndCreditOutcome,
} from '@/lib/mobile/iap/verify';

export const dynamic = 'force-dynamic';

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

const FAILURE_STATUS: Record<
  Exclude<VerifyAndCreditOutcome, { ok: true }>['code'],
  number
> = {
  unknown_product: 400,
  bad_transaction: 400,
  invalid_receipt: 400,
  iap_verifier_unconfigured: 503,
  transaction_conflict: 409,
};

export async function GET(request: Request): Promise<NextResponse> {
  const platform = detectStorePlatformFromRequest(request);
  if (!isNativeStoreApp(platform)) {
    return json({ ok: false, code: 'native_store_only' }, 403);
  }

  const viewer = await getViewer();
  if (viewer.userId === null) {
    return json({ ok: false, code: 'sign_in_required' }, 401);
  }

  const sql = await getSqlRunner();
  if (sql === null) {
    return json({ ok: false, code: 'unavailable' }, 503);
  }

  const balance = await getStoreWalletBalance(sql, viewer.userId);
  return json(
    {
      ok: true,
      platform,
      balance,
      packs: STORE_IAP_PACKS,
    },
    200,
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const platform = detectStorePlatformFromRequest(request);
  if (!isNativeStoreApp(platform)) {
    return json({ ok: false, code: 'native_store_only' }, 403);
  }

  const viewer = await getViewer();
  if (viewer.userId === null) {
    return json({ ok: false, code: 'sign_in_required' }, 401);
  }

  const sql = await getSqlRunner();
  if (sql === null) {
    return json({ ok: false, code: 'unavailable' }, 503);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ ok: false, code: 'bad_request' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, code: 'bad_request' }, 400);
  }

  const productId = typeof body.productId === 'string' ? body.productId : '';
  const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
  const purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken : null;
  const signedPayload = typeof body.signedPayload === 'string' ? body.signedPayload : null;
  const rawEnv = body.environment;
  const environment =
    rawEnv === 'sandbox' || rawEnv === 'local' ? rawEnv : 'production';

  const outcome = await verifyAndCreditStorePurchase(sql, {
    userId: viewer.userId,
    storePlatform: platform,
    productId,
    transactionId,
    purchaseToken,
    signedPayload,
    environment,
  });

  if (!outcome.ok) {
    return json(outcome, FAILURE_STATUS[outcome.code]);
  }

  return json(outcome, outcome.idempotent ? 200 : 201);
}
