# 브랜드 스튜디오 계정 경로 워커

> `docs/BRAND-STUDIO-V2.md` §7의 `sunra_mcp` 경로를 실제로 돌리는 프로그램. 파일은 `scripts/brand-studio-lane-worker.mjs`.

## 무엇을 하나

Sunra에는 들어가는 길이 둘 있다. API 키로 쓰는 길(`sunra_api`, Vercel에서 바로 실행)과, 로그인한 계정의 구독 크레딧으로
쓰는 길(`sunra_mcp`)이다. 계정 쪽은 브라우저 로그인으로 받은 토큰이 15분마다 갱신되기 때문에 서버에 키 하나로 심을 수 없다.
그래서 `sunra` CLI가 로그인돼 있는 워크스테이션에서 이 워커가 대신 실행한다.

1. 5초마다 앱(`POST /api/brand-studio/lane`)에 "내 경로로 온 작업 있나"를 묻는다(`claim`). 묻는 것 자체가 생존 신호다.
2. 받은 작업을 CLI로 실행한다(`create_image` / `create_video`, 결과 자리 하나당 호출 하나).
3. 끝나면 결과 파일 주소를 앱에 돌려준다(`complete`). 앱이 내려받아 저장한다. 워커는 아무것도 보관하지 않는다.
4. 실패하면 이유와 함께 알린다(`fail`). 고객에게는 코드에 맞는 문장만 보인다.

워커가 90초 넘게 묻지 않으면 앱은 이 경로를 닫힌 것으로 보고, 아직 시작하지 않은 작업을 API 경로로 옮긴다.

## 실행

```bash
node scripts/brand-studio-lane-worker.mjs --env-file D:\dev\twings\.env.local
```

필요한 환경 변수(이름만, 값은 `.env.local`과 Vercel에만 둔다):

| 이름 | 뜻 |
| --- | --- |
| `STUDIO_LANE_URL` | 앱 주소. 운영은 `https://twings.app` (brand.twings.app에서는 이 경로가 열리지 않는다) |
| `BRAND_STUDIO_LANE_SECRET` | 앱(Vercel)과 같은 값 |
| `STUDIO_LANE_MAX` | 동시에 돌릴 작업 수. 기본 8. 계정 전체 한도는 20이고 **다른 내부 도구와 같이 쓴다** |
| `STUDIO_LANE_POLL_MS` | 묻는 간격. 기본 5000 |
| `STUDIO_LANE_PROJECT_ID` | Sunra 쪽 프로젝트. 없으면 "TWINGS Brand Studio"를 찾거나 만든다 |

상시 실행은 Windows 예약 작업으로 등록하고, 콘솔 창이 뜨지 않게 `quiet_run.pyw`로 감싼다(전역 지침의 Quiet Windows automation).

```text
pythonw.exe D:/dev/agent-harnesses/windows-background/agent-harness/quiet_run.pyw --log D:/dev/twings/.tmp/studio-lane.log -- node D:/dev/twings/scripts/brand-studio-lane-worker.mjs --env-file D:/dev/twings/.env.local
```

## 알아둘 것

- 계정 크레딧 1 = 정가 1센트로 계산해 사용량에 반영한다(2026-11-10 견적: Seedream 5.0 Pro 1K 5, 2K 9 · Nano Banana Pro 2K 14 ·
  Seedance 2.5 480p 4초 42, 720p 5초 117, 1080p 10초 571).
- 480p 시안은 `draft: true`, 1080p 완성은 시안의 작업 id를 `draft_source_task_id`로 넘긴다. "영상을 고친다"(edit)는 원본 길이를
  따르므로 시안이 될 수 없고 일반 480p로 나간다.
- 안전 검수는 Sunra 쪽에서 항상 돈다. 워커에 끄는 옵션은 없다.
- 고객 문장은 CLI에 stdin으로 넘긴다(셸 인용 문제 없음). 로그에는 작업 id와 종류만 남고 문장·주소·비밀값은 남기지 않는다.
- PC가 꺼지거나 CLI 로그인이 풀리면 이 경로만 멈춘다. `sunra status`로 로그인 상태를 본다.
- 서버에서 직접 계정 경로를 쓰도록 바꾸려면 Sunra OAuth 동의를 한 번 받아 갱신 토큰을 서버에 안전하게 보관해야 한다(후속).
