# TWINGS 정보 구조 재편 — 템플릿 사이트 (2026-09-05)

> 창업자 결정(2026-09-05): "우리는 프롬프트 사이트가 아니라 템플릿 사이트다." 아래 네 가지를 확정.
> 1. 카탈로그 1차 구분은 **VIDEO · IMAGE 두 탭**, 지금부터.
> 2. **콘테스트 폐지.** 유가 캠페인만 남긴다.
> 3. **프롬프트 노출 중단.** 프롬프트는 템플릿의 내부 레시피이며 화면에 나오지 않는다.
> 4. 앱은 **PWA 먼저**, 카메라·푸시가 필요해지면 Expo.

## 0. 본질

한 줄: **사진 한 장으로 검증된 템플릿의 주인공이 되고, 그 영상을 올려서 돈까지 버는 곳.**

- 원자 단위는 **템플릿**. 포스터, 예시 결과물, 가격, 엔진, 그리고 속에 든 프롬프트(비공개).
- 루프는 둘. **만들기**: 템플릿 → 내 얼굴 결과물 → 게시. **벌기**: 캠페인(지정 템플릿) → 만들기 → 게시 → 정산.
- 프롬프트·쿠키·콘테스트는 이전 제품(YAGI PROMPTS)의 어휘. 이번 재편에서 화면에서 사라진다. 데이터와 도메인 코드는 남긴다(레시피는 생성 파이프라인이 쓴다).

## 1. 객체 모델

| 객체 | 테이블 | 비고 |
| --- | --- | --- |
| 템플릿 | `prompt_items` + `medium`('video'\|'image') + `price_cents` + `runtime_seconds` (0015) | 공개 상태 = `published`. `prompt_text`는 서버 전용. |
| 캠페인 | `campaigns`, `campaign_applications` (0013/0014/0106) | `style_slug` → 템플릿 slug. |
| 생성물(v2) | `render_jobs`(예정) | 작업 큐 + 상태 API. 앱이 붙는 지점. |

가격은 `TWINGS_STYLES` 하드코딩에서 행으로 이동. `price_cents = 0`은 "아직 판매 안 함"(만들기 버튼 대신 "곧 열립니다").

## 2. 경로

### 공개(로케일 접두)
| 경로 | 내용 | 캐시 |
| --- | --- | --- |
| `/{l}` | 홈: 히어로(사진 한 장) + VIDEO 레일 + IMAGE 레일(있을 때) + 모집 중 캠페인 + FAQ | static + tag |
| `/{l}/video` | 영상 템플릿 카탈로그(용도 필터) | static + tag `prompts` |
| `/{l}/image` | 이미지 템플릿 카탈로그. 비어 있으면 준비 중 상태 | static + tag `prompts` |
| `/{l}/t/{slug}` | 템플릿 상세 = 만들기 화면. 결과물·가격·런타임·용도, 내 사진으로 만들기, 관련 템플릿, 이 템플릿의 캠페인 | static + tag (프롬프트 텍스트 없음 → 뷰어별 차이 없음) |
| `/{l}/campaigns`, `/{l}/campaigns/{slug}` | 그대로 | 그대로 |
| `/{l}/pricing` | 편당 가격 안내(템플릿별) | static |

### 앱(무접두, 로그인)
`/campaigns/{slug}/apply`, `/campaigns/mine`, `/account`, `/library`, `/billing/*` 그대로.

### 리다이렉트(308, `next.config` redirects — 미들웨어보다 먼저 평가)
| from | to |
| --- | --- |
| `/{l}/studio` | `/{l}/video` |
| `/{l}/prompts` | `/{l}/video` |
| `/{l}/prompts/{slug}` | `/{l}/t/{slug}` |
| `/{l}/contests`, `/{l}/contests/{slug}` | `/{l}/campaigns` |
| `/prompts/submit` | `/en/video` (로케일 미들웨어가 다시 돌린다) |
| `/contests/{slug}/submit` | `/en/campaigns` |

### 제거
공개 `studio`, `prompts`, `prompts/[slug]`, `contests`, `contests/[slug]`; 앱 `prompts/submit`, `contests/[slug]/submit`. `POST /api/prompts/copy/[id]` → 410 Gone(텍스트 반출 통로 폐쇄). `/api/prompts/media`는 유지(포스터·영상). 어드민 콘테스트 화면은 네비에서 빼고 경로만 남긴다(데이터 열람용).

## 3. 네비

`VIDEO · IMAGE · 캠페인 · 요금제` + 내 계정/로그인. 홈 히어로 CTA → `/video`.

## 4. 요금제

쿠키(프롬프트 열람권)는 노출 중단과 함께 화면에서 사라진다. 요금제 페이지는 **편당 결제, 구독 없음**과 템플릿별 가격표. `lib/cookies`·Stripe 팩 코드는 크레딧(소모형, 인앱결제 호환)으로 재사용할 수 있게 그대로 둔다.

## 5. 앱

- PWA: `app/manifest.ts`, 최소 서비스워커, `apple-mobile-web-app` 메타. 설치형 첫 단계.
- Expo 전 선행: 생성 작업 큐 + 상태 API(페이지 결합 금지), 도메인 로직 공유 패키지(`lib/campaigns/state.ts` 등은 이미 순수 TS), Apple/Google 로그인 프로바이더, 짧은 딥링크(`/t/{slug}`, `/campaigns/{slug}`), 소모형 크레딧 = IAP 호환.

