# PG 심사 모드 (`RENDER_PIPELINE_PUBLIC=review`) — 2026-10-21

## 왜 필요한가 — 심사가 구조적으로 통과 불가능했다

토스페이먼츠 전자결제 심사 체크리스트([notice/20057](https://www.tosspayments.com/notice/20057))가 홈페이지에 요구하는 것:

1. 하단에 상호·사업자등록번호·대표자명·사업장 주소·유선번호(휴대폰 번호 허용)
2. **판매 가능한 상품 1개 이상**, 빈 카테고리 금지, 상품 이미지 정상
3. **테스트 API 키를 발급받아 신용카드 결제창 연동 완료**
4. 상품 금액과 결제 금액 일치

1번과 4번은 이미 충족한다. 2번과 3번이 막혀 있었고, 원인은 코드 한 줄이다.

```ts
// 이전 lib/flags.ts
if (env.VERCEL_ENV !== 'production') return true;
return live(env.TOSS_CLIENT_KEY) && live(env.TOSS_SECRET_KEY);  // live_ 키만 허용
```

운영에서 결제 경로는 **라이브 키가 있어야만** 열렸다. 그런데 라이브 키는 이 심사를 통과해야 발급된다
(개발자센터 → API 키 → 라이브: 비어 있고, 결제위젯 키는 아직 문서 예제 키 `test_gck_docs_…` 상태다.
"내 키는 전자결제 신청하고 확인할 수 있어요"). 심사를 통과해야 키가 나오고, 키가 있어야 심사를 통과한다.

그래서 twings.app의 모든 구매 경로가 "출시 준비 중 / 곧 열립니다 / 열리면 알림 받기"였고, 심사자는
상품을 살 수도, 결제창을 볼 수도 없었다. 체크리스트 2·3번 불충족이다.

## 무엇을 바꿨나

`RENDER_PIPELINE_PUBLIC`에 세 번째 상태 `review`를 두었다.

| 값 | 상점 화면 | 실제 결제·생성 | 운영에서 테스트 키 |
| --- | --- | --- | --- |
| (없음)·`off` | 닫힘 ("곧 열립니다") | 관리자만 | — |
| `review` | **열림** (가격 + 구매 CTA) | 관리자 + **심사 계정만** | **허용** |
| `on` | 열림 | 로그인한 모든 사람 | 금지 (라이브 키 필수, 그대로) |

- `review`는 **공개 판매 개시가 아니다.** 일반 고객은 로그인해도 기존처럼 닫힌 스튜디오를 본다.
  공개 판매는 여전히 `on`이고, 여전히 대표 결정이다 (AGENTS.md §6).
- 심사 계정 판별은 **Auth 서버가 쓰는 `app_metadata.purpose = 'toss_review'`** 하나뿐이다
  (`docs/qa/toss-checkout/REVIEW-ACCOUNT.md`, `lib/auth/review-login.ts`). 프로필 컬럼도,
  이메일 패턴도, 요청에 실린 값도 권한 판정에 쓰지 않는다. 등급·관리자 권한은 주지 않는다.
- 게이트는 `lib/auth/purchase-gate.ts` 한 곳이다. 렌더 큐, 토스 주문·승인 서비스, 동의 라우트,
  주문 페이지가 전부 같은 함수를 읽는다 — 한쪽만 열리는 일이 없도록.
- 로그인 전 화면은 `storefrontOpen()`이 따로 판단한다. 심사자는 먼저 익명으로 상품 페이지를 보고
  체크리스트 2번을 판정하기 때문이다. 이 상태에서 CTA는 "로그인하고 만들기"이며, 심사 계정으로
  로그인하면 실제로 결제까지 간다.
- JSON-LD `Offer`는 그대로 `RENDER_PIPELINE_PUBLIC`(공개 판매)만 따른다. 일반 고객이 실행할 수 없는
  재고 상태를 검색엔진에 알리지 않는다.

## 운영 적용

코드 배포가 아니라 환경 변경이다.

1. Vercel `yagi-prompts` → Settings → Environment Variables → Production에
   `RENDER_PIPELINE_PUBLIC = review` 추가
2. Production 재배포 (마케팅 라우트가 정적이라 CTA 문구는 빌드 시점에 결정된다)
3. `TOSS_CLIENT_KEY` / `TOSS_SECRET_KEY`는 **상점 전용 테스트 키**여야 한다. 문서 예제 키
   (`test_gck_docs_…` / `test_gsk_docs_…`)는 이 상점의 거래로 남지 않으므로 심사 근거가 되지 않는다.
   전용 위젯 키가 아직 없다면 개발자센터 → API 키 → 결제위젯 연동 키에서 발급 여부를 먼저 확인한다.
4. 심사 종료 후 이 변수를 **제거**한다. 심사 계정과 세션 정리는 `REVIEW-ACCOUNT.md` 5번을 따른다.

## 검증 (2026-10-21, 로컬)

| 검사 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 통과 |
| `npx vitest run` | **268 파일 / 2,550 테스트 통과** |
| `npm run build:local` | 통과 (스냅샷 재생성 후) |
| `npm run sweep:anon` (기본 모드) | **SWEEP PASSED — 980/980** |
| `npm run sweep:anon` (`RENDER_PIPELINE_PUBLIC=review`) | **SWEEP PASSED — 980/980** |
| review 빌드의 `/api/renders/access` (익명) | `open: true`, `live: false` |
| review 빌드의 템플릿 페이지 | CTA가 "열리면 알림 받기" → "내 사진으로 만들기"로 바뀜 |

새 테스트: `tests/billing/public-switch.test.ts`(세 상태와 게이트), `tests/auth/review-viewer.test.ts`
(심사 표시는 Auth 서버에서만 오고, 관리자에게는 붙지 않으며, 등급을 바꾸지 않는다).

실제 카드 승인·환불 재검증은 하지 않았다. 9월 19일 테스트 키 실카드 증거(`README.md`)가 최신이며,
이 변경은 그 경로의 **게이트만** 바꾸고 결제 로직은 건드리지 않았다.

## 남은 것 — 대표 확인 필요

- 상점 전용 테스트 위젯 키 발급 여부 확인 후 Vercel 키 교체
- 심사 신청서의 홈페이지 주소·심사 계정 ID/PW가 현재 배포와 일치하는지 확인
- 안심정산플랜 연이용권 결제 (상점관리자 배너) — 정산 수령 조건
- 구독(정기결제·빌링)은 별도 심사 항목이다. 현재 신청과 사이트 구성이 일치하는지는 §아래 참고
