# CAMPAIGNS — 유가 캠페인 설계 (v1, 2026-09-03)

> 대표 지시: "정해진 영상 포맷을 우리가 만들어놓으면 크리에이터들이 지원하고, 포스팅하고 링크를 올리면
> 수익을 가져간다. 수익은 7일 후 조회수 기반 혹은 포스팅 완료 7일 이후 취득." 참고: Brandazine
> 셀프 캠페인(MORPHIC 워크스페이스에서 실제 운영한 두 캠페인 — 프롬퀸 13명 선정/12편, 90년대 인터뷰 14편,
> 중위 조회 7,811).

## 0. 한 문장

**캠페인 = 클라이언트가 의뢰한 하나의 영상 포맷(템플릿)을, 선정된 크리에이터들이 자기 얼굴로 만들어
SNS에 올리고, 링크를 제출하면 검수 → 7일 홀드 → 정산되는 상품.** 콘테스트(다수 경쟁·소수 수상)의
사촌이지만 돈의 방향이 다르다: 콘테스트는 상금 소수, 캠페인은 선정된 모두에게 원고료.

## 1. Brandazine에서 배운 것 / 우리가 더 잘하는 것

| Brandazine (관찰) | TWINGS 캠페인 |
|---|---|
| 단계: 캠페인 시작 → 크리에이터 선정 → 진행(발송) → 콘텐츠 → 진단 | 동일한 5단계를 **상태 머신으로 코드에** 둔다(테스트 있음) |
| "업로드 지연" 배지, 크리에이터 699명 조회 | 지원자 수 · 선정 · 게시 · 검수 · 정산 카운터 + 업로드 D-day 지연 상태 |
| 콘텐츠별 조회/참여율/저장율, 중위값 | 7일차 조회수 스냅샷을 **정산의 입력값**으로 저장(v1 자진신고+관리자 확인, v2 API) |
| 원고료 미지급(아이템 협찬만) | **정산 규칙 3종**: 고정 / 조회수 기반 / 혼합, 상·하한, 7일 홀드 — 상세 페이지에 숫자로 명시 |
| 2차 활용 라이선스 협의 | 캠페인 옵션(`license`: 없음/포함/협의) — v2 |
| 포맷은 브리프 텍스트 | **포맷 = 스튜디오 스타일(프롬프트)**: 크리에이터가 사진 1장으로 우리 파이프라인에서 생성 → 포맷 통일, 업로드 지연 구조적 감소 |
| 광고 표기 안내 없음 | 요구사항에 `#광고` 표기 필수 옵션(표시·광고법) + 해시태그/멘션 목록 |

## 2. 역할과 흐름

```
[클라이언트] 메일/미팅 → 관리자가 캠페인 초안 작성(어드민) → 공개(모집)
[크리에이터] 캠페인 목록 → 상세(브리프·포맷 예시 영상·정산 규칙·일정) → 로그인 → 지원(한 줄 어필 + SNS + 팔로워 수)
[관리자]    지원자 큐 → 선정/거절 (슬롯 수만큼)
[크리에이터] 선정 알림 → (스튜디오에서 사진으로 영상 생성) → SNS 게시 → 링크 제출
[관리자]    게시물 검수: 링크 열림·플랫폼 일치·요구사항(해시태그/#광고) → 승인(verified, hold_until=+7일) / 반려(재제출 가능)
[시스템]    홀드 종료 → 정산 대기 큐 (조회수 기반이면 7일차 조회수 입력 → 금액 계산)
[관리자]    지급 처리 → paid (지급 참조번호 기록) → 크리에이터 알림
[클라이언트] 캠페인 종료 리포트(게시 수·중위 조회·총 정산) — v2
```

## 3. 상태 머신

**Campaign**: `draft → recruiting → selecting → running → closed → archived` (draft→archived 가능).
- recruiting: 지원 접수 중(`applications_close_at` 전) · selecting: 접수 마감, 선정 중 · running: 게시 기간(`post_deadline_at` 전) · closed: 마감 후, 정산 진행/완료.

**Application**: `applied → selected | declined | withdrawn` · `selected → posted | withdrawn | expired(마감 미게시)` ·
`posted → verified | rejected` · `rejected → posted(재제출)` · `verified → paid`.
- `hold_until = verified_at + hold_days(기본 7)`. 홀드 종료 전 지급 불가(코드로 금지).

## 4. 정산 규칙 (payout rule) — 캠페인마다 하나

```
model: 'flat' | 'per_view' | 'hybrid'
flat_cents            고정 원고료 (flat/hybrid)
per_1k_views_cents    조회 1,000회당 단가 (per_view/hybrid)
min_cents / max_cents 하한/상한 (per_view/hybrid; 상한 null = 없음)
currency              'KRW' (v1 고정; 정수 원 단위 저장)
hold_days             7
metrics_at            'verified+hold' — 조회수 스냅샷 시점 = 홀드 종료일
```
계산은 `lib/campaigns/payout.ts`의 순수 함수 하나. 상세 페이지의 문장은 이 규칙에서 생성한다("고정 30,000원, 검수 후 7일 뒤 지급" / "1,000회당 500원, 최소 10,000원 · 최대 100,000원").

## 5. 데이터 (마이그레이션 0013 + RLS 0106)

