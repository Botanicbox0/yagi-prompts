# 프로젝트 룸 소통 1단계 — 고객 알림, 팀 작업대, 팀 메모 (2026-11-18)

> 대표 지시(2026-11-17): "야기 팀과" 쪽이 frame.io 수준으로 소통하기 어렵다. 참고 프로젝트는 freeframe(구조만 참고, 코드는 가져오지 않는다).
> 이 문서는 네 단계 가운데 1단계의 설계다. 기준 코드는 main `fb936804`.
> 관련 문서: `docs/BRAND-ROOMS.md`(룸 원본), `docs/BRAND-CLIENT-WORK.md` §4(E 항목이 이 문서로 구체화된다).

## 1. 왜 1단계가 이것인가

의견을 남기는 기능(구간 의견, 그리기, 버전 비교, 승인, 공유 링크)은 이미 있다. 소통이 끊기는 곳은 그 앞뒤다.

| 끊기는 곳 | 지금 (코드 확인) |
| --- | --- |
| 고객이 새 소식을 아는 길 | 사이트에 들어와 있을 때 배지뿐. 룸·리뷰 코드 어디에서도 메일·푸시를 보내지 않는다 |
| 팀이 고객 반응을 아는 길 | Slack. 다만 외부인(공유 링크) 의견, 스토리보드 승인·수정 요청은 Slack에도 가지 않는다 |
| 팀의 "대기" 목록 | 대화 글만 센다. 시안 의견, 승인, 수정 요청은 세지 않는다 (`messages.ts:1302-1308`) |
| 팀이 일하는 화면 | 대화 / 시안 올리기 / 의견 답글이 세 화면. 의견 화면은 새로고침해야 새 글이 보인다 |
| 팀끼리만 볼 메모 | 없다. 시안에 남기는 글은 전부 고객에게 보인다 |

1단계는 이 다섯 가지만 고친다. 전체 화면 리뷰·실시간 갱신(2단계), 의견 수정·멘션·프로젝트 단위 공유 링크·외부인 메일(3단계), 영상 변환(4단계)은 넣지 않는다.

## 2. 고객 알림

### 2.1 어떤 일에 무엇을 보내나 (제안값, 대표 확정 필요 — §8-1)

| 일어난 일 | 메일 | 푸시 |
| --- | --- | --- |
| 야기 팀이 새 시안·새 버전을 올림 | 바로 | 바로 |
| 야기 팀이 스토리보드를 공유·새 버전 | 바로 | 바로 |
| 야기 팀의 대화 메시지 | 10분 뒤에도 읽지 않았으면, 묶어서 한 통 | 바로 |
| 야기 팀이 내 의견에 답글 | 위와 같음 | 바로 |
| 대화에서 나를 부름 (같은 조직 동료 포함) | 바로 | 바로 |
| 새 의뢰 접수 | 바로 (의뢰를 낸 사람에게만) | 없음 |
| 동료의 일반 대화·의견, 팀의 상태 변경 | 없음 (앱 안 배지 그대로) | 없음 |

- **일반 대화**: 프로젝트에 속하지 않는 조직의 일반 대화("일반 문의")에 야기 팀이 답해도 같은 규칙으로 알린다. 이때 받는 사람은 룸을 열 수 있는 조직 구성원 전체이고, 버튼은 알림함으로 간다.
- **받는 사람**: 그 프로젝트 룸을 볼 수 있는 조직 구성원에서 그 일을 한 본인을 뺀 사람. 룸이 닫힌 조직(모픽·샌드박스)은 사건 자체가 생기지 않으므로 대상이 아니다.
- **읽었으면 보내지 않는다**: 묶음 메일은 보낼 시점에 `brand_room_reads`가 그 글보다 뒤면 건너뛴다(사유 `read`).
- **상한**: 묶음 메일은 받는 사람 × 프로젝트마다 30분에 한 통. "바로" 메일은 같은 발송 회차에 여러 건이면 한 통으로 합친다.
- **메일 내용**: 프로젝트 이름, 무슨 일인지 한두 문장, 야기 팀 글의 앞 120자(묶음일 때 최대 5줄), 버튼 하나(프로젝트로 이동). 내부 도구 이름, 가격, 기한 약속은 넣지 않는다. 답장은 전달되지 않으므로 답장을 권하지 않는다.
- **문안**: 외부 발송 문안이라 대표 확정 전에는 보내지 않는다. 초안은 §9.

### 2.2 구조

모든 룸 사건은 `postRoomEvent`(`lib/brand-rooms/events.ts:54`) 한 곳을 거치고, 대화는 `message.send`·`staffSendMessage`(`lib/brand-rooms/messages.ts`)를 거친다. 알림은 이 세 곳에서만 쌓는다.

```
사건 기록 ──> enqueueNotices()  ──> brand_room_notices (대기)
                                        │
            after()로 즉시 1회 ─────────┤
            10분 cron (tick) ───────────┴─> runRoomNoticePass() ─> 메일(기존 getMailer) · 푸시(기존 sendPushToUser)
```

- **새 파일** `lib/brand-rooms/notices.ts`: 규칙표(§2.1을 값으로), `enqueueNotices`, `runRoomNoticePass`, 메일 본문 조립(기존 `lib/notify/sheet.ts`의 `sheet()`·`sheetText()` 사용).
- **쌓기는 최선 노력**: `postRoomEvent`와 같은 방식으로 savepoint 안에서 실행하고, 실패해도 원래 쓰기를 실패시키지 않는다.
- **보내기**: `runRoomNoticePass`는 한 번에 대기 행을 잠그고(`for update skip locked`) 받는 사람 × 프로젝트로 묶어 보낸다. 메일의 `idempotencyKey`는 묶음 id. 실패는 3회까지 다시 시도하고 그 뒤 `failed`.
- **cron**: `/api/brand-rooms/notices/tick`, 10분 간격, 기존 tick과 같은 `CRON_SECRET` 확인. `vercel.json`에 한 줄 추가. 플래그가 꺼져 있으면 아무것도 하지 않고 끝난다.
- **플래그**: `BRAND_ROOM_NOTIFY`(기본 off). 꺼져 있으면 쌓지도 보내지도 않는다. 켜는 것은 대표 승인 뒤.
- **푸시**: 브랜드 화면에는 서비스 워커가 등록돼 있지 않다(`RegisterServiceWorker`는 `(app)`·`(marketing)` 레이아웃에만 있다). `(brand)` 레이아웃에 등록하고, 알림함(`/brand/rooms`)에 "휴대폰 알림 받기"를 둔다. 구독 API(`/api/notify/push`)는 이미 로그인한 누구나 쓸 수 있다. 푸시 주소는 같은 출처 경로(`/brand/rooms/{projectId}`), `tag`는 프로젝트 id(같은 프로젝트 알림이 쌓이지 않고 바뀐다).
- **수신 설정**: 알림함 위쪽에 "메일로 받기" 켬/끔(조직별). 메일 맨 아래 링크는 서명 토큰(기존 `NOTIFY_TOKEN_SECRET` 방식에 새 범위 추가)으로 로그인 없이 그 조직의 룸 메일을 끈다. `List-Unsubscribe` 헤더는 기존 메일러가 붙인다.

### 2.3 테이블 (core + glue 한 쌍)

```sql
-- 받는 사람별 수신 설정. 행이 없으면 메일을 받는다.
create table brand_room_notice_prefs (
  user_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

-- 보낼 알림. 한 사람에게 같은 글로 두 번 쌓이지 않는다.
create table brand_room_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  project_id uuid,                       -- 일반 대화는 null
  recipient_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('new_version','storyboard','team_message','team_reply','mention','intake_received')),
  message_id uuid,                       -- brand_room_messages.id (의뢰 접수는 null)
  timing text not null check (timing in ('now','bundle')),
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','sent','skipped','failed')),
  skip_reason text,                      -- read | muted | no_mailer | cap
  batch_id uuid,
  attempts int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, message_id, kind)
);
create index on brand_room_notices (state, due_at) where state = 'pending';
```

구현(0094·0167)에서 위 초안과 달라진 것. 원본은 마이그레이션 파일이다.

- `project_id`는 null을 허용한다(조직의 일반 대화). 묶는 단위는 받는 사람 × 장소(조직 + 프로젝트 또는 일반 대화)다.
- 열 추가: `lease_until`(보내는 중 잠금 10분), `push_state`·`pushed_at`(푸시는 메일보다 먼저, 한 번만).
- 건너뛴 사유 추가: `no_access`(그사이 구성원에서 빠짐), `no_email`, `deleted`(원래 글이 지워짐), `rule`. 30분 상한에 걸린 행은 건너뛰지 않고 `due_at`만 뒤로 민다.
- ~~"바로" 메일이 나갈 때 같은 사람·장소의 기한이 된 묶음 글도 함께 싣는다.~~ N4에서 없앴다(§10.1: 메일 한 통은 알림 한 종류).
- 버튼 주소: 프로젝트는 `/brand/rooms/{projectId}?organizationId=…`, 일반 대화는 `/brand/rooms?organizationId=…&channel=general`. 여러 브랜드에 속한 사람이 다른 브랜드로 열리지 않게 조직을 붙인다.
- 수신 거부 주소는 twings.app 쪽에 있다(브랜드 호스트는 `/api/notify/unsubscribe`를 막는다). 메일 앱의 원클릭 수신 거부(POST)도 받는다. 이전에는 GET만 받아서, 메일에 붙어 나가던 원클릭 헤더가 동작하지 않았다.
- ~~사전(`messages/rooms-notices.ts`)의 문구는 임시 문구다.~~ N4에서 §10 확정본으로 바꿨다(종류별 제목·첫 줄·본문·버튼·푸시).

확인(2026-11-18, 로컬 두 역할, 가짜 메일러): 플래그가 꺼져 있으면 0행이고 tick은 `ran:false`. 켜면 새 시안 메일은 응답 직후 나가고(행이 `sent`), 팀 대화는 10분 뒤로 잡힌다. 고객이 대화를 읽으면 `skipped/read`, 읽지 않은 일반 대화는 묶음 메일 한 통. 수신 거부는 GET·POST 모두 설정을 끄고, 그 뒤 글은 `skipped/muted`. tick은 bearer가 틀리면 401, `CRON_SECRET`이 없으면 503. 푸시 발송과 실제 메일 헤더, 30분 상한·재시도·멘션·스토리보드·답글·의뢰 접수 메일은 단위 테스트로만 확인했다.

