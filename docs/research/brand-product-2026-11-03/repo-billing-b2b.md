# 결제·구독·조직 과금 구조 조사 — B2B 월 플랜(390,000·690,000·990,000원)의 전제

> 조사일 2026-11-03 · 저장소 `D:\dev\twings` main `119f4ea2` 읽기 전용 · 코드 수정 없음, npm·유료 API 호출 없음.
> 외부 사실은 공식 페이지를 직접 열어 확인했고(확인 날짜 2026-11-03), 1차 출처를 못 찾은 값은 **미확인**으로 표시했다.

## 0. 결론 먼저

1. **조직(브랜드) 단위 정기 과금은 지금 코드에 없다.** 운영 중인 돈 경로는 전부 1회 결제 3종(템플릿 `billing_payments`, 2차 활용 `brand_usage_payments`, 캠페인 펀딩 `campaign_funding_payments`)이고, 정기결제는 **개인** 크리에이터 구독(`creator_subscriptions`, 0042~0044)뿐인데 그마저 운영 DB에 **미적용**이다(`supabase/README.md` "미적용: 0042~0044").
2. **토스 자동결제(빌링) 계약 자체가 아직 없다.** 현재 계약은 단건 일반결제(임시 MID 2542, 라이브 키 미발급)이고, 빌링은 토스 문서상 "추가 리스크 검토 및 계약" 대상이다. B2B 카드 자동결제는 이 계약이 선행 조건이다.
3. **재사용할 것은 뼈대, 새로 만들 것은 장부.** `TossGateway`/`SubscriptionGateway` 시임, 빌링키 암호화(`lib/creator-subscriptions/crypto.ts`), claim→confirm→lease→reconcile 패턴, 웹훅 힌트 디스패처(`/api/billing/toss/webhook`가 이미 표 3개를 가른다), 관리자 오퍼레이션 레지스트리, 준비 증빙 게이트(`availability.ts`)는 그대로 쓴다. 조직 구독·기간·크레딧 원장·세금계산서 기록은 **새 테이블**이 필요하다(§3 초안).
4. **약관이 B2B 구독을 막는다.** 이용약관 제4조는 "템플릿 한 편당 한 번 결제, 정기결제가 아님, 충전식 재화·포인트·이용권 없음"이라 B2B 월 플랜·크레딧과 정면 충돌한다. 제4조의2(브랜드 캠페인 대금)는 "견적별 총액·세금 기준"만 정하고 정기·좌석·크레딧을 모르므로 **B2B 전용 조항(또는 별도 이용계약)**이 필요하다.
5. **세 플랜 금액의 부가세 기준부터 정해야 한다.** B2B 관행은 부가세 별도이고(세금계산서 공급가액 기준), 소비자 쪽 코드는 전부 부가세 포함 원화 고정가다. 390,000원이 공급가액이면 청구액은 429,000원이다. 이 결정 없이는 원가·마진·세금계산서·토스 청구 금액 어느 것도 확정되지 않는다.
6. **토스 월 정산한도 1,000만원이 B2B를 바로 막는다.** 990,000원 고객 10곳이면 한도다. 보증보험 담보 증액을 계약 단계에서 같이 협의해야 한다(`docs/TOSS-CONTRACT.md`).
7. **워크플로우가 전제한 "1크레딧≈129원"은 저장소에 없다.** 2026-11-02 대표 결정(PLATFORM-2.0 §19.2, `lib/twings/template-price.ts`)은 **1크레딧 = 부가세·수수료 뺀 순수입 10원**이고 마진은 템플릿에 들어간다. B2B 플랜 설계(`b2b-pricing-plans.md`)가 129원을 쓰면 다른 보고서와 숫자가 어긋난다.

---

## 1. 지금 있는 결제 수단·게이트웨이와 상태 머신

### 1.1 경로 한눈에

