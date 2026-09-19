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

## campaigns.intro

분류: **candidate** · 주제: campaign · 현재 KO 1/2/1 · EN 2/2/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 브랜드가 정한 템플릿 하나를 선정된 여러 크리에이터가 각자 자기 얼굴로 만들어 채널에 올립니다. 브랜드에게는 브리프 한 번으로 같은 포맷을 여러 채널에 동시에 내보내는 방법이고, 크리에이터에게는 링크 제출, 검수, 7일 홀드, 정산으로 이어지는 원고료입니다. 규칙은 캠페인마다 숫자로 적혀 있습니다. | 마음에 드는 캠페인에 지원해 보세요. 선정되면 정해진 영상 포맷에 본인 사진을 적용해 콘텐츠를 만들고, 안내된 채널에 게시합니다. 원고료와 지급 조건은 캠페인마다 확인할 수 있습니다. |
| EN | One template chosen by a brand, made by many selected creators, each with their own face, posted on their own channels. For a brand it is one brief sent out in the same format across many channels at once; for a creator it is a fee that follows the link, the review, a seven-day hold and the payout. Every campaign spells its rules in numbers. | Apply to a campaign you like. If selected, use your photo with the campaign’s video format, then post on the required channel. Each campaign lists its creator fee and payment terms. |

이유: 브랜드 설명은 상단에 맡기고 크리에이터가 할 일과 선정 조건을 설명한다. 고정 7일 및 즉시 수익 약속을 제거한다.

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

## campaigns.payoutPerView

분류: **candidate** · 주제: payout · 현재 KO 3/3/4 · EN 4/4/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 1,000회당 {rate} | 조회수 1,000회당 {rate} |
| EN | {rate} per 1,000 views | {rate} per 1,000 views |

이유: 무엇을 세는지 한국어에도 명시한다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.payoutHybrid

분류: **candidate** · 주제: payout · 현재 KO 3/3/4 · EN 4/4/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 기본 {amount} + 1,000회당 {rate} | 기본 {amount} + 조회수 1,000회당 {rate} |
| EN | {amount} base + {rate} per 1,000 views | {amount} base + {rate} per 1,000 views |

이유: 횟수 단위를 명시한다. 요율과 금액은 바꾸지 않는다.

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

## campaigns.slotsLine

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | {left}자리 남음 · 총 {slots}명 | 추가 선정 가능 {left}명 · 총 {slots}명 |
| EN | {left} spots left · {slots} in total | {left} selection places available · {slots} in total |

이유: 현재 left는 남은 지원 접수 수가 아니라 선정 정원에서 사용 중인 자리를 뺀 값이다. 신청 순서대로 마감된다는 인상을 줄인다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.seeStyle

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 이 포맷의 예시 영상 | 예시 영상 보기 |
| EN | The example film for this format | Watch the example video |

이유: 영상 링크의 행동을 명확히 한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.formatBody

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 이 캠페인의 영상은 아래 스튜디오 장면으로 만듭니다. 사진 한 장을 올리면 같은 장면이 당신의 얼굴로 나옵니다. | 아래는 이 캠페인에서 사용할 영상 포맷입니다. 선정된 크리에이터가 본인 사진을 적용해 각자의 영상을 만듭니다. |
| EN | Films for this campaign are made from the studio scene below. One photo in, and the same scene comes out with your face. | This is the video format for the campaign. Selected creators use their own photos to make individual videos. |

이유: 선정 조건을 명시하고 동일 결과 보장으로 읽히는 문장을 완화한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.makeItCta

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 스튜디오에서 만들기 | 템플릿 살펴보기 |
| EN | Make it in the studio | Explore templates |

이유: 현재 링크는 캠페인과 연결된 생성 작업이 아니라 /[locale]/studio 리다이렉트다. 직접 제작 CTA는 후속 기능에서 권한/비용과 함께 설계한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.briefHeading

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 브리프 | 캠페인 안내 |
| EN | Brief | Campaign brief |

이유: 크리에이터에게 생소한 브리프를 익숙한 용어로 바꾼다. 영어 brief는 문맥을 보완한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.step1

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지원 — 한 줄 어필과 SNS 계정, 팔로워 수를 보냅니다. | 지원 — 지원 이유와 활동 중인 SNS 계정, 팔로워 수를 입력합니다. |
| EN | Apply — one line about you, your SNS account and follower count. | Apply — tell us why you’d like to join and share your social profile and follower count. |

