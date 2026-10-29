# 크리에이터 후보 공유 (Brand shortlist)

2026-10-28 · 브랜치 `claude/brand-shortlist` · 마이그레이션 0066/0146 (**클라우드 적용 필요**)

인플루언서 협업 캠페인에서 스튜디오가 추린 크리에이터 후보를 고객(브랜드 담당자)에게 보여 주고, 고객이 함께하고 싶은 후보를 **선호로 표시**하게 하는 기능이다. 섭외 확정은 TWINGS가 한다(지원자 탭의 선호 표시와 같은 원칙).

## 고객이 보는 것

- 위치: brand.twings.app 캠페인 화면의 **크리에이터 후보** 탭. 공개된 후보가 1명 이상일 때만 탭이 생긴다.
- 볼 수 있는 사람: 그 캠페인을 볼 수 있는 모든 사람(브랜드 멤버, 캠페인 게스트, TWINGS 팀의 읽기 화면).
- 선호 표시: 브랜드 owner/editor, "열람과 코멘트"로 초대된 캠페인 게스트. 조직 viewer·열람 전용 게스트·TWINGS 팀 화면은 표시할 수 없다.
- 카드 한 장 = 후보 한 명: 프로필 사진, 이름, `@핸들`(인스타그램 프로필 링크), 카테고리, 팔로워, 그리고 아래 지표.

| 묶음 | 항목 |
| --- | --- |
| 프로필 | 팔로워 · 팔로우 · 게시물 |
| 피드 | 30일 평균 게시 수 · 평균 참여 · 참여율 · 평균 좋아요 · 평균 댓글 |
| 광고 | 30일 평균 광고 게시 수 · 광고 비중 · 평균 참여 · 참여율 · 평균 좋아요 · 평균 댓글 |
| 릴스 | 30일 평균 릴스 수 · 평균 참여 · 참여율 · 평균 좋아요 · 평균 댓글 |
| 조회수 | 90일 중간 조회수 · 90일 최대 조회수 |

- 정렬: 팔로워 순(기본) / 조회수 순(90일 중간) / 참여율 순(피드·릴스 중 높은 값). "선호만 보기" 필터.
- 모르는 값은 `—`. 0으로 채우지 않는다.

## 절대 고객에게 가지 않는 것

가져오기 계약에 **필드 자체가 없다**: 단가·제안 금액·협업 비용, 내부 메모, 페널티, 협업 횟수, 지원 메시지, 후보를 찾은 경로·원본 링크·원본 이미지 주소. 계약 밖의 키가 하나라도 있으면 요청 전체를 `invalid`로 거절한다(조용히 버리지 않는다 — 보내는 쪽이 바로 알게 하려고). DB도 `metrics`에 허용된 키 외에는 저장을 거부한다(0066 `brand_shortlist_metrics_keys`).

이름·카테고리·핸들에 후보 모집 경로를 가리키는 단어가 있으면 거절한다(`lib/brands/shortlist/schema.ts`). 프로필 사진은 받은 바이트를 192×192 WebP로 다시 만들어 비공개 저장소에만 두고, 매 요청마다 권한을 다시 확인하는 경로(`/api/brand-workspace/shortlist/{id}/avatar`)로만 내보낸다. 외부 이미지 주소는 저장하지 않는다.

## 스튜디오 흐름

1. 관리자 캠페인 화면(`/admin/brand-workspace/{id}`) 또는 brand.twings.app 캠페인 화면(DB 관리자의 운영자 보기)의 **크리에이터 후보 관리**에서 캠페인 ID를 확인한다. 새 고객 캠페인은 brand.twings.app `/brand` → **새 캠페인 만들기**에서 바로 만들 수 있다([BRAND-STAFF-ACCESS.md](BRAND-STAFF-ACCESS.md) "운영자 캠페인 준비").
2. 후보를 넣는다: JSON 파일 업로드, 또는 가져오기 워커가 `POST /api/brand-shortlist-worker/import`.
3. 새 후보는 **대기** 상태(고객에게 안 보임). 확인 뒤 "대기 중인 후보 모두 공개" 또는 한 명씩 공개.
4. 고객이 선호로 표시하면 관리 표에 "고객 선호"가 붙는다. 섭외 뒤 결과는 기존 캠페인 흐름(게시물·리포트)으로 이어진다.

