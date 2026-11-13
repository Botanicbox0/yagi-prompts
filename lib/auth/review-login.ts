/** PG review is a normal Supabase user, never an auth or payment bypass. */
export interface ReviewSession { access_token: string; refresh_token: string }
export interface ReviewLoginDependencies {
  authenticate(input: { email: string; password: string }): Promise<{
    user: { id: string; app_metadata?: Record<string, unknown> };
    session: ReviewSession;
  } | null>;
  ordinaryProfile(id: string): Promise<boolean>;
  commit(session: ReviewSession): Promise<boolean>;
}

/** The reviewer addresses, lower case. This domain is not the staff domain. */
export const REVIEW_ACCOUNT_EMAIL = /^pg-review(?:-[a-z0-9]+)*@twings\.app$/;
export const isReviewAccountEmail = (email: string | null | undefined): boolean =>
  typeof email === 'string' && REVIEW_ACCOUNT_EMAIL.test(email.trim().toLowerCase());

export async function authenticateReviewAccount(
  input: { email: unknown; password: unknown }, deps: ReviewLoginDependencies,
): Promise<boolean> {
  if (typeof input.email !== 'string' || typeof input.password !== 'string') return false;
  const email = input.email.trim().toLowerCase();
  // This domain is not the staff domain. Other customers retain Google/Kakao sign-in.
  if (!REVIEW_ACCOUNT_EMAIL.test(email) || email.length > 120
    || input.password.length < 1 || input.password.length > 256) return false;
  try {
    const result = await deps.authenticate({ email, password: input.password });
    if (!result || result.user.app_metadata?.purpose !== 'toss_review') return false;
    if (!await deps.ordinaryProfile(result.user.id)) return false;
    return await deps.commit(result.session);
  } catch { return false; }
}
