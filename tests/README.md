# tests/ — vitest

`npx vitest run` 한 번에 전부 돈다(PGlite in-memory, 스위트마다 새 DB). 폴더는 `lib/`의 도메인과 거의 1:1이고(`tests/brands` ↔ `lib/brands` 같은 식), 아래 7개는 lib 밖의 경계를 검사한다.

| 폴더 | 무엇을 지키나 |
| --- | --- |
| `helpers/` | PGlite(`freshDb`·`runner`), 관리자 하네스(`adminHarness`·`formOf`), 프로필·결제·푸시 시드 |
| `routes/` | 호스트 경계(소비자·브랜드·관리자), 토스 결제 라우트, (app) 경로 게이트 |
| `ui/` | 화면 단위 렌더(템플릿 페이지·시트·레시피 허브) |
| `onboarding/` | 가입 직후 시작 시트 |
| `pwa/` | 설치형 셸·스토어 브리지 |
| `runtime/` | `lib/cache.ts`·플래그·런타임 모드 |
| `workspace/` | 브랜드·관리자 워크스페이스 공통(디자인 감도 가드 포함) |

규칙은 `AGENTS.md` §4: 새 기능은 실패하는 테스트 → 구현 → 통과. `tests/db/migrations.test.ts`가 테이블 목록을, `tests/i18n/dictionary.test.ts`가 사전 키를, `tests/admin/auth.test.ts`가 관리자 오퍼레이션 전체의 권한을 열거한다 — 새 테이블·키·오퍼레이션은 저절로 검사 대상이 된다.
