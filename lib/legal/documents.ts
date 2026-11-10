import type { Locale } from '@/lib/i18n/config';

/**
 * The legal surface (founder direction, 2026-08-14; rewritten 2026-09-11 for the template product):
 * 이용약관 · 환불정책 · 개인정보처리방침.
 *
 * Why it exists: a domestic PG (토스페이먼츠) will not pass a merchant review without them, and
 * 전자상거래법 §21 requires the seller identification block on the site regardless of gateway. The
 * 2026-09-11 rewrite answers the PG reviewer's two questions directly: what the verification and
 * management standard for a face-based product is (terms §5, privacy §5), and what is actually sold
 * (one payment per finished film — there is no stored-value item; the old "cookie" credit is gone).
 *
 * Three deliberate shapes:
 *   · the text lives HERE as markdown, not in `messages/*.ts`. A legal document is a versioned
 *     artefact with an effective date; it renders through the same strict markdown renderer the
 *     campaign brief uses;
 *   · every business identifier is a NAMED PLACEHOLDER in one object (`BUSINESS`). The founder
 *     fills it once; nothing else in the repo repeats a registration number;
 *   · the product facts stated here (one payment per render, 3-day share link, real-person
 *     verification before a real face reaches the video engine) are the ones the code enforces
 *     (lib/renders, lib/identity). Change the code, change the clause.
 *
 * NOT legal advice: a careful draft that describes what the product actually does, written to be
 * reviewed. The refund clause follows 전자상거래법 §17 for made-to-order digital content.
 */

/**
 * 전자상거래법 §21 표시사항.
 *
 * 상호 · 대표자 · 본점 주소 are transcribed from the corporate registry certificate
 * (등기사항전부증명서, 등기번호 0940868 / 법인등록번호 110111-0940868, 발급 2026-11-03): the head
 * office moved to 영등포구 on 2026-10-29 and was registered the same day; the 사업자등록증 was
 * reissued with this address on 2026-11-06 (영등포세무서). Every earlier line on that
 * certificate (양천구 → 구로구 → 양천구) is struck through and must never appear here. Nothing else
 * from the registry is copied — a director's resident number and home address are on that document
 * and have no business on a public page.
 *
 * `mailOrderNumber` comes from the 통신판매업신고증 (구로구청, 2026-09-10; nothing else on that
 * certificate — the representative's birth date is on it — belongs on a public page). The move to
 * 영등포구 needs a 변경신고 there, which may issue a new number; replace it only from the new 신고증.
 * Should it ever be blanked to a `TODO` again, the legal pages show the placeholder and the footer
 * drops the line (`businessFooterLines`, `hasMailOrderNumber`).
 */
export const BUSINESS = {
  name: 'YAGI WORKSHOP Inc.',
  nameKo: '야기워크숍 주식회사',
  representative: '윤병삼',
  registrationNumber: '519-81-04213',
  /** 통신판매업신고증 제 2026-서울구로-1618 호 (구로구청, 신고 2026-09-10). */
  mailOrderNumber: '2026-서울구로-1618',
  address: '서울특별시 영등포구 양평로 110, 5층 씨06호 (양평동4가)',
  /** Same line as the English address filed with D&B and the app stores (unit and postal code included). */
  addressEn: '5F C06, 110, Yangpyeong-ro, Yeongdeungpo-gu, Seoul, 07208, Republic of Korea',
  phone: '010-6599-4020',
  phoneEn: '+82 10-6599-4020',
  email: 'hello@yagiworkshop.xyz',
  host: 'Vercel Inc. · Supabase Inc. · Cloudflare, Inc.',
} as const;

/** True once the founder has replaced the placeholder with the number on the 신고증. */
export function hasMailOrderNumber(): boolean {
  return !BUSINESS.mailOrderNumber.startsWith('TODO');
}

/**
 * 구매안전서비스 (전자상거래법 §13②⑩, §24) — KB국민은행 「KB에스크로 이체」, 판매자 등록 2026-09-02.
 *
 * The bank issues a JS snippet that form-posts to a popup; this is the same seller-verification page
 * reached by the plain GET link the bank also hands out, so the site needs no inline script. The
 * `mHValue` is the bank's public seller hash — it is what the mark discloses on purpose (상호 ·
 * 쇼핑몰 · 예금주), not a credential. The bank's snippet references the mark image over http://; a
 * secure page would block that, so the https host is used here (verified 200, image/gif).
 */
export const ESCROW = {
  bank: 'KB국민은행',
  bankEn: 'KB Kookmin Bank',
  service: 'KB에스크로 이체',
  serviceEn: 'KB Escrow Transfer',
  href: 'https://okbfex.kbstar.com/quics?page=C016760&mHValue=9c8456fe46af3eed4b7c4f7a85484c91',
  mark: 'https://img1.kbstar.com/img/escrow/escrowcmark.gif',
} as const;

