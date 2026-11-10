# 프로젝트 룸 명령줄 (`scripts/twings-room.mjs`)

야기 팀이 터미널에서 프로젝트 룸에 올리는 도구다(docs/BRAND-ROOMS.md §5). Node만 있으면 되고 의존성은 없다.
서버 쪽 문은 `POST /api/brand-rooms/ingest`(lib/brand-rooms/ingest.ts)이고, 서버 비밀값 `BRAND_ROOM_INGEST_SECRET`으로만 열린다.
비밀값이 없거나 틀리면, `BRAND_ROOMS`가 꺼져 있으면, 샌드박스 조직의 프로젝트면 모두 404다. brand.twings.app에서는 이 주소에 닿지 않는다.

## 준비

환경 파일 하나(예: `~/.twings-room.env`, 저장소 밖)에 두 줄을 둔다. 값은 Vercel과 `.env.local`에 있는 것과 같고, 채팅·커밋·로그에 옮기지 않는다. 스크립트는 값을 출력하지 않는다.

```text
ROOM_INGEST_URL=https://twings.app
BRAND_ROOM_INGEST_SECRET=<서버와 같은 값>
```

로컬 서버에 올릴 때는 `ROOM_INGEST_URL=http://localhost:<포트>`. 출력하는 관리자·브랜드 주소의 호스트는 twings.app이면 admin.twings.app·brand.twings.app, 그 밖에는 같은 주소다(`ROOM_ADMIN_ORIGIN`, `ROOM_BRAND_ORIGIN`으로 바꿀 수 있다).

## 스토리보드 올리기

```text
node scripts/twings-room.mjs storyboard push --project <프로젝트 id> --title "봄 런칭 필름" --dir <폴더> [--share] [--version-of <스토리보드 id>] [--env-file <경로>]
```

- 폴더의 그림(`01.png, 02.jpg, …`, jpg·png·webp, 한 장 25MB까지)을 이름 순서(숫자는 값 순서: `2` 다음 `10`)로 읽어 컷을 만든다. 보드당 200컷까지.
- 컷의 글은 `board.json` 또는 `board.md`에서 읽는다. 둘 다 없으면 그림만 올린다. 글의 수와 그림의 수가 다르면 멈춘다.
- 기본은 **임시 저장**이라 브랜드에게 보이지 않는다. 관리자 화면에서 확인한 뒤 공유하거나, `--share`로 바로 공유한다(공유하면 룸 대화에 한 줄이 남는다).
- `--version-of <id>`를 주면 그 스토리보드의 다음 버전(2차, 3차 …)으로 올라가고, 브랜드 화면에 "바뀐 컷"이 표시된다.
- 만든 사람은 야기 팀(`created_role = 'studio'`, `source = 'cli'`)으로 남는다.
- 끝나면 보드의 관리자 주소와 브랜드 주소를 출력한다. 그림이 깨졌거나 도착하지 않은 컷은 빠지고 그 파일 이름을 알려 준다.

`board.json` — 그림마다 하나, 순서대로. `{ "title": "…", "cuts": [ … ] }` 모양도 된다.

```json
[
  { "scene": 1, "shot": 1, "description": "하이키 화이트 스튜디오. 병이 천천히 돈다.", "camera": "느린 푸시 인, 85mm", "audio": "잔잔한 피아노", "seconds": 2.5 },
  { "scene": 1, "shot": 2, "description": "라벨에 빛이 스친다.", "seconds": 1.5 }
]
```

`board.md` — 맨 위 `# 제목`(있으면 `--title` 대신 쓴다), 그림마다 `## ` 섹션 하나. 섹션 안의 `키: 값` 줄은 scene(장면), shot(컷), camera(카메라), audio(sound·사운드·대사), seconds(length·길이, `2.5`·`2.5s`·`2.5초`)이고 나머지 줄은 설명이다.

```markdown
# 봄 런칭 필름

## 오프닝
scene: 1
shot: 1
camera: 느린 푸시 인, 85mm
seconds: 2.5
하이키 화이트 스튜디오. 프렌치 블루 병이 천천히 돈다.

## 라벨
scene: 1
shot: 2
라벨에 빛이 스치며 로고가 또렷해진다.
```

## 동작 순서 (스크립트가 하는 일)

1. `storyboard.push` — 임시 저장 보드와 그림마다 예약된 컷을 만들고, 그림을 보낼 주소를 받는다(운영: 서명된 업로드 주소, 로컬: 같은 문의 `?upload=<컷 id>`).
2. 그림을 4장씩 동시에 보낸다.
3. `storyboard.finish` — 도착한 그림을 바이트로 확인·측정해 컷으로 만든다. 한 번에 12컷씩 처리하므로 남은 컷이 없을 때까지 다시 부르고, 마지막에 `--share`면 공유한다.

## 시안 올리기

```text
node scripts/twings-room.mjs review push --project <프로젝트 id> --title "봄 런칭 필름 1차" --file <파일> [--version-of <시안 id>] [--env-file <경로>]
```

- 영상(mp4, mov)은 **200MB까지**, 이미지(png, jpg, webp)는 50MB까지. 넘으면 아무것도 보내기 전에 "film.mp4 is 230.4 MB; a film can be at most 200 MB."처럼 알려 주고 멈춘다. 영상 길이는 10분까지(서버가 확인한다).
- 프로젝트 룸의 시안 탭에 바로 올라가 브랜드가 의견을 남길 수 있다. `--version-of <시안 id>`를 주면 그 시안의 다음 버전(v2, v3 …)으로 쌓인다.
- 만든 사람은 야기 팀으로 남고, 끝나면 시안의 관리자 주소와 브랜드 주소를 출력한다.
- 순서: `review.push`(보낼 주소: 운영은 서명된 주소, 로컬은 같은 비밀값을 붙여 `PUT /api/brand-rooms/reviews/upload?key=…`) → 파일 보내기 → `review.finish`.

## 아직 없는 명령

`message post`(대화에 야기 팀 이름으로 한 줄 남기기)는 아직 없다. 대화 서비스(lib/brand-rooms/messages.ts)의 작성은 사람(관리자 프로필) 기준이라 명령줄에는 작성자가 없고,
몇 줄로 붙이면 대화 쪽 규칙(멘션, 알림, 중복 방지)을 건너뛰게 된다. 대화 슬라이스가 작성자 없는 야기 팀 줄을 받는 함수를 내면 `INGEST_OPERATIONS`에 한 줄과 이 스크립트의 명령 하나로 붙인다.
