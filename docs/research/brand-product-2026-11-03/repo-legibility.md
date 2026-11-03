# TWINGS 저장소 가독화·효율화 감사 (repo-legibility)

- 기준: `D:\dev\twings` main `119f4ea2`, 2026-11-03 읽기 전용 감사. 코드·문서는 바꾸지 않았고 npm 스크립트·유료 API는 쓰지 않았다.
- 대표 지시(2026-11-03): "타 AI가 가시적으로 어떤 구조인지 이해하기 편하게, 코드·폴더 구조 효율화".
- 방법: 트리 전수 집계(스크립트), 폴더별 대표 파일 1~2개의 머리말 주석, import 참조 수 grep, docs 50개의 첫 줄·마지막 커밋일·INDEX 수록 여부 대조. 숫자는 전부 이 날짜의 저장소 실측이며 외부 출처는 없다.

## 0. 결론 먼저

1. **코드 자체는 도메인별로 잘 쪼개져 있다**(lib 41개 폴더, tests 41개 폴더가 거의 1:1). 헷갈리는 것은 코드가 아니라 **이름 유산과 지도 부재**다. "표면(consumer/brand/admin) → 호스트 → route group → lib 도메인 → 테이블"을 한 장으로 적은 문서가 **없다**(docs 전체에서 "route group" 0건, "ARCHITECTURE" 0건).
2. 첫 세션의 AI는 `AGENTS.md`(12KB) → `docs/INDEX.md`(3KB) → `docs/PLATFORM-2.0.md`(67KB, 816줄)를 읽어야 하는데, 정작 코드 주석 수백 곳이 가리키는 "PLAN §7·§13"의 원본 `PLAYBOOK-PLAN.md`(루트, 87KB, 2026-08-12)는 INDEX 어디에도 없다. 새 AI는 "PLAN"이 무엇인지 모른 채 시작한다.
3. 가장 싼 개선은 **문서 3개 추가**(루트 `ARCHITECTURE.md`, `lib/README.md`, `docs/INDEX.md` 재편)이고, 이름 바꾸기·파일 이동은 **59개 worktree가 살아 있는 지금은 하지 않는다**(§4 위험).
4. 죽은 코드는 적다: 참조 0인 파일 5개(전부 components), 테스트·스크립트만 쓰는 파일 15개. 대신 **기능이 잠든 도메인**(레거시 playbook CMS, contests, Stripe)이 살아 있는 코드처럼 보여서 탐색 비용을 먹는다.
5. 저장소 안의 `.claude/worktrees/`(12개 worktree, 22,536 파일)가 `.gitignore`에 없어 미추적 상태로 트리를 걷는 모든 도구(grep, 인덱서, AI)의 노이즈가 된다. 이것 하나가 가장 큰 "토큰 누수"다.

## 1. 지금 구조 — 실측 수치

| 영역 | 수치 (2026-11-03) |
| --- | --- |
| `app/` | route group 4개 `(marketing)` 17 · `(app)` 47 · `(brand)` 23 · `(admin)` 32 파일, `app/api` 상위 폴더 27개·route 파일 81개, `app/auth` 4, `app/actions` 1(`locale.ts`), `app/creative-media` 1, `.well-known` 2. ts/tsx 212파일 18,233줄 |
| `lib/` | 폴더 41 + 루트 파일 4(`cache.ts`·`flags.ts`·`runtime-mode.ts`·`marquee.ts`), 359파일 49,179줄. 허브(다른 lib 폴더에서 들어오는 import 줄 수): `db` 138, `i18n` 57, `auth` 54, `content` 50, `prompts` 38, `renders` 35, `campaigns` 34 |
| `components/` | 폴더 32(+루트 3), 227파일 31,970줄. `components/ad/`는 **빈 폴더** |
| `tests/` | 폴더 41, 378파일 56,508줄(AGENTS §3의 "290+ 파일"은 낡은 수치). vitest `pool: forks`, CI 4 shard |
| `messages/` | `ko.ts` 4,965줄/320KB, `en.ts` 5,012줄/278KB, 최상위 그룹 56개(동일) + 도메인 사전 4개(`admin-workflow`·`campaign-collaboration`·`campaign-funding`·`campaign-risk`) |
| `scripts/` | 51파일, npm scripts 38개. `sweep-anon.ts` 1,897줄, `data-*` 마커 157종 |
| `supabase/migrations/` | 118파일 = core 71(`0001`~`0073`) + glue 47(`0100`~`0148`), 테이블 118개·함수 44개. `supabase/README.md`에 운영 적용 원장 |
| `docs/` | 615파일: 루트 md 45(391KB), `evidence/` 288, `qa/` 208, `reviews/` 25, `design/` 15, `wording/` 15, `research/` 9, `plans/` 6, `legal/` 2, `product/` 2 |
| `public/` | 259파일(fonts 105, reel 118). `content/` 5(템플릿 JSON 2, OG 2, MANIFEST) |
| 환경변수 | `process.env.*` 50종(`PLAYBOOK_*` 3, `TWINGS_*` 5, `NEXT_PUBLIC_*` 6), `.env.example` 18키 |
| tsconfig | `paths`는 `@/*` 하나. `include`가 `**/*.ts(x)` 전체라 `scripts/`·`tests/`·`ops/`도 `tsc --noEmit` 대상 |
| git | `git worktree list` 73개: `D:/dev/.worktrees/twings` 59, **`<repo>/.claude/worktrees` 12**, 임시 1. 미추적 루트: `.claude/`, `TEMP/`(4), `tmp/`(30), `.tmp/`(4), `instagram uploader/`(2), `skills-lock.json`, `docs/HANDOFF-2026-10-28-IG-LAUNCH.md`, `docs/research/SUME-ARCHITECTURE-REFERENCE.md` |

## 2. 헷갈리는 것 (답할 것 1)

### 2.1 이름 불일치 — 어디에 무엇이 남아 있나

