# app/ — 표면과 라우트

Next.js 15 App Router 단일 앱이 호스트별로 세 표면을 낸다. 판정은 `lib/routing/surfaces.ts`, 게이트는 `middleware.ts`. 전체 지도는 루트 `ARCHITECTURE.md` §2.

| 폴더 | 표면 | 캐시 | 메모 |
| --- | --- | --- | --- |
| `(marketing)/[locale]/` | consumer 공개 | 정적 + 캐시 태그 + 1h TTL | 랜딩, 템플릿 페이지, `/brands` 브랜드 랜딩, FAQ, 법적 문서 |
| `(app)/` | consumer 로그인 | `force-dynamic` + `private, no-store` | 계정·결제·렌더·셀카·캠페인 지원·크리에이티브 지원. 새 무접두 경로는 `lib/i18n/config.ts`의 `APP_PREFIXES`에 등록 |
| `(brand)/brand/` | brand (`brand.twings.app`) | dynamic | 워크스페이스: 캠페인·크리에이터·라이브러리·멤버·설정·스튜디오. 새 경로는 `lib/routing/surfaces.ts`의 `isBrandPath`·`brandRouteAllowed` |
| `(admin)/admin/` | admin (`admin.twings.app`) | dynamic | 모든 변경은 `admin/do/route.ts` → `lib/admin/dispatch.ts` 하나로 |
| `api/` | 공통 | — | 도메인별 라우트 핸들러. 브랜드 호스트에서 열리는 API는 `brandRouteAllowed` 허용 목록에 있어야 한다 |
| `auth/` | 공통 | — | callback · signin · signout · 심사 계정 로그인 |
| `actions/` | 공통 | — | 서버 액션(로케일) |
| `.well-known/` | 공통 | — | 앱 링크(Android·iOS) |

`globals.css`가 디자인 토큰의 단일 원본(Tailwind v4 CSS-first)이고, 브랜드·관리자 표면은 각자 `workspace.css`를 더한다.
