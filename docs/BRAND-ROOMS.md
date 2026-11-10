# 프로젝트 룸 — 의뢰한 일을 야기 팀과 같이 보는 곳 (2026-11-11)

> 대표 지시(2026-11-11): "브랜드가 템플릿이나 영상 캠페인 외주를 맡겼을 때 frame.io급으로 공유와 slack급의 소통이
> 붙어야 한다. storyboard 공유도 할 수 있어야 한다. 우리는 이미지랑 텍스트 기반으로 붙여서 공유할 것이고, 연결된
> CLI로도 만들 수 있어야 한다. 우리랑 소통하고 작업 외주 맡기는 탭을 잘 구분하거나 가시적으로 표현해야 한다."
>
> 플래그 `BRAND_ROOMS`(기본 꺼짐). 꺼져 있으면 운영 화면은 달라지지 않는다. 스튜디오 v3(`docs/BRAND-STUDIO-V3.md`) 위에 얹는다.

## 1. 한 줄 정의

**프로젝트 룸**은 의뢰 하나(`brand_projects` 한 행)마다 생기는 공간이다. 그 안에 스토리보드, 시안 리뷰, 대화가 있고,
밖에는 모든 룸의 대화를 한곳에서 보는 **메시지**가 있다. 브랜드가 직접 만드는 곳(이미지·영상)과 야기 팀에 맡긴 일을
보는 곳이 메뉴에서 눈에 보이게 갈린다.

참고한 것: Frame.io V4(프로젝트 → 에셋·버전 스택 · 타임코드/구간 댓글 · 화면 위 그리기 · 상태 · 공유 링크),
Slack(채널 · 스레드 · 멘션 · 리액션 · 안 읽음), Storyboarder.ai(컷 카드 = 그림 + "Scene 1 | Shot 3" + 설명, 샷 리스트, 애니매틱).

## 2. 메뉴: 두 묶음

레일(`rail` 모드)을 두 묶음으로 나눈다. 펼치면 묶음 이름이 보이고, 접으면 구분선과 옅은 바탕으로 갈린다.

| 묶음 | 항목 |
| --- | --- |
| **직접 만들기** | 이미지 · 영상 · 에셋 · 브랜드 키트 |
| **야기 팀과** | 의뢰(`/brand`, 지금의 캠페인·의뢰 목록) · 메시지(`/brand/rooms`) · 리뷰(`/brand/studio/review`) · 크리에이터(열려 있을 때) |

- 메시지와 의뢰 항목에 안 읽음 수 배지.
- `BRAND_ROOMS`가 꺼져 있으면 지금 레일 그대로(묶음 없음, 메시지 항목 없음).
- 모픽(샌드박스)·생성 차단 조직은 `sidebar` 그대로이고 룸·메시지가 없다. 모픽에게 룸을 열지는 대표 결정(§9).

## 3. 주소

| 주소 | 내용 |
| --- | --- |
| `/brand/rooms` | 메시지: 왼쪽 채널 목록(프로젝트마다 하나 + "일반 문의"), 오른쪽 대화 |
| `/brand/rooms/[projectId]` | 프로젝트 룸: 개요 · 스토리보드 · 시안 · 대화 탭(`?tab=`) |
| `/s/[token]` | 공유 링크(로그인 없이 보기, 허용하면 이름을 적고 의견 남기기) |
| `/admin/brand-rooms` | 야기 팀: 모든 조직의 룸 목록·대화·스토리보드 편집·시안 올리기 |
| `/api/brand-rooms/{messages,storyboards,reviews,shares,summary,ingest}` | API |

기존 프로젝트 상세(`/brand/projects/[id]`)는 그대로 두고, 머리에 "룸 열기" 버튼과 안 읽음 배지만 더한다.
캠페인 목록 카드에도 같은 버튼.

## 4. 대화 (슬라이스 M)

- 채널 = 프로젝트 하나(또는 조직의 "일반 문의", `project_id` null). 메시지, 스레드(한 단계), `@멘션`(조직 멤버와 "야기 팀"),
  리액션(이모지 6종), 첨부(이미지·영상·파일, 메시지당 10개), 수정·삭제(내 것), 고정(pin), 링크 미리보기 없음.
- **참조 카드**: 메시지는 스토리보드 컷·시안·시안 댓글을 가리킬 수 있다(`ref`). 그러면 대화 안에 작은 카드(썸네일 + "스토리보드 v2 · 컷 3")로 보이고
  누르면 그 자리로 간다. 컷과 시안에서 "대화에 남기기"를 누르면 그 참조가 붙은 스레드가 열린다. **컷 댓글은 따로 없고 이 스레드가 곧 컷 댓글이다.**
