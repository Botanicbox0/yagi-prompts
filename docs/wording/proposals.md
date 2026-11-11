# 문안 비교표 — 적용 전 후보

자동 생성 파일. 수정 원본은 `reviews.json`, 생성 명령은 `npx tsx scripts/dump-wording.ts`입니다.

점수는 **현재 원문**의 명확성 / 구체성 / 자연스러움 순서입니다. `owner-decision`은 대표 결정 전 적용하지 않습니다. 메일 문구는 decision 값과 관계없이 발송 전 별도 승인이 필요합니다. 변경 없는 검토 항목은 inventory.csv에서 확인합니다.

## campaigns.line1

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 정해진 포맷, | 내 얼굴로 만드는 |
| EN | A SET FORMAT, | Make it with your face. |

이유: 크리에이터 소개 두 줄은 하나의 의미 단위로 적용한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.line2

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 당신의 얼굴, 원고료. | 브랜드 캠페인. |
| EN | YOUR FACE, A FEE. | Create for a brand. |

이유: 얼굴과 수익을 기계적으로 병렬 나열하지 않고 참여 활동을 말한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.emptyTitle

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지금 모집 중인<br>캠페인이<br>없습니다. | 지금은 모집 중인<br>캠페인이 없습니다. |
| EN | NO CAMPAIGN<br>IS RECRUITING<br>RIGHT NOW. | No campaigns are<br>accepting applications right now. |

이유: 불필요한 세 줄 분할과 전면 대문자를 완화한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.emptyBody

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 캠페인은 브랜드의 의뢰로 열립니다. 계정에서 캠페인 알림을 켜 두면 새 모집이 열릴 때 메일로 알려드립니다. | 캠페인 알림을 켜 두면 새 모집이 시작될 때 이메일로 알려드립니다. |
| EN | Campaigns open on a brand’s brief. Turn on campaign alerts in your account and the next one reaches you by email. | Turn on campaign alerts to hear by email when applications open. |

이유: 빈 화면에서 필요한 다음 행동만 남긴다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.emptyCta

분류: **candidate** · 주제: notification · 현재 KO 2/2/4 · EN 2/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 캠페인 알림 켜기 | 캠페인 알림 설정하기 |
| EN | Turn on campaign alerts | Manage campaign alerts |

이유: 현재 링크는 토글을 켜지 않고 계정 페이지로 이동한다. 클릭 결과와 CTA를 맞춘다.

근거: lib/notify/unsubscribe.ts; lib/campaigns/notify.ts; lib/prompts/announce.ts; app/(app)/account/page.tsx

## campaigns.payoutLabel

분류: **candidate** · 주제: payout · 현재 KO 4/4/4 · EN 3/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 원고료 | 원고료 |
| EN | Fee | Creator fee |

이유: 브랜드 집행 비용과 크리에이터 원고료를 구분한다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.payoutHold

분류: **owner-decision** · 주제: payout · 현재 KO 3/1/4 · EN 3/1/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 검수 후 {days}일 뒤 지급 | 검수 완료 후 {days}일이 지나면 정산 대상 |
| EN | paid {days} days after review | Eligible for payment {days} days after approval |

이유: 대기기간 종료는 송금일 보장이 아니다. 실제 지급 SLA는 대표 결정으로 별도 명시해야 한다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.payoutHoldNone

분류: **owner-decision** · 주제: payout · 현재 KO 3/1/4 · EN 3/1/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 검수 후 바로 지급 | 검수 완료 후 정산 대상 |
| EN | paid right after review | Eligible for payment after approval |

이유: 0일 대기라도 수동 송금이 즉시 실행되는 것은 아니다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.hostedBy

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 클라이언트 | 주최 |
| EN | Client | Hosted by |

이유: 브랜드 외 주최 유형에도 맞는 중립적 라벨을 쓴다. 브랜드 전용 화면에서만 의뢰 브랜드를 사용한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.slotsLabel

분류: **candidate** · 주제: campaign · 현재 KO 4/4/4 · EN 2/3/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 모집 인원 | 모집 인원 |
| EN | Slots | Creators selected |

이유: 영어 Slots 대신 실제 선정 인원임을 설명한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.step5

