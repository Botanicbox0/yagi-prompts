# feat(app): 설치형 앱 셸과 완성 푸시 알림

> PR #80 본문 원본. 이 환경에는 `gh` CLI가 없어 PR은 상위 세션이 열었다(브랜치 `claude/app-shell-push-ea35f2`, base `main`).
> 아래 `---` 다음부터가 PR 본문이다.

---

## 요약

`docs/PLATFORM-2.0.md` §5.2·§5.3 구현. 스토어 인앱결제 수수료가 5% 마진과 맞지 않으므로 설치형 PWA를 앱으로 완성하고, 오래 걸리는 렌더는 완성되는 순간 푸시로 알린다. 이메일은 지금처럼 항상 보낸다.

- 커밋: `56b0111` 기능(테스트 픽스처 키는 실행할 때 생성) · `7c8dfcb` PR 본문 초안 · 이 문서가 든 커밋(디자인을 사이트 토큰으로 정정, 캡처 교체)
- 기준: `main` `866f168`
- 상세·화면 증거: [`docs/qa/app-shell/README.md`](README.md)

## 변경

| 항목 | 내용 |
| --- | --- |
| A. manifest | `theme_color`·`background_color`는 사이트 배경 흰색, `id: '/'` 유지(설치본 정체성 보존), `start_url: /video?source=pwa`, 192/512 `any`+`maskable`, 바로가기(영상 포맷·내 작품) |
| B. viewport | `viewport-fit=cover`, 테마색 흰색 그대로, iOS 상태바 `default`(흰 바탕·검정 글자). 페이지가 상태바 아래로 확장되는 경우(Android edge-to-edge) 상단 인셋은 페이지 배경으로 칠한다. 고정 헤더·모바일 메뉴·하단 탭은 안전 영역을 비켜 간다. 320px 가로 넘침 0 |
| C. 하단 탭 | standalone 전용(JS 판정 + CSS 가드, 서버 HTML에는 없음). 흰 surface + 상단 hairline, ink 글자·아이콘, 현재 탭은 파란 강조색과 굵기. 포맷·내 작품·계정 3개(내 사진은 전용 라우트 전까지 `/account`라 접힘). 로그아웃 시 내 작품 → `/auth/choose?next=%2Frenders`. 숨기기 선언은 `data-hide-tabs` |
| D. 설치 안내 | Android `beforeinstallprompt` 보관 → 카드 버튼, iOS Safari 공유 시트 안내. `/account`·완성된 결과 페이지에 1장, "다시 보지 않기"(localStorage try/catch) |
| E. 웹 푸시 | `web-push` 3.6.7 고정. `POST`/`DELETE /api/notify/push`. `RenderNotifier` `push` 채널(활성 기기 전부, 404/410 폐기, 1건 이상 성공이면 전달, 도달 시 `notify_channel='push'`). `sw.js` `push`·`notificationclick` |
| F. NotifyChoice | `data-notify-choice`. 대기 중 결과 페이지 "완성되면 알려드릴까요?", `/account` 설정. 권한은 버튼 뒤에만, iPhone Safari 탭은 홈 화면 안내로 연결 |
| G. 카카오 이메일 | 콜백이 `''` 대신 NULL 저장 |
| H. 테스트 | 신규 8 파일(manifest·sw VM 실행·라우트·push 라이브러리·push notifier·마이그레이션·탭/설치 카드/알림 선택 렌더 조건·콜백) + 스윕 체크 |

### 설계 판단 (리뷰 포인트)

