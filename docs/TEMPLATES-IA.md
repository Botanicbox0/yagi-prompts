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

- **통화(2026-09-07, 창업자)**: 한국어 페이지는 **원화 고정가**만 보여준다 — 달러 환산 노출 금지. 원화 가격은 행에 저장(`prompt_items.price_krw`, 0018)하고 관리자 편집기에서 USD와 나란히 입력한다. 비어 있으면 x,900원 규칙(USD×1,400을 천 단위로 올림 −100: $4→5,900원, $7→9,900원, $2→2,900원)으로 계산해 보여주며, 0018이 기존 행을 같은 규칙으로 채웠다. 결제가 붙으면 국내 PG는 이 원화 금액을 청구한다(`lib/twings/products.ts`).
- **가격 노출 위치(2026-09-07, 창업자)**: 카드에는 가격이 없다 — "가격 붙어있으면 구매욕구가 떨어지지 않을까". 가격은 템플릿 페이지의 사실 블록·결제 버튼과 요금제 표에서만 보인다.

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

- **생성 대기 → 구현(2026-09-06, `render_jobs`, 마이그레이션 0017/0107)**: 스튜디오가 사진을 브라우저에서 1600px JPEG로 줄여 `POST /api/renders`에 보내면, 서버는 사진을 비공개 `renders` 버킷에 넣고 행을 큐잉한 뒤 201과 `/renders/{id}`를 돌려준다. 같은 함수 호출의 `after()`에서 패스가 돈다 — 이미지(GPT Image 2·Seedream)는 그 자리에서 1~2분 안에 끝나고, 영상은 ModelArk 태스크를 만든 뒤 대기. 완료 시 결과를 **우리 스토리지로 즉시 복사**(제공자 URL은 24h), 3일 공유 토큰 발급(`/r/{id}/{token}`, 로그인 없이 보기·다운로드), 완료 메일 발송(Resend, sume.com 톤 — 흰 시트·검정 알약 버튼·회색 메타). 실패는 이유 코드(`face_policy`·`moderated`·`engine_access`…)와 함께 실패 메일. 소유자 페이지 `/renders/{id}`는 영구, `/renders`·계정 페이지가 "내 작품".
  - **패스는 한 함수(`runRenderPass`)를 네 곳에서 부른다**: 인큐 직후 `after()`, ModelArk 완료 콜백(`/api/renders/callback`, 본문은 힌트일 뿐 — 태스크는 제공자에서 다시 읽는다), 소유자 결과 페이지(열 때마다 폴링·6초 자동 새로고침), Vercel Cron(`/api/renders/tick`, **Hobby 플랜은 하루 1회 한도** → 매일 03:00 KST 안전망; Pro 전환 시 `vercel.json`에서 매분으로). 모든 단계가 멱등: 클레임은 `FOR UPDATE SKIP LOCKED` 리스, 시도 예산 3회, 메일은 `render:{job}:{user}` idempotency key. 20분 넘게 `running`인 동기 작업은 다음 패스가 회수.
  - **공개 게이트**: 결제가 붙기 전까지 관리자만 실생성(`lib/flags.ts` `RENDER_PIPELINE_PUBLIC=false`), 나머지는 데모 그대로. 스튜디오는 `/api/renders/access`로 물어 배지와 버튼을 바꾼다. 결제(§8 다음 단계)가 붙으면 결제 완료 시점에 같은 `createRenderJob`을 호출하면 된다.
  - **얼굴 정책**: GPT Image 2 경로는 본인 사진 그대로 통과(2026-09-06 실측). ModelArk(Seedream·Seedance)는 실제 얼굴을 거부하므로 그 템플릿에 실제 사진을 넣으면 `face_policy`로 즉시 실패하고 메일이 이유를 말한다 — 실인물 자산 라이브러리(H5 라이브니스) 연결이 그 다음 작업.
  - **환경 변수**: `CRON_SECRET`(선택; 있으면 tick이 Bearer 검사), 엔진 키는 기존 `OPENAI_API_KEY`·`ARK_API_KEY`, 메일은 `RESEND_API_KEY`·`NOTIFY_FROM_EMAIL`(없으면 작업은 완료되고 메일만 `pending`으로 남았다가 설정 후 다음 패스에 발송).

### 8.1 결과 링크 전달 채널 — 카카오톡·WhatsApp 설계 (창업자 질문, 2026-09-06)

질문: "카카오톡으로 연동된 가입자는 카카오톡으로 링크 전달, 구글로 가입한 사람도 한국이면 카카오톡으로도 받게, WhatsApp 가입도."

**원칙: 로그인 수단과 전달 채널을 분리한다.** 로그인은 신원(누구인가), 전달은 검증된 연락처(어디로 보낼까). 카카오로 로그인했다는 사실이 카톡으로 보낼 권한을 주지 않는다 — 카카오 로그인 토큰으로 보내는 "나에게 보내기"(`talk_message`) API는 카카오 가입자 전용이고, 토큰을 서버에 보관해야 하며, 하루 한도가 있고, 로그인 동의 화면에 항목이 하나 늘어난다. 쓰지 않는다.

