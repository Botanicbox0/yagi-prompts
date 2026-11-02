# Fable 5.1 scope addendum

> 모델 제안 원문을 보존한 참고 기록이다. 아래의 ‘확정’ 및 우선순위 표현도 모델의 제안이며 대표 승인이나 최종 사양이 아니다. 실제 결정은 [설계·실행 기록](KAIPER-SELF-SERVICE.md)과 [설계 보정 기록](KAIPER-DECISIONS-AND-REVIEW.md)이 우선한다. 특히 0050/0135 대리 동의 스키마와 재동의에 따른 보상 교체는 구현하지 않았으며 대리 등록은 약관·동의 변경안만 준비했다.

# KAIPER-FABLE-PLAN.md 부록 A (2026-10-16, 답변 반영)

본 부록은 초기 계획을 대체하지 않고 정정·추가만 한다. 충돌 시 부록이 우선한다.

## A1. 확정·정정

- 브랜드 정본 표기는 **KAIPER**. 초기 계획의 kapier/kaiper 질문 종결.
- 운영 사실: 프로젝트 0, 계약 0, 0045/0130 미적용. §3.4 개방 게이트 유지, 어느 슬라이스도 이를 대신 충족하지 않는다.
- 마이그레이션 재배정: 0047/0132 초대·참여자 스레드(Sol 진행 중), 0048/0133 위험·Slack(Sol 진행 중), **0049/0134 캠페인 결제**, **0050/0135 대리 동의 기록**.
- 삭제: 이미지 크레딧 종류와 플래그 전부, 자동 확정 옵션, §2.3 "ConfirmCheck로 payout 덮어쓰기" 규칙.
- `ConfirmCheck`는 환불·회수(abandon)·링크 철회 세 동작에만 둔다. 그 외 확인 게이트는 만들지 않는다.
- 토큰 로그 금지: 조인 페이지에 `Referrer-Policy: no-referrer`, 요청 로그·오류 리포트·감사 행에는 토큰 sha256 앞 8자만 남긴다. 서버 액션 입력 덤프 금지.

## A2. 결함 수정: 보상 조건은 지원 시점에 고정

초기 계획은 선정된 지원이 있어도 확인 후 `campaigns.payout`을 덮어쓰게 했다. 이는 약관 §8.2 위반이므로 폐기한다.

- `campaign_applications`에 `payout_snapshot jsonb not null`, `payout_version int not null`, `consent_version`을 둔다. 지원 생성 트랜잭션에서 당시 `campaigns.payout`을 복사하며, 이후 갱신 트리거로 변경을 거부한다.
- `campaigns.payout_version`을 두고 제안 `accept`마다 1 증가시킨다. 승인은 상태·지원 수와 무관하게 항상 허용되지만 **이후 지원에만** 적용된다. 관리자 화면에 "기존 지원 N건은 각자 동의한 조건 유지"를 표시한다.
- 정산 계산(`payoutReleasable`, 지급 문장, 브랜드 합계)은 전부 `application.payout_snapshot`만 읽는다. `campaigns.payout`은 모집 페이지 표시와 신규 지원 복사 원본으로만 쓴다.
- 재동의: `campaign_payout_reconsents(application_id, payout_version, consented_at, request_id, unique(application_id,payout_version))`. 크리에이터가 본인 화면에서 새 버전을 명시 수락하면 스냅샷을 교체하고 이전 스냅샷은 `payout_snapshot_history`에 보존한다. 이번 구현은 테이블과 크리에이터 수락 화면까지이며, 브랜드·관리자가 대신 재동의시키는 경로는 없다.
- 테스트: 승인 후 payout 변경 시 기존 지원 금액 불변, 스냅샷 없는 insert 실패, 스냅샷 update 거부, 재동의 전후 금액 차이, 크리에이터 DTO에 타 버전 노출 없음.

## A3. 캠페인 결제 슬라이스 S7 (0049/0134)

원칙: **브랜드 입금(브랜드→TWINGS)과 크리에이터 지급(TWINGS→크리에이터)은 테이블·상태·화면이 전부 분리**된다. 지급 어댑터는 없으며 기존 수동 지급 기록을 그대로 쓴다. 입금 완료는 캠페인 공개·제작·지급의 조건이 아니다.

