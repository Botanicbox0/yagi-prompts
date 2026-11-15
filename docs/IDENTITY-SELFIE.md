# 내 사진 — 정면 셀카, 최대 N장 보관 (설계 메모)

2026-10-22 · 대표 결정 · 생성형 기준 사진(Sunburst·Seedream 비교) 흐름을 대체한다. 이전 계약은 [IDENTITY-PORTRAIT.md](IDENTITY-PORTRAIT.md)에 기록으로만 남긴다.
같은 날 오후 후속 지시로 "한 장"이 "같은 사람의 사진 최대 N장 + '이 얼굴로 만들까요?'"로 넓어졌다(PLATFORM-2.0 §4). N은 환경변수 `IDENTITY_SELFIE_LIMIT`(기본 1, 상한 10)이고, 약관 §5.3 문안을 대표가 승인하면 Vercel에서 10으로 올린다.

## 1. 대표 요청과 해석

| 대표 원문 요지 | 구현 |
| --- | --- |
| 기준 사진 **생성 과정을 없앤다.** 자연스러운 정면 셀카 한 장만 올리면 된다. | 셀카 업로드 → 즉시 미리보기 → 각도·밝기 권고 → 저장 → 모든 주문에서 재사용(교체 가능). 생성 API 호출·비교 선택 화면·무료 횟수 개념을 모두 제거했다. |
| 로그인 직후 `/account`로 떨어지는 게 거칠다. 영상 포맷 목록으로, 보던 템플릿이 있으면 그 템플릿으로. | OAuth 콜백·`/auth/signin`은 이미 `/{locale}/video`가 기본이었다. 남아 있던 예외가 **심사 계정 로그인**(`/auth/review/login` → `/account`)이었고, 이를 `/{locale}/video` 기본 + `next` 유지로 바꿨다. `/auth/choose`의 심사 로그인 링크도 `next`를 넘긴다. |
| "내 사진 업로드" 진입점을 눈에 띄게. 셀카가 없으면 템플릿 "만들기"에서 그 자리에서 올리고 결제로. | 진입점 4곳: ① 템플릿 페이지 스튜디오 안 인라인 업로더(기본 경로), ② 계정 페이지 첫 카드, ③ 헤더 계정 메뉴 "내 사진"(데스크톱·모바일), ④ 전용 페이지 `/identity/selfie`(브랜드 스튜디오·커뮤니티가 링크). |
| "매번 모바일에서 얼굴을 안 넣어도 되게 알아서 10개까지는 꺼내 쓸 수 있게, '해당 얼굴을 활용해서 제작할까요?' 같은 멘트" | 저장 사진이 있으면 스튜디오가 먼저 묻는다: 기본 사진 크게 + **"이 얼굴로 만들까요?"** + [이 사진으로 만들기] [다른 사진 고르기]. "다른 사진"은 모달 시트(휴대폰은 바텀시트, 데스크톱은 같은 구조의 가운데 패널)의 썸네일 그리드 + 새로 찍기/사진 올리기. 문장은 사전 키 하나(`selfie.useThisFace`)라 대표 원문으로 바꾸기 쉽다. 보관 한도는 `IDENTITY_SELFIE_LIMIT`. |

포지션은 그대로다: 내 얼굴로 트렌드 포맷의 주인공이 되는 곳. 사진은 수단이지 기능이 아니므로, 사진을 "준비"하는 별도 단계를 두지 않고 **포맷을 고른 자리에서 한 번** 끝낸다.

## 2. 흐름

```
로그인 ──▶ /{locale}/video (보던 템플릿이 있으면 그 템플릿 #make)
                │
                ▼
템플릿 페이지 #make ──▶ /api/renders/access ──▶ 저장 사진 있음? ──┬─ 예 ─▶ [이 얼굴로 만들까요?] 기본 사진 크게
                                                                │          ├ 이 사진으로 만들기 ──────────────┐
                                                                │          └ 다른 사진 고르기 ─▶ 시트(aria-modal)│
                                                                │               썸네일 그리드(최대 N) → 고르기 ──┤
                                                                │               새로 찍기/사진 올리기(한도면 바꾸기)┤
                                                                │                                              ▼
                                                                │                         얼굴 확정 → 결제 버튼으로 스크롤·포커스
                                                                └─ 아니오 ─▶ [인라인 업로더] 카메라/사진/드롭 → 미리보기
                                                                           → 각도·밝기 권고(권고만) → 본인 사진 동의 ☑
                                                                           → "내 사진 저장" POST /api/identity/selfie
                                                                           → 저장됨 = 이번 주문의 얼굴 → 결제 버튼
                │
                ▼
"{가격} 결제하고 만들기" ──▶ POST /api/billing/toss/orders {selfieId}
                               서버가 그 사진(소유자의 활성 사진이면 어느 것이든)의 바이트를 주문 input에 복사
                               (identity_selfie_id 기록, last_used_at 갱신)
                               └▶ 토스 결제창 → 승인 → createRenderJob(주문의 바이트 그대로)
```

