# TWINGS AI 크리에이티브 MCP 안내

AI 크리에이티브가 자신의 AI 도구(Claude Code · Cursor · Codex 등)에서 TWINGS 템플릿 초안을 작성·검사·업로드하고 프로필과 대표 작업을 관리하기 위한 Streamable HTTP MCP 서버 안내서다.

- 엔드포인트: `https://twings.app/api/mcp`
- 인증 방식: `Authorization: Bearer <YOUR_TOKEN>` (크리에이티브 스튜디오에서 발급한 개인 토큰, 생성 직후 1회만 표시)
- 준비 조건: 크리에이티브 스튜디오(`/creators/workspace`)에서 승인 또는 원클릭 시작을 완료한 활성 계정

---

## 1. 연결 방법

1. `/creators/workspace`의 **AI 에이전트로 올리기 (MCP)** 패널에서 토큰 이름을 입력해 토큰을 발급한다.
2. 발급 직후 표시되는 값을 복사해 아래 클라이언트 설정의 `<YOUR_TOKEN>` 자리에 넣는다. (토큰 문자열은 화면·로그·코드에 다시 저장하지 않는다.)

### Claude Code

```bash
claude mcp add --transport http twings https://twings.app/api/mcp --header "Authorization: Bearer <YOUR_TOKEN>"
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "twings": {
      "url": "https://twings.app/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.twings]
url = "https://twings.app/api/mcp"
http_headers = { Authorization = "Bearer <YOUR_TOKEN>" }
```

---

## 2. 도구 목록

| 도구 이름 | 하는 일 |
| --- | --- |
| `whoami` | 내 핸들, 공개 프로필 URL, 프로그램·셀프 공개 가능 여부, 계정·파일 한도 확인 |
| `get_recipe_guide` | 레시피 구조, 허용 엔진·비율·길이, 클립 카드(`guide[]`) 규칙, 파일 한도, 예시 2종(`example`, `exampleWithClips`) 조회 |
| `validate_recipe` | 저장 없이 레시피 규칙 검사(`ok`, `issues`) 및 `guide[]`의 알 수 없는 `{{이름}}` 비차단 경고(`warnings`) 반환. 레시피 모양이 틀리면 어느 칸이 왜 틀렸는지 `hints`(최대 8줄)로 알려 준다 |
| `list_templates` | 내 템플릿 목록(초안·검수 중·공개·반려), 상태, 검수 메모, 공개된 레시피 열람 회원 수 조회 |
| `get_template` | 특정 템플릿의 레시피 JSON, 업로드 파일(`ast_...`), 테스트 렌더 이력, 웹 편집기 주소(`editor`), 공개 시 `url` 반환 |
| `save_template` | 초안 생성 또는 수정. `editor` 주소, 미완성 사유(`issues`), `guide[]` 토큰 경고(`warnings`) 반환 |
| `upload_file` | 초안에 참조 파일(`role: "reference"`) 또는 예시 결과물(`role: "example"`) 업로드(공개 `https` URL 또는 `data_base64`). `contains_person`으로 실제 인물 얼굴 포함 여부 지정 |
| `delete_file` | 초안에서 업로드된 파일(`ast_...`) 삭제 |
| `test_render` | 저장해 둔 내 셀카로 초안의 **이미지 단계만** 테스트 렌더 실행 |
| `publish_template` | 검사를 통과한 초안을 스튜디오 검수 없이 즉시 공개(권리 확인 필수) |
| `submit_template` | 완성된 초안을 스튜디오 검수에 제출(권리 확인 필수) |
| `update_profile` | 공개 프로필 필드(핸들·이름·한 줄 소개·소개글·국가·도시·링크·공개 이메일·도구·브랜드 협업·공개 여부) 부분 수정 |
| `list_works` | 프로필에 등록된 대표 작업 목록 조회 |
| `add_work` | 프로필 대표 작업 추가(공개 `https` URL 또는 `data_base64`, 이미지·짧은 영상) |
| `remove_work` | 프로필 대표 작업(`wrk_...`) 삭제 |
| `get_stats` | 공개된 템플릿별 레시피 열람 회원 수(전체·최근 7일) 조회 |

---

## 3. 한 번에 올리는 순서