재사용: `lib/brands/usage/payment.ts`의 claim → confirm → settle 분기표, lease·backoff·batch 상수, `TossGateway`, `usagePaymentsOpen` 형태의 런타임 가드. `core.ts` 헬퍼는 usage 테이블에 묶여 있으므로 `lib/campaigns/funding/core.ts`에 테이블명만 바꿔 복제한다. 소비자 `billing_payments`, 렌더 주문, `brand_usage_*` 테이블·장부는 읽거나 쓰지 않는다.

테이블(전부 RLS force, service_role만, `request_id`·`revision` 포함):

```
campaign_funding_cases   id, campaign_id, organization_id, project_id,
  status(draft|quoted|accepted|paid|fulfilled|review|refund_pending|refunded|closed)
campaign_funding_quotes  id, case_id, revision, line_items jsonb, subtotal_krw, vat_krw,
  total_krw, tax_basis('included'), valid_until, status(proposed|accepted|superseded|expired),
  accepted_by, accepted_at, consent_version
campaign_funding_payments  brand_usage_payments와 동일 컬럼: environment, amount_krw,
  order_name, payment_key, status(pending|confirming|paid|failed|expired|review|
  refund_pending|refunded), lease_until, failure_code, expires_at, consent_*
campaign_funding_events  case_id, kind, actor_role, actor_id, quote_id
```

흐름:

1. **견적**: 관리자 오퍼레이션 `campaignFunding.quote`. 항목명·금액을 관리자가 입력하고 서버가 VAT·합계를 계산한다. 단가 정책이 없으므로 자유 항목이며 브랜드는 금액을 입력할 수 없다. 새 견적은 이전 `proposed`를 `superseded`로 만든다.
2. **수락**: 브랜드 owner만. 동의 체크와 `consent_version`을 받고 revision을 고정한다. `valid_until` 경과 시 수락 거부.
3. **체크아웃**: 주문은 `createUsageOrder`와 같은 규칙으로 서버가 만들고, 주문명은 `TWINGS 캠페인 · {프로젝트명} #{revision}`이다. 브라우저 금액은 일치 검증만 한다. 테스트 키와 로컬 fake는 preview·local에서 돈다. production은 `CAMPAIGN_FUNDING_PUBLIC`과 live 키가 모두 있어야 열리고, 환경 불일치는 `payments_closed`다.
4. **확인**: `confirmUsagePayment`와 같은 claim→confirm→settle. DONE 전액만 `paid`, 불일치·잔액 이상은 `review`, 거절·만료는 `failed`, 타임아웃은 claim 유지.
5. **조정**: 기존 일일 tick에 `reconcileCampaignFunding`을 추가하고 관리자 오퍼레이션 `campaignFunding.reconcile`로도 호출한다. `paid` 이후 자동 동작은 `fulfilled` 전이와 이벤트 기록뿐이다.
6. **환불**: 관리자 `campaignFunding.resolve(refund|abandon)`만. 사유 필수, 전액 환불만, `ConfirmCheck` 적용. 환불돼도 크리에이터 지급 기록은 건드리지 않는다.

지급과의 연결: 관리자 지급 화면에 "브랜드 입금 확인" 배지만 보인다. 지급 가능 조건에 넣지 않되, 입금 미확인 상태의 지급 기록은 다음 할 일에 경고 항목으로 올린다.

UI:

- 브랜드 `/brand/projects/[id]` "결제" 탭: 견적 카드(항목·VAT·합계·유효기간·상태), 수락 폼(동의 체크, 약관 링크), 결제 버튼(환경 배지 "테스트 결제"), 결제 상태 칩(대기·확인 중·완료·검토 중·실패·환불됨). 체크아웃 `/brand/projects/[id]/funding/[orderId]`, success·fail 복귀는 `return-path` 검증.
- 관리자 캠페인 상세 결제 패널: 견적 작성 폼, 상태, 조정 버튼, 해결 폼. 다음 할 일: 검토 중 결제, 환불 대기, 견적 유효기간 3일 이내.
- 스윕 마커 `data-campaign-funding`. 사전 키 전부 `messages/*`, 금액·조건 문장은 약관 초안과 동일 문구.

