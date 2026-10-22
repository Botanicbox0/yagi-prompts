# PR 초안 — fix(billing): 승인 거절·종결 상태·웹훅으로 결제 실패를 끝낸다

> `gh` CLI가 이 PC에 없어 PR을 열지 못했다. 브랜치 `claude/payment-hardening-2dea5c`는 push했다. 이 파일을 PR 본문으로 쓰면 된다(base `main`).

- 코드 커밋: `git rev-parse HEAD` = `782143f5ef41bc4a1299e0424afdd8c6fea23928` (이 초안은 그 위의 문서 커밋)
- 기준: `main` 866f168
- 요구사항 원본: `docs/PLATFORM-2.0.md` §2.2 표 1~9번 (Director 감사)

## 무엇이 바뀌나

| # | 문제 | 수정 |
| --- | --- | --- |
| 1 | 카드 거절도 `confirm_pending` → "다시 결제하지 말고 기다리라" | `TossError.retryable=false`면 결제를 한 번 다시 읽고(이미 승인됐으면 승인 처리) 즉시 `failed(declined)`. 주문 페이지에 사유 + **다시 결제하기**. `POST /api/billing/toss/orders/{id}/retry`가 같은 사용자·템플릿·옵션·저장 사진으로 새 `pending` 주문을 만든다. 원 주문은 `failed` + `retried_by`(두 번 눌러도 같은 주문), 소유자만, 하루 주문 한도 적용. 네트워크·5xx·타임아웃만 `confirm_pending`. |
| 2 | `price_changed`·`not_open`·401이 주문을 `pending`으로 남겨 옛 금액 결제창이 다시 열림 | `failed(price_changed)` + "가격이 바뀌어 주문을 다시 만들어야 해요" + 템플릿 링크, `failed(not_open)` + 닫힘 안내. 401이면 복귀 페이지가 승인 파라미터를 `next`에 담아 로그인으로 보내고 같은 복귀 페이지로 돌아온다. |
| 3 | 키 설정 오류가 `runRenderPass`·크론을 죽임, `flags.ts`(`live_` 접두)와 게이트웨이(`live_gck_`/`live_gsk_`) 불일치 | 패스의 게이트웨이 생성·리콘사일을 try/catch, `[billing] {"event":"toss_gateway_unavailable",…}` 한 줄(키 값 없음). tick은 패스가 실패해도 사진·2차 활용 복구를 계속하고 503. `tossKeyKind` 하나를 flags·게이트웨이가 공유. 운영 `review`는 테스트 위젯 키 쌍일 때만 열리고 아니면 `off` + 오류 로그. `_docs_` 키는 경고 로그. |
| 4 | 끝나지 않는 상태 | `CANCELED`→`paid`였으면 `refunded`, 아니면 `failed(canceled)` / `ABORTED`·`EXPIRED`·404→`failed(aborted·expired·unknown_payment)` / 다른 주문의 기록→`failed(provider_mismatch)` / 부분 잔액→`refund_pending(partial_balance)`(자동 환불 안 함) / `WAITING_FOR_DEPOSIT`→`expires_at`까지 `confirming`, 지나면 `failed(expired)`. 환불·이행 각 10회 상한 → `refund_manual`/`fulfil_manual`, `/admin` 렌더 카드 "결제 확인 필요 N". 환불 재시도는 처음 3번 바로, 그 뒤 1분→1시간 백오프. 실패 메일은 환불 확인 또는 상한 도달 시 정확히 1회. 패스당 50건, 패스 로그에 `payments confirmed · refunded · failed · manual`. |
| 5 | 상점관리자 수동 취소를 DB가 모름 | `POST /api/billing/toss/webhook`: 본문은 힌트(`orderId`/`paymentKey`/`status`). 주문을 찾으면 그 1건만 **저장된 결제 키로** 토스에서 다시 읽어 정리(콘솔 취소→`refunded`, 부분 취소→관리자 대기, 실패로 안내한 주문에 돈이 잡혀 있으면 환불). 모르는 주문·잘못된 본문 빈 200, 발신지 분당 30·전체 120 초과 빈 429, 우리 쪽 장애 빈 503(토스 재전송), GET 405, 본문·시크릿 로그 없음. |
| 6 | 만료된 `pending`과 사진이 영원히 남음 | `failed(expired)` + 입력 사진 삭제(`input_deleted_at`). 거절된 주문의 사진은 다시 결제하기용으로 주문 시간까지 두고, 지나거나 재주문되면 삭제. |
| 7 | 승인 시 `consent_at` 덮어씀 | 승인·동의 라우트 모두 `coalesce` — 처음 동의한 시각이 남는다. |
| 8 | 상태 폴링마다 전체 사용자 리콘사일 | `reconcileTossPayments(deps, { orderId })` — 그 주문 1건만. 전체는 렌더 패스·크론만. |
| 9 | 로그인 복귀 뒤 승인 경로 미검증 | 미들웨어(세션 없음) → 알림 띠 로그인 링크 → `/auth/signin` → OAuth 콜백 → 승인 라우트까지 실제 라우트로 `paymentKey`가 보존되고 승인이 끝나는 것을 테스트로 고정. |

