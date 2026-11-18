# 브랜드 스튜디오 v2 — 실제로 만들어지는 스튜디오

> 2026-11-10 대표 지시로 시작. 설계 원본은 이 문서, 요청·응답 규격은 `lib/brand-studio/contracts.ts`,
> 모델 목록은 `lib/brand-studio/models.ts`. 셋이 다르면 코드가 맞고 이 문서를 고친다.
> 브랜드 제품 전체 그림은 `docs/BRAND-PRODUCT.md`, 디자인 규칙은 `docs/design/IDENTITY.md`·`TASTE.md`·`TOOLBOX.md`.

## 1. 왜 다시 만드나

2026-11-10 점검에서 `/brand/studio`(`components/brand-workspace/brand-brief-studio.tsx`, 21,633줄)는 서버 호출이
3개뿐이고 모델을 부르지 않는 데모였다. 이미지 "생성"은 올린 사진이나 데모 파일을 돌려주고 영상은 가짜 대기 표시만
띄운다. 실제 렌더 경로(계약 템플릿 → Seedance)는 숨겨져 있고, 스튜디오 결과를 캠페인으로 넘길 방법이 없다.
브랜드 계정이 "무엇을 할 수 있는지 안 보인다"는 대표의 지적은 정확했다.

v2는 기존 파일을 고치지 않고 **새 파일**(`lib/brand-studio/*`, `components/brand-studio/*`, `app/api/brand-studio/*`)로
만들고 플래그 `BRAND_STUDIO_V2=on`으로 연다. 플래그가 꺼져 있으면 운영 화면과 테스트는 지금과 같다.

## 2. 대표 결정 (2026-11-10)

| 항목 | 결정 |
| --- | --- |
| 개발 주체 | Argon(Antigravity)은 당분간 개발에 쓰지 않는다. 설계·리뷰·배포는 Fable, 구현은 Opus 5.5 xhigh 세션. |
| 기본 화면 | 영상 우선 4블록 디렉터 대신 **세 문**: 만들기 · 포맷 · 캠페인. |
| 생성 제공사 | **Sunra만.** Higgsfield는 CLI·MCP·크레딧 어느 것도 쓰지 않는다. |
| 경로 | 테스트 조직(야기워크숍 테스트)은 Sunra 계정 경로, 동시 실행이 한도를 넘으면 다른 경로로 넘긴다(§7). |
| 프롬프트 보강 | Gemini 3.8 Flash, 모델별 문법으로 자동 보강. 기본 켜짐. |
| 에셋 | 회사 에셋으로 등록해 두고 오른쪽 패널에서 끌어다 참조로 쓴다(공동창업자 서비스에서 가져온 방식). |
| 영상 | 레퍼런스 영상을 넣고, 무엇을 유지·변경할지와 사운드 방식(함께 생성 / 음악 없이 / 무음)을 고른다. |
| Seedream 5.5 | 2026-11-09 발표. Sunra 두 경로 모두 아직 목록에 없어 `awaiting_provider`로 등록만 해 둔다(§4). |
| 모픽 격리 | §3. 어기면 즉시 롤백. |
| 배포 | Fable이 실제 화면으로 리뷰해 통과하면 배포한다. Toss 구독 심사 표면은 건드리지 않는다(§13). |

대표 결정이 아직 필요한 것은 §14.

## 3. 절대 하드라인 — 모픽(Morphic) 격리

1. 모픽 조직(`lib/brands/features.ts`의 `SANDBOXED_CLIENT_ORG_IDS` 두 개와 이름에 Morphic/모픽이 들어간 조직)에게는
   자체 생성형 스튜디오의 존재도, 모픽 캠페인을 B2B 영업에 쓰는 모습도 보이지 않는다.
2. `SANDBOXED_CLIENT_ORG_IDS`, `DEFAULT_SANDBOX_DENIED`, `isSandboxedClientOrganization`을 지우거나 약하게 만들지 않는다.
   v2의 모든 페이지·API·홈 구성은 이 가드를 **먼저** 본다.
3. 모픽 계정은 `/brand`에서 캠페인 관리 화면에 머문다. 스튜디오(`/brand/studio`), 브랜드 키트(`/brand/identity`),
   전용 템플릿 제작 의뢰(`template_build`), `CampaignMoatShowcase`, 그리고 v2의 세 문·에셋 패널·"캠페인으로 보내기"는
   하나도 보이지 않는다. API는 `feature_unavailable`을 404로 답한다(존재를 알리지 않는다).
4. 일반 B2B 화면의 예시·빈 상태·쇼케이스에 모픽 캠페인 영상이나 "글로벌 AI 플랫폼 · 영상 9편 · 200만 뷰+" 문구를
   쓰지 않는다. 야기 인하우스 에셋만 쓴다. v2 빈 상태는 미디어 없이 예시 문장만 둔다.
   범위는 로그인한 워크스페이스다. 공개 마케팅 페이지(`/[locale]/brands`의 사례와 실적 수치)는 그대로 둔다
   (2026-11-10 대표 결정).