테스트: 금액 조작 `amount_mismatch`, 환경 불일치 거부, 같은 case 동시 주문 1건, 타임아웃 후 reconcile로 `paid`, 불일치 스냅샷 `review`·환불 가능, 10회 주문 상한, `paid`가 캠페인 상태·제작·지급 행을 바꾸지 않음, 브랜드 DTO에 payment_key 없음, 크리에이터 DTO에 결제 정보 전무, 크로스 오리진 POST 거부.

**제공사 정책 확인 필수(법적 결론 아님):**

- 토스 가맹점 심사는 "템플릿 1편 결제" 상품으로 통과했다. B2B 캠페인 대금을 같은 MID·업종으로 받을 수 있는지, 상품 추가 심사 필요 여부.
- 카드 결제 시 세금계산서·현금영수증 발행 규칙(중복 발행 불가 여부)은 회계 확인.
- KB 에스크로가 B2B 선결제에 적용되는지.
- 지급대행은 별도 계약·seller 등록·크리에이터 사업자 여부 확인 전까지 어댑터를 만들지 않는다.

## A4. 대리 얼굴 등록 동의 S8 (0050/0135): 기록만

범위는 제안·동의·검토 기록과 화면이다. `lib/identity`·`lib/ark`의 소유자 검사, 계정당 1 자산 그룹, 라이브니스, 제공사 검수를 한 줄도 바꾸지 않는다. 실행 플래그나 생성 코드 경로 자체를 만들지 않으며, 테스트로 `lib/identity`·`lib/ark`·`lib/renders`에서 아래 테이블 참조가 0건임을 고정한다.

```
likeness_delegation_proposals  id, organization_id, campaign_id, project_id,
  subject_user_id(TWINGS 계정 필수), proposed_by, scope jsonb{formatIds, period, purposes,
  channels, region}, status(proposed|consented|declined|withdrawn|expired|revoked),
  consent_version, request_id, revision
likeness_delegation_consents   id, proposal_id unique, subject_user_id, consented_at,
  consent_version, text_hash(sha256), revoked_at, revoke_reason
likeness_delegation_reviews    proposal_id, reviewer, legal_ok bool null,
  provider_ok bool null, note, reviewed_at
```

- 동의는 **본인 계정으로만** 가능하다. 브랜드가 대신 동의하거나 사진을 올리는 경로는 없다. 미성년·공인 금지는 약관 §5.2 그대로다.
- UI: 브랜드 "크리에이터" 탭에서 선정된 참여자에게만 제안, 크리에이터 `/campaigns/mine`에서 범위 문장을 읽고 동의·거절·철회, 관리자 검토 패널은 법무·제공사 체크 두 칸과 메모만 있고 실행 버튼이 없다.
- 제공사 확인 필수: BytePlus 인물 자산 그룹 1계정 1그룹과 실인물 대조 정책이 위임 생성을 허용하는지, 제3자 얼굴 업로드 약관, 동의 기록 보관 요구.

## A5. 약관 변경안 (검토용, 미발효)

`lib/legal/documents.ts`에 `LEGAL_DRAFTS` 객체를 별도로 두고 `LEGAL_EFFECTIVE`와 `DOCUMENTS`는 건드리지 않는다. `/legal/*`에 노출하지 않으며 `/admin/legal-drafts`에서만 "검토용 초안 · 미발효" 띠와 함께 렌더한다. 다음 문안은 대표·법무 검토 전 효력이 없다.

**이용약관 제4조의2 (브랜드 캠페인 대금) [초안]**
① 브랜드는 회사가 제시한 견적서의 항목·금액·유효기간을 확인하고 수락한 뒤 결제합니다. 금액은 부가가치세를 포함한 총액이며 결제 화면에서 변경되지 않습니다. ② 결제 완료는 캠페인 공개, 크리에이터 선정, 결과물 제작, 원고료 지급 중 어느 것도 자동으로 발생시키지 않으며, 각 절차는 회사의 검수와 운영 일정에 따릅니다. ③ 결제 수단 정보는 결제대행사가 처리하며 회사 서버에 저장되지 않습니다.