| 이름 | 실체 | 남아 있는 곳 (파일 수) | 판정 |
| --- | --- | --- | --- |
| 저장소 `yagi-prompts` · Vercel 프로젝트 `yagi-prompts` | 제품 TWINGS | AGENTS.md, next.config.ts, scripts 3, tests 3, lib 1 | 외부 연결(GitHub·Vercel)이라 유지. `docs/WORKSPACE.md` "이름 변경 범위"에 이미 "유지" 결정 기록 |
| `package.json` `"name": "playbook"` | 내부 패키지명 | package.json, package-lock.json | 유지(배포 호환) — 단 ARCHITECTURE.md에 한 줄 설명 필요 |
| `PLAYBOOK_MODE` · `PLAYBOOK_LOCAL_DB` · `PLAYBOOK_DEV_IDENTITY` | 로컬/클라우드 단일 스위치(`lib/runtime-mode.ts` M7) | lib 16, scripts 15, tests 10 (총 42) | 유지. `run-local.ts`·CI·Vercel env가 다 이 이름 |
| `PLAYBOOK-PLAN.md` (루트, 636줄 87KB, 2026-08-12, 코드명 PLAYBOOK) | M0 제품 계획. 코드 머리말이 인용하는 "PLAN §3.4 / §6 / §7 / §13 / §15.1"의 원본 | lib 대표 파일 머리말 대부분 | **INDEX에 없음.** 새 AI가 "PLAN §7"을 풀 수 없다 |
| "playbook" 낱말 | 레거시 블록 CMS 객체(테이블 `playbooks`·`playbook_revisions`·`steps`·`blocks`, 0002) | 코드 189파일(app 20, components 17, lib 56, tests 74, messages 3) | **살아 있는 레거시**: `app/(marketing)/[locale]/p/[slug]`, `app/(app)/library`, `app/(admin)/admin/playbooks`, `admin/p/[id]`, `components/playbook/`, `lib/content/`, `lib/publish/`. `lib/flags.ts` `PLAYBOOKS_IN_NAV=false`, `PLAYBOOK_DETAIL_ROUTE_READY=true` — 네비에서는 숨겼지만 라우트·관리자·사전(`플레이북` 24회)은 그대로 |
| `lib/prompts/` | **템플릿**(`prompt_items` 테이블). 머리말 "PLAN §13.1 — the prompt content contracts" | import 132파일(app 29, components 21, lib 27, scripts 6, tests 49) | 이름은 역사, 실체는 템플릿. 같은 개념에 `components/prompts`·`components/templates`·`components/playbook` 세 층이 공존 |
| `lib/content/` | 레거시 playbook CMS(schemas·load·shape·publish) **+** 현행 랜딩 미디어 슬롯(`landing-media*.ts`) **+** 공개 카탈로그 projection(`catalog.ts`) | app 12파일 | 레거시와 현행이 한 폴더에 섞임. 허브 4위(inbound 50)라 이동 비용 큼 |
| `lib/twings/` | 가격·원가(`cost-model.ts`)·템플릿 가격(`template-price.ts`)·크레딧·해상도·구독 플랜·viewer-access — "제품 규칙 잡동사니" 10파일 | import 26파일 | 제품명 폴더라 역할을 짐작할 수 없음. 역할은 "pricing + entitlement" |
| `lib/cookies/` | **크레딧 지갑**(PLAN §15.1 wallet/unlock). HTTP 쿠키 아님 | app에서는 `app/auth/callback/route.ts` 1곳만 | 오독 1순위 이름. 기능 자체가 거의 잠듦 |
| `lib/contests/` | 콘테스트 도메인(0007) | app import는 `(admin)/admin/contests/*` 2곳뿐, `(marketing)`에 공개 라우트 없음 | 잠든 기능(관리자 미리보기만) |
| `lib/billing/stripe-*` · `app/api/stripe/webhook` · `app/(app)/billing/retired.ts` | 은퇴한 $9 구독(retired.ts 주석: "subscriptions on hold") | billing 13파일 중 Stripe 5 | Toss와 Stripe가 한 폴더에 공존. "retired"라는 사실이 폴더 밖에서는 안 보임 |
| `lib/creators/`(1파일, 표시 이름) vs `lib/creator-platform/`(AI 크리에이티브 지원·정산) vs `lib/makers/`(AI 크리에이티브 공개 프로필·대표작) vs `lib/influencers/`(캠페인 참여자 SNS 검증) vs `components/creators/`(maker-profile·creative-studio) | 역할 셋이 폴더 다섯에 흩어짐 | `app/(app)/creators/*` = 사전 `creatorProgram`(AI 크리에이티브 지원), `app/(marketing)/[locale]/creators` = 같은 프로그램 랜딩, `app/(marketing)/[locale]/makers/[handle]` = 공개 프로필, `app/(app)/campaigns/*` = 캠페인 크리에이터 | 호칭 결정(PLATFORM-2.0 §14.2 "메이커" → 2026-10-28 "AI 크리에이티브")이 코드 폴더명에 반영되지 않음. `ko.ts`: 메이커 6, AI 크리에이티브 4, 크리에이터 198 |
| `lib/admin/operations.ts` 머리말 | "`app/(admin)/admin/actions.ts` is the thin 'use server' wrapper" | 그 파일은 **없다**. 실제 진입은 `app/(admin)/admin/do/route.ts` → `lib/admin/dispatch.ts` → `ADMIN_OPERATIONS`(14개 `*-operations.ts`를 spread로 병합) | 주석이 낡음. AGENTS §4의 "관리자 동작은 operations.ts 레지스트리로만"은 맞다 |

### 2.2 표면 ↔ lib 대응이 적힌 곳

- **없다.** 부분 조각만 있다: `README.md` "Where things are" 표 10행(2026-09 이전 기준 — `(brand)` 없음, `lib/storage`를 "local driver now, Supabase driver later"라고 쓰지만 실제는 `local-driver.ts`·`supabase-driver.ts`·`r2-public.ts`·`public-media-direct.ts` 4개, "2 fixture playbooks" 서술도 레거시), `AGENTS.md` §4 한 줄(route group 캐시 정책), `lib/routing/surfaces.ts`(코드: `consumer`/`brand`/`admin` 표면과 호스트 `twings.app`·`www`·`brand`·`brands`·`admin.twings.app`), `docs/WORKSPACE-HOST-ROUTING.md`(호스트 경계), `docs/TEMPLATES-IA.md` §2(경로). 이 다섯을 읽어야 그림이 나온다.
- 사전 그룹(56개) ↔ 화면 대응도 적힌 곳이 없다(`tests/i18n/dictionary.test.ts`가 키 누락만 잡는다).

