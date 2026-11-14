# TWINGS 2026-11-14 레퍼런스 정량 계측 기록

> 실측 일시: 2026-11-14 (browser 서브에이전트 `3dd24701-02f6-4e82-aec7-fb87169b5275` 실사이트 추출 검증 완료)
> 대상: `https://www.magnific.com/` (핑크 포인트 토큰), `https://www.sume.com/ko-kr` (다크 캔버스·여백·한국어 조판 계측)
> 적용 상태: **2026-11-14 TWINGS Design System v2 최종 확정 (Frozen)** — TWINGS 적용 시 CTA 네온 글로우는 제거(`box-shadow: none`)하고, KPI·지표 숫자는 `#EDEDED` / `#09090B` 무채색으로 유지하며 `#FF58AE`는 클릭 가능한 핵심 CTA와 활성 포커스 상태에만 사용한다.

---

## 1. Magnific (`https://www.magnific.com/`) — 핑크 포인트 토큰

| CSS 토큰 | HEX / 값 | RGB | 용도 |
| --- | --- | --- | --- |
| `--magnific-magenta-500` | `#FF58AE` | `rgb(255 88 174)` | 핵심 실행 CTA 버튼 배경, 핵심 강조 숫자 |
| `--magnific-magenta-600` | `#FF389F` | `rgb(255 56 159)` | CTA 호버 상태 |
| `--magnific-magenta-700` | `#FF1A90` | `rgb(255 26 144)` | CTA 액티브(눌림) 상태 |
| `--magnific-magenta-400` | `#FF7AC1` | `rgb(255 122 193)` | 소프트 하이라이트, 다크 보더 강조 |
| `--magnific-magenta-300` | `#FF9ED4` | `rgb(255 158 212)` | 은은한 다크 보조 틴트 |
| `--magnific-magenta-200` | `#FFC2E4` | — | 라이트 배지/하이라이트 |
| `--magnific-magenta-100` | `#FFE0F1` | — | 라이트 표면 미세 틴트 |
| `--magnific-magenta-50` | `#FFF0F8` | — | 최저 채도 라이트 틴트 |
| `--magnific-magenta-800` | `#CC1573` | — | **화이트 바탕 위 텍스트 링크** (`5.35:1` WCAG AA) |
| `--magnific-magenta-900` | `#991056` | — | 화이트 바탕 위 핑크 배지 짙은 글자 (`8.04:1`) |
| `--magnific-magenta-950` | `#660B3A` | — | 초고대비 핑크-다크 잉크 |

### CTA 버튼 실측 지오메트리 & WCAG 대비 검증

- **CTA 글로우 그림자:** `0 4px 14px 0 rgba(255, 88, 174, 0.39)`
- **기본 높이:** `min-height: 44px` (컴팩트 버튼 `36px`), `padding: 0 24px`, `border-radius: 9999px`
- **버튼 서체:** `14px`, `font-weight: 600`, `letter-spacing: -0.01em`
- **WCAG AA 대비 실계산:**
  - `#FFFFFF` on `#FF58AE` = **2.89:1 (미달 — 절대 금지)**
  - `#09090B` (Rich Ink) on `#FF58AE` = **6.88:1 (AA 통과 — 필수 규칙)**
  - `#CC1573` on `#FFFFFF` = **5.35:1 (AA 통과 — 라이트 모드 텍스트 링크)**
  - `#FF58AE` on `#000000` = **7.26:1 (AA/AAA 통과 — 다크 모드 포커스/라벨)**
  - `#FF58AE` on `#0E0E0E` = **6.80:1 (AA 통과 — 다크 표면 라벨)**

---

## 2. Sume Korean (`https://www.sume.com/ko-kr`) — 다크 캔버스·여백·조판

| CSS 토큰 | HEX / 값 | 용도 |
| --- | --- | --- |
| `--agent-bg-chrome` | `#000000` | 최외곽 페이지 캔버스 |
| `--landing-surface` | `#0E0E0E` | 섹션·베이스 카드 표면 |
| `--landing-wash` | `rgba(255, 255, 255, 0.05)` (`#FFFFFF0D`) | 카드·칩·트랙 기본 면 |
| `--landing-track` | `rgba(255, 255, 255, 0.08)` (`#FFFFFF14`) | 호버/활성 세그먼트 트랙 |
| `--landing-panel` | `#2F3032` | 상승 패널, 스위치 |
| `--landing-scrim` | `rgba(0, 0, 0, 0.55)` (`#0000008C`) | 미디어 상단 오버레이 |
| `--landing-foot-shade` | `rgba(0, 0, 0, 0.62)` (`#0000009E`) | 미디어 하단 그라데이션 |
| Chip BG | `rgba(0, 0, 0, 0.45)` | 이미지 위 최소 스펙 배지 |
| `--agent-border` | `rgba(255, 255, 255, 0.08)` | 미세 경계선 |
| `--landing-hairline` | `rgba(255, 255, 255, 0.12)` | 기본 헤어라인 카드 보더 |
| `--landing-rule` | `rgba(255, 255, 255, 0.20)` | 강조 구분선 |
| `--ink-primary` | `#FFFFFF` / `#EDEDED` | 주요 제목·본문 |
| `--ink-secondary` | `rgba(255, 255, 255, 0.60)` | 보조 설명·캡션 |

### 뷰포트별 여백 · 반경 · 타이포그래피 계측

| 항목 | Desktop (`1440x900`) | Mobile (`390x844`) |
| --- | --- | --- |
| 컨테이너 최대폭 | `1040px` (미디어/리믹스 스테이지) | `100%` |
| 바깥 여백 | `16px 16px 64px` (섹션 상하 여유 `56~80px`) | `12px 12px 48px` |
| 섹션 간격 | `32px` | `24px` |
| 그리드 간격 | `12px` (2~3열), 매소너리 `8px` | `10px` (1~2열) |
| 카드 패딩 | `24px` (빠른 링크 카드 `16px`) | `16px` |
| 반경(Radius) | 카드 `16px` / 미디어 타일 `12px` / 칩·CTA `999px` | 동일 |
| `h1` 크기 / 행간 / 자간 | `40~52px` / `1.14` / `-0.03em` | `26px` / `30~32px` / `-0.02em` |
| `body` 크기 / 행간 | `15px` / `1.55` | `15px` / `21px` (`1.4`) |
| 한국어 줄바꿈 규칙 | `word-break: keep-all`, `overflow-wrap: break-word`, 제목 `text-wrap: balance` | 동일 |
