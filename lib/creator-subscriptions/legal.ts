/** A reviewable draft, never an implicit approval of a new recurring sales contract. */
export const SUBSCRIPTION_TERMS_VERSION = 'creator-subscription-2026-10-09-v1';

export const SUBSCRIPTION_TERMS_DRAFT = {
  ko: `## 월 구독과 결제

크리에이터는 월 24,900원, 프리미엄은 월 49,000원이며 부가세가 포함됩니다. 카드를 등록하고 첫 결제가 승인되면 한 달 동안 사용할 영상 제작량이 제공됩니다. 다음 결제일에는 같은 플랜의 요금이 자동으로 청구됩니다. 첫 결제일이 해당 월에 없는 경우 그 달의 마지막 날에 갱신하고, 다음 달에는 원래 결제일을 기준으로 합니다.

## 영상 제작량

제작량은 영상 길이와 화면 비율에 따라 사용됩니다. 제작 전에 필요한 사용량을 확인할 수 있습니다. 제공 범위는 해당 템플릿의 Seedance 2.5 · 720p 영상이며, 다른 모델이나 이미지 제작은 별도로 안내합니다. 결제 기간이 끝나면 남은 제작량은 이월되지 않습니다. 생성 실패로 영상이 완성되지 않으면 해당 작업에 사용한 제작량을 돌려드립니다.

## 프리미엄 맞춤 수정

프리미엄에서는 텍스트와 참고 이미지 최대 3장으로 의상 색, 소품 색, 배경 색감, 조명을 조정할 수 있습니다. 원본의 인물, 장면 구성, 카메라 움직임과 길이는 유지됩니다. 요청이 원본에서 벗어날수록 결과가 달라질 수 있으며, 생성 결과를 보장하지 않습니다. 맞춤 수정 영상을 새로 만드는 경우에도 해당 영상의 제작량을 사용합니다. 원본과 수정된 제작 프롬프트는 공개하지 않습니다.

수정 요청은 가입 화면에 표시된 월 횟수 안에서 사용할 수 있으며, 결제 기간마다 새로 제공됩니다. 요청을 GPT에 보내 검토한 경우에는 제작이 진행되지 않아도 수정 요청 횟수가 사용됩니다. 검토에 들어가기 전에 거절된 요청은 횟수를 사용하지 않습니다. 원래 템플릿으로 만드는 영상에는 수정 요청 횟수가 필요하지 않습니다.

## 사진과 참고 이미지

얼굴 사진은 본인 사진만 사용할 수 있습니다. 기존 이용약관의 초상권 검증 절차는 구독에도 동일하게 적용됩니다. 참고 이미지는 사용 권한이 있는 것만 첨부해 주세요. 참고 이미지로 다른 사람의 얼굴을 적용할 수 없습니다. 요청과 참고 이미지는 맞춤 수정을 위해 OpenAI에 전달되고, 영상 생성에 필요한 정보는 기존 약관의 제공사로 전달됩니다. 원본 제작 프롬프트와 얼굴 기준 사진은 맞춤 수정을 위한 GPT 요청에 포함하지 않습니다. 사진이나 참고 이미지를 별도 동의 없이 홍보에 사용하지 않습니다.

## 해지

계정에서 다음 자동결제를 해지할 수 있습니다. 해지하면 다음 결제 기간부터 요금이 청구되지 않으며, 이미 결제한 기간이 끝날 때까지 남은 제작량을 사용할 수 있습니다. 결제가 진행 중이면 결과를 확인한 뒤에 해지합니다.

## 환불

현재 결제 기간의 제작량을 사용하지 않았고 제작 대기 중인 작업도 없다면 계정에서 전액 환불을 요청할 수 있습니다. 결제사에서 취소가 확인되면 해당 기간의 이용 권한과 다음 자동결제가 함께 끝납니다. 이미 제작을 시작한 작업이 있으면 고객센터에서 확인 후 안내해 드립니다. 서비스 결함이나 관련 법령에 따른 권리는 이 안내로 제한되지 않습니다.

## 변경과 문의

플랜의 금액이나 제공량이 달라지면 적용 전에 안내합니다. 이용 내역과 다음 결제일은 계정에서 확인할 수 있습니다. 문의는 hello@yagiworkshop.xyz로 보내주세요.`,
  en: `## Monthly subscription and billing

Creator costs KRW24,900 per month and Premium costs KRW49,000 per month, including VAT. After you register a card and the first payment is approved, video-making capacity is provided for one month. The same plan is billed automatically on the next billing date. When a month has no matching day, renewal falls on its last day; later months retain the original billing day.

## Video-making capacity

Use depends on video length and aspect ratio. The required amount is shown before creation. Eligible templates use Seedance 2.5 at 720p; other models and image creation are indicated separately. Unused capacity does not carry over. If generation fails without a completed video, the amount reserved for that job is restored.

## Premium adjustments

With Premium, a text request and up to three reference images can adjust clothing color, prop color, background palette and lighting. The original person, scene structure, camera movement and duration stay the same. Requests that move further from the original may produce less accurate results, and results are not guaranteed. Creating an adjusted video uses that video's capacity. Original and adjusted production prompts remain private.

Adjustment requests are limited to the monthly number shown at enrollment and renew each billing period. A request counts once it is sent to GPT for review, even if creation does not proceed. Requests rejected before that review do not count. Creating an original template does not use an adjustment request.

## Photos and reference images

Use only your own face photo. The identity and likeness checks in the existing terms also apply to subscriptions. Attach reference images only when you have the right to use them. References cannot substitute another person's face. Requests and reference images are sent to OpenAI for adjustments, and information needed for video generation is sent to the providers identified in the existing terms. The original production prompt and identity photo are excluded from the GPT adjustment request. Photos and references are not used for promotion without separate consent.

## Cancellation

You can stop the next automatic payment from your account. Once cancellation is recorded, no new period is billed; you retain unused capacity until the end of the period already paid for. If a payment is in progress, its outcome is checked before processing the request.

## Refunds

You may request a full refund of the current period from your account if none of its capacity has been used and no creation jobs are pending. Once the payment provider confirms cancellation, access for that period and the next renewal end. If creation has already started, contact support so we can check your activity. This notice does not restrict rights arising from service defects or applicable law.

## Changes and support

Changes to plan prices or capacity are communicated before they take effect. Your activity and next billing date are shown in your account. Contact hello@yagiworkshop.xyz for help.`,
} as const;