구독(월정액)·캠페인 제작·브랜드 스튜디오·커뮤니티 이미지 보상도 같은 `selfieId`를 보낸다. 모든 경로는 `savedSelfiePhoto(sql, store, userId, id)` 한 함수로만 바이트를 읽는다. 브랜드 스튜디오·커뮤니티·접근 API는 `currentSelfie`(= 기본 사진)를 쓴다.

## 3. 화면별 상태

### 템플릿 스튜디오 `data-selfie-panel`
| 상태 | 표시 | 결제 버튼 |
| --- | --- | --- |
| 사진 없음 (`data-selfie-present="false"`) | 인라인 업로더(빈 상태: 얼굴 아이콘 + 한 줄 안내 + 카메라/사진 버튼) | 비활성, 힌트 "먼저 내 사진을 올려주세요" |
| 업로더: 사진 선택됨 / 저장 중 / 저장 실패 | PR #76 그대로(미리보기·권고·동의, `aria-busy`, `role=alert`로 원인과 복구) | 비활성 |
| 업로더: 저장됨 | 그 사진이 이번 주문의 얼굴이 된다(질문 없이). "저장했어요" 알림 | **활성**, 스크롤·포커스 이동 |
| 질문 (`data-selfie-sheet-state="confirm"`) | 기본 사진(4:5) 크게 + **"이 얼굴로 만들까요?"** + 메모·기본·저장일 + [이 사진으로 만들기](48px) [다른 사진 고르기](44px) | 비활성, 힌트 "어떤 얼굴로 만들지 먼저 골라주세요." |
| 확정 (`data-selfie-sheet-state="chosen"`) | 작은 사진 + "이 얼굴로 만들어요" + [다른 사진 고르기] | **활성**, 스크롤·포커스 이동 |
| 시트 열림 (`data-selfie-chooser`) | `role=dialog` `aria-modal` `aria-labelledby`, 닫기(44px), 썸네일 그리드(`data-selfie-pick`, `aria-pressed`), 한도 아래면 새로 찍기(휴대폰만)/사진 올리기, 한도면 "사진 바꾸기"(표시된 사진과 교체). "본인 사진만" 안내. 불러오는 중 `role=status`, 실패 시 다시 불러오기 | 비활성(시트가 닫힐 때까지) |
| 시트: 새 사진 (`data-selfie-chooser-view="upload"`) | "사진 목록으로" + 고른 파일로 바로 미리보기(업로더 재사용) → 저장 → 그 사진으로 확정 | 비활성 |
| 주문 시 `selfie_required` | 고른 사진이 다른 탭에서 지워졌거나 바뀐 경우. 남은 사진이 있으면 질문으로, 없으면 업로더로 되돌리고 "사진 목록이 바뀌었어요. 다시 골라주세요." 선택한 비율·화질은 유지 | 비활성 |

키보드·초점: 시트를 열면 제목으로 초점이 가고(낭독), 사진이 오면 이번 주문의 사진 타일로 옮긴다. Tab은 시트 안에서 돈다(`trapFocusIndex`). Escape·배경 탭·닫기는 시트를 닫고 [다른 사진 고르기]로 초점을 돌려준다. 고르면 시트가 닫히고 결제 버튼으로 초점이 간다(기존 동작). 저장 중에는 닫히지 않는다. 시트는 `document.body`로 포털되고 열린 동안 페이지 스크롤을 잠근다. 움직임은 CSS 트랜지션만(`motion-reduce`면 없음).

접근(`/api/renders/access`)은 포커스·`pageshow`마다 갱신되지만, 사람이 사진을 고르는 중(`selfieEditingRef`)에는 패널을 갈아끼우지 않는다. 기본 사진이 다른 탭에서 바뀌면 질문을 다시 한다.

