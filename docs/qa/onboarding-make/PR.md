# feat(onboarding): 템플릿 결제 화면 정리·상태 문장 단일화·히어로 증거·시작 시트

브랜치 `claude/onboarding-make-d07eba` → base `main` (f837ca4).
PR 열기: https://github.com/Botanicbox0/yagi-prompts/pull/new/claude/onboarding-make-d07eba
기능 커밋 `215f3e69524a56a25366839cb7b5e3f3a4d8847e` (이 PR 본문 초안은 그 위의 문서 커밋).

## 왜

docs/PLATFORM-2.0.md §15 크리틱의 판정은 "증거의 순서"다. 지금은 설명 → 가격 → 결과이고, SOTA는 결과 → 한 번의 확인 → 결제다. 이 PR은 §15.3의 1·2·3번과 §3.2-1·2·3을 한 브랜치에서 고친다. 디자인 토큰(흰 바탕 · 파란 강조 · Pretendard)은 그대로다.

## 무엇이 바뀌나

**템플릿 페이지 = 결제 결정 화면 (P0, §15.3-1)**
- 바깥 H2 "이 장면을 내 얼굴로 만들어보세요", `#make` 링크 버튼, 엔진 칩(SEEDANCE 2.x)을 없앴다. 만들기 카드 하나가 가격 박스다: 가격 · 길이 · 비율 · 해상도 · **보통 N분** · 판매 상태 한 줄 → 스튜디오 → AI 한계 한 줄 + 환불 한 문장(`renders.notCharged` "생성이 최종 실패하면 결제 금액을 전액 환불합니다." 그대로). 정의 문단(GEO)은 카드 아래로.
- **보통 N분** = 같은 엔진·같은 길이의 최근 성공 `render_jobs`(최대 200건) 중앙값, 주문(`created_at`)→완성(`finished_at`). 10건 미만이면 이미지 2분 · 영상 5분. 정적 페이지와 같은 태그(`prompts`)·1h TTL로 캐시(`lib/twings/typical-wait.ts`, `cached-typical-wait.ts`). 운영은 아직 표본이 없어 기본값이 나간다.
- **모바일(≤768px) safe-area 하단 고정 바**(가격 + CTA 하나, `data-make-sticky`). `data-hide-tabs`로 설치앱 탭바를 비킨다. 스튜디오(사진·버튼 영역)가 화면에 들어오면 내려가 카드 버튼을 가리지 않는다(2026-10-07 "결제 버튼 위에 고정 UI 없음" 유지). 누르면 스튜디오로 스크롤하고 첫 버튼(셀카 시트 "이 사진으로 만들기" / 업로더 / 결제 / 로그인 / 알림)에 초점.
- 별점은 1건 이상일 때만 렌더("아직 등록된 유저 평가가 없어요" 제거).

**스튜디오 초기 상태 (§3.2-2)**
- `/api/renders/access` 응답 전에는 중립 스켈레톤(사진 3칸 · 한 줄 · 버튼 자리, `data-phase="pending"`). "닫힘"을 먼저 그리고 바꾸던 깜빡임이 사라진다. 실패하면 닫힘으로 확정.
- 비로그인(상점 열림): 드롭존 대신 기존 가이드 사진 3장(정면 · 밝은 곳 · 혼자) + 한 줄 + "로그인하고 만들기" 하나.
- 라이브: 카드 폭 한 열. 비율은 템플릿 기본값으로 접고 "다른 비율"로 펼친다. 결제 버튼은 채운 기본 버튼(금액 표시는 결제 확인이라 유지).
- 접근성: `data-studio-ai-note`의 0.7rem·opacity 45 → text-sm·`text-black/70`(약 8:1). 화질·비율 버튼, 뒤로 가기 링크, 하단 바 CTA, 시트 버튼 모두 44px 이상. 모션은 `motion-reduce`에서 꺼진다. 포커스 링은 전역 `:focus-visible` 그대로.

**판매 상태 문장 한 소스 (P1, §15.3-3)**
- 홈 히어로가 `RENDER_PIPELINE_PUBLIC` 대신 `storefrontOpen()`을 읽는다. 홈 · 템플릿 · 요금제가 같은 값으로 같은 사실을 말한다 — 열림: "지금은 (템플릿마다) 한 편씩 결제해 바로 만들 수 있습니다", 닫힘: "영상 생성은 공개 준비 중입니다". 지금 운영(`review`)에서 동시에 보이던 "공개 준비 중"/"지금 결제"/"준비 중"이 하나로 맞춰진다.
- 요금제: 파는 것이 먼저(`data-pricing-order`). 단건 카드가 위, 월 구독 비교는 "준비 중" 티저로 아래. 월 구독만 열린 경우에만 순서가 바뀐다. 월 구독 미리보기의 "구독 신청과 영상 생성은 아직 준비 중" 문장은 단건이 열려 있으면 "월 구독은 출시를 준비하고 있습니다. 그동안은 템플릿마다 한 편씩 결제해 만들 수 있습니다."로.
- 엔진명은 소비자 화면(템플릿 · 요금제 표 기준 문장 · FAQ a2 ko/en)에서 뺐다. 관리자·문서·JSON-LD는 그대로. 카탈로그 카드의 엔진 칩은 catalog-wait 세션 범위라 건드리지 않았다.

