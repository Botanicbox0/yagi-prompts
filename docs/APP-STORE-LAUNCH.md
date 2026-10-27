# TWINGS 공개 전환(`RENDER_PIPELINE_PUBLIC=on`) 및 iOS App Store · Google Play 등록 런북

> 기준일: 2026-10-24(§1), 2026-10-28(§2) · 관련 문서: `docs/PLATFORM-2.0.md` §2.3·§5, `docs/TOSS-CONTRACT.md`

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

## 2. Google Play 앱 (1단계) — 구매 없는 TWA

> 대표 결정 2026-10-28: **Android는 Google Play에 구매 없는 앱(TWA)으로, iPhone은 PWA 유지.** App Store는 앱 안 결제(IAP) 가격을 정한 뒤에 다시 판단한다(`docs/PLATFORM-2.0.md` §5.1, §13-1).

### 왜 구매 없는 앱인가 (2026-10-28 공식 문서 확인)
- Google Play 결제 정책: Play로 배포한 앱에서 디지털 상품을 팔면 Play 결제를 써야 하고 TWA도 예외가 아니다. 수수료는 15%(연 첫 100만 달러), 한국 대체 결제는 Play 결제와 **병행할 때만** 쓸 수 있고 4%p 낮다(15%→11%). 5% 마진 구조에서는 성립하지 않는다.
- 예외는 **소비 전용(consumption-only) 앱**: 앱 안에서 디지털이든 실물이든 어떤 상품도 살 수 없으면 허용된다. 링크 없이 "웹사이트에서 구매할 수 있어요" 같은 문장은 쓸 수 있다. 앱 밖(메일·SNS) 안내는 자유. 출처: https://support.google.com/googleplay/android-developer/answer/10281818
- iPhone: Apple 3.1.3(b)는 웹에서 산 상품을 앱에서 쓰게 하려면 같은 상품을 IAP로도 팔아야 한다고 정한다(예외는 3.1.3(a) Reader 앱). 그래서 App Store는 IAP 가격 결정이 먼저다. 한국 외부 결제는 26%라 소규모 사업자 IAP(15%)보다 비싸다.

### 앱 안에서 바뀌는 것 (`lib/mobile/store-shell.ts`)
- **판별**: TWA는 Chrome 그 자체라 User-Agent·헤더로 알 수 없고, 쿠키·localStorage는 사용자의 일반 Chrome과 공유된다(거기 표시하면 브라우저 결제까지 숨는다). 그래서 앱만의 신호로 판별한다 — 실행 URL의 `?source=twa`(`mobile/twa-manifest.json`의 `startUrl`과 바로가기), Chrome이 앱 실행에 주는 `android-app://<패키지>/` referrer, 그리고 탭 단위 sessionStorage. `<head>`의 차단 스크립트가 첫 페인트 전에 `<html data-store-shell="android">`를 붙인다.
- **숨김**(`data-store-hide`): 템플릿 페이지의 가격·판매 상태 문장·스튜디오(결제 버튼, 하단 고정 바)·환불 문장, 요금표의 구독 시작 버튼, 헤더 '개인 | 브랜드' 전환과 푸터의 브랜드 링크(브랜드 결제로 이어지는 입구).
- **안내**(`data-store-note`, 사전 `appShell.store`): "앱에서는 구매할 수 없어요. 구매는 TWINGS 웹사이트에서 할 수 있어요." 링크 없음.
- **결제 페이지**(`/billing/toss/[id]`, `/billing/subscription`, `/billing/subscription/[id]`): 앱 안에서는 결제 위젯을 아예 불러오지 않고 안내 두 문장만 보인다(`StoreShellGate`).
- **그대로인 것**: 포맷 탐색, 내 작품(`/renders`), 내 사진, 계정, 캠페인, 완성 푸시(TWA 알림 위임 `enableNotifications: true`), 설치형 하단 탭.
- 로그인하지 않은 채 바로가기(`/renders?source=twa`)로 열면 middleware가 로그인 화면 URL에도 `source=twa`를 붙인다.
- **기기에서 확인할 것**: 다른 앱의 링크(App Links)로 앱이 바로 열릴 때 referrer가 실제로 `android-app://app.twings.client/`인지. 공식 문서에 없는 동작이라, 아니면 그렇게 열린 첫 화면에서는 판별이 안 된다.

### 도메인 검증
- `https://twings.app/.well-known/assetlinks.json` (`app/.well-known/assetlinks.json/route.ts`). Vercel 환경변수 `ANDROID_SHA256_CERT_FINGERPRINTS` = Play Console → 앱 무결성의 **앱 서명 키** SHA-256(업로드 키와 다르다, 콤마로 여러 개), `ANDROID_PACKAGE_NAME`(기본 `app.twings.client`). 지문이 없으면 빈 목록 `[]`을 돌려준다.
- 검증이 실패하면 앱은 주소창이 보이는 Custom Tab으로 열린다.
- **패키지 이름 `app.twings.client` — 대표 확정 2026-10-28.** 첫 업로드(내부 테스트 포함) 순간 고정되고, 설치가 한 번이라도 생기면 누구도 다시 쓸 수 없다. Android 개발자 인증에 따라 Play Console에서 서명 키 공개 인증서와 함께 패키지 이름을 등록한다.
- iOS용 `/.well-known/apple-app-site-association`은 자리만 있다(App Store는 보류).

### 빌드 (Bubblewrap, 아직 실행 전)
```powershell
cd mobile
npx @bubblewrap/cli update   # twa-manifest.json으로 Android 프로젝트를 만들거나 갱신
npx @bubblewrap/cli build    # JDK·Android SDK가 없으면 설치를 묻고, 업로드 키 비밀번호를 묻는다
```
- 업로드 키 `mobile/android-upload-keystore.jks`와 빌드 산출물은 git에 넣지 않는다(`.gitignore`). 키와 비밀번호는 대표가 따로 보관한다.
- 산출물 `app-release-bundle.aab`를 Play Console에 올리면 Play App Signing이 앱 서명 키를 만든다. 그 SHA-256을 Vercel에 넣고 재배포한다.

### Play Console 등록 순서 (대표)
1. 조직 계정 인증: D&B 기록 정정 → DUNS 확인 → 사업자등록증 → 웹사이트(Search Console에 twings.app) → 전화 인증. 조직 계정은 개인 계정의 테스터 모집 요건이 없다.
2. 앱 만들기: 이름 TWINGS, 기본 언어 한국어, 앱, 무료.
3. 스토어 등록정보: 짧은 설명·자세한 설명, 앱 아이콘, 그래픽 이미지, 휴대전화 스크린샷(규격은 Play Console 화면 안내대로).
4. 앱 콘텐츠: 개인정보처리방침 `https://twings.app/ko/legal/privacy`, 데이터 보안 양식(이메일·얼굴 사진·결제는 웹), 콘텐츠 등급 설문, 타겟 연령(약관의 이용 연령과 같게), 광고 없음.
5. 내부 테스트 트랙에서 기기 확인(위 "기기에서 확인할 것" 포함) → 프로덕션 심사 제출.
