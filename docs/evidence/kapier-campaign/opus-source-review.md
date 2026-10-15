# Opus 5.5 source review

# TWINGS 변경분 독립 소스 리뷰 (Opus 5.5)

## 결론

제공된 소스 범위에서 **즉시 악용 가능한 P1 결함은 찾지 못했습니다.** 단, 아래 두 가지 전제를 확인해야 이 결론이 유지됩니다.

- `brand_memberships`에 프로젝트 단위(캠페인 게스트) 행이 없어야 합니다.
- 운영 DB 연결 역할이 BYPASSRLS여야 합니다.

두 전제는 아래 "검증 공백"에서 설명합니다. 결제 복구, 락 순서, 온보딩, 동의 증빙 영역에서 **P2 결함 9건**을 확인했습니다. 마이그레이션 미적용과 플래그 기본 off는 운영 게이트로 보고 결함에 넣지 않았습니다.

---

## P2 — 실제 코드 결함

### P2-1. 클라이언트가 보낸 paymentKey를 먼저 확정해서, 4xx 응답이나 조회 404가 나면 주문이 영구히 `confirming`에 갇힘

**위치**
- `lib/campaigns/funding/payment.ts:242-251`
- `:275-277`
- `:129-131`
- `:304`
- `components/campaigns/funding-actions.tsx:204-224`

**트리거**
1. `/brand/projects/P/funding/return?orderId=O&paymentKey=junk&amount=N` 경로에 들어가면 마운트 시 사용자 조작 없이 `order.confirm`이 자동으로 POST됩니다.
2. 서버는 공급자를 검증하기 전에 `payment_key=junk`, `status='confirming'`을 기록합니다. `payment_key`는 0049 트리거로 한 번 정해지면 바뀌지 않습니다.
3. Toss confirm이 4xx를 돌려줘도 `catch`가 모두 `confirm_pending`으로 처리합니다. `TossError.retryable`은 무시됩니다.
4. reconcile의 `retrieve(junk)`는 404, 즉 `null`을 받습니다. 그러면 `settle`이 `confirming`과 새 lease를 계속 다시 씁니다.

**결과**
- 정상 paymentKey로는 더 이상 confirm할 수 없습니다. `o.payment_key !== v.paymentKey`이면 conflict가 납니다.
- `campaign_funding_one_order` 인덱스 때문에 새 주문도 만들 수 없습니다.
- 관리자 환불은 `paid/review/refund_pending`만 허용하므로 이 상태를 해제할 방법이 없습니다.
- 결과적으로 케이스가 영구 차단됩니다.
- 조직 viewer는 결제 목록 DTO에서 주문 ID를 볼 수 있습니다. 따라서 viewer가 소유자에게 이 링크를 클릭하게 만드는 것만으로 구매를 막을 수 있습니다.

**권고**
- return 페이지는 사용자가 직접 누르는 확인 버튼으로 바꾸십시오.
- 확정되지 않은 4xx와 `retrieve=404`는 `failed`로 되돌리십시오. 키 바인딩도 함께 해제해야 합니다.
- 운영자용 "미확정 해제" 작업을 추가하십시오.

### P2-2. 견적을 수락한 뒤 유효기간이 지나면 케이스가 영구히 정지됨

**위치**
- `lib/campaigns/funding/payment.ts:44-45`
- `lib/campaigns/funding/service.ts:89`

**트리거**: 견적 수락 → 결제 전에 `valid_until`이 지남.

**결과**
- 주문 생성은 conflict로 끝납니다.
- 재견적은 `c.status !== "quoted"`에서 conflict로 끝납니다.
- `campaign_id`가 unique라서 새 케이스도 만들 수 없습니다.
- 브랜드와 관리자 모두 복구할 방법이 없습니다.

### P2-3. 환불이 공개 롤아웃 플래그에 묶여 있음

**위치**
- `payment.ts:348`
- `app/(admin)/admin/funding/page.tsx:193`

**트리거**: 사고 대응으로 `CAMPAIGN_FUNDING_PUBLIC`이나 `POLICY_READY`를 끔.

**결과**: 이미 결제된 건의 환불 버튼과 환불 작업이 모두 `payments_closed`가 됩니다. 신규 판매를 막는 kill switch가 환불 의무 이행까지 막습니다. 환불은 `open()`이 아니라 환경 일치 여부와 스키마 준비 여부만 검사하도록 분리해야 합니다.