### 2.3 죽은 코드 후보 (grep 확인, 2026-11-03)

| 분류 | 파일 | 근거 |
| --- | --- | --- |
| 참조 0 (app·components·lib·tests·scripts 어디서도 import 없음) | `components/admin/navigation-scroll.tsx`, `components/landing/circle-wipe.tsx`, `components/landing/hero-media.tsx`, `components/landing/reel-poster.tsx`, `components/motion/use-section-theme.ts` | `'@/components/...'`·`'./name'`·`'../name'` 문자열 전수 검색. 삭제 전 `npx tsc --noEmit`로 최종 확인 |
| 테스트·스크립트만 참조 | `components/contests/rails.tsx`, `components/landing/sections.tsx`, `lib/campaigns/risk/local-model.ts`, `lib/contests/submit.ts`, `lib/cookies/purchase.ts`, `lib/db/migrations.ts`(scripts), `lib/design/identity.ts`, `lib/influencers/local-vision.ts`, `lib/marquee.ts`, `lib/notify/worker.ts`(scripts), `lib/premium-editing/privacy.ts`, `lib/prompts/access.ts`, `lib/prompts/maker-film.ts`(scripts), `lib/prompts/submit.ts`, `lib/seo/contest-metadata.ts` | 런타임 경로에서 안 쓰임. `lib/design/identity.ts`는 설계 원본(IDENTITY.md 코드판)이라 유지 대상 |
| 빈 폴더 | `components/ad/` | 파일 0 |
| 사전 그룹 사용처 미확인 | `ko.ts`/`en.ts`의 `howItReads`, `appError` | 코드에서 `dict.howItReads`·`dict.appError` 패턴 0건(동적 접근 가능성 있어 "후보") |
| 낡은 설정 | `.claude/launch.json`이 `D:/dev/.worktrees/twings/shortlist-confirmed-share`를 가리킴 | 해당 작업은 PR #147로 병합됨(메모리) |

### 2.4 docs 50개 — 중복·낡음·모순

| 문제 | 근거 |
| --- | --- |
| INDEX(2026-10-23, 2026-10-30 수정) 밖의 루트 문서 13개 | `APP-STORE-LAUNCH.md`, `BRAND-AUTH-EXPERIENCE.md`, `BRAND-CONTRACT-PRODUCTION.md`, **`BRAND-ENGINE.md`(현재 포지션 원본, 10-30)**, `BRAND-INQUIRY-DELIVERY.md`, `BRAND-LAUNCH.md`, `BRAND-LOCALE.md`, `BRAND-MANAGED-WORKSPACE.md`, **`BRAND-MOAT-AND-STORAGE.md`(11-02 최신)**, `BRAND-POST-COLLECTION.md`, `BRAND-STAFF-ACCESS.md`, `HANDOFF-2026-10-28-IG-LAUNCH.md`(미추적), `INDEX.md` 자신. `BRAND-*.md`는 와일드카드 한 줄로만 언급 |
| 날짜·핸드오프·리뷰·QA 성격의 루트 문서 10개 | `BRAND-CLOUD-MIGRATIONS-2026-09-20`, `HANDOFF-2026-09-17`, `HANDOFF-2026-10-28-IG-LAUNCH`, `IDENTITY-PORTRAIT-QA`, `PRODUCTION-ROLLOUT-2026-09-23`, `SECURITY-RESEARCH-2026-10-15`, `WORDING-REVIEW-2026-09-20`, `copy-review-2026-09-20.csv`, `CREATOR-ONBOARDING-REVIEW-NOTES`, `CREATOR-ONBOARDING-PLAN`. INDEX "기록" 절에 5개만 적혀 있고 나머지는 현행 절에 섞임 |
| `docs/research/` 9개 중 INDEX 0개, `docs/wording/` 15개 중 1개, `docs/design/` 15개 중 3개 | 폴더명만 "기록" 절에 언급 |
| 브랜드 측 문서 13개(`BRAND-*.md` 11 + `CAMPAIGN-REPORTING` + `WORKSPACE-HOST-ROUTING`)가 2026-09-20~24에 집중 | 2026-10-30 `BRAND-ENGINE.md`가 brand.twings.app 방향을 바꿨는데, 9월 문서들은 "현행"처럼 INDEX에 남음 |
| `WORKSPACE.md`(2026-09-22) | worktree 1개 + archive 4개를 그리는데 실제는 59+12개. "worktree 의존성은 `D:\dev\twings\node_modules`를 가리킨다"는 서술은 현재 운영(각 worktree `npm ci`)과 다름 |
| `SERVER-HANDOFF.md`(YAGI-SERVER 이관) | AGENTS §0은 `D:\dev\twings`가 작업 경로. 둘 다 "현행"으로 INDEX에 있음 |
| 호칭 | `PLATFORM-2.0.md` §14.2 "메이커"(48회) ↔ 코드 주석(`lib/makers/works.ts` "an AI creative's")·`ko.ts`(AI 크리에이티브 4회) ↔ AGENTS §6 "메이커". INDEX 절 제목도 "메이커(템플릿 메이커)" |
| 수치 | AGENTS §3 "290+ 파일 / 2,800+ 테스트" vs 실제 378 테스트 파일(케이스 수 미확인) |
| 루트 잡동사니 | `PRODUCT.md`(impeccable 스키마 36줄), `CONTEXT.md`(캠페인 용어 18줄), `PLAYBOOK-PLAN.md`(87KB) — 셋 다 INDEX·README에 없음 |

## 3. 제안 (답할 것 2) — 위험 낮은 순

