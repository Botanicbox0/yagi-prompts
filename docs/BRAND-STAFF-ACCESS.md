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

모든 운영자 화면 위에 "TWINGS 운영자로 보는 중" 안내가 있다. `is_admin` 계정에는 기존 관리자 화면(`/admin/brand-workspace/organizations/{id}`, `/admin/brand-workspace/{projectId}`) 링크가 붙는다. 그 화면은 스스로 권한을 확인하며, 새 관리자 변경 경로는 추가하지 않았다.

## 무엇이 닫혀 있는가 (쓰기)

운영자 보기는 고객 좌석이 아니다. 아래는 모두 기존 권한 검사 그대로이며 `hasStaffReadAccess`를 참조하지 않는다.

- 고객 동작(승인·수정 요청, 파일 올리기, 캠페인 의뢰, 브랜드 설정 수정, 로고 변경, 초대·해제, 지원 메시지, 셀프 스튜디오 생성·횟수 차감): 멤버십이 없으면 거부. `is_admin`도 고객으로 승인·의뢰·생성할 수 없다.
- 기존 스튜디오 동작(댓글·첨부·설정·로고 등 `is_admin` 경로): 변경 없음. 스튜디오 댓글은 계속 `author_role = 'studio'`로 남는다.
- 도메인만 있는 운영자(`is_admin` 아님)는 `/admin`, 스튜디오 전용 로더, 관리자 오퍼레이션을 쓸 수 없다.
- 운영자가 어떤 브랜드의 실제 멤버이면 그 브랜드에서는 멤버 역할과 멤버 화면(공개된 캠페인만)을 그대로 쓴다.

## 코드 위치

- 판단: `lib/brands/workspace/staff.ts` (`isStaffEmail`, `verifiedEmailOf`, `hasStaffReadAccess`)
- 세션 이메일: `lib/auth/verified-email.ts`
- 읽기 경로: `lib/brands/workspace/service.ts`(`readableProject`, `memberOrStaff`, 범위·홈·첨부·로고·설정·팀·지원), `lib/brands/production/service.ts`(`reader`)
- 화면: `components/brand-workspace/{identity,staff-notice,project-detail,scope,context}.tsx|ts`, `app/(brand)/brand/**`
- 테스트: `tests/brands/staff-workspace.test.ts`(PGlite + 실제 라우트), `tests/brands/staff-switcher-ui.test.tsx`