| 경로 | 테이블 | 게이트웨이 | 개방 조건 | 운영 상태 (2026-11-03) |
| --- | --- | --- | --- | --- |
| 템플릿 단건 (NORMAL) | `billing_payments` (0025, 0052) | `TossGateway` 결제위젯 v2 (`TOSS_CLIENT_KEY`/`TOSS_SECRET_KEY`, `*_gck_`/`*_gsk_` 쌍) | `RENDER_PIPELINE_PUBLIC=review|on` + 운영은 키 종류 일치(`lib/flags.ts renderPipelineMode`) | 운영 `review`(심사 계정만 결제). 라이브 키 미발급, 문서 예제 키라 `toss_docs_key` 경고. 0025·0052 운영 적용됨 |
| 2차 활용 라이선스 | `brand_usage_payments` 외 12개 `brand_usage_*` (0037/0123) | 같은 `TossGateway` 재사용, 별도 서비스 | `BRAND_USAGE_PAYMENTS=on` + 운영은 라이브 키 | 기본 **꺼짐**. 0037/0123 운영 적용(2026-09-24) |
| 캠페인 펀딩(서비스 대금) | `campaign_funding_*` (0049/0134) | 같은 `TossGateway`; 위젯은 `CARD`·`TOSSPAY`만 허용(`fundingWidgetMethodSupported`) | `CAMPAIGN_FUNDING_PUBLIC=on` + `CAMPAIGN_FUNDING_POLICY_READY=on` | 기본 꺼짐. 운영 적용(2026-10-15) |
| 개인 월 구독(크리에이터/프리미엄) | `creator_subscriptions`, `_periods`, `_usage`, `_key_cleanup`, `_launch_evidence` (0042~0044/0127/0129) | `SubscriptionGateway`(API 키 `TOSS_BILLING_CLIENT_KEY`/`SECRET_KEY`, `test_ck_`/`live_ck_`), 빌링키 AES-256-GCM(`TOSS_BILLING_ENCRYPTION_KEY`) | `CREATOR_SUBSCRIPTION_PUBLIC=on` + 운영 + 라이브 빌링 키 + 증빙 10단계 전부 통과(`evaluateSubscriptionAvailability`) | **미적용**(0042~0044 운영 DB에 없음). 플랜 버전 `creator-2026-10-09-v1`(24,900원/604·49,000원/1,200 units) |
| Stripe 월 $9 구독(옛) | `subscriptions`(0002), `stripe_events` | `lib/billing/stripe-*` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`) | 키 없으면 503 | **휴면**: `/api/billing/checkout`는 410 `subscription_retired`, `/api/stripe/webhook`·`/api/billing/portal`은 남아 있음. `isEntitled`는 `lib/auth/identity.ts`·`viewer.ts`에서 아직 'pro' 티어 판정에 쓰인다 |

토스 자동결제 상태: `docs/TOSS-CONTRACT.md` "자동결제(빌링)는 이 화면에 없다. 월 구독을 열려면 별도 신청·계약이 필요한지 확인해야 한다". 토스 공식 문서는 "자동결제는 리스크 검토 및 추가 계약 후 사용", "정기 구독형 서비스가 아니라면 정책적으로 제한"이라고 명시한다(https://docs.tosspayments.com/guides/v2/billing, 2026-11-03 확인). 즉 **별도 계약이 맞다**.

### 1.2 상태 머신

**템플릿 단건 `billing_payments.status`** (`lib/billing/toss-service.ts`):
`pending → confirming → paid → (렌더 이행, fulfilled_at)`; 실패 시 `failed` + `failure_code ∈ {declined, price_changed, not_open, expired, canceled, aborted, unknown_payment, provider_mismatch, partial_balance, refund_manual, fulfil_manual}`; 환불 `refund_pending → refunded`. `declined|aborted|unknown_payment`만 "다시 결제하기"(`retried_by`) 허용. 자동 복구 상한 `TOSS_RETRY_CAP=10`, 패스당 `TOSS_RECONCILE_BATCH=50`, 웹훅 속도 제한 30건/발신자/분·120건 전체. 동의 버전 `refund-2026-09-14-section-2`. `payment_type='BILLING'`은 컬럼·제약만 예약돼 있고 **쓰는 코드가 없다**(0025 주석 "No BILLING writer is shipped here").

**개인 구독 `creator_subscriptions.status`** (`lib/creator-subscriptions/service.ts`):
`awaiting_auth(30분) → authorizing(authKey 지문·리스) → active ⇄ past_due → ended`; 환불 `refund_pending → refunded`. 기간 `creator_subscription_periods.status`: `pending → charging → paid | failed(charge_exhausted_review, provider_review_required …) → refund_pending → refunded`, 월 경계는 **원 앵커 기준 한국 달력월**(`billingBoundary`). 사용량 `creator_subscription_usage.state`: `reserved → consumed | released`, CHECK `reserved + consumed ≤ monthly_units`. 갱신은 `processSubscriptionRenewals` + `/api/creator-subscriptions/tick`(`CRON_SECRET`)인데 **`vercel.json` crons에는 `/api/renders/tick`·`/api/brands/inquiries/tick`만 있다** — 구독 갱신 스케줄은 등록돼 있지 않다(문서상 Cloudflare Worker도 "적용된 것으로 간주하지 않음").

**2차 활용 `brand_usage_payments`**: `pending → confirming → paid → (활성화 가드) fulfilled | blocked_after_payment`; `failed`, `review`(PARTIAL_CANCELED·입금 대기·잔액 불일치), `refund_pending → refunded`(관리자 `brandUsage.resolve`만, 자동 환불 없음). 온라인 결제는 `tax_basis='included'`인 견적만.

**캠페인 펀딩 `campaign_funding_payments`**: `pending → confirming → awaiting_deposit → paid → review → refund_pending → refunded`, `failed`, `expired`. **유일하게 `WAITING_FOR_DEPOSIT`(가상계좌 입금 대기)을 상태로 받는 경로**다(`lib/campaigns/funding/payment.ts:156`, 테스트 "supports asynchronous deposit receipts"). 단, 위젯에서는 카드·토스페이만 고를 수 있어 실제 가상계좌 발급은 일어나지 않는다. 견적 총액·`tax_basis`는 **문자열 자유 입력**(`taxBasis: z.string().min(1).max(1000)`)이라 세율 계산이 없다.

### 1.3 공통 안전장치(재사용 대상)

- 금액은 서버 저장가만, 브라우저 금액은 일치 검사(모든 경로).
- 멱등: 같은 `request_id`/`idempotencyKey` → 같은 결과; 주문당 살아 있는 결제 1개(부분 유니크 인덱스).
- 불확실 승인은 `confirming` + 리스, 복구는 조회(retrieve) 먼저, `IN_PROGRESS`일 때만 같은 멱등 키 재승인.
- 웹훅은 힌트: `/api/billing/toss/webhook`가 `billing_payments → brand_usage_payments → campaign_funding_payments` 순으로 주문을 찾아 제공사를 다시 읽는다(`tests/routes/toss-payment-routes.test.ts`). 네 번째 표를 붙이면 된다.
- 준비 증빙: `creator_subscription_launch_evidence`(10단계 + premium_editing) × 플랜·릴리스·약관 버전 × 구현 SHA × 설정 다이제스트가 전부 맞아야 `open`.

---

## 2. 구독 엔티티·크레딧 원장 — 있는 것과 없는 것

### 2.1 있는 원장 3개

| 원장 | 단위 | 소유 | 쓰는 코드 | B2B에서 재사용 가능한 부분 |
| --- | --- | --- | --- | --- |
| `creator_subscription_usage` | 내부 units(100 = Seedance 2.5 10초 720p) | 개인 `user_id` + `period_id` | `lib/creator-subscriptions/usage.ts` `reserveSubscriptionUsage/settleSubscriptionUsage`, 호출은 `lib/renders/service.ts:291, 858~934` | **예약→확정/해제 3상태, 기간 행 잠금, CHECK로 초과 차단** — 구조 그대로 조직 원장에 복제 |
| `platform_credit_ledger` | 이미지 보상 크레딧(delta) | 개인 `user_id` | `lib/creator-platform/{admin,rewards,service}.ts`, kind `grant/reserve/release/revoke`, `event_key unique` | **event_key 멱등 + sum(delta) 잔액** 패턴. 조직 원장도 같은 방식이 맞다 |
| `platform_settlements` | 판매 1건 = 1행 (revenue/tax/fees/provider_cost/fx/margin/creator_due) | `render_id` + `billing_payments.payment_id` | `lib/creator-platform/admin.ts settle`, `marginSplit` 80/20, `payout='company'`면 0 | 원가·세금·수수료를 **건별로 적는 증빙 모델**. B2B 원가 추적(엔진별 실사용 USD × 환율)에 같은 열을 쓴다 |

`platform_reward_policy.cost_per_credit`(보상 크레딧 단가)와 `lib/twings/template-price.ts`의 `CREDIT_NET_KRW = 10`은 서로 다른 크레딧이다. B2B 크레딧은 §19.2의 "순수입 10원" 정의를 따르는 것이 일관된다.

### 2.2 조직 모델

`brand_organizations(id, name, created_by, request_id, studio_managed)`, `brand_memberships(organization_id, user_id, role owner|editor|viewer, status active|revoked)`. **slug·플랜·좌석·과금 컬럼은 없다.** 결제 권한은 2차 활용에서 `brand_usage_buyers`(스튜디오가 편집자를 근거와 함께 등록, 멤버십 해제 시 트리거로 철회)로 풀었다 — B2B 결제 담당자도 이 패턴을 쓴다.

### 2.3 개인 구독과 분리해야 하는 이유

| 항목 | `creator_subscriptions` | B2B 조직 구독 |
| --- | --- | --- |
| 소유 | `user_id` 1명, 환경당 열린 구독 1개 | `organization_id`, 멤버 여럿이 소비 |
| 금액 | 플랜 enum `creator|premium` 고정, 부가세 **포함** | 3단 + 협상 가능, 부가세 **별도** 관행, 공급가액·세액 분리 |
| 결제 수단 | 카드 빌링키만 | 카드 빌링 **또는** 세금계산서 후불(계좌이체·가상계좌) |
| 사용량 | units(영상 전용), 미이월 | 크레딧(이미지·영상·마감 단계), 이월·초과분·좌석 |
| 약관 | `creator-subscription-2026-10-14-v2` 초안(B2C 청약철회 문안) | 사업자 간 계약, 전자상거래법 적용 제외(§4.2) |
| 증빙 | 소비자 자동결제 심사 증빙 | 계약서·세금계산서·입금 확인 |

같은 표를 쓰면 `plan_id` CHECK, `unique(user_id, environment)`, `premium_edit_limit`, 승인 증빙 단계까지 전부 깨진다. **새 표가 맞다.** 공유하는 것은 게이트웨이·암호화·패턴뿐이다.

---

## 3. 제안 스키마 초안 (core/glue 규약)

번호는 `supabase/README.md` "다음 번호"를 적용 직전에 다시 확인한다(README에는 "core 0072"로 적혀 있는데 0073이 이미 적용돼 있어 낡은 줄일 수 있다). 모든 표는 `enable/force row level security`, 브라우저 역할 권한 없음, `service_role`만 select/insert + 상태성 컬럼 update(0123·0127 glue와 같은 자세).

```sql
-- NNNN_core_brand_billing.sql (초안, 적용 전 대표 결정 §7 반영)
create table brand_subscriptions (
  id uuid primary key,
  organization_id uuid not null references brand_organizations(id),
  environment text not null check (environment in ('test','live')),
  plan_code text not null,                       -- 'b2b-390' | 'b2b-690' | 'b2b-990' (값은 대표 결정)
  plan_version text not null,                    -- 계약 당시 값 고정: 원가 모델이 바뀌어도 청구 불변
  supply_krw integer not null check (supply_krw > 0),   -- 공급가액
  vat_krw integer not null check (vat_krw >= 0),        -- 세액 (별도/포함은 대표 결정, 둘 다 적는다)
  billing_method text not null check (billing_method in ('card_billing','invoice_transfer')),
  monthly_credits integer not null check (monthly_credits > 0),
  rollover_cap integer not null default 0,       -- §19.2 "1달치, 잔액 상한 2배"를 B2B에 쓸지는 결정 항목
  seats_included integer not null check (seats_included > 0),
  customer_key text unique,                      -- card_billing만
  billing_key_ciphertext text,                   -- AES-256-GCM, creator-subscriptions/crypto.ts 재사용
  auth_fingerprint text, auth_lease_until timestamptz,
  status text not null default 'draft' check (status in
    ('draft','awaiting_auth','authorizing','active','past_due','suspended','ended','refund_pending','refunded')),
  cancel_at_period_end boolean not null default false,
  anchor_at timestamptz, current_period_index integer not null default -1,
  next_billing_at timestamptz,
  contract_ref text,                             -- 계약서 PDF·버전 (brand_project_contracts 참조 가능)
  consent_version text, consent_at timestamptz, consented_by uuid references profiles(id),
  created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (created_by, request_id),
  check (billing_method <> 'card_billing' or customer_key is not null)
);
create unique index brand_subscriptions_one_open_per_org
  on brand_subscriptions(organization_id, environment) where status not in ('ended','refunded');

