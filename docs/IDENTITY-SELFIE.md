# 내 사진 — 정면 셀카 한 장 (설계 메모)

2026-10-22 · 대표 결정 · 생성형 기준 사진(Sunburst·Seedream 비교) 흐름을 대체한다. 이전 계약은 [IDENTITY-PORTRAIT.md](IDENTITY-PORTRAIT.md)에 기록으로만 남긴다.

## 1. 대표 요청과 해석

| 대표 원문 요지 | 구현 |
| --- | --- |
| 기준 사진 **생성 과정을 없앤다.** 자연스러운 정면 셀카 한 장만 올리면 된다. | 셀카 업로드 → 즉시 미리보기 → 각도·밝기 권고 → 저장 → 모든 주문에서 재사용(교체 가능). 생성 API 호출·비교 선택 화면·무료 횟수 개념을 모두 제거했다. |
| 로그인 직후 `/account`로 떨어지는 게 거칠다. 영상 포맷 목록으로, 보던 템플릿이 있으면 그 템플릿으로. | OAuth 콜백·`/auth/signin`은 이미 `/{locale}/video`가 기본이었다. 남아 있던 예외가 **심사 계정 로그인**(`/auth/review/login` → `/account`)이었고, 이를 `/{locale}/video` 기본 + `next` 유지로 바꿨다. `/auth/choose`의 심사 로그인 링크도 `next`를 넘긴다. |
| "내 사진 업로드" 진입점을 눈에 띄게. 셀카가 없으면 템플릿 "만들기"에서 그 자리에서 올리고 결제로. | 진입점 4곳: ① 템플릿 페이지 스튜디오 안 인라인 업로더(기본 경로), ② 계정 페이지 첫 카드, ③ 헤더 계정 메뉴 "내 사진"(데스크톱·모바일), ④ 전용 페이지 `/identity/selfie`(브랜드 스튜디오·커뮤니티가 링크). |

포지션은 그대로다: 내 얼굴로 트렌드 포맷의 주인공이 되는 곳. 사진은 수단이지 기능이 아니므로, 사진을 "준비"하는 별도 단계를 두지 않고 **포맷을 고른 자리에서 한 번** 끝낸다.

## 2. 흐름

```
로그인 ──▶ /{locale}/video (보던 템플릿이 있으면 그 템플릿 #make)
                │
                ▼
템플릿 페이지 #make ──▶ /api/renders/access ──▶ selfie 있음? ──┬─ 예 ─▶ [저장된 내 사진] + 결제 버튼 활성
                                                              │
                                                              └─ 아니오 ─▶ [인라인 업로더]
                                                                       카메라로 찍기 / 사진 고르기 / 드롭
                                                                       └▶ 미리보기 + 각도·밝기 권고(권고만)
                                                                          └▶ 본인 사진 동의 ☑
                                                                             └▶ "내 사진 저장" POST /api/identity/selfie
                                                                                └▶ 저장됨 → 결제 버튼으로 스크롤·포커스
                │
                ▼
"{가격} 결제하고 만들기" ──▶ POST /api/billing/toss/orders {selfieId}
                               서버가 현재 셀카 바이트를 주문 input에 복사(identity_selfie_id 기록)
                               └▶ 토스 결제창 → 승인 → createRenderJob(주문의 바이트 그대로)
```

구독(월정액)·캠페인 제작·브랜드 스튜디오·커뮤니티 이미지 보상도 같은 `selfieId`를 보낸다. 모든 경로는 `savedSelfiePhoto(sql, store, userId, id)` 한 함수로만 바이트를 읽는다.

## 3. 화면별 상태

