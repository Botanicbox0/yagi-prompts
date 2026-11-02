# YAGI 제작 노하우 코퍼스 → 브랜드 엔진 "고정 층" 항목화 (2026-11-03)

> 목적: `D:\dev\Video-Creator`·`D:\dev\music-creator`·`D:\dev\twings` 안에 흩어진 제작 규칙·수치·도구 인자·알고리즘을 **브랜드 엔진의 고정 층(아이덴티티·절대 규칙·제작 원칙·메모리)** 으로 옮길 수 있게 한 줄씩 항목화했다(`docs/BRAND-ENGINE.md` §3 구조 기준).
> 읽은 범위: 아래 §0. 모든 수치는 **로컬 파일에서 2026-11-03에 직접 읽은 값**이고, 외부 라이선스·API 한도처럼 1차 출처(공식 페이지)를 열지 않은 것은 **미확인**으로 표시했다. 코드는 수정하지 않았고 스크립트·유료 API를 돌리지 않았다.

## 결론 먼저

1. **노하우의 80%는 이미 "코드 + 측정값" 형태다.** 프롬프트 규칙(seedance-film-director·image-director), 색 보정(`viral_color_grade.py` 1,354줄), 사운드(`viral_music_sync.py`·`earshot_bridge.py`·real-sound), 업스케일 마감(`ig_reels_master.py`), 음악 마스터(`mastering.py` 701줄)가 모두 CLI 인자와 JSON 리포트를 낸다. 제품으로 옮길 때 "사람 판단"으로 남는 것은 미감 승인·얼굴 동의·라이선스 확인 세 가지뿐이다.
2. **P0는 두 개다.** ① 모델별 프롬프트 컴파일러(라우팅 표 + 7개 모델 문법 + Seedance 타임라인 문법)와 ② 레퍼런스 측정 → 촬영 지시서(`extract_image.py` 지표 40여 개를 JSON 스키마로). 둘 다 외부 가중치가 없고 CPU에서 돈다. 지금 제품(`lib/renders/engines.ts`)은 `{{selfie}}`를 `Image 1`로 바꾸는 치환뿐이다(product-facts §0).
3. **색 보정은 가장 완성도 높은 모듈이고, 브랜드 메모리의 "색 층"이 된다.** 프리셋 5종의 `defaults` 8필드 + `match-report.json`의 `profiles/levels/distance` 구조를 그대로 `brand_looks` 테이블 스키마로 쓸 수 있다(§4.3).
4. **라이선스 벽이 있는 항목은 네 개다.** 음악(YuE2·SheetSage2 가중치 CC BY-NC 4.0 — 상업 납품 불가), 바이럴 음원 라이브러리(Grimes·Hiroshi Yoshimura 등 상업 음원 — 내부 레퍼런스 전용), 얼굴 게이트(ArcFace/InsightFace 비상업 — PLATFORM-2.0 §21.8), 그리고 **마스터링 체인의 `pedalboard` 의존(GPL-3.0 가능성, 미확인)**. 이 넷은 제품 기능 설계보다 라이선스 결정이 먼저다.
5. **모션 그래픽(HyperFrames·motion-doctrine)은 브랜드 제품 1차 범위에서 뺀다.** 포지션(브랜드만의 AI 미디어 엔진 = 사진·영상 생성·마감)과 IDENTITY §5("화려한 모션 그래픽보다 절제된 정보 한 줄")에 맞지 않고, 헤드리스 브라우저 렌더 인프라·HeyGen 카탈로그 권리·월간 스킬 드리프트라는 운영 비용이 따로 든다. 채널별 내보내기의 캡션·엔드카드 오버레이만 P2로 남긴다(§9).

## 0. 읽은 것 · 읽지 않은 것

| 묶음 | 읽음 | 비고 |
| --- | --- | --- |
| Video-Creator `AGENTS.md`(55줄) | 전체 | 권한·480p 게이트·도구 요약 |
| 스킬 `SKILL.md` 10종 | 전체 | seedance-film-director(137), image-director(48), motion-doctrine(174), cut-the-curve(259, 90줄 전문+헤딩), real-sound(200), earshot(238), media-use(97), product-launch-video·talking-head-recut·general-video(헤딩+핵심줄) |
| references | 전체: `model-prompt-formulas.md`, `seedance-2.5-model-notes.md`, `extraction-tool.md`, `real-sound/licences.md`, `media-use/luts/*` / 헤딩·수치줄: `prompt-composition.md`, `reference-video-analysis.md`, `sound-design.md`, `process.md`, earshot `docs/launch-video-sound.md`, `docs/SFX.md` | |
| `tools/*.py` 7개 | docstring·상수·함수 시그니처·argparse 전부, 핵심 알고리즘 줄(`analyze_pixels`, `measure_look`, `match_reference`, `_generate_lut_grid`, `_build_active_grade_chain`, `encode_ig_master`) | 실행 안 함 |
| 카탈로그 2개 | 전체 JSON | visual-looks(프리셋 5), viral-music(트랙 5) |
| music-creator | `AGENTS.md`·`README.md`·`config.toml` 전체, `mastering.py`·`pipeline.py`·`gpu_guard.py` 구조+수치줄, ablation 문서 헤딩+판정표, `yue2-music/VENDORED.md`, `yue2-songwriter` 라이선스·길이·seed 줄 | |
| twings | `IDENTITY.md`·`identity.ts`·`BRAND-ENGINE.md`·`LESSONS.md`·`photo-craft.md`·`color-system.md` 전체, `product-facts.md` §4·§5 전체+헤딩, PLATFORM-2.0 §4·§21.8, 약관 §5.3 원문, `lib/renders/engines.ts` 구조, higgsfield 스킬 2개(모드·구조만) | |
| 읽지 않음 | `prompt-composition.md`·`reference-video-analysis.md`·`example-derived-structure.md` 본문, real-sound `scripts/*.py` 본문, earshot 패키지 소스, music-creator `workers/*`, Americano 저장소 | 필요 시 2차 |

---

## 1. 마스터 항목표

열: **이름 · 보장(품질 효과) · 지금 형태 · 브랜드 제품 형태 · 입력 → 출력 · 외부 의존(모델·라이선스·GPU) · 난이도 · 우선순위**. 형태 약어: 규칙=프롬프트·문서 규칙, PY=파이썬 도구, JS=Node 스크립트, 카탈로그=JSON·LUT, 사람=사람 판단. 제품 형태 약어: 모듈=서버 모듈, 프리셋, 템플릿=프롬프트 템플릿, 검수=검수 규칙, 워커=로컬 GPU 워커, PD=사람 PD.

