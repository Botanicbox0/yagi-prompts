import type { Locale } from '@/lib/i18n/config';
import { PACK_COOKIES, PACK_PRICE_USD, SIGNUP_COOKIES, WEEKLY_COOKIES } from '@/lib/cookies/wallet';

/**
 * The legal surface (founder direction, 2026-08-14): 이용약관 · 환불정책 · 개인정보처리방침.
 *
 * Why it exists now: a domestic PG (토스페이먼츠 / 카카오페이 via 포트원) will not pass a merchant
 * review without them, and 전자상거래법 §21 requires the seller identification block on the site
 * regardless of which gateway is chosen. So these pages are a payment PREREQUISITE, not paperwork.
 *
 * Three deliberate shapes:
 *   · the text lives HERE as markdown, not in `messages/*.ts`. The dictionaries are UI strings a
 *     translator keeps in step; a legal document is a versioned artefact with an effective date,
 *     and mixing them would put a refund clause behind a completeness test that cares about button
 *     labels. It renders through the same strict markdown renderer the contests brief uses;
 *   · every business identifier is a NAMED PLACEHOLDER in one object (`BUSINESS`). The founder
 *     fills it once; nothing else in the repo repeats a registration number;
 *   · the product facts (3 free cookies, +1 weekly, $4 for 5) are INTERPOLATED from
 *     `lib/cookies/wallet.ts`, so the policy cannot drift from the code that charges.
 *
 * NOT legal advice: this is a careful draft that describes what the product actually does, written
 * to be reviewed. The refund clause follows 전자상거래법 §17 for digital content — see below.
 */

/**
 * 전자상거래법 §21 표시사항. Every `TODO` is a fact only the founder holds; the pages render the
 * placeholder verbatim so an unfilled field is visible rather than silently absent.
 */
export const BUSINESS = {
  name: 'YAGI Workshop',
  nameKo: '야기워크숍',
  representative: 'TODO — 대표자 성명',
  registrationNumber: 'TODO — 사업자등록번호 (000-00-00000)',
  mailOrderNumber: 'TODO — 통신판매업 신고번호 (제0000-서울0000호)',
  address: 'TODO — 사업장 주소',
  phone: 'TODO — 연락처',
  email: 'hello@yagiworkshop.xyz',
  host: 'Vercel Inc. · Supabase Inc.',
} as const;

