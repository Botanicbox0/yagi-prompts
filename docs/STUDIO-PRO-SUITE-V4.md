# Studio Pro Suite v5 — 설계 및 확정 사양서 (Carbon × Fable 5.2 × 대표 최종 확정, 2026-11-13)

> 브랜치: `gemini/studio-pro-suite` (`D:\dev\.worktrees\twings\studio-pro-suite`)
> 디자인 정본: Studio UI v4 (`95% Monochrome #FFFFFF / #F4F4F5 / #09090B` + `5% Electric Ultramarine #0033FF` 단일 CTA, `Geist + Pretendard Variable + Geist Mono tabular-nums`, 보더리스 면 분리)

---

## 1. 대표 확정 정책 (2026-11-13)

1. **명칭 통일**:
   - 기존 `비디오 스튜디오` → **`영상 스튜디오`** (`/brand/studio/video`)
   - 영상 스튜디오 안의 작업 단위는 **`프로젝트`** (`새 프로젝트`, `내 프로젝트`, `완료 처리`)로 명명한다. (`brand_studio_video_projects` 테이블 — `야기 팀과` 의뢰 룸 `brand_projects`와 스키마·권한을 분리한다.)
2. **`@` 레퍼런스 인식 시각화**:
   - 프롬프트 입력창에서 `@image1`, `@video1`, `@audio1` 등 실제 첨부된 트레이 항목과 바인딩된 멘션은 **옅은 파란색 배경 알약(`color-mix(in srgb, var(--ys-cta-bg) 10%, transparent)`)**으로 즉시 하이라이트한다.
   - `<textarea>` 미러 레이어는 글꼴·크기·굵기·자간·패딩·스크롤을 100% 동일하게 유지(배경만 채색)하여 다중 줄 한글 IME 조합 중 커서 밀림이 절대 발생하지 않게 하고, 인식된 에셋의 상단 트레이 썸네일에도 같은 파란 링을 켜 양방향으로 확인시킨다. 매칭되지 않는 번호(`@image9` 등)는 앰버 점선 밑줄로 구분한다.
3. **수동 `자동 개선(✨)` 노출 제거 → 상시 백그라운드 멀티모달 디렉터 (`Video-Creator` 문법 직결)**:
   - 프롬프트 독(`Dock`)에서 고객이 직접 누르던 `자동 개선` 스위치와 `✨` 버튼을 제거한다.
   - 뒷단은 **`MediaAnalyzer`**(첨부 시점 선행 분석, 기본 `gemini-3.8-flash`, 향후 `Argon` 어댑터 결합 슬롯 분리)와 **`PromptCompiler`**(제출 시점 3갈래 분류: 정교한 프롬프트 Pass-through / 누락 슬롯 보강 / 짧은 한국어 브리프 전체 확장)로 구성한다.
   - `D:\dev\Video-Creator` (`seedance-film-director`)의 핵심 연출 원칙을 그대로 내장한다:
     - `Reference authority:` → `Visual style:`(`#Hex` 팔레트, 조명 방향, 렌즈/질감) → `0.0s–Xs` 초단위 타임라인 및 컷 경계(`hard cut`, `match cut`, `continuous`) 명시
     - 실사 인물 자연 피부(`glass-skin` 등 플라스틱 광택어 금지로 SeedVR2 우글거림 방지), 주변 조명·그림자 통합(얼굴 동동 뜸 방지), 정면 고정 탈피(대각·측면·OTS 교차 및 오프축 시선)
     - Seedance 생성 프롬프트 기본 **Strict No-BGM (현장 폴리·앰비언스만 생성)** — 음악은 시퀀스 레일 후반 작업에서 결합
   - **샷 시트 캐시 수명 (용량 무한 증가 방지)**:
     - 레퍼런스 영상 분석 결과(`brand_studio_assets.film_sheets`)는 무거운 이미지 파일 없이 경량 구조화 JSON만 저장하며, **마지막 사용일로부터 `14일` 슬라이딩 만료(`film_sheets_expires_at`)**를 둔다.
     - 해당 레퍼런스 영상을 쓰던 영상 스튜디오 `프로젝트`가 **`완료(completed)` / `보관(archived)` 또는 삭제**될 때(다른 활성 프로젝트가 참조하지 않으면) 즉시 `film_sheets` 캐시를 자동 비운다.
