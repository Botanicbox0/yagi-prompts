# Argon(Antigravity) 미감 분석·개선 프롬프트 — /brands 랜딩 v7

> 대표가 Antigravity의 Argon에게 그대로 붙여 넣는 프롬프트다. 아래 ``` 블록 전체를 복사한다.

```
너는 TWINGS for Brands 랜딩(/ko/brands, /en/brands)의 미감 디렉터이자 프론트엔드 디자이너다. Awwwards SOTD 수준의 감도를 목표로, 지금 만든 v7을 분석하고 직접 개선해라. 결과물은 PR 하나다.

## 0. 작업 위치와 규칙
- 저장소: GitHub Botanicbox0/yagi-prompts. v7은 2026-10-30에 main으로 운영 배포됐다(PR #115·#116).
- 작업 공간: `git worktree add D:\dev\.worktrees\twings\landing-v7-polish -b codex/brand-landing-v7-polish origin/main`으로 새로 만들고, 그 폴더에서 먼저 `npm ci`를 한다. D:\dev\twings 본 폴더와 다른 세션의 작업 공간은 건드리지 않는다.
- PR은 main으로 연다. main에 직접 push하지 않는다. 병합은 대표 또는 Director가 한다. main에 들어가면 곧바로 twings.app에 배포된다.
- 이 PC에는 gh가 없다. PR은 `node scripts/gh-pr.mjs create …`로 연다. GitHub Actions가 결제 문제로 돌지 않을 수 있으니, 아래 로컬 검증 결과를 PR 본문에 적는다.
- 먼저 읽을 것(순서대로):
  1. AGENTS.md (특히 §3 검증 루프, §5 문안·브랜드 규칙, §11)
  2. docs/design/TASTE.md — 대표가 좋다·싫다고 한 것. 반드시 지킨다.
  3. docs/design/TOOLBOX.md §0, §1-1 — 화면마다 기법 3~4개만. 빨강 금지. 블루 하나.
  4. lib/design/identity.ts — 디자인 아이덴티티의 원본. 색·서체·모션·이미지 색 대역·하드라인. 값을 바꾸면 components/brand-studio/v7.module.css의 .identity도 같이 바꾸고 tests/design/identity.test.ts가 통과해야 한다.
  5. docs/BRAND-ENGINE.md — 이 페이지가 파는 것(브랜드만의 AI 미디어 엔진: 고정 층 + 바뀌는 것).
  6. docs/research/brand-landing-2026-10-30/reference-teardown.md — daylightcomputer.com 등 레퍼런스 해부(스크린샷 경로 포함).
  7. docs/wording/brand-landing-2026-10-29.md, docs/wording/brand-landing-2026-10-30.md — 문구 원칙과 검토 기록.
- 코드: components/brand-studio/v7.tsx(서버 섹션), v7-client.tsx(클라이언트 섬: Reveal, Film, Compare, ChapterScene, PinnedTrack, EngineSwitch, Tabs, DemoDock), v7.module.css, app/(marketing)/[locale]/brands/page.tsx. 문구는 messages/ko.ts·en.ts의 brandLanding.v7(하드코딩 금지).
- 미디어: public/reel/landing/v7/ (히어로·지시서 컷·블루 월드 영상). 새 이미지를 만들 때 GPT Image는 쓰지 않는다. 인물은 가상 인물만. Pinterest·서드파티 이미지는 참고만, 공개·모델 입력 금지. YAGI 마크가 보이면 정확해야 한다(좌우 반전 금지).

## 1. 절대 지킬 것 (어기면 반려)
- 흰 바탕 유지. 포인트는 프렌치 블루 #3875C5 하나(글자는 #3063A7). 빨강 버튼·점·그라데이션 금지.
- 공개 페이지에 엔진·경쟁사 이름 금지(Higgsfield, Seedream, Seedance, Kling, Nano Banana, GPT Image, Midjourney, Runway 등).
- 숫자는 승인된 것만: 영상 9편 · 200만 뷰+ · 파생 오가닉 콘텐츠 300건+. 새 숫자·'수십 명' 금지. 가격·견적 링크 금지.
- 고객명은 이미 공개된 Morphic 사례만. 데이터 처리 약속(학습 미사용·즉시 파기·암호화 보관) 금지.
- 미구현 기능의 상태 표기(스튜디오에서 운영 중 / 곧 / 얼리 액세스 / 예시)를 지우지 않는다.
- 한국어는 합니다체 창업자 톤. 한 문장 한 생각, 나열은 둘까지, 의인화 금지, 같은 문형 반복 금지.
- prefers-reduced-motion에서 모든 움직임이 멈춘다. 모션 라이브러리 추가 금지(framer-motion 없음).

## 2. 분석 방법
1. npm ci → npm run db:local → npm run dev:free (3000). 또는 npm run build:local && npm run start:local.
2. 1440×900, 1920×1080, 390×844에서 스크롤을 90%씩 내리며 화면마다 캡처하고(Playwright), 각 장면의 첫인상을 3초 안에 적는다.
3. 같은 해상도로 reference-teardown.md의 daylightcomputer.com 캡처와 나란히 비교한다(색이 아니라 밀도·리듬·전환·타이포 스케일·인터랙션 감도).
4. 아래 기준으로 0~5점 채점하고, 3점 이하를 고친다.
   - 첫 화면(히어로): 범주가 3초 안에 읽히는가, 영상과 글이 겹치지 않는가, 문 세 개가 보이는가
   - 위계와 리듬: 섹션마다 한 장면 한 메시지인가, 여백이 일정한 리듬인가, 너무 긴가(현재 약 16 뷰포트)
   - 색: 사진들이 195–225° 쿨 대역에 모이는가, 따뜻한 사진이 화면당 하나를 넘지 않는가, 블루가 행동 지점에만 있는가
   - 타이포: 디스플레이 540/−0.052em이 한국어·영어 모두 아름다운가, 줄바꿈이 어색한 곳(특히 EN 히어로·마무리)
   - 인터랙션: 비교 끌기, 엔진 전환(비율 형태 변화), 고정 장면 3장 전환, 고정 가로 레일, 데모 버튼이 손맛 있게 반응하는가(스프링, 지연, 끊김)
   - 모바일: 고정이 풀린 상태의 순서와 밀도, 손가락 조작, 가로 넘침 0
   - 문구: AI처럼 읽히는 문장(대비 공식, 셋 나열, 명사형 제목, 번역투)
   - 접근성: 대비, 포커스 링, 키보드(←/→), 스크린 리더 라벨
5. 개선은 화면마다 기법 3~4개 원칙 안에서 한다. 새로 넣을 후보: 섹션 경계의 겹침 전환(다음 장면이 아래에서 덮기), 히어로 축소 아웃(scroll-driven, @supports 가드), 크리에이터 피드의 스케일 월(기울어진 타일이 큰 제목 위로 흐름), 결과물 탭의 자동 진행 바. 무거운 효과는 데스크톱 + 모션 허용에서만.

## 3. 결과물
- PR 하나(codex/brand-landing-v7-polish → main). 운영 중인 페이지이므로 병합 전 프리뷰 URL 캡처를 함께 둔다. 본문에:
  - 채점표(전/후), 화면별 전후 캡처 경로, 고른 기법과 이유
  - 바꾼 파일 목록, 건드리지 않은 규칙 확인
- 검증(전부 통과해야 완료):
  npx tsc --noEmit
  npx vitest run
  npm run build:local
  npm run start:local  (별도 터미널, 3000)
  npm run sweep:anon   ("SWEEP PASSED"가 나와야 한다)
- 문구를 바꿨다면 docs/wording/brand-landing-2026-10-30.md에 무엇을 왜 바꿨는지 적는다. 대표가 좋다/싫다고 한 판정이 새로 생기면 docs/design/TASTE.md 기록에 한 줄 추가한다.
- 대표 결정이 필요한 것(가격, 고객명, 약관·데이터 문구, 음악 라이선스)은 임의로 정하지 말고 PR 본문에 질문으로 남긴다.
```
