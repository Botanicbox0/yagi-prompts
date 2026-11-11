# BRAND-STORAGE-QUOTAS-F — 조직별 저장 한도 설계 및 플랜별 원가 제안 (2026-11-11)

> 묶음 F 설계 문서 (`HANDOFF-2026-11-11-GEMINI.md` §4-F).
> 한도 숫자와 비구독 외주 고객 보관 기간은 **제안값**이며, 최종 확정은 대표(윤병삼) 결정 사항(`AGENTS.md` §5, 핸드오프 §7-5)이다.

---

## 1. 목표와 하지 않을 것

### 목표
1. **실측 기반 원가 산정**: 현재 운영 저장소(Cloudflare R2 · Supabase Storage)의 버킷·경로·조직별 실사용량을 바이트 단위로 측정하고, 공식 단가표 기준 월 원가와 매출 대비 원가율을 계산해 플랜별 기본 한도안을 제시한다.
2. **플랜 기본값 + 관리자 조직별 덮어쓰기**: 조직의 배정 플랜(`b2b_39`, `b2b_69`, `b2b_99`, `project_only`, `unassigned`)에서 기본 저장 한도와 보관 기간을 가져오되, 관리자가 `/admin/brand-workspace/organizations/[id]`에서 조직별 한도(`quota_bytes`)·보관 기간(`retention_days`)을 덮어쓰고 이력을 남길 수 있게 한다.
3. **누적 집계 + 중복 없는 전체 재계산(`reconcile`)**:
   - 파일 업로드 예약·확정 및 삭제 시 바이트 증감을 즉시 반영하고,
   - 관리자 수동 실행 또는 주기적 점검 시 `storage_key` 기준으로 중복을 제거해(`brand_studio_assets`로 저장된 생성물·시안과 `brand_studio_outputs` 중복 방지) 정확한 바이트 합계와 항목별 내역(`breakdown`)을 맞춘다.
4. **알리는 것(`80%`)과 막는 것(`100%`)의 분리**:
   - **80% 이상 (`near_limit`)**: 업로드·생성은 허용하되 에셋·설정 화면에서 잔여 용량 안내 배너를 표시한다.
   - **100% 이상 (`exceeded`)**: **새 파일 업로드만 차단**(`storage_quota_exceeded`, HTTP `413`/`409`)하고, 기존 작업물 열람·다운로드·시안 승인·대화·파일 삭제는 절대 막지 않는다(고객이 직접 불필요한 파일을 지워 공간을 비울 수 있어야 한다).
5. **지운 파일의 실제 물리 삭제(`physical-cleanup`)**:
   - 고객이 스튜디오 에셋·출력물을 삭제했을 때 DB 참조(`!keyStillUsed`)가 0건이 된 `st/` 오브젝트(및 썸네일)를 R2 / 로컬 `.storage`에서 실제로 지우고 사용량을 즉시 차감한다.
   - 기존 `StorageDriver`의 write-once 인터페이스는 건드리지 않고 전용 정리 모듈(`lib/brand-studio/physical-cleanup.ts`)로 분리하며, **기존 운영 데이터·오브젝트를 임의로 일괄 삭제하지 않는다**(핸드오프 §2-6 준수).

### 하지 않을 것
- 대표 승인 전 플랜 요금표·약관 문구(`lib/legal/documents.ts`, 공개 요금 페이지) 수정 금지.
- 대표 승인 전 비구독 외주 고객(`project_only`)의 만료 파일 자동 물리 삭제 실행 금지(만료 대상 조회·관리자 표시까지만 구현하고 자동 삭제 스위치는 꺼 둔다).
- 모픽(`Morphic`) 및 샌드박스 조직(`d425c3b1-...`, `deb648e9-...`, `denied: ['generative_media']`)에 스튜디오·보관함·프로젝트 룸 UI나 배너 노출 금지(기존 화면과 바이트 단위로 동일하게 유지).

---

## 2. 운영 저장소 실측 결과 (2026-11-11 기준, 읽기 전용 측정)

### 2.1 저장소 전체 사용량

| 저장소 | 구분 (`bucket` / prefix) | 오브젝트 수 | 실사용 바이트 | 용량 (MiB / GB) | 비고 |
| --- | --- | ---: | ---: | ---: | --- |
| **Cloudflare R2** (`twings-media-apac`) | `(root)` 공개 쇼케이스·카탈로그 | 127 | `742,675,160 B` | `708.3 MiB` | 조직 한도 외 공통 자산 |
| **Cloudflare R2** (`twings-media-apac`) | `ig-master/` | 2 | `53,689,530 B` | `51.2 MiB` | 공통 마스터 미디어 |
| **Cloudflare R2** (`twings-media-apac`) | `st/` (브랜드 스튜디오·룸) | 25 | `19,192,835 B` | `18.30 MiB` | **조직별 저장 한도 집계 대상** |
| **Cloudflare R2 합계** | 전체 | **154** | **`815,557,525 B`** | **`777.8 MiB` (`0.82 GB`)** | 무료 구간(`10 GB`) 이내 |
| **Supabase Storage** | `content` (캠페인 납품물 등) | 389 | `756,009,570 B` | `721.0 MiB` | 구형·캠페인 공용 버킷 |
| **Supabase Storage** | `public-content` | 14 | `361,476,598 B` | `344.7 MiB` | 공개 미디어 |
| **Supabase Storage** | `renders` (개인 앱 렌더) | 12 | `40,661,671 B` | `38.8 MiB` | 소비자 단건 렌더 |
| **Supabase Storage 합계** | 전체 | **415** | **`1,158,147,839 B`** | **`1,104.5 MiB` (`1.16 GB`)** | Free `1 GB` 한도 초과 상태 (`SCALE-RISKS` R-01) |

