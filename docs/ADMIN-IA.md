# ADMIN-IA.md — TWINGS Admin 정보구조(IA) 및 공통 패턴 재설계

> 작성일: 2026-10-31  
> 근거 문서: [`docs/ADMIN-AUDIT.md`](./ADMIN-AUDIT.md), [`docs/PLATFORM-2.0.md`](./PLATFORM-2.0.md) §10·§13·§16·§21.4, [`docs/design/IDENTITY.md`](./design/IDENTITY.md), [`docs/design/TASTE.md`](./design/TASTE.md), [`docs/design/TOOLBOX.md`](./design/TOOLBOX.md)

---

## 1. 설계 목표 (30초 원칙 & 본 자리 처리 원칙)

1. **30초 인지 원칙**: 운영자가 `/admin`을 열면 스크롤하지 않고 30초 안에 **"지금 위험한 것(Critical), 오늘 처리할 것(High), 일반 검수(Normal), 그리고 각각의 다음 행동"**을 파악한다.
2. **본 자리 처리(In-place Triage) 원칙**: 할 일 항목을 누르면 목록의 맨 위가 아니라 **처리가 필요한 정확한 필터·캠페인·섹션(`#anchor`)**으로 곧장 이동하며, 판단에 필요한 근거(제출 링크, 지표, 스크린샷, 비용, 실패 사유)가 버튼 바로 옆에 놓인다.
3. **조회 · 판단 · 편집 분리 원칙**: 일상적으로 수십 번 보는 조회·판단 영역과 가끔 여는 전체 수정·생성 폼을 시각적·구조적으로 분리해, 수정 폼 때문에 검수 대기열이 스크롤 아래로 밀리지 않게 한다.
4. **URL 100% 하위 호환**: 기존 북마크, 이메일 알림 링크(`/admin/inquiries`, `/admin/campaigns`, `/admin/community#social` 등), 스윕 및 테스트 경로는 단 하나도 깨뜨리지 않는다.

---

## 2. 내비게이션 재구성 (업무·대상 기준 4그룹)

내부 테이블·기능명 중심이던 기존 메뉴에서 누락된 **렌더 보드(`/admin/renders`)**, **사용자 보기(`/admin/users`)**, **콘테스트(`/admin/contests`)**를 정식 편입하고, 구버전 **플레이북(`/admin/playbooks`)**은 템플릿 그룹에서 분리해 시스템 하단 레거시 항목으로 내린다.

| 그룹 키 (`group.key`) | 그룹명 (KO / EN) | 메뉴 키 (`AdminNavKey`) | 경로 (`ADMIN_NAV_PATHS`) | 대상 업무 및 역할 |
| --- | --- | --- | --- | --- |
| **`today`** | **오늘의 운영**<br>Today's operations | `home` | `/admin` | 심각도·대기 시간 순 단일 우선순위 대기열 및 운영 상태 요약 |
| | | `renders` **(신설)** | `/admin/renders` | **렌더 보드 & 단건 결제 점검** (`PLATFORM-2.0 §10`): 렌더 상태·비용·실패 사유·재시도·완료 메일 재발송, Toss 수동 확인 결제(`refund_manual`, `partial_balance`, `fulfil_manual`) 대사 |
| | | `inquiries` | `/admin/inquiries` | 브랜드 캠페인 의뢰(`brand_inquiries`) 및 렌더 결과 피드백(`render_feedback`) |
| | | `risk` | `/admin/risk` | 캠페인 참가자 메시지 리스크 플래그(`campaign_risk_flags`) 및 탐지 워커·Slack 상태 |
| **`campaigns`** | **브랜드·캠페인**<br>Brands & campaigns | `brandWorkspace` | `/admin/brand-workspace` | 브랜드 조직·프로젝트 준비, 쇼트리스트, 성과 수집, 2차 활용 라이선스(`/admin/brand-workspace/usage`) |
| | | `campaigns` | `/admin/campaigns` | 크리에이터 캠페인 모집, 지원자 선발, 게시물 검수, 정산 지급(`#payout-queue`) |
| | | `funding` | `/admin/funding` | 캠페인 펀딩 견적 발행, 보상 제안 승인, 입금 대사, 만료·환불 처리 |
| **`templates`** | **크리에이터·콘텐츠**<br>Creators & content | `prompts` | `/admin/prompts` | 오리지널·메이커 템플릿 검수, 공개 설정, 대표 지정, 주간 알림 메일 |
| | | `community` | `/admin/community` | SNS 팔로워 인증(`#social`), 메이커 지원(`#applications`), 포맷 레시피 3인 검수(`#formats`), 문의·보상·정산 |
| | | `contests` **(편입)** | `/admin/contests` | 콘테스트 운영, 출품작 승인/반려, 수상작 선정 |
| | | `landingMedia` | `/admin/landing-media` | 랜딩 페이지 미디어 슬롯 교체·초기화 |
| **`settings`** | **사용자·시스템**<br>Users & system | `users` **(신설)** | `/admin/users` | **사용자 보기** (`PLATFORM-2.0 §10`): 역할·메이커/인플루언서 자격·연동 SNS·셀카 수·주문/렌더 수 (개인정보 최소) |
| | | `subscriptions` | `/admin/subscriptions` | 정기결제 출시 준비도 점검 및 실패 결제(`charge_exhausted_review` 등) 확인 |
| | | `policy` | `/admin/policy` | 기본 공개 등급 정책 |
| | | `playbooks` **(레거시 강등)** | `/admin/playbooks` | 구버전 에디토리얼 플레이북 보관함 (라우트·테스트 호환 유지) |

