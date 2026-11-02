# 엔진·렌더 파이프라인·단가 구조 조사 — 브랜드 엔진이 재사용할 것과 새로 만들 것

- 조사일 2026-11-03 · 대상 `D:\dev\twings` main `119f4ea2` (읽기 전용, 코드 수정·빌드·유료 호출 없음)
- 보조 확인: Vercel 프로젝트 `yagi-prompts`의 환경변수 **이름 목록**(값은 읽지 않음, Vercel MCP `filter_project_envs`, 2026-11-03)
- 가격·한도 숫자는 전부 **저장소의 원가표 코드**가 원본이며, 그 코드가 인용한 공식 페이지 URL과 코드가 적어 둔 확인일을 함께 적었다. 공식 페이지를 2026-11-03에 다시 열어 보지는 않았으므로 §9 검증 목록에 올린다.

## 0. 결론 먼저

1. **엔진 어댑터·큐·저장·알림·원가 기록은 그대로 재사용할 수 있다.** `lib/renders/engines.ts`(이미지 동기 / 영상 비동기, 실패 어휘 하나), `lib/renders/service.ts`(lease·재시도·yield·알림), `lib/recipes/*`(단계·슬롯·참조 순서), `lib/twings/*`(원가·크레딧). 새 엔진은 "어댑터 1개 + 레지스트리 1행 + `toFailure` 분기 1개"로 붙는 구조가 이미 있다.
2. **브랜드 엔진에 가장 먼저 걸리는 것은 "얼굴이 반드시 있어야 한다"는 소비자 전제다.** `parseRecipe`는 `selfie` 슬롯이 없거나 결과가 셀카를 읽지 않으면 거절하고(`selfie_missing`·`no_identity`), `createAuthorizedRender`는 사진이 없으면 `bad_photo`다. 브랜드 제품컷(얼굴 없음)은 지금 파이프라인으로 **만들 수 없다**. 슬롯 모델을 `person | product | scene`로 넓히는 것이 첫 작업이다.
3. **BRAND-ENGINE §4의 10단계 중 지금 코드로 되는 것은 4(생성)·7(영상)뿐이고, 5(규칙 검사)는 얼굴 동의·제공사 검수만 있다.** 지시서·모델 라우팅·마스크 부분 수정·색 보정·사운드·업스케일·채널별 내보내기·메모리는 코드가 없다. 로컬 GPU(ComfyUI·SeedVR2·8188)를 부르는 코드 경로는 **0건**이고, 워크스테이션을 쓰는 것은 Ollama(gpu-arbiter 11434)를 부르는 **pull 워커 2종**(캠페인 위험 판독, 팔로워 캡처 판독)뿐이다. 이 pull 워커 패턴(claim/heartbeat/complete + 비밀키 + lease)이 GPU 마감 워커의 틀이 된다.
4. **크레딧 단가는 바뀌었다.** 이 조사 브리프의 "1크레딧≈129원"은 10-28 설계 값이고, 2026-11-02 대표 결정(§19.2)과 코드(`lib/twings/template-price.ts`)는 **1크레딧 = 부가세·스토어 수수료를 뺀 순수입 10원**, 마진은 플랜이 아니라 템플릿(이미지 ×1.12, 영상 6%)에 있다. B2B 플랜은 이 크레딧 정의(앱스토어 15% 전제)와 PG·부가세 가정을 **그대로 쓰면 안 되고**, 제공사 원가 함수(`quoteVideo`·`estimateImageUsd`)와 실측 원가 기록(`render_jobs.cost_usd`·`cost_source`)만 공유해야 한다.
5. **키 현황(이름만)**: Vercel에 `KLING_API_KEY`는 없다. `GEMINI_API_KEY`는 **있다**(Production·Preview, AGENTS.md §6의 "없다"는 낡은 서술) — 다만 잔액·작동은 미확인. ModelArk 세 키(`ARK_API_KEY`·`ARK_ACCESS_KEY`·`ARK_SECRET_KEY`)와 `OPENAI_API_KEY`는 Production에만 있다(Preview 없음).

## 1. 엔진 어댑터 인터페이스와 등록 방식

### 1.1 호출 계약 (`lib/renders/engines.ts`)

| 항목 | 이미지 (동기) | 영상 (비동기) |
| --- | --- | --- |
| 입력 | `ImageRenderInput { engine, prompt, aspect, photo, references?[] }` | `VideoRenderInput { engine, prompt, aspect, seconds, photo, assetId?, fixedReferenceUrls?, resolution?, references?[], callbackUrl? }` |
| 호출 | `runImageRender(input, deps) → EngineOutput { bytes, mime, provider, costUsd, costSource, completionTokens }` | `startVideoRender → StartedVideo { taskId, model, seconds, provider }` 뒤 `pollVideoRender → pending | succeeded(EngineOutput) | failed(RenderFailure)` |
| 참조 전달 | OpenAI·Gemini: bytes만. Seedream: bytes(data URL) 또는 https URL, `asset://` 거부 | ModelArk: `image_url`/`video_url` + role(`reference_image`/`reference_video`), 얼굴은 `asset://`만. Kling: data URL 또는 storage URL, `asset://` 거부, 4:3/3:4 거부 |
| 비용 | OpenAI: `usage` 토큰 × 공시 단가(실측). Gemini: 장당 공시가 + 입력 토큰(estimate). Seedream: `estimateImageUsd` | ModelArk: `usage.completion_tokens` × 토큰 단가(`provider_usage`), 없으면 픽셀 공식 추정. Kling: 완료 태스크 `billing[]` USD, 없으면 초당 공시가 |
| 실패 | `RenderFailure(code, message, retryable, step?)` — 코드 `no_engine_key · face_policy · moderated · engine_access · engine_error · network · bad_output · identity_required · identity_unavailable · asset_failed · edit_*` | 같은 어휘. `toFailure()`가 제공사별 에러 클래스를 이 어휘로 번역(새 어댑터 = 분기 1개) |
| 재시도 | `retryable`만 큐로 복귀, `MAX_ATTEMPTS = 3`(`service.ts`) | 폴링 실패는 `pending`으로 되돌려 다음 패스에 재시도 |
| 검수 훅 | 제공사 모더레이션 결과를 `face_policy`/`moderated`로 번역(`looksLikeFaceRefusal`) | ModelArk `InputImageSensitiveContentDetected.PrivacyInformation` → `face_policy`; Kling 정책 메시지 정규식 |
| 키 | `openAiConfigFromEnv`·`seedreamConfigFromEnv`·`geminiConfigFromEnv`·`arkConfigFromEnv`·`klingConfigFromEnv` — 키는 여기서만 읽고 `deps`로 주입 가능(테스트는 가짜 클라이언트) | 동일 |