같은 핸들을 다시 보내면 갱신이다: 지표가 있으면 지표 묶음과 기준일을 통째로 바꾸고, 새로 안 보낸 이름·카테고리·사진은 그대로 둔다. 공개 여부와 고객의 선호 표시는 건드리지 않는다.

## 가져오기 계약

```json
{
  "projectId": "캠페인 ID (관리자 화면에 표시)",
  "measuredOn": "2026-10-27",
  "candidates": [
    {
      "handle": "fixture.creator",
      "displayName": "표시 이름",
      "category": "뷰티·패션",
      "avatar": "data:image/jpeg;base64,...",
      "metrics": {
        "followers": 67000, "following": 164, "posts": 562,
        "feedPosts30d": 18, "feedEngagement": 343, "feedEngagementRate": 0.5, "feedLikes": 330, "feedComments": 13,
        "adPosts30d": 9.3, "adShare": 53, "adEngagement": 290, "adEngagementRate": 0.4, "adLikes": 279, "adComments": 12,
        "reelsPosts30d": 20, "reelsEngagement": 266, "reelsEngagementRate": 0.4, "reelsLikes": 261, "reelsComments": 4.2,
        "viewsMedian90d": 10000, "viewsMax90d": 39000
      }
    }
  ]
}
```

- `handle`: 인스타그램 핸들. `@`·대문자는 정리된다. 한 요청 안에서 중복 불가.
- `displayName` ≤ 60자, `category` ≤ 40자, 둘 다 선택.
- `avatar`: 선택. PNG/JPEG/WebP data URL, 원본 300 KB 이하. 선언한 형식과 실제 바이트가 다르면 거절.
- `metrics`: 전부 선택. 정수(팔로워·팔로우·게시물·조회수), 평균(소수 1자리까지), 비율(%, 0~100, `0.5`는 0.5 %). 모르면 빼거나 `null`.
- `measuredOn`: 지표를 읽은 날(한국 시간), `YYYY-MM-DD`.
- 한 요청에 후보 최대 30명, 본문 4 MB 이하. 더 많으면 나눠 보낸다.

### 가져오기 워커 요청

```
POST https://twings.app/api/brand-shortlist-worker/import
Authorization: Bearer <BRAND_SHORTLIST_IMPORT_SECRET>
Content-Type: application/json
```

| 응답 | 뜻 |
| --- | --- |
| 200 `{ ok: true, id, added, updated }` | 저장됨(새 후보는 대기 상태) |
| 400 `{ ok: false, code: "invalid", field }` | 계약 위반. `field`가 위치(`candidates.3.avatar`, `candidates.0.metrics`) |
| 404 `{ error: "unavailable" }` | 비밀값 없음/틀림 |
| 404 `{ ok: false, code: "not_found" }` | 그런 캠페인 없음 |
| 409 `not_active` | 취소된 캠페인 |
| 413 `too_large` | 본문 4 MB 초과 |

`BRAND_SHORTLIST_IMPORT_SECRET`(32자 이상)는 Vercel 환경변수와 워커 쪽에만 둔다. 없으면 경로 전체가 404.

## 코드 위치

| 무엇 | 어디 |
| --- | --- |
| 스키마·거절 규칙 | `lib/brands/shortlist/schema.ts` |
| 가져오기·공개·선호·사진 권한 | `lib/brands/shortlist/service.ts` |
| 워커 경로 | `lib/brands/shortlist/http.ts`, `app/api/brand-shortlist-worker/import/route.ts` |
| 고객 화면 | `components/brand-workspace/shortlist.tsx`, 캠페인 페이지 `app/(brand)/brand/projects/[id]/page.tsx` |
| 관리자 화면 | `components/brand-workspace/shortlist-admin.tsx`, 오퍼레이션 `brandWorkspace.shortlist{Import,Share,Remove}` |
| 선호 표시 API | `/api/brand-workspace` `shortlist.pick` |
| 테스트 | `tests/brands/shortlist.test.ts`, `tests/brands/shortlist-ui.test.tsx` |

## 마이그레이션 — 클라우드 적용 필요

1. `0066_core_brand_shortlist.sql` — `brand_shortlist_candidates`(지표 키 제한, 핸들·사진 모양 검사).
2. `0146_glue_brand_shortlist.sql` — RLS 강제, 브라우저 키 권한 없음, service_role만.

적용 전에도 배포는 안전하다: 표가 없으면 후보 탭이 생기지 않고, 관리자 패널은 "아직 가져온 후보가 없어요"를 보이며, 가져오기는 `storage_unavailable`로 끝난다.