### 템플릿 스튜디오 `data-selfie-panel`
| 상태 | 표시 | 결제 버튼 |
| --- | --- | --- |
| 셀카 없음 (`data-selfie-present="false"`) | 인라인 업로더(빈 상태: 얼굴 아이콘 + 한 줄 안내 + 카메라/사진 버튼) | 비활성, 힌트 "먼저 내 사진을 올려주세요" |
| 사진 선택됨 | 미리보기(4:5, 검은 바탕 contain) + "다른 사진으로" + 권고 카드(`data-photo-advice`, `data-photo-light`) + 동의 + 저장 | 비활성 |
| 저장 중 | 버튼 "저장하는 중…" + 스피너, 입력 잠금(`aria-busy`) | 비활성 |
| 저장 실패 | `role=alert` 문장(원인·복구), 고른 사진·동의 유지 → 한 번 더 누르면 됨 | 비활성 |
| 저장됨 (`data-selfie-state="saved"`) | 사진 + "{날짜} 저장" + "저장했어요" 상태 + "사진 바꾸기" | **활성**, 스크롤·포커스 이동 |
| 바꾸는 중 (`data-selfie-state="changing"`) | 업로더 + "지금 사진 그대로 쓰기" | 비활성(교체가 끝나거나 취소될 때까지) |
| 주문 시 `selfie_required` | 다른 탭에서 바꿨거나 없어진 경우. 업로더를 그 자리에 다시 열고 선택한 비율·화질은 유지 | 비활성 |

접근(`/api/renders/access`)은 포커스·`pageshow`마다 갱신되지만, 사람이 사진을 고르는 중(`selfieEditingRef`)에는 패널을 갈아끼우지 않는다.

### 권고 (차단 아님 — AGENTS.md §5, 2026-10-15 대표 결정)
- 각도: 기존 MediaPipe 워커(`/workers/photo-advice-v1.js`) 그대로. 분석 중·경고·미검출·실패 모두 저장 가능.
- 밝기: 새로 추가. 64×64 다운스케일 luma 평균과 양끝 비율로 `dark`/`bright` 힌트(`lib/identity/photo-advice.ts assessPhotoLight`). 기기 안에서만 계산, 저장하지 않음.
- 두 권고는 한 문단으로 합쳐 `aria-live="polite"`로 읽힌다.

### `/identity/selfie` (전용 페이지)
제목 한 줄, 같은 업로더, 저장되면 "템플릿으로 돌아가기"(`next`) 또는 "영상 포맷 고르기". `?change=1`이면 바로 교체 모드. 비로그인은 `/auth/choose?next=/identity/selfie?next=…`.

### 계정 `/account` `data-selfie-account`
이름 카드 바로 아래 첫 카드: 썸네일(없으면 윤곽), "저장된 내 사진 · {날짜} 저장" / "아직 올린 사진이 없어요", 버튼 "사진 바꾸기" / "내 사진 올리기 →".

### 헤더 계정 메뉴 `data-creator-selfie`
"내 사진" → `/identity/selfie`. 데스크톱 드롭다운과 모바일 시트 둘 다.

## 4. 데이터·저장

- 새 테이블 `identity_selfies`(0050 core / 0137 glue). 계정당 현재 셀카 1개는 **부분 유니크 인덱스**(`replaced_at is null`)로 DB가 보장한다(약관 §5.3 "계정당 인물 자산 그룹 1개"와 같은 말).
- 바이트는 기존 비공개 `renders` 버킷 `{selfieId}/selfie.png`. 서버에서 방향 보정·메타데이터 제거·최대 1600px(얼굴 크롭·왜곡 없음). 읽기는 소유자 세션 + `private, no-store`.
- 교체는 새 행 + 이전 행 `replaced_at`. 같은 바이트 재제출은 멱등(기존 id 반환). 하루 교체 20회 제한.
- 주문·렌더 계보: `billing_payments.identity_selfie_id`, `render_jobs.identity_selfie_id`. 결제 시점에 바이트를 주문 input으로 **복사**하므로 이후 교체가 결제한 작품을 바꾸지 않는다. `platform_redemptions.portrait_id`(FK 없음)는 셀카 id를 그대로 담는다.
- **새 주문은 현재 셀카만** 쓴다. 교체된 id로 들어온 주문은 `selfie_required`로 거절한다(다른 탭에서 바꾼 사진으로 결제되는 일을 막는다).

