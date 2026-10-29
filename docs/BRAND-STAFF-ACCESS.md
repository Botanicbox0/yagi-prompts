# TWINGS 운영자 보기 (모든 브랜드 워크스페이스 열람)

브랜치: `codex/staff-brand-switcher`. 마이그레이션 없음. 기존 스키마(`profiles.is_admin`, `brand_*`)만 쓴다.

## 누가 열람하는가

`lib/brands/workspace/staff.ts`의 `hasStaffReadAccess()` 하나가 판단한다.

1. `profiles.is_admin = true`인 계정(기존 전역 스튜디오 권한). 또는
2. 인증 서버가 확인한 이메일의 도메인이 정확히 `yagiworkshop.xyz`인 계정.

"인증 서버가 확인한 이메일"의 출처는 `lib/auth/verified-email.ts`의 `getVerifiedEmail()` 하나다. Supabase `auth.getUser()`(쿠키 세션을 인증 서버에 다시 확인)의 결과에서, `getViewer()`가 정한 사용자 id와 같고 `email_confirmed_at`이 있을 때만 그 `email`을 쓴다. 초대 수락이 쓰던 규칙과 같고, 초대 수락도 이제 이 함수를 쓴다.

다음 값은 절대 쓰지 않는다: `profiles.email`, `Viewer.email`, `Viewer.isAdmin`만 따로, 요청 본문·쿼리, 표시용 이름. 도메인 비교는 `@`가 하나인 주소에서 뒷부분이 정확히 일치해야 한다. 하위 도메인(`a@sub.yagiworkshop.xyz`), 뒤에 붙인 도메인(`a@yagiworkshop.xyz.evil`), 앞에 붙인 도메인(`a@evilyagiworkshop.xyz`)은 모두 거부한다.

로그인은 Google·Kakao OAuth만 있다. 이메일 확인 여부는 제공사가 준 값으로 Supabase가 정한다. 즉 신뢰의 근거는 "그 메일함을 가진 사람"이다. 공용 메일함·별칭·전체 수신(catch-all)이 있으면 그 사람도 열람자가 된다. 로컬 dev identity(`PLAYBOOK_DEV_IDENTITY`)는 세션이 없으므로 도메인 규칙으로는 열리지 않고, `is_admin` 픽스처만 로컬에서 운영자 보기를 연다.

도메인 계정을 `profiles.is_admin`으로 올리지 않는다. 멤버십·초대·소유권도 만들지 않는다.

## 무엇이 열리는가 (읽기)

- 로고 드롭다운(`components/brand-workspace/identity.tsx`): 내 멤버십 브랜드가 먼저(원래 역할 그대로), 그 뒤에 "전체 브랜드 · 운영자 보기" 제목 아래 나머지 모든 브랜드(이름순, 캠페인이 없는 브랜드 포함)가 `studio` 역할, 라벨 **TWINGS 운영자 / TWINGS team**으로 나온다. 공유받은 캠페인만 있던 브랜드(`guest`)도 운영자에게는 `studio`로 나온다. 메뉴는 스크롤되고 항목은 44px, Esc로 닫힌다.
- 선택은 여전히 URL(`?organizationId=`)만으로 정한다. 쿠키 없음. 캠페인 페이지는 그 캠페인의 브랜드가 우선이고, 운영자에게는 공개 전 캠페인도 매핑된다. 없는 id·접근할 수 없는 id는 다른 브랜드로 대체하지 않고 "열 수 없음"이다.
- 홈·라이브러리: 그 브랜드의 모든 캠페인(고객 공개 전 포함, "고객에게 공개 전" 표시).
- 캠페인 상세·리포트: 스튜디오의 내부 상세와 같은 데이터(공유 전 계약서, 계약서 업로드 목록 포함). 계약서에는 공유/비공개 표시.
- 첨부 다운로드(`/api/brand-workspace/attachments/{id}`)와 로고(`/api/brand-workspace/organizations/{id}/logo`): 위 상세와 같은 규칙으로 허용. 페이지에 보이는 파일은 받아지고, 보이지 않는 파일은 404다.
- 설정·팀: 읽기 전용(설정 폼 비활성, 초대·해제 폼 없음). 팀 목록의 이메일 가림 규칙은 소유자 화면과 같다.
- 지원 메시지: `GET /api/brand-workspace?organizationId=` 읽기는 허용. 고객용 지원 서랍(보내기 폼)은 운영자 보기에서 띄우지 않는다. 답장은 기존 `/admin` 문의함에서 한다.
- 셀프 스튜디오: 계약·남은 횟수·템플릿·생성 이력·결과 읽기. 생성 버튼은 비활성, 본인 얼굴 준비 안내는 숨긴다.