**증거 먼저 (P1, §15.3-2)**
- 홈 히어로 "셀카 → 장면" 2-up(`data-hero-evidence`) + "사진 한 장이면 됩니다." 제목과 CTA 사이에 들어가고 정의 문단은 그 아래로. **두 콘텐츠 슬롯이 모두 설정됐을 때만** 렌더 — 하나라도 비면 히어로는 지금 모양 그대로(운영 기본값).

**가입 직후 시작 시트 (§3.2-1)**
- `/{locale}/video`의 클라이언트 섬(`data-onboarding-sheet`). 정적 HTML은 비어 있고, `GET /api/account/onboarding`이 `{show:true}`(로그인 + `profiles.onboarded_at IS NULL`)일 때만 열린다. 세 장 "① 포맷을 고르세요 ② 정면 셀카 한 장 ③ 완성되면 알려드려요", 마지막 장에 "내 사진 미리 올려두기"(`/identity/selfie?next=/{locale}/video`) · "포맷 보러 가기". 건너뛰기 · X · Esc · 배경 · 두 버튼 어느 것으로 닫아도 `POST`가 한 번 기록(세션 필수 · Origin 일치 · 멱등, 두 번째는 `recorded:false`). 셀카 시트와 같은 모양·모션(모바일 바텀시트, 데스크톱 가운데 패널, `aria-modal`, Tab 가두기).

## 클라우드 적용 필요

- **`supabase/migrations/0054_core_profile_onboarding.sql`** — `alter table profiles add column if not exists onboarded_at timestamptz;` (머리 주석 CLOUD APPLICATION REQUIRED, glue 없음). 코드 배포 **전** 적용. 적용 전에는 GET이 오류를 삼키고 `{show:false}` → 시트가 안 열릴 뿐 다른 화면은 영향 없음.
- 백필은 일부러 하지 않았다: 이미 가입한 계정도 다음 `/video` 방문 때 한 번 본다(아래 대표 결정 2).

## 콘텐츠 슬롯 (docs/CONTENT-SLOTS.md §1b, `.env.example`)

```
NEXT_PUBLIC_HERO_EVIDENCE_BEFORE=   # 정면 셀카 (4:5 권장)
NEXT_PUBLIC_HERO_EVIDENCE_AFTER=    # 그 얼굴이 들어간 장면 스틸 (4:5 권장)
```

운영에는 설정하지 않는다(인물 미정). 로컬 QA 픽스처는 공개된 AI 생성 가이드 인물 `/images/portrait-guide/front-facing.webp` + 기존 템플릿 포스터 `/reel/campaigns/retro-phone-01.jpg` — 같은 사람이 아니며 레이아웃 확인용이다.

## 검증 (최종 코드, 기능 커밋 215f3e6)

| 단계 | 결과 |
| --- | --- |
| `npm run db:local` | ✓ (0054 포함 스냅샷) |
| `npx tsc --noEmit` | ✓ |
| `npx vitest run` | ✓ 290 파일 / 2,805 테스트 |
| `NEXT_PUBLIC_APP_URL=http://localhost:3011 npm run build:local` | ✓ |
| `PORT=3011 npm run start:local` + `SWEEP_BASE_URL=http://localhost:3011 npm run sweep:anon` | ✓ **SWEEP PASSED — 1064/1064** |

새 테스트(먼저 실패 확인 → 구현 → 통과): `tests/ui/make-screen.test.tsx`(단일 CTA · 가격 박스 구성 · 하단 바와 `data-hide-tabs` · 엔진명 없음 · `storefrontOpen()` off/review/on으로 세 곳 문장 · 요금제 순서), `tests/ui/template-ratings.test.tsx`, `tests/ui/hero-evidence.test.tsx`, `tests/onboarding/first-run-sheet.test.tsx`(정적 마크업 비어 있음 · 명시적 yes만 · 기록 한 번), `tests/routes/account-onboarding-api.test.ts`(익명 GET DB 미접근 · 익명 POST 401 · cross-origin/Origin 없음 403 · 첫 기록만 · DB 없음 503), `tests/db/profile-onboarding.test.ts`(0054 · 테이블 목록 불변), `tests/twings/typical-wait.test.ts`(중앙값 · 10건 미만 기본값 · 다른 엔진/길이/실패 제외). 갱신: `tests/ui/studio.test.tsx`(스켈레톤 우선, `initialAccess` seam), `tests/i18n/dictionary.test.ts`(`firstRun.progress` "1 / 3"은 양 언어 공통).