이유: 내부 어필 용어를 입력 내용으로 바꾼다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.step2

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정 — 슬롯 수만큼 선정하고, 내 캠페인 페이지에 바로 반영됩니다. | 선정 — 스튜디오가 참여자를 선정합니다. 결과는 내 캠페인에서 확인할 수 있습니다. |
| EN | Selection — as many creators as there are slots; it shows on your campaign page at once. | Selection — our studio selects the creators. Check the result in My campaigns. |

이유: 선정 주체를 명시하고 슬롯이라는 내부 용어를 제거한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.step3

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 제작·게시 — 스튜디오에서 만든 영상을 정해진 플랫폼에 올립니다. | 제작·게시 — 캠페인 안내에 따라 영상을 만들고 지정된 채널에 게시합니다. |
| EN | Make and post — the studio film, on the platform the brief names. | Create and post — make your video following the campaign brief, then publish it on the required channel. |

이유: 현재 캠페인 생성 권한/비용 연동은 별도 필요하므로 원클릭 제작 완료를 약속하지 않는다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.step5

분류: **owner-decision** · 주제: payout · 현재 KO 2/1/2 · EN 2/1/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 정산 — 검수 후 7일 홀드가 끝나면 규칙대로 지급됩니다. | 정산 — 게시물이 검수를 통과하고 캠페인에 안내된 대기기간이 지나면 정산 대상이 됩니다. |
| EN | Payout — the seven-day hold after review ends, and the rule pays out. | Payment — your post becomes eligible for payment after approval and the waiting period stated in the campaign. |

이유: 일괄 7일과 자동 지급 뉘앙스를 제거한다. 지급 완료는 실제 이체 후 별도 상태다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.landing.line1

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 광고 한 편이 | 하나의 광고 포맷이 |
| EN | ONE AD, | One campaign format. |

이유: 히어로 3개 키를 한 문장으로 함께 적용한다. 원본 광고가 그대로 복제된다는 인상을 줄이고 제작 단위를 명시한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.line2

분류: **candidate** · 주제: landing · 현재 KO 3/2/3 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 수십 개의 얼굴로 | 여러 크리에이터의 |
| EN | DOZENS OF REAL FACES, | Made personal by creators. |

이유: 수십 명이라는 미확정 패키지 규모를 약속하지 않는다. 3개 히어로 키는 한 묶음이다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.line3

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 퍼집니다. | 콘텐츠가 됩니다. |
| EN | REAL REACH. | Shared on their channels. |

이유: 추상적인 확산 성과 대신 실제 결과물과 게시 경로를 설명한다. 히어로 3개 키는 한 묶음이다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.intro

분류: **candidate** · 주제: landing · 현재 KO 2/3/2 · EN 2/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | TWINGS 캠페인은 세 가지를 한 파이프라인에 묶습니다. 스튜디오가 브랜드 장면을 고품질 AI 영상 포맷으로 만들고, 동의한 실제 크리에이터가 그 포맷을 자기 얼굴로 다시 만들고, 각자 자기 채널에 올려 퍼뜨립니다. 초상권은 계정마다 본인 자산으로 관리하고, 모집·검수·정산은 스튜디오가 운영합니다. | TWINGS가 브랜드에 맞는 영상 포맷을 만들고, 선정된 크리에이터가 자신의 얼굴로 제작해 각자의 채널에 게시합니다. 크리에이터 모집부터 콘텐츠 검수와 정산까지 스튜디오가 운영합니다. |
| EN | A TWINGS campaign ties three things into one pipeline. The studio turns a brand scene into a high-grade AI video format; consenting real creators remake that format with their own faces; each posts it on their own channel. Likeness is managed as a per-account asset, and recruiting, review and payout are run by the studio. | TWINGS creates a video format for your brand. Selected creators make it with their own faces and post it on their channels. Our studio manages recruitment, content review and creator payments. |

이유: 브랜드가 받는 결과와 스튜디오 역할을 앞에 둔다. 파이프라인·계정 자산 설명은 절차 안내로 옮긴다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.ctaBrand

분류: **candidate** · 주제: landing · 현재 KO 5/5/5 · EN 2/2/4

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 캠페인 의뢰하기 | 캠페인 의뢰하기 |
| EN | Start a campaign | Enquire about a campaign |

