export interface StoreIapPack {
  productId: string;
  credits: number;
  retailKrw: number;
  labelKo: string;
  labelEn: string;
}

/**
 * StoreKit 2 (iOS App Store) & Google Play Billing consumable credit packs.
 * Strictly isolated to native store wrappers (`ios-store` / `android-store`).
 * Web browsers and PWAs never expose credits or IAP packs and always receive 403.
 */
export const STORE_IAP_PACKS: readonly StoreIapPack[] = [
  {
    productId: 'twings.credits.1000',
    credits: 100,
    retailKrw: 1_100,
    labelKo: '100 크레딧',
    labelEn: '100 Credits',
  },
  {
    productId: 'twings.credits.3000',
    credits: 300,
    retailKrw: 3_300,
    labelKo: '300 크레딧',
    labelEn: '300 Credits',
  },
  {
    productId: 'twings.credits.5000',
    credits: 500,
    retailKrw: 5_500,
    labelKo: '500 크레딧',
    labelEn: '500 Credits',
  },
  {
    productId: 'twings.credits.10000',
    credits: 1_000,
    retailKrw: 11_000,
    labelKo: '1,000 크레딧',
    labelEn: '1,000 Credits',
  },
] as const;

export function getStoreIapPack(productId: string): StoreIapPack | null {
  return STORE_IAP_PACKS.find((pack) => pack.productId === productId) ?? null;
}

/** Converts authoritative KRW template price to store IAP credits (1 credit = 10 KRW, min 10). */
export function creditsRequiredForKrw(krw: number): number {
  if (!Number.isFinite(krw) || krw <= 0) return 0;
  return Math.max(10, Math.ceil(krw / 10));
}
