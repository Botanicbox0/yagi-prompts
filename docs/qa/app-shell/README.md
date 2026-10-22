# 설치형 앱 셸과 완성 푸시 알림 (2026-10-22)

요구사항 원본: `docs/PLATFORM-2.0.md` §5.2·§5.3 (Director 설계, main 체크아웃의 미커밋 파일). 브랜치 `claude/app-shell-push-ea35f2`.

## 무엇이 바뀌었나

| 항목 | 내용 | 파일 |
| --- | --- | --- |
| A. manifest | `theme_color`·`background_color`는 사이트 배경 흰색(`#ffffff`), `id: '/'` 유지, `start_url: /video?source=pwa`, 192/512 `any`+`maskable` 아이콘, 바로가기 2개(영상 포맷 `/video?source=pwa` · 내 작품 `/renders`) | `app/manifest.ts`, `public/icons/*`, `scripts/pwa-icons.mjs` |
| B. viewport·safe-area | 두 루트 레이아웃 `viewport-fit=cover`, 테마색은 흰색 그대로, iOS 상태바 `default`(흰 바탕·검정 글자 — 흰 페이지에 `black-translucent`면 상태바 글자가 안 보인다). 설치형에서 페이지가 상태바 아래로 확장되는 경우(Android edge-to-edge) 상단 인셋을 페이지 배경으로 칠하고 본문·고정 헤더·모바일 메뉴를 그 아래로 내린다. 가로 노치 인셋은 항상 비켜 간다. | 두 `layout.tsx`, `app/globals.css` "App shell" |
| C. 하단 탭 | 설치형(standalone) 전용. 서버 HTML과 브라우저 탭에서는 렌더하지 않는다(JS 판정 + CSS 이중 가드). 사이트 토큰만: 흰 surface + 상단 hairline, 글자·아이콘 ink, 현재 탭은 파란 강조색(`text-blue`)과 굵기. 포맷·내 작품·계정 3개 — "내 사진"은 전용 라우트가 생기기 전까지 `/account`와 같은 곳이라 접힌다. 로그아웃 상태의 내 작품은 `/auth/choose?next=%2Frenders`. | `components/app/bottom-tabs.tsx` |
| D. 설치 안내 | Android는 `beforeinstallprompt`를 붙잡아 두었다가 카드의 버튼으로 띄운다. iOS Safari는 공유 시트 안내. `/account`(Android만 — iOS는 알림 선택이 직접 안내)와 결과 페이지 완료 상태에 1장. 설치형·인앱 브라우저·데스크톱·푸시 미설정 환경에서는 나오지 않는다. "다시 보지 않기"·Chrome 대화상자 거절 뒤에는 다시 나오지 않는다(localStorage, try/catch). | `components/pwa/install-card.tsx`, `install-prompt.ts`, `platform.ts` |
| E. 웹 푸시 | `web-push` 3.6.7(정확 고정). 키 3개가 모두 있고 형식이 맞을 때만 켜진다. 작업 소유자의 활성 기기 전부에 발송, 404/410은 `revoked_at`, 1건 이상 성공이면 전달로 본다. 이메일은 그대로 항상 보낸다. 푸시가 도달한 작업은 `notify_channel = 'push'`. | `lib/notify/push.ts`, `lib/renders/notify.ts`, `app/api/notify/push/route.ts`, `public/sw.js` |
| F. 알림 선택 | `data-notify-choice`. 대기 중 결과 페이지에 "완성되면 알려드릴까요?", 계정 알림 섹션에 같은 선택(설정). 권한은 버튼을 누른 뒤에만 요청, iPhone Safari 탭에서는 홈 화면 추가 안내로 연결, 켠 뒤 상태와 끄기. | `components/notify/notify-choice.tsx`, `notify-choice-panel.tsx` |
| G. 이메일 없는 카카오 계정 | 콜백이 `''` 대신 NULL 저장(0053이 `profiles.email` NOT NULL을 풀고 기존 `''`를 NULL로 정리) | `app/auth/callback/route.ts` |

## 하단 탭 숨기기 선언

하단 고정 CTA가 있는 페이지(예: 템플릿 만들기 화면)는 **아무 요소에나 `data-hide-tabs` 속성**을 둔다. 가장 쉬운 곳은 그 CTA 자체다 — CTA가 화면에 있는 동안만 탭이 비켜 선다. `<body data-hide-tabs>`도 같은 효과다.

```tsx
<div data-hide-tabs className="fixed inset-x-0 bottom-0 pb-safe">…결제·생성 버튼…</div>
```

- CSS `body:has([data-hide-tabs])`가 첫 페인트부터 숨기고, 컴포넌트도 같은 선언을 보면 렌더하지 않으며 본문 하단 여백을 거둔다.
- `pb-safe`(= `padding-bottom: max(1rem, env(safe-area-inset-bottom))`)는 홈 인디케이터를 비켜 가는 하단 고정 바용 유틸리티다(`app/globals.css`).
- 브라우저 모드의 하단 고정 UI 금지(2026-10-07)는 그대로다. 탭은 설치형에서만 존재한다.