create table brand_subscription_periods (
  id uuid primary key,
  subscription_id uuid not null references brand_subscriptions(id),
  period_index integer not null check (period_index >= 0),
  environment text not null check (environment in ('test','live')),
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  supply_krw integer not null, vat_krw integer not null, total_krw integer not null,
  monthly_credits integer not null, rollover_credits integer not null default 0,
  status text not null default 'pending' check (status in
    ('pending','charging','paid','invoiced','awaiting_deposit','overdue','failed','refund_pending','refunded')),
  payment_key text unique,                       -- 카드 빌링 승인 키
  deposit_due_at timestamptz,                    -- 후불: 입금 기한
  lease_until timestamptz, attempts integer not null default 0, failure_code text,
  paid_at timestamptz, refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, period_index)
);

-- 조직 크레딧 원장: platform_credit_ledger의 event_key 멱등 + creator_subscription_usage의 예약/확정/해제
create table brand_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id),
  period_id uuid references brand_subscription_periods(id),
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('grant','rollover','reserve','consume','release','expire','overage','adjust')),
  job_ref uuid,                                  -- render_jobs / 브랜드 작업 id (렌더 파이프라인과 FK는 다음 단계)
  actor_id uuid references profiles(id),
  event_key text unique not null,                -- 'reserve:<job>' 'consume:<job>' 'grant:<period>'
  reason text,
  created_at timestamptz not null default now()
);
create index brand_credit_ledger_org on brand_credit_ledger(organization_id, created_at desc);