| # | 제안 | 무엇을 | 효과(추정) | 위험 | 순서 |
| --- | --- | --- | --- | --- | --- |
| a | **루트 `ARCHITECTURE.md`** 신설 (§5 초안 그대로) | 표면→호스트→route group→lib→테이블→테스트 매트릭스, 요청 흐름 3개, "어디를 고치면 되나", 이름 유산 표, 환경·플래그 링크 | 첫 세션이 `app/` 246개 폴더와 `lib/` 41개 폴더를 `ls`·`grep`으로 더듬는 탐색(경험상 10~20회 도구 호출, 수만 토큰)을 문서 1회 읽기(약 8KB ≈ 3천 토큰)로 대체. 코드 머리말의 "PLAN §n" 해석 가능 | 없음(문서 추가). 낡으면 해가 되므로 "코드가 원본, 이 문서는 지도"를 머리에 명시하고 PR 템플릿에 "ARCHITECTURE 영향?" 체크 한 줄 | 1 — 지금, 어느 세션과도 충돌 없음 |
| b | `lib/README.md`·`components/README.md`·`app/README.md` | 하위 폴더마다 한 줄 + 진입 파일 + 대응 tests 폴더 (§5의 표를 셋으로 쪼개도 됨) | 폴더 열 때마다 대표 파일을 열어 역할을 추측하는 비용 제거. `lib/cookies`·`lib/twings`·`lib/content` 오독 방지 | 없음 | 1 — a와 같은 PR |
| c | `docs/INDEX.md` 재편 | ① "현행 설계" vs "기록" 분리, ② 누락 13개 수록(특히 `BRAND-ENGINE.md`·`BRAND-MOAT-AND-STORAGE.md`·`PLAYBOOK-PLAN.md`), ③ `docs/archive/` 이동 후보 목록을 INDEX 안에 먼저 적기(이동은 d에서) | 첫 세션 필독량 유지(2~3개)하면서 "최신이 어느 것인가"를 날짜로 판정 가능 | 낮음. 링크 깨짐은 docs 안에서만 | 2 |
| d | 이름·위치 정리 (한 PR, 병렬 세션 종료 뒤) | 후보: `docs/archive/`로 §2.4의 날짜 문서 10개 + 9월 BRAND-* 중 BRAND-ENGINE이 대체한 것(대표 확인 필요), `.claude/`·`TEMP/`·`tmp/`·`.tmp/`·`instagram uploader/`를 `.gitignore`에, `.claude/launch.json` 갱신, `components/ad/` 삭제, §2.3 참조 0 파일 5개 삭제, `PLAYBOOK-PLAN.md`→`docs/PLAN-2026-08-12.md`(코드 주석의 "PLAN §n"은 그대로 유효), `lib/cookies`→`lib/credits`·`lib/twings`→`lib/pricing`·`lib/content`의 `landing-media*`→`lib/landing-media` **(코드 이름은 §4 위험 때문에 후순위, 대표 결정)** | 오독 이름 제거, 트리 노이즈 22,536파일 제거 | **높음**: 59개 worktree와 충돌, import 경로 132·26파일, 테스트 경로, 스윕 마커 | 4 — worktree 정리 뒤 |
| e | `tests/` ↔ `lib/` 대응 명시 | lib에 테스트 폴더 없는 6개(`faq`·`mcp`·`mobile`·`publish`·`routing`·`supabase`)와 tests에만 있는 7개(`helpers`·`onboarding`·`pwa`·`routes`·`runtime`·`ui`·`workspace`)를 `tests/README.md` 표로. 실제로는 `tests/routes`가 `lib/routing`+미들웨어, `tests/pwa/store-bridge.test.ts`가 `lib/mobile`을 덮음 | "어느 테스트를 돌리면 되나"를 즉답. CI shard 영향 없음 | 없음 | 2 |
| f | `.agents/skills/README.md` | 8개 `higgsfield-*` 스킬(= `.claude/skills` 정션, `skills-lock.json`으로 고정)의 용도 한 줄과 "제품 코드와 무관, 미디어 생성 전용" 명시 | 새 AI가 스킬 폴더를 제품 코드로 오해하지 않음 | 없음(`.agents/`는 gitignore라 로컬 전용) | 3 |
| g | "영역 책임" 표(CODEOWNERS 유사) | `.github/CODEOWNERS`는 없음. GitHub 강제 대신 ARCHITECTURE.md 안 표로: 결제(`lib/billing`·`api/billing`·`api/stripe`)=Director 전용, 렌더·인물(`lib/renders`·`lib/identity`·`lib/ark`)=우회 금지, 약관(`lib/legal`)=대표 승인, 사전(`messages/`)=Gemma 워딩 경로 | AGENTS §2·§4·§5의 역할 규칙을 경로 단위로 바꿔 "이 파일 건드려도 되나"를 즉답 | 없음 | 2 — a에 포함 |

### 3.1 각 제안의 효과·위험 근거 (답할 것 3)

- **토큰·탐색 횟수**: 이 감사가 구조 파악에 쓴 도구 호출은 12회, 들여온 출력은 약 60KB다. a+b가 있으면 같은 이해를 2회(ARCHITECTURE + 해당 lib README)로 얻는다. 수치는 이 세션의 실측이며 모델·도구에 따라 다르다.
- **병렬 세션 충돌**: 파일 이동·이름 변경은 `git worktree list` 73개 전부에 머지 충돌을 만든다. 문서 추가(a·b·c·e·f·g)는 새 파일이라 충돌이 없다.
- **캐시 태그·스윕 마커·import·Vercel**: `lib/cache.ts` 태그 7종(`catalog`·`prompts`·`contests`·`campaigns`·`landing-media`·`creator-subscription-status`·로케일), `sweep-anon.ts` 마커 157종, `lib/prompts` import 132파일, `PLAYBOOK_MODE`(run-local.ts·CI·Vercel env) — d의 코드 이름 변경만 이들에 닿는다. a~c·e~g는 어느 것에도 닿지 않는다.
- **순서**: (1) a+b+g 한 PR → (2) c+e 한 PR → (3) f → (4) worktree 정리·대표 결정 뒤 d.

