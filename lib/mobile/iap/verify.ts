import type { SqlRunner } from '@/lib/db/sql-runner';
import { constantTimeEqual } from '@/lib/renders/share';
import { getStoreIapPack } from './catalog';

export type NativeIapOs = 'ios' | 'android';

export function toNativeIapOs(platform: 'ios-store' | 'android-store'): NativeIapOs {
  return platform === 'ios-store' ? 'ios' : 'android';
}

export interface VerifyReceiptInput {
  platform: NativeIapOs;
  productId: string;
  transactionId: string;
  purchaseToken?: string | null;
  signedPayload?: string | null;
  environment: 'sandbox' | 'production' | 'local';
}

export type VerifyReceiptResult =
  | { ok: true; environment?: 'sandbox' | 'production' | 'local'; meta?: Record<string, unknown> }
  | { ok: false; code: 'invalid_receipt' | 'iap_verifier_unconfigured' };

export type StoreReceiptVerifier = (input: VerifyReceiptInput) => Promise<VerifyReceiptResult>;

/**
 * Default verifier fails closed unless `STORE_IAP_SANDBOX_SECRET` matches in a non-production
 * environment. Production App Store JWS / Google Play Developer API verifiers inject here.
 */
export const defaultStoreReceiptVerifier: StoreReceiptVerifier = async (input) => {
  const sandboxSecret = process.env.STORE_IAP_SANDBOX_SECRET?.trim();
  const token = input.purchaseToken?.trim() ?? '';
  if (
    sandboxSecret &&
    sandboxSecret.length >= 16 &&
    input.environment !== 'production' &&
    token.length > 0 &&
    constantTimeEqual(token, sandboxSecret)
  ) {
    return {
      ok: true,
      environment: input.environment,
      meta: { mode: 'sandbox_secret' },
    };
  }
  return { ok: false, code: 'iap_verifier_unconfigured' };
};

export async function getStoreWalletBalance(sql: SqlRunner, userId: string): Promise<number> {
  try {
    const { rows } = await sql.query<{ credits_balance: number }>(
      'select credits_balance from store_iap_wallets where user_id = $1',
      [userId],
    );
    return Number(rows[0]?.credits_balance ?? 0);
  } catch {
    return 0;
  }
}

export type VerifyAndCreditOutcome =
  | {
      ok: true;
      idempotent: boolean;
      platform: NativeIapOs;
      productId: string;
      transactionId: string;
      creditsAdded: number;
      balance: number;
    }
  | {
      ok: false;
      code:
        | 'unknown_product'
        | 'bad_transaction'
        | 'invalid_receipt'
        | 'iap_verifier_unconfigured'
        | 'transaction_conflict';
    };

export async function verifyAndCreditStorePurchase(
  sql: SqlRunner,
  input: {
    userId: string;
    storePlatform: 'ios-store' | 'android-store';
    productId: string;
    transactionId: string;
    purchaseToken?: string | null;
    signedPayload?: string | null;
    environment?: 'sandbox' | 'production' | 'local';
  },
  deps?: { verifier?: StoreReceiptVerifier },
): Promise<VerifyAndCreditOutcome> {
  const pack = getStoreIapPack(input.productId);
  if (!pack) return { ok: false, code: 'unknown_product' };

  const transactionId = input.transactionId.trim();
  if (!transactionId || transactionId.length > 160 || /\s/.test(transactionId)) {
    return { ok: false, code: 'bad_transaction' };
  }

  const platform = toNativeIapOs(input.storePlatform);
  const environment = input.environment ?? 'production';
  const verifier = deps?.verifier ?? defaultStoreReceiptVerifier;
  const verdict = await verifier({
    platform,
    productId: pack.productId,
    transactionId,
    purchaseToken: input.purchaseToken,
    signedPayload: input.signedPayload,
    environment,
  });
  if (!verdict.ok) return verdict;

  return sql.transaction(async (tx) => {
    const existing = await tx.query<{
      user_id: string;
      product_id: string;
      status: string;
    }>(
      'select user_id, product_id, status from store_iap_transactions where platform = $1 and transaction_id = $2 for update',
      [platform, transactionId],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.user_id !== input.userId || row.product_id !== pack.productId) {
        return { ok: false as const, code: 'transaction_conflict' as const };
      }
      const wallet = await tx.query<{ credits_balance: number }>(
        'select credits_balance from store_iap_wallets where user_id = $1',
        [input.userId],
      );
      return {
        ok: true as const,
        idempotent: true,
        platform,
        productId: pack.productId,
        transactionId,
        creditsAdded: 0,
        balance: Number(wallet.rows[0]?.credits_balance ?? 0),
      };
    }

    const walletRows = await tx.query<{ credits_balance: number }>(
      `insert into store_iap_wallets (user_id, credits_balance, lifetime_purchased)
       values ($1, $2, $2)
       on conflict (user_id) do update
         set credits_balance = store_iap_wallets.credits_balance + $2,
             lifetime_purchased = store_iap_wallets.lifetime_purchased + $2
       returning credits_balance`,
      [input.userId, pack.credits],
    );

    await tx.query(
      `insert into store_iap_transactions
         (user_id, platform, product_id, transaction_id, purchase_token, kind, credits_delta, status, environment, receipt_meta, verified_at)
       values ($1, $2, $3, $4, $5, 'purchase', $6, 'verified', $7, $8::jsonb, now())`,
      [
        input.userId,
        platform,
        pack.productId,
        transactionId,
        input.purchaseToken ?? null,
        pack.credits,
        verdict.environment ?? environment,
        JSON.stringify(verdict.meta ?? {}),
      ],
    );

    return {
      ok: true as const,
      idempotent: false,
      platform,
      productId: pack.productId,
      transactionId,
      creditsAdded: pack.credits,
      balance: Number(walletRows.rows[0]?.credits_balance ?? pack.credits),
    };
  });
}
