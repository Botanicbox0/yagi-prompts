# 브랜드 워크스페이스 정체성과 로고 (2026-09-23)

브랜드 워크스페이스 사이드바에 "지금 어느 브랜드를 보고 있는지"를 보여 주고, 브랜드마다 비공개 로고를 붙일 수 있게 한 작업의 요약이다. 실제 고객 이름·자료·이미지는 코드, 테스트, 마이그레이션, 이 문서 어디에도 넣지 않았다.

## 1. 브랜드 번호는 따로 만들지 않는다

브랜드의 식별자는 `brand_organizations.id`(UUID) 하나다. 이미 모든 권한 검사, 캠페인, 초대, 지원 메시지가 이 값을 기준으로 묶여 있고, 추측할 수 없는 값이라 URL에 드러나도 권한을 주지 않는다. 사람이 읽는 순번을 새로 만들면 두 번째 식별자를 동기화해야 하고, 순번은 다른 브랜드의 존재와 개수를 드러낸다. 그래서 새 번호는 두지 않았다.

## 2. 선택한 브랜드는 URL에만 있다

- 워크스페이스 링크는 모두 `?organizationId=<uuid>`를 달고 다닌다. 쿠키나 서버의 "현재 브랜드" 상태는 없다. 링크를 복사하면 같은 브랜드가 열리고, 탭마다 다른 브랜드를 볼 수 있다.
- 선택 규칙(`lib/brands/workspace/selection.ts`의 `resolveWorkspaceSelection`):
  1. 캠페인 화면(`/brand/projects/<id>` 이하)은 그 캠페인을 가진 브랜드로 고정된다. 쿼리가 다른 브랜드를 가리켜도 무시한다.
  2. 그다음은 쿼리. 이 계정이 열 수 있는 브랜드 목록과 대조한다.
  3. 쿼리가 없으면 첫 번째 브랜드(가장 먼저 만든 소속 브랜드).
  4. 열 수 없는 브랜드, 형식이 틀린 값, 쿼리를 두 번 넣은 경우는 "열 수 없는 브랜드"로 표시한다. 다른 브랜드로 조용히 바꿔 보여 주지 않는다.
- 스튜디오 결과 화면(`/brand/studio/<id>`)은 결과가 속한 브랜드로 URL을 다시 맞춘다(리다이렉트).
- 선택 가능한 브랜드(`loadBrandWorkspaceScope`): 활성 소속 브랜드(역할 그대로) + 공개 중인 캠페인에 초대받아 들어온 브랜드(`guest`). guest로 목록에 오른다고 소속, 소유자 권한, 팀·설정 접근이 생기지 않는다. 초대가 취소되거나 캠페인이 비공개로 바뀌면 목록에서 빠진다.

## 3. 화면이 따르는 것은 선택한 브랜드의 역할이다

| 선택한 브랜드에서의 역할 | 홈·라이브러리 | 스튜디오 | 브랜드 설정 | 팀 관리 | 새 의뢰 |
| --- | --- | --- | --- | --- | --- |
| 소유자 | 그 브랜드 것만 | 열림 | 수정 + 로고 관리 | 열림 | 가능 |
| 편집자 | 그 브랜드 것만 | 열림 | 읽기 전용 | 숨김 | 가능 |
| 열람자 | 그 브랜드 것만 | 열림(의뢰 없음) | 읽기 전용 | 숨김 | 불가 |
| 공유 캠페인(guest) | 공유된 캠페인만 | 숨김 | 숨김 | 숨김 | 불가 |

A 브랜드 소유자라도 열람자로 있는 B 브랜드를 보고 있을 때는 B의 권한만 보인다. 메뉴는 표시일 뿐이고, 모든 페이지와 API는 지금까지처럼 서버에서 따로 권한을 검사한다. 홈과 라이브러리는 서버에서 선택한 브랜드로 좁혀 불러온다(`loadBrandWorkspace(..., { organizationId })`).

사이드바: TWINGS 로고 아래에 브랜드 로고(없으면 이름 첫 글자), 이름, 역할을 보여 준다. 브랜드가 하나면 그대로 보여 주고, 둘 이상일 때만 `<details>` 기반 목록을 연다. 키보드, 터치, JavaScript 없이도 동작하고 Esc로 닫힌다. 국가 표시는 저장된 값이 없으므로 넣지 않았다.

## 4. 로고 저장 경로

- 테이블 `brand_organization_logos`(추가만 가능한 이력)와 `brand_organizations.logo_id`·`logo_revision`. 복합 외래 키 때문에 다른 브랜드의 로고를 가리킬 수 없다. 캠페인이 없어도 로고를 붙일 수 있다.
- 바이트는 비공개 staging 버킷 `brands/<organization_id>/logos/<logo_id>`에만 저장한다. 공개 버킷 사본과 외부 URL 필드는 없다.
- 형식: 실제 바이트를 확인해 PNG, JPEG, WebP만 받는다. 2 MiB 이하. 선언한 형식이 있으면 바이트와 일치해야 한다.
- 쓰기: 그 브랜드 소유자 또는 스튜디오. 편집자·열람자는 `forbidden`, 비소속·없는 브랜드는 `not_found`. 같은 `requestId`로 같은 바이트를 다시 보내면 첫 결과를 돌려주고, 다른 바이트면 `conflict`. `expectedRevision`이 맞지 않아도 `conflict`.
- 읽기: `GET /api/brand-workspace/organizations/<id>/logo`. 활성 소속, 공개 중인 캠페인의 활성 guest, 스튜디오만 받는다. 그 밖의 경우와 로고가 없는 경우는 모두 404. 응답은 `private, no-store`.
- 삭제: 포인터만 비운다(기본 아바타로 돌아감). 저장소에는 삭제 기능이 없으므로 바이트는 남는다.
- 화면: 관리자 조직 페이지(`/admin/brand-workspace/organizations/<id>`)에서 올리기·삭제, 브랜드 설정 페이지에서 소유자가 올리기·삭제.

