# 크리에이터 후보 공유 (Brand shortlist)

2026-10-28 · 브랜치 `claude/brand-shortlist` · 마이그레이션 0066/0146 (운영 적용됨)
2026-10-29 · 선별(대기·공개·제외, 범위 필터, 캠페인 기준)과 새 카드 · 브랜치 `codex/shortlist-triage` · 마이그레이션 0068/0148 (**클라우드 적용 필요, 코드보다 먼저**)

인플루언서 협업 캠페인에서 스튜디오가 추린 크리에이터 후보를 고객(브랜드 담당자)에게 보여 주고, 고객이 함께하고 싶은 후보를 **선호로 표시**하게 하는 기능이다. 섭외 확정은 TWINGS가 한다(지원자 탭의 선호 표시와 같은 원칙).

## 고객이 보는 것

- 위치: brand.twings.app 캠페인 화면의 **크리에이터 후보** 탭. 공개된 후보가 1명 이상일 때만 탭이 생긴다.
- 볼 수 있는 사람: 그 캠페인을 볼 수 있는 모든 사람(브랜드 멤버, 캠페인 게스트, TWINGS 팀의 읽기 화면).
- 선호 표시: 브랜드 owner/editor, "열람과 코멘트"로 초대된 캠페인 게스트. 조직 viewer·열람 전용 게스트·TWINGS 팀 화면은 표시할 수 없다.
- 카드 한 장 = 후보 한 명. 위에서부터:
  - 4:3 초상 영역: 프로필 사진(크게)과, 사진의 대표색(`avatar_tone`)으로 칠한 배경. 오른쪽 위 하트가 선호 표시.
  - 사실 라벨 최대 3개. 같은 카드의 숫자로 확인할 수 있는 규칙만 쓴다(`shortlistTags`): 조회수 강세(90일 중간 조회수 ≥ 팔로워의 60%), 반응 좋음(참여율 ≥ 이 후보들 중앙값의 1.3배), 광고 비중 낮음(≤ 15%), 꾸준한 업로드(30일 피드나 릴스 ≥ 10개). 마우스를 올리면 규칙이 보인다.
  - 이름, `@핸들`(인스타그램 프로필 링크), 카테고리.
  - 큰 숫자 3개: 팔로워 · 90일 중간 조회수 · 참여율(피드·릴스 중 높은 값).
  - "이 후보들 중앙값 대비": 조회수·참여율·팔로워 막대, 가운데 눈금이 중앙값, `+32%`처럼 차이. 공개 후보가 3명 이상일 때만.
  - **지표 자세히**(접힘): 아래 표 전체.
- 비교: 카드의 "비교"를 4명까지 골라 한 표로 본다. 각 줄에서 가장 높은 값이 굵게(광고 비중은 가장 낮은 값).

| 묶음 | 항목 |
| --- | --- |
| 프로필 | 팔로워 · 팔로우 · 게시물 |
| 피드 | 30일 평균 게시 수 · 평균 참여 · 참여율 · 평균 좋아요 · 평균 댓글 |
| 광고 | 30일 평균 광고 게시 수 · 광고 비중 · 평균 참여 · 참여율 · 평균 좋아요 · 평균 댓글 |
| 릴스 | 30일 평균 릴스 수 · 평균 참여 · 참여율 · 평균 좋아요 · 평균 댓글 |
| 조회수 | 90일 중간 조회수 · 90일 최대 조회수 |

- 정렬: **팔로워 많은 순(기본)** / 조회수 순(90일 중간) / 참여율 순(피드·릴스 중 높은 값). "선호만 보기" 필터.
- 모르는 값은 `—`. 0으로 채우지 않는다.

## 절대 고객에게 가지 않는 것

가져오기 계약에 **필드 자체가 없다**: 단가·제안 금액·협업 비용, 내부 메모, 페널티, 협업 횟수, 지원 메시지, 후보를 찾은 경로·원본 링크·원본 이미지 주소. 계약 밖의 키가 하나라도 있으면 요청 전체를 `invalid`로 거절한다(조용히 버리지 않는다 — 보내는 쪽이 바로 알게 하려고). DB도 `metrics`에 허용된 키 외에는 저장을 거부한다(0066 `brand_shortlist_metrics_keys`).

이름·카테고리·핸들에 후보 모집 경로를 가리키는 단어가 있으면 거절한다(`lib/brands/shortlist/schema.ts`). 프로필 사진은 받은 바이트를 480×480 WebP로 다시 만들어(대표색도 이때 뽑는다) 비공개 저장소에만 두고, 매 요청마다 권한을 다시 확인하는 경로(`/api/brand-workspace/shortlist/{id}/avatar`)로만 내보낸다. 외부 이미지 주소는 저장하지 않는다.

## 스튜디오 흐름

1. 관리자 캠페인 화면(`/admin/brand-workspace/{id}`) 또는 brand.twings.app 캠페인 화면(DB 관리자의 운영자 보기)의 **크리에이터 후보 관리**에서 캠페인 ID를 확인한다. 새 고객 캠페인은 brand.twings.app `/brand` → **새 캠페인 만들기**에서 바로 만들 수 있다([BRAND-STAFF-ACCESS.md](BRAND-STAFF-ACCESS.md) "운영자 캠페인 준비").
2. 후보를 넣는다: JSON 파일 업로드, 또는 가져오기 워커가 `POST /api/brand-shortlist-worker/import`.
3. 새 후보는 **대기** 상태(고객에게 안 보임). 아래 **선별**로 공개하거나 제외한다.
4. 고객이 선호로 표시하면 관리 표에 "고객 선호"가 붙는다. 섭외 뒤 결과는 기존 캠페인 흐름(게시물·리포트)으로 이어진다.