**이용약관 제5조 제7항 (대리 등록·제작 동의) [초안]**
회사는 크리에이터 본인이 자신의 계정에서 인물·브랜드·캠페인·포맷·기간·용도를 특정하여 명시적으로 동의한 경우에 한해, 브랜드 캠페인을 위한 대리 제작을 검토할 수 있습니다. 동의는 언제든 철회할 수 있으며, 동의가 있더라도 제3항의 검증 절차와 AI 엔진 제공자의 정책에 부합하지 않으면 제작하지 않습니다.

**이용약관 제8조 제2항 수정 [초안]**
원고료 규칙은 지원 시점에 캠페인 페이지에 표시된 내용으로 각 지원마다 확정되며, 이후 캠페인 조건이 바뀌어도 크리에이터가 새 조건에 별도로 동의하지 않는 한 변경되지 않습니다.

**환불정책 제8항 (브랜드 캠페인 대금) [초안]**
캠페인 대금은 크리에이터 선정 전까지 전액 환불합니다. 선정 이후에는 회사와 브랜드가 별도 합의한 조건에 따르며, 이미 지급된 원고료에 해당하는 금액은 환불되지 않습니다. 환불은 원래 결제 수단으로 처리합니다.

**개인정보처리방침 §4·§5 추가 [초안]**
§4: 대리 제작 동의 시 동의 범위·일시·문안 버전을 해당 브랜드에 전달합니다. §5: 결제대행사란을 "토스페이먼츠 주식회사 (한국)"으로 명시하고 "캠페인 대금 결제"를 위탁 업무에 추가합니다.

## A6. 위험 검토함과 Slack

- 채널 `twings-risk-review` `C0C9DRS4DT7`은 환경변수 `SLACK_RISK_CHANNEL_ID`와 봇 토큰으로 연결한다. 채널 존재는 연결 완료가 아니며 S5 테스트 통과 후 관리자 화면에 "최근 전송 성공 시각"이 보여야 연결로 본다.
- 전송은 `risk_notifications(flag_id unique, status, attempts, last_error_code, sent_at)` outbox 행을 플래그 생성 트랜잭션에 넣고 `after()`로 보낸다. 실패는 reconcile tick에서 재시도한다. `last_error_code`로 감지 실패와 전송 실패를 구분한다.
- Slack 본문은 플래그 ID, 카테고리, 신뢰도, 캠페인 slug, 관리자 링크뿐이다. 원문·이름·계좌·결제 키·첨부는 보내지 않으며, Slack의 버튼·답장은 입력으로 받지 않는다.

## A7. 슬라이스 순서와 게이트 갱신

| 순서 | 슬라이스 | 번호 | 플래그 |
| --- | --- | --- | --- |
| S1·S4 | 초대·참여자 스레드 (Sol 진행 중) | 0047/0132 | `CAMPAIGN_INVITES_PUBLIC`, `CAMPAIGN_THREADS_PUBLIC` |
| S5 | 위험·Slack (Sol 진행 중) | 0048/0133 | `RISK_SCAN_ENABLED` |
| S2 | 운영 모드 홈·스테퍼 | 없음 | 없음 |
| S3 | 보상 제안·불변 스냅샷·재동의 | 0048/0133 또는 Sol 배정 | `CAMPAIGN_REWARD_PROPOSALS` |
| S7 | 캠페인 결제 | 0049/0134 | `CAMPAIGN_FUNDING_PUBLIC` |
| S8 | 대리 동의 기록 | 0050/0135 | `LIKENESS_DELEGATION_PROPOSALS` |
| S6 | KAIPER 파일럿 | 없음 | 없음 |

S3 번호가 Sol의 위험 번호와 겹치므로 Sol이 현재 사용 중인 다음 번호를 확인해 이어 붙인다. S7은 S3 스냅샷에 의존하지 않지만 S6 전에 끝나야 한다.

개방 게이트 추가: 토스 B2B 상품 심사 결과 확인, A5 초안의 대표·법무 승인과 `LEGAL_EFFECTIVE` 갱신, 대리 동의는 `legal_ok`·`provider_ok` 모두 참이어도 실행 경로를 별도 계획으로 설계한 뒤에만 연다. 실제 결제·환불 증거는 테스트 키로만 남기고 live 결제는 파일럿 체크리스트의 대표 실행 항목으로 둔다.