- **채널 1 — 이메일(기본, 구현됨)**: 카카오·구글 모두 이메일이 필수 동의라 모든 계정에 있다.
- **채널 2 — 카카오 알림톡(한국 번호)**: 조건은 **휴대폰 번호**뿐이라 구글 가입자도 번호만 확인하면 받는다. 선행: 카카오톡 채널 개설 + 비즈니스 채널 인증(사업자등록증) + 발신프로필 등록 + **템플릿 사전 심사**("[TWINGS] 결과물이 완성됐어요. #{link} · 3일간 열립니다" 류). 전송은 대행사 REST API(Solapi·NHN Cloud Notification 등, 건당 ₩7~9, 카톡이 없는 번호는 SMS 대체발송). 카카오 로그인 동의항목에 `phone_number`(선택)를 켜면 번호가 미리 채워진다.
- **채널 3 — WhatsApp(해외 번호)**: WhatsApp Business Platform의 승인 템플릿 메시지. Meta 비즈니스 인증 필요, Twilio 경유가 가장 단순. 알림톡과 같은 "번호 + 승인 템플릿" 모델이라 어댑터 하나 차이.
- **UX**: 첫 실생성(또는 계정 페이지)에서 "결과 받을 곳"을 한 번 정한다 — 이메일(항상) + 휴대폰 번호(선택; `+82`면 알림톡, 그 외 WhatsApp; 인증 코드 1회). 프로필에 `phone_e164`·`phone_verified_at`·`notify_channels`를 두고, `render_jobs.notify_channel`이 실제 발송 채널을 기록한다. 코드는 이미 채널 무관(`lib/renders/notify.ts`의 `RenderNotifier`): 알림톡·WhatsApp은 구현체 두 개를 더하는 일이지 파이프라인을 고치는 일이 아니다.
- **WhatsApp 가입**: Meta는 "WhatsApp으로 로그인" OAuth를 제공하지 않는다. 실질적인 방법은 Supabase Auth **전화번호 OTP를 WhatsApp 채널로** 보내는 것(Twilio Verify, `signInWithOtp({ phone, options: { channel: 'whatsapp' } })`). 이러면 번호가 곧 신원이라 WhatsApp 전달이 자동으로 검증된다. 선행: Twilio 계정 + Verify 서비스의 WhatsApp 발신자 승인(Meta 비즈니스 인증), Supabase Phone 프로바이더 활성화. 문(`/auth/choose`)에는 세 번째 버튼(번호 입력 → 코드)이 붙는다.
- **순서 제안**: ① 알림톡(한국 고객 대부분·비용 최저) → ② WhatsApp 전달 → ③ WhatsApp 가입. 셋 다 창업자 쪽 계정·심사가 선행이라, 코드보다 먼저 카카오톡 채널 개설과 Meta 비즈니스 인증을 시작해 두는 편이 좋다.
- **카카오 로그인**: Supabase Auth의 Kakao 프로바이더로 붙인다(코드 변경은 로그인 버튼 하나). 선행: 카카오 디벨로퍼스 앱 + **비즈 앱 전환**(사업자등록번호)으로 이메일을 필수 동의 항목으로 — Supabase가 이메일을 요구하기 때문. iOS 앱을 낼 때는 Apple 로그인이 같이 필수.
  - **설정 기록(2026-09-06, 라이브 로그인 확인)**: Supabase Kakao 프로바이더의 Client ID = 카카오 앱 **REST API 키**(앱 > 플랫폼 키 목록의 키 값, 16진수 32자리), Client Secret = **카카오 로그인 클라이언트 시크릿**(비즈니스 인증 시크릿·어드민 키는 쓰지 않음), Redirect URI = `https://nhokkikjkzjalxqsbzuk.supabase.co/auth/v1/callback`. 동의항목은 닉네임·이메일 **필수** + 프로필 사진 **선택** — Supabase는 `account_email profile_image profile_nickname` 세 scope를 항상 요청하므로 프로필 사진을 비워 두면 KOE205, Client ID가 틀리면 KOE101이 뜬다.
  - **문(`/auth/choose`) 워딩 원칙**: 로그인 문은 랜딩이 아니다(Linear·Figma·Notion과 같은 형태). 제목은 행위("로그인 또는 회원가입"), 한 줄 안내(첫 방문이면 계정 자동 생성), "…로 계속하기" 버튼 둘, 이용약관·개인정보처리방침 링크가 든 동의 한 줄. 가치 제안 문단과 사진 처리 안내는 넣지 않는다.

## 9. 남는 질문(v2)
- 크레딧 전환 시점(생성 파이프라인이 붙을 때).
- 콘테스트 데이터 보존 기간.
- 이미지 템플릿 판매가(원가 $0.05~0.25 → $1~2 권장).
