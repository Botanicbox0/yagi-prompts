# feat(brands): S2 고정 층 — 브랜드 아이덴티티·메모리·룩 (`0075`/`0151`, `/brand/identity`)

`docs/BRAND-PRODUCT.md` §5에 정의된 브랜드 미디어 엔진의 **고정 층(S2: 아이덴티티 · 절대 규칙 · 작업 기억 · 결정론적 룩)**을 구현합니다.

## 1. 클라우드 적용 필요 (코드 배포 전)

Supabase 프로젝트 `nhokkikjkzjalxqsbzuk`에 아래 두 마이그레이션을 코드 배포 **전**에 적용해야 합니다(`#176`의 `0074`/`0150` 적용 뒤):

- `supabase/migrations/0075_core_brand_identity.sql` — `brand_identities`, `brand_identity_events`, `brand_memory_events`, `brand_looks` 4개 테이블 및 CHECK/인덱스
- `supabase/migrations/0151_glue_brand_identity.sql` — 4개 테이블 RLS 활성화·강제(`ENABLE` + `FORCE`), `public,anon,authenticated` 권한 전부 회수, `service_role`에만 권한 부여

## 2. 변경 내용

- **스키마 (`lib/brands/identity/schema.ts`)**
  - `BrandIdentitySchema`: 컬러 팔레트 9색(`#rrggbb` + `lib/design/identity.ts`의 `contrast()`로 강조색 위 흰 글자 ≥ 4.5:1, 잉크/캔버스 ≥ 7:1, 본문/종이 ≥ 4.5:1 강제), 서체·크기 위계, 세계관 색조 범위(`ownedHue` 0..360, `skinProtected: true`), 내부 모델 역할(`modelRoles`), 절대 규칙(`never` ≤ 3, `consentedFacesOnly: true`, 로고 최소 크기·여백·위치), 참조 이미지 역할 분리(`references` ≤ 14), 제품 정합성 체크리스트(`productChecklist` ≤ 20), 브랜드 보이스(`voice`).
  - `twingsDefaultIdentity()`: `lib/design/identity.ts`의 고정 값으로 채운 기본 기준표.
- **서비스 (`lib/brands/identity/service.ts`)**
  - `loadBrandIdentity`, `confirmedIdentityFor` (`status === 'confirmed'`이고 `brand_learning` 기능이 열려 있을 때만 `ConfirmedBrandIdentity` 반환; `draft`이거나 차단된 조직이면 `null` 반환하여 엔진이 미확정 초안을 읽지 못하도록 강제).
  - `saveBrandIdentity`, `confirmBrandIdentity`, `draftFromTwingsDefaults` (조직 `owner` 또는 `admin`만 가능, 낙관적 동시성 `expectedRevision` 검증, `brand_identity_events` 이력 기록).
  - `recordMemory` / `listMemory`, `saveLook` / `listLooks` (`owner` / `editor` / `admin` 가능, `brand_learning` 정책 연동).
- **브랜드 워크스페이스 화면 (`app/(brand)/brand/identity/page.tsx`) 및 라우팅**
  - `brand_learning` 차단 조직은 `notFound()`.
  - 상태 배지(`초안 (미반영)` / `확정 (반영 중)` / `미등록`), 컬러 팔레트 스와치 + 실시간 명도 대비 배지, 서체 위계, 세계관 색조·피부 보호, 절대 규칙·로고 기준, 참조 역할 분리, 제품 체크리스트, 보이스, 저장된 브랜드 룩, 작업 기억 타임라인.
  - `lib/routing/surfaces.ts`, `lib/brands/workspace/selection.ts`, `components/brand-workspace/access.ts`, `components/brand-workspace/navigation.tsx`, `app/(brand)/layout.tsx`, `app/api/brand-workspace/route.ts`, `components/brand-workspace/action-form.tsx`, `scripts/sweep-anon.ts` 등록.
- **관리자 조직 상세 패널 (`app/(admin)/admin/brand-workspace/organizations/[id]/page.tsx`, `lib/admin/brand-engine-operations.ts`)**
  - `brandEngine.identityDraft`, `brandEngine.identityConfirm` 오퍼레이션 등록 및 `[data-brand-identity-admin]` 패널 추가.
- **다국어 사전 (`messages/ko.ts`, `messages/en.ts`)**
  - `brandWorkspace.identityLayer.*` 및 `brandWorkspace.managed.identity*` 추가 (로컬 Gemma 4 `yagi-crm-gemma4:31b-q8_0` 검수 반영).

## 3. 검증 결과

- `npx tsc --noEmit` — 통과 (오류 0)
- `npx vitest run` — **371 파일 / 3,605 테스트 전부 통과** (`tests/brands/identity.test.ts` 신규 5개 스위트 포함)
- `npm run build:local` — 통과 (`/brand/identity` 동적 라우트 빌드 확인)
- `npm run sweep:anon` — **SWEEP PASSED — 1308/1308 checks passed** (`/brand/identity` 익명 접근 시 로그인 리다이렉트 및 `private, no-store`, `noindex, nofollow` 확인)
- 로컬 스크린샷 증거: `docs/evidence/brand-identity/` (`brand-identity-1440-ko.png`, `brand-identity-390-ko.png`, `brand-identity-1440-en.png`, `brand-identity-390-en.png`)