## 바뀐 파일 (`git diff --stat 866f168 782143f`)

```
 app/(admin)/admin/page.tsx                        |  11 +
 app/(app)/billing/toss/[id]/page.tsx              |  18 +-
 app/(app)/billing/toss/return/resume.ts           |  29 ++
 app/(app)/billing/toss/return/return.tsx          |  22 +-
 app/(app)/billing/toss/status.tsx                 | 102 +++-
 app/api/billing/toss/orders/[id]/retry/route.ts   |  44 ++
 app/api/billing/toss/orders/[id]/route.ts         |  16 +-
 app/api/billing/toss/webhook/route.ts             |  58 +++
 app/api/renders/tick/route.ts                     |   7 +-
 docs/qa/toss-checkout/README.md                   |  33 +-
 lib/billing/toss-gateway.ts                       |  38 +-
 lib/billing/toss-service.ts                       | 588 +++++++++++++++++++---
 lib/flags.ts                                      |  44 +-
 lib/renders/runtime.ts                            |   6 +-
 lib/renders/service.ts                            |  21 +-
 messages/en.ts                                    |  20 +
 messages/ko.ts                                    |  20 +
 scripts/sweep-anon.ts                             |  23 +
 supabase/migrations/0052_core_billing_failure.sql |  27 +
 tests/billing/public-switch.test.ts               |  80 ++-
 tests/billing/toss-checkout.test.ts               | 553 +++++++++++++++++++-
 tests/billing/toss-gateway.test.ts                |  33 ++
 tests/billing/toss-order-page.test.tsx            | 114 ++++-
 tests/routes/toss-payment-routes.test.ts          | 328 ++++++++++++
 24 files changed, 2091 insertions(+), 144 deletions(-)
```

범위 밖이지만 요구사항 때문에 건드린 곳: `app/(admin)/admin/page.tsx`(§2.2-4 "/admin 대시보드 카운트" — Stat 1줄). `lib/renders/service.ts`는 리콘사일 호출부와 `RenderPassReport.payments` 필드만, `notifyFinished`는 그대로다(실패 메일 1회는 `renderPaymentStatus`가 수동 대기 상태를 `refund_manual`로 돌려 보류를 푸는 방식).

## 실행한 검증 (로컬, worktree)