## 4. 이름 바꾸기·이동 시 반드시 같이 보는 것

| 바꿀 것 | 같이 바뀌어야 하는 것 |
| --- | --- |
| `lib/<x>` 폴더명 | `@/lib/<x>` import(아래 수), `tests/<x>`, `vitest` include, `lib/README.md`, ARCHITECTURE.md |
| `lib/prompts` | import 132파일 — 사실상 불가(보류). 이름 대신 README로 "= 템플릿" 명시 |
| `lib/twings` | import 26파일(app 2·components 6·lib 7·tests 11) — 가능하나 후순위 |
| `lib/cookies` | app 1·tests 2 — 가장 싼 이름 변경 후보 |
| `app/(…)` 경로 | `lib/i18n/config.ts` `APP_PREFIXES`·`isCreatorProgramAppPath`·`isCampaignAppPath`, `lib/routing/surfaces.ts`, `next.config.ts` redirects(`/auth/:path*`·`/api/:path*` 등 4개), `sweep-anon.ts` 마커, `tests/routes/*` 38파일 |
| 사전 그룹 | `tests/i18n/dictionary.test.ts`, 4개 도메인 사전의 `ko`/`en` 병렬 |
| `.gitignore`에 `.claude/` 추가 | `.claude/launch.json`·`.claude/skills` 정션은 로컬 전용이므로 추적 손실 없음(미확인: 다른 PC와 공유 의도가 있었는지) |

## 5. ARCHITECTURE.md 초안 (그대로 파일로 옮길 수 있게 — 확인한 경로만)

````markdown
# ARCHITECTURE — TWINGS 저장소 지도

> 코드가 원본이고 이 문서는 지도다. 경로가 틀리면 코드를 믿고 이 문서를 고친다.
> 규칙·역할·검증 루프는 `AGENTS.md`, 설계·결정은 `docs/PLATFORM-2.0.md`, 이 저장소의 M0 계획(코드 주석의 "PLAN §n")은 루트 `PLAYBOOK-PLAN.md`(2026-08-12, 코드명 PLAYBOOK = TWINGS)다.

## 1. 한 줄

Next.js 15 App Router 단일 앱이 호스트별로 세 표면(consumer · brand · admin)을 낸다. 데이터는 Supabase Postgres(로컬은 PGlite 스냅샷), 파일은 Supabase Storage + R2 공개 미디어, 배포는 Vercel(`icn1`), 결제는 토스페이먼츠 단건.

## 2. 표면 → 호스트 → route group

| 표면 (`lib/routing/surfaces.ts`) | 호스트 | route group | 캐시 | 진입 |
| --- | --- | --- | --- | --- |
| consumer | `twings.app`, `www.twings.app` | `app/(marketing)/[locale]/…` (공개, 정적 + 태그 + 1h), `app/(app)/…` (로그인, `force-dynamic` + `private, no-store`) | `lib/cache.ts` 태그 | `middleware.ts` → `lib/i18n/config.ts` (`APP_PREFIXES`가 무접두 (app) 경로 게이트) |
| brand | `brand.twings.app`, `brands.twings.app` | `app/(brand)/brand/…` (projects · creators · library · members · settings · studio · usage · invite) | dynamic | `app/(brand)/layout.tsx` → `lib/brands/workspace/service.ts` |
| admin | `admin.twings.app` | `app/(admin)/admin/…` (brand-workspace · campaigns · community · contests · do · funding · inquiries · landing-media · p · playbooks · policy · prompts · risk · subscriptions) | dynamic | `app/(admin)/layout.tsx`, 모든 변경은 `app/(admin)/admin/do/route.ts` |
| 공통 | — | `app/api/*` (상위 27개), `app/auth/*`(callback · signin · signout · review), `app/actions/locale.ts`, `app/creative-media/[file]`, `app/.well-known/*` | — | `vercel.json` cron: `/api/renders/tick` 18:00 UTC, `/api/brands/inquiries/tick` 19:00 UTC |

호스트 판정과 CSP: `lib/routing/surfaces.ts`, `lib/security/workspace-csp.ts`. 로컬/클라우드 스위치: `lib/runtime-mode.ts` (`PLAYBOOK_MODE=local` → PGlite + `.storage/`).

## 3. lib 도메인 (41)