모든 운영자 화면 위에 "TWINGS 운영자로 보는 중" 안내가 있다. `is_admin` 계정에는 기존 관리자 화면(`/admin/brand-workspace/organizations/{id}`, `/admin/brand-workspace/{projectId}`) 링크가 붙는다. 그 화면은 스스로 권한을 확인한다. brand 호스트에서 열린 변경은 아래 "운영자 캠페인 준비" 하나뿐이다.

## 운영자 캠페인 준비 (DB 관리자만, 2026-10-29)

대표 요청: brand.twings.app 캠페인 운영 화면에서 관리자가 새 고객 캠페인을 만들고, 곧바로 그 캠페인의 크리에이터 후보 관리와 가져오기용 캠페인 ID를 쓸 수 있어야 한다. 그전에는 운영자 보기가 읽기 전용이고 brand 호스트가 `/admin/do`를 막아서, 캠페인을 만들 길이 admin.twings.app의 접힌 "캠페인 준비" 폼밖에 없었다.

- 대상: `profiles.is_admin = true`이고 그 브랜드의 멤버가 아닌 계정(운영자 보기, `studio` 역할). 도메인만 있는 열람자는 그대로 읽기 전용이다. 관리자가 실제 멤버인 브랜드에서는 고객 의뢰 마법사가 그대로 나온다.
- 화면: `/brand` 머리에 **새 캠페인 만들기**, `/brand/projects/new`에 고객사 선택(지금 고른 브랜드가 기본값)·캠페인 이름·목표·총예산(선택)·**대표 이미지(선택)** 폼과 **새 고객사 등록**. 만든 캠페인은 `/admin/brand-workspace`의 "캠페인 준비"와 같다: `production_mode = creator`, 고객에게 공개 전(`client_visible = false`), 상태 `requested`, 관리자에게 멤버십은 생기지 않는다. 고객에게 공개·담당자 초대는 지금처럼 관리자 화면에서 한다.
- 캠페인 페이지(`/brand/projects/{id}`): 운영자 안내 바로 아래에 **진행 상태**(요청 → 캠페인 시작/종료, 진행 중 → 캠페인 완료/종료, 완료·종료는 확인 상자 필수, 되돌릴 수 없음)와 **크리에이터 후보 관리**(가져오기용 캠페인 ID, 공개·숨기기. 후보 파일 가져오기·삭제는 관리자 화면에서). 결과는 그 묶음 맨 위에 표시된다. 진행 상태 추가는 2026-10-29 대표 요청("완료처리를 여기서 할 수 없는 게 불편하다").
- 대표 이미지(2026-10-29 대표 요청): JPEG·PNG·WebP 1장, 15 MiB까지. 바이트는 스튜디오 문을 지나지 않는다(서버리스 본문 한도). 기존 첨부 경로로 올린다: `/api/brand-workspace` `attachment.reserve`(선언한 형식·크기 검사) → 바이트를 비공개 저장소로 직접(로컬은 첨부 바이트 경로) → `attachment.complete`(서버가 실제 바이트의 형식·크기를 다시 확인하고 맞지 않으면 준비 상태로 바꾸지 않는다) → 스튜디오 문 `brandWorkspace.cover`(그 캠페인의 준비된 이미지만, 현재 revision일 때만). 캠페인을 먼저 만들고 이미지가 실패하면 캠페인 페이지가 "다시 올려 주세요" 안내와 함께 열린다. 이미 만든 캠페인은 캠페인 페이지의 **캠페인 대표 이미지**에서 올리거나 바꾼다. TWINGS 팀이 올린 현재 대표 이미지는 고객 파일 목록에 나오지 않는다(`detail()`의 첨부 필터). 대표 이미지를 바꾸면 이전 이미지는 더 이상 대표가 아니어서 고객 파일 목록에 보인다. 관리자 화면에서 바꿀 때도 같고, 막으려면 첨부에 "대표 이미지" 표시를 두는 마이그레이션이 필요하다(후속 제안).
- 경로: `POST /api/brand-workspace/studio`(`app/api/brand-workspace/studio/route.ts`). 허용 목록(`lib/admin/brand-host-studio.ts`)은 `brandWorkspace.organization`, `brandWorkspace.createProject`, `brandWorkspace.status`, `brandWorkspace.cover`, `brandWorkspace.shortlistShare` 다섯. 목록 밖 이름은 404다. 돌아가는 곳은 brand 캠페인 페이지와 새 캠페인 페이지뿐이다. `/admin/do` 자체는 brand 호스트에서 계속 막혀 있다. 검사 순서는 아래 "보안".
- 테스트: `tests/brands/studio-prep.test.ts`(PGlite + 실제 라우트·디스패처), `tests/brands/studio-door-hardening.test.ts`, `tests/brands/studio-cover.test.ts`, `tests/brands/studio-cover-client.test.ts`, `tests/brands/studio-prep-ui.test.tsx`, `tests/routes/brand-host.test.ts`, `tests/security/workspace-csp.test.ts`. 스윕은 익명 POST가 본문 없는 404인지, 작업공간 페이지의 CSP와 모든 `<script>`의 nonce를 확인한다.