### 사이드바 밀도 개선
- 기존 사이드바는 모든 메뉴 항목 아래에 2줄짜리 부연 설명(`.admin-nav-description`)을 상시 노출해 세로 길이가 과도하게 길었다.
- 데스크톱 사이드바에서는 메뉴명을 선명하게 보여주고, 부연 설명은 **현재 활성화된 항목(`aria-current="page"`) 또는 포커스/호버 시에만** 조밀하게 노출하거나 1줄 요약으로 압축해 한 화면에 전체 4그룹이 스크롤 없이 들어오게 한다(DOM 텍스트는 스크린리더 및 `tests/admin/workflow.test.tsx` 호환을 위해 유지).

---

## 3. 홈(`/admin`) 단일 우선순위 대기열 설계

### 3.1 심각도(Severity) 3단계 및 우선순위 규칙

홈 상단 **"지금 확인할 일"** 대기열(`adminNextActions`)은 모든 운영 멈춤 신호를 **심각도(Severity) → 대기 시간(가장 오래 기다린 항목 우선) → 건수** 순으로 정렬한다.

| 등급 | 심각도 (`severity`) | 배지 표현 | 포함되는 대기열 키 (`AdminTaskKey`) 및 조건 | 이동 경로 (`href` — 처리 지점 직결) |
| --- | --- | --- | --- | --- |
| **1순위** | **`critical`**<br>(결제·안전·장애) | 위험 (Danger)<br>`#dc2626` | 1. **`paymentsManual`**: Toss 단건 결제 수동 환불/이행 필요 (`countManualTossPayments > 0`)<br>2. **`rendersFailed`**: 렌더 실패 (`renders.failed > 0`) 또는 15분 이상 지연(`renders.held > 0`)<br>3. **`risk`**: 미검토 캠페인 리스크 플래그 (`risk.flags > 0`) 또는 탐지 워커 중단/사망 작업 (`risk.dead > 0`)<br>4. **`brandUsageBlocked`**: 결제 후 차단된 2차 활용 또는 결제 검토 (`brand_usage_cases` `blocked_after_payment` / `review`)<br>5. **`fundingReview`**: 캠페인 펀딩 결제 검토·환불 대기 (`review` / `refund_pending`)<br>6. **`subscriptionReviews`**: 정기결제 한도 소진/제공사 검토 필요 (`creator_subscription_periods` 실패 검토) | 1. `/admin/renders?tab=payments`<br>2. `/admin/renders?status=failed`<br>3. `/admin/risk`<br>4. `/admin/brand-workspace/usage`<br>5. `/admin/funding#orders`<br>6. `/admin/subscriptions` |
| **2순위** | **`high`**<br>(고객·크리에이터 대기) | 오늘 처리 (Accent)<br>`#3875C5` | 7. **`inquiries`**: 새 브랜드 의뢰 (`brand_inquiries.status = 'new'`)<br>8. **`feedback`**: 새 렌더 불만/환불 문의 (`render_feedback.status = 'new'`)<br>9. **`studio`**: 브랜드 워크스페이스 스튜디오 인박스 (`studio > 0`)<br>10. **`brandUsage`**: 새 2차 활용 문의·범위 정의 대기 (`inquiry` / `scoping` / `scope_defined`)<br>11. **`funding`**: 캠페인 보상 제안(`proposed`) 또는 만료 견적 정리 대기<br>12. **`posts`**: 검수 대기 중인 크리에이터 게시물 (`campaign_applications.status = 'posted'`)<br>13. **`payouts`**: 승인 완료 후 지급 대기 중인 정산 (`verified` & `paid_at is null`) | 7. `/admin/inquiries?kind=brand&status=new`<br>8. `/admin/inquiries?kind=feedback&status=new`<br>9. `/admin/brand-workspace`<br>10. `/admin/brand-workspace/usage`<br>11. `/admin/funding`<br>12. 대기 건이 있는 캠페인 상세 `/admin/campaigns/[id]#posts` (복수면 `/admin/campaigns?filter=posts#campaigns-table`)<br>13. `/admin/campaigns#payout-queue` |
| **3순위** | **`normal`**<br>(선발·심사·콘텐츠) | 검수 대기 (Neutral) | 14. **`applicants`**: 선발 대기 중인 캠페인 지원자 (`status = 'applied'`)<br>15. **`socialAccounts`**: SNS 팔로워 인증 대기 (`submitted` 또는 `recheck_at`)<br>16. **`creatorApplications`**: 메이커 지원서 대기 (`maker_applications.status = 'pending'`)<br>17. **`formatsSubmitted`**: 메이커 제출 레시피 검수 대기 (`platform_formats.status = 'submitted'`)<br>18. **`templates`**: 제출된 템플릿 검수 대기 (`prompt_items.status = 'pending'`)<br>19. **`contestEntries`**: 콘테스트 출품작 검수 대기 (`contest_entries.status = 'pending'`) | 14. 대기 건이 있는 캠페인 상세 `/admin/campaigns/[id]#applications` (복수면 `/admin/campaigns?filter=applicants#campaigns-table`)<br>15. `/admin/community#social`<br>16. `/admin/community#applications`<br>17. `/admin/community#formats`<br>18. `/admin/prompts?status=pending`<br>19. `/admin/contests#entries` |

