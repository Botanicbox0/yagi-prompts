# TWINGS Studio UI v4 — High-End AI Creative Studio Design System Refactoring (2026-11-12)

## 1. 배경과 목표

기존 화이트 백그라운드 기조와 기능·권한·격리 구조(모픽 샌드박스 `404` 및 탭 숨김, B2C 개인 결제·약관 불변)는 **100% 유지**하면서, B2B 어드민/ERP 인상을 주던 회색 실선(`1px solid`), 탁한 블루·파스텔 연하늘 틴트, 단조로운 타이포그래피를 전면 걷어내고 **Visual Electric · Cosmos.so · Paper.design · Linear** 감도의 하이엔드 AI 크리에이티브 스튜디오 디자인 시스템으로 리팩토링한다.

---

## 2. 4대 디자인 시스템 축

### 2.1 Color System — "95% Monochrome + 5% Electric Ultramarine Accent"
- **Canvas & Surface (면 대비만으로 공간 분리)**:
  - Main Canvas Background: `#FFFFFF`
  - Sidebars / Secondary Panels / Inactive Pills: `#F4F4F5` (외곽 실선 제거)
  - Hover Surface: `#E4E4E7`
  - Media / Onboarding Card Surface: `#F8F8FA`
- **Active & Selected States (Rich Black 통일)**:
  - 탭 활성화(`영상 만들기`, `문장·참조로 만들기` 등), 스펙·옵션 선택(`5초`, `9:16`, `1080p` 등), 토글 ON(`role="switch"[aria-checked="true"]`), 좌측 사이드바 `+ 만들기` 버튼 등 모든 일반 선택·활성 상태는 **`#09090B` 배경 + `#FFFFFF` 텍스트**로 통일.
  - **전면 폐기**: 연파랑 배경 + 파란 글씨 파스텔 틴트(`#EBF5FF`, `#E8EFF7`, 구 `--ys-accent-soft`) 조합 전면 제거.
- **Primary CTA Only (단일 원포인트 블루)**:
  - 화면당 최종 생성·핵심 실행 버튼(`만들기 · N 크레딧`, `새 영상 만들기 시작` 등) 단 하나에만 **Electric Ultramarine `#0033FF`** (Hover `#0026CC`), `#FFFFFF` 볼드 텍스트, 입체 그림자 `0 4px 14px rgba(0, 51, 255, 0.28)` 적용.
- **Text Hierarchy**:
  - Primary Text: `#09090B`
  - Secondary / Label Text: `#52525B`
  - Supporting Helper Description: `#71717A` (`font-weight: 400`)
  - Muted / Placeholder Text: `#A1A1AA`
- **사진·영상 색 세계 분리**:
  - 생성 화보·필름 색 권위(`WORLD.french = #3875c5`, `[195, 225]°`)는 촬영·S5 컬러 QA 기준으로 보존하고, 제품 UI 크롬(`COLOUR`, `--ys-*`, `--id-*`)만 새 시스템으로 일원화한다.

### 2.2 Typography Tuning — "Geist + Pretendard Pairing & Tight Tracking"
- **자체 호스팅 가변 웹폰트 (`public/fonts/geist/`)**:
  - `Geist-Variable.woff2` (`100–900`, Latin/숫자/기호 `unicode-range`) + `GeistMono-Variable.woff2` (`100–900`, Latin/숫자/기호 `unicode-range`) 자체 호스팅(외부 런타임 CDN `0`건).
  - Sans 기본 스택: `'Geist', 'Pretendard Variable', Pretendard, -apple-system, sans-serif` (영문·숫자는 날카로운 Geist, 한글은 글리프 단위로 Pretendard Variable 폴백).
  - Mono 스펙·수치 스택: `'Geist Mono', 'Pretendard Hangul', 'Pretendard Variable', monospace` + **`font-variant-numeric: tabular-nums` 필수** (크레딧 잔액 `29,845`, 견적 `15 크레딧`, 해상도 `2K`/`480p`/`1080p`, 비율 `4:3`/`9:16`, 길이 `5초`, 저장 용량 등).
- **자간 및 굵기 대비**:
  - 페이지 타이틀·섹션 헤드라인: `font-weight: 650`, `letter-spacing: -0.035em`, `line-height: 1.25`
  - 버튼·탭·본문 UI: `letter-spacing: -0.02em` (기본 `0` 자간 폐기)
  - 부연 설명: `#71717A`, `font-weight: 400`, 로컬 Gemma 4(`yagi-crm-gemma4:31b-q8_0`) 기반 페이지별 기능 맥락 반영 한국어 문안 압축·고도화.

### 2.3 Borderless Layout & Tactile Elevation
- 상단 헤더 하단 선·좌우 레일 경계선 및 중첩된 `1px solid` 회색 테두리 제거(불가피한 구분선만 `rgba(0, 0, 0, 0.04)` 이하).
- **Image Studio Floating Prompt Dock (`components/brand-studio/dock.tsx`, `app/(brand)/studio-v2.css`)**:
  - 내부 중첩 회색 입력 박스를 제거하고 일체형 캡슐 독(`background: rgba(255, 255, 255, 0.88)`, `backdrop-filter: blur(20px)`, `border-radius: 24px`, `box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 20px 48px -12px rgba(0, 0, 0, 0.12)`)으로 통합.
  - 모델·비율·해상도·화질·장수 드롭다운은 무보더 알약(`background: #F4F4F5`, Hover `#E4E4E7`, `border-radius: 9999px`, `height: 32px`)으로 정돈.
- **Video Studio 좌측 컨트롤 패널 (`components/brand-studio/video/workspace.tsx`)**:
  - `#F4F4F5` 무보더 세그먼트 트랙 위 `#09090B` 액티브 탭(`영상 만들기` / `영상 편집`).
  - `시작 프레임 / 끝 프레임` 업로드 카드는 `1px dashed rgba(0, 0, 0, 0.12)` + `#FAFAFA` 배경 + 부드러운 호버 전환.

### 2.4 Visual Media Containers & Gallery Polish
- **Video Studio 중앙 3단계 온보딩 카드**:
  - 바깥 회색 테두리 컨테이너 제거(여백 확보).
  - 상단 텍스트 도식(`START -> @1`, `9:16 5s`, `480p -> 1080p`) 제거 → 카드 상단·좌우 여백 없는 **Full-bleed `16:9` 루프 비디오 슬롯(`<video autoPlay loop muted playsInline>`)** 배치(`border-radius: 16px`, `background: #F8F8FA`, 무보더).
- **Image Studio 갤러리 및 실패 카드**:
  - 그리드 `gap: 12px`, 타일 `border-radius: 12px`, 호버 시에만 반투명 블랙 글래스(`rgba(0, 0, 0, 0.65)`, `backdrop-filter: blur(8px)`) 알약 액션 배지(`부분 수정` 등) 노출.
  - 생성 실패 카드(`이번에는 만들지 못했어요`): `#F4F4F5` 미세 그라데이션·노이즈 질감 + 미니멀 아이콘 + 무보더 알약 `다시 만들기` 버튼.
