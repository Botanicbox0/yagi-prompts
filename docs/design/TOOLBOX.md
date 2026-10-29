# TWINGS 디자인 엔지니어링 툴박스

> 원문은 대표가 2026-10-29에 준 "Design Engineering Repertoire & Contextual Judgment Guidelines"다. 이 파일은 그것을 TWINGS 코드 사실에 맞춰 정리한 것이다.
> 취향 판정(좋다/싫다)의 기록은 `docs/design/TASTE.md`에 있다. 이 파일은 "무엇을 꺼내 쓸 수 있는가", TASTE.md는 "대표가 무엇을 좋아하고 싫어했는가"를 적는다.

## 0. 고정값

| 항목 | 값 |
| --- | --- |
| 모드 | **화이트(라이트) 모드.** 브랜드 랜딩(`/brands`)과 brand.twings.app이 같은 톤이다. |
| 서체 | `Pretendard Variable`. 헤드라인 700–800, 자간 -0.03em ~ -0.04em. 본문 400–500, 자간 -0.01em. |
| 포인트 색 | **블루 하나, 토큰 하나.** 현재 값 `#3875C5`(대표 레퍼런스의 콘플라워 블루, 2026-10-29). brand.twings.app은 `--ys-accent`, 랜딩은 `--lp-blue`. 작은 글자로 쓰는 블루는 `--ys-accent-text`(같은 색상을 85%로 어둡게 섞은 값)로 대비를 지킨다. 메인 키 컬러는 바뀔 수 있으니 화면 코드에 hex를 쓰지 않고, 옅은 바탕·선·빛은 `color-mix(in srgb, var(--ys-accent) N%, transparent)`로 파생한다. 잉크와 흰색 위에서만 쓴다. |
| 빨강 | **브랜드 강조로 쓰지 않는다.** 전역 YAGI v1.2(primary RED `#ED1E1E`)는 TWINGS 화면에 적용하지 않는다. 오류·삭제 같은 진짜 의미 상태에만 낮은 채도의 상태색을 남긴다. |
| 층위 | 갤러리 알라바스터 `#F8F9FA`(바탕) / 퓨어 화이트 `#FFFFFF`(작업 면·카드) |
| 이징 | spring 토큰 하나. CSS `linear()` 스프링을 쓰고, `cubic-bezier(0.22, 1, 0.36, 1)`을 폴백으로 둔다. `linear`와 기본 `ease`는 쓰지 않는다. |
| 의존성 | 모션 라이브러리는 없다(`framer-motion` 미설치). 새로 넣지 않는다. Shared layout은 View Transitions API(`view-transition-name`)나 FLIP으로 만든다. |

## 1. 상황별 판단 원칙

**한 화면에 모든 기법을 넣지 않는다.** 화면마다 목적을 먼저 정하고, 그 목적에 맞는 기법 3–4개만 고른다. 새 컴포넌트나 화면을 만들 때는 커밋 본문이나 PR 본문에 "고른 기법 3–4개와 이유"를 먼저 적는다.

### 1-1. 랜딩·스토리텔링 (`/brands`, 마케팅 페이지)
- **목표:** 첫인상의 세련미. 분절된 도구 세 개를 하나로 합친다는 메시지를 시각으로 설득한다. 손으로 만지는 맛.
- **우선 기법:**
  - Asymmetric Bento Grid(라이브 미니 데모 내장)
  - Shared Layout Morphing
  - Blur-to-Sharp Reveal
  - Chromatic Cast Shadow
  - Cursor-Tracking Iridescent Sheen
  - Architectural Hairlines & Crosshairs

### 1-2. 워크스페이스 관리 화면 (brand.twings.app 홈·캠페인·후보·라이브러리·멤버·설정)
- **목표:** 미디어가 주인공인 조용한 작업 공간. Playbook 앱 UI가 기준이다.
- **기준 구성:**
  - 연회색 바탕 위 큰 라운드 바깥 프레임
  - 회색 아이콘 사이드바
  - 큰 볼드 제목과 개수 칩
  - 한 줄 pill 툴바
  - 라운드 미디어 그리드
- **쓰지 않는 것:** 오른쪽 레일. 활동·최근 작업 레일도, 탭 옆에 붙는 대화 패널도 두지 않는다(대표 2026-10-29, TASTE.md).
- **우선 기법:**
  - Gallery Passepartout Framing
  - Multi-Layered Daylight Shadow
  - Double-Ring Specular Border
  - Cursor-Tracking Spotlight(카드)
  - Tabular Numerals
  - Concentric Radius

### 1-3. 스튜디오·캔버스 작업창 (brand.twings.app 스튜디오, 미리보기·뷰어)
- **목표:**
  - 업로드한 브랜드 에셋의 색이 왜곡되지 않는다(무채색 크롬).
  - 오래 작업해도 눈이 피로하지 않다.
  - 포토샵·피그마급의 정밀한 조작감.
- **우선 기법:**
  - Alabaster/White 층위 분리
  - Frosted Milky Quartz + Double-Ring Bevel(떠 있는 툴바)
  - Dynamic Contextual Island
  - Recessed Tactile Wells(입력 슬롯·슬라이더)
  - Tabular Numerals
  - Concentric Squircle Radius
  - Ambient Color Bleed(선택한 에셋의 주색)
- 마키·지우개·모델 셀렉터는 아직 코드에 없다. 그 기능이 생길 때 Dynamic Contextual Island를 적용하고, 지금은 기존 툴바와 액션바에 적용한다.