### 3.2 각 대기열 행이 보여주는 4가지 정보
1. **무엇이 몇 건 막혀 있는가**: 작업 제목 + 건수 배지(`tabular-nums`) + 심각도 배지(`위험` / `오늘 처리` / `검수`).
2. **왜 중요한가**: 해당 단계가 멈추면 고객이나 크리에이터에게 어떤 영향이 있는지 1줄 인과 설명.
3. **얼마나 기다렸는가 (`oldestAt`)**: 가장 오래 대기 중인 항목의 경과 시간(예: `3시간 대기`, `2일 대기`)을 함께 표시해 SLA 지연을 즉시 식별한다.
4. **바로 할 행동 (CTA)**: 처리 지점(`href`)으로 직결되는 단일 액션 버튼.

### 3.3 홈 화면 불필요 요소 정리 (H5 해결)
- 상시 절반을 차지하던 "브랜드 캠페인을 처음 운영한다면" 3단계 정적 안내(`app/(admin)/admin/page.tsx:266-291`)는 하단 접기(`<details>`) 도움말로 내린다.
- 하단 요약 카드(`다른 활동 현황`, `page.tsx:314-402`)의 렌더 실패·수동 결제 링크를 `/admin/inquiries`가 아니라 **`/admin/renders?status=failed`**와 **`/admin/renders?tab=payments`**로 수정한다.

---

## 4. 공통 UI 패턴 4종 정의 (`components/admin/chrome.tsx`)

모든 Admin 화면이 동일한 조작감과 시각 위계를 갖도록 4가지 공통 패턴을 표준화한다.