1. **가이드 읽기**: `get_recipe_guide`를 호출해 허용 엔진, 파라미터, 클립 카드(`guide[]`) 형식, 현재 파일 한도를 확인한다.
2. **초안 만들기**: `save_template`에 최소 레시피 골격을 넣어 초안 `id`를 먼저 발급받는다(이후 파일 업로드에 이 `id`가 필요).
3. **파일 올리기**: `upload_file`로 참조 파일(`role: "reference"`)과 예시 결과물(`role: "example"`)을 올린다. 참조 파일에 실제 인물 얼굴이 들어 있으면 `contains_person: true`를 전달한다(웹 편집기의 "인물 얼굴 포함"과 같으며, 공개 시 회원의 직접 다운로드를 막는다).
4. **레시피와 클립 카드 채우기**: 반환된 `ast_...` ID를 `slots`에 연결하고 `steps`, `output`, `notes`, 필요 시 `guide[]`를 채워 `save_template`을 다시 호출한다.
5. **검사**: `validate_recipe`로 `issues`가 없는지 확인하고, `warnings`가 있으면 `guide[]` 안의 `{{이름}}` 오타를 고친다.
6. **웹 편집기에서 확인**: `save_template` 또는 `get_template`이 돌려준 `editor` 주소를 브라우저로 열어 클립 카드 순서, 팁 위치, 공개 설정, 로열티를 눈으로 확인한다.
7. **테스트 및 공개**: 이미지 단계가 있는 템플릿은 `test_render`를 1회 성공시킨 뒤(영상 전용 템플릿은 예시 영상 파일 업로드로 대체) `publish_template`로 공개하거나 `submit_template`로 검수를 요청한다.

---

## 4. 클립 카드(`guide[]`) 쓰는 법

`recipe.guide`는 여러 컷이나 단계별 흐름을 설명하는 **표시 전용** 카드 목록이다. 어떤 생성 엔진도 이 배열을 읽지 않으며, 공개 설정(`show_prompts`)이 켜져 있을 때 템플릿 페이지의 전체 폭 **클립별** 구역(`#clips`)에 렌더링된다.

- **노출 범위**:
  - 로그인한 회원: 카드 번호·제목(`title`)·조건 한 줄(`meta`)·**프롬프트 위의 팁 상자(`note`)**·접을 수 있는 프롬프트(`prompt`)와 복사 버튼이 모두 보인다.
  - 로그인하지 않은 방문자: 번호와 제목(`title`)만 보이며, 조건 한 줄·팁·프롬프트는 가려진다.
- **필드 구성**:
  - `title`: 고객에게 그대로 보이는 클립 제목(비로그인 방문자에게도 노출). 모델명이나 내부 작업 단계 이름을 적지 않는다.
  - `kind`: `"image"` 또는 `"video"`.
  - `meta`(선택): 제목 아래 한 줄 스펙. 예: `"Video · 4:3 · 5s"`. 모델명·엔진 ID·내부 파이프라인 용어를 넣지 않는다.
  - `prompt`: 해당 클립의 프롬프트.
  - `note`(선택): 프롬프트 **위** 강조 상자로 보이는 제작 팁.
- **`{{이름}}` 규칙**: 클립 카드 프롬프트에서 `{{이름}}`은 `recipe.slots`에 선언된 슬롯 이름과 `recipe.steps[].id`만 쓸 수 있다. 선언되지 않은 이름을 넣으면 구매자 화면에 잘못된 단계 번호가 표시되며, `validate_recipe`와 `save_template`이 저장을 막지 않는 `warnings` 항목으로 알려 준다.

---

## 5. 한도 (상수 기준)

모든 수치 제한은 코드 상수에서 파생된다. 아래 표의 "현재 값"은 작성 시점 기준이다.

| 항목 | 기준 상수 | 현재 값 |
| --- | --- | --- |
| 클립 카드 최대 개수 | `MAX_GUIDE_CLIPS` (`components/recipes/guide-editor.ts`) | 16장 |
| 클립 카드 제목 길이 | `GUIDE_TITLE_MAX` (`components/recipes/guide-editor.ts`) | 1~120자 |
| 클립 카드 조건 한 줄 길이 | `GUIDE_META_MAX` (`components/recipes/guide-editor.ts`) | 80자 이하 |
| 단계·클립 프롬프트 최소 길이 | `MIN_STEP_PROMPT_CHARS` (`lib/recipes/schema.ts`) | 10자 |
| 단계·클립 프롬프트 기본 상한 | `DEFAULT_PROMPT_CHARS` (`lib/engines/prompt-limits.ts`) | 8,000자 |
| Seedance 2.5 클립당 상한 | `SEEDANCE_25_PROMPT_CHARS` (`lib/engines/prompt-limits.ts`) | 15,000자(클립당) |
| 팁(`note`) / 도입(`intro`) / 마무리(`outro`) | `NOTE_MAX`, `INTRO_MAX`, `OUTRO_MAX` (`lib/recipes/schema.ts`) | 800자 / 1,200자 / 600자 |
| 템플릿당 참조 파일 개수 | `MAKER_REFERENCE_FILES` (`lib/recipes/assets.ts`) | 6개(+ 예시 1개) |
| 이미지 / base64 업로드 상한 | `MAKER_FILE_MAX_BYTES` (`lib/recipes/assets.ts`) | 4 MB |
| 영상·오디오 URL 업로드 상한 | `MAKER_AV_FILE_MAX_BYTES` (`lib/recipes/assets.ts`) | 25 MB |
| 템플릿당 파일 합계 상한 | `MAKER_FORMAT_MAX_BYTES` (`lib/recipes/assets.ts`) | 60 MB |
| 하루 초안 생성 / 템플릿당 테스트 렌더 | `MAKER_DRAFTS_PER_DAY`, `MAKER_TEST_RENDERS` (`lib/recipes/maker.ts`) | 3개 / 3회 |
| 발급 가능한 MCP 토큰 수 | `MAKER_TOKENS_MAX` (`lib/makers/tokens.ts`) | 5개 |
| 대표 작업 수 / 총 용량 | `MAKER_WORKS_MAX`, `MAKER_WORKS_MAX_BYTES` (`lib/makers/works.ts`) | 12개 / 40 MB |