- **시스템 메시지**: 스토리보드 공유, 새 버전, 승인·수정 요청, 시안 업로드, 상태 변경은 대화에 한 줄로 남는다(`postRoomEvent`).
- 읽음: 채널별 마지막 읽은 시각(`brand_room_reads`). 안 읽음 수는 레일과 채널 목록에.
- 새 메시지는 폴링으로 받는다(화면이 앞에 있을 때 4초, 아니면 20초, `since` 커서). 보낸 메시지는 낙관적으로 먼저 보인다.
- 작성자 표시: 브랜드 멤버는 이름, 야기 팀은 "야기 팀 · 이름". 브랜드가 쓰면 내부 알림(기존 concierge 알림 함수, 최선 노력).
- 예전 프로젝트 대화(`brand_messages`)는 같은 채널의 앞부분에 "이전 대화"로 읽기 전용 표시.
- 입력: Enter 전송, Shift+Enter 줄바꿈, 파일 끌어 놓기·붙여 넣기, `@` 자동완성. 분당 20개 제한.

## 5. 스토리보드 (슬라이스 S)

- 보드 = 프로젝트의 스토리보드 한 버전. 컷(프레임) = **그림 + 장면/컷 번호 + 설명**, 선택으로 카메라·대사/사운드·길이(초).
- 브랜드 화면: 컷 카드 그리드(그림, "S1 · 컷 3", 설명, 길이, 스레드 수), 표 보기(샷 리스트), **재생**(길이대로 넘기는 애니매틱),
  컷을 누르면 크게 + 오른쪽에 그 컷의 스레드. 보드 전체에 **승인 / 수정 요청**. 버전 선택(v1, v2 …)과 "바뀐 컷" 표시.
- 만드는 사람: 야기 팀이 관리자 화면에서(여러 장 한 번에 올리기, 글 붙여 넣기, 끌어서 순서, 임시 저장 → 공유) 또는 CLI로.
  브랜드도 자기 스토리보드를 올릴 수 있다(같은 편집기).
- **CLI**: `node scripts/twings-room.mjs storyboard push --project <id> --title "…" --dir <폴더>` — 폴더의 `01.png, 02.png …`와
  `board.json`(컷마다 scene, shot, description, camera, audio, seconds) 또는 `board.md`를 읽어 임시 저장 보드를 만든다.
  `--share`를 주면 바로 공유. `message post`, `review push <파일>`도 같은 스크립트. 인증은 서버 비밀값 `BRAND_ROOM_INGEST_SECRET`
  (`/api/brand-rooms/ingest`, 스태프 전용, 값은 Vercel과 `.env.local`에만).
- 스튜디오와의 다리: 브랜드는 컷 그림을 "참조로 쓰기"로 이미지·영상 화면에 가져갈 수 있다(같은 미디어 키).

## 6. 시안 리뷰 (슬라이스 R)

스튜디오 v3의 리뷰 공간(`brand_studio_reviews`)을 넓힌다.

- 리뷰 항목이 프로젝트에 묶일 수 있다(`project_id`). **버전 스택**: 같은 시안의 v1, v2 …(`stack_id`, `version`). 새 버전을 올리면
  이전 버전의 열린 의견이 "v1에서 넘어온 의견"으로 보인다. **나란히 비교**(두 버전 동시 재생, 같은 시각).
- 의견: 시각 하나 또는 **구간**(`at_ms`–`end_ms`), 화면 위치, **화면 위 그리기**(펜·화살표, 정규화 좌표의 선 배열), 답글, 해결.
- 야기 팀이 시안 파일을 올린다(관리자 화면 + CLI). 영상 500MB, 이미지 50MB까지(직접 업로드).
- 상태: 검토 필요 → 수정 요청 | 승인. 승인하면 대화에 시스템 메시지.
- **공유 링크**: 시안이나 스토리보드를 워크스페이스 밖 사람에게. 옵션: 의견 허용(이름 입력), 만료(기본 14일), 내려받기 허용, 암호(선택), 언제든 끊기.
  토큰은 256비트, DB에는 해시만. 공유 화면은 `noindex`, 조직·프로젝트의 다른 것은 아무것도 보이지 않는다. 열람 수 기록.

## 7. 룸 화면과 개요 (슬라이스 H)

- 룸 머리: 프로젝트 이름, 트랙(크리에이터 캠페인 / 스케일 제작 / 단일 영상), 상태, 참여자 얼굴(브랜드 멤버 + 야기 팀), "공유".
- **개요**: 단계 줄(의뢰 접수 → 스토리보드 → 시안 → 수정 → 완료, 실제 데이터로 채움: 보드·시안의 상태와 날짜),
  "지금 확인할 것"(승인 기다리는 보드, 열린 의견이 있는 시안, 안 읽은 메시지), 최근 활동 5개.
- 탭: 개요 · 스토리보드 · 시안 · 대화. 각 탭은 해당 슬라이스의 컴포넌트를 그대로 싣는다.
- 첫 사용 설명(`Explainer`): 의뢰 → 스토리보드 확인 → 시안에 의견 → 승인.
- 레일 묶음, 안 읽음 배지, 프로젝트 상세·캠페인 카드의 "룸 열기".

## 8. 데이터

전부 RLS 강제·정책 없음·service role 전용(0152 모양). 번호: core 0082–0084, glue 0156–0158.