분류: **owner-decision** · 주제: payout · 현재 KO 2/1/2 · EN 2/1/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 정산 — 검수가 끝나고 캠페인마다 정한 기간이 지나면 지급됩니다. 기간은 원고료 항목에 적혀 있습니다. | 정산 — 게시물이 검수를 통과하고 캠페인에 안내된 대기기간이 지나면 정산 대상이 됩니다. |
| EN | Payout — paid after review, once the campaign's own holding period has passed. The period is listed with the fee. | Payment — your post becomes eligible for payment after approval and the waiting period stated in the campaign. |

이유: 일괄 7일과 자동 지급 뉘앙스를 제거한다. 지급 완료는 실제 이체 후 별도 상태다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.landing.ctaBrand

분류: **candidate** · 주제: landing · 현재 KO 5/5/5 · EN 2/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 캠페인 의뢰하기 | 캠페인 의뢰하기 |
| EN | Start a campaign | Enquire about a campaign |

이유: 버튼은 개설 완료가 아니라 의뢰 폼으로 이동한다. 한국어는 유지하고 영어를 도착 화면과 맞춘다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.reelHeading

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 장면은<br>이렇게 나옵니다. | 우리 브랜드라면,<br>어떤 장면이 어울릴까요? |
| EN | THIS IS WHAT<br>A SCENE LOOKS LIKE. | Find a scene<br>for your brand. |

이유: 쇼릴을 브랜드의 선택과 연결한다. 질문형 제목은 CTA가 아니다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.reelLede

분류: **candidate** · 주제: landing · 현재 KO 2/3/2 · EN 2/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 아래는 모두 스튜디오가 설계해 생성한 포맷입니다. 같은 장면을 동의한 크리에이터의 얼굴로 다시 만들어 그 사람의 채널에 올리는 것이 캠페인이고, 크리에이터 확산 없이 브랜드 전용 영상만 필요하면 개별 프로덕션으로 의뢰할 수 있습니다. | 스튜디오가 직접 제작하고 테스트한 영상 포맷입니다. 브랜드에 맞게 새 포맷을 만들거나, 기존 포맷으로 캠페인을 진행할 수 있습니다. |
| EN | Every clip below is a format the studio designed and generated. A campaign remakes the same scene with a consenting creator’s face and posts it on their channel; a brand that needs the film alone, without creator reach, can commission it as a one-off production. | These video formats were created and tested by our studio. Start a campaign with an existing format, or commission one for your brand. |

이유: 캠페인 원리를 반복하는 긴 문장을 줄이고 두 가지 의뢰 방식을 설명한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.reel.highteen.title

분류: **candidate** · 주제: landing · 현재 KO 4/4/4 · EN 2/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 하이틴 | 하이틴 |
| EN | High teen | Teen movie |

이유: 한국어 장르명 하이틴은 자연스럽지만 영어 High teen은 장르명으로 어색하다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.reel.highteen.line

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 16:9 · 인물 중심 장면 | 16:9 · 인물이 중심인 장면 |
| EN | 16:9 · character-led scene | 16:9 · a character-focused scene |

이유: 짧은 설명을 자연스럽게 정리한다. 화면 비율은 유지한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.how1Title

분류: **owner-decision** · 주제: legal · 현재 KO 3/2/3 · EN 2/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 동의한 얼굴, 명확한 사용 범위 | 동의와 활용 범위를 명확하게 |
| EN | Consented likenesses. Clear usage rights. | Clear consent and usage terms |

이유: 얼굴 인증과 광고 활용 라이선스는 다르다. Licensed real faces가 포괄적 이용허락처럼 읽히는 문제를 줄인다. 권리 설명은 대표 검토 후 반영한다.

근거: AGENTS.md §5; lib/legal/documents.ts TERMS_KO §5, §8 / PRIVACY_KO §4; no legal edit in this PR

## campaigns.landing.how1Body

분류: **owner-decision** · 주제: legal · 현재 KO 2/2/2 · EN 2/2/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 크리에이터는 자신의 얼굴 사용과 캠페인 참여 조건에 동의합니다. 게시 채널, 광고 표기, 브랜드 채널 재사용 범위는 캠페인 조건에 명시됩니다. 필요한 경우 별도의 본인 확인을 진행합니다. | 크리에이터는 본인 얼굴 사진만 사용합니다. 사진은 제공사 자동 검수를 거쳐 계정당 인물 자산 그룹 1개에 등록되며, 필요하면 카메라 본인 인증을 진행합니다. 브랜드의 2차 활용 범위는 캠페인 계약에서 따로 정합니다. |
| EN | Creators consent to the use of their likeness and the campaign terms. Posting channels, ad disclosure and reuse on brand channels are specified in those terms. Additional identity checks are carried out when required. | Creators use photos of their own face. Photos pass the provider’s automated review and are registered in one likeness asset group per account. Camera-based identity verification may also be required. Any reuse by the brand is agreed separately in the campaign contract. |