### (a) 모델별 프롬프트 문법 · 라우팅

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a1 | 작업 종류 → 엔진 라우팅 표 | 같은 프롬프트를 모든 모델에 보내지 않는다. 마크 보존 NB Pro 8/8, 제품 사진다움 Seedream 6/8(LESSONS §2) | 규칙(LESSONS §2, IDENTITY §6-1, `identity.ts MODEL_ROLES`) | 모듈(설정 테이블 `engine_routing`: 작업종류→엔진·해상도·기본 플래그). 공개 화면에 엔진명 금지 | 작업 종류(마크/제품/흰바탕/인물/영상/교체) → `{engine, resolution, flags}` | 엔진 API 키(ARK·GEMINI·HIGGSFIELD·KLING). 없음(가중치) | 낮음 | **P0** |
| a2 | GPT Image 2.5 5단 브리프 문법 | 매체·비율 선언→레퍼런스 권한→포즈·의상→공간→빛·#HEX·제외 | 규칙(`model-prompt-formulas.md` §1) | 템플릿 — **단, TWINGS는 GPT Image 비사용(IDENTITY §6-1)**. 보관만 | 지시서 → 프롬프트 + `--variant sunburst --quality high --resolution 2k` | OpenAI. 기본값 함정(flare/low/1k) | 낮음 | P3 |
| a3 | Nano Banana Pro ALL-CAPS LOCK 문법 | 구도·포즈 드리프트 방지, 얼굴 기하·로고 수정·한글 문자·4K | 규칙(§2) | 템플릿(`IDENTITY LOCK / COMPOSITION LOCK / POSE LOCK / OUTFIT & PROPS / SETTING / COLOR GRADE & LIGHT / CAMERA & OPTICS / NEGATIVE`) | 지시서 → 프롬프트 + `--resolution 2k|4k`, 레퍼런스 ≤14(객체 6·인물 5·스타일 3, photo-craft §6) | Gemini(`nano_banana_pro`/`2_1`). 2.1은 `--thinking-level high` | 낮음 | **P0** |
| a4 | Seedream 5.0 Pro 고밀도 산문 문법 | 레퍼런스 포즈·키·소재 재현, 원본 프레임+제품 교체 | 규칙(§3, photo-craft §6) | 템플릿(4부: 레퍼런스 역할 → 피사체·포즈·의상·환경 → 빛·#HEX·렌즈 → 용도·클린 프레임) | 지시서 → 프롬프트 + `--resolution 2k`(1k/1.5k/2k, **4K 없음**), ≤600 영단어, 레퍼런스 ≤10(미확인: Volcengine 문서) | ModelArk/Higgsfield/Morphic | 낮음 | **P0** |
| a5 | FLUX 3 / Kontext 5블록 문법 | 카메라 선행, 긍정문만(negative 없음) | 규칙(§4) | 템플릿(보관) | — | BFL | 낮음 | P3 |
| a6 | Soul 2.0 / Cinematic / Location | 패션 사진다움(대표 선택 컷 다수), Seedance start-image 키프레임 | 규칙(§5, IDENTITY §6-1) | 템플릿 — Soul에 레퍼런스 넣으면 옷·포즈를 베낀다 → 새 룩은 **글 + HEX VALUES만**(IDENTITY §6-5) | 지시서 → `text2image_soul_v2 --quality 2k [--custom-reference-id]` | Higgsfield 전용 | 낮음 | P1 |
| a7 | Ideogram 4.5 / Recraft V4.1 | 타이포·레이아웃(#HEX 토큰, `--magic-prompt off`), 벡터(`--model-type vector --colors`) | 규칙(§6) | 템플릿(브랜드 키트·패키지 목업용) | — | Higgsfield | 낮음 | P2 |
| a8 | 레퍼런스 권한 분리 규칙 | 인물 사진 1장만 모델에, 장면·스타일은 글로 → 얼굴 섞임·장면 붕괴 방지 | 규칙(image-director §2, seedance SKILL "Start From the Active Brief") | 검수(입력 검증: `image_urls` 역할 태그 필수, 분석 전용 자산은 업로드 차단) | 자산 목록 + 역할(identity/wardrobe/material/environment/typography/style/start-frame) → 허용 목록 | — | 중간 | **P0** |
| a9 | 사진 프롬프트 9단 순서 + TWINGS 색 블록 | 키워드 대신 사진을 말로. `COLOUR AUTHORITY … HEX VALUES […]` 끝에 고정 | 규칙(IDENTITY §6-2·6-3) | 템플릿(브랜드별 `colour_block`을 아이덴티티에서 자동 생성) | 아이덴티티(WORLD 8색) → 색 블록 문자열 | — | 낮음 | **P0** |
| a10 | Anti-plastic skin 계약(AMERICANO) | 금지어(porcelain/flawless/smooth/dewy glow) + 무광 반사·미세 모공·단일 카메라 렌더 3문장 | 규칙(image-director §1, photo-craft §2, W8) | 템플릿(인물 컷 자동 삽입) + 검수(금지어 린트) | 프롬프트 → 린트 결과 | — | 낮음 | **P0** |
| a11 | 빛 공식 · 소재 어휘 · 광학 표 | "modifier+size · side/height · distance · shadow/highlight 효과", 소재 16종 문구, 초점거리 6단, 조리개, 필름 스톡 | 규칙(photo-craft §1–§5) | 템플릿 어휘집(지시서 필드의 드롭다운 값) | 지시서 필드 → 문장 | — | 낮음 | P1 |
| a12 | 장비명 금지 | "softbox·reflector"를 쓰면 장비가 화면에 찍힘(NB 6/8, Seedream 4/8) | 규칙(LESSONS §3-1, IDENTITY §6-1) | 검수(금지어 린트: 장비·카메라 브랜드·`Kodak Vision3 500T`·`Panavision`) | — | — | 낮음 | **P0** |
| a13 | Seedance 2.5 엔진 사실표 | duration 4–30s, image_urls 1–30, 480p/720p/1080p, draft/bitrate_mode, negative_prompt·seed 없음 | 규칙(`seedance-2.5-model-notes.md`, 2026-09-27 확인) | 모듈(엔진 어댑터 파라미터 검증) | — | Higgsfield `bytedance/seedance-2.5/*`(미확인: 현재 스키마) | 낮음 | P1 |
| a14 | Seedance 타임라인 출력 계약 | `Visual style:` 블록 필수, 0초→D초 빈틈 없는 구간, 경계마다 편집 종류, 0.1–0.2s 서브초 컷, 런타임 설정 재진술 금지 | 규칙(seedance SKILL "Default Output Contract") | 템플릿 + 검수(타임라인 린트: 합계=D, 겹침·공백 0, 각 구간 편집 명시) | 브리프 → 프롬프트 → 린트 | — | 중간 | **P0** |
| a15 | 연기·카메라 반(反)AI 기본값 | 밀리미터 미세연기(입술 1–2mm, 2mm 코너 리프트), 오프축 시선, Hug-over-Kiss, 각도 교대(18°/45°/90°/OTS), `x%,y%` 좌표, 어깨 밖 15% 여백, 와이드 상한(인물 35–50% 높이) | 규칙(seedance SKILL "Flexible Prompt Architecture") | 템플릿(인물 영상 자동 삽입 조항) | — | — | 낮음 | P1 |
| a16 | Anti-Composite Law · 단일 롤 연속성 | 얼굴이 방보다 밝거나 붙여 넣은 듯 보이지 않게, 전 컷 하나의 필름 스톡·#Hex·그림자 비율 | 규칙(seedance SKILL, IDENTITY §6-4) | 템플릿 | 측정 hex(extract) → 조항 | — | 낮음 | **P0** |
| a17 | No-BGM 오디오 규칙 | 음악 누출 방지: 시작·끝 양쪽에 제외 명시, `() <> {} 【】` 표기, 물 소리 리플 회피, 자막 유발 반복어 회피 | 규칙(seedance "Audio Semantics", model-notes) | 템플릿 + 검수 | — | — | 낮음 | P1 |
| a18 | IP·NSFW 필터 회피 어휘 변환 | IP 어휘 군집·렌즈 브랜드 → 일반 재질·형태 서술; 직유 금지(날개가 실제로 그려짐); 서브초 오프닝에 push-in 금지 | 규칙(model-notes 2026-10-27~29 관찰) | 검수(사전 린트) + 템플릿 | — | — | 낮음 | P1 |
| a19 | 480p Draft 게이트 | 첫 실행·수정은 `--resolution 480p --draft true --bitrate_mode high`, 승인 뒤 720p/1080p. 1080p는 업스케일이 아니라 **새 샘플** | 규칙(AGENTS 권한·보고, IDENTITY §6-1) | 모듈(렌더 상태기계: draft→approve→final) — 제품의 "480p 테스트 → 승인 → 본 렌더"(PLATFORM §21.6 S5) | — | 엔진 비용 | 중간 | **P0** |
| a20 | 리믹스(교체) 라우팅 | 인물·옷: Genjutsu `hf_mult_replace_object` 또는 Morphic Seedance `edit_video`; 제품·세트 색: Seedance `video_edit`+제품 이미지 | 규칙(IDENTITY §6-1, BRAND-ENGINE 리믹스) | 모듈(라우팅 표의 행) | 영상 + 교체 대상 + 참고 이미지 → 영상 | Higgsfield·Morphic | 중간 | P1 |

### (b) 레퍼런스 측정 → 촬영 지시서

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| b1 | `extract_image.py` 정지 이미지 계측 | 형용사 대신 숫자: 톤 분위수, 들뜬 검정 hex, LAB a*/b*, 6색 k-means, DoF 비, 할레이션, 입자, 4분면 조명 | PY(458줄, OpenCV·numpy, 네트워크 없음) | 모듈(서버 워커, CPU) — "무드보드가 곧 프롬프트"(LESSONS §5-3) | 이미지 N장 → `image_analysis.json` + `sheets/img_XX-sheet.png` | 없음(가중치 없음) | 낮음 | **P0** |
| b2 | `extract_video.py` 영상 역설계 | 0.1s 샘플링, 컷 후보(Adaptive+Threshold), 샷별 `aesthetic_analysis` + `camera_analysis`(Farneback 플로우), earshot 오디오 | PY(498줄, FFmpeg·PySceneDetect·PyAV) | 모듈(CPU 워커). 레퍼런스 원본은 **업로드·공개 금지** | mp4 → `frames/`, `shots.json`, `manifest.json`, `audio_timeline.json`, `index.html` | FFmpeg 8.1.2, PySceneDetect 0.7.1, earshot(MIT) | 중간 | P1 |
| b3 | 촬영 지시서 필드 규격 | 렌즈 mm·거리 m·틸트 °·머리 y%·인물 폭%·영역별 hex·빛 공식·소재·금지어를 한 문단으로 | 규칙(image-director §1 Perspective Lock, IDENTITY §6-2, W1) | 모듈(JSON 스키마 §3.3) + PD 검토 | 측정 JSON + 아이덴티티 + 한 줄 지시 → 지시서 JSON → 모델별 프롬프트 | LLM(지시서 산문화) | 중간 | **P0** |
| b4 | 밀집 연속성 검토 · 인과 감사 | 3장 스틸로 카메라 움직임을 주장하지 않는다; 샷 처음·중간·끝 비교; 원본보다 조금 크게 쓴 카메라 | 규칙(reference-video-analysis.md, IDENTITY §6-4) | PD 체크리스트 + 모듈(`camera_analysis` 자동 요약) | shots.json → 샷별 카메라 문장 | — | 중간 | P1 |
| b5 | 좋은 원본 + 제품만 교체 | 처음부터 만든 장면은 "흔한 AI"; 브랜드 과거 캠페인 컷이 최고 레퍼런스 | 규칙(LESSONS §3-3, W4) | 모듈(1급 워크플로: 이미지1=원본 프레임, 이미지2=컷아웃, "병만 바꿔라") + 마크 재검사 | 원본 + 컷아웃 → 장면 컷 | Seedream | 낮음 | **P0** |

### (c) 색 보정 → LUT → 브랜드 룩 메모리

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| c1 | `analyze`: 활성 화면 p01/p99 계측 | 레터박스·자막대 제외, AI 영상의 들뜬 암부(`p01>15/255`)·눌린 하이라이트(`p99<210/255`) 진단 | PY(`viral_color_grade.py analyze`) | 모듈(CPU) | mp4 → `{p01,p99,active_box,…}` | FFmpeg | 낮음 | P1 |
| c2 | `grade`: 프리셋 LUT + 레벨 + 할레이션 + 그레인 | 33³ `.cube` 감산 색밀도·피부 15–40° 보호, `colorlevels`→`lut3d interp=tetrahedral`→bloom(screen blend)→`unsharp`→`noise c0f=t+u`, CRF 16 | PY + 카탈로그(프리셋 4 + 커스텀 1) | 모듈 + 프리셋(브랜드별 룩) | mp4 + look_id + `--intensity 0..1 --skin-protect 0..1 --grain --halation --no-auto-levels` → mp4 + 비교 시트 | FFmpeg | 낮음 | P1 |
| c3 | `match`: 레퍼런스 룩 이식 | 3-way 뉴트럴 캐스트(LAB)·L* CDF 매칭·p01/p99 레벨·감산 밀도·할레이션·그레인 자동 계측 → 전용 LUT + before/after 거리 | PY(`match_reference`, `build_match_lut`, `look_distance`) | 모듈("브랜드 룩 만들기") | target mp4 + ref(jpg/mp4) + `--intensity 0.85 --skin-protect 0.7` → `match-*.cube`, `*-matched.mp4`, `match-compare.jpg`, `match-report.json` | FFmpeg, numpy | 중간 | **P1** |
| c4 | `save-look`: 카탈로그 자산화 | `source: reference-match` 룩은 `build-luts`가 덮어쓰지 않음; 원자적 카탈로그 쓰기 | PY + 카탈로그 | **브랜드 메모리 "색 층"** = `brand_looks` 테이블(§4.3) | LUT + report + id/title → 카탈로그 행 | — | 낮음 | **P1** |
| c5 | TWINGS 전용 LUT 사례 | 청록 대역만 프렌치 블루로(`twings-french-blue.cube`), 빨강 대역 불변(초록 무늬 방지), 보정 뒤 초록 픽셀 비율 비교 | 카탈로그(프로젝트 폴더) + 규칙(IDENTITY §6-4-1) | 프리셋(TWINGS 자체 브랜드 룩) + 검수(색상 대역 이탈 ΔE) | — | — | 낮음 | P1 |
| c6 | 회귀 테스트 | `tests/test_color_match.py` | PY 테스트 | 모듈 테스트로 이식 | — | — | 낮음 | P1 |

### (d) 사운드

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| d1 | 큐 리스트(`cues.json`) | 모든 소리는 화면 코드가 계산한 프레임에 놓인다(접촉, 팝인 50%, 속도 피크, 라이저 히트, 워드마크 가독) | 규칙+템플릿(real-sound step 0, `templates/cues.json`, id `act:thing:n`) | 모듈(컷 리스트·`shots.json`에서 큐 자동 생성) | 타임라인 → cues.json | — | 중간 | P2 |
| d2 | SFX 뱅크(earshot forge 252음) | 코드로 만든 소리(forge v2 183 + 0.4 51 + CC0 fit 15 + pluck 3), `whoosh:<dur>:<apex>` 속도 매칭, `api.sfx_check` 검증 | PY(`earshot_bridge.py sfx`, earshot 0.4.0 MIT) | 모듈(CPU, 모델 로드 없음, 킷 렌더 ~1분) | intent/bank id + `--dur --apex --pitch` → 48kHz WAV | earshot(MIT), numba | 낮음 | P2 |
| d3 | 실녹음 사운드트랙 10단계 | 큐→브리프→소싱→라이선스 감사→음악 편집(바 라인)→디자인 JSON→믹스→QA→5렌즈 비평→마스터·크레딧·먹스 | PY 9개 + 프롬프트 템플릿 10개(real-sound) | PD 주도 워크플로(런치 필름급) — 브랜드 제품 1차에는 **d4·d5만** | — | Freesound(CC0/CC BY)·Mixkit·Pixabay; NC/ND/SA 금지 | 높음 | P3 |
| d4 | 바이럴 음원 드롭 싱크 | 슬라이스 `[T_drop−T_reveal, T_drop−T_reveal+D]` → 드롭이 반전 컷에 **0ms** | PY(`viral_music_sync.py slice|master`) + 카탈로그(`anchors`) | 모듈 — **단, 음원은 브랜드가 권리를 가진 트랙만**(현재 카탈로그 5곡 중 4곡은 상업 음원) | 영상 + track + `--reveal-s` → WAV / 마스터 mp4 + `sound-report.json` | 음원 권리(§11) | 낮음 | P2 |
| d5 | 폴리 정리 + 덕킹 + -14 LUFS 마스터 | Demucs `htdemucs_ft` + HPSS로 AI 신스 베드 제거(`--foley clean`), Act 1 `-3 dB` 덕(드롭 뒤 절반), `--target-lufs -14 --ceiling-dbtp -1`, 영상 `-c:v copy` | PY(`master_video`, earshot real-sound `master.py`) | 모듈(CPU; Demucs는 CPU 가능) | mp4 + WAV → 마스터 mp4 | Demucs(라이선스 미확인), earshot | 중간 | P2 |
| d6 | earshot QA 지표 | `p_real`(클립 lo 0.17/hi 0.77, 긴 파일 lo 0.40/hi 0.77), `lufs_i` ±0.5, `true_peak ≤ -1 dBTP`, LRA 5–9, `cuts_with_sound`, `within_1f_pct`, `silent_cuts`, sync −45..+75ms, 2–6kHz 하쉬니스 >6dB, >14kHz 클릭 | PY(`earshot timeline/sheet/critique/measure`) | 검수(자동 게이트 + 시트 PNG) | 영상 → JSON + `audio-sheet.png` | CLAP `laion/larger_clap_general`, AST `MIT/ast-finetuned-audioset-10-10-0.4593`(라이선스 미확인), CPU 20–60s 로드 | 중간 | P2 |
| d7 | 런치 필름 사운드 맵 | 클릭 1보이스·85ms 릴리즈, 타이핑 ≤12키/s·음악 6–10dB 덕, 팝 50% 지점, 하드컷 무음(85%), 라이저 히트 30–250ms 전 종료, 드롭=히어로 리빌(30–60% 지점), 로고 0.2–0.7s 침묵 뒤 한 음·8–20dB 아래 | 규칙(real-sound SKILL, `sound-design.md` 측정 norm) | 검수 규칙(런치 필름 전용) | — | — | 낮음 | P3 |
| d8 | Seedance 원생 오디오 크래클 제거 | `>5.5kHz` 디지털 크래클을 사용자 지적 전에 자동 제거 | 규칙(seedance SKILL Post-Production 2) | 모듈(d5 안의 단계) | — | — | 낮음 | P2 |

### (e) 업스케일 · De-AI 그레인 · 인스타 규격

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| e1 | SeedVR2 7B 디퓨전 업스케일 | 720p의 광학 미세 디테일 복원, `face_roi_lap +165–175%`(Lanczos·Topaz 대비) | PY(`run_seedvr2_1080p`: ComfyUI `127.0.0.1:8188`, `seedvr2_ema_7b_fp16.safetensors`+`ema_vae_fp16`, `resolution=1080 batch_size=21 uniform_batch_size temporal_overlap=2 color_correction="lab" offload_device="none"`) | 워커(YAGI-SERVER GPU, gpu-arbiter 우선순위 ComfyUI>Qwen>기타) | 720p mp4 → 1080×1920 | SeedVR2 가중치(라이선스 미확인), ComfyUI 노드, RTX PRO 6000 | 중간 | P2 |
| e2 | De-AI 인코드 체인 | `scale=1080:1920 lanczos`(SeedVR2 생략 시) → `unsharp=3:3:0.55` → `cas=0.25` → `curves m='0/0 0.06/0.05 0.50/0.50 0.94/0.955 1/1'` → `noise=c0s=3.4:c0f=t+u` → `yuv420p`; x264 `preset slow CRF 13 High@4.1 bt709 aq-mode=3:aq-strength=1.0:psy-rd=1.20,0.15:deblock=-2,-2:keyint=48:min-keyint=24`; AAC 320k 48k; 24fps CFR; `+faststart` | PY(`encode_ig_master`) | 모듈(CPU 워커, 프리셋 "인스타 마스터") | mp4 + WAV → mp4 | FFmpeg | 낮음 | P2 |
| e3 | Edits 앱 내보내기 규칙 | `HD(1080p)` + `SDR` + 네이티브 `24fps`(4K 업로드 재압축, 8-bit에 HDR 금지, 광학플로우 보간 금지) | 규칙(AGENTS, ig_reels docstring) | 문서(채널별 내보내기 안내) | — | — | 낮음 | P2 |
| e4 | 웹 납품 크기 | 4K ≈15MB, 1080p ≤8MB, 720p 9:16 ≤3MB(전용 편집본), `+faststart` | 규칙(IDENTITY §6-4-2) | 모듈(채널별 내보내기 타깃) | — | — | 낮음 | P2 |
| e5 | 4K 분할 업스케일 · 색공간 태그 | 1080p→4K 15초 한 번에 돌리면 저장 단계 메모리 부족 → 컷 지점에서 나눠 잇기; SD→HD 출력은 BT.601 태그(Chrome이 미태그 HD를 709로 읽음) | 규칙(IDENTITY §6-4-1, 메모리 `template-480p-seedvr2-upscale`) | 워커 규칙 | — | — | 중간 | P2 |
| e6 | Deglaze 후처리 | 하이라이트 롤오프·그레인·미세 대비, 그레인 피드 5 / 자유 VTO 6 / 룩북 3.5 | PY(Americano `face_refine.py`, `fix_shot1_americano_skin.py` — 저장소 밖) | 모듈(이미지용 De-AI 프리셋) | 이미지 → 이미지 | — | 중간 | P1 |

### (f) 로컬 수정법

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| f1 | 극소 부위 수정 5단계 | ① 네모로 잘라 캔버스 채움(180px→1440px) ② "고정할 것 먼저" 프롬프트, 참고는 **마크 파일만** ③ ECC 정렬 후 미세 결만 가져오고 큰 덩어리 빛·색은 원본(형태 변경은 시그마 ≥200px) ④ 마스크 하드니스 약 50, 구조선 피해 균일면에 경계, 네모 끝 전 0 ⑤ **네모 밖 변경 픽셀 0**, 원본 크기로 확인 | 규칙(IDENTITY §6-4-3) + PY(`projects/2026-11-01-twings-perfume-real/local-fix`, 저장소 밖) | 모듈("부분 수정 캔버스": 마스크 + 영역 재렌더 + 합성 검증) — BRAND-ENGINE §6 P1 | 이미지 + 박스 + 마크/신원 레퍼런스 → 수정본 + `changed_pixels_outside=0` 리포트 | NB Pro(편집), OpenCV ECC | 중간 | **P1** |
| f2 | 수정 모델 드리프트 교정 | 로고를 키우면 원본 크기·중심으로 되돌림; 프레임을 크게 옮기면(ECC 낮음·가장자리 줄무늬) 합치지 않고 네모 재설정; 옆의 깨진 로고도 같이 | 규칙(§6-4-3) | 검수 규칙 | — | — | 낮음 | P1 |
| f3 | 미감 게이트 | "미감 별로인 건 절대 적용 금지": 승인 프레임에서 출발, 색만 바꾸기, 후보는 대표에게 먼저 | 사람(IDENTITY §6-4-4, 메모리 `aesthetic-gate`) | PD(브랜드 담당자 승인 단계) | — | — | — | **P0**(프로세스) |

### (g) 음악

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g1 | YuE2 보컬곡·BGM 생성 | 가사+스타일 태그 → 곡; BGM 모드(악보에서 보컬 성부 제거, 공식 `instrumentalize`) | PY(WSL, `scripts/mc generate`, GpuSession) | **보류** — 가중치 CC BY-NC 4.0(상업 납품 불가) | lyrics/style/abc/seed/cfg → `song.flac`·`bgm_master.wav` | YuE2-3B·YuE2-VAE·SheetSage2 가중치 CC BY-NC 4.0; GPU 20GB 캡 | — | 보류 |
| g2 | 대체 엔진 요구 사양 | §8.2 표 | 문서(이 보고서) | 조달 기준 | — | — | — | P2 |
| g3 | `mastering.py` v3 체인 | 8단: 1.5s 라이더+서브 합성(31.5/50/80Hz) → 15-Band 1/3옥타브 스플라인 EQ(31.5Hz–16kHz, STFT 4096·75%) → 2-Zone 공명 억제(350–2000·2000–7500Hz) → 글루 컴프 1.75:1 + Oxford Inflator `y=1.5x−0.5x³`(wet 28%) → 2-Band 트랜지언트(45–130Hz 3.25dB·130–7500Hz 2.75dB) → 후단 트림 → 4-Zone M/S(<140Hz −30dB 모노, 155–920 −6.8, 920–4k −8.5, >4k −9.5dB) → 4× 룩어헤드 TP 리미터 −14 LUFS/−1 dBTP | PY(701줄, CPU, `ui` venv) | 모듈(CPU 워커) — **코드는 자체 작성이라 재사용 가능**, 의존 `pedalboard` 라이선스 확인 선행(§8.3) | WAV/FLAC → 마스터 WAV/MP3 + before/after(LUFS·TP·S/M) | numpy·scipy·soundfile(BSD), pyloudnorm(MIT), **pedalboard(미확인, GPL-3.0 가능성)** | 낮음 | P2 |
| g4 | 마스터 검증 근거 | 상업 레퍼런스 12곡 프로파일, CommScore 18.34→35.16, ISO15 오차 3.05→0.59dB, MS 오차 5.86→0.03dB, p_real 평균 0.974; Matchering·익사이터 폐기 근거 | 문서(`mix_mastering_ablation_2026_11.md`) | 내부 근거(공개 문안에 히트곡명 금지) | — | — | — | — |
| g5 | GPU 안전장치 | 단일 작업 락, ComfyUI>Ollama 추론>음악>대기 Ollama, arbiter 홀드 20s 하트비트(IDLE_GRACE 60s), job 1200s(<HOLD_MAX 1800s), 단계별 VRAM 캡(yue2 20GB·나머지 8GB), 여유 +4GB | PY(`gpu_guard.py`) | 워커 공통(e1·g3·업스케일 모두 이 패턴) | — | gpu-arbiter 공개 API만 | 중간 | P2 |

### (h) 모션 그래픽

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h1 | motion-doctrine 벡터 법칙 | 퇴장 축·방향·속도가 입장을 정함, 하우스 current=LEFT, 예약 벡터(상승/Z전진/Z후진/스케일 버스트), 크로스페이드 금지, idle wobble 금지, 클라이맥스 전 0.3–0.75s 정지, 단일 진입 ≤800ms, 퇴장≈75%, 스태거 ≤500ms, bounce/elastic 금지 | 규칙 + JS(`seam-gate.mjs` 빌드 게이트, `seam-stamp.mjs`) | **1차 범위 제외**(§9). 웹 UI 모션 원칙으로만 흡수(IDENTITY §5 단일 스프링) | ledger.json → seam 검증 exit 0 | HyperFrames(라이선스 미확인) | — | P3 |
| h2 | cut-the-curve 카탈로그 7기법 | zoom-through(0.2s exit 1→1.2 / 0.5s entry 0.75→1, blur 10px 텍스트·18–20px 풀프레임), inverse, cut-the-curve(~0.6s), waterfall cut/entry, rack-focus, nudge(10/65/25) | 규칙 + GSAP 예제 | 제외 | — | GSAP | — | P3 |
| h3 | product-launch-video · talking-head-recut · general-video | URL/브리프 → 런치 영상(1920×1080/1080×1920/1080×1080), TTS·캡션·SFX 파이프라인; 토킹헤드 오버레이(Whisper 로컬) | JS 파이프라인(HyperFrames CLI, HeyGen TTS·카탈로그) | 제외. 캡션·엔드카드 오버레이 템플릿만 P2 | — | HeyGen 계정·카탈로그 권리, talking-head는 MIT(vtake-skills 개작) | — | P3 |

### (i) 얼굴 · 인물

| # | 이름 | 보장 | 지금 | 제품 | 입력 → 출력 | 외부 의존 | 난이도 | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| i1 | 개인 쪽 얼굴 절차(약관 §5.3) | 실제 인물 사진 → BytePlus 자동 검수 → 계정당 인물 자산 그룹 1개 → 필요 시 카메라 본인 인증 → 타인 얼굴 거부; 신고 24시간 | 모듈(운영 중: `lib/identity/*`, `lib/ark/*`, `RenderFailureCode face_policy`) | **그대로 재사용**(브랜드 쪽 "동의한 크리에이터" 경로) | 셀카 + 동의 → identity asset | ModelArk | — | 운영 |
| i2 | 가상 인물 정책 | 공개·생성 입력은 가상 인물만; 제3자 사진은 분석만; identity bank 공개 금지 | 규칙(IDENTITY §6-1, `IMAGERY.people`, §21.8) | 검수(브랜드 모델 등록 시 `kind: fictional|consented_creator`) | — | — | 낮음 | **P0** |
| i3 | 단일 모델 아이덴티티(Americano) | 얼굴 레퍼런스 1 + 체형 레퍼런스 1(`single_model_identity_v2`), 업로드 없는 뒷면 생성 금지 | 규칙(§21.8) | 모듈(브랜드 캐스트 테이블: face_ref·body_ref·consent) | — | — | 낮음 | P1 |
| i4 | 얼굴 일치·비율 게이트 | ArcFace ≥0.62, 팔다리 비율 편차 ≤0.18, 실패 컷 1회 재생성 | PY(Americano) | **제품 기능으로 쓰지 않음**(가중치 비상업) → 제공사 검수 + VLM 검토 + PD | — | InsightFace/ArcFace 비상업(미확인) | — | 보류 |
| i5 | 권리 미확인 인물 에셋 차단 | `brand_assets` 권리 상태, `brand_usage_*` 기록 없는 인물 에셋은 생성 입력 금지 | 설계(PLATFORM §21.5) | 모듈(절대 규칙 검사 항목 "얼굴 동의") | — | — | 중간 | **P0** |

---

## 2. (a) 모델별 프롬프트 문법과 라우팅

### 2.1 라우팅 표 — 어떤 컷에 어떤 모델, 왜

실측 근거: LESSONS §2(2026-10-29, 제품 8종×엔진 2), IDENTITY §6-1(대표 고정 2026-10-30), image-director §3. 공개 화면에서는 엔진명을 쓰지 않는다(`HARDLINES`).

| 작업(컷 종류) | 1순위 | 왜(근거) | 보조 |
| --- | --- | --- | --- |
| 새 룩 에디토리얼 전신(레퍼런스 없음) | Soul 2.0 `text2image_soul_v2 --quality 2k` | 대표 선택 컷 대부분; 옷 비대칭·분위기가 패션 사진다움. 레퍼런스를 넣으면 베끼므로 글+HEX만 | Seedream |
| 레퍼런스대로 지키는 전신·소재, 제품 사진다움(두꺼운 유리·커스틱·캡), 원본 프레임 + 제품 교체 | Seedream 5.0 Pro `--resolution 2k` | 포즈·키·비율·옷 재현, 제품 6/8 승, 원본 그레인과 잘 맞음 | NB Pro |
| 로고·마크 보존, 얼굴 클로즈업·3/4·프로필, 여러 레퍼런스 조합, 색만 바꾸기, 흰 바탕 커머스, 한글 문자, 4K | Nano Banana Pro `--resolution 2k|4k` | 마크 8/8 정확(Seedream은 8/8 "Y/y"로 바꿈), 얼굴 기하 강함(Seedream은 고개 돌리면 얼굴 +4.5~6.7% 커짐) | — |
| 인물이 나오는 컷 | Seedream / NB Pro + a10 계약 | GPT Image는 플라스틱 피부(대표 지적 2026-10-29) → 비사용 | — |
| 타이포·레이아웃 / 벡터 | Ideogram 4.5 / Recraft V4.1 | 브랜드 키트·패키지 목업 | — |
| Seedance 시작 프레임 | `soul_cinematic` | 광학 할레이션·필름 그레인 네이티브 | NB Pro(라벨 유지 필요 시) |
| 컷 → 5초 클립, 15–20초 광고 | Seedance 2.5 (Morphic 먼저, Higgsfield `bytedance/seedance-2.5/reference-to-video`) | 제품 형태·마크 유지, 720p 5초 35크레딧(LESSONS) | Kling(제품 어댑터 `kling-omni`, 키 없음) |
| 영상 속 인물·옷 교체 / 제품·세트 색 교체 | Genjutsu `hf_mult_replace_object` 또는 Morphic `edit_video` / Seedance `video_edit`+제품 이미지 | 움직임 유지; 제품 교체는 Genjutsu보다 `video_edit`(2026-10-30 비교) | — |
| 업스케일 | SeedVR2(ComfyUI 로컬) / Topaz Video | §6 | — |

**지금 제품 형태**: `lib/renders/engines.ts`는 ModelArk(Seedream·Seedance)·Gemini(Nano Banana)·OpenAI·Kling 어댑터를 갖고 있고 `face_policy`·`engine_access` 실패 코드를 구분한다. 프롬프트는 레시피 문자열의 `{{selfie}}`를 "Image 1"로 치환하는 수준(product-facts §0). 라우팅 표와 문법 컴파일러는 없다.

### 2.2 모델별 문법 요약 (제품의 프롬프트 템플릿으로 그대로 옮김)

| 모델 | 구조 | 필수 CLI/파라미터 | 함정 |
| --- | --- | --- | --- |
| GPT Image 2.5 | 5단: 매체·크롭 선언 → 레퍼런스 권한(무엇을 쓰고 무엇을 무시) → 포즈·의상 역학 → 전·중·후경 → 빛·#HEX·광학·제외 | `--variant sunburst --quality high --resolution 2k`(기본 flare/low/1k) | TWINGS 비사용 |
| Nano Banana Pro / 2.1 | ALL-CAPS 섹션 + LOCK: `IDENTITY LOCK / COMPOSITION LOCK / POSE LOCK / OUTFIT & PROPS / SETTING / COLOR GRADE & LIGHT / CAMERA & OPTICS / NEGATIVE` | `--resolution 2k`(1k/2k/4k); 2.1 `--thinking-level high` | 신원 사진 1장만 첨부(장면 사진 함께 주면 얼굴 섞임·장면 붕괴) |
| Seedream 5.0 Pro | 4부 산문: 레퍼런스 역할·보존 규칙 → 피사체+포즈+의상+환경 → 빛·#HEX·렌즈·필름 → 용도·클린 프레임 | `--resolution 2k`(1k/1.5k/2k, **4K 없음**); ≤600 영단어(미확인), 레퍼런스 ≤10 | 처음부터 만든 장면은 "흔한 AI"; 원본 프레임이 있을 때 최강 |
| FLUX 3 / Kontext | 카메라 선행 5블록, negative 없음 → 긍정문 | — | Kontext 편집: "Maintain the exact facial identity of Image 1 while…" |
| Soul 2.0 / Cinematic / Location | 레이어형 아트 디렉션 | `--custom-reference-id`, `--style-id`, `--quality 2k`; Location은 `--image-references` 거부 | 레퍼런스 넣으면 베낌 |
| Ideogram 4.5 / Recraft V4.1 | 3부(요약·스타일 #HEX·구성+인용문) / 벡터 | `--magic-prompt off --quality high --resolution 2k` / `--model-type vector --colors` | — |

공통 조항(모든 인물 컷에 자동 삽입): a10 무광 반사 3문장, a12 장비명·카메라 브랜드 금지, photo-craft §2 "피할 단어"(hyperrealistic, 8K, octane, CGI, flawless/porcelain, pristine, vibrant, "cinematic lighting"), 긍정 표현("empty street", not "no cars"), 분홍 메이크업 금지·입술 자연색(IDENTITY §2).

### 2.3 Seedance 2.5 — 엔진 사실과 타임라인 문법

- **엔드포인트(Higgsfield, 2026-09-27 확인, 재확인 필요)**: `reference-to-video` = `prompt`, `image_urls` 1–30, `video_urls` 1–10, `audio_urls` 1–10(하나 이상 필수), `duration` 4–30 정수, `resolution` 480p/720p/1080p, `aspect_ratio` 16:9·4:3·1:1·3:4·9:16·21:9, `draft`, `bitrate_mode`, `generate_audio`(기본 true). `text-to-video`는 레퍼런스 없음, `image-to-video`는 `image_url`+`end_image_url`. **negative_prompt·seed·camera_fixed·자산 역할 필드 없음** — 역할은 프롬프트 텍스트.
- **워크스페이스 기본값**: 모든 첫 실행·수정 = `--resolution 480p --draft true --bitrate_mode high`; 승인 뒤 `720p|1080p --draft false --bitrate_mode high`. 1080p는 업스케일이 아니라 새 샘플이라 결과가 어느 쪽으로든 달라진다(v2.3 관찰).
- **바인딩**: `@Image 1`… 업로드 순서, 첫 등장 순서로 소개, 안정 범위 1–8 피사체, 멀티뷰 허용(2.5), R2V에 첫 프레임 역할 없음.
- **시간**: 공식은 정수 초·`Shot N`; 워크스페이스 실측은 0.1–0.2s 서브초 타임라인(선호 프롬프트 17개 중 16개). 타임스탬프는 컷을 강제하지 않는다 → 경계마다 `hard cut / match cut / continuous` 명시. 서브초 오프닝에 `continuous push-in`을 붙이면 3–4초로 늘어남 → `Hard cut`.
- **출력 계약**: 모델명·길이·비율·해상도·fps는 프롬프트에 쓰지 않는다(API 파라미터). `Visual style:` 블록 필수(매체·세트·팔레트 역할·빛·재질·렌즈·구도·카메라 성격). 제목·슬로건·로고·엔드카드 발명 금지. 1,000단어 권장은 근거 없음(2026-10-03 정정), 15,000자는 상한이지 목표가 아님.
- **사운드 표기**: `()` 음악, `<>` 효과음, `{}` 대사, `【】` 화면 글자. 대사는 `Mina (Korean, quietly): {…}`. No-BGM은 시작·끝 양쪽에 제외어(score, background music, song, melody, beat) 명시. 물·파도·메아리 단어는 리플 아티팩트.
- **시각 실패 모드**: 강한 감정어→빛나는 눈, 거대 AI 레퍼런스→지문 질감, 스토리보드 ≤15패널, 직유→문자 그대로(날개), 해부학적 묘사→`moderated`, 부정형 순서 가드는 안 먹힘(샷 구조를 바꿔야 함), 같은 프롬프트도 실행마다 다름.
- **영상 프롬프트 문법(IDENTITY §6-4)**: "Begin already in motion", 한 색의 세계, 얼굴→제품→소재 교차, 제품 형태 글로 잠금(유리 두께·라벨·캡·펌프), 샷마다 `[Shot 5 — 3.0–3.9s] 85mm, x=65% y=38%`, Anti-Composite·Anti-AI Symmetry, 메이크업 잠금, 카메라 시작·경로·끝·각도(원본보다 조금 크게), 제외 목록(글자·자막·로고·슬라이드쇼·크로스페이드). 글자는 제품 인쇄물뿐, 카피는 HTML에서.

### 2.4 제품 형태 제안 — 프롬프트 컴파일러

```
compilePrompt(spec: ShotSpec, identity: BrandIdentity, memory: BrandMemory, target: EngineId)
  → { prompt, params, lint: [{rule, severity, text}] }
```
- 입력 `ShotSpec`은 §3.3 지시서. `target`은 a1 라우팅 표가 정한다.
- 모델별 직렬화기 7개(§2.2) + 공통 조항 삽입기(a9·a10·a12·a16·a17) + 린트(금지어·장비명·IP 군집·타임라인 합계·레퍼런스 역할 누락).
- Seedance는 `TimelineSpec[]`(start, end, edit, camera, action, audio)에서 산문을 생성하고, 합계=duration·공백 0·겹침 0을 검사한다.
- 테스트: 모델별 골든 프롬프트(Video-Creator `library/user-preferred`, `projects/*/prompt*.txt`)를 픽스처로.

---

## 3. (b) 레퍼런스 측정 → 촬영 지시서

### 3.1 `extract_image.py` 지표 (버전 1.0.0, `image_analysis.json`)

| 그룹 | 키 | 계산 |
| --- | --- | --- |
| `metadata` | `width, height, format, mode, exif, info_keys, aspect_ratio{exact_integer, decimal, nearest_standard, deviation_pct}, sha256, embedded_text` | PIL |
| `tonal_summary` | `key_classification`(6종: high-key veiled / bright editorial lifted / low-contrast filmic / chiaroscuro / low-key / balanced), `mean_luminance, std_contrast, dynamic_range_p99_p01`, `percentiles{p01, p05_black_floor, p50_median, p95_white_shoulder, p99}`, `zone_shares_pct{dark_below_64, mid_64_to_191, bright_above_191}`, `tonal_hex{lifted_black_p05, shadow_15pct, midtone_50pct, highlight_15pct}` | gray 분위수, 마스크별 평균 RGB→hex |
| `color_summary` | `temperature_tendency`(warm golden/ivory · cool cyan/slate · neutral), `tint_tendency`(green foliage · rose/blush · neutral), `lab_a_green_magenta_shift, lab_b_blue_yellow_shift, midtone_lab_a_shift, midtone_lab_b_shift, mean_saturation_pct, p90_saturation_pct`, `dominant_palette[6]{hex, rgb, share_pct, luminance}` | OpenCV LAB(128 중심), HSV S, k-means k=6 on 160×160 |
| `optics_and_texture` | `optics_classification`(4종), `global_sharpness_laplacian, center_sharpness, periphery_sharpness, center_to_periphery_dof_ratio`(중앙 40% 박스 vs 외곽), `bloom_halation_index`((halo_mean−mean)/std), `grain_micro_sigma`(저기울기 35% 패치의 5×5 하이패스 std), `quadrant_luminance{top_left, top_right, bottom_left, bottom_right}` | 1024 롱엣지 정규화, Laplacian ksize 3, dilate 15×15 |
| 시트 | `sheets/<name>-sheet.png`: 3×3 격자, RGB/Luma 히스토그램, 스와치, 100% 크롭 3 | 공개 시 레퍼런스 사진 영역·`source_path`·sha 제거(W1) |

### 3.2 `extract_video.py` 지표 (버전 1.1.0)

`--interval 0.1 --neighbors 3 --min-scene 0.15 --threshold 3.0 --export-width 1440 --max-frames 1000 --window START:END --fresh --no-audio`. 출력: `frames/`, `sheets/`, `frames.csv/json`(프레임 인덱스·시각·shot id·사유·선명도), `shots.json`(샷별 `aesthetic_analysis` = 3.1과 같은 지표 + `camera_analysis{pan_x_px_per_s, tilt_y_px_per_s, radial_divergence_per_s(+push-in/−pull-back), subject_motion_px_per_s, bg_motion_px_per_s, subject_to_bg_ratio, motion_hint, status}`), `manifest.json`(`pacing_summary` 샷 수·평균/최소/최대·서브초 컷·롱홀드, `aesthetic_summary`), `audio_timeline.json`·`audio_critique.json`·`sheets/audio-sheet.png`(earshot: LUFS/LRA/dBTP, BPM, `within_1f_pct`, `silent_cuts`, 이벤트 태그), `index.html`. HDR PQ/HLG는 중단, 1000프레임 예산 초과 시 명시적 실패. 24fps 네이티브 간격 0.0417s — 보간 프레임을 증거로 쓰지 않는다.

### 3.3 촬영 지시서(ShotSpec) 필드 제안 — JSON 스키마

```jsonc
{
  "brief": "겨울 아침, 창가 빛",                 // 한 줄 지시
  "deliverable": { "medium": "editorial still", "aspect": "4:5", "use": "feed" },
  "references": [                                 // a8 역할 분리
    { "asset_id": "…", "role": "identity",  "controls": ["face","skin","hair"], "ignore": ["outfit","background","props"] },
    { "asset_id": "…", "role": "analysis-only", "measured": { /* 3.1 image_analysis */ } }
  ],
  "subject": { "cast_id": "…", "age_band": "20s", "hair": "loose straight", "pose": { "torso_deg": 30, "head_tilt": "left", "gaze": "off-axis down-right", "hands": "…" } },
  "wardrobe": { "silhouette": "…", "fabric": "…", "construction": "…", "lock": true },
  "space": { "foreground": "…", "midground": "…", "background": "…", "surface": "seamless paper" },
  "camera": { "focal_mm": 85, "distance_m": 3.5, "tilt_deg": 10, "height": "shoulder", "head_y_pct": 35, "subject_width_pct": 18, "margin_pct": 15, "aperture": "f/4", "dof_ratio": 2.4 },
  "light": { "key": { "modifier": "large strip", "side": "camera-left", "height": "slightly behind", "distance": "close", "effect": "one long highlight down the sleeve" }, "fill": "white card camera-right, one stop under", "colour_k": 5600 },
  "tone": { "key_classification": "balanced", "lifted_black_hex": "#161B15", "shadow_hex": "…", "mid_hex": "…", "highlight_hex": "#F5F3EE", "saturation_pct": 22, "shadow_share_pct": 85, "halation": 0.3, "grain_sigma": 1.4 },
  "palette": { "world": "blue", "hex_values": ["#f3f7fa","#d0dbe7","#3875c5","#16233f"], "warm_notes": ["skin","lips"] },
  "skin_contract": true, "equipment_names": false,
  "exclusions": ["text","watermark","logo","beauty-filter smoothing","visible blush"],
  "engine": { "id": "seedream_v5_pro", "resolution": "2k" },   // a1이 채움
  "memory_refs": ["approved_frame:…", "look:…", "banned_phrase:…"]
}
```
근거: image-director §1(Perspective & Micro-Pose Lock 4항), IDENTITY §6-2(9단 순서·역할 지도), photo-craft §1(빛 공식)·§3(광학), W1(렌즈 mm·거리 m·틸트 °·머리 Y%·영역별 hex), seedance "Mid-Wide cap 35–50%·15% margin".

---

## 4. (c) 색 보정 → LUT → 브랜드 룩 메모리

### 4.1 알고리즘 (`viral_color_grade.py`, 서브커맨드 `list|build-luts|analyze|grade|compare|profile|match|save-look`)

1. **활성 영역 검출** `detect_active_box`: 레터박스·상단 캡션 제외(`--keep-captions`로 해제).
2. **계측** `analyze_video(sample_count)` → p01/p99; `measure_look(crops)` → `luma{p01,p05,p50,p95,p99}`, `zones{shadows|midtones|highlights:{share,a,b,chroma,hex}}`(near-neutral 픽셀만으로 캐스트 산출 — 빨간 드레스·뺨은 콘텐츠), `density_slope`, `mid_chroma`, `saturation_pct`, `skin_share`(15–40° 색상 + a*≥~6 게이트), `texture`(할레이션·그레인).
3. **레벨** `_compute_colorlevels_params` / `match_levels`: 프리셋 `target_black_ire·target_white_ire·max_black_shift·max_white_gain` 안전 범위 안에서 p01/p99 이동.
4. **LUT** `_generate_lut_grid(33)`: `_s_curve(contrast, pivot)` + 감산 밀도 `1−k·sat^p·(1−w_skin·c)·clip(y·2.5)` + 스킨 보호 채도 부스트 + 존별 split-tone 오프셋. 프리셋별 상수: oled(contrast 0.24, pivot 0.51, density 0.13, sat 1.24), kodak-2383(0.28/0.52/0.16/1.26 + 시안 그림자·골드 하이라이트 split, 빨강 −0.04), dreamcore(0.22/0.50/0.12), dark-fairy(0.32/0.53/0.14 + toe_pull 0.018).
   `build_match_lut`: 존별 LAB 전달 + L* CDF 매칭(`tone_curve`, 슬로프 제한) + 감산 밀도, 스킨 노드는 자기 색상·채도 유지. `adjust_lut(intensity, skin_protect)`로 identity와 블렌드.
5. **FFmpeg 체인** `_build_active_grade_chain`: `colorlevels(rimin…bomax)` → `lut3d=file:interp=tetrahedral` → (할레이션 >0.005: `format=gbrp,split` → 하이라이트 `colorlevels rimin=0.62 gimin=0.58 bimin=0.58` → `gblur sigma=18` → `blend screen opacity=halation`) → `unsharp=5:5:micro:5:5:0` → `noise=c0s=grain:c0f=t+u`. 레터박스는 활성 영역만 그레이딩. `--crf 16`.
6. **거리** `look_distance`: 톤(p5–p95 평균 |ΔL*|), 3-way 캐스트(Δ(a,b) 평균), 크로마 비 → `distance_to_reference{before, after}`.
7. **리포트** `match-report.json`: `mode, target, reference{path,name,sha256,p01,p99,active_box}, settings{intensity, skin_protect, auto_levels, exclude_captions, halation, grain, halation_auto, grain_auto, lut_size}, levels{imin,imax,omin,omax}, metrics{source,reference,result luma; saturation_pct}, distance_to_reference, profiles{source,reference,result}, keyframe_t, outputs{video,lut,compare,report}`.
8. **저장** `save_look(lut, id, title, report, description)`: `LOOK_ID ^[a-z0-9][a-z0-9-]{1,47}$`, `source: reference-match`, 원자적 카탈로그 쓰기.

### 4.2 프리셋 카탈로그 스키마와 현재 값 (`library/visual-looks/catalog.json` v1.0.0, 2026-11-01)

| id | aesthetics | black_ire | white_ire | max_black_shift | max_white_gain | micro_contrast | halation | grain |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| oled-editorial-punch(기본) | fashion-campaign, editorial, luxury, clean-punch, portrait | 0.008 | 0.965 | 0.095 | 1.24 | 0.35 | 0.0 | 1.8 |
| kodak-2383-campaign | film-campaign, kodak-2383, warm-editorial, vintage-luxury, analog | 0.01 | 0.96 | 0.09 | 1.22 | 0.30 | 0.06 | 2.8 |
| dreamcore-pastel-bloom | dreamcore, surreal, miniature, dollhouse, water, fairycore | 0.008 | 0.972 | 0.09 | 1.24 | 0.32 | 0.08 | 2.0 |
| dark-fairy-cinema | dark-fairy, avant-garde, studio-black, gothic, metallic, tulle | 0.005 | 0.97 | 0.105 | 1.25 | 0.45 | 0.04 | 2.2 |
| tutu-studio-silver(custom, reference-match 2026-10-29) | custom | 0.01 | 0.8723 | 0.095 | 1.24 | 0.22 | 0.0694 | 0.569 |

TWINGS 자체 룩: `Video-Creator/projects/2026-10-30-twings-fashion-reverse/grade/twings-french-blue.cube`(청록→프렌치 블루 대역만, 카탈로그 미등록). media-use의 `luts/index.json`(teal-orange-blockbuster, bleach-bypass, film-fade; HeyGen CDN `.cube` + `params` 폴백)은 HyperFrames용이라 별개.

### 4.3 브랜드 룩 메모리 데이터 모델 제안

```sql
brand_looks (
  id uuid pk, org_id uuid fk, slug text /* LOOK_ID 규칙 */, title text,
  source text check (source in ('preset','reference-match','manual')),
  lut_key text /* storage: 33³ .cube */, lut_size int default 33, lut_sha256 text,
  defaults jsonb /* {auto_levels, target_black_ire, target_white_ire, max_black_shift, max_white_gain, luma_micro_contrast, halation_strength, grain_strength} */,
  profile jsonb  /* measure_look 출력: luma, zones, density_slope, mid_chroma, saturation_pct, skin_share, texture */,
  settings jsonb /* intensity, skin_protect, halation, grain, exclude_captions */,
  reference jsonb /* {name, sha256, kind, p01, p99, active_box} — 내부 전용, 공개 금지 */,
  distance jsonb /* {before, after} */, compare_sheet_key text,
  status text /* draft|approved|retired */, approved_by uuid, approved_at timestamptz,
  created_at timestamptz
);
brand_look_uses (look_id, asset_id, intensity_override numeric, result_metrics jsonb, created_at);
```
규칙: 외부 레퍼런스로 만든 룩은 공개 예시 금지(product-facts §4), 승인된 룩만 "만들기" 마감 단계 기본값, 아래 계층이 조직 룩의 색상 대역(IDENTITY 195–225°)을 풀 수 없음(§21.5).

---

## 5. (d) 사운드

### 5.1 큐 리스트 · SFX 뱅크

- **큐 포맷**: `out/cues.json`(템플릿 `real-sound/templates/cues.json`), 안정 id `act:thing:n`, 프레임은 화면 코드가 계산(접촉, 팝인 50%, 속도 피크, 라이저 히트, 워드마크 가독). 생성 영상에서는 `shots.json` 컷 경계 + `T_reveal`로 대체 생성.
- **뱅크(earshot 0.4.0, MIT)**: `forge_v2`(183, 34 카테고리) + `forge04`(51: ui_pop, knock, cut_hit, mallet, drip, shutter, reverse_swell 등) + `fit`(15, CC0 녹음을 코드로 피팅) + `pluck`(3). 렌더 `earshot_bridge.py sfx <intent|bank-id|whoosh:dur:apex> out.wav [--dur --apex --pitch --seed]`, 검증 `api.sfx_check`. 킷 프리셋 calm/crisp/minimal/launch, `kit check`가 클릭·컷 테일·콤브 링·4세미톤 초과 글라이드·이중 어택 거부. 음악 대비 레벨 `bed_db` 3–10dB, 스톱다운 6–12dB×0.3–0.5s. **코드로 만든 소리라 라이선스 문제 없음**; 실녹음이 필요하면 real-sound(Freesound CC0/CC BY, Mixkit, Pixabay; NC/ND/SA·"royalty free" 무문서·AI 생성 오디오 금지, 크레딧 필수).
- **스코어**: `earshot_bridge.py score <cues.json> out.wav [--video-in --video-out]` — 킷(launch/ui/cinema/explain/game), 속도 매칭 우시, 스톱다운, 보이스오버 카빙, −14 LUFS 마스터, 먹스, QA.

### 5.2 바이럴 음원 드롭 싱크 (`viral_music_sync.py`, `library/viral-music/catalog.json`)

- **선택 교리**: ① 10–20s 숏폼은 `T_reveal`(매크로→와이드, 빌드→몽타주) 하나를 가진다, 비트 없는 앰비언트를 페이스 전환에 얹지 않는다 ② 길이 D와 `T_reveal`이 주어지면 `T_drop ≥ T_reveal`인 앵커를 고르고 `[T_drop−T_reveal, T_drop−T_reveal+D]`를 자른다 → 0ms ③ Act 1은 희박한 인트로·하프 스윕·리버스 스웰 앞 앵커를 골라 폴리가 −2.5~−4.2dB 덕킹으로 통과.
- **카탈로그 스키마**: `tracks[{id, title, artist, file(48k WAV), sample_rate_hz, duration_s, aesthetics[], visual_fit, anchors[{anchor_id, t_drop_s, kind(melody_and_sub_bloom|loop_entrance|beat_drop|groove_entrance|melody_shift|melodic_phrase), delta_db, pre_hush_window_s[2], recommended_for}]}]`.
- **현재 5곡**: Instupendo "Comfort Chain"(37.00s +14dB, 19.60s), Sonilo×YAGI "Dark Fairy 124bpm"(12.20s), Grimes "Genesis"(40.70s +11.5dB), Memo Boy "Brian is the Most Beautiful"(5.05s, 36.80s), Hiroshi Yoshimura "FEEL"(32.45s). **4곡은 상업 음원 — 내부 레퍼런스·검토 전용**(product-facts §4 화면 문구). 브랜드 제품에서는 ① 브랜드가 라이선스한 트랙 업로드 → 앵커 자동 계측(`delta_db`, `pre_hush`) ② 또는 BGM 없는 마스터만 납품.
- **master 인자**: `--foley keep|clean|mute --no-vocals --music-gain-db 0 --foley-gain-db -3 --duck-db -3 --target-lufs -14 --ceiling-dbtp -1 --no-qa --fade-in-s 0.15 --fade-out-s 0.45`. `clean` = Demucs `htdemucs_ft` 스템 + HPSS 퍼커시브만(CPU, `DEMUCS_PATH`). 먹스 `-c:v copy -c:a aac -b:a 320k`. 산출 `sound-report.json`.

### 5.3 마스터 기준과 QA 지표

| 지표 | 기준 | 출처 |
| --- | --- | --- |
| 통합 라우드니스 | −14.0 LUFS ±0.5 LU(게이트), 웹·소셜 | real-sound SKILL §10, `master.py`, music-creator `config.toml [mix]` |
| 트루피크 | WAV ≤ −1.5 dBTP(real-sound 게이트, ceiling 0.77 linear) → AAC 뒤 ≤ −1.0 dBTP; music-creator 리미터 −1.0 dBTP(4× 오버샘플 룩어헤드) | process.md §2·§4 |
| LRA | 5–9 LU(경고 4–10), 인트로는 본체보다 5–12 LU 아래 | sound-design §4 |
| 가장 큰 순간 | 드롭/히어로 리빌, 런타임 30–60% 지점, 통합 대비 +2..+7 LU; 로고는 피크보다 8–20dB 아래, 0.5–2.5s 테일 → −60dBFS | sound-design §2 |
| 싱크 | 임팩트 어택 −45..+75ms(중앙 +8), 우시 apex ±45ms, 라이저 끝 −250..+30ms; `chance`보다 높아야 의미 | process.md §4, earshot timeline |
| 클릭 | >14kHz 버스트, 1ms 안에 ≥80% 에너지, 20ms RMS 9배·4ms RMS 6배 | process.md §4 |
| 하쉬니스 | 이벤트 2–6kHz 5ms RMS가 음악 최대보다 6dB 초과 시 플래그; 센트로이드 ≤6.5kHz | process.md §4 |
| 가청성 | `read_db` ≥6 clear, 3–6 ok, 0–3 barely, <0 masked | process.md §4 |
| 진실성 | `p_real` 클립(≤6s) lo 0.17/hi 0.77, 긴 파일 lo 0.40/hi 0.77; 길이 다른 파일은 verdict만 비교; 속이기 쉬움(모달 공명+룸+노이즈 플로어) | earshot SKILL |
| 컷 사운드 | 프로 런치 필름은 컷의 ~85%에 전용 소리 없음; `cuts_with_sound`·`silent_cuts`·`within_1f_pct` | sound-design §2, extraction-tool |
| Seedance 크래클 | >5.5kHz 디지털 크래클·히스 자동 제거 | seedance SKILL |

---

## 6. (e) 업스케일 · De-AI 그레인 · 인스타 규격

- **원인 진단**: Seedance 720p는 속눈썹·캐치라이트·모공·직조와 센서 노이즈가 없어 Lanczos 1080p만 하면 Edits 앱에서 플라스틱(`face_roi_lap ~58–76`); 기본 x264 디블로킹이 피부 결을 한 번 더 뭉갬. SeedVR2 7B FP16 + 미세 광학 센서 그레인이 Topaz Proteus prob-4보다 자연스러움(`face_roi_lap +165–175%`).
- **파이프라인** `ig_reels_master.py --video 720p.mp4 --audio 48k.wav --out 1080p.mp4 [--grain 3.4 --cas 0.25 --crf 13 --fps 24 --no-seedvr2]`: ① ComfyUI 업로드 → `SeedVR2LoadDiTModel`·`SeedVR2LoadVAEModel`·`SeedVR2VideoUpscaler`(e1 인자) ② e2 체인 단일 패스 인코드. 그레인은 **루미넌스만**(`c0s`, 색노이즈 0), ISO 3200 질감.
- **Edits 규칙**: HD 1080p·SDR·네이티브 24fps CFR(플래시·런웨이·직캠 연출). 4K 업로드 시 인스타 강제 다운스케일, 8-bit SDR에 HDR 설정 시 피부 탈색·할로, 24→30/60 광학플로우는 스트로브·머리카락 젤리.
- **웹 납품 크기**(IDENTITY §6-4-2): 4K ≈15MB(가로 1700px+ 고밀도 또는 2400px+), 1080p ≤8MB, 720p 9:16 ≤3MB(16:9를 자르지 않고 전용 편집본), `-movflags +faststart`. GitHub 100MB·Vercel Hobby 월 100GB.
- **운영 메모**: 1080p→4K는 컷 지점에서 분할, SD→HD 출력은 BT.601 태그, yagi-crm 업스케일 스튜디오는 FHD·QHD·4K·8GB 입력(product-facts §4). 개인 쪽에서는 업스케일이 최상위 플랜 독점(§19.4) → 브랜드 쪽 표현 충돌 주의.
- **GPU**: YAGI-SERVER RTX PRO 6000 96GB, gpu-arbiter 시분할(ComfyUI 최우선). 제품 워커는 music-creator `GpuSession` 패턴(락·양보·홀드·VRAM 캡·반환 확인)을 그대로 쓴다.

---

## 7. (f) 로컬 수정법 (IDENTITY §6-4-3, 대표 지시 2026-11-01·11-02)

| 단계 | 규칙 | 수치 |
| --- | --- | --- |
| 1 자르기 | 고칠 것 + 주변 질감(로고면 유리·액체까지)을 네모로 잘라 캔버스를 채우게 확대 | 180px → 1440px |
| 2 프롬프트 | "이미지 1의 프레임·크기·위치·배경 질감·모든 요소는 픽셀 그대로. 이미지 2의 로고 **모양만** 쓴다. 흐린 로고 자리에 같은 크기·방향으로 유리 곡면에 섞여 인쇄. 더 크게 만들지 않는다." 참고는 마크 파일만(제품 사진을 주면 붙여 넣음). 피부는 신원 기준 사진 + "결만 살린다" | — |
| 3 정렬·합성 | ECC로 위치 맞춘 뒤 수정본에서 미세 결만, 큰 덩어리의 빛·색은 원본(후광 방지). 형태가 바뀌는 수정은 모델이 그린 자리에 두고 마스크는 병 윤곽, 큰 덩어리 시그마 ≥200px | σ ≥ 200px |
| 4 마스크 | 고칠 것만 덮고 네모 끝 전에 0으로; 경계는 깃·턱선·유리 테두리 같은 구조선을 피해 액체·배경·머리카락 균일면에; 가장자리 하드니스 약 50(BRAND-ENGINE §4-6) | hardness ≈ 50 |
| 5 확인 | 네모 밖 변경 픽셀 수 **0**; 경계·로고는 원본 크기로; 옆의 깨진 로고도 같이; 얼굴은 얼굴 전체를 네모로 | changed_pixels_outside = 0 |
| 교정 | 로고를 키우면 원본 크기·중심으로 되돌려 찍음; ECC 낮거나 가장자리 줄무늬면 합치지 말고 네모 재설정 | — |
| 데모 | 전후 차이가 한눈에: 승인 컷에서 일부러 망가뜨린 "수정 전"을 만들고 실제로 고침, "처음 나온 컷"이라 부르지 않음 | — |

제품 형태: "부분 수정 캔버스"(BRAND-ENGINE §6 P1) = 박스 선택 → 확대 렌더(NB Pro 편집) → ECC 정렬 → 주파수 분리 합성 → 마스크 → 차분 검증 리포트. 전신 컷을 전체 재생성하지 않는다(§4-6). 스크립트 원본: `Video-Creator/projects/2026-11-01-twings-perfume-real/local-fix`(저장소 밖, 이식 필요).

---

## 8. (g) 음악

### 8.1 라이선스 벽
- YuE2-3B·YuE2-VAE·SheetSage2 가중치 **CC BY-NC 4.0**(music-creator AGENTS·README §7·VENDORED.md). `yue2-songwriter`: "개인 창작자는 수익화 가능, **회사의 상업적 이용은 m-a-p 연락 필요**"(공식 README 기준이라고 적혀 있음 — 1차 출처 미확인). 공식 스킬 코드는 Apache 2.0, `instrumental/` MIT. RVC는 본인·허락받은 목소리만.
- BRAND-ENGINE §6·§7-1: 음악 생성 P2 **보류**, 라이선스 해결 전 납품·공개 문안 금지. yagi-crm 뮤직 스튜디오는 내부 전용.

### 8.2 대체 엔진이 갖춰야 할 요구 사양 (YuE2에서 아쉬웠던 것 포함)

| 항목 | 요구 | 근거 |
| --- | --- | --- |
| 라이선스 | 상업 납품·광고·플랫폼 게시 허용, 출력물 권리 귀속 명시, Content ID 충돌 정책, 면책 | real-sound licences, BRAND-ENGINE §7-1 |
| 길이 제어 | 초 단위 `duration` 파라미터(15/30/60s 숏폼). YuE2는 길이 파라미터가 없어 악보 마디×템포로만 정해지고 같은 요청이 68s·168s로 나옴 | README §4, songwriter §4 |
| 구조 제어 | 섹션 태그(`[Intro][Verse][Chorus][Bridge][Outro]`) 또는 드롭 시각 지정 — `T_drop`을 `T_reveal`에 맞추려면 드롭 위치 제어가 핵심 | viral-music rule_2 |
| 템포 | BPM 파라미터(YuE2는 style 텍스트로만) | songwriter |
| 보컬 유무 | 인스트루멘탈 보장(YuE2 BGM 모드는 보장 못 해 seed 2–3회 재시도) | README §7 |
| 스템 | vocals/drums/bass/other 분리 출력(폴리 덕킹·리믹스용; 없으면 Demucs 후처리) | d5 |
| 멜로디 조건 | ABC/MIDI 레퍼런스 멜로디(커버·브랜드 사운드 로고 변주) — 선택 | README §4 |
| 한국어 | 가사 언어 KO 공식 지원(YuE2는 EN·ZH만) | README §7 |
| 재현성 | seed + 후보 N개(논문: 8후보 선택으로 6.73→6.96) | songwriter §7 |
| 출력 | 48kHz 스테레오 WAV, 마스터 전 원본 | mastering SR=48000 |
| 실행 | 로컬 GPU ≤20GB(GpuSession 캡) 또는 API; 큐·타임아웃 1200s 안 | config.toml |

### 8.3 `mastering.py` 체인 재사용 가능성
- 코드 자체는 YAGI 작성(CPU, `ui` venv)이라 재사용 가능. 체인·상수는 §1 g3. 상업 레퍼런스 타깃 커브(`COMM_TARGET_VOCAL_ISO`·`COMM_TARGET_BGM_ISO`, 15밴드 dB)는 12곡 프로파일에서 유도된 **숫자 테이블**이라 음원 자체를 포함하지 않는다 — 다만 공개 문안에서 히트곡명·아티스트명을 쓰지 않는다.
- 의존성: numpy·scipy·soundfile(BSD), pyloudnorm(MIT), **`pedalboard`(Spotify) — GPL-3.0 가능성, 미확인**. GPL이면 서버 내부 실행(배포 없음)은 보통 문제 없으나 법무 확인 뒤 결정; 대안은 `pb.Compressor/HighpassFilter/PeakFilter/HighShelfFilter`를 scipy 2차 섹션으로 재구현(컴프 1개·필터 4개뿐이라 난이도 낮음).
- 검증 지표(ablation): `Score = 25·p_real − 1.2·SpecDef − 1.0·StereoDef − 3.0·LoudnessDef`, S/M 적정 −10.5~−7.5dB, corr ≥0.65. Matchering 2.0(빈 대역 강제 부스트, corr 0.45 붕괴)·고역 익사이터(p_real 급락)·4스템 역분리(LRA 손실)는 폐기 근거가 있다.

---

## 9. (h) 모션 그래픽 — 1차 범위 판단: **제외**

| 근거 | 내용 |
| --- | --- |
| 포지션 | BRAND-ENGINE §1 "브랜드만의 AI 미디어 엔진" = 사진·영상 생성·절대 규칙·메모리·마감. HyperFrames는 HTML→영상 렌더 프레임워크로, 생성 모델 노하우와 다른 축 |
| 디자인 원칙 | IDENTITY §5 "화려한 모션 그래픽보다 절제된 정보 한 줄. 영상 위에는 스펙 라벨 정도만" |
| 운영 비용 | 헤드리스 브라우저 렌더 서버, HeyGen CLI 로그인·카탈로그(BGM 10k+·이미지 75k+) 권리 확인, 월간 upstream 스킬 드리프트(`HYPERFRAMES_SKIP_SKILLS=1`, `custom_patches.json`) |
| 라이선스 | HyperFrames 자체 라이선스 미확인; talking-head-recut은 MIT(vtake-skills 개작); GSAP 번들(상용 조건 미확인) |
| 쓸모 | 내부 히어로(W6 `hero-ko.mp4`), 런치 필름, 토킹헤드 패키징 — 스튜디오 서비스 영역 |

남길 것: ① motion-doctrine의 수치(진입 ≤800ms, 퇴장 ≈75%, 스태거 ≤500ms, 정지 0.3–0.75s, bounce/elastic 금지)는 **웹 UI 모션 가이드**로 흡수(이미 `MOTION.spring` 하나) ② 채널별 내보내기의 캡션·엔드카드 오버레이(브랜드 폰트·마크 위치 고정, HTML 템플릿) P2 ③ 런치 필름 사운드 맵(d7)은 스튜디오 서비스 문서.

---

## 10. (i) 얼굴 · 인물 — 개인 쪽 원칙의 브랜드 적용

| 인물 유형 | 허용 | 경로 | 검수 |
| --- | --- | --- | --- |
| **가상 인물**(identity bank, 생성 얼굴) | 기본값. 공개·생성 입력 모두 허용 | 브랜드 캐스트 등록: 얼굴 레퍼런스 1 + 체형 레퍼런스 1(`single_model_identity_v2`), 업로드에 없는 뒷면 생성 금지, 레퍼런스 원본 비공개 | VLM 의류·장면 검토 + PD. 얼굴 일치 자동 게이트(ArcFace ≥0.62)는 가중치 비상업이라 **제품 기능 아님** |
| **동의한 크리에이터·직원·대표** | 허용, 단 개인 쪽과 같은 경로 | TWINGS 셀카 업로드 → 본인 사진 동의 ☑ → 제공사(BytePlus) 자동 검수 → 계정당 인물 자산 그룹 1개 → 필요 시 카메라 본인 인증 → 타인 얼굴 거부(약관 §5.3). 브랜드 쪽에서는 `brand_usage_*` 권리 기록과 연결, 기간·채널 명시 | 각도·밝기 판정은 권고만(2026-10-15 결정); 신고 24시간 검토; `face_policy` 거부는 다른 업체로 재시도 금지(IDENTITY §6-1) |
| **친구·제3자 얼굴** | 두 사람 동의(PLATFORM §19.5, 대표 승인) | 개인 쪽 설계 그대로 | — |
| **고객 브랜드가 보낸 실존 모델 사진**(동의 미확인) | **생성 입력 금지**(§21.5 "권리가 확인되지 않은 인물 에셋은 생성 입력으로 쓰지 않는다") | 라이브러리 보관·분석만 | 절대 규칙 검사 항목 "얼굴 동의" |
| Pinterest·IG 등 제3자 이미지 | 분석만. 모델 입력·공개 금지 | `extract_image.py` 측정 → 글로 번역 | — |

프롬프트 층의 인물 규칙(모든 모델 공통): 신원 사진 1장만 첨부(장면·스타일은 글로), 레퍼런스의 스튜디오 배경·블러셔·소품·정반사 제거 명시, Anti-plastic 계약, "ZERO freckles" 같은 결점 금지는 글로 안 막힘 → 깨끗한 기준 사진을 먼저 만들어 얼굴·머리·피부 전용 레퍼런스로(IDENTITY §6-4). 원칙 불변: 얼굴 검증·제공사 검수 우회 코드는 어떤 이유로도 금지(twings AGENTS §4).

---

## 11. 라이선스 표 (걸리는 것 전부)

| 항목 | 라이선스 | 확인 상태 | 영향 |
| --- | --- | --- | --- |
| YuE2-3B·YuE2-VAE·SheetSage2 가중치 | CC BY-NC 4.0 | 저장소 문서(AGENTS·README·VENDORED) / 공식 페이지 미확인 | 음악 생성 보류 |
| yue2-music 스킬 코드 / instrumental | Apache 2.0 / MIT | VENDORED.md | 코드 재사용 가능 |
| 바이럴 음원 5곡(Grimes, Hiroshi Yoshimura, Instupendo, Memo Boy, Sonilo) | 상업 음원(라이선스 없음) / Sonilo 트랙 출처 불명 | product-facts §4 "내부 검토용" | 제품에서는 브랜드 보유 음원만 |
| earshot 0.4.0 | MIT | `tools/earshot/LICENSE`, pyproject | 재사용 가능 |
| CLAP `laion/larger_clap_general`, AST `MIT/ast-finetuned-audioset-10-10-0.4593` | 미확인 | `earshot/config.py`에서 참조만 확인 | QA 모듈 서버 탑재 전 확인 |
| Demucs `htdemucs_ft` | 미확인(MIT 추정) | `viral_music_sync.py`·`config.toml` 참조 | 폴리 정리·스템 |
| pedalboard(Spotify) | 미확인(GPL-3.0 가능성) | `mastering.py` import | 마스터 모듈 의존 교체 여부 |
| SeedVR2 7B FP16 가중치 + ComfyUI 노드 | 미확인 | `ig_reels_master.py` 참조 | 업스케일 워커; product-facts §4 "모델 가중치 라이선스 확인 필요" |
| InsightFace/ArcFace(Americano 얼굴 게이트) | 비상업(PLATFORM §21.8 기재) | 1차 출처 미확인 | 자동 얼굴 검증 제품 기능 금지 |
| HyperFrames / GSAP 번들 | 미확인 | — | 모션 제외 근거 중 하나 |
| talking-head-recut | MIT(vtake-skills 개작) | `NOTICE.md` | — |
| Freesound·Mixkit·Pixabay 녹음 | CC0/CC BY 허용, NC·ND·SA·불명 금지, Mixkit·Pixabay는 Content ID 등록 금지, CC BY는 크레딧 필수 | `real-sound/references/licences.md` | 실녹음 사운드 워크플로 |
| 상업 레퍼런스 12곡(마스터 타깃 커브 유도) | 숫자 테이블만 포함 | ablation 문서 | 공개 문안에 곡명 금지 |
| Americano identity bank 얼굴·체형 레퍼런스 | 공개 금지 | §21.8 | — |

---

## 12. TWINGS 제안

1. **고정 층 스키마에 "제작 원칙" 테이블 3개를 추가한다**: `engine_routing`(a1), `prompt_rules`(a9·a10·a12·a16·a17 조항 + 린트), `shot_spec_schema`(§3.3). `lib/design/identity.ts`와 같은 모양으로 코드 상수 → 브랜드별 행. P0, 마이그레이션 core+glue.
2. **P0 구현 순서**: ① `extract_image.py` 서버 워커화(CPU, 가중치 없음) → ② ShotSpec 생성(한 줄 지시 + 측정 + 아이덴티티) → ③ 프롬프트 컴파일러(NB Pro·Seedream·Soul·Seedance 4개 직렬화기부터) → ④ 480p draft→approve→final 상태기계 → ⑤ 절대 규칙 검사에 "레퍼런스 역할 누락·장비명·금지어·얼굴 동의" 린트 추가. 이 다섯은 외부 라이선스 의존이 없다.
3. **P1**: 부분 수정 캔버스(f1, 저장소 밖 스크립트 이식), 색 보정 `match`+`save-look` → `brand_looks`(§4.3), 좋은 원본+제품 교체 1급 워크플로(b5), Deglaze 프리셋(e6).
4. **P2(GPU·라이선스 확인 뒤)**: SeedVR2 업스케일 워커 + 인스타 마스터 프리셋(e1·e2), 사운드 마감(d4·d5·d6; 음원은 브랜드 보유분만), 마스터 체인(g3; pedalboard 대체 여부 먼저). 모든 GPU 워커는 `GpuSession` 패턴과 gpu-arbiter 공개 API만.
5. **제외·보류**: 음악 생성(g1), 자동 얼굴 게이트(i4), 모션 그래픽(h). 공개 문안에 넣지 않는다.
6. **공개 금지 목록을 검사기로**: 엔진명·도구명(Seedream·Seedance·Nano Banana·SeedVR2·YuE2·earshot·HyperFrames·ComfyUI), 내부 실측 수치(8/8, 6/8, +165%), 레퍼런스 원본(`source_path`·sha·시트의 사진 영역), 히트곡명, Americano 레퍼런스, 클라이언트 패키지가 섞인 교체 전 원본 프레임.
7. **골든 픽스처**: Video-Creator `library/user-preferred/*.txt`, `projects/2026-09-26-beauty-ad-template/prompt-en.txt`, `2026-10-29-fashion-runway-template/prompt_v3.txt`, 브라이덜 5컷 프롬프트를 컴파일러 테스트 입력으로 가져온다(원본 영상·사진은 가져오지 않는다).

## 13. 대표 결정 필요

1. **음악 라이선스**: m-a-p에 상업 이용 문의할지, 상업 라이선스 엔진으로 교체할지, 당분간 "BGM 없는 마스터 + 브랜드 보유 음원"만 할지(§8.2 사양 기준 조달).
2. **`pedalboard` 의존**: GPL 확인 결과에 따라 서버 내부 사용 허용 vs scipy 재구현.
3. **GPT Image 2.5 위치**: IDENTITY §6-1은 "쓰지 않는다", BRAND-ENGINE §6 P1은 "부분 수정 캔버스(NB 계열·GPT Image 2.5 편집)" — 어느 쪽을 원본으로 둘지.
4. **얼굴 일치 게이트 대체**: 비상업 가중치 대신 (a) 제공사 검수 + VLM + PD만, (b) 상업 라이선스 얼굴 임베딩 조달, (c) 보류.
5. **SeedVR2 가중치 라이선스 확인 뒤 업스케일 워커의 제품 노출 범위**(개인 쪽 최상위 플랜 독점 §19.4와의 관계).
6. **브랜드 쪽 "동의한 크리에이터" 얼굴 경로**를 개인 쪽 §5.3 그대로 쓸지, 브랜드 계약(기간·채널·2차 활용) 필드를 더할지 — 약관 문안은 대표 승인.
7. **바이럴 음원 카탈로그 운영**: 내부 레퍼런스로만 유지할지, 브랜드 업로드 트랙 앵커 자동 계측 기능을 만들지.
8. **공개 사례 범위**: 브라이덜 5컷 얼굴 공개 여부(`docs/qa/bridal-image-templates/PR.md`), yunseol 워크플로를 "대표 본인 계정" 표기로 랜딩에 쓸지.
9. **모션 그래픽 제외** 확정 여부(§9). 캡션·엔드카드 오버레이만 P2로 두는 안.

---

### 부록 — 읽은 파일 (2026-11-03, 로컬)

Video-Creator: `AGENTS.md`; `.agents/skills/{seedance-film-director,image-director,motion-doctrine,cut-the-curve,real-sound,earshot,media-use,product-launch-video,talking-head-recut,general-video}/SKILL.md`; `seedance-film-director/references/{seedance-2.5-model-notes,extraction-tool,prompt-composition,reference-video-analysis,seedance-ad-planning,action-chase-camera}.md`; `image-director/references/model-prompt-formulas.md`; `real-sound/references/{licences,sound-design,process}.md`; `media-use/luts/{index.json,README.md}`; `talking-head-recut/NOTICE.md`; `tools/{viral_color_grade,viral_music_sync,ig_reels_master,extract_image,extract_video,earshot_bridge,sync_yunseol_hd}.py`; `tools/earshot/{LICENSE,pyproject.toml,docs/launch-video-sound.md,docs/SFX.md}`; `library/visual-looks/catalog.json`; `library/viral-music/catalog.json`.
music-creator: `AGENTS.md`, `README.md`, `config.toml`, `musicgen/{mastering,pipeline,gpu_guard}.py`, `docs/mix_mastering_ablation_2026_11.md`, `.agents/skills/yue2-music/VENDORED.md`, `.agents/skills/yue2-songwriter/SKILL.md`(라이선스·길이·seed 줄).
twings: `docs/design/IDENTITY.md`, `lib/design/identity.ts`, `docs/BRAND-ENGINE.md`, `docs/research/brand-landing-2026-10-29/{LESSONS,photo-craft,color-system}.md`, `docs/research/brand-landing-2026-10-30/product-facts.md`, `docs/PLATFORM-2.0.md`(§4·§21), `docs/IDENTITY-SELFIE.md`(헤딩), `lib/legal/documents.ts`(§5.3), `lib/renders/engines.ts`, `.agents/skills/higgsfield-product-photoshoot/SKILL.md`(모드), `.agents/skills/higgsfield-brandkit/SKILL.md`(구조).