## QA: 설치하지 않고 설치형 모드 보기

브라우저 콘솔에서 `localStorage.setItem('twings:display-mode', 'standalone')` 후 새로고침하면 그 브라우저에서만 설치형처럼 동작한다(하단 탭, 안전 영역). 끌 때는 `localStorage.removeItem('twings:display-mode')`. 제품 코드는 이 키를 쓰지 않는다. 아래 캡처도 이 플래그로 찍었다 — CDP `Emulation.setEmulatedMedia`의 `display-mode` 특성은 Chrome이 받기만 하고 적용하지 않는다(실측).

## 운영 반영 순서 (대표·Director)

1. **클라우드 마이그레이션 먼저**: `supabase/migrations/0053_core_push_subscriptions.sql` → `0139_glue_push_subscriptions.sql`. 0053이 `profiles.email` NOT NULL을 풀기 전에 코드가 배포되면, 이메일 없는 카카오 신규 가입의 프로필 생성이 실패한다(로그인 자체는 유지).
2. **VAPID 키 생성**(한 번만, 바꾸면 기존 구독이 모두 끊긴다): `npx web-push generate-vapid-keys`.
3. **Vercel 환경변수**(Production·Preview): `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`(`mailto:` 주소). `NEXT_PUBLIC_` 접두사를 붙이지 않는다 — 페이지가 공개 키만 브라우저에 넘긴다. 하나라도 없으면 푸시는 조용히 꺼지고 알림 선택은 "이 환경에서는 푸시를 쓸 수 없어요"를 보인다.
4. 재배포 후 확인: Android Chrome에서 결과 대기 페이지 → "푸시 알림 켜기" → 완성 시 알림 → 탭하면 `/renders/{id}`. iPhone은 Safari 공유 → 홈 화면에 추가 → 추가한 앱에서 같은 순서.

## 화면 증거 (390px, 320px)

캡처는 헤드리스 Chrome(CDP)으로 남겼다. 기기 크기·사용자 에이전트(Android Chrome / iPhone Safari)·안전 영역은 CDP로 에뮬레이션했고(iPhone: 상단 0 — iOS `default` 상태바는 웹뷰 밖에 그려진다 —, 하단 홈 인디케이터 34px), 설치형 모드는 위의 QA 플래그로 켰다. 내장 브라우저(앱 브라우저 패널)에서도 390px로 같은 결과를 확인했다(탭 3개, 가로 넘침 0).

디자인 정정(2026-10-22): 처음 올린 캡처는 브리프의 YAGI v1.2 다크 지시(검정 상단 띠, 검정 탭바, 빨간 활성 표시)대로였다. 상위 세션이 지시를 바로잡아 사이트 자체 토큰(흰 바탕·검정 글자·파란 강조)으로 바꾸고 1·3·4·5·6·7·8·9를 다시 찍었다(2는 브라우저 모드라 바뀐 것이 없다).

| # | 파일 | 확인한 것 |
| --- | --- | --- |
| 1 | [01-standalone-tabs-ko-video-390.png](01-standalone-tabs-ko-video-390.png) | 설치형 iPhone: 흰 탭바 + 상단 hairline, 탭 3개(56px, 현재 탭 "포맷"은 파란색·굵게, `aria-current`), 홈 인디케이터만큼 아래 여백, 본문 하단 여백, 가로 넘침 0, `viewport-fit=cover`·iOS 상태바 `default`·흰 테마색 |
| 2 | [02-browser-mode-ko-video-390.png](02-browser-mode-ko-video-390.png) | 같은 페이지 브라우저 모드: 탭 없음, 안전 영역 여백 없음 |
| 3 | [03-standalone-tabs-320.png](03-standalone-tabs-320.png) | 320px 설치형: 가로 넘침 0, 탭 107px×3 |
| 4 | [04-standalone-tabs-en-renders-signin.png](04-standalone-tabs-en-renders-signin.png) | 로그아웃 상태 내 작품 탭 → `/auth/choose?next=%2Frenders&locale=en` |
| 5 | [05-account-notify-choice-android-390.png](05-account-notify-choice-android-390.png) | Android 브라우저 `/account`: 완성 알림 "푸시 알림 켜기" + "이메일은 항상 보내드려요" + Android 설치 카드, 탭 없음. 캡처는 합성 `beforeinstallprompt`를 보냈고, 서비스워커가 등록된 실행에서는 Chrome이 낸 실제 이벤트로 같은 카드가 떴다 |
| 6 | [06-account-standalone-tabs-390.png](06-account-standalone-tabs-390.png) | 설치형 `/account`: 계정 탭 현재, 로그인 상태 내 작품 `/renders`, 설치 카드 없음 |
| 7 | [07-render-waiting-ask-ios-standalone-390.png](07-render-waiting-ask-ios-standalone-390.png) | 설치형 iPhone, 대기 중 결과 페이지: "완성되면 알려드릴까요?" + 켜기, 내 작품 탭 현재 |
| 8 | [08-account-ios-safari-install-guide-390.png](08-account-ios-safari-install-guide-390.png) | iPhone Safari 탭 `/account`: "아이폰은 홈 화면에 추가한 TWINGS에서만…" → "추가하는 방법 보기" → 공유 시트 안내. iOS 설치 카드는 중복이라 이 화면에서는 나오지 않음 |
| 9 | [09-account-push-on-390.png](09-account-push-on-390.png) | 켜기 누른 뒤: "이 기기로 완성 알림을 보내드려요." + 끄기, 설치 카드는 약속이 이미 지켜졌으므로 사라짐 |