-- 세금계산서·청구서 기록 (발행 자체는 팝빌/바로빌 API 또는 홈택스 수기)
create table brand_invoices (
  id uuid primary key,
  organization_id uuid not null references brand_organizations(id),
  period_id uuid references brand_subscription_periods(id),
  kind text not null check (kind in ('tax_invoice','receipt','credit_note')),
  supply_krw integer not null, vat_krw integer not null, total_krw integer not null,
  provider text not null check (provider in ('popbill','barobill','manual')),
  provider_ref text,                             -- 국세청 승인번호 / 관리번호
  status text not null default 'draft' check (status in ('draft','issued','sent','cancelled')),
  issued_at timestamptz, created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), unique (created_by, request_id)
);

-- 결제 담당자: brand_usage_buyers와 같은 모델(좌석에 묶임, 멤버십 해제 시 트리거 철회)
create table brand_billing_contacts (
  organization_id uuid not null references brand_organizations(id),
  user_id uuid not null references profiles(id),
  role text not null check (role in ('payer','invoice_recipient')),
  business_registration_no text,                 -- 세금계산서용 사업자번호 (암호화·마스킹은 결정 항목)
  evidence text not null, granted_by uuid not null references profiles(id),
  status text not null default 'active' check (status in ('active','revoked')),
  revoked_reason text, created_at timestamptz not null default now(),
  primary key (organization_id, user_id, role)
);