5. `tests/brand-studio/sandbox.test.ts`가 1~4를 고정한다. 이 테스트를 약하게 고쳐서 통과시키지 않는다.

## 4. 모델

`lib/brand-studio/models.ts`가 유일한 목록이다. 화면의 모델 칩, 비율·해상도 선택, 검증, 견적이 모두 여기서 나온다.

| id | 용도 | Sunra API | Sunra 계정 경로 |
| --- | --- | --- | --- |
| `seedream-5-pro` (기본 이미지) | 제품·인물 사진 | `bytedance/seedream-5.0-pro` | `seedream-5-pro` |
| `nano-banana-pro` | 글자·로고, 부분 수정 기본 | `google/gemini-3-pro-image` | `nano-banana-pro` |
| `seedream-5-flash` | 빠른 시안 | `bytedance/seedream-5.0-flash` | 없음 |
| `seedream-5.5` | 대기 | (미확정) | 없음 |
| `nano-banana-2.1` (2026-11-19 공개) | 글자 많은 컷, 참고 사진 여러 장, 낮은 크레딧 | `google/gemini-nano-banana-2.1` | `nano-banana-2.1` |
| `seedance-2.5` (영상) | 텍스트·이미지·레퍼런스·편집, 480p 시안 → 1080p | `bytedance/seedance-2.5` | `seedance-2.5` |

- 입력 규격 전문은 `docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt`(카탈로그에서 뽑은 원문). 추측하지 말고 이 파일과
  `https://docs.sunra.ai/llms-full.txt`를 본다.
- 이미지는 요청 한 번에 한 장이다. 장수 N은 요청 N개로 보낸다.
- 안전 검수(`enable_safety_checker`)는 항상 켠다. 끄는 코드 경로를 만들지 않는다.
- Seedream 5.5: 2026-11-10 기준 ModelArk에도 없다(계정의 `GET {ARK_BASE_URL}/models` 60개 중 최신 Seedream은
  `dola-seedream-5-0-flash-260915`, `dola-seedream-5-0-pro-260628`). `npm run studio:catalog`가 Sunra 카탈로그에서 새 모델을 찾아 알려 준다. 목록에 뜨면 규격을 다시 읽고
  `availability: 'live'`로 바꾼 뒤 한 장 스모크로 확인한다. 고객 화면에는 그 전까지 나타나지 않는다.
- 고객 화면에 보이는 것은 모델의 제품명뿐이다. 제공사(Sunra), 경로, 엔드포인트, 내부 id는 보이지 않는다.

## 5. 화면 구조

### 5.1 `/brand` 홈 — 세 문 (플래그 켜짐 + 스튜디오 열린 조직만)

캠페인 목록 위에 카드 세 장. 문 하나에 동작 하나.

| 문 | 누르면 | 한 줄 |
| --- | --- | --- |
| 만들기 | `/brand/studio` | 이미지와 영상을 만든다 |
| 포맷 | `/brand/studio?tab=formats` | 크리에이터가 따라 찍을 영상 틀을 고르거나 의뢰한다 |
| 캠페인 | `/brand/projects/new` (캠페인이 있으면 목록으로 스크롤) | 크리에이터와 함께 퍼뜨린다 |

플래그가 켜진 조직에서는 `CampaignMoatShowcase` 자리에 세 문이 온다. 모픽·생성 차단 조직은 지금 화면 그대로다.

### 5.2 `/brand/studio` — 만들기

```
┌──────────────────────────────────────────────┬────────────────┐
│ [만들기] [포맷]                     사용량 ▓▓░ │  에셋            │
│                                              │  검색 · 역할 칩   │
│  결과 보드                                     │  ┌──┐┌──┐┌──┐   │
│  - 요청 한 번이 한 묶음(프롬프트 한 줄 + 결과들)     │  └──┘└──┘└──┘   │
│  - 진행 중 카드: 자리 비율 그대로, 단계 문구         │  끌어서 참조로    │
│  - 빈 상태: 예시 문장 3개(누르면 입력창에 들어감)    │  [올리기]        │
├──────────────────────────────────────────────┤                │
│  참조 트레이  [이미지 1 · 제품 ✕] [영상 1 ✕] (+)  │                │
│  ┌ 무엇을 만들까요? ─────────────────────────┐ │                │
│  └────────────────────────────────────────┘ │                │
│  이미지|영상  모델▾  비율▾  해상도▾  장수/길이      │                │
│  사운드▾(영상)  보강 ●            예상 ₩1,300  [만들기] │            │
└──────────────────────────────────────────────┴────────────────┘
```

- **프롬프트 독은 하나.** 이미지와 영상은 같은 독에서 토글로 바꾼다. 화면에 채워진 버튼은 "만들기" 하나.
- **참조 트레이**: 에셋 패널이나 결과 보드에서 끌어다 놓거나(타입 지정 드래그), 누르거나, 파일을 끌어 놓거나, 붙여넣는다.
  칩은 순서대로 "이미지 1", "이미지 2", "영상 1". 칩을 누르면 역할(제품·인물·로고·스타일·장소)과
  "가져올 것 / 빼둘 것" 메모를 적을 수 있다(기본은 접힘). 프롬프트에서 "이미지 3"을 썼는데 3번이 없으면 보내기 전에 막는다.
