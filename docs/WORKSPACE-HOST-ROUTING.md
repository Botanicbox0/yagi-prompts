# 워크스페이스 호스트 경계

2026-09-20 구현, 이후 브랜드 워크스페이스 출시에 맞춰 갱신. 도메인 등록·DNS 변경·OAuth 허용 목록 변경은 포함하지 않는다. 브랜드 워크스페이스는 단수 호스트 `brand.twings.app`에서 운영되며, 복수형 `brands.twings.app`은 이동 전용이다. 기준 코드는 `lib/routing/surfaces.ts`와 `middleware.ts`다.

## 접근 계약

| 호스트 | 동작 |
|---|---|
| `twings.app`, `www.twings.app`, `yagi-prompts.vercel.app` | 기존 소비자 경로·관리자 경로 유지 |
| `localhost`, `127.0.0.1`, `[::1]` | 포트를 보존하는 기존 로컬 동작 |
| `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`의 정확한 호스트 | 현재 배포의 소비자/프리뷰 동작. 임의 `*.vercel.app` 허용 없음 |
| `admin.twings.app` | `GET/HEAD /` → 307 `/admin`; 세션 없는 관리자 페이지 → 같은 호스트의 `/auth/choose?next=…`; 기존 서버 `requireAdmin` 및 오퍼레이션 권한 검사 유지. 허용 경로는 `adminRouteAllowed` |
| `brand.twings.app` | 운영 중인 브랜드 워크스페이스. `GET/HEAD /` → 307 `/brand`; 허용 경로는 `brandRouteAllowed`이고 그 밖은 404. 세션 없는 `GET/HEAD` 워크스페이스 페이지 → 같은 호스트의 `/auth/choose?next=…`, 세션 없는 그 밖의 메서드 → 404. 초대 랜딩 `GET/HEAD /brand/invite`만 세션 없이 열린다 |
| `brands.twings.app` | `GET/HEAD /` 또는 워크스페이스 경로(`isBrandPath`)만 308로 `https://brand.twings.app`의 같은 경로로 이동(`/`는 쿼리 없이 `/brand`로, 그 밖의 경로는 쿼리 유지). POST 등 다른 메서드와 그 밖의 경로(인증·API·정적 자산 포함)는 404. OAuth 코드나 POST를 넘기지 않는다 |
| 그 밖의 호스트 | 404, `private, no-store`, `noindex, nofollow` |

관리자 호스트(`adminRouteAllowed`)가 받는 것:

- 인증: `GET/HEAD /auth/choose`, `/auth/open-in-browser`, `/auth/signin`, `/auth/callback`, `POST /auth/signout`
- `GET/HEAD /admin` 및 하위 페이지, `POST /admin/do`
- `POST /api/workspace-locale`
- `POST /api/admin/staging-url`, `POST /api/admin/brand-workspace`, `POST /api/admin/brand-workspace/attachments/{id}`
- `GET/HEAD /api/admin/media/{ref}`
- `GET/HEAD /api/brand-workspace/attachments/{id}`, `GET/HEAD /api/brand-workspace/organizations/{id}/logo` (핸들러가 스튜디오 권한을 다시 확인한다)
- `GET/HEAD` 정적 자산: `/_next/static/*`, `/fonts/*.css|woff|woff2`, `/favicon.ico`, `/icon.png`, `/apple-icon.png`, `/brand/twings.svg`, `/brand/twings-mark-{black,white,mask}.png`

브랜드 호스트(`brandRouteAllowed`)가 받는 것:

- 위와 같은 인증 경로, `POST /api/workspace-locale`
- `GET/HEAD` 워크스페이스 페이지(`isBrandPath`: `/brand`, `/brand/{projects,members,invite,settings,library,studio}` 및 하위)
- `POST /api/brand-production`, `GET/HEAD /api/brand-production/{id}` 및 `/api/brand-production/{id}/media`
- `GET/HEAD/POST /api/brand-workspace`, `/api/brand-workspace/attachments/{id}`, `/api/brand-workspace/organizations/{id}/logo`
- 관리자 호스트와 같은 정적 자산 `GET/HEAD` (`/api/*`와 `/admin*`은 제외)