export const LEGAL_DOCS = ['terms', 'refund', 'privacy'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

/** The effective date printed on every document. Bump it whenever the text below changes. */
export const LEGAL_EFFECTIVE = '2026-08-14';

interface LegalDocument {
  title: string;
  summary: string;
  body: string;
}

const money = `$${PACK_PRICE_USD}`;

// ---------------------------------------------------------------------------
// 이용약관 / Terms
// ---------------------------------------------------------------------------

const TERMS_KO = `## 제1조 (목적)

이 약관은 ${BUSINESS.nameKo}(이하 "회사")가 운영하는 YAGI PROMPTS(이하 "서비스")의 이용 조건과 절차, 회사와 이용자의 권리·의무를 정합니다.

## 제2조 (서비스의 내용)

1. 서비스는 회사가 직접 작성하고 실행해 본 AI 영상·이미지·오디오 프롬프트와 그 제작 과정을 공개하는 웹사이트입니다.
2. 서비스는 이용자를 대신해 AI 생성을 수행하지 않습니다. 어떤 모델에 무엇을 어떤 값으로 입력하는지를 제공합니다.
3. 커뮤니티 프롬프트는 이용자가 제출하고 회사가 검수한 뒤 게시됩니다.

## 제3조 (회원가입과 계정)

1. 이용자는 Google 계정으로 로그인하여 회원이 될 수 있습니다.
2. 계정은 본인만 사용할 수 있으며, 타인에게 양도하거나 공유할 수 없습니다.
3. 이용자는 서비스 내 계정 페이지에서 언제든지 탈퇴를 요청할 수 있습니다.

## 제4조 (쿠키 — 유료 이용권)

1. "쿠키"는 잠긴 프롬프트 원문을 열람할 수 있는 서비스 내 이용권입니다.
2. 쿠키 1개로 프롬프트 1개를 열람하며, 한 번 연 프롬프트는 해당 계정에서 계속 볼 수 있습니다.
3. 회원가입 시 ${SIGNUP_COOKIES}개가 무료로 지급되고, 이후 매주 ${WEEKLY_COOKIES}개가 무료로 지급됩니다. 무료 쿠키는 이월·누적되지 않습니다.
4. 유료 쿠키는 ${money}에 ${PACK_COOKIES}개 단위로 구매하며, **정기결제가 아닙니다.**
5. 쿠키는 계정이 유지되는 동안 유효하며 별도의 소멸 기한을 두지 않습니다. 다만 회원 탈퇴 시 잔여 쿠키는 소멸합니다.
6. 쿠키는 현금으로 환급되지 않으며, 환불은 별도의 환불정책을 따릅니다.

## 제5조 (콘텐츠와 저작권)

1. 회사가 게시한 프롬프트·영상·오디오·제작 과정 문서의 권리는 회사에 있습니다.
2. 이용자는 열람한 프롬프트를 본인의 창작 활동에 사용할 수 있습니다. 다만 프롬프트 원문을 그대로 재배포하거나, 서비스의 상당 부분을 복제하여 유사 서비스를 제공하는 행위는 금지합니다.
3. 이용자가 제출한 프롬프트·작품의 권리는 제출자에게 있으며, 이용자는 회사가 이를 서비스와 홍보 채널에 크레딧과 함께 게시할 수 있는 이용 허락을 부여합니다.
4. 회사는 검수 기준에 맞지 않는 제출물의 게시를 거절하거나 게시된 제출물을 내릴 수 있습니다.

## 제6조 (금지행위)

이용자는 다음 행위를 하여서는 안 됩니다.

1. 타인의 저작물을 자신의 것으로 제출하는 행위
2. 자동화된 수단으로 서비스를 과도하게 조회하거나 콘텐츠를 대량 수집하는 행위
3. 서비스의 접근 통제(쿠키 열람 제한 등)를 우회하려는 행위
4. 법령과 공서양속에 반하는 콘텐츠를 제출하는 행위

## 제7조 (서비스의 변경과 중단)

회사는 서비스의 내용을 변경하거나 중단할 수 있습니다. 유료 쿠키에 영향을 주는 중대한 변경이나 서비스 종료 시에는 최소 30일 전에 서비스 내 공지 또는 이메일로 알리고, 사용하지 않은 유료 쿠키에 대해 환불정책에 따라 환불합니다.

## 제8조 (책임의 한계)

1. 서비스가 제공하는 프롬프트는 게시 시점에 회사가 실행하여 확인한 결과를 기준으로 합니다. 외부 AI 모델의 정책·버전 변경으로 동일한 결과가 보장되지 않을 수 있습니다.
2. 회사는 이용자가 서비스를 이용해 생성한 결과물의 적법성·상업적 이용 가능성에 대해 보증하지 않습니다. 각 AI 모델 제공자의 이용약관은 이용자가 확인하여야 합니다.

## 제9조 (준거법과 관할)

이 약관은 대한민국 법령에 따르며, 분쟁은 민사소송법상 관할 법원에 제기합니다.`;

const TERMS_EN = `## 1. Purpose

These terms govern the use of YAGI PROMPTS (the "Service"), operated by ${BUSINESS.name} (the "Company").

## 2. What the Service is

1. The Service publishes AI video, image and audio prompts written and test-run by the Company, together with write-ups of how the results were made.
2. The Service does not run generations on your behalf. It tells you what to run, where, and with which values.
3. Community prompts are submitted by users and published after review.

## 3. Accounts

1. You may create an account by signing in with Google.
2. An account is personal. It may not be transferred or shared.
3. You may request deletion of your account at any time from the account page.

## 4. Cookies (paid access credits)

1. A "cookie" is an in-service credit that opens the full text of a gated prompt.
2. One cookie opens one prompt, and a prompt you have opened stays open on that account.
3. ${SIGNUP_COOKIES} cookies are granted free on signup, and ${WEEKLY_COOKIES} more free each week. Free cookies do not accumulate.
4. Paid cookies are sold in packs of ${PACK_COOKIES} for ${money}. **This is a one-time purchase, not a subscription.**
5. Cookies do not expire while the account exists. Cookies remaining at account deletion are forfeited.
6. Cookies are not exchangeable for cash. Refunds follow the Refund Policy.

## 5. Content and rights

1. Prompts, clips, audio and process write-ups published by the Company remain the Company's.
2. You may use a prompt you have opened in your own work. You may not redistribute prompt text verbatim, or reproduce a substantial part of the Service to offer a similar one.
3. You keep the rights to anything you submit. You grant the Company a licence to display it, with your credit, on the Service and in its promotion.
4. The Company may decline to publish, or may unpublish, a submission that does not meet its review standard.

## 6. Prohibited conduct

1. Submitting someone else's work as your own.
2. Automated bulk collection of Service content.
3. Circumventing access controls, including the cookie gate.
4. Submitting content that is unlawful or offends public order.

## 7. Changes to the Service

The Company may change or discontinue the Service. For a material change affecting paid cookies, or for discontinuation, the Company will give at least 30 days' notice in the Service or by email and refund unused paid cookies under the Refund Policy.

## 8. Limits of liability

1. Prompts reflect results the Company obtained at the time of publication. Model policy or version changes by third-party providers may produce different results.
2. The Company does not warrant the legality or commercial usability of anything you generate. The terms of each AI model provider are yours to check.

## 9. Governing law

These terms are governed by the laws of the Republic of Korea.`;

// ---------------------------------------------------------------------------
// 환불정책 / Refund policy
// ---------------------------------------------------------------------------

const REFUND_KO = `## 1. 무엇을 파는가

YAGI PROMPTS의 유료 상품은 "쿠키" ${PACK_COOKIES}개 묶음(${money})이며, **정기결제가 아닌 일회성 구매**입니다. 쿠키 1개는 잠긴 프롬프트 1개의 원문을 여는 데 사용됩니다.

## 2. 청약철회 (전액 환불)

전자상거래 등에서의 소비자보호에 관한 법률 제17조에 따라, **결제일로부터 7일 이내이고 구매한 쿠키를 하나도 사용하지 않은 경우 전액 환불**해 드립니다.

## 3. 일부 사용 시 (부분 환불)

쿠키는 개별적으로 사용되는 가분적(可分的) 상품입니다. 따라서 결제일로부터 7일 이내라면 **사용하지 않은 쿠키에 한하여 개수 비례로 환불**합니다.

- 예: ${money}에 ${PACK_COOKIES}개를 구매하고 2개를 사용한 경우 → 남은 3개에 해당하는 금액을 환불합니다.
- 이미 사용한 쿠키(= 프롬프트 원문을 연 경우)는 콘텐츠 제공이 완료된 것으로 보아 환불되지 않습니다. 이 점은 결제 화면에서도 안내합니다.

## 4. 환불이 제한되는 경우

- 결제일로부터 7일이 지난 경우
- 구매한 쿠키를 모두 사용한 경우
- 이용약관 제6조의 금지행위로 이용이 제한된 경우

## 5. 무료 쿠키

가입 시 지급되는 ${SIGNUP_COOKIES}개와 매주 지급되는 ${WEEKLY_COOKIES}개는 무상 제공분이므로 환불 대상이 아닙니다.

## 6. 서비스 중단 시

회사의 사정으로 서비스를 종료하는 경우, 사용하지 않은 유료 쿠키 전액을 사용 기한 없이 환불합니다.

## 7. 환불 신청 방법

${BUSINESS.email} 로 **결제하신 이메일 주소와 결제 일시**를 적어 보내주세요. 영업일 기준 3일 이내에 회신하고, 확인 후 3영업일 이내에 결제 수단으로 환불합니다. 카드 결제의 경우 카드사 사정에 따라 취소 반영까지 추가 시간이 소요될 수 있습니다.`;

const REFUND_EN = `## 1. What is sold

The only paid item on YAGI PROMPTS is a pack of ${PACK_COOKIES} cookies for ${money}. It is a **one-time purchase, not a subscription**. One cookie opens the full text of one gated prompt.

## 2. Full refund

Within **7 days of purchase, with none of the purchased cookies used**, you get a full refund. (Korea's Act on Consumer Protection in Electronic Commerce, Article 17.)

## 3. Partial use

Cookies are spent one at a time, so a partly used pack is refunded **pro rata on the unused cookies** within the same 7 days.

- Example: you buy ${PACK_COOKIES} for ${money} and spend 2 → the value of the remaining 3 is refunded.
- A cookie already spent (the prompt text was opened) is treated as content delivered and is not refundable. The checkout says so before you pay.

## 4. When a refund is not available

- More than 7 days after purchase.
- All purchased cookies have been spent.
- Access was restricted for conduct prohibited under section 6 of the Terms.

## 5. Free cookies

The ${SIGNUP_COOKIES} signup cookies and the ${WEEKLY_COOKIES} weekly cookie are granted at no charge and are not refundable.

## 6. If the Service closes

If the Company discontinues the Service, all unused paid cookies are refunded in full, with no deadline to claim.

## 7. How to request one

Email ${BUSINESS.email} with **the address you paid from and the date of the payment**. We reply within 3 business days and refund to the original payment method within 3 business days of confirming. Card refunds may take additional time to appear, depending on the issuer.`;

// ---------------------------------------------------------------------------
// 개인정보처리방침 / Privacy
// ---------------------------------------------------------------------------

const PRIVACY_KO = `## 1. 수집하는 개인정보

| 구분 | 항목 | 수집 시점 |
|---|---|---|
| 필수 | 이메일 주소, 프로필 이름 | Google 로그인 시 |
| 필수 | 언어 설정, 쿠키 잔액·사용 내역 | 서비스 이용 시 |
| 선택 | 크레딧 표기용 @핸들 | 프롬프트 제출 시 |
| 선택 | 대표 SNS 주소 | 콘테스트 출품 시 |
| 자동 | 접속 기록, 브라우저 정보 | 서비스 이용 시 |

회사는 주민등록번호를 수집하지 않으며, 결제 수단 정보(카드번호 등)는 결제대행사가 처리하고 회사 서버에 저장하지 않습니다.

## 2. 이용 목적

1. 회원 식별과 로그인 유지
2. 쿠키 지급·차감과 열람 권한 확인
3. 제출물 검수와 크레딧 표기
4. 결제·환불 처리 및 관련 법령상 거래기록 보존
5. 서비스 개선을 위한 통계 분석

## 3. 보유 기간

- 회원 정보: 회원 탈퇴 시까지. 탈퇴 요청을 받으면 7일 이내에 삭제합니다.
- 결제·거래 기록: 전자상거래법에 따라 5년간 보관합니다.
- 게시된 제출물: 게시가 유지되는 동안. 삭제 요청 시 크레딧과 함께 내립니다.

## 4. 제3자 제공

회사는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 따른 요구가 있는 경우는 예외로 합니다.

## 5. 처리 위탁

| 수탁자 | 위탁 업무 |
|---|---|
| Supabase Inc. | 데이터베이스·인증·파일 저장 |
| Vercel Inc. | 웹 호스팅 |
| Google LLC | 로그인 인증 |
| 결제대행사 | 결제 처리 (연동 시 상호 명시) |

## 6. 이용자의 권리

이용자는 언제든지 자신의 개인정보를 조회·수정·삭제하거나 처리 정지를 요구할 수 있습니다. 서비스 내 계정 페이지 또는 ${BUSINESS.email} 로 요청하시면 됩니다.

## 7. 쿠키(브라우저)와 추적

서비스는 로그인 유지와 언어 설정을 위한 필수 쿠키만 사용하며, 광고 목적의 추적 도구를 사용하지 않습니다. (여기서의 "쿠키"는 브라우저 쿠키를 말하며, 서비스 내 이용권 "쿠키"와 다릅니다.)

## 8. 개인정보 보호책임자

- 담당: ${BUSINESS.representative}
- 이메일: ${BUSINESS.email}`;

const PRIVACY_EN = `## 1. What we collect

| Type | Data | When |
|---|---|---|
| Required | Email address, profile name | Google sign-in |
| Required | Language setting, cookie balance and history | Using the Service |
| Optional | @handle for credit | Submitting a prompt |
| Optional | Main SNS link | Entering a contest |
| Automatic | Access logs, browser information | Using the Service |

We do not collect national identification numbers. Payment instrument details (card numbers and the like) are handled by the payment provider and never stored on our servers.

## 2. Why

1. Identifying you and keeping you signed in.
2. Granting and spending cookies, and checking what you may read.
3. Reviewing submissions and crediting them.
4. Processing payments and refunds, and keeping transaction records required by law.
5. Aggregate analysis to improve the Service.

## 3. How long

- Account data: until you delete your account. Deletion requests are completed within 7 days.
- Payment and transaction records: 5 years, as required by Korean e-commerce law.
- Published submissions: while they remain published; removed with their credit on request.

## 4. Sharing

We do not sell or share personal data with third parties, except where required by law.

## 5. Processors

| Processor | Purpose |
|---|---|
| Supabase Inc. | Database, authentication, file storage |
| Vercel Inc. | Web hosting |
| Google LLC | Sign-in |
| Payment provider | Payment processing (named here once connected) |

## 6. Your rights

You may access, correct, delete or restrict processing of your data at any time — from the account page, or by writing to ${BUSINESS.email}.

## 7. Browser cookies

The Service sets only the cookies needed to keep you signed in and to remember your language. There is no advertising or tracking pixel. (These browser cookies are not the in-service "cookies" that open prompts.)

## 8. Contact

- Data protection officer: ${BUSINESS.representative}
- Email: ${BUSINESS.email}`;

// ---------------------------------------------------------------------------

const DOCUMENTS: Record<LegalDoc, Record<Locale, LegalDocument>> = {
  terms: {
    ko: { title: '이용약관', summary: 'YAGI PROMPTS 서비스 이용 조건입니다.', body: TERMS_KO },
    en: { title: 'Terms of Service', summary: 'The terms you use YAGI PROMPTS under.', body: TERMS_EN },
  },
  refund: {
    ko: {
      title: '환불정책',
      summary: '쿠키 구매의 청약철회와 환불 기준입니다.',
      body: REFUND_KO,
    },
    en: {
      title: 'Refund Policy',
      summary: 'How refunds work for cookie purchases.',
      body: REFUND_EN,
    },
  },
  privacy: {
    ko: {
      title: '개인정보처리방침',
      summary: '수집하는 개인정보와 처리 방법입니다.',
      body: PRIVACY_KO,
    },
    en: {
      title: 'Privacy Policy',
      summary: 'What we collect and what we do with it.',
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
    [ko ? '사업장 주소' : 'Address', BUSINESS.address],
    [ko ? '연락처' : 'Phone', BUSINESS.phone],
    [ko ? '이메일' : 'Email', BUSINESS.email],
    [ko ? '호스팅 제공자' : 'Hosting provider', BUSINESS.host],
  ];
}
