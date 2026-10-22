# Toss 단건 결제 검증

## 운영 개시 (2026-09-30 정리)

결제 코드(위젯 → 서버 승인 → 렌더 생성 → 실패 시 자동 환불)는 main에 있고 운영에 배포돼 있다. 공개 여부는 이제 **코드가 아니라 Vercel 환경변수**로 연다(`lib/flags.ts renderPipelinePublic`).

1. 토스페이먼츠 가맹 심사 승인 → 개발자센터에서 **라이브** 클라이언트 키·시크릿 키 확인(`live_…`).
2. 대표가 Vercel `yagi-prompts` › Settings › Environment Variables(Production)에서 `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`를 라이브 키로 교체. 키는 대화·코드·문서 어디에도 적지 않는다.
3. 같은 화면에서 `RENDER_PIPELINE_PUBLIC` = `on` 추가.
4. Redeploy(환경변수는 재배포해야 반영된다).
5. 확인: 일반 계정으로 템플릿 페이지 → 결제 버튼이 보이는지, 실제 카드로 소액 템플릿 1건 결제 → 렌더 시작 → 토스 상점관리자에서 승인 확인 → 필요하면 관리자 화면에서 취소.

안전장치: 운영(`VERCEL_ENV=production`)에서는 `on`이어도 **두 키가 결제위젯 라이브 키 쌍(`live_gck_`/`live_gsk_`)일 때만** 열린다. 게이트웨이와 같은 규칙(`lib/flags.ts tossKeyKind`)이라 API 키 쌍(`live_ck_`/`live_sk_`)으로는 열리지 않는다. 테스트 키가 남아 있으면 계속 닫혀 있다(돈을 받지 않고 영상을 내주는 사고 방지). `review`는 반대로 **테스트 위젯 키 쌍일 때만** 열리고, 라이브 키나 잘못된 키면 닫힌 채 오류 로그 한 줄(`render_pipeline_closed`, 키 값 없음)을 남긴다. 문서 예제 키(`_docs_`)는 경고 로그만 남긴다. 프리뷰·로컬은 테스트 키로도 열 수 있다(QA용). 닫을 때는 `RENDER_PIPELINE_PUBLIC`을 지우고 재배포 — 이미 결제된 주문의 생성·환불은 계속 처리된다.

## 결제 실패·종결 상태 (2026-10-22, docs/PLATFORM-2.0.md §2.2)

모든 주문은 이름 있는 상태로 끝난다. `billing_payments.failure_code`가 사유이고, 주문 페이지(`/billing/toss/{id}`)가 그 사유를 문장으로 보여준다.

| 상황 | 주문 상태 | 화면 |
| --- | --- | --- |
| 카드사·결제수단이 승인 거절(토스 4xx) | `failed(declined)` 즉시 | 사유 + **다시 결제하기** |
| 네트워크·5xx·타임아웃 | `confirming` 유지 | 확인 중 — 리콘사일이 주문번호로 다시 읽는다 |
| 승인 시점에 가격이 바뀜 | `failed(price_changed)` | "가격이 바뀌어 주문을 다시 만들어야 해요" + 템플릿 링크 |
| 승인 시점에 판매가 닫힘 | `failed(not_open)` | 닫힘 안내 |
| 승인 시점에 세션 없음(401) | `pending` 유지 | 승인 파라미터를 `next`에 담아 로그인 → 같은 복귀 페이지에서 승인 계속 |
| 토스 `CANCELED` | 우리가 `paid`였으면 `refunded`, 아니면 `failed(canceled)` | |
| 토스 `ABORTED`·`EXPIRED`·모르는 키(404) | `failed(aborted / expired / unknown_payment)` | |
| 부분 취소(잔액 남음) | `refund_pending(partial_balance)` | 자동 환불하지 않고 관리자 대기 |
| 입금 대기 | `expires_at`까지 `confirming`, 지나면 `failed(expired)` | |
| 결제 없이 주문 시간(30분) 경과 | `failed(expired)` + 입력 사진 삭제 | 템플릿에서 다시 시작 |
| 환불 10회 실패 | `refund_pending(refund_manual)` | 담당자 처리 안내, 실패 메일 1회 |
| 생성 시작 10회 실패 | `paid(fulfil_manual)` | 담당자 처리 안내 |

