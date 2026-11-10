export type ConciergeLocale = 'ko' | 'en';

export type ConciergeFaqCategory =
  | 'selfie'
  | 'customize'
  | 'selective_frames'
  | 'pricing'
  | 'maker_revenue'
  | 'campaign_reward';

export interface PersonalConciergeFaqItem {
  id: string;
  category: ConciergeFaqCategory;
  categoryLabel: string;
  question: string;
  shortLabel: string;
  answer: string;
  actionLabel?: string;
  actionHref?: string;
  keywords: readonly string[];
}

export type EscalationReason =
  | 'user_requested_human'
  | 'account_or_billing_check'
  | 'ai_unanswered';

export interface ConciergeAiAnswerResult {
  answeredByAi: boolean;
  needsHumanEscalation: boolean;
  escalationReason?: EscalationReason;
  matchedFaqId?: string;
  reply: string;
  actionLabel?: string;
  actionHref?: string;
}

export interface ConciergeTranscriptTurn {
  role: 'user' | 'ai' | 'human_agent';
  text: string;
}

export interface PersonalSupportSlackReply {
  id: string;
  body: string;
  createdAt: string;
  authorLabel: string;
}

export const PREFERRED_PERSONAL_SUPPORT_CHANNELS = [
  'twings-support',
  'twings-concierge',
  'twings-cs',
  'twings-brand-concierge',
] as const;

export const FALLBACK_PERSONAL_SUPPORT_CHANNEL_ID = 'C0B74D4L6MN'; // #hermes-notifier