등록은 레지스트리 두 표다: `lib/images/engines.ts`의 `IMAGE_ENGINE_IDS`/`IMAGE_ENGINES`(사이즈·품질·단가·참조 상한)와 `VIDEO_ENGINE_IDS`/`VIDEO_ENGINES`(provider만), 영상 모델 표는 `lib/ark/models.ts`(`ARK_MODELS`)와 `lib/kling/models.ts`(`KLING_MODELS`)를 `lib/video/models.ts`가 한 뷰(`videoModelForEngine`·`videoEngineSpec`·`quoteVideo`)로 묶는다. `render_jobs.provider` CHECK는 0017에서 만들고 0061에서 `kling`·`google`을 더했다(새 provider = 마이그레이션 1개).

### 1.2 등록된 엔진 전체 (2026-11-03, 코드 원가표 기준)

| 엔진 id | 제공사 / wire 모델 | 해상도·길이 | 단가(코드) | 참조 상한 | 메이커 허용 | 출처 파일 / 코드가 인용한 공식 페이지 |
| --- | --- | --- | --- | --- | --- | --- |
| `gpt-image-2.5-flare` | openai / `gpt-image-2.5-flare`, quality `xhigh` | 1024급(4:5 1024×1280, 9:16 864×1536 …) | $0.082/장 + $0.012/참조 (**실측 2026-10-24**) | 16 | O (기본 이미지 엔진) | `lib/images/engines.ts`; developers.openai.com 모델 페이지·이미지 가이드(코드 확인 2026-09-10, 2026-10-21) |
| `gpt-image-2.5-sunburst` | openai, quality `max` | 동일 | $0.60/장 + $0.03 (**미측정 추정**) | 16 | X | 동일 |
| `gpt-image-2` | openai, quality `high` | 동일 | $0.21/장(1024² high 공시 $0.211) + $0.03 | 16 | O | 동일 |
| `seedream-5.0-pro` | modelark / `dola-seedream-5-0-pro-260628` | 2K(4:5 1728×2160, 1:1 2048²) | $0.09/장(2.61MP 초과 구간), 첫 참조 무료·이후 $0.003 | 10 | O | `lib/images/engines.ts`; docs.byteplus.com/en/docs/modelark/model-pricing (코드 확인 2026-10-21) |
| `seedream-5.0-lite` | modelark / `seedream-5-0-260128` | 2K | $0.035/장, 참조 무료 | 10 | O | 동일 |
| `nano-banana-2.1` | google / `gemini-nano-banana-2.1` (Interactions API) | 2K(4:5 1856×2304) | $0.0504/장 + ≈$0.002/참조(입력 $1.5/M) | 14 (객체 10 + 인물 4) | X (스모크 대기) | `lib/images/engines.ts`, `lib/images/gemini.ts`; ai.google.dev 이미지 생성 가이드·Gemini API pricing (코드 확인 2026-10-24) |
| `nano-banana-pro` | google / `gemini-3-pro-image` | 2K | $0.134/장 | 14 | 스튜디오 전용 (`STUDIO_RECIPE_ENGINE_IDS`) | 동일; PLATFORM-2.0 §9.2 |
| `seedance-2.0` | modelark / `dreamina-seedance-2-0-260128` | 480p·720p·1080p·4k, 4~15초 | 토큰 과금 $7.00/M(720p)·$7.70/M(1080p); 초당 참고 $0.15(720p) | 12 | O (기본 영상 엔진) | `lib/ark/models.ts`·`lib/ark/pricing.ts`; docs.byteplus.com/en/docs/modelark/model-pricing (코드 확인 2026-10-09) |
| `seedance-2.5` | modelark / `dreamina-seedance-2-5-260628` | 480p·720p·1080p, 4~30초 | $10.70/M(720p)·$11.70/M(1080p); 초당 참고 $0.231(720p)·$0.569(1080p) | 50 | O | 동일 |
| `kling-omni` | kling / `kling-3.0-omni`(기본) 또는 `kling-4.0`(`KLING_VIDEO_MODEL`) | 3.0: 720p·1080p, 3~15초, 16:9·9:16·1:1 / 4.0: 3~30초, +21:9 | 3.0: $0.112/s(720p)·$0.14/s(1080p, 오디오 포함) / 4.0: $0.157·$0.235 | 3.0: 7 / 4.0: 10(합 15) | X (스모크 대기) | `lib/kling/models.ts`; kling.ai/dev/pricing, kling.ai/document-api (코드 확인 2026-10-24) |