- **앱 크롬은 사이트 자체 디자인 시스템을 그대로 쓴다**: 흰 바탕·검정 글자·파란 강조, `app/globals.css`의 기존 토큰(`bg-surface`, `border-hairline`, `text-on-surface`, `text-blue`)만 쓰고 새 색을 만들지 않는다. 브리프의 "YAGI v1.2 Dark Brand(#0A0A0A·#ED1E1E)" 지시는 상위 세션이 정정했다 — 처음 구현의 검정 상단 띠·검정 탭바·빨간 활성 표시는 흰 페이지 위에서 이질적이었다. iOS 상태바도 그래서 `default`다(흰 페이지에 `black-translucent`면 상태바 글자가 보이지 않는다). 탭의 강조색은 `text-accent`가 아니라 `text-blue`: 탭바는 늘 흰 바탕 위에 있고, Tailwind v4는 `@layer utilities`의 일반 클래스에 `aria-*` 변형을 만들지 않는다.
- **`start_url`은 `/ko/video`가 아니라 `/video?source=pwa`**: 미들웨어는 방문한 로케일 접두사를 쿠키로 기억한다(`middleware.ts`). `/ko/video`로 시작하면 영어 사용자는 앱을 열 때마다 언어 쿠키가 `ko`로 바뀐다. 접두사 없는 `/video`는 308로 각자의 `/{locale}/video?source=pwa`가 된다. 바로가기도 같은 이유로 `/video?source=pwa`.
- **푸시는 이메일과 함께 간다**: 푸시할 기기가 없으면 결과는 예전과 똑같다(이메일 결과 그대로). 둘 중 하나라도 독자에게 닿으면 `sent`이므로, 이메일 재시도 때문에 푸시가 반복되지 않는다. 둘 다 실패하면 일시적 오류가 하나라도 있을 때 재시도한다. 이메일이 성공하고 푸시만 실패하면 `[renders] {id}: push — …` 경고 로그를 남긴다.
- **엔드포인트는 알려진 푸시 서비스만**(FCM, Mozilla, Apple, WNS). 서버가 저장된 URL로 POST하므로 임의 주소(내부망 등)를 거부한다.
- **설치 카드는 약속을 지킬 수 있을 때만**: 푸시 키가 없는 환경, 이미 이 브라우저로 푸시를 받는 경우에는 "완성 알림을 받을 수 있어요" 카드를 띄우지 않는다. `/account`에서는 iOS 안내를 알림 선택이 직접 하므로 카드는 Android만.
- **헤더 파일은 건드리지 않았다**(헤더 통합은 범위 밖). 안전 영역은 `app/globals.css`가 기존 `[data-audience-nav]`·`#nav-overlay`에 건다. 이 속성이 바뀌면 함께 옮겨야 한다.

## 운영 반영 전 (대표·Director)

1. **클라우드 마이그레이션 적용 필요 — 코드 배포 전에**: `supabase/migrations/0053_core_push_subscriptions.sql` → `0139_glue_push_subscriptions.sql`. 0053은 `push_subscriptions` 생성, `render_jobs.notify_channel` CHECK에 `push` 추가, **`profiles.email` NOT NULL 해제와 기존 `''`의 NULL 정리**를 한다. 0053 없이 코드가 먼저 나가면 이메일 없는 카카오 신규 가입의 프로필 생성이 실패한다(로그인은 유지). 푸시는 테이블이 없어도 조용히 건너뛰고 이메일은 나간다.
2. **VAPID 키 생성(한 번)**: `npx web-push generate-vapid-keys`. 키를 바꾸면 기존 구독이 모두 끊긴다.
3. **Vercel 환경변수 3개**(Production·Preview, `NEXT_PUBLIC_` 접두사 없음): `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`(`mailto:` 주소). 하나라도 없으면 푸시는 꺼지고 알림 선택은 "이 환경에서는 푸시를 쓸 수 없어요"를 보인다.
4. 재배포 후 실기기 확인: Android Chrome(브라우저 탭에서도 푸시 가능)과 iPhone(Safari 공유 → 홈 화면에 추가 → 추가한 앱에서 켜기).

## 검증 (최종 코드)

- `npm run db:local` 통과
- `npx tsc --noEmit` 통과
- `npx vitest run` **277 파일 / 2,638 테스트 통과** (기준선 269 / 2,559)
- `npm run build:local` 통과 (`APP_URL=http://localhost:3003`)
- `npm run start:local` (`PORT=3003`) + `npm run sweep:anon` **SWEEP PASSED — 1006/1006** (푸시 키 없음·있음 두 빌드 모두)
- `npm run security:client` / `security:built` 통과
- Gitleaks v8.30.1(CI와 같은 Linux 바이너리, 워크플로의 sha256 검증) `gitleaks git --redact --no-banner --log-opts="866f168..HEAD"`: **no leaks found**. 처음 올린 히스토리는 web-push 문서의 공개 예시 키를 테스트·스윕 픽스처 리터럴로 써서 `generic-api-key` 4건이 잡혔다 → 픽스처 키는 실행할 때 만들고(`tests/helpers/push.ts`, 스윕도 `node:crypto`) 같은 최종 트리로 히스토리를 다시 썼다.
- 브라우저: 390px·320px 설치형/브라우저 모드, 로그인 화면(알림 선택·설치 카드·탭) 캡처 9장 — `docs/qa/app-shell/01…09-*.png`
- 푸시 E2E(로컬, 헤드리스 Chrome, 일회용 키): 버튼 → FCM 구독 → `POST /api/notify/push 200` → 렌더 패스 `notifier email:fake+push:web-push · notified 2` → 같은 구독으로 직접 발송 **FCM HTTP 201** → 끄기 `DELETE 200`

## 건너뛴 검사·남은 위험