create table brand_billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id),
  subscription_id uuid references brand_subscriptions(id), period_id uuid references brand_subscription_periods(id),
  kind text not null, actor_id uuid references profiles(id), reason text,
  created_at timestamptz not null default now()
);
```

서비스 모듈 제안: `lib/brands/billing/{plans,gateway-adapter,service,periods,credits,invoices,reconcile,runtime}.ts`. `SubscriptionGateway`(issue/charge/retrieveOrder/cancel/revokeBillingKey)는 `lib/creator-subscriptions/gateway.ts`에서 **그대로 import**한다. 조직 기능 차단(`brandFeatureAllowed`)은 `repo-brand-surface.md`의 `lib/brands/entitlements.ts` 제안과 같은 함수를 부르고, 플랜은 그 함수의 입력 중 하나가 된다.

---

## 4. 한국 B2B 결제 경로 비교

### 4.1 사실 확인 (2026-11-03)

| 사실 | 값 | 출처 |
| --- | --- | --- |
| 토스 자동결제 전제 | "리스크 검토 및 추가 계약 후 사용", 정기 구독형 아니면 제한 | https://docs.tosspayments.com/guides/v2/billing |
| 자동결제 결제수단 | 신용·체크카드, 계좌이체 2가지. 간편결제는 네이버페이·토스페이만(별도 심사), 카카오페이 불가 | 같은 페이지 |
| 스케줄링 | 토스가 제공하지 않음, 상점이 직접 주기 호출(`POST /v1/billing/{billingKey}`, 승인 최대 60초) | https://docs.tosspayments.com/guides/v2/billing/integration , https://docs.tosspayments.com/reference |
| 빌링키 발급 | `POST /v1/billing/authorizations/issue`(authKey + customerKey 22~50자) | https://docs.tosspayments.com/reference |
| 가상계좌 | 승인 시 계좌만 발급, 입금 시점 불명 → **웹훅 필수**; `validHours` 기본 168h, 최대 2,160h(90일) | https://docs.tosspayments.com/guides/v2/get-started/payment-methods , reference |
| 계좌이체 | 환불 180일, 현금영수증 당일 자동 신청, 최소 200원·1일 최대 1,000만원 | payment-methods 페이지 |
| 우리 계약 수수료 | 카드 3.74%(부가세 포함, 실질 3.4%), 계좌이체 2.2%·최소 220원, 월 정산한도 1,000만원(보증보험 담보 1,000만원), 정산 D+4영업일 | `docs/TOSS-CONTRACT.md` (계약 화면 전사) |
| 전자상거래법 적용 범위 | 제3조①: 사업자가 **상행위를 목적으로 구입하는 거래에는 적용하지 아니한다**(단, 사실상 소비자 지위면 적용) | 위키문헌 사본 https://ko.wikisource.org/wiki/대한민국_전자상거래_등에서의_소비자보호에_관한_법률 — **law.go.kr 원문 조문 재확인 필요** |
| 현행 법령 버전 | 시행 2026-07-21, 법률 제21312호(2026-01-20 일부개정); 제17조②5 디지털콘텐츠 제공 개시 후 청약철회 제한, ③ 표시·광고와 다르면 3개월/30일 | https://law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsId=009318&lsJoLnkSeq=1000527255&print=print |
| 가격표시제 실시요령 | 산업통상자원부고시 제2025-51호, 시행 2025-04-07 — **부가세 포함 총액 표시 조항 본문은 미확인**(페이지가 스크립트 렌더) | https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulId=33397&efYd=0 |
| 팝빌 세금계산서 API | 연동신청 → API Key → 무료 테스트 → 계약; 포인트 충전식, "발행 단가 확인" API 있음. **건당 단가 공개 안 됨(미확인; 비공식 중개 페이지는 100원/건 부가세 별도)** | https://www.popbill.com/Taxinvoice/API , https://www.linkhub.co.kr/api/taxinvoice |
| 바로빌 세금계산서 API | 연동비·유지관리비 무료, 표준형 구간별 발급단가, 대량형 월 5만 건↑, 개발 기간 무료. **단가표 숫자 미확인** | https://dev.barobill.co.kr/partners/cost/partner |
| 카드 결제 건에 세금계산서 중복 발행 불가 | 통설(신용카드 매출전표가 증빙) — **부가가치세법 조문 미확인** | — |

### 4.2 경로 비교

| | A. 카드 자동결제(토스 빌링) | B. 세금계산서 후불(계좌이체·가상계좌) | C. 둘 다 |
| --- | --- | --- | --- |
| 필요한 코드 | `brand_subscriptions`(card_billing) + 기간 생성·청구 스케줄러(cron 등록 **필수**, 지금 vercel.json에 없음) + `SubscriptionGateway` 재사용 + 웹훅 4번째 디스패치 | `brand_subscription_periods.status='invoiced|awaiting_deposit|overdue'` + 가상계좌 발급(`POST /v1/virtual-accounts`) 또는 수동 입금 확인 오퍼레이션 + `brand_invoices` + 팝빌/바로빌 어댑터(또는 홈택스 수기) + 입금 웹훅 처리(지금 없음, TOSS-CONTRACT "가상계좌 다시 켜면 안 된다") | A+B, `billing_method`로 분기 |
| 운영 절차 | 토스 자동결제 추가 계약·심사(별도), 라이브 빌링 키(`live_ck_`) 발급·Vercel 등록, 실패 시 past_due 안내·재시도 | 월초 세금계산서 발행 → 기한 내 입금 확인 → 미입금 시 suspended, 사업자번호·담당자 수집, 세무 대리인과 발행 주체 합의 | 양쪽 |
| 수수료 | 카드 3.4% 실질(법인카드 자동결제 가능 여부 **미확인**) | 계좌이체 2.2%(토스 경유) 또는 직접 입금 0% + 세금계산서 발행비(미확인, 건당 수백 원 수준) | — |
| 증빙 | 카드 매출전표(세금계산서 중복 발행 불가 통설) | 세금계산서 = 고객 매입세액 공제 증빙. **한국 법인 고객 대부분이 요구** | — |
| 약관 | 제4조 개정 또는 B2B 조항 신설(정기결제·크레딧·해지) | 같은 + 지급 기한·연체·공급 중단 조항 | — |
| 현 약관 충돌 | 제4조①②("정기결제가 아님", "포인트·이용권 없음") | 제4조의2③("결제 완료 = 입금 확인")은 그대로 쓸 수 있음 | — |
| 부가세 표기 | 소비자형 화면이면 포함 총액; B2B 전용 화면이면 "부가세 별도" 명시 | 공급가액·세액 분리 필수 | — |
| 추천 | 셀프서브 최소 플랜용 | 690,000·990,000 및 연 계약용 | **C** — 최소 플랜은 A, 상위 플랜·연 계약은 B. 첫 분기는 B를 수동(홈택스 + 관리자 '입금 확인' 오퍼레이션)으로 시작해도 코드가 덜 든다 |

부가세 표기 관례: B2B 계약·견적은 공급가액 + "부가세 별도"가 일반이고, 2차 활용 코드도 `tax_basis in ('included','excluded')`에 `messages/ko.ts`의 "부가세 포함/부가세 별도" 라벨이 있다. 소비자 대상 표시는 총액 표시가 원칙이다(가격표시제 조문은 미확인). 따라서 **brand.twings.app의 요금 문구는 "월 390,000원(부가세 별도)"처럼 기준을 반드시 적는다**.

---

## 5. 크레딧 차감·초과·이월·좌석 — 재사용할 코드와 테스트

| 규칙 | 재사용 | 새로 만들 것 | 받쳐 주는 기존 테스트 |
| --- | --- | --- | --- |
| 차감(예약→확정/해제) | `reserveSubscriptionUsage/settleSubscriptionUsage` 구조, `lib/renders/service.ts`의 호출 지점 3곳(생성·성공·실패) | 조직 원장 버전(`brand_credit_ledger`), 엔진별 크레딧 산정은 `templateCredits`(`lib/twings/credits.ts`) + `baseCredits` 재사용 | `tests/creator-subscriptions/service.test.ts` "prevents overspend, duplicate reservation and double release", "serializes concurrent reservations…", "settled consumption cannot be undone…" |
| 멱등 | `platform_credit_ledger.event_key unique` + `on conflict do nothing` | — | `tests/creator-platform/*`(보상 원장) |
| 월 경계 | `billingBoundary`/`currentBillingIndex`(KST 달력월, 앵커 고정) | — | `tests/creator-subscriptions/periods.test.ts`, "renews only once per original-anchor month" |
| 이월 | **없음**(개인 구독은 미이월; §19.2 앱 플랜은 1달·2배 상한) | `kind='rollover'` + `rollover_cap` | 없음 → 새 테스트 |
| 초과분 과금 | **없음** | `kind='overage'` 사전 승인(자동 청구 금지, 다음 세금계산서에 합산) | 없음 |
| 좌석 | `brand_memberships` + `brand_usage_buyers` 트리거 패턴 | 초대 시 `seats_included` 검사(서버 액션·관리자 오퍼레이션 양쪽), 좌석 초과 시 안내 | `tests/brands/usage.test.ts` "a viewer cannot be made a buyer, and a revoked member loses buyer authority" |
| 원가 증빙 | `platform_settlements` 열 구성, `marginSplit` | 조직 월별 원가 집계(실사용 USD × 환율) | `tests/twings/credits.test.ts`, `subscription-plan.test.ts` |
| 준비 게이트 | `evaluateSubscriptionAvailability` 패턴(증빙 × 버전 × SHA) | B2B용 단계: contract, invoice, terms, charge, deposit, suspend, refund | `tests/creator-subscriptions/availability*.test.ts`, `readiness-probes.test.ts` |
| 웹훅 | `/api/billing/toss/webhook` 디스패치 | 4번째 표 + `DEPOSIT` 이벤트 처리 | `tests/routes/toss-payment-routes.test.ts` "settles a campaign-funding receipt neither other table knows…" |

**크레딧 단위 정의의 충돌**: 이 워크플로우의 `b2b-pricing-plans` 프롬프트는 "1크레딧≈이미지 1장≈129원"을 전제하지만 저장소는 2026-11-02부터 "1크레딧 = 순수입 10원, 이미지 = 원가×1.12, 영상 = 원가/(1−0.06)"이다(`lib/twings/template-price.ts`, PLATFORM-2.0 §19.2 표: Seedream 5.0 Pro 5장 = 71크레딧, Seedance 2.5 10초 720p = 345크레딧). B2B 플랜을 크레딧으로 팔려면 **같은 10원 정의**를 쓰고, 390,000원(부가세 별도)의 순수입은 결제 수단별로 달라진다(카드 3.4% 차감 ≈ 376,740원 → 약 37,600크레딧; 계좌 직접 입금이면 390,000원 → 39,000크레딧). 숫자는 제안이며 대표 결정이다.

---

## 6. 약관·환불 — 현 조항과 B2B 충돌표

| 현 조항 (`lib/legal/documents.ts`, 효력 2026-11-02) | 내용 | B2B 구독과의 충돌 |
| --- | --- | --- |
| 이용약관 제4조① | "템플릿 한 편당 한 번 결제 … **정기결제가 아닙니다**" | 월 플랜은 정기결제 → 개정 또는 B2B 조항 신설 |
| 제4조② | "충전식 재화, 포인트, 이용권이 없습니다" | 크레딧·좌석 → §19.2처럼 "구독에 포함된 월 이용 한도"로 정의하는 문안 필요 |
| 제4조의2 | 브랜드 캠페인 대금: 견적별 총액·세금 기준·환불 조건, 결제 완료 = 입금 확인, 전액 환불 가능한 계약 우선 수납 | 후불·입금 확인 모델은 재사용 가능. 정기·좌석·크레딧·기능 차단은 없음 |
| 환불정책 §2 | 전자상거래법 제17조 7일 청약철회, 디지털콘텐츠 개시 후 제한 | B2B는 제3조①로 적용 제외 가능하지만 약관규제법은 적용. 계약서에 "사업자 간 거래로 청약철회 규정이 적용되지 않는다"와 자체 환불 기준(미사용 기간 일할 등)을 명시 |
| 환불정책 §8 | 브랜드 캠페인 대금 환불은 견적 조건 + 법령 | 구독 환불(중도 해지·미사용 크레딧)은 미규정 |
| 구독 약관 초안 `SUBSCRIPTION_TERMS_DRAFT`(creator-subscription-2026-10-14-v2) | 개인 24,900/49,000원, 미이월, 미사용 시 전액 환불 | 금액·대상이 다름. 문단 구조(결제·제작량·해지·환불·변경)는 B2B 약관의 틀로 재사용 |
| `BUSINESS` 주소 | 구로구 디지털로34길 55 | 메모리 기준 본점은 2026-10-21부터 양천구 — 약관·사업자 정보 갱신 필요(세금계산서 발행 정보와도 맞아야 함) |

---

## 7. TWINGS 제안

1. **순서**: ① 토스 자동결제 추가 계약 신청(단건 라이브 키와 같은 날, §19.6) + 월 정산한도 증액 협의 → ② B2B 약관·계약서 초안(제4조의3 또는 별도 "브랜드 서비스 이용계약") → ③ `brand_subscriptions`·`periods`·`credit_ledger`·`invoices` core/glue 작성 → ④ 후불 경로를 **수동**으로 먼저 연다(관리자 오퍼레이션 `brandBilling.invoice`, `brandBilling.confirmDeposit`, 홈택스 수기 발행) → ⑤ 카드 빌링은 계약 뒤 `SubscriptionGateway` 재사용으로 붙인다 → ⑥ 팝빌/바로빌 어댑터는 월 발행 건수가 손으로 버거워질 때(10건↑) 붙인다.
2. **갱신 스케줄러를 먼저 고친다**: `/api/creator-subscriptions/tick`이 `vercel.json`에 없다. B2B 청구도 같은 크론 경로를 쓰므로 등록(또는 `/api/renders/tick`에서 호출)이 선행이다.
3. **크레딧은 §19.2의 10원 정의 하나로 통일**하고, 플랜 크레딧은 `plan_version`에 고정해 원가 모델 변경이 기존 계약을 바꾸지 않게 한다(개인 구독 604 units 원칙과 같다).
4. **초과분은 자동 청구하지 않는다.** 한도 도달 시 생성 차단 + 담당자 안내, 추가분은 다음 세금계산서에 합산(사전 서면 동의). 카드 빌링 고객도 초과분은 별도 승인 건으로.
5. **결제 담당자·세금계산서 수신자는 좌석에 묶는다**(`brand_usage_buyers` 모델). 사업자등록번호는 결제 담당자 행에만, 브랜드 DTO에는 넣지 않는다.
6. **기능 차단과 플랜을 한 함수로**: `brandFeatureAllowed(orgId, feature)`가 플랜 포함 기능 + 조직별 예외(차단 목록)를 함께 보게 한다. 차단 고객의 플랜 가치 조정은 계약서 특약으로, 코드는 차단만 안다.
7. **Stripe 잔재 정리**는 B2B와 무관하게 별도 PR: `subscriptions`/`stripe_events`·`isEntitled`('pro' 티어)·`/api/stripe/webhook`·`/api/billing/portal`. 지금은 휴면이라 급하지 않지만, B2B 구독 도입 시 "subscription"이라는 이름이 세 가지 뜻(Stripe·개인·조직)이 되므로 먼저 치우는 편이 안전하다.

## 8. 대표 결정 필요 (임의 결정 금지)

1. **부가세 기준**: 390,000·690,000·990,000원이 공급가액(별도)인지 총액(포함)인지. 청구액·크레딧·세금계산서 금액이 전부 여기에 달려 있다.
2. **결제 경로**: 카드 자동결제 / 세금계산서 후불 / 둘 다, 플랜별 허용 경로. 후불의 입금 기한·연체 시 중단 규칙.
3. **PG 계약**: 토스 자동결제 추가 계약 신청 시점, 정산한도(1,000만원) 증액과 보증보험 담보 증액, 네이버페이·토스페이 빌링 심사 여부.
4. **약관**: 제4조 개정 vs B2B 전용 조항/계약서, 청약철회 적용 제외 명시, 중도 해지·미사용 크레딧 환불 기준, 연 계약 할인·해지 위약 여부(법무 검토 경로).
5. **크레딧 정책**: 이월(1달·2배 상한을 B2B에도 적용할지), 초과분 단가, 좌석 수, 플랜 변경(업/다운) 시 일할 규칙.
6. **가격 노출**: `docs/BRAND-ENGINE.md` §7-5("정하기 전 가격 노출 금지")에 따라 공개 요금표 시점, 셀프서브 최소 플랜 허용 여부, "문의→견적→계약" 경로.
7. **세금계산서 발행 주체·도구**: 홈택스 수기 / 팝빌 / 바로빌, 발행 명의 정보(본점 주소 변경 반영), 발행일 규칙(선발행·후발행).
8. **법인 사업자 정보 수집**: 사업자등록번호·담당자 연락처 저장 범위와 개인정보처리방침 반영.