- `ARK_MODELS`에는 `seedance-2.0-fast`($5.60/M)·`seedance-2.0-mini`($3.50/M)도 있으나 엔진 id가 없어 팔리지 않는다. Seedream `flash`($0.018)도 미배선.
- 토큰 공식(`quoteArkVideo`): `tokens = seconds × W × H × 24 / 1024`. 예: 720p 9:16 10초 = 216,000 tokens → $2.3112 → 1,400원/USD로 3,236원.
- 영상 기본 해상도 720p(`DEFAULT_CREATOR_RESOLUTION`), 1080p는 행에 `price_1080_*`가 있을 때만 판매(`lib/twings/resolution.ts`). 영상 길이 규칙: Seedance 2.0 15초 초과면 2.5로 이동(`arkModelForVideo`), 레시피 단계는 이동 없이 거절(`duration` 이슈).
- 기본 엔진: 이미지 `gpt-image-2.5-flare`, 영상 `seedance-2.0`(`defaultEngine`).

### 1.3 "프롬프트 에이전트"의 유일한 선례 — 프리미엄 편집 (`lib/premium-editing/*`)

구독 렌더의 "문장으로 고치기"는 OpenAI Responses API(`gpt-5.6-sol`, `PREMIUM_EDIT_MODEL`로 `gpt-5.6`만 대체 가능)에 **strict JSON schema**로 묻고, 답을 4개 scope(`wardrobe_color · prop_color · background_palette · lighting_mood`) × 유한한 값(색 14 + 팔레트 3 + 무드 3)으로만 받아 `applyEditPlan`이 프롬프트에 끼운다. 유료 해석은 1회(`prepare_token` lease 20분), 레시피 템플릿에는 제공하지 않는다. 브랜드의 "모델별 프롬프트 에이전트"는 이 모양(구조화 출력 + 허용값 enum + 1회 과금 lease)을 넓히면 된다.

## 2. 이미지·영상·편집 경로 — 큐잉·저장·검수·알림

### 2.1 흐름

| 단계 | 구현 | 비고 |
| --- | --- | --- |
| 입구 | `POST /api/renders`(maxDuration 300) → `createRenderJob`(결제 증빙 `paymentOrderId` 필수) → `createAuthorizedRender` → `render_jobs` 행 + 사진 `{job}/input.{ext}` 저장 → 201 → `after()`로 패스 실행 | 브랜드 셀프 스튜디오 `createBrandRenderJob`(계약 `brand_production_contracts`, 0033)·캠페인 `createCampaignRenderJob`·구독 `createSubscriptionRenderJob`·보상 `createRewardImageJob`·샌드박스 `createRecipeSandboxRender`가 같은 함수를 부른다 |
| 상태 | `held → queued → running → succeeded | failed` (`lib/renders/repo.ts`). `held`는 얼굴 검증 대기 | `claimRenderJobs`: `for update skip locked`, lease 20분, `attempts+1`, 하루 20건/인(`RENDER_JOBS_PER_DAY`) |
| 패스 호출 | ① enqueue 직후 `after()` ② ModelArk 콜백 `/api/renders/callback` ③ 소유자가 결과 페이지를 열 때 ④ cron `/api/renders/tick`(**Hobby라 하루 1회**, `vercel.json` `0 18 * * *`, limit 5) | 분 단위 cron 없음 → 모든 단계 멱등, 큰 세트는 `yield`(150초 예산) 후 자기 자신을 다시 호출(`continueInNewInvocation`) |
| 이미지 | 패스 안에서 동기 완료, 레시피면 단계별 `{job}/step-{id}.{ext}` 저장·`render_job_recipes.state`에 기록 → 재시도 시 이어서 | 캐러셀 결과는 `render_job_outputs`(position 0~9, 0072) |
| 영상 | `startVideoRender` → `provider_task_id` 기록 → 다음 패스 `pollVideoRender` → 완료 시 `finishing_at`(0055) → 다운로드 → `{job}/result.mp4` | ModelArk URL 24h, Kling 30일 — 즉시 복사 |
| 저장 | 렌더: Supabase 비공개 버킷 `renders`(로컬 `.storage/renders`), 서명 URL 분 단위(`RenderStore.url`). 공개 미디어(템플릿 포스터·영상)만 R2 `media.twings.app`(`withPublicMediaDirect`, R2 키 4개 있을 때) | 렌더 결과는 R2에 가지 않는다 |
| 비용 기록 | `render_jobs.cost_usd`, `cost_source`(`provider_usage`/`estimate`), `provider_completion_tokens`(0043/0046) | 정산·B2B 사용량의 1차 데이터 |
| 알림 | `RenderNotifier`: 이메일(Resend) 항상 + 웹 푸시(`push_subscriptions`) 병행, `notify_status`, 3회 한도, 결제 환불 대기면 skip | 채널 인터페이스에 kakao/whatsapp/sms 자리만 있음 |
| 결과 | 3일 공유 링크(`share_token`), 포스터 캡처(`poster_key`), 피드백(`lib/renders/feedback.ts`, 내용 미확인) | 샌드박스(메이커 테스트·스튜디오 검수) 렌더는 공유·메일·목록 없음 |

### 2.2 검수(얼굴·제공사)