이유: 버튼은 개설 완료가 아니라 의뢰 폼으로 이동한다. 한국어는 유지하고 영어를 도착 화면과 맞춘다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.ctaCreator

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 크리에이터라면 | 참여할 캠페인 보기 |
| EN | For creators | Explore campaigns |

이유: 대상 호칭을 클릭 후 행동으로 바꾼다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.reelEyebrow

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 스튜디오 포맷 예시 | 영상 포맷 예시 |
| EN | Studio formats | Example video formats |

이유: 스튜디오 내부 분류보다 보여주는 콘텐츠를 말한다.

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

## campaigns.landing.howEyebrow

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 원리 | 운영 방식 |
| EN | How it works | How it works |

이유: 추상적인 원리보다 서비스 운영을 설명하는 섹션임을 드러낸다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.howHeading

분류: **candidate** · 주제: landing · 현재 KO 2/2/2 · EN 2/2/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 세 가지가<br>한 파이프라인에. | 제작부터 게시·정산까지,<br>TWINGS가 운영합니다. |
| EN | THREE THINGS,<br>ONE PIPELINE. | From production to creator payments.<br>Managed by TWINGS. |

이유: 세 가지·파이프라인 대신 업무 범위를 제시한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.how1Title

분류: **owner-decision** · 주제: legal · 현재 KO 3/2/3 · EN 2/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 실제 인물의 초상권 | 동의와 활용 범위를 명확하게 |
| EN | Licensed real faces | Clear consent and usage terms |

이유: 얼굴 인증과 광고 활용 라이선스는 다르다. Licensed real faces가 포괄적 이용허락처럼 읽히는 문제를 줄인다. 권리 설명은 대표 검토 후 반영한다.

근거: AGENTS.md §5; lib/legal/documents.ts TERMS_KO §5, §8 / PRIVACY_KO §4; no legal edit in this PR

## campaigns.landing.how1Body

분류: **owner-decision** · 주제: legal · 현재 KO 2/2/2 · EN 2/2/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 크리에이터는 본인 얼굴 사진으로만 만듭니다. 계정마다 인물 자산 그룹 하나, 생성 엔진의 자동 검수, 필요하면 카메라 본인 인증. 지원할 때 게시 조건과 광고 표기에 동의하므로, 브랜드는 실제 사람의 얼굴이 들어간 광고를 동의 위에서 씁니다. 브랜드 채널 2차 활용 범위는 캠페인 조건에 숫자로 적습니다. | 크리에이터는 본인 얼굴 사진만 사용합니다. 사진은 제공사 자동 검수를 거쳐 계정당 인물 자산 그룹 1개에 등록되며, 필요하면 카메라 본인 인증을 진행합니다. 브랜드의 2차 활용 범위는 캠페인 계약에서 따로 정합니다. |
| EN | Creators make only with photos of their own face: one likeness asset group per account, the engine’s automated moderation, and a camera check when the Company requires one. Applying means agreeing to the posting terms and the ad disclosure, so a brand uses an ad with a real person’s face on top of consent. Reuse on brand channels is written into the campaign terms in numbers. | Creators use photos of their own face. Photos pass the provider’s automated review and are registered in one likeness asset group per account. Camera-based identity verification may also be required. Any reuse by the brand is agreed separately in the campaign contract. |

이유: 본인 얼굴·계정당 그룹·자동 검수·필요 시 인증 사실을 보존한다. 지원 동의만으로 브랜드의 모든 재사용 권리가 생긴다는 인상을 없앤다.

근거: AGENTS.md §5; lib/legal/documents.ts TERMS_KO §5, §8 / PRIVACY_KO §4; no legal edit in this PR

## campaigns.landing.how2Title

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 고품질 포맷 제작 | 브랜드에 맞춘 영상 포맷 |
| EN | Studio-grade formats | A format made for your brand |

이유: 고품질이라는 자기 평가 대신 제공하는 결과를 말한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.how2Body

