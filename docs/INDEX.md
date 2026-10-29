# docs/ 색인 — 무엇을 언제 읽는가 (2026-10-23)

처음 오는 에이전트는 **AGENTS.md → 이 색인 → 작업 영역의 원본 문서** 순서로 읽는다. 전부 읽지 않는다. 한 작업에 보통 2~3개면 충분하다.

## 항상 (규칙·설계 원본)
| 문서 | 읽는 때 |
| --- | --- |
| `../AGENTS.md` | 모든 작업 전. 규칙·역할·검증 루프·현재 상태(§6). |
| `PLATFORM-2.0.md` | 2026-10-22 이후 모든 제품 작업. 결제 감사(§2), 첫 경험(§3), 셀카(§4), 앱(§5), 인플루언서·브랜드(§6), 메이커 레시피(§7), 수익(§8), 단가(§9), 관리자(§10), 단계(§12), **대표 결정 대기(§13)**, 호칭(§14, 확정값은 §14.2), 디자인 크리틱(§15), brand 개편(§16), 인플루언서 결정(§17), 레시피 v2 실행(§18), **앱 결제·구독·크레딧 결정(§19, 2026-10-28)**. |
| `TEMPLATES-IA.md` | 정보구조와 §12의 포지션·과금·자산 경로 결정. 뒤집지 않는다. |
| `../lib/legal/documents.ts` | 약관·환불·개인정보. 절차를 설명하는 문구는 여기와 같아야 한다. |
| `SETUP.md` | 환경변수·로컬 모드·배포 전제. |
| `design/TASTE.md` | UI를 만들거나 고치기 전. 대표가 좋다·싫다고 한 화면 판정의 원장. 새 판정은 같은 PR에서 한 줄 추가. |
| `design/TOOLBOX.md` | UI 작업 전. 화이트 모드 고정값(블루 `#0000EE` 하나, 레드 금지)과 화면 목적별로 3–4개만 고르는 기법 목록. |
| `CONTENT-SLOTS.md` | 히어로 릴·증거 2-up 같은 미디어 슬롯(환경변수) 규칙. |

## 결제
| 문서 | 읽는 때 |
| --- | --- |
| `TOSS-CONTRACT.md` | 수수료·정산·한도·계약 진행 상태의 원본. |
| `qa/toss-checkout/README.md` | 결제 흐름·종결 규칙·웹훅·운영 개시 순서. |
| `qa/toss-checkout/PG-REVIEW-MODE.md`, `REVIEW-ACCOUNT.md`, `SUBMISSION-2026-10-21.md` | 심사 모드(`review`)와 심사 계정, 심사 경과. |
| `CREATOR-RESOLUTION.md`, `CREATOR-SUBSCRIPTION.md` | 원가 플로어(5%)·해상도 가격·월 구독 설계(미출시). |
| `SECONDARY-USAGE.md` | 브랜드 2차 활용 결제. |

## 얼굴 사진·렌더
| 문서 | 읽는 때 |
| --- | --- |
| `IDENTITY-SELFIE.md` | 현재 계약: 셀카 N장·시트·주문 계보. |
| `IDENTITY-PORTRAIT.md`, `IDENTITY-PORTRAIT-QA.md` | 과거 생성형 기준 사진(읽기 전용 표). 새 작업에서 되살리지 않는다. |
| `BEAUTY-TEMPLATE.md` | 템플릿별 참조 이미지가 하드코딩된 예(레시피 v2가 대체할 것). |
| `RUNBOOK-deletion.md` | 계정·사진 삭제 절차. |

## 메이커(템플릿 메이커)·커뮤니티
| 문서 | 읽는 때 |
| --- | --- |
| `CREATOR-PLATFORM.md` | 플랫폼 테이블·80/20 정산·이미지 보상 크레딧·플래그. |
| `qa/catalog-makers/PR.md`, `qa/recipe-v2/PR.md` | 카탈로그 분리·메이커 프로필(PR #94)과 레시피 v2(PR #95)의 구현 범위·검증·남은 위험. 해당 화면을 만질 때 먼저. |
| `CREATOR-ONBOARDING-PLAN.md`, `CREATOR-ONBOARDING-REVIEW-NOTES.md`, `qa/creator-onboarding.md` | 지원·작업공간·정산 현황 화면(PR #79). |
| `CREATOR-PROFILE.md` | 계정 페이지·SNS 주소 저장(인증 아님). |
| `SECURITY-RESEARCH-2026-10-15.md` | 레시피 비공개·DTO 허용 목록 등 보안 선택. |

## 캠페인·브랜드
| 문서 | 읽는 때 |
| --- | --- |
| `CAMPAIGNS.md` | 캠페인 도메인·상태 머신·브랜드 의뢰 폼·알림·랜딩. |
| `AUDIENCE-RENOVATION.md` | 크리에이터/브랜드 진입 분리(2026-10-07)와 모바일 헤더 규칙. |
| `plans/KAIPER-*.md` | 브랜드 셀프서비스(초대 링크→인플루언서→TWINGS 선정) 설계·검증. Phase 3의 출발점. |
| `BRAND-SHORTLIST.md` | 캠페인 크리에이터 후보 공유(가져오기 계약·고객에게 안 가는 항목·선호 표시). |
| `BRAND-*.md`, `CAMPAIGN-REPORTING.md`, `WORKSPACE-HOST-ROUTING.md` | brand.twings.app 워크스페이스·호스트 라우팅·리포트·게시물 수집·인증. 해당 화면을 만질 때만. |

## 앱·SEO·운영
| 문서 | 읽는 때 |
| --- | --- |
| `qa/app-shell/README.md` | 설치형 셸·푸시 검증과 운영 전제(VAPID 키). |
| `SEO-GEO.md` | 구조화 데이터·사이트맵·llms.txt 점검 기준. |
| `SERVER-HANDOFF.md`, `WORKSPACE.md` | 워크스테이션·worktree 사용 규칙. |
| `VERSIONS.md` | 버전 고정 이유. |
| `../supabase/README.md` | 마이그레이션 규칙과 **운영 적용 이력**. |

## 기록(참고용, 작업 전 필독 아님)
`HANDOFF-2026-09-17.md`, `PRODUCTION-ROLLOUT-2026-09-23.md`, `WORDING-REVIEW-2026-09-20.md`, `copy-review-2026-09-20.csv`, `BRAND-CLOUD-MIGRATIONS-2026-09-20.md`, `reviews/`, `research/`, `evidence/`, `wording/`, `product/`, `qa/` 아래 나머지 검증 기록.

## PR 열기·병합 (이 PC에 `gh` 없음)
`node scripts/gh-pr.mjs checks <pr>…` · `create <head> <base> "<title>" <bodyfile|branch:path>` · `merge <pr>` · `comment <pr> <file>` · `retarget <pr> <base>` · `close <pr>`. git에 저장된 github.com 자격 증명을 쓰고 값은 출력하지 않는다. `merge`는 체크가 전부 초록이고 mergeable일 때만 병합 커밋을 만든다.