### 이미 고른 기준 사진이 있는 계정 — 재업로드 없이 이관
0050이 `identity_portrait_selections`에서 **선택이 끝난 성공 결과**를 계정별 현재 셀카 행으로 옮긴다(`input_key`는 그 결과 객체 `{attemptId}/result.png`를 그대로 가리키고, 바이트는 복사하지 않는다). 토스 심사 계정(`pg-review-20261014@twings.app`)은 10/22 14:15 KST에 Sunburst·Seedream 결과와 선택이 이미 있으므로, 배포 후에도 **셀카를 다시 올리지 않고** 그 사진으로 결제창까지 간다(심사 계정 한정 "AI 가상 인물" 예외는 PR #75 `REVIEW-ACCOUNT.md`의 대표 결정, 일반 사용자 규칙은 그대로). 이관 행의 `sha256`은 객체 키의 해시라 실제 업로드와 절대 같지 않다 → 새 사진을 올리면 그냥 교체된다. `tests/identity/selfie-migration.test.ts`가 이관·소유자 격리·재적용 거부를 고정한다.

### 기존 생성형 portrait 테이블 — 유지(읽기 전용)
`identity_portrait_attempts`/`identity_portrait_selections`와 `billing_payments.identity_portrait_id`·`render_jobs.identity_portrait_id`는 **남긴다.**
근거: 이미 결제·렌더된 작품이 FK로 참조하고 있어 drop하면 계보가 끊긴다(ON DELETE SET NULL로 null만 남음). 운영 DB에 0029/0115가 적용되지 않았을 수도 있어(IDENTITY-PORTRAIT.md "새 클라우드 적용 필요") 이 PR은 그 상태를 건드리지 않는다. 코드에서는 더 이상 읽지도 쓰지도 않는다(생성 서비스·프로바이더·프롬프트 계약·라우트·페이지 삭제). 폐기(drop)와 저장 파일 정리는 대표가 "과거 결과를 보존할 필요 없음"을 결정한 뒤 별도 마이그레이션으로 한다.

## 5. 안전장치 (바뀌지 않은 것)
- 본인 사진 동의 체크 없이는 저장되지 않는다(`consent_required`).
- 제공사 검수·ModelArk 실인물 자산 대조·카메라 본인 인증(`/identity/verify`)·held 작업 흐름은 그대로다. 셀카는 그 경로에 들어가는 입력일 뿐이다.
- 얼굴 각도·밝기 판정은 권고만 한다. 어떤 상태에서도 저장 버튼은 "파일 + 동의"로만 열린다.
- 익명·크로스오리진 업로드 거절, 소유자 외 이미지 404, 응답 `private, no-store`(스윕이 고정).

## 6. 심사 경로 (RENDER_PIPELINE_PUBLIC=review)
심사 계정(`app_metadata.purpose=toss_review`) 로그인 → `/{locale}/video` → 템플릿 → (이미 이관된 사진이 있으면 바로, 없으면 인라인 셀카 저장) → 결제창. `tests/billing/toss-checkout.test.ts`가 review 모드에서 셀카 저장→`createTossOrder` 성공, 일반 계정은 `not_open`임을 고정한다. 비밀번호는 보지도 입력하지도 않는다.

## 7. 클라우드 적용 필요
- `supabase/migrations/0050_core_identity_selfies.sql`
- `supabase/migrations/0137_glue_identity_selfies.sql`
코드 배포 **전에** 적용해야 한다. 적용 전에는 `/api/renders/access`가 `selfie: null`을 돌려주고 업로더는 503 → "지금은 사진을 저장할 수 없어요"를 보인다. `IDENTITY_PORTRAIT_ENABLED` 환경변수는 더 이상 읽지 않으므로 Vercel에서 제거해도 된다.

## 8. 대표 결정 필요
1. 옛 생성형 portrait 테이블·저장 파일 폐기 시점(§4).
2. 셀카 **삭제** 버튼(교체만 구현). 계정 삭제 런북에 `{selfieId}/selfie.png` 삭제를 포함할지.
3. 헤더 1차 내비에 "내 사진"을 올릴지(현재는 계정 메뉴 안).

## 9. 검증
AGENTS.md §3 루프 결과와 스크린샷은 PR 본문에. 새 테스트: `tests/identity/selfie-service.test.ts`, `tests/routes/identity-selfie.test.ts`, `tests/billing/toss-checkout.test.ts`(셀카 계보·review 경로), `tests/auth/review-login-route.test.ts`(로그인 랜딩·`next`), `tests/identity/photo-advice.test.ts`(밝기).
