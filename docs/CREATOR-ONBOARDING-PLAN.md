# TWINGS 포맷 작가 온보딩 완성 — 구현 계획 (Fable 5.1, 읽기 전용 감사 기준)

작업 경로 `D:/dev/.worktrees/twings/creator-onboarding`, 브랜치 `codex/creator-onboarding`, 기준 `origin/main 5756f71`. 이 문서는 코드를 바꾸지 않고 현재 저장소를 읽은 결과와 그에 맞춘 구현 지시다. Opus가 이 범위대로 구현하고 Codex가 독립 검토한다.

## 0. 결론 한 줄

이미 병합된 크리에이터 플랫폼(0046/0131, `lib/creator-platform/*`, `/community`, `/admin/community`)은 "승인된 작가의 비공개 포맷 제출 → 관리자 수락 → 기존 템플릿 QA/게시 → 정산 기록" 뼈대를 갖추고 있다. 빠진 것은 **앞단(프로그램 발견·지원·심사)**과 **작가 쪽 가시성(검수 피드백·템플릿 상태·정산 근거)**이다. 새 플랫폼을 만들지 않고, 테이블 1개와 컬럼 3개를 더해 그 공백만 채운다. 모든 화면은 기존 플래그 `TWINGS_FORMAT_CREATORS=on` 뒤에서만 열리고, 실제 송금·가격·약관은 건드리지 않는다.

## 1. 감사 결과 — 있는 것과 없는 것

### 1.1 재사용할 기존 구현 (수정 최소화)

| 영역 | 파일 | 현재 동작 |
| --- | --- | --- |
| 스키마 | `supabase/migrations/0046_core_creator_platform.sql`, `0131_glue_*` | `platform_creators(user_id, active, approved_by, contract_version)`, `platform_formats(status submitted/accepted/rejected, template_id, recipe)`, `platform_settlements(creator_id, creator_due, platform_margin)`, `platform_audit`, `platform_rate_limits`. 전부 RLS enable+force, 브라우저 역할 접근 없음. `platform_private_format_guard` 트리거가 수락된 포맷의 `text_visibility≠hidden`·`source≠yagi`·`author_id` 변경을 거부한다. |
| 플래그 | `lib/creator-platform/runtime.ts` | `platformAccess()` → `{ready, community, creators, rewards}`. `creators = ready && TWINGS_FORMAT_CREATORS==='on'`. |
| 도메인 | `lib/creator-platform/service.ts` | `submitPlatform()`의 `format` 액션: 승인 작가만, 하루 3건, `canonicalPost`로 예시 링크 검증, 재전송 멱등. `platformHome()`은 레시피를 절대 돌려주지 않는 명시 프로젝션. `approvedCreator()`, `lockUser()`, `audit()`. |
| 관리자 | `lib/creator-platform/admin.ts`, `lib/admin/platform-operations.ts` | `platform.manage` 단일 오퍼레이션. `creator`(계정 ID로 승인/해제), `format`(accept→`insertPrompt` status pending/hidden/yagi/author_id=작가, reject), `settle`(원가 증빙 있는 live NORMAL 결제만, `marginSplit` 80/20), 감사 기록. |
| 경제 | `lib/creator-platform/economics.ts` | `marginSplit({revenue,tax,fees,providerCost,creator})` → 배분 대상 이익의 80%. 매출이 아니라 마진 기준(고정 결정과 일치). |
| 화면 | `app/(app)/community/page.tsx`, `components/community/hub.tsx` | 하나의 클라이언트 허브에 요청·평점·보상·포맷 제출이 섞여 있다. 포맷 섹션(`hub.tsx:49-60`)은 제목·상태만 보여주고 반려 사유·템플릿 상태·링크가 없다. 누적 배분액은 통화별 합계 한 줄뿐이다. |
| 관리자 화면 | `app/(admin)/admin/community/page.tsx` | 포맷 수락/반려 버튼은 있으나 작가에게 보이는 메모 입력이 없다(사유는 감사 로그에만). 작가 승인은 계정 UUID를 손으로 입력하는 폼뿐이다. |
| 템플릿 편집 | `app/(admin)/admin/prompts/[id]/page.tsx`, `lib/admin/prompt-operations.ts` | pending 행은 approve/reject, published는 전체 편집. `textVisibility` select가 `hidden`을 포함하므로 수락된 포맷 편집은 가능하다(기본값이 행 값). 가격·미디어·번역은 여기서만 들어간다. |
| 테스트 | `tests/creator-platform/{service,routes,contract,rls,admin-media}.test.ts` | PGlite 실제 스키마로 권한·레시피 캐너리·수락 후 pending·트리거·정산·보상 검증. RLS 테스트가 `platform_%` 테이블 **14개**를 고정한다. |
| 스윕 | `scripts/sweep-anon.ts:1396-1405` | `/community` 익명 리다이렉트, `/api/community` 401·no-store 확인. |
| 사전 | `messages/ko.ts:16-135`, `messages/en.ts:5-124` | `community.*` 네임스페이스. 작가 관련 문안은 "포맷 작가"(ko) / "format creators"(en), 배분 문구 `royaltyHint`가 이미 80%·마진 기준·송금 아님을 말한다. |
| 패턴 참조 | `app/(app)/campaigns/[slug]/apply/{page,actions}.ts`, `app/(app)/campaigns/mine/page.tsx` | JS 없는 서버 액션 지원 폼 + `?ok/err&field` 코드, 단계 바. 작가 지원 폼은 이 모양을 그대로 따른다. |
| 엣지 게이트 | `lib/i18n/config.ts:32-57`, `lib/seo/sitemap.ts:144-164` | `APP_PREFIXES`와 캠페인 leaf 정규식. 새 무접두 경로는 여기와 robots에 등록해야 한다. |