분류: **candidate** · 주제: landing · 현재 KO 3/2/3 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 장면은 스튜디오가 만듭니다. Seedance 2.0 같은 최신 영상 모델로 브랜드 제품이 들어간 장면 하나를 설계하고 테스트해 템플릿으로 고정합니다. 사진 한 장을 넣으면 같은 장면이 그 사람의 얼굴로 나오므로, 크리에이터 수만큼 촬영할 필요가 없습니다. | 스튜디오가 브랜드 제품과 메시지에 맞는 장면을 설계하고 테스트합니다. 선정된 크리에이터는 이 템플릿에 본인 사진을 적용해 각자의 영상을 만듭니다. |
| EN | The studio makes the scene. With current video models such as Seedance 2.0 it designs and tests one scene with the brand’s product in it and fixes it as a template. One photo in, the same scene out with that person’s face — no shoot per creator. | Our studio designs and tests a scene around your product and message. Selected creators use the template with their own photos to make individual videos. |

이유: Seedance 2.0 같은 오래된 모델명과 품질 단정을 제거한다. 제작 역량과 개인화 방식은 남긴다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.how3Title

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 실제 채널로 확산 | 크리에이터의 채널에 게시 |
| EN | Spread through real channels | Published on creators’ channels |

이유: 조회수나 전파를 보장하지 않고 실제 수행 행위를 설명한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.how3Body

분류: **candidate** · 주제: landing · 현재 KO 2/3/2 · EN 2/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정된 크리에이터가 각자 자기 채널에 올립니다. 링크 제출, 형식·해시태그·광고 표기 검수, 7일 홀드, 원고료 정산까지 스튜디오가 운영하고, 브랜드는 게시물 링크와 조회수를 받습니다. | 선정된 크리에이터가 캠페인 조건에 맞춰 각자의 채널에 게시합니다. 스튜디오가 게시물과 광고 표기를 확인하고 정산을 진행합니다. 브랜드에는 게시물 링크와 확인한 조회수를 전달합니다. |
| EN | Selected creators post on their own channels. Link submission, a review of format, hashtags and disclosure, a seven-day hold and the fee payout are all run by the studio; the brand receives the post links and the view counts. | Selected creators post on their channels under the campaign terms. Our studio reviews the posts and ad disclosures, then manages creator payments. You receive the post links and verified view counts. |

이유: 홀드 등 내부 용어와 일률적인 7일 지급 약속을 빼고 브랜드가 받는 내용을 명시한다. 확인한 조회수는 수동 확인 기준이다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

## campaigns.landing.howNote

분류: **candidate** · 주제: landing · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 크리에이터 확산 없이 브랜드 전용 영상만 필요한 경우도 받습니다. 개별 광고 프로덕션으로 의뢰해 주세요. | 브랜드 채널에 사용할 영상만 의뢰할 수도 있습니다. |
| EN | A brand that needs the film alone, without creator reach, is welcome too — commission it as a one-off ad production. | You can also commission videos for your own brand channels. |

이유: 개별 광고 프로덕션의 의미를 구매 목적에 맞춰 간결하게 설명한다.

근거: AGENTS.md §5, §8; docs/CAMPAIGNS.md §13; components/campaigns/brand-landing.tsx

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

## campaigns.brands.lede

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 템플릿 하나와 브리프 한 번을 정하면 크리에이터 모집, 선정, 검수, 정산은 스튜디오가 맡습니다. 아래에 남겨 주시면 1영업일 안에 회신합니다. | 제품과 캠페인 목표를 알려주세요. 예산과 일정에 맞는 영상 포맷과 운영 방식을 제안드립니다. |
| EN | Pick one template and write one brief; the studio recruits, selects, reviews and pays the creators. Leave your details below and we reply within one business day. | Tell us about your product and campaign goals. We’ll propose a video format and an approach to fit your budget and timeline. |

이유: 의뢰 전에 템플릿·브리프를 완성해야 한다는 부담을 줄인다. 회신 SLA는 접수 안내에서 명확히 다룬다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.step1

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 포맷 — 카탈로그의 템플릿을 고르거나, 브랜드 전용 장면을 새로 만듭니다. 개별 광고 프로덕션도 여기서 시작합니다. | 영상 포맷 — 기존 템플릿을 활용하거나 브랜드에 맞는 장면을 새로 제작합니다. |
| EN | Format — pick a template from the catalogue, or have a brand-only scene made. A one-off ad production starts here too. | Video format — use an existing template or commission a scene for your brand. |

