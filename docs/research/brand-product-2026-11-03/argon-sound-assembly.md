# Gemini 4 Argon과 '사운드 조립' — 공식 스펙 확인과 설계 제안

> 작성 2026-11-03. 저장소 `D:\dev\twings` main `119f4ea2` 기준. 모든 가격·한도는 확인 날짜 2026-11-03, 출처 URL을 함께 적었다. 1차 출처를 못 찾은 값은 **미확인**으로 표시했다. 코드는 수정하지 않았고 API는 호출하지 않았다.

## 0. 결론

1. **대표의 해석은 맞다.** 공식 모델 페이지 기준 Argon(`gemini-4-argon`)은 입력 Text·Image·Video·Audio·PDF, **출력 Text만**이고 **Audio generation: Not supported**다. 영상을 보고 듣고 큐를 고르고 배치를 지시하고 결과를 재판정하는 '사운드 디렉터'는 되지만, 소리 자체는 만들지 못한다. ([모델 페이지](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon))
2. **"유일한 모델"은 아니다.** Gemini 3.8 Flash도 같은 입력 모달리티(오디오·영상 포함)와 agentic video understanding을 지원하고, 가격은 Argon의 약 1/2.7이다. Argon의 차이는 플래그십 추론 품질과 1M long decode, 그리고 가격이다. ([3.8 Flash 모델 페이지](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [요금](https://ai.google.dev/gemini-api/docs/pricing))
3. **Argon은 무료 티어가 없다.** 입력 $2.00 / 출력 $10.00(thinking 토큰 포함) per 1M — 2026-11-30까지의 한시 가격이고 **12월 1일부터 $4.00 / $20.00**으로 두 배가 된다. 선불 크레딧이 0이라(402) 충전 전엔 어떤 테스트도 못 한다.
4. **비용은 출력(thinking) 토큰이 결정한다.** 15초 영상 1편의 조립 루프(영상 3회 + 오디오 2회 + 호출 5회)는 **11월 가격 기준 약 $0.22~0.41/편, 12월부터 $0.43~0.83/편**. 월 500편이면 **$108~207(11월) / $216~414(12월~)**. 영상 입력 토큰 자체는 15초에 1,500 토큰($0.003)밖에 안 된다.
5. **한국 가용:** Gemini Developer API 가용 지역에 South Korea가 있다. Vertex AI에서는 Argon이 global·us·eu·London·Singapore 엔드포인트뿐이고 **Seoul(asia-northeast3)은 없다** — 한국 내 데이터 상주는 불가.
6. **데이터 정책:** 유료 티어는 프롬프트·응답을 제품 개선에 쓰지 않고 DPA(Google이 처리자) 아래 처리한다. 무료 티어는 제품 개선에 쓰고 사람이 읽을 수 있다 → **브랜드 자료는 무료 티어에 절대 넣지 않는다.**
7. **설계:** Argon = 큐 리스트·선택·판정을 JSON으로 내는 디렉터, 생성은 별도 엔진, 배치·레벨·마스터는 결정론적 믹서(`real-sound` 스크립트), 측정은 earshot. Argon의 판정은 "의미·취향 대리", earshot의 숫자는 "사실". 둘이 어긋나면 숫자가 이기고 사람이 본다.

## 1. Argon 공식 스펙

| 항목 | 값 | 출처 (확인 2026-11-03) |
| --- | --- | --- |
| 모델 id | `gemini-4-argon` (Stable). Vertex에는 `gemini-4-argon-cyber-permissive` 변형도 있음 | [모델 페이지](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon), [Vertex locations](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) |
| 입력 | Text, Image, Video, Audio, PDF | 모델 페이지 |
| 출력 | **Text만** | 모델 페이지 |
| Audio generation / Image generation / Live API | **Not supported** (셋 다) | 모델 페이지 |
| 컨텍스트 | 1,048,576 토큰 (입력+출력 통합) | 모델 페이지 |
| 최대 출력 | 65,536 (동기 기본) / long decode 시 최대 1,048,576 | 모델 페이지 |
| Agentic video understanding | Supported (기본은 static) | 모델 페이지, [video-understanding](https://ai.google.dev/gemini-api/docs/video-understanding) |
| Thinking | Supported (low / medium / high) — **thinking 토큰도 출력 단가로 과금** | 모델 페이지, [요금 callout](https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon) |
| Structured outputs / Function calling / URL context / File search / Code execution | Supported | 모델 페이지 |
| Caching | Implicit only (explicit 미지원) | 모델 페이지 |
| Batch API / Flex / Priority | Supported | 모델 페이지 |
| 최신 업데이트 | 2026-10 (모델 카드 발행 2026-10-13) | 모델 페이지, [모델 카드](https://deepmind.google/models/model-cards/gemini-4-argon/) |
| 지식 컷오프 | 2026-03 | 모델 카드 |
| 모델 카드의 멀티모달 한계 | "hallucinations 등 파운데이션 모델의 일반 한계"만 언급. **오디오·영상 전용 환각 지표 없음**, 오디오 길이·fps 한도도 카드에 없음 | 모델 카드 |

Antigravity 블로그(2026-10-13)는 Argon을 "software engineering, enterprise knowledge work(legal·finance), cybersecurity defense" 플래그십으로 소개하고, 사운드·오디오 능력은 한 줄도 언급하지 않는다. ([블로그](https://antigravity.google/blog/gemini-4-argon-in-google-antigravity)) 2차 기사에는 "Gemini 4 Carbon이 10-28 발표됐다"는 말이 있으나 공식 모델 목록에는 Gemini 4가 Argon 하나뿐이다 — **미확인**.

### 1.1 가격 (per 1M tokens, USD)

| 모드 | 입력 | 출력(thinking 포함) | 캐시(implicit) | 기간 |
| --- | --- | --- | --- | --- |
| Standard | $2.00 | $10.00 | $0.10 | ~2026-11-30 |
| Standard | **$4.00** | **$20.00** | $0.20 | 2026-12-01~ |
| Batch / Flex | $1.00 → $2.00 | $5.00 → $10.00 | $0.05 → $0.10 | 위와 같은 전환일 |
| Priority | $3.60 → $7.20 | $18.00 → $36.00 | $0.18 → $0.36 | 위와 같은 전환일 |
| Free tier | **Not available** | — | — | — |

- 출처: [요금 페이지 Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon). 오디오·영상 입력에 별도 단가가 없다 — 모든 모달리티가 같은 토큰 단가다. PDF(DOCUMENT)는 이미지 토큰 단가로 과금([Notes](https://ai.google.dev/gemini-api/docs/pricing#notes)).
- Grounding with Google Search/Maps: 월 5,000건 무료(Gemini 3 이상 공유), 이후 $14/1,000건, 일 1,500건 상한. 사운드 조립엔 불필요.

### 1.2 레이트 리밋·과금 티어

| 티어 | 자격 | 10분 지출 상한 | 과금 상한 | Argon Batch enqueued tokens |
| --- | --- | --- | --- | --- |
| Free | 프로젝트 활성 | N/A | N/A | (Argon 사용 불가) |
| Tier 1 | 결제 계정 연결 | $10 | $250 | 5,000,000 |
| Tier 2 | $100 결제 + 3일 | $200 | $2,000 | 500,000,000 |
| Tier 3 | $1,000 결제 + 30일 | $200 | $20,000~ | 1,000,000,000 |

- 출처: [rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits), [billing](https://ai.google.dev/gemini-api/docs/billing). **모델별 RPM·TPM·RPD 수치는 문서에 없고 AI Studio에서만 보인다** → 미확인.
- 결제: 신규 계정은 Prepay 기본, 최소 충전 $5(지역별로 UI가 최소액 표시), 크레딧은 12개월 뒤 소멸·환불 불가, 잔액 $0이면 모든 키가 402. **Google Cloud $300 무료 체험·Welcome credit은 2026-03부터 Gemini API에 쓸 수 없다.** ([billing FAQ](https://ai.google.dev/gemini-api/docs/billing#cloud-free-trial))

### 1.3 데이터 사용 정책 (브랜드 자료 보호 관점)

| | 무료(Unpaid) | 유료(Paid) |
| --- | --- | --- |
| 제품 개선에 사용 | **예** — 프롬프트·파일·응답 사용, 사람 검토자가 읽을 수 있음, "민감·기밀·개인정보 제출 금지" | **아니오** — DPA(Google = 처리자) 아래 처리 |
| 로그 | — | 남용 감지 목적으로 제한 기간 보관 |
| EEA·스위스·영국 사용자 대상 서비스 | 불가 | 유료만 허용 |
| 생성물 소유권 | Google은 소유권 주장 안 함 (같은 내용을 타인에게 생성할 수 있음) | 같음 |

출처: [Gemini API Additional Terms (2026-03-23 발효)](https://ai.google.dev/gemini-api/terms). 함의: 브랜드 기획서·무드보드·미공개 영상은 **유료 티어 키로만** 보낸다. 무료 티어 3.8 Flash로 하는 테스트는 TWINGS 자체 공개 영상(`public/reel/landing/v7/`)만 쓴다.

### 1.4 한국 가용

- Gemini Developer API: [available regions](https://ai.google.dev/gemini-api/docs/available-regions)에 South Korea 포함. 지역 선택은 없다(글로벌 서빙).
- Vertex AI(Gemini Enterprise Agent Platform): Argon 지원 엔드포인트는 **global, us(multi), eu(multi), London(europe-west2), Singapore(asia-southeast1)**. **Seoul(asia-northeast3) 미지원.** 3.8 Flash는 global·us·eu만, Omni 1.1 Flash(preview)는 global만. ([locations](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations))
- 호출 경로는 지금 `lib/images/gemini.ts`가 쓰는 Interactions API(`POST /v1beta/interactions`, `x-goog-api-key: GEMINI_API_KEY`)를 그대로 쓰면 된다. agentic video 모드와 `steps[]` 응답이 이 API 문법이다.

## 2. 오디오·영상 입력 한도와 토큰 환산

| 항목 | 값 | 출처 |
| --- | --- | --- |
| 오디오 토큰 | **32 tokens/초** (1분 = 1,920) | [audio](https://ai.google.dev/gemini-api/docs/audio#technical-details) |
| 오디오 최대 길이 | 프롬프트당 9.5시간 | audio |
| 오디오 품질 | **16 Kbps로 다운샘플**, 다채널은 모노 합산, 비음성 소리(새소리·사이렌 등) 이해 | audio |
| 오디오 포맷 | WAV, MP3, AIFF 등 | audio |
| 인라인 요청 상한 | 요청 전체 20 MB (프롬프트+파일) → 초과 시 Files API | audio, video |
| Files API 상한 | 유료 20 GB / 무료 2 GB | video |
| 영상 static 모드 | 1 FPS 샘플, 프레임당 66(low) / 258(default·high) 토큰 + 오디오 32/초 + 메타 → **약 100 tok/초(low) / 약 300 tok/초(high)**; 영상 안 오디오는 **1 Kbps 모노**로 처리, 타임스탬프 1초 단위 | [video](https://ai.google.dev/gemini-api/docs/video-understanding#technical-details-video), [tokens](https://ai.google.dev/gemini-api/docs/tokens#video) |
| 영상 agentic 모드 | 모델이 타임라인을 탐색하며 필요한 프레임·오디오·대본만 로드. 장편에서 최대 88% 절감, **5분 미만 클립에선 오히려 토큰·TTFT 증가** 가능. 토큰은 `total_thought_tokens`(출력 단가) + `total_tool_use_tokens` | video, tokens |
| 영상 최대 길이 | 1M 컨텍스트 모델: low 3시간 / high 1시간 | video |
| 커스텀 fps / 구간 클리핑 / `media_resolution` | 지원(`processing.fps`, clipping intervals, `media_resolution`) — 토큰은 fps에 비례 | video |
| 15초 영상 1회 | low ≈ 1,500 토큰, high ≈ 4,500 토큰 | 계산 |

주의 두 가지.
- tokens 가이드 머리말은 "Video: 263 tokens per second"라 쓰고 표는 "~100 / ~300"이라 쓴다. 문서 내부 불일치 → 실제 `usage`로 확인.
- Argon이 '듣는' 소리는 영상 안이면 1 Kbps, 별도 오디오면 16 Kbps다. **고역 질감·트루피크·마스킹 같은 미세 판정은 Argon이 아니라 earshot 미터가 해야 한다.** Argon에게 믹스를 들려줄 땐 영상과 별도로 사운드트랙 WAV를 오디오 입력으로 함께 준다.

## 3. '사운드 조립' 아키텍처 제안

### 3.1 역할 분담

| 층 | 담당 | 하는 일 | 안 하는 일 |
| --- | --- | --- | --- |
| 디렉터 | **Argon** (또는 3.8 Flash) | 영상을 보고 듣고 `cue_plan.json`(큐·재질·감정·음악 드롭 위치·금지 사항) 작성, 후보 SFX·음악 선택 이유, 믹스 재판정(무엇이 싸구려인지·브랜드 룰 위반인지) | 소리 생성, 프레임 단위 타이밍, 레벨 수치 결정 |
| 큐 프레임 | 픽처 코드 / earshot | 컷·접촉·로고 가독 프레임을 **프레임 정확도**로 계산(`cues.json`, id `act:thing:n`) | — |
| 생성·소싱 | 음악: 상업 라이선스 엔진 또는 라이선스 트랙(§7.2) · SFX: ElevenLabs SFX API 또는 CC0/Mixkit/Pixabay 뱅크(`real-sound` 라이선스 정책: NC·ND·SA·unverified 금지) | 후보 3~5개씩 | 라이선스 판단(사람·audit.py) |
| 믹서 | `real-sound/scripts/mix.py` + `master.py` (ffmpeg·numpy) | 트림·배치·레벨·팬·EQ·리샘플 피치·바라인 음악 편집·마스터(-14 LUFS, 트루피크 리미터; 게이트 ±0.5 LU, ≤ -1.5 dBTP) | 생성 |
| 측정 | earshot (`timeline`, `sheet`, `critique`, `measure`, `rank`, `realness`) | LUFS·dBTP·LRA, 컷 대비 sync `offset_ms`와 `chance`, 런치필름 7편 대비 스코어카드, 후보 순위 z | 취향, 가사·언어, 라이선스 |
| 사람 | 브랜드 담당·YAGI | 취향 최종 결정, 라이선스 확인, 루프 탈출 | — |

### 3.2 파이프라인 (15초 영상 1편)

1. **큐 프레임**: 픽처 소스가 코드면 `export-cues.ts`식 `cues.json`, 생성 영상이면 earshot `timeline --detail high`로 컷·온셋을 뽑는다. 이 프레임이 유일한 타이밍 원본이다.
2. **디렉터 1차 (Argon, 영상 입력 1회)**: 무음 영상 + `cues.json` + 브랜드 사운드 룰(고정 층: 보이스오버 금지, 로고 리빌에 드롭, 재질 팔레트, 금지 장르) → Structured outputs로 `cue_plan.json`:
   ```json
   { "palette": ["glass", "paper", "air"],
     "cues": [ { "cue_id": "logo:reveal:1", "t_hint": "00:12", "kind": "music_drop", "intent": "…", "must": true },
               { "cue_id": "bottle:contact:3", "t_hint": "00:04", "kind": "sfx", "material": "glass on stone", "level_role": "accent" } ],
     "music": { "mood": "…", "tempo_hint": 96, "drop_cue": "logo:reveal:1", "avoid": ["edm","trap"] },
     "no_sound_at": ["00:00-00:01"] }
   ```
   `t_hint`는 초 단위 힌트일 뿐이고 믹서는 `cue_id`로 `cues.json`의 프레임에 스냅한다.
3. **소싱·생성**: 큐별 후보 3~5개(ElevenLabs SFX 프롬프트 또는 뱅크 검색), 음악 후보 2~3개. `audit.py`로 라이선스 분류.
4. **디렉터 2차 (Argon, 오디오 입력 1회)**: 후보 묶음(큐당 3~5개, 총 60~90초)을 듣고 큐별 1순위·이유. earshot `rank`/`match` z와 비교해 **둘 다 상위**인 후보만 채택, 어긋나면 사람 목록으로.
5. **믹스·마스터**: `mix.py` → `master.py` → `qa.py --layers --listen --realness`.
6. **판정 (Argon, 영상+오디오 입력 1회)**: 소리 붙은 영상 + 사운드트랙 WAV + earshot `critique`·`timeline` JSON을 같이 준다. 출력은 `verdict.json`: `{pass, issues:[{cue_id, t, type: late|early|missing|cheap|masking|rule_violation, fix}]}`.
7. **수정**: Argon의 issue 중 타이밍·레벨 유형은 earshot 숫자로 **검증된 것만** `variant.py` 연산으로 옮긴다(Argon 타임스탬프는 1초 해상도·근사치). 재질·취향 유형은 후보 교체.
8. **재판정** 1회(영상 입력 1회). 종료 조건을 만족하면 `mux.mjs`로 합치고 earshot `timeline`으로 완성본을 한 번 더 듣는다.

### 3.3 earshot 지표와 Argon 판정의 병행 규칙

| 질문 | 누가 답하나 | 근거 |
| --- | --- | --- |
| 소리가 컷에 맞았나 | earshot `offset_ms` (±100 ms = 온셋 인정, `chance`보다 좋아야 의미) | Argon은 1초 단위 타임스탬프, 모델 카드에 sync 지표 없음 |
| 라우드니스·트루피크·LRA | earshot `measure` (BS.1770) | Argon은 16 Kbps/1 Kbps로 듣는다 |
| 진짜 녹음처럼 들리나 | earshot `p_real` (증거 목록 포함) | 정량 |
| 재질이 화면과 맞나, 싸구려인가, 브랜드 톤인가 | **Argon** | earshot은 "taste is not measured" |
| 브랜드 룰 위반(보이스오버, 금지 장르, 드롭 위치) | **Argon** + 룰 기반 체크 | 의미 판단 |
| 라이선스 | 사람 + `audit.py` | 둘 다 못 한다 |

### 3.4 루프 종료 조건

- **통과**: earshot `critique` 판정이 launch-grade 또는 close **그리고** critical 행 0 **그리고** Argon `verdict.pass = true`(must 큐 전부 충족, rule_violation 0).
- **상한**: 디렉터 판정 최대 3회(영상 입력 3회). 3회에도 미통과면 사람에게 넘긴다 — Argon에게 "다시"를 더 시켜도 비용만 는다.
- **불일치 규칙**: Argon이 "늦었다"고 하는데 earshot `offset_ms`가 ±40 ms면 Argon을 무시하고 기록만 남긴다. earshot이 critical인데 Argon이 pass면 earshot이 이긴다.
- **중단**: 라이선스 unverified 자산이 하나라도 있으면 mux 금지(real-sound 정책).

## 4. Argon의 다른 역할

### 4.1 브리프 컨시어지 (기획서 PDF·무드보드·레퍼런스 영상 → 촬영 지시서 초안)

- 가능: PDF 입력 지원(이미지 단가), 1M 컨텍스트에 34장 덱 + 무드보드 이미지 + 레퍼런스 영상 15~60초가 다 들어간다. Structured outputs로 `components/brand-workspace/brief-concierge.tsx`의 `GAP_QUESTIONS` 모양(필드·근거·디렉터 기본값·status)을 그대로 채울 수 있다. 지금 이 컴포넌트는 `runArgonAnalysis`가 `setTimeout`인 목업이고 근거 문장이 하드코딩이다 — 실제 호출은 서버 액션에서 Interactions API로 바꾸면 된다(이번 보고서에선 수정 안 함).
- 한계: Figma 링크는 URL context 도구로 못 읽는다(인증 필요) → 내보낸 PNG/PDF를 받는다. 레퍼런스 영상은 static 1 FPS라 빠른 컷 편집은 놓친다 → `fps` 올리거나 agentic 모드.
- 환각 위험: 모델 카드가 hallucination을 일반 한계로 명시. **덱에 없는 "근거"를 만들어낼 수 있다** → 모든 추출 필드에 `evidence: {page, quote}`를 강제하고, quote가 원문에 실제로 있는지 문자열 검증(코드)으로 거른다. 통과 못 한 필드는 "assumed"로 내려 사람이 확인.
- 사람 검수 위치: 클라이언트에게 지시서를 보내기 **전** 1회(PD). 그 전 단계는 자동.

### 4.2 결과물 QA (마크·피부·손·팔레트 이탈)

- 가능: 이미지 입력 + `media_resolution: high`로 로고 형태·좌우반전·색 대역을 설명하게 할 수 있다. 팔레트 이탈은 코드(픽셀 통계)가 더 정확하다 — Argon은 "왜 이탈로 보이나"의 설명 역할.
- 한계·위험: 손가락 개수·피부 질감 같은 미세 결함은 모델이 놓치거나 반대로 없는 결함을 보고할 수 있다(오디오·영상 전용 환각 지표 없음). **Argon의 "fail"은 플래그, "pass"는 보증이 아니다.**
- 사람 검수 위치: Argon pass → 사람 1회(공개 전), Argon fail → 사람이 보고 결정. `docs/design/IDENTITY.md` §6-4-3 로컬 수정 규칙은 그대로.

## 5. 비용 추정 (15초 영상 1편, 사운드 조립 루프)

가정: 호출 5회(큐 플랜 1 · 후보 선택 1 · 판정 2 · 최종 1), 영상 입력 3회, 오디오 입력 2회(후보 90초 + 믹스 15초), 호출당 텍스트(시스템·브랜드 룰·스키마·이전 JSON) 3,000 토큰, thinking은 출력 단가.

| 시나리오 | 입력 토큰 | 출력 토큰(thinking 포함) | 11월 단가 | 12월~ 단가 | 월 500편 (11월 / 12월~) |
| --- | --- | --- | --- | --- | --- |
| 표준 (video low 100 tok/s, thinking medium ≈2,500/호출) | ≈23,000 | ≈17,000 | **$0.22** | **$0.43** | $108 / $216 |
| 고해상·깊은 추론 (video high 300 tok/s, thinking high ≈6,000/호출) | ≈32,000 | ≈35,000 | **$0.41** | **$0.83** | $207 / $414 |
| 표준을 Batch로 | 같음 | 같음 | $0.11 | $0.22 | $54 / $108 |
| 같은 표준 루프를 3.8 Flash로 | 같음 | 같음 | $0.08 | ($0.16, 2027-01~) | $41 |

- 계산: 표준 = 23k×$2/1M + 17k×$10/1M = $0.046 + $0.170. **출력이 전체의 약 80%.** 영상 3회 입력은 $0.009에 불과하다.
- 원화: 환율은 **가정 1 USD = 1,450원(미확인)** → 표준 500편 ≈ 157,000원(11월) / 313,000원(12월~), 고해상 ≈ 300,000 / 600,000원. Google 결제는 USD이며 부가세·카드 수수료 별도.
- 비교 — 생성 비용(Argon 밖): ElevenLabs SFX $0.12/분 → 큐 8개×10초 ≈ $0.16/편(분당 과금일 때; 생성당 과금이면 ≈ $0.96, 과금 단위 미확인). Lyria 3.5 $0.08/곡. Omni Flash로 소리 포함 15초를 통째로 만들면 출력만 5,792 tok/s × 15 s × $17.5/1M ≈ **$1.52/편**(≈ $0.10/초), 500편 ≈ $760.
- 절감: 시스템 프롬프트는 implicit caching($0.10/1M)이 자동 적용될 수 있다. 판정 2회차를 3.8 Flash로 내리면 디렉터 1차만 Argon으로 둘 수 있다.

## 6. 테스트 계획

- **무료 티어로 Argon 테스트는 불가능하다**(Free tier: Not available). Cloud 무료 체험 $300도 Gemini API엔 못 쓴다.
- 무료로 할 수 있는 것: `gemini-3.8-flash` 무료 티어로 같은 프롬프트·스키마·루프를 돌려 **파이프라인 모양**을 검증. 단, 무료 티어는 데이터가 제품 개선에 쓰이므로 입력은 TWINGS 자체 공개 영상(`public/reel/landing/v7/`)과 CC0 소리만.
- Argon 본 테스트에 필요한 최소 충전: 아래 5개 케이스 × 2회 ≈ 10호출 × ≤$0.5 ≈ **$5 이내**. 최소 충전액 $5(지역별 UI 확인). 여유와 재시도를 보면 **$10 충전**을 권한다. 충전은 대표 결정.

| # | 케이스 | 입력 | 기대 출력 | 판정 기준 | 호출당 비용(11월) |
| --- | --- | --- | --- | --- | --- |
| 1 | 큐 추출 | 무음 15초 (v7 히어로 컷) + 브랜드 룰 | `cue_plan.json` (schema 검증) | 사람이 표시한 컷·접촉 프레임과 `t_hint` 차이 ≤ 1초, must 큐 누락 0, 스키마 통과 5/5 | ≈ $0.05 |
| 2 | 후보 선택 | 한 큐의 CC0 후보 5개(각 ≤3초) + 큐 설명 | 1순위·이유 | earshot `rank` 상위 2와 교집합 ≥ 1, 사람 선택과 일치율 | ≈ $0.03 |
| 3 | 믹스 결함 탐지 | 같은 영상의 믹스 A(정상, -14 LUFS) / B(SFX 200 ms 지연 + 음악 +6 dB) | `verdict.json` | B에서 지연·음악 과대 둘 다 보고, 시각 ±1초, A에 거짓 결함 0 | ≈ $0.08 |
| 4 | 환각 프로브 | (a) 컷에 소리 없는 영상, (b) 화면 원인 없는 소리가 든 영상 | 누락·불필요 소리 보고 | earshot `timeline` 대비 false positive / negative 각 ≤ 1 | ≈ $0.08 |
| 5 | 브랜드 룰 준수 | 룰(보이스오버 금지, 00:12 드롭) + 위반 믹스 / 준수 믹스 | pass/fail + 위반 항목 | 정답 일치 2/2, `rule_violation`에 cue_id 포함 | ≈ $0.06 |

각 케이스는 `usage`의 `total_input_tokens / total_thought_tokens / total_output_tokens`를 기록해 §5 가정을 실측으로 바꾼다. 결과 파일은 `docs/research/brand-product-2026-11-03/argon-tests/`(제안)에 두고 코드엔 넣지 않는다.

## 7. 대안 비교

### 7.1 '들을 수 있는' 모델

| 모델 | 입력 | 출력 | 가격 (per 1M) | 비고 |
| --- | --- | --- | --- | --- |
| Gemini 4 Argon | 텍스트·이미지·영상·오디오·PDF | 텍스트 | $2 / $10 → 12월 $4 / $20 | 무료 없음, agentic video, 1M |
| Gemini 3.8 Flash | 같음 | 텍스트 | $0.75 / $3.75 (~2026-12-31) → $1.50 / $7.50 | **무료 티어 있음**(학습 사용), agentic video 지원, 최신 2026-09 |
| Gemini 3.1 Pro Preview | 멀티모달 | 텍스트 | $2 / $12 (≤200k) | Preview, Argon보다 비싸거나 같음 — 이유 없음. "Gemini 3.8 Pro"는 **존재하지 않는다**(모델 목록 확인) |
| OpenAI gpt-audio-1.5 / gpt-realtime-2.1 | 오디오(+텍스트) | 오디오·텍스트 | 오디오 입력 **$32** / 출력 $64; mini $10 / $20 | Argon 입력 단가의 16배. 영상 입력은 요금 페이지에 없음(미확인) |
| OpenAI gpt-5.6-sol | 텍스트·이미지 | 텍스트 | $4 / $20 (프로모 ~2026-11-21) | 오디오·영상 입력 단가 없음 → 사운드 디렉터로 부적합 |

출처: [Gemini 요금](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 모델 목록](https://ai.google.dev/gemini-api/docs/models), [OpenAI 요금](https://developers.openai.com/api/docs/pricing). 결론: 영상+오디오를 함께 '보고 듣는' 텍스트 출력 모델로는 Gemini 계열이 유일하게 싸고, 그 안에서 **Argon vs 3.8 Flash는 품질 차이를 §6 테스트로 재야 한다.** 디렉터 1차는 Argon, 반복 판정은 3.8 Flash로 섞는 구성이 비용상 자연스럽다.

### 7.2 생성 엔진 후보 (Argon 밖)

| 용도 | 후보 | 가격 | 라이선스·제약 |
| --- | --- | --- | --- |
| 음악 | Lyria 3.5 (`lyria-3.5`, Gemini API 유료) | $0.08/곡 | Google 소유권 주장 안 함; 상업 사용 조건·SynthID 표시 요건은 모델 페이지에서 추가 확인 필요(미확인) |
| 음악 | music-creator(YuE2) | 로컬 | **CC BY-NC** — 브랜드 상업물에 불가(기존 메모리와 일치) |
| 음악 | 라이선스 트랙 라이브러리 | 트랙당 | real-sound의 music supervisor 흐름, 바라인 편집 |
| SFX | ElevenLabs Sound Effects API | **$0.12/분**(페이지 표), FAQ는 "per generation"이라 단위 불일치 | "Royalty-free"; 상업 사용 조건은 Music 항목에만 명시 → 확인 필요 |
| SFX | CC0/Mixkit/Pixabay 뱅크 + earshot sfx kit | 무료 | real-sound 정책: CC BY는 크레딧 필수(광고엔 부담) → CC0·Mixkit·Pixabay 우선 |
| V2A(영상→소리) 모델 | 공식 Gemini API에 없음 | — | 미확인. Omni가 유일한 '영상과 함께 소리' 경로 |

### 7.3 Gemini Omni Flash로 소리 포함 영상을 바로 만드는 경로

| | Argon 디렉터 + 조립 | Omni 통짜 생성 |
| --- | --- | --- |
| 소리 통제 | 큐·재질·레벨·드롭 프레임을 코드가 결정, 재질 교체 가능, 브랜드 음악 사용 가능 | 프롬프트 문장으로만("calm background music", "At 5s the chorus starts"); **오디오 레퍼런스 업로드 불가, 영상 레퍼런스의 오디오는 무시, 보이스 편집 불가** |
| 브랜드 룩 유지 | 픽처는 그대로(사운드만 입힘) | 사운드를 바꾸려면 영상을 다시 생성 → 룩이 흔들림. 입력 영상은 편집·연장 시 10초 이하 |
| 라이선스 | 자산별 추적(`audit.py`, credits) | 생성물 일괄, SynthID 워터마크 |
| 비용(15초) | Argon $0.22~0.41 + 생성 $0.2~1 | 출력 ≈ $1.52(720p 기준, 1080p·4K는 업스케일) |
| 길이 | 제한 없음 | 3~10초 출력 (연장은 끝에만) |
| 적합 | 브랜드 캠페인 본편·반복 포맷 | 티저 컷, 빠른 시안 |

출처: [Omni 모델 페이지](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash), [Omni 가이드 Limitations·Prompting the audio](https://ai.google.dev/gemini-api/docs/omni#limitations). Omni는 "소리 통제력"과 "브랜드 룩 유지" 둘 다 TWINGS 포지션(고정 층 + 바뀌는 것)과 맞지 않는다. 시안용 보조로만.

## 8. 저장소 안 Argon 흔적과 연결 지점

| 위치 | 지금 | 연결 방법 |
| --- | --- | --- |
| `lib/images/gemini.ts` | Interactions API 클라이언트(`GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_IMAGE_MODEL`), 이미지 전용, `usage` 파싱 있음 | 같은 엔드포인트로 `model: "gemini-4-argon"` + `response_format` JSON schema. 모델 id는 `GEMINI_REASONING_MODEL`류 env로 두고 기본값을 상수에(이미지 쪽 `GEMINI_IMAGE_MODEL` 패턴) |
| `components/brand-workspace/brief-concierge.tsx` | 클라이언트 목업: `runArgonAnalysis`가 `setTimeout`, 근거 문장 하드코딩, 칩 "Argon 멀티모달 분석 × Fable 디렉터 대화" | §4.1대로 서버 액션 + evidence 문자열 검증 |
| `app/(brand)/workspace.css` | `/* AI Production Brief Concierge (Argon Multimodal × Fable 5.1) */`, `.ys-agent-argon`, `.ys-argon-prefill` | 변경 불필요 |
| `docs/PLATFORM-2.0.md` §19 머리말 | "아르곤(Gemini 4 Argon) 검토는 API 선불 크레딧이 바닥나 하지 못했다" | 충전 뒤 §6 테스트로 대체 |
| `docs/design/ARGON-REVIEW-PROMPT.md` | Antigravity 안의 Argon에게 붙여 넣는 랜딩 미감 디렉터 프롬프트(API 아님) | 그대로 |
| `D:\dev\Video-Creator\.agents\skills\real-sound`, `earshot` | '들을 수 없는 에이전트' 전제의 조립·측정 체계 전체 | §3 그대로 재사용. earshot의 `llm_critique`가 이미 Gemini에 모노 64 kbps 오디오를 보내는 선택 기능(동의 필수, 타임스탬프 근사)이라 Argon 판정의 선례다 |

주의: 11-03 대표 결정대로 Morphic 조직에는 사운드 기능을 열지 않는다(조직별 deny-list).

## 9. TWINGS 제안

1. **Argon을 "사운드 디렉터"로 쓴다. 생성은 하지 않는다.** 공개 문안에도 "소리를 만든다"가 아니라 "영상을 보고 듣고 소리를 지시·검수한다"로 쓴다(엔진명은 공개 페이지에 쓰지 않는 규칙 유지).
2. **타이밍·레벨의 원본은 코드와 earshot**, Argon은 의미·취향 대리. §3.3 표를 설계 문서(`docs/BRAND-ENGINE.md` 제작 원칙 층)에 옮긴다.
3. **비용 설계:** 디렉터 1차 = Argon, 판정 반복 = 3.8 Flash, 야간 대량은 Batch. 12월 가격 인상 전에 §6 테스트로 Argon이 3.8 Flash보다 실제로 나은지 재고, 아니면 3.8 Flash를 기본으로.
4. **키 분리:** 유료 티어 키 하나를 `GEMINI_API_KEY`로 두고(이미 그 이름), 무료 티어 키는 TWINGS 공개 자산 테스트에만. 브랜드 자료는 유료 키로만.
5. **생성 엔진:** SFX는 ElevenLabs SFX API(상업 조건 확인 뒤) 또는 CC0 뱅크, 음악은 라이선스 트랙 또는 Lyria 3.5(조건 확인 뒤). YuE2는 브랜드 상업물에 쓰지 않는다.
6. **브리프 컨시어지**는 목업을 Argon 호출로 바꾸되 evidence 문자열 검증을 반드시 넣고, 지시서 발송 전 사람 1회.
7. **Omni**는 티저 시안용으로만. 본편 사운드 경로로 쓰지 않는다.

## 10. 대표 결정 필요

1. **Argon 테스트를 위한 선불 충전** — $10 권장(최소 $5). 충전 전엔 어떤 Argon 테스트도 불가. 12월 1일 가격 인상 전에 할지.
2. **디렉터 모델 기본값** — 테스트 결과 Argon과 3.8 Flash 차이가 작으면 3.8 Flash를 기본으로 둘지(비용 1/2.7).
3. **SFX·음악 생성 엔진 계약** — ElevenLabs SFX(상업 조건), Lyria 3.5(상업 조건·표시 요건), 라이선스 트랙 라이브러리 중 무엇을 쓸지. 유료 계약은 모두 결제 결정.
4. **데이터 상주** — Vertex Seoul 미지원. Developer API(글로벌)로 충분한지, 브랜드 고객 계약에 "데이터는 Google 글로벌 인프라에서 처리(유료 티어, 학습 미사용)"를 어떻게 쓸지. 공개 페이지의 "학습 미사용" 약속 금지 규칙(ARGON-REVIEW-PROMPT §1)과 충돌하지 않게 계약서에만.
5. **사람 검수 위치** — §4의 "지시서 발송 전 1회", "공개 전 1회"를 기본으로 할지.
6. **루프 상한** — 디렉터 판정 3회 상한(§3.4)을 기본으로 할지.

## 출처 (모두 2026-11-03 확인)

- Argon 모델 페이지: https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
- Argon 모델 카드: https://deepmind.google/models/model-cards/gemini-4-argon/
- 요금: https://ai.google.dev/gemini-api/docs/pricing
- 오디오 이해: https://ai.google.dev/gemini-api/docs/audio
- 영상 이해: https://ai.google.dev/gemini-api/docs/video-understanding
- 토큰: https://ai.google.dev/gemini-api/docs/tokens
- 레이트 리밋: https://ai.google.dev/gemini-api/docs/rate-limits
- 결제: https://ai.google.dev/gemini-api/docs/billing
- 약관(2026-03-23 발효): https://ai.google.dev/gemini-api/terms
- 모델 목록: https://ai.google.dev/gemini-api/docs/models
- 3.8 Flash 모델 페이지: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- Omni Flash 모델·가이드: https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash , https://ai.google.dev/gemini-api/docs/omni
- 가용 지역: https://ai.google.dev/gemini-api/docs/available-regions
- Vertex AI 엔드포인트 지역: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
- Antigravity 블로그: https://antigravity.google/blog/gemini-4-argon-in-google-antigravity
- OpenAI 요금: https://developers.openai.com/api/docs/pricing
- ElevenLabs API 요금: https://elevenlabs.io/pricing/api
- 저장소: `lib/images/gemini.ts`, `components/brand-workspace/brief-concierge.tsx`, `app/(brand)/workspace.css`, `docs/PLATFORM-2.0.md` §19, `docs/design/ARGON-REVIEW-PROMPT.md`, `docs/BRAND-ENGINE.md`, `D:\dev\Video-Creator\.agents\skills\{real-sound,earshot}\SKILL.md`