## 2. 툴박스

### A. 표면·빛·유리
- **Frosted Milky Quartz**
  - 반투명 흰 패널 `rgba(255,255,255,0.75)` + `backdrop-filter: blur(20px) saturate(180%)`. 아래 에셋 색이 수채화처럼 비친다.
  - 대상은 오버레이(드롭다운·모달·시트·sticky 툴바·떠 있는 HUD)다.
  - `@supports` 폴백은 불투명 흰 면.
- **미디어 위 다크 유리**
  - 썸네일 위 칩(재생시간·버전·반응 수)과 뷰어 HUD처럼 사진·영상 위에 올라가는 작은 요소만 `rgba(18,18,22,0.65)` + `blur(24px) saturate(190%)`를 쓴다.
  - 셸 자체는 어둡게 만들지 않는다.
- **Double-Ring Specular Border**
  - 바깥에 `1px solid rgba(0,0,0,0.06)`, 안쪽 위에 `inset 0 1px 0 0 rgba(255,255,255,0.9)`를 겹친다.
  - 다크 유리에서는 위 `rgba(255,255,255,0.18)` / 옆·아래 `0.05`의 그라데이션 헤어라인과 `inset 0 1px 0 0 rgba(255,255,255,0.12)`.
  - 패널에 단색 테두리만 두지 않는다.
- **Progressive Blur:** 스크롤 영역 위아래 경계에 `mask-image: linear-gradient` + `backdrop-filter: blur`를 둔다. 콘텐츠가 안개처럼 사라진다.
- **Multi-Layered Daylight Shadow:** 진한 그림자 하나 대신, 투명도 0.02–0.05의 확산 그림자 3–4겹.
- **Chromatic / Ambient Color Bleed**
  - 포커스된 에셋의 색이 바닥이나 배경에 은은하게 번진다(`filter: blur(120px)`, `opacity 0.15` 전후).
  - 주색은 16×16 다운샘플 canvas로 뽑는다. 같은 출처 이미지만 쓴다.
- **Recessed Tactile Wells:** 프롬프트 입력창, 레퍼런스 이미지 슬롯, 슬라이더 트랙은 안으로 파인 음각(inset shadow). 노브는 양각 세라믹.
- **Subtle Film Grain**
  - 디지털의 차가움을 눌러야 하는 바탕에만 SVG fractal noise `opacity 0.015–0.02`.
  - 정적이어야 하고, `pointer-events: none`, `aria-hidden`.

### B. 공간 구획·프레이밍
- **Architectural Hairlines & Crosshairs:** 무거운 박스 대신 `1px solid rgba(0,0,0,0.06)` 실선. 교차점에 작은 `+`.
- **Gallery Passepartout Framing:** 에셋 둘레에 넉넉한 여백을 둬서 액자 속 작품처럼 보이게 한다.
- **Concentric Border Radius:** 바깥 반경 = 안쪽 반경 + 패딩.

### C. 모션·조작감
- **Shared Layout Morphing:** 선택 영역이 입력 슬롯으로 이동할 때, 탭 인디케이터가 움직일 때 쓴다. 형태가 끊기지 않게 모핑한다. 구현은 View Transitions API 또는 FLIP.
- **Dynamic Contextual Island:** 도구 모드를 바꾸면 떠 있는 툴바가 스프링으로 늘어나면서 그 모드의 컨트롤을 보인다. 예: 크기·경도 슬라이더, 브러시 미리보기 원.
- **Blur-to-Sharp Staggered Reveal:** 결과물이나 핵심 섹션이 `blur(8px)`에서 `blur(0)`으로 초점이 맞듯 나타난다.
- **Cursor-Tracking Spotlight / Iridescent Sheen**
  - 위임 `pointermove` 리스너 하나와 rAF로 `--mouse-x`, `--mouse-y`를 갱신한다.
  - 흰 카드 위에서는 흰 빛이 보이지 않는다. 블루·잉크의 아주 옅은 틴트를 쓴다.
  - `(hover: hover) and (pointer: fine)`에서만 켠다.
- **Spring Physics:** 호버, 드롭다운 열림, 슬라이더에 spring 토큰을 쓴다.

### D. 타이포그래피·정밀도
- **Pretendard Variable 대비:** 헤드라인은 무겁고 좁게, 본문은 편하게.
- **Tabular Numerals & Mono 배지**
  - 수치에는 전부 `font-variant-numeric: tabular-nums`. 대상: 퍼센트, 해상도(1K·2K·4K), 크레딧, 좌표, 팔로워 수, 날짜.
  - 단위 배지는 고정폭으로 둬서, 숫자가 바뀌어도 레이아웃이 흔들리지 않게 한다.

## 3. 지켜야 할 한계

- `backdrop-filter`는 오버레이, HUD, 미디어 위 칩에만 쓴다. 그리드 카드 전체에 걸지 않는다. 한 화면에서 동시에 흐리는 층은 6개 안팎까지.
- `prefers-reduced-motion`이면 스프링, 리빌, 스포트라이트를 끄고 바로 최종 상태를 보인다.
- 유리 위 텍스트는 WCAG AA 대비를 넘겨야 한다. 키보드 포커스 링은 블루로 분명하게 보이게 한다.
- 터치 기기에서는 커서 효과를 쓰지 않는다.
- 서드파티 화면(Playbook 등)은 참고만 한다. 이미지와 문구를 가져오지 않는다.