## 6. 단계

- **P1 데이터** (완료, `ed38634`): 0015 마이그레이션(medium/price/runtime), 리포지토리·카탈로그·어드민 편집기 필드.
- **P2 공개 IA** (완료): `/video`·`/image`·`/t/[slug]`, 홈·요금제 재작성, 네비, `next.config` 리다이렉트, 프롬프트 노출 제거(copy 410, 계정 페이지 정리), 사이트맵·robots·메타, 사전. 테스트·스윕 재작성(스윕 415/415).
- **P3 어드민** (완료): 네비 라벨 '템플릿', 콘테스트 네비 제거(경로는 유지).
- **P4 PWA** (완료): `app/manifest.ts`, `public/sw.js`(네비게이션 network-first + 오프라인 페이지만), `apple-mobile-web-app` 메타, 미들웨어 매처 예외.
- **P5**: 배포·검증·메모리.

### 남은 정리(후속)
- 오디오 결과물이 붙은 프롬프트(`handheld-market-run` 픽스처)는 템플릿 페이지에 오디오 행을 그리지 않는다. 오디오 템플릿은 v1 범위 밖.
- `components/prompts/detail.tsx`의 잠금 패널·복사 버튼·SubmitStrip, `components/pricing/{cookie-table,plan-table}`, `lib/contests/*` 공개용 코드는 참조가 끊긴 채 남아 있다. 어드민 콘테스트 미리보기가 `components/contests/*`를 쓰므로 한 번에 지우지 않고 다음 정리 패스에서 걷어낸다.
- 어드민 '템플릿' 화면의 용어(프롬프트 → 템플릿)는 라벨만 바꿨다. 본문 카피는 후속.

## 7. 엔진과 비율 (창업자 결정 2026-09-06)

- 이미지 엔진은 **Seedream 5.0 Pro/Lite (ModelArk) + GPT Image 2 (OpenAI)**. GPT Image 2는 **항상 `quality: high`** ("우리는 고품질로 파는거니까") — 코드에 파라미터가 없다.
- 템플릿 행에 `engine`(null = 매체 기본: 영상 seedance-2.0, 이미지 gpt-image-2)과 `aspect_default`(null = 이미지 4:5, 영상 9:16)가 있다(0016). 어드민 편집기에서 고르고, 방문자는 만들기 화면의 비율 피커에서 바꾼다. **기본 4:5 = 인스타 피드.**
- 비율 → 픽셀 표는 `lib/images/engines.ts` 한 곳. Seedream Pro는 **2K 티어**(창업자 2026-09-06 "품질 더 올려줘"; 2.36MP 계단 위라 장당 $0.09), Lite도 2K, GPT Image 2는 16의 배수 1024급. 테스트가 각 엔진의 문서 제약(픽셀 범위·비율 범위·16px 격자·가격 계단)을 고정한다.
- 클라이언트: `lib/images/seedream.ts`(ModelArk `images/generations`, 같은 `ARK_API_KEY`), `lib/images/openai.ts`(`/images/generations` + `/images/edits` with `input_fidelity: high`, `OPENAI_API_KEY`). 스모크: `npm run image:smoke -- --engine <id> --ratio 4:5 [--photo p]`.
- 실측(2026-09-06): Seedream 5.0 Pro 4:5 1344×1680(1.5K, 당시) 26초 · GPT Image 2 4:5 1024×1280 high 92초, 토큰 기준 $0.18.
- **키 권한 함정**: ModelArk API 키가 'Customize' 범위면 활성화된 모델도 `403 AccessDenied`. 콘솔 API keys › edit permission에서 모델을 체크해야 한다(2026-09-06 Seedream 5.0 Pro/Lite 추가). `ModelNotOpen`(404)은 미활성화, `AccessDenied`(403)는 키 범위.
- 얼굴 정책: ModelArk 이미지 생성도 실제 얼굴 참조를 거부 → 실인물 자산 라이브러리(`asset://`) 경로 재사용. GPT Image 2는 사진 직접 편집(본인·동의 인물만, 모더레이션 거부 가능).

## 8. 제안 (2026-09-06, 창업자 질문에 대한 답 — 미결정)

- **생성 대기**: 영상 2~5분은 화면에 붙잡아 둘 수 없다. 작업 큐(`render_jobs`) + 결과 페이지(로그인, 영구 보관 "내 작품") + **완료 알림 메일**(이미 있는 Resend outbox 재사용)에 서명 링크(3일 만료)를 담는다. 링크는 로그인 없이 보기·다운로드까지만, 만료 후에는 계정 페이지에서 계속 접근. PWA 푸시는 그다음, 알림톡은 카카오 로그인 뒤.
- **카카오 로그인**: Supabase Auth의 Kakao 프로바이더로 붙인다(코드 변경은 로그인 버튼 하나). 선행: 카카오 디벨로퍼스 앱 + **비즈 앱 전환**(사업자등록번호)으로 이메일을 필수 동의 항목으로 — Supabase가 이메일을 요구하기 때문. iOS 앱을 낼 때는 Apple 로그인이 같이 필수.

## 9. 남는 질문(v2)
- 크레딧 전환 시점(생성 파이프라인이 붙을 때).
- 콘테스트 데이터 보존 기간.
- 이미지 템플릿 판매가(원가 $0.05~0.25 → $1~2 권장).