이유: 브랜드가 고르는 선택지를 명시한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.step2

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 브리프·예산 — 게시 조건, 원고료 규칙, 브랜드 채널 2차 활용 범위를 숫자로 정합니다. | 진행 조건 — 예산과 일정, 게시 조건, 원고료, 콘텐츠 활용 범위를 함께 정합니다. |
| EN | Brief and budget — posting rules, the fee and the reuse rights on brand channels, stated in numbers. | Campaign terms — agree on the budget, schedule, posting requirements, creator fees and content usage rights. |

이유: 권리 범위는 숫자만으로 설명할 수 없다. 실제 합의 항목을 나열한다.

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

## campaigns.brands.fieldTemplate

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 희망 포맷 | 희망 영상 포맷 |
| EN | Preferred format | Preferred video format |

이유: 추상적인 포맷의 종류를 분명히 한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.templateNew

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 브랜드 전용 장면 제작 | 브랜드 전용 영상 제작 |
| EN | A brand-only scene | A custom video for our brand |

이유: 브랜드가 받는 결과물 단위를 명시한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.templateUndecided

분류: **candidate** · 주제: brand · 현재 KO 4/4/4 · EN 3/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 상담 후 결정 | 상담 후 결정 |
| EN | Decide after a call | Decide after discussing options |

이유: 상담을 전화만으로 한정하지 않는다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.fieldTiming

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 희망 시기 (선택) | 희망 게시 시기 (선택) |
| EN | Timing (optional) | Preferred posting date (optional) |

이유: 계약일·제작일·게시일 중 묻는 시점을 분명히 한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.fieldMessage

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 내용 | 제품과 캠페인 목표 |
| EN | Message | Product and campaign goals |

이유: 내용이라는 포괄적 라벨을 실제 필요한 정보로 바꾼다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.successBody

분류: **owner-decision** · 주제: brand · 현재 KO 3/1/3 · EN 3/1/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 1영업일 안에 담당자가 이메일로 회신합니다. 접수 확인 메일도 함께 보냈습니다. | 담당자가 1영업일 안에 이메일로 답변드립니다. |
| EN | We reply by email within one business day. A confirmation is on its way to you too. | We’ll reply by email within one business day. |

이유: 저장 성공과 비동기 메일 발송 성공은 다르다. 발송 완료 단정은 제거 후보, 1영업일 응답 약속은 운영 책임자가 재확인해야 한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.errRateLimited

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 같은 이메일로 오늘 더 보낼 수 없습니다. 내일 다시 시도하거나 hello@yagiworkshop.xyz로 보내 주세요. | 오늘 보낼 수 있는 문의 수를 초과했습니다. 잠시 후 다시 시도하거나 hello@yagiworkshop.xyz로 연락해 주세요. |
| EN | No more enquiries from this email today. Try tomorrow, or write to hello@yagiworkshop.xyz. | You’ve reached the enquiry limit. Please try again later or email hello@yagiworkshop.xyz. |

이유: 같은 이메일로 보낼 수 없다는 표현을 횟수 제한으로 명확히 한다. 서버는 rolling 24h이므로 자정에 풀린다고 단정하지 않는다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.brands.errUnavailable

분류: **candidate** · 주제: brand · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지금은 접수할 수 없습니다. hello@yagiworkshop.xyz로 보내 주세요. | 문의를 접수하지 못했습니다. 다시 시도하거나 hello@yagiworkshop.xyz로 연락해 주세요. |
| EN | Enquiries cannot be taken right now. Please write to hello@yagiworkshop.xyz. | We couldn’t receive your enquiry. Please try again or email hello@yagiworkshop.xyz. |

이유: 실패한 행동과 복구 경로를 함께 제시한다.

근거: docs/CAMPAIGNS.md §11; lib/brands/service.ts; components/campaigns/brand-form.tsx

## campaigns.appStatus.selected

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정 | 선정 완료 |
| EN | Selected | Selected |

이유: 완료된 선정임을 명확히 한다. 영어는 유지한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.appStatus.withdrawn

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 철회 | 지원 취소 |
| EN | Withdrawn | Application withdrawn |

이유: 무엇을 철회했는지 명시한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.appStatus.posted

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 게시 · 검수 대기 | 링크 제출 완료 · 검수 대기 |
| EN | Posted · in review | Link submitted · awaiting review |

이유: 상태 변화는 외부 게시 사실 자동 확인이 아니라 링크 제출이다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.appStatus.verified

분류: **candidate** · 주제: payout · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 검수 완료 · 홀드 중 | 검수 완료 · 정산 대기 |
| EN | Verified · on hold | Approved · awaiting payment |

