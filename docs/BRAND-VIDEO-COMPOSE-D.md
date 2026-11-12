# 브랜드 비디오 합치기 설계 (묶음 D) — 2026-11-12 개정

> 지시 원본: `docs/HANDOFF-2026-11-11-GEMINI.md` §4-D · §4-I · §7-3 (2026-11-12 대표 확정 정책 3 반영)
> 대상 주소: `/brand/studio/compose` (비디오 스튜디오 상단 진입 + 레일 `+ 만들기` 메뉴 연결)
> 격리 규칙: `studioRouteOrShowroom` 및 `studioSeat` 첫 줄 적용 — 모픽(`d425c3b1-…`, `deb648e9-…`, `Morphic`/`모픽`), `generative_media` 차단 조직, 캠페인 게스트, `BRAND_STUDIO_V2` 비활성 환경에서는 페이지와 API 모두 즉시 `404`를 반환한다. `project_only` 조직은 쇼룸(`<StudioShowroom focus="video" />`)을 노출하고 API 변경 호출은 `404`로 차단한다.

---

## 1. 목표와 하지 않을 것

### 목표
- 스튜디오에서 만든 영상·에셋에 올린 영상·내 컴퓨터 파일을 **순서대로 놓고**, 앞뒤 구간을 **자르고**, 원하는 초 구간에 **자막(Pretendard Variable)**과 **배경음악(볼륨 조절)**을 얹어 **1080p MP4 한 편으로 렌더링**하는 간결한 편집기를 만든다.
- 타임라인 조작이 낯선 고객도 **"1번째 컷 3초로 줄이고 마지막에 '신제품 출시' 자막 넣어줘"**, **"배경음악 볼륨 30%로 낮춰줘"**처럼 채팅으로 지시해 즉시 편집·되돌리기(Undo)할 수 있게 한다.
- **TWINGS 자체 크레딧 과금 체계 (대표 확정 정책 3)**:
  - **단순 타임라인 조작·자막 지시 채팅(`POST /api/brand-studio/compose` `chat.edit`)**: **무료(`0` 크레딧) + 분당 속도 제한(조직·멤버당 분당 `20회`, 초과 시 `429`)**으로 제공한다. 내장 한국어·영어 파서를 우선 실행하고, 자유 문장은 서버 구조화 파서로 `TimelinePatch[]`를 검증·반환한다. 외부 AI 벤더명·BYOK 키 입력창은 노출하지 않는다.
  - **고해상도 1080p 최종 렌더링(`render.reserve` / `render.refund`)**: 실행 시 조직 월간 한도에서 TWINGS 크레딧(`기본 10 + 초당 2 크레딧`)을 선차감하고, 브라우저 인코딩이 실패하면 즉시 **100% 자동 환불(`render.refund`)**한다.
- 내보낸 MP4는 브라우저에서 바로 내려받거나 1클릭으로 **에셋(`/brand/library`)에 저장**할 수 있게 한다.

### 하지 않을 것
- Premiere·After Effects 식 다중 트랙 키프레임·합성 노드·색보정 NLE로 복잡하게 만들지 않는다.
- 소비자 구독 OAuth 토큰 프록시나 고객 노출 화면의 외부 API 키(BYOK) 설정창을 두지 않는다.
- 새 무거운 외부 패키지(`@ffmpeg/ffmpeg` 31MB WASM, Remotion, Zustand 등)나 DB 마이그레이션을 추가하지 않는다(`brand_studio_jobs`의 `video_final` / `compose-1080p` 원장 행을 재사용하고 비디오 생성 보드 목록에서는 제외한다).

---

## 2. 사전 검증 결과 (라이선스 · 의존성 · 크레딧 구조)

1. **`OpenCut` (`https://github.com/opencut-app/opencut`) 라이선스 및 의존성 점검**
   - **MIT License** — 상업 서비스에서 타임라인 데이터 모델과 상호작용 구조를 참고해 자체 구현하는 데 법적 제약이 없다.
   - 무거운 모노레포·31MB WASM 번들 대신, 선언형 타임라인 상태 모델(`clips[]`, `captions[]`, `bgm`, `aspect`, `undoStack`)만 TWINGS 자체 TypeScript + `--ys-*` 디자인 토큰으로 작성했다(추가 npm 의존성 `0개`).
2. **채팅 편집(`OpenChatCut` 참고) 및 TWINGS 크레딧 확정안**
   - 소비자 구독 세션을 제3자 웹 서비스에서 위임·프록시하는 구조는 배제하고, **TWINGS 자체 서버 엔드포인트(`/api/brand-studio/compose`) + TWINGS 크레딧 체계**로 일원화했다.
   - 타임라인 조작·자막 지시 채팅은 `0` 크레딧 + 분당 `20회` 슬라이딩 윈도 속도 제한(`429` + `Retry-After`)으로 보호하고, 1080p MP4 최종 렌더링 실행 시에만 크레딧을 차감한다.

---

## 3. 내보내기(Export) 경로 비교 및 30초 · 1080p 실측

동일 기준(**30초 · `1920×1080` · 30fps = 900프레임**, 10초 클립 3개 연결 + 하단 Pretendard 자막 바 + 배경음악 믹스)으로 현 워크스테이션에서 실제 소요 시간을 측정했다.

