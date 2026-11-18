/**
 * GPT Image 2.6 `reasoning_effort` ("complexity": how much the model plans before rendering; OpenAI image
 * prompting guide, read 2026-11-19). Both Sunra lanes take it for GPT Image 2.6: the API lane's OpenAPI
 * document (low | medium | high, default high) and the account lane's `create_image` ("Same price at every
 * level", default high), read 2026-11-19.
 *
 * The studio keeps the provider's default (high) for anything that needs planning — text or layout in the
 * picture, three or more references, a partial edit — and asks for medium for a plain shot (a product or a
 * person with up to two references and no lettering), which renders sooner. Low is never chosen: the
 * customer's picture is the deliverable. Pure; client-safe.
 */
export type GptReasoningEffort = 'low' | 'medium' | 'high';

/** Words that mean a layout or lettering the model has to plan (Korean and English). */
const LAYOUT = /포스터|배너|인포그래픽|카드\s*뉴스|상세\s*페이지|메뉴(?:판)?|슬라이드|문구|글자|글씨|타이포|레이아웃|제목|로고|라벨|표\b|차트|다이어그램|\b(?:poster|banner|infographic|slide|menu|flyer|brochure|typography|layout|headline|title|caption|label|logo|chart|diagram|card|packaging copy|text)\b/i;
/** A quoted string of two or more characters: copy that must appear. */
const QUOTED = /["“”'‘’「『]([^"“”'‘’」』]{2,})["“”'‘’」』]/;

export function gptReasoningEffort(input: { kind: string; prompt: string; references: number }): GptReasoningEffort {
  if (input.kind !== 'image') return 'high';
  if (input.references >= 3) return 'high';
  if (QUOTED.test(input.prompt) || LAYOUT.test(input.prompt)) return 'high';
  return 'medium';
}
