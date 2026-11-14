# TWINGS Mobile Store Launch Runbook (iOS App Store & Google Play)

> Applies to `D:\dev\twings` (consumer wrapper `app.twings.client`). Keep `brand.twings.app` and `admin.twings.app` web-only.

---

## 1. Architecture & Surface Separation

1. **Web & Installed PWA (`twings.app`)**:
   - Uses Toss Payments KRW single-order widget checkout (`/api/billing/toss/*`).
   - Never displays consumable IAP credit packs (`twings.credits.*`) or `data-native-iap-sheet`.
   - Any call to `GET/POST /api/mobile/iap/verify` or `POST /api/mobile/iap/renders` without a native store shell UA (`TwingsIOS/` or `TwingsAndroid/` or `x-twings-client: ios-store|android-store`) is rejected with `403 { ok: false, code: 'native_store_only' }`.
2. **Native Store Wrappers (`ios-store` / `android-store`)**:
   - Built with Capacitor pointing at `https://twings.app/ko/video?source=pwa` (`capacitor.config.ts` + `mobile/capacitor.config.json`).
   - Uses StoreKit 2 (iOS App Store) & Google Play Billing consumable credit SKUs:
     - `twings.credits.1000` (100 credits, 1,100 KRW tier)
     - `twings.credits.3000` (300 credits, 3,300 KRW tier)
     - `twings.credits.5000` (500 credits, 5,500 KRW tier)
     - `twings.credits.10000` (1,000 credits, 11,000 KRW tier)
   - Server ledger (`store_iap_wallets`, `store_iap_transactions` in migrations `0088` / `0163`) verifies receipts fail-closed and deducts credits inside the same serializable transaction as render enqueueing (`POST /api/mobile/iap/renders`).
3. **Desktop Web Gate for Video Format Authoring**:
   - Creating or publishing **video** templates (`/creators/workspace/formats/[id]`) requires a desktop web viewport (`>= 1024px`); mobile store builds render the desktop-web notice (`data-video-maker-desktop-only`).

---

## 2. Domain Association & Native Capabilities Checklist

| Surface | Endpoint / File | Required Production Env Vars |
| --- | --- | --- |
| iOS Universal Links | `/.well-known/apple-app-site-association` | `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` (`app.twings.client`) |
| Android App Links / TWA | `/.well-known/assetlinks.json` | `ANDROID_PACKAGE_NAME` (`app.twings.client`), `ANDROID_SHA256_CERT_FINGERPRINTS` |
| Apple Sign In (Guideline 4.8) | `/auth/choose`, `lib/auth/providers.ts` | Auto-enabled for `ios-store` shell UA; override via `NEXT_PUBLIC_APPLE_AUTH=on`; Supabase Apple provider configured with Services ID + `appleid.apple.com` in `allowNavigation` |
| Native Sandbox IAP Testing | `lib/mobile/iap/verify.ts` | `STORE_IAP_SANDBOX_SECRET` (non-production only; fail-closed in production without Apple App Store Server API / Google Play Developer API verifier wiring) |

---

## 3. Store Submission Preflight

1. Apply DB migrations `0088_core_personal_v2_studio_maker_iap.sql` and `0163_glue_personal_v2_studio_maker_iap.sql` to Supabase before shipping native builds.
2. Confirm `npx tsc --noEmit`, full `npx vitest run`, and `npm run sweep:anon` pass on release commit.
3. Verify inside iOS Simulator / TestFlight (`TwingsIOS/1.0`) and Android Internal Testing (`TwingsAndroid/1.0`):
   - `/auth/choose` renders Apple + Google + Kakao on iOS, Google + Kakao on Android.
   - Template studio shows `data-native-iap-sheet` and hides Toss PG card widget copy.
   - Standard Safari / Chrome shows Toss checkout only and receives `403 native_store_only` on `/api/mobile/iap/*`.
4. Confirm Apple Privacy Manifest (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, Sign in with Apple account deletion path under `/account`).