## 5. 서비스 함수 (로컬에서 추출한 로고를 붙일 때)

```ts
import { storeBrandOrganizationLogo, removeBrandOrganizationLogo, loadBrandSettings } from "@/lib/brands/workspace/service";
// deps.sql: SqlRunner, deps.storage: putStaging을 가진 StorageDriver(getStorage())
// viewer: 스튜디오 관리자(is_admin) 또는 그 브랜드 소유자의 Viewer
const current = await loadBrandSettings({ sql }, viewer, organizationId, true); // 스튜디오면 true
const result = await storeBrandOrganizationLogo({ sql, storage }, viewer, {
  organizationId,                 // 브랜드 UUID
  requestId: crypto.randomUUID(), // 재시도할 때는 같은 값을 다시 쓴다
  expectedRevision: current!.logoRevision,
  bytes,                          // Uint8Array/Buffer. PNG·JPEG·WebP, 2 MiB 이하
  // mime: "image/png",           // 선택. 주면 바이트와 일치해야 한다
});
// { ok: true, id, revision } 또는 { ok: false, code: "invalid" | "conflict" | "forbidden" | "not_found" | "storage_unavailable" }
```

관리자 화면을 쓰면 같은 서비스를 `brandWorkspace.logo` / `brandWorkspace.logoRemove` 오퍼레이션(`/admin/do`)으로 호출한다. 브랜드 이름으로 로고를 찾아 붙이는 공개 매핑은 두지 않았다.

## 6. 마이그레이션과 남은 일

- `0035_core_brand_organization_logo.sql`, `0121_glue_brand_organization_logo.sql`: **클라우드 적용 필요.** 0034/0120 다음에 적용한다. 로컬 PGlite 스냅샷은 `npm run db:local`로 다시 만든다.
- 적용 전에 이 코드를 배포하면 새 컬럼을 읽는 브랜드 화면이 실패한다. 마이그레이션을 먼저 적용해야 한다.
- 로고 응답은 캐시하지 않는다(권한 회수가 곧바로 반영되도록). 사이드바는 화면을 옮길 때마다 작은 이미지를 한 번씩 다시 받는다.
- 이미지 크기(가로·세로 픽셀)는 검사하지 않는다. 형식과 용량만 본다. 표시할 때는 `object-fit: contain`으로 맞춘다.
- 전체 검증 루프(빌드, 로컬 서버, 스윕, 브라우저 확인)는 코디네이터가 한다.

## 7. 담당자 초대와 최종 검증

- TWINGS 내부 어드민의 브랜드 담당자 초대에서 `owner`를 선택하면, 초대받은 이메일로 인증·수락한 계정에 해당 브랜드의 **워크스페이스 관리자 / Workspace admin** 권한을 부여한다. `profiles.is_admin`은 바뀌지 않는다.
- 브랜드 관리자는 자기 브랜드의 설정·로고·팀을 관리하고 편집자/열람자를 초대할 수 있다. 워크스페이스 관리자 지정은 기존 내부 어드민 경로를 유지한다. 마지막 관리자를 제거할 수 없고, 캠페인만 초대받은 손님은 관리자로 승격되지 않는다.
- `workspace-admin-invitation.test.ts`에서 실제 초대 수락부터 설정 수정, 팀원 초대, 타 브랜드 차단, 내부 어드민 차단, 마지막 관리자 보호를 검증했다.
- 홈 로고·서비스 간 안내 링크·문의창도 선택한 브랜드를 따른다. 브랜드를 전환하면 문의창은 다시 마운트되어 이전 브랜드의 대화나 작성 중인 메시지가 넘어가지 않는다.
- Codex 최종 검증: `npx tsc --noEmit` 통과, 전체 Vitest **141 파일 / 1,565 테스트 통과**, `npm run db:local`, `npm run build:local`, `npm run start:local` 통과, 익명 스윕 **637/637 SWEEP PASSED**.
- 브라우저: 로컬 관리자 초대 수락 픽스처로 브랜드 이름·역할·팀·설정 접근과 KO/EN 화면을 확인했다. 390px 모바일 화면도 직접 확인했다. 고객 자료와 스크린샷은 비공개 로컬 경로에만 보관한다.
- 실제 고객 초대, 클라우드 마이그레이션, 운영 로고·캠페인 데이터 반영은 수행하지 않았다. 로고 추출 시안과 원본 픽셀 추출 확정은 코드 검증과 별개다.