4. **`영상 스튜디오` 단일 스테이지 + 3단 탄성 시퀀스 레일(`72px / 200px / 55vh`) + 테이크 스택 + Premiere/DaVinci 반출**:
   - 진입 시 빈 프로젝트 난립과 모달 마찰을 막기 위해 즉시 작업 화면을 열고(우측 보관함에 이미지 스튜디오 **최근 생성물 · 조직 공유 폴더 · 멤버별 개인 좋아요 · 업로드** 기본 노출 + `Ctrl+V`), **첫 생성 제출 또는 첫 클립 추가 시 서버 `프로젝트`를 자동 생성(Lazy Create)**한다.
   - 탭 이동 없이 한 화면에서 하단 **시퀀스 레일**이 3단계 높이로 열린다:
     - `72px`: 스토리보드 순서 썸네일, 드래그 정렬, 같은 컷 재생성 시 옆으로 늘어나지 않고 겹쳐 쌓이는 **테이크 스택(`1/3`)**
     - `200px`: 빠른 앞뒤 트림 핸들, 컷 자동 인식 마커, BGM·자막 트랙
     - `55vh`: 정밀 멀티트랙 편집기 (이때 프롬프트 `Dock`은 1줄 알약 `+ 새 클립 만들기…`로 접힘)
   - 클립 또는 구간을 선택했을 때만 플로팅 액션 바(`[자르기 · 컷 자동 인식 · 레퍼런스 색보정 · @ 레퍼런스로 재투입 · 구간 맞춤 음악 생성 · SeedVR2 업스케일]`)가 나타나 CapCut식 복잡한 상주 패널을 없앤다.
   - **내보내기**: 웹 MP4 렌더링과 함께 Premiere Pro·DaVinci Resolve 양쪽이 기본 직독하는 **`FCP7 xmeml v4 (.xml)` + 원본 클립(`media/`) + 컬러 그레이딩 `.cube` 3D LUT + `.srt` 자막 `.zip` 패키지**를 제공하며, **타임라인에 올린 BGM은 기본 제외 없이 그대로 함께 내보낸다.**
5. **조직별 `워크플로우 · 지식` 허브 (`캐릭터 시트 메이커` 기본 탑재) + 멀티 클라이언트 `MCP 연결하기` (무제한 · 원클릭 온보딩)**:
   - 좌측 레일 `직접 만들기`: `이미지 스튜디오` · `영상 스튜디오` · `워크플로우` · `에셋`.
   - `워크플로우` 허브(`/brand/studio/workflows`): `우리 팀 워크플로우` | `기본 템플릿` | `팀 지식 · 가이드` 구성.
   - **기본 탑재 1번 템플릿 — `캐릭터 시트 메이커`**: 기준 캐릭터(`@image1` 또는 설명) → 16:9 와이드 정면·측면·후면 동시 턴어라운드 생성·슬라이스 → 표정 4종 및 착장 디테일 시트 생성 → `Gemini 3.8 Flash` 비전 일관성 대조(이탈 시 1회 자동 재시도) → 캐릭터 폴더 세트로 저장.
   - **"방금 한 작업을 워크플로우로 저장"** 및 **자연어 AI 워크플로우 빌더** 제공.
   - **멀티 클라이언트 MCP (`https://brand.twings.app/api/mcp`)**: 인위적 토큰 일일 크레딧 상한 없이 조직 크레딧 한도 내에서 자유롭게 동작하며, `MCP 연결하기` 모달에서 **`Claude` · `Claude Code` · `ChatGPT` · `Gemini` · `Cursor` · `Codex (CLI)` · `OpenClaw` · `Hermes`** 탭별 **1–2–3단계 원클릭 복사/연결 가이드**와 멤버별 토큰 발급·폐기 및 OAuth 2.1 연결을 모두 지원한다.

---

## 2. 철칙 및 불변 안전선