## 보안 (2026-10-29, 대표 요청 "보안 이슈 없게 빡세게 막을 수 없나?")

위협: 이 경로와 `/admin/do`는 관리자 세션 쿠키로 움직인다. brand·admin 호스트 페이지에 남의 스크립트(XSS)가 들어오면 그 스크립트가 관리자의 브라우저에서 같은 출처 요청을 보낼 수 있다. 막는 층과 남는 위험은 아래와 같다.

**1. 남의 스크립트가 실행되지 않게 (CSP, `lib/security/workspace-csp.ts`, `middleware.ts`)**
- 대상: brand.twings.app·admin.twings.app의 모든 응답, 그리고 어느 호스트든 `/brand`·`/admin` 경로(로컬·프리뷰 포함).
- `script-src 'nonce-…' 'strict-dynamic'`: 요청마다 새 nonce. Next.js가 요청의 CSP 헤더에서 nonce를 읽어 자기 스크립트에 붙인다. 브라우저가 보낸 CSP·nonce 헤더는 버린다. 개발 서버만 `'unsafe-eval'`(빠른 새로고침). 인라인 이벤트 핸들러·주입된 `<script>`·`javascript:` 주소는 실행되지 않는다.
- `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`(이 호스트들을 남의 iframe에 넣을 수 없다. 자기 자신도 넣지 않는다), `form-action 'self'`(로그인은 링크라 OAuth 흐름에 영향 없음).
- 넣지 않은 것: `connect-src`·`img-src`·`frame-src` 허용 목록, Trusted Types. 위 위협(같은 출처 관리자 요청)을 막지 못하고, 목록이 틀리면 운영의 서명 업로드·저장 미디어·결제 위젯이 조용히 깨지는데 로컬 모드로는 확인할 수 없다. 운영에서 위반 보고를 받아 실제 출처를 본 뒤 붙이는 것이 다음 단계다.
- 정적 페이지(전역 404)는 nonce를 받을 수 없어 이 호스트들에서 스크립트 없이 보인다. 내용은 그대로 보인다.

**2. 경로 자체 (`app/api/brand-workspace/studio/route.ts`)** — 실패는 모두 본문 없는 404
- `requireAdmin()` → `Origin`이 이 출처와 정확히 같고 `Sec-Fetch-Site: same-origin`, 둘 다 있어야 한다(공용 미들웨어 검사는 둘 중 하나가 없어도 통과시킨다) → 허용 목록 → JSON 호출은 `x-twings-studio: 1` 헤더 필수(다른 사이트의 폼은 이 헤더를 보낼 수 없다) → 본문 64 KB 이하.
- 허용 목록에서 후보 파일 가져오기(4 MB 파일 업로드, 가져오기 작업은 비밀값 전용 경로를 쓴다)와 후보 삭제(되돌릴 수 없음)를 뺐다. 둘 다 admin.twings.app에 그대로 있다.
- 관리자별 한도: 10분에 30건(`lib/admin/brand-host-audit.ts`). 넘으면 429 `studioRateLimited`, 동작도 기록도 하지 않는다.