- **보강**: 기본 켜짐. 결과 묶음의 "보낸 프롬프트 보기"에서 원문과 보강본을 볼 수 있다. 끄면 원문 그대로 보낸다.
- **예상 사용량**: 만들기 전에 이번 실행의 예상 사용량을 원 단위로 보여 준다(§9). 한도가 0이면 독 대신 안내를 보여 준다.
- **결과 보기**(결과를 누르면): 크게 보기, 그리고 동작 여섯 개 —
  부분 수정 · 같은 설정으로 다시 · 영상으로(이미지를 시작 장면으로) · 에셋에 저장 · 캠페인으로 보내기 · 내려받기.
- **부분 수정**(이미지): 그림 위에 상자를 그리고 무엇을 바꿀지 적는다. 상자 밖 픽셀은 바뀌지 않는다(§8).
- **레퍼런스 영상**(영상 모드에서 영상이 트레이에 있으면 패널이 열린다):
  1. 읽은 내용: 길이, 컷 수, 카메라, 사운드(음악·말·효과음 유무) 두세 문장.
  2. 방식: "이 영상을 고친다"(원본 유지, 말한 것만 변경) / "이 영상처럼 새로 만든다".
  3. 유지할 것: 카메라 · 컷 타이밍 · 구도 · 동작 · 룩 (칩, 복수 선택).
  4. 바꿀 것: 자유 입력 + 참조 이미지(제품·인물)를 트레이에 추가.
  5. 사운드: 함께 생성(음악 포함) / 음악 없이 현장음만(음악은 나중에) / 무음.
  6. 먼저 480p 시안 → 마음에 들면 "1080p로 완성".
- **권한**: viewer·guest는 보드와 에셋을 보기만 한다. 만들기·올리기는 owner·editor.
- **모바일**: 에셋 패널은 아래에서 올라오는 시트, 독은 아래 고정.

### 5.3 `/brand/studio?tab=formats` — 포맷

지금 숨겨져 있는 실제 경로(계약 템플릿 제작, `ProductionCreate`)를 꺼내 보여 주고, 계약이 없으면 두 가지 시작점을 준다:
"내 영상으로 포맷 만들기"(만들기의 레퍼런스 영상 흐름으로) · "전용 포맷 의뢰"(`/brand/projects/new`의 `template_build`).
메이커 템플릿을 브랜드가 골라 쓰는 흐름은 로열티 결정(PLATFORM-2.0 §13-2) 뒤로 미룬다.

### 5.4 컴포넌트 규칙 (seed-design에서 배운 것)

- 변형×크기는 명세로 고정하고 임의 스타일을 붙이지 않는다. 버튼: `solid`(화면에 하나) · `soft` · `ghost`, 크기 `sm`·`md`.
- 상태는 `data-*` 속성으로 표현한다(`data-state="pending"`, `data-selected`, `data-disabled`, `data-drop-target`).
  스윕과 테스트가 같은 속성을 본다.