- **Higgsfield 절대 금지**: 어떠한 Higgsfield API/CLI/MCP/SDK 호출도 하지 않는다(크레딧 지출 `0`).
- **모픽 샌드박스 격리**: `d425c3b1-4066-4970-8a3b-93c52b3eef70`, `deb648e9-c2df-43d4-b2a7-7f9eff8180d9`, `Morphic`/`모픽` 조직 및 `generative_media` 차단 조직은 모든 신규 페이지·API·MCP·OAuth 경로에서 예외 없이 `404`를 반환한다.
- **고객 노출 문구 위생**: 내부 인프라·모델·서버명(`ComfyUI`, `YuE2`, `SheetSage`, `YAGI-SERVER`, `gpu-arbiter`, `Slack`, `Supabase`, `R2` 등) 노출 금지, 원화 금액 대신 크레딧(`tabular-nums`)만 표기.
- **클립보드 `Ctrl+C / Ctrl+V`**: `LayerEditor`, `RegionEditPanel`, `RegionForm`, `Viewer`, `StudioApp`, `Dock`, `VideoStudioWorkspace` 전 표면 동작 유지.

---

## 3. 기본 템플릿 — `영상화용 캐릭터 시트 생성기` (`video-character-sheet`, 2026-11-22)

`워크플로우` 허브의 두 번째 기본 템플릿(`starter:video-character-sheet`, 분류 `character`). 인물 사진 1장과 의상 사진 1장으로 영상 제작 때 참조 이미지로 붙일 16:9 캐릭터 시트 1장을 만든다. 시트는 세 칸이다: 왼쪽 얼굴 클로즈업, 가운데 전신 앞모습, 오른쪽 전신 뒷모습(두 전신 칸은 목 아래만).