export function getPersonalConciergeFaqs(
  locale: ConciergeLocale = 'ko',
): readonly PersonalConciergeFaqItem[] {
  const isKo = locale === 'ko';
  return [
    {
      id: 'selfie-guide',
      category: 'selfie',
      categoryLabel: isKo ? '얼굴 · 셀카 가이드' : 'Selfie & Likeness',
      shortLabel: isKo ? '📸 어떤 셀카를 올리면 잘 나오나요?' : '📸 Best selfie tips & 2-candidate choice',
      question: isKo
        ? '어떤 셀카를 올리면 얼굴이 가장 자연스럽게 닮게 나오나요?'
        : 'What kind of selfie gives the most natural likeness?',
      answer: isKo
        ? '이목구비가 또렷하게 보이는 정면 셀카 1장이면 충분합니다. 선글라스·마스크·심한 측면 각도나 어두운 역광만 피해 주세요. 또한 전신 위주이거나 조명이 강한 장면은 AI가 먼저 2가지 닮음새 후보(타입 A · 타입 B)를 생성해 더 닮은 얼굴을 직접 고르실 수 있게 도와드립니다.'
        : 'One clear front-facing photo with visible facial features is all you need. Avoid sunglasses, masks, or extreme side angles. On distant or stylized scenes, TWINGS generates 2 likeness candidates (Type A & Type B) so you can pick the one that looks most like you.',
      actionLabel: isKo ? '내 기준 셀카 관리하기 →' : 'Manage my reference selfie →',
      actionHref: '/identity/selfie',
      keywords: [
        '셀카',
        '사진',
        '얼굴',
        '정면',
        '닮은',
        '닮음',
        '안 닮',
        '각도',
        '본인',
        '초상권',
        'selfie',
        'photo',
        'face',
        'likeness',
      ],
    },
    {
      id: 'template-modify',
      category: 'customize',
      categoryLabel: isKo ? '의상 · 배경 수정' : 'Outfit & Scene Edits',
      shortLabel: isKo ? '👗 의상이나 배경을 내 사진으로 바꿀 수 있나요?' : '👗 Can I swap outfits or backgrounds?',
      question: isKo
        ? '템플릿의 의상이나 배경을 내가 원하는 스타일이나 사진으로 바꿀 수 있나요?'
        : 'Can I change the template outfit or background with my own reference image?',
      answer: isKo
        ? '네! 모든 템플릿 상세 페이지에서 "고정되는 연출 vs 내 취향대로 바꿀 수 있는 요소"를 확인하실 수 있습니다. 원하는 의상·메이크업이나 배경·공간을 텍스트로 적거나 내 레퍼런스 이미지를 직접 업로드하면, AI가 임의 변형 없이 원본 사진의 핏과 색감을 살려 반영합니다.'
        : 'Yes! Every template page clearly lists what is locked vs. customizable. You can describe your desired outfit/makeup or background in text or upload your own reference photo directly without unwanted AI distortion.',
      actionLabel: isKo ? '영상 템플릿 둘러보기 →' : 'Browse video templates →',
      actionHref: `/${locale}/video`,
      keywords: [
        '의상',
        '옷',
        '배경',
        '수정',
        '바꾸',
        '변경',
        '레퍼런스',
        '메이크업',
        '스타일',
        '고정',
        'outfit',
        'background',
        'modify',
        'change',
        'reference',
        'custom',
      ],
    },
    {
      id: 'selective-5shot',
      category: 'selective_frames',
      categoryLabel: isKo ? '5장 화보 선택 제작' : 'Selective 5-Shot Set',
      shortLabel: isKo ? '🖼️ 5장 화보 중 원하는 컷만 골라 만들 수 있나요?' : '🖼️ Can I pick only 1–3 shots from a 5-shot set?',
      question: isKo
        ? '5장 이미지 화보 템플릿에서 원하는 1~3컷만 골라서 제작할 수 있나요?'
        : 'Can I select and render only specific frames from a 5-shot editorial image set?',
      answer: isKo
        ? '네, 가능합니다! 5장 연속 화보 세트 템플릿 상세 화면에서 원하는 컷(1~5장)만 클릭해 선택하시면, 선택한 장수만큼만 크레딧이 비례 차감됩니다(1컷 9 크레딧 · 2컷 18 크레딧 · 3컷 27 크레딧 · 5장 전체 45 크레딧).'
        : 'Yes! On any 5-shot editorial set template, you can toggle only the frames you want (1 to 5 shots), and your credits scale proportionally (1 shot = 9 cr, 3 shots = 27 cr, all 5 shots = 45 cr).',
      actionLabel: isKo ? '5장 화보 세트 보러 가기 →' : 'Explore 5-shot image sets →',
      actionHref: `/${locale}/image`,
      keywords: [
        '5장',
        '화보',
        '골라서',
        '선택',
        '일부만',
        '한장만',
        '1장',
        '3장',
        '컷',
        '이미지 템플릿',
        '5-shot',
        'selective',
        'frames',
        'pick',
      ],
    },
    {
      id: 'maker-revenue',
      category: 'maker_revenue',
      categoryLabel: isKo ? '나만의 영상 · 80% 수익' : 'Make Your Own & 80% Revenue',
      shortLabel: isKo ? '💰 내 템플릿을 올리면 정말 수익의 80%를 받나요?' : '💰 Do I really earn 80% when others use my template?',
      question: isKo
        ? '나만의 영상을 제작하고 템플릿으로 올리면 어떻게 수익을 받나요?'
        : 'How does the 80% Maker revenue share work when I publish my own template?',
      answer: isKo
        ? '"나만의 영상 제작하기"에서 레퍼런스 영상·사진으로 완성한 장면을 내 템플릿으로 공개하면, 다른 유저가 그 템플릿으로 제작할 때마다 순수익(판매가 − 생성 원가 − 결제 수수료 4%)의 80%가 회원님의 메이커 정산금으로 자동 적립됩니다.'
        : 'When you create a scene in "Make Your Own Video" and publish it as a template, you automatically earn 80% of the net profit (sale price minus generation cost and 4% payment fee) every time another user renders with your template.',
      actionLabel: isKo ? '나만의 영상 제작 & 수익 계산기 →' : 'Open Make Your Own Video & Calculator →',
      actionHref: `/${locale}/direct`,
      keywords: [
        '나만의 영상',
        '템플릿 올리',
        '템플릿 등록',
        '수익',
        '80%',
        '메이커',
        '로열티',
        '정산금',
        '직접 연출',
        'maker',
        'revenue',
        'royalty',
        'publish',
      ],
    },
    {
      id: 'campaign-reward',
      category: 'campaign_reward',
      categoryLabel: isKo ? '캠페인 현금 수익화' : 'Campaign Cash Rewards',
      shortLabel: isKo ? '🏆 캠페인 영상 올리고 현금 정산 받는 법' : '🏆 How to earn cash from brand campaigns',
      question: isKo
        ? '브랜드 캠페인에 참여해서 현금 리워드를 받으려면 어떻게 해야 하나요?'
        : 'How do I participate in brand campaigns and get paid cash rewards?',
      answer: isKo
        ? '캠페인 탭에서 ① 브랜드 지정 공식 포맷으로 제작비 0원(브랜드 전액 지원)으로 내 영상을 만들어 올리거나, ② 브랜드 가이드(필수 해시태그·언급·7일 유지)를 지켜 나만의 영상을 SNS에 업로드하고 링크를 제출하시면 검수 후 현금 리워드와 2차 광고 활용 보너스를 정산받으실 수 있습니다.'
        : 'In the Campaigns tab, either (1) render with the official brand format at 0 cost (sponsored by the brand) or (2) create your own video following the brand guide (required hashtags, mention, 7-day retention), post to SNS, and submit the link for cash payout plus secondary ad licensing bonuses.',
      actionLabel: isKo ? '진행 중인 수익화 캠페인 보기 →' : 'View active cash campaigns →',
      actionHref: `/${locale}/campaigns`,
      keywords: [
        '캠페인',
        '광고',
        '리워드',
        '현금',
        '수익화',
        '해시태그',
        '인스타',
        '틱톡',
        '릴스',
        '가이드',
        'campaign',
        'reward',
        'cash',
        'tiktok',
        'reels',
      ],
    },
    {
      id: 'pricing-refund',
      category: 'pricing',
      categoryLabel: isKo ? '요금 · 제작 시간 · 환불' : 'Pricing, Time & Refunds',
      shortLabel: isKo ? '💳 제작 소요 시간과 오류 시 환불 기준' : '💳 Generation time & automatic refund policy',
      question: isKo
        ? '제작 시간은 얼마나 걸리고, 오류가 나면 환불되나요?'
        : 'How long does generation take, and what is the refund policy if an error occurs?',
      answer: isKo
        ? '화보 이미지는 약 1분, 영상은 약 2~5분 내외로 완성되며 완료 시 웹 푸시와 이메일로 알림을 보내드립니다. 만약 시스템 오류나 생성 실패로 결과물이 완성되지 않은 경우 결제 금액(또는 차감 크레딧)은 100% 자동 취소·환불됩니다.'
        : 'Editorial images take about 1 minute and videos take 2–5 minutes, with email and web push notifications on completion. If a system or generation failure prevents completion, your payment or credits are 100% automatically refunded.',
      actionLabel: isKo ? '요금 및 이용 안내 보기 →' : 'View pricing & policy →',
      actionHref: `/${locale}/pricing`,
      keywords: [
        '가격',
        '요금',
        '시간',
        '얼마나 걸',
        '몇분',
        '알림',
        '푸시',
        '이메일',
        'price',
        'cost',
        'time',
        'how long',
        'notification',
      ],
    },
  ];
}