export const LEGAL_DOCS = ['terms', 'refund', 'privacy'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

/** The effective date printed on every document. Bump it whenever the text below changes. */
export const LEGAL_EFFECTIVE = '2026-11-02';

/** Stated once, used by the terms, the refund policy and the privacy policy alike. */
const SHARE_LINK_DAYS = 3;
const REPORT_REVIEW_HOURS = 24;

interface LegalDocument {
  title: string;
  summary: string;
  body: string;
}

// ---------------------------------------------------------------------------
// 이용약관 / Terms
// ---------------------------------------------------------------------------

const TERMS_KO = `## 제1조 (목적)

이 약관은 ${BUSINESS.nameKo}(이하 "회사")가 운영하는 TWINGS(이하 "서비스")의 이용 조건과 절차, 회사와 이용자의 권리·의무를 정합니다.

## 제2조 (서비스의 내용)

1. 서비스는 이용자가 올린 **본인의 얼굴 사진 한 장**을 회사가 미리 만들어 검증한 장면(이하 "템플릿")에 적용하여 AI 영상 또는 이미지(이하 "결과물")를 만들어 제공합니다.
2. 결과물은 회사가 계약한 외부 AI 모델(BytePlus ModelArk의 Seedance·Seedream, OpenAI의 GPT Image)로 생성됩니다. 어떤 템플릿이 어떤 모델을 쓰는지는 템플릿 페이지에 표시합니다.
3. 서비스는 브랜드가 의뢰한 캠페인에 크리에이터를 모집·선정하고 게시물을 검수·정산하는 "캠페인" 기능을 함께 운영합니다(제8조).

## 제3조 (회원가입과 계정)

1. 이용자는 Google 또는 카카오 계정으로 로그인하여 회원이 됩니다. 별도의 비밀번호를 만들지 않습니다.
2. **만 14세 미만은 가입할 수 없습니다.**
3. 계정은 본인만 사용할 수 있으며 타인에게 양도·공유할 수 없습니다.
4. 이용자는 계정 페이지에서 언제든지 탈퇴를 요청할 수 있습니다.

## 제4조 (템플릿 결과물 결제)

1. 결과물은 **템플릿 한 편당 한 번 결제**합니다. 가격은 각 템플릿 페이지에 원화로 표시되며, **정기결제가 아닙니다.**
2. 서비스에는 충전식 재화, 포인트, 이용권이 없습니다. 결제 금액은 그 결제로 만드는 결과물 한 편에만 쓰입니다.
3. 결제가 완료되면 결과물 생성이 곧바로 시작됩니다. 결과물은 계정의 "내 작품"에 보관되고, 완성 알림이 이메일로 발송됩니다.
4. 환불은 별도의 환불정책을 따릅니다.

## 제4조의2 (브랜드 캠페인 서비스 대금)

1. 브랜드 캠페인 결제는 **TWINGS 자체 서비스 대금**을 수납합니다. 서비스명은 "TWINGS 브랜드 캠페인 운영 서비스"이며, 참여자에게 전달할 자금의 수납이나 지급 대행은 포함하지 않습니다.
2. 최종 결제 총액, 세금 기준, 제공 범위, 시작 조건과 환불 조건, 유효기간, 합의 문서의 참조·버전은 견적마다 정합니다. 결제 총액은 수락한 견적에 적힌 원화 금액이며 결제 화면에서 바꾸지 않습니다.
3. 결제 완료는 **입금 확인**을 뜻합니다. 캠페인 공개, 참여자 선정, 제작 시작이나 원고료 지급을 자동 실행하지 않습니다. 서비스는 견적에 적힌 시작 조건을 충족하고 회사와 브랜드가 확인한 뒤 진행합니다.
4. 참여자 보상 제안은 TWINGS 서비스 견적과 별개입니다. 제안을 보내거나 스튜디오가 검토했다는 사실만으로 참여자 보상 조건이 확정되거나 지급되지 않으며, 기존 지원자가 동의한 캠페인 조건을 바꾸지 않습니다.
5. 현재는 합의된 환불 조건을 전액 환불로 처리할 수 있는 계약을 우선 수납합니다. 환불 대상과 금액은 해당 견적과 적용되는 법령에 따라 확인하며, 이 조항은 법령상 보장된 청약철회·환불 권리를 제한하지 않습니다. 세부 안내는 환불정책 제8항을 따릅니다.

## 제5조 (사진과 초상권 — 검증과 관리 기준)

1. 이용자는 **본인의 얼굴이 찍힌 사진만** 올릴 수 있습니다.
2. 타인의 얼굴이 포함된 사진은 그 사람의 명시적 동의를 받은 경우에만 올릴 수 있으며, 다음 사진은 동의 여부와 관계없이 올릴 수 없습니다.
   - 미성년자의 얼굴이 담긴 사진
   - 공인·유명인 등 제3자의 초상을 사칭하거나 오인하게 할 수 있는 사진
   - 타인의 사진을 무단으로 촬영·수집·복제한 사진
3. **실제 인물의 얼굴이 담긴 사진은 회사의 검증 절차를 거친 뒤에만 생성에 사용됩니다.** 올린 사진은 AI 엔진 제공자(BytePlus)의 자동 콘텐츠 검수를 거쳐 **계정마다 하나뿐인 인물 자산 그룹**에 등록되며, 그 계정의 결과물에만 쓰입니다. 회사는 신고가 접수되거나 이상 징후가 있는 계정에 대해 **카메라로 실제 인물임을 확인하는 본인 인증(BytePlus 실인물 인증)을 요구**할 수 있고, 인증을 거친 계정에서는 이후 올리는 사진이 인증된 얼굴과 대조되어 **다른 사람의 얼굴은 생성이 거부됩니다.** 인증을 요구받고 응하지 않으면 실제 인물 템플릿 이용이 제한됩니다.
4. 이용자는 올린 사진에 대해 초상권·저작권 등 필요한 권리와 동의를 갖추었음을 보증합니다. 이를 위반하여 발생하는 분쟁과 손해의 책임은 이용자에게 있으며, 회사는 위반 사실을 안 때 해당 결과물을 삭제하고 계정 이용을 제한할 수 있습니다.
5. 누구나 자신의 초상이 무단으로 사용된 결과물을 ${BUSINESS.email} 로 신고할 수 있습니다. 회사는 신고를 받은 때로부터 **${REPORT_REVIEW_HOURS}시간 이내에 검토**하고, 침해가 확인되면 결과물과 공유 링크를 즉시 삭제·무효화합니다.
6. 회사는 결과물을 만드는 데 필요한 범위에서만 사진을 처리하며, 이용자의 동의 없이 사진이나 결과물을 홍보에 사용하지 않습니다.

## 제6조 (결과물과 템플릿의 권리)

1. 결제하여 만든 결과물은 이용자가 개인적·상업적으로 이용할 수 있습니다. 다만 법령과 이 약관에 반하는 이용(타인 사칭, 명예훼손, 음란·폭력적 목적 등)은 금지합니다.
2. 템플릿(장면·프롬프트·구성)과 예시 영상의 권리는 회사에 있습니다. 템플릿의 프롬프트는 공개되지 않으며, 서비스의 상당 부분을 복제하여 유사 서비스를 제공하는 행위는 금지합니다.
3. 결과물의 공유 링크는 발급일로부터 **${SHARE_LINK_DAYS}일 뒤 만료**됩니다. 결과물 자체는 계정에 남습니다.

## 제7조 (금지행위)

이용자는 다음 행위를 하여서는 안 됩니다.

1. 제5조를 위반하여 타인의 얼굴로 결과물을 만드는 행위
2. 결과물을 사칭·사기·명예훼손·성적 목적 등 위법한 용도로 이용하는 행위
3. 회사의 검증 절차나 본인 인증을 우회하거나, 다른 사람의 계정·인증을 이용하는 행위
4. 자동화된 수단으로 서비스를 과도하게 이용하거나 콘텐츠를 대량 수집하는 행위
5. 법령과 공서양속에 반하는 사진·콘텐츠를 올리는 행위

## 제8조 (캠페인)

1. 캠페인은 브랜드가 정한 템플릿으로 선정된 크리에이터가 각자 자신의 얼굴로 결과물을 만들어 지정된 채널에 게시하고, 검수 후 원고료를 받는 프로그램입니다.
2. 원고료 규칙, 지원·게시 마감, 게시 조건은 각 캠페인 페이지에 숫자로 표시됩니다. 지원 시 이 조건에 동의한 것으로 봅니다.
3. 크리에이터는 게시물에 **광고 표기(#광고)** 를 하여야 하며(표시·광고의 공정화에 관한 법률), 표기가 없는 게시물은 검수를 통과하지 못합니다.
4. 원고료는 검수 통과 후 캠페인에 표시된 홀드 기간이 지난 뒤 지급됩니다. 지급에 필요한 정보는 별도로 안내합니다.
5. 브랜드의 캠페인 의뢰는 서비스의 의뢰 폼으로 접수하며, 실제 진행 조건은 회사와 브랜드 사이의 별도 합의로 정합니다.

## 제9조 (서비스의 변경과 중단)

회사는 서비스의 내용을 변경하거나 중단할 수 있습니다. 서비스를 종료할 때에는 최소 30일 전에 서비스 내 공지 또는 이메일로 알리고, 결제되었으나 완성되지 않은 결과물은 환불정책에 따라 환불합니다.

## 제10조 (책임의 한계)

1. 결과물은 외부 AI 모델이 생성하므로 같은 사진과 템플릿으로도 결과가 매번 다를 수 있습니다. 회사는 예시 영상과 완전히 같은 결과를 보증하지 않습니다.
2. 회사는 이용자가 결과물을 서비스 밖에서 이용하는 방법의 적법성에 대해 책임지지 않습니다. 다만 제5조의 검증·관리 기준은 회사가 직접 운영합니다.

## 제11조 (준거법과 관할)

이 약관은 대한민국 법령에 따르며, 분쟁은 민사소송법상 관할 법원에 제기합니다.`;

const TERMS_EN = `## 1. Purpose

These terms govern the use of TWINGS (the "Service"), operated by ${BUSINESS.name} (the "Company").

## 2. What the Service is

1. The Service takes **one photo of your own face** and places you in a scene the Company has made and verified in advance (a "template"), producing an AI film or image (a "result").
2. Results are generated by third-party AI models the Company contracts (Seedance and Seedream on BytePlus ModelArk, GPT Image by OpenAI). Each template page says which model it runs on.
3. The Service also runs "campaigns": brands commission a template, selected creators make and post it, and the Company reviews and pays out (section 8).

## 3. Accounts

1. You sign in with a Google or Kakao account. There is no separate password.
2. **You must be at least 14 years old.**
3. An account is personal. It may not be transferred or shared.
4. You may request deletion of your account at any time from the account page.

## 4. Payment for template results

1. A result is **paid for once, per template**. The price is shown on each template page in Korean won. **This is not a subscription.**
2. There is no stored value, points or credits on the Service. A payment buys exactly the one result made with it.
3. Rendering starts as soon as payment completes. The result is kept in your account under "My work", and an email tells you when it is ready.
4. Refunds follow the Refund Policy.

## 4A. Brand campaign service payments

1. Brand campaign payments collect **TWINGS's own service fees** for the "TWINGS Brand Campaign Operations Service". They do not collect funds to pass on to participants or provide a participant payout service.
2. Each quote specifies the final total, tax basis, scope, start conditions and refund conditions, validity period, and the reference and version of the agreed document. The amount charged is the Korean-won total in the accepted quote and cannot be changed at checkout.
3. A completed payment records receipt of funds. It **does not automatically** publish a campaign, select participants, start production or pay creator fees. Work proceeds after the quoted start conditions are met and confirmed by the Company and the brand.
4. A participant reward proposal is separate from the TWINGS service quote. Submission or studio review alone does not establish a participant reward or pay it, and does not change campaign terms already accepted by applicants.
5. At present, collection prioritizes contracts whose agreed refund conditions can be handled through full refunds. Refund eligibility and amount are assessed under the relevant quote and applicable law. This section does not limit statutory withdrawal or refund rights. See section 8 of the Refund Policy.

## 5. Photos and likeness — the verification and management standard

1. You may upload **only photos of your own face**.
2. A photo showing another person may be uploaded only with that person's explicit consent, and the following may never be uploaded, consent or not:
   - photos showing a minor's face;
   - photos that impersonate or could be mistaken for a public figure or any third party;
   - photos of others taken, collected or copied without permission.
3. **A photo of a real person is used for rendering only after the Company's checks.** Each upload passes the AI provider's (BytePlus) automated content moderation and is registered to **the one likeness asset group an account may hold**, usable only for that account's results. Where a report is received or an account shows warning signs, the Company may **require real-person verification — a camera check that a live person is present (BytePlus real-person verification)**; on a verified account every later photo is compared with the verified face and **another person's face is refused.** An account that is asked to verify and does not is restricted from real-person templates.
4. You warrant that you hold the rights and consents the photo requires. You are responsible for disputes and damages arising from a breach; on learning of one the Company removes the result and may restrict the account.
5. Anyone may report a result that uses their likeness without permission at ${BUSINESS.email}. The Company reviews a report **within ${REPORT_REVIEW_HOURS} hours** and, where an infringement is confirmed, deletes the result and voids its share link at once.
6. The Company processes photos only as far as making the result requires, and never uses a photo or result in its promotion without your consent.

## 6. Rights in results and templates

1. You may use a result you paid for personally and commercially, except for uses that are unlawful or breach these terms (impersonation, defamation, sexual or violent purposes and the like).
2. Templates (scenes, prompts, composition) and sample films remain the Company's. Template prompts are not published, and reproducing a substantial part of the Service to offer a similar one is prohibited.
3. A result's share link **expires ${SHARE_LINK_DAYS} days** after it is issued. The result itself stays in your account.

## 7. Prohibited conduct

1. Making a result with someone else's face in breach of section 5.
2. Using a result for impersonation, fraud, defamation, sexual purposes or any other unlawful end.
3. Circumventing the Company's checks or real-person verification, or using another person's account or verification.
4. Automated overuse of the Service or bulk collection of its content.
5. Uploading photos or content that are unlawful or offend public order.

## 8. Campaigns

1. A campaign is a programme in which selected creators each make a result from a brand's template with their own face, post it on the named channel, and are paid a fee after review.
2. The fee rule, the application and posting deadlines and the posting requirements are stated in numbers on each campaign page. Applying means accepting them.
3. Creators must mark posts as **advertising (#ad / #광고)** under Korea's Fair Labelling and Advertising Act; an unmarked post fails review.
4. Fees are paid after review, once the hold period shown on the campaign has passed. Payout details are requested separately.
5. Brand commissions arrive through the enquiry form on the Service; the actual engagement is agreed separately between the Company and the brand.

## 9. Changes to the Service

The Company may change or discontinue the Service. Before discontinuation it gives at least 30 days' notice in the Service or by email, and refunds any paid result that has not been completed, under the Refund Policy.

## 10. Limits of liability

1. Results are generated by third-party AI models, so the same photo and template may produce different results each time. The Company does not warrant a result identical to the sample film.
2. The Company is not responsible for how you use a result outside the Service. The verification and management standard in section 5 is operated by the Company itself.

## 11. Governing law

These terms are governed by the laws of the Republic of Korea.`;

// ---------------------------------------------------------------------------
// 환불정책 / Refund policy
// ---------------------------------------------------------------------------

const REFUND_KO = `## 1. 무엇을 파는가

제1항부터 제7항까지는 템플릿 결과물 결제에 적용하며, 브랜드 캠페인 서비스 대금은 제8항에서 별도로 안내합니다.

TWINGS의 템플릿 유료 상품은 **템플릿 한 편당 한 번 결제**하는 맞춤 생성 결과물(AI 영상·이미지)입니다. 가격은 템플릿 페이지에 원화로 표시되며, **정기결제가 아닌 일회성 결제**입니다. 충전식 재화, 포인트, 이용권은 판매하지 않습니다.

결제가 완료되면 이용자가 올린 사진으로 결과물 생성이 곧바로 시작됩니다. 결과물은 이용자 한 사람을 위해 그때 만들어지는 디지털콘텐츠입니다.

## 2. 청약철회 (전액 환불)

전자상거래 등에서의 소비자보호에 관한 법률 제17조에 따라, 결제일로부터 7일 이내에 청약철회를 요청할 수 있습니다. **결과물 생성이 시작되기 전에는 전액 환불**합니다.

다만 같은 법 제17조 제2항 제5호에 따라 **디지털콘텐츠의 제공이 시작된 뒤에는 청약철회가 제한**됩니다. 결과물 생성은 결제 즉시 시작되므로, 결제 화면에서 이 사실을 미리 안내하고 동의를 받습니다.

## 3. 생성이 실패한 경우

회사 또는 AI 모델의 사정으로 결과물이 만들어지지 않은 경우(생성 실패 안내를 받은 경우) **전액 환불**합니다. 별도 요청이 없어도 확인되는 대로 처리하며, 늦어도 7일 이내에 ${BUSINESS.email} 로 알려주시면 바로 처리합니다.

## 4. 결과물에 명백한 하자가 있는 경우

올린 얼굴이 반영되지 않았거나 영상이 재생되지 않는 등 명백한 하자가 있으면, 결과물을 받은 날로부터 7일 이내에 요청하시면 **무상 재생성 1회 또는 전액 환불** 중 하나로 처리합니다.

표시·광고 내용과 다르거나 계약대로 제공되지 않은 경우에는 전자상거래법 제17조 제3항에 따른 청약철회 기간(공급받은 날부터 3개월, 그 사실을 안 날 또는 알 수 있었던 날부터 30일)을 적용합니다. 위 7일 안내가 법령에 따른 권리를 제한하지는 않습니다.

## 5. 환불되지 않는 경우

- 완성된 결과물이 정상적으로 제공된 뒤의 단순 변심 (예시 영상과 분위기가 다르다는 이유 등)
- 이용약관 제5조·제7조를 위반하여 이용이 제한된 경우
- 청약철회 기간이 지난 뒤 정상적으로 제공된 결과물에 대한 단순 변심

위 사유에 따른 단순 변심은 환불되지 않습니다. 다만 서비스의 하자나 표시·광고 및 계약 내용과 다른 제공에 대한 법령상 청약철회·환불 권리는 별도로 적용됩니다.

## 6. 서비스 종료 시

회사의 사정으로 서비스를 종료하는 경우, 결제되었으나 완성되지 않은 결과물은 기한 없이 전액 환불합니다.

## 7. 환불 신청 방법

${BUSINESS.email} 로 **결제하신 이메일 주소와 결제 일시**를 적어 보내주세요. 영업일 기준 3일 이내에 회신합니다. 법령상 청약철회가 가능한 경우에는 청약철회 의사를 전달한 날부터 3영업일 이내에 원래 결제 수단으로 환불합니다. 카드사에 취소 내역이 반영되기까지는 추가 시간이 걸릴 수 있습니다.

## 8. 브랜드 캠페인 서비스 대금

브랜드 캠페인 결제는 TWINGS 자체 서비스 대금을 수납하며 참여자 원고료 지급과 분리합니다. 서비스의 제공 범위, 시작 조건과 환불 조건은 수락한 견적에 명시합니다. 입금 확인만으로 제작이 시작되지는 않습니다.

현재는 합의된 환불 조건을 전액 환불로 처리할 수 있는 계약을 우선 수납합니다. 환불의 대상과 금액은 해당 견적에 명시한 조건과 적용되는 법령에 따라 확인합니다. 환불이 확정되면 원래 결제 수단으로 처리하며, 제공사 처리 결과가 확인되지 않은 경우 완료로 안내하지 않고 확인 중임을 알립니다.

이 안내는 법령상 보장된 청약철회·환불 권리를 제한하지 않습니다.`;

const REFUND_EN = `## 1. What is sold

Sections 1 through 7 apply to template result payments. Brand campaign service payments are addressed separately in section 8.

The paid template item on TWINGS is a made-to-order result (an AI film or image), **paid for once per template**. The price is shown on the template page in Korean won. It is a **one-time payment, not a subscription**. No stored value, points or credits are sold.

Rendering starts as soon as payment completes, using the photo you uploaded. The result is digital content made at that moment for you alone.

## 2. Withdrawal (full refund)

Under Korea's Act on Consumer Protection in Electronic Commerce, Article 17, you may withdraw within 7 days of payment. **Before rendering has started, you are refunded in full.**

Under Article 17(2)(5) of the same Act, withdrawal is restricted **once delivery of digital content has begun**. Because rendering begins immediately after payment, the checkout says so before you pay and asks for your agreement.

## 3. If rendering fails

If no result is produced for reasons on the Company's or the AI model's side (you receive a failure notice), you are **refunded in full**. This is processed as soon as it is confirmed; writing to ${BUSINESS.email} within 7 days makes it immediate.

## 4. If the result is plainly defective

If your face is not reflected, the film does not play, or the result is otherwise plainly defective, ask within 7 days of receiving it and you get **one free re-render or a full refund**, your choice.

If delivery differs from the advertised or agreed terms, the withdrawal periods in Article 17(3) of the same Act apply: within 3 months of delivery or within 30 days of when you learned or could have learned of the problem. The 7-day service remedy above does not limit statutory rights.

## 5. When a refund is not available

- A change of mind after a completed result has been delivered (for example, that the mood differs from the sample).
- Access was restricted for conduct prohibited under sections 5 and 7 of the Terms.
- A change of mind about a properly delivered result after the applicable withdrawal period.

These changes of mind are not refundable. Statutory withdrawal and refund rights for defects or delivery that differs from the advertised or agreed terms still apply.

## 6. If the Service closes

If the Company discontinues the Service, every paid result that has not been completed is refunded in full, with no deadline to claim.

## 7. How to request one

Email ${BUSINESS.email} with **the address you paid from and the date of the payment**. We reply within 3 business days. Where statutory withdrawal applies, we refund the original payment method within 3 business days of receiving your withdrawal. Your card issuer may take additional time to display the cancellation.

## 8. Brand campaign service payments

Brand campaign payments collect TWINGS's own service fees, separately from creator fee payments. The accepted quote states the scope of service, start conditions and refund conditions. Receipt of funds alone does not start production.

At present, collection prioritizes contracts whose agreed refund conditions can be handled through full refunds. Refund eligibility and amount are assessed under the quoted conditions and applicable law. Once a refund is confirmed, it is processed through the original payment method. An unconfirmed provider result is described as pending, not completed.

This guidance does not limit statutory withdrawal or refund rights.`;

// ---------------------------------------------------------------------------
// 개인정보처리방침 / Privacy
// ---------------------------------------------------------------------------

const PRIVACY_KO = `## 1. 수집하는 개인정보

| 구분 | 항목 | 수집 시점 |
|---|---|---|
| 필수 | 이메일 주소, 프로필 이름 | Google 또는 카카오 로그인 시 |
| 필수 | 언어 설정, 알림 설정 | 서비스 이용 시 |
| 필수 | **얼굴 사진**(이용자가 올린 사진), 생성된 결과물 | 결과물을 만들 때 |
| 필수 | 인물 자산 식별자(자산 그룹·자산 ID), 카메라 본인 인증을 거친 경우 그 결과 | 실제 인물 사진으로 결과물을 만들 때 |
| 선택 | 활동 SNS 주소, 팔로워 수, 게시물 링크, 조회수 | 캠페인 지원·게시 시 |
| 선택 | 회사명, 담당자 이름, 직위, 업무 이메일, 연락처, 예산대, 문의 내용 | 브랜드 캠페인 의뢰 시 |
| 자동 | 접속 기록, 브라우저 정보 | 서비스 이용 시 |

본인 인증 과정에서 카메라로 촬영되는 얼굴 영상은 인증 제공자(BytePlus)가 처리하며, **회사 서버에는 저장되지 않습니다.** 회사는 인증 결과와 식별자만 보관합니다.

회사는 주민등록번호를 수집하지 않으며, 결제 수단 정보(카드번호 등)는 결제대행사가 처리하고 회사 서버에 저장하지 않습니다.

## 2. 이용 목적

1. 회원 식별과 로그인 유지
2. 이용자가 고른 템플릿으로 결과물을 만들고 계정에 보관·전달
3. 실제 인물의 얼굴로 결과물을 만들 때 본인 여부 확인(이용약관 제5조)
4. 캠페인의 지원·선정·검수·정산 처리와 브랜드 의뢰 회신
5. 결제·환불 처리 및 관련 법령상 거래기록 보존
6. 완성 알림 등 서비스 이용에 필요한 이메일 발송
7. 서비스 개선을 위한 통계 분석

## 3. 보유 기간

- 회원 정보: 회원 탈퇴 시까지. 탈퇴 요청을 받으면 7일 이내에 삭제합니다.
- 얼굴 사진과 결과물: 결과물을 계정에서 제공하는 동안. 계정을 삭제하면 함께 삭제되며, 결과물의 공유 링크는 발급 후 ${SHARE_LINK_DAYS}일이 지나면 만료됩니다.
- 인물 자산 식별자와 인증 결과: 계정이 유지되는 동안. 계정 삭제 시 엔진 제공자에 등록된 자산 그룹과 자산도 삭제를 요청합니다.
- 캠페인 기록: 정산 완료 후 5년(전자상거래법·세법상 거래기록).
- 브랜드 의뢰: 회신 후 1년.
- 결제·거래 기록: 전자상거래법에 따라 5년간 보관합니다.

## 4. 제3자 제공

회사는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 다음은 예외로 합니다.

- 캠페인에 선정된 크리에이터의 활동명·SNS 주소·게시물 링크를 해당 캠페인의 브랜드에 전달하는 경우(지원 시 동의)
- 법령에 따른 요구가 있는 경우

## 5. 처리 위탁과 국외 이전

결과물 생성과 본인 인증은 아래 국외 사업자가 처리합니다. 사진은 결과물을 만드는 동안만 전송·처리되며, 각 사업자의 개인정보 처리 기준을 따릅니다.

| 수탁자 (국가) | 위탁 업무 | 이전되는 항목 |
|---|---|---|
| BytePlus Pte. Ltd. (싱가포르) | 실인물 인증, 영상·이미지 생성(Seedance·Seedream) | 얼굴 사진, 인증 시 촬영되는 얼굴 영상 |
| OpenAI, L.L.C. (미국) | 이미지 생성(GPT Image) | 얼굴 사진 |
| Supabase Inc. (미국) | 데이터베이스·인증·파일 저장 | 회원 정보, 사진, 결과물 |
| Vercel Inc. (미국) | 웹 호스팅 | 접속 기록 |
| Cloudflare, Inc. (미국) | 공개 미디어 전송 | 접속 기록 |
| Google LLC (미국) / Kakao Corp. (한국) | 로그인 인증 | 이메일, 프로필 이름 |
| Resend, Inc. (미국) | 이메일 발송 | 이메일 주소 |
| 결제대행사 (토스페이먼츠, 연동 시 상호 명시) | 결제 처리 | 결제 정보 |

## 6. 이용자의 권리

이용자는 언제든지 자신의 개인정보를 조회·수정·삭제하거나 처리 정지를 요구할 수 있습니다. 서비스 내 계정 페이지 또는 ${BUSINESS.email} 로 요청하시면 됩니다. 자신의 얼굴이 무단으로 사용된 결과물의 삭제도 같은 주소로 요청할 수 있으며, ${REPORT_REVIEW_HOURS}시간 이내에 검토합니다.

## 7. 브라우저 쿠키와 추적

서비스는 로그인 유지와 언어 설정을 위한 필수 쿠키만 사용하며, 광고 목적의 추적 도구를 사용하지 않습니다.

## 8. 만 14세 미만

서비스는 만 14세 미만 아동의 가입을 받지 않으며, 아동의 개인정보를 알게 된 경우 지체 없이 삭제합니다.

## 9. 개인정보 보호책임자

- 담당: ${BUSINESS.representative}
- 이메일: ${BUSINESS.email}`;

const PRIVACY_EN = `## 1. What we collect

| Type | Data | When |
|---|---|---|
| Required | Email address, profile name | Google or Kakao sign-in |
| Required | Language and notification settings | Using the Service |
| Required | **Face photo** (the one you upload), the generated result | Making a result |
| Required | Likeness asset identifiers (asset group and asset IDs) and, where a camera check was run, its outcome | Making a result from a real-person photo |
| Optional | SNS link, follower count, post link, view count | Applying to and posting in a campaign |
| Optional | Company, contact name, job title, work email, phone, budget range, enquiry text | Sending a brand enquiry |
| Automatic | Access logs, browser information | Using the Service |

The face video captured during verification is processed by the verification provider (BytePlus) and **is not stored on our servers**. We keep only the outcome and an identifier.

We do not collect national identification numbers. Payment instrument details (card numbers and the like) are handled by the payment provider and never stored on our servers.

## 2. Why

1. Identifying you and keeping you signed in.
2. Making the result for the template you chose, and keeping and delivering it in your account.
3. Confirming it is you when a result uses a real person's face (Terms, section 5).
4. Running campaign applications, selection, review and payout, and answering brand enquiries.
5. Processing payments and refunds, and keeping transaction records required by law.
6. Sending the emails the Service needs, such as the "your film is ready" notice.
7. Aggregate analysis to improve the Service.

## 3. How long

- Account data: until you delete your account. Deletion requests are completed within 7 days.
- Face photos and results: while the result is available in your account. They are deleted with the account; a result's share link expires ${SHARE_LINK_DAYS} days after it is issued.
- Likeness asset identifiers and verification outcome: while the account exists; on deletion we also request deletion of the asset group and assets registered with the provider.
- Campaign records: 5 years after payout (e-commerce and tax record-keeping).
- Brand enquiries: 1 year after our reply.
- Payment and transaction records: 5 years, as required by Korean e-commerce law.

## 4. Sharing

We do not sell or share personal data with third parties, except:

- a selected creator's display name, SNS link and post link are passed to the brand running that campaign (agreed on applying);
- where required by law.

## 5. Processors and international transfers

Rendering and verification are performed by the providers below, outside Korea. A photo is transferred only for as long as making the result takes, under each provider's data-processing terms.

| Processor (country) | Purpose | Data transferred |
|---|---|---|
| BytePlus Pte. Ltd. (Singapore) | Real-person verification; film and image generation (Seedance, Seedream) | Face photo; face video captured during verification |
| OpenAI, L.L.C. (United States) | Image generation (GPT Image) | Face photo |
| Supabase Inc. (United States) | Database, authentication, file storage | Account data, photos, results |
| Vercel Inc. (United States) | Web hosting | Access logs |
| Cloudflare, Inc. (United States) | Public media delivery | Access logs |
| Google LLC (United States) / Kakao Corp. (Korea) | Sign-in | Email, profile name |
| Resend, Inc. (United States) | Email delivery | Email address |
| Payment provider (Toss Payments, named here once connected) | Payment processing | Payment data |

## 6. Your rights

You may access, correct, delete or restrict processing of your data at any time — from the account page, or by writing to ${BUSINESS.email}. The same address takes requests to remove a result that uses your likeness without permission; these are reviewed within ${REPORT_REVIEW_HOURS} hours.

## 7. Browser cookies

The Service sets only the cookies needed to keep you signed in and to remember your language. There is no advertising or tracking pixel.

## 8. Children

The Service does not accept users under 14, and deletes a child's data without delay on becoming aware of it.

## 9. Contact

- Data protection officer: ${BUSINESS.representative}
- Email: ${BUSINESS.email}`;

// ---------------------------------------------------------------------------

const DOCUMENTS: Record<LegalDoc, Record<Locale, LegalDocument>> = {
  terms: {
    ko: { title: '이용약관', summary: 'TWINGS 서비스 이용 조건과 사진·초상권 기준입니다.', body: TERMS_KO },
    en: { title: 'Terms of Service', summary: 'The terms you use TWINGS under, including the photo and likeness standard.', body: TERMS_EN },
  },
  refund: {
    ko: {
      title: '환불정책',
      summary: '템플릿 한 편당 결제의 청약철회와 환불 기준입니다.',
      body: REFUND_KO,
    },
    en: {
      title: 'Refund Policy',
      summary: 'How withdrawal and refunds work for a per-template payment.',
      body: REFUND_EN,
    },
  },
  privacy: {
    ko: {
      title: '개인정보처리방침',
      summary: '수집하는 개인정보, 얼굴 사진의 처리, 국외 이전 내역입니다.',
      body: PRIVACY_KO,
    },
    en: {
      title: 'Privacy Policy',
      summary: 'What we collect, how face photos are handled, and where they are processed.',
      body: PRIVACY_EN,
    },
  },
};

export function legalDocument(doc: LegalDoc, locale: Locale): LegalDocument {
  return DOCUMENTS[doc][locale];
}

/** The §21 seller block, rendered under every legal document. */
export function businessRows(locale: Locale): Array<[string, string]> {
  const ko = locale === 'ko';
  return [
    [ko ? '상호' : 'Company', ko ? BUSINESS.nameKo : BUSINESS.name],
    [ko ? '대표자' : 'Representative', BUSINESS.representative],
    [ko ? '사업자등록번호' : 'Business registration no.', BUSINESS.registrationNumber],
    [ko ? '통신판매업 신고번호' : 'Mail-order sales registration no.', BUSINESS.mailOrderNumber],
    [ko ? '사업장 주소' : 'Address', ko ? BUSINESS.address : BUSINESS.addressEn],
    [ko ? '연락처' : 'Phone', ko ? BUSINESS.phone : BUSINESS.phoneEn],
    [ko ? '이메일' : 'Email', BUSINESS.email],
    [ko ? '호스팅 제공자' : 'Hosting provider', BUSINESS.host],
    [
      ko ? '구매안전서비스' : 'Buyer protection (escrow)',
      ko
        ? `${ESCROW.bank} ${ESCROW.service} 가입 (2026-09-02)`
        : `${ESCROW.bankEn} — ${ESCROW.serviceEn}, enrolled 2026-09-02`,
    ],
  ];
}

/**
 * The same facts as one or two footer lines on every page (전자상거래법 §21 puts them on the site,
 * not only on the policy pages — founder, 2026-09-11). The 통신판매업 number joins the line the day
 * it exists; until then the footer says nothing rather than printing a placeholder to customers.
 */
export function businessFooterLines(locale: Locale): string[] {
  const ko = locale === 'ko';
  const identity = [
    ko ? BUSINESS.nameKo : BUSINESS.name,
    `${ko ? '대표' : 'CEO'} ${BUSINESS.representative}`,
    `${ko ? '사업자등록번호' : 'Business reg. no.'} ${BUSINESS.registrationNumber}`,
    ...(hasMailOrderNumber() ? [`${ko ? '통신판매업신고' : 'Mail-order reg. no.'} ${BUSINESS.mailOrderNumber}`] : []),
  ].join(' · ');
  const contact = [ko ? BUSINESS.address : BUSINESS.addressEn, ko ? BUSINESS.phone : BUSINESS.phoneEn, BUSINESS.email].join(' · ');
  return [identity, contact];
}
