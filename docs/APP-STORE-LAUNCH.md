# TWINGS 공개 전환(`RENDER_PIPELINE_PUBLIC=on`) 및 iOS App Store · Google Play 등록 런북

> 기준일: 2026-10-24 · 관련 문서: `docs/PLATFORM-2.0.md` §2.3·§5, `docs/TOSS-CONTRACT.md`

---

## 1. `twings.app` Public 공개 전환 (`RENDER_PIPELINE_PUBLIC=on`)

### 왜 지금 당장 `on`으로 바꾸면 안 되는가 (토스 심사·계약 보호 장치)
`lib/flags.ts`의 `renderPipelineMode()`는 프로덕션 환경(`VERCEL_ENV === 'production'`)에서 아래와 같이 동작합니다:
- `RENDER_PIPELINE_PUBLIC=review`일 때: `test_gck_` / `test_gsk_` 키 쌍이어야 상점이 열리며(`storefrontOpen() === true`), 토스 심사 계정(`pg-review-20261014@twings.app`)만 결제·렌더를 실행할 수 있습니다.
- `RENDER_PIPELINE_PUBLIC=on`일 때: **`TOSS_CLIENT_KEY`와 `TOSS_SECRET_KEY`가 모두 정식 라이브 위젯 키(`live_gck_...` / `live_gsk_...`)여야만 열립니다.** 만약 라이브 키 발급 전에 `RENDER_PIPELINE_PUBLIC=on`만 먼저 켜면, `renderPipelineMode()`가 무료 렌더 유출을 막기 위해 자동으로 `'off'`로 강등(`render_pipeline_closed`)시켜 버리고, 토스 심사자가 보는 상품 페이지가 "곧 열립니다"로 닫혀 **심사가 반려**됩니다.

### 공개 전환 4단계 체크리스트 (라이브 키 발급 즉시)
1. **사전 점검**: `node scripts/public-launch-preflight.mjs` 실행 (비밀값 출력 없이 boolean/kind만 확인)
2. **토스 라이브 키 교체 (Vercel Production)**:
   - 전자계약 및 보증보험(1,000만 원) 완료 후 발급된 정식 MID의 **`live_gck_...` / `live_gsk_...`** 를 Vercel Production 환경변수 `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`에 입력합니다.
   - 토스 개발자센터 **라이브 단계 웹훅**에 `https://twings.app/api/billing/toss/webhook` 등록.
3. **`RENDER_PIPELINE_PUBLIC=on` 전환 및 재배포**:
   - Vercel Production 환경변수 `RENDER_PIPELINE_PUBLIC`을 `review` → `on`으로 변경 후 **Redeploy** (정적 템플릿 페이지의 CTA를 갱신하기 위해 재배포 필수).
4. **첫 실결제 스모크 및 심사 계정 정리**:
   - 대표 계정으로 3,900원 템플릿 1건 실결제 → 렌더 완료·웹 푸시·이메일 확인 → `/admin`에서 환불 테스트.
   - `pg-review-20261014@twings.app` 심사 계정 비활성화.

---

## 2. Android (Google Play) & iOS (App Store) 스토어 등록 전략 및 빌드

### 핵심 정책: 5% 플로어 마진 보호를 위한 Companion Studio 모드 (`lib/mobile/store-bridge.ts`)
- 현재 TWINGS 단건 템플릿 가격(3,900원~11,700원)은 **원가 마진 5%** 로 설계되어 있어, 앱스토어·구글플레이 인앱결제 수수료(15~30%) 또는 한국 제3자 결제 수수료(26% + PG 3.4%)를 적용하면 건당 −10%~−25% 역마진이 발생하며, 웹 PG(토스)를 스토어 앱 WebView 안에서 그대로 열면 **Apple 지침 3.1.1 및 Google Play 결제 정책 위반으로 심사 반려**됩니다.
- 따라서 스토어 배포 바이너리(`TwingsIOS/1.0`, `TwingsAndroid/1.0`)는 `storeCheckoutPolicy()`를 통해 **Companion Studio & Creator App 모드**로 동작합니다:
  1. **포맷 탐색 및 프리뷰**: 전체 비디오·이미지·메이커 컬렉션 탐색
  2. **내 얼굴 셀카 카메라 촬영 및 보관함 관리**: `/identity/selfie` (최대 10장)
  3. **실시간 완성 푸시 알림 & 내 작품 다운로드·SNS 공유**: `/renders` 및 `/renders/[id]`
  4. **인플루언서·크리에이터 캠페인 지원 및 성과 리포트**: `/campaigns` (참여자 무료·보상 수령 구조이므로 인앱결제 대상 아님)

### 도메인 소유권 자동 검증 라우트 (구현 완료)
- **Android Digital Asset Links**: `https://twings.app/.well-known/assetlinks.json` (`app/.well-known/assetlinks.json/route.ts`)
  - Vercel 환경변수: `ANDROID_PACKAGE_NAME` (기본값 `app.twings.client`), `ANDROID_SHA256_CERT_FINGERPRINTS` (Play Console 앱 서명 SHA-256 지문, 콤마 구분)
- **iOS Universal Links / Associated Domains**: `https://twings.app/.well-known/apple-app-site-association` (`app/.well-known/apple-app-site-association/route.ts`)
  - Vercel 환경변수: `APPLE_TEAM_ID` (Apple Developer Team ID 10자리), `IOS_BUNDLE_ID` (기본값 `app.twings.client`)

### 빌드 명령어
- **Google Play Store (AAB 생성 — Bubblewrap TWA)**:
  ```powershell
  npx @bubblewrap/cli init --manifest https://twings.app/manifest.webmanifest --directory ./mobile/android-twa
  # 또는 이미 구성된 mobile/twa-manifest.json 사용:
  cd mobile
  npx @bubblewrap/cli build
  # 생성된 app-release-bundle.aab 파일을 Google Play Console에 업로드
  ```
- **iOS App Store & Android (Capacitor 네이티브 브리지)**:
  ```powershell
  # mobile/capacitor.config.json 기준 Xcode / Android Studio 프로젝트 생성
  npx @capacitor/cli add ios
  npx @capacitor/cli open ios
  # Xcode에서 Signing & Capabilities -> Associated Domains에 applinks:twings.app 추가 후 Archive -> App Store Connect 업로드
  ```
