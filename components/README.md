# components/ — 화면 조각

서버 컴포넌트가 기본, 클라이언트 섬(`'use client'`)은 필요한 최소 범위. 문안은 전부 `messages/*.ts`에서 받는다(하드코딩 금지). 어느 표면이 쓰는지 기준으로 읽는다.

| 폴더 | 표면 | 한 줄 |
| --- | --- | --- |
| `admin/` | admin | 관리자 셸(`chrome.tsx`), 편집 패널, 캠페인·브랜드 상태 폼 |
| `brand-workspace/` | brand | brand.twings.app 전체: 컨텍스트·스코프(`context.ts`·`scope.ts`·`access.ts`), 내비, 캠페인 마법사·상세·타임라인, 스튜디오, 관리자 겸용 폼(`managed-form.tsx`) |
| `brand-studio/` | marketing | `/brands` 랜딩 v7(서버 섹션 + 클라이언트 섬) |
| `brand/` | 공통 | TWINGS·YAGI 마크와 워드마크 |
| `campaigns/` | marketing | 캠페인 공개 페이지, 브랜드 문의 폼, 고객 사례 |
| `templates/`, `prompts/` | marketing · app | 템플릿 목록·페이지·만들기 시트, 템플릿 카드·미디어 |
| `recipes/`, `makers/`, `creators/` | app · marketing | 레시피 v2 편집·실행, AI 크리에이티브 프로필·허브, 지원 폼 |
| `renders/`, `identity/` | app | 대기·결과·포스터 캡처, 셀카 업로드·시트·가이드 |
| `billing/`, `twings/` | app | 구독 체크아웃·상태(미출시), 스튜디오·프리미엄 편집 UI |
| `app/`, `nav/`, `audience/`, `auth/`, `onboarding/`, `pwa/`, `notify/` | app · marketing | 앱 헤더·하단 탭, 사이트 내비, 개인|브랜드 진입, 로그인 무대, 시작 시트, 설치 안내, 알림 선택 |
| `landing/`, `marketing/`, `motion/`, `ui/`, `analytics/` | marketing | 소비자 랜딩 섹션, 공통 크롬·안내, 스크롤 모션, 마키·텍스트 교체, 이벤트 비콘 |
| `community/`, `contests/`, `library/`, `playbook/` | app · marketing | 플래그 off 또는 레거시(콘테스트, 라이브러리, playbook CMS 렌더) |
| 루트 파일 | 공통 | `site-footer.tsx`, `locale-toggle.tsx`, `locale-submit-button.tsx` |

`ad/`는 빈 폴더(광고 레일 플레이스홀더, `lib/flags.ts` `AD_SLOTS_DB_BACKED`). 디자인 규칙은 `docs/design/TOOLBOX.md`·`IDENTITY.md`, 가드 테스트는 `tests/design`·`tests/workspace`.
