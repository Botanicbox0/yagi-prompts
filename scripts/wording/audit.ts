export interface Scores { clarity: number; specificity: number; naturalness: number }
export interface Review {
  source_ko: string;
  source_en: string;
  ko: Scores;
  en: Scores;
  proposed_ko: string;
  proposed_en: string;
  reason: string;
  evidence: string;
  decision: 'candidate' | 'owner-decision' | 'keep' | 'retire-if-unused';
  topic: string;
}

/** A transparent triage, not a substitute for a contextual language review. 3 = unassessed. */
export function triage(key: string, text: string, locale: 'ko' | 'en'): { scores: Scores; flags: string[] } {
  const scores: Scores = { clarity: 3, specificity: 3, naturalness: 3 };
  const flags: string[] = [];
  const flag = (name: string, axis: keyof Scores) => { flags.push(name); scores[axis] = 2; };
  if (text.length > (locale === 'ko' ? 140 : 270)) flag('long-copy', 'clarity');
  if (locale === 'ko' && /플레이북|YAGI PROMPTS/.test(text)) flag('legacy-product-language', 'clarity');
  if (/크레딧|포인트|충전|이용권|쿠키|\bcredits?\b|\bcookies?\b|top.?up/i.test(text)) flag('stored-value-or-cookie-review', 'clarity');
  if (!key.startsWith('admin.') && /홀드|파이프라인|자산 그룹|슬롯|레일|리비전|\bhold\b|pipeline|asset group|\bslots?\b/i.test(text)) flag('internal-term', 'naturalness');
  if (/파생 오가닉|유가 프로젝트|원고료입니다|동의 위에서|반려|한 줄 어필/.test(text)) flag('awkward-or-operator-language', 'naturalness');
  if (/7일|seven.day|7.day|1영업일|one business day|24시간|24 hours|바로 지급|immediate.*pa/i.test(text)) flag('timing-promise-review', 'specificity');
  if (/Seedance 2\.0|GPT Image 1|KLING|VEO/.test(text)) flag('model-or-offer-freshness', 'specificity');
  if (/항상|완벽한|보장|guaranteed|always|100%/i.test(text)) flag('absolute-claim-review', 'specificity');
  return { scores, flags };
}

export function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

export function validateReviews(reviews: Record<string, Review>, ko: Map<string, string>, en: Map<string, string>): void {
  for (const [key, review] of Object.entries(reviews)) {
    if (!ko.has(key) || !en.has(key)) throw new Error(`Unknown review key: ${key}`);
    for (const locale of ['ko', 'en'] as const) {
      for (const axis of ['clarity', 'specificity', 'naturalness'] as const) {
        const score = review[locale][axis];
        if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error(`Invalid score: ${key}.${locale}.${axis}`);
      }
      const proposed = review[`proposed_${locale}`];
      if (!proposed.trim()) throw new Error(`Empty proposal: ${key}.${locale}`);
      const current = (locale === 'ko' ? ko : en).get(key)!;
      if (review[`source_${locale}`] !== current) throw new Error(`Stale review source: ${key}.${locale}; review the changed wording before updating its source snapshot`);
      if (JSON.stringify(placeholders(proposed)) !== JSON.stringify(placeholders(current))) throw new Error(`Changed placeholders: ${key}.${locale}`);
    }
    if (!review.reason.trim() || !review.evidence.trim()) throw new Error(`Missing rationale: ${key}`);
    if (!['candidate', 'owner-decision', 'keep', 'retire-if-unused'].includes(review.decision)) throw new Error(`Invalid decision: ${key}`);
  }
}