이유: 본인 얼굴·계정당 그룹·자동 검수·필요 시 인증 사실을 보존한다. 지원 동의만으로 브랜드의 모든 재사용 권리가 생긴다는 인상을 없앤다.

근거: AGENTS.md §5; lib/legal/documents.ts TERMS_KO §5, §8 / PRIVACY_KO §4; no legal edit in this PR

## campaigns.landing.proofHeading

분류: **owner-decision** · 주제: landing · 현재 KO 3/2/3 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 영상 9편으로<br>시작한 유행. | 글로벌 AI 플랫폼의<br>국내 론칭 캠페인 |
| EN | A TREND THAT<br>STARTED WITH NINE FILMS. | A Korean launch campaign<br>for a global AI platform. |

이유: 시작한 유행이라는 인과 주장을 사실인 사례 설명으로 바꾼다. 고객 사례 제목은 대표 승인 후 반영한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.proofStat3Label

분류: **owner-decision** · 주제: landing · 현재 KO 2/3/2 · EN 2/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 파생 오가닉 콘텐츠 | 같은 포맷으로 이어진 콘텐츠 |
| EN | Derived organic posts | Organic posts using the same format |

이유: 파생 오가닉이라는 업계 표현을 풀어쓴다. 기존 300건+ 집계 정의와 같은지 대표 확인이 필요하다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.creatorsEyebrow

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 크리에이터라면 | 크리에이터 모집 |
| EN | For creators | For creators |

이유: 섹션의 내용을 명시한다. 영어 분류 라벨은 유지한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.brands.heading

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 브리프 한 번,<br>채널 여러 개. | 캠페인의 목표를<br>들려주세요. |
| EN | ONE BRIEF.<br>MANY CHANNELS. | Tell us what<br>you want to achieve. |

이유: 문의 폼 앞에서는 구조 설명보다 사용자가 입력할 내용을 안내한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.step1

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 포맷 — 카탈로그의 템플릿을 고르거나, 브랜드 전용 장면을 새로 만듭니다. 개별 광고 프로덕션도 여기서 시작합니다. | 영상 포맷 — 기존 템플릿을 활용하거나 브랜드에 맞는 장면을 새로 제작합니다. |
| EN | Format — pick a template from the catalogue, or have a brand-only scene made. A one-off ad production starts here too. | Video format — use an existing template or commission a scene for your brand. |

이유: 브랜드가 고르는 선택지를 명시한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.step3

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 운영 — 모집부터 정산까지 스튜디오가 진행하고, 게시물 링크와 조회수를 리포트로 받습니다. | 운영·결과 확인 — 스튜디오가 모집부터 정산까지 운영하고, 게시물 링크와 조회수를 전달합니다. |
| EN | Operation — the studio runs recruiting through payout; you get the post links and the view counts as a report. | Delivery and results — our studio manages recruitment through payment, then shares the post links and view counts. |

이유: 아직 없는 자동 리포트 기능으로 오해하지 않게 제공 정보만 말한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.fieldName

분류: **candidate** · 주제: brand · 현재 KO 4/4/4 · EN 3/3/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 담당자 이름 | 담당자 이름 |
| EN | Your name | Contact name |

이유: 브랜드 담당자 입력란이라는 한·영 의미를 맞춘다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.fieldBudget

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 예산대 | 캠페인 예산 |
| EN | Budget range | Campaign budget |

이유: 예산대라는 표현을 익숙한 명사로 바꾼다. 구간과 금액은 그대로 유지한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.budgetOver30m

분류: **candidate** · 주제: brand · 현재 KO 5/5/5 · EN 2/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 3,000만원 이상 | 3,000만원 이상 |
| EN | Over KRW 30M | KRW 30M or more |

이유: 기존 한국어 이상과 영어 Over의 경계값 불일치를 고친다. 금액과 정책 구간은 변경하지 않는다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.templateUndecided

분류: **candidate** · 주제: brand · 현재 KO 4/4/4 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 상담 후 결정 | 상담 후 결정 |
| EN | Decide after a call | Decide after discussing options |

