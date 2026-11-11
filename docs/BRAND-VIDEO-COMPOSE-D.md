# 브랜드 비디오 합치기 설계 (묶음 D) — 2026-11-11

> 지시 원본: `docs/HANDOFF-2026-11-11-GEMINI.md` §4-D · §4-I · §7-3
> 대상 주소: `/brand/studio/compose` (비디오 스튜디오 상단 진입 + 레일 `+ 만들기` 메뉴 연결)
> 격리 규칙: `studioRouteContext` 및 `studioAccess` 첫 줄 적용 — 모픽(`d425c3b1-…`, `deb648e9-…`, `Morphic`/`모픽`), `generative_media` 차단 조직, 캠페인 게스트, `BRAND_STUDIO_V2` 비활성 환경에서는 페이지와 API 모두 즉시 `404`를 반환한다.

---

## 1. 목표와 하지 않을 것

### 목표
- 스튜디오에서 만든 영상·에셋에 올린 영상·내 컴퓨터 파일을 **순서대로 놓고**, 앞뒤 구간을 **자르고**, 원하는 초 구간에 **자막(Pretendard Variable)**과 **배경음악(볼륨 조절)**을 얹어 **1080p MP4 한 편으로 내보내는 간단한 편집기**를 만든다.
- 타임라인 조작이 낯선 고객도 **"2번째 컷 3초로 줄이고 마지막에 브랜드 슬로건 자막 넣어줘"**, **"배경음악 볼륨 30%로 낮춰줘"**처럼 채팅으로 지시해 즉시 편집·되돌리기(Undo)할 수 있게 한다.
- 내보낸 MP4는 브라우저에서 바로 내려받거나 1클릭으로 **에셋(`/brand/library`)에 저장**할 수 있게 한다.

### 하지 않을 것
- Premiere·After Effects 식 다중 트랙 키프레임·합성 노드·색보정 NLE로 복잡하게 만들지 않는다.
- OpenAI·Anthropic 약관을 위반하는 제3자 웹앱 내 소비자 구독(ChatGPT Plus/Pro, Claude Pro/Max) OAuth 토큰 우회·프록시를 구현하지 않는다.
- 새 무거운 외부 패키지(`@ffmpeg/ffmpeg` 31MB WASM, Remotion, Zustand 등)나 DB 마이그레이션을 추가하지 않는다.

---

## 2. 사전 검증 결과 (라이선스 · 의존성 · 소비자 구독 약관)

### 2-1. `OpenCut` (`https://github.com/opencut-app/opencut`) 라이선스 및 의존성 점검
- **라이선스**: **MIT License** — 상업 서비스에서 타임라인 데이터 모델과 상호작용 구조를 참고해 자체 구현하는 데 법적 제약이 없다.
- **원본 의존성 구조**: Bun 모노레포(`apps/web`), Prisma + PostgreSQL, Upstash Redis, Better-Auth, TanStack Router, Zustand, `@ffmpeg/ffmpeg`(브라우저 31MB WASM 다운로드), 그리고 진행 중인 Rust/WASM 개편 코드가 결합되어 있다.
- **결정**: 외부 모노레포 코드나 WASM 번들을 통째로 들이지 않고, **선언형 타임라인 상태 모델(`clips[]`, `captions[]`, `bgm`, `aspect`, `undoStack`)만 TWINGS 자체 TypeScript + `--ys-*` 디자인 토큰**으로 깨끗하게 새로 작성한다(추가 npm 의존성 `0개`).

### 2-2. `OpenChatCut` (`https://github.com/0xsline/OpenChatCut`) 구조 및 OpenAI·Anthropic 약관 확인
1. **OpenChatCut이 실제로 연결하는 것**
   - OpenChatCut은 웹 SaaS가 아니라 **로컬 데스크톱 Electron + Remotion + FFmpeg 앱**이며 로컬 MCP 서버(`127.0.0.1:5199`)를 띄운다.
   - 연결 방식은 **(a) 사용자 PC에 설치된 로컬 CLI 에이전트(Claude Code / Codex CLI)**가 로컬 MCP 포트를 호출하거나, **(b) 사용자가 직접 입력한 API Key(BYOK)**를 쓰는 구조다. 호스팅된 웹 서비스가 소비자 구독 로그인 세션을 받아 대신 호출하는 구조가 아니다.