같은 핸들을 다시 보내면 갱신이다: 지표가 있으면 지표 묶음과 기준일을 통째로 바꾸고, 새로 안 보낸 이름·카테고리·사진은 그대로 둔다. 공개·제외 여부와 고객의 선호 표시는 건드리지 않는다. 그래서 **다시 보지 않을 후보는 삭제가 아니라 제외**한다: 삭제한 핸들은 다음 가져오기 때 대기로 다시 들어온다.

## 선별 (스튜디오)

관리자 화면과 brand.twings.app 운영자 보기의 **크리에이터 후보 관리** 표. 기본 정렬은 **팔로워 많은 순**, 표 머리를 누르면 그 지표로 정렬(한 번 더 누르면 반대).

- 상태 3개: **대기**(고객에게 안 보임) · **공개**(고객에게 보임) · **제외**(안 보이고, 다시 가져와도 제외 유지). DB가 "공개이면서 제외"를 막는다. 제외는 언제든 되돌릴 수 있다(대기로·공개).
- 탭: 전체 · 대기 · 공개 · 제외 · 고객 선호, 각각 인원.
- 범위 필터 4개: 팔로워 · 90일 중간 조회수 · 참여율 · 광고 비중. 칩을 누르면 지금 후보 분포 막대(팔로워·조회수는 로그 눈금)와 최소·최대 슬라이더. 값이 없는 후보는 범위를 정하면 목록에서 빠지고, 그 인원이 칩 안에 적힌다. 핸들 검색.
- 선택: 줄 체크, 머리 체크로 **보이는 후보 전부**. 필터가 숨긴 줄은 선택에서 자동으로 빠진다. 아래 막대에서 공개 / 제외 / 대기로.
- **필터로 한 번에 정리**: 대기 후보만 대상. 지금 필터(없으면 캠페인 기준) 안 → 공개, 밖 → 제외 또는 대기로 둠, 지표가 없어 판단할 수 없는 후보 → 대기로 둠. 공개·제외한 후보는 건드리지 않는다.
- **캠페인 기준**: 지금 필터를 그 캠페인의 기준으로 저장(`brand_projects.shortlist_criteria`, 범위 키 4개만). 대기 후보에 "기준 안 / 기준 밖 / 판단 보류" 표시만 하고, 저절로 공개·제외하지 않는다. 가져오기 워커가 새 후보를 넣어도 마찬가지다.
- 최근 24시간 안에 들어온 대기 후보에 "새로 들어옴".
- 마지막 이동은 알림의 **되돌리기**(또는 `Z`)로 되돌린다. 단축키: `J`/`K` 이동, `X` 선택, `S` 공개, `E` 제외, `W` 대기로, `/` 검색.
- 스크립트 없이도 줄마다 단추가 같은 오퍼레이션으로 한 건씩 보낸다.
- brand.twings.app 스튜디오 문에는 선별·캠페인 기준이 열려 있다(되돌릴 수 있는 이동만). 파일 가져오기와 영구 삭제는 관리자 화면에만 있다. 감사 기록에는 이동한 **인원 수**만 남기고 후보 ID는 남기지 않는다.

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
| 가져오기·공개·선별·캠페인 기준·선호·사진 권한 | `lib/brands/shortlist/service.ts` |
| 범위 판정·라벨·중앙값 | `lib/brands/shortlist/format.ts` (`shortlistFit`, `shortlistTags`, `shortlistMedian`) |
| 워커 경로 | `lib/brands/shortlist/http.ts`, `app/api/brand-shortlist-worker/import/route.ts` |
| 고객 화면 | `components/brand-workspace/shortlist.tsx`, 캠페인 페이지 `app/(brand)/brand/projects/[id]/page.tsx` |
| 관리자 화면 | `components/brand-workspace/shortlist-admin.tsx`, 선별 `components/brand-workspace/shortlist-triage.tsx`, 오퍼레이션 `brandWorkspace.shortlist{Import,Share,Triage,Criteria,Remove}` |
| 선호 표시 API | `/api/brand-workspace` `shortlist.pick` |
| 테스트 | `tests/brands/shortlist.test.ts`, `tests/brands/shortlist-ui.test.tsx`, 스튜디오 문 `tests/brands/studio-door-hardening.test.ts` |

## 마이그레이션

1. `0066_core_brand_shortlist.sql` — `brand_shortlist_candidates`(지표 키 제한, 핸들·사진 모양 검사). 운영 적용됨.
2. `0146_glue_brand_shortlist.sql` — RLS 강제, 브라우저 키 권한 없음, service_role만. 운영 적용됨.
3. `0068_core_brand_shortlist_triage.sql` — `excluded_at`/`excluded_by`, `avatar_tone`, `brand_projects.shortlist_criteria`(범위 키 4개만). **클라우드 적용 필요, 선별 코드 배포 전에.** 적용 전에 코드가 나가면 후보 화면이 새 열을 못 읽어 비고, 가져오기 워커가 `avatar_tone`을 못 써서 실패한다.
4. `0148_glue_brand_shortlist_triage.sql` — `brand_projects.shortlist_criteria` 갱신 권한(service_role). 0068과 함께.

0066 적용 전에도 배포는 안전했다: 표가 없으면 후보 탭이 생기지 않고, 관리자 패널은 "아직 가져온 후보가 없어요"를 보이며, 가져오기는 `storage_unavailable`로 끝난다.