이유: 상담을 전화만으로 한정하지 않는다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.fieldMessage

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 내용 | 제품과 캠페인 목표 |
| EN | Message | Product and campaign goals |

이유: 내용이라는 포괄적 라벨을 실제 필요한 정보로 바꾼다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.consent

분류: **owner-decision** · 주제: legal · 현재 KO 3/2/3 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 문의 회신을 위해 회사명, 이름, 직위, 이메일, 연락처와 요청 내용을 수집·이용하는 데 동의합니다. 회신 후 1년간 보관하며, 개인정보처리방침을 따릅니다. | 문의 회신을 위해 회사명, 이름, 이메일, 연락처를 수집·이용하는 데 동의합니다. 회신 후 1년간 보관하며, 개인정보처리방침을 따릅니다. |
| EN | I agree that the company name, my name, job title, email, phone and request are collected to answer this enquiry, kept for one year after the reply, and handled under the privacy policy. | I agree that the company name, my name, email and phone are collected to answer this enquiry, kept for one year after the reply, and handled under the privacy policy. |

이유: 개인정보 수집 동의 원문은 일반 워딩 패스에서 바꾸지 않는다. 전화번호는 선택 항목이라는 폼 구조와 동의 문안의 일치 여부는 별도 승인 항목이다.

근거: AGENTS.md §5; lib/legal/documents.ts TERMS_KO §5, §8 / PRIVACY_KO §4; no legal edit in this PR

## campaigns.brands.successBody

분류: **owner-decision** · 주제: brand · 현재 KO 3/1/3 · EN 3/1/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 담당자가 이메일로 회신합니다. | 담당자가 1영업일 안에 이메일로 답변드립니다. |
| EN | The studio replies by email. | We’ll reply by email within one business day. |

이유: 저장 성공과 비동기 메일 발송 성공은 다르다. 발송 완료 단정은 제거 후보, 1영업일 응답 약속은 운영 책임자가 재확인해야 한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.appStatus.selected

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정 | 선정 완료 |
| EN | Selected | Selected |

이유: 완료된 선정임을 명확히 한다. 영어는 유지한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.appStatus.expired

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 기한 만료 | 게시 기한 지남 |
| EN | Expired | Posting deadline missed |

이유: 어떤 기한이 끝났는지 명시한다. application expired는 선정 후 미게시를 뜻한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.applySuccessBody

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정 결과는 내 캠페인 페이지에서 확인할 수 있습니다. 지원 마감 전까지는 내용을 수정할 수 있습니다. | 선정 결과는 내 캠페인에서 확인할 수 있습니다. 지원 마감 전이며 아직 선정되지 않은 경우에만 내용을 수정할 수 있습니다. |
| EN | The selection shows on your campaigns page. You can edit until applications close. | Check your selection result in My campaigns. You can edit your application before the deadline if you haven’t been selected. |

이유: 현재 서비스는 selected 이후 수정 금지. 기존 문구의 마감 전 무조건 수정 가능 약속을 좁힌다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.errSlotsFull

분류: **candidate** · 주제: campaign · 현재 KO 4/4/4 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 모집 인원이 모두 찼습니다. | 모집 인원이 모두 찼습니다. |
| EN | Every slot is taken. | All creator places have been filled. |

이유: 영어 내부 슬롯 용어를 참여 인원으로 바꾼다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.stepVerified

분류: **candidate** · 주제: campaign · 현재 KO 4/4/4 · EN 2/3/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 검수 | 검수 |
| EN | Verified | Review |

이유: 얼굴 인증 verified와 게시물 검수 review를 구분한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.rejectedReason

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 반려 사유 | 수정이 필요한 부분 |
| EN | Reason | What to change |

이유: 이유 자체보다 해결할 내용을 안내한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.holdUntilLine

분류: **owner-decision** · 주제: payout · 현재 KO 3/2/4 · EN 3/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | {date} 이후 정산 가능 | {date}부터 정산 대상입니다. |
| EN | Payable after {date} | Eligible for payment from {date}. |

이유: 입금 확정일이 아닌 지급 가능 시작일임을 명확히 한다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.fieldViews

분류: **owner-decision** · 주제: metrics · 현재 KO 2/1/4 · EN 2/1/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 7일차 조회수 | 정산 기준일 조회수 |
| EN | Views on day 7 | Views at the payout measurement date |

이유: 고정 7일을 제거한다. 기준일 표시 및 기록 시점은 별도 구현/운영 결정이 필요하다.