- 눌림 피드백만 준다: 150ms, 살짝 줄어듦. hover 장식은 최소.
- 색은 토큰만. TWINGS 블루 하나(#3875C5, 글자는 #3063A7), 흰 바탕 + 반투명 패널, Pretendard Variable. 빨강 금지.
- 진행 중 카드는 결과와 같은 비율의 자리를 먼저 잡는다(레이아웃이 튀지 않는다).
- 문구는 전부 `messages/ko.ts`·`messages/en.ts`의 `brandStudio` 아래. 내부 용어(lane, provider, queue, Sunra, MCP,
  token, endpoint, draft_task_id)는 화면에 쓰지 않는다. 새 화면 한국어는 Gemma 4로 다듬고 사실은 Fable이 확인한다.

## 6. 데이터

마이그레이션 `0076_core_brand_studio.sql`(스키마) + `0077_core_brand_studio_film.sql`(에셋에 영상 읽기 결과 보관) +
`0152_glue_brand_studio.sql`(RLS: 서비스 롤만, 정책 없음 = 닫힘). 운영 적용 여부는 `supabase/README.md` 원장을 본다.

- `brand_studio_assets` — 회사 에셋. `id, organization_id, kind(image|video|audio), role(null 가능), name, tags text[],
  mime, size_bytes, width, height, duration_ms, storage_key unique, thumb_key, sha256, source(upload|generation),
  source_output_id, status(pending|ready), created_by, request_id, created_at, deleted_at`.
  같은 조직의 같은 `sha256`은 하나로 접는다(삭제되지 않은 것 기준 unique). 삭제는 soft delete.
- `brand_studio_jobs` — 요청 한 번. `id, organization_id, created_by, request_id, kind, status, lane, model,
  prompt, final_prompt, enhance, params jsonb(aspect·resolution·seconds·audio·count·method·keep·change·box),
  refs jsonb, parent_output_id, estimate_usd, cost_usd, estimate_krw, error_code, error_detail(내부용), work jsonb(중간 상태:
  부분 수정 계획, film sheet), claimed_at, created_at, started_at, finished_at`.
  `(organization_id, created_by, request_id)` unique = 멱등.
- `brand_studio_outputs` — 결과 자리 하나. `id, job_id, organization_id, idx, kind, status(pending|ready|failed),
  provider_task_id, draft_task_id, storage_key, thumb_key, mime, bytes, width, height, duration_ms, is_draft,
  saved_asset_id, created_at, deleted_at`.
- `brand_studio_allowances` — 조직별 한도. `organization_id pk, monthly_cap_krw, preferred_lane(null|sunra_api|sunra_mcp),
  note, updated_by, updated_at`. 행이 없으면 `BRAND_STUDIO_DEFAULT_MONTHLY_KRW`(기본 0 = 닫힘).
- `brand_studio_lanes` — 경로 상태. `lane pk, seen_at, info jsonb`(계정 경로 워커의 생존 신호).

저장소: 결과와 에셋은 `StudioMediaStore`(새 모듈)로 쓴다. 운영은 R2 공개 버킷에 **추측할 수 없는 256비트 난수 키**
(`st/<hex>.<ext>`, 목록·색인 없음, 삭제 시 객체도 삭제), 로컬은 `.storage/` + 게이트웨이. Supabase 스토리지를 쓰지 않는
이유는 2026-11-02 egress 한도 초과로 로그인까지 막혔던 사고 때문이다. 비공개 버킷 + 서명 URL은 후속(§14).

## 7. 실행 — 경로와 대기열

경로(lane)는 둘이다. 고객에게는 보이지 않는다.

| 경로 | 무엇 | 실행 주체 | 동시 한도 |
| --- | --- | --- | --- |
| `sunra_api` | `SUNRA_API_KEY`로 `api.sunra.ai` 큐에 제출, 웹훅 + 폴링 | Vercel 함수 | `BRAND_STUDIO_API_CONCURRENCY`(기본 20) |
| `sunra_mcp` | Sunra 계정(구독 크레딧)으로 생성 | 워크스테이션의 워커(`scripts/brand-studio-lane-worker.mjs`)가 로그인된 `sunra` CLI로 실행 | `BRAND_STUDIO_MCP_CONCURRENCY`(기본 20) |

- 선호 경로 = `brand_studio_allowances.preferred_lane` → 없으면 `BRAND_STUDIO_DEFAULT_LANE`(기본 `sunra_api`).
  야기워크숍 테스트 조직은 `sunra_mcp`로 둔다.
- 라우터: 선호 경로가 열려 있고(키가 있거나, 워커 신호가 90초 안) 한도 아래면 거기로. 아니면 다른 경로로. 둘 다 찼으면
  `held`로 두고 자리가 나면 오래된 것부터 보낸다. 조직 하나가 열어 둘 수 있는 작업은 6개.
- `video_final`은 시안을 만든 경로를 그대로 쓴다(제공사 제약).
- 계정 경로 워커가 죽으면(신호 90초 초과) 그 경로에 배정돼 아직 시작 안 한 작업은 API 경로로 옮긴다.
- 진행: `after()`(생성 직후) + 웹훅(`/api/brand-studio/webhook`) + 클라이언트 폴링(이미지 3초, 영상 8초, 폴링 요청이 열린
  작업을 한 걸음 전진) + 하루 한 번 크론 청소. Vercel Hobby라 분 단위 크론은 없다.
- 실패한 작업과 취소한 작업은 사용량에서 뺀다. 제공사 잔액 부족은 `provider_unavailable`로 답하고 서버 로그에
  `studio_provider_balance`를 남긴다(고객에게 제공사 사정을 말하지 않는다).
- **잔액 부족이면 경로를 바꾼다.** 한 경로가 돈을 못 내면(API 계정 잔액 0, 계정 크레딧 소진) 그 경로를 10분 닫고 작업을 다른 경로로
  한 번 옮긴다. 둘 다 닫혔으면 `provider_unavailable`. `video_final`은 옮기지 않는다.
- **결과 파일은 조각으로 나눠 동시에 받는다.** 2026-11-10 실측에서 제공사 파일 서버가 연결 하나당 초당 약 50KB였다(2K PNG가 2분 제한을
  넘겨 결제된 결과를 잃었다). 범위 요청 10개를 동시에 보내고, 저장에 실패한 결과는 세 번까지 다시 시도한다(이미 과금된 결과다).
- 취소는 제공사에 넘어가기 전(`held`·`queued`)에만 된다. 결과 삭제는 파일까지 지운다.
- 영상은 기본이 480p 시안이다. 모델 기본값(720p)으로 두면 설정 없이 누른 한 번이 시안의 두 배 넘게 든다.
- 로컬·테스트는 `BRAND_STUDIO_PROVIDER=fake`: 돈을 쓰지 않고 몇 초 뒤 자리표시 결과를 돌려준다. 운영 기본은 `live`.

## 8. 지능 — 보강, 영상 읽기, 부분 수정

### 8.1 프롬프트 보강 (`lib/brand-studio/enhancer`)

Prompt Architect. 고객 문장과 참조를 Gemini(`gemini-4-hydrogen`, `BRAND_STUDIO_ENHANCER_MODEL`로 바꿀 수 있음)에 구조화 출력으로
보내 고른 모델의 문법으로 다시 쓴다. 출력은 `{prompt, notes}`. Gemini가 실패하거나 검사에 걸리면 **결정적 조립**(`fallback.ts`)으로
내려간다. 보강 실패가 생성을 막지 않는다.

- **규칙의 원본은 코드다.** 모델별 문법은 `lib/brand-studio/enhancer/profiles/`의 파일이 하나뿐인 원본이다
  (`core.ts`, `seedream.ts`, `nano-banana.ts`, `gpt-image.ts`, `seedance.ts`, 실행 종류별 `tasks.ts`, 인물 피부 `skin.ts`).
  파일마다 머리말에 `version`, 대상 모델, 근거(`sources`: 주소, 읽은 날, 근거가 되는 주장), `lastVerified`가 있고 규칙에는
  `[official]`·`[aggregator]`·`[house]`·`[founder: 날짜]` 표시가 붙는다. 여기에는 규칙을 다시 적지 않는다.
- **찾는 순서**: 모델 id(`MODEL_BLOCKS`: Nano Banana Pro·2.1, GPT Image 2.6) → 모델 계열(`promptProfile`).
- **바꾸는 법**: 규칙을 고치면 그 파일의 `version`을 올리고 `profiles/CHANGELOG.md`에 한 줄을 쓰고,
  `npx tsx scripts/architect-eval.ts <env> --refs <dir> --label after`의 전후 표를 PR에 붙인다(텍스트만, 이미지 생성 없음).
  모델 버전이 바뀌면 `npm run studio:catalog`와 각 `sources`를 다시 읽고 `lastVerified`를 고친다.
- **기록**: 작업마다 `work.enhancer = { profile, profileVersion, coreVersion, llmModel, source, fallbackReason?, skinMode,
  toneMatch, skinVariant? }`가 남는다(내부용, 고객에게 보이지 않음).
- **알려진 빈틈**: 템플릿 이미지 세트(`lib/prompts/image-templates.ts`, 관리자 세트 등록)는 Prompt Architect를 거치지 않는다.
  피부 규칙은 세트 프롬프트를 쓰는 사람이 직접 넣어야 한다.

### 8.2 레퍼런스 영상 읽기 (`lib/brand-studio/film-sheet`)

Gemini 3.8 Flash에 영상을 넣어 `FilmSheet`(샷 구간, 프레이밍, 카메라, 동작, 룩, 사운드 유무, 요약)를 받는다.
실패하면 `null`을 돌려주고 흐름은 계속된다(화면은 "읽은 내용" 없이 진행). 내부 Video-Creator에서 쓰는
"먼저 재고, 그다음 고친다" 순서를 고객 흐름으로 옮긴 것이다.

### 8.3 부분 수정 (`lib/brand-studio/region-edit`)

1. 상자를 모델이 받는 비율 중 가장 가까운 것으로, 주변 맥락을 포함해 넓힌다(그림 밖으로 못 나가면 그림 전체를 쓴다).
2. 그 영역을 잘라 긴 변 1,536~2,048px로 키운다.
3. 편집 모델(기본 Nano Banana Pro)에 보낸다. 브랜드 원본(로고·제품)이 참조에 있으면 2번 그림으로 같이 보낸다.
4. 결과를 영역 크기로 줄이고, 테두리 띠의 평균 밝기·색을 원본에 맞춘다.
5. 고객 상자 **안쪽으로** 부드럽게 겹쳐 합성한다. 출력은 PNG.
- 불변 조건: 상자 밖 픽셀은 원본과 1비트도 다르지 않다. 테스트가 가짜 편집 함수로 이를 검사한다.
- `sharp`만 쓴다(Vercel 함수에서 동작해야 한다).

### 8.4 검수에 막혔을 때 한 번 더 (`lib/brand-studio/enhancer/blocked.ts`, `block-retry.ts`)

제공사 안전 검수는 그림이 아니라 낱말에 반응하는 일이 잦고, 같은 요청이 두 번째에는 그냥 통과하기도 한다(2026-11-10 대표 지시).
그래서 결과가 전부 검수에 막힌 실행은 **딱 한 번** 다시 보낸다.

- Gemini 3.8 Flash가 막힌 문장을 보고 둘 중 하나를 답한다.
  - **다시 쓰기**: 장면·순서·카메라·참조 번호·화면 속 글자는 그대로 두고, 검수가 오해할 낱말만 바꾼다(몸 대신 옷과 동작으로,
    "shoot"→"film", "seductive"→"confident", 실존 인물·타사 이름 삭제). 나이는 절대 바꾸지 않는다.
  - **멈춤**: 요청 자체가 검수가 막으려는 것(성적 내용, 미성년자, 폭력, 실존 인물 흉내, 타사 상표, 기만, 불법)이면 다시 보내지 않는다.
- Gemini에 닿지 못하면 같은 문장으로 한 번 더 보낸다. 참조 번호를 잃은 재작성은 버리고 원문으로 보낸다.
- 재시도도 같은 검수를 그대로 거친다. 안전 검수는 켠 채이고, 위장(오타, 은어, "픽션" 포장)은 규칙으로 금지한다. **검수를 우회하는
  기능이 아니다.** 두 번째에도 막히면 실패로 끝나고 사용량은 0이다. 세 번째는 없다. 1080p 완성은 다시 쓰지 않는다.
- 바꿔 보낸 문장은 결과의 "보낸 프롬프트 보기"에서 고객이 그대로 볼 수 있다. 막힌 원문은 `work.blockedPrompt`에 내부용으로 남는다.
- 참조가 붙은 실행이 막히면 화면은 "참조한 사진이나 영상 때문일 수 있어요"라고 알려 준다. 2026-11-10 실측: 사람이 나오는 참고 영상은
  문장을 그대로 두고 다시 보내도 막혔다(낱말이 아니라 자료가 이유인 경우).
- 두 경로 모두 같다: API 경로는 결과 조회에서, 계정 경로는 워커의 실패 보고에서 재시도가 걸린다.

## 9. 한도와 사용량

- 조직별 월 한도(원)는 관리자가 넣는다(`/admin` 조직 페이지 패널, 오퍼레이션 `brand_studio.allowance.set`).
  행이 없고 기본값도 0이면 스튜디오는 열려 있되 만들기 자리에 "아직 사용 한도가 열리지 않았어요" 안내가 나온다.
- 사용량(원) = 제공사 원가(USD) × 환율 × (1 + 마진). 환율과 마진은 기존 상수(`lib/twings/cost-model.ts`,
  `lib/brands/production/pricing.ts`)를 그대로 쓴다. 새 가격을 만들지 않는다. 이 숫자는 결제가 아니라 월 한도 차감이다.
- 생성 요청 시 예상액을 예약한다(조직 행 잠금, 초과하면 `allowance_exhausted`).
- **버튼에 보인 값이 곧 차감되는 값이다(2026-11-18).** 끝난 작업은 예약한 값을 그대로 가져간다
  (`settledUsageKrw`). 어느 실행 경로로 돌았는지, 제공사가 나중에 얼마로 정산했는지는 차감을 바꾸지 않는다.
  제공사 실제 원가는 `cost_usd`에 따로 적어 마진을 볼 때만 쓴다. 결과가 일부만 나오면 나온 만큼만 가져가고,
  실패하거나 취소되면 0이다.
- 보인 값이 원가와 멀어지지 않게 견적을 제공사 청구에 맞춘다.
  1. 제공사 원가는 정가가 아니라 청구액이다. 계정 실행 경로는 결과 하나마다 센트 단위로 올려서 청구한다
     (정가 $0.043 → 5크레딧). `lib/brand-studio/models.ts`의 `billedUsd`가 이 규칙이고, 이미지·영상 견적 모두 거친다.
  2. 영상 견적은 Sunra 문서의 토큰 식 그대로다(프레임 = 24 × 초 + 1, 참조 영상은 실제 길이와 출력의 2/3 중 큰 쪽).
     여유분을 얹지 않는다. `tests/brand-studio/server/quote-parity.test.ts`가 Sunra 견적과 대조한다.
  3. 사용량은 결과 하나마다 크레딧 단위로 올려서 센다(`usageKrw`). 화면의 "8크레딧"은 한도에서 80원이 빠진다는 뜻이고,
     결과에 적힌 크레딧을 더하면 잔액이 줄어든 만큼과 같다.
- 견적과 원가가 벌어질 수 있는 곳(차감에는 영향 없음, 마진에만 영향): API 실행 경로는 정가 그대로 정산되어 이미지 한 장에
  1센트 미만 덜 든다. GPT Image는 프롬프트 길이와 참조 이미지 크기까지 과금된다. 참조 영상을 붙인 영상은 화면이 길이를
  0.1초 단위로 본다. `cost_usd`와 `estimate_usd`를 비교하면 얼마나 벌어졌는지 보인다.
- 전체 차단 스위치: `BRAND_STUDIO_V2`를 끄면 API가 닫힌다. 진행 중이던 작업의 결과 수신은 계속된다.

## 10. 캠페인으로 보내기

결과나 에셋에서 "캠페인으로 보내기" → 기존 캠페인을 고르거나 제목·목표만 적어 새 의뢰를 만든다.
서버는 기존 `createBrandProject`로 의뢰를 만들고 파일을 `brand_attachments`로 복사한다(reserve → put → complete).
끝나면 그 캠페인 페이지로 간다. 스튜디오와 캠페인 사이에 없던 다리다.

## 11. 환경 변수 (이름만)

`BRAND_STUDIO_V2`, `BRAND_STUDIO_PROVIDER`, `BRAND_STUDIO_DEFAULT_LANE`, `BRAND_STUDIO_DEFAULT_MONTHLY_KRW`,
`BRAND_STUDIO_API_CONCURRENCY`, `BRAND_STUDIO_MCP_CONCURRENCY`, `BRAND_STUDIO_LANE_SECRET`, `BRAND_STUDIO_WEBHOOK_SECRET`,
기존 `SUNRA_API_KEY`, `GEMINI_API_KEY`, `R2_*`, `PUBLIC_MEDIA_BASE_URL`, `CRON_SECRET`. 값은 Vercel과 `.env.local`에만 둔다.

## 12. 작업 분담과 파일 소유

같은 작업 폴더(`D:\dev\.worktrees\twings\brand-studio-v2`, 브랜치 `claude/brand-studio-v2`)에서 동시에 일한다.
자기 소유가 아닌 파일은 고치지 않고, 필요하면 보고에 적는다. `npm run build:local`·서버 실행·스윕은 Fable만 돌린다.

| 조각 | 소유 파일 |
| --- | --- |
| 계약(Fable) | `lib/brand-studio/contracts.ts`, `lib/brand-studio/models.ts`, 이 문서 |
| S1 서버 | `lib/brand-studio/{service,repo,lanes,usage,media-store,provider,...}`, `app/api/brand-studio/**`, `supabase/migrations/0076*·0152*`, `lib/routing/surfaces.ts`, `lib/flags.ts`, `lib/admin/**`의 한도 오퍼레이션과 패널, `scripts/studio-catalog.ts`, `package.json` scripts, `tests/brand-studio/server/**`, `tests/brand-studio/sandbox.test.ts` |
| S2 지능 | `lib/brand-studio/enhancer/**`, `lib/brand-studio/film-sheet/**`, `lib/brand-studio/region-edit/**`, `tests/brand-studio/intel/**` |
| S3 화면 | `components/brand-studio/**`, `app/(brand)/brand/studio/page.tsx`, `app/(brand)/brand/page.tsx`, 브랜드 CSS, `messages/ko.ts`·`messages/en.ts`의 `brandStudio`, `scripts/sweep-anon.ts`, `tests/brand-studio/ui/**` |
| S4 계정 경로 워커 | `scripts/brand-studio-lane-worker.mjs`, `docs/BRAND-STUDIO-LANE-WORKER.md` (S1 뒤) |

S2가 내보내는 함수(S1이 부른다, 전부 순수 함수 + 주입된 `fetch`):

```ts
// lib/brand-studio/enhancer/index.ts
export interface EnhanceInput {
  kind: 'image' | 'region_edit' | 'video' | 'video_remix';
  profile: StudioPromptProfile;
  locale: 'ko' | 'en';
  prompt: string;
  references: Array<{ index: number; kind: 'image' | 'video' | 'audio'; label: string; role?: StudioAssetRole;
    use?: string; avoid?: string; frame?: 'start' | 'end'; thumb?: { bytes: Uint8Array; mime: string } }>;
  brand?: { name?: string; tone?: string; palette?: string[]; rules?: string[] } | null;
  video?: { seconds: number | null; aspect: string; audio: StudioAudioMode; method?: StudioRemixMethod;
    keep?: StudioKeepKey[]; change?: string; sheet?: FilmSheet | null } | null;
}
export interface EnhanceResult { prompt: string; notes: string; source: 'model' | 'fallback' }
export function enhancePrompt(input: EnhanceInput, deps: { fetch: typeof fetch; env: Record<string, string | undefined> }): Promise<EnhanceResult>;
export function composeFallbackPrompt(input: EnhanceInput): EnhanceResult; // 결정적, 네트워크 없음

// lib/brand-studio/film-sheet/index.ts
export function readFilm(input: { video: { bytes: Uint8Array; mime: string } | { url: string }; locale: 'ko' | 'en' },
  deps: { fetch: typeof fetch; env: Record<string, string | undefined> }): Promise<FilmSheet | null>;

// lib/brand-studio/region-edit/index.ts
export interface RegionPlan { roi: { left: number; top: number; width: number; height: number };
  box: { left: number; top: number; width: number; height: number }; aspect: string; work: { width: number; height: number } }
export function planRegion(image: { width: number; height: number }, box: RegionBox, aspects: readonly string[]): RegionPlan;
export function cropForEdit(original: Uint8Array, plan: RegionPlan): Promise<{ bytes: Uint8Array; mime: 'image/png' }>;
export function compositeRegion(input: { original: Uint8Array; edited: Uint8Array; plan: RegionPlan; feather?: number }):
  Promise<{ bytes: Uint8Array; mime: 'image/png'; width: number; height: number }>;
```

## 13. Toss 심사 중 지킬 것

구독 결제 심사가 진행 중이다. 이 작업은 아래를 **읽지도 고치지도 않는다**: `lib/creator-subscriptions/**`,
`lib/auth/review-login.ts`, `app/(app)/billing/**`, `app/(app)/auth/review`, `app/api/creator-subscriptions/**`,
`lib/legal/documents.ts`, `/[locale]/pricing`, `/[locale]/legal/**`, `RENDER_PIPELINE_PUBLIC`, 결제 관련 환경 변수.
`lib/flags.ts`에는 함수 하나(`brandStudioV2Open`)만 **추가**한다. 배포 뒤 심사 표면을 운영에서 다시 확인하고, 깨지면 되돌린다.

## 14. 대표 결정 대기

1. 조직별 월 한도 기본값과 플랜별 포함량(지금은 0 = 관리자가 열어 줌).
2. 고객 화면의 사용량 표시(지금은 원 단위 예상액과 월 누적).
3. 고객 조직의 기본 경로(지금은 API 우선, 넘치면 계정 경로). 계정 구독 크레딧을 고객 물량에 쓰는 것이 Sunra 약관에 맞는지.
4. 에셋·결과 저장을 비공개 버킷 + 서명 URL로 올릴 시점.
5. 메이커 템플릿을 브랜드가 쓰는 흐름과 로열티.

## 15. 방향 점검 (2026-11-10, 실제 화면과 실제 호출을 본 뒤)

**대표 요청과 맞는 것**
- "무엇을 할 수 있는지 안 보인다" → 홈의 세 문과, 실제로 만들어지는 만들기 화면.
- 프롬프트 바 하나 + 모델별 자동 보강 + 그 자리 부분 수정 + 오른쪽 에셋 패널 + 참고 영상(유지·변경·사운드) + 캠페인으로 보내기.
- 무드보드·14슬롯·렌즈 선택 없음. 모픽 격리 유지. 생성은 Sunra만.

**실제로 돌려 보고 고친 것**
- 결과가 주인공이 되도록 카드를 키우고, 독을 한 줄 컨트롤 + 얇은 사용량 표시로 줄였다. 결과 보기는 가운데 창, 휴대폰은 독이 화면을 덮지 않는다.
- 실행 전 예상 사용량은 서버 왕복 없이 바로 나온다(같은 계산식을 화면과 서버가 함께 쓴다).
- **참고 영상 제한을 돈 쓰기 전에 알려 준다**: 2~30초, 고치기는 4초 이상, 최소 해상도. 제공사가 거절한 뒤에 알리는 것은 늦다.
- **캠페인으로 보낼 때 의도를 함께 보낸다**: 영상은 "크리에이터가 따라 찍을 포맷으로 써 달라"가 기본. 대표가 말한 해자
  (만든 것 → 포맷 → 크리에이터 캠페인)의 첫 연결이다.
- **한 경로가 돈을 못 내면 다른 경로로 넘긴다**: 11-10에 API 계정 잔액이 0이라 모든 요청이 거절됐다. 이제 잔액 부족이면 그 경로를
  10분 닫고 작업을 다른 경로로 옮긴다. 고객 화면에는 아무 차이가 없다.
- 보강 문구에서 TWINGS 자체 취향(시선·표정)을 고객 브랜드에 강요하던 규칙을 뺐다.

**경로 판단 (실측)**
- 계정 경로가 싸다: 1크레딧 ≈ 정가 1센트이고 플랜 단가는 그 절반 수준. 다만 로그인 계정 하나에 묶여 있고 내부 다른 도구와
  동시 20개·월 크레딧을 나눠 쓴다. 그래서 고객 조직 기본은 API, 테스트 조직은 계정 경로, 서로 넘침·잔액 부족을 받아 준다.

**이번 범위 밖, 다음 차례**
1. 배경 지우기(누끼)와 클릭으로 영역 고르기(SAM), 레이어 분리 — 패션·제품 에셋 정리에 바로 쓰인다.
2. 음악 나중에 붙이기(지금은 "음악 없이"로 뽑는 것까지), 영상 결과 자동 점검.
3. 메이커 템플릿을 브랜드가 골라 쓰는 흐름과 로열티.
4. 1080p 완성의 실제 호출 검증(크레딧이 모자라 미실행), 비공개 저장, 서버에서 직접 쓰는 계정 경로.
5. 개인 쪽: 반려동물·커플 카테고리, 캐릭터 교체(리캐스트). 이 배포 뒤 설계부터.

## 16. 완료 기준

- 테스트 조직으로 `/brand/studio`에서 이미지 생성 → 부분 수정 → 에셋 저장 → 캠페인으로 보내기가 실제로 된다.
- 레퍼런스 영상 + 변경 지시 + 사운드 선택으로 480p 시안이 나오고 1080p로 완성된다.
- 모픽 조직에서는 §3의 모든 항목이 테스트와 실제 화면으로 확인된다.
- `AGENTS.md` §3 검증 루프 전부 통과, 스윕 통과, 운영에서 Toss 심사 표면 정상.