RLS는 다른 룸 테이블과 같다: 켜고 강제, `service_role`만. 번호는 PR을 여는 시점의 main에서 다시 확인한다(지금 main 최고 번호는 core 0091·glue 0165, 열린 PR #244가 core 0092를 쓰고 있다).

### 2.4 약관·처리방침과의 관계 (판단은 대표)

- 개인정보처리방침은 이용 목적에 "완성 알림 등 서비스 이용에 필요한 이메일 발송"을 두고 있고(`lib/legal/documents.ts:412`), 메일 처리 위탁사로 Resend를 적고 있다(`:444`). 프로젝트 진행 알림은 광고가 아닌 서비스 이용 메일이라 이 문장 안에 든다고 읽었다. 이 해석이 맞는지는 대표 확인이 필요하다(§8-5).
- 푸시는 문서에 언급이 없다. 기존 렌더 완료 푸시와 같은 방식(브라우저 권한 요청 뒤 구독)이다.
- 약관·처리방침 문구는 이 작업에서 바꾸지 않는다.

## 3. 팀이 놓치지 않게

마이그레이션 없이 고친다.

- **Slack에 추가**: 외부인 의견(`shares.ts`의 `guestComment`), 고객의 스토리보드 승인·수정 요청(`storyboards.ts`의 `board.status`). 지금은 둘 다 Slack에 가지 않는다.
- **"대기" 세는 법**: 마지막으로 팀이 본 시점 뒤의
  - 고객이 쓴 대화 글(지금과 같음), 그리고
  - 사건 줄 가운데 `detail.actorRole = 'brand'`이고 종류가 `review_commented`, `review_changes_requested`, `review_approved`, `storyboard_approved`, `storyboard_changes_requested`인 것.
  - "마지막으로 본 시점"에는 팀이 낸 사건 줄(팀의 의견 답글, 새 버전)도 포함한다. 팀이 답하면 대기가 풀린다.
- **새 의뢰**: 의뢰 접수는 룸에 줄을 남기지 않는다(0082 제약). 작업대 목록에 "팀 글이 아직 없는 프로젝트"를 따로 "새 의뢰"로 올린다.
- **2026-11-18 대표 변경: "대기" = 아직 답하지 않은 고객 메시지**. 고객 쪽 줄(위 정의 그대로)은 같은 채널에 그보다 늦은 팀 줄(팀 대화·답글, 고객이 보는 팀 의견, 새 버전·스토리보드 공유 같은 팀 사건 줄. 팀 메모와 지운 팀 줄은 아님)이 생기거나, 팀원이 "확인함"을 누를 때까지 센다. 대화·서랍을 여는 것만으로는 줄지 않는다(관리자 읽음 표시 오퍼레이션 `brand_rooms.channel.read`를 없앴다). "확인함"은 작업대 머리말(목록·검토 모드 모두)과 조직 대화 화면에 있고, 기다리는 수가 있을 때만 눌린다. 누른 사람과 시각은 버튼 옆에 "확인함 · 이름 · 시각"으로 보인다. 저장은 새 마이그레이션 없이 그 팀원의 `brand_room_reads` 행(지금은 이 버튼만 쓴다)이다. 고객 화면·알림·Slack에는 아무것도 생기지 않는다.

## 4. 팀 작업대

`/admin/brand-rooms/[organizationId]/[projectId]` — 프로젝트 하나를 한 화면에서 처리한다. 관리자 화면이므로 기존 관리자 스타일을 따른다.

```
┌ 프로젝트 이름 · 조직 · 상태 · 대기 3 ─────────────────────────────┐
│ 대화 (왼쪽 40%)          │ [시안] [스토리보드] [공유 링크]          │
│ 기존 AdminRoomChannel     │ 버전 목록 + 올리기(DeliveryUpload)        │
│ 을 이 프로젝트 채널로     │ 버전을 고르면 그 자리에서 재생·의견 답글   │
│ 고정                      │ (기존 AdminReviewStage)                   │
└──────────────────────────┴───────────────────────────────────────────┘
```

- **목록**: `/admin/brand-rooms`는 프로젝트 행 목록이 된다. 대기 있는 프로젝트가 위, 그다음 최근 활동순. 행을 누르면 작업대.
- **의견 화면 자동 갱신**: `AdminReviewStage`가 15초마다 다시 읽는다(탭이 보일 때만, 글을 쓰는 동안은 멈춤). 대화는 기존 4초 그대로.
- **팀이 공유 링크 만들기**: 관리자 오퍼레이션 `brand_rooms.share.create`·`brand_rooms.share.revoke`를 추가한다(기존 `createShare`를 감싼다). `lib/admin/operations.ts`에 등록.
- **기존 화면**: 조직 단위 대화(`/admin/brand-rooms/[organizationId]`, general 채널)와 스토리보드·리뷰 목록은 그대로 두고 작업대에서 링크한다. 지우지 않는다.

구현(N3)에서 달라진 것·정한 것. 원본은 코드다(`lib/brand-rooms/messages.ts`의 `teamWaiting`, `staffRoomOverview`, `staffProjectDesk`).

- **대기**(2026-11-18에 "답하지 않은 것"으로 바뀜, §3 끝): 팀이 마지막으로 본 시점 = 관리자 읽음 표시, 팀 글(`author_role = 'studio'`), 팀이 낸 사건 줄(`detail.actorRole = 'studio'`) 가운데 가장 늦은 것. 그 뒤의 지워지지 않은 고객 글과, §3의 다섯 사건(`actorRole = 'brand'`)을 센다. 외부인 의견의 사건 줄은 `actorRole = 'brand'`(행위자 없음)이라 대기에 들어간다. 팀 메모는 줄이 없어 더하지도 풀지도 않는다.
- **새 의뢰**: 열린 조직의 고객 공개 프로젝트 중 팀 글도 팀 사건도 없는 것, 상태가 `requested`·`active`인 것만(끝난 프로젝트·취소는 뺀다). 고객이 이미 글을 남긴 새 의뢰는 새 의뢰 묶음에만 한 번 나온다.
- **목록**: 프로젝트 행은 작업대로 간다. 조직의 일반 문의 대화도 대기가 있으므로 행으로 남기고, 그 행은 기존 조직 대화 화면으로 간다.
- **Slack**: 외부인 의견은 보낸 사람 줄이 "이름 (공유 링크 외부인)"이고, 이름·본문은 Slack 마크업(`<!channel>` 등)이 동작하지 않게 바꿔 보낸다. 바로가기는 그 버전을 연 작업대. 스토리보드는 승인·수정 요청만 보낸다(다시 열기·같은 상태 반복은 보내지 않는다).
- **공유 링크**: 팀이 만든 링크는 `created_role = 'studio'`. 토큰은 `/admin/do`의 JSON 답(`shareToken`)에만 실리고 리다이렉트 주소에는 실리지 않는다. 작업대의 끄기는 그 프로젝트의 링크만, 열린 조직만 받는다. 작업대의 만들기·끄기는 JSON으로 보내 그 자리에서 목록을 다시 읽고, 스크립트 없이 보내도 자기 `_back`(공유 링크 탭)으로 돌아온다. 리뷰 화면의 기존 끄기(범위 없음)는 예전처럼 어떤 링크든 끄고 리뷰 화면으로 간다.
- **검토 모드**(브라우저 확인 뒤 바꿈): 버전을 고르면(`?review=`) 스테이지가 작업대 본문 전체 폭을 쓰고 페이지와 함께 스크롤된다. 대화는 머리말의 "대화" 버튼(대기 수 표시)으로 여는 왼쪽 서랍(420px, 노트 열의 반대쪽)이 되고, 닫혀도 화면에 남아(숨김) 쓰던 글·스크롤·폴링이 그대로다. 닫힌 서랍은 읽음 표시를 보내지 않아 버튼의 대기 수가 열 때까지 남고, 닫힌 동안 새 줄이 오면 페이지를 다시 읽어 그 수를 갱신한다. 열리면 옅은 막이 나머지 화면 전체(노트 열과 입력창 포함)를 덮고, 막을 누르거나 서랍 안·버튼에서 Esc를 누르거나 닫기 버튼으로 닫는다. 스테이지에서 누른 Esc는 스테이지의 것이다. 스테이지는 단독 리뷰 화면과 같은 틀(`.bsv-admin-frame`)에 들어가 제 색을 쓰고, 작업대에서는 자기 제목 블록과 따로 있는 상태 표시를 감춘다(버전 선택이 상태를 이미 보여 준다).
- **탭**: 클라이언트 이동이라 대화가 다시 그려지지 않는다. 고른 버전은 모든 탭 주소에 남아, 시안으로 돌아오거나 새로 고쳐도 다시 열린다.
- **외부인 의견 줄**: 대화에서 외부인 의견 사건 줄은 그 의견에 적힌 이름과 리뷰 화면의 "외부 손님" 표시로 나온다(이름이 없으면 표시만). 이전에는 "야기 팀"으로 보였다(브랜드 쪽 포함).
- **의견 화면 자동 갱신**: `AdminReviewStage`가 15초마다 다시 읽고, 탭으로 돌아오면 한 번 더 읽는다. 쓰는 글·답글, 펼친 펜, 보내지 않은 그림, 보내는 중이면 쉰다. 작업대와 `/admin/brand-studio/reviews/[id]` 둘 다.
- 확인: 단위 테스트와 서버 렌더 테스트. 이 저장소의 테스트에는 DOM이 없어 갱신 일시정지는 타이머 단위로 확인했다. 첫 구현은 로컬 브라우저로 확인했고(겹침·색 대비 문제를 찾아 위 검토 모드로 바꿈), 바꾼 뒤의 화면은 다시 열어 재야 한다.

## 5. 팀 메모 (고객에게 보이지 않는 의견)

시안의 특정 시각·위치에 팀끼리만 보는 글을 남긴다. freeframe의 Internal 의견과 같은 개념이고, 구현은 우리 코드로 새로 쓴다.

```sql
alter table brand_studio_review_comments
  add column visibility text not null default 'public' check (visibility in ('public','team')),
  add constraint brand_studio_review_comments_team_author
    check (visibility = 'public' or (author_role = 'studio' and guest_name is null));
```

규칙:

1. `team`은 야기 팀만 쓸 수 있다(위 제약 + 코드). 답글은 부모의 값을 물려받는다. 고객이 보는 의견 아래에 팀만 보는 답글을 달 수는 없다(`invalid`): 조용히 공개로 바뀌면 새는 것이고, 한 타래가 둘로 갈린다.
2. 팀 메모는 룸 사건 줄을 남기지 않는다. 따라서 대화의 점프 카드, 고객 안 읽음 수, Slack, 고객 알림 어디에도 나오지 않는다.
3. 읽는 곳은 전부 기본이 "빼고 읽기"다. 관리자 경로만 명시적으로 포함해 읽는다.
4. 새 버전으로 열린 의견을 넘길 때 팀 메모도 `team` 그대로 넘긴다.
5. 공개로 바꾸는 기능은 1단계에 없다(지우고 다시 쓴다).

막아야 하는 읽기 경로(조사에서 찾은 전부). 경로마다 "팀 메모가 나오지 않는다"는 테스트를 하나씩 둔다.

| # | 경로 | 처리 |
| --- | --- | --- |
| 1 | `commentsOf` → `loadReviewDetail`(스튜디오 리뷰), `loadRoomReviewDetail`(룸 파일 탭), `sharedReviewView`(공유 링크 `/s/[token]`) | 뺀다 |
| 2 | `commentsOf` → `staffReviewDetail`(관리자) | 포함, 화면에 "팀 메모" 표시 |
| 3 | 내보내기(CSV·Markdown·마커) | 화면이 가진 목록으로 만들므로 1번이 막으면 함께 막힌다. 관리자 내보내기에는 구분 열 추가 |
| 4 | 개수 `open_count`/`total_count`, 개요의 열린 의견 수, 알림함 알림 | 고객용 수에서 뺀다. 관리자 목록은 공개/팀 수를 따로 |
| 5 | 대화 점프 카드(`to_jsonb(c)`), 참조 확인 | 사건 줄이 없어 생기지 않는다. 그래도 조회 조건에 `visibility = 'public'`을 건다 |
| 6 | Slack 알림 본문 | 팀 메모는 보내지 않는다 |
| 7 | 쓰기 쪽 읽기(부모 확인, 해결, 내 글 지우기) | 고객·외부인은 팀 메모를 부모로 삼거나 해결·삭제할 수 없다(404) |

6. 팀 메모를 쓰거나 해결해도 리뷰의 "마지막 활동" 시각은 움직이지 않는다. 고객이 그 시각과 목록 순서를 보기 때문이다.
7. 0093이 적용되기 전에도 코드는 안전하다: 열이 없으면 읽기는 예전과 같고 팀 메모 쓰기는 거절된다(`teamNotesReady`).

관리자 화면: 의견 입력창에 "팀만 보기" 전환(보낸 뒤에도 켜진 채로 남는다. 꺼지면 다음 팀 메모가 공개로 나갈 수 있어서다), 팀 메모는 점선 테두리·옅은 빗금과 "팀 메모" 꼬리표. 관리자 문구는 `adminConsole.reviewTeam`에 두어 고객 페이지 데이터에 실리지 않는다. 고객 화면에는 이 낱말이 나오지 않는다.

확인(2026-11-18, 로컬 두 역할): 관리자 화면에서 공개 의견과 팀 메모를 하나씩 남기고, 고객의 룸 파일 탭·개요·스튜디오 리뷰·알림함과 공유 링크를 열었다. 팀 메모는 화면, HTML, API 응답(18개) 어디에도 없었고 열린 의견 수는 1이었다. 고객이 팀 메모에 답글·해결·삭제를 보내면 404였다.

## 6. 구현 조각과 순서

| 조각 | 범위 | 마이그레이션 | 겹치는 파일 |
| --- | --- | --- | --- |
| N1 팀 메모 | §5 전부 | 있음(열 1개) | `lib/brand-studio/review.ts`, `lib/brand-rooms/shares.ts`, 관리자 리뷰 화면 |
| N2 알림 기반 | §2.2·2.3: 테이블, 쌓기, 보내기, tick, 수신 거부. 플래그 off | 있음(표 2개) | `lib/brand-rooms/events.ts`, `messages.ts`(보내는 두 함수), 새 파일들, `vercel.json` |
| N3 팀 작업대 | §3·§4 | 없음 | `messages.ts`(대기 계산), 관리자 화면, `operations.ts` |
| N4 고객 설정 화면 | 알림함의 메일·푸시 설정, `(brand)` 서비스 워커 등록, 문안 사전 | 없음 | 알림함 컴포넌트, `(brand)` 레이아웃, `messages/rooms-*.ts` |

순서: N1과 N2를 함께 → N3 → N4. N1과 N2는 건드리는 파일이 다르다. N3는 N1의 "팀만 보기"를 화면에 쓰고 `messages.ts`를 N2 뒤에 고친다. N4의 문안은 대표 확정본으로 넣는다.

**N4 구현**(2026-11-18, 브랜치 `claude/rooms-notice-settings`, 마이그레이션 없음, 플래그 off면 운영 화면 그대로). 위 설계와 달라진 것:

- 메일·푸시는 §10.1 모양이다. "바로" 알림은 한 건이 한 통이고 묶음 id도 따로다. 묶음 메일은 받는 사람 × 장소마다 한 통, `{count}`는 실린 글 수, 인용 줄은 글 있는 것만 최대 5줄이다. 푸시도 "바로" 알림은 한 건씩, 팀 대화·답글은 그 회차 건수를 센 한 건이다. 같은 장소 푸시는 태그가 같아 마지막 것만 남으므로 오래된 것부터 보낸다.
- 설정은 알림함 목록 맨 아래 "알림 설정" 칸(`#notice-settings`)이다. 이메일은 `/api/brand-rooms/notice-prefs`(GET·POST)로 저장한다. 푸시는 `/api/notify/push`를 브랜드 호스트에 여는 대신 `/api/brand-rooms/notice-push`(POST·DELETE, 같은 저장 함수)를 새로 뒀다. 플래그가 꺼지면 404여야 하고, 좌석을 확인해 모픽·샌드박스를 404로 막아야 해서다. `/api/notify/push`는 브랜드 호스트에서 계속 닫혀 있다.
- 브라우저 쪽 구독 흐름은 개인 화면의 "완성되면 알려드릴까요?"와 같은 코드를 쓴다(`components/notify/push-client.ts`로 옮겼고, 개인 화면 동작은 그대로).
- 브랜드 호스트에서 `/sw.js`와 알림 아이콘 두 개(`/icons/icon-192.png`, `/icons/badge-96.png`)만 열었다(GET). `(brand)` 레이아웃은 알림이 켜져 있고 룸이 열린 사람에게만 서비스 워커를 등록한다.
- 푸시 구독은 브라우저 × 출처마다 하나다. twings.app 구독과 brand.twings.app 구독이 따로 있고 둘 다 그 사람의 모든 푸시를 받는다(`sendPushToUser`). 그래서 `public/sw.js`는 운영 호스트에서 브랜드 경로를 brand.twings.app에서, 그 밖의 경로를 twings.app에서 연다. 로컬·프리뷰는 그대로이고, twings.app에서 받은 렌더 푸시는 전과 같다.
- 수신 거부 뒤 페이지는 §10의 제목·문장과 링크 하나(그 브랜드 알림함의 설정 칸)만 둔다. 홈 링크는 뺐다. 다른 범위의 수신 거부 페이지는 바이트까지 그대로다.
- 브랜드 호스트는 설치형 앱이 아니어서 iPhone 사파리 탭에서는 "이 브라우저는 알림을 지원하지 않아요."가 보인다. 푸시 키가 없는 배포에서는 푸시 줄을 보이지 않는다. 멘션의 `{name}`은 그 사람의 이름 그대로다(야기 팀원도 "지수님이 불렀어요", 이름이 없는 팀원은 "야기 팀"). 멘션 아래 인용 줄은 §10.1 표기("야기 팀 · 이름")를 따른다.

확인(2026-11-18): `npx tsc --noEmit` 통과. `npx vitest run tests/brand-rooms tests/notify tests/i18n tests/routes tests/brands tests/db tests/account tests/pwa tests/design --maxWorkers=8` 194개 파일, 1,833개 테스트 통과. 리뷰 반영(영어 단수형, 멘션 이름) 뒤 `tsc` 통과, `npx vitest run tests/brand-rooms tests/notify tests/i18n tests/routes tests/pwa --maxWorkers=8` 102개 파일, 945개 테스트 통과. 확정 문안은 §10 표를 손으로 옮긴 문자열과 대조한다(`tests/brand-rooms/notices/wording.test.ts`, 문구 하나를 바꾸면 실패하는 것까지 확인).

리뷰의 브라우저 확인(전체 루프, 빌드, 스윕, 메일 8통 §10 대조, CSP 아래 서비스 워커 등록) 뒤 고친 것:

- 390px에서 떠 있는 문의 버튼이 푸시 스위치 모서리를 덮었다. 한 열이 되는 899px 이하에서 알림함 목록 끝에 버튼 자리(88px + 안전 영역, 워크스페이스 화면이 폰에서 버튼 아래 두는 여백과 같다)를 둔다. 버튼은 옮기거나 바꾸지 않았다.
- 알림이 켜져 있으면 알림함을 열 때마다 React key 경고가 났다. 서버 페이지가 만든 설정 요소를 클라이언트 목록에 넣으면 지연 참조로 도착해 정적 자식으로 표시되지 않기 때문이다. 페이지는 이제 데이터(문구, 메일 스위치 값, 공개 키)만 넘기고 알림함이 설정 칸을 직접 그린다.
- 서버가 구독 저장을 거절하면(2xx 아님) 브라우저 구독이 남아 새로고침 뒤 스위치가 켜져 보였다. 공용 흐름(`components/notify/push-client.ts`)이 그때 브라우저 구독도 되돌린다(최선 노력). 응답을 못 받은 경우는 그대로 두어 다음 방문 때 다시 보낸다. 개인 화면의 다른 동작은 그대로다.
- 수신 거부 뒤 페이지(룸 범위)의 제목과 문장에 `word-break: keep-all`(`overflow-wrap: anywhere`로 보완). 다른 범위 페이지는 바이트 그대로다.
- 서비스 워커는 로그인한 사람의 워크스페이스에서만 등록한다. 별도 레이아웃은 없고 `(brand)` 레이아웃의 로그인 분기(`scope`, 문의 버튼과 같은 조건)를 쓴다.

고친 뒤 `npx tsc --noEmit` 통과, `npx vitest run tests/brand-rooms tests/notify tests/i18n tests/routes tests/pwa tests/account --maxWorkers=8` 106개 파일, 1,014개 테스트 통과. 빌드·스윕과 고친 화면의 브라우저 확인은 다시 하지 않았다(§7).

각 조각의 완료 기준은 AGENTS.md §3 검증 루프 전부와, 로컬에서 두 역할(고객·팀)로 실제 화면 확인이다. 메일은 로컬 가짜 메일러(`PLAYBOOK_FAKE_MAILER=1`)로 보낸 내용을 확인한다. 형식 검증(§11)은 하지 않는다: 결제·렌더·크레딧·정산·동의 상태에 닿지 않는다.

## 7. 확인하지 못한 것

- 운영에서 `BRAND_ROOMS`와 Slack 알림이 켜져 있는지(값은 코드로 알 수 없다).
- N4 리뷰의 로컬 브라우저 확인(2026-11-18, 증거는 커밋하지 않는 `.bench-evidence/notice-settings/`): 서비스 워커는 워크스페이스 CSP(`script-src 'nonce-…' 'strict-dynamic'`, `worker-src` 없음)에서 위반 없이 등록됐다. 크롬 한 가지로만 봤고, 사파리·파이어폭스와 실제 푸시 서비스로 간 알림, brand.twings.app 운영 호스트는 아직이다. 그 확인에서 나온 다섯 가지는 고쳤고(§6 N4), 고친 뒤 화면은 다시 브라우저로 본다: 390px에서 문의 버튼과 푸시 스위치가 겹치지 않는지(700–899px 포함), 콘솔의 key 경고가 사라졌는지, 서버가 구독 저장을 거절하면 새로고침 뒤 스위치가 꺼져 있는지(개인 화면 포함), 수신 거부 뒤 페이지가 낱말 중간에서 줄바꿈하지 않는지, 로그아웃 상태의 `/brand/invite`에 서비스 워커가 등록되지 않는지.
- 운영 메일 발신 주소로 브랜드 고객에게 보낸 메일이 스팸함에 가지 않는지. 켜기 전에 대표 계정으로 한 통 보내 확인한다.
- 이 설계는 코드만 읽고 썼다. 운영 화면을 고객·팀으로 열어 보지 않았다.

## 8. 대표 결정 필요

1. **어떤 일에 메일을 보낼지**: §2.1 표가 제안값이다.
2. **메일·푸시 문안**: §9 초안.
3. **묶음 간격**: 읽지 않은 지 10분 뒤 발송, 프로젝트당 30분에 한 통.
4. **접수 확인 메일의 약속 문장**: "영업일 N일 안에 답합니다"를 넣을지와 숫자(`docs/BRAND-CLIENT-WORK.md` §6-5와 같은 질문). 초안에는 넣지 않았다.
5. **처리방침 해석**: 프로젝트 알림 메일이 "서비스 이용에 필요한 이메일"에 든다는 §2.4의 해석.
6. **(3단계 예고) 외부인 메일 주소 수집**: 공유 링크로 들어온 사람에게 답글 알림을 보내려면 메일 주소를 받아야 하고, 처리방침에 반영해야 한다. 1단계에는 없다.

## 9. 알림 문안 초안

Gemma 4 2패스(맥락 전체로 쓰기 → `docs/wording/ai-tell-quick-rules.md`로 윤문) 결과를 원문과 대조해 붙인다. 대표 확정 전에는 사전에 넣지 않는다.

실행: 2026-11-18, `yagi-crm-gemma4:31b-q8_0`, 두 패스 모두 완료. 아래는 2패스 결과 그대로이고, 영어의 "Yagi team"만 제품 표기("YAGI team")에 맞췄다.

| 알림 | 메일 제목 | 메일 첫 줄 | 메일 본문 | 버튼 | 푸시 제목 | 푸시 내용 |
| --- | --- | --- | --- | --- | --- | --- |
| 새 시안 | [{project}] {title} 새 시안이 도착했어요 | {title}의 새 버전이 올라왔습니다. | 야기 팀이 {version}번째 시안을 준비했어요. 확인하고 의견을 남겨주세요. | 시안 확인하기 | 새 시안 도착 | [{project}] {title}의 {version}번째 시안을 확인해 보세요. |
| 스토리보드 | [{project}] 스토리보드가 공유되었습니다 | {title} 스토리보드를 확인해 보세요. | 야기 팀이 작업 방향을 담은 스토리보드를 올렸습니다. 내용을 검토해 주세요. | 스토리보드 보기 | 스토리보드 공유 | [{project}] {title}의 스토리보드가 도착했습니다. |
| 묶음(대화·답글) | [{project}] 읽지 않은 메시지가 {count}건 있어요 | 야기 팀의 메시지를 확인해 주세요. | 아직 확인하지 않은 의견과 답글이 {count}건 있습니다. 원활한 프로젝트 진행을 위해 확인해 주세요. | 메시지 확인하기 | 새 메시지 {count}건 | [{project}] 야기 팀이 보낸 메시지가 {count}건 있습니다. |
| 멘션 | [{project}] {name}님이 불렀어요 | 대화에서 언급되셨습니다. | {name}님이 프로젝트 대화창에서 호출했습니다. 어떤 내용인지 확인해 보세요. | 대화 바로가기 | 나를 불렀어요 | [{project}] {name}님이 언급하셨습니다. |
| 의뢰 접수 | [{project}] 의뢰가 정상적으로 접수되었습니다 | 요청하신 내용이 잘 전달되었습니다. | 야기 팀이 보내주신 의뢰 내용을 확인하고 있습니다. 곧 안내해 드릴게요. | 내 의뢰 확인하기 | (푸시 없음) | (푸시 없음) |

맨 아래 한 줄: "이 메일은 프로젝트 진행 알림이며, 알림 설정에서 수신 여부를 변경할 수 있습니다."

영어:

| 알림 | Subject | Heading | Body | Button | Push title | Push body |
| --- | --- | --- | --- | --- | --- | --- |
| new_version | New version of {title} for {project} | A new version of {title} is ready. | The YAGI team has uploaded version {version}. Please review it and share your feedback. | Review Draft | New Draft Ready | Check out version {version} of {title} in {project}. |
| storyboard | Storyboard shared for {project} | Your storyboard for {title} is ready. | The YAGI team has shared the storyboard outlining the project direction. Please take a look. | View Storyboard | Storyboard Shared | The storyboard for {title} in {project} is now available. |
| replies | {count} unread messages in {project} | You have new messages from the YAGI team. | There are {count} unread replies and messages. Please check them to keep the project moving. | View Messages | {count} New Messages | You have {count} new messages from the YAGI team in {project}. |
| mention | {name} mentioned you in {project} | You were mentioned in a conversation. | {name} tagged you in the project chat. Click below to see the message. | Go to Chat | You were mentioned | {name} mentioned you in {project}. |
| intake_received | Request received for {project} | Your request has been successfully submitted. | The YAGI team is reviewing your requirements. We will get back to you soon. | View Request | (none) | (none) |

Footer: "This is a project notification. You can manage your notification settings in the workspace."

원문 대조에서 걸린 곳(대표가 정할 것):

1. **의뢰 접수 본문의 "곧 안내해 드릴게요" / "We will get back to you soon"**: 기한은 아니지만 응답 약속이다. §8-4(약속 문장)와 같은 결정이라, 정해지기 전에는 이 문장을 빼고 보낸다.
2. **묶음 본문의 "원활한 프로젝트 진행을 위해 확인해 주세요"**: 사실이 아니라 재촉이다. 이 문장을 빼도 메일은 성립한다(앞 문장 + 야기 팀 글 발췌 + 버튼).
3. **"정상적으로", "성공적으로"**: 뜻을 더하지 않는 낱말이다. 윤문 뒤에도 남았다.
4. **멘션 본문의 "호출했습니다"**: 제품 화면의 낱말은 "부르다"(예: "팀 전체에 알려요")이다. 제목은 "불렀어요"로 맞는데 본문만 다르다.


## 10. 확정 문안과 메일 모양 (2026-11-18 대표 확정)

대표가 §9 초안을 보고 "이대로 진행하자"고 했다(2026-11-18). §2.1의 발송 대상과 §8-3의 간격(10분, 30분)도 제안값대로 간다. 걸린 네 곳은 함께 올린 권고대로 처리했다: 응답 약속 문장과 재촉 문장을 빼고, "정상적으로"·"성공적으로"를 빼고, 멘션 낱말을 "부르다"로 맞췄다. 접수 메일에 기한 약속은 넣지 않는다. 뺀 문장을 되살리거나 약속을 넣는 것은 대표가 다시 정한다. (같은 날 대표가 접수 메일에 "영업일 3일 안에 연락드립니다."를 직접 넣었다. §10.2·§10.3 표가 그것을 반영한다.)

초안에 없던 문구(멘션 본문, 수신 거부 링크, 알림 설정, 수신 거부 뒤 페이지)는 같은 날 Gemma 4 2패스로 뽑아 원문과 대조했다. 발송은 여전히 `BRAND_ROOM_NOTIFY`가 켜져야 시작된다.

### 10.1 메일 모양

- 메일 한 통은 알림 한 종류다. "바로" 알림(새 시안, 스토리보드, 멘션, 의뢰 접수)은 한 건이 한 통이다. N2의 "바로 메일에 묶음 글도 함께 싣기"는 없앤다.
- 묶음 메일(야기 팀 대화·의견 답글)은 받는 사람 × 장소마다 한 통이고 `{count}`는 실린 글의 수다. 본문 아래에 글마다 "쓴 사람: 앞 120자"를 최대 5줄 싣는다. 글이 없는 줄(파일만 보낸 메시지 등)은 싣지 않는다. "외 N건" 줄은 없다.
- 멘션 메일도 본문 아래에 그 글의 "쓴 사람: 앞 120자"를 한 줄 싣는다.
- 쓴 사람 표기: 야기 팀은 "야기 팀 · 이름"(이름이 없으면 "야기 팀"), 고객은 이름.
- 조직의 일반 대화에서 온 알림은 `{project}` 자리에 그 채널의 제품 이름(`roomsChat`의 `general`: "일반 문의" / "General")을 넣고, 버튼은 알림함의 일반 대화로 간다.
- 맨 아래: 확정 문장 + 수신 거부 링크, 그리고 회사 줄.
- 푸시: 종류별 확정 문구. 대화·답글 푸시는 묶음 문구에 그 회차의 건수를 넣는다(한 건이면 1).

### 10.2 한국어

| 알림 | 메일 제목 | 첫 줄 | 본문 | 버튼 | 푸시 제목 | 푸시 내용 |
| --- | --- | --- | --- | --- | --- | --- |
| 새 시안 | [{project}] {title} 새 시안이 도착했어요 | {title}의 새 버전이 올라왔습니다. | 야기 팀이 {version}번째 시안을 준비했어요. 확인하고 의견을 남겨주세요. | 시안 확인하기 | 새 시안 도착 | [{project}] {title}의 {version}번째 시안을 확인해 보세요. |
| 스토리보드 | [{project}] 스토리보드가 공유되었습니다 | {title} 스토리보드를 확인해 보세요. | 야기 팀이 작업 방향을 담은 스토리보드를 올렸습니다. 내용을 검토해 주세요. | 스토리보드 보기 | 스토리보드 공유 | [{project}] {title}의 스토리보드가 도착했습니다. |
| 묶음(대화·답글) | [{project}] 읽지 않은 메시지가 {count}건 있어요 | 야기 팀의 메시지를 확인해 주세요. | 아직 확인하지 않은 의견과 답글이 {count}건 있습니다. | 메시지 확인하기 | 새 메시지 {count}건 | [{project}] 야기 팀이 보낸 메시지가 {count}건 있습니다. |
| 멘션 | [{project}] {name}님이 불렀어요 | {name}님이 불렀어요 | {name}님이 프로젝트 대화에서 불렀어요. 내용을 확인해 주세요. | 대화 바로가기 | 나를 불렀어요 | [{project}] {name}님이 불렀어요 |
| 의뢰 접수 | [{project}] 의뢰가 접수되었습니다 | 요청하신 내용이 잘 전달되었습니다. | 야기 팀이 보내주신 의뢰 내용을 확인하고 있습니다. 영업일 3일 안에 연락드립니다. | 내 의뢰 확인하기 | (푸시 없음) | (푸시 없음) |

- 의뢰 접수 본문의 둘째 문장 "영업일 3일 안에 연락드립니다."는 대표 문장이다(2026-11-18). §8-4의 약속 문장 결정이 이것으로 끝났다.
- 맨 아래 문장: "이 메일은 프로젝트 진행 알림이며, 알림 설정에서 수신 여부를 변경할 수 있습니다." 링크 글자: "수신 거부"
- 알림 설정(알림함): 제목 "알림 설정" · "이메일 알림" — "새 시안, 스토리보드, 메시지, 멘션 알림을 메일로 보내드려요." · "푸시 알림" — "현재 사용 중인 브라우저에서 알림을 보내드려요." · 차단됨 "브라우저 설정에서 알림을 허용해 주세요." · 미지원 "이 브라우저는 알림을 지원하지 않아요." · "저장됐어요" · "저장하지 못했어요. 다시 시도해 주세요."
- 수신 거부 뒤 페이지: "메일 수신을 거부했습니다" · "이제 이 브랜드의 프로젝트 메일은 발송되지 않아요. 다시 받으려면 알림 설정에서 켤 수 있어요." · 링크 "알림 설정으로 가기"

### 10.3 영어

| 알림 | Subject | Heading | Body | Button | Push title | Push body |
| --- | --- | --- | --- | --- | --- | --- |
| new_version | New version of {title} for {project} | A new version of {title} is ready. | The YAGI team has uploaded version {version}. Please review it and share your feedback. | Review Draft | New Draft Ready | Check out version {version} of {title} in {project}. |
| storyboard | Storyboard shared for {project} | Your storyboard for {title} is ready. | The YAGI team has shared the storyboard outlining the project direction. Please take a look. | View Storyboard | Storyboard Shared | The storyboard for {title} in {project} is now available. |
| replies | {count} unread messages in {project} | You have new messages from the YAGI team. | There are {count} unread replies and messages. | View Messages | {count} New Messages | You have {count} new messages from the YAGI team in {project}. |
| mention | {name} mentioned you in {project} | {name} mentioned you | {name} mentioned you in the project conversation. Please check the message. | Go to Chat | You were mentioned | [{project}] {name} mentioned you |
| intake_received | Request received for {project} | Your request has been submitted. | The YAGI team is reviewing your requirements. We'll get back to you within 3 business days. | View Request | (none) | (none) |

The receipt's second sentence follows the founder's Korean sentence (대표 문장, 2026-11-18).

count = 1 uses the singular form: "1 unread message in {project}" · "There is 1 unread reply or message." · "1 New Message" · "You have 1 new message from the YAGI team in {project}." (한국어는 한 가지 문장 그대로)

- Footer: "This is a project notification. You can manage your notification settings in the workspace." Link: "Unsubscribe"
- Settings: "Notification settings" · "Email notifications" — "Get emails for new drafts, storyboards, messages, and mentions." · "Push notifications" — "Get notifications on your current browser." · blocked "Please allow notifications in your browser settings." · unsupported "This browser does not support notifications." · "Saved" · "Failed to save. Please try again."
- After unsubscribing: "Email notifications turned off" · "You will no longer receive project emails from this brand. You can turn them back on in notification settings." · link "Go to notification settings"


## 11. 2단계: 크게 보기·프레임·구간 반복·빠른 갱신 (2026-11-18)

브랜치 `claude/rooms-review-stage2`(main `81ff208b`에서). 마이그레이션 0096·0168은 **클라우드 적용 필요**이고, 적용 전에도 코드는 예전처럼 동작한다.

### 11.1 크게 보기와 전체 화면

- **검토 모드**: 룸의 시안 탭에서 시안을 열면(`?tab=review&review=<id>`) 스테이지가 워크스페이스 본문 전체 폭을 쓴다. 룸의 1180px 상한과 셸의 상한이 이때만 풀리고, 파일 탭의 분류 칩·기획서·스토리보드는 잠시 비킨다. 위쪽 "← 시안 목록"(이미 있던 `roomsReview.tab.back`)으로 목록에 돌아간다. 주소에 `review`가 있으면(알림 메일 버튼, 대화 카드, 복사한 링크) 바로 검토 모드로 열리고 스테이지가 화면 맨 위로 온다. 없으면 목록부터 보인다(예전에는 첫 시안을 저절로 열었다).
- **영상 크기**: 검토 모드와 공유 페이지(`layout="wide"`)는 창 높이에서 머리말·조작 줄을 뺀 만큼을 쓴다(예전 상한 66vh·760px 대신). 9:16 영상은 높이에 맞춘다. 1440×900에서 가로 영상 848×477(예전 약 450px 폭), 세로 영상 336×597.
- **전체 화면**: 조작 줄의 버튼 또는 `F`. `<video>`가 아니라 플레이어 전체(핀, 그림, 구간 막대, 조작 줄)와 의견 칸을 담은 틀을 전체 화면으로 올린다. 의견 칸은 처음에 접혀 있고 버튼으로 펼친다. 구간·위치·그리기를 시작하거나 글을 쓰기 시작하면 저절로 펼쳐진다. 빠져나와도 쓰던 글은 그대로다. 브라우저가 요소 전체 화면을 못 하면(iPhone 사파리) 버튼을 그리지 않고 크게 보기로 대신한다.
- **떠 있는 문의 버튼**: 검토 모드에서는 오른쪽 아래 "실시간 문의" 버튼이 의견 칸의 보내기 버튼과 폰의 의견 목록을 가려서, 시안이 열려 있는 동안만 숨긴다(목록으로 돌아오면 다시 보인다). 전체 화면에는 원래 나오지 않는다.
- **단축키**: 스테이지 안 어디에 포커스가 있어도 듣는다(스테이지가 클릭으로 포커스를 받는다). 글 칸·선택 상자·편집 가능한 글·대화 상자 안에서는 듣지 않는다. 나란히 비교 중에는 쉰다.

### 11.2 실제 프레임

- **파일에서 읽기**: 팀이 시안을 올리거나 고객이 영상을 올릴 때 MP4/MOV의 상자를 맨 위부터 차례로 읽어(파일 끝에 있는 `moov`도) 영상 트랙의 `mdhd` 시간 단위와 `stts`로 평균 프레임 레이트를 구한다. 0.5% 안이면 흔한 값(23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60) 중 가장 가까운 것으로 맞춘다. 조각난 MP4(`mvex`)나 읽을 수 없는 파일은 비워 둔다.
- **저장**: `brand_studio_assets.fps`(0096). 폭·높이·길이가 이미 에셋에 있어서 같은 자리에 둔다. 같은 파일이 다시 오면 처음 값을 지킨다. 스튜디오 결과물과 예전 행은 비어 있다. 열이 없으면(`assetFpsReady`) 읽지도 쓰지도 않는다.
- **브라우저에서 재기**: 저장된 값이 없으면 1배속 재생 중 `requestVideoFrameCallback`이 알려 주는 프레임 시각 간격의 중앙값으로 잰다. 재기 전에는 한 칸을 1/24초로 본다.
- **쓰는 곳**: ←/→와 `,`/`.`는 진짜 한 프레임(그 프레임 시작보다 조금 뒤로 보내 정확히 그 프레임에 선다). 재생 시계, 의견 시각, 칩, 구간, 핀 설명은 `m:ss:ff`(초 안의 프레임 번호, 100fps 이상은 세 자리). 레이트를 아직 모를 때만 예전 `m:ss.t`.
- **화면에서 읽히는 모양**: `0:08:00`이 8분처럼 읽혀서, 화면의 시각(재생 위치, 길이, 의견 시각 칩, 구간·장면 칩)은 `0:08` 뒤에 프레임 `:00`을 작고 옅게(0.82em, 보조 잉크) 붙인다. 옅은 부분의 대비는 어두운 칩 위에서 7.4:1(기본값 #a1a1aa / #111113), 워크스페이스 토큰으로 8.0:1이다. 더 옅은 회색(#71717a)은 3.9:1이라 쓰지 않았다. 길이가 정확히 초에서 끝나면(1프레임 안) 프레임 없이 `0:08`만 쓴다. 화면 낭독기 이름, CSV·체크리스트·편집기 마커, 링크 주소는 예전처럼 글자 그대로다. 의견은 그대로 ms로 저장하되 화면에 보이던 프레임의 시작으로 맞춘다. `?t=ms`는 그대로다. 플레이어 시간 옆에 "23.976 fps"를 작게 보인다(좁은 화면에서는 숨김).

### 11.3 구간 반복

- 구간이 있을 때(막 찍은 I/O 구간, 아니면 고른 구간 의견) 조작 줄의 반복 버튼이나 `R`로 켠다. 끝에 닿으면 시작으로 돌아가 계속 재생한다(끝은 포함하지 않는다). 다른 의견을 고르거나 구간을 지우면 꺼진다. 구간 의견의 시각을 한 번 누르면 예전처럼 시작으로 가고, 두 번 누르면 그 구간을 반복 재생한다. 그림 표시 규칙(멈춘 상태에서 시작 ±400ms)은 바꾸지 않았다.

### 11.4 빠른 갱신(맥박)

- **한 번의 가벼운 읽기**: `lib/brand-rooms/pulse.ts`가 부분별로 짧은 도장(대화, 시안, 스토리보드, 공유 링크)을 돌려준다. 도장은 몇 개의 개수·최근 시각을 해시한 16자이고 내용은 담지 않는다. 문 세 개가 같은 함수를 쓰고, 각자 그 데이터를 읽을 수 있는 사람만 들인다.
  - 고객: `GET /api/brand-rooms/pulse?organizationId=&projectId=` (룸 좌석 → 샌드박스·생성 정책 → 프로젝트. 공유 링크 부분은 소유자·편집자만)
  - 공유 링크 손님: `POST /api/brand-rooms/shares/public {op:'pulse', token}` (토큰과 암호 증명, 그 항목 하나만. 주소당 분당 60회의 별도 묶음이라 한 사무실 주소 뒤의 탭 다섯 개까지 막히지 않고, 다른 묶음은 그대로)
  - 팀: `GET /admin/brand-rooms/<org>/pulse?projectId=` 또는 `?review=`(그 시안의 버전 묶음 전체)
- **팀 메모는 고객·손님 도장을 움직이지 않는다**: 공개 의견만 센다. 팀 도장은 팀 메모까지 센다(테스트로 확인).
- **화면 쪽**: 탭이 보일 때 5초마다 묻고, 10분 동안 바뀐 게 없으면 15초로 늦춘다. 탭이 숨으면 묻지 않고, 돌아오면 바로 묻는다. 401·403·404면 그 페이지에서는 멈춘다. 바뀐 부분만 다시 읽는다.
  - 고객 시안 탭: 30초 전체 다시 읽기 대신, 시안 도장이 바뀔 때 목록과 열린 시안을 다시 읽는다.
  - 팀 리뷰 화면(작업대·단독): 15초 `router.refresh()` 대신, 시안 도장이 바뀔 때 다시 읽는다. 쓰는 중이면 기다렸다가 손을 떼는 즉시 다시 읽는다("새 의견 있음" 같은 문구는 없어서 새로 만들지 않았다). 맥박 문이 없으면(룸 플래그 꺼짐) 예전 15초 갱신으로 돌아간다.
  - 공유 페이지: 처음으로 실시간 갱신이 생겼다. 손님이 쓰던 글이 있으면 기다린다.
  - 대화의 4초 폴링은 그대로 두었다.

### 11.5 문구

새 문구는 아이콘 버튼 이름 다섯 개뿐이다(`studioReview.player`). Gemma 4 2패스를 모두 돌렸다(1패스 맥락 전체로 쓰기, 2패스 `docs/wording/ai-tell-quick-rules.md`로 윤문). 2패스는 1패스와 글자 하나 다르지 않았고, 사실과 대조해 그대로 넣었다.

| 키 | 한국어 | English |
| --- | --- | --- |
| `fullscreen` | 전체 화면 | Full screen |
| `exitFullscreen` | 전체 화면 나가기 | Exit full screen |
| `loop` | 구간 반복 | Loop |
| `notesShow` | 의견 펼치기 | Expand notes |
| `notesHide` | 의견 접기 | Collapse notes |

### 11.6 확인한 것과 남은 것

- 로컬 두 역할(내구 PGlite, 고객 `…0001`·관리자 `…0003`)에서 23.976fps 가로·30fps 세로 테스트 영상(프레임 번호를 2진 상자로 새김)을 CLI로 올려 직접 봤다. →와 `,`가 캔버스로 읽은 프레임 번호 0→12, 11→9로 한 칸씩 움직였고, 세로 영상은 `?t=1000`에서 30번 프레임으로 열렸다. 반복은 1.0–3.0초 안에서만 돌았다. 전체 화면(헤드리스 크로미움)에서 의견 칸이 접힌 채 열리고, 펼쳐 쓴 글이 빠져나온 뒤에도 남았다. 공유 페이지는 회원이 쓴 의견을 새로고침 없이 3초 남짓에 보였다. 단독 팀 리뷰 화면은 쓰는 동안 다시 읽지 않다가 글을 지우자마자 새 의견을 보였다.
- 작업대의 대기 수와 확인함은 대화 줄이 움직인다(§3 끝, 새 줄마다 페이지를 다시 읽는다). 후속 작업(대기 = 답하지 않은 것, 확인함)을 합친 뒤 로컬에서 고객 줄을 남기고 작업대 검토 모드를 열었을 때 대기 3이 보였고, 확인함을 누르자 1.4초 뒤 0이 되고 확인 줄이 붙었다. 맥박 요청과 스테이지는 그대로였다. 맥박은 시안 도장만 보고 그 갱신과 겹치지 않는다. 대화 줄로 다시 읽을 때는 맥박의 "쓰는 중 기다리기"를 거치지 않지만 쓰던 글은 지워지지 않는다(페이지를 다시 그려도 입력 상태는 남는다).
- 확인하지 못한 것: 실제 iPhone·iPad 사파리, 파이어폭스(크로미움 헤드리스로만 봤다. `requestVideoFrameCallback`이 없는 브라우저는 화면 갱신마다 시계가 돌고, 레이트를 재지 못하면 한 칸을 1/24초로 본다), 크롬이 재생하지 못하는 코덱의 시안, 가변 프레임 레이트 영상, 운영 데이터베이스에서의 맥박 쿼리 속도.

### 11.7 화면 정리 (2026-11-18 대표 판정)

대표가 검토 모드 화면을 보고 타임라인의 번호 핀이 "골프핀처럼" 보이고 고객사에 보이는 화면인데 프리미엄하지 않다고 했다. "진행해. 상단 버튼이랑 내보내기 메뉴도 같이." 네 화면(스튜디오 리뷰, 룸, 팀 작업대, 공유 링크)이 같은 스테이지라 함께 바뀌었다. 동작·권한·데이터·API는 그대로다.

- **타임라인 하나**: 4px 재생 막대(올리거나 끌면 6px, 지난 부분은 기본 잉크) 아래 16px 표시 줄. 의견마다 8px 점 하나(누를 자리는 24px, 폰은 28px). 고객·손님 의견은 채운 점, 야기 팀 의견은 같은 색 고리, 팀 메모는 점선 고리(팀 화면에만). 번호는 의견 목록에만 있다. 구간 의견은 점에서 시작하는 2px 선. 14px보다 가까운 점은 숫자 알약 하나로 묶이고, 누르면 그 의견들의 짧은 목록이 열린다. 폰(520px 이하)에서는 누를 자리와 같은 28px로 묶는다: 14px로 두면 한 점의 절반이 옆 점의 누를 자리에 덮여 다른 의견이 열렸다. 재생하지 않은 막대 부분은 점보다 흐리지만 길이가 늘 보이게 했다(어두운 화면 2.4:1).
- **내용은 올리거나 눌렀을 때**: 점에 마우스를 올리거나 포커스가 가거나 폰에서 처음 누르면 위에 작은 카드(쓴 사람, 시각, 두 줄, 답글 수; 팀 화면의 팀 메모는 그 표시까지). 누르면(폰은 카드가 떠 있을 때 한 번 더) 그 장면으로 가서 목록에서 고른다: 폰에서 고르면 화면이 의견 목록으로 내려가 카드가 사라졌다. 목록의 줄에 올리면 그 점이 커진다.
- **포인트 색은 하나**: 고른 의견(점, 구간 선, 막대 위 옅은 칠)과 그리고 있는 구간(선과 손잡이 두 개)만. 목록의 번호 배지, 야기 팀 표시, 화면 위 위치 표시에서는 뺐다.
- **표시 줄의 키보드**: 탭 한 번으로 들어가 ←/→로 점과 알약 사이를 움직인다(이때 영상은 움직이지 않는다). Enter·Space로 열고 Esc로 스테이지에 돌아간다. 아래 늘 보이던 단축키 문장은 빼고 조작 줄 끝의 "?" 버튼(또는 `?` 키)에 두 칸 목록으로 옮겼다.
- **머리말**: 제목 옆에 조용한 상태 표시. 오른쪽은 윤곽 버튼(수정 요청) · 채운 버튼 하나(승인하기) · 공유 · `⋯`(링크 복사, 새 버전 올리기, 나란히 비교). 승인된 뒤, 보기만 하는 사람, 손님에게는 채운 버튼이 없다(다른 것을 올리지 않는다). 팀 화면에도 채운 버튼을 두지 않았다: 승인은 고객이 정할 일이고 팀의 주 행동은 의견 칸의 보내기다. 폰에서는 윤곽 버튼도 `⋯`로 들어간다.
- **의견 패널**: 글자 탭(열린 의견 / 해결됨 / 전체), 필터 아이콘(그림 표시만, 작성자) — 걸려 있으면 작은 점, 내보내기 아이콘(CSV 표, 체크리스트, 편집기 마커). 의견은 가는 선으로 나눈 줄이고 답글·해결·삭제는 올리거나 포커스가 갈 때, 고른 줄, 터치 화면에서 보인다. 고른 줄은 한 단 밝은 면과 왼쪽 2px 포인트 막대.
- **문구**: 새 이름은 필터·단축키·묶음 알약·J/L/I/O 줄뿐이고 Gemma 4 2패스를 거쳤다. `더보기`, `답글 {count}개`는 기존 사전 문구를 그대로 옮겼다. 원칙은 `docs/design/TASTE.md` 규칙 16.
- **마감 손질 (2026-11-19, "아쉬운 것 없을 때까지")**: 동작·권한·데이터·API는 그대로이고 네 화면을 세 크기(1440×900, 1280×720, 390×844)에서 다시 보며 고쳤다.
  - 구간 선은 고른 의견과 올린(목록 줄·점·카드) 의견에만 그린다. 쉬는 동안 구간 의견은 시작 점 하나다. 새 구간을 그리는 동안 고른 의견의 선과 막대 위 칠은 숨고 점은 남는다.
  - 붐비는 표시 줄(의견당 30px 미만, 폰은 40px 미만, 또는 묶음 하나가 구간 두 칸보다 길 때)은 줄을 고르게 나눈 구간(데스크 약 30px, 폰 약 56px)으로 접는다. 데스크는 의견 수만큼 길고 밝은 짧은 막대, 폰은 구간마다 숫자 알약이다. 묶음·구간에 마우스를 잠깐 올리면 그 의견 목록이 뜨고(눌러야 고정), 목록의 줄에 올리면 그 의견의 실제 시각에 점이 생긴다. 점이 하나로 묶이는 간격은 14px에서 누를 자리와 같은 24px로 넓혔다(옆 점의 누를 자리가 겹치던 것).
  - 넓은 화면(1241px 이상)의 룸 검토 모드·공유 링크·스튜디오 리뷰는 스테이지 본문이 창 바닥까지 찬다(`fillBodyHeight`). 플레이어는 영상, 타임라인, 조작 줄을 담은 어두운 캔버스 한 장이고 영상은 그 가운데에, 조작 줄은 의견 칸의 입력창과 같은 바닥선에 놓인다. 팀 화면(본문 높이 그대로)은 의견 칸이 플레이어 높이에 맞춰 안에서 스크롤한다.
  - 포인트 색: 한 화면에 채운 버튼 하나(`승인하기`, 없으면 `보내기`, 둘 다면 `보내기`는 잉크로 채운 중립 버튼), 그리고 지금 더하는 것(그리는 구간, 찍는 순간)과 포커스 링. 고른 의견은 잉크다. TASTE 규칙 19.
  - 브라우저 기본 컨트롤을 없앴다: 버전, 재생 속도, 나란히 비교의 두 선택은 스테이지의 선택 메뉴(`StageSelect`), 작성자 필터는 패널 안 선택 줄, `팀만 보기`·`그림 표시만`은 스위치(`StageSwitch`, 체크박스 그대로). 나란히 비교의 재생 막대도 스테이지와 같은 막대다.
  - 스튜디오 리뷰 페이지: 바깥 머리말의 분홍 `공유 링크 (/s/...) · 대화방 연결`을 스테이지 머리말의 윤곽 버튼 `공유 링크 · 대화방 연결`(사전 `studioReview.shareOpen`, 주소 조각만 뺐다)로 옮겼다. 1480px 이하에서 목록은 위쪽 띠가 되어 스테이지가 전체 폭을 쓰고, 리뷰가 열려 있으면 떠 있는 문의 버튼이 숨는다.
  - 의견 줄의 동작(2차): 줄에 바로 보이는 것은 `답글` 하나이고, `⋯`(`더보기`)가 스테이지 메뉴로 `해결`(`다시 열기`)과 `삭제`(예전과 같은 확인 창)를 연다. 줄을 겨냥한 클릭이 해결·삭제로 떨어지지 않는다. 두 버튼은 시각 줄(답글은 이름 줄) 끝에 자리를 늘 잡아 두고, 마우스가 있으면 올리거나 포커스·선택일 때 보이며 숨은 동안에는 눌리지 않는다. 터치 화면은 늘 보인다. Tab 순서는 답글 → ⋯, 메뉴는 화살표와 Esc.
  - 팀 작업대(2차): 버전을 열면 그 버전이 창 위로 올라오고 스테이지가 창 바닥까지 찬다(룸 검토 모드와 같은 `fillBodyHeight`). 의견 칸은 플레이어 높이와 상관없이 바닥까지 자기 스크롤을 갖고 입력창은 칸 바닥에 있다. 대화 서랍은 그대로 그 위에 열린다.
  - 떠 있는 문의 버튼(2차, #267 이후): 폰(640px 이하 레일 셸)에서는 상단 막대 안에 있어 아무것도 가리지 않으므로 검토 중에도 그대로 둔다. 그보다 넓은 화면에서만 검토 중에 숨긴다(룸·스튜디오 리뷰 모두).
  - 그 밖에: 버전 선택이 상태를 말하므로 따로 붙던 상태 표시는 뺐다. 긴 제목은 제 칸 안에서 줄바꿈하고 버튼은 오른쪽에 남는다. 의견이 없을 때도 입력창은 칸 바닥에 있다. 한국어 본문은 단어 사이에서만 줄을 바꾼다. 공유 링크와 팀 화면의 흐린 글자(4.5:1 미만이던 #71717a)와 재생 막대 남은 부분(3:1 미만)을 올렸다. 터치 화면에는 키보드 단축키 버튼을 그리지 않는다.

## 12. 초대로 공유 (2026-11-18, 플래그 `BRAND_ROOM_INVITES`)

> 대표 결정(2026-11-18): 공유는 디자인 도구의 공유 창처럼 두 가지 접근 방식을 둔다. **"초대한 사람만"이 기본**이고, **"링크가 있는 누구나"**는 고객이 직접 바꿀 때만 켜지며, 켤 때 만료와 암호를 권한다. 쓰임: 초대는 공개 전 시안·외부 파트너·임원 검토, 링크는 한 번 빨리 보여 줄 때.
>
> 플래그 `BRAND_ROOM_INVITES`(기본 꺼짐, `BRAND_ROOMS`도 켜져 있어야 함). 꺼져 있으면 지금과 똑같다: 예전 공유 창, `/api/brand-rooms/people`은 404, 초대 메일 없음, 모든 초대는 이메일이 같아야 수락된다. 예외 하나: 보기 권한 손님의 읽기 전용은 플래그와 상관없이 적용된다(아래). 켜기 전에 0097·0170을 적용한다(클라우드 적용 필요). 켜는 것은 대표 결정이다.

### 12.1 무엇이 바뀌나

- **공유 창 하나에 두 부분.** 시안·스토리보드의 "공유" 버튼과 룸 머리의 "공유"(프로젝트 전체)가 같은 창을 연다. 소유자·편집자만 보인다. 뷰어와 초대 손님에게는 버튼이 없다.
  1. **사람 초대(프로젝트 단위).** 이메일을 쉼표·띄어쓰기·Enter로 여러 개(한 번에 10개까지, 형식 확인, 중복 제거) 넣고 권한(보기 / 의견 남기기, 기본 의견 남기기)을 골라 보낸다. 초대받은 사람은 그 프로젝트 룸 하나를 손님으로 본다(`brand_project_members`). 아래 목록: 브랜드 멤버(역할만, 여기서 못 바꿈), 초대로 들어온 사람(들어온 계정의 이름·이메일과 초대한 주소, 권한 바꾸기, 내보내기), 수락 전 초대(남은 날 또는 "전송 실패", 다시 보내기, 초대 취소). 내보내면 `brand_project_members`가 바로 `revoked`가 되고, 그 사람을 들인 초대도 끊긴다.
  2. **링크 공유(그 시안·스토리보드 하나).** 선택 하나: "초대한 사람만"(기본, 링크 없음) / "링크가 있는 누구나". 누구나로 바꾸면 기존 옵션(만료 1·7·14·30·90일 중 14일 선택, 암호, 의견, 내려받기)과 권고 한 줄이 펼쳐지고, "링크 만들기"를 눌러야 링크가 생긴다(기존 `brand_room_shares` 그대로). 다시 "초대한 사람만"으로 바꾸면 확인 한 번 뒤 그 항목의 열린 링크를 모두 끈다. 이 기능 전에 만든 링크가 열려 있으면 처음부터 "링크가 있는 누구나"로 보인다.
- **브랜드가 초대한다.** 지금까지는 야기 팀만 프로젝트 초대를 만들었다. 이제 소유자·편집자도 고객 공개(`client_visible`) 프로젝트에 손님(뷰어 + `can_comment`)을 초대한다. 같은 쓰기 함수(`storeInvitation`, 팀 초대도 이것을 쓴다)와 같은 수락 함수다. 한도: 조직당 하루 20건(팀 초대 포함), 프로젝트당 수락 대기 20건. 같은 주소를 다시 초대하면 기존 대기 초대를 끊고 새 링크를 보낸다(목록에는 하나).
- **초대 메일.** 기존 메일러와 거래 메일 틀(`sheet()`). 초대한 사람 이름, 브랜드 이름, 프로젝트 이름, 버튼 하나(수락 화면, 토큰은 주소의 `#` 뒤), 만료 날짜, "받은 분만 쓰라"는 줄, 맨 아래 "왜 받았는지" 한 줄과 회사 줄. 광고 없음, 수신 거부 헤더 없음(한 번 보내는 메일). 플래그가 켜지고 메일러가 있을 때만 나간다. 결과는 초대 행에 남는다(`mail_state` sent / failed / skipped). 못 보냈으면 목록에 "전송 실패"가 보이고, 보낸 사람 화면에 복사할 링크가 한 번 나온다(다시 보내기도 같다).
- **수락 규칙(정확히).** 프로젝트 초대만 바뀐다. 플래그가 켜져 있으면, 로그인(Google·카카오)한 계정의 확인된 이메일이 초대 주소와 같거나, **같지 않아도** 토큰이 유효하고(만료 전, 취소 안 됨) 아직 쓰이지 않았으면 그 계정에 묶는다. 한 번만 쓰인다: 수락한 계정이 다시 열면 그대로 들어가고, 다른 계정은 404(`not_found`). 수락한 계정 id와 그때의 이메일을 초대 행에 남긴다(`accepted_by`, `accepted_email`). 초대한 사람이 그 사이 소유자·편집자 자리를 잃었으면 초대는 죽는다. **조직 초대(프로젝트 없음)는 이메일 일치 규칙 그대로**다. 플래그가 꺼져 있으면 모든 초대가 예전처럼 이메일 일치를 요구한다.
- **수락 뒤.** 바로 그 프로젝트 룸으로 간다. 시안·스토리보드의 공유 창에서 보낸 초대면 그 항목이 열린다(`target_kind`/`target_id`). 수락 화면 버튼 아래 줄은 "지금 로그인한 계정으로 들어가고 초대한 사람이 그 계정을 본다"로 바뀐다.
- **보기 권한 손님은 쓰지 못한다.** `roomSeat`가 손님의 `can_comment`를 읽고(`readOnlyProjectIds`), `canTalkIn`이 프로젝트별로 판단한다. 막는 곳: 대화 글쓰기·수정·리액션·첨부(예약·완료), 시안 의견(시각·구간·그리기 포함), 스토리보드 컷 스레드(대화와 같은 길). 승인·상태·스토리보드 결정은 원래 소유자·편집자만이다. 화면은 입력창을 감추고 기존 문구 "이 대화는 읽기만 할 수 있어요."를 보인다. 조직 멤버의 권한은 그대로다. **이 판단은 플래그와 상관없이 늘 적용된다**(대표 위임 검토 2026-11-18): 팀이 "보기"로 초대한 기존 손님도 룸에서 쓰지 못하게 바로잡는 수정이다. 전에는 룸이 `can_comment`를 읽지 않아 보기 손님도 대화를 쓸 수 있었다.
- **손님이 보지 못하는 것**(기존 규칙, 테스트로 다시 고정): 다른 프로젝트(404), 일반 문의 채널(404), 조직 설정·스튜디오·크레딧, 공유 창과 사람 목록(API 403), 팀 메모.
- **알림.** 들어온 손님은 그 프로젝트의 새 시안·스토리보드·멘션 알림을 받는다(`roomAudience`, 이미 손님 포함). 내보내면 보낼 때 다시 판단해서 `skipped/no_access`가 된다.
- **팀 작업대.** 플래그가 켜져 있으면 작업대의 공유 링크 탭 아래에 "이 프로젝트의 손님" 표가 읽기 전용으로 붙는다: 들어온 손님(이름, 계정 이메일과 초대 주소, 권한, 들어온 날)과 수락 전 초대(이메일, 권한, 만료, 메일 실패 여부). 관리자 읽기(`staffProjectGuests`, 관리자 여부를 DB에서 다시 확인)로 읽고 브랜드 API는 쓰지 않는다. 문구는 관리자 사전(`adminConsole.roomDesk.guest*`).
- **수락 화면 로그인 전 줄.** 토큰이 주소의 `#` 뒤에만 있어 로그인 전에는 서버도 화면도 초대 종류를 모른다. 그래서 플래그가 켜져 있으면 두 종류 모두에 맞는 줄(아래 `accept.login`)로 바꾸고, 꺼져 있으면 지금 줄 그대로다.

### 12.2 데이터 (0097 core · 0170 glue, 새 테이블 없음)

`brand_invites`에 `accepted_email`(소문자, 254자), `mail_state`('sent'·'failed'·'skipped', null = 메일 시도 없음), `mail_sent_at`, `target_kind`('review'·'storyboard')·`target_id`(둘 다 있거나 둘 다 없음, 프로젝트 초대에만). 범위 제약을 "프로젝트 초대는 뷰어"로 넓혔다(전에는 "팀이 발행한 뷰어"). 소유자 초대는 여전히 팀만. 대기 초대 부분 인덱스. glue는 RLS 켜고 강제, 브라우저 권한 회수, `service_role`에 새 세 열(`mail_state`·`mail_sent_at`·`accepted_email`)의 update만 더한다. 토큰은 고치지 않는다(다시 보내기는 새 행 + 옛 행 `revoked_at`).

### 12.3 문안 (Gemma 4 2패스)

실행: 2026-11-18, `yagi-crm-gemma4:31b-q8_0`. 1패스(맥락 전체, 규칙 없음) 188초, 2패스(`docs/wording/ai-tell-quick-rules.md`를 시스템 프롬프트로)까지 597초, 두 패스 모두 완료. 아래는 2패스 결과이고, 원문 대조에서 사실과 달라 고친 두 줄만 표시했다. "초대한 사람만"·"링크가 있는 누구나"는 대표가 정한 이름이다. 공유 창 제목·닫기, 멤버 역할 이름, 일반 오류, 링크 옵션(만료·암호·의견·내려받기, 만든 링크 상자)은 기존 사전 문구를 그대로 쓴다.

| 키 | 한국어 | English |
| --- | --- | --- |
| people.title | 사람 초대 | Invite people |
| people.scopeNote | 초대받은 사람은 이 프로젝트의 시안, 스토리보드, 대화를 확인할 수 있습니다. | Invited people can view drafts, storyboards, and chats in this project. |
| people.emailLabel | 이메일 | Email |
| people.emailPlaceholder | 이메일을 입력하세요. 쉼표로 구분해 여러 명을 초대할 수 있습니다. | Enter emails. Separate multiple addresses with commas. |
| people.permissionLabel | 권한 | Permission |
| people.permView | 보기 | View |
| people.permComment | 의견 남기기 | Comment |
| people.send | 초대하기 | Invite |
| people.sending | 초대 보내는 중 | Sending invitation |
| people.sent | {count}명에게 초대를 보냈습니다. | Sent invitations to {count} people. |
| people.mailFailed | 일부 메일을 보내지 못했습니다. 아래 링크를 복사해 직접 전달해 주세요. | Some emails couldn't be sent. Please copy the link below and send it directly. |
| people.listTitle | 접근 가능한 사람 | People with access |
| people.memberTag | 멤버 | Member |
| people.guestTag | 게스트 | Guest |
| people.noEmail | 이메일 없음 | No email |
| people.remove | 내보내기 | Remove |
| people.removeConfirm | {name}님을 이 프로젝트에서 내보낼까요? | Remove {name} from this project? |
| people.pending | {days}일 후 만료 | Expires in {days} days |
| people.pendingToday | 오늘 만료 | Expires today |
| people.failed | 전송 실패 | Failed to send |
| people.resend | 다시 보내기 | Resend |
| people.cancel | 초대 취소 | Cancel invitation |
| people.cancelConfirm | {email}님의 초대를 취소할까요? | Cancel invitation for {email}? |
| people.copyLink | 링크 복사 | Copy link |
| people.copied | 링크를 복사했습니다. | Link copied. |
| people.empty | 초대한 사람이 없습니다. | No one has been invited yet. |
| errors.email | {email}은(는) 유효한 이메일 주소가 아닙니다. | {email} is not a valid email address. |
| errors.too_many | 한 번에 최대 10명까지 초대할 수 있습니다. | You can invite up to 10 people at a time. |
| errors.rate_limited | 오늘 보낼 수 있는 초대 횟수를 모두 사용했습니다. | You've reached the daily invitation limit. |
| errors.project_limit | 수락 대기 중인 초대가 너무 많아 초대를 더 보낼 수 없습니다. | Too many pending invitations to send more. |
| errors.already_member | {email}님은 이미 브랜드 멤버입니다. | {email} is already a brand member. |
| link.title | 링크 공유 | Share link |
| link.invited | 초대한 사람만 (대표 결정) | Only people invited |
| link.anyone | 링크가 있는 누구나 (대표 결정) | Anyone with the link |
| link.invitedHelp | 초대한 사람만 로그인해서 볼 수 있습니다. **(대조 후 수정)** | Only people invited can open it, after signing in. **(fixed)** |
| link.anyoneHelp | 로그인 없이 누구나 이 작업 하나만 확인할 수 있습니다. | Anyone with the link can view this work without logging in. |
| link.recommend | 보안을 위해 만료일과 암호를 설정해 주세요. | We recommend setting an expiration date and password for security. |
| link.create | 링크 만들기 | Create link |
| link.offConfirm | '초대한 사람만'으로 변경하면 기존 링크가 즉시 꺼집니다. 변경하시겠어요? **(대조 후 수정)** | Switching to 'Only people invited' will immediately turn off existing links. Do you want to proceed? **(fixed)** |
| link.offOk | 변경하기 | Change |
| link.offCancel | 취소 | Cancel |
| mail.subject | {inviter}님이 {project} 프로젝트에 초대했습니다. | {inviter} invited you to the {project} project. |
| mail.heading | {organization}의 {project} 프로젝트에 초대받았습니다. | You've been invited to the {project} project by {organization}. |
| mail.body | {inviter}님이 초대를 보냈습니다. 아래 버튼을 눌러 로그인하면 시안과 스토리보드를 확인할 수 있습니다. | {inviter} has sent you an invitation. Log in via the button below to view the drafts and storyboards. |
| mail.bodyComment | 시안에 의견을 남길 수도 있습니다. | You can also leave comments on the drafts. |
| mail.expiry | 이 링크는 {date}까지 유효합니다. | This link is valid until {date}. |
| mail.personal | 이 링크는 초대받은 분만 사용해 주세요. | Please use this link only if you were the intended recipient. |
| mail.button | 초대 수락하기 | Accept invitation |
| mail.why | {inviter}님이 프로젝트 협업을 위해 이 메일을 보냈습니다. | {inviter} sent this email for project collaboration. |
| accept.note | 현재 로그인한 계정으로 접속합니다. 초대한 사람이 이 계정 정보를 확인할 수 있습니다. | You will join with your current account, and the inviter will be able to see your account information. |
| accept.login | 로그인 후 초대를 수락해 주세요. 작업공간 초대를 받으셨다면 초대받은 이메일로 로그인해야 합니다. | Log in to accept the invitation. For workspace invitations, please use the invited email address. |

`accept.login`은 따로 돌린 2패스(2026-11-18, 같은 모델, 1패스 99초, 2패스까지 203초, 두 패스 완료)의 2패스 결과 그대로다. 지금 줄의 두 번째 문장("로그인 뒤 초대가 나타나지 않으면 원래 받은 초대 링크를 다시 열어주세요")은 빠졌다.

원문 대조에서 걸린 곳:

1. **link.invitedHelp**: 2패스는 "초대한 사람만 이 링크로 접속할 수 있습니다"였다. 이 모드에는 링크가 없으므로 "로그인해서 볼 수 있습니다"로 고쳤다.
2. **link.offConfirm**: 2패스는 "기존 링크가 즉시 만료됩니다"였다. 실제로는 끊기(`revoked`, 화면 표기 "꺼짐")이고 만료와 다르므로 "꺼집니다"로 고쳤다.
3. 고치지 않고 남긴 것(대표가 볼 것): 권한 이름이 "보기 / 의견 남기기"로 짧아졌다(제안은 "볼 수 있음 / 의견을 남길 수 있음"). 메일의 "의견을 남길 수도 있습니다"는 시안 의견만 말하고 대화는 말하지 않는다. "{email}님"은 주소에 존칭이 붙는다. 메일 맨 아래 줄은 실제로는 TWINGS가 대신 보낸 메일이다.
4. 메일 맨 아래 회사 줄은 기존 `companyLine()`이라 주소가 예전 본점(구로구)으로 나온다. 다른 거래 메일과 같은 문제이고 이 작업에서 바꾸지 않았다.

### 12.4 개인정보처리방침에 필요한 문장 (제안, 대표 판단)

약관·방침 문구는 바꾸지 않았다(`lib/legal/documents.ts` 그대로). 켜기 전에 방침에 아래 취지가 있는지 대표가 확인한다.

- 수집 항목·목적: "회원이 프로젝트에 다른 사람을 초대할 때 입력한 초대받는 분의 이메일 주소는 초대 메일 발송과, 그 프로젝트에 접근할 수 있는 사람 목록 표시에만 이용합니다."
- 보유 기간: "초대가 만료되거나 취소되거나, 초대받은 분의 접근이 해제될 때까지 보관합니다." (지금 구현은 행을 지우지 않고 `revoked_at`·만료로 끊는다. 이 문장대로라면 만료·해제 뒤 이메일을 지우는 정리 작업이 필요하다 — 12.6-3.)

### 12.5 확인 (2026-11-18, 브랜치 `claude/rooms-share-invite`)

- `npx tsc --noEmit` 통과.
- 새 테스트: `tests/brand-rooms/invites/service.test.ts`(발행 권한, 10개·하루 20·프로젝트 20 한도, 같은 주소 갱신, 재시도 멱등, 메일 내용·메일러 없음·실패·다시 보내기, 조직 초대 엄격 일치, 프로젝트 초대 1회 결합·만료·취소·플래그 꺼짐, 초대한 편집자 퇴장, 보기 손님의 모든 쓰기 경로, 권한 변경, 손님 벽, 내보내기와 알림), `schema.test.ts`(0097), `ui.test.tsx`(머리 공유 버튼, 창 기본값, 플래그 꺼짐 = 예전 창), `tests/brand-rooms/sandbox.test.ts`에 초대 블록(샌드박스 다섯 경우 404·쓰기 0, 스위치 꺼짐 404, 권한), `tests/brands/workspace-security.test.ts`에 0170 열 권한.
- 로컬 화면(가짜 메일러, 한 durable PGlite에 소유자·손님 서버를 번갈아): 소유자가 머리 "공유"로 두 주소 초대 → 메일 두 통 캡처 → 다른 계정(이메일 다름)으로 수락 → 프로젝트 룸에 손님으로 도착, 대화 작성 → 소유자 목록에 그 계정과 초대 주소 → 보기로 바꿈 → 손님 화면에 입력창 없음, API 403 → 내보냄 → 손님 룸 접근 불가. 시안 공유 창의 링크 모드 전환(기본 초대한 사람만, 누구나 → 14일 선택 → 링크 만들기 → 초대한 사람만 → 확인 → 열린 링크 0). 1440×900, 390×844. 브라우저 콘솔 오류 0.
- 후속(같은 날): 보기 손님 제한을 플래그와 무관하게, 수락 화면 로그인 전 줄, 작업대 손님 표. origin/main(`ce8486cd`)을 합친 뒤 전체 루프: `npx tsc --noEmit` 통과, `npx vitest run --maxWorkers=8` 610개 파일·6,299개 테스트 통과, `npm run db:local`, `npm run build:local` 통과, `npm run start:local`(3000) + `npm run sweep:anon` "SWEEP PASSED — 1453/1453 checks passed". 다시 찍은 화면: 새 초대가 "7일 후 만료"로 보이는 창(1440·390), 플래그를 끈 상태에서 보기 손님의 읽기 전용 룸(입력창 없음, 쓰기 API 403, 사람 API 404), 작업대 손님 표, 로그인 전 수락 화면.

### 12.6 대표 결정 필요

1. ~~보기 손님 제한을 플래그와 묶을지~~ 정했다(2026-11-18 검토): 늘 막는다. 이 코드가 배포되면 팀이 "보기"로 초대한 운영 손님은 플래그와 상관없이 룸에서 쓰지 못한다. 그런 손님에게 대화를 열어 주려면 팀이 의견 가능으로 다시 초대해야 한다.
2. **문안 확정**: 12.3 표(특히 권한 이름과 초대 메일). 외부 발송 문안이다.
3. **초대 이메일 보관**: 12.4의 보유 기간 문장과, 만료·해제 뒤 주소를 지우는 정리 작업을 둘지.
4. **이메일이 다른 계정의 결합**: 토큰을 가진 첫 계정이 들어온다. 링크가 전달되면 다른 사람이 들어올 수 있고, 초대한 사람이 목록에서 보고 내보낸다(대표 결정의 전제). 수락 화면과 메일에 그 사실을 한 줄씩 적었다.

### 12.7 하지 않은 것·남은 것

- 작업대의 손님 표는 읽기 전용이다. 팀이 손님을 내보내는 것은 지금처럼 관리자 워크스페이스 화면(`brandWorkspace.revokeAccess`)에서 한다.
- 미디어 주의(기존): 납품 영상은 추측 불가 키의 공개 버킷에 있어서, 이미 불러온 미디어 주소는 룸 접근 제어로 막히지 않는다. 내보낸 손님이 전에 받아 둔 주소는 계속 열린다. 이 작업에서 바꾸지 않았다.
- 빌드·스윕은 하지 않았다(별도 검증). 새 주소는 API 하나(`/api/brand-rooms/people`, 브랜드 호스트 허용 목록에 추가)라 엣지 게이트·스윕 변경은 없다.
