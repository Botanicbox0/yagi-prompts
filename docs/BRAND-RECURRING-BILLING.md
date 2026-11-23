# 브랜드 정기 결제 — 카드 자동결제와 계좌이체 (설계, 구현 전)

> 2026-11-23 대표 지시: "brand.twings.app에도 결제를 붙인다, 정기결제", "계좌이체를 선호할 수도 있으니 이 부분도 설계한 뒤 토스에 메일".
> 기준 코드: `main` `81a66f42`. 이 문서는 설계만 담는다. 코드·마이그레이션·환경변수·가격 표기는 바꾸지 않았다.
> 금액은 대표 결정 그대로다: 월 290,000 / 490,000 / 690,000원, **부가세 별도**(실결제 319,000 / 539,000 / 759,000원).
> 값이 "제안"이라고 적힌 곳과 §12는 대표가 정한다. "토스 확인 필요"는 공식 문서로 확인하지 못한 것이다(§13).

## 0. 추천안

1. **돈의 단위는 청구서 하나로 통일한다.** 이미 운영 중인 `brand_invoices`(정가 − 할인 + 부가세)를 그대로 쓰고, 고객사마다 **받는 방법**만 고른다: 카드 자동결제 또는 계좌이체. 카드는 "청구서가 발행되는 날 등록 카드로 자동 결제", 계좌이체는 "청구서에 적힌 입금 계좌로 기한 안에 입금"이다. 할인·일할·부가세 계산은 한 곳(`invoiceAmounts`)에서만 일어난다.
2. **계좌이체는 세 단계로 자동화한다.** ① 지금처럼 관리자가 입금을 확인(오늘 가능) → ② 청구서마다 가상계좌를 발급하고 입금 웹훅으로 자동 확인 → ③ 고객사마다 같은 계좌번호(고정식 가상계좌). ②와 ③은 토스 계약이 필요하고, 계약이 안 되거나 장애가 나면 ①로 떨어진다. 법인계좌에서 매달 자동으로 빼 가는 방식은 토스에 없다(§2.2).
3. **증빙은 수단에 따라 하나만.** 카드는 카드 매출전표, 계좌이체는 세금계산서. 한 거래에 둘을 같이 내지 않는다(§2.4).

이용 차단은 새 상태를 만들지 않고 지금 있는 규칙(`planActiveWithGrace` → `loadAllowance`)을 그대로 쓴다. 구독 엔진은 플랜의 `ends_on`만 움직인다(§5.3).

## 1. 지금 있는 것

| 영역 | 상태 | 위치 |
| --- | --- | --- |
| 플랜 3개 + 프로젝트 전용 | 기록만 한다(결제 아님). `billing_mode`에 `invoice`·`card` 값은 이미 있다 | `lib/brands/plans.ts`, `brand_plan_assignments` |
| 청구 장부 | `draft → issued → paid`, `draft·issued → void`. 조직·월당 유효 청구서 1장 | `lib/brands/billing/invoices.ts`, `brand_invoices`(0176) |
| 금액 | 일할 → 할인 → 부가세 10%, 전부 내림. DB 체크 제약이 같은 식을 강제 | `lib/brands/billing/math.ts` `invoiceAmounts` |
| 할인·코드 | 조직당 활성 1개, 청구 N회. 발행 때 1회 차감, 취소하면 복원 | `lib/brands/billing/discounts.ts` |
| 세금계산서 정보 | 상호·사업자등록번호(검증)·대표자·주소·수신 메일 | `brand_billing_profiles` |
| 유예 | 플랜 `ends_on` 뒤 `BRAND_PLAN_GRACE_DAYS`(기본 7일)까지 유효, 그 뒤 한도가 기본값(운영 0)으로 떨어져 생성이 닫힌다 | `lib/brand-studio/usage.ts` `loadAllowance` |
| 고객 화면 | 플랜·크레딧·할인·청구 내역(읽기 전용)·세금계산서 정보. **결제 화면 없음** | `/brand/billing` |
| 관리자 | `brandBilling.invoice.draft/issue/markPaid/void` 등 14개. **월 청구 자동 발행 없음**(손으로 초안) | `lib/admin/brand-billing-operations.ts` |
| 개인 구독 엔진 | 빌링키 발급·암호화·첫 결제·갱신·해지·환불. 테스트 키, 심사 계정만 | `lib/creator-subscriptions/*` |
| 가상계좌 | 코드에 입금 웹훅 처리 없음. 계약에서도 빠져 있다 | `docs/TOSS-CONTRACT.md` |
| 약관 | "정기결제가 아닙니다". B2B 약관 없음 | `lib/legal/documents.ts` |

## 2. 조사 결과 (2026-11-23, 공식 문서)

### 2.1 카드 자동결제