---

## 6. 하지 못하는 것

- **공개된 템플릿의 레시피 수정**: 한 번 공개(`accepted` / `published`)된 템플릿의 레시피는 잠기며, `save_template`·`upload_file`·`delete_file`은 `draft` 상태에서만 동작한다.
- **영상 테스트 렌더**: `test_render`는 이미지 단계만 실행한다. 영상 단계는 구매 시에만 생성되며, 이미지 단계가 없는 영상 전용 레시피는 `video_test_unavailable`로 거절된다(예시 영상 파일 업로드로 공개).
- **초안 삭제**: MCP에는 초안 삭제 도구가 없다.
- **비공개·사설망 URL 가져오기**: `upload_file`과 `add_work`의 `url`은 공개 `https` 주소만 허용하며, 사설·로컬 주소와 리다이렉트 우회는 차단된다.

## 7. 블로그 글 도구 (`TWINGS_MAKER_BLOG=on`일 때 활성)

`TWINGS_MAKER_BLOG=on`이면 같은 `/api/mcp` 엔드포인트에서 AI 크리에이티브 블로그 글 작성·공개 도구 6종이 추가로 열린다(스위치가 꺼져 있을 때는 `tools/list`에서 숨겨지며 호출 시 `not_open` 오류를 반환한다).

| 도구 | 읽기 전용 | 역할 |
| --- | --- | --- |
| `get_post_guide` | ✓ | 7종 블록 스키마, 글자·용량(`POST_MAX_JSON_BYTES`)·편수(`POST_MAX_PER_MAKER`, 하루 `POST_MAX_NEW_PER_DAY`) 한도 조회 |
| `list_posts` | ✓ | 내 블로그 글 목록(`draft` · `published` · `hidden`)과 편집·공개 주소 조회 |
| `get_post` | ✓ | 글 1편의 전체 블록과 상태 조회 |
| `save_post` | | 새 초안 생성 또는 기존 초안·공개 글 저장(`hidden` 상태는 잠김) |
| `publish_post` | | `rightsConfirmed: true` 확인 및 1개 이상 블록·소유 미디어·공개 템플릿 검증 후 즉시 공개 |
| `unpublish_post` | | 공개 중인 글을 `draft`로 되돌리기(`hidden` 상태는 잠김) |

### 블로그 글의 모델·도구 이름 (대표 결정 2026-11-26)

블로그 글은 AI 크리에이티브가 직접 쓰는 글이라, 쓴 모델과 도구 이름(Seedance 2.5, Seedream 5.5, Nano Banana 2.1, Kling, Midjourney, ComfyUI 등)을 소제목·본문·목록·대표 작업 설명·프롬프트 카드(제목, 조건 한 줄, 프롬프트, 팁) 어디에나 적을 수 있다. 글 스키마·저장·공개 읽기·화면 어디에서도 이 이름을 거르거나 바꾸지 않는다(`tests/posts/model-names.test.ts`가 고정). `get_post_guide`의 `naming`이 에이전트에게 같은 내용을 알려 준다.

이 결정은 블로그 글에만 해당한다. TWINGS가 쓰는 화면 문구에는 여전히 모델 이름을 넣지 않고, 템플릿 클립 카드의 제목과 조건 한 줄(`recipe.guide[].title`, `recipe.guide[].meta`)에 모델 이름을 넣지 않는다는 규칙도 그대로다.

### 문구와 이름 확정 (2026-11-26)

클립 보기·MCP 안내·블로그의 화면 문구와 이름 "블로그"는 2026-11-26 대표가 확정했다. Gemma 4 윤문(`docs/wording/ai-tell-quick-rules.md`)을 거쳐 말투를 해요체로 맞췄고, 권리 확인 문장("내가 권리를 가진 내용만 올립니다.")은 본인이 하는 확인이라 그대로 두었다.
