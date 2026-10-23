# 첫 경험 "결정 화면" — QA (2026-10-23)

요구사항 원본: `docs/PLATFORM-2.0.md` §3.2, §15.1~15.3(1·2·3번). 브랜치 `claude/onboarding-make-d07eba`.

## 무엇이 바뀌었나

| 화면 | 바뀐 점 | 마커 |
| --- | --- | --- |
| 템플릿 페이지 | 바깥 H2·링크 버튼·엔진 칩 제거. 만들기 카드 하나 = 가격 박스(가격 · 길이 · 비율 · 해상도 · 보통 N분 · 판매 상태 한 줄) → 스튜디오 → AI 한계 한 줄 + 환불 한 문장. 정의 문단은 카드 아래로. | `data-template-price-box` `data-template-fact` `data-template-sale-state` `data-studio-ai-note` `data-template-refund` |
| 템플릿 페이지(≤768px) | safe-area 하단 고정 바(가격 + CTA 하나). 스튜디오가 화면에 들어오면 내려가고, 누르면 스튜디오로 스크롤 + 첫 버튼에 초점. `data-hide-tabs`로 설치앱 탭바를 비킨다. | `data-make-sticky` `data-make-cta="sticky"` `data-hide-tabs` |
| 스튜디오 초기 상태 | 접근 응답 전에는 중립 스켈레톤(사진 3칸 · 한 줄 · 버튼 자리). "닫힘"을 먼저 그리지 않는다. | `data-phase="pending"` `data-studio-pending` |
| 스튜디오 비로그인 | 드롭존 대신 사진 예시 3장(정면 · 밝은 곳 · 혼자, 기존 가이드 이미지) + 한 줄 + "로그인하고 만들기" 하나. | `data-studio-photo-examples` `data-studio-signin` |
| 스튜디오 라이브 | 한 열(카드 폭). 비율은 기본값으로 접고 "다른 비율"로 펼침. 결제 버튼은 채운 기본 버튼. | `data-aspect-toggle` `data-make-cta="card"` |
| 별점 | 1건 이상일 때만 렌더("아직 평가가 없어요" 제거). | `data-template-ratings` |
| 판매 상태 문장 | 홈 히어로 · 템플릿 · 요금제가 `storefrontOpen()` 한 값으로 같은 사실을 말한다(열림: "한 편씩 결제해 바로 만들 수 있습니다", 닫힘: "영상 생성은 공개 준비 중입니다"). | `data-creator-availability` `data-template-sale-state` `data-pricing-films` |
| 요금제 | 파는 것이 먼저: 단건 카드가 위, 월 구독은 "준비 중" 티저로 아래(월 구독만 열린 경우만 반대). 엔진명 제거. | `data-pricing-order` |
| 홈 히어로 | "셀카 → 장면" 2-up + "사진 한 장이면 됩니다." — 두 콘텐츠 슬롯이 모두 설정됐을 때만. | `data-hero-evidence` |
| 시작 시트 | `/{locale}/video`에서 `profiles.onboarded_at is null`인 로그인 계정에게 1회. 세 장, 건너뛰기, 닫으면(건너뛰기 · X · Esc · 배경 · 두 버튼) 한 번 기록. 정적 HTML에는 없다. | `data-onboarding-sheet` |

## 캡처 (이 폴더)

로컬 개발 서버(`npm run dev` 계열)에서 찍었다. 왼쪽 아래 "N" 배지는 개발 서버 표시라 운영에는 없다.

| 파일 | 상태 |
| --- | --- |
| `template-first-screen-390.jpg` | 390px 첫 화면: 결과물 + 가격 박스 + 하단 고정 바(가격 + "로그인하고 만들기"). 익명 · `RENDER_PIPELINE_PUBLIC=review` |
| `template-make-card-390.jpg` | 하단 바를 누른 뒤: 카드의 사진 예시 3장 + 한 줄 + CTA에 초점, 하단 바는 내려감 |
| `template-live-studio-390.jpg` | 라이브 스튜디오(운영자 픽스처): 비율 접힘 + "다른 비율", 화질, 결제 버튼, AI 한계 · 환불 |
| `template-desktop.jpg` | 1440px: 왼쪽 결과물, 오른쪽 제목 + 만들기 카드 |
| `hero-evidence-390.jpg` · `hero-evidence-desktop.jpg` | 히어로 증거(QA 픽스처 — 아래) + 열린 상점 문장 |
| `pricing-single-first-390.jpg` | 요금제: 단건 카드가 위, 월 구독 티저가 아래 |
| `first-run-sheet-step1-390.jpg` · `first-run-sheet-step3-390.jpg` · `first-run-sheet-desktop.jpg` | 시작 시트 1장 · 3장(바텀시트) · 데스크톱 가운데 패널 |

## 재현

```powershell
npm run db:local                      # 0054 포함 스냅샷
# 익명 + 열린 상점 + 히어로 증거 픽스처 (Git Bash라면 MSYS_NO_PATHCONV=1 — 아니면 /images/… 값이 Windows 경로로 바뀐다)
$env:PORT='3011'; $env:RENDER_PIPELINE_PUBLIC='review'
$env:NEXT_PUBLIC_HERO_EVIDENCE_BEFORE='/images/portrait-guide/front-facing.webp'
$env:NEXT_PUBLIC_HERO_EVIDENCE_AFTER='/reel/campaigns/retro-phone-01.jpg'
npx tsx scripts/run-local.ts dev      # /ko · /ko/t/neon-alley-dolly · /ko/pricing
# 시작 시트: 로그인 픽스처(onboarded_at = NULL)
npm run dev:free                      # /ko/video → 시트, 닫은 뒤 새로고침하면 다시 안 뜬다
```

히어로 증거의 QA 픽스처는 사이트에 이미 공개된 AI 생성 가이드 인물(`front-facing.webp`)과 기존 템플릿 포스터(`retro-phone-01.jpg`)다. **같은 사람의 셀카 → 장면이 아니다** — 레이아웃 확인용이다. 운영 인물은 대표 결정(PLATFORM-2.0 §15.5-16).

## 확인한 것 (브라우저)

- 390px: 첫 화면에 결과물 · 가격 · CTA가 함께 보인다. 하단 바 탭 → `#make`, 초점이 카드의 "로그인하고 만들기"로, 하단 바는 `data-make-sticky-state="away"`.
- 라이브 스튜디오: 비율 옵션은 `hidden`, "다른 비율"(44px)로 펼친다. 결제 버튼 48px.
- 시작 시트: GET `{show:true}` → "포맷 보러 가기" → GET `{show:false}`, 스크롤 잠금 해제. Esc로 닫아도 같은 기록. 새로고침 후 다시 열리지 않는다.
- 가로 스크롤 없음(390px, `scrollWidth === clientWidth`).