### P2-4. 환불 1단계가 공급자 확인 전에 상태를 오염시킴

**위치**
- `payment.ts:378-393`
- `:400-407`

**트리거**: 다음 셋 중 하나가 일어날 때.
- 공급자 조회 예외
- `matches` 불일치
- 공급자 상태가 DONE이 아님

**결과**
- 결제와 케이스가 모두 이미 `refund_pending`으로 커밋된 상태에서 `payment_review`나 `confirm_pending`을 반환합니다.
- 실제로는 환불이 시작되지 않았는데 브랜드 화면에 "환불 결과 확인 중"이 계속 표시됩니다.
- 원래 상태(`paid` 또는 `review`)는 기록에서 사라지고 되돌릴 경로가 없습니다.

**권고**: 공급자 사전 조회를 상태 전이보다 먼저 하거나, 이전 상태를 저장해 두었다가 복원하십시오.

### P2-5. 가상계좌처럼 비동기로 입금되는 결제는 `review`에 고정됨

**위치**
- `payment.ts:139-152`
- `:292`

**트리거**: Toss 위젯 결제수단 설정에 가상계좌가 포함되어 있으면 confirm 응답이 `WAITING_FOR_DEPOSIT`입니다.

**결과**
- 코드는 이를 `review`로 분류합니다.
- reconcile은 `confirming`과 `refund_pending`만 처리하므로, 실제 입금이 들어와도 `paid`로 바뀌지 않습니다.
- 웹훅도 없습니다.

**권고**: 위젯 variant에서 비동기 결제수단을 명시적으로 빼거나, 이 상태를 별도로 처리하십시오.

### P2-6. 행 락 순서가 역전되어 교착이 발생할 수 있음

**위치**
- `lib/campaigns/collaboration/service.ts:167-172` (`for share of a,c,l,p`): rowmark가 rangetable 순서를 따르므로 **application을 먼저, campaign을 나중에** 잠급니다.
- `lib/admin/campaign-operations.ts:243-250` (select 작업): `campaigns FOR UPDATE`를 먼저 잡고 application을 UPDATE합니다.
- `service.ts:373-430` (`acceptInvitation`): campaign을 먼저 잡고 `campaign_applications FOR UPDATE`를 잡습니다.

**트리거 예시**
- 크리에이터가 대기 화면을 보는 순간(`loadParticipation`도 FOR SHARE를 잡음) 관리자가 같은 지원서를 선정하는 경우
- 기존 지원자가 다른 초대를 수락하면서 동시에 스레드를 여는 경우

**결과**: 40P01이 발생해 한쪽이 503이나 오류 페이지로 끝납니다.

**악화 요인**: `storeParticipantFile`이 트랜잭션 안에서 `putStaging`(`:711`)을 호출해, 공유 락을 네트워크 I/O 시간 내내 보유합니다.

**권고**
- 읽기 경로에서는 `FOR SHARE`를 제거하십시오.
- 쓰기 경로는 campaign을 먼저 잠근 뒤 application을 잠그는 순서로 통일하십시오.
- 스토리지 쓰기는 트랜잭션 밖에서 하십시오(pending → ready 2단계).

### P2-7. 비로그인 사용자의 초대 수락 경로에서 토큰이 유실됨 (온보딩 결함)

**위치**
- `lib/i18n/config.ts:51`: `join`이 로그인 게이트 대상입니다. sweep도 비로그인 redirect를 기대합니다.
- `components/campaigns/collaboration-forms.tsx:241-253`

**트리거**: 비로그인 크리에이터가 `/campaigns/x/join#token=…`을 엽니다.

**결과**
- 미들웨어가 `JoinForm`보다 먼저 로그인 화면으로 redirect하므로 `sessionStorage`에 토큰이 저장되지 않습니다.
- 브라우저의 fragment 상속 규칙 때문에 토큰이 `/auth/choose?…#token=…` URL과 방문 기록에 남습니다. 이 페이지의 서드파티 스크립트가 읽을 수 있고, 수락 전까지 노출됩니다.
- `next`에는 토큰이 없으므로 로그인 후 "초대 링크가 없습니다"가 표시됩니다.
- 인앱 웹뷰에서 외부 브라우저로 넘어가는 경우에는 원래 링크를 다시 열지 않는 한 복구할 수 없습니다.
- 결과적으로 신규 계정 온보딩의 기본 경로가 깨집니다.
- `JoinForm`의 `!signedIn` 분기(`:288-293`)는 실행될 수 없는 코드입니다.

