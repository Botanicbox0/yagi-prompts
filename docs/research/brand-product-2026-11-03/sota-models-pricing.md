# 생성 모델·API SOTA와 단가 (2026-11-03)

> 브랜드 제품 리서치 묶음의 한 편. 범위: 이미지·영상·오디오/음악·V2A·업스케일·색 보정 모델의 공식 단가, 라이선스, 레퍼런스 기능, 한국 가용성, RTX PRO 6000(96GB) 1장 로컬 실행 가능성.
> 코드·가격·약관은 바꾸지 않았다. 모든 숫자는 **2026-11-03 확인**, USD 원문 + **1,400원/USD** 환산. 공식 페이지에서 못 읽은 값은 **미확인**으로 표시했다. 2차 출처(리셀러·가이드)만 있는 값은 **(2차)**로 표시했다.

## 결론 먼저

1. **이미지는 Seedream 5.0 Pro($0.045~0.09)와 Nano Banana Pro($0.134/1K·2K)가 품질 1군, Nano Banana 2.1($0.0336/1K)·Seedream 5.0 Lite($0.035)·FLUX 3 Image Klein($0.009/1K)이 비용 1군이다.** 같은 컷을 1/4~1/15 가격으로 뽑을 수 있으니 "검수 통과한 컷만 Pro로 다시 뽑는" 2단 구조가 맞다.
2. **영상은 Seedance 2.5가 720p $0.231/s(323원/s), 1080p $0.569/s(797원/s)로 2.0보다 약 50% 비싸졌고, 오디오는 항상 붙는다(끌 수 없음).** 5초 720p 한 편이 1,618원이라 TWINGS 24,900원 템플릿의 5% 원가 상한(1,245원)을 넘긴다. 비용 대안은 Seedance 2.0 Fast 720p $0.12/s, Wan 2.6 $0.10/s, Gemini Omni 1.1 Flash ≈$0.10/s, Veo 3.1 Fast $0.10/s(오디오 포함).
3. **Sora 2 API는 2026-09-24에 종료됐고 대체 API가 없다.** 영상 라우팅 표에서 뺀다.
4. **오픈 가중치 쪽 라이선스 지뢰가 많다.** Tencent Hunyuan 계열(HunyuanVideo 1.5, HunyuanImage 3.0, HunyuanVideo-Foley)은 라이선스가 **대한민국에서 적용되지 않는다**(사용 불가). MMAudio 가중치·ThinkSound·YuE2 가중치는 비상업. Ideogram 4 오픈 가중치도 비상업. 한국 법인이 상업 납품에 쓸 수 있는 오픈 모델은 **Qwen-Image/Qwen-Image-Edit(Apache-2.0), SeedVR2(Apache-2.0), ACE-Step 1.5(MIT), Wan 2.2(Apache-2.0), FLUX.2 klein 4B(Apache-2.0), LTX-2.5(연매출 $10M 미만 무료)** 정도다.
5. **로컬 GPU는 업스케일(SeedVR2)·부분 수정(Qwen-Image-Edit)·BGM(ACE-Step 1.5)·LUT 그레이딩(ffmpeg)에서 API 대비 건당 100~400원을 아낀다.** 단가는 작지만 건수가 많은 작업이라 월 단위로는 의미가 있다. V2A는 상업 가능한 오픈 모델이 없어 Seedance 내장 오디오·Gemini Omni·ElevenLabs SFX로 간다.
6. **MiniMax Music은 2026-08-20부터 신규 사용자에게 닫혔고, Suno·Udio는 공개 API가 없다.** 음악 API는 ElevenLabs Music($0.15/분, Starter+ 상업)과 Google Lyria 3/3 Pro($0.04/30초, $0.08/곡)로 좁혀진다.

## 0. 표기 규칙·확인 방법

- 공식 요금 페이지를 직접 열어 읽었다(Gemini API, Vertex AI, OpenAI, BytePlus ModelArk, Runway Dev, BFL docs, Ideogram, Recraft, ElevenLabs, MiniMax, Stability, Topaz, Magnific docs, Alibaba Model Studio, Colourlab, Dehancer). GitHub LICENSE 원문과 Hugging Face 모델 카드의 license 태그로 오픈 가중치 라이선스를 확인했다.
- Kling 공식 요금 페이지(kling.ai/document-api/pricing)와 BytePlus 모델 문서 페이지는 JavaScript로만 렌더링돼 본문을 못 읽었다. 그 값은 **미확인** 또는 **(2차)**다.
- "로컬 실행 가능"은 RTX PRO 6000 Blackwell 96GB 1장, ComfyUI·gpu-arbiter 운영 환경 기준이다. 속도는 공식 README에 적힌 다른 GPU 수치를 그대로 옮겼고, 우리 카드 실측은 **사내 측정 필요**로 남겼다.
- 로컬 원가 추정(§3)의 전기요금·감가는 **가정**이다. 가정값을 표 안에 적어 두었다.

## 1. 모델별 표

### 1.1 이미지