이유: verified는 얼굴 인증이 아니라 게시물 검수. 대기기간 종료와 송금 완료를 구분한다.

근거: docs/CAMPAIGNS.md §3–4, §7; lib/campaigns/state.ts holdUntil/payoutReleasable; lib/admin/campaign-operations.ts pay

## campaigns.appStatus.rejected

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 반려 · 재제출 필요 | 수정 후 다시 제출해 주세요 |
| EN | Returned · resubmit | Changes needed · resubmit |

이유: 반려라는 운영 용어를 다음 행동으로 바꾼다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.appStatus.expired

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 기한 만료 | 게시 기한 지남 |
| EN | Expired | Posting deadline missed |

이유: 어떤 기한이 끝났는지 명시한다. application expired는 선정 후 미게시를 뜻한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.applyLede

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 아래 조건을 확인하고 지원서를 보내주세요. 선정되면 내 캠페인 페이지에 바로 표시됩니다. | 게시 조건과 원고료를 확인한 뒤 지원해 주세요. 선정 결과는 내 캠페인에서 확인할 수 있습니다. |
| EN | Read the terms below and send your application. A selection shows on your campaigns page at once. | Review the posting requirements and creator fee, then apply. You can check the selection result in My campaigns. |

이유: 아래 조건의 내용을 명시하고 즉시 선정 결과가 나온다는 오해를 줄인다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.applySuccessBody

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 선정 결과는 내 캠페인 페이지에서 확인할 수 있습니다. 지원 마감 전까지는 내용을 수정할 수 있습니다. | 선정 결과는 내 캠페인에서 확인할 수 있습니다. 지원 마감 전이며 아직 선정되지 않은 경우에만 내용을 수정할 수 있습니다. |
| EN | The selection shows on your campaigns page. You can edit until applications close. | Check your selection result in My campaigns. You can edit your application before the deadline if you haven’t been selected. |

이유: 현재 서비스는 selected 이후 수정 금지. 기존 문구의 마감 전 무조건 수정 가능 약속을 좁힌다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.applySignInBody

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지원하려면 로그인이 필요합니다. 선정·검수·정산 상태가 계정에 기록됩니다. | 로그인한 뒤 캠페인에 지원할 수 있습니다. 진행 상태와 정산 내역은 내 캠페인에서 확인하세요. |
| EN | Sign in to apply — selection, review and payout are recorded on your account. | Sign in to apply. Track your campaign progress and payments in My campaigns. |

이유: 기록된다는 시스템 설명을 사용자가 확인할 위치로 바꾼다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.fieldPitch

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 한 줄 어필 | 지원 이유 |
| EN | One line about you | Why you’d like to join |

이유: 한 줄 어필이라는 표현을 구체적인 입력 목적에 맞춘다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.fieldPitchHint

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 어떤 콘텐츠를 만들어 왔는지, 이 포맷이 왜 맞는지. 10~300자. | 어떤 콘텐츠를 만드는지, 이 캠페인에 참여하고 싶은 이유를 적어 주세요. 10~300자. |
| EN | What you make, and why this format fits. 10–300 characters. | Tell us what you create and why you’d like to join this campaign. 10–300 characters. |

이유: 행동을 완결된 문장으로 안내하고 길이 제한을 유지한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.fieldSns

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 활동 SNS 계정 링크 | 활동 중인 SNS 계정 링크 |
| EN | Your SNS account link | Social profile link |

이유: 한국어는 활동 중임을 명확히, 영어는 SNS 직역을 피한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.errRateLimited

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 오늘은 더 보낼 수 없습니다. 내일 다시 시도해 주세요. | 지원 횟수 제한에 도달했습니다. 잠시 후 다시 시도해 주세요. |
| EN | No more submissions today. Try again tomorrow. | You’ve reached the application limit. Please try again later. |

이유: rolling 24h 제한을 내일 자정 해제로 약속하지 않는다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.errSlotsFull

분류: **candidate** · 주제: campaign · 현재 KO 4/4/4 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 모집 인원이 모두 찼습니다. | 모집 인원이 모두 찼습니다. |
| EN | Every slot is taken. | All creator places have been filled. |

