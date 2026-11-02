# Opus 5.5 final source review

# TWINGS 변경분 최종 소스 리뷰 (Opus 5.5, 후속)

## 결론

제공된 소스 범위에서 **P1은 없습니다.** 이전 P2 9건은 대부분 실제 코드로 해소되었습니다.

다만 이전 P2-1과 같은 계열(미검증 paymentKey 바인딩으로 인한 영구 고착)에서 **새 트리거를 가진 P2 1건이 남아 있습니다.** 이 건은 머지 전에 수정하는 것을 권합니다. 그 외 P3 5건이 있습니다.

이 판정은 소스 범위 안의 결론이며 운영 승인이 아닙니다.

---

## 남은 결함

### P2-A. 다른 주문의 paymentKey가 바인딩되면 케이스가 `review`에 영구 고착

**위치**
- `app/api/campaign-funding/route.ts:138-148`
- `lib/campaigns/funding/payment.ts:250-259`, `:136-139`, `:284-296`, `:417-418`, `:530-535`
- 0049 `campaign_funding_one_order`

**트리거**
1. 브랜드 소유자가 `/brand/projects/P/funding/return?orderId=O&paymentKey=K&amount=N` 링크에서 "내 결제 결과 확인하기"를 누릅니다.
   - `K`는 같은 Toss 가맹점의 다른 결제 키입니다. 예를 들어 `brand_usage_payments` 결제처럼 이 테이블에 없는 키입니다.
   - `O`와 `N`은 조직 viewer도 DTO에서 볼 수 있습니다.
2. 서버는 공급자 검증 전에 `payment_key=K`, `status='confirming'`을 기록합니다. 이 값은 0049 트리거 때문에 바꿀 수 없습니다.
3. Toss confirm이 4xx(non-retryable)를 반환하면 `retrieve(K)`가 다른 주문의 결제를 돌려줍니다.
   - `matches`가 실패하므로 `settle`이 결제와 케이스를 모두 `review`로 만듭니다.
   - 5xx로 `confirm_pending`이 된 경우에도 reconcile이 같은 경로로 `review`에 도달합니다.

**결과**
- `releaseUnpaid`(`:530-535`)와 `refund`(`:418`)는 둘 다 `matches(p,o)`를 요구합니다. 따라서 해제도 환불도 할 수 없습니다.
- reconcile은 `review`를 다시 조회하지 않습니다.
- `voidExpired`는 `failed/expired`가 아닌 주문이 있으면 conflict를 냅니다.
- `campaign_funding_one_order` 인덱스가 `review`를 포함하므로 새 주문도 만들 수 없습니다.
- 앱 안에서 케이스를 복구할 경로가 없습니다.

명시적 클릭을 요구하도록 바뀌면서 위험은 줄었지만, 이전 P2-1과 같은 영구 차단 결과는 남아 있습니다.

**권고 (둘 중 하나)**
- 바인딩 전에 `retrieve(K)`로 `orderId===O`를 확인합니다.
- 또는 공급자가 확인한 `p.orderId !== o.id`를 "이 주문의 키가 아님"으로 판정해 `failed`로 처리합니다. Toss 미승인 인가는 만료되므로, 실제 금전 불확실성은 생기지 않습니다.

### P3

**P3-1. 협업 기록의 DELETE 불변성이 강제되지 않음**
- 위치: `0047:65-69`, `0132:2-7`
- 트리거가 `before update`에만 걸려 있습니다. 앱 연결 역할인 postgres(소유자)나 `service_role`로 `delete from campaign_participant_access_audit`(또는 messages, files)를 실행하면 성공합니다.
- 0132는 `service_role`에 부여된 기존 권한을 revoke하지 않습니다. 0133은 revoke합니다. PGlite 테스트는 테이블 생성 뒤에 역할을 만들기 때문에 이 차이를 잡지 못합니다.
- 권고: 0048처럼 `update or delete` 트리거를 적용하고, `service_role`에 대해 revoke 후 다시 grant하십시오.

**P3-2. 익명 GET이 공개 경로에서 campaigns 행을 잠금**
- 위치: `app/(app)/campaigns/[slug]/join/page.tsx:42-48`
- 이제 익명 GET에서도 `campaigns ... for share`가 실행됩니다. 이 행 잠금 쓰기는 반복 요청이 들어오면 `FOR UPDATE`를 쓰는 경로(관리자 편집, 수락, 메시지·파일 쓰기)와 경합합니다.
- 권고: 한 번의 행 조회로 표시 내용과 해시를 함께 만드십시오.

**P3-3. 인가 전에 캠페인 행을 잠금**
- 위치: `lib/campaigns/funding/service.ts:335-342`
- `reward.propose`는 `seat` 인가보다 먼저 `campaigns FOR UPDATE`를 실행합니다. 캠페인 UUID만 알면 로그인한 누구나 이 잠금을 유발할 수 있습니다.
- 권고: 순서를 바꿔 인가를 먼저 하십시오.

**P3-4. 기존 지원서가 있으면 초대만 소진됨**
- 위치: `lib/campaigns/collaboration/service.ts:472-516`
- `declined`나 `withdrawn` 지원서가 있는 크리에이터가 새 초대를 수락하면, 초대는 소진되지만 기존 종료 지원서에 연결될 뿐 재신청은 되지 않습니다.
- 이때 입력한 pitch와 SNS는 fingerprint에만 저장되고 버려집니다.