const EXPLICIT_HUMAN_KEYWORDS = [
  '상담원',
  '사람',
  '담당자',
  '직원',
  '상담사',
  '직접 문의',
  '1:1',
  '일대일',
  '슬랙',
  '연결해',
  '대화하고 싶',
  '통화',
  '채팅 상담',
  'human',
  'live agent',
  'real person',
  'talk to someone',
  'support agent',
  'representative',
  'operator',
  'slack',
];

const ACCOUNT_DISPUTE_KEYWORDS = [
  '결제 오류',
  '결제 취소',
  '환불해',
  '환불 신청',
  '환불 요청',
  '돈이 빠져',
  '중복 결제',
  '안 들어왔',
  '정산이 안',
  '로그인이 안',
  '계정 탈퇴',
  '버그',
  '오류 났',
  '에러',
  '실패했',
  '신고',
  'refund request',
  'charged twice',
  'payment error',
  'billing issue',
  'bug',
  'broken',
  'not working',
];

/**
 * Evaluates a customer's free-text question in the TWINGS AI Support Center.
 * Returns an immediate grounded answer when covered by TWINGS FAQ knowledge,
 * or flags `needsHumanEscalation: true` when the user wants a human or when the AI cannot answer.
 */
export function answerPersonalConciergeQuery(input: {
  query: string;
  locale?: ConciergeLocale;
}): ConciergeAiAnswerResult {
  const locale: ConciergeLocale = input.locale === 'en' ? 'en' : 'ko';
  const isKo = locale === 'ko';
  const normalized = input.query.trim().toLowerCase();

  if (!normalized) {
    return {
      answeredByAi: true,
      needsHumanEscalation: false,
      reply: isKo
        ? '궁금하신 점을 입력하시거나 아래 자주 묻는 질문을 선택해 주세요.'
        : 'Type your question or choose one of the frequently asked questions below.',
    };
  }

  // 1. Explicit request for a human agent
  if (EXPLICIT_HUMAN_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return {
      answeredByAi: false,
      needsHumanEscalation: true,
      escalationReason: 'user_requested_human',
      reply: isKo
        ? '담당 상담원과 1:1 실시간 상담으로 바로 연결해 드릴게요. 계정 확인과 실시간 답변 수신을 위해 로그인 후 메시지를 남겨주시면 담당자가 즉시 확인합니다.'
        : 'I will connect you directly with a support specialist. Please sign in so we can verify your account and deliver live replies right here.',
    };
  }

  // 2. Account-specific billing, refund dispute, or bug report requiring human inspection
  if (ACCOUNT_DISPUTE_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return {
      answeredByAi: false,
      needsHumanEscalation: true,
      escalationReason: 'account_or_billing_check',
      reply: isKo
        ? '결제·환불 확인이나 계정별 생성 오류는 담당 팀원이 회원님의 작업 내역을 직접 확인해 처리해 드리고 있습니다. 아래 상담원 1:1 연결을 통해 바로 전달해 주세요.'
        : 'Billing checks, refund requests, and account-specific generation issues require a specialist to inspect your job history directly. Please connect with a specialist below.',
    };
  }

  // 3. Match against curated TWINGS FAQ knowledge base
  const faqs = getPersonalConciergeFaqs(locale);
  let bestFaq: PersonalConciergeFaqItem | null = null;
  let bestScore = 0;

  for (const faq of faqs) {
    let score = 0;
    for (const kw of faq.keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        score += kw.length >= 3 ? 2 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestFaq = faq;
    }
  }

  if (bestFaq && bestScore > 0) {
    return {
      answeredByAi: true,
      needsHumanEscalation: false,
      matchedFaqId: bestFaq.id,
      reply: bestFaq.answer,
      actionLabel: bestFaq.actionLabel,
      actionHref: bestFaq.actionHref,
    };
  }

  // 4. Unanswered / unrecognized query -> escalate to human on Slack rather than hallucinating
  return {
    answeredByAi: false,
    needsHumanEscalation: true,
    escalationReason: 'ai_unanswered',
    reply: isKo
      ? '이 질문은 AI가 추측해서 답변하기보다 TWINGS 담당 상담원이 직접 확인해 안내해 드리는 것이 정확합니다. 아래에서 상담원과 1:1로 연결해 보세요.'
      : 'To give you an accurate answer rather than a guess, our TWINGS support specialist should check this directly. Connect with a specialist below.',
  };
}