**권고**: `join`을 게이트에서 빼서 클라이언트가 토큰을 먼저 저장하게 하거나, 서버 측 일회성 교환으로 바꾸십시오.

### P2-8. 동의 증빙의 무결성 문제

**위치**
- `service.ts:40-61`
- `app/(app)/campaigns/[slug]/join/page.tsx:60-91`
- 0047 invites 테이블

**문제 1 — 보이지 않는 내용에 대한 동의**: `termsVersion` 해시에는 `brief`가 포함되지만 join 화면에는 brief가 표시되지 않습니다. 크리에이터는 보지 않은 참여 안내에 동의하게 됩니다.

**문제 2 — 날짜 하루 차이**: 마감일을 `applicationsCloseAt?.slice(0,10)`으로 자릅니다. KST 자정 마감(예: `…-19T15:00Z`)이 하루 앞당겨 표시됩니다. 다른 화면은 `formatCampaignDateTime`을 씁니다.

**문제 3 — 재구성 불가능한 증빙**
- 해시(`accepted_terms_version`)만 저장하고 스냅샷은 남기지 않습니다.
- 수락 이후 요구사항, 일정, slots, brief가 바뀌어도 막는 장치가 없습니다(payout만 잠김).
- 따라서 분쟁 시 "무엇에 동의했는지"를 복원할 수 없습니다.

### P2-9. payout 불변 트리거의 롤아웃 위험 (확인 필요)

**위치**
- `campaign-operations.ts:150`
- `0047:12-15`

**트리거**: 0047을 적용했는데, 지원서가 있는 기존 캠페인의 저장된 `payout` jsonb 모양(키 누락, `maxCents` 부재와 null의 차이 등)이 현재 폼 직렬화 결과와 다름. 테스트 픽스처들 사이에서도 payout 키 집합이 서로 다릅니다.

**결과**: 제목만 수정해도 진행 중인 캠페인 편집이 전부 `badTransition`이나 DB 예외로 실패합니다.

**권고**: 적용 전에 운영 DB에서 `payout`과 정규화 결과를 비교하는 쿼리로 영향 범위를 확인하십시오.

---

## P3 — 정확성 및 UX

- **관리자 협업 작업의 오류 매핑이 잘못됨** (`lib/admin/campaign-collaboration-operations.ts:11-22`)
  - `conflict`가 `staleReview`로 매핑되어 콘테스트 출품작 교체 문구가 표시됩니다.
  - `not_open`, `not_selected`, `rate_limited`, `unavailable`이 모두 "폼 검증 실패"로 표시됩니다.
- **초대 생성 재시도 시 토큰 유실** (`service.ts:290-298`): 응답을 잃어 같은 requestId로 재시도하면 conflict가 납니다. 토큰은 해시로만 저장되므로 링크를 다시 얻을 수 없습니다.
- **수락된 초대의 철회 표시 오류** (`service.ts:345-348`): `revokeInvitation`이 수락된 초대도 철회합니다. 브랜드 화면에는 지원서가 살아 있는데 "철회됨"으로 표시됩니다.
- **위험 신호 화면의 번역 누락** (`app/(admin)/admin/risk/page.tsx:56`): `slackConfig='disabled'`에 해당하는 번역 키가 없어 한국어 화면에 원문 "disabled"가 노출됩니다.
- **결제 라우트의 응답 코드 오류** (`app/api/campaign-funding/route.ts:49-51`): 잘못된 JSON이 400이 아니라 503 "unavailable"로 응답됩니다.
- **협업 라우트의 응답 코드 오류**: `invalid`가 403으로 응답됩니다.
- **불변 감사 기록에 delete 권한 부여** (`0133:7`): `campaign_risk_reviews`와 `campaign_risk_access`에 delete가 부여되어, 감사 기록을 불변으로 다룬다는 의도와 맞지 않습니다.
- **주석과 다른 락 순서** (`lib/campaigns/funding/service.ts:39-64`): 주석은 "프로젝트를 먼저 잠그지 않는다"고 하지만, 실제로는 프로젝트 FOR SHARE를 케이스보다 먼저 잡습니다. `accept`/`order`는 케이스를 먼저 잡습니다. 다른 트랜잭션이 프로젝트를 UPDATE하며 끼어들면 3자 교착이 생길 수 있습니다.
- **GET 요청의 부수효과** (`route.ts:142`): GET이 공급자 조회와 DB 갱신을 일으킵니다. 소유자 권한 범위 안이라 피해는 작지만 GET 부수효과입니다.
- **초대가 비공개를 보장하지 않음**: 초대는 `recruiting`(공개) 캠페인에서만 동작합니다. 같은 캠페인에 공개 지원서로 들어와 선정된 사람도 브랜드 대화에 접근합니다. "비공개 초대 캠페인"이라는 의도라면 현재 구조로는 성립하지 않습니다.
- **알림 링크에서 대상을 찾기 어려움**: Slack 메시지에 flag ID가 아니라 outbox ID가 들어갑니다. 관리 화면에서 해당 신호를 찾기 어렵습니다.

