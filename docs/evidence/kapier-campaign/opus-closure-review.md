# Opus 5.5 closure source review

# TWINGS 변경분 최종 종결 리뷰 (Opus 5.5)

## 결론

제공된 소스 범위 안에서 **남은 차단 결함(P1·P2)은 없습니다.** 이전 리뷰의 P2-A와 P3-1~5는 모두 실제 코드로 해소되었습니다. 아래에 비차단 P3 몇 건만 기록합니다.

이 판정은 소스 리뷰 결론일 뿐 **운영 승인이 아닙니다.** 브라우저·OAuth·실제 Toss·PostgreSQL 다중 연결 QA는 검증되지 않았습니다. 플래그는 off, 마이그레이션은 미적용, 정책 문서는 초안 상태입니다.

---

## 요청 항목별 확인

| 항목 | 판정 | 근거 |
|---|---|---|
| 외부 Toss 키를 바인딩 전에 거부 | **해결** | `payment.ts:236-248`: `pending`일 때 `retrieve(K)`를 먼저 호출합니다. `paymentKey`나 `orderId`가 다르면 DB 쓰기 없이 `payment_review`를 반환합니다. 조회 예외가 나면 바인딩 없이 `confirm_pending`을 반환합니다. 404(null)이면 바인딩 후 confirm 4xx → `confirm_rejected` → `failed`로 끝나며, 케이스는 `accepted`에 머물러 새 주문을 만들 수 있습니다. |
| 외부 결제를 confirm/cancel하지 않음 | **해결** | `settle:136-140`: 키는 같고 `orderId`가 다르면 `failed`와 케이스 `accepted`로 처리하며 공급자를 호출하지 않습니다. `refund`(`:462`)는 `matches`를 요구하므로 외부 결제를 취소할 수 없습니다. `releaseUnpaid`(`:574-579`)는 외부 결제 증거를 인정하되 cancel을 호출하지 않습니다. 회귀 테스트 `funding.test.ts:162-235`가 confirm·cancel 호출 수를 고정합니다. |
| 미확정 자금의 이중 청구 방지 | **해결** | 타임아웃·5xx는 `confirming` 상태와 lease를 유지하고, reconcile은 retrieve만 합니다. `awaiting_deposit`는 `campaign_funding_one_order`, 주문 생성(`:68`), void(`service.ts:465-473`)를 모두 차단합니다. confirm의 idempotency key는 주문별로 고정되어 있고, `payment_key`는 트리거로 불변입니다. |
| 네트워크 이후 현재 소유자 재확인 | **해결** | confirm은 preflight에서 `seat(buy)` → retrieve → 두 번째 트랜잭션에서 `lockCase` + `seat(buy)`로 다시 확인합니다(`:262-263`). 라우트도 `loadFundingCheckout`으로 먼저 확인합니다. |
| reward: 인가 후 캠페인 잠금 | **해결** | `service.ts:336-343`: 잠금 없는 인가 조회를 먼저 하고, 그다음 `campaigns FOR UPDATE` → `seat` 재확인 → 링크를 재확인합니다. 순서는 campaign→project로 견적 경로와 일치합니다. 테스트 `:236-258`이 있습니다. |
| HTTP 상태 매핑 | **해결** | `route.ts:26-42`, `:79-82`: `invalid`→400, `rate_limited`→429, `unavailable`→503, `not_found`→404, `conflict`→409. 테스트 `funding-http.test.ts:87-103`이 있습니다. |
| 견적 유효기간 KST 날짜·시각 | **표시 해결** | 관리자(`:231`)와 브랜드(`:147`) 화면 모두 `formatBrandTimestamp`를 씁니다. 테스트 `:259-265`가 두 로케일 모두 `17 … 00:45 KST`를 확인합니다. 입력 변환은 아래 확인 항목을 보십시오. |
| 협업 기록 DELETE 불변 + 기본 권한 | **해결** | 0047:55과 66-70은 `update or delete` 트리거로, `tg_op='DELETE'`를 먼저 거부합니다. 0132:4는 `service_role`까지 revoke한 뒤 select/insert와 열 단위 update만 다시 부여합니다. 테스트 `:911-950`이 상속 권한 제거까지 확인합니다. |
| 잠금 없는 일관된 초대 조건 스냅샷 | **해결** | `loadInvitationLanding:95-114`는 단일 SELECT로 표시 내용과 해시를 같은 행에서 만듭니다. `termsSnapshot`이 고정 키만 고르므로 `slots_taken`은 해시에 섞이지 않습니다. 수락 시 같은 함수로 재검증하고 스냅샷을 불변 저장합니다. 테스트 `:839-860`이 있습니다. |
| 종료된 지원서는 토큰을 소진하지 않음 | **해결** | `:503-508`: `declined/withdrawn/expired`면 초대를 갱신하기 전에 `Denied`를 던지고 트랜잭션이 롤백됩니다. 문구도 "초대는 사용하지 않았습니다"로 정확합니다. 테스트 `:861-910`이 있습니다. |