**3. 탐지 (`platform_audit`, 0046 운영 적용됨, 수정·삭제 불가 트리거)**
- 동작마다 실행 전 `attempt` 행(이 행을 못 쓰면 동작하지 않는다)과 실행 뒤 `result` 행(성공 여부·코드). `action = brandHostStudio.<오퍼레이션>`, 누가(`actor_id`), 무엇에(`entity_id` = 캠페인 또는 브랜드), 언제, 어느 호스트, 그리고 고정값(공개 여부, 바꾼 상태)만 남긴다. 캠페인 이름 같은 자유 문장은 남기지 않는다.
- 조회 예: `select created_at, actor_id, action, entity_id, details from platform_audit where action like 'brandHostStudio.%' order by created_at desc;`
- 실시간 알림(예: 후보 공개·캠페인 완료 시 운영 Slack)은 새 발송 문안이 필요해 **대표 결정**으로 남겼다.

**남는 위험 (솔직하게)**
- CSP는 XSS의 실행을 막는 층이지 0으로 만드는 보증이 아니다. 우리 코드가 신뢰한 스크립트(Next.js 번들, Toss SDK 같은 외부 SDK)가 오염되거나 nonce가 붙는 경로로 주입이 생기면, 그 스크립트는 관리자 세션으로 허용된 5개 동작을 한도 안에서 할 수 있다. 같은 이유로 admin.twings.app의 `/admin/do`(전체 관리자 권한)도 CSP가 1차 방어선이다.
- 한도(10분 30건)는 피해 속도를 늦출 뿐 0으로 만들지 않는다. 감사 기록은 사후 확인용이며 실시간 차단은 아니다.
- `/admin/do`의 요청 검사는 이번에 바꾸지 않았다(기존 `sameOrigin`: Sec-Fetch-Site 또는 Origin 중 하나). 같은 엄격 검사를 거기에도 걸지는 별도 판단이다.

## 무엇이 닫혀 있는가 (쓰기)

운영자 보기는 고객 좌석이 아니다. 아래는 모두 기존 권한 검사 그대로이며 `hasStaffReadAccess`를 참조하지 않는다.

- 고객 동작(승인·수정 요청, 파일 올리기, 캠페인 의뢰, 브랜드 설정 수정, 로고 변경, 초대·해제, 지원 메시지, 셀프 스튜디오 생성·횟수 차감): 멤버십이 없으면 거부. `is_admin`도 고객으로 승인·의뢰·생성할 수 없다.
- 예외는 위 "운영자 캠페인 준비" 하나다. 고객 의뢰가 아니라 스튜디오 준비(`createStudioProject`)이고, `is_admin`만 쓸 수 있다.
- 기존 스튜디오 동작(댓글·첨부·설정·로고 등 `is_admin` 경로): 변경 없음. 스튜디오 댓글은 계속 `author_role = 'studio'`로 남는다.
- 도메인만 있는 운영자(`is_admin` 아님)는 `/admin`, 스튜디오 전용 로더, 관리자 오퍼레이션을 쓸 수 없다.
- 운영자가 어떤 브랜드의 실제 멤버이면 그 브랜드에서는 멤버 역할과 멤버 화면(공개된 캠페인만)을 그대로 쓴다.

## 코드 위치

- 판단: `lib/brands/workspace/staff.ts` (`isStaffEmail`, `verifiedEmailOf`, `hasStaffReadAccess`)
- 세션 이메일: `lib/auth/verified-email.ts`
- 읽기 경로: `lib/brands/workspace/service.ts`(`readableProject`, `memberOrStaff`, 범위·홈·첨부·로고·설정·팀·지원), `lib/brands/production/service.ts`(`reader`)
- 화면: `components/brand-workspace/{identity,staff-notice,project-detail,scope,context}.tsx|ts`, `app/(brand)/brand/**`
- 테스트: `tests/brands/staff-workspace.test.ts`(PGlite + 실제 라우트), `tests/brands/staff-switcher-ui.test.tsx`