### 4.1 목록 패턴 (List Pattern)
- **상단 요약·필터 바 (`AdminFilterBar`)**: 상태별 탭(전체 / 처리 필요 / 완료 등)과 각 탭의 건수(`tabular-nums`), 키워드 검색(`q`), 보조 액션(예: `+ 새로 만들기`, `대사 실행`)을 한 줄에 배치한다.
- **조밀한 데이터 표/리스트**:
  - 모든 숫자·금액·건수·날짜·ID 열은 `font-variant-numeric: tabular-nums`를 강제한다.
  - 행마다 **식별자(짧은 코드) · 핵심 제목/대상 · 현재 상태 배지 · 대기/갱신 시각 · 바로 할 액션** 순서를 지킨다.
- **빈 상태 (`EmptyState`)**: 단순히 "없습니다"만 적지 않고 현재 적용된 필터 조건과 필터 초기화 링크를 함께 제공한다.

### 4.2 상세 패턴 (Detail Pattern)
- **상단 헤더 (`AdminDetailHeader`)**: 상위 목록 복귀 링크(`← 목록으로`), 대상 이름, 고유 슬러그/ID, 현재 상태 배지, 공개 페이지 미리보기 링크(`PublicLink ↗`).
- **요약 & 다음 행동 바 (`AdminNextStepBanner`)**: 현재 상태에서 운영자가 지금 해야 할 결정 1가지를 상단에 고정하고 해당 섹션으로 점프시킨다.
- **섹션 점프 바 (`AdminSectionNav`)**: 긴 상세 화면(`/admin/campaigns/[id]`, `/admin/brand-workspace/[id]`, `/admin/community`) 상단에 앵커 탭 바를 두어 스크롤 없이 원하는 업무 섹션으로 이동한다.
- **조회(Read) · 판단(Triage) · 편집(Authoring) 분리**:
  - **판단(Triage)**(지원자 선발, 게시물 승인, 출품작 심사, 정산 지급)은 상단에 즉시 조작 가능한 카드로 노출한다.
  - **편집(Authoring)**(15개 필드가 넘는 전체 메타데이터 수정 폼, 설정 변경, 신규 생성 폼)은 `<details className="admin-fold">` 안에 넣어 평소에는 화면을 가리지 않게 한다.

### 4.3 위험 동작 확인 패턴 (`ConfirmCheck`)
- 상태 비가역 전환(캠페인 모집 시작·종료, 환불 실행, 템플릿 전체 공지 메일 발송, 반려·삭제·권한 회수)은 반드시 `<ConfirmCheck label={...} />`(`<input type="checkbox" name="confirm" value="yes" required />`)를 거쳐야 제출된다.
- 위험 버튼(`.admin-btn-danger` / `bw-danger`)에만 빨강(`#dc2626`) 테두리·텍스트를 쓰고, 일반 주요 행동 버튼(`BUTTON_PRIMARY`)에는 프렌치 블루(`#3875C5`) 또는 딥 차콜(`#111111`)을 쓴다.

### 4.4 처리 결과 및 오류 표시 패턴 (`OutcomeBanner`)
- `/admin/do`가 303 리다이렉트로 돌려보내는 `?ok=<code>` / `?err=<code>&detail=<msg>`를 페이지 최상단 `OutcomeBanner`(`role="status"` / `role="alert"`)에서 일관되게 렌더링한다.
- 성공 시 차분한 그린(`#15803d`), 오류 시 선명한 레드(`#b91c1c`)와 구체적인 DB/검증 사유(`detail`)를 표시한다.

---

## 5. 신설 화면 설계 (`PLATFORM-2.0 §10`)

### 5.1 렌더 보드 (`/admin/renders`) — `app/(admin)/admin/renders/page.tsx`

`docs/PLATFORM-2.0.md:262` (§10: *"렌더 보드: `/admin/renders` — 작업, 상태, 비용, 실패 사유, 재시도, 메일 재발송"*) 및 단건 결제(`billing_payments`) 수동 확인 해소를 위한 통합 운영 보드다.