| 경로 | 30초 · 1080p 실측 시간 | 장점 | 한계 및 운영 위험 | 채택 여부 |
| --- | --- | --- | --- | --- |
| **1. 브라우저 WebCodecs (`VideoEncoder` `avc1` + Canvas + 자체 MP4 먹서)** | **`3.88초`** (`3,879 ms`, 900 chunks) | 서버 CPU·메모리·함수 시간 `0`, 결과물이 표준 H.264 `.mp4`(`ftyp`+`moov` faststart)라 `sniffMime`·모바일 재생 즉시 호환 | 운영 R2(`media.twings.app`)에 CORS 헤더가 없어 인증된 동일 출처 클립 스트림 경로 필요; 구형 브라우저는 폴백 필요 | **주 경로 채택** (+ 구형 브라우저 `MediaRecorder` 폴백) |
| **2. 브라우저 `MediaRecorder` 실시간 녹화 폴백** | **`30.4초`** (1.0× 재생 시간) | WebCodecs 미지원 환경에서도 동작 | 영상 길이만큼 실시간 대기 필요, 브라우저별 코덱 차이 | **자동 보조 폴백 채택** |
| **3. 서버리스 함수 직접 인코딩** | 부적합 | 클라이언트 성능 무관 | 요청/응답 바디 한도, `ffmpeg` 바이너리 번들 크기 한계, 동시 내보내기 시 OOM·타임아웃 위험 | **기각** |
| **4. 로컬 작업기 `ffmpeg` (`libx264 -preset veryfast`)** | **`1.40초`** (`1,397 ms`, `686 KB`) | 가장 빠르고 오디오 리샘플링·다중 트랙 합성이 정밀함 (`libx264` 사용으로 Moonlight/GPU 추론 간섭 없음) | 예약 작업 워커 단일 장애점(`docs/SCALE-RISKS-2026-11.md` R-05) 및 대기열 지연 | 로컬 개발·향후 비동기 고해상도 마감 확장 경로로 보존 |

### R2 CORS 문제 해결 (보안 게이트 유지)
- 운영에서 `/api/brand-studio/media/[...key]`는 사진만 서빙하고 영상·오디오는 `404`다(`docs/BRAND-STUDIO-V3.md` §9-1).
- 따라서 `/api/brand-studio/compose`(인증 필수 + `studioSeat` 조직 멤버십·`self_studio` 검증 + 모픽 샌드박스 `404`)에서 **선택한 조직 소유의 에셋(`assetId`)·생성물(`outputId`)에 한해** 바이트 스트림(`Range` 지원, `private, no-store`)을 건네주어, 브라우저 `<video>`·`<audio>`·Canvas가 오염(Tainted Canvas) 없이 안전하게 합성할 수 있게 한다.

---

## 4. 화면 및 데이터 모델

### 화면 구성 (기법 3가지 — `docs/design/TOOLBOX.md` §1-3)
1. **Alabaster / Pure White 층위 분리**: 좌측 클립·자막·음악 소스 서랍과 우측 채팅 편집 패널은 흰 카드(`#FFFFFF`), 중앙 프리뷰 무대는 조용한 알라바스터(`#F6F7F9`).
2. **Recessed Tactile Wells + Tabular Numerals**: 타임라인 트랙, 시작·끝 초(`0.1s` 단위), 볼륨 슬라이더, 잔여·필요 크레딧 배지, 재생 타임코드에 음각 트랙과 `tabular-nums` 고정폭 숫자 적용.
3. **TWINGS 단일 프렌치 블루 포인트 (`--ys-accent` / `--ys-accent-text`)**: 주요 렌더링 CTA 하나만 블루 채움(`#3875C5`), 선택된 클립은 `1.5px` 블루/잉크 테두리, 빨강 배지·버튼 없음.

### 타임라인 상태 (`ComposerProject`, `localStorage` 자동 임시 저장)
- `aspect`: `'9:16' | '16:9' | '4:5' | '1:1'` (기본 `'9:16'` — `1080×1920`, `'16:9'` — `1920×1080`, `'4:5'` — `1080×1350`, `'1:1'` — `1080×1080`)
- `clips`: `Array<{ id, label, sourceKind: 'asset' | 'output' | 'local', assetId?, outputId?, srcUrl, durationSec, trimStartSec, trimEndSec, volume, muted }>`
- `captions`: `Array<{ id, text, startSec, endSec, position: 'bottom' | 'center' | 'top', size: 'sm' | 'md' | 'lg' }>`
- `bgm`: `{ label, srcUrl, durationSec, trimStartSec, volume } | null`

---

## 5. 실패 시 동작 · 측정 지표 · 되돌리기

- **실패 시 동작**:
  - 클립이 하나도 없거나 읽기 전용 권한(`viewer`)이면 렌더링 버튼을 비활성화한다.
  - 월간 잔여 크레딧이 부족하면 인코딩을 시작하지 않고 필요한 크레딧 수를 안내한다(`allowance_exhausted`).
  - 인코딩 도중 브라우저 오류가 발생하면 `render.refund`를 자동 호출해 차감된 크레딧을 100% 즉시 환불하고 안내 문구를 표시한다.
  - 에셋 저장 시 조직 저장 한도(묶음 F `storage_quota_exceeded`)에 걸리면 로컬 파일 다운로드는 그대로 성공시키고 한도 안내 문구만 표시한다.
- **측정할 숫자**: 렌더링 완료 시간(`ms`), 출력 파일 크기(`bytes`), 클립 수·총 길이(`sec`), 차감·환불 크레딧, 채팅 편집 명령 성공률.
- **되돌리는 방법**: DB 스키마 변경이 없으므로 해당 PR 커밋을 `git revert`하면 즉시 이전 상태로 복구된다.
