# TWINGS for Brands — 제품 사실표 (2026-10-30)

랜딩(twings.app/brands)과 brand.twings.app 소개에 쓸 주장을 사실로만 채우기 위한 표다. 모든 항목에 근거 파일이나 라우트를 붙였다.

- **코드 기준**: `origin/main` c9ee049(#128). 이 worktree(`claude/brand-asset-studio`, 107a4c2)가 그 위에 랜딩 v6 커밋 20개를 더 얹고 있다.
- **주의**: `D:\dev\twings` 로컬 checkout은 75d8162(#110)에 멈춰 있다. #111~#128이 빠져 있으니 사실 확인에 쓰지 않는다.
- **운영 랜딩과 새 랜딩**:
  - 지금 twings.app/brands에 나가는 것은 `origin/main`의 `app/(marketing)/[locale]/brands/page.tsx`다. format explorer, craft showcase, Morphic film pair, customer story로 되어 있다.
  - v6 랜딩(`components/brand-studio/*`)은 이 브랜치에만 있다. 대표 승인 전까지 운영에 내보내지 않는다(배포 보류 2026-10-29).
- **표기**:
  - **운영** = 운영 코드와 데이터가 실제로 돈다.
  - **플래그** = 코드는 운영에 있지만 기본으로 꺼져 있다.
  - **스튜디오** = 제품 기능이 아니라 YAGI 사람이 도구로 수행한다.
  - **예정** = 설계만 있다.

---

## 0. 대표가 말한 7개 기능은 지금 어디까지 와 있나

| 기능 | 오늘의 사실 | 랜딩에서 쓸 수 있는 표현 |
| --- | --- | --- |
| 브랜드 하드라인(절대 규칙) | 제품 기능은 없다. 스튜디오가 작업마다 손으로 규칙 패스를 돈다: 생성 → 마크·장비·피부·문구 검사 → 표적 편집 → 재검사(`docs/research/brand-landing-2026-10-29/LESSONS.md` §2). 랜딩의 키트 규칙 4줄은 예시 데이터다(`messages/ko.ts` `brandLanding.landing.assets.rules`). 자산·웹사이트에서 규칙을 자동으로 초안 잡는 기능은 설계에도 아직 없다. | 스튜디오의 작업 방식으로는 쓸 수 있다. 제품 기능은 "곧". 자동 초안은 "곧(계획)". |
| 브랜드 메모리 | 조직 로고(0035), 캠페인 브리프·결정 기록, 캠페인 조건(0056)까지만 있다. 3계층 메모리(조직·프로젝트·개인)는 미구현이다(PLATFORM-2.0 §21.3, 단계 S3). | "곧". 지금 랜딩 pillar 문안 "저장해 다음 작업에 활용합니다"는 현재형이라 고쳐야 한다(§6-7). |
| 짧은 지시 → on-brand 이미지 | 없다. 랜딩 비교 섹션은 오히려 한 줄 프롬프트가 흔한 컷을 낸다는 걸 보여 준다. 오케스트레이터는 S5다. | "곧". 지금 된다고 쓰지 않는다. |
| 모델별 프롬프트 최적화 에이전트 | 스튜디오는 하고 있다(`image-director`, `seedance-film-director` 스킬, LESSONS §2 실측 라우팅). 제품에서는 레시피가 `{{selfie}}`를 엔진 방언 "Image 1"로 바꾸는 것뿐이다(`lib/prompts/maker-film.ts`, `engineStepPrompt`). 최적화가 아니다. | 스튜디오 방식은 운영. 제품 기능은 "곧". 엔진 이름은 쓰지 않는다. |
| 프로덕션 기능(yagi-crm → TWINGS) | yagi-crm 안에서 내부용으로 운영 중이다(업스케일, 컬러·사운드, 음악). TWINGS에는 없다. | 업스케일·컬러·사운드만 "곧". 음악은 내부 전용(§4). |
| 크리에이터 캠페인 | 운영. 관리형 캠페인과 brand.twings.app 캠페인 화면이 돈다. Morphic 사례(8월 90년대 인터뷰, 9월 한·일 동시)가 공개돼 있다. | 지금 하는 일로 쓴다. 숫자는 승인 3개만. |
| 프로덕션(의뢰 필름) | 운영(서비스). 의뢰 폼과 포트폴리오 덱 링크가 운영 랜딩에 있다. | 지금 하는 일로 쓴다. |

---

## 1. 지금 운영 중 (live)

### 1-A. 공개 사이트 (twings.app)
1. **브랜드 랜딩 `/[locale]/brands` (운영판)**: 포맷 탐색, 제작 쇼케이스, Morphic 필름 두 편, 고객 사례가 있다. 근거는 `origin/main:app/(marketing)/[locale]/brands/page.tsx`다.
2. **Morphic 사례**: `/[locale]/brands/stories/morphic`과 사례 카드가 있다.
   - 8월 90년대 인터뷰 캠페인은 영상 9편, 200만+, 300건+다.
   - 9월에는 한·일 동시 후속 캠페인을 했다.
   - 근거: `messages/ko.ts`의 `morphic90s`·`morphicSeptember`(L765~), `lib/campaigns/case-studies.ts`.
3. **템플릿 '가상 뷰티 광고 주인공 되기'** (`/ko/t/star-in-a-virtual-beauty-ad`, 2026-09-26 공개)
   - 셀카 1장이 Image 1, 저장소에 넣어 둔 YAGI 립글로스가 Image 2다. 결과는 15초 720p다.
   - 근거: `docs/BEAUTY-TEMPLATE.md`, `lib/renders/template-references.ts`.
   - 주의: 운영 렌더·결제는 `RENDER_PIPELINE_PUBLIC` 값에 따라 열린다(AGENTS §6 기준 `review`). "누구나 지금 만들 수 있다"고 쓰기 전에 Vercel 값을 확인한다.
4. **이미지 세트 템플릿 '웨딩 화보 5컷'**: 등록은 돼 있지만 가격 0, "준비 중"이다. 근거는 `content/templates/bridal-editorial-5.json`, `docs/qa/bridal-image-templates/PR.md`다.
5. **AI 크리에이티브 레시피 허브 (@yunseolfromseoul)**
   - 경로: `/[locale]/makers/yunseolfromseoul`, `/t/aquarium-goldfish-daydream`.
   - 템플릿 페이지에 "만드는 법"(프롬프트, 사진 자리는 `[내 사진]`)이 있다. 전체 프롬프트는 회원만 볼 수 있다.
   - 근거: PR #125(b2ce59f), `components/recipes/how-it-was-made.tsx`, `lib/prompts/maker-film.ts`. 자세한 내용은 §5-B.
6. **TWINGS MCP (AI 크리에이티브용)**: `POST /api/mcp`다. 크리에이티브 개인 토큰(`twk_…`)으로 레시피 검증, 초안, 테스트 렌더, 공개를 자기 Claude Code·Codex에서 한다. 근거는 `app/api/mcp/route.ts`, `lib/mcp/server.ts`, PLATFORM-2.0 §20.5다.
7. **브랜드 의뢰·상담 폼**: 의뢰는 `brand_inquiries`에 저장되고 Slack으로 전달된다. 근거는 `components/campaigns/brand-inquiry-dialog.tsx`, migrations 0021/0041, `docs/BRAND-INQUIRY-DELIVERY.md`다.

### 1-B. brand.twings.app (운영, 흰 바탕 리디자인 10-29 반영)

| 화면·기능 | 하는 일 | 근거 |
| --- | --- | --- |
| 홈 | 선택한 브랜드의 캠페인만 보여 준다. 수락한 초대가 아직 공유 전이면 "대기"로 표시한다. | `app/(brand)/brand/page.tsx` |
| 새 캠페인 5단계 | 포맷 → 보상과 예산 → 참여 대상 → 기간과 게시 조건 → 확인. 초안은 브라우저에 저장된다. TWINGS가 검토하기 전에는 공개되지 않는다. | `app/(brand)/brand/projects/new/page.tsx`, `components/brand-workspace/campaign-wizard.tsx`, `messages/ko.ts` `wizard` |
| 캠페인 한 화면 탭 | 개요, 브리프, 크리에이터 후보, 지원자, 결제, 파일·대화, 계약·2차 활용 | `components/brand-workspace/project-tabs.tsx` |
| 진행 타임라인 | 브리프 → TWINGS 검토 → 모집 → 선정 → 제작·게시 → 리포트 → 정산. 실제 상태를 따라 "다음 단계" 한 줄이 바뀐다. | `campaign-sections.tsx`, `next-action.ts`, `messages/ko.ts` `timeline.stages` |
| 콘텐츠 검토 | 승인하거나 수정 요청을 보낸다. 수정 요청은 무엇을 고칠지 써야 한다. | `decision-fields.tsx`, `confirm-step.tsx` |
| 크리에이터 후보(shortlist) | 스튜디오가 후보를 가져와 선별·공개한다. 브랜드는 카드나 리스트로 비교하고 선호·제외·되돌리기를 하며, 2~4명을 나란히 비교한다. "섭외 확정"을 표시한다. 섭외는 TWINGS가 정한다. | `shortlist.tsx`, `shortlist-triage.tsx`, `lib/brands/shortlist/service.ts`, `docs/BRAND-SHORTLIST.md` (0066·0068·0070 운영 적용) |
| 지원자 선호 표시 | 브랜드는 표시만 하고, 선정은 TWINGS가 한다. | `applicant-preference.tsx` |
| 성과 | 게시물별 최신 수치를 보여 준다. 스튜디오가 대략 하루 한 번 수집하고, 증빙은 CSV로 남긴다. 없는 수치를 0으로 채우지 않는다. | `performance.tsx`, `lib/brands/workspace/performance.ts`, `docs/BRAND-POST-COLLECTION.md` |
| 리포트 | 캠페인 리포트 페이지가 있다. | `app/(brand)/brand/projects/[id]/reports/[reportId]/page.tsx` |
| 계약 문서 | 공유된 계약 문서 목록이 있다. | `contracts.tsx` |
| 2차 활용 | 콘텐츠를 골라 문의하면 TWINGS가 크리에이터와 시스템 밖에서 협의한다. 브랜드에는 최종 견적만 보이고, 수락하면 1회 결제한다. 결제는 기본 꺼짐(플래그)이다. | `secondary-usage.tsx`, `docs/SECONDARY-USAGE.md` (0037 적용) |
| 셀프 스튜디오 | 계약한 브랜드만 쓴다. TWINGS가 브랜드 전용 포맷을 설계하면, 브랜드 멤버가 본인 확인한 정면 사진으로 영상을 만들고 내려받는다. 편수는 운영자가 정한다. | `app/(brand)/brand/studio/*`, `production-create.tsx`, `lib/brands/production/service.ts`, `docs/BRAND-CONTRACT-PRODUCTION.md` |
| 라이브러리 | 선택한 브랜드의 캠페인 콘텐츠가 모인다. | `app/(brand)/brand/library/page.tsx` |
| 멤버·초대·설정·로고 | 역할별 권한이 있다. 로고는 소유자만 올리고, 서버가 실제 바이트를 다시 검사한다. | `members/page.tsx`, `invite.tsx`, `logo-control.tsx` (0035) |
| 지원 대화 | 브랜드 전용 Slack 컨시어지 채널로 이어진다. | `support.tsx`, `lib/brands/concierge-slack.ts` |

### 1-C. 스튜디오가 사람 손으로 하는 운영 서비스
- **관리형 크리에이터 캠페인**: 포맷을 제작하고, 크리에이터를 모집·선정하고, `#광고` 표기를 포함해 게시물을 검수하고, 7일 홀드 뒤 정산하고, 리포트를 낸다. 근거는 `docs/CAMPAIGNS.md` §0~§2다. 한·일 동시 진행은 Morphic 9월 사례로 확인된다.
- **의뢰 필름(프로덕션)**: 포트폴리오와 회사 소개 덱 링크, 제작 상담 폼이 있다. 근거는 `app/(marketing)/[locale]/brands/page.tsx`의 `LandingProduction` actions다.
- **에셋 제작**: 랜딩의 제품 8종, 장면, 착용, 영상 컷은 모두 스튜디오가 만든 예시다. 지금 브랜드가 맡기면 같은 방식으로 스튜디오가 만든다. 셀프 서비스는 아니다.

---

## 2. 베타 / 얼리 액세스 (코드는 있으나 닫혀 있음, 또는 예시만)

| 항목 | 상태 | 근거 | 랜딩 표기 |
| --- | --- | --- | --- |
| 크리에이터 풀 `/brand/creators` + 지정 초대 | 플래그 `TWINGS_INFLUENCERS` 기본 off. 약관·개인정보 문안 결정 대기 | `docs/qa/creator-pool/PR.md`, PLATFORM-2.0 §17 | 얼리 액세스 |
| 인플루언서 자격 확인 (로컬 AI가 팔로워 캡처를 읽어 제안, 사람이 확정) | 같은 플래그, off | `docs/qa/influencer-identity/README.md` | 공개하지 않음(내부 운영) |
| 캠페인 펀딩 결제 | `CAMPAIGN_FUNDING_PUBLIC` 플래그 | `lib/campaigns/funding/runtime.ts` | 쓰지 않음(결제는 §6-4) |
| 2차 활용 결제 | 기본 off | `docs/SECONDARY-USAGE.md` | "문의 후 견적"까지만 |
| 셀프 스튜디오 | 운영 중이지만 계약 브랜드만 쓴다 | 위 1-B | 디자인 파트너 대상 얼리 액세스 |
| 에셋 스튜디오(제품 컷, 장면 교체, 착용, 컷 → 영상) | 랜딩 예시뿐이다. 제품 기능은 없고, 엔진 어댑터만 있다(`lib/renders`, `lib/images/engines.ts`) | PLATFORM-2.0 §21.3·§21.6 | 이미 "얼리 액세스" 표기가 있다(`assets.early`). 유지한다 |
| 착용(VTO) 룩북·자유 모드 | 랜딩 예시만. 원형은 별도 제품 Americano | PLATFORM-2.0 §21.8, `components/brand-studio/studio-vto.tsx` | 얼리 액세스 + "예시" |
| 새 엔진 두 개(공식 API 영상, 이미지) | 키가 Vercel에 없어 스모크 미실행. 메이커 허용 목록에 없다 | AGENTS §6-5, `lib/recipes/schema.ts` `MAKER_ENGINE_IDS` | 쓰지 않음 |
| 미연결 프로토타입 | `aesthetic-engine.tsx`("VLM 5-Point Mood DNA"), `brief-concierge.tsx`, `human-handoff.tsx`, `review-stage.tsx`("zero-login stakeholder share")는 어디에서도 import되지 않는다 | `git grep` 결과 0건 | 기능으로 보여 주지 않는다 |

---

## 3. 계획 — "곧"으로 보여 줘도 되는 것과 필요한 일

| # | 기능 | 필요한 일 | 근거 |
| --- | --- | --- | --- |
| 1 | **브랜드 하드라인 키트 + 생성마다 규칙 검사** | ① 키트 스키마(마크 파일, 팔레트 hex, 금지 표현, 인물 동의 정책) ② 생성 → VLM 검사(로고 드리프트, 장비 노출, 플라스틱 피부는 실제로 잡힌 결함) → 표적 편집 → 재검사 루프 ③ 실패 사유 UI. 엔진은 어댑터 뒤 | LESSONS §2 "규칙 패스", §5-1·5-5; PLATFORM-2.0 §21.5 |
| 2 | **하드라인 자동 초안** (자산·웹사이트에서) | 브랜드 사이트와 가이드 PDF, 올린 자산을 VLM이 읽어 규칙 JSON 초안을 만들고 사람이 승인한다. 크롤러, 근거 링크 표시, 승인 전 미적용. **설계 문서에 아직 없다.** 대표가 범위를 정해야 한다 | 대표 지시(2026-10-30) |
| 3 | **3계층 브랜드 메모리** | 조직(로고·폰트·팔레트·금지) / 프로젝트(무드보드·타깃·핵심 카피·결정) / 개인(비율·레이아웃·피드백). 행으로 저장하고 요청에 조직 → 프로젝트 → 개인 순으로 합친다. 아래 계층은 위의 금지를 풀 수 없다. 실제 게시 성과를 다음 캠페인으로 돌리는 루프 | PLATFORM-2.0 §21.3·§21.5·§21.9 (S3) |
| 4 | **업로드 → 자동 태깅 → 자연어 검색** | `brand_assets` + 비공개 Storage, VLM 태그(JSON 스키마), 멀티모달 임베딩 + pgvector. 실제 소비재 에셋 약 200장으로 벤치마크한 뒤 모델을 확정한다 | §21.5 (S2) |
| 5 | **짧은 지시 → on-brand 결과 (오케스트레이터)** | 3·4가 먼저다. 메모리를 읽고 작업을 나누는 에이전트, 라우팅 표를 설정값으로, 480p 테스트 → 승인 → 본 렌더 | §21.6 S5, Video-Creator `AGENTS.md` 권한·보고 원칙 |
| 6 | **모델별 프롬프트 최적화 에이전트** | 스튜디오 스킬의 모델별 공식(이미지 7종 구조, 영상 타임라인 규칙)을 서버 쪽 프롬프트 컴파일러로 옮긴다. 엔진 선택은 작업 종류로 정한다(사진다움 / 마크·문자·흰 바탕 / 영상). 모델 이름은 설정값 | `.agents/skills/image-director/SKILL.md` §3, `seedance-film-director/SKILL.md`, LESSONS §2·§5-2 |
| 7 | **무드보드 = 프롬프트 (레퍼런스 측정을 기능으로)** | `tools/extract_image.py`는 numpy와 PIL만 쓰고 네트워크 호출이 없어 서버로 옮길 수 있다. 측정 숫자(톤 분위수, 들뜬 검정, Lab 치우침, 심도 비, 번짐, 입자)를 프롬프트에 넣는다 | LESSONS §5-3 |
| 8 | **"좋은 원본 + 제품만 교체"를 1급 워크플로로** | 브랜드 메모리에 과거 캠페인 원본 컷을 쌓고, 신제품을 그 프레임에 넣고, 마크를 재검사한다 | LESSONS §3-3·§5-4 |
| 9 | **부분 편집 캔버스** | 영역을 잘라 입력 #1로 넣고, 패치 레이어, 비파괴 마스크 지우개(수식이 정해져 있다) | §21.5 (S4) |
| 10 | **업종별 랜딩 `/brands/[업종]`** | 섹션 순서는 그대로 두고 미디어 묶음과 문구만 바꾼다. 업종 목록은 대표가 정한다 | §21.4 "업종별 보기" |
| 11 | **프로덕션 마감 기능** (yagi-crm에서 이식) | §4의 업스케일, 컬러, 사운드. GPU 시분할 정책과 라이선스 확인, 결과 저장을 TWINGS Storage로 | §4 |

---

## 4. yagi-crm 프로덕션 기능

- **위치**: `D:\dev\YAGI-SALESFORCE`. 내부 관리도구 "YAGI Workspace"이고 git 저장소가 아니다. WSL `~/yagi-crm-src`에는 `server/crm-worker`만 있다.
- **구조**: 메뉴가 세 부문으로 나뉜다(`lib/member.ts` `DIVISIONS`).
  - SALES: `/crm`, `/documents`
  - OPERATIONS: `/operations`, `/contests`, `/programs`, `/sprints`, `/calendar`, `/brain`
  - PRODUCTION: `/production/*`
- **운영 상태**: migrations `20261028120000_production_studio.sql`과 `20261029120000_production_color_sound.sql`이 있다. WSL 서비스 `yagi-production-worker`는 `active`다(2026-10-29 19:43 KST부터). 읽기 전용 `systemctl --user is-active`로만 확인했고, 서비스는 건드리지 않았다.
- **질문에 대한 답**: PRODUCTION 부문에는 브리프, 캐스팅, 일정, 승인, 납품, 예산 기능이 **없다**.
  - PRODUCTION은 YAGI-SERVER 로컬 모델로 미디어를 다듬는 작업대와 작업 대기열이다.
  - 일정은 OPERATIONS(`/sprints`, `/calendar`)에 있다.
  - 견적서와 거래명세서는 SALES(`/documents`)에 있다.
  - 고객 브리프, 승인, 납품은 TWINGS brand.twings.app이 이미 갖고 있다(§1-B).

| 기능 | 하는 일 | TWINGS 미래로 보여 줄까 | 주의 |
| --- | --- | --- | --- |
| **작업 대기열·서버 상태** (`/production`) | 한 번에 한 작업. 서버가 꺼져 있어도 요청은 저장되고, 취소·재실행·로그·진행 표시가 있다 | 보조로만 쓴다. brand.twings.app의 렌더 진행 표시와 겹친다 | GPU 모델명, 서버 이름은 비공개 |
| **업스케일 스튜디오** (`/production/upscale`) | 이미지·영상을 FHD·QHD·4K로 올린다. 프레임 간 일관성을 지키고, 영상 소리는 그대로 둔다. 8GB까지 받는다 | **예** — "4K 마스터로 마감" | 모델 가중치 라이선스를 확인해야 한다. 개인 쪽에서는 업스케일이 최상위 플랜 독점(§19.4)이니 브랜드 쪽 표현과 충돌하지 않게 한다 |
| **컬러 그레이딩** (`/production/post`) | 레퍼런스 이미지·영상의 색감을 측정해 전용 3D LUT(33³ `.cube`)를 만든다. p01/p99 레벨 보정, 피부톤 보호, 할레이션, 35mm 그레인, 레터박스·자막대 계측 제외, 3단 비교 시트와 레퍼런스 거리(ΔL*)를 낸다. 검증된 시네마 룩 4종이 있고, 커스텀 룩을 카탈로그에 저장한다 | **예, 가장 강하다** — 저장한 룩 = 브랜드 메모리의 "색" 계층. "우리 브랜드 룩을 저장해 모든 영상에 같은 색" | CPU에서 돈다. 외부 레퍼런스로 만든 룩은 공개 예시로 쓰지 않는다 |
| **사운드 마감** (`/production/post`) | 음원의 드롭을 반전 컷(T_reveal)에 0ms로 맞춘다. 생성 영상의 폴리를 프레임 단위로 유지하고, AI 신스 패드를 제거한다(드럼·트랜지언트·보컬은 유지). 덕킹, -14 LUFS / -1 dBTP 마스터, 영상 스트림 무재인코딩 먹싱, 검수 시트 | **예** — "영상마다 숏폼 기준 음량과 비트 싱크로 마감" | **바이럴 음원 라이브러리는 상업 음원이라 레퍼런스·내부 검토용**이다(화면 문구 그대로). 공개 예시는 권리 있는 음원이나 BGM 없는 버전만 쓴다 |
| **뮤직 스튜디오** (`/production/music`) | 가사·스타일로 보컬곡을 만들고, BGM 모드가 있다. 레퍼런스 곡의 멜로디를 악보로 뽑아 따라가고, 목소리 음색을 바꾼다 | **아니오(내부 전용)** | 화면 문구가 "가중치는 CC BY-NC 4.0 — 상업 납품 전 라이선스를 확인하세요"다. 음색 변환은 목소리 권리 문제가 있다 |
| **목소리 모델 설치·삭제** | 음색 모델을 등록하고, pickle을 실행하지 않은 채 검사한다 | 아니오 | 내부 |
| **내 로컬 AI로 쓰기** (`/production/connect`) | 개인 토큰 + 스킬 파일 하나면 직원의 Claude Code·Codex가 스튜디오에 작업을 넣고 결과를 받는다 | **예** — TWINGS MCP(§1-A-6)와 같은 생각이다. "브랜드 팀의 AI 에이전트가 직접 쓰는 스튜디오" | 토큰 흐름은 TWINGS 쪽 설계로 다시 만든다 |
| **파일 서비스** | 서버 디스크로 바로 올리고 받는다. 서명 티켓 6시간, 이어 올리기 | 아니오(인프라) | 호스트명·경로 비공개 |

**반드시 내부에 둘 것**
- SALES 전체: 고객·리드, Gmail 발송 승인, LinkedIn 큐, Slack 명함 수신함, 회의 녹음·회의록, 시퀀스.
- `/documents`의 견적서·거래명세서(가격).
- 해외 매출 invoice와 송금 증빙, 재무 색인(`document-writer/_ledger`).
- `work/` 하위 폴더 이름에 실제 영업 대상 회사명이 있다. 랜딩·데모 화면에 이 폴더를 열지 않는다.
- 멤버 이름, 서버 이름, 내부 호스트명·디스크 경로, GPU 사양, 모델 가중치 이름.

---

## 5. 스튜디오의 전문 워크플로

공통 원칙(Video-Creator `AGENTS.md`):
- 원본 레퍼런스는 로컬 분석 자료다. 생성 모델에 올리지 않는다.
- 영상은 480p 테스트를 먼저 하고, 승인을 받은 뒤 720p 이상을 렌더한다.
- 관찰한 사실, 해석, 제안을 구분한다.

이 세 가지가 "전문가가 실제로 일하는 방식"의 핵심이다.

### W1. 레퍼런스 역설계 → 숫자로 쓴 룩
- **입력**: 레퍼런스 사진(분석 전용), 승인된 인물 사진 1장.
- **단계**
  1. `tools/extract_image.py`로 측정한다. EXIF, 정확한 비율, 들뜬 검정, 그림자·중간·하이라이트 hex, k-means Lab 팔레트, 색온도·틴트, 번짐, 중심 대 주변 심도 비, 입자, 조명 방향을 뽑는다. 3×3 구도 격자, 히스토그램, 스와치, 100% 크롭을 한 장 시트로 만든다.
  2. 렌즈 mm, 카메라 거리(m), 기울기 각도, 머리 Y 위치(%), 영역별 hex를 한 문단에 숫자로 쓴다.
  3. 레퍼런스 원본은 보내지 않는다. 인물 사진 1장만 모델에 넣는다(얼굴 섞임 방지).
- **출력**: 모델별 프롬프트와 컷 세트. 예: 웨딩 화보 5컷.
- **왜 프로 방식인가**: 형용사 대신 측정값으로 말한다. 지킬 것(인물·의상)과 새로 만들 것을 나눈다. 원본 저작물을 생성에 쓰지 않는다.
- **보여 줄 수 있는 결과물**
  - `D:\dev\Video-Creator\projects\2026-10-27-bridal-5shots-reverse\extraction\sheets\img_02_…-sheet.png`: 측정 시트.
  - `…\final_5shots_seedream\twings_5shots_final_lineup.png`: 최종 5컷.
- **가리거나 뺄 것**
  - 시트 안의 레퍼런스 사진 영역은 외부 업로드 이미지다(`image_analysis.json`의 `source_path`가 사용자 업로드). 히스토그램과 스와치 패널만 잘라 쓴다.
  - `source_path`와 sha는 뺀다.
  - 최종 컷의 얼굴은 공개해도 되는지 대표 확인이 필요하다(`docs/qa/bridal-image-templates/PR.md` "판매 전 막힌 것" 3).

### W2. 작업 종류별 모델 라우팅 + 모델별 프롬프트 방언
- **입력**: 작업 종류. 마크가 있는 생성, 제품 사진다움, 흰 바탕 커머스, 인물, 컷 → 영상 중 하나다.
- **단계**
  1. 실측 라우팅표로 엔진을 고른다(LESSONS §2). 마크만 레퍼런스로 줬을 때 한 엔진은 8/8을 지켰고, 다른 엔진은 8/8을 글자로 바꿨다. 제품 사진다움은 반대쪽 엔진이 6/8에서 이겼다.
  2. 모델마다 구조를 바꿔 쓴다. 대문자 LOCK 섹션형, 고밀도 산문형, 5단 브리프형 등이다(`image-director` §3).
  3. 같은 컷을 여러 모델로 뽑아 비교 시트를 만든 뒤 고른다.
- **출력**: 컷마다 고른 엔진의 결과와 비교 시트.
- **왜 프로 방식인가**: 같은 프롬프트를 모든 모델에 보내지 않는다. 이름이 아니라 실측으로 고른다.
- **보여 줄 수 있는 결과물**: `D:\dev\Video-Creator\projects\2026-10-27-bridal-5shots-reverse\comparisons_v2\compare_v2_shot02_window_crouch_vine.png`.
- **가리거나 뺄 것**
  - 패널 라벨의 엔진 이름은 가린다(§6-3). "모델 A·B·C"로 바꾼다.
  - 8/8, 6/8 같은 내부 실측 수치는 공개 숫자로 쓰지 않는다(§6-1).

### W3. 절대 규칙 패스 (로고·마크 검수 → 표적 편집)
- **입력**: 1차 생성 컷, 브랜드 키트(마크 파일, 팔레트, 금지 표현, 인물 동의).
- **단계**
  1. 사진을 가장 잘 찍는 엔진으로 먼저 만든다.
  2. 마크 드리프트, 촬영 장비 노출, 배경의 실제 브랜드 로고를 검사한다.
  3. 편집 엔진에 "그 표시만 바꾸고 나머지는 그대로"를 지시한다.
  4. 다시 검사한다. 이때 각인 재질, 곡면, 조명이 유지됐다.
- **출력**: 마크가 맞는 컷.
- **왜 프로 방식인가**: 리터처의 "한 군데만 손보기"다. 생성을 처음부터 다시 돌리지 않고, 결함만 고친다.
- **보여 줄 수 있는 결과물**: worktree `public/reel/landing/c-logo-raw.webp` 대 `c-logo-ours.webp`. 이미 v6 비교 섹션에 쓰인다.
- **가리거나 뺄 것**: 없다. 가상 YAGI 제품이라 그대로 써도 된다. 다만 "같은 엔진" 비교라는 설명에 엔진 이름은 넣지 않는다.

### W4. 좋은 원본 + 제품만 교체
- **입력**: 이미지 1 = YAGI가 찍은 캠페인 원본 프레임, 이미지 2 = 제품 컷아웃.
- **단계**
  1. "이미지 1의 프레임, 이미지 2의 병, 병만 바꿔라"고 지시한다. 그러면 원본의 빛, 그레인, 구도가 그대로 따라온다.
  2. 마크를 재검사한다(W3).
  3. 결과 11장을 만들었다.
- **출력**: 장면 컷(`sc-*`), 제품 컷(`pk-*`). 립글로스 컷은 대표의 하트 립스틱 컷에서 제품만 교체했다.
- **왜 프로 방식인가**: 처음부터 장면을 만들면 흔한 AI 컷이 나온다. 브랜드의 과거 촬영물이 가장 좋은 레퍼런스다.
- **보여 줄 수 있는 결과물**: worktree `public/reel/landing/sc-parfum.webp`, `pk-parfum.webp`, `beauty-ad-product.webp`, `highteen-product.webp`.
- **가리거나 뺄 것**
  - 교체 **전** 원본 프레임은 보여 주지 않는다. 원본 라이브러리에 클라이언트 패키지가 섞여 있을 수 있다(§21.4 "클라이언트 브랜드명과 패키지는 어디에도 내보내지 않는다").
  - Pinterest 보드 핀은 공개 금지다.

### W5. 필름 디렉션 (컷 → 영상)
- **입력**: 승인된 시작 컷과 브리프. 레퍼런스 영상은 로컬 분석만 한다.
- **단계**
  1. 레퍼런스를 0.1초 단위로 연속 검토하고, 인과·동작을 점검한다.
  2. `Visual style:` 블록을 쓴다. 매체, 팔레트 역할, 빛, 재질, 렌즈를 적는다.
  3. 0초부터 끝까지 빈틈없는 초 단위 타임라인을 쓰고, 경계마다 편집 종류를 적는다(하드컷, 매치컷, 연속 무빙).
  4. 영상 생성에는 효과음·폴리·앰비언스만 넣는다. 음악은 후반에 넣는다.
  5. 480p 테스트 → 승인 → 720p 이상. 비트레이트는 high로 둔다.
- **출력**: 5초 제품 클립, 15~20초 광고.
- **왜 프로 방식인가**: 감독의 콘티처럼 시간, 컷, 카메라 경로를 쓴다. "cinematic, 4K" 같은 형용사는 쓰지 않는다. 테스트 렌더로 비용을 통제한다.
- **보여 줄 수 있는 결과물**
  - worktree `public/reel/landing/clip-parfum.mp4`, `clip-oil.mp4`, `clip-mist.mp4`, `beauty-ad.mp4`.
  - 테스트 렌더 사례: `D:\dev\Video-Creator\projects\2026-10-29-yunseol-reverse\seedance_480p_4x3_v1.mp4`.
- **가리거나 뺄 것**
  - `yunseol-reverse\extraction_source_a`와 `extraction_style_b`는 외부 원본 분석물이라 공개 금지다.
  - 프롬프트 원문(`prompt_v1.txt`)은 일부만 흐리게 보여 준다.

### W6. 모션 디자인 히어로 (사진 1장 → 마크·색·빛 고정 → 컷 → 광고 → 여러 얼굴)
- **입력**: 제품 사진 1장, 스틸 4장, 광고 트림.
- **단계**
  1. 메시지 하나와 18초 무한 루프로 브리프를 정한다(`BRIEF.md`).
  2. 모션 교리를 적용한다. 퇴장 방향이 다음 입장을 정하고, 장면 전체가 하나의 카메라처럼 이어지며, 0.5~1.2초마다 무언가 바뀐다.
  3. 컷 seam은 같은 속도로 맞춘다(`cut-the-curve`).
  4. ko와 en을 한 composition에서 뽑고, 루프 이음새를 검사한다(`loop-check.jpg`).
- **출력**: `hero-{ko,en}.mp4`.
- **왜 프로 방식인가**: 슬라이드 묶음이 아니라 편집 문법으로 만든다. 폰 폭(약 343px)에서도 읽히는지 확인한다.
- **보여 줄 수 있는 결과물**: `D:\dev\Video-Creator\projects\2026-10-29-twings-brand-hero\out\hero-ko.mp4`, `contact-ko.jpg`. 운영 사본은 worktree `public/reel/landing/hero-ko.mp4`.
- **가리거나 뺄 것**: 제작 도구(오픈소스 프레임워크) 이름은 쓰지 않는다.

### W7. 컬러·사운드 마감 (휴대폰 OLED 기준)
- **입력**: 생성 영상, 선택적으로 레퍼런스 룩과 음원.
- **단계**
  1. **컬러**(`tools/viral_color_grade.py`)
     - 활성 화면만 계측해 들뜬 p01과 눌린 p99를 잡는다.
     - OLED 블랙에 고정하고, 33³ LUT에 감산 색밀도를 넣고, 피부 색상대를 보호한다.
     - 할레이션과 그레인을 더하고, 레퍼런스와의 거리를 리포트한다.
  2. **사운드**(`tools/viral_music_sync.py master`)
     - 드롭을 반전 컷에 0ms로 맞추고, 폴리를 프레임 단위로 고정한다.
     - AI 신스 패드를 제거하고, 덕킹한다.
     - -14 LUFS / -1 dBTP로 마스터하고, 청각 검수 시트를 만든다.
- **출력**: 마스터 mp4, 비교 시트, LUFS·dBTP 수치.
- **왜 프로 방식인가**: 컬러리스트와 사운드 엔지니어의 마감 단계를 측정값으로 돌린다. 숏폼 플랫폼의 음량 기준을 맞춘다.
- **보여 줄 수 있는 결과물**
  - `D:\dev\Video-Creator\projects\2026-10-29-yunseol-fashion-show\ig_upload_1080p_dream_story_nobgm.mp4`
  - 같은 폴더의 `earshot_mastered\` 시트
  - `…\2026-10-29-yunseol-story-adaptation\arch101_1080p_color_match_comparison.jpg`
- **가리거나 뺄 것**
  - `arch101`은 외부 원본 영상을 분석한 것으로 보인다. 비교 이미지에서 원본 패널은 빼고, 우리 결과의 before/after만 쓴다. 가장 안전한 방법은 `beauty-ad` 원본 대 그레이딩본을 새로 뽑는 것이다.
  - BGM 있는 버전은 음원 권리를 확인하기 전에 공개하지 않는다.
  - 검수 도구(제3자 MIT 오픈소스)를 우리 도구라고 쓰지 않는다.

### W8. 사실감 패스 (피부·손 QC, 플라스틱 룩 제거)
- **입력**: 인물이 나오는 컷.
- **단계**
  1. 금지어를 뺀다(flawless, porcelain, smooth skin, dewy glow 등).
  2. 무광 반사 계약을 넣는다(낮은 정반사, 하이라이트 클리핑 금지). 실제 모공, 잔머리, 비대칭, 휴대폰 HDR 문구를 넣는다.
  3. 피부와 손을 검사한다.
  4. deglaze 후처리를 한다(하이라이트 롤오프, 그레인, 미세 대비). 그레인은 피드 5, 자유 VTO 6, 룩북 3.5다.
  5. VTO에서는 얼굴 일치 게이트와 팔다리 비율 게이트를 쓴다(Americano).
- **출력**: AI처럼 매끈하지 않은 인물 컷.
- **왜 프로 방식인가**: 리터처가 실제로 쓰는 톤·질감 보정이다. 인물, 의상, 구도는 바꾸지 않는다.
- **보여 줄 수 있는 결과물**
  - worktree `public/reel/landing/c-skin-raw.webp` 대 `c-skin-ours.webp`.
  - 웨딩 1번 컷 수정 전후: `…\final_5shots_seedream\01_veiled_closeup_seedream_2k.png` 대 `01b_veiled_closeup_v5_americano_seedream_2k.png`. 수정 스크립트는 `fix_shot1_americano_skin.py`다.
- **가리거나 뺄 것**
  - Americano identity bank의 얼굴과 체형 레퍼런스는 공개 금지다(§21.8).
  - 얼굴 게이트 가중치는 비상업 라이선스라 "자동 얼굴 검증"을 제품 기능으로 쓰지 않는다.

### 5-B. @yunseolfromseoul — 무엇이고 어떻게 워크플로를 보여 주나
- **무엇인가**
  - 대표 본인의 admin 계정(`a14d387f…`)에 붙은 공개 AI 크리에이티브 핸들이다. 이 계정이 만든 템플릿에는 모두 이 크레딧이 붙는다(메모리 `yunseol-recipe-hub`).
  - 인스타그램 게시물의 실제 프롬프트가 1단계 레시피가 된다. 사진 자리는 `[내 사진]`이다.
  - 비회원에게는 "무료 가입하고 복사"가 보이고, 회원은 전체 프롬프트를 본다.
  - 템플릿은 `aquarium-goldfish-daydream`(영상 10초, 4:3, story-first, 프롬프트 공개, 소스 파일 비공개)과 `fashion-show-arrival` 두 개다.
- **워크플로를 보여 주는 방식**: Video-Creator에 무대 뒤가 그대로 남아 있다.
  - `2026-10-29-yunseol-reverse`: 소스 측정과 스타일 측정 → 프롬프트 → 480p 테스트.
  - `2026-10-29-yunseol-fashion-show`: 의상 측정과 컷아웃 → 생성 → 보컬 정리 → BGM 있는 판과 없는 판 → 청각 검수 마스터 → IG 1080p 업로드본.
  - `2026-10-29-yunseol-story-adaptation`: 색 매칭 비교 v5~v8, 사운드 마스터 v2~v8. 반복 수정의 기록이다.
  - 랜딩에서는 "게시물 → 레시피 → 내 사진 한 장으로 만들기"의 실제 사례가 된다. W1, W5, W7을 한 사람의 작업으로 묶어 보여 줄 수 있다.
- **주의**
  - 대표 본인이 운영하는 계정이다. 독립된 외부 크리에이티브의 채택 사례나 후기로 쓰지 않는다.
  - 랜딩 모자이크의 `yunseol-peach` 클립은 "가상 인물 예시"로 표시돼 있다. 그 표시를 유지한다.
  - 템플릿 JSON의 `price_krw`·`royalty_krw`는 내부 값이다.
  - story-adaptation의 외부 원본 영상과 음원은 공개하지 않는다.

---

## 6. 하면 안 되는 주장

1. **숫자는 승인된 것만 쓴다**: 영상 9편 · 200만 뷰+ · 파생 오가닉 콘텐츠 300건+.
   - 내부 문서에 있는 "13명 선정/12편, 14편, 중위 조회 7,811"(`docs/CAMPAIGNS.md` 머리말)은 쓰지 않는다.
   - LESSONS의 실측치(8/8, 6/8, 35 크레딧)도 쓰지 않는다.
   - **지금 worktree 문안의 "수십 명의 크리에이터", "크리에이터 수십 명이 홍보", "dozens of creators"**(hero.body, campaign.title, en)는 승인되지 않은 수량 주장이다. 대표가 확인하기 전에는 "여러 크리에이터"로 바꾼다.
2. **클라이언트 이름**
   - AGENTS §5가 허용한 이름은 "글로벌 AI 플랫폼"뿐이다.
   - 다만 **Morphic은 이미 운영 main에 공개돼 있다**(metaDescription, 사례 카드, `/brands/stories/morphic`). 실질적으로 승인된 상태지만 AGENTS 문구와 어긋나니 대표 확인을 기록해 둔다.
   - **"갤러리 라파예트·더현대"도 운영 main과 worktree에 나간다**(`productionCollabs`, `heroCinema.parisTitle`, en "Galeries Lafayette", "The Hyundai"). 승인 목록에 없으니 대표 확인이 필요하다.
   - 그 밖의 이름은 쓰지 않는다. Video-Creator나 dev 폴더에 보이는 브랜드 프로젝트명, 영업 대상사가 여기에 해당한다.
3. **경쟁사·엔진·도구 이름을 공개 페이지에 쓰지 않는다**
   - 엔진: Seedream, Seedance, Nano Banana, GPT Image, Kling, Higgsfield, ModelArk, Gemini.
   - 도구: SeedVR2, YuE2, SheetSage, RVC, Demucs, earshot, HyperFrames, ComfyUI.
   - 경쟁사·레퍼런스: Typeface, Playbook, Koto, riverflow, magnific, Argon.
   - 지금 worktree의 `brandLanding`에는 이 이름이 없다(확인함). 결과물 이미지 라벨까지 확인한다.
4. **가격·단가를 쓰지 않는다**
   - 스튜디오 요금, 좌석, 크레딧, 템플릿 가격, 로열티, 2차 활용 금액을 쓰지 않는다. 카드에는 가격을 노출하지 않는다.
   - 지금 운영 main과 worktree의 프로덕션 섹션에는 외부 견적 페이지 링크("예상 견적 보기/확인하기" → pricing.yagiworkshop.xyz)와 "포트폴리오와 예상 견적을 먼저 확인해 보세요"가 있다. 새 랜딩에 유지할지는 대표가 정한다.
5. **"AI 생성 표시" 배지는 넣지 않는다.** "AI 영상은 완벽하지 않을 수 있다" 안내는 유지한다.
6. **모집 출처를 쓰지 않는다**
   - 크리에이터 후보를 어디서 찾는지 UI, DB, 문안 어디에도 쓰지 않는다. shortlist import 계약에는 출처 필드가 없다(`lib/brands/shortlist/service.ts`).
   - `docs/CAMPAIGNS.md`의 외부 플랫폼 참조는 내부 문서다.
7. **아직 없는 기능을 현재형으로 쓰지 않는다** (지금 worktree 문안에서 찾은 것)
   - "제품 사진 한 장이면 제품 컷과 광고 영상이 나옵니다"(hero.title): 지금은 스튜디오 작업이다. "예시" 또는 "얼리 액세스"를 붙이고, 셀프 서비스로 읽히지 않게 쓴다.
   - "로고와 색상은 원본 그대로 유지합니다": 규칙 패스를 거친 결과에 대해서만 맞는 말이다. "항상"으로 읽히지 않게 쓴다.
   - pillar "브랜드 메모리 — 저장해 다음 작업에 활용합니다", "절대 규칙 — 결과물마다 확인합니다": 제품 기능은 미구현이다. "스튜디오가 작업마다 …" 또는 "곧"으로 쓴다.
   - "한국과 일본에서 활동 중인 크리에이터 풀과 함께"(marketsBody): 크리에이터 풀 기능은 off다. 한·일 동시 진행은 Morphic 9월 사례로만 말한다.
   - "누가 참여하든 처음 설계한 마스터 조명, 렌즈 감도, 카메라 무빙이 그대로 유지됩니다"(scaleBody): 셀프 스튜디오 문안 "인물이 바뀌면 장면 구성과 길이도 조금씩 달라집니다"와 충돌한다.
   - 자동 태깅·검색, 한 줄 지시 생성, 4K 업스케일, 음악 생성, 자동 얼굴 검증은 아직 없다.
8. **데이터·초상권 주장은 법무 문서와 같은 말로만 쓴다** (`lib/legal/documents.ts`)
   - worktree `scalePillars`의 **"캠페인 종료 후 데이터를 즉시 파기합니다", "원본과 결과물을 모두 파기"는 개인정보처리방침과 어긋난다.** 방침 §3은 "캠페인 기록: 정산 완료 후 5년", "얼굴 사진과 결과물: 결과물을 계정에서 제공하는 동안"이다.
   - "AI 학습에 쓰지 않습니다", "계정마다 독립된 공간에 암호화해 보관"은 방침에 근거 문장이 없다.
   - 이 세 문구는 이 상태로 운영에 나가면 안 된다. 대표·법무 승인 경로로 보낸다.
   - 초상권 설명은 약관 §5.3과 같은 말로 쓴다. 본인 얼굴만, 계정당 인물 자산 그룹 1개, 제공사 자동 검수, 필요 시 카메라 본인 인증, 신고 24시간 검토다.
9. **외부 이미지를 공개하지 않는다**: 대표 Pinterest 보드, 블루 레퍼런스 사진, Americano 가상 얼굴 원본, 역설계에 쓴 레퍼런스 사진·영상. 생성 참고로만 쓴다.

---

### 부록: 이번 조사에서 하지 않은 것
- 운영 Vercel 환경변수(`RENDER_PIPELINE_PUBLIC`, `TWINGS_INFLUENCERS`, `CAMPAIGN_FUNDING_PUBLIC`)의 실제 값은 확인하지 않았다. 문서상 기본값으로 적었다.
- yagi-crm의 Supabase migration이 운영에 적용됐는지는 SQL로 확인하지 않았다. worker가 active라서 운영 중으로 판단했다.
- 결과물 이미지 파일(비교 시트 등)은 열어 보지 않았다. 라벨 속 엔진 이름과 원본 패널은 쓰기 전에 눈으로 확인해야 한다.
- 지시받은 읽기 전용 범위를 지키려고 ICM store는 하지 않았다.
