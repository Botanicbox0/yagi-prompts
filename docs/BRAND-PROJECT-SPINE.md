# 브랜드 워크스페이스: 프로젝트 뼈대

> 2026-11-25 설계. 기준 커밋 `origin/main` `3d274a58`(쓰는 동안 PR #369가 들어와 `ef2163cd`가 됐다. 줄 번호는 `3d274a58` 기준이고, 인용한 파일 가운데 그 사이 바뀐 것은 `components/brand-studio/video/workspace.tsx` 하나라 그 파일의 줄 번호만 밀렸을 수 있다. 마이그레이션 번호는 그대로다). **설계와 시안만 있고 기능은 아직 만들지 않았다.**
> 대표 지시 원문은 §1에 그대로 옮겼다. 시안 화면은 `docs/qa/brand-project-spine/`에 있다(§12).
> 이 문서가 `docs/BRAND-STUDIO-V6-PLAN.md` §3의 "프로젝트는 `brand_studio_video_projects` 하나"와 §8-4("프로젝트 이름")를 대신한다. 구현 첫 PR에서 V6 문서의 그 두 곳에 이 문서 링크를 단다.

## 0. 대표님께

**한 줄 요약:** 프로젝트를 하나로 합치고, 홈·에셋·공유를 그 프로젝트를 중심으로 다시 짭니다. 프로젝트를 고르지 않아도 만들 수 있습니다.

**화면마다 바뀌는 것**

- **홈:** 맨 위에 소식 한 칸(새 기능·할인을 대표님이 올리는 자리), 그 아래 입력창, 확인할 것, 그리고 진행 중인 프로젝트 카드가 본문이 됩니다. 프로젝트가 없으면 지금처럼 최근 작업물이 보이고 "프로젝트로 묶기" 한 줄이 붙습니다.
- **프로젝트:** 지금은 "야기 팀에 맡긴 프로젝트"와 "영상 스튜디오 프로젝트"가 서로 다른 것인데 둘 다 프로젝트라고 부릅니다. 하나로 합칩니다. 프로젝트 안에 파일(이미지·영상·사운드), 편집본, 대화가 들어갑니다. 직접 만들던 프로젝트를 나중에 야기 팀에 맡길 수 있습니다.
- **스튜디오(이미지·영상·사운드·편집):** 머리말에 "지금 어느 프로젝트인지"가 보이고 거기서 바꿉니다. 고른 프로젝트에 결과가 자동으로 저장됩니다. 고르지 않으면 "미분류"에 저장되고, 나중에 한 번에 옮길 수 있습니다. 미분류는 개인 보관함이 아니라 팀 전체가 봅니다.
- **에셋:** 프로젝트별 / 브랜드 자료(로고·제품·인물) / 미분류로 묶습니다. 사운드도 여기에 보입니다.
- **보내기:** 이미지의 "검수 · 공유" 자리가 "보내기"가 됩니다. @이름과 메시지를 적어 팀원에게 보내면, 받는 사람 알림함에 프로젝트·썸네일·보낸 사람·메시지가 뜨고 거기서 바로 답글을 답니다. 팀원이 아닌 메일 주소를 적으면 초대하고 보냅니다.
- **Slack:** 1단계는 한 방향입니다. 프로젝트마다 채널을 정해 두면 보내기 내용이 그 채널에 올라갑니다. Slack에서 단 답글이 TWINGS로 돌아오는 것은 다음 단계입니다.

**그대로인 것:** 왼쪽 레일의 모양과 두 모드(직접 만들기 / 야기 팀과), 입력창, 야기 팀과 하는 대화·시안 검수·스토리보드, 외부 공유 링크(야기 팀 프로젝트와 `더보기` 메뉴에 남습니다), 크레딧과 요금.

**코드를 보고 알게 된 것 두 가지**

1. 지금의 "검수 · 공유"로 채팅에 올리면 **야기 팀에 알림이 갑니다.** 팀 내부용이 아닙니다. 그래서 "보내기"의 대화는 야기 팀이 볼 수 없는 "우리 팀" 칸을 따로 둡니다. 야기 팀과 하는 대화는 지금 자리에 그대로 있습니다.
2. 지금 팀원 초대는 **관리자만** 할 수 있습니다. "초대하고 보내기"가 자연스러우려면 편집자도 초대할 수 있어야 합니다(아래 결정 3).

**정해 주실 것** (각각 제 추천이 있습니다, §11)

1. 홈 소식 칸: 사진이 있는 배너(추천) / 글 한 줄.
2. 레일에 "프로젝트"와 "알림함" 두 줄을 더할지(추천: 더함).
3. 편집자도 보내기에서 팀원을 "보기 전용"으로 초대할 수 있게 할지(추천: 예).
4. 이름: 미분류 · 편집본 · 브랜드 자료 · 보내기(§13 후보).
5. Slack: 썸네일과 메시지 일부가 고객의 Slack에 저장된다는 안내 문구와 약관 한 줄. Slack 앱은 대표님 계정으로 만들어야 합니다.
6. 이미 만들어 둔 "영상 프로젝트"는 자동으로 프로젝트가 되지 않고 미분류의 편집본으로 남깁니다(추천). 이름 없는 프로젝트가 한꺼번에 생기는 것을 막기 위해서입니다.

**시안을 보실 때:** 시안은 눌러도 동작하지 않는 그림입니다. 이름·사진·숫자는 모두 예시입니다. 화면마다 왼쪽 레일 가운데 점선 상자에 "만들어야 하는 것"을 적어 두었습니다. 지금 쓰시는 화면은 아무것도 바뀌지 않았습니다.

**만드는 순서(승인 후):** ① 프로젝트 합치기와 스튜디오의 프로젝트 고르기 → ② 에셋 → ③ 홈과 소식 칸 → ④ 보내기 → ⑤ Slack → ⑥ 야기 팀에 맡기기·편집본 저장. 조각마다 스위치를 달아 시험용 워크스페이스에서 먼저 켭니다.

---

## 1. 대표 지시 (2026-11-25, 원문)

- 홈: "홈 화면에서는 프로젝트 베이스로 지금 진행중인 프로젝트로 들어갈 수 있게 설계될 수 있게 보여야 할 것 같아. 지금은 너무 조잡해 보임. 그리고 만약 신기능이 나오거나 우리가 뉴스 보낼거나 홍보할 거 있으면 저기에 띄울거야. 마치 krea.ai가 지금 HOME 화면에서 SEEDANCE 할인 홍보를 하고 있는 것처럼."
- 프로젝트: "이미지 스튜디오든 영상 스튜디오든 정해진 프로젝트가 있어야지 만들 수 있게 되어있게 설계하려 했는데. 근데 지금 이게 안되어 있는 것 같음. 이거 무조건 프로젝트 강제하는게 근데 좋은 방향인지는 잘 판단이 안되어서 ... 너가 판단해줘." / "결론적으로 프로젝트별로 파일 모음이 잘 구성되어야 하지 않을까 싶은데"
- 내부 공유: "이거는 아마 팀 내부적으로 바로 공유하는 기능일 것 같은데 ... 외부 공유는 직접 만드는 사이드에서 개별 이미지를 외부로 공유할 일은 거의 없을 것 같아서 내부적인 공유가 목적이 될 것 같음. workspace에 자연스럽게 초대를 유도하는건 좋아. ... 슬랙처럼 @누구태그 방식으로 해서 에셋이랑 메세지 보낼 수 있게 되면 좋을 것 같은데...! 그래서 확인하는 사람은 이게 어떤 프로젝트에서 어떤 에셋이 어떤 메세지로 보내졌는지를 볼 수 있게! 워크스페이스안에 들어온 사람은 알림을 받고 바로 그걸 확인할 수 있고 코멘트도 남길 수 있게 ... 그리고 팀 내부 slack을 연동해놓을 경우에는 그 채널에 알림이 가는거지."
- 에셋: "에셋 (이 공간이 아마 프로젝트 에셋으로 구성되어야 하지 않을까 싶은데) 도 수정이 필요할 것 같아. 너가 잘 판단해봐."

조정 세션이 대표에게 이미 말한 판단 여섯 가지(프로젝트 하나, 강제하지 않음, 홈은 프로젝트 카드 + 소식 한 칸, 에셋 세 묶음, 파일에 붙는 대화, Slack 한 방향)를 방향으로 삼았다. 코드와 어긋나는 곳은 §11-2에 모았다.

## 2. 지금 코드 (`3d274a58`)

| 무엇 | 사실 | 근거 |
| --- | --- | --- |
| 야기 팀 프로젝트 | `brand_projects`. 의뢰서 성격: `title` 3–120자, `objective` 3–2000자 필수, `production_mode in ('creator','studio')` 필수, `status in ('requested','active','completed','cancelled')`. 이후 `client_visible`, `cover_attachment_id`, `campaign_terms`, `shortlist_criteria`, `intake_brief`가 붙었다. 종류를 가르는 `kind`·`origin` 열은 없다 | `supabase/migrations/0027_core_brand_workspace.sql:23-35`, `0031:3`, `0034:42`, `0056:22`, `0068:27`, `0085:35` |
| 그 표를 가리키는 것 | 외래 키 29곳(대화 `brand_room_messages`, 스토리보드, 검수 `brand_studio_reviews.project_id`, 공유 링크 `brand_room_shares`, 알림 `brand_room_notices`, 납품본, 캠페인·정산·사용권 등). `lib/`와 `app/`의 약 35개 파일이 이 표를 다룬다 | `0027`–`0094`의 `references brand_projects`, `lib/brand-rooms/*`, `lib/brands/workspace/service.ts` |
| 영상 프로젝트 | `brand_studio_video_projects`. `title` 1–120자, `status in ('active','completed','archived')`, `aspect`, `timeline` jsonb(편집 타임라인 `ComposerProject`). 가리키는 외래 키는 `brand_studio_jobs.project_id` 하나 | `0087_core_brand_studio_projects_workflows_mcp.sql:15-35`, `0091_core_brand_studio_job_project.sql`, `lib/brand-studio/compose/timeline.ts:174-187` |
| 실행의 프로젝트 | `brand_studio_jobs.project_id`(nullable, 영상 프로젝트를 가리킴). `BRAND_STUDIO_PROJECTS=on`이고 열이 있을 때만 쓴다(기본 off). 이미지 스튜디오는 `?project=`로 고르고, 영상 스튜디오는 실행에 프로젝트를 보내지 않는다. 사운드 실행도 넣지 않는다 | `lib/flags.ts:265-274`, `lib/brand-studio/job-projects.ts`, `components/brand-studio/studio-app.tsx:244-258`, `components/brand-studio/video/workspace.tsx:219`, `lib/brand-studio/sound/music-jobs.ts:385-387` |
| 한 덩어리로 옮기기 | 실행과 거기서 나온 것(새 버전, 1080p 마무리, 부분 수정)은 한 가족으로 같이 움직인다(`job.assign_project`의 재귀 쿼리). 새 실행은 원본 실행의 프로젝트를 물려받는다 | `lib/brand-studio/job-projects.ts:67-145` |
| 영상 스튜디오의 `?project=` | 영상 프로젝트(타임라인) id다. 첫 클립이 올라가거나 첫 실행이 받아들여질 때 자동으로 만들어진다 | `app/(brand)/brand/studio/video/page.tsx:86,135`, `components/brand-studio/video/workspace.tsx:377-439` |
| 편집 스튜디오의 영상 | 브라우저 localStorage `twings_studio_compose_v1:<orgId>`에만 있다. 서버에 저장하지 않는다 | `lib/brand-studio/compose/timeline.ts:399-401`, `components/brand-studio/editor-v2/film-store.ts` |
| 사운드 | `brand_studio_jobs.kind in ('music','sound_effect')` + `brand_studio_outputs.kind='audio'`. 에셋 화면의 실행 조회는 이미지·영상 종류만 읽어서 사운드가 빠진다 | `0172_core_brand_studio_sound.sql`, `lib/brand-studio/repo.ts:268-290` |
| 올린 자료 | `brand_studio_assets`(`role`: product·person·logo·style·place·other). 프로젝트 열 없음. 조직 로고는 `brand_organization_logos` | `0076_core_brand_studio.sql:17-50`, `0035` |
| 폴더·좋아요 | `brand_studio_folders`/`_folder_items`(조직 공용, 100개·500개 한도), `brand_studio_likes`(개인) | `0081_core_brand_studio_library.sql` |
| 에셋 화면 | 탭 `projects|all|uploads|generated|folders|liked|deliverables`. "프로젝트"는 타임라인에 놓인 파일, 검수 파일, 납품본에서 읽어 묶은 것이다(열이 없어서) | `components/brand-studio/asset-hub-model.ts:9,335-412`, `lib/brand-studio/asset-projects.ts` |
| 홈 | 이름 → 입력창 → "바로 확인할 작업물"·"야기 팀과" 줄 → 시작 가이드 → 최근 작업물 벽(최대 12, 오디오 제외). 소식을 띄우는 자리는 없다 | `components/brand-workspace/home/home-view.tsx`, `lib/brands/workspace/home.ts:134-163` |
| 대화 | `brand_room_messages`. 방은 따로 없고 `channel`이 `'general'`(프로젝트 없음) 또는 프로젝트 id 문자열이다. 답글은 한 단계. `mentions uuid[]`. `ref_key`는 `storyboard:`·`review:`만 허용하고, `ref`가 있으면 프로젝트가 있어야 한다 | `0082_core_brand_room_messages.sql:44-76`, `lib/brand-rooms/messages.ts:794` |
| 누가 대화를 보나 | 조직의 활성 멤버 + 그 프로젝트의 손님(`brand_project_members`). 야기 팀은 관리자 화면에서 `client_visible` 프로젝트의 채널을 읽는다: 대부분 `channel = p.id::text`로 찾지만, 대화 목록의 두 번째 조회는 채널을 가리지 않고 `channel`로 묶는다. 멤버가 글을 쓰면 매번 야기 팀 알림이 대기열에 들어간다. 멘션 후보는 멤버와 손님이고 "@야기 팀"은 팀 알림으로 간다 | `lib/brand-rooms/access.ts:140-176`, `lib/brand-rooms/messages.ts:590-609,1195-1203,1618-1657,1724-1737` |
| 읽음 | `brand_room_reads`: 사람·채널마다 `last_read_at` 하나(메시지별이 아님). 이 표의 `channel`도 `'general'`이나 uuid 문자열만 허용한다(`brand_room_reads_channel`) | `0082:113-122` |
| 채널 값을 믿는 코드 | 채널 문자열을 `'general'` 또는 uuid로만 받는 곳: zod `ChannelId`, 메시지 조회·보내기의 채널 해석. `parseRefKey`는 `storyboard:`·`review:`만 읽는다. 알림은 채널을 `project_id`에서 만들어 읽음·묶음을 판단한다 | `lib/brand-rooms/message-contracts.ts:180,263-269,519`, `lib/brand-rooms/messages.ts:154-160,1181,1456-1457`, `lib/brand-rooms/notices.ts:560,736,802-803` |
| 알림 | `brand_room_notices`(메일·푸시 대기열). 종류 `new_version·storyboard·team_message·team_reply·mention·intake_received`. 멘션은 즉시 메일 + 푸시, 팀 메시지는 10분 묶음. 멤버끼리의 멘션 없는 글은 아무에게도 알리지 않는다. `BRAND_ROOMS`와 `BRAND_ROOM_NOTIFY`가 둘 다 on이어야 한다 | `0094_core_brand_room_notices.sql:30-65`, `lib/brand-rooms/notices.ts:60-111`, `vercel.json:16-17` |
| 지금의 "검수 · 공유" | `POST /api/brand-studio/share-bridge`. 검수 기록을 만들고, 프로젝트가 없으면 제목이 "스튜디오 공유 · 검수함"인 `brand_projects` 행을 만든다(제목으로 다시 찾는다). 채팅에 올리면 `ref: review`로 글을 쓰고 **야기 팀 Slack 알림을 보낸다** | `app/api/brand-studio/share-bridge/route.ts:33,124-133,253-314,494-506` |
| 초대 | 워크스페이스 초대는 owner만(`createBrandInvitation`), 역할은 editor·viewer, 조직당 하루 20건, 7일 만료. 초대 메일은 `BRAND_ORG_INVITE_EMAIL`(기본 off). `brand_plan_assignments.seats`는 있지만 초대할 때 확인하는 코드는 없다 | `lib/brands/workspace/service.ts:861-880`, `lib/flags.ts`(`BRAND_ORG_INVITE_EMAIL`), `0074:49,57` |
| 닫힌 조직 | `isSandboxedClientOrganization`, `assertBrandFeature`, `brand_feature_policies`. 페이지는 `notFound()`, API는 `not_found` | `lib/brands/features.ts:37-65`, `lib/brands/entitlements.ts:182-194`, `lib/brand-rooms/access.ts:77-83`, `lib/brand-studio/access.ts:39` |
| Slack | 전부 야기 팀 내부 알림용(환경변수의 웹훅·봇 토큰). 고객 Slack을 연결하는 코드와 조직별 연동 표는 없다 | `lib/brands/team-notice-outbox.ts`, `lib/brands/concierge-slack.ts`, `lib/brands/slack*.ts` |
| 레일 모드 | 쿠키 `twings_brand_mode`(조직별 맵). 직접 만들기: `/brand/studio*`·`/brand/identity`. 야기 팀과: `/brand`·`/brand/projects*`·`/brand/rooms*`·`/brand/creators*` | `components/brand-workspace/rail-mode.ts:28,55-62` |
| 관리자 조작 | `lib/admin/operations.ts` 레지스트리(`parse` + `run`), `POST /admin/do`. 브랜드 쪽 배너·공지 조작은 없다 | `lib/admin/operations.ts:46-62`, `lib/admin/dispatch.ts:22-40` |

## 3. 프로젝트 하나

### 3.1 세 가지 안

| | A. `brand_projects`가 프로젝트 (추천) | B. `brand_studio_video_projects`가 프로젝트 (V6 결정) | C. 새 상위 표를 얹는다 |
| --- | --- | --- | --- |
| 대화·검수·스토리보드·공유·알림 | 그대로 쓴다(외래 키 29곳이 이미 여기를 본다) | 다섯 개 표의 외래 키를 바꾸거나 영상 프로젝트마다 숨은 `brand_projects` 행을 만들어야 한다 | 모든 표를 새 id로 옮기거나 두 id를 같이 들고 다닌다 |
| 야기 팀 프로젝트와의 관계 | 같은 행. "야기 팀에 맡기기"는 그 행의 상태를 바꾸는 일이다 | 끝까지 다른 것. 프로젝트가 두 가지인 문제가 남는다 | 같은 프로젝트에 id가 둘 |
| 이미지·사운드만 있는 프로젝트 | 자연스럽다 | `timeline`과 `aspect`가 빈 행(V6 §3이 그렇게 적었다) | 자연스럽다 |
| 한 프로젝트에 편집본 여러 개 | 영상 프로젝트가 프로젝트 안의 편집본이 된다 | 못 한다(V6 §3도 "그때 상위 표를 얹는다"고 적었다) | 된다 |
| 위험 | 직접 만든 프로젝트가 야기 팀 화면·정산·보관 규칙에 섞일 수 있다(§3.4로 막는다) | 대화 쪽을 크게 고친다 | 옮길 것이 가장 많다 |

**A를 추천한다.** 프로젝트에 붙어야 하는 것(대화, 검수, 알림, 공유 링크)이 전부 `brand_projects`에 걸려 있고, 직접 만든 프로젝트를 나중에 야기 팀에 맡기려면 같은 행이어야 한다. B는 V6 문서가 Canvas를 보류하면서 "지금은 상위 컨테이너가 필요 없다"고 내린 결정인데, 대화와 공유가 프로젝트에 들어오면서 전제가 바뀌었다.

### 3.2 무엇이 어디에 붙나

| 대상 | 프로젝트와의 연결 | 프로젝트가 없을 때 |
| --- | --- | --- |
| 프로젝트 | `brand_projects` + 새 열 `origin`: `'team'`(야기 팀에 맡긴 것. 지금 있는 행 전부의 기본값) / `'self'`(직접 만들기에서 만든 것). `'self'` 행은 `client_visible=false`로 만든다(§3.4) | — |
| 스튜디오 실행(이미지·영상·사운드) | 새 열 `brand_studio_jobs.brand_project_id` → `brand_projects`. 결과물은 실행을 따라간다 | null = 미분류 |
| 올린 자료 | 새 열 `brand_studio_assets.brand_project_id` | null이고 `role`이 product·person·logo·style·place면 브랜드 자료, 아니면 미분류 |
| 편집본 | `brand_studio_video_projects` + 새 열 `brand_project_id`. 고객 화면의 이름은 "편집본"(영상 프로젝트라는 말은 없앤다) | null = 미분류 편집본 |
| 편집 스튜디오의 영상 | 지금은 브라우저에만 있다. 편집본 행으로 서버에 저장되어야 프로젝트에 보인다(조각 6, 편집 스튜디오 작업과 맞춘다) | 저장 전에는 어디에도 안 보인다 |
| 검수·스토리보드·외부 공유 링크·납품본 | 이미 `brand_projects`를 가리킨다. 바꾸지 않는다 | — |
| 대화 | `brand_room_messages`. 프로젝트마다 칸이 둘: 야기 팀과 하는 지금 채널, 그리고 멤버만 보는 새 칸(§8.2) | 멤버 칸 `members`(프로젝트 없음) |
| 기존 `brand_studio_jobs.project_id` | 건드리지 않는다. 새 코드는 읽지도 쓰지도 않는다. 운영에 값이 있는지 확인한 뒤(§11-3) 정리 마이그레이션에서 지운다 | — |
| 폴더 | 표는 그대로. 에셋 화면에서는 폴더가 있는 조직에만 필터로 보인다. 새로 만드는 길은 `더보기` 안으로 옮긴다. "폴더를 프로젝트로 바꾸기"는 조각 6 | — |
| 좋아요 | 그대로(개인). 에셋의 필터가 된다 | — |

### 3.3 직접 만들기와 야기 팀과

- `origin`은 "누가 만들고 있나"다. 레일의 두 모드는 화면을 가르는 렌즈로 남고, 프로젝트는 하나다.
- **야기 팀에 맡기기:** `origin='self'` 프로젝트에서 의뢰 마법사(`/brand/projects/new`의 `ProjectIntakeWizard`)를 그 프로젝트 id로 연다. 제출하면 같은 행을 `origin='team'`, `status='requested'`, `client_visible=true`로 바꾸고 `objective`·`intake_brief`·`production_mode`를 채운 뒤, 지금 새 의뢰가 하는 일(`project_requested` 이벤트, 야기 팀 알림 `lib/brands/workspace/service.ts:423-439`)을 그대로 한다. 야기 팀과의 채널이 그때 열린다(그 전에는 `client_visible=false`라 채널 목록·글쓰기·야기 팀 화면 어디에도 없다). 이 갱신에는 `service_role`의 열 권한이 더 필요하다(§3.6).
- 직접 만든 파일은 야기 팀에 **자동으로 보이지 않는다.** 지금처럼 고객이 고른 파일만 넘긴다(`lib/brand-studio/handoff.ts`가 `brand_attachments`로 복사하는 방식). 멤버 칸의 대화도 넘어가지 않는다.
- 반대로, 야기 팀 프로젝트에도 고객이 직접 만든 결과를 담을 수 있다(스튜디오에서 그 프로젝트를 고르면 된다). 고객 쪽 "파일" 탭에만 보인다.
- 보관: 직접 만든 프로젝트는 `status='completed'`를 "보관"으로 쓴다. 홈 카드에서 빠지고 "전체 프로젝트"에 남는다.

### 3.4 직접 만든 프로젝트가 야기 팀 쪽에 새지 않게

두 겹으로 막는다.

**첫째 겹: `origin='self'` 행은 `client_visible=false`로 만든다.** 이 열은 지금 "야기 팀과 화면에 보이는가"로 쓰인다(직원이 숨겨 둔 프로젝트가 false, `lib/brands/workspace/service.ts:421`). 지금 코드의 대부분이 이 조건을 건다. 그래서 따로 고치지 않아도 닫히는 곳:

- 고객의 야기 팀 채널 목록과 안 읽은 수(`channelRows`, `lib/brand-rooms/messages.ts:1256-1287`), 그 채널에 글쓰기(`requireRoomProject`, `lib/brand-rooms/access.ts:119`)와 거기서 나가는 야기 팀 알림(`messages.ts:1195-1203`).
- 야기 팀 대화 목록·채널(`messages.ts:1627,1653,1724`), 직원이 id로 여는 방(`messages.ts:1458,1695`).
- 고객 쪽 `/brand`·야기 팀과 홈·에셋의 팀 묶음(`loadBrandWorkspace`의 고객 분기 `service.ts:273`, `lib/brand-studio/asset-projects.ts:97`), "야기 팀 프로젝트에 추가" 목록(`lib/brand-studio/repo.ts:346`, `app/api/brand-studio/share-bridge/route.ts:367`), 알림 대상(`roomAudience`, `access.ts:152-155`).

새 화면(홈 카드, 프로젝트 페이지, 프로젝트 칩)은 `client_visible`을 보지 않고 `origin`으로 읽는 새 조회를 쓴다.

**둘째 겹: `client_visible`을 걸지 않는 조회에 `origin = 'team'`을 더한다.**

| 어디 | 지금 조건 | 섞이면 생기는 일 |
| --- | --- | --- |
| `lib/brand-rooms/storyboards.ts:1077` `staffStoryboardList`, `lib/brand-studio/review.ts:1458` `staffDeliveryProjects` | 취소 아님 | 야기 팀 작업 목록에 고객의 내부 프로젝트가 뜬다 |
| `lib/brands/workspace/service.ts:335` `loadStudioWorkspace`, `:269`(`loadBrandWorkspace`의 직원 분기), `:321`(`loadBrandWorkspaceChoices`의 id→조직 맵) | 없음 또는 조직만 | 관리자 화면의 프로젝트 목록 |
| `lib/admin/brand-org-list.ts:320` | 없음 | 조직별 프로젝트 수 |
| `lib/brands/storage-quota.ts:537-545` | 조직만 | "진행 중인 프로젝트 있음"이 항상 참이 되고, 직접 만든 프로젝트를 보관(`completed`)하면 "마지막 완료 시각"이 움직여 보관 기한 계산이 달라진다. 조회 전체를 `origin='team'`으로 좁힌다 |

영향이 없는 것으로 본 곳: `app/(admin)/admin/inquiries/page.tsx:52`(`status='requested'` + `intake_brief` 있음), 캠페인 쪽(`production_mode='creator'` 조건), `lib/brands/creator-pool.ts:114`(캠페인 링크 조인), `lib/brands/workspace/inbox.ts:64`(옛 `brand_messages` 행이 있어야 잡힌다. 직접 만든 프로젝트에는 없다), `lib/brands/upload-gate.ts:236-244`(관리자가 만든 행만 본다).

**테스트로 못 박는다.** ① 조건을 상수 하나(`TEAM_PROJECTS`)로 두고 둘째 겹의 조회가 모두 그것을 쓴다. ② `lib/`·`app/`에서 `brand_projects`를 읽는 파일 목록을 테스트가 들고 있다가, 새 파일이 생기거나 목록의 파일이 `client_visible`도 상수도 없이 여러 행을 읽으면 실패한다(`rail.css`의 선택자 범위를 읽는 테스트와 같은 방식). ③ 직접 만든 프로젝트를 하나 넣고 위 화면·목록·알림·보관 계산이 그대로인지 보는 통합 테스트.

`origin='self'` 행은 `production_mode='studio'`, `objective=''`로 쓴다. `production_mode`의 허용 값은 넓히지 않는다(zod `z.enum(['creator','studio'])`, `lib/brands/workspace/schemas.ts:41`을 그대로 둔다). 지금의 `createProject`는 의뢰서 스키마(제목 3–120자, 목적 3–2000자, `schemas.ts:36`)를 통과해야 하므로 직접 만든 프로젝트는 넣는 함수를 따로 둔다.

### 3.5 기존 행

- `brand_projects`: 전부 `origin='team'`(기본값). 데이터를 고치지 않는다.
- "스튜디오 공유 · 검수함" 행: 그대로 둔다. 보내기가 열리면(조각 4) 새로 만들지 않고, 이미 있는 것은 보통 프로젝트처럼 목록에 보인다. 운영에 몇 개 있는지는 확인하지 못했다(§11-3).
- `brand_studio_video_projects`: 자동으로 프로젝트를 만들지 않는다. 미분류의 편집본으로 보이고, 편집본에서 "프로젝트로 만들기"를 누르면 같은 이름의 프로젝트를 만들어 그 편집본과 타임라인에 놓인 실행·자료(`collectMediaRefs`, `lib/brand-studio/video-projects/service.ts`)를 함께 옮긴다. 첫 클립에서 자동 생성되는 행이라 한꺼번에 프로젝트로 바꾸면 이름 없는 프로젝트가 쌓인다.
- `brand_studio_jobs`, `brand_studio_assets`: 전부 미분류로 시작한다(새 열이 null).

### 3.6 마이그레이션 (가장 작게, 되돌릴 수 있게)

작성 시점 `origin/main`의 가장 높은 번호는 `0193`이다(`0192_core_format_revision` · `0193_glue_format_revision`). 구현 PR을 열기 직전에 다시 확인한다.

**조각 1: `0194_core_brand_project_spine.sql` + `0195_glue_brand_project_spine.sql`: 클라우드 적용 필요**

```sql
-- core 0194 (요지)
alter table brand_projects add column if not exists origin text not null default 'team';
alter table brand_projects add constraint brand_projects_origin check (origin in ('team','self'));
-- 제목·목적 검사는 열에 붙은 check라 이름이 정해져 있다(brand_projects_title_check,
-- brand_projects_objective_check). 이름으로 지우고 다시 만든다(0053:39가 같은 식으로 지운다).
--   title:     origin='self' → 1–120자, 그 외 지금처럼 3–120자
--   objective: origin='self' → 0–2000자, 그 외 지금처럼 3–2000자
create index if not exists idx_brand_projects_origin on brand_projects (organization_id, origin, updated_at desc);

alter table brand_studio_jobs            add column if not exists brand_project_id uuid;
alter table brand_studio_assets          add column if not exists brand_project_id uuid;
alter table brand_studio_video_projects  add column if not exists brand_project_id uuid;
-- 셋 다: foreign key (organization_id, brand_project_id) references brand_projects (organization_id, id)
--        on delete set null (brand_project_id), 그리고 where brand_project_id is not null 부분 색인.
```

- glue 0195: 세 스튜디오 표는 0152·0162의 자세(RLS 강제, 브라우저 정책 없음, `service_role`만)를 다시 확인만 한다(0165가 0091에 한 것과 같다). `brand_projects`는 `service_role`에게도 `select, insert`와 **열 단위 UPDATE**만 열려 있다(`0113:7-13`의 `status, revision, updated_at`, 이후 `0117:6`·`0120:4`·`0148:4`·`0160:4`가 `client_visible`·`cover_attachment_id`·`shortlist_criteria`·`intake_brief`를 더했다). `origin`·`title`·`objective`·`production_mode`에는 UPDATE 권한이 없고 DELETE도 없다. 그래서 glue가 `grant update(origin, title, objective, production_mode) on brand_projects to service_role`을 준다(이름 바꾸기와 "야기 팀에 맡기기"에 필요하다). 브라우저 역할에는 아무것도 주지 않는다.
- 스위치: `BRAND_PROJECT_SPINE`(기본 off). 서버는 열이 있는지도 본다(`jobProjectColumnReady`와 같은 방식, `lib/brand-studio/job-projects.ts:24-33`). 그래서 코드를 먼저 배포하고 마이그레이션을 뒤에 적용해도 된다.
- 순서: 코드 배포(스위치 off) → 0194·0195 적용 → 시험 조직에서 on → 전체 on.
- 되돌리기: 스위치를 끄면 아무도 새 열을 읽거나 쓰지 않는다. `origin='self'` 행은 `client_visible=false`라 스위치가 꺼진 화면 어디에도 나오지 않는다. 완전히 되돌리려면 그 행들을 지우고(앱 역할에는 DELETE 권한이 없어 되돌리기 마이그레이션에서 지운다), 새 열 셋과 `origin`을 지우고, 제목·목적 검사와 권한을 원래대로 돌린다. 기존 행의 값은 바뀐 적이 없다.

**뒤 조각의 마이그레이션(번호는 그때 정한다, 모두 클라우드 적용 필요):** 소식 칸(§6), 보내기(§8.6), Slack(§9.3).

## 4. 열려 있는 프로젝트와 미분류

**프로젝트를 강제하지 않는다.** 고르지 않고 만들면 미분류에 들어가고, 프로젝트를 골라 둔 동안에는 저절로 그 프로젝트에 들어간다. 처음 온 사람이 이름부터 짓게 하면 첫 결과를 보기 전에 멈춘다. 반대로 개인 보관함을 두면 팀이 서로의 작업을 못 본다. 그래서 미분류는 워크스페이스의 것이다.

### 4.1 "지금 어느 프로젝트인가"

- **보이는 곳:** 네 스튜디오의 머리말, 제목 바로 옆의 칩 하나(시안 g). 홈의 입력창에는 "저장 위치" 칩으로 같은 것이 보인다. 지금은 스튜디오마다 머리말이 따로라(`components/brand-studio/v2-page.tsx:71-75`, `app/(brand)/brand/studio/video/page.tsx:91-121`, `sound/sound-studio.tsx:458`, `editor-v2/editor-v2.tsx:95`) 칩 컴포넌트 하나를 네 곳에 건다. `ImageProjectBar`·`VideoProjectBar`(`components/brand-studio/video/project-bar.tsx`)는 스위치가 켜지면 그리지 않는다.
- **주소:** `?project=<brand_projects.id>`가 그 화면의 기준이다. 영상 스튜디오에서는 지금 `?project=`가 편집본 id라서 `?film=<id>`로 옮기고, 옛 주소는 편집본 id로 읽히면 `film`으로 바꿔 준다.
- **기억:** 쿠키 `twings_brand_project`(조직별 맵, `twings_brand_mode`와 같은 모양)에 마지막으로 고른 값을 둔다. 주소에 없으면 쿠키를 읽어 서버가 처음부터 맞는 칩을 그린다. "미분류"를 고른 것도 값으로 기억한다(그래야 직전 프로젝트로 되돌아가지 않는다). 브라우저·조직 단위다.
- 기억한 프로젝트가 보관·삭제됐으면 미분류로 돌아가고 한 줄로 알린다.

### 4.2 새 결과가 들어가는 곳

서버가 정한다(지금의 `projectForNewJob` 규칙을 `brand_project_id`로 옮긴다).

1. 내부 채우기 실행(`params.purpose='fill'`)은 프로젝트가 없다.
2. 앞선 결과에서 만든 것(새 버전, 1080p 마무리, 부분 수정)은 요청이 뭐라 하든 원본 실행의 프로젝트를 따른다.
3. 그 밖에는 요청이 보낸 프로젝트. 이 조직의 것이고 보관·취소가 아니어야 한다. 아니면 `not_found`.
4. 사운드 실행과 영상 실행도 같은 값을 보낸다(지금은 둘 다 안 보낸다).
5. 올린 자료는 프로젝트가 열려 있을 때 올리면 그 프로젝트에 들어간다. 에셋 화면의 "브랜드 자료"에서 올리면 프로젝트 없이 들어간다.

### 4.3 옮기기

- **한 개:** 파일의 `더보기`와 뷰어의 프로젝트 칩에서. 실행 단위로 움직이므로 한 번에 만든 여러 장과 그 버전들이 같이 간다(`assignStudioJobProject`의 가족 규칙). 창에 몇 개가 함께 가는지 적는다.
- **여러 개:** 에셋에서 여러 개 고르고 "프로젝트로 옮기기". 서버가 가족을 넓혀 한 트랜잭션으로 옮긴다(한 번에 200개까지).
- **편집본:** 편집본만 옮기거나, 타임라인에 놓인 실행·자료까지 같이 옮길지 묻는다.
- **미분류로 빼기:** 같은 창에서 "미분류".
- 옮기면 그 파일에 붙은 대화도 따라간다(§8.2).
- 권한: 만들 수 있는 자리(owner·editor). viewer는 못 옮긴다.

### 4.4 미분류를 누가 보나

스튜디오를 쓸 수 있는 활성 멤버 전부. 지금 에셋 화면이 조직 전체에 보이는 것과 같다. 프로젝트 손님(`brand_project_members`)과 닫힌 조직에는 보이지 않는다. 개인 칸은 만들지 않는다.

### 4.5 프로젝트 칩의 목록

| 프로젝트 수 | 칩 | 목록 |
| --- | --- | --- |
| 0 | "미분류" | 미분류(선택됨) · 새 프로젝트 · 안내 한 줄. 검색 없음 |
| 1–5 | 고른 것의 이름 또는 "미분류" | 프로젝트들(최근 작업 순, 썸네일·마지막 작업) · 구분선 · 미분류 · 새 프로젝트 |
| 6 이상 | 같음 | 위에 검색, 최근 6개, "전체 프로젝트" 링크 |

- 야기 팀 프로젝트는 보조 줄에 "야기 팀과"가 붙는다.
- 새 프로젝트는 이름만 받는다(1–120자). `origin='self'`, `status='active'`, `client_visible=false`로 만들고 바로 고른다. 넣는 함수는 따로 두되(§3.4) 지금의 조직당 하루 20개 한도(`lib/brands/workspace/service.ts:395-396`, share-bridge가 만든 행도 센다)와 같은 규칙으로 센다.

## 5. 홈 (직접 만들기)

위에서 아래로(시안 a, b):

1. **작업공간 이름**: 지금 그대로.
2. **소식 한 칸**(§6): 켜진 소식이 있고 이 사람이 닫지 않았을 때만.
3. **입력창**: PR #360 그대로. "저장 위치" 칩만 더한다.
4. **확인할 것**: 가는 줄, 있을 때만. 받은 공유(나를 부른 글 가운데 안 읽은 것)와 확인할 시안·스토리보드(지금의 "바로 확인할 작업물", `loadRoomSummary().alerts`)를 한 묶음으로. 두 줄까지 보이고 나머지는 "더 보기".
5. **야기 팀과**: 지금 그대로 한 줄.
6. **진행 중인 프로젝트**: 카드. 본문이다. 최근 작업 순 6개, "전체 프로젝트"·"새 프로젝트" 링크.
7. **미분류**: 한 줄(썸네일 몇 장, 개수, "프로젝트로 옮기기"). 0개면 없다.
8. **시작 가이드**: 지금 조건 그대로.

**프로젝트가 하나도 없을 때:** 6·7 대신 안내 한 줄("프로젝트로 묶어 두면…" + "새 프로젝트")과 지금의 최근 작업물 벽. 아무것도 만든 적이 없으면 지금의 시작 예시 세 개.

**카드 하나가 보여 주는 것**

| 요소 | 내용 | 어디서 |
| --- | --- | --- |
| 표지 | 최근 결과 3장(큰 것 1 + 작은 것 2). 결과가 없으면 올린 자료. 야기 팀 프로젝트는 표지(`cover_attachment_id`) 또는 최근 시안 | `brand_studio_jobs.brand_project_id` → `brand_studio_outputs`, `brand_studio_assets` |
| 제목 | 프로젝트 이름 + 안 읽은 것이 있으면 작은 숫자 표시(잉크색, 포인트 색 아님) | `brand_projects.title`, §8.4의 읽음 |
| 둘째 줄 | 직접 만든 것: "이미지 24 · 영상 6 · 사운드 2". 야기 팀 것: "야기 팀과 · 시안 v2 확인 대기"(지금 야기 팀과 홈의 단계 줄) | 종류별 개수, `loadRoomOverview` |
| 셋째 줄 | 마지막 작업 시각과 한 일("김서아 님이 영상을 추가했습니다") | 실행·자료·멤버 칸 글 가운데 가장 최근 것 |

- 조회는 `lib/brands/workspace/project-cards.ts` 하나로: 조직의 `status in ('requested','active')` 프로젝트를 한 번에 읽고, 표지·개수·마지막 작업은 lateral 조인으로 붙인다(카드마다 따로 조회하지 않는다).
- 카드에는 테두리 상자를 두지 않는다. 사진이 카드고 글은 그 아래 세 줄이다(TASTE 규칙 15·20). 채운 버튼은 입력창의 것 하나다.
- 글자는 홈의 세 단계(22 / 15 / 12.5)만 쓴다.

**야기 팀과 홈**(`team-home.tsx`): 그대로다. 직접 만든 프로젝트는 `client_visible=false`라 지금 조회에 잡히지 않는다(§3.4). 직접 만들기 홈의 카드에는 야기 팀 프로젝트도 함께 보인다(둘째 줄로 구분).

**TASTE와의 관계:** 규칙 20("홈은 입력창 + 확인할 것 + 최근 작업물 벽")의 벽이 프로젝트 카드로 바뀌고, 규칙 14(캠페인 운영과 셀프 스튜디오 분리)는 "프로젝트는 하나, 화면은 모드로 가른다"로 다시 써야 한다. 대표가 시안을 승인하면 구현 PR에서 `docs/design/TASTE.md`에 그 판정을 적는다.

## 6. 소식 칸

한 번에 하나. 캐러셀, 카운트다운, 여러 줄 쌓기는 만들지 않는다.

**데이터**

```text
brand_announcements
  id, slot ('home')
  kicker_ko/en (≤12자, 비우면 기본 머리표), title_ko/en (≤60자), cta_label_ko/en (≤12자)
  cta_href        -- '/brand/...' 내부 경로 또는 twings.app 계열 https 주소만
  image_key, image_w, image_h   -- 공개 미디어 저장소의 키. 없으면 한 줄형으로 그린다
  starts_at, ends_at            -- 둘 다 필수, 60일 이내
  audience jsonb                -- { modes?: ['make','team'], plans?: [...], orgs?: [uuid] }
  status ('draft','live','ended'), created_by, created_at, updated_at
brand_announcement_dismissals (announcement_id, user_id, dismissed_at)   -- 사람마다 닫기
```

코드 설정 파일로 두면 소식 하나마다 배포가 필요하다. 대표가 직접 올리는 자리라서 표 + 관리자 조작으로 둔다.

**관리자 조작**(`lib/admin/operations.ts` 레지스트리에 등록, `/admin/do`):

- `brandNews.save`: 초안 만들기·고치기. 이미지 올리기는 `landingMedia.replace`의 경로를 따른다.
- `brandNews.publish`: 켜기. 두 언어 문구·기간이 다 있어야 한다. 같은 자리에 켜진 것이 있으면 그것을 끝낸다.
- `brandNews.end`: 끝내기.
- 화면 `/admin/brand-news`: 목록, 실제 크기 미리보기, 대상 조직 수.

**누구에게 보이나**

- 닫힌 조직에는 절대 보이지 않는다: 읽는 함수가 `isSandboxedClientOrganization`과 `assertBrandFeature(…,'generative_media')`를 먼저 통과시킨다(`roomAudience`가 하는 것과 같다, `lib/brand-rooms/access.ts:144-151`).
- 기본 대상은 직접 만들기를 쓸 수 있는 조직의 직접 만들기 홈이다. `audience`로 모드·플랜을 좁히고, `orgs`로 시험 조직에만 먼저 켠다.
- 기간 안, `status='live'`, 내가 닫지 않은 것 가운데 가장 최근에 시작한 하나.
- 닫으면 그 소식은 그 사람에게 다시 뜨지 않는다.

**이미지 규칙**

- 원본 1600×400(4:1) WebP, 400KB 이하. 주제는 오른쪽 절반, 세로 가운데 60% 안. 왼쪽은 글 뒤로 어두워진다.
- 이미지 안에 글자를 넣지 않는다. 문구는 화면이 얹는다.
- 우리가 만든 승인된 컷만 쓴다. 새 이미지는 올리기 전에 대표에게 후보로 보인다(IDENTITY §6-4-4).
- 닫힌 조직의 미디어, 고객사 로고는 쓰지 않는다.

**문구:** 소식마다 대표가 쓴다. 화면은 틀(머리표, 한 줄, 버튼, 닫기)만 준다. 시안의 문장은 자리 표시다.

## 7. 에셋

**탭(시안 d):** 프로젝트별 · 브랜드 자료 · 미분류 · 모든 파일.
**필터(한 줄):** 종류(이미지·영상·사운드) · 역할(브랜드 자료에서) · 좋아요만 · 폴더(폴더가 있는 조직만) · 검색.

| 지금 탭 | 바뀐 뒤 |
| --- | --- |
| 프로젝트(읽어서 묶음) | 프로젝트별. `brand_project_id`로 묶는다. 맨 위에 브랜드 자료 한 줄, 맨 아래에 미분류 묶음. 묶음 제목 옆에 종류별 개수 |
| 전체 | 모든 파일 |
| 업로드 · 생성 결과 | 모든 파일의 필터("올린 것 / 만든 것"). 프로젝트 안에서는 "올린 자료" 줄 |
| 폴더 | 필터. 탭에서는 뺀다 |
| 좋아요 | 필터 |
| 캠페인 납품본 | 그 야기 팀 프로젝트의 묶음 안("시안 3 · 납품본 5"). 지금의 연결(`brand_content_versions.project_id`, `brand_studio_reviews.project_id`)을 그대로 읽는다 |

- **브랜드 자료:** 프로젝트가 없고 `role`이 product·person·logo·style·place인 올린 자료 + 조직 로고. 로고 · 제품 · 인물 순으로 묶어 보인다. 모든 프로젝트에서 참조로 쓴다(스튜디오 오른쪽 자료 칸의 기본 목록).
- **사운드:** `music`·`sound_effect` 실행의 `audio` 결과를 읽는다(`jobsOfStudioState`에 세 번째 묶음). 타일은 제목 + 길이, 프로젝트 페이지에서는 재생 버튼이 있는 줄.
- **미분류:** `brand_project_id`가 null인 실행·편집본, 그리고 역할이 없거나 `other`인 올린 자료.
- **해야 하는 일:** 지금 에셋 화면은 이미지 60 + 영상 60 실행을 한 번에 받아 브라우저에서 묶는다(`loadStudioState`). 프로젝트별로 정확히 묶으려면 서버가 프로젝트마다 표지 몇 장과 개수를 주고, "모두 보기"는 그 프로젝트만 페이지로 읽어야 한다.

**프로젝트 페이지(시안 c):** 새 주소 `/brand/project/[id]`. 지금 `/brand/rooms*`와 `/brand/projects*`는 레일을 야기 팀과 모드로 바꾸는 경로라(`pathRailMode`, `components/brand-workspace/rail-mode.ts:55-62`) 직접 만든 프로젝트를 거기에 두면 레일이 뒤집힌다. 새 주소는 홈·에셋처럼 모드를 바꾸지 않는 공용 페이지로 둔다. 탭은 파일 · 편집본 · 대화. 파일은 종류별 줄(이미지, 영상, 사운드, 올린 자료). 주 버튼 "이어서 만들기"는 그 프로젝트를 고른 채 스튜디오를 연다. 야기 팀 프로젝트는 지금의 방 페이지 `/brand/rooms/[projectId]`(개요·파일·대화 탭, `lib/brand-rooms/overview.ts:22-23`)가 그대로 프로젝트 페이지이고, 고객이 직접 만든 파일 줄과 멤버 칸이 더해진다. 두 페이지는 같은 머리말·탭 컴포넌트를 쓴다.

## 8. 보내기 (팀 내부 공유)

### 8.1 화면

- 뷰어(시안 e): "검수 · 공유" 자리에 "보내기". 누르면 오른쪽에 입력칸 하나가 열린다. `@`를 치면 멤버 목록이 뜨고, 메시지와 함께 보낸다. Slack처럼 받는 사람과 글이 한 칸에 있다.
- 받는 사람 없이 보내면 프로젝트의 멤버 칸에 카드만 올라가고 알림은 가지 않는다.
- 그 파일에 이미 있는 대화는 입력칸 위에 줄로 보인다. 타일에는 올렸을 때 작은 말풍선 숫자만.
- 보낸 것은 프로젝트의 "대화" 탭(시안 e-2)에 카드로 보인다: 보낸 사람, 멘션, 글, 파일 카드(썸네일·종류·"파일 열기"), 답글.
- 받는 사람의 알림함(시안 f): 썸네일, 보낸 사람, 프로젝트, 글 첫머리, 시각, 안 읽음 점. 열면 오른쪽에 그 대화가 열리고 바로 답글을 단다.
- 레일: 직접 만들기 모드에도 "알림함" 줄을 둔다(지금은 야기 팀과 모드에만 있다, `/brand/rooms`). 안 읽은 수가 붙는다. 알림함 목록 주소는 레일 모드를 바꾸지 않는 공용 페이지로 옮긴다(`pathRailMode`에서 `/brand/rooms` 목록만 빼거나 새 주소를 둔다). 그러지 않으면 직접 만들기에서 알림함을 누를 때마다 레일이 야기 팀과로 바뀐다.

### 8.2 데이터: 멤버 칸

방향은 "파일에 붙은 대화가 그 프로젝트의 지금 대화 채널에 카드로 보인다"였다. 코드를 보면 그 채널은 **야기 팀이 관리자 화면에서 읽고**(`lib/brand-rooms/messages.ts:1618-1657`), 프로젝트 손님도 보며(`lib/brand-rooms/access.ts:160-172`), 멤버가 글을 쓸 때마다 야기 팀 알림이 나간다(`messages.ts:1195-1203`). 내부 의견이 그리로 가면 안 된다. 그래서 채팅 제품을 하나 더 만들지 않고, 같은 표에 **칸**을 하나 더 둔다.

- `brand_room_messages.channel`의 허용 값에 `'members'`(프로젝트 없음)와 `'members:' || project_id`를 더한다. 지금 값(`'general'`, `project_id::text`)은 야기 팀과 하는 대화로 그대로 남는다.
- 읽는 권한: 그 조직의 활성 멤버만. 손님과 야기 팀은 아니다.
- 답글은 지금 규칙 그대로 한 단계. 답글은 부모와 같은 칸에 있어야 한다는 외래 키(`brand_room_messages_parent_fk`)가 그대로 지켜 준다.
- 화면에서는 프로젝트 "대화" 탭 위에 누가 보는 대화인지 한 줄로 적는다. 야기 팀 프로젝트는 "우리 팀 / 야기 팀과" 두 칸을 나란히 둔다.

**멤버 칸은 저절로 숨겨지지 않는다.** 야기 팀 쪽 조회 대부분은 `channel = p.id::text`로 찾지만 그렇지 않은 곳이 있다. 멤버 칸에 글이 하나라도 들어가기 전에 고쳐야 하는 곳:

| 어디 | 지금 | 고칠 것 |
| --- | --- | --- |
| `lib/brand-rooms/messages.ts:1639-1657` (`staffRoomOverview`의 두 번째 조회) | 모든 글을 `channel`로 묶고 `project_id is null or p.client_visible`만 건다. 마지막 글의 본문이 `/admin/brand-rooms`에 찍힌다(`app/(admin)/admin/brand-rooms/page.tsx:114`) | `m0.channel = 'general' or m0.channel = m0.project_id::text` 조건 |
| `lib/admin/brand-org-list.ts:343-347` | 채널을 가리지 않고 `max(created_at)` | 같은 조건(시각만 새지만 맞춘다) |
| `lib/brand-rooms/messages.ts:1195-1203` (`message.send` 뒤의 야기 팀 알림) | 멤버 글마다 대기열에 넣는다 | 멤버 칸이면 넣지 않는다 |
| `lib/brand-rooms/message-contracts.ts:180,519`, `messages.ts:154-160,1181,1456-1457` | 채널 문자열을 `'general'`이나 uuid로만 받는다 | 멤버 칸 값을 받는 고객 쪽 길을 따로 둔다. 직원 쪽 해석(`:1456-1457`)은 그대로 거부하게 둔다 |
| `lib/brand-rooms/message-contracts.ts:263-269` (`parseRefKey`) | `storyboard:`·`review:`만 읽어서 답글이 `ref`를 잃는다(`messages.ts:797`) | `output:`·`asset:` |
| `lib/brand-rooms/notices.ts:560,736,802-803` | 알림이 채널을 `project_id`에서 만든다. 멤버 칸의 멘션이 야기 팀 채널의 읽음으로 판단되고 그 채널 묶음에 섞인다 | 알림 행에 채널을 싣거나 글에서 읽는다 |
| `lib/brand-rooms/access.ts:140-176` (`roomAudience`) | 손님이 대상에 든다. `client_visible`이 아닌 프로젝트는 대상이 비어 버린다 | 멤버 칸 전용 대상(활성 멤버만, `client_visible`과 무관) |
| 저장 용량·정리(`lib/brands/storage-quota.ts:208`, `lib/brands/upload-gate.ts:278,380`, `lib/brand-studio/physical-cleanup.ts:107`) | 채널과 무관하게 첨부를 센다 | 그대로 둔다(멤버 칸의 첨부도 조직 용량이다) |

테스트: 멤버 칸에 글을 넣고, 관리자 대화 목록·조직 목록·야기 팀 알림 대기열·손님 화면·직원 채널 열기에 그 글이 나오지 않는지 본다.

### 8.3 데이터: 파일에 붙이기

- 보내기 하나는 멤버 칸의 **뿌리 글**이다. `ref = {kind:'output', outputId}` 또는 `{kind:'asset', assetId}`, `ref_key = 'output:<uuid>'` / `'asset:<uuid>'`.
- 바꾸는 검사: `brand_room_messages_ref_key`의 정규식에 `asset|output`을 더하고, `brand_room_messages_ref_project`("ref가 있으면 프로젝트가 있어야 한다")는 `channel = 'members'`일 때 풀어 준다(미분류 파일).
- 한 파일의 대화 = `ref_key`가 같은 뿌리 글들(색인 `idx_brand_room_messages_ref`가 이미 있다, `0082:92`).
- 파일을 다른 프로젝트로 옮기면 그 파일의 뿌리 글과 답글의 `project_id`·`channel`을 한 문장으로 바꾼다.
- 파일을 지우면 대화는 남고 카드는 "지워진 파일"로 보인다(지금 soft delete 규칙).

### 8.4 읽음과 알림

- 지금의 읽음은 사람·채널마다 하나라서, 칸을 열면 전부 읽은 것이 된다. 받은 공유가 열 때까지 안 읽음으로 남으려면 대화별 읽음이 필요하다: `brand_room_thread_reads (organization_id, root_message_id, user_id, last_read_at)`.
- 알림함의 "나에게 온 것" = 나를 부른 뿌리 글, 그리고 내가 쓰거나 답글을 단 대화 가운데 마지막 글이 내 읽음보다 뒤인 것.
- 누가 알림을 받나(전부 아니면 전무가 되지 않게):
  - 뿌리 글에서 불린 사람: `mention`(즉시 메일 + 푸시). 규칙표는 그대로 쓰지만, 대상과 읽음 판단은 멤버 칸 기준으로 바꿔야 한다(§8.2 표의 `notices.ts`·`roomAudience` 줄).
  - 그 대화의 참여자(쓴 사람, 불린 사람, 답글 단 사람): 새 답글마다 새 종류 `member_reply`(10분 묶음 메일 + 푸시). 지금은 멤버끼리의 멘션 없는 글이 아무에게도 알리지 않는다(`messageNoticeKind`, `lib/brand-rooms/notices.ts:85-88`).
  - 그 밖의 멤버: 알림 없음. 프로젝트 카드와 레일의 숫자만.
  - "이 프로젝트의 모든 활동 받기"는 나중에 사람이 켜는 것으로.
- 메일·푸시는 지금 대기열과 묶음 규칙을 그대로 쓴다(10분 대기, 사람·자리마다 30분에 묶음 메일 하나, 앱에서 읽으면 건너뜀). 메일 문안은 지금의 멘션 메일을 그대로 쓴다. 썸네일을 넣는 식으로 문안을 바꾸려면 대표 승인이 필요하다.
- `brand_room_notices_kind`에 `member_reply`를 더하고, `brand_room_notices_general`(프로젝트 없는 알림은 `team_message`·`mention`만)에도 더한다.
- `BRAND_ROOMS`·`BRAND_ROOM_NOTIFY`가 꺼진 환경에서는 보내기 자체를 닫는다.

### 8.5 초대하고 보내기

- `@` 뒤에 멤버가 아닌 메일 주소를 치면 목록이 "초대하고 보내기" 한 줄로 바뀐다.
- 글은 바로 올라간다. 초대(`brand_invites`, 7일 만료)를 만들고 `brand_room_pending_mentions (message_id, invite_id)`에 적어 둔다. 수락하면(`acceptBrandInvitation`) 그 사람을 그 글의 `mentions`에 넣고 알림을 만든다. 만료되면 글에는 "초대가 만료됐어요"만 남는다.
- 초대 메일은 지금의 초대 메일 그대로다(`BRAND_ORG_INVITE_EMAIL`이 꺼져 있으면 지금처럼 링크를 복사해 전한다). 새 발송 문안은 만들지 않는다.
- **권한:** 지금은 owner만 초대한다. 추천은 editor도 보내기에서 `viewer` 역할로 초대할 수 있게 하는 것(하루 20건 한도는 조직 전체로 그대로). 대표 결정(§11-1의 3). 정해지기 전에는 owner가 아닌 사람에게 "워크스페이스 관리자만 초대할 수 있어요"를 보인다.
- 좌석 수: 지금 코드에는 초대할 때 좌석을 세는 곳이 없다. 이 설계는 그것을 바꾸지 않는다.

### 8.6 마이그레이션 (조각 4, 번호는 그때): 클라우드 적용 필요

- core: `brand_room_messages_channel`·`_ref_key`·`_ref_project` 검사 교체, `brand_room_reads_channel` 검사 교체(지금은 `'general'`이나 uuid만 받아 멤버 칸의 읽음 표시가 실패한다, `0082:119-121`), `brand_room_notices_kind`·`_general` 교체와 알림 행의 채널 열, 표 `brand_room_thread_reads`·`brand_room_pending_mentions`.
- glue: 새 표 둘은 대화 표와 같은 자세(RLS 강제, 정책 없음, `service_role`만, `0156`과 같다).
- 스위치 `BRAND_SEND`(기본 off). 되돌리기: 스위치를 끄면 멤버 칸에 쓰는 길이 닫힌다. 검사를 원래대로 돌리려면 멤버 칸의 글을 먼저 지우거나 옮겨야 한다.

### 8.7 외부 공유 링크와 검수 페이지

- 없애지 않는다. `/s/<token>`, `brand_room_shares`, `/brand/studio/review`는 야기 팀 프로젝트의 시안 검수에 그대로 쓴다.
- 직접 만든 파일에서는 기본 행동이 아니다. 뷰어의 `더보기`에 "외부 링크 만들기"로 남는다(owner·editor, 지금 권한 그대로).
- `share-review-dialog.tsx`는 그 길에서 계속 쓴다(겹침 버그는 PR #369에서 고쳐졌다). 이 설계는 그 파일을 바꾸지 않는다.
- 보내기가 열리면 share-bridge는 "스튜디오 공유 · 검수함"을 새로 만들지 않는다. 야기 팀에 보여 주려면 야기 팀 프로젝트를 고르게 한다.

## 9. Slack 1단계 (설계만)

한 방향: TWINGS → 고객의 Slack. Slack에서 단 답글은 돌아오지 않는다.

### 9.1 연결

1. 설정 → 연결 → "Slack 연결"(owner만).
2. Slack OAuth v2 동의 화면 → `/api/brand-integrations/slack/callback`. `state`는 서명한 값으로 조직·사용자에 묶고 10분 뒤 만료.
3. 봇 토큰을 암호화해 저장하고 기본 채널을 고르게 한다(미분류와 채널을 정하지 않은 프로젝트용, 비워 둘 수 있다).
4. 프로젝트 페이지 `더보기` → "Slack 채널 연결"(owner·editor): 채널 목록에서 하나 고른다. 비공개 채널은 봇을 초대해야 목록에 나온다.

요청할 권한(구현할 때 Slack 문서로 다시 확인한다, §11-3): `chat:write`, `chat:write.public`, `channels:read`, `groups:read`, `users:read`, `users:read.email`, `files:write`.

### 9.2 보내는 것

- 보내기의 뿌리 글 하나 = Slack 메시지 하나. 답글은 1단계에서 보내지 않는다.
- 모양: 첫 줄 "보낸 사람 → @받는 사람 · 프로젝트 이름", 글 첫머리(300자까지), 썸네일, "TWINGS에서 열기" 버튼(알림함의 그 대화로 가는 주소).
- 멘션: 멤버의 메일로 Slack 사용자를 찾아(`users.lookupByEmail`) 실제 멘션으로 바꾼다. 못 찾으면 이름을 글자로만 쓴다. 찾은 결과는 하루 기억한다.
- 썸네일: 우리 미디어는 비공개라 주소를 그대로 줄 수 없다. 긴 변 1280px 이하 축소본을 Slack에 파일로 올린다. 원본은 보내지 않는다. 그래서 축소본과 글 일부가 고객의 Slack에 저장된다(대표 확인이 필요한 안내 문구, §11-1의 5).
- 영상은 정지 프레임 한 장, 사운드는 글만.

### 9.3 저장, 실패, 환경변수

```text
brand_integrations        (organization_id, provider 'slack', team_id, team_name, bot_user_id,
                           token_enc, scopes, default_channel_id, status 'active'|'broken'|'removed',
                           installed_by, installed_at, last_error)
brand_project_channels    (organization_id, project_id, provider, channel_id, channel_name, set_by)
brand_integration_deliveries (message_id, provider, state 'pending'|'sent'|'failed'|'skipped',
                           attempts, last_error, slack_ts, created_at)   -- message_id당 한 번
```

- 토큰은 앱에서 AES-256-GCM으로 암호화해 넣는다(키는 환경변수). `lib/creator-subscriptions/crypto.ts`에 같은 종류의 도우미가 있다(그대로 쓸 수 있는지는 확인하지 못했다). 화면·로그·응답에 토큰을 내지 않는다.
- 보내기는 앱 안에서 먼저 끝난다. Slack 전송은 대기열에 넣고 응답 뒤에 한 번, 그리고 10분 cron이 다시 돈다(알림 대기열과 같은 방식). Slack이 실패해도 보내기는 실패하지 않는다.
- 다시 시도: 일시 오류와 속도 제한은 3번까지. 채널 없음·보관됨·봇이 채널에 없음·토큰 취소는 다시 시도하지 않고 연결을 `broken`으로 표시한다. 프로젝트 페이지와 설정에 조용한 한 줄로 알린다.
- 환경변수(값은 Vercel에만): `BRAND_SLACK_CLIENT_ID`, `BRAND_SLACK_CLIENT_SECRET`, `BRAND_SLACK_SIGNING_SECRET`, `BRAND_INTEGRATION_KEY`, 스위치 `BRAND_SLACK_CONNECT`. 지금 있는 야기 팀 알림용 `SLACK_BRAND_CONCIERGE_*`·`SLACK_TEAM_NOTICE_WEBHOOK_URL`과 이름이 겹치지 않는다.
- 닫힌 조직에는 연결 화면이 없다(404).

### 9.4 대표가 직접 해야 하는 것

- Slack 앱 만들기(이름, 아이콘, 리디렉트 주소, 위 권한), 다른 워크스페이스에 설치할 수 있게 배포 설정 켜기.
- 클라이언트 id·시크릿·서명 시크릿을 Vercel 환경변수에 넣기.
- 고객에게 보일 안내 문구와 개인정보처리방침·약관의 한 줄(제3자 서비스로 전달되는 항목: 보낸 사람 이름, 받는 사람 이름, 프로젝트 이름, 글 일부, 축소 이미지) 승인.

## 10. 조각

| # | 조각 | 스위치 | 마이그레이션 | 끝나면 대표가 보는 것 | 크기 | 먼저 필요한 것 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 프로젝트 합치기 + 스튜디오의 프로젝트 칩 | `BRAND_PROJECT_SPINE` | 0194 · 0195 | 네 스튜디오 머리말에서 프로젝트를 고르고, 만든 것이 그 프로젝트에 들어간다. 프로젝트 페이지의 파일 탭 | 큼 | — |
| 2 | 에셋 다시 묶기 + 옮기기 + 사운드 | 같은 스위치 | 없음 | 에셋이 프로젝트별·브랜드 자료·미분류로 보이고, 여러 개를 골라 옮긴다 | 중간 | 1 |
| 3a | 홈의 프로젝트 카드 | 같은 스위치 | 없음 | 홈 본문이 프로젝트 카드 | 중간 | 1 |
| 3b | 소식 칸 + 관리자 화면 | `BRAND_NEWS` | 있음 | 관리자에서 소식을 올리면 홈에 뜬다 | 작음 | — (따로 갈 수 있다) |
| 4 | 보내기 + 알림함 + 초대하고 보내기 | `BRAND_SEND` | 있음 | 이미지에서 @로 보내고 알림함에서 답글 | 큼 | 1 |
| 5 | Slack 1단계 | `BRAND_SLACK_CONNECT` | 있음 | 프로젝트에 채널을 연결하면 보내기가 Slack에 뜬다 | 중간 | 4, 대표의 Slack 앱 |
| 6 | 야기 팀에 맡기기, 편집본 서버 저장, 폴더를 프로젝트로, 기존 `project_id` 정리 | 조각별 | 정리 때만 | 직접 만든 프로젝트를 의뢰로 바꾸고, 편집본이 프로젝트에 보인다 | 중간 | 1, 편집 스튜디오 작업 |

- 조각마다: 실패하는 테스트 → 구현 → AGENTS.md §3 검증 루프 → 프리뷰. 화면이 바뀌는 조각은 1440·1920 전후 캡처를 대표에게 먼저 보인다.
- 켜는 순서: 로컬 → 프리뷰 → 운영의 시험 조직(조직 allow-list) → 전체. 닫힌 조직은 스위치와 무관하게 지금처럼 404다(각 조각의 테스트에 넣는다).
- 조각 1에 §3.4의 필터와 테스트가 들어간다. 이것 없이 `origin='self'` 행을 만들지 않는다.

## 11. 대표 결정과 확인하지 못한 것

### 11-1. 대표 결정 (추천 포함)

1. **홈 소식 칸의 모양.** 추천: 사진이 있는 배너(시안 a). 사진이 준비되지 않은 소식은 같은 자리에 한 줄로 뜬다(시안 a′).
2. **레일에 "프로젝트"·"알림함" 두 줄.** 추천: 더한다. 프로젝트 페이지가 레일에서 갈 곳이 생기고, 받은 공유를 직접 만들기 모드에서도 바로 본다. 레일이 두 줄 길어진다.
3. **초대 권한.** 추천: editor도 보내기에서 viewer로 초대할 수 있게. 지금은 owner만이라 대부분의 사람에게 "초대하고 보내기"가 막힌다.
4. **이름.** 미분류 · 편집본 · 브랜드 자료 · 보내기 · 알림함(§13의 후보에서).
5. **Slack 안내 문구와 약관 한 줄**(§9.4), 그리고 Slack 앱 만들기.
6. **기존 영상 프로젝트.** 추천: 자동으로 프로젝트를 만들지 않고 미분류의 편집본으로 둔다.

### 11-2. 방향과 코드가 어긋난 곳

- "그 프로젝트의 지금 대화 채널에 카드로"는 그대로 하면 내부 의견이 야기 팀과 프로젝트 손님에게 보인다. 멤버 칸을 둔다(§8.2).
- 지금의 "검수 · 공유"는 채팅에 올릴 때 야기 팀 Slack으로 알린다(`share-bridge/route.ts:124-133,506`). 대표는 팀 내부 공유로 읽고 있었다.
- V6 문서의 결정(프로젝트 = 영상 프로젝트)은 이 문서로 바뀐다. `BRAND_STUDIO_PROJECTS`의 이미지 프로젝트 바는 켜지 않고 이 설계로 대신한다.
- 영상 스튜디오의 `?project=`는 편집본 id다. 프로젝트 id와 겹치지 않게 `?film=`으로 옮긴다.
- 워크스페이스 초대는 owner만 한다.
- 사운드는 `brand_studio_jobs`에 있어 프로젝트 열을 같이 쓸 수 있다. 다만 넣는 코드와 읽는 코드가 둘 다 없다.
- `/brand/rooms*`와 `/brand/projects*`는 레일을 야기 팀과 모드로 바꾼다. 프로젝트 페이지와 알림함은 모드를 바꾸지 않는 주소가 필요하다(§7, §8.1).
- `brand_projects`는 서버 역할도 정해진 열만 고칠 수 있다. 이름 바꾸기와 "야기 팀에 맡기기"에는 권한 추가가 필요하다(§3.6).

### 11-3. 확인하지 못한 것

- 운영에서 `BRAND_STUDIO_PROJECTS`가 켜진 적이 있는지, `brand_studio_jobs.project_id`에 값이 있는 행이 있는지(운영 DB와 Vercel 환경변수를 보지 않았다).
- 운영의 `brand_studio_video_projects`와 "스튜디오 공유 · 검수함" 행 수.
- 편집 스튜디오 v2의 영상 데이터가 `ComposerProject` 그대로인지(같은 localStorage 키를 쓴다는 것까지만 확인).
- `lib/creator-subscriptions/crypto.ts`를 연동 토큰에 그대로 쓸 수 있는지.
- Slack API의 권한 이름·파일 올리기 방식·배포 조건은 기억에 따른 것이다. 구현할 때 Slack 공식 문서로 다시 확인한다.
- viewer 역할이 지금 프로젝트 대화에 글을 쓸 수 있는지(보내기의 권한을 거기에 맞춘다).
- 프로젝트 카드 조회의 속도(프로젝트·실행이 많은 조직에서). 색인은 §3.6의 것으로 시작하고 조각 3a에서 잰다.
- 형식 검증(AGENTS.md §11): 이 설계는 결제·크레딧 상태를 바꾸지 않아 대상이 아니다. 실행하지 않았다.

### 11-4. 사실 검토

작성자와 다른 검토 에이전트가 이 문서의 코드 사실을 코드와 대조했다(2026-11-25, 한 차례). 고친 것: 멤버 칸이 새는 조회(§8.2 표), `brand_projects`의 열 권한(§3.6), 직접 만든 프로젝트를 `client_visible=false`로 두는 첫째 겹(§3.4), 읽음 표의 채널 검사와 알림의 채널(§8.2, §8.6), 레일 모드를 바꾸는 경로(§7, §8.1), 검사 이름(§3.6), 조회 이름과 보관 시각(§3.4), 프로젝트 넣는 함수(§4.5). 검토가 확인하지 못했다고 밝힌 것: viewer의 글쓰기 권한, 홈 블록의 순서(표시 속성 너머), 시안 스크린샷.

## 12. 시안 화면

정적인 그림이다. 실제 화면의 레일·입력창·에셋 머리말·알림함 틀은 로컬에서 띄운 `origin/main`의 마크업과 스타일을 그대로 가져왔고(`prototype/spine-app.css`), 새로 생기는 부분만 워크스페이스 토큰으로 그렸다(`prototype/spine-proto.css`). 앱 코드는 한 줄도 바뀌지 않았고, 고객이 닿을 수 있는 주소도 없다.

| 화면 | 파일(1440 / 1920) | 실제 | 그림(만들어야 함) |
| --- | --- | --- | --- |
| a. 홈 | `home-1440.webp` / `home-1920.webp` | 레일, 입력창, 줄의 모양 | 소식 칸, 받은 공유 줄, 프로젝트 카드, 미분류 줄, 레일의 두 줄, 저장 위치 칩 |
| a′. 홈(소식 한 줄형) | `home-line-1440.webp` / `-1920` | 같음 | 같음 |
| b. 홈(프로젝트 없음) | `home-empty-1440.webp` / `-1920` | 최근 작업물 벽의 모양 | 안내 줄, 새 프로젝트 |
| c. 프로젝트 | `project-1440.webp` / `-1920` | 탭·버튼의 모양 | 페이지 전체 |
| d. 에셋 | `assets-1440.webp` / `-1920` | 머리말, 필터, 타일 | 탭 구성, 브랜드 자료, 사운드 타일, 미분류 묶음 |
| e. 보내기 | `viewer-send-1440.webp` / `-1920` | — | 뷰어의 보내기 전체 |
| e′. 초대하고 보내기 | `viewer-invite-1440.webp` / `-1920` | — | 같음 |
| e-2. 대화에 올라간 카드 | `project-talk-1440.webp` / `-1920` | 입력칸 | 멤버 칸, 파일 카드, 답글 |
| f. 알림함 | `inbox-1440.webp` / `-1920` | 알림함의 틀, 입력칸 | 받은 공유 줄(썸네일·보낸 사람·프로젝트), 오른쪽 대화 |
| g. 프로젝트 고르기 | `studio-picker-1440.webp` / `-1920` | 스튜디오 머리말, 입력창 | 프로젝트 칩과 목록 |

눌러 볼 수 있는 판: `docs/qa/brand-project-spine/prototype/home.html`(저장소를 내려받아 브라우저로 연다. 화면끼리 링크로 이어진다). 다시 만드는 법은 `prototype/_build/README.md`.

고른 기법(TOOLBOX §1-2) 네 가지: 사진이 곧 카드, 가는 선으로 나눈 줄, 숫자는 tabular, 떠 있는 메뉴에만 유리. 채운 버튼은 화면마다 하나다.

## 13. 문구 후보 (대표 확인 대기)

시안에 쓴 새 문구다. 로컬 Gemma(`yagi-crm-gemma4:31b-q8_0`) 2패스를 2026-11-25에 실행했다: ① 규칙 없이 맥락 전체를 주고 항목별 문구, ② `docs/wording/ai-tell-quick-rules.md`를 system prompt로 넣고 같은 구조·사실로 윤문. 그 뒤 사실을 직접 대조했다. 전부 **대표 확인 대기**이고, 가격·기간·권한을 문구로 바꾼 것은 없다.

| 쓰이는 곳 | 채택 | 다른 안 | en |
| --- | --- | --- | --- |
| 프로젝트 없이 만든 파일이 모이는 곳 | 미분류 | 분류되지 않음 | Unfiled |
| 홈의 미분류 줄 | 프로젝트 없이 만든 파일 14개 | 미분류 파일이 14개 있습니다 | 14 files created without a project |
| 미분류를 프로젝트에 넣기 | 프로젝트로 옮기기 | 프로젝트 지정하기 | Move to project |
| 새 결과가 저장되는 곳의 라벨 | 저장 위치 | 저장할 프로젝트 | Save to |
| 목록의 '새 프로젝트' 설명 | 이름만 정하면 바로 시작합니다 | 새 프로젝트를 생성합니다 | Start immediately by naming it |
| 목록 아래 안내 | 새 결과가 선택한 프로젝트에 저장됩니다. 다른 스튜디오로 옮겨도 유지됩니다. | 선택한 프로젝트에 저장되며 스튜디오를 이동해도 유지됩니다. | Results will be saved to the selected project. This persists across studios. |
| 홈 카드 묶음 제목 | 진행 중인 프로젝트 | 최근 프로젝트 | Ongoing projects |
| 모든 프로젝트로 | 전체 프로젝트 | 모든 프로젝트 보기 | All projects |
| 프로젝트 만들기 | 새 프로젝트 만들기 | 프로젝트 생성하기 | Create new project |
| 프로젝트가 없을 때 홈 한 줄 | 프로젝트로 묶으면 파일과 팀 대화를 한곳에서 볼 수 있습니다. | 프로젝트를 만들면 파일과 대화를 한데 모아 관리할 수 있습니다. | Grouping by project lets you see files and team chats in one place. |
| 홈의 줄 묶음 라벨 | 확인할 것 | 검토 필요 | To check |
| 받은 공유 한 줄 | (이름) 님이 이미지를 보냈습니다 | (이름) 님이 파일을 공유했습니다 | (name) sent an image |
| 카드의 안 읽은 수 | 새 메시지 2 | 읽지 않은 대화 2 | 2 new messages |
| 프로젝트 페이지 주 버튼 | 이어서 만들기 | 작업 계속하기 | Continue creating |
| 야기 팀에 넘기기 | 야기 팀에 맡기기 | 제작 요청하기 | Assign to Yagi team |
| 이어 붙인 영상 탭 | 편집본 | 영상 편집본 | Edits |
| 멤버 칸 위 한 줄 | 이 대화는 워크스페이스 멤버만 봅니다. | 멤버들끼리만 확인 가능한 대화입니다. | Only workspace members can see this chat. |
| 파일을 팀원에게 | 보내기 | 공유하기 | Send |
| 보내기 제목 아래 | 받는 사람의 알림함과 프로젝트 대화에 올라갑니다. | 상대방의 알림함과 프로젝트 대화창에 기록됩니다. | It will be added to the recipient's inbox and project chat. |
| 보내기 입력칸 도움말 | @로 받는 사람을 고릅니다 | @를 입력해 멤버를 선택하세요 | Select recipient with @ |
| 대화 입력칸 빈칸 | 메시지 남기기. @로 멤버를 부릅니다 | 내용을 입력하세요. @로 멤버를 멘션할 수 있습니다. | Leave a message. Mention members with @ |
| 멤버가 아닌 메일 묶음 | 멤버가 아닌 주소 | 외부 이메일 주소 | Non-member address |
| 그 줄의 설명 | 초대장을 보내고 수락하면 이 메시지가 전달됩니다 | 초대 수락 후 메시지를 확인할 수 있습니다. | An invite will be sent, and the message delivered upon acceptance. |
| 그 줄의 버튼 | 초대하고 보내기 | 초대장 발송하기 | Invite and send |
| 대화 카드에서 파일로 | 파일 열기 | 파일 확인하기 | Open file |
| 답글 빈칸 | 답글 남기기 | 답장을 입력하세요 | Write a reply |
| 알림함에서 연 공유의 한 줄 | (이름) 님이 보낸 파일입니다. 멤버만 볼 수 있는 대화입니다. | (이름) 님이 파일을 공유했습니다. 멤버 전용 대화입니다. | File sent by (name). This is a members-only chat. |
| 모든 프로젝트에서 쓰는 자료 | 브랜드 자료 | 공통 에셋 | Brand materials |
| 그 묶음의 설명 | 모든 프로젝트에서 함께 씁니다 | 어느 프로젝트에서나 사용할 수 있습니다 | Used across all projects |
| 에셋 탭 | 프로젝트별 / 모든 파일 | 프로젝트 단위로 보기 / 전체 파일 보기 | By project / All files |
| 소식 칸 머리표·버튼 기본값 | 새 소식 / 자세히 보기 | 공지사항 / 더 알아보기 | What's new / View more |
| 함께 옮겨지는 안내 | 한 번에 만든 4장이 함께 옮겨집니다. | 생성된 파일 4개를 함께 이동합니다. | 4 files created together will be moved. |
| 레일의 줄 이름 | 알림함 | 받은 공유 | Inbox |

**Gemma 안을 쓰지 않은 것 (사실 대조)**

- 목록의 '미분류' 설명: Gemma는 "프로젝트 없이 저장한 파일입니다"라고 썼다. 이 줄은 파일 설명이 아니라 고르는 항목이다(고르면 새 결과가 프로젝트 없이 저장된다). 초안 "프로젝트 없이 저장"을 유지했다.
- 목록 아래 안내: Gemma 안 "선택한 프로젝트에 결과가 저장됩니다"는 이미 만든 결과도 옮겨지는 것처럼 읽힌다. "새 결과가"로 고쳤다.

**Gemma에 보내지 않은 문구 (내 초안, 미실행)**

- 멤버 칸 이름 "우리 팀", 프로젝트 파일 줄 "올린 자료", 목록 검색 빈칸 "프로젝트 찾기".
- 카드의 활동 한 줄("(이름) 님이 영상을 추가했습니다" 꼴), 편집본 상태("편집 중 · 어제 저장", "내보냄 · 11월 22일").
- §8.5의 "워크스페이스 관리자만 초대할 수 있어요", "초대가 만료됐어요", §4.1의 보관된 프로젝트 안내.

구현 조각에서 이 문구들과 영어를 `messages/*.ts` 사전에 넣기 전에 다시 2패스를 돌리고 대표에게 보인다. 소식 칸의 문장은 소식마다 대표가 쓴다.