1. **상단 요약 KPI 스트립 (`data-admin-renders-summary`)**:
   - 전체 최근 렌더 · 실행/대기 중(`running`/`queued`) · **15분 이상 지연(`held`)** · **실패(`failed`)** · **결제 수동 확인 필요(`paymentsManual`)** · 추정/실제 누적 비용(USD/KRW).
2. **뷰 필터 탭**:
   - `전체 작업 (all)` | `실패 · 지연 (attention)` | `실행 중 (active)` | `완료 (succeeded)` | `결제 확인 필요 (payments)`
3. **단건 결제 수동 확인 패널 (`#payments`, `data-manual-payments`)**:
   - `billing_payments` 중 `refund_manual`, `partial_balance`, `fulfil_manual` 또는 `confirming` 임대 만료 건을 표로 노출한다.
   - 노출 칼럼: 주문 ID(`id.slice(0,8)`), 템플릿 슬러그, 결제 금액(`amount_krw`), 상태(`status`), 실패/점검 코드(`failure_code`), 승인/생성 시각, 연결된 렌더 ID.
   - **즉시 실행 오퍼레이션 (`payment.reconcile`)**: `reconcilePendingTossOrders`를 실행해 Toss 실상태와 즉시 대사하고 자동 복구 가능한 건을 수렴시킨다 (`POST /admin/do`).
4. **렌더 작업 표 (`#jobs`, `data-render-jobs-table`)**:
   - 노출 칼럼:
     - **작업 ID / 시각**: `id.slice(0,8)`, 생성 시각, 소요 시간(`completed_at - created_at`).
     - **템플릿 / 매체**: `template_slug`, `medium`(`video`/`image`), `aspect`, 엔진/모델(`model`).
     - **사용자(최소 식별)**: 마스킹된 이메일(예: `ab***@example.com`) + `/admin/users?q=<userId>` 링크 (원본 셀카 이미지는 노출하지 않음).
     - **상태 / 단계**: `queued` / `leased` / `running`(`finishing_at` 유무) / `succeeded` / `failed` / `cancelled`.
     - **비용 (`cost`)**: `estimated_cost_usd` (`cost_source`: `provider_usage` vs `estimate`).
     - **실패 사유 / 불만**: `error_code`, `error_detail`, 연결된 `render_feedback` 상태.
     - **알림 상태**: `notification_events` 발송 여부 (`sent_at`).
   - **행별 즉시 실행 오퍼레이션 (`/admin/do`)**:
     - **`render.retry`**: `status === 'failed'`인 렌더 작업을 안전하게 재큐잉(`status='queued'`, `error_code=null`, `error_detail=null`, `attempts` 보존/갱신)하고 렌더 패스를 트리거한다. (얼굴 검증·제공사 검수는 기존 파이프라인 그대로 통과하며 절대 우회하지 않음)
     - **`render.resendNotification`**: `status === 'succeeded'`인 렌더의 결과 안내 메일을 재발송한다 (`notifyRenderFinished` 재호출).

### 5.2 사용자 보기 (`/admin/users`) — `app/(admin)/admin/users/page.tsx`

`docs/PLATFORM-2.0.md:262` (§10: *"사용자 보기: `/admin/users` — 역할, 자격, 연동 SNS, 셀카 수, 주문 수. 개인정보는 최소"*) 명세를 구현한다.

1. **개인정보 최소 노출 원칙 (Privacy by Design)**:
   - 목록에서는 이메일을 기본 마스킹(` maskEmail(email) `, 예: `ya***@yagi.studio`)하여 화면 캡처 시에도 고객 개인정보가 노출되지 않게 한다(검색은 이메일 일부 또는 UUID prefix로 가능).
   - **셀카(`identity_selfies`) 원본 사진은 절대 불러오거나 표시하지 않는다** — 오직 저장된 유효 셀카 개수(`selfie_count`)만 숫자로 표시한다.
2. **필터 및 검색 (`data-admin-users`)**:
   - 역할 필터: `전체 (all)` | `메이커 (makers)` | `인플루언서 (influencers)` | `관리자 (admins)`
   - 검색(`?q=`): 사용자 ID prefix, 이메일 키워드, 메이커 핸들(`@handle`), SNS 핸들 검색.