화면 1–4는 `start:local`(운영 빌드, 3003), 5–9는 로그인 화면이 필요해 `dev:free`(dev identity, 3004)로 찍었다. 5–9 왼쪽 아래 "N"은 Next 개발 모드 표시이며 운영 빌드에는 없다.

## 푸시 도달 검증

로컬 dev 서버(일회용 VAPID 키, 가짜 메일러)와 헤드리스 Chrome으로 확인했다. 키는 프로세스 환경과 QA 후 삭제한 임시 파일에만 있었다.

1. 실제 버튼: 알림 권한 → 서비스워커 활성화 → FCM 구독(`fcm.googleapis.com`) → `POST /api/notify/push 200` → 패널 `on`.
2. 렌더 패스(`/api/renders/tick`): `notifier email:fake+push:web-push · claimed 1 · failed 1 · notified 2 · notify failed 0`, 푸시 실패 경고 없음.
3. 같은 구독·같은 서버 키로 Node `web-push` 직접 발송: **FCM `HTTP 201`** — VAPID 서명·페이로드 암호화·헤더가 맞다.
4. 끄기: `DELETE /api/notify/push 200` → 브라우저 구독 해제 → 패널 `off`.
5. **확인하지 못한 것**: 알림이 화면에 뜨고 탭해서 `/renders/{id}`가 열리는 장면. 헤드리스 Chrome은 알림 표시 플랫폼이 없어 FCM 메시지·DevTools `deliverPushMessage` 모두 `getNotifications()`가 비었다. 서비스워커의 `push`·`notificationclick`(제목·본문·태그·같은 출처 링크만·기존 창 포커스·새 창)은 `tests/pwa/service-worker.test.ts`가 VM에서 실행해 검증한다. **실기기 확인 필요**(Android Chrome, iOS 16.4+ 홈 화면 앱).

QA 중 발견해 고친 것:
- 서비스워커 설치가 오프라인 페이지 캐시 실패에 묶여 있었다(기존 코드). 캐시가 실패하면 워커가 `redundant`가 되어 푸시도 함께 죽는다 → 캐시 실패를 삼키고 설치를 계속한다. 패널의 `serviceWorker.ready`·`subscribe`에는 20초 제한을 둬 버튼이 "설정하는 중…"에 멈추지 않는다.
- 이메일이 성공하면 같은 작업의 푸시 실패가 어디에도 남지 않았다 → `[renders] {id}: push — …` 경고 로그.
- 이미 이 브라우저로 푸시를 받는 사람에게도 "홈 화면에 추가하면 완성 알림을…" 카드가 떴다 → 구독이 있으면(그리고 켜는 순간에도) 숨긴다.

## 검증 기록

2026-10-22, 최종 코드(기준 main `866f168`, 디자인 정정·픽스처 키 수정 포함)로 AGENTS.md §3 순서 그대로:

- `npm run db:local`: 통과
- `npx tsc --noEmit`: 통과
- `npx vitest run`: **277 파일 / 2,638 테스트 통과** (기준선 269 / 2,559 + 신규 8 파일)
- `npm run build:local` (`APP_URL=http://localhost:3003`): 통과
- `npm run start:local` (`PORT=3003`, 푸시 키 없음): 통과
- `npm run sweep:anon` (`SWEEP_BASE_URL=http://localhost:3003`): **SWEEP PASSED — 1006/1006** (신규 체크: manifest 필드·아이콘 5개·sw.js `push`/`notificationclick`·`viewport-fit=cover`·iOS 상태바 `default`·흰 테마색·서버 HTML에 하단 탭 없음·`/api/notify/push` 익명 POST/DELETE 401 + `no-store`). 푸시 키를 넣은 빌드에서도 같은 1006/1006을 확인했다.
- `npm run security:client`, `security:built`: 통과 (클라이언트 엔트리 82개, `web-push`는 서버 번들에만)

포트 3000은 다른 세션이 써서 3003을 썼다. 정적 페이지의 canonical·hreflang은 빌드 시점 origin으로 구워지므로 `APP_URL`을 같은 포트로 맞춰 빌드해야 스윕의 절대 URL 체크(56개)가 통과한다.

건너뛴 것: 실기기(Android Chrome, iOS 16.4+ 홈 화면 앱) 설치·알림 표시·탭 확인, 클라우드 마이그레이션 적용, Vercel 환경변수 등록, 운영 배포.