이유: 영어 내부 슬롯 용어를 참여 인원으로 바꾼다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.errWrongPlatform

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 이 캠페인이 지정한 플랫폼의 링크가 아닙니다. | 캠페인에 안내된 SNS의 게시물 링크를 입력해 주세요. |
| EN | That link is not on a platform this campaign names. | Enter a post link from one of the platforms listed in this campaign. |

이유: 왜 틀렸는지와 고치는 행동을 연결한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.mineLede

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지원한 캠페인의 진행 상태, 게시 링크 제출, 정산 현황을 여기서 봅니다. | 지원 결과를 확인하고 게시물 링크를 제출하세요. 검수와 정산 상태도 여기에서 볼 수 있습니다. |
| EN | Where each application stands, where to submit your post link, and what has been paid. | Check your application results and submit your post links. Track review and payment status here, too. |

이유: 메뉴의 설명을 실제 가능한 행동으로 바꾼다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.mineBrowse

분류: **candidate** · 주제: campaign · 현재 KO 4/4/4 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 모집 중인 캠페인 보기 | 모집 중인 캠페인 보기 |
| EN | See what is recruiting | Explore open campaigns |

이유: 영어 recruiting의 주어가 모호해 open campaigns로 명확히 한다.

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

## campaigns.postHint

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | {platforms}에 올린 게시물 링크. {date}까지 제출. | {date}까지 {platforms}에 게시한 링크를 제출해 주세요. |
| EN | The link to your post on {platforms}. Due {date}. | Submit the link to your post on {platforms} by {date}. |

이유: 장소·대상·기한을 한 문장으로 묶는다. 플레이스홀더 보존.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.postSubmit

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 링크 제출 | 게시물 링크 제출하기 |
| EN | Submit link | Submit post link |

이유: 클릭 결과를 구체화한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.postResubmit

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 다시 제출 | 수정한 링크 다시 제출하기 |
| EN | Resubmit | Resubmit post link |

이유: 새 게시물 업로드를 강요하지 않고 수정 후 링크 재제출 행동을 안내한다.

근거: docs/CAMPAIGNS.md §2–6; lib/campaigns/state.ts; components/campaigns/labels.ts

## campaigns.postSaved

분류: **candidate** · 주제: campaign · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 링크를 받았습니다. 검수 결과는 여기서 확인할 수 있습니다. | 게시물 링크를 받았습니다. 검수가 끝나면 결과를 알려드립니다. |
| EN | Link received. The review result shows here. | We’ve received your post link. We’ll notify you when the review is complete. |

이유: 검수 알림 메일 구현을 근거로 다음 단계를 안내한다. 실제 메일 도착 시간은 약속하지 않는다.

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

## campaigns.email.recruitingBody

분류: **owner-decision** · 주제: email · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | {host}의 「{title}」 캠페인이 열렸습니다. 원고료 {payout} · {slots}명 선정 · {applyBy} 지원 마감. 지원하면 선정 결과를 내 캠페인에서 바로 볼 수 있습니다. | {host}의 「{title}」 캠페인이 크리에이터를 모집합니다. 원고료 {payout}, 모집 인원 {slots}명입니다. {applyBy}까지 지원해 주세요. 선정 결과는 내 캠페인에서 확인할 수 있습니다. |
| EN | {host} opened "{title}". Fee {payout} · {slots} creators · apply by {applyBy}. Apply and the result shows up in My campaigns. | Applications are open for “{title}” by {host}. Creator fee: {payout}. Places: {slots}. Apply by {applyBy} and check the selection result in My campaigns. |

이유: 금액·인원·기한을 짧은 문장으로 분리한다. 외부 발송 문안은 대표 승인 필요.

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
| KO | 「{title}」 게시물이 검수를 통과했습니다. 홀드 기간이 끝나면 규칙대로 정산됩니다. 원고료 {payout}. | 「{title}」 게시물이 검수를 통과했습니다. 캠페인에 안내된 대기기간이 지나면 정산 대상이 됩니다. 원고료 조건: {payout}. |
| EN | Your post for "{title}" passed review. Once the hold ends it is paid under the campaign rule. Fee {payout}. | Your post for “{title}” has been approved. It becomes eligible for payment after the campaign’s waiting period. Creator fee terms: {payout}. |

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

## account.notifLede

