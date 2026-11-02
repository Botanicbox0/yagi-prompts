# feat(brands): 조직별 기능 정책(기본 개방·예외 차단)과 B2B 플랜 기록, 브랜드 제품화 설계 문서, 저장소 지도

brand.twings.app 제품화(2026-11-03 대표 지시)의 첫 슬라이스(S1)다. 설계·결정·단계의 단일 원본은 `docs/BRAND-PRODUCT.md`.

## 무엇이 바뀌나

**기능 정책 — 기본 전체 개방, 예외는 조직별 차단 목록** (`docs/BRAND-PRODUCT.md` §4)
- `lib/brands/features.ts`: 기능 그룹 7개(`generative_media`·`sound`·`color_grading`·`brand_learning`·`campaigns`·`creator_pool`·`agent_access`). 엔진·경로가 아니라 "고객이 사는 것"의 이름이라 그룹 안의 새 화면은 자동으로 덮인다.
- `lib/brands/entitlements.ts`: `brand_feature_policies` 차단 목록. 행이 없으면 전부 허용. 관리자만 쓰고(프로필 `is_admin` 기준, viewer 플래그 불신), revision 충돌 검사, 모든 저장은 `brand_feature_policy_events`에 남는다. 표가 아직 없으면(마이그레이션 전) 워크스페이스는 전부 허용으로 동작한다.
- 적용 지점 3곳: 사이드바(`loadBrandWorkspaceScope`가 선택지마다 `denied`를 붙이고 `sectionVisibility`가 스튜디오 문을 닫음) · `/brand/studio` 페이지(`notFound()`) · 작업 시작(`reserveProduction` → `feature_unavailable`, API 404). 이미 만든 결과물은 그대로 본다.
- 관리자 조직 페이지(`/admin/brand-workspace/organizations/[id]`)에 "기능 정책" 패널(체크 = 차단) + 오퍼레이션 `brandEngine.featurePolicy`.

**B2B 플랜 기록** (§6.1)
- `lib/brands/plans.ts`: `b2b_39`·`b2b_69`·`b2b_99`(월 390,000·690,000·990,000원, 대표 결정). 조직에 플랜·청구 방식(`invoice`|`card`)·시작/종료일·좌석·메모를 **기록**한다(결제 아님). 관리자 "플랜" 패널 + `brandEngine.plan`. 기능을 플랜으로 가르지 않는다(포함 내용은 §6.2 제안, 대표 결정 대기).

**문서·지도**
- `docs/BRAND-PRODUCT.md`(신규): 대표 결정 8개, 현황, 제품 구조, 기능 정책, 고정 층 스키마(S2), 플랜·과금 제안, Argon의 자리, 엔진·비용 효율화, 노하우 이관, scenario-labs 차용, 저장소 가독화, 단계, 대표 결정 11개.
- `docs/research/brand-product-2026-11-03/` 조사 10편(브랜드 표면·엔진·과금·노하우·scenario skills·플랫폼·모델 단가·Argon·B2B 요금제·가독화).
- 루트 `ARCHITECTURE.md`(신규, 표면→호스트→route group→lib 41개→테이블, 요청 흐름 3개, 어디를 고치면 되나, 이름 유산) + `app/`·`lib/`·`components/`·`tests/` README + `docs/INDEX.md`·`README.md`·`AGENTS.md`(§1 읽기 순서, §3 테스트 수, §6 8번 행; §2 역할 문단은 작업 폴더에 있던 대표의 수정본을 함께 커밋) 갱신.

## 클라우드 적용 필요 (배포 **전**)
- `supabase/migrations/0074_core_brand_entitlements.sql` + `0150_glue_brand_entitlements.sql` — `brand_feature_policies`·`brand_feature_policy_events`·`brand_plan_assignments`·`brand_plan_events`(RLS 강제, 서버 롤만). 워크스페이스 로더는 표가 없어도 전부 허용으로 돌지만, 브랜드 렌더 예약(`reserveProduction`)은 표가 없으면 실패하므로 배포 전에 적용한다(운영에 브랜드 생산 계약은 0건이라 당장 영향은 없다).
- 배포 뒤, 대표 확인 후: Morphic 조직(`deb648e9-c2df-43d4-b2a7-7f9eff8180d9`)에 차단 목록 `generative_media, sound, color_grading` 저장 — 관리자 조직 페이지의 "기능 정책" 패널에서(SQL 대안은 BRAND-PRODUCT §4.5). 적용되면 Morphic 계정의 사이드바에서 스튜디오가 사라지고 `/brand/studio`는 404가 된다. 캠페인·후보·리포트·라이브러리는 그대로.

## 검증 (2026-11-03, D:\dev\twings main 119f4ea2 + 이 변경)
- `npx tsc --noEmit` — 통과
- `npx vitest run` — 370 파일 / 3,600 테스트 전부 통과(새 `tests/brands/entitlements.test.ts` 7개 포함: 기본 개방, 관리자 전용·revision 충돌·이벤트, 사이드바 문 닫힘, 렌더 예약 거절, 플랜 기록, 레지스트리 경유)
- `npm run build:local` — 통과(PGlite 스냅샷 재생성 포함)
- `npm run start:local` + `npm run sweep:anon` — **SWEEP PASSED 1303/1303**
- GitHub Actions는 결제 문제로 안 돌 수 있다(2026-10-29~). 로컬 결과가 기준.

## 남은 위험
- 관리자 조직 페이지의 새 패널 2개는 vitest 렌더가 아니라 로컬 모드 화면 확인이 필요하다(스크린샷은 다음 슬라이스에서 docs/evidence에).
- `ADMIN(admin.twings.app) 전면 개선` 세션이 `lib/admin/operations.ts`·관리자 조직 페이지를 재구성 중이다(브랜치 `claude/admin-overhaul-28f6ca`). 이 PR의 추가분은 import 1줄 + 스프레드 1줄 + 섹션 2개라 머지 충돌 시 그대로 옮기면 된다.
- `supabase/README.md` "다음 번호"를 core 0076 / glue 0152로 바꿨다(0075/0151은 S2 고정 층이 쓴다).

## 다음
S2 고정 층(브랜드 아이덴티티·절대 규칙·메모리·룩, 0075/0151, `/brand/identity`) → S3 얼굴 없는 생성·촬영 지시서 → S4 로컬 GPU 마감 워커 → S5 Argon 사운드 디렉터(충전 결정 뒤) → S6 과금(약관 별지·토스 빌링 계약 뒤). 대표 결정 11개는 BRAND-PRODUCT §13.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