스윕 갱신: 템플릿 상세 `data-studio-closed` → `data-studio-pending`(정적 HTML은 스켈레톤), 가격 박스 · 사실 · AI 한계 · 환불 · 하단 바+`data-hide-tabs` · `href="#make"` · 링크 버튼/엔진 칩 부재 · "완성까지 보통 N분", 홈 `data-hero-evidence` 부재(슬롯 없음) · 판매 문장, 요금제 `single-first` · "Seedance" 부재, `/video` 정적 HTML에 시트 없음.

브라우저 확인(390px · 1440px, 로컬 dev): 첫 화면에 결과물 · 가격 · CTA, 하단 바 탭 → 스크롤 + 초점, 라이브 스튜디오 한 열 · 비율 접힘, 시트 열림 → "포맷 보러 가기"/Esc → GET `{show:false}` · 스크롤 잠금 해제, 가로 스크롤 없음.

## 캡처 (`docs/qa/onboarding-make/`)

`template-first-screen-390.jpg` · `template-make-card-390.jpg` · `template-live-studio-390.jpg` · `template-desktop.jpg` · `hero-evidence-390.jpg` · `hero-evidence-desktop.jpg` · `pricing-single-first-390.jpg` · `first-run-sheet-step1-390.jpg` · `first-run-sheet-step3-390.jpg` · `first-run-sheet-desktop.jpg`. 재현 방법은 같은 폴더 `README.md`.

## 건너뛴 검사 · 남은 위험

- **프리뷰 URL 없음**: 이 PC에 `gh`가 없어 PR을 열지 못했다. Vercel 프리뷰는 PR을 연 뒤 생긴다.
- 캡처는 dev 서버(왼쪽 아래 "N" 배지는 개발 표시)에서 찍었다. 운영 빌드에서는 익명 + 상점 닫힘 상태만 눈으로 봤다.
- 실제 셀카가 저장된 계정의 "이 얼굴로 만들까요?" 시트가 카드 폭(약 500px) 안에서 어떻게 보이는지는 로컬 픽스처에 저장된 셀카가 없어 업로더 상태로만 확인했다.
- `prefers-reduced-motion`은 클래스(`motion-reduce:`)와 `matchMedia`로 처리했고 에뮬레이션으로 따로 찍지는 않았다.
- JS가 꺼진 브라우저는 스켈레톤에서 멈춘다(이전에는 "닫힘"에서 멈췄다). 가격 박스·사실·환불 문장은 정적 HTML에 있다.
- `community.noRatings` 사전 키는 이제 화면에서 쓰지 않는다(다른 화면 재사용 여지로 남김).
- 0054 미적용 상태로 배포하면 시트만 안 열린다(오류 없음).

## 대표 결정 필요

1. **히어로 증거 인물**(§15.5-16): 대표 본인 또는 권리 정리된 내부 모델의 셀카 + 같은 얼굴의 장면 스틸 한 쌍. 정해지면 위 두 환경변수만 넣고 재배포. (참고: `/brands` 쇼케이스의 `public/reel/studio-demo/reference-selfie.jpeg` → `different-person.jpg`가 이미 공개된 실제 쌍이지만, 실존 인물의 소비자 히어로 사용 동의는 확인하지 못해 쓰지 않았다.)
2. **기존 계정에게 시작 시트를 보일지**: 지금은 백필 없이 모두 한 번 본다. 신규 가입자만 보게 하려면 0054에 `update profiles set onboarded_at = created_at where onboarded_at is null;` 한 줄을 더한다.
3. **템플릿별 before/after**(§15.3-2 후반): `prompt_items.media`의 zod 스키마는 `video · poster · audio`만 받아 `evidence` 항목을 추가하려면 스키마 · 미디어 라우트 · 관리자 업로드를 함께 바꿔야 한다 → 이 PR에서는 하지 않았다. 제안: `PromptMediaSchema`에 `evidence: { before: AssetRef, after: AssetRef }`(선택)을 더하고, 관리자 편집기에 두 칸, 템플릿 페이지 미디어 아래에 같은 `HeroEvidence` 컴포넌트. 공개는 권리 정리된 쌍만.
4. **결제 버튼 라벨**: CTA 라벨은 "내 사진으로 만들기"(비로그인 "로그인하고 만들기") 하나로 맞췄고, 사진을 고른 뒤의 결제 버튼은 결제 금액 표시를 위해 "5,900원 결제하고 만들기"를 유지했다. 이것까지 하나로 합칠지.
5. 사전 문안(시작 시트 세 장, 판매 상태 문장, 사진 예시 캡션)은 창업자 톤으로 썼다. 외부 발송 문안은 없다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
