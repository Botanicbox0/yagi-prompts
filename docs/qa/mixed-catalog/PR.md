## 템플릿 카탈로그 — 오리지널과 AI 크리에이티브 템플릿을 한 피드에 (docs/PLATFORM-2.0.md §7.5)

대표 요청(2026-10-30): "템플릿은 메이커 템플릿이랑 original template이랑 자연스럽게 섞여서 노출되게. maker 템플릿이 아래로 가니까 보기가 너무 길다. maker 템플릿에 들어가면 그 maker가 만든 거라는 명시와 제작자 프로필 볼 수 있게 정도 간단하게."

### 결정
- **그리드 하나.** `/{locale}/video`·`/{locale}/image`와 홈의 영상·이미지 레일에서 "TWINGS 오리지널 → AI 크리에이티브 컬렉션" 두 레일(PR #94)과 홈의 별도 크리에이티브 레일을 걷었다. 크리에이티브 템플릿은 매체에 맞는 레일 안으로 들어간다.
- **랭킹 하나 + 뭉침 방지.** 순서는 NEW(공개 14일) → 추천(`featured`) → 최신. 그 안에서 다른 출처에 카드가 남아 있는 동안 한 출처가 연달아 세 장을 넘지 않는다(`railOrder`, `ORIGIN_RUN_MAX = 3`). 데스크톱 4열이면 줄마다, 폰 2열이면 두 줄마다 두 출처가 함께 보인다. 출처마다 순서는 랭킹 그대로라 한 출처뿐인 목록(크리에이티브 프로필, 지금의 이미지 탭)은 예전과 똑같다. Pinterest·피드형 서비스가 쓰는 "같은 출처 N개 연속 금지" 다양성 규칙과 같은 방식이고, 정적 캐시 페이지라 결정적(deterministic)이다.
- **출처 칩("전체 · 오리지널 · AI 크리에이티브")은 없앴다.** 고객은 포맷을 보고 고르지 누가 만들었는지로 고르지 않는다. 칩 한 줄이 폰 첫 화면에서 카드 한 줄을 밀어낸다. 특정 크리에이티브의 템플릿을 찾는 사람은 그 사람 프로필(`/{locale}/makers/{handle}`, `twings.app/@handle`)로 온다. 목록의 필터는 기존 용도 칩 하나다.
- **카드**: 오리지널은 표시가 없다. 크리에이티브 템플릿은 제목 아래 `by @handle` 한 줄(기존), 레시피를 공개했으면 기존 레시피 칩. 가격 없음(AGENTS.md §5). 카드에 프로필 사진은 넣지 않았다. 사진 없는 크리에이티브의 색 모노그램이 그리드에 색 점을 찍기 때문이다(TASTE 규칙 1·2). 스윕·테스트용으로 카드에 `data-card-origin` 마커를 더했다.
- **템플릿 페이지**: 크리에이티브 템플릿은 제목 바로 아래 한 줄 — 프로필 사진 · "이 템플릿을 만든 AI 크리에이티브" · 이름(@handle) · "프로필 보기 →". 줄 전체가 프로필 링크다. #111의 하단 크리에이티브 카드(소개·장소·협업 가능)는 이 한 줄로 바꿨다. 그 정보는 프로필 페이지에 그대로 있다. #127이 정한 이야기 먼저 순서(영상 → 만드는 법 → 셀카 한 장이면)는 그대로다. 맨 아래 "@handle의 다른 템플릿" 레일은 남겼다. 비슷한 템플릿 레일과 겹치지 않고 첫 화면을 늘리지 않는다.
- 카탈로그 데이터 모양(`PromptCard`·`PromptCatalog`)은 바꾸지 않았다. 정렬은 화면에서 하므로 카탈로그 캐시 키(`v12-creative-cover`)는 그대로다.

### 바뀐 파일
- `components/prompts/card-frame.ts` — `railOrder`에 출처 섞기, `ORIGIN_RUN_MAX`
- `components/templates/listing.tsx` — 그리드 하나. `components/templates/origin-filter.tsx` 삭제, `filter-chips.tsx`의 출처 칩 이벤트 정리, `rails.tsx`의 `origin` prop·`data-rail-origin` 제거
- `app/(marketing)/[locale]/page.tsx` — 홈 영상·이미지 레일이 두 출처를 모두 싣고 크리에이티브 레일 삭제(히어로는 대표가 고른 오리지널 그대로)
- `app/(marketing)/[locale]/t/[slug]/page.tsx` — 제목 아래 크리에이터 한 줄, 하단 카드 삭제
- `messages/ko.ts`·`en.ts` — 레일·칩 키 8개 삭제, "프로필 전체 보기" → "프로필 보기"
- `scripts/sweep-anon.ts` — 두 레일 순서·칩 검사를 한 그리드·두 출처·연속 3장 이하·홈 레일·제목 아래 한 줄 검사로 교체
- `docs/PLATFORM-2.0.md` §7.5(설계 메모), §14.2·§20.1·§20.2 한 줄씩, `docs/design/TASTE.md` 기록 + 규칙 7, `AGENTS.md` §6 표 한 줄

### 스크린샷 (로컬 스냅샷, 같은 데이터로 before = main `0fa6140`, after = 이 브랜치)
| 화면 | before (main) | after (이 브랜치) | 페이지 높이 |
| --- | --- | --- | --- |
| `/ko/video` 375 | [01](docs/qa/mixed-catalog/01-before-video-ko-375.jpg) | [03](docs/qa/mixed-catalog/03-after-video-ko-375.jpg) | 3,841 → **3,353px** |
| `/ko/video` 1440 | [02](docs/qa/mixed-catalog/02-before-video-ko-1440.jpg) | [04](docs/qa/mixed-catalog/04-after-video-ko-1440.jpg) | 3,344 → **3,044px** |
| `/ko/t/cafe-window-timelapse` 375 (크리에이티브 템플릿) | [05](docs/qa/mixed-catalog/05-before-template-ko-375.jpg) | [07](docs/qa/mixed-catalog/07-after-template-ko-375.jpg) | 3,764 → **3,540px** |
| 같은 페이지 1440 첫 화면 | [06](docs/qa/mixed-catalog/06-before-template-ko-1440.jpg) | [08](docs/qa/mixed-catalog/08-after-template-ko-1440.jpg) | — |

로컬 스냅샷은 영상 10편(오리지널 7, 크리에이티브 3)이라 줄어든 높이는 칩 한 줄과 레일 제목 둘만큼이다. 크리에이티브 템플릿이 늘수록 차이가 커진다. 전에는 크리에이티브 템플릿이 전부 오리지널 아래에 따로 있었고, 지금은 3·5·7번째 자리에 섞인다(순서: 오리지널 2 → 크리에이티브 → 오리지널 → 크리에이티브 → …). 운영에는 오리지널이 더 많아서 연속 3장 규칙이 실제로 작동한다.

### 검증
| 단계 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run` | **353 파일 / 3,355 테스트 통과**. 먼저 실패하는 테스트를 쓰고 구현했다: 한 출처 연속 3장 제한(양방향), NEW 우선, 두 출처가 다 있는 동안 뭉침 없음(12:1·12:3·3:12·7:7·20:5), 한 출처 목록은 이전과 같음, 목록 그리드 하나·레일/칩/컬렉션 제목 없음·카드 `data-card-origin`, 템플릿 페이지 제목 아래 한 줄(제목과 만드는 법 사이, 한 번만, 소개·장소·협업 가능 문구 없음, ko/en), 사전에서 레일·칩 키 삭제 |
| `npm run build:local` | 통과 (`NEXT_PUBLIC_APP_URL=http://localhost:3117`) |
| `npm run start:local -- -p 3117` + `npm run sweep:anon` | **SWEEP PASSED — 1225/1225** (`SWEEP_BASE_URL=http://localhost:3117`). 새 검사: 목록 그리드 하나, `data-rail-origin`·출처 칩·컬렉션 제목 없음, 두 출처가 한 그리드에, 연속 3장 이하, 홈에 별도 크리에이티브 레일 없음·영상 레일에 크리에이티브 카드, 템플릿 페이지 크리에이터 줄 한 번·제목과 설명 사이·프로필 링크 |
| GitHub Actions | 계정 결제 문제로 체크가 시작되지 않는다(10-29부터). 위 로컬 루프로 대신했다 |

건너뛴 것: 실제 운영 데이터(프롬 퀸·이미지 세트·@yunseolfromseoul 템플릿)로는 보지 않았다 — 로컬 스냅샷만. 크리에이티브가 사진을 올린 경우의 템플릿 페이지 아바타는 테스트로만 확인했다(로컬 픽스처는 모노그램).

### 대표 결정 필요
- 없음(이 PR 범위). 참고: 템플릿 페이지의 "검증됨" 배지 설명은 아직 "스튜디오 검수를 통과한 템플릿입니다"다. 셀프 공개(`TWINGS_MAKER_SELF_PUBLISH`, 운영 off)가 켜지면 크리에이티브 템플릿에는 맞지 않는 문장이 된다. §20.6의 문구 정리 범위로 따로 남긴다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
