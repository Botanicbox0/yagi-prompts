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
- "바로" 메일이 나갈 때 같은 사람·장소의 기한이 된 묶음 글도 함께 싣는다.
- 버튼 주소: 프로젝트는 `/brand/rooms/{projectId}?organizationId=…`, 일반 대화는 `/brand/rooms?organizationId=…&channel=general`. 여러 브랜드에 속한 사람이 다른 브랜드로 열리지 않게 조직을 붙인다.
- 수신 거부 주소는 twings.app 쪽에 있다(브랜드 호스트는 `/api/notify/unsubscribe`를 막는다). 메일 앱의 원클릭 수신 거부(POST)도 받는다. 이전에는 GET만 받아서, 메일에 붙어 나가던 원클릭 헤더가 동작하지 않았다.
- 사전(`messages/rooms-notices.ts`)의 문구는 임시 문구다. §9 초안과 모양이 다르다(제목 하나 + 일어난 일 줄 목록). 대표 확정본을 이 모양에 맞춰 N4에서 넣는다.

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

각 조각의 완료 기준은 AGENTS.md §3 검증 루프 전부와, 로컬에서 두 역할(고객·팀)로 실제 화면 확인이다. 메일은 로컬 가짜 메일러(`PLAYBOOK_FAKE_MAILER=1`)로 보낸 내용을 확인한다. 형식 검증(§11)은 하지 않는다: 결제·렌더·크레딧·정산·동의 상태에 닿지 않는다.

## 7. 확인하지 못한 것

- 운영에서 `BRAND_ROOMS`와 Slack 알림이 켜져 있는지(값은 코드로 알 수 없다).
- 브랜드 호스트(brand.twings.app)에서 서비스 워커와 푸시 구독이 실제로 되는지. 푸시 구독은 출처별이라 twings.app에서 한 구독과 별개다. N4에서 로컬과 프리뷰로 확인한다.
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