- **입력**: Image 1 = 인물 사진(필수, 역할 `person`), Image 2 = 의상 사진(필수, 역할 `style`), 인물 이름(선택, 폴더명과 작업 줄에만 쓰임), 폴더명(선택). 자유 지시문·출력 구성·모델 선택은 없다. 두 사진 중 하나라도 없거나 이미지가 아니면 `reference_missing`으로 아무것도 만들지 않는다. 런 입력은 `inputs.image1Ref`, `inputs.image2Ref`, `subject`, `folderName`.
- **고정 설정**: 한 단계(`sheet`) → 이미지 작업 1건. 모델 `gpt-image-2.6-sunburst`(내부 문서용 표기, 고객 화면에는 모델·공급사 이름을 쓰지 않는다), 16:9, 2K(2048×1152), quality `high`, 1장, 참조 `[Image 1, Image 2]` 순서. 제공사 쪽 planning depth는 문안에 레이아웃 단어가 있어 두 레인 모두 `high`로 나간다.
- **보내는 문장 = 서버 프리셋**: 대표가 완성한 영어 원문(`tests/brand-studio/fixtures/video-character-sheet-prompt.txt`, 끝 줄바꿈 1개를 뺀 4,718자)이 `lib/brand-studio/workflows/presets/video-character-sheet.ts`에 상수로 그대로 있다. 스튜디오 프롬프트 한도보다 길어 `job.prompt`로 다니지 않는다. 작업의 `prompt`는 짧은 표시 줄(`영상화용 캐릭터 시트 생성기 · 소라`, 영어 화면은 `Character Sheet for Video · …`, 이름이 없으면 제목만)이고, 실제 문장은 준비 단계(`prepareJob`)에서 `params.preset`으로 조립돼 `final_prompt`에만 들어간다. Prompt Architect(enhancer)는 이 작업에 돌지 않고, 팀 가이드(`inject_director`)도 붙지 않는다. 작업 보기(`jobView`)는 `finalPrompt: null`과 `preset: 'video-character-sheet'`(id만)을 내보내며, 문장·변수는 화면·목록·MCP 응답·로그 어디에도 나가지 않는다. `starters.ts`(클라이언트 안전 파일)는 프리셋을 import하지 않는다.
- **서버 전용 보장**: `lib/brand-studio/workflows/presets/index.ts`, `presets/video-character-sheet.ts`, `workflows/sheet-analysis.ts`는 `import 'server-only'`로 시작해 클라이언트 코드가 import하면 빌드가 실패한다(vitest는 `vitest.config.ts`의 별칭으로 빈 모듈을 쓴다). 빌드 결과물 검사는 `npm run build:local` 뒤 `node scripts/brand-studio-preset-bundle-check.mjs .next/static`(통과하면 `PRESET BUNDLE CHECK PASSED — 0 hits in N files`, 원문 조각이 있으면 위치를 찍고 종료 코드 1). `.next/server`에 돌리면 원문을 찾아야 정상이다.
- **원문에서 바꾼 한 곳**: `Ignore the charcoal t-shirt in Image 1 — it is placeholder`의 `the charcoal t-shirt`를 네 번째 자리표시자 `{{IMAGE1_WARDROBE}}`로 열었다. `image1Wardrobe = 'the charcoal t-shirt'`이면 원문과 바이트 단위로 같다.
- **네 변수와 대체값**: 실행마다 두 사진의 768px WebP 축소본을 Gemini(`studioGeminiConfig`, thinking LOW, 20초 제한, 재시도 없음) 한 번으로 읽어 짧은 영어 명사구 4개를 받는다(`lib/brand-studio/workflows/sheet-analysis.ts`). 요청에는 고정 지시문, 고정 라벨 2줄(`Image 1 (person photo):`, `Image 2 (outfit photo):`), 사진 2장만 실린다. 고객이 입력한 이름·조직·회원·브랜드·팀 가이드는 보내지 않는다.

  | 변수 | 최대 | 내용 | 대체값 |
  | --- | --- | --- | --- |
  | `faceBound` | 400자 | Image 1의 얼굴·머리 디테일(안경, 수염, 점·주근깨·흉터, 머리색·길이·결·가르마, 귀걸이·피어싱) | every face-bound detail visible in Image 1 — eyewear, facial hair, moles, freckles, and the hair's color, length and parting |
  | `fashionText` | 900자 | Image 2의 모든 옷·신발·소품(색·소재·핏·길이·여밈) | every garment, shoe and accessory visible in Image 2, each in its exact color, fabric and cut |
  | `build` | 200자 | Image 1의 체형("on a body of …"를 잇는 구) | natural proportions consistent with the face, neck and shoulders in Image 1 |
  | `image1Wardrobe` | 120자 | Image 1에서 입고 있는 옷("the …"로 시작) | whatever the person is wearing |

  키 없음·사진 누락이나 디코딩 실패·호출 예외·시간 초과·JSON이 아닌 답 → 네 값 모두 대체값. 한 값만 `sanitizeSheetVar`를 통과하지 못하면 그 값만 대체값. 정리 규칙: 한 줄로 합치고 제어 문자·중괄호·백틱·끝 문장부호를 지우며, 번호 붙은 미디어·칸 언급(`Image 1`, `panel 2`, `사진 3` 등), 링크, 지시문처럼 보이는 말(ignore, instructions 등)은 버린다. 값은 명사구 목록이어야 하므로 명령처럼 읽히는 조각도 버린다: 조각이 add·write·replace·render·include·remove 같은 동사로 시작하거나, change·show·use·make·put·print처럼 옷 이름에도 쓰이는 동사 뒤에 관사·글자·배경을 가리키는 말이나 따옴표 글자가 따라오는 경우다(사진 속 간판·스티커의 글자가 문장으로 들어오는 것을 막는다). 옷에 인쇄된 글자를 따옴표로 적은 묘사(`white tee printed with "LOVE" in red`)와 `change purse`, `print scarf`, `button-up shirt` 같은 옷 이름은 그대로 통과한다. 최대 길이를 넘으면 그 안의 마지막 쉼표나 공백에서 자른다. 모든 변수가 최대일 때 보내는 문장은 6,279자(8,000자 미만, account lane 문서상 이 모델 한도 32,000자 미만)이고 두 레인 모두 자르지 않는다.