2. **Anthropic · OpenAI 소비자 구독 OAuth 약관 확인**
   - **Anthropic**: Consumer Terms 및 OAuth 정책상 Claude Free/Pro/Max 소비자 구독 세션·OAuth 토큰을 제3자 웹 SaaS가 수취·프록시해 호출하는 것은 **명시적으로 금지**된다(제3자 서비스는 정식 API 키 `sk-ant-…` 사용 필수).
   - **OpenAI**: 소비자 구독(ChatGPT Plus/Pro) 계정을 호스팅된 제3자 웹 서비스 백엔드에서 풀링·프록시하는 것은 약관상 제한되며, 위임 로그인(`Sign in with ChatGPT`)은 승인된 로컬 런타임 파트너 도구로 한정된다. 웹 서비스는 OpenAI Platform API(자체 크레딧 또는 사용자 BYOK `sk-…`)를 써야 한다.
3. **우리 구현 방향 (대표 질문 §7-3 선택지 지원)**
   - **기본 모드 (즉시 동작 · 유료 호출 0원)**: 한국어·영어 편집 의도를 구조화 패치(`TimelinePatch`)로 즉시 변환하는 **내장 채팅 편집 엔진**(순서 변경, 구간 길이 조절, 앞뒤 자르기, 자막 추가·수정·삭제, 비율 전환, 원음/배경음악 볼륨 조절, 실행 취소).
   - **선택 모드 (사용자 BYOK API 키 — 브라우저 세션 메모리에만 유지, 서버 DB·로그 미저장)**: 고객이 원하면 자신의 OpenAI(`sk-…`) 또는 Anthropic(`sk-ant-…`) API 키를 연결해 자연어 복합 지시를 같은 `TimelinePatch` JSON 스키마로 실행할 수 있게 지원한다(약관 100% 준수, 당사 크레딧 소모 0). 향후 대표가 당사 스튜디오 크레딧 차감형 LLM 채팅 편집을 선택하면 스위치 하나로 전환할 수 있다.

---

## 3. 내보내기(Export) 경로 비교 및 30초 · 1080p 실측

동일 기준(**30초 · `1920×1080` · 30fps = 900프레임**, 10초 클립 3개 연결 + 하단 Pretendard 자막 바 + 배경음악 믹스)으로 현 워크스테이션에서 실제 소요 시간을 측정했다.

| 경로 | 30초 · 1080p 실측 시간 | 장점 | 한계 및 운영 위험 | 채택 여부 |
| --- | --- | --- | --- | --- |
| **1. 브라우저 WebCodecs (`VideoEncoder` `avc1` + Canvas + 자체 MP4 먹서)** | **`3.88초`** (`3,879 ms`, 900 chunks) | 서버 CPU·메모리·함수 시간 `0`, Vercel Hobby 한도 무관, 결과물이 표준 H.264 `.mp4`(`ftyp`+`moov` faststart)라 `sniffMime`·모바일 재생 즉시 호환 | 운영 R2(`media.twings.app`)에 CORS 헤더가 없어 인증된 동일 출처 클립 스트림 경로 필요; 구형 브라우저는 폴백 필요 | **주 경로 채택** (+ 구형 브라우저 `MediaRecorder` 폴백) |
| **2. 브라우저 `MediaRecorder` 실시간 녹화 폴백** | **`30.4초`** (1.0× 재생 시간) | WebCodecs 미지원 환경에서도 동작 | 영상 길이만큼 실시간 대기 필요, 브라우저별 코덱 차이 | **자동 보조 폴백 채택** |
| **3. Vercel 서버 함수 (Hobby)** | 실행 불가 / 부적합 | 클라이언트 성능 무관 | Hobby 함수 제한(최대 60초, 메모리 1,024MB, 요청/응답 바디 4.5MB), `ffmpeg` 바이너리 번들 크기 한계, 동시 내보내기 시 즉시 OOM·타임아웃 | **기각** |
| **4. 로컬 작업기 `ffmpeg` (`libx264 -preset veryfast`)** | **`1.40초`** (`1,397 ms`, `686 KB`) | 가장 빠르고 오디오 리샘플링·다중 트랙 합성이 정밀함 (`libx264` 사용으로 Moonlight/GPU 추론 간섭 없음) | 예약 작업 워커 단일 장애점(`docs/SCALE-RISKS-2026-11.md` R-05) 및 대기열 지연 | 로컬 개발·향후 비동기 고해상도 마감 확장 경로로 보존 |

