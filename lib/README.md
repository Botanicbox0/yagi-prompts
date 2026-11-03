# lib/ — 도메인 모듈 (41)

한 폴더 = 한 도메인. 서버 전용 코드가 기본이고, 클라이언트가 읽는 순수 모듈은 파일 머리말에 적혀 있다. 역할·진입 파일·테이블·테스트의 전체 표는 루트 `ARCHITECTURE.md` §3, 이름 유산(playbook·prompts·cookies·twings)은 같은 문서 §8.

| 폴더 | 한 줄 | 진입 |
| --- | --- | --- |
| `admin/` | 관리자 오퍼레이션 레지스트리 + 디스패처 + 읽기 모델. 모든 관리자 변경은 여기를 지난다 | `operations.ts`, `dispatch.ts` |
| `ark/` | BytePlus ModelArk(Seedance·Seedream) API 경계와 가격표 | `client.ts`, `pricing.ts` |
| `auth/` | 세션 viewer 해석, `requireAdmin`, 검증된 이메일, 개발용 identity | `viewer.ts` |
| `billing/` | 토스 단건 결제·웹훅·정산 대조. Stripe 파일은 은퇴한 구독용 | `toss-service.ts` |
| `brands/` | brand.twings.app: 문의, 워크스페이스, 제작 계약, 후보 공유, 2차 활용, 기능 정책·플랜 | `workspace/service.ts`, `entitlements.ts`, `plans.ts` |
| `campaigns/` | 캠페인 도메인·상태 머신, 협업, 펀딩, 리스크 워커 | `repo.ts`, `service.ts` |
| `content/` | 레거시 playbook 블록 CMS + 랜딩 미디어 슬롯 + 공개 카탈로그 projection | `catalog.ts`, `landing-media.ts` |
| `contests/` | 콘테스트(관리자 미리보기만 사용 중) | `repo.ts` |
| `cookies/` | 크레딧 지갑(HTTP 쿠키가 아니다) | `wallet.ts` |
| `creator-platform/` | AI 크리에이티브 지원·온보딩·정산·보상 | `service.ts` |
| `creator-subscriptions/` | 크리에이터 월 구독(미출시, 플래그) | `service.ts` |
| `creators/` | 표시 이름 프로필 | `profile.ts` |
| `db/` | `SqlRunner`(PGlite/Postgres), 마이그레이션 적용 | `connect.ts`, `sql-runner.ts` |
| `design/` | 디자인 아이덴티티 상수(`docs/design/IDENTITY.md`의 코드판) | `identity.ts` |
| `events/` | 퍼널 이벤트 | `track.ts` |
| `faq/` | FAQ 카탈로그·JSON-LD | `catalog.ts` |
| `i18n/` | 로케일 규칙, `APP_PREFIXES` 엣지 게이트, 사전 로더 | `config.ts`, `dictionaries.ts` |
| `identity/` | 정면 셀카 보관·실인물 자산. 얼굴 검증 우회 금지 | `selfie-service.ts` |
| `images/` | 이미지 엔진(Seedream·GPT Image·Gemini) | `engines.ts` |
| `influencers/` | SNS 계정 연동·팔로워 검증 워커 | `service.ts` |
| `kling/` | Kling 공식 API 어댑터 | `client.ts` |
| `legal/` | 약관·환불·개인정보 원문. 절차 문구의 단일 원본 | `documents.ts` |
| `makers/` | AI 크리에이티브 공개 프로필·대표작·토큰 | `profile.ts` |
| `mcp/` | TWINGS MCP 서버 | `server.ts` |
| `media/` | 미디어 토큰·권한 | `authorize.ts` |
| `mobile/` | 스토어 브리지(`.well-known`) | `store-bridge.ts` |
| `motion/` | 스크롤 모션 기하(순수) | `geometry.ts` |
| `navigation/` | 개인 · 브랜드 audience 네비 | `audience.ts` |
| `notify/` | 이메일·웹푸시·워커·템플릿 | `service.ts` |
| `premium-editing/` | 구독 프롬프트 해석 guard·privacy | `service.ts` |
| `prompts/` | **템플릿**(`prompt_items`): 저장소·스키마·카탈로그·추천순 | `repo.ts`, `catalog.ts` |
| `publish/` | CMS 발행 파이프라인 | `pipeline.ts` |
| `recipes/` | 레시피 v2(단계·슬롯·실행·자산) | `execute.ts`, `schema.ts` |
| `renders/` | 렌더 잡 생성·패스·ETA·공유·포스터·알림 | `service.ts`, `engines.ts` |
| `routing/` | 표면·호스트 판정, 안전 반환 경로 | `surfaces.ts` |
| `security/` | 워크스페이스 CSP·nonce | `workspace-csp.ts` |
| `seo/` | 사이트맵·robots·JSON-LD | `structured-data.ts` |
| `storage/` | 스토리지 드라이버(local · supabase · R2 공개 미디어) | `index.ts` |
| `supabase/` | auth/data/service 클라이언트 팩토리 | `service-client.ts` |
| `twings/` | 가격·원가 플로어·템플릿 가격·크레딧·해상도·플랜 | `template-price.ts`, `products.ts` |
| `video/` | 영상 모델 뷰(ark + kling) | `models.ts` |
| 루트 파일 | `cache.ts`(태그·revalidate), `flags.ts`(코드 플래그), `runtime-mode.ts`(`PLAYBOOK_MODE`), `marquee.ts` | — |