- **다시 결제하기**: `POST /api/billing/toss/orders/{id}/retry`. 같은 사용자·템플릿·옵션·저장 사진으로 새 `pending` 주문을 만든다. 원 주문은 `failed`로 남고 `retried_by`로 새 주문을 가리킨다(두 번 눌러도 같은 주문). 하루 주문 한도(20건)가 그대로 적용된다.
- **재시도 상한**: 환불은 처음 3번은 다음 패스에서 바로, 그 뒤 1분부터 1시간까지 늘려 가며 다시 시도한다. 생성 시작은 1분부터 늘린다. 각 10회 뒤 `*_manual`로 멈추고 `/admin` 대시보드 "결제 확인 필요"에 센다. 실패 메일은 환불이 확인됐을 때 또는 상한에 닿았을 때 정확히 한 번 나간다.
- **패스**: 렌더 패스·크론이 한 번에 최대 50건을 정리하고, 패스 로그 한 줄에 `payments confirmed · refunded · failed · manual`을 적는다. 키 설정이 잘못돼도 렌더는 계속되고 `[billing] {"event":"toss_gateway_unavailable",…}` 한 줄만 남긴다(키 값 없음). 상태 폴링(`GET /api/billing/toss/orders/{id}`)은 그 주문 1건만 정리한다.
- **동의 시각**: `consent_at`은 비어 있을 때만 기록한다. 결제창을 다시 열거나 승인해도 처음 동의한 시각이 남는다.
- **웹훅** `POST /api/billing/toss/webhook`: 본문은 힌트일 뿐이다(`orderId`/`paymentKey`/`status`). 주문을 찾으면 그 주문 1건만 토스에서 **우리가 저장한 결제 키로** 다시 읽어 위 규칙대로 정리한다. 상점관리자에서 취소한 결제가 `refunded`가 되는 경로다. 모르는 주문·잘못된 본문은 빈 200, 같은 발신지 분당 30건(전체 120건)을 넘으면 빈 429, 우리 쪽 장애(DB·토스 조회 실패)는 빈 503(토스가 다시 보낸다). GET은 405. 본문 내용은 로그에 남기지 않는다.

**클라우드 적용 필요(코드 배포 전에):** `supabase/migrations/0052_core_billing_failure.sql` — `refund_attempts`·`fulfil_attempts`·`input_deleted_at`·`retried_by` 컬럼과 인덱스 2개. 이 마이그레이션 없이 배포하면 주문 생성·승인은 되지만 리콘사일·다시 결제하기가 실패한다(렌더는 계속된다).

**대표 할 일 — 웹훅 URL 등록:** 토스페이먼츠 상점관리자(개발자센터) → 웹훅 → 웹훅 등록에서 URL `https://twings.app/api/billing/toss/webhook`, 이벤트 `PAYMENT_STATUS_CHANGED`(결제 상태 변경)를 등록한다. 라이브 키로 바꾼 뒤에도 같은 URL이 라이브 환경에 등록돼 있는지 확인한다. 등록 전에는 상점관리자에서 직접 취소한 결제를 DB가 알지 못한다.

검증(2026-10-22, 로컬): `npx tsc --noEmit` 통과 → `npx vitest run` **270 파일 / 2,620 테스트 통과**(기준선 269 / 2,559). 새 테스트를 수정 전 코드에 돌리면 43개 실패·라우트 테스트 파일 로드 실패였다. → `npm run db:local`(0052 포함) → `npm run build:local` 통과 → `npm run start:local`(포트 3001) → `npm run sweep:anon` **SWEEP PASSED — 992/992**(웹훅·다시 결제하기·세션 없는 복귀 체크 12개 추가). 포트를 바꿔 띄울 때는 빌드와 서버 모두 `NEXT_PUBLIC_APP_URL=http://localhost:3001`을 줘야 canonical·hreflang 체크가 맞는다. 실제 토스 테스트 키 카드 승인·취소는 이번에 다시 하지 않았다(가짜 게이트웨이와 스크립트된 토스 응답으로 검증).

## 2026-09-20 최신 main 통합 검증

브랜드 출시가 반영된 main `d14861c`를 `codex/toss-checkout`에 통합했다. 기존 결제 구현을 바꾸지 않고 브랜드·인증 호스트·문안·SEO 변경과 함께 작동하는지 검증했다.

- `npx tsc --noEmit`: 통과
- `npx vitest run`: **114 파일 / 1,352 테스트 통과**
- `npm run build:local`, `npm run start:local`: 통과
- `npm run sweep:anon`: **SWEEP PASSED — 601/601**
- `node scripts/smoke-workspace-hosts.mjs 3000`: **HOST SMOKE PASSED — 87/87**

아래 실제 테스트 카드 승인·환불 증거는 9월 19일 검증 기록이다. 이번 통합 검사에서는 카드 결제를 다시 실행하지 않았다. `.env.local`, 약관 본문, 공개 플래그는 변경하지 않았다. 클라우드 결제 마이그레이션 적용과 운영 배포는 아직 하지 않았다.

## 기존 실제 카드·환불 검증

2026-09-19, 로컬 일반 사용자 픽스처(`PLAYBOOK_DEV_IDENTITY`, free 계정)와 실제 토스 테스트 키로 검증했다. `RENDER_PIPELINE_PUBLIC`은 로컬 확인 동안만 열었으며, 최종 소스는 `false`다. `.env.local` 수정과 클라우드 마이그레이션 적용은 하지 않았다.