### 2.2 조직별 상세 실사용량 (`storage_key` 중복 제거 기준)

| 조직 | 배정 플랜 | 스튜디오 업로드 | 미저장 생성 결과 | 저장된 생성물 | 스토리보드 컷 | 시안·룸·의뢰 첨부 | 조직 합계 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 야기워크숍 테스트 (`org_1`) | `unassigned` | `17.03 MiB` (`17,855,643 B`) | `1.13 MiB` (`1,181,174 B`) | `0 B` | `85.6 KiB` (`87,696 B`) | `0 B` | **`18.24 MiB` (`19,124,513 B`)** |
| 샌드박스 고객사 2곳 (`Morphic` 등) | `unassigned` | `0 B` | `0 B` | `0 B` | `0 B` | `0 B` | **`0 B`** (`st/` 기준) |

> R2 `st/` 물리 합계(`19,192,835 B`)와 DB 중복 제거 합계(`19,124,513 B`)의 차이 `68.3 KiB`는 파생 WebP 썸네일 크기이며, 원본 삭제 시 썸네일도 함께 정리한다.

---

## 3. 공식 저장·전송 단가 및 플랜별 한도 제안표

### 3.1 클라우드 공식 단가 비교 (`1 USD = 1,400원` 환산)

| 항목 | Cloudflare R2 (Standard, 현재 `st/` 주 저장소) | Supabase Storage (Pro 월 \$25 기준) | 설계 판단 |
| --- | --- | --- | --- |
| 기본 무료 / 포함량 | 월 `10 GB` 저장 + 쓰기 100만 건 + 읽기 1,000만 건 상시 무료 | 월 `100 GB` 저장 + Uncached 전송 `250 GB` 포함 | 브랜드 미디어(`st/`)는 전량 **R2** 유지 |
| 초과 저장 단가 | **\$0.015 / GB-월** (약 **21원 / GB-월**) | \$0.0213 / GB-월 (약 30원 / GB-월) | R2가 30% 저렴 |
| 전송(Egress) 단가 | **\$0.00 / GB (무제한 무료)** | Uncached **\$0.09 / GB** (약 **126원 / GB**), Cached \$0.03 / GB | 시안 영상 반복 재생 시 R2 전송비 **0원**이 결정적 |

### 3.2 플랜별 기본 저장 한도 제안표 (대표 결정 대기 — 핸드오프 §7-5)

플랜 월 요금은 `docs/BRAND-PRODUCT.md` 확정값(`390,000원` / `690,000원` / `990,000원`)을 따르며, 한도를 100% 채웠을 때의 최대 R2 원가가 월 구독료의 **1.1% 이하**에 머물도록 산정했다.

| 플랜 ID | 플랜 구분 (월 요금, VAT 별도) | 제안 기본 한도 | 최대 채움 시 R2 월 원가 | 매출 대비 저장 원가율 | 보관 정책 제안 |
| --- | --- | ---: | ---: | ---: | --- |
| `b2b_39` | Starter (`390,000원/월`) | **`50 GB`** | 약 **`1,050원/월`** (\$0.75) | `0.27%` | 구독 유지 중 상시 보관 |
| `b2b_69` | Growth (`690,000원/월`) | **`200 GB`** | 약 **`4,200원/월`** (\$3.00) | `0.61%` | 구독 유지 중 상시 보관 |
| `b2b_99` | Scale (`990,000원/월`) | **`500 GB`** | 약 **`10,500원/월`** (\$7.50) | `1.06%` | 구독 유지 중 상시 보관 |
| `project_only` | 비구독 프로젝트 전용 (건별 계약) | **`30 GB`** | 약 **`630원/월`** (\$0.45) | 건별 원가 미미 | 진행 중 `30 GB` · 최종 납품 후 **`90일` 보관** |
| `unassigned` | 플랜 미배정 (초기·내부 테스트) | **`10 GB`** | 약 **`210원/월`** (\$0.15) | R2 무료 구간 내 | 관리자 개별 조정 가능 |

---

## 4. 검토한 대안과 버린 이유