### R2 CORS 문제 해결 (보안 게이트 유지)
- 운영에서 `/api/brand-studio/media/[...key]`는 사진만 서빙하고 영상·오디오는 `404`다(`docs/BRAND-STUDIO-V3.md` §9-1).
- 따라서 `/api/brand-studio/compose`(인증 필수 + `studioAccess` 조직 멤버십 검증 + 모픽 샌드박스 `404`)에서 **선택한 조직 소유의 에셋(`assetId`)·생성물(`outputId`)에 한해** 바이트 스트림(`Range` 지원, `private, no-store`)을 건네주어, 브라우저 `<video>`·`<audio>`·Canvas가 오염(Tainted Canvas) 없이 안전하게 합성할 수 있게 한다.

---

## 4. 화면 및 데이터 모델

### 화면 구성 (기법 3가지 — `docs/design/TOOLBOX.md` §1-3)
1. **Alabaster / Pure White 층위 분리**: 좌측 클립·자막·음악 소스 서랍과 우측 채팅 편집 패널은 흰 카드(`#FFFFFF`), 중앙 프리뷰 무대는 조용한 알라바스터(`#F6F7F9`).
2. **Recessed Tactile Wells + Tabular Numerals**: 타임라인 트랙, 시작·끝 초(`0.1s` 단위), 볼륨 슬라이더, 재생 타임코드에 음각 트랙과 `tabular-nums` 고정폭 숫자 적용.
3. **TWINGS 단일 프렌치 블루 포인트 (`--ys-accent` / `--ys-accent-text`)**: 주요 내보내기 CTA 하나만 블루 채움(`#3875C5`), 선택된 클립은 `1.5px` 블루/잉크 테두리, 빨강 배지·버튼 없음.

### 타임라인 상태 (`ComposerProject`, `localStorage` 자동 임시 저장)
- `aspect`: `'9:16' | '16:9' | '4:5' | '1:1'` (기본 `'9:16'` — `1080×1920`, `'16:9'` — `1920×1080`, `'4:5'` — `1080×1350`, `'1:1'` — `1080×1080`)
- `clips`: `Array<{ id, label, sourceKind: 'asset' | 'output' | 'local', assetId?, outputId?, srcUrl, durationSec, trimStartSec, trimEndSec, volume, muted }>`
- `captions`: `Array<{ id, text, startSec, endSec, position: 'bottom' | 'center' | 'top', size: 'sm' | 'md' | 'lg' }>`
- `bgm`: `{ label, srcUrl, durationSec, trimStartSec, volume } | null`

---

## 5. 실패 시 동작 · 측정 지표 · 되돌리기

- **실패 시 동작**:
  - 클립이 하나도 없으면 내보내기 버튼을 비활성화하고 에셋 선택/업로드를 안내한다.
  - WebCodecs H.264 인코딩이 지원되지 않거나 실패하면 자동으로 `MediaRecorder` 폴백으로 내려가며, 에셋 저장 시 조직 저장 한도(묶음 F `storage_quota_exceeded`)에 걸리면 로컬 파일 다운로드는 그대로 성공시키고 한도 안내 문구만 표시한다.
- **측정할 숫자**: 내보내기 완료 시간(`ms`), 출력 파일 크기(`bytes`), 클립 수·총 길이(`sec`), 채팅 편집 명령 성공률.
- **되돌리는 방법**: DB 스키마 변경이 없으므로 해당 PR 커밋을 `git revert`하면 즉시 이전 상태로 복구된다.
