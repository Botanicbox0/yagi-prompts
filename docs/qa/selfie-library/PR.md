# PR 초안 — feat(identity): 내 사진 여러 장 보관과 "이 얼굴로 만들까요?" 시트

- **base**: `claude/selfie-upload-ux-c3dff2` (PR #76, `cd34b77`) · **head**: `claude/selfie-library-70826b`
- 이 머신에 `gh`가 PATH에 없어 PR을 열지 못했다. 브랜치는 push했다:
  https://github.com/Botanicbox0/yagi-prompts/pull/new/claude/selfie-library-70826b (base를 `claude/selfie-upload-ux-c3dff2`로 바꿔서 열 것)
- 기능 커밋 `git rev-parse`: `ffbce7c0e6d6b730a74e7420ee9cdb80f35f7673` (이 PR.md는 그 다음 문서 커밋)

## 무엇을 왜
대표 후속 지시(2026-10-22 오후, `docs/PLATFORM-2.0.md` §4): "매번 모바일에서 얼굴을 안 넣어도 되게 알아서 10개까지는 꺼내 쓸 수 있게, '해당 얼굴을 활용해서 제작할까요?' 같은 멘트". PR #76의 정면 셀카 한 장을 **같은 사람의 사진 최대 N장**으로 넓히고, 템플릿 스튜디오가 저장 사진으로 먼저 묻는다.

- **한도** `IDENTITY_SELFIE_LIMIT`: 정수 1~10, 그 밖의 값·미설정은 1. 약관 §5.3("사진 한 장")이 바뀌기 전까지 **1**로 둔다. N=1에서는 PR #76과 같은 경험(사진 한 장 + "사진 바꾸기")이다.
- **데이터**(0050/0137 같은 파일 수정, 둘 다 미적용): "계정당 1장" 인덱스 제거, `is_default`·`last_used_at`·`deleted_at`·`label` 추가, 활성 사진 중 기본 정확히 1장(`identity_selfie_default` 부분 유니크 + `identity_selfies_default_active` 체크 + 프로필 행 잠금 안 승계), 한도 검사도 같은 잠금 안, 중복은 활성 라이브러리 전체 sha256, 이관 행 `is_default=true`, 삭제 권한 없음(소프트 삭제).
- **API** `/api/identity/selfie`: `GET {limit, defaultId, items}` · `POST`(+`replaceId`, 409 `limit_reached`, 하루 20회) · `PATCH {id, isDefault?, label?}` · `DELETE {id}`(소프트, 기본이면 가장 최근 사진 승계, 마지막 1장도 가능). 모두 `private, no-store`, 쓰기는 같은 출처만, JSON 2KB 제한.
- **주문**: `savedSelfiePhoto`가 "소유자의 활성 사진이면 어느 것이든" 바이트를 복사하고 `last_used_at`을 찍는다. 모든 주문 경로가 이 함수만 쓰므로 `lib/billing/toss-service.ts`·`lib/renders/service.ts`는 **수정하지 않았다**(결제 세션과 충돌 없음). 교체·삭제된 id는 그대로 `selfie_required`.
- **화면**: 스튜디오 `SelfieSheet`(기본 사진 크게 + "이 얼굴로 만들까요?" + [이 사진으로 만들기][다른 사진 고르기] → `aria-modal` 시트: 휴대폰 바텀시트/데스크톱 가운데 패널, 썸네일 그리드 + 새로 찍기/사진 올리기, 한도면 바꾸기). 계정 카드·`/identity/selfie`는 `SelfieGrid` 관리 모드(기본 뱃지·기본으로·메모·삭제 확인·"N장 중 M장"). 문장은 사전 키 `selfie.useThisFace` 하나.
- **안전장치 불변**: 동의 없이는 저장 안 됨, 각도·밝기 권고만, 익명·크로스오리진 거부, 소유자 외 404, 제공사 검수·자산 대조 그대로. 다른 사람 사진 자동 판정 없음 — "본인 사진만" 문안.

설계 전체: `docs/IDENTITY-SELFIE.md`. QA 기록·스크린샷: `docs/qa/selfie-library/README.md`.

## `git diff --stat cd34b77..ffbce7c`
```
 app/(app)/account/page.tsx                         |  37 ++-
 app/(app)/identity/selfie/page.tsx                 |  29 +-
 app/api/identity/selfie/[id]/image/route.ts        |   5 +-
 app/api/identity/selfie/route.ts                   | 110 +++++--
 components/identity/selfie-grid.tsx                | 358 +++++++++++++++++++++
 components/identity/selfie-sheet.tsx               | 336 +++++++++++++++++++
 components/identity/selfie-uploader.tsx            |  36 ++-
 components/twings/studio.tsx                       | 114 ++++---
 docs/IDENTITY-SELFIE.md                            | 110 ++++---
 docs/RUNBOOK-deletion.md                           |   1 +
 docs/qa/selfie-library/README.md                   |  51 +++
 docs/qa/selfie-library/*.jpg (15)                  | Bin
 lib/identity/selfie-service.ts                     | 191 +++++++++--
 messages/en.ts                                     |  38 +++
 messages/ko.ts                                     |  39 +++
 scripts/sweep-anon.ts                              |  10 +
 supabase/migrations/0050_core_identity_selfies.sql |  34 +-
 supabase/migrations/0137_glue_identity_selfies.sql |   4 +-
 tests/billing/toss-checkout.test.ts                |  37 ++-
 tests/identity/selfie-migration.test.ts            |  66 +++-
 tests/identity/selfie-service.test.ts              | 220 ++++++++++---
 tests/routes/identity-selfie.test.ts               | 154 +++++++--
 tests/ui/selfie-grid.test.tsx                      | 130 ++++++++
 tests/ui/selfie-sheet.test.tsx                     | 117 +++++++
 tests/ui/selfie-uploader.test.tsx                  |   2 +-
 39 files changed, 1958 insertions(+), 271 deletions(-)
```

## 검증 (AGENTS.md §3 루프, 최종 코드 기준)
| 단계 | 결과 |
| --- | --- |
| `npm run db:local` | 스냅샷 재생성(수정한 0050 포함) |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run` | **269 파일 / 2,583 테스트 통과** |
| `npm run build:local` | 통과(`NEXT_PUBLIC_APP_URL=http://localhost:3007`) |
| `npm run start:local` (`PORT=3007`) + `npm run sweep:anon` | **SWEEP PASSED — 992/992** (새 체크 8개: 익명·크로스오리진 PATCH/DELETE 거부 + `no-store`) |
| `npm run security:client` / `security:built` | 통과(82 client entry points, built assets checked) |

테스트는 실패 → 구현 → 통과 순서로 썼다(구현 전 21개 실패 + 새 컴포넌트 모듈 없음 확인).

포트 메모: 지시대로 3004에서 먼저 돌렸을 때 기능 체크는 모두 통과했지만 canonical/hreflang 절대 URL 56개가 실패했다. 빌드가 `NEXT_PUBLIC_APP_URL`(기본 `http://localhost:3000`)을 정적 페이지에 굽기 때문이다. 같은 출처로 다시 빌드해 3004에서 992/992를 확인했고, 최종 코드는 다른 세션이 3004를 쓰기 시작해 3007에서 같은 방식으로 돌렸다. 다른 포트에서 스윕할 때는 `NEXT_PUBLIC_APP_URL=http://localhost:<port>`로 빌드·실행해야 한다.

추가 확인(로컬 dev, 실제 API·헤드리스 Edge·Claude 앱 브라우저): 시트 Tab 가두기·Shift+Tab·Escape(초점 복귀)·고르면 결제 버튼 초점, 메모·삭제 확인 초점 복귀, 409 `limit_reached`(+limit), 동의 없음 400, 교체 시 3장·기본 유지, 같은 바이트 200 `unchanged`, 크로스오리진 PATCH 403, 지운 사진 이미지 404, 시트 안 업로드 → 새 사진으로 확정, 주문 요청에 고른(기본 아닌) `selfieId`, `selfie_required` 시 남은 사진으로 다시 묻기. 표는 `docs/qa/selfie-library/README.md`.

## 스크린샷 (`docs/qa/selfie-library/`)
휴대폰 390×844: `mobile-studio-confirm-ko.jpg`, `mobile-sheet-grid-ko.jpg`, `mobile-studio-chosen-ko.jpg`, `mobile-sheet-full-ko.jpg`(한도), `mobile-sheet-one-ko.jpg`(N=1), `mobile-account-grid-ko.jpg`, `mobile-account-delete-confirm-ko.jpg`, `mobile-account-one-ko.jpg`, `mobile-selfie-page-ko.jpg`, `mobile-studio-empty-ko.jpg`
데스크톱 1280×900: `desktop-studio-confirm-ko.jpg`, `desktop-sheet-grid-ko.jpg`, `desktop-account-grid-ko.jpg`, `desktop-account-full-ko.jpg`(한도), `desktop-selfie-page-add-ko.jpg`
사진은 사이트에 이미 공개된 AI 생성 가이드 이미지 한 장의 변형(같은 사람)이다. 실제 인물 사진은 쓰지 않았다.

## 건너뛴 검사
- 실제 토스 결제(테스트 키 결제창·승인) — 이 worktree에 키가 없다. 주문 생성·계보는 `tests/billing/toss-checkout.test.ts`와 요청 가로채기로 확인.
- 실기기 iOS Safari·Android — 헤드리스 Edge 모바일 에뮬레이션(터치·모바일 UA)과 Claude 앱 브라우저로만 확인.
- en 스크린샷 — en 마크업은 `tests/ui/selfie-sheet.test.tsx`·`selfie-grid.test.tsx`가 두 언어로 고정.
- 클라우드 마이그레이션 적용(대표·Director 몫).

## 클라우드 적용 필요 (코드 배포 **전**)
- `supabase/migrations/0050_core_identity_selfies.sql` (2.0 수정본)
- `supabase/migrations/0137_glue_identity_selfies.sql` (수정본: 권한 그대로, 삭제 권한 없음 주석)
PR #76이 아직 병합·적용 전이라 새 번호를 만들지 않고 같은 파일을 고쳤다. 혹시 PR #76의 0050이 먼저 적용됐다면 이 수정본을 그대로 다시 적용할 수 없다 — 그때는 차이(컬럼 4개, 인덱스 교체, 체크, 이관 행 기본 지정)를 새 번호로 옮겨야 한다.

## 환경변수
- `IDENTITY_SELFIE_LIMIT` — 설정하지 않으면 1. 대표가 약관 §5.3 문안("같은 사람의 사진 최대 10장, 인물 자산 그룹 1개는 그대로")을 승인하면 Vercel Production에 `10`을 넣고 재배포. 올릴 때 `ARK_RELEASE_AFTER_USE`가 켜져 있는지 같이 본다(PLATFORM-2.0 §4).

## 대표 결정 필요
1. 약관 §5.3 문안 승인 → 한도 10.
2. 화면 문장 "이 얼굴로 만들까요?" 유지 또는 원문 "해당 얼굴을 활용해서 제작할까요?"(`messages/ko.ts` `selfie.useThisFace` 한 곳).
3. 지운 사진 파일을 계정 삭제 전에도 정리할지(예: 30일).

## 남은 위험
- 시트는 "다른 사진 고르기"로 여는 모달이고, 질문 카드는 휴대폰·데스크톱 모두 인라인이다. "모바일 바텀시트"를 질문 카드 자체로 읽었다면 조정이 필요하다(PLATFORM-2.0 §3.2의 하단 고정 CTA 작업과 함께 붙이기 쉽다).
- 저장 사진이 있으면 이제 한 번 "이 사진으로 만들기"를 눌러야 결제 버튼이 열린다(대표 요청의 질문). 첫 업로드 직후에는 묻지 않는다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
