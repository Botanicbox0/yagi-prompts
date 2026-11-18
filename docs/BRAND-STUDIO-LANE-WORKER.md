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
- 480p 시안은 `draft: true`, 1080p 완성은 시안의 작업 id를 `draft_source_task_id`로 넘긴다. 원본 길이를 따르는 실행
  (`duration: -1`: "영상을 고친다"(edit), 길이를 고르지 않은 레퍼런스 새로 찍기)은 시안이 될 수 없다(CLI 설명: "Duration -1 cannot
  be a preview"). 그래서 두 경로 모두 이런 실행은 같은 값의 일반 480p로 계획하고 보낸다(`lib/brand-studio/reference-video.ts`
  `isDraftRun`). 결과에 "1080p로 완성"이 붙지 않고, 앱은 시안으로 계획된 실행의 시안 id만 저장한다(`lane-api.ts`, `finish.ts`).
  API 경로에서 `duration: -1` 시안이 되는지는 문서에 없고 시험한 적도 없다.
- 레퍼런스 영상은 계정이 직접 받은 파일만 받는다(바깥 주소는 "Reference video must be an uploaded asset", 2026-11-18). 워커는 생성
  전에 영상마다 한 번 `get_upload_url`로 자리를 받아, 앱 주소에서 내려받은 파일을 돌려받은 헤더 그대로 PUT하고 `asset_url`로
  바꿔 보낸다(무료, 50 MB 상한 = 스튜디오 업로드 상한, 받기 2분·올리기 3분 제한). 레퍼런스 이미지·오디오는 바깥 주소를 그대로 받는다.
  올리기에 실패하면 아무것도 쓰지 않은 채 `failed`로 끝난다(`provider_unavailable`은 계정 경로 전체를 10분 닫으므로 쓰지 않는다).
  매핑과 업로드는 `scripts/brand-studio-lane-mapping.mjs`에 있고 워커 옆에 있어야 한다. 워커 버전 2부터.
- CLI는 `--no-download`로 부른다. 끝난 파일을 워커 PC에 먼저 내려받게 두면 제공사 파일 서버가 느려서(연결당 초당 약 50KB)
  결과 확인 한 번이 수십 초씩 걸린다. 파일은 앱이 조각으로 나눠 직접 받는다.
- 안전 검수는 Sunra 쪽에서 항상 돈다. 워커에 끄는 옵션은 없다.
- 고객 문장은 CLI에 stdin으로 넘긴다(셸 인용 문제 없음). 로그에는 작업 id와 종류만 남고 문장·주소·비밀값은 남기지 않는다.
  오류 문장에 주소가 섞여 있으면 쿼리 문자열(서명)을 지우고 남긴다.
- PC가 꺼지거나 CLI 로그인이 풀리면 이 경로만 멈춘다. `sunra status`로 로그인 상태를 본다.
- 서버에서 직접 계정 경로를 쓰도록 바꾸려면 Sunra OAuth 동의를 한 번 받아 갱신 토큰을 서버에 안전하게 보관해야 한다(후속).