### 권고 (차단 아님 — AGENTS.md §5, 2026-10-15 대표 결정)
- 각도: 기존 MediaPipe 워커(`/workers/photo-advice-v1.js`) 그대로. 분석 중·경고·미검출·실패 모두 저장 가능.
- 밝기: 64×64 다운스케일 luma 평균과 양끝 비율로 `dark`/`bright` 힌트(`lib/identity/photo-advice.ts assessPhotoLight`). 기기 안에서만 계산, 저장하지 않음.
- 두 권고는 한 문단으로 합쳐 `aria-live="polite"`로 읽힌다.
- **다른 사람 사진 자동 판정은 하지 않는다**(얼굴 매칭은 권고 범위를 넘는다). "본인 사진만 올려주세요. 여기 있는 사진은 모두 같은 사람이어야 해요."를 시트·페이지에 문안으로만 둔다.
- **저장한 사진 확인(서버, 2026-11-15, 코드 기본값은 꺼짐·운영은 켜짐)**: `TWINGS_PHOTO_CHECK=on` + `GEMINI_API_KEY` + 0089 적용일 때만. 저장한 사진 한 장당 한 번 Gemini(`gemini-4-hydrogen`, `GEMINI_PHOTO_CHECK_MODEL`로 교체)에 사진 품질 사실(얼굴 수·실제 인물·가림·각도·선명도·빛·크기)만 묻고, 판정(`good`/`check`/`retake` + 항목)은 서버가 정해(`lib/identity/photo-check.ts photoVerdict`) `identity_selfies.photo_check`에 남긴다. 신원·나이·감정은 묻지 않는다. 문구는 `selfie.photoCheck` 사전. 시트("이 얼굴로 만들까요?"·고른 사진)와 `/identity/selfie` 저장 직후에 보이고, 결과 없음·실패·확인 중이면 아무것도 보이지 않는다. 어떤 결과도 버튼을 막지 않는다. API `POST /api/identity/selfie/{id}/check` → `{ ok, check }`(꺼짐 404 `off`, 남의 것 404 `not_found`, 익명 401, 다른 출처 403). **켜기 전에** 개인정보처리방침에 처리 위탁(Google)을 넣어야 하고, 이 확인이 켜지면 `selfie.photoAdvisoryHint`의 "이 기기에서만 살펴보고 분석 결과는 저장하지 않아요"도 고쳐야 한다(대표 결정).

### `/identity/selfie` (전용 페이지)
사진이 없으면 업로더 하나. 있으면 관리 그리드(아래 계정과 같은 것) + [사진 추가](한도 아래) 또는 [사진 바꾸기](한도, 기본 사진과 교체) + "템플릿으로 돌아가기"(`next`) 또는 "영상 포맷 고르기". `?add=1`·`?change=1`이면 바로 업로더를 연다. 비로그인은 `/auth/choose?next=/identity/selfie?next=…`.

### 계정 `/account` `data-selfie-account`
이름 카드 바로 아래 첫 카드 "내 사진": 관리 그리드(`data-selfie-grid data-selfie-mode="manage"`) — 사진마다 기본 뱃지(2장 이상일 때), [기본으로], [삭제](한 번 더 묻고 소프트 삭제), [메모](40자, Enter 저장·Escape 취소), 위에 "N장 중 M장"(N>1일 때). 아래 [사진 추가 →](`/identity/selfie?add=1`) 또는 N=1이면 [사진 바꾸기](`?change=1`). 사진이 없으면 "아직 올린 사진이 없어요" + [내 사진 올리기 →]. 결과는 `role=status`로 알린다.

N=1에서는 사진 한 장만 보인다: 카운터·기본 뱃지·[기본으로] 없이 메모와 삭제, 그리고 [사진 바꾸기].

관리 그리드는 컨테이너 너비로 모양을 바꾼다(`@container`): 좁으면(휴대폰 계정 카드, `/identity/selfie`의 좁은 열) 사진 한 장당 한 줄 — 썸네일 + 제목·저장일 + [기본으로][메모][삭제] 한 줄 — , 넓으면(데스크톱 계정 카드) 3열 카드. 제목은 메모가 없으면 "사진 N"이고, 화면 낭독용 이름도 "사진 N · 기본 · {날짜} 저장"이라 같은 날 저장한 사진끼리 구별된다. 메모 칸·"그대로 두기"는 나타나면서 초점을 받고(`autoFocus`), 닫히면 연 버튼으로 돌려준다.

### 헤더 계정 메뉴 `data-creator-selfie`
"내 사진" → `/identity/selfie`. 데스크톱 드롭다운과 모바일 시트 둘 다.

## 4. 데이터·저장