- 자동결제는 "리스크 검토 및 추가 계약 후" 쓸 수 있고, 정기 구독형이 아니면 제한된다. 결제 주기 실행은 상점이 직접 한다(토스가 스케줄을 돌려 주지 않는다). [자동결제 이해하기](https://docs.tosspayments.com/guides/v2/billing), [연동](https://docs.tosspayments.com/guides/v2/billing/integration)
- 수단은 국내 발급 신용·체크카드와 퀵계좌이체(개인 계좌). 카카오페이는 안 된다.
- 법인카드: 빌링키 발급 API가 사업자등록번호 10자리를 받고 응답에 `ownerType: 법인`이 있다. 다만 등록창(`requestBillingAuth`)에서 법인카드, 특히 무기명 카드를 등록할 수 있는지는 **토스 확인 필요**. [API 연동](https://docs.tosspayments.com/guides/v2/billing/integration-api)
- **토스 이용계약 제42조가 상점에 요구하는 것** — 화면과 약관이 이것을 지켜야 한다. [전자결제서비스 이용계약](https://pages.tosspayments.com/terms/onboarding/)
  - 가입 약관과 **따로** 자동결제 약관을 알리고 사전 동의를 받는다.
  - 금액이 바뀌거나 유료로 전환될 때는 **결제 7일 전까지** 금액·결제일·환불 조건·해지 방법을 알린다. → 할인 회차가 끝나 금액이 오르는 달도 여기에 해당한다(§5.2).
  - **영업시간 밖에도** 해지를 신청할 수 있어야 한다. → 화면에서 직접 해지.
  - 환불은 이용 일수·회차에 비례해야 하고, 자체 포인트로만 돌려주는 것은 안 된다. → 환불 문안의 하한(§12-4).
- 심사가 보는 화면 항목을 정리한 자동결제 전용 공식 체크리스트는 찾지 못했다(**토스 확인 필요**).

### 2.2 계좌 기반 수단

| 수단 | 정기 과금에 쓸 수 있나 | 근거 |
| --- | --- | --- |
| **가상계좌**(청구서마다 발급) | 된다. 고객이 매달 입금하고 웹훅으로 자동 확인 | 발급 `POST /v1/virtual-accounts`, 유효기간 최대 90일, 입금 시 `DEPOSIT_CALLBACK`. [웹훅](https://docs.tosspayments.com/reference/using-api/webhook-events), [용어](https://docs.tosspayments.com/resources/glossary/virtual-account) |
| **고정식 가상계좌**(고객사마다 같은 번호) | 된다. `accountKey`가 같으면 같은 계좌번호. 그래도 청구마다 발급 요청은 필요 | "리스크 검토 및 추가 계약 필요". 수수료·지원 은행은 **토스 확인 필요** |
| 계좌이체(퀵계좌이체·뱅크페이) | **법인계좌는 안 된다.** 자동결제는 개인 계좌만, 법인계좌(뱅크페이)는 매번 결제창 인증 | "뱅크페이(법인계좌)는 자동결제를 지원하지 않아요." [계좌이체](https://docs.tosspayments.com/resources/glossary/transfer-payment) |
| 출금 동의 자동이체(CMS) | 토스 상품으로 확인되지 않는다 | 서비스 소개의 "자금관리서비스"는 입출금 조회용. 제공 여부 **토스 확인 필요** |

가상계좌에서 알아 둘 것:

- 입금액은 주문 금액과 정확히 같아야 하고 나눠 낼 수 없다. 다른 금액이 은행 단계에서 거절되는지는 **토스 확인 필요**. [가상계좌 안내](https://www.tosspayments.com/blog/articles/30637)
- 입금 기한이 지나도 웹훅이 오지 않는다. 만료는 우리 쪽 작업이 처리한다. [가상계좌 웹훅](https://docs.tosspayments.com/blog/virtual-account-webhook)
- 입금 완료가 은행 사정으로 **되돌아갈 수 있다**(`DONE → WAITING_FOR_DEPOSIT`). "2분 지연 통보" 옵션이 있다(신청 방법 **토스 확인 필요**).
- 웹훅은 10초 안에 200을 받아야 하고, 실패하면 최대 7회 다시 온다. 본문의 `secret`을 발급 때 받은 값과 비교한다. [웹훅 가이드](https://docs.tosspayments.com/guides/v2/webhook)
- 입금 뒤 환불은 환불 계좌(`refundReceiveAccount`)가 필요하다. [결제 취소](https://docs.tosspayments.com/guides/v2/cancel-payment)

### 2.3 수수료 (청구서 한 장 기준)

| 실결제 | 카드 3.74%(현 단건 계약, 부가세 포함) | 가상계좌(공개 요금 건당 400원, 부가세 별도) |
| --- | --- | --- |
| 319,000원 | 11,931원 | 440원 |
| 539,000원 | 20,159원 | 440원 |
| 759,000원 | 28,387원 | 440원 |

카드 요율은 단건 계약(`twinkodj7p`) 값이다. 정기결제 MID의 요율과 가상계좌의 우리 계약 요율은 **토스 확인 필요**. 공개 요금: [수수료 안내](https://www.tosspayments.com/about/fee). 회사 계좌로 직접 받는 수동 입금은 수수료가 없다.

### 2.4 증빙

- 카드로 결제하면 카드 매출전표가 증빙이고, 세금계산서를 또 내면 이중 발급이다(부가가치세법 제33조 ②, [국세청 상담 사례](https://call.nts.go.kr/call/qna/selectQnaInfo.do?mi=1329&ctgId=CTG11945)).
- 토스는 상점의 고객에게 세금계산서를 발행해 주지 않는다. 우리가 홈택스 또는 발행 대행(팝빌·바로빌)으로 낸다.
- 가상계좌·계좌이체는 토스가 현금영수증을 자동 발급한다. 세금계산서를 내는 건은 발급 요청에서 현금영수증을 `미발행`으로 지정한다(요청 단위 지정이 문서에 있다, **토스 재확인**). [현금영수증](https://docs.tosspayments.com/resources/glossary/cash-receipt)
- 세금계산서 작성일(발행일 기준인지 입금일 기준인지)은 세무 대리인 확인이 필요하다.

### 2.5 참고한 구조 — Stripe Billing

가져오는 것만 적는다. [수금 방식](https://docs.stripe.com/billing/collection-method), [은행 송금](https://docs.stripe.com/invoicing/bank-transfer), [재시도](https://docs.stripe.com/billing/revenue-recovery/smart-retries), [고객 포털](https://docs.stripe.com/customer-management)

- 구독은 청구서를 만들고, 고객마다 `charge_automatically`(자동 청구) 또는 `send_invoice`(청구서 + 납기)를 고른다. → §0-1
- 고객마다 변하지 않는 입금 계좌 번호, 입금 자동 대사. → 고정식 가상계좌(§0-2 ③)
- 실패 재시도는 횟수와 기간이 정해져 있고, 카드 자체가 못 쓰는 상태면 새 카드가 등록될 때까지 재시도하지 않는다. → §5.4
- 고객이 결제 수단 변경·청구서 확인·납부·해지를 직접 한다. 실패 메일에서 그 화면으로 바로 간다. → §4.1

한국에 맞게 바꾼 것: 과소·초과 입금을 잔액으로 쌓는 방식은 쓰지 않는다(가상계좌는 금액이 맞아야 입금된다). 증빙을 수단별로 나눈다. 법인계좌 자동 출금이 없어서 계좌이체는 고객이 매달 입금하는 방식이다.

## 3. 구조

```
brand_subscriptions (조직당 1행: 플랜, 받는 방법, 상태, 해지 예약)
        │  매달: D-7 초안 + 예정 안내 → 1일 발행
        ▼
brand_invoices (지금 있는 장부. 금액은 invoiceAmounts)
        │  청구서 하나에 결제 시도 여러 번
        ▼
brand_invoice_payments (시도 1건 = 토스 주문 1건: 카드 승인 / 가상계좌 / 수동 입금)
        │  done 1건 → 청구서 paid → 플랜 ends_on = 그 달 말일
        ▼
brand_plan_assignments.ends_on  →  planActiveWithGrace  →  loadAllowance (지금 그대로)
```

- **주기는 달력 월**이다. 지금 장부가 `period = YYYY-MM`, 조직·월당 1장이고 첫 달 일할(`proposeProration`)이 있다. 매달 1일(KST) 그 달 이용료를 선불로 청구한다.
- **플랜 변경**: 올릴 때는 바로 적용하고 남은 일수의 차액을 추가 청구서로 낸다(같은 일할 식). 내릴 때는 다음 달부터 적용하고 환불하지 않는다(제안, §12-4와 함께 확정).
- 구독 행이 없는 조직(관리자가 손으로 플랜을 넣은 고객, 프로젝트 전용, 샌드박스)은 지금과 똑같이 동작한다.

## 4. 화면

### 4.1 고객 — `/brand/billing` (소유자·관리자만)

1. **플랜 선택.** 카드 3장: 월 290,000 / 490,000 / 690,000원 "(부가세 별도)", 그 아래 실제 결제 금액과 결제일("매월 1일, 첫 달은 남은 일수만큼"). 할인이 있으면 할인 후 금액과 남은 회차를 같이 보여 준다. 할인 코드는 여기서 먼저 넣는다.
2. **받는 방법 선택.** 두 칸: "카드 자동결제 — 매달 1일 등록 카드로 결제, 카드 매출전표" / "계좌이체 — 매달 청구서의 계좌로 입금, 세금계산서". 계좌이체를 고르면 세금계산서 정보(이미 있는 폼)가 필수다.
3. **동의.** B2B 이용약관과 **별도 칸**의 자동결제 동의(카드만). 금액·결제일·해지 방법·환불 기준을 동의 칸 바로 위에 적는다.
4. **카드 등록 또는 입금 안내.**
   - 카드: 토스 등록창 → 돌아오면 첫 청구서를 바로 결제 → 활성.
   - 계좌이체: 첫 청구서와 입금 계좌·금액·기한을 보여 주고 메일로도 보낸다. 입금이 확인되면 활성. 계약서로 먼저 시작한 고객은 관리자가 먼저 열어 줄 수 있다(§4.2).
5. **이후 같은 화면에서**: 다음 결제 예정(날짜·금액), 청구 내역과 증빙(매출전표 링크 / 세금계산서 발행 여부), 미납 청구서의 "지금 결제"·"입금 계좌 보기", 결제 수단 변경, 카드 교체, 플랜 변경, **해지**(확인 한 번, "○월 ○일까지 이용" 표시, 해지 취소 가능).

메일(문안은 대표 확정 뒤): 결제 예정 안내(D-7), 청구서 발행, 결제 완료, 카드 결제 실패(화면으로 가는 링크), 입금 기한 3일 전, 기한 경과, 생성 중단 예정·중단, 해지 접수.

화면 문구에는 내부 용어(MID, 빌링키, 웹훅, 가상계좌 발급 상태 이름)를 쓰지 않는다. 고객에게는 "입금 전용 계좌"라고 부른다.

### 4.2 관리자

- 조직 과금 패널: 구독 상태, 받는 방법, 다음 청구, 결제 시도 목록(실패 사유), 세금계산서 발행 기록(발행일·승인번호 입력).
- 오퍼레이션(전부 `lib/admin/operations.ts` 등록): 구독 시작(입금 전 먼저 열기), 받는 방법 변경, 카드 재결제, 입금 계좌 다시 발급, 수동 입금 확인(지금의 `invoice.markPaid`), 환불, 해지·해지 취소.
- **확인 필요 큐**: 금액 불일치, 이미 결제된 청구서에 들어온 입금, 입금 되돌림, 재시도 소진, 토스 상태와 우리 상태가 다른 건.
- 이번 달 수금 합계와 MID별 월 정산한도 대비(§7.2).

## 5. 상태와 실패 처리

### 5.1 상태

구독(`brand_subscriptions.status`):

```
pending ──첫 청구서 결제──▶ active ──미납(기한 경과)──▶ past_due ──유예 경과──▶ suspended
                              ▲                            │                      │
                              └──────────── 결제 확인 ─────┴──────────────────────┘
active / past_due / suspended ──해지 예약(cancel_at_period_end)·기간 종료──▶ ended
```

청구서는 지금 전이에 둘을 더한다: `paid → issued`(입금 되돌림 전용, 사유 기록)와 `paid → refunded`(전액 환불). 부분 환불은 청구서를 `paid`로 두고 환불 금액을 따로 기록한다.

결제 시도(`brand_invoice_payments.status`): `pending → charging → done | failed`(카드), `pending → waiting_deposit → done | expired | canceled`(가상계좌), `done → refunded`, 그리고 사람이 봐야 하는 `review`.

### 5.2 매달 일정 (제안값은 §12)

| 날 | 카드 자동결제 | 계좌이체 |
| --- | --- | --- |
| D-7 (전달 24~25일) | 다음 달 청구서 초안 + **결제 예정 안내 메일**(금액·결제일. 금액이 지난달과 다르면 그 이유) | 같은 초안 + 청구 예정 안내 |
| D0 (1일) | 발행 → 등록 카드 결제 → `paid` | 발행 → 입금 계좌 안내, 납기 = 발행일 + 입금 기한 |
| 실패·미납 | D+1, D+3, D+5 재시도. 분실·정지·해지처럼 다시 해도 안 되는 응답이면 재시도하지 않고 카드 교체를 요청 | 기한 3일 전·기한 당일·기한 다음 날 메일 |
| 유예 끝 | `suspended`: 새 생성이 닫힌다. 보기·내려받기·룸은 그대로 | 같다 |
| 결제 확인 | 즉시 `active`, 그 달 말일까지 | 같다 |

D-7 안내는 토스 계약 제42조(금액 변경 7일 전 고지)를 매달 지키는 가장 단순한 방법이다. 할인이 끝나는 달, 플랜이 바뀌는 달에도 따로 챙길 것이 없다.

### 5.3 차단은 `ends_on` 하나로

`planActiveWithGrace(plan, 오늘, 유예일수)`가 이미 "`ends_on` + 유예일까지 유효"를 판정하고, `loadAllowance`가 그 결과로 한도를 정한다. 구독 엔진은 구독이 있는 조직의 `ends_on`만 쓴다.

- 청구서가 `paid`가 되면 `ends_on = 그 달 말일`.
- 다음 달 청구서를 발행하면(아직 미납) `ends_on = 그 청구서의 납기일`. 그래서 "납기 + 유예"까지 이용이 이어진다. 카드의 납기일은 발행일이다.
- 그 뒤에도 미납이면 지금 규칙대로 한도가 기본값으로 떨어져 생성이 닫힌다.

검사 지점이 늘지 않고, 수동으로 관리하는 조직의 동작도 바뀌지 않는다. `docs/BRAND-PRODUCT.md` §6.4의 "연체는 스튜디오를 막지 않는다"는 수동 청구 기준이다. 구독 조직에서 미납이 생성을 닫는다는 점은 대표 결정이다(§12-2).

### 5.4 경우별 처리

| 경우 | 처리 |
| --- | --- |
| 카드 승인 실패 | 청구서는 `issued`로 남는다(취소하지 않으므로 할인 회차가 두 번 줄지 않는다). 시도 행만 `failed`. 재시도마다 새 시도 행 = 새 주문번호 |
| 카드 승인 응답 유실·시간 초과 | 재시도 전에 같은 주문을 토스에서 다시 조회한다(개인 구독 엔진의 방식). 결제됐으면 `done`으로 맞춘다 |
| 재시도 소진 | `past_due` 유지 + 확인 필요 큐. 고객은 화면에서 카드 교체 또는 **이번 청구서만 계좌이체로** 낼 수 있다 |
| 입금 기한 경과 | 가상계좌 유효기간을 "납기 + 유예"로 잡아 유예 중에도 입금된다. 만료는 우리 작업이 처리하고, 고객이 "입금 계좌 보기"를 누르면 새로 발급한다 |
| 부분 입금·초과 입금 | 가상계좌는 금액이 맞아야 입금된다(은행 단계 거절 여부 토스 확인 필요). 수동 입금에서 금액이 다르면 `paid`로 바꾸지 않고 확인 필요 큐로 보낸다. 잔액으로 쌓지 않는다 |
| 중복 결제·중복 입금 | 청구서당 `done` 시도는 1건만(부분 유니크 인덱스). 받는 방법을 바꾸거나 "지금 카드로 결제"를 누르면 열려 있는 가상계좌를 먼저 취소한 뒤 승인한다. 그래도 이미 `paid`인 청구서에 돈이 들어오면 자동으로 다음 달에 충당하지 않고 확인 필요 큐 → 환불 |
| 입금 되돌림(`DONE → WAITING_FOR_DEPOSIT`) | 청구서 `paid → issued`, `ends_on`을 납기일로 되돌리고 고객·관리자에게 알린다. 지연 통보 옵션을 쓸 수 있으면 켠다 |
| 웹훅 지연·중복·순서 뒤바뀜 | 웹훅 본문은 힌트로만 쓰고 토스에서 결제를 다시 조회해 상태를 정한다(지금 단건 웹훅과 같은 방식). `secret` 비교, 모든 전이는 조건부 UPDATE라 같은 웹훅이 여러 번 와도 결과가 같다. 웹훅이 끝내 안 오면 주기 작업이 `waiting_deposit` 건을 조회한다 |
| 결제 수단 변경 | 다음 청구서부터 적용. 열려 있는 청구서는 위 "중복" 규칙으로 한 경로만 살린다. 계좌이체 → 카드는 카드 등록과 자동결제 동의가 끝나야 바뀐다 |
| 카드 교체 | 새 빌링키 저장 후 이전 키는 폐기 대기열로(개인 구독의 `key_cleanup` 방식). 미납 청구서가 있으면 바로 재결제 |
| 해지 | `cancel_at_period_end`. 결제된 기간 끝까지 이용, 다음 청구서를 만들지 않는다. 기간이 끝나면 빌링키 폐기. 결제한 적이 없으면 바로 종료 |
| 플랜 올림 | 즉시 적용 + 차액 일할 추가 청구서(카드는 바로 결제, 계좌이체는 입금 안내) |
| 플랜 내림 | 다음 달 청구서부터 |
| 환불 | 기준은 §12-4. 카드는 승인 취소(부분 취소 가능), 가상계좌는 환불 계좌를 받아 취소. 환불 계좌는 저장하지 않고 토스로 넘기기만 한다. 세금계산서가 나간 건은 수정 세금계산서가 필요하다(관리자 체크 항목) |
| 할인 | 발행 때 1회 차감, 청구서 취소 때 복원 — 지금 그대로이고 두 수단에 똑같이 적용된다. 할인이 끝나 금액이 오르는 달은 D-7 안내에 이유가 적힌다 |

### 5.5 개인 구독 엔진에서 가져올 것과 새로 만들 것

| 가져온다 | 새로 만든다 |
| --- | --- |
| 빌링키 암호화(`crypto.ts`, AES-256-GCM, 환경·구독 id를 AAD로) | 조직 단위 구독 행과 권한(소유자·관리자, `requireBrandBillingSeat`) |
| 토스 빌링 클라이언트(`gateway.ts`): 발급·승인·조회·취소 | 청구서–결제 시도 모델(개인 쪽은 기간 행이 곧 주문) |
| 주문번호 = 행 UUID, 멱등 키(`…-charge-{id}`), 재시도 전 재조회 | 달력 월 주기와 D-7 초안·안내(개인 쪽은 가입일 기준 주기) |
| 승인 중 임대(lease)와 조건부 UPDATE | 가상계좌 발급·입금 웹훅·만료·되돌림·환불 계좌 |
| 쓰지 않는 빌링키 폐기 대기열 | 받는 방법 전환, "이번 청구서만 계좌이체" |
| 테스트/라이브 환경 분리(키 접두사), 출시 증빙 게이트 | 세금계산서 발행 기록, 미납 안내 메일 일정, 확인 필요 큐 |
| 준비 상태 판정(`availability`) 방식 | 브랜드 host 심사 로그인·심사 조직(§8) |

개인 엔진의 사용자 id 잠금, 편수 단위(units), 소비자 약관 버전, 이용 전 환불 규칙은 가져오지 않는다. 테이블도 공유하지 않는다.

**주기 작업 등록이 선행 조건이다.** 개인 구독 갱신 작업(`/api/creator-subscriptions/tick`)은 `vercel.json`에 없고 Cloudflare Worker는 배포되지 않았다. 브랜드 청구 작업은 `vercel.json`에 직접 등록한다(이미 있는 세 tick과 같은 방식, `CRON_SECRET`).

## 6. 스키마 초안

번호는 구현 시작 때 `origin/main`에서 다시 확인한다(지금 다음 빈 번호 0182, 0174·0175는 다른 브랜치 예약). 전부 RLS deny-all, service role만 쓴다(0177과 같은 방식).

```sql
-- NNNN_core_brand_subscriptions.sql (초안)
create table brand_subscriptions (
  organization_id uuid primary key references organizations(id),
  environment text not null check (environment in ('test','live')),
  status text not null check (status in ('pending','active','past_due','suspended','ended')),
  plan_id text not null,                     -- b2b_29 | b2b_49 | b2b_69
  pending_plan_id text,                      -- 다음 달부터 적용할 플랜(내림)
  collection_method text not null check (collection_method in ('card','transfer')),
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz, ended_at timestamptz,
  terms_version text not null, autopay_terms_version text,
  consented_by uuid not null, consented_at timestamptz not null,
  revision integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table brand_payment_methods (        -- 카드 빌링키. 조직·환경당 활성 1개
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, environment text not null,
  customer_key text not null unique,         -- 무작위 값. 조직 id를 쓰지 않는다
  billing_key_cipher text not null,
  card_company text, card_last4 text, owner_type text,
  status text not null check (status in ('active','replaced','revoked')),
  registered_by uuid not null, created_at timestamptz not null default now()
);
create unique index brand_payment_methods_one_active
  on brand_payment_methods (organization_id, environment) where status = 'active';

alter table brand_invoices
  add column kind text not null default 'subscription' check (kind in ('subscription','adjustment')),
  add column due_on date,
  add column collection_method text check (collection_method in ('card','transfer')),
  add column tax_invoice_issued_on date, add column tax_invoice_ref text,
  add column refunded_krw integer not null default 0;
-- status에 'refunded' 추가. 조직·월 유니크 인덱스는 kind = 'subscription'에만 걸리도록 다시 만든다.

create table brand_invoice_payments (       -- 시도 1건 = 토스 주문 1건 (id가 orderId)
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references brand_invoices(id),
  organization_id uuid not null, environment text not null,
  method text not null check (method in ('card','virtual_account','manual')),
  status text not null check (status in
    ('pending','charging','waiting_deposit','done','failed','expired','canceled','refunded','review')),
  amount_krw integer not null,               -- 청구서 total_krw와 같아야 한다
  attempt_no integer not null,
  payment_key text, failure_code text, receipt_url text,
  va_bank text, va_account_number text, va_due_at timestamptz, va_secret_hash text,
  lease_until timestamptz, refunded_krw integer not null default 0,
  created_at timestamptz not null default now(), settled_at timestamptz
);
create unique index brand_invoice_payments_one_done
  on brand_invoice_payments (invoice_id) where status = 'done';
create unique index brand_invoice_payments_one_open
  on brand_invoice_payments (invoice_id) where status in ('pending','charging','waiting_deposit');

create table brand_subscription_events (    -- 감사 기록(누가·언제·무엇을, 스냅샷 jsonb)
  id bigint generated always as identity primary key,
  organization_id uuid not null, action text not null, actor uuid,
  snapshot jsonb not null, created_at timestamptz not null default now()
);
```

고정식 가상계좌를 쓰게 되면 `brand_subscriptions`에 `account_key`(무작위 12자 이내)를 더한다. 사업자등록번호와 환불 계좌는 이 테이블들에 넣지 않는다.

## 7. 토스 계약

### 7.1 어느 계약으로 받나

| 수단 | 계약 | 상태 |
| --- | --- | --- |
| 카드 자동결제 | 정기결제 MID `bill_twinglnyl` | twings.app 개인 구독으로 심사 중. brand.twings.app과 B2B 금액대를 같이 받을 수 있는지 **토스 확인 필요**(같은 사업자의 MID 추가는 요청할 수 있다고 안내돼 있다. [MID 안내](https://www.tosspayments.com/blog/articles/35011)) |
| 가상계좌 | 단건 MID `twinkodj7p`에 수단 추가로 예상 | 지금 계약에서 빠져 있다. 추가 절차·요율 **토스 확인 필요** |
| 고정식 가상계좌 | 추가 계약 | 조건 **토스 확인 필요** |
| 수동 입금 | 계약 없음(회사 계좌) | 오늘 가능 |

코드는 "상점 프로필"(키 묶음 이름)로 게이트웨이를 고르게 만든다. 같은 MID를 쓰면 지금의 `TOSS_BILLING_*`를, 별도 MID가 나오면 새 이름의 키 묶음을 가리키면 되고 구조는 같다.

### 7.2 월 정산한도 1,000만 원이 뜻하는 숫자

정기결제 MID 기준(개인 구독 매출과 합산), 카드 자동결제 고객사만 셌을 때:

| 플랜 | 실결제 | 한도 안에 들어가는 고객사 수 |
| --- | --- | --- |
| 290,000원 | 319,000원 | 31곳 |
| 490,000원 | 539,000원 | 18곳 |
| 690,000원 | 759,000원 | 13곳 |

가상계좌는 단건 MID의 한도(개인 템플릿 결제와 합산)에 들어간다. 회사 계좌로 직접 받는 수동 입금은 한도와 무관하다. 한도 상향 문의는 보류 중이다.

## 8. 심사 준비

지금 없는 것:

| 필요한 것 | 지금 | 할 일 |
| --- | --- | --- |
| 브랜드 host 심사 로그인 | `/auth/review/login`은 개인 host에서만 열린다(다른 host는 404) | 브랜드 host에서 여는 심사 로그인. 전용 메일 패턴과 `app_metadata.purpose`를 개인 심사와 다른 값으로 |
| 심사 전용 조직 | 없음 | 조직 1개, 심사 계정이 소유자. 다른 고객 데이터 없음, 관리자 권한 없음, 샌드박스 아님. 테스트 키로만 결제된다 |
| 상품·금액·주기 표시 | 플랜은 "요청"만 가능, 금액 없음 | §4.1의 1~3번 화면 |
| 자동결제 별도 동의 | 없음 | 별도 칸 + B2B 자동결제 약관(§12-4) |
| 해지 경로 | 없음(문의로만) | 화면에서 직접 해지 |
| 환불 안내 | B2B 문서 없음 | B2B 약관·환불 기준 문서와 화면 요약 |
| 사업자 정보 표시 | 브랜드 워크스페이스 화면에서 확인하지 못했다 | 결제 화면 하단에 상호·대표·사업자등록번호·주소·연락처(개인 쪽과 같은 원본) |

심사 계정이 보는 순서: 로그인 → `/brand/billing` → 플랜 선택 → 카드 자동결제 → 동의 → 토스 테스트 등록창 → 결제 완료 → 해지. 개인 쪽 심사에서 쓴 "테스트 결제" 표시(PR #315)를 같은 방식으로 쓴다.

## 9. 플래그 (전부 기본 off)

| 플래그 | 켜면 |
| --- | --- |
| `BRAND_SUBSCRIPTIONS` | 고객이 `/brand/billing`에서 직접 구독을 시작할 수 있다. 꺼져 있으면 화면·API는 지금과 같다 |
| `BRAND_SUBSCRIPTION_QA` | 심사 조직과 관리자만 테스트 키로 결제 화면을 본다 |
| `BRAND_BILLING_AUTO_ISSUE` | 주기 작업이 구독 조직의 청구서를 D-7 초안·1일 발행한다 |
| `BRAND_BILLING_CARD` | 카드 자동결제 선택지와 승인 |
| `BRAND_BILLING_VIRTUAL_ACCOUNT` | 청구서별 입금 전용 계좌 발급과 웹훅 자동 확인. 꺼져 있으면 회사 계좌 안내 + 수동 확인 |
| `BRAND_BILLING_FIXED_ACCOUNT` | 고객사 고정 계좌번호 |

샌드박스 조직(`isSandboxedClientOrganization`)은 어떤 플래그에서도 이 화면과 API가 404다. 프로젝트 전용 조직은 구독 대상이 아니다.

## 10. 형식 검증 (AGENTS.md §11)

결제 상태 전이라 대상이다. TLA+/TLC 모델 두 개를 B1·B3·B4에서 만든다.

1. **청구서 × 결제 시도.** 사건: 발행, 카드 승인 성공·실패·응답 유실, 가상계좌 발급·입금·만료·취소·되돌림, 웹훅 중복·지연·순서 뒤바뀜, 받는 방법 전환, 수동 입금 확인, 환불. 불변 조건: 청구서가 `paid`이면 `done` 시도가 정확히 1건이고 금액이 같다 / `done`이 2건이 되는 경로가 없다 / `paid`·`void`·`refunded` 청구서에 새 승인이 나가지 않는다 / 할인 회차 사용 수 = 취소되지 않은 발행 청구서 수.
2. **이용 가능 기한.** 불변 조건: 생성이 닫히는 것은 가장 오래된 미납 청구서의 "납기 + 유예"가 지났을 때뿐이다 / 결제가 확인되면 다음 판정에서 반드시 열린다 / 해지 예약은 결제된 기간을 줄이지 않는다.

규칙은 이 문서 §5와 토스 계약 제42조에서 정의한다. 일부러 틀린 조건(예: 전환 때 가상계좌를 취소하지 않음)을 넣어 반례가 나오는지 확인한다. 이 PC에는 TLC가 설치되어 있지 않다. 설치 전에는 "미실행"으로 보고하고, 같은 불변 조건을 vitest 속성 테스트로 먼저 건다.

## 11. 구현 단계

각 단계는 플래그 뒤에서 혼자 배포할 수 있다. 검증은 AGENTS.md §3 루프 전부 + 아래.

| 단계 | 내용 | 플래그 | 선행 | 단계별 검증 |
| --- | --- | --- | --- | --- |
| B0 | 이 문서, 토스 회신, B2B 약관 초안(법무) | — | — | — |
| B1 | 스키마, 구독 상태 엔진(순수 함수), 청구서 `due_on`·`kind`, 주기 작업(D-7 초안·1일 발행·`ends_on` 갱신), 관리자 패널. 수금은 수동 확인 | `BRAND_BILLING_AUTO_ISSUE` | 마이그레이션 클라우드 적용 | 달력 경계(말일·윤년·첫 달 일할) 테스트, 같은 달 두 번 실행해도 청구서 1장, 모델 2 |
| B2 | 고객 화면: 플랜·받는 방법·동의·입금 안내·해지·플랜 변경, 안내 메일 | `BRAND_SUBSCRIPTIONS` | B1, 약관·문구 확정(§12-4) | 두 역할(소유자/멤버) 화면 확인, 샌드박스 404, 사전 키 테스트 |
| B3 | 카드: 등록창, 첫 결제, 재시도, 실패 메일, 카드 교체, 매출전표, 심사 로그인·심사 조직 | `BRAND_BILLING_CARD`, `BRAND_SUBSCRIPTION_QA` | 토스 회신(§13-1·2), B2 | 토스 테스트 키로 등록 → 승인 → 실패 재시도 → 해지, 응답 유실 재조회 테스트, 모델 1 |
| B4 | 가상계좌: 청구서별 발급, 입금 웹훅, 만료, 되돌림, 환불 계좌, "이번 청구서만 계좌이체" | `BRAND_BILLING_VIRTUAL_ACCOUNT` | 가상계좌 계약, B2 | 테스트 키 입금 시뮬레이션, 웹훅 중복·지연·순서 테스트, 모델 1 |
| B5 | 고정 계좌번호, 세금계산서 발행 대행 연동, 연 결제 | `BRAND_BILLING_FIXED_ACCOUNT` 외 | 계약·대표 결정 | — |

B3와 B4는 서로 기다리지 않는다. 토스 회신이 먼저 오는 쪽부터 한다. B1·B2만으로도 "매달 자동 청구 + 계좌이체(수동 확인)"가 돌아간다.

## 12. 대표 결정 (영향 큰 순)

1. **기본 결제 수단.** 화면에서 먼저 보여 주는 쪽. 제안: 계좌이체(세금계산서)를 기본으로, 카드는 선택지. 근거는 수수료(§2.3: 청구서당 440원 대 11,931~28,387원)와 법인 고객의 세금계산서 수요.
2. **계좌이체 입금 기한과 미납 처리.** 제안: 발행일 + 7일, 그 뒤 유예 7일(`BRAND_PLAN_GRACE_DAYS` 그대로), 유예가 끝나면 새 생성만 닫고 보기·내려받기는 유지. 첫 달은 입금 확인 뒤 시작할지, 신청 즉시 시작할지도 함께.
3. **카드 실패 정책 값.** 제안: 결제일 다음 날·3일 뒤·5일 뒤 재시도(총 4회), 유예 7일 뒤 생성 중단.
4. **B2B 구독 약관·해지·환불 문안.** 자동결제 별도 약관, 해지(기간 끝까지 이용), 환불 기준(토스 계약상 이용 일수 비례가 하한), 플랜 변경 규칙(올림 즉시·차액 일할, 내림 다음 달), 할인 중 해지 시 처리, 미납 시 공급 중단 조항. 현 약관의 "정기결제가 아닙니다"와 충돌하므로 B2B 문서를 따로 둔다. 문안은 대표·법무.
5. **연 결제 여부.** 할지, 한다면 할인율과 중도 해지 환불. 하면 한 건 금액이 커서 정산한도(§7.2)에 바로 닿는다.
6. **플랜별 기본 크레딧(숫자 3개).** 비어 있으면 결제해도 한도가 0이라 구독을 열 수 없다.
7. **세금계산서 발행 방식.** 홈택스 수기로 시작할지 발행 대행을 바로 붙일지, 작성일 기준(세무 대리인 확인).
8. **가격 공개 범위.** 금액이 `/brand/billing` 안에만 보일지, 공개 요금 페이지를 만들지(심사는 로그인 뒤 화면으로도 볼 수 있다).

## 13. 토스 확인 필요

1. `bill_twinglnyl`로 brand.twings.app 정기결제를 함께 받을 수 있는지, 필요한 절차(URL 추가·추가 심사·별도 MID).
2. 법인카드(기명·무기명)를 자동결제 카드로 등록할 수 있는지, 카드사별 제한.
3. 가상계좌를 `twinkodj7p`에 추가하는 절차와 요율, 고정식 가상계좌의 계약 조건·수수료.
4. 가상계좌에 다른 금액이 입금되면 은행 단계에서 거절되는지, 입금 취소 대비 지연 통보 신청 방법.
5. 세금계산서를 내는 건의 현금영수증을 요청 단위로 `미발행` 지정하면 되는지.
6. 법인계좌 출금 동의 자동이체(CMS) 제공 여부.
7. 자동결제 심사가 화면에서 확인하는 항목.

### 13.1 문의 문단 초안 (대표가 보내는 답장의 "3. 추가 문의")

발송과 문안 확정은 대표가 한다.

```text
3. 추가 문의

brand.twings.app은 twings.app과 같은 법인이 운영하는 기업 고객용 서비스입니다. 월 이용료는 29만 원, 49만 원, 69만 원(부가세 별도)이고, 카드 정기결제와 계좌 입금을 함께 받으려고 합니다. 아래 내용을 확인 부탁드립니다.

(1) 지금 심사 중인 정기결제 상점(bill_twinglnyl)으로 brand.twings.app의 정기결제도 함께 받을 수 있을까요? 가능하다면 URL 추가나 추가 심사처럼 필요한 절차를, 별도 상점이 필요하다면 그 절차를 알려 주세요.
(2) 기업 고객이 법인카드(기명·무기명)를 자동결제 카드로 등록할 수 있는지, 카드사별 제한이 있는지 궁금합니다.
(3) 계좌 입금은 매달 청구서마다 가상계좌를 발급하고 입금 통보로 확인하려고 합니다. 기존 일반결제 상점(twinkodj7p)에 가상계좌를 추가하면 되는지, 고객사마다 같은 계좌번호를 쓰는 고정식 가상계좌의 계약 조건과 수수료는 어떻게 되는지 알려 주세요.
(4) 가상계좌에 청구 금액과 다른 금액이 입금되면 은행에서 거절되는지, 입금 취소에 대비한 지연 통보는 어떻게 신청하는지도 알고 싶습니다.
(5) 기업 고객에게는 저희가 세금계산서를 직접 발행합니다. 이때 가상계좌 결제 건의 현금영수증은 발급 요청에서 '미발행'으로 지정하면 되는지 확인 부탁드립니다.
(6) 법인계좌에서 출금 동의를 받아 매달 자동으로 출금하는 상품이 있는지도 알려 주세요.
```

## 14. 확인하지 못한 것

- §13의 일곱 가지(토스 회신 전).
- 부가가치세법 시행령에서 "세금계산서를 발급하지 않는 사업자"의 범위를 정한 조문은 원문을 대조하지 못했다. 본문(제33조 ②)과 국세청 상담 사례로만 확인했다. 세무 대리인 확인을 권한다.
- 현금영수증을 발급한 거래에 세금계산서를 또 낼 수 있는지의 조문 원문. 그래서 세금계산서 건은 현금영수증 `미발행`으로 설계했다.
- 팝빌·바로빌의 건당 단가(공개 숫자 없음).
- 브랜드 워크스페이스 화면에 사업자 정보가 표시되는지는 코드 검색으로만 봤다(결과 없음). 화면을 열어 확인하지 않았다.
- 형식 검증 도구(TLC)는 이 PC에 없어 모델을 돌리지 않았다. 설계 단계라 모델도 아직 없다.
