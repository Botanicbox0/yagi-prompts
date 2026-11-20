# docs/ 색인 — 무엇을 언제 읽는가 (2026-10-23)

처음 오는 에이전트는 **AGENTS.md → 이 색인 → 작업 영역의 원본 문서** 순서로 읽는다. 전부 읽지 않는다. 한 작업에 보통 2~3개면 충분하다.

## 항상 (규칙·설계 원본)
| 문서 | 읽는 때 |
| --- | --- |
| `../AGENTS.md` | 모든 작업 전. 규칙·역할·검증 루프·현재 상태(§6). |
| `../ARCHITECTURE.md` | 처음 오는 에이전트. 표면→호스트→route group→lib 41개→테이블 지도, 요청 흐름 3개, "어디를 고치면 되나", 이름 유산 읽는 법. 폴더별 한 줄 안내는 `app/`·`lib/`·`components/`·`tests/`의 README. |
| `BRAND-PRODUCT.md` | **brand.twings.app 제품화(2026-11-03~)의 단일 원본.** 대표 결정(플랜 3개 금액, 기능 정책 기본 개방·예외 차단, Argon 역할), 고정 층 스키마, 플랜·과금 제안, 노하우 이관, 단계, 대표 결정 대기. 근거는 `research/brand-product-2026-11-03/`. |
| `BRAND-STUDIO-V6-PLAN.md` | 브랜드 스튜디오 다음 단계(2026-11-15). 고객 정의, 지금 코드의 실제 상태(작동/가짜), 영상 버전 설계(§4), 편집기 원칙과 기능 순서(§5), 음악 위치(§6), PR 순서(§7), 대표 결정 대기(§8). |
| `BRAND-EDITING-STUDIO.md` | 편집 스튜디오 개선과 말로 편집(2026-11-18). 지금 편집 공간의 실제 상태와 결함(§1), 참고한 두 오픈소스의 구조·라이선스(§2), 가져올 것과 가져오지 않을 것(§3), 말로 편집 설계(§4), 조각 순서 E0~E7(§5), 대표 결정 대기(§8). |
| `BRAND-EDITING-STUDIO-V2.md` | 편집 스튜디오 구조 재설계와 시안(2026-11-20). 작업 공간 네 개(컷 편집 · 색 · 사운드 · 자막)가 미리보기 하나와 타임라인 하나를 둘러싸고, 각 공간이 "고칠 것"으로 열린다. 지금 편집기 감사(§1), 뼈대(§4), 작업 공간별 설계(§5), 분석과 비용(§7), 시안 여는 법(§10, 플래그 `BRAND_STUDIO_EDITOR_V2`), 조각 V0~V8(§11), 대표 결정 14개(§12), 대표 그림과 다를 수 있는 곳(§13). |
| `BRAND-SOUND-STUDIO.md` | 사운드 스튜디오 설계(2026-11-20, 엔진 확정판, 구현 전). 대표 결정(음악은 Sunra API의 Suno v6, 효과음은 ElevenLabs, 상업 이용)과 근거(§1), 고객에게 약속하는 것(§2), 엔진 입력·레인·잠정 크레딧(§3), 화면과 길이 도구·문구(§4), 권리·안전(§5), 기존 코드(§6), 엔진 어댑터와 조각 SS1~SS3의 구현 명세·스모크 테스트 견적(§7), 남은 대표 결정(§8), 대안 엔진(§9). 근거 파일은 `research/brand-sound-studio-2026-11-20/`. |
| `BRAND-CLIENT-WORK.md` | 영상 제작만 맡기는 고객의 여정(2026-11-15). 두 역할로 걸어 본 점검표(§1), frame.io 비교(§2), "프로젝트 하나, 가운데는 작업물" 방향(§3), PR 순서 A~H(§4), 대표 결정 대기(§6). "야기 팀과" 화면을 만지기 전에 읽는다. |
| `BRAND-ENGINE.md` | 브랜드 미디어 엔진의 포지션(고정 층 + 바뀌는 것, 2026-10-30). 랜딩 v7이 이 문서의 공개판. |
| `PLATFORM-2.0.md` | 2026-10-22 이후 모든 제품 작업. 결제 감사(§2), 첫 경험(§3), 셀카(§4), 앱(§5), 인플루언서·브랜드(§6), 메이커 레시피(§7), 수익(§8), 단가(§9), 관리자(§10), 단계(§12), **대표 결정 대기(§13)**, 호칭(§14, 확정값은 §14.2), 디자인 크리틱(§15), brand 개편(§16), 인플루언서 결정(§17), 레시피 v2 실행(§18), **앱 결제·구독·크레딧 결정(§19, 2026-10-28)**. |
| `TEMPLATES-IA.md` | 정보구조와 §12의 포지션·과금·자산 경로 결정. 뒤집지 않는다. |
| `../lib/legal/documents.ts` | 약관·환불·개인정보. 절차를 설명하는 문구는 여기와 같아야 한다. |
| `SETUP.md` | 환경변수·로컬 모드·배포 전제. |
| `design/IDENTITY.md` | **UI를 만들거나 이미지·영상을 생성하기 전 항상.** 색, 서체, 컴포넌트, 사진·영상 프롬프트 문법, 모델 역할의 고정 원본. |
| `design/TASTE.md` | UI를 만들거나 고치기 전. 대표가 좋다·싫다고 한 화면 판정의 원장. 새 판정은 같은 PR에서 한 줄 추가. |
| `design/TOOLBOX.md` | UI 작업 전. 화이트 모드 고정값(블루 `#3875C5` 하나, 레드 금지)과 화면 목적별로 3–4개만 고르는 기법 목록. |
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
| `CAST-CATEGORIES.md` | 누가 나오나요(혼자·둘이서·반려동물): `cast` 축, pet·partner 사진 자리, 슬롯 사진 수명, 둘이서 플래그, 화면. |
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
| `BRAND-MOAT-AND-STORAGE.md` | 브랜드 에셋·저장소 해자(2026-11-02). |
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
`HANDOFF-2026-09-17.md`, `PRODUCTION-ROLLOUT-2026-09-23.md`, `WORDING-REVIEW-2026-09-20.md`, `copy-review-2026-09-20.csv`, `BRAND-CLOUD-MIGRATIONS-2026-09-20.md`, `reviews/`, `research/`(조사 보고서 — `brand-product-2026-11-03/`는 BRAND-PRODUCT.md의 근거), `evidence/`, `wording/`, `product/`, `qa/` 아래 나머지 검증 기록. 루트 `PLAYBOOK-PLAN.md`는 2026-08-12 M0 계획(코드 주석의 "PLAN §n")이며 현행 설계가 아니다.

## PR 열기·병합 (이 PC에 `gh` 없음)
`node scripts/gh-pr.mjs checks <pr>…` · `create <head> <base> "<title>" <bodyfile|branch:path>` · `merge <pr>` · `comment <pr> <file>` · `retarget <pr> <base>` · `close <pr>`. git에 저장된 github.com 자격 증명을 쓰고 값은 출력하지 않는다. `merge`는 체크가 전부 초록이고 mergeable일 때만 병합 커밋을 만든다.
