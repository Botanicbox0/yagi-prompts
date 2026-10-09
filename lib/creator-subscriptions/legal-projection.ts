import type { Locale } from '@/lib/i18n/config';
import { legalDocument, type LegalDoc } from '@/lib/legal/documents';
import { SUBSCRIPTION_TERMS_DRAFT } from './legal';

/** Reviewable public contract/privacy text. No approval is inferred from a deployed page. */
export const SUBSCRIPTION_PRIVACY_DRAFT = {
  ko: `## 프리미엄 맞춤 수정의 개인정보 처리

맞춤 수정을 요청하면 입력한 텍스트와 참고 이미지 최대 3장을 OpenAI, L.L.C.(미국)에 API로 전달합니다. 의상·소품 색상, 배경 색감, 조명을 조정하기 위한 처리이며, 원본 제작 프롬프트와 얼굴 기준 사진은 이 요청에 포함하지 않습니다. 참고 이미지에 다른 사람의 얼굴이나 불필요한 개인정보를 넣지 마세요.

참고 이미지는 비공개로 보관합니다. 업로드 후 7일이 지나고 수정 요청의 처리가 끝나면 자동 삭제하며, 아직 처리 중인 요청의 이미지는 처리 후 삭제합니다. 수정 요청과 처리 내역은 결과물을 계정에서 제공하는 동안 보관하고, 계정 삭제 시 함께 삭제합니다. 결제·거래 기록은 기존 보유 기간을 따릅니다.

OpenAI의 응답 저장 기능은 사용하지 않습니다. 다만 부정 사용 방지를 위한 기록은 OpenAI의 API 데이터 정책에 따라 일반적으로 최대 30일 보관될 수 있으며, 법령이나 안전 검토에 따른 예외가 있을 수 있습니다. 참고 이미지가 즉시 전부 삭제된다고 보장하지는 않습니다. 맞춤 수정에 필요한 국외 처리를 원하지 않으면 참고 이미지와 수정 요청을 보내지 않고 원래 템플릿으로 영상을 만들 수 있습니다. 개인정보 관련 문의·삭제 요청은 hello@yagiworkshop.xyz로 보내주세요.`,
  en: `## Personal data in Premium adjustments

When you request an adjustment, your text and up to three reference images are sent by API to OpenAI, L.L.C. (United States). They are used to adjust clothing and prop colors, background palette and lighting. The original production prompt and identity photo are excluded. Do not include another person's face or unnecessary personal information in references.

References are stored privately. Once seven days have passed since upload and the adjustment has finished processing, they are deleted automatically. Images for pending requests are deleted after processing. Adjustment requests and processing records are kept while results are provided in your account and deleted with the account. Payment and transaction records follow the existing retention periods.

OpenAI response storage is disabled. Abuse-monitoring records may generally be retained for up to 30 days under OpenAI's API data policy, with possible legal or safety exceptions. Immediate deletion of every reference is not guaranteed. If you do not want the overseas processing needed for adjustments, you can create the original template without sending an adjustment or references. Contact hello@yagiworkshop.xyz with privacy questions or deletion requests.`,
} as const;

function section(source: string, heading: string): string {
  const start = source.indexOf(`## ${heading}\n`);
  if (start < 0) throw new Error('subscription_legal_section_missing');
  const end = source.indexOf('\n## ', start + 3);
  return source.slice(start, end < 0 ? undefined : end).trim();
}

/** The existing one-time/identity clauses stay in force until exact founder/Director approval. */
export function subscriptionLegalDocument(doc: LegalDoc, locale: Locale, approved: boolean): ReturnType<typeof legalDocument> {
  const base = legalDocument(doc, locale);
  if (!approved) return base;
  const ko = locale === 'ko';
  if (doc === 'privacy') return { ...base, body: `${base.body}\n\n${SUBSCRIPTION_PRIVACY_DRAFT[locale]}` };
  if (doc === 'refund') {
    const body = ko ? base.body.replace('TWINGS의 유료 상품은', 'TWINGS의 단건 구매 상품은') : base.body.replace('The only paid item on TWINGS is', 'A one-time purchase on TWINGS is');
    const preface = ko ? '아래 1~7항은 템플릿 단건 구매에 적용됩니다. 월 구독에는 이 문서 마지막의 월 구독 환불 기준을 적용합니다.' : 'Sections 1–7 below apply to one-time template purchases. Monthly subscriptions follow the subscription refund terms at the end of this document.';
    const refund = section(SUBSCRIPTION_TERMS_DRAFT[locale], ko ? '환불' : 'Refunds');
    const cancellation = section(SUBSCRIPTION_TERMS_DRAFT[locale], ko ? '해지' : 'Cancellation');
    return { ...base, summary: ko ? '템플릿 단건 구매와 월 구독의 해지·환불 기준입니다.' : 'Cancellation and refunds for one-time templates and monthly subscriptions.',
      body: `${preface}\n\n${body}\n\n# ${ko ? '월 구독의 해지와 환불' : 'Monthly subscription cancellation and refunds'}\n\n${cancellation}\n\n${refund}` };
  }
  const start = base.body.indexOf(ko ? '## 제4조 (결제)' : '## 4. Payment');
  const end = base.body.indexOf(ko ? '## 제5조' : '## 5.', start);
  if (start < 0 || end < 0) throw new Error('subscription_legal_payment_section_missing');
  const payment = ko ? `## 제4조 (결제)

1. 템플릿 단건 구매는 한 편당 한 번 결제하며, 가격은 템플릿 페이지에 원화로 표시합니다. 단건 구매의 생성은 결제가 완료되면 시작됩니다.
2. 월 구독은 가입 화면의 플랜 금액과 제작량을 기준으로 결제하며, 첫 결제가 승인되면 이용할 수 있습니다. 이후 같은 플랜의 요금이 매월 자동으로 청구됩니다.
3. 결제·해지·환불과 맞춤 수정에 관한 월 구독 기준은 이 문서 마지막의 월 구독 약관을 따릅니다.
4. 본인 얼굴과 초상권 검증, 결과물과 템플릿의 권리, 금지 행위에 관한 아래 조항은 단건 구매와 월 구독에 모두 적용됩니다.

` : `## 4. Payment

1. A one-time template purchase is paid once per result. Its price is shown in Korean won on the template page, and creation starts after payment completes.
2. A monthly subscription uses the plan price and capacity shown at enrollment. Access begins after the first payment is approved, and the same plan is billed automatically each month.
3. Monthly billing, cancellation, refunds and adjustments follow the subscription terms at the end of this document.
4. The likeness checks, result and template rights, and prohibited-conduct clauses below apply to both one-time purchases and monthly subscriptions.

`;
  return { ...base, body: `${base.body.slice(0, start)}${payment}${base.body.slice(end)}\n\n# ${ko ? '월 구독 약관' : 'Monthly subscription terms'}\n\n${SUBSCRIPTION_TERMS_DRAFT[locale]}` };
}