근거: docs/CAMPAIGNS.md §4 metrics_at; lib/campaigns/service.ts submitViews/loadMyCampaigns; lib/admin/campaign-operations.ts verify/pay

## campaigns.viewsHint

분류: **owner-decision** · 주제: metrics · 현재 KO 2/1/4 · EN 2/1/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 게시 7일째의 조회수를 입력하세요. 관리자가 확인한 뒤 정산에 반영됩니다. | 검수 완료 후 캠페인의 대기기간이 끝난 시점의 조회수를 입력해 주세요. 운영자가 확인한 뒤 정산에 반영합니다. |
| EN | The view count on the seventh day after posting. The admin confirms it before the payout. | Enter the view count at the end of the campaign’s waiting period after approval. Our team will verify it before calculating your payment. |

이유: docs의 verified+hold 기준을 따르는 후보. 현재 코드는 posted/verified 상태에서 입력만 허용하며 측정 시점을 강제하지 않는다. 게시일 기준을 채택하려면 정책/코드 동시 변경 필요.

근거: docs/CAMPAIGNS.md §4 metrics_at; lib/campaigns/service.ts submitViews/loadMyCampaigns; lib/admin/campaign-operations.ts verify/pay

## campaigns.slotsFullNotice

분류: **candidate** · 주제: campaign · 현재 KO 4/4/4 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 모집 인원이 모두 찼습니다. | 모집 인원이 모두 찼습니다. |
| EN | Every slot is taken. | All creator places have been filled. |

이유: 같은 상태의 안내를 에러 문구와 통일한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.email.unsubscribeLine

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 캠페인 알림을 더 받고 싶지 않으면 한 번에 끌 수 있습니다. | 새 캠페인 모집 알림은 언제든 끌 수 있습니다. |
| EN | Do not want campaign alerts? One click turns them off. | You can turn off new campaign alerts at any time. |

이유: 선정·검수·지급 거래 메일까지 해제된다고 읽히지 않게 알림 범위를 좁힌다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.recruitingSubject

분류: **owner-decision** · 주제: email · 현재 KO 4/4/4 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 새 캠페인 모집 — {title} | 새 캠페인 모집 — {title} |
| EN | New campaign recruiting — {title} | Applications open — {title} |

이유: 영어 recruiting의 대상이 불명확한 제목을 모집 시작으로 바꾼다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusSubject.selected

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정됐어요 — {title} | 캠페인에 선정됐습니다 — {title} |
| EN | You are selected — {title} | You’ve been selected — {title} |

이유: 합니다체 통일. 영어 수동태 시제를 자연스럽게 정리한다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusSubject.rejected

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 게시물 수정이 필요해요 — {title} | 게시물 수정이 필요합니다 — {title} |
| EN | Your post needs a change — {title} | Changes needed — {title} |

이유: 거래 알림 말투를 합니다체로 통일한다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusTitle.selected

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정됐습니다. | 캠페인에 선정됐습니다. |
| EN | You are selected. | You’ve been selected. |

이유: 무엇에 선정됐는지 명시한다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusTitle.rejected

분류: **owner-decision** · 주제: email · 현재 KO 2/2/3 · EN 2/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 게시물을 다시 올려 주세요. | 게시물을 수정해 주세요. |
| EN | Please post again. | Your post needs changes. |

이유: 다시 올리기는 게시물 삭제/재업로드를 요구하는 것으로 읽힌다. 수정과 링크 재제출만 안내한다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusBody.declined

분류: **owner-decision** · 주제: email · 현재 KO 4/3/4 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 「{title}」 캠페인은 이번에 다른 크리에이터가 선정됐습니다. 지원해 주셔서 고맙습니다. 모집 중인 다른 캠페인도 확인해 보세요. | 「{title}」 캠페인에는 이번에 다른 크리에이터가 선정됐습니다. 지원해 주셔서 감사합니다. 다음 캠페인도 확인해 주세요. |
| EN | Other creators were selected for "{title}" this time. Thank you for applying — there are other campaigns recruiting. | Other creators were selected for “{title}” this time. Thank you for applying. You can check the campaigns page for future opportunities. |

이유: 현재 다른 모집이 실제로 있는지 모르는 상태에서 모집 중인 캠페인이 있다고 단정하지 않는다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusBody.verified