export function personalSlackHandle(
  displayName?: string | null,
  email?: string | null,
  userId?: string,
): string {
  const seed =
    displayName?.trim() ||
    email?.split('@')[0]?.trim() ||
    userId?.slice(0, 8) ||
    'member';
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `@${slug || 'member'}`;
}

export function formatPersonalSupportSlackMessage(input: {
  userId: string;
  displayName?: string | null;
  email?: string | null;
  reason: EscalationReason;
  message: string;
  pagePath?: string;
  transcript?: readonly ConciergeTranscriptTurn[];
}): string {
  const handle = personalSlackHandle(input.displayName, input.email, input.userId);
  const reasonLabel =
    input.reason === 'user_requested_human'
      ? '고객 직접 상담원 연결 요청'
      : input.reason === 'account_or_billing_check'
        ? '결제·환불·계정 확인 요청'
        : 'AI 미해결 질문 자동 에스컬레이션';

  const recentTurns = (input.transcript ?? [])
    .slice(-4)
    .map((t) => {
      const speaker = t.role === 'user' ? '고객' : t.role === 'ai' ? 'AI' : '상담원';
      return `> [${speaker}] ${t.text.replace(/\r?\n/g, ' ')}`;
    });

  const quotedMessage = input.message
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');

  const lines = [
    `🛎️ *[twings.app AI 상담센터 · 실시간 상담원 연결]*`,
    `• *고객:* *${input.displayName || 'TWINGS 회원'}* (\`${handle}\`${input.email ? ` · ${input.email}` : ''})`,
    `• *연결 사유:* ${reasonLabel}`,
    ...(input.pagePath ? [`• *접속 페이지:* \`${input.pagePath}\``] : []),
    ...(recentTurns.length > 0
      ? [`• *이전 AI 대화 요약:*`, ...recentTurns]
      : []),
    `• *고객 문의 메시지:*`,
    quotedMessage,
    `↩️ _답변 방법: 이 메시지의 *스레드(댓글)*로 답장하거나 채널에 \`${handle} 답변내용\`을 입력하면 고객의 twings.app 상담창으로 즉시 전달됩니다._ \`[twings-user:${input.userId}]\``,
  ];

  return lines.join('\n');
}