- **알림이 화면에 뜨고 탭하면 `/renders/{id}`가 열리는 장면은 실기기에서 확인하지 못했다.** 헤드리스 Chrome은 알림 표시 플랫폼이 없다. 서비스워커 처리부는 VM 단위 테스트로 검증했다.
- manifest `screenshots`(PLATFORM-2.0 §5.2 언급)는 넣지 않았다. 설치 시트에 쓸 실제 제품 캡처는 대표 승인 이미지로 따로 정하는 편이 맞다.
- `AppChrome` 헤더 통합, View Transitions는 이번 범위 밖(작업 지시).
- 기존 코드에서 본 것(범위 밖이라 그대로 둠): `components/nav/site-nav.tsx`의 `hover:text-accent`는 빌드 CSS에 규칙이 없다. `text-accent`가 `@layer utilities`의 일반 클래스라 Tailwind v4가 변형을 만들지 않는다.
- "내 사진" 탭은 셀카 라이브러리 작업이 전용 라우트를 만들면 `components/app/bottom-tabs.tsx`의 `PHOTO_HREF` 한 줄로 4번째 탭이 된다.
- 다른 세션과 겹칠 수 있는 파일: `messages/*.ts`(새 `appShell` 블록, `unsubscribe` 뒤), `tests/db/migrations.test.ts`(테이블 목록 1줄), `lib/renders/runtime.ts`(`getRenderNotifier(sql)` 1토큰), `app/(app)/account/page.tsx`·`app/(app)/renders/[id]/page.tsx`(마운트 1곳씩), `package.json`/`package-lock.json`(`web-push`).
- `profiles.email`이 NULL일 수 있게 됐다. 읽는 코드를 확인했다: `lib/auth/viewer.ts`·`lib/renders/feedback.ts`·`lib/campaigns/notify.ts`는 `?? null`, `lib/notify/broadcast.ts`는 형식 검사, 렌더 이메일 notifier는 빈 값과 같은 "no email"로 처리한다. 브랜드 작업공간(`lib/brands/workspace/service.ts`, `lib/brands/usage/*`)은 `String(email)`로 읽지만 초대 수락이 세션의 확인된 이메일 = 프로필 이메일을 요구하므로 이메일 없는 계정은 구성원이 될 수 없다. 구 플레이북 알림 워커(`lib/notify/worker.ts`)는 예전에도 `''`로 발송에 실패했으므로 동작이 같다.

## diff --stat (`866f168..HEAD`, 이 문서 제외)

```
 .env.example                                       |  11 +
 app/(app)/account/page.tsx                         |   3 +
 app/(app)/layout.tsx                               |  12 +-
 app/(app)/renders/[id]/page.tsx                    |   3 +
 app/(marketing)/[locale]/layout.tsx                |  11 +-
 app/api/notify/push/route.ts                       | 114 ++++++++
 app/auth/callback/route.ts                         |   3 +-
 app/globals.css                                    | 104 ++++++++
 app/manifest.ts                                    |  51 +++-
 components/app/bottom-tabs.tsx                     | 160 +++++++++++
 components/notify/notify-choice-panel.tsx          | 210 +++++++++++++++
 components/notify/notify-choice.tsx                |  33 +++
 components/pwa/display-mode.ts                     |  66 +++++
 components/pwa/install-card.tsx                    | 119 +++++++++
 components/pwa/install-prompt.ts                   |  55 ++++
 components/pwa/platform.ts                         |  27 ++
 components/pwa/register-sw.tsx                     |   7 +-
 components/pwa/shell.ts                            |  18 ++
 docs/qa/app-shell/*.png (9)                        | Bin
 docs/qa/app-shell/README.md                        |  89 +++++++
 lib/notify/push.ts                                 | 289 +++++++++++++++++++++
 lib/renders/notify.ts                              | 112 +++++++-
 lib/renders/runtime.ts                             |   2 +-
 messages/en.ts                                     |  47 ++++
 messages/ko.ts                                     |  47 ++++
 package-lock.json                                  | 175 +++++++++++++
 package.json                                       |   2 +
 public/icons/*.png (5)                             | Bin
 public/sw.js                                       |  78 +++++-
 scripts/pwa-icons.mjs                              |  67 +++++
 scripts/sweep-anon.ts                              |  40 ++-
 supabase/migrations/0053_core_push_subscriptions.sql |  44 ++++
 supabase/migrations/0139_glue_push_subscriptions.sql |  11 +
 tests/auth/callback-email.test.ts                  |  63 +++++
 tests/db/migrations.test.ts                        |   2 +
 tests/db/push-subscriptions.test.ts                |  89 +++++++
 tests/helpers/push.ts                              |  13 +
 tests/notify/push.test.ts                          | 208 +++++++++++++++
 tests/pwa/app-shell.test.tsx                       | 192 +++++++++++++
 tests/pwa/manifest.test.ts                         |  95 +++++++
 tests/pwa/service-worker.test.ts                   | 152 +++++++++++
 tests/renders/push-notifier.test.ts                | 198 ++++++++++++++
 tests/routes/notify-push-api.test.ts               | 131 ++++++++++
 types/web-push.d.ts                                |  49 ++++
 56 files changed, 3170 insertions(+), 32 deletions(-)
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