분류: **owner-decision** · 주제: email · 현재 KO 2/1/2 · EN 2/1/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 「{title}」 게시물이 검수를 통과했습니다. 정산 대기 기간이 지나면 캠페인 규칙에 따라 지급됩니다. 원고료: {payout}. | 「{title}」 게시물이 검수를 통과했습니다. 캠페인에 안내된 대기기간이 지나면 정산 대상이 됩니다. 원고료 조건: {payout}. |
| EN | Your post for "{title}" passed review. Payment follows the campaign terms after the waiting period. Fee: {payout}. | Your post for “{title}” has been approved. It becomes eligible for payment after the campaign’s waiting period. Creator fee terms: {payout}. |

이유: 정산 예정과 송금 완료를 구분하고 홀드를 풀어쓴다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusBody.rejected

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 「{title}」 게시물이 반려됐습니다. 사유: {reason} 수정한 뒤 내 캠페인에서 링크를 다시 제출해 주세요. | 「{title}」 게시물에 수정이 필요합니다. {reason} 내용을 수정한 뒤 내 캠페인에서 링크를 다시 제출해 주세요. |
| EN | Your post for "{title}" was sent back. Reason: {reason} Fix it and resubmit the link in My campaigns. | Your post for “{title}” needs changes: {reason} Once updated, resubmit the link in My campaigns. |

이유: 반려 대신 수정 내용과 재제출 경로를 안내한다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## campaigns.email.statusCta.declined

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 모집 중인 캠페인 보기 | 모집 중인 캠페인 보기 |
| EN | See recruiting campaigns | Explore open campaigns |

이유: 모집 캠페인 목록으로 가는 행동을 영어에서도 자연스럽게 표현한다.

근거: AGENTS.md §5 외부 발송; docs/CAMPAIGNS.md §12; lib/campaigns/notify.ts

## unsubscribe.invalidBody

분류: **candidate** · 주제: notification · 현재 KO 4/4/4 · EN 2/2/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 메일 앱에서 링크가 잘렸거나 만료된 링크일 수 있습니다. 계정 설정에서 직접 알림을 변경해 주세요. | 링크가 잘렸거나 더 이상 사용할 수 없습니다. 계정 설정에서 알림을 변경해 주세요. |
| EN | It may have been cut in half by a mail client, or it belongs to an older sending key. Open your account settings and change the switch there instead. | This link may be incomplete or no longer valid. Update your notification settings in your account. |

이유: 사용자에게 필요 없는 sending key 구현 설명을 제거하고 복구 경로를 유지한다.

근거: lib/notify/unsubscribe.ts; lib/campaigns/notify.ts; lib/prompts/announce.ts; app/(app)/account/page.tsx

## studio.needPhoto

분류: **candidate** · 주제: studio · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 사진을 올리면 버튼이 활성화됩니다. | 본인 얼굴 사진을 올려 주세요. |
| EN | Add a photo and the button turns on. | Upload a photo of your own face. |

이유: 버튼 활성화라는 UI 구현 설명 대신 필요한 행동을 안내한다.

근거: components/twings/studio.tsx; app/api/renders/access/route.ts; lib/flags.ts

## studio.aspectLabel

분류: **candidate** · 주제: studio · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 비율 | 화면 비율 |
| EN | Aspect | Aspect ratio |

이유: 비율이 무엇을 뜻하는지 한·영 모두 명확히 한다.

근거: components/twings/studio.tsx; app/api/renders/access/route.ts; lib/flags.ts

## studio.stepResult

분류: **candidate** · 주제: studio · 현재 KO 4/4/4 · EN 2/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 완성 | 완성 |
| EN | Film | Result |

이유: 이미지 템플릿도 같은 단계를 쓰므로 영어 Film으로 한정하지 않는다.

근거: components/twings/studio.tsx; app/api/renders/access/route.ts; lib/flags.ts

## studio.noStyles

분류: **candidate** · 주제: studio · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지금 열려 있는 장면이 없습니다. 다음 장면은 아래 카탈로그에서 만들어지고 있습니다. | 지금 이용할 수 있는 템플릿이 없습니다. 다른 템플릿을 둘러봐 주세요. |
| EN | No scenes are open right now. The next one is being made in the catalogue below. | No templates are available here right now. Browse the other templates. |

이유: 카탈로그에서 장면이 만들어진다는 어색한 표현을 제거한다. 실제 다른 템플릿 링크와 함께 적용해야 한다.

근거: components/twings/studio.tsx; app/api/renders/access/route.ts; lib/flags.ts