- `needsIdentity(engine)` = provider가 modelark **이고 영상**일 때만 참(`lib/identity/service.ts`). 즉 Seedance 영상만 BytePlus 실인물 자산 라이브러리(`asset://`)를 거치고, Seedream·OpenAI·Gemini·Kling은 bytes를 받아 **각 제공사 모더레이션**이 검수한다.
- 자산 모드 `ARK_ASSET_MODE`: 기본 `virtual`(AIGC 그룹을 패스가 자동 생성, 40/50 슬롯 회전 `lib/identity/rotation.ts`), `liveness`(카메라 H5 본인 인증, `held` 상태 사용). `createAsset`에 `moderation.strategy`를 넘기는 호출은 없다(기본 `Default`) — "Skip"은 타입에만 존재하며 사용 0건. 우회 없음 확인.
- 사람 검수는 메이커 레시피 제출 시 스튜디오 검수 렌더 3장(`lib/recipes/review.ts`, 관리자 `platform.review`)뿐이고, 소비자 렌더에는 사람 검수 단계가 없다.
- 브랜드 제품 참조는 `fixedVideoReferenceUrls`(템플릿별 서버 소유 URL)로 얼굴 뒤에 붙는다 — 캠페인 제품 샷의 선례.

### 2.3 브랜드 엔진이 재사용할 것 / 소비자 전용인 것

| 재사용 | 소비자 전용(바꿔야 함) |
| --- | --- |
| 엔진 어댑터·실패 어휘·재시도 규칙 전체 | **`selfie` 슬롯 필수**: `parseRecipe`의 `selfie_missing`·`no_identity`·`user_slot`(사용자 입력은 selfie 하나) 규칙 |
| 큐·lease·yield·멱등 패스, `render_jobs` 열 구조, `render_job_recipes`/`outputs` | `createAuthorizedRender`의 `bad_photo`(사진 없으면 거절), `RENDER_JOBS_PER_DAY` 20/인, `MAX_PHOTO_BYTES` 8MB |
| `RenderStore`(비공개 버킷·서명 URL), R2 공개 미디어 경로 | `audience='brand'` 템플릿도 셀카 기반(`createBrandRenderJob`은 `selfieId` 필수) |
| 비용 기록(`cost_usd`·`cost_source`·완료 토큰) | 3일 공유 링크·포스터·"내 결과물" 목록(브랜드는 라이브러리·승인 상태가 필요) |
| 알림 채널 인터페이스(이메일+푸시) | 구독 사용량·보상 크레딧 연결(`creator_subscription_usage`, `reserveRewardImage`) |
| 레시피 러너(단계·inputs 순서 = 참조 순서, `{{name}}` 치환, 단계별 재개) | 단계 상한 10·입력 6·레이아웃(이미지→영상 1회, 또는 캐러셀) — 브랜드는 "확정 컷 N → 영상 N" 같은 분기 필요 |
| 스모크 스크립트(`ark:smoke`·`image:smoke`·`kling:smoke`·`gemini:smoke`) | 결제 증빙 게이트(`paymentOrderId`, `RENDER_PIPELINE_PUBLIC`) — 브랜드는 계약·크레딧 게이트로 대체 |

## 3. '마감' 단계를 엔진으로 넣으려면 — 필요한 추상화

### 3.1 지금 있는 것 / 없는 것 (grep 결과)

| 기능 | 코드 | 근거 |
| --- | --- | --- |
| 오디오 | 영상 엔진의 **내장 오디오만**(`generateAudio: true`, Kling `audio: 'native'`). 템플릿 미디어에 오디오 **업로드** 슬롯(`media.audio`, ≤20MB, `lib/prompts/media.ts`). 믹스·LUFS·드롭 싱크 코드 없음 | `lib/renders/engines.ts`, `lib/prompts/schemas.ts` |
| 색 보정·LUT·룩 저장 | 없음. 아이덴티티 스키마는 TWINGS 자체용 `lib/design/identity.ts`(COLOUR·TYPE·WORLD·MODEL_ROLES·HARDLINES)만 있고 브랜드별 테이블 없음 | `lib/design/identity.ts`, BRAND-ENGINE §3 |
| 업스케일(SeedVR2) | 코드 0건. 11-03 480p 10편 업스케일은 저장소 밖에서 손으로(ComfyUI API 스크립트, `docs/design/IDENTITY.md` 139행) | grep `seedvr|comfyui|8188` → 코드 매치 없음 |
| 마스크 부분 수정 | 코드 0건. OpenAI `images/edits`는 마스크 없이 참조만 보냄. 패치 레이어·지우개 설계는 PLATFORM-2.0 §21.5(750행 부근) 문서뿐 | `lib/images/openai.ts` |
| 모델별 프롬프트 에이전트 | 프리미엄 편집(§1.3)만. 레시피 프롬프트는 작성자가 엔진 문법 없이 `{{name}}`으로 쓰고 `engineStepPrompt`가 번호로 바꿈 | `lib/recipes/schema.ts` |
| 로컬 GPU 호출 | **없음**. 워크스테이션 연결은 Ollama(gpu-arbiter `127.0.0.1:11434`)를 쓰는 pull 워커 2종: `scripts/campaign-risk-worker.ts`(+`lib/campaigns/risk/*`, 라우트 `/api/campaign-risk-worker/{claim,heartbeat,complete,slack}`), `scripts/social-verify-worker.ts`(+`lib/influencers/*`, `/api/social-verify-worker/{claim,heartbeat,complete,evidence}`). 비밀키 `CAMPAIGN_RISK_WORKER_SECRET`·`SOCIAL_VERIFY_WORKER_SECRET`, 루프백 11434가 아니면 기동 거부(`lib/influencers/local-vision.ts`) | grep `11434|gpu-arbiter|ollama` |

### 3.2 제안 추상화