export function parsePersonalSupportSlackReply(
  rawText: string,
  userId: string,
  userHandle: string,
  parentText?: string | null,
): string | null {
  const text = rawText.trim();
  if (!text) return null;
  if (
    text.includes('[twings.app AI 상담센터') ||
    text.includes('[twings-user:')
  ) {
    return null;
  }

  const normalizedHandle = userHandle.replace(/^@/, '').toLowerCase();
  const mentionMatch = /^\[?@([a-zA-Z0-9가-힣_-]+)\]?[\s,:;-]+([\s\S]+)$/.exec(text);
  if (mentionMatch) {
    const token = mentionMatch[1]!.toLowerCase();
    const replyBody = mentionMatch[2]!.trim();
    if (
      replyBody &&
      (token === normalizedHandle || token === userId.toLowerCase() || token === userId.slice(0, 8).toLowerCase())
    ) {
      return replyBody;
    }
  }

  if (parentText && parentText.toLowerCase().includes(`[twings-user:${userId.toLowerCase()}]`)) {
    const cleaned = text.replace(/^(?:<@[A-Z0-9]+>\s*)+/, '').trim();
    if (cleaned) return cleaned;
  }

  return null;
}

export interface PersonalSupportSlackConfig {
  mode: 'bot' | 'webhook';
  token?: string;
  channelId?: string;
  webhookUrl?: string;
}

export function resolvePersonalSupportSlackConfig(
  env: Record<string, string | undefined> = process.env,
): PersonalSupportSlackConfig | null {
  if (env.VITEST && env.SLACK_PERSONAL_SUPPORT_FORCE_TEST !== 'on') return null;
  if (env.SLACK_PERSONAL_SUPPORT_ENABLED === 'off') return null;

  const token = (
    env.SLACK_SUPPORT_BOT_TOKEN ??
    env.SLACK_BRAND_CONCIERGE_BOT_TOKEN ??
    env.SLACK_BOT_TOKEN
  )?.trim();

  if (token && token.startsWith('xoxb-')) {
    const channelId =
      (
        env.SLACK_SUPPORT_CHANNEL_ID ??
        env.SLACK_BRAND_CONCIERGE_CHANNEL_ID
      )?.trim() || 'auto';
    return { mode: 'bot', token, channelId };
  }

  const webhookUrl = (
    env.SLACK_SUPPORT_WEBHOOK_URL ??
    env.SLACK_BRAND_INQUIRIES_WEBHOOK_URL
  )?.trim();

  if (webhookUrl && webhookUrl.startsWith('https://hooks.slack.com/services/')) {
    return { mode: 'webhook', webhookUrl };
  }

  return null;
}

let cachedSupportChannelId: { id: string; resolvedAt: number } | null = null;