- `campaigns`: id, slug, status, title/summary{en,ko}, brief(markdown{en,ko}), host_name/kind/url(콘테스트와 동일 어휘), media(poster), **style_slug**(스튜디오 스타일=프롬프트 slug, nullable), platforms text[] (instagram/tiktok/youtube), deliverable text, slots int, applications_close_at, post_deadline_at, payout jsonb(§4), requirements jsonb {hashtags[], mentions[], disclosure bool, notes{en,ko}}, budget_cents(클라이언트 예산, 내부용), created/published/updated_at.
- `campaign_applications`: id, campaign_id, creator_id→profiles, status, pitch, sns_url, follower_count, selected_at, post_url, post_platform, posted_at, verified_at, hold_until, views_snapshot int, metrics_source('self'|'admin'|'api'), payout_cents, paid_at, payout_ref, reject_reason, created/updated_at(version 토큰 — 콘테스트 엔트리와 동일 방식). **UNIQUE(campaign_id, creator_id)**.
- `campaign_application_writes`: 지원 남용 방지(콘테스트 `contest_entry_writes`와 동일, 하루 10회).
- RLS: deny-all + 서비스 롤(콘테스트 0104 동일). 공개 읽기는 캐시된 프로젝션(`campaigns` 태그)으로만.

## 6. 화면

- **공개** `/[locale]/campaigns`(모집 중 우선, 카드: 포스터·원고료·슬롯·마감 D-day), `/[locale]/campaigns/[slug]`(브리프, 포맷 예시 영상=스타일의 결과물, 정산 규칙 문장, 요구사항, 타임라인, 지원 버튼). 네비에 "캠페인" 추가(콘테스트 옆).
- **크리에이터** `/campaigns/[slug]/apply`(로그인 게이트, 콘테스트 submit과 같은 JS-free POST), `/campaigns/mine`(내 지원 현황: 상태 스텝바, 링크 제출 폼, 홀드 카운트다운, 정산 상태).
- **어드민** `/admin/campaigns`(카드 보드: 지원/선정/게시/검수/정산 카운터), `/admin/campaigns/new`, `/admin/campaigns/[id]`(빌더 + 큐 3개: 지원자·게시물 검수·정산 대기). 모두 `/admin/do` 오퍼레이션(`campaign.*`, `campaignApplication.*`).
- **알림**(§3.5 outbox 재사용): 선정, 검수 승인/반려, 지급 완료, 게시 마감 D-1.

## 7. 대표 결정 필요 (기본값으로 v1 진행, 바꾸면 규칙만 수정)

1. **정산 모델 기본값**: hybrid(기본료 + 1,000회당 단가, 상한) 추천 — 크리에이터는 최소 보장, 클라이언트는 성과 연동.
2. **원천징수/지급 방식**: v1은 **수동 정산**(관리자가 계좌이체 후 `paid`+참조번호 기록, 시스템은 명세·합계 관리). 3.3% 사업소득 원천징수와 주민번호·계좌 수집은 지급대행(v2)으로 — 민감정보를 우리 DB에 두지 않기 위함.
3. **조회수 소스**: v1 크리에이터 자진신고(7일차 숫자+캡처) + 관리자 확인. v2 YouTube Data API(공개), Instagram은 크리에이터 비즈니스 계정 연동이 필요해 후순위.
4. **클라이언트 과금**: v1 오프라인 계약(세금계산서), 시스템은 예산·집행 추적만. 플랫폼 수수료율은 캠페인 필드(내부용).
5. **광고 표기 필수** 기본 ON(`#광고`) — 표시·광고법 위반은 브랜드·크리에이터 모두의 리스크.

## 8. 단계

- **v1 (지금)**: 도메인(§3·§4, 테스트) → 0013/0106 → 리포지토리 → 어드민 빌더·큐 → 공개 목록/상세 → 지원/링크 제출/내 현황 → 사전(ko/en) → 스윕.
- **v2**: 스튜디오 생성 연동(실인물 자산), 지급대행, 조회수 API, 클라이언트 리포트, 라이선스 협의, 진단.

### v1 구현 상태 (2026-09-05)

| 조각 | 위치 | 상태 |
| --- | --- | --- |
| 도메인·상태기계·정산 계산 | `lib/campaigns/{schemas,state,copy}.ts` | 완료 (테스트 `tests/campaigns/state.test.ts`) |
| DB | `0013_core_campaigns`, `0014_core_campaigns_format_is_style`, `0106_glue_campaigns_rls` | 클라우드·PGlite 적용 |
| 어드민 오퍼레이션 | `lib/admin/campaign-operations.ts` (`campaign.*`, `campaignApplication.*`) | 완료 (`tests/campaigns/operations.test.ts`) |
| 공개 목록/상세 | `app/(marketing)/[locale]/campaigns/…` | 완료, 캐시 태그 `campaigns` |
| 크리에이터 지원/링크/조회수 | `lib/campaigns/service.ts`, `app/(app)/campaigns/[slug]/apply`, `app/(app)/campaigns/mine` | 완료 (`tests/campaigns/service.test.ts`) — 엣지 게이트 `isCampaignAppPath` |
| 어드민 보드/빌더/큐 | `app/(admin)/admin/campaigns/{page,new,[id]}` + `components/admin/campaign-fields.tsx` | 완료 — 정산 대기열은 보드 맨 위 |
| 알림(선정·검수·지급·D-1) | §3.5 outbox | **미구현** — v1.1 |
| 조회수 API 수집 | `metrics_source='api'` 자리만 | v2 |

운영 순서(어드민): 새 캠페인(초안) → 원고료·두 마감일·인원 채우고 **모집 중**으로 → 지원자 큐에서 선정/미선정 → **선정 중**(이때부터 크리에이터가 링크 제출 가능) → 검수 대기 큐에서 검수 통과/반려 → 홀드 종료 후 보드 상단 정산 대기열에서 이체 참조 기록 → **종료**.