## 브라우저 증거

1. [결제 위젯·환불 고지·동의](01-checkout-widget.png): 서버 가격 2,500원, 별도 청약철회 제한 동의, 토스 테스트 표시. 위젯 캡처는 9월 17일, 같은 경로의 실제 카드 인증은 9월 19일 사용자가 직접 수행했다.
2. [승인 후 렌더 시작](02-render-start.png): 서버 승인 뒤 `/renders/{id}`로 이동하여 “만드는 중입니다”를 표시했다.
3. [최종 실패 후 전액 환불](03-refunded.png): 토스 취소 응답의 주문·금액·결제 식별자·`CANCELED`·잔액 0을 확인한 뒤 주문 상태가 `refunded`로 바뀌었다.

카드 테스트는 토스 가짜 게이트웨이를 사용하지 않았다. 렌더 실패만 로컬 OpenAI 호환 엔드포인트가 30초 뒤 403을 반환하도록 재현했다. 별도 개발 프로세스의 환경변수만 사용했고, 엔진 인증값은 로컬 픽스처 문자열로 덮어썼다. 외부 생성 엔진 호출, 인물 사진, 인물 검수 우회는 없었다. 이미지 입력은 글자만 있는 QA 이미지다. 실제 카드 정보와 키는 캡처하지 않았다.

390px 모바일에서 결제·환불 문안, 두 동의 체크의 선택/해제, 결제 버튼 활성/비활성, 가로 넘침을 확인했다. 공개 플래그를 닫은 뒤 같은 일반 사용자에게 결제 진입이 사라지고 기존 환불 상태는 계속 조회되는 것도 확인했다.

## 자동 검증 범위

최종 검증 순서와 결과: `npx tsc --noEmit` 통과 → `npx vitest run` **102 파일 / 1,216 테스트 통과** → `npm run build:local` 통과 → `npm run start:local` Ready → `npm run sweep:anon` **SWEEP PASSED — 484/484**.

- 서버 저장 가격 승인, 금액 위조·판매 중지·가격 변경 거절
- 소유자·동의·공개 플래그 확인, 직접 렌더 POST의 무결제 진입 차단, 관리자 무과금
- 반복·동시 승인 거절, 승인 응답 유실 복구, 일시적 스토리지 장애 재시도
- 렌더 최종 실패 취소, 취소 재시도, 환불 확인 전 실패 메일 보류, 확인 후 환불 사실 포함
- 공개 플래그 종료 후 기존 결제의 생성·환불 계속 처리
- 키가 없는 로컬/테스트의 fake, 클라우드 fake 금지, 환불정책 §2와 양 언어 고지 원문 일치
- 익명 스윕에 토스 생성·승인·주문 조회 거절과 결제 HTML 비노출 추가

실제 이메일 수신은 일반 사용자 픽스처 주소로 검증하지 않았다. 실패 메일의 환불 문구와 전송 시점은 통합 테스트의 메일 페이로드로 확인한다. 테스트 키 검증은 실제 자금 이체·라이브 심사 완료를 의미하지 않는다.

## 배포 전제와 보류

**클라우드 적용 필요:** `0025_core_billing_payments.sql`, `0111_glue_billing_payments.sql`. 렌더 패스가 결제 기록을 읽으므로, 이 코드를 운영에 반영하기 전에 두 마이그레이션을 대표/Director가 적용해야 한다. 공개 플래그는 계속 닫혀 있다.

`NORMAL` 결제만 생성·렌더 연결·환불 대상으로 처리한다. 결제 기록은 `payment_type`과 템플릿이 없는 기록을 허용하는 조건부 제약을 두어 다음 PR에서 빌링키 결제를 추가할 수 있게 했다. 구독·빌링키 발급·갱신은 구현하지 않았다. Stripe 코드는 유지한다.

공개 시점, 라이브 키 전환, 결제수단 구성, 주문명, 영수증 이메일 필수 여부는 대표 결정 사항이다. 현재 위젯은 상점의 기본 설정을 읽으며, 주문명 `TWINGS · 템플릿명`은 검증용 후보이고 `customerEmail`은 전송하지 않는다. 해외 표시 가격/Stripe와 별개로, 이번 토스 결제 화면의 실제 청구 통화·금액은 저장된 KRW 가격을 명시한다.

근거: [토스 위젯 연동](https://docs.tosspayments.com/guides/v2/payment-widget/integration), [SDK의 결제수단·주문명·이메일 옵션](https://docs.tosspayments.com/sdk/v2/js/payment-widget), [서버 승인·취소 API](https://docs.tosspayments.com/reference), [테스트 키](https://docs.tosspayments.com/reference/using-api/api-keys).