분류: **candidate** · 주제: notification · 현재 KO 2/2/3 · EN 2/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 이메일로만 보냅니다. 다이제스트나 마케팅 메일은 없습니다. | 새 템플릿과 캠페인 모집 소식을 이메일로 받을지 선택하세요. 결제나 참여한 캠페인의 진행 안내는 별도로 발송됩니다. |
| EN | Email only. Two switches, no digest, no marketing. | Choose whether to receive new template and campaign announcements by email. Payment updates and updates about campaigns you’ve joined are sent separately. |

이유: 마케팅 메일이 없다는 분류 단정을 피하고 선택 알림과 거래 알림을 구분한다.

근거: lib/notify/unsubscribe.ts; lib/campaigns/notify.ts; lib/prompts/announce.ts; app/(app)/account/page.tsx

## account.notifNewHint

분류: **candidate** · 주제: notification · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 새 템플릿이 열리거나 결제가 시작되는 날 메일을 보냅니다. | 새 템플릿과 서비스 오픈 소식을 이메일로 알려드립니다. |
| EN | One email the day a new template opens or payment goes live. | Get email updates about new templates and service availability. |

이유: 공개 즉시 자동 발송이 아니라 관리자가 수동으로 발송한다. 특정 날짜 전송 약속을 제거한다.

근거: lib/notify/unsubscribe.ts; lib/campaigns/notify.ts; lib/prompts/announce.ts; app/(app)/account/page.tsx

## unsubscribe.doneNew

분류: **candidate** · 주제: notification · 현재 KO 2/2/3 · EN 2/2/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | "새 플레이북" 메일을 더 이상 보내지 않습니다. | 새 템플릿 알림을 껐습니다. |
| EN | You will not get "new playbook" emails any more. | New template alerts are now off. |

이유: 계정 설정과 동일한 새 템플릿 용어를 사용한다.

근거: lib/notify/unsubscribe.ts; lib/campaigns/notify.ts; lib/prompts/announce.ts; app/(app)/account/page.tsx

## unsubscribe.doneUpdates

분류: **candidate** · 주제: notification · 현재 KO 1/1/3 · EN 1/1/3

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | "플레이북 업데이트" 메일을 더 이상 보내지 않습니다. | 캠페인 모집 알림을 껐습니다. |
| EN | You will not get "playbook updated" emails any more. | New campaign alerts are now off. |

이유: notif_updates는 캠페인 모집 소식이다. 과거 플레이북 업데이트 명칭을 교체한다.

근거: lib/notify/unsubscribe.ts; lib/campaigns/notify.ts; lib/prompts/announce.ts; app/(app)/account/page.tsx

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

## studio.dropZone

분류: **candidate** · 주제: studio · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 사진을 여기에 놓거나 클릭해서 선택 | 사진을 끌어 놓거나 눌러서 선택하세요. |
| EN | Drop a photo here, or click to choose | Drop a photo here or tap to choose. |

이유: 터치와 데스크톱 모두에 자연스러운 업로드 안내를 사용한다.

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

## studio.closedBody

분류: **candidate** · 주제: studio · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 열리는 날 이메일로 알려드립니다. 지금은 예시 영상을 보고 장면과 비율을 골라 두세요. | 예시 영상을 둘러보고 마음에 드는 장면을 골라보세요. 알림을 신청하면 서비스 오픈 소식을 이메일로 알려드립니다. |
| EN | We will email you the day this template opens. Until then, watch the sample and pick your scene and aspect. | Explore the examples and find a scene you like. Sign up for an email when the service opens. |

이유: 알림 신청 전 자동 발송 약속과 템플릿별 개인 알림 오해를 줄인다.

근거: components/twings/studio.tsx; app/api/renders/access/route.ts; lib/flags.ts

## studio.noStyles

분류: **candidate** · 주제: studio · 현재 KO 3/3/2 · EN 3/3/2

| 언어 | 현재 | 후보 |
|---|---|---|
| KO | 지금 열려 있는 장면이 없습니다. 다음 장면은 아래 카탈로그에서 만들어지고 있습니다. | 지금 이용할 수 있는 템플릿이 없습니다. 다른 템플릿을 둘러봐 주세요. |
| EN | No scenes are open right now. The next one is being made in the catalogue below. | No templates are available here right now. Browse the other templates. |

이유: 카탈로그에서 장면이 만들어진다는 어색한 표현을 제거한다. 실제 다른 템플릿 링크와 함께 적용해야 한다.

근거: components/twings/studio.tsx; app/api/renders/access/route.ts; lib/flags.ts