| lib | 역할 | 진입 파일 | 주 테이블 | tests |
| --- | --- | --- | --- | --- |
| `admin` | 관리자 오퍼레이션 레지스트리(`ADMIN_OPERATIONS` = 14개 `*-operations.ts` 병합) + 읽기 모델 | `operations.ts`, `dispatch.ts`, `repo.ts` | 전 도메인 | `tests/admin` |
| `ark` | BytePlus ModelArk 영상 생성 API 경계 | `client.ts`, `assets.ts` | `render_jobs` | `tests/ark` |
| `auth` | 세션 viewer 해석, `requireAdmin`, dev identity | `viewer.ts` | `profiles` | `tests/auth` |
| `billing` | 토스 단건 결제·웹훅·정산 대조. Stripe 파일은 은퇴한 구독용 | `toss-service.ts`, `toss-gateway.ts`, `ledger.ts` | `billing_payments`, `subscriptions`, `stripe_events` | `tests/billing` |
| `brands` | 브랜드 문의(`service.ts`), 워크스페이스(`workspace/`), 제작 계약(`production/`), 후보 공유(`shortlist/`), 2차 활용(`usage/`), Slack | `workspace/service.ts`, `repo.ts` | `brand_*` (0027~0037, 0066) | `tests/brands` |
| `campaigns` | 캠페인 도메인·상태 머신, 협업(`collaboration/`), 펀딩(`funding/`), 리스크 워커(`risk/`) | `repo.ts`, `service.ts`, `schemas.ts` | `campaigns`, `campaign_*` | `tests/campaigns` |
| `content` | 레거시 playbook 블록 CMS(schemas·load·shape·facade) + 랜딩 미디어 슬롯(`landing-media*.ts`) + 공개 카탈로그 projection | `catalog.ts`, `load.ts`, `landing-media.ts` | `playbooks`, `steps`, `blocks`, `landing_media` | `tests/content` |
| `contests` | 콘테스트(관리자 미리보기만 사용 중) | `repo.ts` | `contests`, `contest_entries` | `tests/contests` |
| `cookies` | 크레딧 지갑(unlock·purchase). HTTP 쿠키 아님 | `repo.ts`, `wallet.ts` | `cookie_ledger`, `prompt_unlocks` | `tests/cookies` |
| `creator-platform` | AI 크리에이티브(메이커) 지원·온보딩·정산·보상 | `service.ts`, `onboarding.ts`, `admin.ts` | `platform_*` (0046, 0051) | `tests/creator-platform` |
| `creator-subscriptions` | 크리에이터 월 구독(미출시, 플래그) | `service.ts` | `creator_subscription*` | `tests/creator-subscriptions` |
| `creators` | 표시 이름 프로필 | `profile.ts` | `profiles` | `tests/creators` |
| `db` | `SqlRunner` 팩토리(PGlite/Postgres), 마이그레이션 적용 | `connect.ts`, `sql-runner.ts` | — | `tests/db` |
| `design` | 디자인 아이덴티티 상수(`docs/design/IDENTITY.md`의 코드판) | `identity.ts` | — | `tests/design` |
| `events` | 퍼널 이벤트 6종 | `track.ts` | `events` | `tests/events` |
| `faq` | FAQ 카탈로그·JSON-LD | `catalog.ts` | — | (없음) |
| `i18n` | 로케일 규칙, `APP_PREFIXES` 엣지 게이트, 사전 로더 | `config.ts`, `dictionaries.ts` | — | `tests/i18n` |
| `identity` | 정면 셀카 보관·실인물 자산·회전 | `selfie-service.ts`, `service.ts` | `identity_selfies`, `identity_groups/assets` | `tests/identity` |
| `images` | 이미지 엔진(Seedream·GPT Image·Gemini) | `engines.ts` | — | `tests/images` |
| `influencers` | SNS 계정 연동·팔로워 검증 워커 | `service.ts`, `worker.ts`, `rules.ts` | `social_accounts`, `social_verify_workers` | `tests/influencers` |
| `kling` | Kling 공식 API 어댑터 | `client.ts`, `models.ts` | — | `tests/kling` |
| `legal` | 약관·환불·개인정보 원문(문구 단일 원본) | `documents.ts` | — | `tests/legal` |
| `makers` | AI 크리에이티브 공개 프로필·대표작·토큰 | `profile.ts`, `works.ts` | `platform_creators`, `maker_works`, `maker_tokens` | `tests/makers` |
| `mcp` | TWINGS MCP 서버(`app/api/mcp`) | `server.ts` | — | (없음) |
| `media` | 미디어 토큰·권한, 카드 arming | `authorize.ts`, `token.ts` | — | `tests/media` |
| `mobile` | 스토어 브리지(`.well-known`) | `store-bridge.ts` | — | `tests/pwa/store-bridge.test.ts` |
| `motion` | 스크롤 모션 기하(순수) | `geometry.ts` | — | `tests/motion` |
| `navigation` | 개인 · 브랜드 audience 네비 | `audience.ts` | — | `tests/navigation` |
| `notify` | 이메일(Resend)·웹푸시·워커·템플릿 | `service.ts`, `worker.ts`, `push.ts` | `notification_*`, `push_subscriptions` | `tests/notify` |
| `premium-editing` | 구독 프롬프트 해석 guard·privacy | `service.ts`, `guard.ts` | — | `tests/premium-editing` |
| `prompts` | **템플릿**(`prompt_items`): 저장소·스키마·카탈로그·추천순·이미지 세트 | `repo.ts`, `schemas.ts`, `catalog.ts`, `recommended.ts` | `prompt_items`, `platform_format_assets` | `tests/prompts` |
| `publish` | CMS 발행 2단계 파이프라인 | `pipeline.ts` | `publish_assets` | (없음, `tests/content`) |
| `recipes` | 레시피 v2(단계·슬롯·실행·자산) | `repo.ts`, `execute.ts`, `schema.ts` | `render_job_recipes`, `recipe_unlocks` | `tests/recipes` |
| `renders` | 렌더 잡 생성·패스·ETA·공유·포스터·알림 | `service.ts`, `engines.ts`, `repo.ts` | `render_jobs`, `render_job_outputs` | `tests/renders` |
| `routing` | 표면·호스트 판정, 안전 반환 경로 | `surfaces.ts` | — | `tests/routes` |
| `security` | 워크스페이스 CSP·nonce | `workspace-csp.ts` | — | `tests/security` |
| `seo` | 사이트맵·robots·JSON-LD·메타 | `sitemap.ts`, `structured-data.ts` | — | `tests/seo` |
| `storage` | 스토리지 드라이버(local · supabase · R2 공개 미디어 직접 쓰기) | `index.ts` | — | `tests/storage` |
| `supabase` | auth/data/service 클라이언트 팩토리 | `auth-client.ts`, `service-client.ts` | — | (없음) |
| `twings` | 가격·원가 플로어·템플릿 가격·크레딧·해상도·구독 플랜·viewer access | `template-price.ts`, `cost-model.ts`, `products.ts` | `prompt_items.price_cents` | `tests/twings` |
| `video` | 영상 모델 뷰(ark + kling) | `models.ts` | — | `tests/video` |
| 루트 | `cache.ts`(태그·revalidate), `flags.ts`(코드 플래그), `runtime-mode.ts`(`PLAYBOOK_MODE`), `marquee.ts` | — | — | `tests/runtime` |

사전: `messages/ko.ts`·`en.ts`(최상위 그룹 56개) + `admin-workflow`·`campaign-collaboration`·`campaign-funding`·`campaign-risk`. 하드코딩 금지, `tests/i18n/dictionary.test.ts`가 검사.

## 4. 요청 흐름 3개