- **읽기 전에 싸게 확인하는 것**(`presetReadingGate`, 읽기 전용): ① 같은 요청을 다시 보낸 경우(그 단계의 작업이 이미 있음)에는 읽지 않고 기존 작업을 그대로 돌려준다. ② 열린 작업이 조직 한도에 차 있으면 `too_many_running`. ③ 월 한도가 닫혀 있으면 `allowance_closed`, 이번 달 사용액 + 이 단계 견적이 한도를 넘으면 `allowance_exhausted`. 셋을 통과한 뒤에만 조직별 1분 창(`FREE_INTEL_LIMITS.analyzePerMinute`, 키 `sheet:<orgId>`)을 하나 쓰고, 창이 다 차면 읽기를 건너뛰고 대체값으로 진행한다. 거절된 실행은 창을 쓰지 않는다. 작업 생성(`createStudioJob`)의 잠금 걸린 검사와 예약은 그대로이므로 이 확인과 생성 사이의 경합은 거기서 같은 코드로 끝나고, 차감은 한 번뿐이다.
- **크레딧**: 15크레딧(₩150 상당, 1장). `estimateStepCredits`는 `quality`나 `preset`이 있는 단계를 planner와 같은 `imageRunKrw`(참조 수 = 단계가 쓰는 이미지 슬롯 수, 16:9, high)로 계산한다. 기존 세 기본 템플릿 값(66 · 66 · 581)은 그대로다.
- **차단 재시도**: 제공사 안전 검수에 막히면 같은 문장으로 한 번만 다시 보낸다(`source: 'same'`). 다시 쓰기 모델을 부르지 않고 `blockedPrompt` 사본도 남기지 않는다. 두 번째 차단은 실패로 끝난다. API lane과 account lane 모두 같다.
- **일관성 검사**: 아직 없다(`consistencyCheck: 'none'`). 기존 검사(`캐릭터 시트 메이커`)는 작업을 만든 요청 안에서 돌기 때문에, 작업이 비동기로 끝나는 운영에서는 결과물을 보지 못한 채 `checked: false`로 끝난다. 같은 자리에 넣으면 검수했다고 말할 수 없어 넣지 않았다. 완료 시점에 도는 검사(얼굴 칸 대 Image 1, 옷 대 Image 2, 전신 칸의 머리 잘림, 회색 배경, 글자 없음)는 후속 과제다.
- **보관**: 폴더 `영상용 시트 · {이름}`(영어 `Video Sheet · {name}`, 이름이 없으면 `영상용 시트` / `Video Sheet`, 폴더명을 적으면 그 이름)에 결과와 두 입력 사진(라이브러리 에셋일 때)을 함께 넣는다.
- **다시 만들기 없음**: 짧은 표시 줄로 다시 실행하면 다른 결과가 나오므로, 이 작업은 `워크플로로 저장`이 거부되고(`invalid`) 허브의 최근 작업 목록에도 나오지 않는다. 연속 장면 계획(`continuity/planner.ts`)은 이 작업을 이전 프롬프트가 없는 작업으로 다룬다(보낸 문장도 표시 줄도 읽지 않는다). 갤러리의 `다시 만들기`·`설정 다시 쓰기` 숨김은 UI 작업(`dock-model`, `reuse-model`, viewer)에서 한다.
- **프리셋 적용 범위**: 단계의 `preset`은 기본 템플릿에서만 동작한다. 팀 워크플로우는 `preset`을 가질 수 없다: 저장·수정(웹, API, MCP `twings_create_workflow`)은 `invalid`로 거부하고 아무것도 저장하지 않으며, AI 빌더의 결과와 이미 저장된 행에서는 읽을 때 지운다. 실행 단계에서도 기본 템플릿이 아닌 워크플로우의 `preset`은 무시한다. MCP `resources/read`의 워크플로우 응답에는 단계의 `preset`이 실리지 않는다(허브 화면용 상태에는 남는다). 공개 작업 생성 요청(`job.create`, MCP)에는 프리셋 필드가 없다.
- **MCP**: `twings_run_workflow`에 `workflowId: 'video-character-sheet'`와 `imageAssetId`/`imageOutputId`(Image 1) + `image2AssetId`/`image2OutputId`(Image 2)를 준다. 사진이 하나뿐이면 `reference_missing`. `twings_list_workflows`는 슬롯(`hint` 포함)을 그대로 돌려준다.
- **후속**: 얼굴 칸 대 Image 1 일관성 검사, 시트를 영상 스튜디오 참조로 바로 보내는 버튼, 한국어 문구 대표 확인(워딩 패스 결과, PR에 "확인 대기"로 표시).
- **제공사 문장 길이 한도**: 두 레인 모두 32,000자다. API lane은 공개 OpenAPI 스키마(`ImageEditingInput.prompt.maxLength`, 2026-11-22 확인), account lane은 `docs/research/SUNRA-IMAGE-SCHEMAS-2026-11-19.txt`. 보내는 문장은 가장 길 때 6,279자이고, 두 레인 어디에서도 자르지 않는다.