### 1.2 공백 (이번 범위)

1. **발견**: 프로그램을 설명하는 공개 페이지가 없다. 유일한 진입은 플래그가 켜졌을 때 `/account` 하단 버튼(`app/(app)/account/page.tsx:234`)뿐이다.
2. **지원**: 지원서 테이블·폼·상태가 없다. 승인은 관리자가 UUID를 아는 경우에만 가능하다.
3. **심사 피드백**: `platform_formats`에 작가가 읽을 메모 컬럼이 없다. 반려된 작가는 "반려" 두 글자만 본다.
4. **템플릿 상태**: 수락 이후 템플릿이 검수 대기인지, 공개됐는지, 스튜디오가 반려했는지 작가가 알 수 없다.
5. **정산 근거**: 주문 수·원가 확인 대기 건수·확정 건수 없이 합계만 있어서 "증거가 있을 때만 정직하게" 보여주지 못한다.
6. **재제출 연결**: 반려 후 새로 제출하면 이전 건과 무관한 행이 된다.
7. **관리자 큐**: `/admin` 홈 "지금 확인할 일"에 작가 지원서가 없다.

### 1.3 건드리지 않는 것

얼굴 검증·제공사 검수(`lib/identity/*`, `lib/ark/*`, `lib/renders/*`), 보상 크레딧(`rewards.ts`, `offer.ts`), 정산 계산(`economics.ts`, `settle` 액션), 약관(`lib/legal/documents.ts`), 가격, 캠페인 도메인, 구독. 플래그 기본값은 전부 닫힘 유지.

## 2. 설계 결정

### 2.1 용어 (세 가지 "크리에이터" 구분)

| 대상 | KO 표기 | EN 표기 | 근거 |
| --- | --- | --- | --- |
| 이번 범위: AI 포맷 공급자 | **포맷 작가** (프로그램명 "포맷 작가 프로그램") | **format creator** ("Format creator program") | 기존 `community.formatHint`·`royalty` 문안과 일치 |
| 캠페인 참여 인플루언서 | 크리에이터 (기존 유지) | creator | `campaigns.*`, 약관 §8 |
| 월 구독 | 크리에이터 구독 (기존 유지) | Creator subscription | `creatorSubscription.*` |

공개·앱 문안에서 "포맷 작가"는 캠페인·구독과 다른 프로그램이라는 한 줄을 반드시 넣는다. 최종 명칭은 대표 결정(§12)이며 사전 키만 바꾸면 되도록 문자열을 한곳에 둔다.

### 2.2 라우트

캠페인과 같은 모양(공개는 로케일 접두, 앱 leaf는 무접두)을 따른다.

| 경로 | 그룹 | 캐시 | 조건 |
| --- | --- | --- | --- |
| `/[locale]/creators` | marketing, `revalidate=3600` | 정적 | `TWINGS_FORMAT_CREATORS!=='on'`이면 `notFound()`. 플래그는 서버 env이므로 변경 시 재배포가 필요하다(다른 플래그와 동일). |
| `/creators/apply` | (app), `force-dynamic` | no-store, noindex | 로그인 필수(엣지), 플래그 꺼짐이면 `unavailable` 문단만 |
| `/creators/workspace` | (app), `force-dynamic` | no-store, noindex | 로그인 필수. 플래그 꺼짐이면 `unavailable`. 지원 전/검토 중/반려/승인/해제 상태별 화면 |
| `/admin/community#applications` | (admin) | 기존 | 지원서 패널 추가 |

등록: `lib/i18n/config.ts`에 `CREATOR_PROGRAM_PATTERN = /^\/creators\/(?:apply|workspace)\/?$/`를 추가하고 `isAppPath`에 포함(`/creators` 단독은 공개 308 대상). `lib/seo/sitemap.ts`: `DISALLOWED_PATHS`에 `/creators/apply`, `/creators/workspace`; `marketing` 목록에 `{ rest: '/creators', priority: 0.6, changeFrequency: 'weekly' }`는 **플래그가 켜진 빌드에서만** 포함(`buildSitemap` 입력에 `includeCreatorProgram` boolean 추가, `app/sitemap.ts`에서 env 판정). 링크 헬퍼는 `lib/creator-platform/links.ts`(순수 모듈: `creatorProgramHref(locale)`, `CREATOR_APPLY_PATH`, `CREATOR_WORKSPACE_PATH`).

### 2.3 제출 경로

- **지원서**: 캠페인 지원과 같은 JS 없는 서버 액션 `app/(app)/creators/apply/actions.ts` → `lib/creator-platform/onboarding.ts`의 `submitCreatorApplication()`. 서버 액션은 Next가 Origin을 검사하고, 도메인 함수가 플래그·세션·입력을 다시 검사한다.
- **포맷 제출**: 기존 `POST /api/community` `format` 액션을 그대로 쓴다(동일 출처·바디 상한·속도 제한·멱등 유지). 허브의 포맷 폼을 `components/community/format-form.tsx` 클라이언트 섬으로 떼어 작가 공간에서만 렌더하고, `hub.tsx`에서는 포맷 섹션을 제거한다(중복 금지). `revisionOf`(반려 건 재제출) 필드만 추가.
- **관리자**: 기존 `platform.manage` 오퍼레이션에 `application` 액션 추가, `format` 액션에 `note` 추가. 새 오퍼레이션 이름을 만들지 않는다(`tests/admin/auth.test.ts` 열거는 자동 적용).

### 2.4 데이터 노출 원칙 (DTO 허용 목록)