두 워크스페이스 호스트 모두 그 밖의 `/api/*`, 마케팅·결제·렌더·토큰 공유 링크, PWA 파일·sitemap은 404이고, `GET/HEAD`가 아닌 요청은 교차 origin이면 404다. `admin`·`brand`·`brands`의 `robots.txt`는 `Disallow: /`이며 별도 sitemap을 제공하지 않는다.

호스트 검사는 모든 요청의 middleware 진입점에서 먼저 실행한다. API·OAuth·정적 자산의 기존 locale/session 우회는 그 뒤에 적용한다. Next config의 선행 legacy redirect도 소비자 호스트에만 적용한다.

## 인증과 원점

`lib/auth/return-path.ts`는 단일 `/` 시작, 역슬래시·제어문자·인코딩된 경로 구분자 검사 후 URL 파서로 동일 origin을 확인한다. 정규화된 경로·검색·fragment만 반환한다. 관리자 인증 복귀는 정규화 이후에도 `/admin` 또는 그 하위만 허용한다. signin·callback·chooser·외부 브라우저 안내·locale·기존 빌링/identity 복귀 검사에 같은 함수를 사용한다.

`resolveRequestUrl`은 알려진 정확한 Host만 처리한다. 원격 URL과 Host의 불일치 및 임의 `x-forwarded-host`는 권한이나 목적지를 바꾸지 못한다. Next 로컬 서버가 URL을 loopback으로 구성하는 경우에만 알려진 Host를 복원한다. localhost·127.0.0.1·IPv6 loopback끼리는 포트가 같아야 한다. 이 검증된 origin을 인증 callback·실패·복귀 및 관리자 POST의 303 응답에 함께 사용한다.

Supabase 프로젝트와 사용자 ID는 그대로이며 cookie Domain을 추가하지 않는다. 각 호스트가 자신의 세션을 갖는다. 관리자 API의 기존 `requireAdmin`·origin 검사에 더해 middleware는 교차 origin POST를 거절한다. 공개 보기 링크는 관리자 호스트에서만 `https://twings.app`으로 이동한다. 로컬·프리뷰에서는 상대 링크를 유지한다.

## 검증과 활성화 전 남은 일

- `tests/auth/return-path.test.ts`: 실제 signin/callback 호출에서 `/\\evil.example`와 탭 변형의 외부 이동을 재현한 뒤 수정. 관리자 복귀·PKCE callback·인증 실패도 검증.
- `tests/routes/workspace-hosts.test.ts`: 호스트/메서드/경로 행렬, 정적·API·OAuth 우회 방지, 위조 헤더, loopback 원점, 복수형 브랜드 호스트의 308 이동·404와 robots.
- `tests/admin/host-return.test.ts`: 관리자 POST 성공의 303 원점, localhost 호환, 기존 관리자 검사 유지.
- `node scripts/smoke-workspace-hosts.mjs [port]`: 실행 중인 **로컬 서버**에 GET/HEAD만 보낸다. 모든 소켓은 `127.0.0.1`에 연결하며 리디렉션을 따라가지 않는다. 인증값·쿠키값·환경변수는 읽거나 출력하지 않는다. 기본 포트 3000.
- 스모크의 `private, no-store` 판정은 `build:local` → `start:local` 서버 기준이다. Next dev는 페이지 응답에 `no-store, must-revalidate`를 덮어써 이 두 페이지 검사가 다를 수 있다.
- 활성화 전 실제 Vercel 프리뷰의 Host/URL 일치, Supabase의 정확한 callback 허용 목록, Google/Kakao 왕복·취소·로그아웃, 관리자/일반 사용자 권한을 실제 브라우저로 확인해야 한다. 단위 테스트가 실제 OAuth 검증을 대신하지 않는다.
- DNS·Vercel 도메인 연결, 배포·병합, 브랜드 기능 개방, 기존 `/admin` 외부 호스트로의 강제 이동은 별도 결정이다. 생성 공개 플래그·결제·법무·클라우드 DB는 변경하지 않는다.