3. **사용자 표 (`data-users-table`)**:
   - **사용자 식별자**: UUID 앞 8자리 + 마스킹 이메일 + 가입일(`created_at`).
   - **역할 · 자격 배지**:
     - `Admin` (`profiles.is_admin = true`)
     - `Maker` (`platform_creators.active = true`, 핸들 `@handle`, 공개 프로필 여부, 지원 상태)
     - `Influencer` (`profiles.influencer_since` 보유 여부)
   - **연동 SNS (`social_accounts`)**: 플랫폼(`instagram`/`tiktok`/`youtube`), 핸들, 검증 상태(`verified`/`submitted`/`rejected`), 확정 팔로워 수(`tabular-nums`).
   - **셀카 수 (`selfieCount`)**: 활성 보관 셀카 수 (`identity_selfies` where `deleted_at is null`).
   - **주문 · 렌더 활동**: 단건 결제 건수(`paid` 주문 수 / 총 결제액 KRW), 총 렌더 건수(성공 / 실패), 캠페인 참여 건수.
   - **연결 동선**: 해당 사용자의 렌더 보기(`/admin/renders?user=<id>`), 메이커/SNS 심사 보기(`/admin/community#social`).

### 5.3 레거시 화면 호출처 및 의존성 확인 (`/admin/playbooks`, `/admin/p/[id]`)
- **호출처**: `scripts/sweep-anon.ts` 및 `tests/admin/e2e.test.ts`, `tests/admin/workspace-shell.test.tsx`, `tests/admin/mutations.test.ts`에서 `/admin/playbooks`와 `/admin/p/[id]`를 직접 검증한다.
- **결정**: 라우트와 오퍼레이션(`playbook.*`, `revision.*`, `step.*`, `block.*`)은 삭제하지 않고 그대로 유지하되, 사이드바 내비게이션에서는 `templates` 그룹에서 빼서 `settings` 그룹 맨 아래(레거시 보관함)로 이동하고 홈 화면 바로가기에서 제외한다.

---

## 6. 디자인 시스템 적용 원칙 (`IDENTITY.md` 단일 원본)

1. **단일 강조색 프렌치 블루 (`#3875C5`)**:
   - `lib/design/identity.ts` 및 `app/globals.css`의 `--accent: #3875c5`, `--accent-text: color-mix(in srgb, #3875c5 85%, #000000)` (`#3063a7`)를 Admin과 Brand 모두의 유일한 브랜드 강조색으로 사용한다.
   - `docs/PLATFORM-2.0.md §21.4`의 구버전 `#0000EE` / `#1414B8` 문구를 `#3875C5` 기준으로 정정한다.
   - `app/(admin)/workspace.css`와 `app/(brand)/workspace.css`에서 `#0000ee`, `#dc2626`(브랜드 강조용), `#ed1e1e`, `#fad204` 하드코딩을 모두 제거한다.
2. **Admin (`admin.twings.app`) — 조밀하고 빠른 운영 도구 (Operate Mode)**:
   - 배경 `#F8F7F4`(Alabaster) 위에 `#FFFFFF` 패널과 `1px solid rgba(17,17,17,0.08)` 헤어라인 보더를 사용한다.
   - 마케팅 연출(블러 오브, 과장된 그라디언트, 스크롤 애니메이션)을 배제하고 표 가독성, `tabular-nums`, 키보드 포커스 링(`2px solid var(--accent)`), 명확한 상태 배지(위험 `#dc2626`, 경고 `#b45309`, 정상 `#15803d`, 진행 `#3875C5`)만 사용한다.
3. **Brand (`brand.twings.app`) — `/brands` 랜딩과 같은 감도의 고객 워크스페이스**:
   - `/brands` 랜딩과 동일한 프렌치 블루(`#3875C5`), 화이트/알라바스터 표면, 정교한 보더와 타이포그래피 위계를 적용한다.
   - 스튜디오 운영자가 `/brand/projects/[id]`를 열었을 때 고객 화면 위에 길게 펼쳐지던 운영자 전용 준비 패널들을 깔끔한 스튜디오 상단 드로어(`<details>`)로 정돈해 고객이 보는 실제 화면 구성을 즉시 확인할 수 있게 한다.