---

## 검증 공백 (결함으로 판정하지 않음)

1. **RLS 및 DB 역할**
   - 0047/0048/0049는 FORCE RLS를 켭니다.
   - 0132만 `service_role` 정책을 만들고, 0133/0134는 정책이 없습니다.
   - PGlite 테스트는 superuser로 실행되므로 이 차이를 검증하지 못합니다.
   - 운영 앱의 DB 접속 역할이 BYPASSRLS인지 확인되지 않았습니다. BYPASSRLS가 아니면 기능 전체가 실패합니다.
2. **멤버십 범위**
   - `projectAccess`와 `seat`는 조직 단위 `brand_memberships`만 봅니다.
   - 캠페인 전용 게스트가 같은 테이블에 프로젝트 범위 행으로 저장된다면, 게스트가 조직 전체의 참여자 스레드와 결제 내역에 접근할 수 있습니다.
   - **이 경우 P1입니다.** 스키마를 확인해야 합니다.
3. **동시성 테스트가 실제 경합을 검증하지 않음**
   - `singleConnectionTransaction`(`lib/db/sql-runner.ts:99-127`)이 트랜잭션을 직렬화합니다.
   - 따라서 `Promise.all` 기반 "동시 수락"과 "동시 주문" 테스트는 실제 Postgres 행 락 경합이나 교착(P2-6)을 재현하지 못합니다.
   - pg 풀 기반 통합 테스트가 필요합니다.
4. **스토리지**
   - 업로드는 `putStaging`, 읽기는 `read("content", key)`입니다. 실제 드라이버에서 같은 객체를 가리키는지 확인되지 않았습니다(테스트는 mock).
   - staging 영역에 정리(GC) 작업이 있다면 참여자 파일이 사라질 수 있습니다.
5. **Toss 실제 동작**: 다음 동작은 실 API로 확인되지 않았습니다.
   - 미확정 결제의 retrieve 응답 상태
   - 4xx 거절 후 retrieve 상태
   - 가상계좌 노출 여부
   - idempotency key의 유효 범위
6. **개인정보 고지**: 참여자 대화를 로컬 워커로 보내 자동 위험 분석하지만, 참여 화면의 privacy 문구(`messages/campaign-collaboration.ts:26-27`)에는 이 내용이 없습니다. 법무 및 동의 게이트에서 다룰 항목입니다.
7. **미완료 검증**
   - 브라우저 어댑터가 없어 UI는 검증되지 않았습니다. 특히 Toss 위젯, return 흐름, 초대 링크 흐름이 그렇습니다.
   - 전체 테스트는 실행 중이므로 결과가 확정되지 않았습니다.
   - 문서는 통과 증거로 사용하지 않았습니다.

**확인된 양호 항목**
- 초대 토큰 해시 저장
- 수락 시 발급자 권한 재검증
- 금액 서버 고정과 불변 트리거
- 환불의 1회성 마커
- 위험 신호 원문 열람 감사와 오프셋만 저장하는 구조
- 워커 비밀값 상수시간 비교와 스트림 크기 제한
- 메시지와 근거 텍스트의 React 이스케이프
- 파일 매직바이트 검증과 `attachment` + `nosniff`
- 관리자 쓰기를 `/admin/do`로만 허용하는 경계