1. **레시피 단계 종류를 `image | video | finish`로 넓힌다.** `finish` 단계는 `op: 'upscale' | 'grade' | 'audio_mix' | 'inpaint' | 'reframe'`, 입력은 앞 단계 결과(이미지·영상)와 브랜드 룩/마스크 자산, 파라미터는 op별 zod. `parseRecipe`의 레이아웃 규칙(이미지→영상 1회)을 "DAG + 마지막 단계가 output"으로 바꾼다.
2. **실행자(executor) 두 종류.** `provider`(지금처럼 패스 안에서 호출, 동기/폴링)와 `worker`(워크스테이션 GPU). 러너는 `worker` 단계를 만나면 `{ kind: 'handed', provider: 'workstation' }`로 넘기고, 패스의 폴링 루프(`listRenderJobsAwaitingProvider`)가 `worker_tasks` 테이블 상태를 본다. `render_jobs.provider` CHECK에 `workstation` 추가(0061 방식).
3. **워커 프로토콜은 기존 pull 워커를 그대로 복제.** `claim`(lease + heartbeat), 입력은 `RenderStore.url(key, ttl)` 서명 URL로 내려받고, 결과는 서명 업로드 URL(`StorageDriver.signedUploadUrl` 선례)로 올린 뒤 `complete`에 키·바이트·소요 시간·GPU 초를 보고. 워커 쪽은 ComfyUI API(SeedVR2 워크플로)·ffmpeg(LUFS 측정·믹스·LUT 적용)을 호출. gpu-arbiter 시분할 우선순위(ComfyUI > Qwen > 기타)는 워커가 지키고 서버는 모른다.
4. **동기/비동기 기준**: 패스 예산 150초 안에 끝나는 제공사 이미지 편집(마스크 인페인트 포함)은 `provider` 동기. 업스케일·색 보정·사운드는 전부 `worker` 비동기. §19.4의 규칙(GPU 꺼짐·하루 상한 초과 → 대체 경로, 차액은 회사 부담)을 `finish` 단계의 `fallback` 필드로 명시한다.
5. **비용 기록 확장**: `StepRecord.usd`에 더해 `gpuSeconds`·`workerId`를 기록해 B2B 원가(전기·감가)를 나중에 붙일 수 있게 한다. 지금 `recordedUsd`는 USD 합산만 한다.
6. **룩 저장 = 메모리의 색 층**: `grade` 단계가 쓰는 LUT/측정값을 브랜드 테이블(`brand_looks`)에 저장하고 다음 레시피의 `creator` 슬롯처럼 참조한다. 자산 핸들 `ast_…`(`platform_format_assets`) 모델을 브랜드 자산에도 그대로 쓸 수 있다.

## 4. 크레딧·단가 계산 함수와 가정 — B2B가 재사용할 것과 분리할 것

### 4.1 함수 지도

| 함수 | 파일 | 하는 일 | 핵심 상수 |
| --- | --- | --- | --- |
| `quoteVideo` / `quoteArkVideo` / `estimateKlingUsd` | `lib/video/models.ts`, `lib/ark/pricing.ts`, `lib/kling/models.ts` | 영상 1태스크 제공사 USD(토큰 또는 초당) | 토큰 단가표, 해상도별 픽셀표 |
| `estimateImageUsd(engine, refs)` | `lib/images/engines.ts` | 이미지 1장 USD(소수 3자리 반올림) | `usdPerRender`·`usdPerReference`·`freeReferenceImages` |
| `COST_ASSUMPTIONS` | `lib/twings/cost-model.ts` | **1,400원/USD, VAT 10%, PG 3.3%(잠정), 목표 마진 5%**(템플릿 플로어) | `costFloor`·`imageCostFloor`: `price = cost / ((1−margin)/(1+VAT) − PG)` → 100원 올림, 이미지 최저 200원(`IMAGE_MIN_PRICE_KRW`) |
| `baseCredits` / `creditsToKrw` / `baseKrw` / `makeEarning` | `lib/twings/template-price.ts` | §19.2: **1크레딧 = 순수입 10원**(`CREDIT_NET_KRW`), 이미지 원가 ×1.12(`IMAGE_MARKUP` 1.10~1.15), 영상 마진 6%(`VIDEO_MARGIN` 5~7%); 원화 환산은 카드 순수입 비율 `NET_SHARE = 1/1.1 − 0.034`(계약 PG 3.4%) | `RAISE_MAX_KRW` 5,000, `RAISE_STEP_KRW` 100 |
| `templateCredits(card)` | `lib/twings/credits.ts` | 템플릿 1회 크레딧(세트는 장수 합산, 영상은 720p 기준) | — |
| `quoteRecipe(recipe, royaltyKrw)` | `lib/recipes/pricing.ts` | 단계별 USD 합 → 플로어 원화 + 인상분 | 메이커 가격 = 기본가 + R |
| `marginSplit` | `lib/creator-platform/economics.ts` | 이익 = 매출 − 세금 − 수수료 − 원가, 크리에이티브 80%·회사 20%(회사 계정 0%) | 정수 최소 단위, 손실은 0으로 |
| `CREATOR_PLANS` / `quoteSubscriptionVideo` | `lib/twings/subscription-plan.ts` | 구(舊) 구독 설계: 목표 마진 10% 고정, 1 unit = Seedance 2.5 10초 720p 9:16 원가의 1/100(≈$0.0231 ≈ 32원), 24,900원 → 604 units, 49,000원 → 1,200 units | "계약 조건이라 원가표가 바뀌어도 건드리지 않는다" |
| `reserveSubscriptionUsage` / `settleSubscriptionUsage` | `lib/creator-subscriptions/usage.ts` | 렌더 전 예약 → 완료/실패 정산(원장 `creator_subscription_usage`, 0042) | 조직 크레딧 원장의 복제 원형 |
| `brand_production_contracts/templates/reservations` | 0033, `lib/brands/production/service.ts` | 브랜드 계약별 기간·한도(`limit ≤ 100,000`)·예약 행 잠금(`reserveProduction`) | 이미 있는 조직 단위 쿼터 |