---

## 남은 비차단 사항 (P3, 머지 차단 아님)

**P3-a. 관리자 refund/release가 네트워크 이후 관리자 권한을 재확인하지 않음**
- 위치: `payment.ts:469-491`, `:581-605`
- `studio()`는 preflight에서만 호출됩니다. retrieve가 진행되는 최대 15초 사이에 `is_admin`이 해제되어도 lease 토큰으로 전이가 완료됩니다.
- 영향은 이미 인가된 조작자가 시작한 요청에 한정됩니다. 소유자 경로처럼 전이 트랜잭션 안에서 `studio(sql, actorId)`를 다시 호출하면 일관됩니다.

**P3-b. 인가 전 캠페인 행 잠금 (이전 P3-3과 같은 계열, 다른 위치)**
- `issueInvitation`(`collaboration/service.ts:329-337`)은 `campaignAccess`보다 먼저 `campaigns FOR UPDATE`를 실행합니다.
- `participantAccess(write)`(`:211-220`)도 지원서 UUID만으로 캠페인을 잠근 뒤 인가합니다.
- 로그인 사용자가 UUID를 알면 짧은 행 잠금을 유발할 수 있습니다. 플래그가 off인 동안에는 도달할 수 없습니다.

**P3-c. 0134가 `service_role`의 상속 권한을 revoke하지 않음**
- 위치: `0134:6`
- 0132와 달리 `service_role`을 revoke 대상에서 뺐습니다. Supabase 기본 권한이 있다면 DELETE/TRUNCATE 권한이 남습니다.
- DELETE는 0049 트리거가 막습니다. TRUNCATE는 행 트리거를 우회합니다.
- 0132와 같은 패턴(revoke 후 select/insert/update 재부여)으로 맞추기를 권합니다.

**P3-d. 협업 라우트 상태 코드**
- 위치: `collaboration/route.ts:100-117`
- `slots_full`, `not_open`, `not_selected`가 403으로 응답됩니다. 동작은 안전하지만 의미상 409에 가깝습니다.

**P3-e. 기존 `applied` 지원서가 있으면 초대가 소진됨**
- 위치: `:523-547`
- 기존 지원서에 연결될 뿐 새 pitch와 SNS는 반영되지 않습니다. 종료 상태(declined 등)는 이번에 고쳐졌으므로 이 동작이 의도된 것인지만 확인하면 됩니다.

---

## 이 범위에서 확인할 수 없는 항목

- **`campaignFunding.quote` 관리자 op 핸들러(미제공)가 `datetime-local` 값을 KST로 변환하는지**
  - `parseKstDateTimeLocal`을 쓰는지 확인이 필요합니다.
  - 변환 없이 전달하면 `z.string().datetime()`이 거부합니다. 이 경우는 오류로 끝나므로 안전합니다.
  - 서버 UTC 기준으로 `new Date(...)`를 쓰면 유효기간이 9시간 늦어집니다. 이 경우가 문제입니다.
- **`formatBrandTimestamp` 구현 자체**는 이번 제공분에 없습니다. 테스트 결과에 근거해 판정했습니다.
- **테스트 순서 의존성**: 협업 테스트 `:911`은 앞선 테스트가 만든 `service_role` 역할과 각 테이블의 행에 의존합니다. 단독으로 실행하면 실패할 수 있습니다.

---

## 판정

- **P2-A 수정: 승인(소스 범위).** 외부 키는 공급자 증거로 바인딩 전에 거부됩니다. 기존에 잘못 바인딩된 건도 cancel이나 confirm 없이 `failed`로 복구되고, 새 주문을 만들 수 있습니다.
- **P3-1~5 수정: 승인(소스 범위).**
- **남은 차단 결함: 없음.** P3-a~e는 후속 처리로 충분합니다.

## 운영 게이트 (변경 없음, 모두 미검증)

1. **Toss test 키로 실제 응답 확인**
   - 미승인 키, 다른 가맹점 키, 거절 후 `retrieve` 응답
   - idempotency key의 유효 범위
   - 가상계좌 만료 시점
2. **수기 운영 절차 문서화**: cancel 요청이 도달하지 않은 `refund_pending`, `PARTIAL_CANCELED` 등으로 생긴 `review`.
3. **입금 반영 수단 결정**: cron이나 웹훅을 쓸지.
4. **마이그레이션 적용 전 확인**
   - 대상: 0047~0049, 0132~0134
   - 실제 DB 접속 역할의 BYPASSRLS 여부(FORCE RLS에 정책이 없음)
   - P3-c 정정 여부
5. **실제 PostgreSQL 다중 연결 경합 테스트**
6. **브라우저 흐름 검증**: Instagram 웹뷰 → OAuth → 수락, Toss return 흐름.
7. **플래그 off 유지**: 정책·법무 문서가 승인될 때까지 유지하십시오.