### 4.1 템플릿 결제 → 렌더
`app/(marketing)/[locale]/t/[slug]/page.tsx` (가격·CTA: `lib/twings/products.ts`, `lib/prompts/public-catalog.ts`, `components/templates/make-sheet.tsx`)
→ `app/(app)/billing/toss/checkout.tsx` → `POST app/api/billing/toss/orders` (`lib/billing/toss-service.ts` `createTossOrder`)
→ `app/api/billing/toss/confirm/route.ts` (`confirmTossOrder` → `lib/renders/runtime.ts`, 셀카는 `lib/identity/selfie-service.ts`)
→ `lib/renders/service.ts` `createRenderJob` → `render_jobs`
→ 패스: `app/api/renders/tick/route.ts`(cron) `runRenderPass` → `lib/ark/client.ts` 또는 `lib/images/*` / `lib/kling/client.ts`; 콜백 `app/api/renders/callback/route.ts`
→ 결과 `app/(app)/renders/[id]/page.tsx`, 공유 `app/(app)/r/[id]/[token]`, 알림 `lib/notify/*`
→ 웹훅 `app/api/billing/toss/webhook/route.ts` (`reconcileTossWebhook`, 2차 활용·캠페인 펀딩 결제도 정리)

### 4.2 브랜드 캠페인 생성
`brand.twings.app` → `middleware.ts` (`resolveSurface`=brand) → `app/(brand)/layout.tsx` (`loadBrandWorkspace`)
→ `app/(brand)/brand/projects/new/page.tsx` (`components/brand-workspace/campaign-wizard.tsx`, 템플릿 선택 `lib/prompts/catalog.ts`)
→ `POST app/api/brand-workspace/route.ts` → `lib/brands/workspace/service.ts` `createBrandProject` → `brand_projects`
→ 상세 `app/(brand)/brand/projects/[id]/page.tsx` (`lib/brands/usage/*`, `lib/campaigns/funding/*`, `lib/campaigns/collaboration/*`, `lib/brands/shortlist/service.ts`)
→ 스튜디오 측 처리: `app/(admin)/admin/brand-workspace/*` + `lib/admin/brand-workspace-operations.ts`

### 4.3 관리자 오퍼레이션
`app/(admin)/admin/*/page.tsx` 폼 → `POST app/(admin)/admin/do/route.ts`
→ `lib/admin/dispatch.ts` `dispatchAdmin` (`requireAdmin` 재확인 → 이름 조회 → zod)
→ `lib/admin/operations.ts` `ADMIN_OPERATIONS[name]` (prompt · contest · campaign(+production·risk·collaboration·funding) · brand(+workspace·usage·production) · platform · social · landing-media)
→ 도메인 lib 변경 → `lib/cache.ts` `revalidate*` → `outcomeUrl`로 리다이렉트

## 5. 어디를 고치면 되나

| 하고 싶은 것 | 고칠 곳 | 같이 볼 것 |
| --- | --- | --- |
| 템플릿 가격·판매 상태 문장 | `lib/twings/template-price.ts`, `lib/twings/products.ts` (`storefrontOpen`) | AGENTS §5 가격은 대표 결정 |
| 새 (app) 경로 | `app/(app)/…` + `lib/i18n/config.ts` `APP_PREFIXES` | `tests/routes/app-boundaries.test.tsx`, `scripts/sweep-anon.ts` |
| 새 관리자 동작 | `lib/admin/<domain>-operations.ts`에 추가 → `operations.ts` spread | `tests/admin` |
| 사용자 문구 | `messages/ko.ts`·`en.ts` | Gemma 워딩 경로(AGENTS §2), `tests/i18n` |
| 템플릿 카탈로그 순서 | `lib/prompts/recommended.ts` | `lib/cache.ts` `revalidatePrompts` |
| 결제·웹훅 | `lib/billing/toss-*.ts`, `app/api/billing/toss/*` | Director 전용(AGENTS §2), `tests/billing`, `tests/routes/toss-payment-routes.test.ts` |
| 얼굴·셀카·렌더 안전 장치 | `lib/identity/*`, `lib/renders/*`, `lib/ark/*` | 우회 금지(AGENTS §4) |
| 약관 문구 | `lib/legal/documents.ts` | 대표 승인 |
| 스키마 | `supabase/migrations/NNNN_core_*.sql` + `NNNN_glue_*.sql` → `npm run db:local` | `supabase/README.md` 운영 적용 원장, PR 본문 "클라우드 적용 필요" |
| 랜딩 미디어 슬롯 | `lib/content/landing-media*.ts`, `/admin/landing-media` | `docs/CONTENT-SLOTS.md` |
| 호스트·CSP | `lib/routing/surfaces.ts`, `lib/security/workspace-csp.ts`, `middleware.ts` | `tests/routes/workspace-hosts.test.ts` |

## 6. 환경·플래그

- 환경변수 목록·로컬/클라우드 스위치: `docs/SETUP.md` §0, `lib/runtime-mode.ts`, `.env.example`.
- 코드 플래그: `lib/flags.ts` (`RENDER_PIPELINE_PUBLIC`, `PLAYBOOKS_IN_NAV=false`, `ASSET_LIBRARY_MODE` 등). 환경 플래그: `TWINGS_COMMUNITY`·`TWINGS_FORMAT_CREATORS`·`TWINGS_CREATOR_APPLICATIONS`·`TWINGS_IMAGE_REWARDS`(전부 off), `CREATOR_SUBSCRIPTION_PUBLIC`, `PREMIUM_EDITING_ENABLED`, `CAMPAIGN_*_PUBLIC`.

## 7. 검증 매트릭스

| 명령 | 범위 | CI |
| --- | --- | --- |
| `npx tsc --noEmit` | app · lib · components · tests · scripts (tsconfig include 전체) | `ci.yml` |
| `npx vitest run` | `tests/**/*.test.ts(x)` 378파일, PGlite per suite, `pool: forks` | 4 shard |
| `npm run build:local` / `start:local` | `PLAYBOOK_MODE=local` 강제 | `ci.yml` build job |
| `npm run sweep:anon` | 익명 방문자 1,000+ 체크, `data-*` 마커 157종 | `ci.yml` |
| `npm run security:client` / `security:built` | 서버 키가 클라이언트 번들에 없는지 | `ci.yml` |