검산(코드 공식, 2026-11-03): Seedance 2.5 10초 720p 9:16 = $2.3112 → 3,236원 → 영상 6% → **345 크레딧**(§19.2 표와 일치), 웹 단건은 5% 하단 341 크레딧 → 3,900원. 15초 = 517 크레딧 / 플로어 5,900원. Nano Banana 2.1 5장 = $0.052×5 = 364원 → ×1.12 → **41 크레딧**. Kling 3.0 Omni 10초 720p = $1.12 → 1,568원 → 167 크레딧(참고 계산, 코드에 표는 없음).

### 4.2 B2B(월 390,000 · 690,000 · 990,000원) 플랜 관점

| 그대로 재사용 | 분리해야 할 이유 |
| --- | --- |
| 제공사 원가 함수(`quoteVideo`·`estimateImageUsd`), 환율 상수, `render_jobs.cost_usd`·`cost_source`·`provider_completion_tokens` | 환율 1,400원은 상수다 — 정산에는 "그날 환율"을 쓴다고 주석(`makeEarning`)이 말하지만 코드엔 없다 |
| 예약→정산 원장 패턴(`creator_subscription_usage`), 계약별 한도·기간·행 잠금(0033) | **크레딧 정의가 앱스토어 15% 전제**(순수입 10원). B2B는 세금계산서·부가세 별도·PG 0%라 같은 크레딧이면 과소/과대 청구가 된다 |
| 실패 시 미청구(`settle 'failed'`), 재시도 상한 | 마진 목표(템플릿 5~7%·12%)는 소비자 가격 결정이고, 플랜 가격은 대표 결정 항목. 회사 크리에이티브 80/20 배분은 B2B에 적용 안 함 |
| 템플릿 플로어 경고(관리자) | `IMAGE_MIN_PRICE_KRW` 200, 하루 20건/인, 3일 공유 링크 — 조직 단위로 바꿔야 함 |

제안: 조직 크레딧은 "제공사 원가 USD × 환율 × (1 + 플랜 마진)"이 아니라 **원가 단위(unit = 제공사 USD 0.01 같은 원가 기준)**로 적립·차감하고, 플랜 가격은 unit 묶음으로 판다. 그러면 원가표·엔진이 바뀌어도 기존 계약 차감이 흔들리지 않는다(`CREATOR_PLANS`가 지킨 원칙과 같다).

## 5. 엔진 호출 키·환경변수 (값 없음)