| 모델 (ID) | 입력 → 출력 | 해상도 | 단가 (USD → 원) | 상업·라이선스 | 레퍼런스·편집 | 한국 가용 | 로컬 96GB | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Seedream 5.0 Pro** (`dola-seedream-5-0-pro-260628`, BytePlus ModelArk) | 텍스트·이미지 → 이미지 | ≤2.61M px(≤1.5K) / 그 이상(2K~4K) | $0.045 → 63원 / $0.09 → 126원. 입력 이미지 첫 장 무료, 2장째부터 $0.003(4원). 레이어 분해 $0.0225/$0.045 | API 약관(학습 사용·출력물 소유권은 **미확인**) | 멀티 레퍼런스(입력 이미지 장당 과금), 편집, 레이어 분해 | ModelArk 국제 리전(ap-southeast-1)으로 사용. 공식 리전 제한 페이지는 **미확인**(동적 렌더) | 비공개 | [ModelArk pricing](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing) |
| **Seedream 5.0 Lite** (`seedream-5-0-lite-260128`) | 텍스트·이미지 → 이미지 | 단일 티어 | $0.035 → 49원. 입력 이미지 무료 | 위와 같음 | 멀티 레퍼런스·편집 | 위와 같음 | 비공개 | 위와 같음 |
| Seedream 5.0 Flash (`dola-seedream-5-0-flash-260915`) | 〃 | 단일 | $0.018 → 25원 | 〃 | 〃 | 〃 | 비공개 | 〃 |
| Seedream 4.5 / 4.0 | 〃 | 단일 | $0.04 → 56원 / $0.03 → 42원 | 〃 | 〃 | 〃 | 비공개 | 〃 |
| **Nano Banana Pro** (`gemini-3-pro-image`) | 텍스트·이미지 → 이미지 | 1K·2K / 4K | $0.134 → 188원 / $0.24 → 336원 (출력 $120/M tokens, 1K·2K=1,120 tokens, 4K=2,000 tokens). 입력 이미지 560 tokens ≈ $0.0011 | 유료 티어는 "제품 개선에 사용 안 함(No)". 무료 티어 N/A | 멀티 레퍼런스(입력 이미지 다수), 편집·마스크(프롬프트 기반) | 한국 지원(available-regions에 "South Korea") | 비공개 | [Gemini API pricing](https://aistudio.google.com/docs/pricing), [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing), [regions](https://aistudio.google.com/docs/available-regions) |
| **Nano Banana 2.1** (`gemini-nano-banana-2.1`) | 〃 | 1K / 2K / 4K | $0.0336 → 47원 / $0.0504 → 71원 / $0.113 → 158원 (출력 $30/M). Batch 절반($0.0168/1K) | 유료 "No", 무료 "Yes"(학습 사용) → **반드시 유료 티어** | 멀티 레퍼런스·편집 | 지원 | 비공개 | [Gemini API pricing](https://aistudio.google.com/docs/pricing) |
| Nano Banana 2 (`gemini-3.1-flash-image`) / 2 Lite | 〃 | 0.5K~4K | $0.045(0.5K) / $0.067(1K) → 94원 / $0.101(2K) / $0.151(4K). Lite $0.0336/1K | 〃 | 〃 | 지원 | 비공개 | 〃 |
| **GPT Image 2** (`gpt-image-2`) | 텍스트·이미지 → 이미지 | 1024² / 1024×1536 | low $0.006 → 8원, medium $0.053 → 74원, high $0.211 → 295원 (1024²). 토큰: 입력 이미지 $8/M, 출력 $30/M, 텍스트 $5/M | OpenAI API 약관(출력물 소유·학습 미사용 조항은 **약관 확인 필요**, §4) | 다중 입력 이미지, `mask` 편집(프롬프트 기반, 정확한 마스크 추종 보장 없음) | 한국 지원(supported-countries에 "South Korea") | 비공개 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [image guide](https://developers.openai.com/api/docs/guides/image-generation), [countries](https://developers.openai.com/api/docs/supported-countries) |
| **GPT Image 2.5** (`gpt-image-2.5-flare` 빠른 일상용 / `gpt-image-2.5-sunburst` 편집 정밀용) | 〃 | 최대 8,294,400 px(4K, 변 ≤3,840), 2560×1440 초과는 experimental; quality low/medium/high/xhigh/max/auto | 토큰 단가는 GPT Image 2와 동일(입력 이미지 $8/M, 출력 $30/M). **이미지당 가격표는 공식 계산기에만 있어 미확인**. (2차) Runway Dev 리셀 1~75 credits = $0.01~0.75 | 〃 | 〃 | 지원 | 비공개 | 위와 같음 |
| **FLUX 3 Image** (BFL API) | 텍스트·이미지 → 이미지 | 768sq / 1k / 1.5k / 2k / 4k | 1K $0.048 → 67원(공식 계산기 표시값). 768 $0.041, 1.5K $0.07, 2K $0.10, 4K $0.607 **(2차, bfl.ai/pricing 구조화 데이터 판독)** | API 약관. 거절·실패·검열 보류는 미과금 | 편집 동일 가격 | 미확인(지역 제한 표기 없음) | 비공개 | [bfl.ai/pricing](https://bfl.ai/pricing), [docs pricing](https://docs.bfl.ai/quick_start/pricing) |
| **FLUX 3 Image Klein** (5.6B, 오픈 가중치) | 〃 | 1K~4K | API 1K **$0.009 → 13원**(공식 블로그 "starts at $0.009 per 1K image"). 2K $0.014, 4K $0.036 (2차) | "FLUX Kommunity License": 연매출 **$5M 미만** 개인·기업 상업 무료(블로그 문구; 라이선스 원문은 **미확인**, HF 게이트) | T2I·편집 동일 | 〃 | **가능**(INT8 8GB, 5.6B → bf16도 여유). 속도 사내 측정 필요 | [Klein blog](https://bfl.ai/blog/flux-3-image-klein), [Klein docs](https://docs.bfl.ai/flux_3/flux3_image_klein) |
| FLUX.2 [dev] / [klein] 9B / [klein] 4B | 오픈 가중치 | — | [dev]는 호스팅 API 없음("Local only, non-commercial") | HF 태그: **FLUX.2-dev, klein-9B = flux-non-commercial-license**, **klein-4B = Apache-2.0** | — | — | 가능 | [HF FLUX.2-dev](https://huggingface.co/black-forest-labs/FLUX.2-dev), [klein-4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |
| FLUX.1 Kontext pro/max | API | — | docs 표의 가격 셀이 동적 렌더라 **미확인** | API | 편집 특화 | — | 비공개 | [docs pricing](https://docs.bfl.ai/quick_start/pricing) |
| **Ideogram 4.5** (API) | 텍스트(+레퍼런스 ≤5장) → 이미지 / Precise Edit | 해상도 무관 고정가 | very low $0.008 → 11원(레퍼런스·Precise Edit만) / low $0.03 → 42원 / medium $0.06 → 84원 / high $0.10 → 140원, high+레퍼런스·Precise Edit $0.22 → 308원 | ToS(2024-08-14): 출력물 권리를 사용자에게 양도, 상업 사용 제한 없음. 퍼블리시티·상표 침해 금지 | 스타일 레퍼런스 ≤5, Precise Edit(부분 수정). 캐릭터 고정·마스크 명시 없음 | 미확인 | 비공개 (Ideogram 4 오픈 가중치는 **비상업 라이선스**) | [ideogram.ai/models/4.5](https://ideogram.ai/models/4.5/), [ToS](https://ideogram.ai/legal/tos), [HF Comfy-Org/Ideogram-4](https://huggingface.co/Comfy-Org/Ideogram-4) |
| **Recraft V4.1** (API) | 텍스트·이미지 → 래스터/벡터 | 표준 / Pro 2K | V4.1·V4.1 Utility $0.035 → 49원, Pro(2K) $0.21 → 294원, 벡터 $0.08 / Pro 벡터 $0.30, Flash $0.007 → 10원. 스타일 레퍼런스 +$0.005 | API 유닛 선불($1=1,000 units), 비환불. 소유권 문구 없음 | 스타일 생성·참조, Enhance details $0.21, Crisp upscale $0.004, Creative upscale $0.25, 배경 제거 $0.01 | 미확인 | 비공개 | [Recraft pricing](https://www.recraft.ai/docs/api-reference/pricing.md) |
| **Qwen-Image / Qwen-Image-Edit-2511** (20B, 오픈) | 텍스트·이미지 → 이미지, 편집 | 자유 | 로컬 0원(§3) | **Apache-2.0**(GitHub LICENSE·HF 태그) | 편집·텍스트 렌더링 강점, 멀티 이미지 편집(2509+) | 제한 없음 | **가능**(20B bf16 ≈ 41GB, 96GB 여유). 속도 사내 측정 필요 | [GitHub](https://github.com/QwenLM/Qwen-Image), [HF Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) |
| HunyuanImage 3.0 (80B MoE, 오픈) | 〃 | — | — | **Tencent Hunyuan Community License: "DOES NOT APPLY IN … SOUTH KOREA"** → 한국에서 사용·출력물 표시 불가 | — | **불가** | 권장 VRAM ≥3×80GB(Instruct는 ≥8×80GB) → 1장 불가 | [LICENSE](https://github.com/Tencent-Hunyuan/HunyuanImage-3.0/blob/master/LICENSE) |
| (참고) Vertex Imagen 도구 | Product Recontext / Virtual Try-On / Upscaling | — | $0.12 / $0.06 / $0.003 per image | Google Cloud 약관 | 제품 1~3장 + 장면 프롬프트 / 사람 1장 + 옷 1장 | 지원 | 비공개 | [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) |

### 1.2 영상

| 모델 (ID) | 입력 → 출력 | 해상도·길이 | 단가 (USD → 원) | 오디오 / 편집 / 레퍼런스 | 상업·라이선스 | 한국 가용 | 로컬 96GB | 출처 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Seedance 2.5** (`dreamina-seedance-2-5-260628`, ModelArk) | 텍스트·이미지·영상·오디오 → 영상+오디오 | 480p·720p·1080p(4K 미지원), 4~30초 | 토큰 단가 $10.70/M(480p·720p), $11.7/M(1080p); 영상 입력 시 $6.40/$7.0. 페이지 예시(5초 16:9): **480p $0.103/s → 144원/s, 720p $0.231/s → 323원/s, 1080p $0.569/s → 797원/s**. 5초 = $0.514 / $1.156(1,618원) / $2.843(3,980원) | **오디오 항상 생성, 끌 수 없음**(2차: Together 문서). 레퍼런스 이미지 ≤30·영상 ≤10·오디오 ≤10, 첫·끝 프레임 2장(2차). 전용 video-edit 엔드포인트는 **미확인** | ModelArk 약관(학습·소유권 **미확인**) | 국제 리전 사용. (2차) 미국 불가 보도 | 비공개 | [ModelArk pricing](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing), [Together quickstart (2차)](https://docs.together.ai/docs/seedance2.5-quickstart) |
| **Seedance 2.0** (`dreamina-seedance-2-0-260128`) / Fast / Mini | 〃 | 480p~4K / Fast·Mini 480p·720p | 2.0: 480p $0.07/s → 98원, 720p $0.15/s → 210원, 1080p $0.37/s → 518원, 4K $0.78/s → 1,092원. Fast: 480p $0.06, 720p $0.12 → 168원. Mini: $0.04 / $0.08 | 오디오 토글 있음(2차). (2차) video-edit·extend 전용 ID 존재 | 〃 | 〃 | 비공개 | 〃 |
| Seedance 1.0 Pro / Pro Fast | 〃 | 전 해상도 | $2.5/M → 페이지 예시 없음 / $1/M | — | 〃 | 〃 | 비공개 | 〃 |
| **Kling 4.0 (Omni)** | 텍스트·이미지·레퍼런스·영상 → 영상 | 720p·1080p | **공식 단가 미확인**(kling.ai 요금 페이지 동적 렌더). (2차) Runway Dev 리셀: 720p 정가 15.7 credits/s = $0.157/s → 220원/s(2026-11-30까지 12.56), 1080p 23.5 = $0.235/s → 329원/s; 영상 입력 시 출력 7.52/s + 입력·출력 중 긴 쪽 7.52/s | Omni 멀티 레퍼런스(2차: 최대 15개 입력), 영상 입력 편집 | Kling 약관 **미확인** | 글로벌 API 운영(리포 어댑터 `kling-omni` 있음, 키 미등록) | 비공개 | [Runway Dev pricing](https://docs.dev.runwayml.com/guides/pricing/), [kling.ai pricing(미판독)](https://kling.ai/document-api/pricing) |
| Kling 3.0 / O3 (2차, Runway Dev) | 〃 | std·pro·4K | 3.0 std 9(무음)/13(오디오) credits/s, pro 12/17, 4K 43; O3 13/17/43 → $0.09~0.43/s | 오디오 옵션 | 〃 | 〃 | 비공개 | 〃 |
| **Veo 3.1** (Vertex AI) | 텍스트·이미지 → 영상(+오디오) | 720p·1080p·4K | 오디오 포함 720p·1080p **$0.40/s → 560원/s**, 4K $0.60/s; 무음 $0.20/s, 4K $0.40/s. **Fast** 오디오 720p $0.10/s → 140원/s, 1080p $0.12/s, 4K $0.30/s; 무음 $0.08/$0.10/$0.25. **Lite** 오디오 720p $0.05/s, 1080p $0.08/s | 동기 음성·효과음. 레퍼런스 이미지(Vertex 문서) | Google Cloud 약관 | 지원 | 비공개 | [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing). Gemini API 요금 페이지 판독분에는 Veo 행이 없었음(**미확인**) |
| **Gemini Omni 1.1 Flash** (`gemini-omni-1.1-flash`) | 텍스트·이미지·영상 → 영상+네이티브 오디오 | 720p 기준, 3~10초 | 출력 $17.50/M video tokens, **5,792 tokens/s(720p) ≈ $0.10/s → 140원/s**(공식 페이지 문구 "roughly $0.10 per second"). 텍스트 출력 $9/M. 무료 티어 없음 | 네이티브 오디오. (2차) Runway Dev: 360p 3.4·720p 10·1080p 15·4K 30 credits/s, 레퍼런스 이미지 +1, 입력 영상 +1/s | 유료 "No"(학습 미사용) | 지원 | 비공개 | [Gemini API pricing](https://aistudio.google.com/docs/pricing) |
| **Sora 2 / Sora 2 Pro API** | — | — | **2026-09-24 종료**("shut down", 대체 API 없음). 종료 전 단가: sora-2 720p $0.10/s, pro 720p $0.30/s·1024p $0.50/s·1080p $0.70/s | — | — | — | — | [sora-2-pro](https://developers.openai.com/api/docs/models/sora-2-pro), [deprecations](https://developers.openai.com/api/docs/deprecations) |
| **Runway Gen-4.5 / Aleph 2 / Gen-4 Turbo** (Runway Dev) | 텍스트·이미지 → 영상 / 영상 → 영상 편집 | — | 1 credit = $0.01. Gen-4.5 12 credits/s = **$0.12/s → 168원/s**; Aleph 2 28 credits/s = $0.28/s → 392원/s(최소 56 credits); Gen-4 Turbo 5 = $0.05/s; Act-Two 5. ProRes/PNG +5/s, HDR +20/s | Aleph 2 = 영상 편집(부분 수정·스타일) | Runway 약관 | 지원 | 비공개 | [Runway Dev pricing](https://docs.dev.runwayml.com/guides/pricing/) |
| **Wan 2.6** (`wan2.6-i2v`, Alibaba Model Studio 국제) | 이미지·텍스트·오디오 → 영상(+오디오) | 720p·1080p, ≤15초 | **720p $0.10/s → 140원/s, 1080p $0.15/s → 210원/s**(싱가포르 리전, USD). t2v는 같은 값 (2차). i2v-flash 720p $0.05/s (2차) | 오디오 출력 모달리티 있음(별도 단가 없음) | **가중치 비공개**(HF Wan-AI에 2.5/2.6 없음; 2차: Artificial Analysis "not open weights") | 국제 리전 | 비공개 | [wan2.6-i2v](https://www.alibabacloud.com/help/en/model-studio/wan2-6-i2v), [HF Wan-AI](https://huggingface.co/Wan-AI) |
| Wan 2.2 (A14B·5B, 오픈) | 〃 | 480p·720p | 로컬 0원 | **Apache-2.0**, "생성물에 권리 주장 안 함" | 제한 없음 | **가능**(A14B는 80GB 권장 → 96GB 1장 가능). 속도 README는 H100 기준, 사내 측정 필요 | [GitHub Wan2.2](https://github.com/Wan-Video/Wan2.2) |
| **LTX-2.5** (22B, 오픈, 오디오+영상) | 텍스트·이미지 → 영상+오디오 | 최대 4K(latent upscaler) | 로컬 0원 | **LTX-2.x Community License(2026-08-11)**: 연매출 **$10M 이상 기업은 유료 라이선스 필수**, 미만은 상업 포함 무료. HF 태그 ltx-2.x-community-license-agreement | 네이티브 오디오, DFR 고품질 패스 | 제한 없음(한국 제외 조항 없음) | **가능**(22B bf16 ≈ 44GB + Gemma4-12B 인코더 ≈ 24GB; fp8-cast·offload 옵션) | [GitHub LTX-2](https://github.com/Lightricks/LTX-2), [LICENSE-2_x](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x) |
| HunyuanVideo 1.5 (8.3B, 오픈) | 〃 | 480p·720p·1080p | — | **라이선스가 대한민국에서 적용되지 않음**("DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA"; Territory 밖 사용·출력물 표시 금지) | — | **불가** | 기술적으로는 14GB면 되지만 라이선스로 제외 | [LICENSE](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/master/LICENSE) |
| (참고) MiniMax H3 | 〃 | 480p·768p·2K | 2K $0.13/s, 768p $0.08/s, Highspeed 768p $0.06/s, Lite 480p $0.025/s | 입력 이미지 5장 무료 | MiniMax 약관 | 글로벌 | 비공개 | [MiniMax pricing](https://platform.minimax.io/docs/pricing/overview) |

### 1.3 오디오·음악

| 모델 | 출력 | 단가 (USD → 원) | 상업·라이선스 | 한국 / 로컬 | 출처 |
| --- | --- | --- | --- | --- | --- |
| **ElevenLabs Eleven Music** (API) | 보컬·인스트 곡 | **$0.15/분 → 210원/분**(API 페이지). 플랜 포함 분량 3/40/147/660/1,993/6,600분 | "Commercial use licensing on Starter+ plans". 셀프서브는 **"online and offline commercial use is permitted, except for film, TV, and Studio Games"**, 광고·브랜디드 콘텐츠는 허용 문구. Enterprise는 전부 허용. Free는 개인용 | 글로벌 / 비공개 | [API pricing](https://elevenlabs.io/pricing/api), [music](https://elevenlabs.io/music) |
| **ElevenLabs Sound Effects** (API) | 효과음 | **$0.12/분 → 168원/분**("Royalty-free") | 플랜별 상업 조건은 음악과 같은 페이지 기준 | 글로벌 / 비공개 | [API pricing](https://elevenlabs.io/pricing/api) |
| **Lyria 2** (Vertex) | 30초 인스트루멘털 WAV 48kHz | $0.06/count → 84원 | Google Cloud 약관 | 지원 / 비공개 | [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) |
| **Lyria 3 / Lyria 3 Pro** (Vertex), **Lyria 3.5** (Gemini API) | 30초 클립 / 전곡 / 전곡 | $0.04/30초 → 56원 / $0.08/곡 → 112원 / $0.08/곡 | 유료 "No"(Gemini API) | 지원 / 비공개 | [Vertex](https://cloud.google.com/vertex-ai/generative-ai/pricing), [Gemini API](https://aistudio.google.com/docs/pricing) |
| Lyria RealTime | 실시간 | **미확인**(두 요금 페이지 모두 없음) | — | — | — |
| Suno API | — | **공개 API 없음**(2차: platform.suno.com 로그인 페이지만, 파트너 한정 탐색 중) | — | — | (2차) |
| Udio API | — | **공개 API 없음**(2차: Udio 헬프센터) | — | — | (2차) |
| **MiniMax Music 3.0/2.6/2.5** | 곡 ≤5분 | $0.15/곡 → 210원. **2026-08-20부터 신규 사용자 불가**("will no longer be available to new users"), 무료 API는 종료 | — | 신규 불가 | [MiniMax pricing](https://platform.minimax.io/docs/pricing/overview) |
| **Stable Audio 2.5 / 3.0** (API) | 곡·효과음 | 8 credits = **$0.08 → 112원**/생성(1 credit=$0.01, 신규 25 credits) | API 약관. 가중치는 Community License(연매출 **$1M 미만** 무료, 초과는 Enterprise), 출력물은 사용자 소유 | 글로벌 / 비공개(Open 계열만) | [Stability pricing](https://docs.stability.ai/pricing), [license](https://stability.ai/license) |
| **ACE-Step 1.5** (오픈, XL 4B DiT + LM 1.7B/4B) | 전곡(보컬 포함) | 로컬 0원 | **MIT**(GitHub LICENSE + HF 가중치 태그 `mit`). 과제 문구의 "Apache-2.0"은 v1 기준 → 1.5는 MIT | 제한 없음 / **가능**(≥24GB 권장 구성 "Best quality, all models fit"; RTX 3090에서 전곡 10초 미만) | [GitHub ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5), [HF xl-sft](https://huggingface.co/ACE-Step/acestep-v15-xl-sft) |
| **YuE2** (오픈) | 전곡 48kHz 스테레오 | 로컬 0원 | 코드 Apache-2.0, **가중치 CC BY-NC 4.0 + 추가 조건** → 기업 상업 사용은 "Contact us" | 24GB BF16 GPU / 가능하지만 **상업 불가** | [GitHub YuE](https://github.com/multimodal-art-projection/YuE) |

### 1.4 영상 → 사운드 (V2A)

| 모델 | 라이선스 | 한국 상업 납품 | VRAM | 출처 |
| --- | --- | --- | --- | --- |
| MMAudio | 코드 MIT, **가중치 CC-BY-NC 4.0** | **불가** | ≈6GB | [GitHub](https://github.com/hkchengrex/MMAudio) |
| ThinkSound | README "**Commercial use is NOT permitted.** For commercial licensing, contact the authors." + Stability VAE 조건 | **불가** | — | [GitHub](https://github.com/FunAudioLLM/ThinkSound) |
| HunyuanVideo-Foley | Tencent Hunyuan Community License → **한국 제외** | **불가** | 8~20GB | [LICENSE](https://github.com/Tencent-Hunyuan/HunyuanVideo-Foley/blob/master/LICENSE) |
| Seedance 2.5 내장 오디오 | 영상 단가에 포함(추가 과금 없음) | 가능 | — | ModelArk pricing |
| Gemini Omni 1.1 Flash 내장 오디오 | 영상 단가에 포함 | 가능 | — | Gemini API pricing |
| LTX-2.5 내장 오디오 | Community License(<$10M 무료) | 가능(YAGI 기준) | 로컬 | LTX-2 |
| ElevenLabs Sound Effects | $0.12/분 | 가능(Starter+) | — | ElevenLabs |

결론: **독립 V2A 오픈 모델 중 한국 법인이 상업 납품에 쓸 수 있는 것은 없다.** 사운드는 생성 단계에서 같이 뽑거나(Seedance·Omni·LTX) 효과음 API를 쓴다.

### 1.5 업스케일

| 도구 | 단가 (→ 원) | 라이선스 | 로컬 | 출처 |
| --- | --- | --- | --- | --- |
| **SeedVR2 3B/7B** (오픈) | 로컬 0원 | **Apache-2.0**(GitHub LICENSE·HF 태그) | **운영 중**(480p 템플릿 10편 → 1080p 전환 완료). 처리 속도·VRAM 실측값은 **사내 기록 필요** | [GitHub SeedVR](https://github.com/ByteDance-Seed/SeedVR), [HF 7B](https://huggingface.co/ByteDance-Seed/SeedVR2-7B) |
| **Topaz API** (이미지 Enhance) | Developer $50/월 500 credits = **$0.10/credit → 140원**, 1 credit = ≤24MP 출력 1장(32MP 2, 64MP 4, 256MP 10). Scale $240/월 3,000 credits($0.08). 영상 API 단가는 페이지에 없음(**미확인**) | API 약관 | — | [Topaz API](https://www.topazlabs.com/api) |
| **Magnific / Freepik API** (Creative upscaler) | 출력 픽셀 면적 기준, **EUR**: 2x 640→1280 €0.10, 4x 640→2560 €0.20, 8x €0.50, 1080p→4K(2x) €0.20, 720p→4x €0.40. 키는 영업 문의 | API 약관 | — | [Magnific docs](https://docs.magnific.com/api-reference/image-upscaler-creative/image-upscaler) |
| Recraft Crisp / Creative upscale | $0.004 → 6원 / $0.25 → 350원 | API | — | Recraft pricing |
| Runway magnific_precision_upscaler_v2 (2차) | 25 credits = $0.25/장(4,096px 초과 150) | Runway | — | Runway Dev pricing |
| FLUX Video Upscale (Precise/Creative) | "per megapixel-second" — 셀 값 동적 렌더 **미확인** | BFL | — | BFL docs pricing |

### 1.6 색 보정

| 도구 | 가격 | API | 비고 | 출처 |
| --- | --- | --- | --- | --- |
| **Colourlab Ai 4** | **$49/월, $399/년, $799 영구**(Filmlab Ai 제외) | 페이지에 API 없음("Claude & MCP" 메뉴만 존재, 내용 미확인) | Resolve 플러그인 중심 | [colourlab.ai/pricing](https://colourlab.ai/pricing) |
| **Dehancer** | Studio **$49/월(연 $588)**, Production $184/월(연 $2,208). Lifetime 탭은 값 미표시 | 없음 | 필름 에뮬레이션(Resolve·Premiere·FCP 등) | [dehancer.com/pricing](https://www.dehancer.com/pricing) |
| fylm.ai | 공식 페이지 **403**. (2차) Pro $15/월(NeuralToneAI 포함), Lite $5.75~7/월 | 없음(2차) | 브라우저 기반 LUT 제작 | [fylm.ai/pricing](https://fylm.ai/pricing) (미판독) |
| 자체 ffmpeg LUT 파이프라인 | 0원(GPU·CPU 시간만) | 자체 | 승인한 그레이드를 .cube로 고정 → "고정 층 — 아이덴티티(그레이드 LUT)"에 그대로 맞음 | — |

## 2. 컷 유형별 라우팅 제안

원칙: **품질 1순위 모델은 "납품 컷"에만, 비용 대안은 탐색·시안·대량 변형에.** 원화는 1장/1초 단가 기준.

| 컷 유형 | 품질 1순위 | 비용 대안 | 메모 |
| --- | --- | --- | --- |
| **제품 단독**(병·패키지, 2K) | Seedream 5.0 Pro >1.5K **$0.09(126원)** → 마크·텍스트 결함은 Nano Banana Pro 1K·2K $0.134(188원)로 로컬 수정(기존 "Seedream photo + NB Pro mark fix" 흐름) | Nano Banana 2.1 1K $0.0336(47원) 또는 Seedream 5.0 Lite $0.035(49원); 대량 탐색은 FLUX 3 Klein $0.009(13원) | 한 컷 확정까지 보통 8~12장 → 1안 ≈ 1,300~1,900원, 2안 ≈ 400~600원 |
| **모델 착장**(동의한 얼굴 + 제품) | Nano Banana Pro(멀티 레퍼런스·얼굴 유지) $0.134 / Seedream 5.0 Pro + 레퍼런스(2장째 $0.003) | Nano Banana 2.1 $0.0336; Vertex Virtual Try-On $0.06(옷 1장 + 사람 1장, 정해진 포맷일 때) | 얼굴 검증·제공사 검수는 그대로 적용(약관 §5.3) |
| **디테일 클로즈업**(마크·원단) | Nano Banana Pro **4K $0.24(336원)** 또는 Seedream 5.0 Pro >1.5K $0.09 + SeedVR2 로컬 업스케일 | Nano Banana 2.1 2K $0.0504 + SeedVR2 로컬 | 박스 안만 고치는 "Local fix method"는 Qwen-Image-Edit-2511 로컬(0원)로 먼저, 실패 시 NB Pro |
| **텍스트 포함**(카피·라벨) | Ideogram 4.5 high $0.10(140원)·Precise Edit $0.22; GPT Image 2 high $0.211 | Ideogram 4.5 medium $0.06(84원); Qwen-Image 로컬(텍스트 렌더링 강점, 0원) | 2.5 flare/sunburst는 이미지당 가격 미확인이라 계산기로 먼저 견적 |
| **영상 5~15초** | Seedance 2.5 720p **$0.231/s(323원/s)**; 1080p 납품은 $0.569/s(797원/s) 또는 720p + SeedVR2 로컬 업스케일 | Seedance 2.0 Fast 720p $0.12/s(168원/s), Wan 2.6 720p $0.10/s(140원/s), Veo 3.1 Fast 720p $0.10/s(오디오 포함), Gemini Omni 1.1 Flash ≈$0.10/s(≤10초) | 10초 720p: 1안 3,234원 / 2안 1,400~1,680원. Kling 4.0은 공식가 확인 뒤 편입 |
| **사운드 포함 영상** | Seedance 2.5(오디오 상시) 또는 Veo 3.1 오디오 720p·1080p $0.40/s(560원/s) | Veo 3.1 Fast 오디오 $0.10/s, Gemini Omni 1.1 Flash $0.10/s, LTX-2.5 로컬(0원, <$10M) | 효과음만 따로 필요하면 ElevenLabs SFX $0.12/분 |
| **부분 수정**(이미지) | Nano Banana Pro 편집 $0.134 / Seedream 5.0 Pro 편집 $0.045~0.09 | Qwen-Image-Edit-2511 로컬 0원, Ideogram 4.5 Precise Edit low $0.03 | 마스크 정확도는 모두 "프롬프트 기반"이라 0 changed pixels 검증은 우리 쪽에서 |
| **부분 수정**(영상) | Runway Aleph 2 $0.28/s(392원/s, 최소 $0.56) | Kling 4.0 영상 입력(2차 $0.094/s·$0.141/s) — 공식가 미확인; Seedance 2.0 video-edit ID(2차) | Morphic Seedance `edit_video`를 이미 쓰고 있으니 실제 과금 기록과 대조 |

## 3. 로컬 GPU(RTX PRO 6000 96GB)로 비용을 줄일 후보

**가정**(표 안 숫자는 이 가정에서 나온 추정이다): 카드 전력 600W, 전기요금 180원/kWh → **108원/시간(1.8원/분)**. 카드 구매가 1,300만원을 3년·가동률 30%로 감가하면 **≈1,650원/시간(27.5원/분)**. "전기만"과 "감가 포함" 두 값을 적는다. 처리 시간은 README의 타 GPU 수치 또는 보수적 가정이며 **사내 실측으로 교체해야 한다**.

| 작업 | 로컬 모델(라이선스) | 추정 처리 시간(가정) | 로컬 원가(전기만 / 감가 포함) | API 대안 단가 | 건당 절감 | 품질 위험 |
| --- | --- | --- | --- | --- | --- | --- |
| 이미지 업스케일 2K→4K | SeedVR2 7B (Apache-2.0) | 0.5~1분 | 1~2원 / 15~30원 | Topaz 140원, Magnific €0.20(≈300원), Recraft Creative 350원 | **110~330원** | 질감 과생성·마크 변형 → 박스 검수 |
| 영상 업스케일 720p→1080p 10초 | SeedVR2 7B | 3~6분 | 5~11원 / 85~165원 | Seedance 1080p 직접 생성 차액(797−323)×10 = **4,740원**; Magnific video(2차) $2.1~ | **4,500원+** | 시간적 깜빡임, 피부 디테일 과보정; BT.601/709 태그 주의(사내 기록) |
| 이미지 부분 수정(박스) | Qwen-Image-Edit-2511 (Apache-2.0) | 0.3~1분 | 1~2원 / 8~30원 | NB Pro 188원, Seedream Pro 63~126원, Ideogram Precise Edit 42~308원 | **60~300원** | 박스 밖 픽셀 변화·텍스트 왜곡 → 0 changed pixels 검증 유지 |
| BGM 1곡(30~120초) | ACE-Step 1.5 XL (MIT) | 0.2~0.5분(3090에서 <10초) | <1원 / 6~14원 | ElevenLabs $0.15/분(210원/분), Lyria 3 Pro 112원/곡 | **100~400원** | 보컬 발음·장르 편차; 저작권 클리어런스 문서가 없음(ElevenLabs는 라이선스 데이터 학습 명시) |
| V2A(효과음·앰비언스) | 상업 가능 오픈 모델 **없음**(§1.4) | — | — | Seedance 내장(0 추가), ElevenLabs SFX 168원/분 | — | 로컬 대안을 두지 않는다 |
| 색 보정(LUT 적용) | ffmpeg `lut3d` (자체) | 10초 영상 0.1분 | <1원 / 3원 | Colourlab $49/월(사람 작업) | 구독비 | 자동 매칭 품질은 사람 그레이드가 기준; LUT는 승인 뒤 고정 |
| 배경 제거 | (사내 ComfyUI 노드; 모델별 라이선스 확인 필요) | 0.1분 | <1원 / 3원 | Recraft $0.01(14원), Vertex 도구 | 10원대 | 머리카락·유리 경계. 플랫 마크는 remove_bg 손상 이력 → 루미넌스 키 유지 |
| 영상 생성(로컬) | LTX-2.5 (<$10M), Wan 2.2 (Apache-2.0) | 5초 720p 2~8분(가정) | 4~15원 / 55~220원 | Seedance 2.5 720p 5초 1,618원 | **1,400원+** | 모션·프롬프트 추종이 Seedance 2.5보다 낮음; 시안·레이아웃 탐색용 |

판단: **업스케일·부분 수정·BGM·LUT는 로컬로 옮겨도 품질 손실이 검수로 잡히는 범위**다. 생성 자체(이미지·영상)는 Seedream·Nano Banana·Seedance가 여전히 앞서므로 로컬은 탐색·시안까지만.

## 4. 라이선스·약관 위험 목록 (브랜드 상업 납품 관점)

| # | 위험 | 근거 | 대응 |
| --- | --- | --- | --- |
| 1 | **Tencent Hunyuan 계열은 한국에서 라이선스 자체가 적용되지 않는다**(HunyuanVideo 1.5, HunyuanImage 3.0, HunyuanVideo-Foley). Territory 밖에서는 "Output or results … outside the Territory. Any such use … is unlicensed" | 각 LICENSE 1행·정의 l.·§4 | 세 모델 모두 파이프라인·스킬 문서에서 제외 |
| 2 | **비상업 가중치**: MMAudio(CC-BY-NC 4.0), ThinkSound("Commercial use is NOT permitted"), YuE2(CC BY-NC 4.0 + 추가 조건), Ideogram 4 오픈 가중치(non-commercial), FLUX.2 [dev]·[klein] 9B(flux-non-commercial-license) | GitHub README/LICENSE, HF 태그 | 상업 작업에 쓰지 않는다. music-creator의 YuE2는 내부 데모 전용으로 표기 |
| 3 | **매출 문턱형 라이선스**: LTX-2.x(연매출 ≥$10M 유료), FLUX 3 Image Klein("Kommunity License" <$5M, 원문 미확인), Stability Community(<$1M, API는 별도) | LICENSE-2_x, BFL 블로그, stability.ai/license | YAGI는 현재 문턱 아래. 단 "고객 브랜드가 자체 실행"하는 제품 구조로 가면 고객 매출 기준이 되므로, 브랜드 엔진에서 **고객이 직접 가중치를 돌리는 구조는 피한다** |
| 4 | **학습 사용**: Gemini API·Omni·Lyria는 무료 티어 "Yes", 유료 "No". BytePlus·Kling·Runway·Recraft·Ideogram은 학습 사용 조항을 공식 페이지에서 못 읽음 | Gemini pricing 표 | Google은 반드시 유료 티어. 나머지는 약관 원문 확인 뒤 브랜드 계약서에 "입력 자산 학습 미사용" 조항 가능 여부 기재 |
| 5 | **출력물 소유권**: Ideogram은 ToS에서 사용자에게 양도(2024-08-14판). Stability는 "you own outputs". Wan 2.2는 "claim no rights". 나머지(BytePlus, Kling, Google, OpenAI, ElevenLabs)는 이번에 원문 미확인 | 각 ToS | §claims_to_verify |
| 6 | **음악 상업 범위**: ElevenLabs 셀프서브는 film/TV/Studio Games 제외, 광고·브랜디드 콘텐츠 허용. Free는 개인용 | elevenlabs.io/music | 브랜드 TVC·OTT 납품이면 Enterprise 필요 → 견적에 반영 |
| 7 | **서비스 종료 위험**: Sora 2 API 종료(2026-09-24), MiniMax Music 신규 차단(2026-08-20), Seedance 1.5 Pro 퇴역(2026-11-11). 모델 ID가 날짜 스냅샷이라 주기적 교체 필요 | 각 공식 페이지 | 엔진 어댑터에 모델 ID·퇴역일을 데이터로 두고 분기별 점검 |
| 8 | **유명인·상표**: 모든 ToS가 퍼블리시티·상표 침해를 금지. TWINGS 약관 §5.3(본인 얼굴만·제공사 검수)과 같은 방향 | Ideogram ToS 6.2(N)(P) | 브랜드 자산(로고)은 브랜드가 권리자이므로 문제없음. 모델(사람)은 동의서 유지 |
| 9 | **지역**: Gemini API·OpenAI는 한국 명시 지원. BytePlus ModelArk 국제 리전과 Kling 글로벌은 공식 지역 페이지를 못 읽음. (2차) Seedance는 미국 불가 | regions 페이지 | 미국 고객 납품 시 Seedance 대체 경로(Veo·Runway) 준비 |
| 10 | **가격 변동·프로모션**: Kling 4.0 Runway 프로모(2026-11-30까지), Vertex Gemini 소개가(2026-12-31까지), FLUX 3 런칭 할인 종료 | 각 페이지 | 견적서에 "확인일" 표기 |

## 5. 추천 조합

### 1안 — 가장 완성도 높은 조합 (2026-11 기준)

| 단계 | 선택 | 단가 |
| --- | --- | --- |
| 제품·장면 이미지 | Seedream 5.0 Pro(>1.5K) | $0.09 → 126원 |
| 마크·텍스트·얼굴 유지 수정 | Nano Banana Pro(1K·2K) | $0.134 → 188원 |
| 카피·라벨 텍스트 | Ideogram 4.5 high / Precise Edit | $0.10~0.22 → 140~308원 |
| 영상(오디오 포함) | Seedance 2.5 720p → SeedVR2 로컬 1080p | $0.231/s → 323원/s (+로컬 수십 원) |
| 영상 부분 수정 | Runway Aleph 2 | $0.28/s → 392원/s |
| 효과음·음악 | Seedance 내장 + ElevenLabs SFX/Music(Starter+) | $0.12~0.15/분 |
| 업스케일·부분 수정·LUT | SeedVR2·Qwen-Image-Edit-2511·ffmpeg(로컬) | ≈0원 |

컷 하나(이미지 2K 확정본 1장 + 10초 720p→1080p 영상)의 엔진 원가 ≈ **126 + 188 + 3,234 ≈ 3,550원**(탐색 샷 제외).

### 2안 — 비용 효율 조합

| 단계 | 선택 | 단가 |
| --- | --- | --- |
| 이미지 탐색·변형 | FLUX 3 Image Klein → Nano Banana 2.1(1K) | $0.009 → 13원 / $0.0336 → 47원 |
| 확정본만 | Seedream 5.0 Lite 또는 Nano Banana 2.1 2K | $0.035~0.0504 → 49~71원 |
| 텍스트 | Qwen-Image 로컬 → 실패 시 Ideogram 4.5 medium | 0원 / 84원 |
| 영상 | Seedance 2.0 Fast 720p 또는 Wan 2.6 720p; ≤10초 오디오 포함은 Gemini Omni 1.1 Flash·Veo 3.1 Fast | $0.10~0.12/s → 140~168원/s |
| 음악 | ACE-Step 1.5 로컬(MIT) → 납품곡만 Lyria 3 Pro | 0원 / 112원 |
| 업스케일·수정·LUT | 로컬 | ≈0원 |

같은 컷의 엔진 원가 ≈ **47 + 1,400~1,680 ≈ 1,450~1,730원**(1안의 40~49%).

## TWINGS 제안

1. **엔진 라우팅 표를 데이터로 승격한다.** `lib/renders`·엔진 어댑터(`kling-omni`, `nano-banana-2.1`)에 모델 ID, 단가(USD·확인일), 퇴역일, 라이선스 플래그(상업 가능·한국 가능·학습 사용)를 두고 가격 규칙(이미지 8~12%·영상 5% 원가 비율)이 이 표를 읽게 한다. Seedance 2.5 720p 5초(1,618원)는 24,900원 템플릿의 5% 상한(1,245원)을 넘기므로 **2.5는 자동 가격이 32,400원 이상으로 나오는 템플릿에만** 배정하거나, 2.0 Fast·Wan 2.6를 기본으로 둔다.
2. **브랜드 엔진의 "고정 층 — 제작 원칙"에 이 문서의 §2 라우팅과 §4 제외 목록을 넣는다.** Hunyuan 계열·비상업 가중치는 스킬 문서(`Video-Creator/.agents/skills`)에서도 명시적으로 뺀다.
3. **로컬 파이프라인은 업스케일·부분 수정·BGM·LUT 네 가지로 한정**하고, SeedVR2·Qwen-Image-Edit·ACE-Step 1.5의 RTX PRO 6000 실측(처리 시간·VRAM·실패율)을 gpu-arbiter 로그로 모아 §3의 가정값을 교체한다.
4. **Google은 유료 티어만, ElevenLabs는 Starter+ 이상 계정만** 운영 키로 등록한다(무료 티어는 학습 사용·개인용).
5. **Kling 4.0은 공식 단가를 콘솔에서 확인한 뒤** 어댑터 허용 목록(`MAKER_ENGINE_IDS`)에 넣는다. 지금은 리셀러 값뿐이다.
6. 음악은 **ACE-Step 1.5(MIT) 로컬 + Lyria 3 Pro** 조합으로 가고, YuE2는 내부 데모 전용으로 표기한다. MiniMax Music은 목록에서 뺀다.

## 대표 결정 필요

- **영상 기본 엔진**: Seedance 2.5(품질, 오디오 상시, 5초 1,618원)와 2.0 Fast/Wan 2.6(5초 600~840원) 중 템플릿 기본값. 가격 규칙(5%)을 지키려면 2.5 템플릿은 32,400원 이상이어야 한다.
- **1080p 납품 방식**: Seedance 1080p 직접 생성(797원/s) vs 720p + SeedVR2 로컬(323원/s + 로컬). 품질 차이를 시안으로 보고 정한다.
- **ElevenLabs 플랜 등급**: 셀프서브(광고·브랜디드 OK, film/TV/게임 제외) vs Enterprise(전부). 브랜드 고객 범위에 TVC·OTT가 있는지에 달렸다.
- **고객 브랜드가 직접 실행하는 구조 허용 여부**: LTX-2.5(≥$10M 유료)·FLUX Klein(<$5M) 같은 매출 문턱 라이선스 때문에, 가중치를 고객 환경에서 돌리는 제품은 라이선스 비용이 고객 매출에 따라 달라진다.
- **미국 고객 대응**: (2차) Seedance 미국 불가 보도가 맞다면 Veo 3.1·Runway를 미국 전용 경로로 둘지.
- **로컬 GPU 감가 산정 기준**(구매가·가동률)과 전기요금 단가 — §3 추정값을 확정하기 위해 필요.

## 출처 (확인일 2026-11-03)

- Gemini API 요금: https://aistudio.google.com/docs/pricing (ai.google.dev/gemini-api/docs/pricing에서 리다이렉트) · 지역: https://aistudio.google.com/docs/available-regions
- Vertex AI 생성형 요금(Veo·Lyria·Imagen·Nano Banana): https://cloud.google.com/vertex-ai/generative-ai/pricing
- OpenAI 요금: https://developers.openai.com/api/docs/pricing · 이미지 가이드: https://developers.openai.com/api/docs/guides/image-generation · Sora 2 Pro: https://developers.openai.com/api/docs/models/sora-2-pro · 퇴역: https://developers.openai.com/api/docs/deprecations · 지원 국가: https://developers.openai.com/api/docs/supported-countries
- BytePlus ModelArk 요금(Seedream·Seedance): https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing · (2차) Together Seedance 2.5: https://docs.together.ai/docs/seedance2.5-quickstart
- Runway Dev 요금(자사 + 리셀 모델): https://docs.dev.runwayml.com/guides/pricing/
- Kling 요금(판독 실패): https://kling.ai/document-api/pricing
- BFL: https://bfl.ai/pricing · https://docs.bfl.ai/quick_start/pricing · https://bfl.ai/blog/flux-3-image-klein · https://docs.bfl.ai/flux_3/flux3_image_klein
- Ideogram: https://ideogram.ai/models/4.5/ · https://ideogram.ai/legal/tos
- Recraft: https://www.recraft.ai/docs/api-reference/pricing.md
- ElevenLabs: https://elevenlabs.io/pricing/api · https://elevenlabs.io/music
- MiniMax: https://platform.minimax.io/docs/pricing/overview
- Stability: https://docs.stability.ai/pricing · https://stability.ai/license
- Topaz: https://www.topazlabs.com/api · Magnific: https://docs.magnific.com/api-reference/image-upscaler-creative/image-upscaler
- Alibaba Model Studio Wan 2.6: https://www.alibabacloud.com/help/en/model-studio/wan2-6-i2v · HF Wan-AI: https://huggingface.co/Wan-AI
- Colourlab: https://colourlab.ai/pricing · Dehancer: https://www.dehancer.com/pricing · fylm.ai(403): https://fylm.ai/pricing
- 오픈 모델 라이선스: ACE-Step 1.5 https://github.com/ace-step/ACE-Step-1.5 · SeedVR https://github.com/ByteDance-Seed/SeedVR · MMAudio https://github.com/hkchengrex/MMAudio · ThinkSound https://github.com/FunAudioLLM/ThinkSound · HunyuanVideo-Foley https://github.com/Tencent-Hunyuan/HunyuanVideo-Foley · HunyuanVideo-1.5 https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5 · HunyuanImage-3.0 https://github.com/Tencent-Hunyuan/HunyuanImage-3.0 · Qwen-Image https://github.com/QwenLM/Qwen-Image · YuE2 https://github.com/multimodal-art-projection/YuE · LTX-2 https://github.com/Lightricks/LTX-2 (LICENSE-2_x) · Wan2.2 https://github.com/Wan-Video/Wan2.2 · HF license 태그: huggingface.co/api/models/{id}