## 8. 이름 유산 (바꾸지 않는 이유와 읽는 법)

| 보이는 이름 | 읽는 법 |
| --- | --- |
| GitHub `yagi-prompts`, Vercel `yagi-prompts`, `package.json` `playbook` | = TWINGS. 외부 연결이라 유지 |
| `PLAYBOOK_MODE`·`PLAYBOOK_LOCAL_DB`·`PLAYBOOK_DEV_IDENTITY` | 로컬/클라우드 스위치. 이름 유지 |
| `PLAYBOOK-PLAN.md`, 코드 주석 "PLAN §n" | 2026-08-12 M0 계획. 설계의 현행 원본은 `docs/PLATFORM-2.0.md` |
| `playbooks`·`steps`·`blocks` 테이블, `lib/content`·`lib/publish`·`components/playbook`, `/[locale]/p/[slug]`, `/library`, `/admin/playbooks` | 레거시 블록 CMS. 네비에서 숨김(`PLAYBOOKS_IN_NAV=false`), 라우트는 살아 있음 |
| `lib/prompts`, `prompt_items` | = 템플릿 |
| `lib/cookies` | = 크레딧 지갑 |
| `lib/twings` | = 가격·자격 규칙 |
| `lib/makers`·`lib/creator-platform`·`app/(app)/creators`·`/[locale]/makers/[handle]` | = AI 크리에이티브(공급자). `lib/influencers`·`app/(app)/campaigns` = 캠페인 크리에이터 |
| `lib/billing/stripe-*`, `/api/stripe/webhook`, `/billing/retired.ts` | 은퇴한 구독. 현행 결제는 토스 |
````

## 6. TWINGS 제안

1. 이번 주 안에 **PR 하나**: 루트 `ARCHITECTURE.md`(§5 초안 그대로, 경로만 재확인) + `lib/README.md`(§5 표 3의 lib 부분) + `components/README.md`·`app/README.md`(한 줄씩) + `tests/README.md`(§3-e 표). 새 파일만이라 어느 worktree와도 충돌하지 않는다.
2. 같은 PR에서 `docs/INDEX.md`에 "현행 / 기록" 두 절로 나누고 누락 13개와 `PLAYBOOK-PLAN.md`·`PRODUCT.md`·`CONTEXT.md`를 수록. 이동은 하지 않고 "archive 후보" 표만 둔다.
3. `.gitignore`에 `.claude/`·`TEMP/`·`tmp/`·`.tmp/`·`instagram uploader/`·`skills-lock.json`를 올릴지 대표에게 묻는다(§7). 올리면 미추적 2만 파일이 모든 도구의 시야에서 사라진다.
4. `AGENTS.md` §3의 테스트 수치(290+ → 378 파일)와 §6의 호칭 설명(메이커 → AI 크리에이티브, PLATFORM-2.0 §14.2 갱신 포함)을 다음 문서 PR에서 맞춘다. §6 자체를 "ARCHITECTURE.md를 먼저 읽는다" 한 줄로 바꾸면 AGENTS가 상태판 역할에서 벗어난다.
5. 코드 이름 변경(`lib/cookies`→`credits`, `lib/twings`→`pricing`, `lib/content`에서 `landing-media` 분리, 참조 0 파일 5개·`components/ad/` 삭제, `.claude/launch.json` 갱신)은 **병렬 세션이 끝나고 worktree 59개를 정리한 뒤 한 PR**로. 그 전까지는 README가 오독을 막는다.
6. 레거시 playbook CMS(라우트 `/p/[slug]`·`/library`·`/admin/playbooks`, `lib/content`·`lib/publish` 중 블록 부분, 테이블 4개)와 Stripe 잔존, contests를 **"잠든 기능"으로 명시**하고, 제거 여부는 대표 결정으로 올린다(§7). 제거하면 코드 189파일·테스트 74파일에서 "playbook"이 사라져 가장 큰 가독성 이득이 난다.

## 7. 대표 결정 필요 (임의로 정하지 않음)

1. 레거시 playbook CMS(공개 `/[locale]/p/[slug]`·`/library`, 관리자 `/admin/playbooks`·`/admin/p`, 테이블 `playbooks`·`playbook_revisions`·`steps`·`blocks`)를 **유지할지 제거할지**. 제거는 마이그레이션(클라우드 적용)과 레거시 발행 자산 처리가 따른다.
2. 은퇴한 Stripe 구독 코드(`lib/billing/stripe-*`, `/api/stripe/webhook`, `/billing/retired.ts`)와 `lib/contests`·`lib/cookies` 지갑을 **삭제할지 보관할지**.
3. 9월 브랜드 문서 11개(`BRAND-*.md`) 중 `BRAND-ENGINE.md`(10-30)·`BRAND-MOAT-AND-STORAGE.md`(11-02)가 대체한 것이 무엇인지 — `docs/archive/` 이동 목록 확정.
4. `.claude/`(worktree 12개 포함)·`TEMP/`·`tmp/`·`.tmp/`·`instagram uploader/`를 `.gitignore`에 올릴지, 또는 저장소 밖으로 옮길지. `instagram uploader/`에는 계정 핸들이 폴더명으로 들어 있어 커밋 금지 대상이다.
5. 코드 폴더 이름 변경(`lib/cookies`→`credits`, `lib/twings`→`pricing`, `landing-media` 분리)의 **시기** — worktree 59개 정리 시점과 묶어서.
6. 호칭 원본 갱신: `PLATFORM-2.0.md` §14.2 "메이커"를 2026-10-28 결정 "AI 크리에이티브"로 고쳐 쓸지, 코드 폴더(`makers`·`creator-platform`)도 따라갈지.
7. `PLAYBOOK-PLAN.md`를 `docs/`로 옮길지(코드 주석 "PLAN §n"은 경로를 인용하지 않으므로 이동해도 깨지지 않는다).