- 테이블 `identity_selfies`(0050 core / 0137 glue, 둘 다 미적용이라 같은 파일을 고쳤다). 새 테이블 없음.
- **한도**: "계정당 현재 1장" 부분 유니크 인덱스를 없앴다. 활성 사진(`deleted_at`·`replaced_at` 둘 다 비어 있음) 수 ≤ N 검사는 `saveSelfie`가 **프로필 행 잠금**(`select … for update`) 안에서 한다 — 두 탭이 동시에 한도를 넘지 못한다. N=`IDENTITY_SELFIE_LIMIT`(정수 1~10, 그 밖의 값은 1). 한도를 내려도 이미 있는 사진은 그대로 쓰고·바꾸고·지울 수 있고, 새 사진만 못 들어간다.
- **컬럼**: `is_default boolean not null default false`, `last_used_at timestamptz`, `deleted_at timestamptz`, `label text`(1~40자, 비우면 null).
- **기본 사진**: 활성 사진 중 정확히 1장. "최대 1장"은 부분 유니크 인덱스 `identity_selfie_default (user_id) where is_default and deleted_at is null and replaced_at is null`, "교체·삭제된 행은 기본일 수 없음"은 체크 `identity_selfies_default_active`, "최소 1장"은 서비스가 잠금 안에서 지킨다(첫 사진이 기본, 기본을 지우면 가장 최근에 올린 활성 사진이 기본, 기본을 바꾸면 새 사진이 기본을 물려받음).
- **순서**(시트·그리드): 기본 → `last_used_at` 최신 → 최근 저장. 시트가 먼저 묻는 사진은 기본 사진(혹시 없으면 마지막 사용 사진).
- **중복**: 같은 바이트(sha256)는 활성 라이브러리 **전체**와 비교해 멱등 — 그 사진 id를 돌려준다(한도여도).
- **교체**: `replaceId`로 활성 사진 하나를 새 사진으로 바꾼다(새 행 + 이전 행 `replaced_at`). 한도에 찼을 때 들어오는 유일한 길이다. 이전 행 id로 새 주문은 `selfie_required`.
- **삭제**: 소프트 삭제(`deleted_at`). 행과 `{selfieId}/selfie.png`는 지우지 않는다(결제한 주문의 계보). 소유자에게도 사라진다(이미지 404, 주문 `selfie_required`). 파일은 계정 삭제 런북이 지운다([RUNBOOK-deletion.md](RUNBOOK-deletion.md) §2). 마지막 1장도 지울 수 있다.
- 하루 저장 20회(교체·삭제된 행 포함, 지웠다 올리기로 우회 불가).
- 바이트는 비공개 `renders` 버킷 `{selfieId}/selfie.png`. 서버에서 방향 보정·메타데이터 제거·최대 1600px(얼굴 크롭·왜곡 없음). 읽기는 소유자 세션 + `private, no-store`.
- **주문·렌더 계보**: `billing_payments.identity_selfie_id`, `render_jobs.identity_selfie_id`. 결제 시점에 바이트를 주문 input으로 **복사**하므로 이후 교체·삭제가 결제한 작품을 바꾸지 않는다. `platform_redemptions.portrait_id`(FK 없음)는 셀카 id를 그대로 담는다.
- **새 주문은 소유자의 활성 사진이면 어느 것이든** 쓴다(기본이 아니어도). `savedSelfiePhoto`가 그때 `last_used_at`을 갱신한다(호출자의 트랜잭션 안이면 함께 롤백). 교체·삭제된 id·남의 id는 `selfie_required`.
- **다시 결제하기**(`retryTossOrder`, PR #78)도 새 주문이다: 실패한 주문의 바이트 사본을 쓰지만 `identity_selfie_id` 계보를 새 주문에 그대로 넘기고, 그 사진이 그사이 교체·삭제됐으면 `selfie_required`로 거절한다(`useSavedSelfie`, `last_used_at` 갱신). 화면은 기존 "새 주문을 만들지 못했어요. 템플릿에서 다시 시작해 주세요."를 보이고, 템플릿에서 "이 얼굴로 만들까요?"가 다시 묻는다.

### API `/api/identity/selfie` (모든 응답 `private, no-store`)
| 메서드 | 요청 | 응답 |
| --- | --- | --- |
| `GET` | — | `{ ok, limit, defaultId, items: [{ id, createdAt, label, isDefault, lastUsedAt, width, height, imageUrl }] }` (미리보기는 기존 소유자 전용 `/api/identity/selfie/{id}/image`) |
| `POST` | multipart `photo`, `consent=yes`, 선택 `replaceId` | 201 새 사진 / 200 같은 바이트, `{ ok, id, replaced, unchanged, selfie, library }`. 401 로그인, 403 다른 출처, 400 `consent_required`·`bad_photo`, 409 `limit_reached`(+`limit`), 404 `not_found`(교체 대상 없음), 429 `rate_limited`, 413 큰 본문 |
| `PATCH` | JSON `{ id, isDefault?: true, label?: string \| null }` (다른 키 금지, 2KB) | `{ ok, …library }`. 400 `invalid`, 404 `not_found`(남의 것·지운 것) |
| `DELETE` | JSON `{ id }` (2KB) | `{ ok, …library }`(새 기본 포함). 404 `not_found` |

익명 401, 쓰기는 같은 출처만(403), 남의 사진은 404. 스윕이 익명·크로스오리진 PATCH/DELETE 거부와 `no-store`를 고정한다.

### 이미 고른 기준 사진이 있는 계정 — 재업로드 없이 이관
0050이 `identity_portrait_selections`에서 **선택이 끝난 성공 결과**를 계정별 **기본 사진**(`is_default=true`)으로 옮긴다(`input_key`는 그 결과 객체 `{attemptId}/result.png`를 그대로 가리키고, 바이트는 복사하지 않는다). 토스 심사 계정(`pg-review-20261014@twings.app`)은 10/22 14:15 KST에 Sunburst·Seedream 결과와 선택이 이미 있으므로, 배포 후에도 **셀카를 다시 올리지 않고** 그 사진으로 결제창까지 간다(스튜디오가 "이 얼굴로 만들까요?"를 물으면 한 번 누르면 된다. 심사 계정 한정 "AI 가상 인물" 예외는 PR #75 `REVIEW-ACCOUNT.md`의 대표 결정, 일반 사용자 규칙은 그대로). 이관 행의 `sha256`은 객체 키의 해시라 실제 업로드와 절대 같지 않다 → 한도 1에서는 새 사진이 이관 행을 **바꾸고**(`replaceId`), 한도가 크면 옆에 더해진다. `tests/identity/selfie-migration.test.ts`가 이관·기본 지정·소유자 격리·재적용 거부(`identity_selfie_default`)를 고정한다.

### 기존 생성형 portrait 테이블 — 유지(읽기 전용)
`identity_portrait_attempts`/`identity_portrait_selections`와 `billing_payments.identity_portrait_id`·`render_jobs.identity_portrait_id`는 **남긴다.**
근거: 이미 결제·렌더된 작품이 FK로 참조하고 있어 drop하면 계보가 끊긴다(ON DELETE SET NULL로 null만 남음). 운영 DB에 0029/0115가 적용되지 않았을 수도 있어(IDENTITY-PORTRAIT.md "새 클라우드 적용 필요") 이 PR은 그 상태를 건드리지 않는다. 코드에서는 더 이상 읽지도 쓰지도 않는다(생성 서비스·프로바이더·프롬프트 계약·라우트·페이지 삭제). 폐기(drop)와 저장 파일 정리는 대표가 "과거 결과를 보존할 필요 없음"을 결정한 뒤 별도 마이그레이션으로 한다.

## 5. 안전장치 (바뀌지 않은 것)
- 본인 사진 동의 체크 없이는 저장되지 않는다(`consent_required`). 새로 올리는 모든 사진(추가·교체·시트 안 업로드)이 같은 업로더·같은 동의를 지난다.
- 제공사 검수·ModelArk 실인물 자산 대조·카메라 본인 인증(`/identity/verify`)·held 작업 흐름은 그대로다. 사진은 그 경로에 들어가는 입력일 뿐이고, 어느 사진을 고르든 같은 경로를 탄다.
- 얼굴 각도·밝기 판정은 권고만 한다. 어떤 상태에서도 저장 버튼은 "파일 + 동의"로만 열린다.
- 한 계정의 사진은 같은 사람이어야 한다 — 자동 판정 없이 약관(§5.3)·문안·신고(24시간 검토)로 다룬다.
- 익명·크로스오리진 쓰기 거절, 소유자 외 404, 응답 `private, no-store`(스윕이 고정).

## 6. 심사 경로 (RENDER_PIPELINE_PUBLIC=review)
심사 계정(`app_metadata.purpose=toss_review`) 로그인 → `/{locale}/video` → 템플릿 → (이관된 사진이 있으면 "이 얼굴로 만들까요?" → [이 사진으로 만들기], 없으면 인라인 셀카 저장) → 결제창. `tests/billing/toss-checkout.test.ts`가 review 모드에서 셀카 저장→`createTossOrder` 성공, 일반 계정은 `not_open`임을 고정한다. 비밀번호는 보지도 입력하지도 않는다.

## 7. 클라우드 적용 필요
- `supabase/migrations/0050_core_identity_selfies.sql` (2.0 수정본: 4개 컬럼, `identity_selfie_default`, `identity_selfies_default_active`, 이관 행 `is_default=true`, "계정당 1장" 인덱스 제거)
- `supabase/migrations/0137_glue_identity_selfies.sql` (권한은 그대로 select/insert/update, 삭제 권한 없음)
- `supabase/migrations/0089_core_identity_selfie_photo_check.sql` (`photo_check jsonb`, `photo_checked_at`; glue 없음 — 0137의 표 단위 권한을 그대로 물려받는다). 적용 전에는 사진 확인이 꺼진 채로 동작한다. **2026-11-15 운영 적용**, 같은 날 Vercel Production에 `TWINGS_PHOTO_CHECK=on`(대표 지시). 개인정보처리방침 §1·§5와 이용약관 제2조에 Google(얼굴 사진: Gemini 이미지 생성, 저장한 사진의 적합성 확인)을 함께 올렸다.

코드 배포 **전에** 적용해야 한다. 적용 전에는 `/api/renders/access`가 `selfie: null`을 돌려주고 업로더는 503 → "지금은 사진을 저장할 수 없어요"를 보인다. `IDENTITY_PORTRAIT_ENABLED` 환경변수는 더 이상 읽지 않으므로 Vercel에서 제거해도 된다.
`IDENTITY_SELFIE_LIMIT`는 설정하지 않으면 1(약관 현행 "한 장"과 같다). 대표가 약관 문안을 승인한 뒤 Vercel Production에 `10`을 넣고 재배포한다.

## 8. 대표 결정 필요
1. 옛 생성형 portrait 테이블·저장 파일 폐기 시점(§4).
2. **약관 §5.3 문안**: 현재 "본인 얼굴 사진 한 장·계정당 인물 자산 그룹 1개". 제안 "같은 사람의 사진 최대 10장(계정당 인물 자산 그룹 1개는 그대로)". 승인 전까지 `IDENTITY_SELFIE_LIMIT`는 1로 둔다. 올릴 때는 ModelArk 자산 은행 용량도 같이 본다 — 렌더 뒤 삭제(`ARK_RELEASE_AFTER_USE`)가 켜져 있으면 10장이어도 무료 등급 50칸 안이고, 끄면 사람당 최대 10자산이다(PLATFORM-2.0 §4).
3. **화면 문장**: 원문 "해당 얼굴을 활용해서 제작할까요?" → 화면 "이 얼굴로 만들까요?"(`messages/ko.ts` `selfie.useThisFace` 한 곳). 원문으로 바꿀지.
4. 지운 사진 파일을 계정 삭제 전에도 지울지(예: 30일 뒤 정리). 지금은 소프트 삭제 + 계정 삭제 런북에서 일괄 삭제.
5. 헤더 1차 내비에 "내 사진"을 올릴지(현재는 계정 메뉴 안).

## 9. 검증
AGENTS.md §3 루프 결과와 스크린샷은 PR 본문에(`docs/qa/selfie-library/`). 테스트: `tests/identity/selfie-service.test.ts`(한도·기본 1장 불변·중복 멱등·삭제 후 기본 승계·N=1·한도 하향·라벨·하루 20회), `tests/identity/selfie-migration.test.ts`(컬럼·인덱스·체크·이관 행 기본·재적용 거부·글루 권한), `tests/routes/identity-selfie.test.ts`(GET/POST/PATCH/DELETE 권한·크기 제한·no-store·한도 환경변수), `tests/ui/selfie-sheet.test.tsx`(질문/확정/시트/한도/불러오기/키보드), `tests/ui/selfie-grid.test.tsx`(관리·고르기·N=1·한도·계정/페이지 패널), `tests/billing/toss-checkout.test.ts`(활성 사진 아무거나 결제·`last_used_at`·삭제된 id 거부·계보 유지, review 경로), `tests/auth/review-login-route.test.ts`(로그인 랜딩·`next`), `tests/identity/photo-advice.test.ts`(밝기).
