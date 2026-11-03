# 관리자(admin.twings.app) 감사 — 2026-11-03

> 대표 평가 "ADMIN 지금 너무 개판"에 대한 1단계 산출물. 설계와 고칠 순서는 [docs/ADMIN.md](../ADMIN.md)에 있다.
> 범위: `app/(admin)/**` 27개 화면, `components/admin/**`, `lib/admin/**`, 관리자 오퍼레이션 레지스트리, PLATFORM-2.0 §10 요구.

## 0. 결론

1. **홈이 대기열이 아니다.** 할 일 목록, "처음 운영한다면" 안내, 템플릿 등록 띠, 활동 카드 4장이 한 화면에 있고 같은 숫자를 두 번 보여 준다. 렌더 실패·결제 확인 필요·인증 대기 숫자는 **피드백 문의함이나 커뮤니티로 잘못 연결**돼 있다(`app/(admin)/admin/page.tsx:357-385`).
2. **운영에 꼭 필요한 화면 세 개가 없다.** 렌더 보드, 결제 확인(토스 `*_manual` 대기열), 사용자 보기. 결제 하드닝(PR #78)이 "상한 뒤 관리자 대기열로 보낸다"고 설계했지만 그 대기열을 볼 화면이 없다.
3. **시각 언어가 세 개 섞여 있다.** ① 옛 에디토리얼(각진 테두리, 대문자 라벨, 블랙 대형 제목), ② 브랜드 작업공간의 `bw-` 시스템, ③ 화면마다 새로 쓴 Tailwind 카드. 버튼 모양·제목 크기·상태 표시가 화면마다 다르다.
4. **빨강이 남아 있다.** 홈 숫자(`workspace.css:442`의 `#dc2626`), 브랜드 작업공간 4개 화면의 상태 점·"고객에게 숨기기"·"접근 취소"·"문의 종료"(`app/(brand)/workspace.css`의 관리자용 `--ys-red: #dc2626`). 첫 할 일 행에는 폐기된 `#0000EE` 그라데이션이 있다.
5. **옛 제품이 메뉴 한 그룹을 차지한다.** 플레이북 목록·편집기·기본 정책은 TWINGS가 아닌 이전 제품의 화면인데 "시스템" 그룹에 그대로 있다. 반대로 **콘테스트는 메뉴에 없다**(주소를 알아야 들어간다).
6. 좋은 점: 모든 쓰기 동작이 레지스트리(`/admin/do`)를 거치고, 27개 화면 모두 390px에서 가로 넘침이 없으며, 영어 모드에서 하드코딩된 한국어 UI 문구가 없다.

## 1. 방법

- 로컬 관리자 모드: `npm ci` → `npm run db:local` → `PORT=3400 npm run dev:admin`. 데이터는 저장소의 PGlite 픽스처뿐이고 운영 데이터는 쓰지 않았다.
- 헤드리스 Chrome(DevTools 프로토콜)으로 27개 화면을 1440×900, 390×844에서 전체 높이로 찍었다(54장, `admin-audit-2026-11-03/`). 같은 실행에서 HTTP 상태, 가로 넘침, 빨간 계열 색(글자·배경·테두리), 이름 없는 링크·버튼, 라벨 없는 입력, 24px 미만 터치 영역, 콘솔 오류를 기계적으로 쟀다.
- 영어 모드(`playbook.locale=en`)로 한 번 더 열어 화면에 남는 한글을 모았다. 걸린 것은 언어 전환 버튼의 "한국어"와 픽스처 데이터(템플릿·캠페인 제목)뿐이다.
- 코드 스캔: 화면별 `op=` 사용, 레지스트리 이름 114개의 참조 위치, `requireAdmin` 경로 핸들러, 화면 안 SQL.

## 2. 화면 표

스타일 열: **공통**=관리자 셸 클래스(`admin-*`), **bw**=브랜드 작업공간 클래스, **TW**=화면에서 새로 쓴 Tailwind. 높이는 데스크톱/모바일 px.

| # | 라우트 | 목적 | 오퍼레이션 | 상태 | 스타일 | 접근성·모바일 | 높이 | 화면 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `/admin` | 대시보드 | (셸) `caches.refresh` | 링크 오류 3개, 정보 중복 | 공통+TW+덧칠 CSS, **빨강** | 숫자 링크 9×16px, 모바일 첫 화면이 메뉴 | 1,450 / 3,029 | [D](admin-audit-2026-11-03/01-home-desktop.webp) [M](admin-audit-2026-11-03/01-home-mobile.webp) |
| 2 | `/admin/inquiries` | 브랜드 의뢰 + 결과 문의 | `brandInquiry.status`, `renderFeedback.status` | 정상 | 공통(`admin-inbox-*`)+TW | 정상 | 900 / 1,460 | [D](admin-audit-2026-11-03/02-inquiries-desktop.webp) [M](admin-audit-2026-11-03/02-inquiries-mobile.webp) |
| 3 | `/admin/risk` | 캠페인 대화 위험 신호 | `campaignRisk.review`, `campaignRisk.slackConnectionTest` | 정상(픽스처는 분석 꺼짐) | TW | 정상 | 900 / 1,607 | [D](admin-audit-2026-11-03/03-risk-desktop.webp) [M](admin-audit-2026-11-03/03-risk-mobile.webp) |
| 4 | `/admin/brand-workspace` | 브랜드 프로젝트 목록·대화함 | `brandWorkspace.organization`, `.createProject` | 정상. 메뉴 이름은 "브랜드 의뢰", 제목은 "캠페인 운영" | bw, **빨강 점** | 정상 | 1,385 / 2,302 | [D](admin-audit-2026-11-03/04-brand-workspace-desktop.webp) [M](admin-audit-2026-11-03/04-brand-workspace-mobile.webp) |
| 5 | `/admin/brand-workspace/[id]` | 브랜드 프로젝트 상세 | `brandWorkspace.*` 9개 + 후보·제작 컴포넌트 | 정상, **너무 길다**(폼 28개, 노드 2,134) | bw, **빨강 버튼·상태** | 체크박스 14×18px | **10,883 / 15,332** | [D](admin-audit-2026-11-03/05-brand-project-desktop.webp) [M](admin-audit-2026-11-03/05-brand-project-mobile.webp) |
| 6 | `…/organizations/[id]` | 브랜드 조직(로고·멤버·초대) | `brandWorkspace.logo`, `.logoRemove`, `.invite`, `.revokeInvite`, `.revokeAccess`, `.support` | 정상 | bw, **빨강 "접근 취소"** | 정상 | 2,024 / 3,031 | [D](admin-audit-2026-11-03/06-brand-organization-desktop.webp) [M](admin-audit-2026-11-03/06-brand-organization-mobile.webp) |
| 7 | `…/[id]/reports/[reportId]` | 성과 리포트(인쇄) | — | 정상 | bw | 정상 | 2,565 / 4,827 | [D](admin-audit-2026-11-03/07-brand-report-desktop.webp) [M](admin-audit-2026-11-03/07-brand-report-mobile.webp) |
| 8 | `/admin/brand-workspace/usage` | 2차 활용 문의함 | `brandUsage.reconcile` | 정상 | bw | 정상 | 900 / 1,306 | [D](admin-audit-2026-11-03/08-brand-usage-desktop.webp) [M](admin-audit-2026-11-03/08-brand-usage-mobile.webp) |
| 9 | `…/usage/[caseId]` | 2차 활용 건 | `brandUsage.*` 13개 | 정상 | bw, **빨강 "문의 종료"** | ↗ 링크 15×17px | 2,128 / 2,733 | [D](admin-audit-2026-11-03/09-brand-usage-case-desktop.webp) [M](admin-audit-2026-11-03/09-brand-usage-case-mobile.webp) |
| 10 | `/admin/campaigns` | 캠페인 목록 + 지급 대기 | `campaignApplication.pay` | 정상 | TW | 상태 칩 높이 19px | 900 / 1,635 | [D](admin-audit-2026-11-03/10-campaigns-desktop.webp) [M](admin-audit-2026-11-03/10-campaigns-mobile.webp) |
| 11 | `/admin/campaigns/[id]` | 캠페인 상세(진행 확인·지원자·게시·지급·편집) | `campaign.status`, `.update`, `campaignApplication.*` 6개, `campaignProduction.*`, `campaignCollaboration.*` | 정상, 편집 폼이 검수 대기 사이에 끼어 있다 | TW | 체크박스 13×13px | 3,849 / 6,728 | [D](admin-audit-2026-11-03/11-campaign-detail-desktop.webp) [M](admin-audit-2026-11-03/11-campaign-detail-mobile.webp) |
| 12 | `/admin/campaigns/new` | 새 캠페인 | `campaign.create` | 정상 | TW | 체크박스 13×13px | 1,837 / 3,669 | [D](admin-audit-2026-11-03/12-campaign-new-desktop.webp) [M](admin-audit-2026-11-03/12-campaign-new-mobile.webp) |
| 13 | `/admin/campaigns/participants/[id]` | 참여자 대화 | `campaignCollaboration.*` | 픽스처에 연결된 대화가 없어 404(정상 동작) | — | — | — | [D](admin-audit-2026-11-03/13-campaign-participant-desktop.webp) |
| 14 | `/admin/funding` | 캠페인 견적·입금 기록 | `campaignFunding.*` 6개 | 정상 | TW | 정상 | 1,352 / 2,152 | [D](admin-audit-2026-11-03/14-funding-desktop.webp) [M](admin-audit-2026-11-03/14-funding-mobile.webp) |
| 15 | `/admin/prompts` | 템플릿 보드 | (카드 링크) | 정상, 제목이 다른 화면과 다른 블랙 대문자 | TW | **포스터 링크 13개에 이름 없음** | 2,056 / **7,653** | [D](admin-audit-2026-11-03/15-prompts-desktop.webp) [M](admin-audit-2026-11-03/15-prompts-mobile.webp) |
| 16 | `/admin/prompts/[id]` | 템플릿 편집·검수 | `prompt.approve`, `.reject`, `.visibility`, `.feature`, `.archive`, `.announce`, `.update` | 정상 | TW | 뒤로 링크 67×12px | 3,357 / 5,152 | [D](admin-audit-2026-11-03/16-prompt-detail-desktop.webp) [M](admin-audit-2026-11-03/16-prompt-detail-mobile.webp) |
| 17 | `/admin/prompts/new` | 새 템플릿 | `prompt.create` | 정상 | TW | 뒤로 링크 67×12px | 2,095 / 3,595 | [D](admin-audit-2026-11-03/17-prompt-new-desktop.webp) [M](admin-audit-2026-11-03/17-prompt-new-mobile.webp) |
| 18 | `/admin/prompts/new/set` | 이미지 세트 등록 | `prompt.createSet` | 정상 | TW | 정상 | 900 / 1,698 | [D](admin-audit-2026-11-03/18-prompt-new-set-desktop.webp) [M](admin-audit-2026-11-03/18-prompt-new-set-mobile.webp) |
| 19 | `/admin/contests` | 콘테스트 운영 | `contest.*` 5개, `contestEntry.*` 3개 | **메뉴에 없다**, 한 화면에 전부 펼쳐 길다 | TW | 정상 | **8,483 / 13,649** | [D](admin-audit-2026-11-03/19-contests-desktop.webp) [M](admin-audit-2026-11-03/19-contests-mobile.webp) |
| 20 | `/admin/contests/[slug]/preview` | 공개 화면 미리보기 | — | 정상 | 공개 컴포넌트 | 정상 | 2,338 / 2,279 | [D](admin-audit-2026-11-03/20-contest-preview-desktop.webp) [M](admin-audit-2026-11-03/20-contest-preview-mobile.webp) |
| 21 | `/admin/community` | "제작 요청과 포맷 파트너": SNS 확인·지원서·포맷 검수·요청·보상·평점·권한·정산·정책 | `platform.manage`(한 이름에 동작 11개), `social.verify`, `social.reject` | **화면 안 SQL 8개**, 고객용 문구("이런 콘텐츠를 만들고 싶어요")를 운영 제목으로 씀, 계정 UUID 손입력, 승인과 권한 해제가 같은 파란 버튼 | TW | 정상 | 1,756 / 3,042 | [D](admin-audit-2026-11-03/21-community-desktop.webp) [M](admin-audit-2026-11-03/21-community-mobile.webp) |
| 22 | `/admin/landing-media` | 랜딩 이미지 교체 | `landingMedia.replace`, `.reset`(클라이언트 `fetch('/admin/do')`) | 정상 | TW | **라벨 없는 파일 입력 44개** | 2,666 / **7,438** | [D](admin-audit-2026-11-03/22-landing-media-desktop.webp) [M](admin-audit-2026-11-03/22-landing-media-mobile.webp) |
| 23 | `/admin/subscriptions` | 월 구독 운영 준비(점검 전용) | — | 정상. 메뉴 설명은 "크리에이터 출시 알림 신청을 관리합니다"라 내용과 다르다 | TW | 정상 | 1,577 / 2,394 | [D](admin-audit-2026-11-03/23-subscriptions-desktop.webp) [M](admin-audit-2026-11-03/23-subscriptions-mobile.webp) |
| 24 | `/admin/playbooks` | **옛 제품** 플레이북 목록 | `playbook.create`, `.archive` | 잔재 | TW | 정상 | 1,049 / 1,814 | [D](admin-audit-2026-11-03/24-playbooks-desktop.webp) [M](admin-audit-2026-11-03/24-playbooks-mobile.webp) |
| 25 | `/admin/p/[id]` | **옛 제품** 플레이북 편집기 | `revision.*` 8개, `step.*` 4개, `block.*` 4개 | 잔재 | TW | 정상 | 900 / 1,114 | [D](admin-audit-2026-11-03/25-playbook-editor-desktop.webp) [M](admin-audit-2026-11-03/25-playbook-editor-mobile.webp) |
| 26 | `/admin/p/[id]/preview` | **옛 제품** 미리보기 | — | 초안이 없으면 404(정상 동작) | — | — | — | [D](admin-audit-2026-11-03/26-playbook-preview-desktop.webp) |
| 27 | `/admin/policy` | **옛 제품** 블록 공개 등급 | `policy.update` | 잔재 | TW | **라벨 없는 선택 6개** | 900 / 1,539 | [D](admin-audit-2026-11-03/27-policy-desktop.webp) [M](admin-audit-2026-11-03/27-policy-mobile.webp) |

## 3. 화면 공통 문제

### 3.1 셸과 메뉴
- 메뉴 12개 항목마다 두 줄 설명이 붙어 데스크톱에서도 900px 안에 다 들어오지 않고, 링크의 접근 이름이 "대시보드 대기 중인 업무를 확인하고 다음 행동을 고릅니다."처럼 길어진다.
- **모바일에서는 메뉴 전체가 첫 화면을 차지한다.** 모든 화면에서 본문이 약 460px 아래에서 시작한다(`01-home-mobile.webp`).
- 이름이 엇갈린다. 메뉴 "브랜드 의뢰"는 브랜드 작업공간(제목 "캠페인 운영")이고, 진짜 브랜드 의뢰는 "문의함"에 있다. "제작 요청과 포맷 파트너"는 무엇을 하는 곳인지 읽히지 않는다. "구독 운영 준비"의 설명은 다른 기능을 말한다.
- 콘테스트는 `AdminShell active="contests"`를 쓰지만 메뉴 목록(`lib/admin/workflow.ts` `ADMIN_NAV_GROUPS`)에 없다.
- "캐시 새로고침"이 모든 화면 사이드바 하단에 상시 노출된다. 운영자가 매일 누를 일이 아니다.

### 3.2 시각 언어
- 제목: `text-3xl font-semibold`(홈), `font-display font-black uppercase clamp()`(템플릿), `text-2xl`(커뮤니티), bw 제목(브랜드)이 섞여 있다.
- 버튼: 각진 대문자 라벨(`BUTTON`, `BUTTON_PRIMARY`), bw의 둥근 버튼, Tailwind `rounded-full` 칩이 공존한다. IDENTITY §4의 "버튼과 칩은 완전한 pill"과 맞는 것은 일부뿐이다.
- 오류 배너(`OutcomeBanner`)가 실패에 **블루 테두리**를 쓴다. 블루는 "할 일/주요 행동" 색이라 의미가 뒤집힌다.
- `workspace.css` 끝의 "SOTA Operate-Mode Polish" 블록이 위 문제를 덧칠한다: 숫자 빨강(`#dc2626`), 폐기된 `#0000EE` 그라데이션, `ease` 전환.
- 브랜드 작업공간 화면은 `app/(brand)/workspace.css`를 그대로 불러오고, 그 파일의 `html[data-workspace-admin]` 토큰 블록이 `--ys-red: #dc2626`을 다시 켠다. 브랜드 쪽은 같은 파일에서 저채도 `--ys-danger`로 바꿔 두었다.

### 3.3 길이
목록과 편집이 한 화면에 있어 길다. 브랜드 프로젝트 상세 10,883px(모바일 15,332px), 콘테스트 8,483px(13,649px), 템플릿 보드 모바일 7,653px, 랜딩 이미지 모바일 7,438px, 캠페인 상세 6,728px. 검수 대기 항목이 편집 폼 아래로 밀린다.

### 3.4 접근성
- 이름 없는 링크: 템플릿 보드의 포스터 링크 13개.
- 라벨 없는 입력: 랜딩 이미지 파일 입력 44개, 기본 정책 선택 6개.
- 24px 미만 터치 영역: 뒤로 가기 링크(12–17px 높이), 체크박스(12–14px), 캠페인 상태 칩(19px), 홈 카드의 "→"(9×16px).
- 좋은 것: 본문 건너뛰기 링크, 블루 포커스 링, `aria-current`, 모든 화면 가로 넘침 0, 콘솔 오류 0.

### 3.5 문구
- 하드코딩된 UI 문구는 없다(영어 모드 점검). 다만 커뮤니티 화면이 고객 화면의 사전 키(`community.*`)를 운영 섹션 제목으로 재사용해 "이런 콘텐츠를 만들고 싶어요", "게시물을 공유하고 이미지 크레딧 받기" 같은 고객용 문장이 운영 화면에 나온다.
- 홈 안내문 "오늘 손댈 것부터."처럼 명사형 단편이 남아 있다(TASTE 규칙 6).

## 4. 오퍼레이션 레지스트리

`lib/admin/operations.ts` 본문 21개와 다른 14개 파일의 레지스트리를 펼쳐 **114개** 이름을 만든다(플레이북 21 · 템플릿 9 · 콘테스트 8 · 캠페인 9 · 캠페인 제작 3 · 협업 4 · 펀딩 6 · 위험 2 · 브랜드 의뢰 2 · 브랜드 작업공간 27 · 2차 활용 14 · 브랜드 제작 3 · 플랫폼 2 · SNS 2 · 랜딩 이미지 2).

| 문제 | 내용 |
| --- | --- |
| 참조 없음 | `brandWorkspace.settings`, `campaignCollaboration.revoke`(앱·컴포넌트·테스트 어디에도 없음), `block.visibility`(테스트에서만) |
| 한 이름에 여러 동작 | `platform.manage`가 `action` 필드로 답장·포맷 판정·평점 제외·품질 점수·지원서 판정·권한 부여·보상 판정·정산 기록·정책·제안 추가·제안 끄기 11개를 처리한다. 레지스트리를 나열하는 권한 테스트가 이 11개를 따로 보지 못한다 |
| 이름 규칙 | 대부분 `도메인.동사`지만 `platform.manage`, `caches.refresh`, `brandWorkspace.status`처럼 동사가 아닌 이름이 섞여 있다. 계약이 `brandWorkspace.contract`와 `brandProduction.contract` 두 곳에 있다 |
| 옛 제품 | 플레이북 편집기용 21개(`playbook.*`, `revision.*`, `step.*`, `block.*`, `policy.update`)가 레지스트리 파일 본문을 차지한다. 다른 도메인은 전부 별도 파일이다 |
| §10 제안 이름 | `social.verify`는 있고 `social.revoke` 대신 `social.reject`가 있다. `platform.review`는 있다. `campaign.audience`, `payout.export`는 없다 |
| `/admin/do`를 거치지 않는 쓰기 | 업로드 운송만 예외로 문서화돼 있다: `POST /api/admin/staging-url`(서명 URL), `POST /api/admin/brand-workspace`(첨부 예약·완료), `POST /api/admin/brand-workspace/attachments/[id]`(로컬 전용 바이트). `POST /api/brand-workspace/studio`는 허용 목록 안에서 `dispatchAdmin`을 부른다. 업무 상태를 바꾸는 우회 경로는 없다 |
| 화면 안 쓰기 준비 | `/admin/community`가 페이지 안에서 SQL 8개를 직접 실행한다(읽기). 데이터 접근은 `lib/` 아래로 옮겨야 한다 |

## 5. PLATFORM-2.0 §10과의 간극

| §10 요구 | 지금 | 간극 |
| --- | --- | --- |
| 대기열 중심 홈 | 할 일 목록이 있지만 안내·띠·카드와 섞여 있고 숫자가 중복된다 | 홈을 대기열 하나로 |
| AI 크리에이티브 지원 N | 있음(`creatorApplications` → `/admin/community#applications`) | — |
| 포맷 검수 N | 숫자 없음(커뮤니티 화면 목록만) | `platform_formats.status='submitted'` 숫자 |
| 인플루언서 수동 인증 N | 있음(`socialAccounts`) | — |
| 브랜드 캠페인 승인 N | 승인할 대상이 아직 없다(Phase 3 브랜드 캠페인 마법사 미구현). 브랜드 대화·의뢰가 대신 잡힌다 | 마법사가 생기면 큐 추가 |
| 정산 대기 N | 캠페인 지급 대기만 있다. 크리에이티브 정산은 렌더 ID를 손으로 넣는 폼뿐 | 크리에이티브 정산 화면·CSV |
| 결과물 피드백 N | 있음 | — |
| 결제 "확인 필요" N | **숫자만 있고 목록이 없다.** 링크가 피드백 문의함으로 간다 | 결제 확인 목록 |
| 렌더 보드(작업·상태·비용·실패 사유·재시도·메일 재발송) | **없다.** 렌더 실패 숫자도 피드백 문의함으로 간다 | 렌더 보드. 재시도·재발송은 결제 상태와 얽혀 따로 결정 필요(ADMIN.md §8) |
| 사용자 보기(역할·자격·연동 계정·셀카 수·주문 수, PII 최소) | **없다.** 계정 UUID를 복사해 손으로 넣는다 | 사용자 보기 |
| 정산 CSV(크리에이티브별·월별) | 없다 | `payout.export` |

## 6. 이전 관리자 브랜치

| 브랜치 | 상태 | 판단 |
| --- | --- | --- |
| `claude/admin-template-intake` | main에 이미 들어 있다(앞선 커밋 0) | 할 일 없음 |
| `codex/opus-p2-admin` | main에 이미 들어 있다(앞선 커밋 0) | 할 일 없음 |
| `codex/admin-brand-design` | 병합 안 됨, main보다 86커밋 뒤, 5커밋 앞(IA 문서, 렌더 보드, 사용자 보기, 심각도 정렬, 브랜드 토큰) | **병합하지 않는다.** 가져온 생각: 콘테스트·렌더·사용자를 메뉴에 넣기, 오래 기다린 순 정렬, 렌더 보드 안 결제 탭. 버린 것: 심각도 "위험"을 `#dc2626`으로 칠하기, 결제 상태를 보지 않고 실패 렌더를 `queued`로 되돌리며 시도 횟수를 0으로 만드는 `render.retry`, 알림 시도 횟수를 0으로 되돌리는 재발송(같은 멱등 키라 실제로 다시 나가는지 확인 안 됨), `app/(brand)/**` 수정 |

## 7. 재현

스크립트와 원자료는 저장소 밖(세션 임시 폴더)에 두었다. 다시 찍으려면: `npm run db:local` → `PORT=3400 npm run dev:admin` → 헤드리스 Chrome으로 위 27개 주소를 1440·390에서 연다. 상세 화면 ID는 로컬 픽스처 값이다(`bb000000-…-c1` 캠페인, `9a000000-…-01` 템플릿, `ee92ea58-…` 브랜드 프로젝트).