**P3-5. reward.propose 응답 코드 매핑 오류**
- 위치: `route.ts:64-73`
- `invalid`, `unavailable`, `rate_limited`가 모두 403으로 응답됩니다.

---

## 이전 항목 수정 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| P2-1 자동 confirm / 4xx·404 고착 | **해결** (단, P2-A 잔존) | 명시적 버튼(`funding-actions.tsx:226-255`), non-retryable + `retrieve` null이면 `failed` 처리, `confirm_rejected` 근거가 있을 때만 release |
| P2-2 견적 만료 정지 | **해결** | `voidExpiredFundingQuote`: 수락 기록 보존, 트리거가 accepted→voided만 허용, 미확정 주문이 있으면 거부 |
| P2-3 환불이 롤아웃 플래그에 묶임 | **해결** | refund·release·reconcile이 `environmentMatches`만 검사, 관리자 UI는 `recovery`로 분기 |
| P2-4 환불 사전 상태 오염 | **해결** | 상태 변경 없는 preflight lease → 공급자 조회 → 경계 통과 후 전이, `finally`에서 lease 해제 |
| P2-5 가상계좌 | **해결** | `awaiting_deposit` 상태, reconcile 대상 포함, void·주문 생성 차단 |
| P2-6 락 순서 | **해결(코드 기준)** | 쓰기는 campaign→application, 읽기 경로에는 락 없음, 스토리지 쓰기는 트랜잭션 밖. 실제 PostgreSQL 다중 연결 검증은 없음 |
| P2-7 익명 초대 fragment | **해결** | 미들웨어가 GET/HEAD만 예외, sessionStorage 24시간 보관, 외부 브라우저 주소는 정확한 join 경로만 허용. 실제 브라우저·OAuth 검증은 없음 |
| P2-8 동의 증빙 | **해결** | brief Markdown 표시, `formatCampaignDateTime`(KST), 같은 잠금 스냅샷에서 해시 생성, `accepted_terms_snapshot` 불변 저장 |
| P2-9 payout 트리거 롤아웃 | **해결** | 정규화한 값을 비교하고, 잠금 상태면 원본 jsonb 보존 |
| P3 오류 매핑, 응답 코드, delete 권한, Slack 링크, 번역, GET 부수효과, 수락 초대 철회 | **해결** | 남은 부분은 위 P3-1, P3-5 |

**보상 제안**
- 브랜드가 입력한 KRW 금액과 조건을 그대로 저장합니다.
- 관리자 검토 필드 외에는 불변 트리거로 보호됩니다.
- payout이나 지급에 연결되는 코드 경로가 없습니다.
- 의도대로 동작함을 확인했습니다.

**Slack 페이로드**
- 고정 문구, outbox ID, flag 딥링크만 포함합니다.
- 원문은 포함하지 않습니다.
- 딥링크로 들어와도 원문은 열리지 않습니다.

---

## 운영 게이트

1. **P2-A 수정 및 회귀 테스트**
   - 다른 주문의 키로 확인하면 `review`가 아니라 `failed`가 되는지 확인합니다.
   - 새 주문을 만들 수 있는지 확인합니다.
2. **잔여 고착 상태의 운영 절차 문서화**
   - 대상: provider가 `DONE`인데 cancel 요청이 도달하지 않은 `refund_pending`, 그리고 `matches` 실패로 생긴 `review`.
   - 설계상 취소를 재전송하지 않으므로 앱 안에는 복구 경로가 없습니다. Toss 콘솔 대조와 DB 수기 처리 절차가 필요합니다.
3. **Toss 실제 동작 확인 (test 키)**
   - 미승인 키, 거절 이후, 가상계좌 만료 시점의 `retrieve` 응답
   - idempotency key의 유효 범위
   - 실패 후 같은 orderId를 재사용할 수 있는지
4. **입금 반영 수단 결정**
   - reconcile은 수동(관리자 버튼, 브랜드 상태 확인)으로만 실행됩니다.
   - 가상계좌를 쓰려면 cron이나 웹훅을 승인할지 결정해야 합니다.
5. **견적 유효기간 표시 확인**
   - `formatDate`(미제공)가 견적 유효기간을 KST 날짜·시각으로 표시하는지 확인합니다. 동의 대상 정보입니다.
6. **마이그레이션 적용 전 확인**
   - 0047~0049, 0132~0134는 아직 미배포입니다.
   - 운영 payout 정규화 비교 쿼리, P3-1 권한 정정, Vercel의 실제 DB 접속 역할(BYPASSRLS)을 확인해야 합니다.
7. **실제 PostgreSQL 다중 연결 테스트**
   - 대상: 초대 수락과 선정, 파일 finalize와 관리자 편집, 주문 생성 경합.
8. **브라우저 검증**
   - Instagram 웹뷰 → 외부 브라우저 → OAuth → 수락 흐름
   - Toss 위젯 return 흐름
   - 둘 다 미검증입니다.
9. **플래그 기본값 off 유지**
   - 대상: `CAMPAIGN_COLLABORATION_PUBLIC`, `CAMPAIGN_FUNDING_PUBLIC`, `POLICY_READY`, `CAMPAIGN_RISK_ENABLED`, `RISK_SLACK`.
   - 자동 대화 분석 고지, 보관 기간, 법무·초상 관련 문서는 초안 상태이므로 승인 전에는 개방하지 마십시오.