1. **매 업로드마다 전체 테이블 `SUM(bytes)` 실시간 스캔 vs 누적 카운터 + 재계산(`reconcile`) 병행**:
   - 매 업로드마다 5개 테이블 조인·중복 제거 집계를 돌리면 에셋이 수만 개일 때 업로드 예약 지연이 커진다.
   - 따라서 `brand_storage_quotas.used_bytes`에 증감(`delta`)을 원자적으로 반영해 `O(1)`로 한도를 검사하고, 재계산 함수(`reconcileOrganizationStorage`)로 언제든 실제 DB 참조 합계와 정확히 일치시키는 혼합 방식을 채택했다(테이블이 아직 없거나 첫 조회인 조직은 즉시 계산으로 자동 초기화).
2. **한도 100% 초과 시 생성 작업까지 즉시 실패 vs 직접 파일 업로드만 우선 차단**:
   - 진행 중이거나 재시도 중인 스튜디오 작업이 한도 경계에서 깨지면 크레딧 환불·정합성 문제가 생긴다.
   - 따라서 **고객이 새로 올리는 파일(스튜디오 에셋 업로드, 프로젝트 룸 첨부·시안·스토리보드 업로드)** 입구에서 `checkStorageQuotaForUpload`로 선제 차단하고, 기존 열람·다운로드·삭제·승인과 야기 팀 관리자 납품 업로드는 막지 않는다.

---

## 5. 데이터 모델 (`0086_core` · `0161_glue`)

> 묶음 E(`0085_core` / `0160_glue`)와 어떤 순서로 병합해도 충돌하지 않도록 `0086_core_brand_storage_quotas.sql` / `0161_glue_brand_storage_quotas.sql` 번호를 사용한다. 스키마 미적용 환경에서도 `isMissingTable` 폴백으로 서비스가 깨지지 않는다.

- **`public.brand_storage_quotas`**:
  - `organization_id uuid primary key references public.brand_organizations(id) on delete cascade`
  - `quota_bytes bigint null check (quota_bytes is null or quota_bytes >= 0)` — `null`이면 배정 플랜의 기본 한도를 따름, 숫자가 있으면 관리자 조직별 덮어쓰기 한도
  - `used_bytes bigint not null default 0 check (used_bytes >= 0)`
  - `breakdown jsonb not null default '{}'::jsonb` — `{ studioUploadsBytes, studioSavedBytes, studioUnsavedOutputsBytes, roomDeliveriesBytes, storyboardBytes, roomMessageAttachmentsBytes, projectAttachmentsBytes }`
  - `retention_days integer null check (retention_days is null or (retention_days >= 1 and retention_days <= 3650))` — 프로젝트 종료 후 보관 일수 덮어쓰기(`null`이면 플랜 기본값)
  - `reconciled_at timestamptz null`
  - `revision integer not null default 1`
  - `note text not null default ''`
  - `updated_by uuid null references public.profiles(id) on delete set null`
  - `updated_at timestamptz not null default now()`
- **`public.brand_storage_quota_events`** (변경 감사 로그):
  - `id uuid primary key default gen_random_uuid()`, `organization_id`, `revision`, `previous_quota_bytes`, `next_quota_bytes`, `previous_retention_days`, `next_retention_days`, `used_bytes_snapshot`, `reason`, `actor_user_id` (`references public.profiles(id) on delete set null`), `created_at`
- **권한(`0161_glue`)**: `0150_glue_brand_entitlements.sql`과 동일한 deny-all(`enable/force row level security`, `public/anon/authenticated` 권한 회수, `service_role` 전용 허용, `create policy` 미사용) 보안 모델 적용.

---

## 6. 실패 시 동작 · 측정 지표 · 되돌리는 방법

- **실패 시 동작**:
  - 마이그레이션 미적용 상태에서도 `isMissingTable` 폴백으로 기존 테이블 바이트 합산 + 플랜 기본 한도로 정상 계산된다.
  - 물리 파일 삭제(`physical-cleanup.ts`) 중 R2 일시 네트워크 오류가 나더라도 DB 삭제 트랜잭션은 성공으로 응답하고 경고 로그를 남겨 사용자 삭제 동작이 막히지 않게 한다(`reconcile`은 참조 테이블 기준이므로 고객 한도는 즉시 줄어든다).
- **측정할 숫자**:
  - 조직별 `used_bytes / effective_quota_bytes` 비율(`ok < 80%`, `near_limit 80~99.9%`, `exceeded >= 100%`)
  - R2 `st/` 물리 총량과 전 조직 `used_bytes` 합계의 오차(고아 오브젝트 감시 지표)
  - `project_only` 조직 중 마지막 납품 후 `retention_days` 경과 조직 수(`dry-run` 리포트)
- **되돌리는 방법**:
  - 코드 롤백만으로 업로드 게이트와 UI 배너가 즉시 해제되며, `0086`/`0161` 테이블은 기존 테이블에 외래키 제약을 걸지 않는 독립 부가 테이블이므로 다른 기능을 깨뜨리지 않는다.