작가 공간 DTO에 **들어가는 것**: 본인 지원서 필드·상태·`decision_note`, 본인 포맷의 `id,title,medium,status,review_note,reviewed_at,revision_of,example_url`, 연결 템플릿의 `status,slug(published일 때만),reject_reason,onSale`, 정산 집계(건수·합계). **절대 들어가지 않는 것**: `recipe`, 다른 사용자 행, 이메일, 결제 키, 스토리지 키, 원가(`provider_cost`), 감사 `reason`. 테스트에서 `PRIVATE_RECIPE` 캐너리와 `cost`·`fees` 키 부재를 확인한다.

## 3. 스키마 (최소)

`supabase/migrations/0051_core_creator_onboarding.sql` — 머리말 주석 "CLOUD APPLICATION REQUIRED. 기본 플래그 닫힘, 시드 없음."

```sql
create table platform_creator_applications (
  id uuid primary key,
  user_id uuid not null references profiles on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  portfolio_url text not null check (length(portfolio_url) <= 2048),
  sample_urls text[] not null default '{}' check (cardinality(sample_urls) <= 3),
  mediums text[] not null check (cardinality(mediums) between 1 and 2 and mediums <@ array['image','video']::text[]),
  tools text not null default '' check (length(tools) <= 300),
  message text not null check (length(message) between 20 and 2000),
  rights_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','approved','declined')),
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  decided_by uuid references profiles on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'submitted') = (decided_at is null))
);
create unique index platform_creator_applications_open on platform_creator_applications (user_id) where status = 'submitted';
create index platform_creator_applications_owner on platform_creator_applications (user_id, created_at desc);

alter table platform_formats
  add column review_note text check (review_note is null or length(review_note) <= 1000),
  add column reviewed_at timestamptz,
  add column revision_of uuid references platform_formats on delete set null;
```

`supabase/migrations/0138_glue_creator_onboarding.sql` — 0131과 같은 루프로 `platform_creator_applications`에 RLS enable+force, `revoke all from public,anon,authenticated`, `grant select,insert,update,delete to service_role`.

갱신할 테스트: `tests/creator-platform/rls.test.ts`(0131 다음에 0138도 읽고 14→15), `tests/db/migrations.test.ts` 테이블 목록에 `platform_creator_applications`. `npm run db:local`로 스냅샷 재생성. 클라우드 적용은 대표/Director("클라우드 적용 필요" 표시만).

## 4. 상태·권한 매트릭스

### 4.1 지원서 상태

```
(없음) ──지원──▶ submitted ──승인──▶ approved  (같은 트랜잭션에서 platform_creators active=true, approved_by, contract_version upsert)
                     └──반려──▶ declined  (decision_note 필수, 작가에게 표시)
declined ──재지원──▶ submitted (새 행; 하루 1건 제한; 열린 지원서 1건만 — 부분 유니크 인덱스)
approved 상태에서 재지원 ──▶ conflict (이미 작가)
```

작가 권한 해제는 기존 `creator` 액션(active=false). 지원서 행은 그대로 두고 작가 공간이 "권한 해제됨"을 보여준다.

### 4.2 포맷 상태 (기존 + 메모)

```
submitted ──accept(note 선택)──▶ accepted (template pending) ──[/admin/prompts]──▶ published | rejected(reject_reason) | archived
submitted ──reject(note 필수)──▶ rejected ──재제출(revisionOf=이 행)──▶ 새 submitted
```

`revisionOf`는 본인 소유·`rejected` 행만 허용. accepted 포맷의 새 버전은 범위 밖(§12).

### 4.3 권한