| 변수 | 쓰는 곳 | Vercel 상태(이름 기준, 2026-11-03) | docs/SETUP.md |
| --- | --- | --- | --- |
| `ARK_API_KEY`, `ARK_BASE_URL` | Seedance 영상·Seedream 이미지 | `ARK_API_KEY` **Production만** / BASE_URL 없음(기본값) | 표에 있음 |
| `ARK_ACCESS_KEY`, `ARK_SECRET_KEY`, `ARK_OPENAPI_HOST`, `ARK_PROJECT_NAME`, `ARK_QUOTA_GROUPS/ASSETS` | 실인물 자산 라이브러리(AK/SK 서명) | AK·SK **Production만**, 나머지 없음(기본값) | **표에 없음**(TEMPLATES-IA §8.2에 설명) |
| `ARK_ASSET_MODE`, `ARK_RELEASE_AFTER_USE` | virtual/liveness, 사용 후 삭제 | 없음 → 기본 `virtual`·on(`lib/flags.ts`) | 표에 없음 |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | GPT Image, 프리미엄 편집 | KEY **Production만** | 있음 |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, `GEMINI_BASE_URL` | Nano Banana | KEY **있음(Production·Preview)**; 모델·URL 없음 | 있음. AGENTS.md §6 "없다"는 낡음. 작동·잔액 미확인(메모리 11-01: 402) |
| `KLING_API_KEY`, `KLING_VIDEO_MODEL`, `KLING_VIDEO_MODEL_ID`, `KLING_BASE_URL` | Kling | **전부 없음** → `kling-omni` 작업은 `no_engine_key` | 있음 |
| `PREMIUM_EDIT_MODEL`, `PREMIUM_EDITING_ENABLED`, `PREMIUM_EDIT_REQUESTS_PER_PERIOD` | 프리미엄 편집 | 없음 | 없음 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `PUBLIC_MEDIA_BASE_URL` | 공개 미디어 직접 저장 | 전부 있음(Production·Preview) | 있음 |
| `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `WEB_PUSH_PUBLIC_KEY/PRIVATE_KEY/SUBJECT` | 패스·알림 | 있음 | 있음 |
| `RENDER_PIPELINE_PUBLIC`, `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` | 결제 게이트 | 있음(Production) | 있음 |
| `TWINGS_MAKER_SELF_PUBLISH`, `TWINGS_IMAGE_REWARDS`, `TWINGS_CREATOR_APPLICATIONS`, `IDENTITY_SELFIE_LIMIT`, `STORAGE_DRIVER` | 플래그 | 없음(기본값) | 일부 |
| 워커 전용(워크스테이션): `OLLAMA_URL`, `SOCIAL_VERIFY_*`, `CAMPAIGN_RISK_OLLAMA_MODEL/API_ORIGIN/WORKER_ID` | pull 워커 | 서버엔 `CAMPAIGN_RISK_WORKER_SECRET`만 있음, `SOCIAL_VERIFY_WORKER_SECRET` 없음 | qa 문서에만 |

주의: Preview 배포에는 ModelArk·OpenAI 키가 없어 프리뷰 URL에서 실제 렌더는 `no_engine_key`로 끝난다(의도된 것인지 대표 확인 필요).

## 6. 브랜드 '만들기' 10단계 (BRAND-ENGINE §4) — 지금 코드로 되는 것

| # | 단계 | 지금 | 근거 | 부족한 것 |
| --- | --- | --- | --- | --- |
| 1 | 한 줄 지시 | X | 입력은 템플릿의 `prompt_text`/`recipe`뿐. 자유 문장을 프롬프트로 바꾸는 것은 프리미엄 편집(enum 4 scope)뿐 | 지시 → 지시서 에이전트, 입력 저장 |
| 2 | 촬영 지시서(렌즈·빛·색 값) | X | 브랜드 아이덴티티 테이블 없음(`lib/design/identity.ts`는 TWINGS 자체) | `brand_identities`(core+glue), 지시서 스키마 |
| 3 | 모델 고르기(모델별 문장) | △ | 레지스트리·단계별 엔진·`engineStepPrompt` 번호 치환은 있음. 라우팅은 작성자 수동, 자동 라우팅 표 없음 | 컷 종류 → 엔진 라우팅 표, 모델별 프롬프트 에이전트 |
| 4 | 생성 | O | `runImageRender`·`startVideoRender`, 레시피 ≤10단계, 입력 ≤6, 제공사 5곳 | 얼굴 없는 레시피 허용(§2.3) |
| 5 | 절대 규칙 검사 | △ | 얼굴 동의·본인 셀카·제공사 모더레이션·`face_policy`는 있음. 마크 일치·팔레트 ΔE·금지어 검사 없음(텍스트 위험 판독 워커 `lib/campaigns/risk`는 캠페인 문구용) | 이미지 규칙 검사기(워커 또는 제공사 비전) |
| 6 | 부분 수정(마스크, 하드니스 50) | X | 마스크 입력 경로 없음. OpenAI edits는 참조만 | 마스크 자산·`inpaint` finish 단계·캔버스 UI |
| 7 | 영상으로(5초 클립) | O | Seedance 4초~, Kling 3초~; 이미지 결과 → 영상 단계 체인 있음 | "확정 컷 N개 → 클립 N개" 분기(지금은 영상 1단계) |
| 8a | 색 보정·룩 저장 | X | 코드 없음 | `grade` worker 단계, `brand_looks` |
| 8b | 사운드 마감(−14 LUFS) | X | 내장 오디오·업로드만 | `audio_mix` worker 단계(ffmpeg) |
| 8c | 4K 업스케일 | X | 코드 없음, 손작업 선례만 | `upscale` worker 단계(SeedVR2/ComfyUI), §19.4 폴백 |
| 9 | 채널별 비율 내보내기 | △ | 비율은 주문 시 1개 고정(`aspect`), 포스터·프레임 캡처 있음. 재크롭·다중 비율 출력 없음 | `reframe` 단계 또는 비율별 재렌더 정책 |
| 10 | 메모리(승인·수정 축적) | X | `render_jobs` 이력·`feedback.ts`(내용 미확인)만 | 조직·캠페인·개인 3층 메모리 테이블(§21) |

## 7. 테스트 — 엔진·단가·레시피 핵심 케이스 (파일명과 대표 케이스)

| 파일 | 지키는 것 |
| --- | --- |
| `tests/images/engines.test.ts` | OpenAI는 항상 최상위 품질, Nano Banana 2K 사이즈·단가, GPT Image 2.5 픽셀 창, Seedream 2K = $0.09, 참조 1장 포함 단가 |
| `tests/renders/engines-r2.test.ts` | `needsIdentity · identityPath` 매트릭스, Gemini/Kling 어댑터의 실패 번역, Kling 작업은 자산 은행을 거치지 않음, `face_policy`는 재시도 없음 |
| `tests/renders/service.test.ts`(21) | 큐·일일 상한·3일 링크·메일 1회·정책 거절 즉시 실패·일시 오류 3회 재시도·얼굴 검증 hold/release·virtual 모드 자동 그룹·회전·`finishing_at`·고아 복구 |
| `tests/recipes/pipeline.test.ts`(11) | 이미지→영상(얼굴은 자산), 캐러셀 N장 비용 합산, Seedream은 base64 직접, 단계별 재개, 10장 세트 패스 분할, 샌드박스 렌더 무알림 |
| `tests/recipes/schema.test.ts` | 거절 규칙 전체(`selfie_missing` 등), 참조 번호 순서, 메이커 가격 = 기본가 + 인상 |
| `tests/twings/template-price.test.ts`·`credits.test.ts` | 이미지 ×1.12·영상 6% → 10원 크레딧, 현행 3,900/5,900원 재현, 이미지 200원 하한, 80/20, 인상 0~5,000원 |
| `tests/twings/subscription-plan.test.ts` | 구 구독 10% 마진·604 units·토큰 정확 과금 |
| `tests/ark/client.test.ts`·`assets.test.ts`, `tests/kling/client.test.ts`, `tests/images/gemini.test.ts`·`clients.test.ts` | 제공사별 요청 본문·에러 코드 번역·키는 NEXT_PUBLIC 금지·요금 페이지 예시 재현 |
| `tests/premium-editing/video-cost.test.ts` | 완료 토큰 × 공식 단가 기록, 480p는 요금 미확정으로 null |

## 8. TWINGS 제안 (브랜드 엔진 구현 순서)

1. **슬롯·입력 모델부터 넓힌다**: `UserSlot`을 `person(동의 얼굴) | product | scene | look | mask`로, `no_identity` 규칙을 "person 슬롯이 있을 때만" 적용. `createAuthorizedRender`의 사진 필수를 "레시피가 요구하는 슬롯만" 검사로 바꾼다. 얼굴이 들어가는 순간 지금의 동의·검수 경로가 그대로 켜지게 유지한다(AGENTS §4).
2. **브랜드 아이덴티티·룩 테이블**(core+glue)을 `lib/design/identity.ts` 스키마로 만들고, 레시피의 `creator` 자산 핸들 방식으로 참조한다.
3. **`finish` 단계 + 워크스테이션 pull 워커**(§3.2): 첫 op는 `upscale`(SeedVR2)과 `audio_mix`(LUFS). 기존 pull 워커 코드를 복제하고 `render_jobs.provider`에 `workstation`을 더한다. `vercel.json` 일일 cron만으로는 워커 완료 반영이 늦으므로, 워커의 `complete`가 패스를 직접 호출하게 한다(`continueInNewInvocation` 선례).
4. **규칙 검사기**는 사람 검수를 대체하지 않는 "표시"로 시작(마크 유사도·팔레트 ΔE·금지어). 결과는 `render_job_recipes.state`에 단계 기록처럼 남긴다.
5. **조직 크레딧 원장**은 `creator_subscription_usage`의 예약→정산 패턴과 0033 계약 한도를 합쳐 만들고, 단위는 원가 기준 unit으로 둔다(§4.2). 플랜 금액·부가세 표기·세금계산서 경로는 별도 조사(`repo-billing-b2b`)에 넘긴다.
6. **운영 전제 정리**: `KLING_API_KEY` 등록과 스모크, `GEMINI_API_KEY` 잔액 확인 후 `MAKER_ENGINE_IDS` 갱신은 대표 결정 뒤에. §19.8의 "동시 10개" 막은 `claimRenderJobs`에 없다 — 브랜드 배치 생성 전에 넣어야 한다.
7. AGENTS.md §6의 키 서술(GEMINI 없음)과 docs/SETUP.md 표(AK/SK·ARK_ASSET_MODE·PREMIUM_EDIT_* 누락)를 고친다(문서 작업, 이 조사에서는 수정하지 않음).

## 9. 검증이 필요한 사실 (claims_to_verify)

| 주장 | 출처 | 상태 |
| --- | --- | --- |
| Seedance 2.5 720p $10.70/M tokens, 1080p $11.70/M; 2.0 $7.00/$7.70 | https://docs.byteplus.com/en/docs/modelark/model-pricing (코드 확인 2026-10-09) | 2026-11-03 재확인 안 함 |
| Seedream 5.0 Pro $0.045(≤2.61MP)/$0.09, 첫 참조 무료 후 $0.003; Lite $0.035 | 같은 페이지 (코드 확인 2026-10-21) | 재확인 안 함 |
| Kling 3.0 Omni 720p $0.112/s(오디오), 1080p $0.14/s; 4.0 $0.157/$0.235 | https://kling.ai/dev/pricing , https://kling.ai/document-api (코드 확인 2026-10-24) | 재확인 안 함. 4.0 모델 문자열 공개 여부 미확인 |
| Nano Banana 2.1 $0.0504/2K, 입력 $1.5/M; Pro $0.134 | https://ai.google.dev/gemini-api/docs/image-generation , Gemini API pricing (코드 확인 2026-10-24) | 재확인 안 함 |
| GPT Image 2.5 토큰 단가(입력 $8/M·출력 $30/M), gpt-image-2 high 1024² $0.211 | https://developers.openai.com (모델 페이지·이미지 가이드, 코드 확인 2026-10-21) | 재확인 안 함; Flare $0.082는 실측(2026-10-24 smoke), Sunburst $0.60은 미측정 |
| Seedance 2.5 동시 실행 10개·얼굴 자산 상주 50개 | PLATFORM-2.0 §19.8 "ByteDance 확인" | 1차 출처(계약·메일) 미확인 |
| 480p 단가 "720p의 약 45%" | PLATFORM-2.0 §19.4 | 추정값, 코드 원가표에 480p 토큰 단가 없음 → **미확인** |
| 프리미엄 편집 모델 `gpt-5.6-sol` 및 Responses API 구조화 출력 | https://developers.openai.com/api/docs/models/gpt-5.6-sol (코드 확인 2026-10-09) | 재확인 안 함 |

## 10. 대표 결정 필요

1. 브랜드 레시피에서 **얼굴 없는 생성**(제품·세트 컷)을 여는지 — 열면 동의 절차는 person 슬롯이 있을 때만 켜지는 구조가 된다.
2. 마감 단계의 **GPU 워커 운영 범위**: 사무실 GPU가 꺼져 있을 때의 폴백(720p 그대로 납품 vs 대기), 하루 상한, gpu-arbiter 우선순위에서 브랜드 작업의 자리.
3. **B2B 크레딧 단위**를 소비자 크레딧(순수입 10원)과 분리할지, 원가 unit으로 둘지. 플랜 금액 자체(390/690/990천원)는 대표 결정 항목.
4. `KLING_API_KEY` 등록과 스모크 실행 시점, `GEMINI_API_KEY` 잔액 충전 여부(결제 금지 메모리 있음), `MAKER_ENGINE_IDS`에 Kling·Nano Banana 추가 여부.
5. Preview 배포에 엔진 키를 두지 않는 현 상태를 유지할지(프리뷰에서 실제 렌더 검증 불가).
6. 음악 생성(CC BY-NC 가중치) 라이선스 해결 전까지 사운드 마감은 믹스·LUFS까지만 — BRAND-ENGINE §7-1과 동일.
7. 공개 페이지에 엔진 이름을 쓰지 않는 원칙(BRAND-ENGINE §6 P1)을 브랜드 워크스페이스 안(설정·리포트)에서도 지킬지.