| 표 | 슬라이스 | 요지 |
| --- | --- | --- |
| `brand_room_messages` | M | organization_id, project_id(null = 일반), parent_id, author_id, author_role(brand·studio·system), body, kind(text·event), ref jsonb, attachments jsonb, mentions uuid[], pinned_at, edited_at, deleted_at |
| `brand_room_reactions` | M | message_id, user_id, emoji |
| `brand_room_reads` | M | organization_id, channel(프로젝트 id 또는 'general'), user_id, last_read_at |
| `brand_storyboards` | S | organization_id, project_id, title, version, status(draft·shared·changes_requested·approved), created_by, created_role, source(manual·cli) |
| `brand_storyboard_frames` | S | storyboard_id, idx, scene, shot, storage_key, width, height, description, camera, audio, seconds |
| `brand_studio_reviews` 확장 | R | project_id, stack_id, version, source(studio·delivery) |
| `brand_studio_review_comments` 확장 | R | end_ms, strokes jsonb, guest_name |
| `brand_room_shares` | R | token_hash, organization_id, kind(review·storyboard), target_id, allow_comments, allow_download, passphrase_hash, expires_at, revoked_at, views |

미디어는 스튜디오 미디어 저장소(`lib/brand-studio/media-store.ts`, 추측 불가 키)를 같이 쓴다.

## 9. 권한과 하드라인

1. 가드: `components/brand-rooms/route-context.ts`(화면)와 `lib/brand-rooms/guard.ts`(API). 순서: 로그인 → 조직 멤버 또는 그 프로젝트의 초대 손님 →
   `brandRoomsOpen()` → **샌드박스·생성 차단 조직이면 404**. 소유자·편집자는 쓰고, 뷰어는 읽고 대화만 쓴다. 프로젝트 초대 손님은 자기 프로젝트 룸만.
   새 주소·API 전부 `tests/brand-rooms/sandbox.test.ts`.
2. 야기 팀 쓰기는 `lib/admin/operations.ts` 오퍼레이션 또는 ingest 비밀값으로만.
3. 공유 링크는 그 대상 하나만 보여 준다. 토큰 해시 비교는 상수 시간, 만료·끊김은 404.
4. Toss 심사 표면, `lib/renders/*`, `lib/identity/*`, 결제·약관·가격은 건드리지 않는다. `lib/flags.ts`는 함수 추가만.
5. 고객 화면에 내부 도구 이름을 쓰지 않는다("Slack", 엔진 경로, 공급처). 알림은 "야기 팀에 전달됐어요" 수준.
6. 디자인: `docs/design/IDENTITY.md` → `TASTE.md` → `TOOLBOX.md`. 흰 바탕 + 반투명 패널 + TWINGS 블루 하나.
7. 모픽에게 룸을 열지 여부는 대표 결정. 그 전까지 샌드박스 조직은 닫는다.

## 10. 슬라이스와 파일

| 슬라이스 | 소유 |
| --- | --- |
| M 대화 | `lib/brand-rooms/{messages,message-contracts,events}.ts`, `app/api/brand-rooms/{messages,summary}/*`, `components/brand-rooms/chat/*`, `app/(brand)/brand/rooms/page.tsx`, `app/(admin)/admin/brand-rooms/*`(목록·대화), 0082/0156, `messages/rooms-chat.ts`, `tests/brand-rooms/chat/*` |
| S 스토리보드 | `lib/brand-rooms/{storyboards,storyboard-contracts,ingest}.ts`, `app/api/brand-rooms/{storyboards,ingest}/*`, `components/brand-rooms/storyboard/*`, `app/(admin)/admin/brand-rooms/storyboards/*`, `scripts/twings-room.mjs`, 0083/0157, `messages/rooms-storyboard.ts`, `tests/brand-rooms/storyboard/*` |
| R 시안·공유 | `lib/brand-studio/{review,review-contracts}.ts` 확장, `lib/brand-rooms/{shares,share-contracts}.ts`, `app/api/brand-rooms/{reviews,shares}/*`, `components/brand-studio/review/*` 확장, `components/brand-rooms/share/*`, `app/(share)/s/[token]/*` 또는 맞는 route group, 관리자 시안 올리기, 0084/0158, `messages/rooms-review.ts`, `tests/brand-rooms/review/*` |
| H 룸·메뉴 | `components/brand-workspace/{navigation,rail-nav,rail-model,rail-activity}.tsx`, `app/(brand)/rail.css`, `app/(brand)/brand/rooms/[projectId]/*`, `components/brand-rooms/room/*`, `lib/brand-rooms/overview.ts`, 프로젝트 상세·캠페인 카드의 "룸 열기", `messages/rooms-shell.ts`, `tests/brand-rooms/room/*` |

슬라이스 사이의 약속은 `components/brand-rooms/seams.ts`와 `lib/brand-rooms/events.ts`. 공유 파일 규칙은 v3 §8과 같다.

## 11. 대표 결정 대기

- 모픽(샌드박스) 조직에도 룸을 열지. 룸은 스튜디오를 드러내지 않지만 화면이 바뀐다.
- 공유 링크 기본 만료(14일)와 내려받기 기본값(꺼짐).
- 브랜드에게 가는 알림 방법(지금은 화면 안 배지만. 메일·푸시는 다음 단계).
- 룸을 계약 고객 전체에 기본으로 열지, 플랜 조건으로 둘지.