async function resolveSupportChannelId(
  token: string,
  configuredChannel: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (/^[CG][A-Z0-9]{8,}$/.test(configuredChannel)) {
    return configuredChannel;
  }
  const now = Date.now();
  if (cachedSupportChannelId && now - cachedSupportChannelId.resolvedAt < 60_000) {
    return cachedSupportChannelId.id;
  }

  const desiredNames = Array.from(
    new Set([
      ...(configuredChannel !== 'auto'
        ? [configuredChannel.replace(/^#/, '').toLowerCase()]
        : []),
      ...PREFERRED_PERSONAL_SUPPORT_CHANNELS,
    ]),
  );

  try {
    const listResp = await fetcher(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (listResp.ok) {
      const data = (await listResp.json()) as {
        ok?: boolean;
        channels?: Array<{ id?: string; name?: string; is_archived?: boolean }>;
      };
      const channels = (data.channels ?? []).filter((c) => !c.is_archived && c.id && c.name);
      for (const name of desiredNames) {
        const found = channels.find((c) => c.name?.toLowerCase() === name);
        if (found?.id) {
          cachedSupportChannelId = { id: found.id, resolvedAt: now };
          return found.id;
        }
      }
    }
  } catch {
    // Fall through to fallback channel ID
  }

  cachedSupportChannelId = {
    id: FALLBACK_PERSONAL_SUPPORT_CHANNEL_ID,
    resolvedAt: now,
  };
  return FALLBACK_PERSONAL_SUPPORT_CHANNEL_ID;
}

export async function notifySlackPersonalConcierge(
  input: {
    userId: string;
    displayName?: string | null;
    email?: string | null;
    reason: EscalationReason;
    message: string;
    pagePath?: string;
    transcript?: readonly ConciergeTranscriptTurn[];
  },
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean; channelId?: string; ts?: string }> {
  const config = resolvePersonalSupportSlackConfig(options?.env);
  if (!config) return { sent: false };

  const fetcher = options?.fetcher ?? fetch;
  const text = formatPersonalSupportSlackMessage(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 4500);

  try {
    if (config.mode === 'bot' && config.token) {
      const channelId = await resolveSupportChannelId(
        config.token,
        config.channelId ?? 'auto',
        fetcher,
      );
      const response = await fetcher('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          channel: channelId,
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      if (!response.ok) return { sent: false };
      const payload = (await response.json()) as { ok?: boolean; ts?: string };
      return {
        sent: payload.ok === true,
        channelId,
        ts: payload.ts,
      };
    }

    if (config.mode === 'webhook' && config.webhookUrl) {
      const response = await fetcher(config.webhookUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          unfurl_links: false,
          unfurl_media: false,
        }),
      });
      return { sent: response.ok };
    }

    return { sent: false };
  } catch {
    return { sent: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSlackPersonalConciergeReplies(
  input: {
    userId: string;
    displayName?: string | null;
    email?: string | null;
  },
  options?: {
    env?: Record<string, string | undefined>;
    fetcher?: typeof fetch;
  },
): Promise<PersonalSupportSlackReply[]> {
  const config = resolvePersonalSupportSlackConfig(options?.env);
  if (!config || config.mode !== 'bot' || !config.token) return [];

  const fetcher = options?.fetcher ?? fetch;
  const userHandle = personalSlackHandle(input.displayName, input.email, input.userId);

  try {
    const channelId = await resolveSupportChannelId(
      config.token,
      config.channelId ?? 'auto',
      fetcher,
    );
    const historyResp = await fetcher(
      `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=25`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.token}` },
      },
    );
    if (!historyResp.ok) return [];
    const historyData = (await historyResp.json()) as {
      ok?: boolean;
      messages?: Array<{
        ts?: string;
        text?: string;
        subtype?: string;
        reply_count?: number;
      }>;
    };
    if (!historyData.ok || !Array.isArray(historyData.messages)) return [];

    const replies: PersonalSupportSlackReply[] = [];
    const chronological = [...historyData.messages].reverse();

    for (const msg of chronological) {
      if (!msg.ts || !msg.text) continue;
      if (msg.subtype && msg.subtype !== 'thread_broadcast') continue;
      const directBody = parsePersonalSupportSlackReply(
        msg.text,
        input.userId,
        userHandle,
        null,
      );
      if (directBody) {
        replies.push({
          id: `slack-${msg.ts}`,
          body: directBody,
          createdAt: new Date(Number(msg.ts.split('.')[0]) * 1000).toISOString(),
          authorLabel: 'TWINGS 담당 상담원',
        });
      }
    }

    const userParents = historyData.messages
      .filter(
        (m) =>
          m.ts &&
          m.text &&
          m.text.toLowerCase().includes(`[twings-user:${input.userId.toLowerCase()}]`) &&
          typeof m.reply_count === 'number' &&
          m.reply_count > 0,
      )
      .slice(0, 4);

    for (const parent of userParents) {
      if (!parent.ts || !parent.text) continue;
      const threadResp = await fetcher(
        `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(parent.ts)}&limit=15`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.token}` },
        },
      );
      if (!threadResp.ok) continue;
      const threadData = (await threadResp.json()) as {
        ok?: boolean;
        messages?: Array<{ ts?: string; text?: string; subtype?: string }>;
      };
      if (!threadData.ok || !Array.isArray(threadData.messages)) continue;
      for (const reply of threadData.messages) {
        if (!reply.ts || reply.ts === parent.ts || !reply.text) continue;
        if (reply.subtype && reply.subtype !== 'thread_broadcast') continue;
        const parsedBody = parsePersonalSupportSlackReply(
          reply.text,
          input.userId,
          userHandle,
          parent.text,
        );
        if (parsedBody) {
          replies.push({
            id: `slack-${reply.ts}`,
            body: parsedBody,
            createdAt: new Date(Number(reply.ts.split('.')[0]) * 1000).toISOString(),
            authorLabel: 'TWINGS 담당 상담원',
          });
        }
      }
    }

    return replies;
  } catch {
    return [];
  }
}