| 명령 | 결과 |
| --- | --- |
| 새 테스트를 수정 전 코드(866f168 사본)에 실행 | **43 실패 / 30 통과**, 라우트 테스트 파일은 retry 라우트가 없어 로드 실패 — 테스트가 먼저 빨간색 |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run` | **270 파일 / 2,620 테스트 통과** (기준선 269 / 2,559, +1 파일 +61 테스트) |
| `npm run db:local` | 0052 포함 스냅샷 재생성 |
| `npm run build:local` | 통과 (`/api/billing/toss/orders/[id]/retry`, `/api/billing/toss/webhook` 동적 라우트) |
| `npm run start:local` (PORT=3001) + `npm run sweep:anon` (SWEEP_BASE_URL=http://localhost:3001) | **SWEEP PASSED — 992/992** (새 체크 12개: retry 익명 401·no-store, 웹훅 모르는 주문·잘못된 본문 빈 200·no-store, GET 405, 세션 없는 복귀가 `next`에 `paymentKey`·`orderId` 보존) |

포트 3001 첫 스윕은 canonical·hreflang 56건이 실패했다 — 빌드 시점 사이트 주소가 기본값(3000)이었기 때문. 빌드·서버 모두 `NEXT_PUBLIC_APP_URL=http://localhost:3001`로 다시 띄워 992/992. 코드 문제가 아니다.

## 건너뛴 검사

- 실제 토스 테스트 키로 카드 승인·거절·취소, 실제 웹훅 수신은 하지 않았다(이 worktree에 키 없음). 가짜 게이트웨이와 스크립트된 토스 응답(DONE·CANCELED·PARTIAL_CANCELED·ABORTED·EXPIRED·WAITING_FOR_DEPOSIT·404·4xx 재전송)으로 검증했다.
- 프리뷰 배포·스크린샷 없음(PR을 열지 못했다).
- 클라우드 마이그레이션 적용 안 함(규칙상 대표/Director).

## 클라우드 적용 필요 — 코드 배포 **전에**

`supabase/migrations/0052_core_billing_failure.sql` — `billing_payments`에 `refund_attempts`, `fulfil_attempts`, `input_deleted_at`, `retried_by` + 인덱스 2개. 이것 없이 배포하면 주문 생성·승인은 되지만 리콘사일·다시 결제하기·웹훅이 실패한다(렌더는 계속되고 `toss_reconcile_failed` 로그). 감사가 짚은 0039(`resolution`) 운영 적용 여부도 같이 확인 필요.

## 대표 할 일

- 토스페이먼츠 상점관리자(개발자센터) → 웹훅 → URL `https://twings.app/api/billing/toss/webhook`, 이벤트 `PAYMENT_STATUS_CHANGED` 등록. 라이브 키 전환 뒤에도 라이브 환경에 등록돼 있는지 확인.

## 남은 위험

- 웹훅은 같은 상점의 2차 활용(`brand_usage_payments`)·캠페인 펀딩 결제 이벤트도 받는다. 지금은 `billing_payments`에 없으면 빈 200으로 넘긴다 — 그쪽 리콘사일로 넘기는 것은 후속 작업.
- 속도 제한은 서버리스 인스턴스 메모리 기준이다(인스턴스마다 따로). 진짜 범람 방어는 Vercel 방화벽 몫.
- `refund_manual` 실패 메일에는 환불 문장이 없다(거짓 "환불 완료"를 막으려 보류만 푼다). "담당자가 처리 중" 문장을 메일에 넣으려면 `notifyFinished` 수정이 필요해 이번 범위(푸시 세션과 겹침)에서 뺐다. 주문 페이지에는 그 문장이 나온다.
- 토스가 401·403(우리 키 오류)을 승인에 돌려주면 그 주문은 `failed(declined)`가 된다(청구 없음). 로그의 `provider` 코드(`UNAUTHORIZED_KEY` 등)로 구분한다.
- 0050/0051/0053 브랜치와 `messages/*.ts`·`lib/renders/service.ts`에서 병합 충돌이 날 수 있다(위치 충돌, 의미 충돌 아님).

## 다음 행동

1. Director 리뷰 → 0052(및 0039 확인) 클라우드 적용 → 병합·배포.
2. 대표: 웹훅 URL 등록. 심사 계정으로 테스트 결제 1건(카드 거절 1건 포함) 확인.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