| 동작 | 익명 | 로그인 일반 | 지원 중 | 반려됨 | 승인 작가 | 해제된 작가 | 관리자 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/[locale]/creators` 열람 | 플래그 on이면 가능 | 가능 | 가능 | 가능 | 가능 | 가능 | 가능 |
| 지원서 제출 | 불가(로그인 유도) | 가능 | 불가(열린 건 있음) | 가능 | 불가(conflict) | 가능(재심사) | 불가(관리자 계정은 지원 안 함 — `forbidden`) |
| 본인 지원서·결정 메모 보기 | 불가 | 해당 없음 | 가능 | 가능 | 가능 | 가능 | 전체 |
| 포맷 제출 | 불가 | 불가 | 불가 | 불가 | 가능 | 불가 | 불가(관리자는 `/admin/prompts`에서 직접 등록) |
| 본인 포맷·검수 메모·템플릿 상태 | 불가 | — | — | — | 가능 | 가능(읽기) | 전체 |
| 정산 집계 | 불가 | — | — | — | 가능 | 가능(읽기) | 전체 |
| 지원서 승인/반려, 포맷 수락/반려 | 불가 | 불가 | 불가 | 불가 | 불가 | 불가 | 가능(`platform.manage`, 감사 기록) |
| 레시피 열람 | 불가 | 불가 | 불가 | 불가 | 불가(본인 것도 DTO에 없음) | 불가 | 가능 |
| 템플릿 가격·게시 | 불가 | 불가 | 불가 | 불가 | 불가 | 불가 | 가능(기존 편집기) |

모든 행은 서버에서 매 요청 재조회한다. 플래그 `creators=false`면 열람 페이지 404, 제출은 `not_open`, 작가 공간은 `unavailable`.

## 5. 라우트별 한국어 UX

디자인은 기존 토큰·컴포넌트만 쓴다. 마케팅 페이지는 `components/audience/creator-home.tsx`의 `audience-shell / audience-eyebrow / audience-title / audience-heading / audience-button` 클래스, 앱 페이지는 `AppHeader` + `band` + 캠페인 지원 페이지의 `INPUT/LABEL` 상수(`app/(app)/campaigns/[slug]/apply/page.tsx:27-28`)를 그대로 쓴다. 하드코딩 문자열 금지, 전부 `messages/{ko,en}.ts`의 새 네임스페이스 `creatorProgram`.

### 5.1 `/[locale]/creators` — 프로그램 소개 (data-creator-program)

구성(위→아래). 문안은 초안이며 외부 공개 문안이므로 §12-1 대표 확인 대상.

1. 히어로: eyebrow "포맷 작가 프로그램" / 제목 "내가 만든 포맷을\nTWINGS 템플릿으로." / 본문 "AI로 트렌드 포맷을 직접 만드는 분을 찾습니다. 레시피는 공개되지 않고, 스튜디오 검수를 거쳐 템플릿으로 판매됩니다. 판매에서 생긴 이익을 작가와 나눕니다." / 버튼 "작가로 지원하기 →"(`/creators/apply`) / 보조 링크 "이미 지원했다면 작가 공간에서 확인"(`/creators/workspace`).
2. 정의 문단(`data-service-definition`, GEO 규칙): "포맷 작가 프로그램은 AI 영상·이미지 포맷을 만드는 사람이 TWINGS에 포맷을 제출하고, 스튜디오 검수 후 템플릿으로 판매되면 이익을 나누는 프로그램입니다. 캠페인 참여 크리에이터, 월 구독과는 다른 프로그램입니다."
3. "이런 분께 맞아요" 3항목: 영상·이미지 모델로 포맷을 직접 설계해 본 분 / 게시물로 반응을 확인한 포맷이 있는 분 / 다른 사람이 자기 얼굴로 재현해도 되는 포맷을 가진 분.
4. "진행 순서" 4단계(`data-creator-steps`): ① 지원 — 포트폴리오와 예시 게시물 링크로 지원합니다. ② 검토 — 스튜디오가 지원서를 확인하고 결과를 작가 공간에서 알려드립니다. ③ 포맷 제출 — 승인된 작가는 포맷 이름·예시·비공개 레시피를 제출합니다. 제출이 곧 판매는 아닙니다. ④ 검수와 공개 — 스튜디오가 미디어·번역·가격·검수를 마치면 템플릿이 공개됩니다.
5. "수익 배분 기준"(`data-creator-share`): "결제 금액에서 세금·결제 수수료·실제 생성 원가를 뺀 배분 대상 이익의 80%가 작가 몫입니다. 매출 총액의 80%가 아닙니다. 원가 증빙이 확인된 주문부터 배분액이 기록되고, 작가 공간에서 누적액을 볼 수 있습니다. 실제 송금 절차와 일정은 아직 정해지지 않았고, 정해지면 승인된 작가에게 따로 안내합니다." (숫자는 80/20 외에 없음. 송금 약속 없음.)
6. "레시피는 비공개": "제출한 레시피는 공개 페이지, 고객 화면, 공유 링크 어디에도 나오지 않습니다. 스튜디오 검수 담당자만 봅니다."
7. "제출 조건": "본인이 만든 포맷만 제출할 수 있습니다. 다른 사람의 얼굴·저작물·브랜드 자산이 들어간 포맷은 받지 않습니다. 모든 템플릿에는 TWINGS의 본인 얼굴 사용 동의와 제공사 검수가 그대로 적용됩니다." (약관 §5.3 표현과 충돌하지 않게 "본인 얼굴만·제공사 자동 검수" 어휘 사용.)
8. 하단 CTA 반복 + `MarketingFooter`.

metadata: `faq/page.tsx`와 같은 형태(`localeAlternates('/creators')`, `siteOgImage`). JSON-LD는 레이아웃의 Organization/WebSite로 충분하며 새 타입을 추가하지 않는다.

### 5.2 `/creators/apply` — 지원서 (data-creator-apply)

- 상단: eyebrow "포맷 작가 프로그램", 제목 "포맷 작가 지원", 리드 "아래 내용을 보내 주시면 스튜디오가 확인합니다. 결과는 작가 공간에서 알려드려요." (메일 발송 약속 없음)
- 이미 열린 지원서가 있으면 폼 대신 "검토 중" 카드 + 작가 공간 링크. 이미 작가면 작가 공간으로 `redirect`.
- 필드(모두 서버 재검증, 캠페인 지원과 같은 `?err=invalid&field=` 표시):
  - 활동명 `displayName` (필수, ≤80, `profiles.display_name` 프리필, 저장 시 프로필도 갱신하지 않음 — 지원서에만 기록)
  - 대표 채널 또는 포트폴리오 링크 `portfolioUrl` (필수, https만, `lib/creators/profile.ts`의 `socialLinkHref` 규칙 재사용 — 자격증명·포트 없는 https)
  - 내가 만든 포맷 예시 게시물 링크 `sample1..3` (1개 이상 필수, `canonicalPost`로 지원 SNS 공개 게시물만; 힌트 "인스타그램·틱톡·유튜브·X 공개 게시물")
  - 주로 만드는 결과물 `mediums` (체크박스 이미지/영상, 1개 이상)
  - 사용하는 도구·모델 `tools` (선택, ≤300)
  - 소개와 제안하고 싶은 포맷 `message` (필수 20~2000)
  - 체크 `rights` (필수): "예시 게시물은 제가 직접 만든 것이고, 포맷을 제출하고 이용을 허락하는 데 필요한 권리를 갖고 있어요." (기존 `community.rights` 어휘)
  - 체크 `program` (필수): "프로그램 안내(레시피 비공개, 스튜디오 검수 후 판매, 배분 기준)를 읽었어요." — 법적 동의 문구가 아니라 안내 확인. 링크는 `/[locale]/creators`.
  - 버튼 "지원서 보내기"
- 성공 → `redirect('/creators/workspace?ok=applied')`.
- 오류 코드: `sign_in_required`, `not_open`, `invalid(+field)`, `already_open`, `already_creator`, `rate_limited`, `forbidden`(관리자).

### 5.3 `/creators/workspace` — 작가 공간 (data-creator-workspace, data-creator-state=...)

서버 컴포넌트. 상태별 한 화면.

| 상태 | 보이는 것 |
| --- | --- |
| 지원 전 | 프로그램 한 줄 요약 + "작가로 지원하기" 버튼 + 프로그램 페이지 링크 |
| 검토 중 (`submitted`) | "지원서를 검토하고 있어요" 카드: 제출 일시, 보낸 내용 요약(활동명·링크 수·결과물 종류). "결과가 나오면 여기에서 알려드려요." |
| 반려 (`declined`) | "이번에는 함께하지 못하게 됐어요" + `decision_note` 본문 + 결정일 + "다시 지원하기" 버튼(폼으로) |
| 승인·활성 | ① 상태 줄 "포맷 작가 · 승인일 · 계약 버전 라벨" ② **포맷 제출 폼**(클라이언트 섬, 기존 라벨 재사용) ③ **내 포맷 목록**: 각 행에 제목·종류·제출일·상태 칩(`검토 중/접수 완료/반려`)·검수 메모(`review_note`)·템플릿 상태 칩(`스튜디오 검수 중/공개됨(링크 ↗)/판매 준비 중/스튜디오 반려: reject_reason/판매 종료`)·반려 건에는 "수정해서 다시 제출" 버튼(폼 프리필 + `revisionOf`) ④ **정산 현황**(`data-creator-earnings`): 공개 템플릿별 표 — 결제 완료 주문 N건 / 원가 확인 대기 N건 / 배분 기준 확정 N건 / 확정 배분액 합계(KRW). 표 위 문장: `community.royaltyHint` 재사용("…실제 송금 완료 금액은 아닙니다"). 주문이 0건이면 "아직 판매 기록이 없어요." 한 줄만. |
| 승인·해제 | 승인 화면과 같되 제출 폼 대신 "포맷 작가 권한이 해제되었어요. 문의는 hello@yagiworkshop.xyz" (footer와 같은 주소만, 새 연락처 없음). 목록·정산은 읽기 유지. |

`?ok=applied`·`?ok=format` 알림 배너, `?err=`는 폼 오류. 마커: `data-creator-format=<id> data-status=...`, `data-creator-earnings-row=<template_id>`.

### 5.4 진입 링크

- `components/marketing/chrome.tsx` `MarketingFooter`: creator 대상 footer 링크 목록에 플래그가 켜져 있을 때만 `{ href: creatorProgramHref(locale), label: dict.creatorProgram.footerLink }` 추가(상단 내비는 바꾸지 않음 — §12-2).
- `app/(app)/account/page.tsx:234`: `TWINGS_FORMAT_CREATORS==='on'`이면 "포맷 작가 공간" 버튼(`/creators/workspace`)을 community 버튼 옆에 추가(community 버튼 조건에서 creators 플래그는 제거해 중복 진입을 없앤다).
- `components/community/hub.tsx`: 포맷 섹션을 제거하고, `access.creators && !home.creator`일 때 한 줄 안내 "포맷을 직접 만드시나요? 포맷 작가 프로그램 보기 ↗"(`/[locale]/creators`)를 둔다. `home.creator`면 "내 포맷과 정산은 작가 공간에서 →".

### 5.5 관리자 `/admin/community`

오른쪽 열 맨 위에 `id="applications"` 섹션 "포맷 작가 지원서":
- 목록: `submitted` 전부(오래된 순) + 최근 결정 20건. 행마다 활동명, 계정 ID, 결과물 종류, 도구, 소개 본문(`whitespace-pre-wrap`), 포트폴리오·예시 링크(`target=_blank rel="noopener noreferrer nofollow"`, 서버는 절대 fetch하지 않음), 제출일.
- `submitted` 행 폼(`OpForm op="platform.manage"`): `action=application`, 계약 버전 라벨 입력(승인 시 필수), 작가에게 보일 메모(반려 시 필수, 승인 시 선택), 처리 사유(감사, 기존 `reason`), 버튼 "작가 승인" / "반려".
- 기존 "작가 승인(계정 ID)" 폼은 초대형 승인용으로 유지하되 제목을 "초대 승인(계정 ID 직접 입력)"으로 바꾼다.
- 포맷 카드: `submitted`일 때 메모 textarea(`note`) 추가. 반려 버튼은 메모 없이 누르면 `invalid`로 돌아온다(zod superRefine).
- 포맷 카드에 연결 템플릿 상태(`prompt_items.status`)와 편집 링크(기존 `manageTemplate`) 표시.

`/admin` 홈: `lib/admin/workflow.ts` `AdminQueueCounts`에 `creatorApplications?: number`, `QUEUES`에 `{ key: 'creatorApplications', href: '/admin/community#applications' }`, `messages/admin-workflow.ts` `tasks.creatorApplications {title:"포맷 작가 지원서를 검토하세요", hint:"포트폴리오와 예시 게시물을 확인한 뒤 승인 또는 반려합니다. 승인해도 템플릿이 자동 공개되지는 않습니다.", action:"지원서 검토하기"}` + 영어. `app/(admin)/admin/page.tsx`에서 `platformReady`일 때만 건수 조회(아니면 0 — 기존 risk와 같은 처리).

## 6. 서버·도메인 변경 (파일별)

| 파일 | 변경 |
| --- | --- |
| `lib/creator-platform/contract.ts` | `PlatformInput`의 `format`에 `revisionOf: z.uuid().optional()`. 새 `CreatorApplicationInput` zod(§5.2 필드; `samples: z.array(z.string().max(2048)).min(1).max(3)`, `mediums: z.array(z.enum(['image','video'])).min(1)`, `rights: z.literal(true)`, `program: z.literal(true)`). |
| `lib/creator-platform/onboarding.ts` (신규, `import 'server-only'`) | `submitCreatorApplication(sql, viewer, raw, access)`: `demand(viewer.userId,'sign_in_required')`, `demand(!viewer.isAdmin,'forbidden')`, `demand(access.creators,'not_open')`, 파싱 → 트랜잭션: `lockUser`, `platform_rate_limits` 동일 upsert, `approvedCreator`면 `already_creator`, 열린 지원서 있으면 `already_open`, 24시간 내 지원 1건 초과면 `rate_limited`, `portfolioUrl`은 https·자격증명·포트 없음 검사, 각 sample은 `canonicalPost` 필수(정규화 URL 저장), insert. `loadCreatorWorkspace(sql, viewer)`: §2.4 허용 목록대로 지원서(최신 1건), 작가 행(`active, contract_version, created_at`), 포맷 목록(+`left join prompt_items` → `status, slug, reject_reason, price_krw, price_cents`), 정산 집계 SQL(아래). `creatorApplicationCount(sql)`(관리자 홈). |
| 정산 집계 SQL | 작가의 accepted 포맷 템플릿별: `orders` = `billing_payments p join render_jobs j on j.id=p.render_id where j.template_id=f.template_id and p.status='paid' and p.environment='live' and p.payment_type='NORMAL'` 건수; `settled` = 그 중 `platform_settlements s on s.render_id=j.id` 존재 건수; `pending = orders - settled`; `creatorDue = sum(s.creator_due)`. 환불(`p.status<>'paid'`)은 자동 제외. 구독·브랜드·무료 렌더는 조건상 제외. |
| `lib/creator-platform/service.ts` | `format` 분기: `revisionOf`가 있으면 `select id from platform_formats where id=$1 and user_id=$2 and status='rejected'` 확인(`not_found`), insert에 `revision_of` 포함. `platformHome()`은 변경하지 않음(허브 호환). |
| `lib/creator-platform/admin.ts` | `PlatformAdminInput`에 `application` 액션: `{id, decision: enum['approve','decline'], contract: string.max(120).optional(), note: string.max(1000).optional(), reason}` + superRefine(approve→contract 필수, decline→note 3자 이상). 처리: `for update` 행 잠금, 이미 결정된 행은 같은 결정이면 멱등 반환, 다르면 `conflict`; approve → `platform_creators` upsert(기존 creator 분기와 같은 SQL), 지원서 `approved, decided_by, decided_at, decision_note`; decline → `declined, decision_note`. 감사 details `{decision, contract}`(메모 본문은 감사에 넣지 않음). `format` 액션에 `note: string.max(1000).optional()` + superRefine(reject→필수); accept/reject 시 `review_note, reviewed_at=now()` 기록. |
| `lib/admin/platform-operations.ts` | parse는 문자열 통과라 변경 최소(새 키는 자동 포함). |
| `lib/admin/workflow.ts`, `app/(admin)/admin/page.tsx` | §5.5 큐 추가. |
| `lib/i18n/config.ts`, `lib/seo/sitemap.ts`, `app/sitemap.ts` | §2.2 등록. |
| `lib/creator-platform/links.ts` (신규, 순수) | 경로 상수·헬퍼. |
| `app/(marketing)/[locale]/creators/page.tsx` (신규) | §5.1. |
| `app/(app)/creators/apply/{page.tsx,actions.ts}` (신규) | §5.2. actions는 캠페인 지원 액션과 같은 골격(단일 export, `getViewer`, 서비스 호출, `redirect`). |
| `app/(app)/creators/workspace/page.tsx` (신규) | §5.3. |
| `components/community/format-form.tsx` (신규 client) | 허브의 `send('format')` 로직을 옮긴다. props: `copy`, `prefill?`, `revisionOf?`. 제출 성공 시 `window.location.assign('/creators/workspace?ok=format')`. |
| `components/community/hub.tsx` | 포맷 섹션 제거, §5.4 안내 줄. `requests` 키의 `'format'` 처리 제거. |
| `components/creators/*.tsx` (신규 server) | 상태 카드, 포맷 목록, 정산 표. |
| `components/marketing/chrome.tsx`, `app/(app)/account/page.tsx` | §5.4 링크. |
| `scripts/check-private-client.ts` | `privateModules`에 `lib/creator-platform/onboarding.ts` 추가. |
| `scripts/sweep-anon.ts` | §10 체크 추가. |
| `messages/ko.ts`, `messages/en.ts`, `messages/admin-workflow.ts` | §8 키. |
| `docs/CREATOR-PLATFORM.md`, `docs/qa/creator-platform.md` | §11. |

## 7. 관리자 오퍼레이션 요약

| 액션 (`platform.manage`) | 입력 | 효과 | 감사 |
| --- | --- | --- | --- |
| `application` approve | id, contract(필수), note(선택), reason | 지원서 approved + `platform_creators` active=true/contract/approved_by | `application` {decision:'approve', contract} |
| `application` decline | id, note(필수), reason | 지원서 declined + decision_note | `application` {decision:'decline'} |
| `format` accept | id, accept=true, note(선택), reason | 기존 + `review_note, reviewed_at` | 기존 |
| `format` reject | id, accept=false, note(필수), reason | 기존 + `review_note, reviewed_at` | 기존 |
| `creator` (기존) | id, active, contract, reason | 초대형 승인/해제 유지 | 기존 |

## 8. 사전 키 (ko/en 둘 다, `tests/i18n/dictionary.test.ts` 통과)

새 네임스페이스 `creatorProgram`:
`eyebrow, title, body, cta, workspaceLink, footerLink, definition, whoHeading, who1..3, stepsHeading, step1Title..step4Title, step1Body..step4Body, shareHeading, shareBody, privateHeading, privateBody, rulesHeading, rulesBody, distinction, unavailable, applyTitle, applyLede, applySignIn, fieldName, fieldPortfolio, fieldPortfolioHint, fieldSamples, fieldSamplesHint, fieldMediums, fieldTools, fieldMessage, fieldMessageHint, rights, program, programLinkLabel, submit, applied, appliedBody, alreadyOpen, declinedTitle, declinedBody, reapply, approvedLine, revokedTitle, revokedBody, formatsHeading, formatsEmpty, resubmit, reviewNote, templateState: {pending, published, preparing, rejected, archived}, viewTemplate, earningsHeading, earningsEmpty, colTemplate, colOrders, colPending, colSettled, colDue, errors: {not_open, already_open, already_creator, rate_limited, invalid, forbidden, sign_in_required, not_found}`.

`community`에 추가: `applicationsTitle, applicant, portfolio, samples, mediums, tools, about, decisionNote, decideApprove, decideDecline, noteRequiredHint, inviteTitle(기존 grant 폼 제목), formatNote, templateState, hubCreatorDoor, hubCreatorWorkspace`.

`adminWorkflow.tasks.creatorApplications {title, hint, action}`.

문안 규칙: 창업자 톤 완결문, 숫자는 80%만, "크레딧·충전·포인트" 금지, 영어를 한국어 칸에 복사 금지, 가격·송금 일정·최소 금액 언급 금지.

## 9. 테스트 (실패 → 구현 → 통과)

신규 `tests/creator-platform/onboarding.test.ts` (PGlite, `promptHarness`, `viewerOf`, `ADMIN_VIEWER`):

1. 지원: 익명 `sign_in_required`; `creators:false` → `not_open`; 관리자 → `forbidden`; 추가 속성(`isAdmin:true`) → `invalid`; 포트폴리오 `http://`·`javascript:`·자격증명 포함 → `invalid`; 예시 링크 미지원 호스트 → `invalid`; 정상 제출 → `loadCreatorWorkspace` 지원서 `submitted`, 샘플 URL이 정규화 형태.
2. 중복: 같은 사용자 두 번째 → `already_open`; 다른 사용자 공간에는 안 보임; 하루 2건째(반려 후 즉시 재지원 시뮬레이션은 `created_at` 조작) → `rate_limited`.
3. 승인: `application approve` 계약 라벨 없이 → `invalid`; 정상 승인 → `platform_creators.active=true, contract_version`, `approvedCreator` true, 지원서 `approved`, 감사 1건에 메모 본문 없음; 같은 승인 재전송 → 멱등; 반대 결정 → `conflict`; 승인된 사용자의 재지원 → `already_creator`.
4. 반려: 메모 없이 → `invalid`; 정상 → `declined` + `decision_note`가 작가 DTO에 보임; 재지원 가능 → 새 `submitted`.
5. 포맷 피드백: 반려 시 `note` 없이 → `invalid`; 반려+메모 → DTO `review_note`; `revisionOf`로 재제출 성공, 타인 행·accepted 행 `revisionOf` → `not_found`; DTO 전체 JSON에 `PRIVATE_RECIPE` 캐너리·`recipe`·`provider_cost`·`fees` 키 부재.
6. 템플릿 상태: accept 후 DTO `templateState='pending'`, slug 없음; `approvePrompt` 후 `published` + slug; `rejectPrompt` 후 `rejected` + `reject_reason`; `setPromptArchived` 후 `archived`. `prompt.update`를 `hidden` 유지로 호출해도 트리거 통과(회귀).
7. 정산 집계: live NORMAL paid 결제 1건 → `orders 1, pending 1, settled 0`; `settle` 후 `settled 1, creatorDue = marginSplit 결과`; 결제 `refunded` 후 orders/due에서 제외; `environment='test'`·`payment_type<>'NORMAL'` 제외; 다른 작가 DTO는 비어 있음.
8. 해제: `creator active=false` 후 포맷 제출 `forbidden`, 작가 공간 읽기는 유지(`creator.active=false`).

기존 파일 갱신:
- `tests/creator-platform/routes.test.ts`: `format` + `revisionOf` 전달이 `submitPlatform`에 그대로 가는지(모의), 플래그 off 403 유지.
- `tests/creator-platform/rls.test.ts`: 0138 적용 후 15개.
- `tests/db/migrations.test.ts`: 테이블 목록.
- `tests/i18n/locale.test.ts`, `tests/routes/cache-contract.test.ts`: `/creators/apply`, `/creators/workspace`, `/creators/apply/` → app path true; `/creators`, `/ko/creators`, `/creators/workspace/extra` → false. 캠페인 블록처럼 `actions.ts`가 단일 export·`getViewer`·`submitCreatorApplication`을 포함하는지.
- `tests/seo/*`(sitemap 테스트가 있으면): 플래그 입력 true/false에 따른 `/creators` 포함 여부, robots disallow.
- `tests/admin/auth.test.ts`: 자동.
- `tests/creator-platform/service.test.ts`: 기존 캐너리 유지, 포맷 섹션 제거로 깨지는 UI 테스트가 있으면 함께 수정.

수용 기준(사용자 관점):
- A. 플래그 on에서 익명이 `/ko/creators`를 열면 프로그램 설명·4단계·배분 기준·지원 버튼이 보이고, 버튼은 로그인 후 `/creators/apply`로 돌아온다.
- B. 지원서를 보내면 `/creators/workspace`에 "검토 중" 카드가 보인다. 두 번째 지원은 거부된다.
- C. 관리자가 `/admin/community#applications`에서 반려하면 작가 공간에 메모가 보이고 다시 지원할 수 있다. 승인하면 작가 공간에 포맷 제출 폼이 열린다.
- D. 포맷을 제출하면 "검토 중"으로, 관리자가 메모와 함께 반려하면 메모와 "수정해서 다시 제출" 버튼이 보이고, 수락 후 `/admin/prompts/[id]`에서 공개하면 작가 공간에 "공개됨 ↗" 링크가 뜬다.
- E. 정산 기록 전에는 "아직 판매 기록이 없어요", 로컬 픽스처로 결제·정산을 넣으면 건수와 확정 배분액이 보이며 "실제 송금 완료 금액은 아닙니다" 문장이 함께 있다.
- F. 어떤 응답(HTML/RSC/JSON)에도 레시피 본문이 없다(`security:client`, `security:built`, 테스트 캐너리).

## 10. 검증 루프와 증거

AGENTS §3 순서 그대로, 각각 로그 보관(커밋 제외):

```powershell
npm run db:local
npx tsc --noEmit
npx vitest run
npm run security:client
npm run build:local
npm run security:built
npm run start:local          # 별도 터미널
npm run sweep:anon           # SWEEP PASSED
```

스윕 추가(`scripts/sweep-anon.ts`, `/community` 블록 옆):
- `/creators/apply`, `/creators/workspace` 익명 → 302/303/307 + `signin=1`, 응답 no-store·noindex.
- `/creators` 무접두 → 308 → `/{locale}/creators`.
- `/ko/creators`, `/en/creators`: `process.env.TWINGS_FORMAT_CREATORS==='on'`이면 200 + `data-creator-program` + `data-creator-steps` + `PROMPT_SENTINELS`/`privateKeys` 부재; 아니면 404. 어느 분기였는지 로그에 남긴다(서버와 스윕을 같은 셸에서 띄운다).
- `/api/community` POST `{action:'format',revisionOf:'…'}` 익명 401 유지.

브라우저 증거(로컬 `.pglite/platform-qa` 방식, 플래그 on, 픽스처 계정): 프로그램 페이지(KO 데스크톱·KO 390·EN 320), 지원 폼·오류 상태, 작가 공간 5상태, 관리자 지원서 패널·포맷 메모. 스크린샷은 `docs/qa/screenshots/creator-onboarding-*.png`. 유료 생성·메일·실결제·클라우드 마이그레이션은 하지 않는다. `impeccable`/`web-design-guidelines` 체크는 새 세 페이지에 적용(가로 넘침, 44px 터치, 라벨 연결, 키보드).

보고: `git rev-parse HEAD`, `git diff --stat`, 명령별 출력 요약, 건너뛴 검사, 남은 위험. 커밋·푸시·PR은 Codex 검토 뒤.

## 11. 문서

- `docs/CREATOR-PLATFORM.md` "Operator activation contract" 3번 앞에 지원 절차 추가: 공개 페이지는 `TWINGS_FORMAT_CREATORS=on`일 때만 존재, 지원서→승인이 `platform_creators`를 만든다, 계약 버전 라벨 입력 규칙, 반려 메모는 작가에게 보인다, 승인은 템플릿을 공개하지 않는다, 0051/0138 "클라우드 적용 필요".
- `docs/qa/creator-platform.md`에 "Creator onboarding (2026-10-19)" 표: 주장/기능 증거/화면 증거 + 실제 실행 결과 숫자.
- `README.md` "Where things are"는 변경 없음(경로 추가가 필요하면 한 줄).

## 12. 대표 결정 필요 (임의로 정하지 않음)

1. **공개 문안 승인**: §5.1 프로그램 페이지와 지원서 문구는 외부 공개 문안이다. 구현은 초안으로 넣되 플래그를 켜기 전 대표 확인. 프로그램 명칭("포맷 작가" 유지 여부).
2. **노출 위치**: footer 링크 + 계정 페이지 + 허브 안내 줄까지만 넣는다. 상단 내비·랜딩 도어·FAQ 항목 추가 여부.
3. **작가 계약**: `contract_version` 라벨에 대응하는 실제 계약서·약관 변경(송금 일정·최소 금액·세금·KYC)은 범위 밖이며 운영 개방 전 필요.
4. **개인정보처리방침**: 지원서(활동명·포트폴리오 링크·예시 링크·소개·도구) 수집 항목·보관 기간 조항이 없다. 법무 문안은 대표 승인 경로. 운영에서 지원을 받기 전 선행 조건으로 표시.
5. **공개 크레딧**: 작가 포맷 템플릿 페이지에 `@handle`을 표기할지. 기본은 표기하지 않음(관리자가 approve 폼에서 handle을 비워 두면 됨).
6. **반려 후 재지원 간격**: 공학 기본값은 하루 1건·즉시 가능. 상업적 규칙이 필요하면 지정.
7. **승인된 포맷의 새 버전** 처리(템플릿 교체 vs 새 템플릿): 이 범위에서는 반려 건 재제출만 지원.
8. **알림**: 지원 결과·검수 메모를 메일로 보낼지. 이 범위는 화면 내 표시만(외부 발송 없음).
9. **프리뷰 플래그**: 프리뷰 배포에서 `TWINGS_FORMAT_CREATORS=on`을 켜서 확인할지(Vercel 환경변수 조작은 대표/Director).

## 13. Opus 구현 순서 (체크리스트)

1. 0051/0138 마이그레이션 + `db:local` + RLS/migrations 테스트 갱신(빨강 확인 후 초록).
2. `contract.ts`·`onboarding.ts`·`service.ts`(revisionOf)·`admin.ts`(application, format note) + `onboarding.test.ts` 1~8.
3. `links.ts`, `config.ts` 패턴, sitemap/robots, 라우팅 테스트.
4. 사전 키(ko/en/admin-workflow) — dictionary 테스트 통과.
5. `/[locale]/creators`, `/creators/apply`, `/creators/workspace`, `format-form.tsx`, 허브 정리, footer·account 링크.
6. 관리자 패널·홈 큐.
7. 스윕 체크, `check-private-client` 목록, 문서.
8. §10 전체 루프 + 스크린샷 + 보고. 커밋/푸시/PR/배포 금지(Codex 검토 후).
