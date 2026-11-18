/**
 * The one question a revision request may get back (docs/BRAND-STUDIO-V6-PLAN.md §4.6): when it reads two
 * ways, `revise.plan` asks, the customer picks a choice (or has it made as written), and the answer is
 * stored with the version as `params.revision.clarified`. Pure helpers, no I/O: the job view, the clip's
 * history and the prompt writer's fallback all read the answer through these.
 */

export interface StoredClarified {
  question: string;
  answer: string;
}

/** A stored answer, when it is one (an older or hand-edited row may hold anything). */
export function clarifiedOf(revision: { clarified?: unknown } | null | undefined): StoredClarified | null {
  const c = revision?.clarified as { question?: unknown; answer?: unknown } | undefined;
  if (!c || typeof c.question !== 'string' || typeof c.answer !== 'string') return null;
  const question = c.question.trim();
  const answer = c.answer.trim();
  return question && answer ? { question, answer } : null;
}

/**
 * A request with the customer's answer after it, for readers that take requests as plain lines (the history
 * the prompt writer and the reading see, the fallback prompt): "병 색을 바꿔 줘 (왼쪽 병)".
 */
export function withClarified(request: string, clarified: { answer: string } | null | undefined): string {
  const answer = clarified?.answer?.trim();
  return answer ? `${request.trim()} (${answer})` : request;
}
